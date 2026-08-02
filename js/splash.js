'use strict';
// ---- splash LCD demo: mini vignette of whichever game is hovered --------
(() => {
  const el = document.getElementById('lcdDemo');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const W = 21, R = 6; // segment grid: 6 rows tall, fixed so nothing shifts

  const blank = () => Array.from({ length: R }, () => Array(W).fill(' '));
  const show = g => { el.textContent = g.map(r => r.join('')).join('\n'); };

  // pong: flat rally along the middle, paddles tall enough to read as pong
  const pong = { x: 2, vx: 1 };
  function pongTick() {
    pong.x += pong.vx;
    if (pong.x <= 1 || pong.x >= W - 2) pong.vx *= -1, pong.x = Math.max(1, Math.min(W - 2, pong.x));
    const g = blank();
    for (const r of [1, 2, 3]) { g[r][0] = '█'; g[r][W - 1] = '█'; }
    g[2][pong.x] = '■';
    return g;
  }

  // tetris: tetrominoes fall the height of the well, land on the pile,
  // and a full bottom row blinks and clears
  const SHAPES = {
    I: [[0, 0], [0, 1], [0, 2], [0, 3]],
    O: [[0, 0], [0, 1], [1, 0], [1, 1]],
    T: [[0, 1], [1, 0], [1, 1], [1, 2]],
    S: [[0, 1], [0, 2], [1, 0], [1, 1]],
    L: [[0, 0], [1, 0], [1, 1], [1, 2]],
  };
  const drops = [
    ['I', 0], ['O', 4], ['T', 6], ['L', 9], ['O', 12], ['I', 14], ['T', 18],
    ['S', 2], ['L', 16], ['O', 7], ['T', 10],
  ];
  const tet = {
    i: 0, top: 0, flash: 0, mode: '',
    stack: Array.from({ length: R }, () => Array(W).fill(false)),
  };
  function tetFits(top) {
    const [name, col] = drops[tet.i % drops.length];
    for (const [r, c] of SHAPES[name]) {
      const nr = top + r;
      if (nr >= R || tet.stack[nr][col + c]) return false;
    }
    return true;
  }
  function tetTick() {
    const g = blank();
    if (tet.flash > 0) {
      tet.flash--;
      for (let r = 0; r < R; r++) {
        for (let c = 0; c < W; c++) {
          const lit = tet.stack[r][c] && !(tet.flash % 2 && (tet.mode === 'all' || r === R - 1));
          if (lit) g[r][c] = '█';
        }
      }
      if (tet.flash === 0) {
        if (tet.mode === 'all') {
          tet.stack = Array.from({ length: R }, () => Array(W).fill(false));
        } else {
          tet.stack.splice(R - 1, 1);
          tet.stack.unshift(Array(W).fill(false));
        }
        tet.top = 0;
      }
      return g;
    }
    for (let r = 0; r < R; r++) for (let c = 0; c < W; c++) if (tet.stack[r][c]) g[r][c] = '█';
    const [name, col] = drops[tet.i % drops.length];
    if (tetFits(tet.top) && tetFits(tet.top + 1)) {
      for (const [r, c] of SHAPES[name]) g[tet.top + r][col + c] = '■';
      tet.top++;
    } else if (!tetFits(tet.top)) {
      // no room to enter: the well topped out
      tet.flash = 6; tet.mode = 'all';
    } else {
      for (const [r, c] of SHAPES[name]) {
        tet.stack[tet.top + r][col + c] = true;
        g[tet.top + r][col + c] = '█';
      }
      tet.i++; tet.top = 0;
      if (tet.stack[R - 1].every(Boolean)) { tet.flash = 6; tet.mode = 'row'; }
      else if (tet.stack[1].some(Boolean)) { tet.flash = 6; tet.mode = 'all'; }
    }
    return g;
  }

  // snake: crawls the field perimeter chasing a food segment
  const perim = [];
  for (let c = 0; c < W; c++) perim.push([0, c]);
  for (let r = 1; r < R - 1; r++) perim.push([r, W - 1]);
  for (let c = W - 1; c >= 0; c--) perim.push([R - 1, c]);
  for (let r = R - 2; r >= 1; r--) perim.push([r, 0]);
  const snk = { head: 0, len: 8, food: 12 };
  function snakeTick() {
    snk.head = (snk.head + 1) % perim.length;
    if (snk.head === snk.food) snk.food = (snk.food + 17) % perim.length;
    const g = blank();
    const [fr, fc] = perim[snk.food];
    g[fr][fc] = '*';
    for (let i = 0; i < snk.len; i++) {
      const [r, c] = perim[(snk.head - i + perim.length) % perim.length];
      g[r][c] = '■';
    }
    return g;
  }

  // geo wars: foes converge on the center ship and pop on contact
  const geoV = {
    foes: [{ r: 0, c: 2 }, { r: 5, c: 18 }, { r: 0, c: 20 }, { r: 5, c: 4 }],
    spawns: [[0, 6], [5, 14], [0, 18], [5, 0], [0, 10], [5, 20], [0, 0], [5, 8]],
    si: 0, flashes: [],
  };
  function geoTick() {
    const g = blank();
    const cr = 2, cc = 10;
    for (const f of geoV.flashes) g[f.r][f.c] = '*';
    geoV.flashes = geoV.flashes.filter(f => --f.ttl > 0);
    for (const f of geoV.foes) {
      if (f.r < cr) f.r++; else if (f.r > cr) f.r--;
      if (f.c < cc) f.c++; else if (f.c > cc) f.c--;
      if (Math.abs(f.r - cr) + Math.abs(f.c - cc) <= 1) {
        geoV.flashes.push({ r: f.r, c: f.c, ttl: 2 });
        const s = geoV.spawns[geoV.si++ % geoV.spawns.length];
        f.r = s[0]; f.c = s[1];
      }
    }
    for (const f of geoV.foes) g[f.r][f.c] = '■';
    g[cr][cc] = '█';
    return g;
  }

  // cards: five cards dealt across the table, winner blinks, redeal
  const cardsV = { n: 0, ph: 0 };
  function cardsTick() {
    const g = blank();
    cardsV.ph++;
    if (cardsV.n < 5) { if (cardsV.ph % 2 === 0) cardsV.n++; }
    else if (cardsV.ph > 22) { cardsV.n = 0; cardsV.ph = 0; }
    for (let i = 0; i < cardsV.n; i++) {
      const x0 = 2 + i * 4;
      const blink = cardsV.n >= 5 && i === 2 && cardsV.ph % 2 === 1;
      if (blink) continue;
      for (let r = 2; r <= 3; r++) for (let c = x0; c < x0 + 3; c++) g[r][c] = '█';
    }
    return g;
  }

  // dungeon: hero paces two torch-lit rooms joined by a corridor
  const dgV = { x: 3, dir: 1, ph: 0 };
  function dungeonTick() {
    const g = blank();
    dgV.ph++;
    // room walls: two boxes bridged by a gap corridor
    const wall = (r, c) => { if (g[r] && g[r][c] !== undefined) g[r][c] = '█'; };
    for (let c = 1; c <= 8; c++) { wall(1, c); wall(5, c); }
    for (let c = 12; c <= 19; c++) { wall(1, c); wall(5, c); }
    for (let r = 1; r <= 5; r++) { wall(r, 1); wall(r, 19); }
    wall(2, 8); wall(4, 8); wall(2, 12); wall(4, 12);
    wall(3, 9); g[3][9] = ' '; // corridor mouth stays open
    // torches blink on the far walls
    if (dgV.ph % 4 < 3) { g[2][3] = '*'; g[2][16] = '*'; }
    // hero paces between the rooms
    dgV.x += dgV.dir;
    if (dgV.x >= 17) dgV.dir = -1;
    if (dgV.x <= 3) dgV.dir = 1;
    g[3][dgV.x] = '■';
    return g;
  }

  const anims = { pong: pongTick, tetris: tetTick, snake: snakeTick, geo: geoTick, cards: cardsTick, dungeon: dungeonTick };
  let mode = 'pong';
  show(anims[mode]());
  if (!reducedMotion) setInterval(() => show(anims[mode]()), 220);

  // hovered title picks the vignette; leaving falls back to pong
  const picks = { pickPong: 'pong', pickTetris: 'tetris', pickSnake: 'snake', pickGeo: 'geo', pickCards: 'cards', pickDungeon: 'dungeon' };
  for (const [id, m] of Object.entries(picks)) {
    const b = document.getElementById(id);
    const set = to => { mode = to; if (reducedMotion) show(anims[mode]()); };
    b.addEventListener('mouseenter', () => set(m));
    b.addEventListener('focus', () => set(m));
    b.addEventListener('mouseleave', () => set('pong'));
    b.addEventListener('blur', () => set('pong'));
  }
})();
