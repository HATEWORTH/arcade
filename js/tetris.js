'use strict';
// ---- NEON TETRIS --------------------------------------------------------
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const A = window.ARCADE;
  const startEl = document.getElementById('tetrisStart');
  const endEl = document.getElementById('tetrisEnd');
  const scoreLineEl = document.getElementById('tetrisScoreLine');
  const pauseEl = document.getElementById('pauseOverlay');
  const launchEl = document.getElementById('launchOverlay');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const COLS = 10, ROWS = 20;
  const VIOLET = '#8f8aa6', WHITE = '#ffffff';
  // muted "strategy map" palette — soft, semi-transparent mosaic tiles
  const PIECES = [
    { m: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], c: '#7fd1cf' }, // I  teal
    { m: [[1,1],[1,1]], c: '#e4d9c3' },                             // O  cream
    { m: [[0,1,0],[1,1,1],[0,0,0]], c: '#e0459b' },                 // T  hot pink
    { m: [[0,1,1],[1,1,0],[0,0,0]], c: '#8fce9a' },                 // S  green
    { m: [[1,1,0],[0,1,1],[0,0,0]], c: '#a97fc9' },                 // Z  violet
    { m: [[1,0,0],[1,1,1],[0,0,0]], c: '#6a9fd8' },                 // J  blue
    { m: [[0,0,1],[1,1,1],[0,0,0]], c: '#e6cf5e' },                 // L  yellow
  ];
  const rotCW = m => m[0].map((_, i) => m.map(r => r[i]).reverse());
  const rotCCW = m => rotCW(rotCW(rotCW(m)));

  const T = {
    running: false, paused: false,
    board: [], cur: null, next: null, bag: [],
    score: 0, lines: 0, level: 1,
    dropT: 0, soft: false, shake: 0,
  };
  // board must exist before start() — draw() renders the empty well behind
  // the "click to start" overlay
  T.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  // residue map: pieces and cleared rows leave a fading gray ghost tile behind
  let heat = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  const particles = [];
  const rowFlashes = []; // white bands that bloom over exploding lines
  let t = 0;

  function stampHeat(m, x, y, v) {
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const Y = y + r, X = x + c;
        if (Y >= 0 && Y < ROWS && X >= 0 && X < COLS) heat[Y][X] = Math.max(heat[Y][X], v);
      }
    }
  }

  function fromBag() {
    if (!T.bag.length) {
      T.bag = [0, 1, 2, 3, 4, 5, 6];
      for (let i = T.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [T.bag[i], T.bag[j]] = [T.bag[j], T.bag[i]];
      }
    }
    const p = PIECES[T.bag.pop()];
    return { m: p.m.map(r => r.slice()), c: p.c, x: Math.floor((COLS - p.m[0].length) / 2), y: 0 };
  }

  function collides(m, x, y) {
    for (let r = 0; r < m.length; r++) {
      for (let c = 0; c < m[r].length; c++) {
        if (!m[r][c]) continue;
        const X = x + c, Y = y + r;
        if (X < 0 || X >= COLS || Y >= ROWS) return true;
        if (Y >= 0 && T.board[Y][X]) return true;
      }
    }
    return false;
  }

  function spawn() {
    T.cur = T.next || fromBag();
    T.next = fromBag();
    T.dropT = 0;
    if (collides(T.cur.m, T.cur.x, T.cur.y)) gameOver();
  }

  function move(dx) {
    if (!collides(T.cur.m, T.cur.x + dx, T.cur.y)) {
      stampHeat(T.cur.m, T.cur.x, T.cur.y, 0.45);
      T.cur.x += dx; A.bleep(520, 0.03, 'triangle', 0.02);
    }
  }
  function rotate(dir) {
    const m = dir > 0 ? rotCW(T.cur.m) : rotCCW(T.cur.m);
    for (const kick of [0, -1, 1, -2, 2]) {
      if (!collides(m, T.cur.x + kick, T.cur.y)) {
        T.cur.m = m; T.cur.x += kick;
        A.bleep(660, 0.04, 'triangle', 0.03);
        return;
      }
    }
  }
  function ghostY() {
    let y = T.cur.y;
    while (!collides(T.cur.m, T.cur.x, y + 1)) y++;
    return y;
  }
  function hardDrop() {
    const gy = ghostY();
    for (let y = T.cur.y; y <= gy; y++) stampHeat(T.cur.m, T.cur.x, y, 0.5);
    T.score += (gy - T.cur.y) * 2;
    T.cur.y = gy;
    T.shake = 5;
    lock();
  }

  const STATS_H = 96; // footer inside the panel: big numerals + info bar
  function cellPx() {
    const H = innerHeight, W = innerWidth;
    const cell = Math.min((H * 0.84 - STATS_H) / ROWS, (W * 0.5) / COLS);
    return { cell, bx: W / 2 - (COLS * cell) / 2, by: H / 2 - (ROWS * cell + STATS_H) / 2 };
  }

  function burstRow(rowY) {
    const { cell, bx, by } = cellPx();
    for (let cX = 0; cX < COLS; cX++) {
      chaosBurst(bx + (cX + 0.5) * cell, by + (rowY + 0.5) * cell,
        T.board[rowY][cX] || WHITE, 9, 1.5);
    }
  }
  function burstAt(px, py, color, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 160) * power;
      particles.push({
        x: px, y: py, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 1, decay: 1.6 + Math.random() * 1.6, color, len: 5 + Math.random() * 8,
      });
    }
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

  function lock() {
    const { cell, bx, by } = cellPx();
    for (let r = 0; r < T.cur.m.length; r++) {
      for (let c = 0; c < T.cur.m[r].length; c++) {
        if (T.cur.m[r][c] && T.cur.y + r >= 0) T.board[T.cur.y + r][T.cur.x + c] = T.cur.c;
      }
    }
    // landing sparks: a small colored puff at each bottom-edge cell of the piece
    for (let r = 0; r < T.cur.m.length; r++) {
      for (let c = 0; c < T.cur.m[r].length; c++) {
        if (!T.cur.m[r][c]) continue;
        if (T.cur.m[r + 1] && T.cur.m[r + 1][c]) continue;
        chaosBurst(bx + (T.cur.x + c + 0.5) * cell, by + (T.cur.y + r + 1) * cell, T.cur.c, 9, 0.7);
      }
    }
    // drowning synth + hi-hat on touchdown
    A.sweep(240, 45, 0.35, 'sawtooth', 0.05);
    A.hat(0.05, 0.05);
    // clear full rows
    const full = [];
    for (let r = 0; r < ROWS; r++) if (T.board[r].every(Boolean)) full.push(r);
    if (full.length) {
      for (const r of full) burstRow(r);
      for (const r of full) rowFlashes.push({ r, life: 1 });
      // extra white sparks erupting from the row ends on a clear
      for (const r of full) {
        chaosBurst(bx + 0.5 * cell, by + (r + 0.5) * cell, WHITE, 8, 1.8);
        chaosBurst(bx + (COLS - 0.5) * cell, by + (r + 0.5) * cell, WHITE, 8, 1.8);
      }
      // cleared rows leave a bright residue ghost in place (screen-space, not shifted)
      for (const r of full) for (let c = 0; c < COLS; c++) heat[r][c] = 1;
      for (const r of full) { T.board.splice(r, 1); T.board.unshift(Array(COLS).fill(null)); }
      T.lines += full.length;
      T.score += [0, 100, 300, 500, 800][full.length] * T.level;
      T.level = 1 + Math.floor(T.lines / 10);
      T.shake = Math.max(T.shake, full.length === 4 ? 10 : 6);
      // deeper, longer drown + brighter hat, scaling with lines cleared
      A.sweep(500 + full.length * 120, 32, 0.55 + full.length * 0.1, 'sawtooth', 0.06 + full.length * 0.015);
      A.hat(0.07 + full.length * 0.02, 0.12 + full.length * 0.03);
    }
    spawn();
  }

  function gameOver() {
    T.running = false;
    ARCADE_LOCK.unlock();
    scoreLineEl.innerHTML = 'Score ' + T.score + ' &middot; ' + T.lines + ' lines &middot; level ' + T.level;
    A.bleep(220, 0.25, 'sawtooth', 0.06);
    setTimeout(() => A.bleep(150, 0.35, 'sawtooth', 0.06), 160);
    setTimeout(() => endEl.classList.remove('hidden'), 500);
  }

  // set up a fresh board without starting play — shown frozen after picking
  function prime() {
    T.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    heat = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    T.score = 0; T.lines = 0; T.level = 1; T.bag = [];
    T.next = null;
    particles.length = 0;
    rowFlashes.length = 0;
    spawn();
  }
  function start() {
    prime();
    T.running = true;
    ARCADE_LOCK.lock();
    A.audio(); A.startMusic();
    startEl.classList.add('hidden');
    endEl.classList.add('hidden');
  }
  function togglePause() {
    if (!T.running) return;
    T.paused = !T.paused;
    if (T.paused) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
    pauseEl.classList.toggle('hidden', !T.paused);
    if (T.paused) A.suspend(); else A.resume();
  }
  addEventListener('arcadecursorunlock', () => {
    if (window.MODE === 'tetris' && T.running && !T.paused) togglePause();
  });
  addEventListener('arcadequit', () => {
    if (window.MODE === 'tetris') quitToMenu();
  });
  addEventListener('arcaderestart', () => {
    if (window.MODE !== 'tetris') return;
    T.paused = false;
    pauseEl.classList.add('hidden');
    A.resume();
    start();
  });
  function quitToMenu() {
    T.running = false; T.paused = false;
    ARCADE_LOCK.unlock();
    A.setStyle('neon');
    A.resume();
    pauseEl.classList.add('hidden');
    startEl.classList.add('hidden');
    endEl.classList.add('hidden');
    launchEl.classList.remove('hidden');
    window.MODE = 'menu';
  }

  document.getElementById('pickTetris').addEventListener('click', () => {
    window.MODE = 'tetris';
    A.setStyle('medieval');
    launchEl.classList.add('hidden');
    endEl.classList.add('hidden');
    prime();
  });
  addEventListener('pointerdown', () => {
    if (window.MODE !== 'tetris') return;
    if (T.paused) { togglePause(); return; }
    if (!T.running) start();
  });
  addEventListener('keydown', e => {
    if (window.MODE !== 'tetris') return;
    if (e.key === 'Escape') { togglePause(); return; }
    if ((e.key === 'q' || e.key === 'Q') && (T.paused || !T.running)) { quitToMenu(); return; }
    if (!T.running || T.paused) return;
    if (e.key === 'ArrowLeft') move(-1);
    else if (e.key === 'ArrowRight') move(1);
    else if (e.key === 'ArrowUp' || e.key === 'x' || e.key === 'X') rotate(1);
    else if (e.key === 'z' || e.key === 'Z') rotate(-1);
    else if (e.key === 'ArrowDown') T.soft = true;
    else if (e.key === ' ') hardDrop();
    if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(e.key)) e.preventDefault();
  });
  addEventListener('keyup', e => { if (e.key === 'ArrowDown') T.soft = false; });

  function tick(dt) {
    const interval = Math.max(0.07, 0.8 - (T.level - 1) * 0.07);
    T.dropT += dt * (T.soft ? 10 : 1);
    if (T.soft) T.score += Math.floor(dt * 10) > 0 ? 1 : 0;
    while (T.dropT >= interval) {
      T.dropT -= interval;
      if (!collides(T.cur.m, T.cur.x, T.cur.y + 1)) { stampHeat(T.cur.m, T.cur.x, T.cur.y, 0.5); T.cur.y++; }
      else { lock(); break; }
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
    for (let i = rowFlashes.length - 1; i >= 0; i--) {
      rowFlashes[i].life -= dt * 2.2;
      if (rowFlashes[i].life <= 0) rowFlashes.splice(i, 1);
    }
    // residue tiles fade slowly
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (heat[r][c] > 0) heat[r][c] = Math.max(0, heat[r][c] - dt * 0.22);
      }
    }
    T.shake = Math.max(0, T.shake - dt * 30);
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
    if (T.shake > 0 && !reducedMotion) {
      ctx.translate((Math.random() - 0.5) * T.shake, (Math.random() - 0.5) * T.shake);
    }
    ctx.lineCap = 'butt';

    // very subtle CRT-style flicker on the board and pieces; a gentle shimmer
    // with the occasional shallow dip — never a hard strobe
    const flick = reducedMotion ? 1 :
      0.975 + 0.015 * Math.sin(t * 43) + 0.01 * Math.sin(t * 97) - (Math.random() < 0.03 ? 0.04 : 0);

    const { cell, bx, by } = cellPx();
    const bw = COLS * cell, bh = ROWS * cell;
    const pad = Math.max(10, cell * 0.45);
    const px0 = bx - pad, py0 = by - pad;
    const pw = bw + pad * 2, ph = bh + pad + STATS_H;

    // panel card: barely-lighter fill with a hairline border
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(px0, py0, pw, ph);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px0 + 0.5, py0 + 0.5, pw - 1, ph - 1);

    // game title in the left margin, hold'em-style placement
    if (px0 > 190) {
      ctx.globalAlpha = 0.95 * flick;
      ctx.fillStyle = '#679A62';
      ctx.shadowColor = '#679A62';
      ctx.shadowBlur = 8;
      ctx.font = '84px AsgardianWars, "Asgardian Wars", Impact, fantasy';
      ctx.textAlign = 'center';
      ctx.fillText('Tetris', px0 / 2, H * 0.25);
      ctx.shadowBlur = 0;
      ctx.textAlign = 'left';
    }

    // faint cell grid over the play area
    ctx.globalAlpha = (0.055 + beat.kick * 0.015) * flick;
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    for (let c = 0; c <= COLS; c++) { ctx.moveTo(bx + c * cell + 0.5, by); ctx.lineTo(bx + c * cell + 0.5, by + bh); }
    for (let r = 0; r <= ROWS; r++) { ctx.moveTo(bx, by + r * cell + 0.5); ctx.lineTo(bx + bw, by + r * cell + 0.5); }
    ctx.stroke();

    // residue ghosts: pale tiles where pieces passed or rows cleared
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const h = heat[r][c];
        if (h > 0.01 && !T.board[r][c]) {
          ctx.globalAlpha = h * 0.14 * flick;
          ctx.fillStyle = '#c8cdd7';
          ctx.fillRect(bx + c * cell + 0.5, by + r * cell + 0.5, cell - 1, cell - 1);
        }
      }
    }

    // locked stack: flat translucent mosaic tiles
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const col = T.board[r][c];
        if (col) drawCell(bx + c * cell, by + r * cell, cell, col, (0.62 + beat.bass * 0.05) * flick, 6);
      }
    }

    // line-clear flash: a white band blooms over the exploded row and fades
    for (const rf of rowFlashes) {
      ctx.globalAlpha = rf.life * rf.life * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ffffff';
      ctx.shadowBlur = 22 * rf.life;
      ctx.fillRect(bx, by + rf.r * cell, bw, cell);
      ctx.shadowBlur = 0;
    }

    if (T.running && T.cur) {
      // ghost: whisper of a fill at the landing spot
      const gy = ghostY();
      for (let r = 0; r < T.cur.m.length; r++) {
        for (let c = 0; c < T.cur.m[r].length; c++) {
          if (T.cur.m[r][c] && gy + r >= 0) {
            ctx.globalAlpha = 0.10 * flick;
            ctx.fillStyle = T.cur.c;
            ctx.fillRect(bx + (T.cur.x + c) * cell + 0.5, by + (gy + r) * cell + 0.5, cell - 1, cell - 1);
          }
        }
      }
      // falling piece: brightest tiles with a soft bloom
      for (let r = 0; r < T.cur.m.length; r++) {
        for (let c = 0; c < T.cur.m[r].length; c++) {
          if (T.cur.m[r][c] && T.cur.y + r >= 0) {
            drawCell(bx + (T.cur.x + c) * cell, by + (T.cur.y + r) * cell, cell, T.cur.c, 0.92 * flick, 16 + beat.kick * 8);
          }
        }
      }
    }

    // small edge tags on the panel border
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(px0 - 4, by + bh * 0.16, 9, 4);
    ctx.fillRect(px0 + pw - 5, by + bh * 0.52, 9, 4);
    ctx.fillRect(px0 - 4, by + bh * 0.78, 9, 4);

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
    ctx.fillText('LINES', bx + bw * 0.46, fy + 10);
    ctx.textAlign = 'right';
    ctx.fillText('NEXT', bx + bw, fy + 10);
    ctx.textAlign = 'left';

    setTracking(0.5);
    ctx.font = '600 30px ' + SANS;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = '#ececf1';
    ctx.fillText(T.score.toLocaleString('de-DE'), bx, fy + 40);
    ctx.fillText(String(T.lines), bx + bw * 0.46, fy + 40);
    setTracking(0);

    // next piece preview, right-aligned mini mosaic
    if (T.next) {
      const mini = 8;
      const mw = T.next.m[0].length * mini;
      for (let r = 0; r < T.next.m.length; r++) {
        for (let c = 0; c < T.next.m[r].length; c++) {
          if (T.next.m[r][c]) {
            ctx.globalAlpha = 0.85;
            ctx.fillStyle = T.next.c;
            ctx.fillRect(bx + bw - mw + c * mini, fy + 18 + r * mini, mini - 1, mini - 1);
          }
        }
      }
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
    ctx.fillText('LEVEL ' + String(T.level).padStart(2, '0') + '  \u00B7  REGISTRATION INFORMATION', bx + 8, barY + 11.5);
    setTracking(0);

    ctx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    if (window.MODE === 'tetris' && !T.paused) {
      if (T.running) tick(dt);
      fx(dt);
      draw();
      ARCADE_FX.bezel(ctx);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
