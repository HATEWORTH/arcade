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
  // matchbox needs a signalling server. Point this at your own deployment;
  // ?net=wss://host/ overrides it without a rebuild.
  const DEFAULT_SIGNAL = 'ws://localhost:3536';
  function signalUrl(room) {
    const q = new URLSearchParams(location.search);
    const base = (q.get('net') || DEFAULT_SIGNAL).replace(/\/+$/, '');
    return base + '/' + room;
  }
  function roomName() {
    const q = new URLSearchParams(location.search);
    return q.get('room') || 'arcade';
  }

  function lobbyRequest() {
    // ?host=1 opens as host, ?join=1 as guest, otherwise stay single-player
    const q = new URLSearchParams(location.search);
    if (q.get('host') === '1') return 'host';
    if (q.get('join') === '1') return 'guest';
    return null;
  }

  // ---- boot -------------------------------------------------------------
  async function boot() {
    try {
      const mod = await import('../wasm/arcade.js?v=' + (window.__V || ''));
      await mod.default();
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
    if (role) wasm.net_open(game, signalUrl(roomName()), role);
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
    wasm.pointer(window.MODE, ARCADE_LOCK.cur.x, ARCADE_LOCK.cur.y);
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
  document.getElementById('pickGeo').addEventListener('click', () => {
    window.MODE = 'geo';
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

  boot();
})();
