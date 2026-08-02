'use strict';
// ---- DUNGEON: procedurally generated crawler ----------------------------
// Stage 2: combat, enemies of varying difficulty, chests with rarity loot,
// inventory (Tab) with equipment and an editable hotbar, HP/armor HUD.
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const A = window.ARCADE;
  const pauseEl = document.getElementById('pauseOverlay');
  const launchEl = document.getElementById('launchOverlay');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TILE = 32;
  const MW = 46, MH = 34;
  const MONO = 'Consolas, "Courier New", monospace';

  // ---- pixel-art sprites, authored once as data --------------------------
  const PAL = {
    k: '#14160f', s: '#a8b0bc', d: '#6a7280', c: '#a4372e',
    g: '#d9a94e', b: '#2e2a22', w: '#c8b48a', W: '#d8dce0',
    e: '#7ec96f', E: '#4e8a44', B: '#8a6f4e', m: '#b8c4d0',
  };
  function sprite(rows, pal) {
    const p = Object.assign({}, PAL, pal || {});
    const h = rows.length, w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length && x < w; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        g.fillStyle = p[ch] || '#ffffff';
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }
  const HERO_ROWS_TOP = [
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
  ];
  const HERO_F1 = sprite(HERO_ROWS_TOP.concat(['..kdk..kdk..', '..kbk..kbk..', '.kbbk..kbbk.']));
  const HERO_F2 = sprite(HERO_ROWS_TOP.concat(['...kdkkdk...', '...kbkkbk...', '..kbbkkbbk..']));
  const TORCH = sprite(['..ww..', '.wggw.', '..gg..', '..bb..', '..bb..', '.kbbk.']);
  const SKEL_ROWS = [
    '....kkkk....',
    '...kWWWWk...',
    '...kWkkWk...',
    '...kWWWWk...',
    '....kkkk....',
    '.....kk.....',
    '...kkWWkk...',
    '..k.kWWk.k..',
    '..k.kWWk.k..',
    '....kWWk....',
    '....k..k....',
    '...kk..kk...',
    '...kk..kk...',
  ];
  const SKELETON = sprite(SKEL_ROWS);
  const WRAITH = sprite(SKEL_ROWS, { W: '#9db8e8' });
  const SLIME = sprite([
    '...kkkkkk...',
    '..keeeeeek..',
    '.keeeeeeeek.',
    '.keeEeeEeek.',
    '.keeeeeeeek.',
    'kEeeeeeeeEk.',
    '.kEEEEEEEEk.',
    '..kkkkkkkk..',
  ]);
  const BRUTE = sprite([
    '..kk......kk..',
    '..kBk....kBk..',
    '...kBBBBBBk...',
    '..kBBBBBBBBk..',
    '..kBkBBBBkBk..',
    '..kBBBBBBBBk..',
    '.kBBBBBBBBBBk.',
    '.kBBkBBBBkBBk.',
    '.kBBBBBBBBBBk.',
    '..kBBBBBBBBk..',
    '..kBBk..kBBk..',
    '...kkk..kkk...',
  ]);
  const CHEST_CLOSED = sprite([
    '.kkkkkkkkkk.',
    'kwwwwwwwwwwk',
    'kwwwwggwwwwk',
    'kkkkkkkkkkkk',
    'kbbbbggbbbbk',
    'kbbbbbbbbbbk',
    '.kkkkkkkkkk.',
  ]);
  const CHEST_OPEN = sprite([
    '.kkkkkkkkkk.',
    'kbbbbbbbbbbk',
    '.kkkkkkkkkk.',
    'kwwwwwwwwwwk',
    'kwwwwggwwwwk',
    'kkkkkkkkkkkk',
  ]);
  const ICON_SWORD = sprite([
    '....ss....',
    '....ss....',
    '....ss....',
    '....ss....',
    '..gggggg..',
    '....bb....',
    '....bb....',
  ]);
  const ICON_ARMOR = sprite([
    '.kkkkkkkk.',
    '.ksssssdk.',
    '.ksssssdk.',
    '.ksssssdk.',
    '..ksssdk..',
    '...ksdk...',
    '....kk....',
  ]);
  const ICON_POTION = sprite([
    '....kk....',
    '....kk....',
    '...kmmk...',
    '..kmccmk..',
    '..kcccck..',
    '...kkkk...',
  ]);
  const ICONS = { sword: ICON_SWORD, armor: ICON_ARMOR, potion: ICON_POTION };

  // ---- items and rarity --------------------------------------------------
  const RARITIES = [
    { name: 'Common',    color: '#c8cdd7', mult: 1,    w: 100 },
    { name: 'Uncommon',  color: '#7ec96f', mult: 1.3,  w: 55 },
    { name: 'Rare',      color: '#5aa2e8', mult: 1.7,  w: 24 },
    { name: 'Epic',      color: '#b06ae0', mult: 2.2,  w: 9 },
    { name: 'Legendary', color: '#e8a33d', mult: 3,    w: 3 },
  ];
  const MATS = ['Rusty', 'Iron', 'Steel', 'Obsidian', 'Mithril', 'Starforged'];
  function rollRarity(floor) {
    let total = 0;
    const ws = RARITIES.map((r, i) => {
      const w = r.w * (1 + floor * 0.16 * i);
      total += w;
      return w;
    });
    let roll = Math.random() * total;
    for (let i = 0; i < ws.length; i++) {
      roll -= ws[i];
      if (roll <= 0) return i;
    }
    return 0;
  }
  function makeItem(kind, floor) {
    const ri = rollRarity(floor);
    const rar = RARITIES[ri];
    const mat = MATS[Math.min(MATS.length - 1, Math.floor((floor - 1) / 2) + (ri >= 3 ? 1 : 0))];
    if (kind === 'sword') {
      return { kind, ri, dmg: Math.round((4 + floor * 1.3) * rar.mult), name: mat + ' Sword' };
    }
    if (kind === 'armor') {
      return { kind, ri, def: Math.round((2 + floor * 0.8) * rar.mult), name: mat + ' Armor' };
    }
    return { kind: 'potion', ri, heal: Math.round(25 * rar.mult), name: rar.name + ' Potion' };
  }
  function itemStat(it) {
    if (!it) return '';
    if (it.kind === 'sword') return it.dmg + ' dmg';
    if (it.kind === 'armor') return it.def + ' armor';
    return '+' + it.heal + ' hp';
  }

  // ---- enemy catalogue ---------------------------------------------------
  const ETYPES = {
    slime:    { spr: SLIME,    w: 26, h: 18, r: 11, spd: 52,  hp: f => 9 + f * 2,  dmg: f => 3 + f,      gold: f => 3 + f },
    skeleton: { spr: SKELETON, w: 24, h: 26, r: 10, spd: 88,  hp: f => 15 + f * 3, dmg: f => 6 + f * 2,  gold: f => 6 + f * 2 },
    wraith:   { spr: WRAITH,   w: 24, h: 26, r: 9,  spd: 132, hp: f => 10 + f * 2, dmg: f => 5 + f * 2,  gold: f => 8 + f * 2 },
    brute:    { spr: BRUTE,    w: 34, h: 30, r: 15, spd: 50,  hp: f => 34 + f * 7, dmg: f => 12 + f * 3, gold: f => 16 + f * 4 },
  };
  function pickEnemyType(floor) {
    const pool = [
      ['slime', Math.max(8, 40 - floor * 6)],
      ['skeleton', 24 + floor * 4],
      ['wraith', floor >= 2 ? 10 + floor * 4 : 0],
      ['brute', floor >= 2 ? 6 + floor * 3 : 0],
    ];
    let total = 0;
    for (const [, w] of pool) total += w;
    let roll = Math.random() * total;
    for (const [name, w] of pool) {
      roll -= w;
      if (roll <= 0) return name;
    }
    return 'slime';
  }

  // ---- state -------------------------------------------------------------
  const D = {
    running: false, paused: false, over: false,
    tiles: null, seen: null, rooms: [], torches: [], chests: [], enemies: [],
    stairs: { x: 0, y: 0 },
    hero: { x: 0, y: 0, face: 1, moving: false, hp: 100, maxHp: 100, gold: 0 },
    equip: { sword: null, armor: null },
    bag: new Array(16).fill(null),
    hotbar: new Array(4).fill(null),
    inv: false, invMx: 0, invMy: 0,
    atkT: 0, atkAnim: 0, atkDir: 0,
    hurtT: 0, spawnT: 18,
    floats: [], msgs: [],
    cam: { x: 0, y: 0 },
    floor: 1, t: 0, shake: 0,
  };
  const keys = {};
  const idx = (x, y) => y * MW + x;
  const solid = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || D.tiles[idx(x, y)] === 0;
  const hash = (x, y) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) % 1000;
  };
  const heroDmg = () => (D.equip.sword ? D.equip.sword.dmg : 3);
  const heroDef = () => (D.equip.armor ? D.equip.armor.def : 0);
  function say(text, color) {
    D.msgs.push({ text, color: color || '#c8cdd7', t: 2.6 });
    if (D.msgs.length > 4) D.msgs.shift();
  }
  function floatText(x, y, text, color) {
    D.floats.push({ x, y, text, color, t: 1 });
  }
  function addToBag(it) {
    const slot = D.bag.indexOf(null);
    if (slot < 0) { say('Bag full!', '#a4372e'); return false; }
    D.bag[slot] = it;
    return true;
  }

  // ---- generation --------------------------------------------------------
  function generate() {
    D.tiles = new Uint8Array(MW * MH);
    D.seen = new Uint8Array(MW * MH);
    D.rooms = []; D.torches = []; D.chests = []; D.enemies = [];
    D.floats.length = 0;
    for (let tries = 0; tries < 90 && D.rooms.length < 9; tries++) {
      const w = 5 + Math.floor(Math.random() * 6);
      const h = 4 + Math.floor(Math.random() * 5);
      const x = 2 + Math.floor(Math.random() * (MW - w - 4));
      const y = 2 + Math.floor(Math.random() * (MH - h - 4));
      if (D.rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      D.rooms.push({ x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) });
      for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) D.tiles[idx(tx, ty)] = 1;
    }
    for (let i = 1; i < D.rooms.length; i++) {
      const a = D.rooms[i - 1], b = D.rooms[i];
      const carve = (x, y) => { D.tiles[idx(x, y)] = 1; };
      if (Math.random() < 0.5) {
        for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) carve(x, a.cy);
        for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) carve(b.cx, y);
      } else {
        for (let y = Math.min(a.cy, b.cy); y <= Math.max(a.cy, b.cy); y++) carve(a.cx, y);
        for (let x = Math.min(a.cx, b.cx); x <= Math.max(a.cx, b.cx); x++) carve(x, b.cy);
      }
    }
    for (let y = 0; y < MH - 1; y++) {
      for (let x = 0; x < MW; x++) {
        if (D.tiles[idx(x, y)] === 0 && D.tiles[idx(x, y + 1)] === 1 && hash(x, y) % 5 === 0) {
          D.torches.push({ x, y, ph: (hash(x, y) % 100) / 16 });
        }
      }
    }
    const start = D.rooms[0];
    D.hero.x = (start.cx + 0.5) * TILE;
    D.hero.y = (start.cy + 0.5) * TILE;
    let far = D.rooms[0], farD = -1;
    for (const r of D.rooms) {
      const dd = Math.hypot(r.cx - start.cx, r.cy - start.cy);
      if (dd > farD) { farD = dd; far = r; }
    }
    D.stairs = { x: far.cx, y: far.cy };
    // chests in random non-start rooms, glowing with their rarity
    const nChests = 3 + Math.floor(Math.random() * 2);
    for (let i = 0; i < nChests && D.rooms.length > 1; i++) {
      const r = D.rooms[1 + Math.floor(Math.random() * (D.rooms.length - 1))];
      const cx2 = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
      const cy2 = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
      if (D.chests.some(c => c.x === cx2 && c.y === cy2)) continue;
      if (cx2 === D.stairs.x && cy2 === D.stairs.y) continue;
      D.chests.push({ x: cx2, y: cy2, ri: rollRarity(D.floor), opened: false });
    }
    // enemies scattered away from the start room
    const n = 6 + D.floor * 2;
    for (let i = 0; i < n; i++) spawnEnemy(true);
    reveal();
  }
  function spawnEnemy(anywhere) {
    for (let tries = 0; tries < 60; tries++) {
      const x = Math.floor(Math.random() * MW), y = Math.floor(Math.random() * MH);
      if (D.tiles[idx(x, y)] !== 1) continue;
      const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE;
      if (Math.hypot(px - D.hero.x, py - D.hero.y) < TILE * 7) continue;
      if (!anywhere && D.seen[idx(x, y)]) continue;
      const type = pickEnemyType(D.floor);
      const et = ETYPES[type];
      D.enemies.push({
        type, x: px, y: py,
        hp: et.hp(D.floor), maxHp: et.hp(D.floor),
        cd: 0, wanderT: 0, wx: 0, wy: 0, face: 1, hurt: 0,
      });
      return;
    }
  }

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
    D.floor = 1; D.t = 0;
    D.hero.hp = 100; D.hero.maxHp = 100; D.hero.gold = 0;
    D.equip.sword = null; D.equip.armor = null;
    D.bag.fill(null); D.hotbar.fill(null);
    D.bag[0] = { kind: 'potion', ri: 0, heal: 25, name: 'Common Potion' };
    D.hotbar[0] = D.bag[0]; D.bag[0] = null;
    D.inv = false; D.over = false;
    D.msgs.length = 0;
    generate();
    D.cam.x = D.hero.x; D.cam.y = D.hero.y;
  }
  function start() {
    prime();
    D.running = true;
    ARCADE_LOCK.lock();
    A.audio(); A.startMusic();
  }
  function die() {
    D.running = false;
    D.over = true;
    D.inv = false;
    ARCADE_LOCK.unlock();
    A.bleep(220, 0.25, 'sawtooth', 0.06);
    setTimeout(() => A.bleep(150, 0.35, 'sawtooth', 0.06), 160);
  }
  function togglePause() {
    if (!D.running) return;
    D.paused = !D.paused;
    if (D.paused) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
    pauseEl.classList.toggle('hidden', !D.paused);
    if (D.paused) A.suspend(); else A.resume();
  }
  function quitToMenu() {
    D.running = false; D.paused = false; D.inv = false; D.over = false;
    ARCADE_LOCK.unlock();
    A.setStyle('neon');
    A.resume();
    pauseEl.classList.add('hidden');
    launchEl.classList.remove('hidden');
    window.MODE = 'menu';
  }
  function toggleInv() {
    if (!D.running) return;
    D.inv = !D.inv;
    if (D.inv) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
  }
  function descend() {
    D.floor++;
    D.hero.hp = Math.min(D.hero.maxHp, D.hero.hp + 25);
    say('FLOOR ' + D.floor, '#d9a94e');
    A.sweep(400, 60, 0.5, 'sine', 0.06);
    generate();
    D.cam.x = D.hero.x; D.cam.y = D.hero.y;
  }

  document.getElementById('pickDungeon').addEventListener('click', () => {
    window.MODE = 'dungeon';
    A.setStyle('medieval');
    launchEl.classList.add('hidden');
    prime();
  });
  addEventListener('keydown', e => {
    if (window.MODE !== 'dungeon') return;
    if (e.key === 'Escape') {
      if (D.inv) { toggleInv(); return; }
      togglePause();
      return;
    }
    if ((e.key === 'q' || e.key === 'Q') && (D.paused || !D.running)) { quitToMenu(); return; }
    if (e.key === 'Enter' && !D.running && !D.paused) { start(); return; }
    if (e.key === 'Tab') { e.preventDefault(); toggleInv(); return; }
    if (D.running && !D.paused && !D.inv && ['1', '2', '3', '4'].includes(e.key)) {
      useHotbar(+e.key - 1);
    }
    if (e.key === ' ' && D.running && !D.paused && !D.inv) {
      attack(D.hero.face > 0 ? 0 : Math.PI);
      e.preventDefault();
      return;
    }
    keys[e.key.toLowerCase()] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  addEventListener('pointermove', e => {
    if (window.MODE === 'dungeon' && D.inv) { D.invMx = e.clientX; D.invMy = e.clientY; }
  });
  addEventListener('pointerdown', e => {
    if (window.MODE !== 'dungeon') return;
    if (D.paused) { togglePause(); return; }
    if (D.inv) { invClick(e.clientX, e.clientY); return; }
    if (!D.running) { start(); return; }
    if (e.button === 0) {
      const ax2 = ARCADE_LOCK.cur.x - (innerWidth / 2);
      const ay2 = ARCADE_LOCK.cur.y - (innerHeight / 2);
      attack(Math.atan2(ay2, ax2));
    }
  });
  addEventListener('arcadecursorunlock', () => {
    if (window.MODE === 'dungeon' && D.running && !D.paused && !D.inv) togglePause();
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

  // ---- combat ------------------------------------------------------------
  function attack(dir) {
    if (D.atkT > 0) return;
    D.atkT = 0.34;
    D.atkAnim = 0.16;
    D.atkDir = dir;
    if (Math.cos(dir) > 0.3) D.hero.face = 1;
    else if (Math.cos(dir) < -0.3) D.hero.face = -1;
    A.bleep(340, 0.05, 'square', 0.03);
    const RANGE = 52;
    for (const en of D.enemies) {
      const dx = en.x - D.hero.x, dy = en.y - D.hero.y;
      const d = Math.hypot(dx, dy);
      if (d > RANGE + ETYPES[en.type].r) continue;
      let ang = Math.atan2(dy, dx) - dir;
      while (ang > Math.PI) ang -= Math.PI * 2;
      while (ang < -Math.PI) ang += Math.PI * 2;
      if (Math.abs(ang) > 1.05) continue;
      const dmg = heroDmg() + Math.floor(Math.random() * 3);
      en.hp -= dmg;
      en.hurt = 0.18;
      const kn = 150 / (ETYPES[en.type].r / 10);
      const nd = d || 1;
      en.x += (dx / nd) * kn * 0.12;
      en.y += (dy / nd) * kn * 0.12;
      floatText(en.x, en.y - 20, '' + dmg, '#e8e0c8');
      A.bleep(220 + Math.random() * 120, 0.06, 'sawtooth', 0.035);
      if (en.hp <= 0) killEnemy(en);
    }
  }
  function killEnemy(en) {
    const et = ETYPES[en.type];
    const gold = et.gold(D.floor) + Math.floor(Math.random() * 4);
    D.hero.gold += gold;
    floatText(en.x, en.y - 26, '+' + gold + 'g', '#d9a94e');
    D.enemies.splice(D.enemies.indexOf(en), 1);
    D.shake = Math.max(D.shake, 4);
    A.bleep(160, 0.1, 'sawtooth', 0.045);
    if (Math.random() < 0.1) {
      const it = makeItem('potion', D.floor);
      if (addToBag(it)) say('Found ' + it.name, RARITIES[it.ri].color);
    }
  }
  function hurtHero(raw) {
    if (D.hurtT > 0) return;
    const dmg = Math.max(1, raw - heroDef());
    D.hero.hp -= dmg;
    D.hurtT = 0.6;
    D.shake = Math.max(D.shake, 8);
    floatText(D.hero.x, D.hero.y - 24, '-' + dmg, '#a4372e');
    A.bleep(180, 0.12, 'square', 0.05);
    if (D.hero.hp <= 0) { D.hero.hp = 0; die(); }
  }
  function useHotbar(i) {
    const it = D.hotbar[i];
    if (!it) return;
    if (it.kind === 'potion') {
      if (D.hero.hp >= D.hero.maxHp) { say('Already at full health'); return; }
      D.hero.hp = Math.min(D.hero.maxHp, D.hero.hp + it.heal);
      D.hotbar[i] = null;
      floatText(D.hero.x, D.hero.y - 24, '+' + it.heal, '#7ec96f');
      A.bleep(620, 0.08, 'triangle', 0.045);
    }
  }

  // ---- inventory UI ------------------------------------------------------
  const SLOT = 52, GAP = 8;
  function invLayout() {
    const W = innerWidth, H = innerHeight;
    const pw = 590, ph = 420;
    const px = W / 2 - pw / 2, py = H / 2 - ph / 2;
    const bag = [];
    for (let i = 0; i < 16; i++) {
      bag.push({
        x: px + 250 + (i % 4) * (SLOT + GAP),
        y: py + 74 + Math.floor(i / 4) * (SLOT + GAP),
      });
    }
    const eq = {
      sword: { x: px + 60, y: py + 96 },
      armor: { x: px + 132, y: py + 96 },
    };
    const hot = [];
    for (let i = 0; i < 4; i++) {
      hot.push({ x: px + 250 + i * (SLOT + GAP), y: py + ph - 86 });
    }
    return { px, py, pw, ph, bag, eq, hot };
  }
  const inSlot = (mx, my, s) => mx >= s.x && mx <= s.x + SLOT && my >= s.y && my <= s.y + SLOT;
  function invClick(mx, my) {
    const L = invLayout();
    for (let i = 0; i < 16; i++) {
      if (!inSlot(mx, my, L.bag[i])) continue;
      const it = D.bag[i];
      if (!it) return;
      if (it.kind === 'sword' || it.kind === 'armor') {
        const old = D.equip[it.kind];
        D.equip[it.kind] = it;
        D.bag[i] = old;
        say('Equipped ' + it.name, RARITIES[it.ri].color);
        A.bleep(500, 0.05, 'triangle', 0.035);
      } else {
        const slot = D.hotbar.indexOf(null);
        if (slot < 0) { say('Hotbar full'); return; }
        D.hotbar[slot] = it;
        D.bag[i] = null;
        A.bleep(560, 0.04, 'triangle', 0.03);
      }
      return;
    }
    for (const kind of ['sword', 'armor']) {
      if (inSlot(mx, my, L.eq[kind]) && D.equip[kind]) {
        if (addToBag(D.equip[kind])) {
          D.equip[kind] = null;
          A.bleep(420, 0.04, 'triangle', 0.03);
        }
        return;
      }
    }
    for (let i = 0; i < 4; i++) {
      if (inSlot(mx, my, L.hot[i]) && D.hotbar[i]) {
        if (addToBag(D.hotbar[i])) {
          D.hotbar[i] = null;
          A.bleep(420, 0.04, 'triangle', 0.03);
        }
        return;
      }
    }
  }

  // ---- movement + world sim ----------------------------------------------
  const HERO_R = 9;
  function collide(nx, ny, r) {
    const x0 = Math.floor((nx - r) / TILE), x1 = Math.floor((nx + r) / TILE);
    const y0 = Math.floor((ny - r) / TILE), y1 = Math.floor((ny + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (solid(tx, ty)) return true;
    }
    return false;
  }
  function moveWith(o, vx, vy, dt, r) {
    const nx = o.x + vx * dt;
    if (!collide(nx, o.y, r)) o.x = nx;
    const ny = o.y + vy * dt;
    if (!collide(o.x, ny, r)) o.y = ny;
  }
  function update(dt) {
    D.t += dt;
    D.shake = Math.max(0, D.shake - dt * 30);
    D.atkT = Math.max(0, D.atkT - dt);
    D.atkAnim = Math.max(0, D.atkAnim - dt);
    D.hurtT = Math.max(0, D.hurtT - dt);
    for (let i = D.floats.length - 1; i >= 0; i--) {
      const f = D.floats[i];
      f.y -= 26 * dt; f.t -= dt;
      if (f.t <= 0) D.floats.splice(i, 1);
    }
    for (let i = D.msgs.length - 1; i >= 0; i--) {
      D.msgs[i].t -= dt;
      if (D.msgs[i].t <= 0) D.msgs.splice(i, 1);
    }
    if (D.inv) return; // world holds its breath while the bag is open

    let ax = 0, ay = 0;
    if (keys['a'] || keys['arrowleft']) ax -= 1;
    if (keys['d'] || keys['arrowright']) ax += 1;
    if (keys['w'] || keys['arrowup']) ay -= 1;
    if (keys['s'] || keys['arrowdown']) ay += 1;
    const m = Math.hypot(ax, ay) || 1;
    D.hero.moving = !!(ax || ay);
    if (ax) D.hero.face = ax > 0 ? 1 : -1;
    moveWith(D.hero, (ax / m) * 165, (ay / m) * 165, dt, HERO_R);
    if (D.hero.moving) reveal();
    D.cam.x = D.hero.x; D.cam.y = D.hero.y;

    // stairs: step on to descend
    if (Math.hypot(D.hero.x - (D.stairs.x + 0.5) * TILE, D.hero.y - (D.stairs.y + 0.5) * TILE) < 20) {
      descend();
      return;
    }
    // chests: open by touch
    for (const c of D.chests) {
      if (c.opened) continue;
      if (Math.hypot(D.hero.x - (c.x + 0.5) * TILE, D.hero.y - (c.y + 0.5) * TILE) < 30) {
        c.opened = true;
        const rar = RARITIES[c.ri];
        const gold = Math.round((8 + D.floor * 5) * rar.mult);
        D.hero.gold += gold;
        floatText(D.hero.x, D.hero.y - 24, '+' + gold + 'g', '#d9a94e');
        const kinds = ['potion', 'potion', 'sword', 'armor'];
        const it = makeItem(kinds[Math.floor(Math.random() * kinds.length)], D.floor);
        it.ri = Math.max(it.ri, c.ri); // chest rarity floors the loot
        if (it.kind === 'sword') it.dmg = Math.round((4 + D.floor * 1.3) * RARITIES[it.ri].mult);
        if (it.kind === 'armor') it.def = Math.round((2 + D.floor * 0.8) * RARITIES[it.ri].mult);
        if (it.kind === 'potion') it.heal = Math.round(25 * RARITIES[it.ri].mult);
        if (addToBag(it)) say('Found ' + it.name + ' (' + RARITIES[it.ri].name + ')', RARITIES[it.ri].color);
        A.sweep(500, 80, 0.35, 'sine', 0.05);
        A.bleep(760, 0.08, 'triangle', 0.04);
      }
    }
    // enemies: wander until the hero is close, then hunt
    for (const en of D.enemies) {
      const et = ETYPES[en.type];
      en.cd = Math.max(0, en.cd - dt);
      en.hurt = Math.max(0, en.hurt - dt);
      const dx = D.hero.x - en.x, dy = D.hero.y - en.y;
      const d = Math.hypot(dx, dy);
      if (d < TILE * 6.5) {
        moveWith(en, (dx / (d || 1)) * et.spd, (dy / (d || 1)) * et.spd, dt, et.r);
        if (dx) en.face = dx > 0 ? 1 : -1;
        if (d < et.r + HERO_R + 5 && en.cd <= 0) {
          en.cd = 0.85;
          hurtHero(et.dmg(D.floor));
        }
      } else {
        en.wanderT -= dt;
        if (en.wanderT <= 0) {
          en.wanderT = 1 + Math.random() * 2.5;
          const a = Math.random() * Math.PI * 2;
          const go = Math.random() < 0.7;
          en.wx = go ? Math.cos(a) : 0;
          en.wy = go ? Math.sin(a) : 0;
        }
        moveWith(en, en.wx * et.spd * 0.4, en.wy * et.spd * 0.4, dt, et.r);
        if (en.wx) en.face = en.wx > 0 ? 1 : -1;
      }
    }
    // trickle spawns keep the floor dangerous
    D.spawnT -= dt;
    if (D.spawnT <= 0) {
      D.spawnT = 16;
      if (D.enemies.length < 8 + D.floor * 2) spawnEnemy(false);
    }
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
  function drawSlot(s, it, hover) {
    ctx.fillStyle = hover ? 'rgba(255, 255, 255, 0.13)' : 'rgba(255, 255, 255, 0.06)';
    ctx.fillRect(s.x, s.y, SLOT, SLOT);
    ctx.strokeStyle = it ? RARITIES[it.ri].color : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = it ? 2 : 1;
    ctx.strokeRect(s.x + 0.5, s.y + 0.5, SLOT - 1, SLOT - 1);
    if (it) {
      const ic = ICONS[it.kind];
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ic, s.x + SLOT / 2 - ic.width * 2, s.y + SLOT / 2 - ic.height * 2, ic.width * 4, ic.height * 4);
    }
  }
  function drawInventory() {
    const W = innerWidth, H = innerHeight;
    const L = invLayout();
    ctx.globalAlpha = 0.78;
    ctx.fillStyle = '#0c0e08';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#181b12';
    ctx.fillRect(L.px, L.py, L.pw, L.ph);
    ctx.strokeStyle = 'rgba(200, 205, 215, 0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(L.px + 0.5, L.py + 0.5, L.pw - 1, L.ph - 1);
    ctx.fillStyle = '#c8cdd7';
    ctx.font = '600 18px ' + MONO;
    ctx.textAlign = 'left';
    ctx.fillText('INVENTORY', L.px + 26, L.py + 38);
    ctx.font = '600 12px ' + MONO;
    ctx.fillStyle = '#8a8f80';
    ctx.fillText('EQUIPPED', L.px + 60, L.py + 84);
    ctx.fillText('BAG', L.px + 250, L.py + 64);
    ctx.fillText('HOTBAR  [1-4]', L.px + 250, L.py + L.ph - 96);
    let hoverItem = null;
    for (const kind of ['sword', 'armor']) {
      const s = L.eq[kind];
      const hov = inSlot(D.invMx, D.invMy, s);
      drawSlot(s, D.equip[kind], hov);
      if (hov && D.equip[kind]) hoverItem = D.equip[kind];
      ctx.fillStyle = '#8a8f80';
      ctx.font = '600 10px ' + MONO;
      ctx.fillText(kind.toUpperCase(), s.x + 4, s.y + SLOT + 14);
    }
    for (let i = 0; i < 16; i++) {
      const hov = inSlot(D.invMx, D.invMy, L.bag[i]);
      drawSlot(L.bag[i], D.bag[i], hov);
      if (hov && D.bag[i]) hoverItem = D.bag[i];
    }
    for (let i = 0; i < 4; i++) {
      const hov = inSlot(D.invMx, D.invMy, L.hot[i]);
      drawSlot(L.hot[i], D.hotbar[i], hov);
      if (hov && D.hotbar[i]) hoverItem = D.hotbar[i];
      ctx.fillStyle = '#8a8f80';
      ctx.font = '600 10px ' + MONO;
      ctx.fillText('' + (i + 1), L.hot[i].x + 4, L.hot[i].y + 13);
    }
    // stats line + tooltip
    ctx.font = '600 13px ' + MONO;
    ctx.fillStyle = '#c8cdd7';
    ctx.fillText('DMG ' + heroDmg(), L.px + 60, L.py + 200);
    ctx.fillText('ARM ' + heroDef(), L.px + 60, L.py + 222);
    ctx.fillText('GOLD ' + D.hero.gold, L.px + 60, L.py + 244);
    if (hoverItem) {
      ctx.fillStyle = RARITIES[hoverItem.ri].color;
      ctx.fillText(RARITIES[hoverItem.ri].name + ' ' + hoverItem.name + '  ·  ' + itemStat(hoverItem), L.px + 26, L.py + L.ph - 18);
    } else {
      ctx.fillStyle = '#8a8f80';
      ctx.fillText('click gear to equip · potions go to hotbar · Tab closes', L.px + 26, L.py + L.ph - 18);
    }
  }
  function draw() {
    const W = innerWidth, H = innerHeight;
    ARCADE_FX.screen(ctx);
    ctx.imageSmoothingEnabled = false;
    let ox = Math.round(W / 2 - D.cam.x), oy = Math.round(H / 2 - D.cam.y);
    if (D.shake > 0 && !reducedMotion) {
      ox += Math.round((Math.random() - 0.5) * D.shake);
      oy += Math.round((Math.random() - 0.5) * D.shake);
    }
    const tx0 = Math.max(0, Math.floor(-ox / TILE)), tx1 = Math.min(MW - 1, Math.ceil((W - ox) / TILE));
    const ty0 = Math.max(0, Math.floor(-oy / TILE)), ty1 = Math.min(MH - 1, Math.ceil((H - oy) / TILE));

    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        if (!D.seen[idx(x, y)]) continue;
        const sx = ox + x * TILE, sy = oy + y * TILE;
        const hv = hash(x, y);
        if (D.tiles[idx(x, y)] === 1) {
          ctx.fillStyle = hv % 3 === 0 ? '#343a2e' : '#3a4033';
          ctx.fillRect(sx, sy, TILE, TILE);
          if (hv % 11 === 0) {
            ctx.fillStyle = '#2e3428';
            ctx.fillRect(sx + (hv % 5) * 5 + 4, sy + (hv % 7) * 3 + 4, 6, 2);
          }
          if (solid(x, y - 1)) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
            ctx.fillRect(sx, sy, TILE, 7);
          }
        } else if (y + 1 < MH && D.tiles[idx(x, y + 1)] === 1) {
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
          ctx.fillStyle = '#20241a';
          ctx.fillRect(sx, sy, TILE, TILE);
        }
      }
    }

    // stairs
    if (D.seen[idx(D.stairs.x, D.stairs.y)]) {
      const sx = ox + D.stairs.x * TILE, sy = oy + D.stairs.y * TILE;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.35 + i * 0.13) + ')';
        ctx.fillRect(sx + i * 4, sy + i * 4, TILE - i * 8, TILE - i * 8);
      }
    }
    // chests
    for (const c of D.chests) {
      if (!D.seen[idx(c.x, c.y)]) continue;
      const sx = ox + c.x * TILE + TILE / 2, sy = oy + c.y * TILE + TILE / 2;
      if (!c.opened) {
        const rc = RARITIES[c.ri].color;
        ctx.globalAlpha = 0.28 + (reducedMotion ? 0 : 0.1 * Math.sin(D.t * 3 + c.x));
        ctx.fillStyle = rc;
        ctx.beginPath();
        ctx.arc(sx, sy, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const spr = c.opened ? CHEST_OPEN : CHEST_CLOSED;
      ctx.drawImage(spr, sx - 12, sy - spr.height, 24, spr.height * 2);
    }
    // torches
    for (const tc of D.torches) {
      if (!D.seen[idx(tc.x, tc.y)]) continue;
      const sx = ox + tc.x * TILE, sy = oy + tc.y * TILE;
      ctx.drawImage(TORCH, sx + TILE / 2 - 6, sy + TILE - 14, 12, 12);
      const fl = reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(D.t * 9 + tc.ph);
      ctx.globalAlpha = 0.5 * fl;
      ctx.fillStyle = '#e8a33d';
      ctx.beginPath();
      ctx.arc(sx + TILE / 2, sy + TILE - 11, 4 + fl * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // enemies
    for (const en of D.enemies) {
      if (!D.seen[idx(Math.floor(en.x / TILE), Math.floor(en.y / TILE))]) continue;
      const et = ETYPES[en.type];
      const sx = ox + en.x, sy = oy + en.y;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(en.face, 1);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(0, et.h / 2, et.r, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = en.hurt > 0 ? 0.55 : 1;
      ctx.drawImage(et.spr, -et.w / 2, -et.h / 2, et.w, et.h);
      ctx.restore();
      ctx.globalAlpha = 1;
      if (en.hp < en.maxHp) {
        const bw = 26;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(sx - bw / 2, sy - et.h / 2 - 9, bw, 4);
        ctx.fillStyle = '#a4372e';
        ctx.fillRect(sx - bw / 2, sy - et.h / 2 - 9, bw * Math.max(0, en.hp / en.maxHp), 4);
      }
    }
    // hero (blinks while invulnerable)
    if (!(D.hurtT > 0 && Math.floor(D.t * 14) % 2)) {
      const frame = D.hero.moving && Math.floor(D.t * 8) % 2 ? HERO_F2 : HERO_F1;
      ctx.save();
      ctx.translate(ox + D.hero.x, oy + D.hero.y + 2);
      ctx.scale(D.hero.face, 1);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(0, 12, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.drawImage(frame, -12, -13, 24, 26);
      ctx.restore();
    }
    // attack swing arc
    if (D.atkAnim > 0) {
      const p = 1 - D.atkAnim / 0.16;
      ctx.save();
      ctx.translate(ox + D.hero.x, oy + D.hero.y);
      ctx.rotate(D.atkDir);
      ctx.globalAlpha = (1 - p) * 0.75;
      ctx.strokeStyle = '#e8e0c8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 30 + p * 22, -0.9, 0.9);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // floating combat text
    ctx.font = '600 13px ' + MONO;
    ctx.textAlign = 'center';
    for (const f of D.floats) {
      ctx.globalAlpha = Math.min(1, f.t * 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, ox + f.x, oy + f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    // lighting
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

    // ---- HUD -------------------------------------------------------------
    ctx.font = '600 15px ' + MONO;
    ctx.fillStyle = '#c8cdd7';
    ctx.globalAlpha = 0.9;
    ctx.fillText('FLOOR ' + D.floor, 26, 34);
    // health bar
    const hbW = 190;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(26, 46, hbW, 16);
    ctx.fillStyle = '#a4372e';
    ctx.fillRect(26, 46, hbW * Math.max(0, D.hero.hp / D.hero.maxHp), 16);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(26.5, 46.5, hbW - 1, 15);
    ctx.fillStyle = '#e8e0c8';
    ctx.font = '600 11px ' + MONO;
    ctx.fillText(D.hero.hp + ' / ' + D.hero.maxHp, 32, 58);
    ctx.font = '600 13px ' + MONO;
    ctx.fillStyle = '#8fa2b8';
    ctx.fillText('ARMOR ' + heroDef(), 26, 82);
    ctx.fillStyle = '#d9a94e';
    ctx.fillText('GOLD ' + D.hero.gold, 26, 102);
    // hotbar, always on screen
    const hbX = W / 2 - (4 * (SLOT + GAP) - GAP) / 2;
    for (let i = 0; i < 4; i++) {
      const s = { x: hbX + i * (SLOT + GAP), y: H - SLOT - 18 };
      drawSlot(s, D.hotbar[i], false);
      ctx.fillStyle = '#8a8f80';
      ctx.font = '600 10px ' + MONO;
      ctx.fillText('' + (i + 1), s.x + 4, s.y + 13);
    }
    // messages
    ctx.textAlign = 'center';
    ctx.font = '600 14px ' + MONO;
    for (let i = 0; i < D.msgs.length; i++) {
      const mg = D.msgs[i];
      ctx.globalAlpha = Math.min(1, mg.t);
      ctx.fillStyle = mg.color;
      ctx.fillText(mg.text, W / 2, 44 + i * 22);
    }
    ctx.globalAlpha = 1;
    if (!D.running && !D.over) {
      ctx.globalAlpha = 0.6;
      ctx.font = '600 13px ' + MONO;
      ctx.fillStyle = '#c8cdd7';
      ctx.fillText('CLICK OR ENTER TO DELVE · WASD MOVES · CLICK SWINGS · TAB BAG', W / 2, H - 90);
    }
    if (D.over) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = '#0c0e08';
      ctx.fillRect(0, H / 2 - 70, W, 140);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#a4372e';
      ctx.font = '800 44px ' + MONO;
      ctx.fillText('YOU DIED', W / 2, H / 2 - 10);
      ctx.fillStyle = '#c8cdd7';
      ctx.font = '600 14px ' + MONO;
      ctx.fillText('floor ' + D.floor + ' · ' + D.hero.gold + ' gold · Enter or click to retry', W / 2, H / 2 + 26);
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;

    if (D.inv) drawInventory();
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
