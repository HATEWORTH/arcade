'use strict';
// ---- WASM HOST ----------------------------------------------------------
// Pong and Geo Wars are Rust now. This file is everything the page still owns:
// the overlays, pointer lock, input forwarding, the lobby, and the shim the
// Rust side calls back through for audio and storage.

(() => {
  const A = window.ARCADE;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- the surface Rust imports ----------------------------------------
  // Names here must match the #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST)]
  // declarations in rust/src/bridge.rs.
  window.ARCADE_WASM_HOST = {
    bleep: (f, d, w, g) => A.bleep(f, d, w, g),
    sweep: (f, t, d, w, g) => A.sweep(f, t, d, w, g),
    hat: (d, g) => A.hat(d, g),
    beat: () => [A.beat.kick, A.beat.snare, A.beat.bass, A.beat.arp, A.beat.phase],
    reducedMotion: () => reducedMotion,
    storageGet: k => {
      try { return localStorage.getItem(k) || undefined; } catch (e) { return undefined; }
    },
    storageSet: (k, v) => {
      try { localStorage.setItem(k, v); } catch (e) {}
    },
    event: (game, name, detail) => onGameEvent(game, name, detail),
    netSend: bytes => {
      if (net && net.chan && net.chan.readyState === 'open') net.chan.send(bytes);
    },
    sample: (name, vol) => A.sample(name, vol),
    // [glow, shake, particles] — read once per frame by the Rust renderer
    gfx: () => {
      const S = window.ARCADE_SETTINGS;
      if (!S) return [1, 1, 1];
      return [S.get('glow'), S.get('shake'), S.get('particles')];
    },
  };

  // ---- DOM --------------------------------------------------------------
  const startOverlay = document.getElementById('startOverlay');
  const endOverlay = document.getElementById('endOverlay');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const launchOverlay = document.getElementById('launchOverlay');
  const pongHud = document.getElementById('pongHud');
  const hpYouEl = document.getElementById('hpYou');
  const hpCpuEl = document.getElementById('hpCpu');
  const verdictEl = document.getElementById('verdict');
  const finalScoreEl = document.getElementById('finalScore');
  const geoEnd = document.getElementById('geoEnd');
  const geoScoreLine = document.getElementById('geoScoreLine');
  const MAX_HP = 7;

  // games this file drives; everything else still runs its own JS
  const WASM_GAMES = ['pong', 'geo'];
  const isWasm = () => WASM_GAMES.includes(window.MODE);

  let wasm = null;
  let ready = false;
  const paused = { pong: false, geo: false };

  // ---- lobby ------------------------------------------------------------
  // Serverless P2P: trystero rendezvous over public nostr relays carries the
  // WebRTC handshake (the room code is both the meeting point and the
  // encryption secret for it), then the game itself flows peer-to-peer over
  // an unreliable datachannel. Nothing of ours runs anywhere.
  // ?host=1 opens a room, ?join=1&room=CODE joins one.
  let net = null; // { room, chan, peer, game }
  let mintedRoom = null;
  let armedHost = false; // the menu's HOST 2P toggle; ?host=1 pre-arms it

  const hostToggle = document.getElementById('hostToggle');
  function setArmedHost(on) {
    armedHost = on;
    hostToggle.classList.toggle('armed', on);
    hostToggle.textContent = on ? 'hosting — pick pong 3d or geo wars' : 'host a 2p game';
  }
  hostToggle.addEventListener('click', () => setArmedHost(!armedHost));

  function lobbyRequest() {
    const q = new URLSearchParams(location.search);
    if (q.get('join') === '1') return 'guest';
    return armedHost ? 'host' : null;
  }

  function roomCode() {
    const q = new URLSearchParams(location.search);
    if (q.get('room')) return q.get('room');
    if (!mintedRoom) {
      // no ambiguous chars: this gets read out loud over voice chat
      const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
      mintedRoom = Array.from(crypto.getRandomValues(new Uint8Array(5)), b => abc[b % abc.length]).join('');
    }
    return mintedRoom;
  }

  async function netOpen(game, role) {
    if (net) netClose();
    const code = roomCode();
    if (role === 'guest' && !new URLSearchParams(location.search).get('room')) {
      netPill('no room code in the link — ask the host to share theirs', '#e0459b');
      return;
    }
    let joinRoom;
    try {
      ({ joinRoom } = await import('./vendor/trystero-nostr.min.js?v=' + (window.__V || '')));
    } catch (e) {
      console.error('trystero failed to load', e);
      netPill('p2p module failed to load', '#e0459b');
      return;
    }
    // rooms are per-game so two people who picked different games never
    // half-connect; the code stays short because the game rides the appId
    const room = joinRoom({ appId: 'neon-arcade-' + game, password: code }, code);
    net = { room, chan: null, peer: null, game };
    room.onPeerJoin = id => {
      if (!net || net.peer) return; // two players only: first arrival takes the slot
      net.peer = id;
      openChannel(game, room.getPeers()[id]);
    };
    room.onPeerLeave = id => {
      if (!net || net.peer !== id) return;
      net.peer = null;
      net.chan = null;
      if (ready) wasm.net_peer(game, false);
      netPill('player left — waiting for a new one…', '#e0a545');
    };
    if (role === 'host') {
      const link = location.href.split('?')[0] + '?join=1&room=' + code + '&game=' + game;
      netPill('room ' + code + ' — click to copy invite link', '#45e0a5', link);
    } else {
      netPill('joining room ' + code + '…', '#e0a545');
    }
  }

  function openChannel(game, pc) {
    // negotiated on a fixed stream id: both sides create it, no renegotiation.
    // unreliable + unordered — the newest snapshot is the only one that
    // matters, so never pay for a retransmit of a stale one
    const ch = pc.createDataChannel('arcade', { negotiated: true, id: 77, ordered: false, maxRetransmits: 0 });
    ch.binaryType = 'arraybuffer';
    ch.onopen = () => {
      if (!net) return;
      net.chan = ch;
      if (ready) wasm.net_peer(game, true);
      netPill('connected', '#45e0a5');
      setTimeout(() => { if (net && net.chan === ch) netPill(null); }, 2500);
    };
    ch.onmessage = e => {
      if (ready && net && net.chan === ch) wasm.net_packet(game, new Uint8Array(e.data));
    };
    ch.onclose = () => {
      if (net && net.chan === ch) net.chan = null;
    };
  }

  function netClose() {
    if (!net) return;
    try { net.room.leave(); } catch (e) {}
    net = null;
    netPill(null);
  }

  // one small status pill, top center; hosts click it to copy the invite
  let pillEl = null;
  function netPill(text, color, copyLink) {
    if (!pillEl) {
      pillEl = document.createElement('div');
      pillEl.style.cssText =
        'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:98;' +
        'font:600 13px Consolas,monospace;background:#12140d;padding:8px 14px;' +
        'border:1px solid;cursor:default;user-select:none';
      // clicks on the pill are the pill's business — without this the shell's
      // global pointerdown treats them as "start the game" and steals the click
      for (const ev of ['pointerdown', 'pointerup', 'click']) {
        pillEl.addEventListener(ev, e => e.stopPropagation());
      }
      document.body.appendChild(pillEl);
    }
    if (!text) { pillEl.style.display = 'none'; pillEl.onclick = null; return; }
    pillEl.style.display = 'block';
    pillEl.textContent = text;
    pillEl.style.color = color;
    pillEl.style.borderColor = color;
    if (copyLink) {
      pillEl.style.cursor = 'pointer';
      pillEl.onclick = () => {
        navigator.clipboard.writeText(copyLink).then(() => {
          pillEl.textContent = 'invite link copied — send it to your player 2';
        }).catch(() => { pillEl.textContent = copyLink; });
      };
    } else {
      pillEl.style.cursor = 'default';
      pillEl.onclick = null;
    }
  }

  // ---- boot -------------------------------------------------------------
  async function boot() {
    try {
      const v = window.__V || '';
      const mod = await import('../wasm/arcade.js?v=' + v);
      // The generated loader resolves the binary as
      // `new URL('arcade_bg.wasm', import.meta.url)`, and resolving a relative
      // path drops the query — so the loader would come back fresh while the
      // binary, which is the entire game, came back from cache. Point it at an
      // explicitly versioned URL so the two can never drift apart.
      await mod.default({
        module_or_path: new URL('../wasm/arcade_bg.wasm?v=' + v, import.meta.url),
      });
      wasm = mod;
      ready = true;
    } catch (e) {
      console.error('arcade wasm failed to load', e);
      const msg = document.createElement('div');
      msg.style.cssText =
        'position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:99;' +
        'font:600 13px Consolas,monospace;color:#e0459b;background:#12140d;' +
        'padding:10px 16px;border:1px solid #e0459b';
      msg.textContent = 'WASM build missing — run rust/build.sh';
      document.body.appendChild(msg);
    }
  }

  function initGame(game) {
    if (!ready) return;
    wasm.init(game, 'c', Math.floor(Math.random() * 4294967295));
    const role = lobbyRequest();
    if (role) {
      wasm.net_open(game, role);
      netOpen(game, role);
    }
  }

  // ---- events from Rust -------------------------------------------------
  function onGameEvent(game, name, detail) {
    if (name !== 'over') return;
    const parts = detail.split('|');
    if (game === 'pong') {
      const won = parts[0] === '1';
      verdictEl.textContent = won ? 'YOU WIN' : 'GAME OVER';
      verdictEl.className = 'verdict ' + (won ? 'win' : 'lose');
      finalScoreEl.innerHTML = 'Core integrity ' + parts[1] + ' &ndash; ' + parts[2];
      setTimeout(() => endOverlay.classList.remove('hidden'), 650);
    } else if (game === 'geo') {
      geoScoreLine.innerHTML =
        'Score ' + parts[0] + ' &middot; best ' + parts[1] + ' &middot; ' +
        parts[2] + ' kills &middot; ' + parts[3] + 's survived';
      setTimeout(() => geoEnd.classList.remove('hidden'), 600);
    }
    ARCADE_LOCK.unlock();
  }

  // ---- HUD mirrors ------------------------------------------------------
  let lastHud = '';
  function renderHud() {
    if (window.MODE !== 'pong' || !ready) return;
    const h = wasm.hud('pong');
    if (h === lastHud) return;
    lastHud = h;
    const [you, cpu] = h.split('|').map(Number);
    for (const [el, hp] of [[hpYouEl, you], [hpCpuEl, cpu]]) {
      el.innerHTML = '';
      for (let i = 0; i < MAX_HP; i++) {
        const c = document.createElement('i');
        if (i < hp) c.className = 'on';
        el.appendChild(c);
      }
    }
  }

  // ---- lifecycle --------------------------------------------------------
  function startGame() {
    const game = window.MODE;
    if (!ready) return;
    A.audio();
    A.startMusic();
    wasm.start(game);
    ARCADE_LOCK.lock();
    startOverlay.classList.add('hidden');
    endOverlay.classList.add('hidden');
    geoEnd.classList.add('hidden');
  }

  function togglePause() {
    const game = window.MODE;
    if (!ready || !wasm.running(game)) return;
    paused[game] = !paused[game];
    if (paused[game]) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
    pauseOverlay.classList.toggle('hidden', !paused[game]);
    if (paused[game]) A.suspend(); else A.resume();
  }

  function quitToMenu() {
    const game = window.MODE;
    paused[game] = false;
    if (ready) wasm.net_close(game);
    netClose();
    ARCADE_LOCK.unlock();
    A.setStyle('neon');
    A.resume();
    pauseOverlay.classList.add('hidden');
    startOverlay.classList.add('hidden');
    endOverlay.classList.add('hidden');
    geoEnd.classList.add('hidden');
    pongHud.classList.add('hidden');
    launchOverlay.classList.remove('hidden');
    window.MODE = 'menu';
  }

  addEventListener('arcadecursorunlock', () => {
    if (isWasm() && ready && wasm.running(window.MODE) && !paused[window.MODE]) togglePause();
  });
  addEventListener('arcadequit', () => {
    if (isWasm()) quitToMenu();
  });
  addEventListener('arcaderestart', () => {
    if (!isWasm()) return;
    paused[window.MODE] = false;
    pauseOverlay.classList.add('hidden');
    A.resume();
    startGame();
  });

  // ---- input ------------------------------------------------------------
  addEventListener('pointermove', () => {
    if (!isWasm() || !ready) return;
    // Geo aims relative to the ship, so it takes the movement rather than a
    // cursor position — which also survives the cursor pinning to a screen edge
    if (window.MODE === 'geo') {
      const d = ARCADE_LOCK.takeDelta();
      wasm.aim_delta('geo', d.x, d.y);
    } else {
      wasm.pointer(window.MODE, ARCADE_LOCK.cur.x, ARCADE_LOCK.cur.y);
    }
  });
  addEventListener('touchmove', e => {
    if (!isWasm() || !ready) return;
    if (e.touches[0]) wasm.pointer(window.MODE, e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });

  addEventListener('pointerdown', e => {
    if (!isWasm() || !ready) return;
    const game = window.MODE;
    wasm.pointer(game, ARCADE_LOCK.cur.x, ARCADE_LOCK.cur.y);
    if (e.button === 2) { wasm.button(game, 2, true); return; }
    if (paused[game]) { togglePause(); return; }
    if (!wasm.running(game)) { startGame(); return; }
    wasm.button(game, 0, true);
  });
  addEventListener('pointerup', () => {
    if (!isWasm() || !ready) return;
    wasm.button(window.MODE, 0, false);
  });
  addEventListener('pointercancel', () => {
    if (!isWasm() || !ready) return;
    wasm.button(window.MODE, 0, false);
  });
  addEventListener('contextmenu', e => { if (isWasm()) e.preventDefault(); });

  addEventListener('keydown', e => {
    if (!isWasm() || !ready) return;
    const game = window.MODE;
    if (e.key === 'Escape') { togglePause(); return; }
    if ((e.key === 'q' || e.key === 'Q') && (paused[game] || !wasm.running(game))) {
      quitToMenu();
      return;
    }
    if (e.key === 'Enter' && !wasm.running(game) && !paused[game]) { startGame(); return; }
    wasm.key(game, e.key.toLowerCase(), true);
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  });
  addEventListener('keyup', e => {
    if (!isWasm() || !ready) return;
    wasm.key(window.MODE, e.key.toLowerCase(), false);
  });

  // ---- menu entries -----------------------------------------------------
  document.getElementById('pickPong').addEventListener('click', () => {
    window.MODE = 'pong';
    A.setStyle('pong');
    launchOverlay.classList.add('hidden');
    pongHud.classList.remove('hidden');
    initGame('pong');
  });
  const GEO_SFX = ['shoot', 'sniper', 'kill', 'hit', 'death', 'blast', 'hole', 'pulse', 'life'];
  document.getElementById('pickGeo').addEventListener('click', () => {
    window.MODE = 'geo';
    A.preload(GEO_SFX);
    A.setStyle('geo');
    launchOverlay.classList.add('hidden');
    geoEnd.classList.add('hidden');
    initGame('geo');
  });

  // ---- loop -------------------------------------------------------------
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 1 / 30);
    if (ready && isWasm() && !paused[window.MODE]) {
      wasm.tick(window.MODE, dt);
      renderHud();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  boot().then(() => {
    if (!ready) return;
    const q = new URLSearchParams(location.search);
    if (q.get('host') === '1') setArmedHost(true);
    const role = lobbyRequest();
    if (!role) return;
    // an invite link names the game: walk the guest straight into its lobby
    const game = q.get('game');
    if (WASM_GAMES.includes(game)) {
      document.getElementById(game === 'pong' ? 'pickPong' : 'pickGeo').click();
    } else if (role === 'guest') {
      netPill('joining room ' + roomCode() + ' — pick the same game as your host', '#e0a545');
    }
  });
})();
