'use strict';
// ---- NEON SNAKE ---------------------------------------------------------
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const A = window.ARCADE;
  const startEl = document.getElementById('snakeStart');
  const endEl = document.getElementById('snakeEnd');
  const scoreLineEl = document.getElementById('snakeScoreLine');
  const pauseEl = document.getElementById('pauseOverlay');
  const launchEl = document.getElementById('launchOverlay');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLS = 22, ROWS = 22;
  const WHITE = '#ffffff';
  const GREEN = '#8fce9a', PINK = '#e0459b';
  // each spawned signal gets its own neon hue
  const FOOD_COLORS = [PINK, '#45c8e0', '#e0c945', '#9a45e0', '#45e07a', '#e06a45', '#4574e0'];

  const S = {
    running: false, paused: false,
    body: [],            // head first, {x, y}
    dir: { x: 1, y: 0 },
    queue: [],           // buffered turns
    food: null, foodColor: PINK,
    score: 0, eaten: 0, level: 1,
    stepT: 0, shake: 0,
  };
  // residue map: cells the snake vacates leave a fading gray ghost tile
  let heat = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const particles = [];
  const cellFlashes = []; // blooms over eaten signals, tinted by the food's hue
  const rings = [];       // shockwave rings on each catch
  let t = 0;

  const STATS_H = 96; // footer inside the panel: big numerals + info bar
  function cellPx() {
    const H = innerHeight, W = innerWidth;
    const cell = Math.min((H * 0.84 - STATS_H) / ROWS, (W * 0.6) / COLS);
    return { cell, bx: W / 2 - (COLS * cell) / 2, by: H / 2 - (ROWS * cell + STATS_H) / 2 };
  }

  // wilder shards: uneven speeds, gravity arcs, mixed white hot sparks
  function chaosBurst(px, py, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (20 + Math.pow(Math.random(), 2) * 340) * power;
      particles.push({
        x: px + (Math.random() - 0.5) * 6, y: py + (Math.random() - 0.5) * 6,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40 * power,
        g: 140 + Math.random() * 260,
        life: 1, decay: 0.9 + Math.random() * 2.4,
        color: Math.random() < 0.25 ? WHITE : color,
        len: 3 + Math.random() * 14,
      });
    }
  }

  function spawnFood() {
    const free = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (!S.body.some(s => s.x === c && s.y === r)) free.push({ x: c, y: r });
      }
    }
    S.food = free.length ? free[Math.floor(Math.random() * free.length)] : null;
    // always switch to a different hue than the last signal
    const others = FOOD_COLORS.filter(c => c !== S.foodColor);
    S.foodColor = others[Math.floor(Math.random() * others.length)];
  }

  function stepInterval() {
    return Math.max(0.055, 0.16 - (S.level - 1) * 0.012);
  }

  function step() {
    if (S.queue.length) {
      const d = S.queue.shift();
      // ignore reversals
      if (d.x !== -S.dir.x || d.y !== -S.dir.y) S.dir = d;
    }
    const head = S.body[0];
    const nx = head.x + S.dir.x, ny = head.y + S.dir.y;
    const { cell, bx, by } = cellPx();

    // walls and tail end the run (tail tip vacates this step, so exclude it)
    const hitSelf = S.body.slice(0, -1).some(s => s.x === nx && s.y === ny);
    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS || hitSelf) { die(); return; }

    S.body.unshift({ x: nx, y: ny });

    if (S.food && nx === S.food.x && ny === S.food.y) {
      const eatenColor = S.foodColor;
      S.eaten++;
      S.score += 10 * S.level;
      S.level = 1 + Math.floor(S.eaten / 5);
      S.shake = 14;
      const fx0 = bx + (nx + 0.5) * cell, fy0 = by + (ny + 0.5) * cell;
      cellFlashes.push({ x: nx, y: ny, life: 1, color: eatenColor });
      rings.push({ x: fx0, y: fy0, r: cell * 0.4, life: 1, color: eatenColor });
      rings.push({ x: fx0, y: fy0, r: cell * 0.2, life: 1.25, color: WHITE });
      chaosBurst(fx0, fy0, eatenColor, 44, 2.2);
      // hard catch: deep dive-bomb sweep, cracked hat, bright zap on top
      A.sweep(900, 24, 0.5, 'sawtooth', 0.11);
      A.hat(0.13, 0.16);
      A.bleep(1200 + S.level * 60, 0.06, 'square', 0.05);
      setTimeout(() => A.bleep(1600 + S.level * 60, 0.05, 'square', 0.04), 45);
      spawnFood();
    } else {
      const tail = S.body.pop();
      heat[tail.y][tail.x] = Math.max(heat[tail.y][tail.x], 0.5);
      A.bleep(520, 0.02, 'triangle', 0.012);
    }
  }

  function die() {
    S.running = false;
    ARCADE_LOCK.unlock();
    const { cell, bx, by } = cellPx();
    // the whole body shatters
    for (const s of S.body) {
      chaosBurst(bx + (s.x + 0.5) * cell, by + (s.y + 0.5) * cell, GREEN, 7, 1.3);
      heat[s.y][s.x] = 1;
    }
    S.shake = 10;
    scoreLineEl.innerHTML = 'Score ' + S.score + ' &middot; length ' + S.body.length + ' &middot; level ' + S.level;
    A.bleep(220, 0.25, 'sawtooth', 0.06);
    setTimeout(() => A.bleep(150, 0.35, 'sawtooth', 0.06), 160);
    setTimeout(() => endEl.classList.remove('hidden'), 500);
  }

  // set up a fresh run without starting it — shown frozen after picking
  function prime() {
    heat = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    const cx0 = Math.floor(COLS / 2), cy0 = Math.floor(ROWS / 2);
    S.body = [{ x: cx0, y: cy0 }, { x: cx0 - 1, y: cy0 }, { x: cx0 - 2, y: cy0 }];
    S.dir = { x: 1, y: 0 };
    S.queue = [];
    S.score = 0; S.eaten = 0; S.level = 1;
    S.stepT = 0;
    particles.length = 0;
    cellFlashes.length = 0;
    rings.length = 0;
    spawnFood();
  }
  function start() {
    prime();
    S.running = true;
    ARCADE_LOCK.lock();
    A.audio(); A.startMusic();
    startEl.classList.add('hidden');
    endEl.classList.add('hidden');
  }
  function togglePause() {
    if (!S.running) return;
    S.paused = !S.paused;
    if (S.paused) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
    pauseEl.classList.toggle('hidden', !S.paused);
    if (S.paused) A.suspend(); else A.resume();
  }
  addEventListener('arcadecursorunlock', () => {
    if (window.MODE === 'snake' && S.running && !S.paused) togglePause();
  });
  function quitToMenu() {
    S.running = false; S.paused = false;
    ARCADE_LOCK.unlock();
    A.setStyle('neon');
    A.resume();
    pauseEl.classList.add('hidden');
    startEl.classList.add('hidden');
    endEl.classList.add('hidden');
    launchEl.classList.remove('hidden');
    window.MODE = 'menu';
  }

  document.getElementById('pickSnake').addEventListener('click', () => {
    window.MODE = 'snake';
    A.setStyle('snake');
    launchEl.classList.add('hidden');
    endEl.classList.add('hidden');
    prime();
  });
  addEventListener('pointerdown', () => {
    if (window.MODE !== 'snake') return;
    if (S.paused) { togglePause(); return; }
    if (!S.running) start();
  });
  const DIRS = {
    ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 }, A: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 }, D: { x: 1, y: 0 },
    ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 }, W: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 }, S: { x: 0, y: 1 },
  };
  addEventListener('keydown', e => {
    if (window.MODE !== 'snake') return;
    if (e.key === 'Escape') { togglePause(); return; }
    if ((e.key === 'q' || e.key === 'Q') && (S.paused || !S.running)) { quitToMenu(); return; }
    if (e.key === 'Enter' && !S.running && !S.paused) { start(); return; }
    if (!S.running || S.paused) return;
    const d = DIRS[e.key];
    if (d) {
      // buffer up to two turns so quick corners register
      const lastD = S.queue.length ? S.queue[S.queue.length - 1] : S.dir;
      if ((d.x !== lastD.x || d.y !== lastD.y) && (d.x !== -lastD.x || d.y !== -lastD.y) && S.queue.length < 2) {
        S.queue.push(d);
      }
      e.preventDefault();
    }
  });

  function tick(dt) {
    S.stepT += dt;
    while (S.stepT >= stepInterval()) {
      S.stepT -= stepInterval();
      step();
      if (!S.running) break;
    }
  }

  function fx(dt) {
    t += dt;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.g) p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= (1 - dt * 2); p.vy *= (1 - dt * 2);
      p.life -= p.decay * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = cellFlashes.length - 1; i >= 0; i--) {
      cellFlashes[i].life -= dt * 2.2;
      if (cellFlashes[i].life <= 0) cellFlashes.splice(i, 1);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      const rg = rings[i];
      rg.r += dt * 620;
      rg.life -= dt * 3;
      if (rg.life <= 0) rings.splice(i, 1);
    }
    // residue tiles fade slowly
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (heat[r][c] > 0) heat[r][c] = Math.max(0, heat[r][c] - dt * 0.22);
      }
    }
    S.shake = Math.max(0, S.shake - dt * 30);
  }

  function drawCell(x, y, cell, color, fillA, blur) {
    ctx.globalAlpha = fillA;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fillRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
    ctx.shadowBlur = 0;
  }

  // faint dot-grid backdrop, prebuilt once as a repeating pattern
  let dotPat = null;
  function dotPattern() {
    if (dotPat) return dotPat;
    const pc = document.createElement('canvas');
    pc.width = pc.height = 28;
    const g = pc.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(13, 13, 1.5, 1.5);
    dotPat = ctx.createPattern(pc, 'repeat');
    return dotPat;
  }

  function setTracking(px) {
    try { ctx.letterSpacing = px + 'px'; } catch (e) {}
  }

  function draw() {
    const W = innerWidth, H = innerHeight;
    const beat = A.beat;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#050507';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = dotPattern();
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (S.shake > 0 && !reducedMotion) {
      ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
    }
    ctx.lineCap = 'butt';

    // very subtle CRT-style flicker; a gentle shimmer with the occasional
    // shallow dip — never a hard strobe
    const flick = reducedMotion ? 1 :
      0.975 + 0.015 * Math.sin(t * 43) + 0.01 * Math.sin(t * 97) - (Math.random() < 0.03 ? 0.04 : 0);

    const { cell, bx, by } = cellPx();
    const bw = COLS * cell, bh = ROWS * cell;
    const pad = Math.max(10, cell * 0.45);
    const px0 = bx - pad, py0 = by - pad;
    const pw = bw + pad * 2, ph = bh + pad + STATS_H;

    // panel card: barely-lighter fill
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(px0, py0, pw, ph);

    // faint cell grid over the play area
    ctx.globalAlpha = (0.055 + beat.kick * 0.015) * flick;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) { ctx.moveTo(bx + c * cell + 0.5, by); ctx.lineTo(bx + c * cell + 0.5, by + bh); }
    for (let r = 0; r <= ROWS; r++) { ctx.moveTo(bx, by + r * cell + 0.5); ctx.lineTo(bx + bw, by + r * cell + 0.5); }
    ctx.stroke();

    // residue ghosts: pale tiles where the snake passed
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const h = heat[r][c];
        if (h > 0.01) {
          ctx.globalAlpha = h * 0.14 * flick;
          ctx.fillStyle = '#c8cdd7';
          ctx.fillRect(bx + c * cell + 0.5, by + r * cell + 0.5, cell - 1, cell - 1);
        }
      }
    }

    // body: flat translucent mosaic tiles, dimming toward the tail
    for (let i = S.body.length - 1; i >= 0; i--) {
      const s = S.body[i];
      const f = 1 - i / Math.max(S.body.length, 1);
      const a = (0.34 + f * 0.3 + beat.bass * 0.05) * flick;
      drawCell(bx + s.x * cell, by + s.y * cell, cell, GREEN, a, 6);
    }
    // head: brightest tile with a soft bloom
    if (S.body.length) {
      const h = S.body[0];
      drawCell(bx + h.x * cell, by + h.y * cell, cell, GREEN, 0.92 * flick, 16 + beat.kick * 8);
    }

    // food signal: tile in this spawn's hue, pulsing gently with the arpeggio
    if (S.food) {
      const pulse = 0.72 + 0.14 * Math.sin(t * 4) + beat.arp * 0.1;
      drawCell(bx + S.food.x * cell, by + S.food.y * cell, cell, S.foodColor, pulse * flick, 14 + beat.arp * 8);
    }

    // catch flash: a hot bloom over the eaten signal cell in its hue
    for (const cf of cellFlashes) {
      ctx.globalAlpha = cf.life * cf.life * 0.55;
      ctx.fillStyle = cf.color || '#ffffff';
      ctx.shadowColor = cf.color || '#ffffff';
      ctx.shadowBlur = 34 * cf.life;
      ctx.fillRect(bx + cf.x * cell - cell, by + cf.y * cell, cell * 3, cell);
      ctx.shadowBlur = 0;
    }

    // shockwave rings racing out from the catch
    for (const rg of rings) {
      ctx.globalAlpha = Math.max(0, rg.life) * 0.6;
      ctx.strokeStyle = rg.color;
      ctx.lineWidth = 2.5 * Math.max(0.2, rg.life);
      ctx.beginPath();
      ctx.arc(rg.x, rg.y, rg.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.lineWidth = 1;

    // particles: muted line shards
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    for (const p of particles) {
      const sp = Math.hypot(p.vx, p.vy) || 1;
      ctx.globalAlpha = Math.max(0, p.life) * 0.7;
      ctx.strokeStyle = p.color;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + (p.vx / sp) * p.len, p.y + (p.vy / sp) * p.len);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // ---- panel footer: big numerals + info bar ---------------------------
    const SANS = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
    const fy = by + bh + pad * 0.9;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    setTracking(2);
    ctx.font = '600 9px ' + SANS;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('SCORE', bx, fy + 10);
    ctx.fillText('LENGTH', bx + bw * 0.46, fy + 10);
    ctx.textAlign = 'right';
    ctx.fillText('SIGNAL', bx + bw, fy + 10);
    ctx.textAlign = 'left';

    setTracking(0.5);
    ctx.font = '600 30px ' + SANS;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#ececf1';
    ctx.fillText(S.score.toLocaleString('de-DE'), bx, fy + 40);
    ctx.fillText(String(S.body.length), bx + bw * 0.46, fy + 40);
    setTracking(0);

    // signal marker, right-aligned mini tile pulsing like the food
    {
      const mini = 12;
      ctx.globalAlpha = 0.6 + 0.25 * Math.sin(t * 4);
      ctx.fillStyle = PINK;
      ctx.fillRect(bx + bw - mini, fy + 24, mini, mini);
    }

    // info bar with a pink accent tick, like the reference readout strip
    const barY = fy + 52;
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, barY + 0.5, bw - 1, 16);
    ctx.fillStyle = '#e0459b';
    ctx.fillRect(bx, barY + 19, 30, 2);
    setTracking(2);
    ctx.font = '600 8px ' + SANS;
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.fillText('LEVEL ' + String(S.level).padStart(2, '0') + '  ·  SIGNAL ACQUISITION TELEMETRY', bx + 8, barY + 11.5);
    setTracking(0);

    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    if (window.MODE === 'snake' && !S.paused) {
      if (S.running) tick(dt);
      fx(dt);
      draw();
      ARCADE_FX.bezel(ctx);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
