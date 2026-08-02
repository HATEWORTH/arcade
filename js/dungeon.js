'use strict';
// ---- DUNGEON: procedurally generated crawler ----------------------------
// Stage 1: generation, tile rendering, torch lighting, fog of war, and a
// walkable hero. Combat, loot, and descent arrive in later stages.
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const A = window.ARCADE;
  const pauseEl = document.getElementById('pauseOverlay');
  const launchEl = document.getElementById('launchOverlay');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TILE = 32;          // screen pixels per tile
  const MW = 46, MH = 34;   // map size in tiles

  // ---- pixel-art sprites, authored once as data --------------------------
  const PAL = {
    k: '#14160f', s: '#a8b0bc', d: '#6a7280', c: '#a4372e',
    g: '#d9a94e', b: '#2e2a22', w: '#c8b48a',
  };
  function sprite(rows) {
    const h = rows.length, w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        g.fillStyle = PAL[ch] || '#ffffff';
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }
  const HERO_F1 = sprite([
    '....kkkk....',
    '...kssssk...',
    '..ksddddsk..',
    '..kssssssk..',
    '...kddddk...',
    '..kcssssck..',
    '.kcsdssdsck.',
    '.kcsdssdsck.',
    '..kgddddgk..',
    '..kdssssdk..',
    '..kdk..kdk..',
    '..kbk..kbk..',
    '.kbbk..kbbk.',
  ]);
  const HERO_F2 = sprite([
    '....kkkk....',
    '...kssssk...',
    '..ksddddsk..',
    '..kssssssk..',
    '...kddddk...',
    '..kcssssck..',
    '.kcsdssdsck.',
    '.kcsdssdsck.',
    '..kgddddgk..',
    '..kdssssdk..',
    '...kdkkdk...',
    '...kbkkbk...',
    '..kbbkkbbk..',
  ]);
  const TORCH = sprite([
    '..ww..',
    '.wggw.',
    '..gg..',
    '..bb..',
    '..bb..',
    '.kbbk.',
  ]);

  // ---- state -------------------------------------------------------------
  const D = {
    running: false, paused: false,
    tiles: null, seen: null, rooms: [], torches: [], stairs: { x: 0, y: 0 },
    hero: { x: 0, y: 0, vx: 0, vy: 0, face: 1, moving: false },
    cam: { x: 0, y: 0 },
    floor: 1, t: 0,
  };
  const keys = {};
  const idx = (x, y) => y * MW + x;
  const solid = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || D.tiles[idx(x, y)] === 0;
  // deterministic per-tile hash for texture variation
  const hash = (x, y) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) % 1000;
  };

  // ---- generation: rooms, corridors, decoration --------------------------
  function generate() {
    D.tiles = new Uint8Array(MW * MH);        // 0 wall, 1 floor
    D.seen = new Uint8Array(MW * MH);
    D.rooms = [];
    D.torches = [];
    // scatter non-overlapping rooms
    for (let tries = 0; tries < 90 && D.rooms.length < 9; tries++) {
      const w = 5 + Math.floor(Math.random() * 6);
      const h = 4 + Math.floor(Math.random() * 5);
      const x = 2 + Math.floor(Math.random() * (MW - w - 4));
      const y = 2 + Math.floor(Math.random() * (MH - h - 4));
      if (D.rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      D.rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) D.tiles[idx(tx, ty)] = 1;
    }
    // connect each room to the next with an L corridor
    for (let i = 1; i < D.rooms.length; i++) {
      const a = D.rooms[i - 1], b = D.rooms[i];
      const bendFirstX = Math.random() < 0.5;
      const carve = (x, y) => { D.tiles[idx(x, y)] = 1; };
      if (bendFirstX) {
        for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) carve(x, a.cy);
        for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) carve(b.cx, y);
      } else {
        for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) carve(a.cx, y);
        for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) carve(x, b.cy);
      }
    }
    // decoration pass: torches on south-facing wall faces, spaced out
    for (let y = 0; y < MH - 1; y++) {
      for (let x = 0; x < MW; x++) {
        if (D.tiles[idx(x, y)] === 0 && D.tiles[idx(x, y + 1)] === 1 && hash(x, y) % 5 === 0) {
          D.torches.push({ x, y, ph: (hash(x, y) % 100) / 16 });
        }
      }
    }
    // hero starts in the first room, stairs land in the farthest one
    const start = D.rooms[0];
    D.hero.x = (start.cx + 0.5) * TILE;
    D.hero.y = (start.cy + 0.5) * TILE;
    let far = D.rooms[0], farD = -1;
    for (const r of D.rooms) {
      const dd = Math.hypot(r.cx - start.cx, r.cy - start.cy);
      if (dd > farD) { farD = dd; far = r; }
    }
    D.stairs = { x: far.cx, y: far.cy };
    reveal();
  }

  // ---- fog of war --------------------------------------------------------
  function reveal() {
    const hx = D.hero.x / TILE, hy = D.hero.y / TILE;
    const R = 5;
    for (let y = Math.max(0, Math.floor(hy - R)); y <= Math.min(MH - 1, Math.ceil(hy + R)); y++) {
      for (let x = Math.max(0, Math.floor(hx - R)); x <= Math.min(MW - 1, Math.ceil(hx + R)); x++) {
        if (Math.hypot(x + 0.5 - hx, y + 0.5 - hy) <= R) D.seen[idx(x, y)] = 1;
      }
    }
  }

  // ---- flow --------------------------------------------------------------
  function prime() {
    D.floor = 1;
    D.t = 0;
    generate();
  }
  function start() {
    prime();
    D.running = true;
    ARCADE_LOCK.lock();
    A.audio(); A.startMusic();
  }
  function togglePause() {
    if (!D.running) return;
    D.paused = !D.paused;
    if (D.paused) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
    pauseEl.classList.toggle('hidden', !D.paused);
    if (D.paused) A.suspend(); else A.resume();
  }
  function quitToMenu() {
    D.running = false; D.paused = false;
    ARCADE_LOCK.unlock();
    A.setStyle('neon');
    A.resume();
    pauseEl.classList.add('hidden');
    launchEl.classList.remove('hidden');
    window.MODE = 'menu';
  }

  document.getElementById('pickDungeon').addEventListener('click', () => {
    window.MODE = 'dungeon';
    A.setStyle('medieval');
    launchEl.classList.add('hidden');
    prime();
  });
  addEventListener('keydown', e => {
    if (window.MODE !== 'dungeon') return;
    if (e.key === 'Escape') { togglePause(); return; }
    if ((e.key === 'q' || e.key === 'Q') && (D.paused || !D.running)) { quitToMenu(); return; }
    if (e.key === 'Enter' && !D.running && !D.paused) { start(); return; }
    keys[e.key.toLowerCase()] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  addEventListener('pointerdown', () => {
    if (window.MODE !== 'dungeon') return;
    if (D.paused) { togglePause(); return; }
    if (!D.running) start();
  });
  addEventListener('arcadecursorunlock', () => {
    if (window.MODE === 'dungeon' && D.running && !D.paused) togglePause();
  });
  addEventListener('arcadequit', () => {
    if (window.MODE === 'dungeon') quitToMenu();
  });
  addEventListener('arcaderestart', () => {
    if (window.MODE !== 'dungeon') return;
    D.paused = false;
    pauseEl.classList.add('hidden');
    A.resume();
    start();
  });

  // ---- movement ----------------------------------------------------------
  const HERO_R = 9;
  function collideAxis(nx, ny) {
    const x0 = Math.floor((nx - HERO_R) / TILE), x1 = Math.floor((nx + HERO_R) / TILE);
    const y0 = Math.floor((ny - HERO_R) / TILE), y1 = Math.floor((ny + HERO_R) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (solid(tx, ty)) return true;
    }
    return false;
  }
  function update(dt) {
    D.t += dt;
    let ax = 0, ay = 0;
    if (keys['a'] || keys['arrowleft']) ax -= 1;
    if (keys['d'] || keys['arrowright']) ax += 1;
    if (keys['w'] || keys['arrowup']) ay -= 1;
    if (keys['s'] || keys['arrowdown']) ay += 1;
    const m = Math.hypot(ax, ay) || 1;
    const SPEED = 165;
    const vx = (ax / m) * SPEED, vy = (ay / m) * SPEED;
    D.hero.moving = !!(ax || ay);
    if (ax) D.hero.face = ax > 0 ? 1 : -1;
    // axis-separated collision so the hero slides along walls
    let nx = D.hero.x + vx * dt;
    if (!collideAxis(nx, D.hero.y)) D.hero.x = nx;
    let ny = D.hero.y + vy * dt;
    if (!collideAxis(D.hero.x, ny)) D.hero.y = ny;
    if (D.hero.moving) reveal();
    // camera eases after the hero
    const W = innerWidth, H = innerHeight;
    const txc = Math.max(W / 2, Math.min(MW * TILE - W / 2, D.hero.x));
    const tyc = Math.max(H / 2, Math.min(MH * TILE - H / 2, D.hero.y));
    const k = Math.min(1, dt * 6);
    D.cam.x += (txc - D.cam.x) * k;
    D.cam.y += (tyc - D.cam.y) * k;
  }

  // ---- rendering ---------------------------------------------------------
  let lightCv = null, lightCtx = null;
  function ensureLight() {
    if (!lightCv || lightCv.width !== innerWidth || lightCv.height !== innerHeight) {
      lightCv = document.createElement('canvas');
      lightCv.width = innerWidth; lightCv.height = innerHeight;
      lightCtx = lightCv.getContext('2d');
    }
  }
  function draw() {
    const W = innerWidth, H = innerHeight;
    ARCADE_FX.screen(ctx);
    ctx.imageSmoothingEnabled = false;
    const ox = Math.round(W / 2 - D.cam.x), oy = Math.round(H / 2 - D.cam.y);
    const tx0 = Math.max(0, Math.floor(-ox / TILE)), tx1 = Math.min(MW - 1, Math.ceil((W - ox) / TILE));
    const ty0 = Math.max(0, Math.floor(-oy / TILE)), ty1 = Math.min(MH - 1, Math.ceil((H - oy) / TILE));

    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        if (!D.seen[idx(x, y)]) continue;
        const sx = ox + x * TILE, sy = oy + y * TILE;
        const hv = hash(x, y);
        if (D.tiles[idx(x, y)] === 1) {
          // stone floor with quiet per-tile variation
          ctx.fillStyle = hv % 3 === 0 ? '#343a2e' : '#3a4033';
          ctx.fillRect(sx, sy, TILE, TILE);
          if (hv % 11 === 0) {
            ctx.fillStyle = '#2e3428';
            ctx.fillRect(sx + (hv % 5) * 5 + 4, sy + (hv % 7) * 3 + 4, 6, 2);
          }
          // soft shadow cast by a wall directly north
          if (solid(x, y - 1)) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
            ctx.fillRect(sx, sy, TILE, 7);
          }
        } else if (D.tiles[idx(x, y + 1)] === 1 && y + 1 < MH) {
          // south-facing wall: brick face
          ctx.fillStyle = '#4c5140';
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = 'rgba(20, 22, 15, 0.55)';
          for (let by = 0; by < TILE; by += 8) {
            ctx.fillRect(sx, sy + by, TILE, 1);
            const off = ((by / 8) % 2) * 8;
            for (let bx2 = off; bx2 < TILE; bx2 += 16) ctx.fillRect(sx + bx2, sy + by, 1, 8);
          }
          ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
          ctx.fillRect(sx, sy, TILE, 2);
        } else {
          // wall top: near-black mass
          ctx.fillStyle = '#20241a';
          ctx.fillRect(sx, sy, TILE, TILE);
        }
      }
    }

    // stairs down
    if (D.seen[idx(D.stairs.x, D.stairs.y)]) {
      const sx = ox + D.stairs.x * TILE, sy = oy + D.stairs.y * TILE;
      for (let i = 0; i < 4; i++) {
        const shade = 0.55 - i * 0.13;
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.9 - shade) + ')';
        ctx.fillRect(sx + i * 4, sy + i * 4, TILE - i * 8, TILE - i * 8);
      }
    }

    // torches: sprite plus flickering flame glow
    for (const tc of D.torches) {
      if (!D.seen[idx(tc.x, tc.y)]) continue;
      const sx = ox + tc.x * TILE, sy = oy + tc.y * TILE;
      ctx.drawImage(TORCH, sx + TILE / 2 - 6, sy + TILE - 14, 12, 12);
      const fl = reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(D.t * 9 + tc.ph) + 0.06 * Math.sin(D.t * 23 + tc.ph * 2);
      ctx.globalAlpha = 0.5 * fl;
      ctx.fillStyle = '#e8a33d';
      ctx.beginPath();
      ctx.arc(sx + TILE / 2, sy + TILE - 11, 4 + fl * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // hero: 2-frame walk bob, flipped by facing
    const frame = D.hero.moving && Math.floor(D.t * 8) % 2 ? HERO_F2 : HERO_F1;
    const hw = 24, hh = 26;
    ctx.save();
    ctx.translate(ox + D.hero.x, oy + D.hero.y + 2);
    ctx.scale(D.hero.face, 1);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(0, hh / 2 - 1, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.drawImage(frame, -hw / 2, -hh / 2, hw, hh);
    ctx.restore();

    // ---- lighting: darkness with holes for the hero and torches ----------
    ensureLight();
    lightCtx.globalCompositeOperation = 'source-over';
    lightCtx.fillStyle = 'rgba(5, 6, 3, 0.88)';
    lightCtx.fillRect(0, 0, W, H);
    lightCtx.globalCompositeOperation = 'destination-out';
    const punch = (px, py, r, a) => {
      const g = lightCtx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(0, 0, 0, ' + a + ')');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      lightCtx.fillStyle = g;
      lightCtx.fillRect(px - r, py - r, r * 2, r * 2);
    };
    const breathe = reducedMotion ? 1 : 1 + 0.03 * Math.sin(D.t * 3);
    punch(ox + D.hero.x, oy + D.hero.y, 205 * breathe, 1);
    for (const tc of D.torches) {
      if (!D.seen[idx(tc.x, tc.y)]) continue;
      const sx = ox + tc.x * TILE + TILE / 2, sy = oy + tc.y * TILE + TILE - 11;
      if (sx < -160 || sx > W + 160 || sy < -160 || sy > H + 160) continue;
      const fl = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(D.t * 9 + tc.ph);
      punch(sx, sy, 120 * fl, 0.85);
    }
    ctx.drawImage(lightCv, 0, 0);

    // HUD
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#c8cdd7';
    ctx.font = '600 17px Consolas, "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('FLOOR ' + D.floor, 26, 38);
    if (!D.running) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = 0.6;
      ctx.font = '600 13px Consolas, "Courier New", monospace';
      ctx.fillText('CLICK OR ENTER TO DELVE', W / 2, H - 30);
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
  }

  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 1 / 30);
    if (window.MODE === 'dungeon' && !D.paused) {
      if (D.running) update(dt);
      draw();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
