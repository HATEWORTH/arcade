'use strict';
// ---- GEO WARS -----------------------------------------------------------
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const A = window.ARCADE;
  const endEl = document.getElementById('geoEnd');
  const scoreLineEl = document.getElementById('geoScoreLine');
  const pauseEl = document.getElementById('pauseOverlay');
  const launchEl = document.getElementById('launchOverlay');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const CYAN = '#8fce9a', MAGENTA = '#e0459b', LIME = '#e6cf5e', WHITE = '#ffffff';
  const ENEMY_COLOR = { chaser: MAGENTA, drifter: CYAN, weaver: LIME, bit: '#f2f2f2' };

  const G = {
    running: false, paused: false,
    ship: { x: 0, y: 0, vx: 0, vy: 0 },
    mov: { x: 0, y: 0 },
    aim: { x: 0, y: 0 },
    firing: false, fireT: 0,
    bullets: [], enemies: [], parts: [], spray: [],
    holes: [], shocks: [], holeT: 12,
    score: 0, kills: 0, lives: 4, inv: 0,
    mult: 1, multT: 0, nextLife: 20000,
    spawnT: 1, time: 0, shake: 0,
  };
  const keys = {};
  let t = 0;

  // ambient atmosphere: drifting dust motes and slow nebula glows
  const dust = [], blobs = [];
  function initAtmos() {
    dust.length = 0; blobs.length = 0;
    for (let i = 0; i < 90; i++) {
      dust.push({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        vx: (Math.random() - 0.5) * 26, vy: (Math.random() - 0.5) * 26,
        s: 0.6 + Math.random() * 1.6,
        ph: Math.random() * 6.28, f: 0.4 + Math.random() * 1.6,
      });
    }
    const tints = ['224, 69, 155', '143, 206, 154', '69, 116, 224', '195, 122, 230'];
    for (let i = 0; i < 4; i++) {
      blobs.push({
        x: Math.random() * innerWidth, y: Math.random() * innerHeight,
        vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9,
        r: 200 + Math.random() * 280, tint: tints[i],
      });
    }
  }
  initAtmos();

  // the field runs edge to edge — an endless grid with the screen as walls
  function arena() {
    return { bx: 0, by: 0, bw: innerWidth, bh: innerHeight };
  }

  // kill-streak scoring: every kill bumps the multiplier, going 0.8s
  // without one resets it; an extra life every 20k points
  let BEST = 0;
  try { BEST = parseInt(localStorage.getItem('geoBest'), 10) || 0; } catch (e) {}
  function saveBest() {
    if (G.score > BEST) {
      BEST = G.score;
      try { localStorage.setItem('geoBest', String(BEST)); } catch (e) {}
    }
  }
  function addPoints(base) {
    G.score += base * G.mult;
    while (G.score >= G.nextLife) {
      G.nextLife += 20000;
      G.lives++;
      A.bleep(660, 0.12, 'triangle', 0.06);
      setTimeout(() => A.bleep(880, 0.16, 'triangle', 0.06), 100);
    }
  }
  function bumpMult() {
    G.multT = 0.8;
    if (G.mult < 20) G.mult++;
  }

  // ---- spring-mass grid, ported from NeonShooter's Grid.cs ---------------
  const grid = { pts: [], springs: [], cols: 0, rows: 0, w: 0, h: 0 };
  function spring(a, b) {
    return { a, b, k: 0.4, d: 0.14, target: Math.hypot(a.x - b.x, a.y - b.y) * 0.95 };
  }
  function buildGrid() {
    const { bx, by, bw, bh } = arena();
    grid.w = innerWidth; grid.h = innerHeight;
    const spacing = 44;
    const cols = Math.max(4, Math.round(bw / spacing));
    const rows = Math.max(4, Math.round(bh / spacing));
    grid.cols = cols; grid.rows = rows;
    grid.pts = []; grid.springs = [];
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const x = bx + (c / cols) * bw, y = by + (r / rows) * bh;
        grid.pts.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, fx: 0, fy: 0, damp: 0.98 });
      }
    }
    const P = (c, r) => grid.pts[r * (cols + 1) + c];
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        if (c === 0 || r === 0 || c === cols || r === rows)
          grid.springs.push({ a: null, b: P(c, r), k: 0.1, d: 0.1 });     // hard border anchor
        else if (c % 2 === 0 && r % 2 === 0)
          grid.springs.push({ a: null, b: P(c, r), k: 0.012, d: 0.06 });  // firmer interior anchors
        if (c > 0) grid.springs.push(spring(P(c - 1, r), P(c, r)));
        if (r > 0) grid.springs.push(spring(P(c, r - 1), P(c, r)));
      }
    }
  }
  function gridUpdate() {
    for (const s of grid.springs) {
      if (!s.a) { // anchor spring: pulls its point back toward rest
        const p = s.b;
        p.fx += (p.ox - p.x) * s.k - p.vx * s.d;
        p.fy += (p.oy - p.y) * s.k - p.vy * s.d;
        continue;
      }
      const dx = s.a.x - s.b.x, dy = s.a.y - s.b.y;
      const len = Math.hypot(dx, dy);
      if (len <= s.target) continue; // springs only pull, never push
      const str = (len - s.target) / len;
      const dvx = s.b.vx - s.a.vx, dvy = s.b.vy - s.a.vy;
      const fx = s.k * dx * str - dvx * s.d;
      const fy = s.k * dy * str - dvy * s.d;
      s.a.fx -= fx; s.a.fy -= fy;
      s.b.fx += fx; s.b.fy += fy;
    }
    for (const p of grid.pts) {
      p.vx += p.fx; p.vy += p.fy;
      p.x += p.vx; p.y += p.vy;
      p.fx = 0; p.fy = 0;
      p.vx *= p.damp; p.vy *= p.damp;
      p.damp = 0.95;
    }
  }
  function gridExplosive(force, x, y, radius) {
    const r2 = radius * radius;
    for (const p of grid.pts) {
      const dx = p.x - x, dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const f = 100 * force / (10000 + d2);
        p.fx += dx * f; p.fy += dy * f;
        p.damp *= 0.6;
      }
    }
  }
  function gridImplosive(force, x, y, radius) {
    const r2 = radius * radius;
    for (const p of grid.pts) {
      const dx = x - p.x, dy = y - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) {
        const f = 10 * force / (100 + d2);
        p.fx += dx * f; p.fy += dy * f;
        p.damp *= 0.6;
      }
    }
  }

  function burst(x, y, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (30 + Math.pow(Math.random(), 2) * 380) * power;
      G.parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 1 + Math.random() * 2.2,
        color: Math.random() < 0.22 ? WHITE : color,
        len: 4 + Math.random() * 14,
      });
    }
  }

  // two-hue shard spray, per the original's Enemy.WasShot
  function enemyBurst(x, y) {
    const h1 = Math.random() * 360, h2 = h1 + Math.random() * 120;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1080 * (1 - 1 / (1 + Math.random() * 9));
      const hue = Math.floor((h1 + (h2 - h1) * Math.random()) % 360);
      G.parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 0.8 + Math.random() * 1.4, grav: true,
        color: 'hsl(' + hue + ', 60%, 68%)',
        len: 4 + Math.random() * 12,
      });
    }
  }
  function playerBurst(x, y) {
    for (let i = 0; i < 300; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1080 * (1 - 1 / (1 + Math.random() * 9));
      G.parts.push({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 0.5 + Math.random() * 0.6,
        color: Math.random() < 0.5 ? '#ffffff' : '#ccc966',
        len: 6 + Math.random() * 14,
      });
    }
  }

  function prime() {
    const { bx, by, bw, bh } = arena();
    G.ship.x = bx + bw / 2; G.ship.y = by + bh / 2;
    G.ship.vx = 0; G.ship.vy = 0;
    G.mov.x = 0; G.mov.y = 0;
    G.aim.x = G.ship.x; G.aim.y = by + bh * 0.3;
    G.bullets.length = 0; G.enemies.length = 0; G.parts.length = 0;
    G.spray.length = 0;
    G.holes.length = 0; G.shocks.length = 0; G.holeT = 12;
    G.score = 0; G.kills = 0; G.lives = 4; G.inv = 0;
    G.mult = 1; G.multT = 0; G.nextLife = 20000;
    G.spawnT = 1; G.time = 0; G.shake = 0; G.fireT = 0; G.firing = false;
    buildGrid();
  }
  function start() {
    prime();
    G.running = true;
    ARCADE_LOCK.lock();
    G.aim.x = ARCADE_LOCK.cur.x; G.aim.y = ARCADE_LOCK.cur.y;
    A.audio(); A.startMusic();
    endEl.classList.add('hidden');
  }
  addEventListener('arcadecursorunlock', () => {
    if (window.MODE === 'geo' && G.running && !G.paused) togglePause();
  });
  addEventListener('arcadequit', () => {
    if (window.MODE === 'geo') quitToMenu();
  });
  addEventListener('arcaderestart', () => {
    if (window.MODE !== 'geo') return;
    G.paused = false;
    pauseEl.classList.add('hidden');
    A.resume();
    start();
  });
  function die() {
    G.running = false; G.firing = false;
    ARCADE_LOCK.unlock();
    playerBurst(G.ship.x, G.ship.y);
    gridExplosive(120, G.ship.x, G.ship.y, 300);
    G.shake = 16;
    saveBest();
    scoreLineEl.innerHTML = 'Score ' + G.score + ' &middot; best ' + BEST + ' &middot; ' + G.kills + ' kills &middot; ' + Math.floor(G.time) + 's survived';
    A.bleep(220, 0.25, 'sawtooth', 0.06);
    setTimeout(() => A.bleep(150, 0.35, 'sawtooth', 0.06), 160);
    setTimeout(() => endEl.classList.remove('hidden'), 600);
  }
  function togglePause() {
    if (!G.running) return;
    G.paused = !G.paused;
    if (G.paused) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
    pauseEl.classList.toggle('hidden', !G.paused);
    if (G.paused) A.suspend(); else A.resume();
  }
  function quitToMenu() {
    G.running = false; G.paused = false;
    ARCADE_LOCK.unlock();
    A.setStyle('neon');
    A.resume();
    pauseEl.classList.add('hidden');
    endEl.classList.add('hidden');
    launchEl.classList.remove('hidden');
    window.MODE = 'menu';
  }

  document.getElementById('pickGeo').addEventListener('click', () => {
    window.MODE = 'geo';
    A.setStyle('geo');
    launchEl.classList.add('hidden');
    endEl.classList.add('hidden');
    prime();
  });

  addEventListener('keydown', e => {
    if (window.MODE !== 'geo') return;
    if (e.key === 'Escape') { togglePause(); return; }
    if ((e.key === 'q' || e.key === 'Q') && (G.paused || !G.running)) { quitToMenu(); return; }
    if (e.key === 'Enter' && !G.running && !G.paused) { start(); return; }
    keys[e.key.toLowerCase()] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  addEventListener('pointermove', () => {
    if (window.MODE === 'geo') { G.aim.x = ARCADE_LOCK.cur.x; G.aim.y = ARCADE_LOCK.cur.y; }
  });
  addEventListener('pointerdown', e => {
    if (window.MODE !== 'geo') return;
    if (G.paused) { togglePause(); return; }
    if (!G.running) { start(); return; }
    if (e.button === 0) G.firing = true;
  });
  addEventListener('pointerup', () => { G.firing = false; });
  addEventListener('contextmenu', e => { if (window.MODE === 'geo') e.preventDefault(); });

  function spawnEnemy() {
    const { bx, by, bw, bh } = arena();
    const side = Math.floor(Math.random() * 4);
    let x, y;
    if (side === 0) { x = bx + Math.random() * bw; y = by + 10; }
    else if (side === 1) { x = bx + Math.random() * bw; y = by + bh - 10; }
    else if (side === 2) { x = bx + 10; y = by + Math.random() * bh; }
    else { x = bx + bw - 10; y = by + Math.random() * bh; }
    // never materialize on top of the ship — mirror across the arena instead
    if (Math.hypot(x - G.ship.x, y - G.ship.y) < 200) {
      x = bx + bw - (x - bx); y = by + bh - (y - by);
    }
    const roll = Math.random();
    if (G.time > 25 && roll < 0.25) {
      G.enemies.push({ x, y, type: 'weaver', r: 9, spd: 200 + G.time, wob: Math.random() * 6.28, fade: 1, pv: 3 });
    } else if (roll < 0.62) {
      G.enemies.push({ x, y, type: 'chaser', r: 12, spd: 110 + G.time * 1.4, fade: 1, pv: 2 });
    } else {
      const a = Math.random() * Math.PI * 2;
      G.enemies.push({ x, y, type: 'drifter', r: 11, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, fade: 1, pv: 1 });
    }
  }

  function spawnHole() {
    const { bx, by, bw, bh } = arena();
    let x, y, tries = 0;
    do {
      x = bx + 80 + Math.random() * (bw - 160);
      y = by + 80 + Math.random() * (bh - 160);
    } while (Math.hypot(x - G.ship.x, y - G.ship.y) < 300 && ++tries < 20);
    G.holes.push({ x, y, r: 13, hp: 10, eaten: 0, flash: 0, sprayA: Math.random() * Math.PI * 2 });
    A.sweep(300, 45, 0.7, 'sine', 0.06);
  }
  // NeonShooter-style death: a uniform 150-particle ring in a cycling hue
  function ringBurst(x, y) {
    const N = 150;
    const off = Math.random() * (Math.PI * 2 / N);
    const hue = Math.floor((t * 180) % 360);
    for (let k = 0; k < N; k++) {
      const a = (Math.PI * 2 * k) / N + off;
      const spd = 480 + Math.random() * 480;
      G.parts.push({
        x: x + Math.cos(a) * 4, y: y + Math.sin(a) * 4,
        vx: Math.cos(a) * spd, vy: Math.sin(a) * spd,
        life: 1, decay: 0.65 + Math.random() * 0.35,
        color: 'hsl(' + hue + ', 65%, 74%)',
        len: 6 + Math.random() * 12,
      });
    }
  }
  function explodeHole(i, withBits) {
    const h = G.holes[i];
    G.holes.splice(i, 1);
    G.holeT = 18 + Math.random() * 8;
    G.shocks.push({ x: h.x, y: h.y, rad: 8, speed: 660, maxRad: 700 });
    gridExplosive(140, h.x, h.y, 420);
    ringBurst(h.x, h.y);
    G.shake = 18;
    A.sweep(700, 24, 0.7, 'sawtooth', 0.11);
    A.hat(0.12, 0.2);
    // what it swallowed tears free as seeker bits chasing the ship
    if (withBits) {
      const n = Math.min(14, h.eaten);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        G.enemies.push({
          x: h.x + Math.cos(a) * (h.r + 8), y: h.y + Math.sin(a) * (h.r + 8),
          type: 'bit', r: 5, spd: 230 + Math.random() * 90, fade: 0, pv: 1,
        });
      }
    }
  }

  function shipHit() {
    G.lives--;
    G.mult = 1; G.multT = 0;
    playerBurst(G.ship.x, G.ship.y);
    gridExplosive(100, G.ship.x, G.ship.y, 280);
    G.shake = 14;
    A.sweep(500, 40, 0.4, 'sawtooth', 0.07);
    A.hat(0.09, 0.12);
    // like the original: your death wipes the board and detonates every hole
    for (const en of G.enemies) burst(en.x, en.y, ENEMY_COLOR[en.type], 6, 1);
    G.enemies.length = 0;
    for (let i = G.holes.length - 1; i >= 0; i--) explodeHole(i, false);
    G.inv = 2;
    if (G.lives <= 0) die();
  }

  function update(dt) {
    G.time += dt;
    const { bx, by, bw, bh } = arena();

    // the streak dies 0.8s after your last kill
    if (G.mult > 1) {
      G.multT -= dt;
      if (G.multT <= 0) G.mult = 1;
    }

    // thrust + friction + speed cap
    let ax = 0, ay = 0;
    if (keys['a'] || keys['arrowleft']) ax -= 1;
    if (keys['d'] || keys['arrowright']) ax += 1;
    if (keys['w'] || keys['arrowup']) ay -= 1;
    if (keys['s'] || keys['arrowdown']) ay += 1;
    // smooth the stick: input eases in and out instead of snapping,
    // so direction changes carve arcs rather than kinking
    const m = Math.hypot(ax, ay) || 1;
    const k = Math.min(1, dt * 14);
    G.mov.x += ((ax / m) - G.mov.x) * k;
    G.mov.y += ((ay / m) - G.mov.y) * k;
    G.ship.vx += G.mov.x * 3100 * dt;
    G.ship.vy += G.mov.y * 3100 * dt;
    // gentle pull toward the cursor so the ship drifts where you're looking
    const adx = G.aim.x - G.ship.x, ady = G.aim.y - G.ship.y;
    const ad = Math.hypot(adx, ady) || 1;
    G.ship.vx += (adx / ad) * 260 * dt;
    G.ship.vy += (ady / ad) * 260 * dt;
    // light drag: momentum carries, but the ship stays steerable
    G.ship.vx *= Math.max(0, 1 - dt * 1.8);
    G.ship.vy *= Math.max(0, 1 - dt * 1.8);
    const sp = Math.hypot(G.ship.vx, G.ship.vy);
    if (sp > 560) { G.ship.vx *= 560 / sp; G.ship.vy *= 560 / sp; }
    G.ship.x += G.ship.vx * dt;
    G.ship.y += G.ship.vy * dt;
    // soft bounces off the arena walls
    if (G.ship.x < bx + 14) { G.ship.x = bx + 14; G.ship.vx = Math.abs(G.ship.vx) * 0.55; }
    if (G.ship.x > bx + bw - 14) { G.ship.x = bx + bw - 14; G.ship.vx = -Math.abs(G.ship.vx) * 0.55; }
    if (G.ship.y < by + 14) { G.ship.y = by + 14; G.ship.vy = Math.abs(G.ship.vy) * 0.55; }
    if (G.ship.y > by + bh - 14) { G.ship.y = by + bh - 14; G.ship.vy = -Math.abs(G.ship.vy) * 0.55; }

    // twin cannons: two parallel shots with a touch of random spread
    G.fireT -= dt;
    if (G.firing && G.fireT <= 0) {
      const spread = (Math.random() - 0.5) * 0.08 + (Math.random() - 0.5) * 0.08;
      const aimA = Math.atan2(G.aim.y - G.ship.y, G.aim.x - G.ship.x) + spread;
      const ca = Math.cos(aimA), sa = Math.sin(aimA);
      for (const side of [-5, 5]) {
        G.bullets.push({
          x: G.ship.x + ca * 16 - sa * side,
          y: G.ship.y + sa * 16 + ca * side,
          vx: ca * 950, vy: sa * 950,
        });
      }
      G.fireT = 0.1;
      A.bleep(880, 0.018, 'square', 0.012);
    }
    for (let i = G.bullets.length - 1; i >= 0; i--) {
      const b = G.bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt;
      // every bullet nudges the grid outward as it flies — kept subtle
      gridExplosive(3.5, b.x, b.y, 70);
      if (b.x < bx + 3 || b.x > bx + bw - 3 || b.y < by + 3 || b.y > by + bh - 3) {
        // wall impact: a little splash of light-blue sparks
        for (let k = 0; k < 12; k++) {
          const a = Math.random() * Math.PI * 2;
          const sp = Math.random() * 540;
          G.parts.push({
            x: b.x, y: b.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.6, decay: 1.4, color: '#9fd4f0', len: 3 + Math.random() * 6,
          });
        }
        G.bullets.splice(i, 1);
      }
    }

    // exhaust flame while thrusting: white core plus two red side jets
    // that oscillate; the particles swirl into black holes like everything else
    if (ax || ay) {
      const svx = G.ship.vx, svy = G.ship.vy;
      const ssp = Math.hypot(svx, svy) || 1;
      const ux = svx / ssp, uy = svy / ssp;
      const px = G.ship.x - ux * 14, py = G.ship.y - uy * 14;
      const bvx = -ux * 180, bvy = -uy * 180;
      const wob = Math.sin(t * 10) * 0.6;
      const pvx = bvy * wob, pvy = -bvx * wob;
      const streams = [
        { vx: bvx + (Math.random() - 0.5) * 60, vy: bvy + (Math.random() - 0.5) * 60, color: '#ffbb1e' },
        { vx: bvx + pvx, vy: bvy + pvy, color: '#c82609' },
        { vx: bvx - pvx, vy: bvy - pvy, color: '#c82609' },
      ];
      for (const s of streams) {
        G.parts.push({
          x: px, y: py, vx: s.vx, vy: s.vy,
          life: 0.55, decay: 1.7, grav: true, color: s.color, len: 5 + Math.random() * 6,
        });
      }
    }

    // swarm pressure ramps over time
    G.spawnT -= dt;
    if (G.spawnT <= 0) {
      spawnEnemy();
      G.spawnT = Math.max(0.22, 1.05 - G.time * 0.012);
    }
    for (const en of G.enemies) {
      // materializing enemies hold still and can't interact yet
      if (en.fade > 0) { en.fade -= dt; continue; }
      if (en.type === 'drifter') {
        en.x += en.vx * dt; en.y += en.vy * dt;
        if (en.x < bx + en.r || en.x > bx + bw - en.r) { en.vx *= -1; en.x = Math.max(bx + en.r, Math.min(bx + bw - en.r, en.x)); }
        if (en.y < by + en.r || en.y > by + bh - en.r) { en.vy *= -1; en.y = Math.max(by + en.r, Math.min(by + bh - en.r, en.y)); }
      } else {
        const dx = G.ship.x - en.x, dy = G.ship.y - en.y;
        const d = Math.hypot(dx, dy) || 1;
        let vx = (dx / d) * en.spd, vy = (dy / d) * en.spd;
        if (en.type === 'weaver') {
          en.wob += dt * 7;
          const w = Math.sin(en.wob) * en.spd * 0.7;
          vx += (-dy / d) * w; vy += (dx / d) * w;
        }
        en.x += vx * dt; en.y += vy * dt;
      }
    }

    // crowd control: overlapping enemies shove each other apart
    for (let i = 0; i < G.enemies.length; i++) {
      const a = G.enemies[i];
      if (a.fade > 0) continue;
      for (let j = i + 1; j < G.enemies.length; j++) {
        const b = G.enemies[j];
        if (b.fade > 0) continue;
        const dx = a.x - b.x, dy = a.y - b.y;
        const d2 = dx * dx + dy * dy;
        const rr = a.r + b.r;
        if (d2 < rr * rr && d2 > 0.01) {
          const f = 600 * dt / (d2 + 1);
          a.x += dx * f; a.y += dy * f;
          b.x -= dx * f; b.y -= dy * f;
        }
      }
    }

    // ---- black holes -----------------------------------------------------
    if (G.holes.length === 0) {
      G.holeT -= dt;
      if (G.holeT <= 0) spawnHole();
    }
    for (let i = G.holes.length - 1; i >= 0; i--) {
      const h = G.holes[i];
      h.flash = Math.max(0, h.flash - dt);
      // spray jet rotates a full turn every ~0.83s, like the original
      h.sprayA -= (Math.PI * 2 / 50) * 60 * dt;
      // continuous breathing suction on the spring grid — kept gentle
      gridImplosive(Math.sin(h.sprayA / 2) * 5 + 9, h.x, h.y, 180);
      const PR = 250; // gravity reach
      // ship is attracted, linear falloff (respawn blink is exempt)
      if (G.inv <= 0) {
        const dx = h.x - G.ship.x, dy = h.y - G.ship.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < PR) {
          const k = 1 - d / PR;
          G.ship.vx += (dx / d) * 2000 * k * dt;
          G.ship.vy += (dy / d) * 2000 * k * dt;
        }
        if (d < h.r + 10) { shipHit(); break; }
      }
      // bullets are repelled — you have to fight the push to land hits
      for (let j = G.bullets.length - 1; j >= 0; j--) {
        const b = G.bullets[j];
        const dx = h.x - b.x, dy = h.y - b.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < PR) {
          b.vx -= (dx / d) * 1000 * dt;
          b.vy -= (dy / d) * 1000 * dt;
        }
        if (d < h.r + 4) {
          G.bullets.splice(j, 1);
          h.hp--; h.flash = 0.12;
          burst(b.x, b.y, MAGENTA, 3, 0.5);
          if (h.hp <= 0) { addPoints(50); bumpMult(); explodeHole(i, true); break; }
        }
      }
      if (!G.holes[i]) continue; // burst by gunfire this frame
      // enemies get dragged in and swallowed
      for (let j = G.enemies.length - 1; j >= 0; j--) {
        const en = G.enemies[j];
        if (en.fade > 0) continue;
        const dx = h.x - en.x, dy = h.y - en.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < PR) {
          const k = 1 - d / PR;
          const pull = 420 * k * dt;
          en.x += (dx / d) * pull; en.y += (dy / d) * pull;
          if (en.vx !== undefined) { en.vx += (dx / d) * 900 * k * dt; en.vy += (dy / d) * 900 * k * dt; }
        }
        if (d < h.r + en.r) {
          G.enemies.splice(j, 1);
          h.eaten++; h.r = Math.min(26, h.r + 0.5);
          burst(en.x, en.y, ENEMY_COLOR[en.type], 5, 0.6);
          A.bleep(130, 0.05, 'sine', 0.025);
        }
      }
      // orbiting particle jet: sprays in quarter-second on/off windows
      if (Math.floor(t * 4) % 2 === 0 && G.spray.length < 220) {
        const sp = 720 + Math.random() * 180;
        const vx = Math.cos(h.sprayA) * sp, vy = Math.sin(h.sprayA) * sp;
        G.spray.push({
          x: h.x + vy * 0.033 + (Math.random() - 0.5) * 10,
          y: h.y - vx * 0.033 + (Math.random() - 0.5) * 10,
          vx, vy, life: 3.2,
        });
      }
      // overfed wells destabilize and blow on their own
      if (h.eaten >= 15) explodeHole(i, true);
    }
    // shockwaves: the blast wave drags everything it crosses toward it
    for (let i = G.shocks.length - 1; i >= 0; i--) {
      const s = G.shocks[i];
      s.rad += s.speed * dt;
      const tug = (x, y) => {
        const dx = s.x - x, dy = s.y - y;
        const d = Math.hypot(dx, dy) || 1;
        const band = Math.exp(-Math.pow(d - s.rad, 2) / (2 * 48 * 48));
        return [(dx / d) * band, (dy / d) * band];
      };
      const [sx, sy] = tug(G.ship.x, G.ship.y);
      G.ship.vx += sx * 1500 * dt; G.ship.vy += sy * 1500 * dt;
      for (const en of G.enemies) {
        const [ex, ey] = tug(en.x, en.y);
        en.x += ex * 320 * dt; en.y += ey * 320 * dt;
      }
      for (const b of G.bullets) {
        const [tx, ty] = tug(b.x, b.y);
        b.vx += tx * 2200 * dt; b.vy += ty * 2200 * dt;
      }
      if (s.rad > s.maxRad) G.shocks.splice(i, 1);
    }

    // bullets vs enemies
    for (let i = G.enemies.length - 1; i >= 0; i--) {
      const en = G.enemies[i];
      for (let j = G.bullets.length - 1; j >= 0; j--) {
        const b = G.bullets[j];
        if (Math.hypot(b.x - en.x, b.y - en.y) < en.r + 4) {
          G.bullets.splice(j, 1);
          G.enemies.splice(i, 1);
          G.kills++;
          addPoints((en.pv || 1) * 10);
          bumpMult();
          enemyBurst(en.x, en.y);
          gridExplosive(15, en.x, en.y, 110);
          G.shake = Math.max(G.shake, 5);
          A.bleep(280 + Math.random() * 220, 0.05, 'sawtooth', 0.032);
          if (G.kills % 4 === 0) A.hat(0.04, 0.05);
          break;
        }
      }
    }

    // enemies vs ship (materializing enemies are harmless)
    if (G.inv > 0) G.inv -= dt;
    else {
      for (const en of G.enemies) {
        if (en.fade > 0) continue;
        if (Math.hypot(en.x - G.ship.x, en.y - G.ship.y) < en.r + 10) { shipHit(); break; }
      }
    }
  }

  function fx(dt) {
    t += dt;
    // orbiting spray: attracted with 1/d^2 gravity plus a tangential kick,
    // which winds them into the signature vortex around the hole
    for (let i = G.spray.length - 1; i >= 0; i--) {
      const p = G.spray[i];
      for (const h of G.holes) {
        const dx = h.x - p.x, dy = h.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const nx = dx / d, ny = dy / d;
        const g = 36000000 / (d * d + 10000);
        p.vx += nx * g * dt; p.vy += ny * g * dt;
        if (d < 400) {
          const tg = 162000 / (d + 100);
          p.vx += ny * tg * dt; p.vy += -nx * tg * dt;
        }
      }
      const damp = Math.pow(0.94, dt * 60);
      p.vx *= damp; p.vy *= damp;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) G.spray.splice(i, 1);
    }
    for (let i = G.parts.length - 1; i >= 0; i--) {
      const p = G.parts[i];
      // exhaust and enemy shards get swirled by black holes, like the original
      if (p.grav) {
        for (const h of G.holes) {
          const dx = h.x - p.x, dy = h.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          const g = 36000000 / (d * d + 10000);
          p.vx += (dx / d) * g * dt; p.vy += (dy / d) * g * dt;
          if (d < 400) {
            const tg = 162000 / (d + 100);
            p.vx += (dy / d) * tg * dt; p.vy += (-dx / d) * tg * dt;
          }
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= (1 - dt * 2.5); p.vy *= (1 - dt * 2.5);
      p.life -= p.decay * dt;
      if (p.life <= 0) G.parts.splice(i, 1);
    }
    G.shake = Math.max(0, G.shake - dt * 30);
    // atmosphere drift: motes wander (and lean toward black holes), glows roam
    for (const p of dust) {
      let vx = p.vx, vy = p.vy;
      for (const h of G.holes) {
        const dx = h.x - p.x, dy = h.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        if (d < 300) { const k = (1 - d / 300) * 60; vx += (dx / d) * k; vy += (dy / d) * k; }
      }
      p.x += vx * dt; p.y += vy * dt;
      if (p.x < 0) p.x += innerWidth; if (p.x > innerWidth) p.x -= innerWidth;
      if (p.y < 0) p.y += innerHeight; if (p.y > innerHeight) p.y -= innerHeight;
    }
    for (const b of blobs) {
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (b.x < -b.r) b.x += innerWidth + b.r * 2; if (b.x > innerWidth + b.r) b.x -= innerWidth + b.r * 2;
      if (b.y < -b.r) b.y += innerHeight + b.r * 2; if (b.y > innerHeight + b.r) b.y -= innerHeight + b.r * 2;
    }
    if (grid.w !== innerWidth || grid.h !== innerHeight) buildGrid();
    gridUpdate();
  }

  function drawEnemyShape(en, r, alpha) {
    ctx.strokeStyle = ENEMY_COLOR[en.type];
    ctx.shadowColor = ENEMY_COLOR[en.type];
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    if (en.type === 'bit') {
      ctx.arc(en.x, en.y, r, 0, Math.PI * 2);
    } else if (en.type === 'chaser') {
      ctx.moveTo(en.x, en.y - r); ctx.lineTo(en.x + r, en.y);
      ctx.lineTo(en.x, en.y + r); ctx.lineTo(en.x - r, en.y);
    } else if (en.type === 'drifter') {
      ctx.rect(en.x - r, en.y - r, r * 2, r * 2);
    } else {
      ctx.moveTo(en.x, en.y - r); ctx.lineTo(en.x + r, en.y + r);
      ctx.lineTo(en.x - r, en.y + r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  function drawEnemy(en) {
    if (en.fade > 0) {
      // spawn-in: an expanding fading ghost over a fading-in solid
      drawEnemyShape(en, en.r * (1 + en.fade), en.fade * 0.35);
      drawEnemyShape(en, en.r, (1 - en.fade) * 0.9);
    } else {
      drawEnemyShape(en, en.r, 0.9);
    }
  }

  function draw() {
    const W = innerWidth, H = innerHeight;
    ARCADE_FX.screen(ctx);
    const { bx, by, bw, bh } = arena();
    // nebula glows: huge soft color washes drifting behind everything
    for (const b of blobs) {
      const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
      grad.addColorStop(0, 'rgba(' + b.tint + ', 0.05)');
      grad.addColorStop(1, 'rgba(' + b.tint + ', 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    // dust motes twinkling as they drift
    ctx.fillStyle = '#ffffff';
    for (const p of dust) {
      ctx.globalAlpha = 0.07 + 0.11 * (0.5 + 0.5 * Math.sin(t * p.f + p.ph));
      ctx.fillRect(p.x, p.y, p.s, p.s);
    }

    ctx.save();
    if (G.shake > 0 && !reducedMotion) {
      ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    }

    // spring-mass grid: rippled by bullets, sucked by holes, blasted by deaths
    const gcols = grid.cols, grows = grid.rows;
    const GP = (c, r) => grid.pts[r * (gcols + 1) + c];
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.09;
    ctx.beginPath();
    for (let r = 0; r <= grows; r++) {
      for (let c = 0; c <= gcols; c++) {
        const p = GP(c, r);
        if (c > 0) { const q = GP(c - 1, r); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); }
        if (r > 0) { const q = GP(c, r - 1); ctx.moveTo(q.x, q.y); ctx.lineTo(p.x, p.y); }
      }
    }
    ctx.stroke();
    // interpolated mid-lines double the apparent density for free
    ctx.globalAlpha = 0.045;
    ctx.beginPath();
    for (let r = 1; r <= grows; r++) {
      for (let c = 1; c <= gcols; c++) {
        const p = GP(c, r), left = GP(c - 1, r), up = GP(c, r - 1), ul = GP(c - 1, r - 1);
        ctx.moveTo((ul.x + up.x) / 2, (ul.y + up.y) / 2); ctx.lineTo((left.x + p.x) / 2, (left.y + p.y) / 2);
        ctx.moveTo((ul.x + left.x) / 2, (ul.y + left.y) / 2); ctx.lineTo((up.x + p.x) / 2, (up.y + p.y) / 2);
      }
    }
    ctx.stroke();

    // black holes: dark core whose size pulsates like the original sprite
    for (const h of G.holes) {
      const rr = h.r * (1 + 0.1 * Math.sin(t * 10)) + (h.flash > 0 ? 3 : 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.arc(h.x, h.y, rr, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = MAGENTA;
      ctx.shadowColor = MAGENTA;
      ctx.shadowBlur = 16;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.95;
      ctx.beginPath(); ctx.arc(h.x, h.y, rr + 2, 0, Math.PI * 2); ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // spray vortex: light-purple shards spiraling around the wells
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#c37ae6';
    ctx.shadowColor = '#c37ae6';
    ctx.shadowBlur = 6;
    for (const p of G.spray) {
      const s = Math.hypot(p.vx, p.vy) || 1;
      ctx.globalAlpha = Math.min(1, p.life) * Math.min(1, s / 260) * 0.8;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const l = Math.min(16, 4 + s * 0.018);
      ctx.lineTo(p.x + (p.vx / s) * l, p.y + (p.vy / s) * l);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.lineCap = 'butt';
    // shockwave rings racing outward
    for (const s of G.shocks) {
      const fade = 1 - s.rad / s.maxRad;
      ctx.strokeStyle = WHITE;
      ctx.shadowColor = MAGENTA;
      ctx.shadowBlur = 12;
      for (let k = 0; k < 2; k++) {
        ctx.globalAlpha = fade * (k ? 0.2 : 0.45);
        ctx.lineWidth = k ? 1.2 : 2.2;
        ctx.beginPath(); ctx.arc(s.x, s.y, Math.max(1, s.rad - k * 22), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.shadowBlur = 0;
    }

    // bullets
    ctx.strokeStyle = LIME;
    ctx.shadowColor = LIME;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (const b of G.bullets) {
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.013, b.y - b.vy * 0.013);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    for (const en of G.enemies) drawEnemy(en);

    // ship: triangle nosed toward the cursor, blinking while invulnerable
    if (!(G.inv > 0 && Math.floor(t * 12) % 2)) {
      const a = Math.atan2(G.aim.y - G.ship.y, G.aim.x - G.ship.x);
      ctx.strokeStyle = WHITE;
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(G.ship.x + Math.cos(a) * 15, G.ship.y + Math.sin(a) * 15);
      ctx.lineTo(G.ship.x + Math.cos(a + 2.5) * 11, G.ship.y + Math.sin(a + 2.5) * 11);
      ctx.lineTo(G.ship.x + Math.cos(a - 2.5) * 11, G.ship.y + Math.sin(a - 2.5) * 11);
      ctx.closePath();
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // particles
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const p of G.parts) {
      const s = Math.hypot(p.vx, p.vy) || 1;
      ctx.globalAlpha = Math.max(0, p.life) * 0.7;
      ctx.strokeStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (p.vx / s) * p.len, p.y + (p.vy / s) * p.len);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // HUD
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#ececf1';
    ctx.font = '600 17px Consolas, "Courier New", monospace';
    ctx.textAlign = 'left';
    ctx.fillText('SCORE ' + G.score, bx + 14, by + 28);
    ctx.globalAlpha = G.mult > 1 ? 0.95 : 0.5;
    ctx.fillStyle = G.mult > 1 ? LIME : '#ececf1';
    ctx.fillText('x' + G.mult, bx + 14, by + 50);
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#ececf1';
    ctx.font = '600 13px Consolas, "Courier New", monospace';
    ctx.fillText('BEST ' + Math.max(BEST, G.score), bx + 14, by + 70);
    ctx.font = '600 17px Consolas, "Courier New", monospace';
    ctx.globalAlpha = 0.85;
    for (let i = 0; i < G.lives; i++) {
      const lx = bx + bw - 22 - i * 24, ly = by + 22;
      ctx.beginPath();
      ctx.moveTo(lx, ly - 8); ctx.lineTo(lx + 7, ly + 6); ctx.lineTo(lx - 7, ly + 6);
      ctx.closePath();
      ctx.strokeStyle = WHITE;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 1 / 30);
    if (window.MODE === 'geo' && !G.paused) {
      if (G.running) update(dt);
      fx(dt);
      draw();
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
