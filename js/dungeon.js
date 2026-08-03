'use strict';
// ---- DUNGEON: procedurally generated crawler ----------------------------
// Stage 4: Isaac-style room-grid generation (no dead corridors), mana and
// castable magic, and stacking relic pickups with buffs and curses.
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const stageEl = document.getElementById('stage');
  const A = window.ARCADE;
  const pauseEl = document.getElementById('pauseOverlay');
  const launchEl = document.getElementById('launchOverlay');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const TILE = 32;
  // room grid: 5x4 cells, each cell a 9x7-tile room with 1-tile walls
  const GW = 5, GH = 4, CW = 10, CH = 8;
  const MW = GW * CW + 1, MH = GH * CH + 1;
  const MONO = 'Consolas, "Courier New", monospace';

  // ---- pixel-art sprites, authored once as data --------------------------
  const PAL = {
    k: '#14160f', s: '#a8b0bc', d: '#6a7280', c: '#a4372e',
    g: '#d9a94e', b: '#2e2a22', w: '#c8b48a', W: '#d8dce0',
    e: '#7ec96f', E: '#4e8a44', B: '#8a6f4e', m: '#b8c4d0', i: '#c8cdd7',
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
  const FRONT_L1 = ['..kdk..kdk..', '..kbk..kbk..', '.kbbk..kbbk.'];
  const FRONT_L2 = ['...kdkkdk...', '...kbkkbk...', '..kbbkkbbk..'];
  const SIDE_L1 = ['....kdkdk...', '....kbkbk...', '...kbbkbbk..'];
  const SIDE_L2 = ['...kdk.kdk..', '...kb...bk..', '..kbb..kbb..'];
  const HERO_SIDE_TOP = [
    '....kkkk....',
    '...kssssk...',
    '...kssbbk...',
    '...kssssk...',
    '....kddk....',
    '.kkcssdik...',
    'kcccssddik..',
    'kcccssddik..',
    '.kkcgdddk...',
    '...kdssdk...',
  ];
  // classes share the pose set, recolored per palette
  function buildHero(pal) {
    return {
      F1: sprite(HERO_ROWS_TOP.concat(FRONT_L1), pal),
      F2: sprite(HERO_ROWS_TOP.concat(FRONT_L2), pal),
      S1: sprite(HERO_SIDE_TOP.concat(SIDE_L1), pal),
      S2: sprite(HERO_SIDE_TOP.concat(SIDE_L2), pal),
      B1: sprite(HERO_BACK_TOP.concat(FRONT_L1), pal),
      B2: sprite(HERO_BACK_TOP.concat(FRONT_L2), pal),
    };
  }
  const HERO_BACK_TOP = [
    '....kkkk....',
    '...kssssk...',
    '...kssssk...',
    '...kssssk...',
    '....kddk....',
    '..kccccck...',
    '.kccccccck..',
    '.kccccccck..',
    '.kccccccck..',
    '..kcccccck..',
  ];
  const HERO_SETS = {
    knight: buildHero(),
    wizard: buildHero({ c: '#3a6ea8', s: '#7a72b8', d: '#4a4488', g: '#5aa2e8' }),
    necro: buildHero({ c: '#4a3a5a', s: '#8a8f80', d: '#565b48', g: '#7ec96f' }),
  };
  const TORCH = sprite(['..ww..', '.wggw.', '..gg..', '..bb..', '..bb..', '.kbbk.']);
  const MERCHANT = sprite([
    '....kkkk....',
    '...khhhhk...',
    '..khhhhhhk..',
    '..khkkkkhk..',
    '..khhhhhhk..',
    '..khhhhhhk..',
    '.khhhhhhhhk.',
    '.khhhhhhhhk.',
    '.khhghhghhk.',
    '.khhhhhhhhk.',
    '..kkkkkkkk..',
  ], { h: '#7a6a4a' });
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
  const MINION = sprite(SKEL_ROWS, { W: '#9fd8a8' });
  // necromancy keeps the victim's shape: same sprite, rotted zombie-green
  const zombieCache = {};
  function zombieSpr(type) {
    if (zombieCache[type]) return zombieCache[type];
    const src = ETYPES[type].spr;
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(112, 196, 122, 0.5)';
    g.fillRect(0, 0, c.width, c.height);
    zombieCache[type] = c;
    return c;
  }
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
  const BRUTE_ROWS = [
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
  ];
  const BRUTE = sprite(BRUTE_ROWS);
  const GOLEM = sprite(BRUTE_ROWS, { B: '#8a8f80' });
  const BAT = sprite([
    '.k......k.',
    'kdk....kdk',
    'kddk..kddk',
    'kdddkkdddk',
    '.kdbbbbdk.',
    '..kbEEbk..',
    '...kbbk...',
    '....kk....',
  ]);
  const SPIDER_ROWS = [
    '.k..k....k..k.',
    '..k.k.kk.k.k..',
    '...kkkkkkkk...',
    '..kkbbbbbbkk..',
    '.k.kbEbbEbk.k.',
    '...kbbbbbbk...',
    '..k.kbbbbk.k..',
    '..k..kkkk..k..',
    '.k..........k.',
  ];
  const SPIDER = sprite(SPIDER_ROWS);
  const BOSS_GUARDIAN = sprite(BRUTE_ROWS, { B: '#9a4030' });
  const BOSS_BROOD = sprite(SPIDER_ROWS, { b: '#5a3a7a', E: '#e8a33d' });
  const BOSS_BONEKING = sprite(SKEL_ROWS, { W: '#e8d48a' });
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
  const ICON_SHIELD = sprite([
    '.kkkkkkkk.',
    '.ksssssdk.',
    '.ksgssgdk.',
    '.ksssssdk.',
    '..ksssdk..',
    '...ksdk...',
    '....kk....',
  ]);
  const ICON_ARMOR = sprite([
    '.kk....kk.',
    '.kskkkksk.',
    '..kssssk..',
    '..ksddsk..',
    '..kssssk..',
    '..kkkkkk..',
  ]);
  const ICON_POTION = sprite([
    '....kk....',
    '....kk....',
    '...kmmk...',
    '..kmccmk..',
    '..kcccck..',
    '...kkkk...',
  ]);
  const ICON_DAGGER = sprite([
    '....ss....',
    '....ss....',
    '...gggg...',
    '....bb....',
  ]);
  const ICON_AXE = sprite([
    '..sss.....',
    '.sssss....',
    '..sssbb...',
    '.....bb...',
    '.....bb...',
    '.....bb...',
  ]);
  const ICON_SPEAR = sprite([
    '......ss..',
    '.....ss...',
    '....bb....',
    '...bb.....',
    '..bb......',
  ]);
  const ICON_HAMMER = sprite([
    '..ssss....',
    '..ssss....',
    '....bb....',
    '....bb....',
    '....bb....',
  ]);
  const ICONS = { sword: ICON_SWORD, shield: ICON_SHIELD, armor: ICON_ARMOR, potion: ICON_POTION };
  const WEAPON_ICONS = { dagger: ICON_DAGGER, sword: ICON_SWORD, axe: ICON_AXE, spear: ICON_SPEAR, hammer: ICON_HAMMER };
  function iconFor(it) {
    if (it.kind === 'sword') return WEAPON_ICONS[it.wtype] || ICON_SWORD;
    return ICONS[it.kind];
  }
  // weapon classes: same slot, very different handling
  const WTYPES = {
    dagger: { n: 'Dagger', dm: 0.6, cd: 0.19, range: 44, arc: 1.0,  knock: 0.7 },
    sword:  { n: 'Sword',  dm: 1,   cd: 0.34, range: 54, arc: 1.05, knock: 1 },
    axe:    { n: 'Axe',    dm: 1.5, cd: 0.5,  range: 50, arc: 1.4,  knock: 1.3 },
    spear:  { n: 'Spear',  dm: 1.1, cd: 0.38, range: 76, arc: 0.55, knock: 1 },
    hammer: { n: 'Hammer', dm: 1.9, cd: 0.62, range: 52, arc: 1.2,  knock: 2.2 },
  };
  const WTYPE_KEYS = Object.keys(WTYPES);

  // ---- items and rarity --------------------------------------------------
  const RARITIES = [
    { name: 'Common',     color: '#c8cdd7', mult: 1,    w: 100 },
    { name: 'Uncommon',   color: '#7ec96f', mult: 1.3,  w: 55 },
    { name: 'Rare',       color: '#5aa2e8', mult: 1.7,  w: 22 },
    { name: 'Epic',       color: '#b06ae0', mult: 2.2,  w: 8 },
    { name: 'Ultra Rare', color: '#e8a33d', mult: 3,    w: 2.5 },
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
  function rollBossRarity() {
    const ws = [46, 30, 14, 7, 3];
    let roll = Math.random() * 100;
    for (let i = 0; i < ws.length; i++) {
      roll -= ws[i];
      if (roll <= 0) return i;
    }
    return 0;
  }
  function statFor(kind, ri, floor) {
    const m = RARITIES[ri].mult;
    if (kind === 'sword') return Math.round((4 + floor * 1.3) * m);
    if (kind === 'armor') return Math.round((2 + floor * 0.8) * m);
    if (kind === 'shield') return Math.round((3 + floor * 0.9) * m);
    return Math.round(25 * m);
  }
  function makeItem(kind, floor, forceRi) {
    const ri = forceRi !== undefined ? forceRi : rollRarity(floor);
    const mat = MATS[Math.min(MATS.length - 1, Math.floor((floor - 1) / 2) + (ri >= 3 ? 1 : 0))];
    const v = statFor(kind, ri, floor);
    if (kind === 'sword') {
      const wtype = WTYPE_KEYS[Math.floor(Math.random() * WTYPE_KEYS.length)];
      const wt = WTYPES[wtype];
      return {
        kind, wtype, ri,
        dmg: Math.max(1, Math.round(v * wt.dm)),
        cd: wt.cd, range: wt.range, arc: wt.arc, knock: wt.knock,
        name: mat + ' ' + wt.n,
      };
    }
    if (kind === 'armor') return { kind, ri, def: v, name: mat + ' Armor' };
    if (kind === 'shield') return { kind, ri, blk: v, name: mat + ' Shield' };
    return { kind: 'potion', ri, heal: v, name: RARITIES[ri].name + ' Potion' };
  }
  function itemStat(it) {
    if (!it) return '';
    if (it.kind === 'sword') return it.dmg + ' dmg · ' + (1 / it.cd).toFixed(1) + ' swings/s';
    if (it.kind === 'armor') return it.def + ' armor';
    if (it.kind === 'shield') return it.blk + ' block';
    return '+' + it.heal + ' hp';
  }

  // ---- relics: stacking pickups, Isaac-style -----------------------------
  const RELICS = [
    { id: 'tome_bolt',   name: 'Tome of Embers',  desc: 'grants Firebolt [F] · stacks add bolts', color: '#e8763d', spell: 'bolt' },
    { id: 'frost_codex', name: 'Frost Codex',     desc: 'grants Frost Nova [F]',                  color: '#5aa2e8', spell: 'nova' },
    { id: 'whetstone',   name: 'Whetstone',       desc: '+3 damage',            color: '#c8cdd7', dmg: 3 },
    { id: 'giant_belt',  name: 'Giant Belt',      desc: '+25 max health',       color: '#7ec96f', maxHp: 25 },
    { id: 'swift_boots', name: 'Swift Boots',     desc: '+18% move speed',      color: '#7ec96f', spdMult: 1.18 },
    { id: 'vampire_fang', name: 'Vampire Fang',   desc: 'heal 2 on kill',       color: '#a4372e', lifesteal: 2 },
    { id: 'thorn_mail',  name: 'Thorn Mail',      desc: 'attackers take 4',     color: '#7ec96f', thorns: 4 },
    { id: 'mana_pearl',  name: 'Mana Pearl',      desc: '+30 max mana',         color: '#5aa2e8', manaMax: 30 },
    { id: 'soul_siphon', name: 'Soul Siphon',     desc: '+3 mana on kill',      color: '#5aa2e8', manaKill: 3 },
    { id: 'focus_crystal', name: 'Focus Crystal', desc: '+50% spell power',     color: '#b06ae0', spellMult: 1.5 },
    { id: 'deep_lantern', name: 'Deep Lantern',   desc: 'wider light',          color: '#e8a33d', light: 60 },
    { id: 'lucky_coin',  name: 'Lucky Coin',      desc: '+50% gold',            color: '#d9a94e', goldMult: 1.5 },
    { id: 'serpent_eye', name: 'Serpent Eye',     desc: '+15% crit (double hit)', color: '#b06ae0', crit: 0.15 },
    { id: 'swift_hilt',  name: 'Swift Hilt',      desc: '+30% attack speed',    color: '#c8cdd7', atkMult: 0.72 },
    { id: 'iron_skin',   name: 'Iron Skin',       desc: '+3 armor',             color: '#8a8f80', def: 3 },
    { id: 'wind_sigil',  name: 'Wind Sigil',      desc: '+4 mana regen',        color: '#5aa2e8', manaRegen: 4 },
    // curses trade something away
    { id: 'cursed_idol', name: 'Cursed Idol',     desc: '+6 damage, -20 max health', color: '#a4372e', dmg: 6, maxHp: -20, cursed: true },
    { id: 'heavy_crown', name: 'Heavy Crown',     desc: '+100% gold, -15% speed',    color: '#d9a94e', goldMult: 2, spdMult: 0.85, cursed: true },
    { id: 'dim_shard',   name: 'Dim Shard',       desc: '+5 armor, dimmer light',    color: '#8a8f80', def: 5, light: -50, cursed: true },
    { id: 'berserk_ring', name: 'Berserk Ring',   desc: '+1 dmg per 12 missing hp',  color: '#a4372e', berserk: true, cursed: true },
  ];
  function randomRelic() {
    return RELICS[Math.floor(Math.random() * RELICS.length)];
  }

  // ---- classes -----------------------------------------------------------
  const CLASSES = {
    knight: { name: 'KNIGHT', blurb: 'sword & board · 100 hp', hp: 100, mana: 50, regen: 5, spellMult: 1, melee: 3, color: '#a4372e' },
    wizard: { name: 'WIZARD', blurb: 'firebolt · 110 mana · frail', hp: 70, mana: 110, regen: 9, spellMult: 1.6, melee: 2, spell: 'bolt', color: '#5aa2e8' },
    necro: { name: 'NECROMANCER', blurb: 'raise the dead as thralls', hp: 80, mana: 90, regen: 7, spellMult: 1.2, melee: 2, spell: 'raise', color: '#7ec96f' },
  };
  const CLASS_KEYS = ['knight', 'wizard', 'necro'];

  // ---- enemy catalogue ---------------------------------------------------
  const ETYPES = {
    slime:      { spr: SLIME,    w: 26, h: 18, r: 11, spd: 52,  move: 'chase',   hp: f => 9 + f * 2,  dmg: f => 10 + f * 2,  gold: f => 3 + f },
    skeleton:   { spr: SKELETON, w: 24, h: 26, r: 10, spd: 88,  move: 'chase',   hp: f => 18 + f * 4, dmg: f => 14 + f * 3,  gold: f => 6 + f * 2 },
    wraith:     { spr: WRAITH,   w: 24, h: 26, r: 9,  spd: 132, move: 'chase',   hp: f => 12 + f * 3, dmg: f => 12 + f * 3,  gold: f => 8 + f * 2 },
    brute:      { spr: BRUTE,    w: 34, h: 30, r: 15, spd: 50,  move: 'chase',   hp: f => 45 + f * 9, dmg: f => 22 + f * 4,  gold: f => 16 + f * 4 },
    bat:        { spr: BAT,      w: 20, h: 16, r: 8,  spd: 150, move: 'erratic', hp: f => 6 + f,      dmg: f => 8 + f * 2,   gold: f => 4 + f },
    spider:     { spr: SPIDER,   w: 28, h: 18, r: 10, spd: 68,  move: 'lunge',   dash: 265, hp: f => 14 + f * 3, dmg: f => 14 + f * 3, gold: f => 9 + f * 2 },
    golem:      { spr: GOLEM,    w: 34, h: 30, r: 15, spd: 42,  move: 'chase',   dr: 3, hp: f => 55 + f * 10, dmg: f => 18 + f * 3, gold: f => 20 + f * 4 },
    spiderling: { spr: SPIDER,   w: 16, h: 11, r: 6,  spd: 125, move: 'chase',   hp: f => 5 + f,      dmg: f => 8 + f * 2,   gold: f => 2 + f },
    guardian:   { spr: BOSS_GUARDIAN, w: 56, h: 50, r: 24, spd: 72,  move: 'chase', gold: f => 60 + f * 20 },
    brood:      { spr: BOSS_BROOD,    w: 60, h: 40, r: 24, spd: 58,  move: 'chase', gold: f => 60 + f * 20 },
    boneking:   { spr: BOSS_BONEKING, w: 44, h: 50, r: 20, spd: 96,  move: 'lunge', dash: 300, gold: f => 60 + f * 20 },
  };
  const BOSS_KINDS = ['guardian', 'brood', 'boneking'];
  const BOSS_NAMES = { guardian: 'GUARDIAN', brood: 'BROODMOTHER', boneking: 'BONE KING' };
  function pickEnemyType(floor) {
    const pool = [
      ['slime', Math.max(8, 40 - floor * 6)],
      ['skeleton', 24 + floor * 4],
      ['bat', 12 + floor * 2],
      ['spider', 10 + floor * 3],
      ['wraith', floor >= 2 ? 10 + floor * 4 : 0],
      ['brute', floor >= 2 ? 6 + floor * 3 : 0],
      ['golem', floor >= 3 ? 5 + floor * 2 : 0],
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
    drops: [], pedestals: [], bolts: [], corpses: [], allies: [],
    spikes: [], spikeSet: new Set(), braziers: [], wares: [],
    cls: null, clsBtns: [], sealedRoom: null, curRoom: null,
    stairs: { x: 0, y: 0 },
    hero: { x: 0, y: 0, face: 1, moving: false, hp: 100, maxHp: 100, gold: 0 },
    mana: 50,
    relics: [],
    st: null, // derived stats, recalc()'d
    aim: 0, block: false,
    equip: { sword: null, shield: null, armor: null },
    bag: new Array(16).fill(null),
    hotbar: new Array(4).fill(null),
    inv: false, invMx: 0, invMy: 0,
    lootChest: null, drag: null,
    bossDoors: [], stairsLocked: true, stairMsgT: 0,
    atkT: 0, atkAnim: 0, atkDir: 0,
    hurtT: 0, spawnT: 18,
    floats: [], msgs: [],
    cam: { x: 0, y: 0 },
    floor: 1, t: 0, shake: 0,
  };
  const keys = {};
  const idx = (x, y) => y * MW + x;
  // tile values: 0 wall, 1 floor, 2 closed boss door (solid)
  const solid = (x, y) => x < 0 || y < 0 || x >= MW || y >= MH || D.tiles[idx(x, y)] !== 1;
  const hash = (x, y) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >> 13)) * 1274126177;
    return ((h ^ (h >> 16)) >>> 0) % 1000;
  };
  const angDiff = (a, b) => {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };
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
  function los(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(d / 12));
    for (let i = 1; i < steps; i++) {
      const px = x0 + ((x1 - x0) * i) / steps;
      const py = y0 + ((y1 - y0) * i) / steps;
      if (solid(Math.floor(px / TILE), Math.floor(py / TILE))) return false;
    }
    return true;
  }

  // ---- derived stats: base + equipment + every relic stacked -------------
  function recalc() {
    const cls = CLASSES[D.cls || 'knight'];
    const st = {
      dmg: D.equip.sword ? D.equip.sword.dmg : cls.melee,
      def: D.equip.armor ? D.equip.armor.def : 0,
      blk: D.equip.shield ? D.equip.shield.blk : 0,
      maxHp: cls.hp, spd: 165,
      atkCd: D.equip.sword ? D.equip.sword.cd : 0.34,
      range: D.equip.sword ? D.equip.sword.range : 46,
      arc: D.equip.sword ? D.equip.sword.arc : 1.05,
      knock: D.equip.sword ? D.equip.sword.knock : 1,
      manaMax: cls.mana, manaRegen: cls.regen, spellMult: cls.spellMult,
      light: 205, goldMult: 1, crit: 0,
      lifesteal: 0, thorns: 0, manaKill: 0,
      spells: cls.spell ? [cls.spell] : [], berserk: 0,
    };
    for (const r of D.relics) {
      if (r.dmg) st.dmg += r.dmg;
      if (r.def) st.def += r.def;
      if (r.maxHp) st.maxHp += r.maxHp;
      if (r.spdMult) st.spd *= r.spdMult;
      if (r.atkMult) st.atkCd *= r.atkMult;
      if (r.manaMax) st.manaMax += r.manaMax;
      if (r.manaRegen) st.manaRegen += r.manaRegen;
      if (r.spellMult) st.spellMult *= r.spellMult;
      if (r.light) st.light += r.light;
      if (r.goldMult) st.goldMult *= r.goldMult;
      if (r.crit) st.crit += r.crit;
      if (r.lifesteal) st.lifesteal += r.lifesteal;
      if (r.thorns) st.thorns += r.thorns;
      if (r.manaKill) st.manaKill += r.manaKill;
      if (r.berserk) st.berserk += 1;
      if (r.spell && !st.spells.includes(r.spell)) st.spells.push(r.spell);
    }
    st.maxHp = Math.max(20, st.maxHp);
    st.light = Math.max(110, st.light);
    st.bolts = 1 + D.relics.filter(r => r.spell === 'bolt').length - (st.spells.includes('bolt') ? 1 : 0);
    D.st = st;
    D.hero.maxHp = st.maxHp;
    D.hero.hp = Math.min(D.hero.hp, st.maxHp);
    D.mana = Math.min(D.mana, st.manaMax);
  }
  function heroDmg() {
    let v = D.st.dmg;
    if (D.st.berserk) v += D.st.berserk * Math.floor((D.hero.maxHp - D.hero.hp) / 12);
    return v;
  }
  function gainGold(n, x, y) {
    const g = Math.round(n * D.st.goldMult);
    D.hero.gold += g;
    floatText(x, y, '+' + g + 'g', '#d9a94e');
  }
  function gainRelic(relic, quiet) {
    D.relics.push(relic);
    recalc();
    if (relic.maxHp > 0) D.hero.hp = Math.min(D.hero.maxHp, D.hero.hp + relic.maxHp);
    if (!quiet) {
      say(relic.name + ' — ' + relic.desc, relic.cursed ? '#a4372e' : relic.color);
      A.sweep(300, 900, 0.5, 'sine', 0.05);
    }
  }
  // raise dead lives on its own key [E]; F cycles to the newest other spell
  const knowsRaise = () => D.st.spells.includes('raise');
  const activeSpell = () => {
    const others = D.st.spells.filter(s => s !== 'raise');
    return others.length ? others[others.length - 1] : null;
  };

  // ---- generation: Isaac-style room grid ---------------------------------
  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function tryLayout() {
    const startG = { gx: 2, gy: 1 };
    const key = (gx, gy) => gx + ',' + gy;
    const placed = new Set([key(startG.gx, startG.gy)]);
    const target = Math.min(GW * GH, 8 + Math.min(6, D.floor) + Math.floor(Math.random() * 2));
    let frontier = [startG];
    let guard = 0;
    while (frontier.length && placed.size < target && guard++ < 500) {
      const cell = frontier.splice(Math.floor(Math.random() * frontier.length), 1)[0];
      const dirs = DIRS4.slice().sort(() => Math.random() - 0.5);
      let expanded = false;
      for (const [dx, dy] of dirs) {
        if (placed.size >= target) break;
        const nx = cell.gx + dx, ny = cell.gy + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        if (placed.has(key(nx, ny))) continue;
        // Isaac's crowding rule: a new room may touch at most one existing
        // room, which keeps the layout branchy instead of a blob
        let adj = 0;
        for (const [ax, ay] of DIRS4) if (placed.has(key(nx + ax, ny + ay))) adj++;
        if (adj > 1) continue;
        if (Math.random() < 0.4) continue; // sometimes just decline
        placed.add(key(nx, ny));
        frontier.push({ gx: nx, gy: ny });
        expanded = true;
      }
      if (expanded) frontier.push(cell);
    }
    if (placed.size < 7) return null;
    const cells = [...placed].map(s => {
      const [gx, gy] = s.split(',').map(Number);
      return { gx, gy };
    });
    const nbrCount = c => DIRS4.filter(([dx, dy]) => placed.has(key(c.gx + dx, c.gy + dy))).length;
    // BFS distance from start over placed cells
    const dist = { [key(startG.gx, startG.gy)]: 0 };
    const q = [startG];
    while (q.length) {
      const c = q.shift();
      for (const [dx, dy] of DIRS4) {
        const k2 = key(c.gx + dx, c.gy + dy);
        if (placed.has(k2) && dist[k2] === undefined) {
          dist[k2] = dist[key(c.gx, c.gy)] + 1;
          q.push({ gx: c.gx + dx, gy: c.gy + dy });
        }
      }
    }
    const deadEnds = cells.filter(c =>
      nbrCount(c) === 1 && !(c.gx === startG.gx && c.gy === startG.gy));
    if (deadEnds.length < 2) return null;
    deadEnds.sort((a, b) => dist[key(b.gx, b.gy)] - dist[key(a.gx, a.gy)]);
    const bossCell = deadEnds[0];
    const rest = deadEnds.slice(1).sort(() => Math.random() - 0.5);
    const treasureCell = rest[0];
    const shopCell = rest[1] || null; // most floors have one; some don't
    return { placed, cells, startG, bossCell, treasureCell, shopCell, key };
  }
  function roomRect(gx, gy) {
    return { x: gx * CW + 1, y: gy * CH + 1, w: CW - 1, h: CH - 1 };
  }
  // Isaac-style room furniture: 9x7 stamps. R rock (solid), S spikes
  // (floor hazard), B brazier (solid, burns, smashable). Edges stay clear
  // so door mouths are never blocked.
  const ROOM_PATTERNS = [
    [
      '.........',
      '..R...R..',
      '.........',
      '....B....',
      '.........',
      '..R...R..',
      '.........',
    ],
    [
      '.........',
      '.........',
      '...RRR...',
      '...R.R...',
      '...RRR...',
      '.........',
      '.........',
    ],
    [
      '.........',
      '.S.....S.',
      '.........',
      '.R..S..R.',
      '.........',
      '.S.....S.',
      '.........',
    ],
    [
      '.........',
      '..B...B..',
      '.........',
      '.........',
      '.........',
      '..B...B..',
      '.........',
    ],
    [
      '.........',
      '.RR...RR.',
      '.R.....R.',
      '.........',
      '.R.....R.',
      '.RR...RR.',
      '.........',
    ],
    [
      '.........',
      '.........',
      '..S.S.S..',
      '.........',
      '..S.S.S..',
      '.........',
      '.........',
    ],
    [
      '.........',
      '....R....',
      '....R....',
      '.RR.B.RR.',
      '....R....',
      '....R....',
      '.........',
    ],
    [
      '.........',
      '..R......',
      '...R.....',
      '....R....',
      '.....R...',
      '......R..',
      '.........',
    ],
    [
      '.........',
      '.R..S..R.',
      '.........',
      '.B.....B.',
      '.........',
      '.R..S..R.',
      '.........',
    ],
  ];
  function decorateRooms() {
    for (const r of D.rooms) {
      if (r.type !== 'normal') continue;
      if (Math.random() < 0.3) continue; // some rooms stay bare
      const pat = ROOM_PATTERNS[Math.floor(Math.random() * ROOM_PATTERNS.length)];
      for (let py = 0; py < 7 && py < r.h; py++) {
        for (let px = 0; px < 9 && px < r.w; px++) {
          const ch = pat[py][px];
          if (ch === '.') continue;
          const tx = r.x + px, ty = r.y + py;
          if (ch === 'R') D.tiles[idx(tx, ty)] = 3;
          else if (ch === 'B') { D.tiles[idx(tx, ty)] = 4; D.braziers.push({ x: tx, y: ty }); }
          else if (ch === 'S') { D.spikes.push({ x: tx, y: ty }); D.spikeSet.add(idx(tx, ty)); }
        }
      }
    }
  }
  function generate() {
    let L = null;
    for (let i = 0; i < 40 && !L; i++) L = tryLayout();
    if (!L) L = tryLayout() || { placed: new Set(['2,1']), cells: [{ gx: 2, gy: 1 }], startG: { gx: 2, gy: 1 }, bossCell: { gx: 2, gy: 1 }, treasureCell: { gx: 2, gy: 1 }, key: (a, b) => a + ',' + b };
    D.tiles = new Uint8Array(MW * MH);
    D.seen = new Uint8Array(MW * MH);
    D.rooms = []; D.torches = []; D.chests = []; D.enemies = [];
    D.drops = []; D.pedestals = []; D.bolts = []; D.corpses = []; D.allies = [];
    D.spikes = []; D.spikeSet = new Set(); D.braziers = []; D.wares = [];
    D.bossDoors = []; D.stairsLocked = true; D.sealedRoom = null;
    D.floats.length = 0;
    // carve room interiors
    for (const c of L.cells) {
      const r = roomRect(c.gx, c.gy);
      const type =
        c.gx === L.startG.gx && c.gy === L.startG.gy ? 'start' :
        c.gx === L.bossCell.gx && c.gy === L.bossCell.gy ? 'boss' :
        c.gx === L.treasureCell.gx && c.gy === L.treasureCell.gy ? 'treasure' :
        L.shopCell && c.gx === L.shopCell.gx && c.gy === L.shopCell.gy ? 'shop' : 'normal';
      D.rooms.push({ ...r, gx: c.gx, gy: c.gy, cx: r.x + Math.floor(r.w / 2), cy: r.y + Math.floor(r.h / 2), type });
      for (let ty = r.y; ty < r.y + r.h; ty++) {
        for (let tx = r.x; tx < r.x + r.w; tx++) D.tiles[idx(tx, ty)] = 1;
      }
    }
    // doors between every pair of adjacent placed rooms
    for (const c of L.cells) {
      const r = roomRect(c.gx, c.gy);
      if (L.placed.has(L.key(c.gx + 1, c.gy))) {
        const wallX = (c.gx + 1) * CW;
        const my = r.y + 2;
        for (let y = my; y < my + 3; y++) D.tiles[idx(wallX, y)] = 1;
      }
      if (L.placed.has(L.key(c.gx, c.gy + 1))) {
        const wallY = (c.gy + 1) * CH;
        const mx = r.x + 3;
        for (let x = mx; x < mx + 3; x++) D.tiles[idx(x, wallY)] = 1;
      }
    }
    decorateRooms();
    // torches on south-facing wall faces
    for (let y = 0; y < MH - 1; y++) {
      for (let x = 0; x < MW; x++) {
        if (D.tiles[idx(x, y)] === 0 && D.tiles[idx(x, y + 1)] === 1 && hash(x, y) % 5 === 0) {
          D.torches.push({ x, y, ph: (hash(x, y) % 100) / 16 });
        }
      }
    }
    const startRoom = D.rooms.find(r => r.type === 'start');
    const bossRoom = D.rooms.find(r => r.type === 'boss');
    const treasureRoom = D.rooms.find(r => r.type === 'treasure');
    D.hero.x = (startRoom.cx + 0.5) * TILE;
    D.hero.y = (startRoom.cy + 0.5) * TILE;
    D.stairs = { x: bossRoom.cx, y: bossRoom.cy };
    // boss guards the stairs room: a long fight that hits like a truck.
    // It waits at the interior spot farthest from every doorway.
    const bossHp = Math.round(240 + (D.floor - 1) * 110 + heroDmgSafe() * 8);
    let bposX = bossRoom.cx, bposY = bossRoom.cy, bScore = -1;
    const bdoors = doorTilesOf(bossRoom);
    for (let ty = bossRoom.y + 1; ty < bossRoom.y + bossRoom.h - 1; ty++) {
      for (let tx = bossRoom.x + 1; tx < bossRoom.x + bossRoom.w - 1; tx++) {
        if (D.tiles[idx(tx, ty)] !== 1) continue;
        if (tx === bossRoom.cx && ty === bossRoom.cy) continue; // stairs live here
        let sMin = Infinity;
        for (const dv of bdoors) sMin = Math.min(sMin, Math.hypot(dv.x - tx, dv.y - ty));
        if (sMin > bScore) { bScore = sMin; bposX = tx; bposY = ty; }
      }
    }
    D.enemies.push({
      type: BOSS_KINDS[Math.floor(Math.random() * BOSS_KINDS.length)],
      isBoss: true, room: bossRoom, homeRoom: bossRoom,
      x: (bposX + 0.5) * TILE, y: (bposY + 0.5) * TILE,
      hp: bossHp, maxHp: bossHp,
      dmgv: 25 + D.floor * 4,
      cd: 0, wanderT: 0, wx: 0, wy: 0, face: 1, fa: Math.PI / 2, hurt: 0, aggro: false,
      broodT: 5,
    });
    // treasure room holds a pedestal relic
    D.pedestals.push({
      x: treasureRoom.cx, y: treasureRoom.cy,
      relic: randomRelic(), taken: false,
    });
    // the shop stocks a potion, a piece of gear, and a relic — for a price
    const shopRoom = D.rooms.find(r => r.type === 'shop');
    if (shopRoom) {
      const potion = makeItem('potion', D.floor);
      const gearKinds = ['sword', 'armor', 'shield'];
      const gear = makeItem(gearKinds[Math.floor(Math.random() * gearKinds.length)], D.floor + 1);
      const relic = randomRelic();
      D.wares.push(
        { x: shopRoom.cx - 2, y: shopRoom.cy, it: potion, price: 12 + D.floor * 3, sold: false, msgT: 0 },
        { x: shopRoom.cx, y: shopRoom.cy, it: gear, price: Math.round((18 + D.floor * 5) * RARITIES[gear.ri].mult), sold: false, msgT: 0 },
        { x: shopRoom.cx + 2, y: shopRoom.cy, relic, price: relic.cursed ? 45 + D.floor * 8 : 65 + D.floor * 12, sold: false, msgT: 0 },
      );
      shopRoom.merchant = { x: shopRoom.cx, y: shopRoom.cy - 2 };
    }
    // floor 1: pick your starting weapon — three pedestals, take one
    if (D.floor === 1) {
      const picks = WTYPE_KEYS.slice().sort(() => Math.random() - 0.5).slice(0, 3);
      picks.forEach((wt, i) => {
        const it = makeItem('sword', 1, 0);
        const prof = WTYPES[wt];
        it.wtype = wt;
        it.dmg = Math.max(1, Math.round(statFor('sword', 0, 1) * prof.dm));
        it.cd = prof.cd; it.range = prof.range; it.arc = prof.arc; it.knock = prof.knock;
        it.name = MATS[0] + ' ' + prof.n;
        D.pedestals.push({
          x: startRoom.cx - 2 + i * 2, y: startRoom.cy - 2,
          it, taken: false, group: 'startWeapon',
        });
      });
    }
    // chests + enemies fill the normal rooms
    const normals = D.rooms.filter(r => r.type === 'normal');
    const nChests = Math.min(normals.length, 2 + Math.floor(Math.random() * 2));
    const shuffled = normals.slice().sort(() => Math.random() - 0.5);
    for (let i = 0; i < nChests; i++) {
      const r = shuffled[i];
      const cx2 = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
      const cy2 = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
      if (D.tiles[idx(cx2, cy2)] !== 1 || D.spikeSet.has(idx(cx2, cy2))) continue;
      const ri = rollRarity(D.floor);
      const items = new Array(4).fill(null);
      const nItems = 2 + Math.floor(Math.random() * 3);
      const kinds = ['potion', 'potion', 'sword', 'armor', 'shield'];
      for (let j = 0; j < nItems; j++) {
        items[j] = makeItem(kinds[Math.floor(Math.random() * kinds.length)], D.floor,
          Math.max(rollRarity(D.floor), ri));
      }
      D.chests.push({
        x: cx2, y: cy2, ri, opened: false, cool: 0, items,
        gold: Math.round((8 + D.floor * 5) * RARITIES[ri].mult),
      });
    }
    const n = 5 + D.floor * 2;
    for (let i = 0; i < n; i++) spawnEnemy(true);
    D.curRoom = startRoom;
    startRoom.visited = true;
    revealRoom(startRoom);
    D.cam.x = (startRoom.x + startRoom.w / 2) * TILE;
    D.cam.y = (startRoom.y + startRoom.h / 2) * TILE;
  }
  function heroDmgSafe() {
    return D.st ? heroDmg() : 3;
  }
  function spawnEnemy(anywhere) {
    const normals = D.rooms.filter(r => r.type === 'normal');
    if (!normals.length) return;
    for (let tries = 0; tries < 60; tries++) {
      const r = normals[Math.floor(Math.random() * normals.length)];
      const x = r.x + Math.floor(Math.random() * r.w);
      const y = r.y + Math.floor(Math.random() * r.h);
      if (D.tiles[idx(x, y)] !== 1) continue;
      // never posted near a doorway — the player gets breathing room
      if (doorTilesOf(r).some(dv => Math.hypot(dv.x - x, dv.y - y) < 3)) continue;
      const px = (x + 0.5) * TILE, py = (y + 0.5) * TILE;
      if (Math.hypot(px - D.hero.x, py - D.hero.y) < TILE * 6) continue;
      if (!anywhere && D.seen[idx(x, y)]) continue;
      const type = pickEnemyType(D.floor);
      const et = ETYPES[type];
      D.enemies.push({
        type, x: px, y: py, homeRoom: r,
        hp: et.hp(D.floor), maxHp: et.hp(D.floor),
        cd: 0, wanderT: 0, wx: 0, wy: 0, face: 1,
        fa: Math.random() * Math.PI * 2, hurt: 0, aggro: false,
      });
      return;
    }
  }

  // ---- room lockdown -----------------------------------------------------
  function sealRoom(room) {
    D.sealedRoom = room;
    D.bossDoors = [];
    const tryDoor = (x, y) => {
      if (x < 0 || y < 0 || x >= MW || y >= MH) return;
      if (D.tiles[idx(x, y)] === 1) {
        D.tiles[idx(x, y)] = 2;
        D.bossDoors.push({ x, y });
      }
    };
    for (let x = room.x - 1; x <= room.x + room.w; x++) {
      tryDoor(x, room.y - 1);
      tryDoor(x, room.y + room.h);
    }
    for (let y = room.y - 1; y <= room.y + room.h; y++) {
      tryDoor(room.x - 1, y);
      tryDoor(room.x + room.w, y);
    }
    if (collide(D.hero.x, D.hero.y, HERO_R)) {
      const cx3 = (room.x + room.w / 2) * TILE, cy3 = (room.y + room.h / 2) * TILE;
      const a = Math.atan2(cy3 - D.hero.y, cx3 - D.hero.x);
      for (let step = 4; step < 220; step += 4) {
        const nx = D.hero.x + Math.cos(a) * step, ny = D.hero.y + Math.sin(a) * step;
        if (!collide(nx, ny, HERO_R)) { D.hero.x = nx; D.hero.y = ny; break; }
      }
    }
    A.sweep(200, 50, 0.5, 'sawtooth', 0.07);
    say('The doors slam shut!', '#a4372e');
    // everything living in this room wakes at once
    for (const en of D.enemies) {
      if (en.homeRoom === room && !en.aggro) {
        en.aggro = true;
        floatText(en.x, en.y - 22, '!', '#e8a33d');
      }
    }
  }
  function openSeal(unlockStairs) {
    for (const dr of D.bossDoors) D.tiles[idx(dr.x, dr.y)] = 1;
    D.bossDoors = [];
    if (D.sealedRoom) D.sealedRoom.cleared = true;
    D.sealedRoom = null;
    if (unlockStairs) {
      D.stairsLocked = false;
      say('The doors grind open — the way down is unsealed', '#7ec96f');
    } else {
      say('Room cleared — the doors release', '#7ec96f');
    }
    A.sweep(80, 300, 0.7, 'sine', 0.06);
  }

  // one room at a time: entering reveals the whole room, Isaac-style
  // every doorway tile on a room's wall ring
  function doorTilesOf(r) {
    if (r.doors) return r.doors;
    const out = [];
    const check = (x, y) => {
      if (x >= 0 && y >= 0 && x < MW && y < MH && D.tiles[idx(x, y)] !== 0) out.push({ x, y });
    };
    for (let x = r.x - 1; x <= r.x + r.w; x++) { check(x, r.y - 1); check(x, r.y + r.h); }
    for (let y = r.y - 1; y <= r.y + r.h; y++) { check(r.x - 1, y); check(r.x + r.w, y); }
    r.doors = out;
    return out;
  }
  function roomAt(tx, ty) {
    for (const r of D.rooms) {
      if (tx >= r.x && tx < r.x + r.w && ty >= r.y && ty < r.y + r.h) return r;
    }
    return null;
  }
  function revealRoom(r) {
    for (let y = Math.max(0, r.y - 1); y <= Math.min(MH - 1, r.y + r.h); y++) {
      for (let x = Math.max(0, r.x - 1); x <= Math.min(MW - 1, r.x + r.w); x++) {
        D.seen[idx(x, y)] = 1;
      }
    }
  }
  function enterRoom(nr) {
    D.curRoom = nr;
    nr.visited = true;
    revealRoom(nr);
    // thralls squeeze through with you, re-forming deeper in the room so
    // none of them are left wedged in the doorway
    const rcx = (nr.x + nr.w / 2) * TILE, rcy = (nr.y + nr.h / 2) * TILE;
    const inAng = Math.atan2(rcy - D.hero.y, rcx - D.hero.x);
    for (const al of D.allies) {
      al.x = D.hero.x + Math.cos(inAng) * 52 + (Math.random() - 0.5) * 28;
      al.y = D.hero.y + Math.sin(inAng) * 52 + (Math.random() - 0.5) * 28;
      // clamp into the room interior — never the door band
      al.x = Math.max((nr.x + 0.4) * TILE, Math.min((nr.x + nr.w - 0.4) * TILE, al.x));
      al.y = Math.max((nr.y + 0.4) * TILE, Math.min((nr.y + nr.h - 0.4) * TILE, al.y));
      unstick(al, 8);
    }
    if (!nr.cleared && nr.type !== 'start' && nr.type !== 'treasure' && nr.type !== 'shop') {
      if (D.enemies.some(en => en.homeRoom === nr)) {
        sealRoom(nr);
        if (nr.type === 'boss') {
          say('The floor guardian stirs…', '#a4372e');
          A.sweep(120, 45, 0.6, 'sawtooth', 0.08);
        }
      } else {
        nr.cleared = true;
      }
    }
  }

  // ---- flow --------------------------------------------------------------
  function prime() {
    D.floor = 1; D.t = 0;
    D.hero.hp = 100; D.hero.gold = 0;
    D.relics = [];
    D.equip.sword = null; D.equip.shield = null; D.equip.armor = null;
    D.bag.fill(null); D.hotbar.fill(null);
    D.hotbar[0] = { kind: 'potion', ri: 0, heal: 25, name: 'Common Potion' };
    D.inv = false; D.over = false; D.block = false;
    D.lootChest = null; D.drag = null;
    D.msgs.length = 0;
    recalc();
    D.mana = D.st.manaMax;
    generate();
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
    stageEl.classList.remove('freecursor');
    ARCADE_LOCK.unlock();
    A.setStyle('neon');
    A.resume();
    pauseEl.classList.add('hidden');
    launchEl.classList.remove('hidden');
    window.MODE = 'menu';
  }
  // one source of truth for the menu pointer: if the pointer lock is
  // somehow still held, use the delta-tracked virtual cursor; otherwise
  // the real mouse position
  function invPos() {
    if (ARCADE_LOCK.locked()) return { x: ARCADE_LOCK.cur.x, y: ARCADE_LOCK.cur.y };
    return { x: D.invMx, y: D.invMy };
  }
  function toggleInv() {
    if (!D.running) return;
    D.inv = !D.inv;
    D.drag = null;
    if (D.inv) { D.invMx = ARCADE_LOCK.cur.x; D.invMy = ARCADE_LOCK.cur.y; }
    if (!D.inv && D.lootChest) {
      D.lootChest.cool = 1.1;
      D.lootChest = null;
    }
    if (D.inv) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
  }
  function descend() {
    D.floor++;
    D.hero.hp = Math.min(D.hero.maxHp, D.hero.hp + 15);
    say('FLOOR ' + D.floor, '#d9a94e');
    A.sweep(400, 60, 0.5, 'sine', 0.06);
    generate();
  }

  document.getElementById('pickDungeon').addEventListener('click', () => {
    window.MODE = 'dungeon';
    A.setStyle('medieval');
    launchEl.classList.add('hidden');
    prime();
  });
  addEventListener('contextmenu', e => { if (window.MODE === 'dungeon') e.preventDefault(); });
  addEventListener('keydown', e => {
    if (window.MODE !== 'dungeon') return;
    if (e.key === 'Escape') {
      if (D.inv) { toggleInv(); return; }
      togglePause();
      return;
    }
    if ((e.key === 'q' || e.key === 'Q') && (D.paused || !D.running)) { quitToMenu(); return; }
    if (e.key === 'Enter' && !D.running && !D.paused) {
      if (D.over) { D.over = false; return; }
      D.cls = D.cls || 'knight';
      start();
      return;
    }
    if (!D.running && !D.over && !D.paused && ['1', '2', '3'].includes(e.key)) {
      D.cls = CLASS_KEYS[+e.key - 1];
      start();
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); toggleInv(); return; }
    if (D.running && !D.paused && !D.inv && ['1', '2', '3', '4'].includes(e.key)) {
      useHotbar(+e.key - 1);
    }
    if ((e.key === 'f' || e.key === 'F') && D.running && !D.paused && !D.inv) {
      castSpell();
      return;
    }
    if ((e.key === 'e' || e.key === 'E') && D.running && !D.paused && !D.inv) {
      castRaise();
      return;
    }
    if (e.key === ' ' && D.running && !D.paused && !D.inv) {
      attack();
      e.preventDefault();
      return;
    }
    keys[e.key.toLowerCase()] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  addEventListener('pointermove', e => {
    if (window.MODE === 'dungeon' && !D.running && !ARCADE_LOCK.locked()) {
      D.invMx = e.clientX; D.invMy = e.clientY;
    }
    if (window.MODE === 'dungeon' && D.inv) {
      if (!ARCADE_LOCK.locked()) { D.invMx = e.clientX; D.invMy = e.clientY; }
      const p = invPos();
      if (D.drag && Math.hypot(p.x - D.drag.sx, p.y - D.drag.sy) > 6) D.drag.moved = true;
    }
  });
  addEventListener('pointerdown', e => {
    if (window.MODE !== 'dungeon') return;
    if (D.paused) { togglePause(); return; }
    if (D.inv) {
      if (e.button !== 0) return;
      if (!ARCADE_LOCK.locked()) { D.invMx = e.clientX; D.invMy = e.clientY; }
      const p = invPos();
      const s = slotAt(p.x, p.y);
      if (s && s.type !== 'takeall' && getSlot(s)) {
        D.drag = { from: s, sx: p.x, sy: p.y, moved: false };
      } else if (s) {
        clickSlot(s);
      }
      return;
    }
    if (!D.running) {
      if (D.over) { D.over = false; return; } // back to class select
      for (const b of D.clsBtns) {
        if (e.clientX >= b.x && e.clientX <= b.x + b.w && e.clientY >= b.y && e.clientY <= b.y + b.h) {
          D.cls = b.cls;
          start();
          return;
        }
      }
      return;
    }
    if (e.button === 0) attack();
    if (e.button === 2 && D.equip.shield) D.block = true;
  });
  addEventListener('pointerup', e => {
    if (e.button === 2) D.block = false;
    if (window.MODE !== 'dungeon' || !D.inv || !D.drag || e.button !== 0) return;
    const drag = D.drag;
    D.drag = null;
    if (!drag.moved) { clickSlot(drag.from); return; }
    const p = invPos();
    const target = slotAt(p.x, p.y);
    if (target) { dropItem(drag.from, target); return; }
    const L = invLayout();
    const inPanel = p.x >= L.px && p.x <= L.px + L.pw &&
      p.y >= (D.lootChest ? L.py - 108 : L.py) && p.y <= L.py + L.ph;
    if (inPanel) return;
    const it = getSlot(drag.from);
    if (!it) return;
    setSlot(drag.from, null);
    let dx2 = D.hero.x + Math.cos(D.aim) * 34, dy2 = D.hero.y + Math.sin(D.aim) * 34;
    if (collide(dx2, dy2, 6)) { dx2 = D.hero.x; dy2 = D.hero.y; }
    D.drops.push({ x: dx2, y: dy2, it, cool: 1.4 });
    say('Dropped ' + it.name);
    A.bleep(300, 0.05, 'triangle', 0.03);
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

  // ---- combat + magic ----------------------------------------------------
  function attack() {
    if (D.atkT > 0 || D.block) return;
    const dir = D.aim;
    D.atkT = D.st.atkCd;
    D.atkAnim = 0.16;
    D.atkDir = dir;
    A.bleep(340, 0.05, 'square', 0.03);
    for (const en of D.enemies) {
      const dx = en.x - D.hero.x, dy = en.y - D.hero.y;
      const d = Math.hypot(dx, dy);
      if (d > D.st.range + ETYPES[en.type].r) continue;
      if (Math.abs(angDiff(Math.atan2(dy, dx), dir)) > D.st.arc) continue;
      const crit = Math.random() < D.st.crit;
      const dmg = Math.max(1, Math.round((heroDmg() + Math.floor(Math.random() * 3)) * (crit ? 2 : 1)) - (ETYPES[en.type].dr || 0));
      damageEnemy(en, dmg, crit);
      const nd = d || 1;
      nudge(en, (dx / nd) * 16 * D.st.knock, (dy / nd) * 16 * D.st.knock, ETYPES[en.type].r);
    }
    // braziers shatter under a swing
    for (let i = D.braziers.length - 1; i >= 0; i--) {
      const bz = D.braziers[i];
      const bx3 = (bz.x + 0.5) * TILE, by3 = (bz.y + 0.5) * TILE;
      const dx = bx3 - D.hero.x, dy = by3 - D.hero.y;
      const d = Math.hypot(dx, dy);
      if (d > D.st.range + 18) continue;
      if (Math.abs(angDiff(Math.atan2(dy, dx), dir)) > D.st.arc) continue;
      D.tiles[idx(bz.x, bz.y)] = 1;
      D.braziers.splice(i, 1);
      floatText(bx3, by3 - 12, 'smash', '#e8a33d');
      if (Math.random() < 0.15) D.drops.push({ x: bx3, y: by3, it: makeItem('potion', D.floor) });
      A.bleep(150, 0.1, 'square', 0.05);
    }
  }
  function damageEnemy(en, dmg, crit) {
    en.hp -= dmg;
    en.hurt = 0.18;
    en.aggro = true;
    floatText(en.x, en.y - 20, '' + dmg + (crit ? '!' : ''), crit ? '#e8a33d' : '#e8e0c8');
    A.bleep(220 + Math.random() * 120, 0.06, 'sawtooth', 0.035);
    if (en.hp <= 0) killEnemy(en);
  }
  function castSpell() {
    const sp = activeSpell();
    if (!sp) { say('No spell learned — find a tome', '#8a8f80'); return; }
    if (sp === 'bolt') {
      if (D.mana < 12) { say('Not enough mana', '#5aa2e8'); return; }
      D.mana -= 12;
      const n = Math.max(1, D.st.bolts);
      for (let i = 0; i < n; i++) {
        const spread = n > 1 ? (i - (n - 1) / 2) * 0.16 : 0;
        const a = D.aim + spread;
        D.bolts.push({
          x: D.hero.x + Math.cos(a) * 14, y: D.hero.y + Math.sin(a) * 14,
          vx: Math.cos(a) * 380, vy: Math.sin(a) * 380,
          dmg: Math.round((9 + D.floor * 2) * D.st.spellMult), t: 1.6,
        });
      }
      A.bleep(700, 0.07, 'square', 0.045);
    } else if (sp === 'nova') {
      if (D.mana < 22) { say('Not enough mana', '#5aa2e8'); return; }
      D.mana -= 22;
      const R2 = 130;
      for (const en of D.enemies) {
        const d = Math.hypot(en.x - D.hero.x, en.y - D.hero.y);
        if (d > R2 + ETYPES[en.type].r) continue;
        damageEnemy(en, Math.max(1, Math.round((7 + D.floor * 2) * D.st.spellMult)), false);
        en.slow = 2.2;
      }
      D.novaT = 0.3;
      A.sweep(900, 90, 0.4, 'sine', 0.07);
    }
  }
  function castRaise() {
    if (!knowsRaise()) return;
    if (D.allies.length >= 4) { say('Your host is full', '#9fd8a8'); return; }
    if (D.mana < 20) { say('Not enough mana', '#5aa2e8'); return; }
    let best = -1, bd = 150;
    for (let i = 0; i < D.corpses.length; i++) {
      const dd = Math.hypot(D.corpses[i].x - D.hero.x, D.corpses[i].y - D.hero.y);
      if (dd < bd) { bd = dd; best = i; }
    }
    if (best < 0) { say('No corpse near enough to raise', '#9fd8a8'); return; }
    D.mana -= 20;
    const c = D.corpses.splice(best, 1)[0];
    D.allies.push({ x: c.x, y: c.y, ttl: 30, cd: 0, face: c.face || 1, type: c.type });
    floatText(c.x, c.y - 18, 'RISE', '#9fd8a8');
    A.sweep(100, 400, 0.5, 'sine', 0.06);
  }
  function bossLoot(en) {
    const nItems = 3 + Math.floor(Math.random() * 3);
    const kinds = ['sword', 'shield', 'armor', 'potion'];
    for (let i = 0; i < nItems; i++) {
      const a = (i / nItems) * Math.PI * 2 + Math.random();
      const it = makeItem(kinds[Math.floor(Math.random() * kinds.length)], D.floor, rollBossRarity());
      D.drops.push({
        x: en.x + Math.cos(a) * (24 + Math.random() * 26),
        y: en.y + Math.sin(a) * (24 + Math.random() * 26),
        it,
      });
    }
    // every boss guards a relic
    D.drops.push({ x: en.x, y: en.y, relic: randomRelic() });
  }
  function killEnemy(en) {
    const et = ETYPES[en.type];
    gainGold(et.gold(D.floor) + Math.floor(Math.random() * 4), en.x, en.y - 26);
    D.enemies.splice(D.enemies.indexOf(en), 1);
    // the fallen stay where they fell, all floor long
    D.corpses.push({ x: en.x, y: en.y, type: en.type, face: en.face, rot: Math.random() < 0.5 ? 1 : -1 });
    D.shake = Math.max(D.shake, en.isBoss ? 14 : 4);
    A.bleep(160, 0.1, 'sawtooth', 0.045);
    if (D.st.lifesteal) D.hero.hp = Math.min(D.hero.maxHp, D.hero.hp + D.st.lifesteal);
    if (D.st.manaKill) D.mana = Math.min(D.st.manaMax, D.mana + D.st.manaKill);
    if (en.isBoss) {
      say('BOSS SLAIN', '#e8a33d');
      A.sweep(600, 40, 0.7, 'sawtooth', 0.09);
      bossLoot(en);
      openSeal(true);
    } else {
      if (Math.random() < 0.1) {
        D.drops.push({ x: en.x, y: en.y, it: makeItem('potion', D.floor) });
      }
      // room cleared? the doors release
      if (D.sealedRoom && en.homeRoom === D.sealedRoom &&
          !D.enemies.some(x => x.homeRoom === D.sealedRoom)) {
        D.sealedRoom.cleared = true;
        openSeal(false);
      }
    }
  }
  function hurtHeroFrom(en, raw) {
    if (D.hurtT > 0) return;
    const toEn = Math.atan2(en.y - D.hero.y, en.x - D.hero.x);
    const frontal = Math.abs(angDiff(toEn, D.aim)) < 1.15;
    let dmg;
    if (D.block && D.equip.shield && frontal) {
      dmg = Math.max(0, raw - D.st.blk * 2 - D.st.def);
      D.hurtT = 0.35;
      floatText(D.hero.x, D.hero.y - 24, dmg > 0 ? '-' + dmg : 'BLOCK', '#8fa2b8');
      A.bleep(520, 0.06, 'square', 0.045);
      nudge(en, Math.cos(toEn) * 20, Math.sin(toEn) * 20, ETYPES[en.type].r);
    } else {
      dmg = Math.max(1, raw - D.st.def);
      D.hurtT = 0.6;
      D.shake = Math.max(D.shake, 8);
      floatText(D.hero.x, D.hero.y - 24, '-' + dmg, '#a4372e');
      A.bleep(180, 0.12, 'square', 0.05);
    }
    if (D.st.thorns) damageEnemy(en, D.st.thorns, false);
    D.hero.hp -= dmg;
    if (D.hero.hp <= 0) { D.hero.hp = 0; die(); }
  }
  // environmental damage: spikes and flames ignore blocking
  function hurtHeroEnv(raw) {
    if (D.hurtT > 0) return;
    const dmg = Math.max(1, raw - Math.floor(D.st.def / 2));
    D.hero.hp -= dmg;
    D.hurtT = 0.6;
    D.shake = Math.max(D.shake, 6);
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
      sword: { x: px + 32, y: py + 96 },
      shield: { x: px + 96, y: py + 96 },
      armor: { x: px + 160, y: py + 96 },
    };
    const hot = [];
    for (let i = 0; i < 4; i++) {
      hot.push({ x: px + 250 + i * (SLOT + GAP), y: py + ph - 86 });
    }
    const chest = [];
    for (let i = 0; i < 4; i++) {
      chest.push({ x: px + 250 + i * (SLOT + GAP), y: py - 84 });
    }
    const takeAll = { x: px + 26, y: py - 78, w: 130, h: 40 };
    return { px, py, pw, ph, bag, eq, hot, chest, takeAll };
  }
  const inSlot = (mx, my, s) => mx >= s.x && mx <= s.x + SLOT && my >= s.y && my <= s.y + SLOT;
  function slotAt(mx, my) {
    const L = invLayout();
    for (let i = 0; i < 16; i++) if (inSlot(mx, my, L.bag[i])) return { type: 'bag', key: i };
    for (let i = 0; i < 4; i++) if (inSlot(mx, my, L.hot[i])) return { type: 'hot', key: i };
    for (const kind of ['sword', 'shield', 'armor']) {
      if (inSlot(mx, my, L.eq[kind])) return { type: 'eq', key: kind };
    }
    if (D.lootChest) {
      for (let i = 0; i < 4; i++) if (inSlot(mx, my, L.chest[i])) return { type: 'chest', key: i };
      if (L.takeAll && mx >= L.takeAll.x && mx <= L.takeAll.x + L.takeAll.w &&
          my >= L.takeAll.y && my <= L.takeAll.y + L.takeAll.h) return { type: 'takeall' };
    }
    return null;
  }
  function getSlot(s) {
    if (s.type === 'bag') return D.bag[s.key];
    if (s.type === 'hot') return D.hotbar[s.key];
    if (s.type === 'eq') return D.equip[s.key];
    if (s.type === 'chest') return D.lootChest ? D.lootChest.items[s.key] : null;
    return null;
  }
  function setSlot(s, it) {
    if (s.type === 'bag') D.bag[s.key] = it;
    else if (s.type === 'hot') D.hotbar[s.key] = it;
    else if (s.type === 'eq') { D.equip[s.key] = it; recalc(); }
    else if (s.type === 'chest' && D.lootChest) D.lootChest.items[s.key] = it;
  }
  function accepts(s, it) {
    if (!it) return true;
    if (s.type === 'bag') return true;
    if (s.type === 'hot') return it.kind === 'potion';
    if (s.type === 'eq') return it.kind === s.key;
    if (s.type === 'chest') return true;
    return false;
  }
  function dropItem(from, to) {
    if (!to || to.type === 'takeall') return false;
    const a = getSlot(from), b = getSlot(to);
    if (!a) return false;
    if (!accepts(to, a) || !accepts(from, b)) return false;
    setSlot(to, a);
    setSlot(from, b);
    if (to.type === 'eq') say('Equipped ' + a.name, RARITIES[a.ri].color);
    A.bleep(520, 0.04, 'triangle', 0.03);
    return true;
  }
  function clickSlot(s) {
    const it = getSlot(s);
    if (s.type === 'takeall') {
      if (!D.lootChest) return;
      for (let i = 0; i < 4; i++) {
        const ci = D.lootChest.items[i];
        if (ci && addToBag(ci)) {
          say('Took ' + ci.name + ' (' + RARITIES[ci.ri].name + ')', RARITIES[ci.ri].color);
          D.lootChest.items[i] = null;
        }
      }
      A.bleep(640, 0.05, 'triangle', 0.035);
      return;
    }
    if (!it) return;
    if (s.type === 'chest') {
      if (addToBag(it)) {
        say('Took ' + it.name + ' (' + RARITIES[it.ri].name + ')', RARITIES[it.ri].color);
        setSlot(s, null);
        A.bleep(640, 0.05, 'triangle', 0.035);
      }
      return;
    }
    if (s.type === 'bag') {
      if (it.kind === 'potion') {
        const slot = D.hotbar.indexOf(null);
        if (slot < 0) { say('Hotbar full'); return; }
        D.hotbar[slot] = it;
        D.bag[s.key] = null;
      } else {
        const old = D.equip[it.kind];
        D.equip[it.kind] = it;
        D.bag[s.key] = old;
        recalc();
        say('Equipped ' + it.name, RARITIES[it.ri].color);
      }
      A.bleep(520, 0.04, 'triangle', 0.03);
      return;
    }
    if (addToBag(it)) {
      setSlot(s, null);
      A.bleep(420, 0.04, 'triangle', 0.03);
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
  function nudge(o, dx, dy, r) {
    const nx = o.x + dx;
    if (!collide(nx, o.y, r)) o.x = nx;
    const ny = o.y + dy;
    if (!collide(o.x, ny, r)) o.y = ny;
  }
  function unstick(o, r) {
    if (!collide(o.x, o.y, r)) return;
    for (let rad = 4; rad <= 64; rad += 4) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const nx = o.x + Math.cos(a) * rad, ny = o.y + Math.sin(a) * rad;
        if (!collide(nx, ny, r)) { o.x = nx; o.y = ny; return; }
      }
    }
  }
  function update(dt) {
    D.t += dt;
    D.shake = Math.max(0, D.shake - dt * 30);
    D.atkT = Math.max(0, D.atkT - dt);
    D.atkAnim = Math.max(0, D.atkAnim - dt);
    D.hurtT = Math.max(0, D.hurtT - dt);
    D.novaT = Math.max(0, (D.novaT || 0) - dt);
    for (let i = D.floats.length - 1; i >= 0; i--) {
      const f = D.floats[i];
      f.y -= 26 * dt; f.t -= dt;
      if (f.t <= 0) D.floats.splice(i, 1);
    }
    for (let i = D.msgs.length - 1; i >= 0; i--) {
      D.msgs[i].t -= dt;
      if (D.msgs[i].t <= 0) D.msgs.splice(i, 1);
    }
    if (D.inv) return;

    D.mana = Math.min(D.st.manaMax, D.mana + D.st.manaRegen * dt);
    D.aim = Math.atan2(ARCADE_LOCK.cur.y - innerHeight / 2, ARCADE_LOCK.cur.x - innerWidth / 2);
    D.hero.face = Math.cos(D.aim) >= 0 ? 1 : -1;
    if (!D.equip.shield) D.block = false;

    let ax = 0, ay = 0;
    if (keys['a'] || keys['arrowleft']) ax -= 1;
    if (keys['d'] || keys['arrowright']) ax += 1;
    if (keys['w'] || keys['arrowup']) ay -= 1;
    if (keys['s'] || keys['arrowdown']) ay += 1;
    const m = Math.hypot(ax, ay) || 1;
    D.hero.moving = !!(ax || ay);
    const spd = D.block ? D.st.spd * 0.45 : D.st.spd;
    moveWith(D.hero, (ax / m) * spd, (ay / m) * spd, dt, HERO_R);
    // crossing a doorway loads the next room
    const htx2 = Math.floor(D.hero.x / TILE), hty2 = Math.floor(D.hero.y / TILE);
    const nr = roomAt(htx2, hty2);
    if (nr && nr !== D.curRoom) enterRoom(nr);
    // fixed Isaac camera: glides to the room's center
    const cr = D.curRoom;
    const tcx = (cr.x + cr.w / 2) * TILE, tcy = (cr.y + cr.h / 2) * TILE;
    const ck = Math.min(1, dt * 9);
    D.cam.x += (tcx - D.cam.x) * ck;
    D.cam.y += (tcy - D.cam.y) * ck;

    // hazards underfoot
    const htx = Math.floor(D.hero.x / TILE), hty = Math.floor(D.hero.y / TILE);
    if (D.spikeSet.has(idx(htx, hty))) hurtHeroEnv(8 + D.floor * 2);
    for (const bz of D.braziers) {
      if (Math.hypot((bz.x + 0.5) * TILE - D.hero.x, (bz.y + 0.5) * TILE - D.hero.y) < TILE * 0.7 + 8) {
        hurtHeroEnv(6 + D.floor);
        break;
      }
    }

    D.stairMsgT = Math.max(0, D.stairMsgT - dt);
    if (Math.hypot(D.hero.x - (D.stairs.x + 0.5) * TILE, D.hero.y - (D.stairs.y + 0.5) * TILE) < 20) {
      if (D.stairsLocked) {
        if (D.stairMsgT <= 0) {
          D.stairMsgT = 2.5;
          say('The way down is latched — slay the guardian', '#a4372e');
          A.bleep(160, 0.08, 'square', 0.035);
        }
      } else {
        descend();
        return;
      }
    }
    // shop wares: touch to buy, if your purse can cover it
    for (const w of D.wares) {
      w.msgT = Math.max(0, w.msgT - dt);
      if (w.sold) continue;
      if (Math.hypot(D.hero.x - (w.x + 0.5) * TILE, D.hero.y - (w.y + 0.5) * TILE) < 24) {
        if (D.hero.gold < w.price) {
          if (w.msgT <= 0) {
            w.msgT = 2;
            say('Costs ' + w.price + 'g — you have ' + D.hero.gold, '#d9a94e');
            A.bleep(160, 0.07, 'square', 0.03);
          }
          continue;
        }
        if (w.it && D.bag.indexOf(null) < 0) {
          if (w.msgT <= 0) { w.msgT = 2; say('Bag full!', '#a4372e'); }
          continue;
        }
        D.hero.gold -= w.price;
        w.sold = true;
        if (w.relic) {
          gainRelic(w.relic);
        } else {
          addToBag(w.it);
          say('Bought ' + w.it.name + ' (' + RARITIES[w.it.ri].name + ')', RARITIES[w.it.ri].color);
        }
        A.bleep(880, 0.06, 'triangle', 0.05);
        setTimeout(() => A.bleep(1180, 0.08, 'triangle', 0.05), 70);
      }
    }
    // pedestals: walk up to claim what rests there
    for (const p of D.pedestals) {
      if (p.taken) continue;
      if (Math.hypot(D.hero.x - (p.x + 0.5) * TILE, D.hero.y - (p.y + 0.5) * TILE) < 26) {
        p.taken = true;
        if (p.relic) {
          gainRelic(p.relic);
        } else if (p.it) {
          const old = D.equip.sword;
          D.equip.sword = p.it;
          if (old) addToBag(old);
          recalc();
          say('Took the ' + p.it.name, RARITIES[p.it.ri].color);
          A.bleep(560, 0.06, 'triangle', 0.04);
          // choosing one dismisses its siblings
          if (p.group) {
            for (const q of D.pedestals) {
              if (q !== p && q.group === p.group) q.taken = true;
            }
          }
        }
      }
    }
    for (const c of D.chests) {
      c.cool = Math.max(0, c.cool - dt);
      if (c.cool > 0 || D.lootChest) continue;
      if (!c.items.some(Boolean) && c.opened) continue;
      if (Math.hypot(D.hero.x - (c.x + 0.5) * TILE, D.hero.y - (c.y + 0.5) * TILE) < 30) {
        if (!c.opened) {
          c.opened = true;
          gainGold(c.gold, D.hero.x, D.hero.y - 24);
          c.gold = 0;
          A.sweep(500, 80, 0.35, 'sine', 0.05);
        }
        D.lootChest = c;
        D.inv = true;
        D.invMx = ARCADE_LOCK.cur.x; D.invMy = ARCADE_LOCK.cur.y;
        ARCADE_LOCK.unlock();
        A.bleep(760, 0.08, 'triangle', 0.04);
      }
    }
    for (let i = D.drops.length - 1; i >= 0; i--) {
      const dr = D.drops[i];
      dr.cool = Math.max(0, (dr.cool || 0) - dt);
      if (dr.cool > 0) continue;
      if (Math.hypot(D.hero.x - dr.x, D.hero.y - dr.y) < 26) {
        if (dr.relic) {
          gainRelic(dr.relic);
          D.drops.splice(i, 1);
        } else if (addToBag(dr.it)) {
          say('Picked up ' + dr.it.name + ' (' + RARITIES[dr.it.ri].name + ')', RARITIES[dr.it.ri].color);
          A.bleep(640, 0.05, 'triangle', 0.035);
          D.drops.splice(i, 1);
        }
      }
    }
    // spell bolts
    for (let i = D.bolts.length - 1; i >= 0; i--) {
      const b = D.bolts[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.t -= dt;
      if (b.t <= 0 || solid(Math.floor(b.x / TILE), Math.floor(b.y / TILE))) {
        D.bolts.splice(i, 1);
        continue;
      }
      for (const en of D.enemies) {
        if (Math.hypot(en.x - b.x, en.y - b.y) < ETYPES[en.type].r + 5) {
          damageEnemy(en, Math.max(1, b.dmg - (ETYPES[en.type].dr || 0)), false);
          D.bolts.splice(i, 1);
          break;
        }
      }
    }

    // ---- enemies ---------------------------------------------------------
    for (const en of D.enemies) {
      if (en.homeRoom !== D.curRoom) continue; // other rooms sleep
      const et = ETYPES[en.type];
      unstick(en, et.r);
      en.cd = Math.max(0, en.cd - dt);
      en.hurt = Math.max(0, en.hurt - dt);
      en.slow = Math.max(0, (en.slow || 0) - dt);
      const slowMul = en.slow > 0 ? 0.45 : 1;
      const dx = D.hero.x - en.x, dy = D.hero.y - en.y;
      const d = Math.hypot(dx, dy);

      // keep every mob inside its own room, always
      const clampRoom = () => {
        const r = en.homeRoom;
        if (!r) return;
        en.x = Math.max(r.x * TILE + et.r, Math.min((r.x + r.w) * TILE - et.r, en.x));
        en.y = Math.max(r.y * TILE + et.r, Math.min((r.y + r.h) * TILE - et.r, en.y));
      };
      if (!en.aggro) {
        if (!en.isBoss) {
          en.wanderT -= dt;
          if (en.wanderT <= 0) {
            en.wanderT = 1 + Math.random() * 2.5;
            const a = Math.random() * Math.PI * 2;
            const go = Math.random() < 0.7;
            en.wx = go ? Math.cos(a) : 0;
            en.wy = go ? Math.sin(a) : 0;
            en.fa = a;
            en.face = Math.cos(a) >= 0 ? 1 : -1;
          }
          moveWith(en, en.wx * et.spd * 0.4 * slowMul, en.wy * et.spd * 0.4 * slowMul, dt, et.r);
          clampRoom();
          const toHero = Math.atan2(dy, dx);
          const inCone = d < TILE * 5.5 && Math.abs(angDiff(toHero, en.fa)) < 0.95;
          const heard = d < TILE * 1.3;
          if ((inCone && los(en.x, en.y, D.hero.x, D.hero.y)) || heard) {
            en.aggro = true;
            floatText(en.x, en.y - 22, '!', '#e8a33d');
            A.bleep(500, 0.05, 'square', 0.025);
          }
        }
        continue;
      }

      const nd = d || 1;
      if (et.move === 'erratic') {
        const wob = Math.sin(D.t * 6 + en.x * 0.013) * 0.85;
        let vx = dx / nd - (dy / nd) * wob, vy = dy / nd + (dx / nd) * wob;
        const vn = Math.hypot(vx, vy) || 1;
        moveWith(en, (vx / vn) * et.spd * slowMul, (vy / vn) * et.spd * slowMul, dt, et.r);
      } else if (et.move === 'lunge') {
        en.lt = (en.lt || 0) - dt;
        en.lcool = Math.max(0, (en.lcool || 0) - dt);
        if (en.lphase === 'wind') {
          if (en.lt <= 0) {
            en.lphase = 'dash';
            en.lt = 0.42;
            en.ldx = dx / nd; en.ldy = dy / nd;
            A.bleep(200, 0.08, 'sawtooth', 0.04);
          }
        } else if (en.lphase === 'dash') {
          moveWith(en, en.ldx * et.dash * slowMul, en.ldy * et.dash * slowMul, dt, et.r);
          if (en.lt <= 0) { en.lphase = 'stalk'; en.lcool = 1.3; }
        } else {
          moveWith(en, (dx / nd) * et.spd * slowMul, (dy / nd) * et.spd * slowMul, dt, et.r);
          if (d < TILE * 3.4 && en.lcool <= 0) {
            en.lphase = 'wind';
            en.lt = 0.35;
            A.bleep(640, 0.05, 'square', 0.03);
          }
        }
      } else {
        moveWith(en, (dx / nd) * et.spd * slowMul, (dy / nd) * et.spd * slowMul, dt, et.r);
      }
      clampRoom();
      if (en.isBoss) {
        if (en.type === 'brood') {
          en.broodT -= dt;
          if (en.broodT <= 0) {
            en.broodT = 6;
            const lings = D.enemies.filter(x => x.type === 'spiderling').length;
            for (let s = 0; s < 2 && lings + s < 6; s++) {
              const a = Math.random() * Math.PI * 2;
              const sp = {
                type: 'spiderling', homeRoom: en.homeRoom,
                x: en.x + Math.cos(a) * 30, y: en.y + Math.sin(a) * 30,
                hp: ETYPES.spiderling.hp(D.floor), maxHp: ETYPES.spiderling.hp(D.floor),
                cd: 0, wanderT: 0, wx: 0, wy: 0, face: 1, fa: a, hurt: 0, aggro: true,
              };
              unstick(sp, ETYPES.spiderling.r);
              D.enemies.push(sp);
            }
            floatText(en.x, en.y - 30, 'brood!', '#b06ae0');
            A.bleep(300, 0.1, 'square', 0.04);
          }
        }
      }
      if (dx) en.face = dx > 0 ? 1 : -1;
      en.fa = Math.atan2(dy, dx);
      if (d < et.r + HERO_R + 5 && en.cd <= 0) {
        en.cd = en.isBoss ? 1.1 : 0.85;
        hurtHeroFrom(en, en.isBoss ? en.dmgv : et.dmg(D.floor));
      }
    }
    // allies (necromancer thralls): hunt nearby foes, crumble in time
    for (let i = D.allies.length - 1; i >= 0; i--) {
      const al = D.allies[i];
      al.ttl -= dt;
      al.cd = Math.max(0, al.cd - dt);
      if (al.ttl <= 0) {
        floatText(al.x, al.y - 16, '*crumble*', '#9fd8a8');
        D.allies.splice(i, 1);
        continue;
      }
      let best = null, bd = TILE * 8;
      for (const en of D.enemies) {
        const dd = Math.hypot(en.x - al.x, en.y - al.y);
        if (dd < bd) { bd = dd; best = en; }
      }
      if (best) {
        const dx2 = best.x - al.x, dy2 = best.y - al.y;
        const nd2 = Math.hypot(dx2, dy2) || 1;
        moveWith(al, (dx2 / nd2) * 120, (dy2 / nd2) * 120, dt, 8);
        al.face = dx2 > 0 ? 1 : -1;
        if (nd2 < ETYPES[best.type].r + 10 && al.cd <= 0) {
          al.cd = 0.7;
          damageEnemy(best, Math.max(1, Math.round((5 + D.floor) * D.st.spellMult) - (ETYPES[best.type].dr || 0)), false);
        }
      } else {
        const dx2 = D.hero.x - al.x, dy2 = D.hero.y - al.y;
        const nd2 = Math.hypot(dx2, dy2) || 1;
        if (nd2 > TILE * 1.6) {
          moveWith(al, (dx2 / nd2) * 130, (dy2 / nd2) * 130, dt, 8);
          al.face = dx2 > 0 ? 1 : -1;
        }
      }
    }
  }

  // ---- rendering ---------------------------------------------------------
  let lightCv = null, lightCtx = null;
  function ensureLight(w, h) {
    const cw = Math.ceil(w), chh = Math.ceil(h);
    if (!lightCv || lightCv.width !== cw || lightCv.height !== chh) {
      lightCv = document.createElement('canvas');
      lightCv.width = cw; lightCv.height = chh;
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
      const ic = iconFor(it);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ic, s.x + SLOT / 2 - ic.width * 2, s.y + SLOT / 2 - ic.height * 2, ic.width * 4, ic.height * 4);
    }
  }
  function drawRelicGlyph(x, y, r, size) {
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
    ctx.closePath();
    ctx.fill();
    if (r.cursed) {
      ctx.strokeStyle = '#a4372e';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
  // canvas-drawn pointer arrow — immune to CSS/pointer-lock cursor quirks
  function drawPointer(x, y) {
    ctx.save();
    ctx.translate(x, y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.5, 12.5);
    ctx.lineTo(7.5, 18);
    ctx.lineTo(10, 16.5);
    ctx.lineTo(7, 11.5);
    ctx.lineTo(12, 11);
    ctx.closePath();
    ctx.fillStyle = '#e8e0c8';
    ctx.fill();
    ctx.strokeStyle = '#14160f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
  function drawInventory() {
    const W = innerWidth, H = innerHeight;
    const L = invLayout();
    const MP = invPos();
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
    ctx.fillText('EQUIPPED', L.px + 32, L.py + 84);
    ctx.fillText('BAG', L.px + 250, L.py + 64);
    ctx.fillText('HOTBAR  [1-4]', L.px + 250, L.py + L.ph - 96);
    let hoverItem = null, hoverRelic = null;
    const dragging = D.drag && D.drag.moved;
    const isDragSrc = s => dragging && D.drag.from.type === s.type && D.drag.from.key === s.key;
    const showItem = (s, it) => (isDragSrc(s) ? null : it);
    if (D.lootChest) {
      ctx.fillStyle = '#181b12';
      ctx.fillRect(L.px, L.py - 108, L.pw, 96);
      ctx.strokeStyle = RARITIES[D.lootChest.ri].color;
      ctx.lineWidth = 1;
      ctx.strokeRect(L.px + 0.5, L.py - 107.5, L.pw - 1, 95);
      ctx.fillStyle = RARITIES[D.lootChest.ri].color;
      ctx.font = '600 13px ' + MONO;
      ctx.fillText(RARITIES[D.lootChest.ri].name.toUpperCase() + ' CHEST', L.px + 26, L.py - 88);
      const ta = L.takeAll;
      const taHov = MP.x >= ta.x && MP.x <= ta.x + ta.w && MP.y >= ta.y && MP.y <= ta.y + ta.h;
      ctx.fillStyle = taHov ? 'rgba(255, 255, 255, 0.14)' : 'rgba(255, 255, 255, 0.06)';
      ctx.fillRect(ta.x, ta.y, ta.w, ta.h);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.strokeRect(ta.x + 0.5, ta.y + 0.5, ta.w - 1, ta.h - 1);
      ctx.fillStyle = '#c8cdd7';
      ctx.font = '600 12px ' + MONO;
      ctx.fillText('TAKE ALL', ta.x + 30, ta.y + 25);
      for (let i = 0; i < 4; i++) {
        const s = { type: 'chest', key: i };
        const it = D.lootChest.items[i];
        const hov = inSlot(MP.x, MP.y, L.chest[i]);
        drawSlot(L.chest[i], showItem(s, it), hov);
        if (hov && it) hoverItem = it;
      }
    }
    for (const kind of ['sword', 'shield', 'armor']) {
      const s = L.eq[kind];
      const hov = inSlot(MP.x, MP.y, s);
      drawSlot(s, showItem({ type: 'eq', key: kind }, D.equip[kind]), hov);
      if (hov && D.equip[kind]) hoverItem = D.equip[kind];
      ctx.fillStyle = '#8a8f80';
      ctx.font = '600 9px ' + MONO;
      ctx.fillText(kind.toUpperCase(), s.x + 2, s.y + SLOT + 13);
    }
    for (let i = 0; i < 16; i++) {
      const hov = inSlot(MP.x, MP.y, L.bag[i]);
      drawSlot(L.bag[i], showItem({ type: 'bag', key: i }, D.bag[i]), hov);
      if (hov && D.bag[i]) hoverItem = D.bag[i];
    }
    for (let i = 0; i < 4; i++) {
      const hov = inSlot(MP.x, MP.y, L.hot[i]);
      drawSlot(L.hot[i], showItem({ type: 'hot', key: i }, D.hotbar[i]), hov);
      if (hov && D.hotbar[i]) hoverItem = D.hotbar[i];
      ctx.fillStyle = '#8a8f80';
      ctx.font = '600 10px ' + MONO;
      ctx.fillText('' + (i + 1), L.hot[i].x + 4, L.hot[i].y + 13);
    }
    ctx.font = '600 13px ' + MONO;
    ctx.fillStyle = '#c8cdd7';
    ctx.fillText('DMG ' + heroDmg(), L.px + 32, L.py + 210);
    ctx.fillText('BLK ' + D.st.blk, L.px + 32, L.py + 232);
    ctx.fillText('ARM ' + D.st.def, L.px + 32, L.py + 254);
    ctx.fillText('GOLD ' + D.hero.gold, L.px + 32, L.py + 276);
    // relic shelf: every pickup, stacked
    ctx.fillStyle = '#8a8f80';
    ctx.font = '600 12px ' + MONO;
    ctx.fillText('RELICS', L.px + 32, L.py + 306);
    for (let i = 0; i < D.relics.length && i < 24; i++) {
      const rx = L.px + 40 + (i % 8) * 24;
      const ry = L.py + 324 + Math.floor(i / 8) * 24;
      drawRelicGlyph(rx, ry, D.relics[i], 8);
      if (Math.abs(MP.x - rx) < 10 && Math.abs(MP.y - ry) < 10) hoverRelic = D.relics[i];
    }
    if (hoverRelic) {
      ctx.fillStyle = hoverRelic.cursed ? '#a4372e' : hoverRelic.color;
      ctx.font = '600 13px ' + MONO;
      ctx.fillText(hoverRelic.name + ' — ' + hoverRelic.desc, L.px + 26, L.py + L.ph - 18);
    } else if (hoverItem) {
      ctx.fillStyle = RARITIES[hoverItem.ri].color;
      ctx.font = '600 13px ' + MONO;
      ctx.fillText(RARITIES[hoverItem.ri].name + ' ' + hoverItem.name + '  ·  ' + itemStat(hoverItem), L.px + 26, L.py + L.ph - 18);
    } else {
      ctx.fillStyle = '#8a8f80';
      ctx.font = '600 13px ' + MONO;
      ctx.fillText('click for quick-move · drag to arrange · Tab closes', L.px + 26, L.py + L.ph - 18);
    }
    // the dragged item rides the cursor
    if (dragging) {
      const it = getSlot(D.drag.from);
      if (it) {
        const ic = iconFor(it);
        ctx.globalAlpha = 0.9;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(ic, MP.x - ic.width * 2, MP.y - ic.height * 2, ic.width * 4, ic.height * 4);
        ctx.globalAlpha = 1;
      }
    }
    drawPointer(MP.x, MP.y);
  }
  function draw() {
    const W = innerWidth, H = innerHeight;
    ARCADE_FX.screen(ctx);
    ctx.imageSmoothingEnabled = false;
    // one room fills the screen: zoom fits the room plus its wall ring
    const Z = Math.min(W / ((CW + 1) * TILE), H / ((CH + 1) * TILE)) * 0.95;
    const VW = W / Z, VH = H / Z;
    ctx.save();
    ctx.scale(Z, Z);
    let ox = Math.round(VW / 2 - D.cam.x), oy = Math.round(VH / 2 - D.cam.y);
    if (D.shake > 0 && !reducedMotion) {
      ox += Math.round((Math.random() - 0.5) * D.shake);
      oy += Math.round((Math.random() - 0.5) * D.shake);
    }
    // render only the current room and its surrounding walls
    const cr = D.curRoom || D.rooms[0];
    const tx0 = Math.max(0, cr.x - 1), tx1 = Math.min(MW - 1, cr.x + cr.w);
    const ty0 = Math.max(0, cr.y - 1), ty1 = Math.min(MH - 1, cr.y + cr.h);
    const inV = (tx, ty) => tx >= tx0 && tx <= tx1 && ty >= ty0 && ty <= ty1;

    for (let y = ty0; y <= ty1; y++) {
      for (let x = tx0; x <= tx1; x++) {
        if (!D.seen[idx(x, y)]) continue;
        const sx = ox + x * TILE, sy = oy + y * TILE;
        const hv = hash(x, y);
        if (D.tiles[idx(x, y)] === 1) {
          if (x % CW === 0 || y % CH === 0) {
            // open doorway: a black passage out of the room
            ctx.fillStyle = '#060704';
            ctx.fillRect(sx, sy, TILE, TILE);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
            ctx.fillRect(sx, sy, TILE, 2);
          } else {
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
          }
        } else if (D.tiles[idx(x, y)] === 3 || D.tiles[idx(x, y)] === 4) {
          // rock or brazier base sits on visible floor
          ctx.fillStyle = hv % 3 === 0 ? '#343a2e' : '#3a4033';
          ctx.fillRect(sx, sy, TILE, TILE);
          if (D.tiles[idx(x, y)] === 3) {
            ctx.fillStyle = '#20241a';
            ctx.beginPath();
            ctx.ellipse(sx + TILE / 2, sy + TILE / 2 + 5, 13, 9, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#6a705c';
            ctx.beginPath();
            ctx.ellipse(sx + TILE / 2, sy + TILE / 2 - 1, 12, 10, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#828a70';
            ctx.beginPath();
            ctx.ellipse(sx + TILE / 2 - 3, sy + TILE / 2 - 5, 5, 4, 0, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = '#4a5040';
            ctx.fillRect(sx + 9, sy + 12, 14, 14);
            ctx.fillStyle = '#2e3428';
            ctx.fillRect(sx + 11, sy + 22, 10, 6);
          }
        } else if (D.tiles[idx(x, y)] === 2) {
          ctx.fillStyle = '#5a4632';
          ctx.fillRect(sx, sy, TILE, TILE);
          ctx.fillStyle = 'rgba(20, 22, 15, 0.5)';
          for (let by = 6; by < TILE; by += 10) ctx.fillRect(sx, sy + by, TILE, 2);
          ctx.fillStyle = '#8a8f80';
          ctx.fillRect(sx + 3, sy + 3, 3, 3);
          ctx.fillRect(sx + TILE - 6, sy + 3, 3, 3);
          ctx.fillRect(sx + 3, sy + TILE - 6, 3, 3);
          ctx.fillRect(sx + TILE - 6, sy + TILE - 6, 3, 3);
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

    if (inV(D.stairs.x, D.stairs.y)) {
      const sx = ox + D.stairs.x * TILE, sy = oy + D.stairs.y * TILE;
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = 'rgba(0, 0, 0, ' + (0.35 + i * 0.13) + ')';
        ctx.fillRect(sx + i * 4, sy + i * 4, TILE - i * 8, TILE - i * 8);
      }
      if (D.stairsLocked) {
        ctx.fillStyle = '#8a8f80';
        for (let i = 0; i < 4; i++) ctx.fillRect(sx + 4 + i * 8, sy + 2, 3, TILE - 4);
        ctx.fillRect(sx + 2, sy + TILE / 2 - 2, TILE - 4, 3);
      }
    }
    // spikes: rows of points on the floor tile
    for (const sp2 of D.spikes) {
      if (!inV(sp2.x, sp2.y)) continue;
      const sx = ox + sp2.x * TILE, sy = oy + sp2.y * TILE;
      ctx.fillStyle = '#8a8f80';
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const px2 = sx + 6 + i * 10, py2 = sy + 8 + j * 9;
          ctx.beginPath();
          ctx.moveTo(px2, py2 + 6);
          ctx.lineTo(px2 + 3, py2);
          ctx.lineTo(px2 + 6, py2 + 6);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    // brazier flames
    for (const bz of D.braziers) {
      if (!inV(bz.x, bz.y)) continue;
      const sx = ox + bz.x * TILE + TILE / 2, sy = oy + bz.y * TILE + 10;
      const fl = reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(D.t * 8 + bz.x * 2);
      ctx.globalAlpha = 0.75 * fl;
      ctx.fillStyle = '#e8763d';
      ctx.beginPath();
      ctx.ellipse(sx, sy, 5, 8 * fl, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.9 * fl;
      ctx.fillStyle = '#e8a33d';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 2, 3, 4.5 * fl, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // the fallen: splatted where they died, laid sideways over a dark stain
    for (const c of D.corpses) {
      const tx2 = Math.floor(c.x / TILE), ty2 = Math.floor(c.y / TILE);
      if (!inV(tx2, ty2)) continue;
      const et = ETYPES[c.type];
      const sx = ox + c.x, sy = oy + c.y;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = '#3a1814';
      ctx.beginPath();
      ctx.ellipse(sx, sy + et.h * 0.2, et.r + 6, et.r * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.save();
      ctx.translate(sx, sy + et.h * 0.18);
      ctx.rotate((Math.PI / 2) * c.rot);
      ctx.scale(c.face, 0.62); // squashed flat on its side
      ctx.drawImage(et.spr, -et.w / 2, -et.h / 2, et.w, et.h);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // raised thralls: the corpse's own body, walking again in rot-green
    for (const al of D.allies) {
      const sx = ox + al.x, sy = oy + al.y;
      const aspr = al.type ? zombieSpr(al.type) : MINION;
      const aw = al.type ? ETYPES[al.type].w : 22;
      const ah = al.type ? ETYPES[al.type].h : 24;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.scale(al.face, 1);
      ctx.globalAlpha = 0.92;
      ctx.drawImage(aspr, -aw / 2, -ah / 2, aw, ah);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    // the shop: rug, merchant, and priced wares
    if (cr.type === 'shop' && cr.merchant) {
      const rugX = ox + (cr.cx - 2.5) * TILE, rugY = oy + (cr.cy - 0.5) * TILE;
      ctx.fillStyle = 'rgba(122, 90, 50, 0.25)';
      ctx.fillRect(rugX, rugY, TILE * 6, TILE * 2);
      const msx = ox + (cr.merchant.x + 0.5) * TILE, msy = oy + (cr.merchant.y + 0.5) * TILE;
      const bob = reducedMotion ? 0 : Math.sin(D.t * 1.6) * 1.5;
      ctx.drawImage(MERCHANT, msx - 12, msy - 14 + bob, 24, 22);
      ctx.fillStyle = '#d9a94e';
      ctx.font = '600 9px ' + MONO;
      ctx.textAlign = 'center';
      ctx.fillText('SHOP', msx, msy - 20 + bob);
      ctx.textAlign = 'left';
    }
    for (const w of D.wares) {
      if (w.sold || !inV(w.x, w.y)) continue;
      const sx = ox + (w.x + 0.5) * TILE, sy = oy + (w.y + 0.5) * TILE;
      const col = w.relic ? w.relic.color : RARITIES[w.it.ri].color;
      ctx.fillStyle = '#565b48';
      ctx.fillRect(sx - 8, sy - 2, 16, 8);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(sx, sy - 12, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (w.relic) {
        drawRelicGlyph(sx, sy - 12, w.relic, 7);
      } else {
        const ic = iconFor(w.it);
        ctx.drawImage(ic, sx - ic.width, sy - 12 - ic.height, ic.width * 2, ic.height * 2);
      }
      ctx.fillStyle = D.hero.gold >= w.price ? '#d9a94e' : '#a4372e';
      ctx.font = '600 9px ' + MONO;
      ctx.textAlign = 'center';
      ctx.fillText(w.price + 'g', sx, sy + 16);
      ctx.textAlign = 'left';
    }
    // pedestals
    for (const p of D.pedestals) {
      if (!inV(p.x, p.y)) continue;
      const sx = ox + p.x * TILE + TILE / 2, sy = oy + p.y * TILE + TILE / 2;
      ctx.fillStyle = '#565b48';
      ctx.fillRect(sx - 8, sy - 4, 16, 10);
      ctx.fillStyle = '#3a4033';
      ctx.fillRect(sx - 11, sy + 4, 22, 4);
      if (!p.taken) {
        const bob = reducedMotion ? 0 : Math.sin(D.t * 2.4) * 3;
        const col = p.relic ? p.relic.color : RARITIES[p.it.ri].color;
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(sx, sy - 14 + bob, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        if (p.relic) {
          drawRelicGlyph(sx, sy - 14 + bob, p.relic, 8);
        } else {
          const ic = iconFor(p.it);
          ctx.drawImage(ic, sx - ic.width, sy - 14 + bob - ic.height, ic.width * 2, ic.height * 2);
        }
      }
    }
    for (const c of D.chests) {
      if (!inV(c.x, c.y)) continue;
      const sx = ox + c.x * TILE + TILE / 2, sy = oy + c.y * TILE + TILE / 2;
      if (!c.opened) {
        ctx.globalAlpha = 0.28 + (reducedMotion ? 0 : 0.1 * Math.sin(D.t * 3 + c.x));
        ctx.fillStyle = RARITIES[c.ri].color;
        ctx.beginPath();
        ctx.arc(sx, sy, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const spr = c.opened ? CHEST_OPEN : CHEST_CLOSED;
      ctx.drawImage(spr, sx - 12, sy - spr.height, 24, spr.height * 2);
    }
    for (const dr of D.drops) {
      const tx2 = Math.floor(dr.x / TILE), ty2 = Math.floor(dr.y / TILE);
      if (!inV(tx2, ty2)) continue;
      const sx = ox + dr.x, sy = oy + dr.y;
      const col = dr.relic ? dr.relic.color : RARITIES[dr.it.ri].color;
      ctx.globalAlpha = 0.35 + (reducedMotion ? 0 : 0.15 * Math.sin(D.t * 4 + dr.x));
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(sx, sy, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (dr.relic) {
        drawRelicGlyph(sx, sy, dr.relic, 7);
      } else {
        const ic = iconFor(dr.it);
        ctx.drawImage(ic, sx - ic.width * 1.5, sy - ic.height * 1.5, ic.width * 3, ic.height * 3);
      }
    }
    for (const tc of D.torches) {
      if (!inV(tc.x, tc.y)) continue;
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
    // spell bolts
    for (const b of D.bolts) {
      ctx.strokeStyle = '#e8763d';
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.moveTo(ox + b.x, oy + b.y);
      ctx.lineTo(ox + b.x - b.vx * 0.03, oy + b.y - b.vy * 0.03);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (D.novaT > 0) {
      const p = 1 - D.novaT / 0.3;
      ctx.globalAlpha = (1 - p) * 0.7;
      ctx.strokeStyle = '#5aa2e8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ox + D.hero.x, oy + D.hero.y, 130 * p, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const en of D.enemies) {
      if (en.homeRoom !== D.curRoom) continue;
      const et = ETYPES[en.type];
      const sx = ox + en.x, sy = oy + en.y;
      if (!en.aggro && !en.isBoss) {
        ctx.globalAlpha = 0.05;
        ctx.fillStyle = '#e8e0c8';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, TILE * 5.5, en.fa - 0.95, en.fa + 0.95);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
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
      if (en.slow > 0) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#5aa2e8';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, et.r + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (en.lphase === 'wind') {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#a4372e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, et.r + 6 + (en.lt / 0.35) * 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (en.hp < en.maxHp || en.isBoss) {
        const bw = en.isBoss ? 44 : 26;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(sx - bw / 2, sy - et.h / 2 - 9, bw, 4);
        ctx.fillStyle = en.isBoss ? '#e8a33d' : '#a4372e';
        ctx.fillRect(sx - bw / 2, sy - et.h / 2 - 9, bw * Math.max(0, en.hp / en.maxHp), 4);
        if (en.isBoss) {
          ctx.fillStyle = '#e8a33d';
          ctx.font = '600 10px ' + MONO;
          ctx.textAlign = 'center';
          ctx.fillText(BOSS_NAMES[en.type] || 'BOSS', sx, sy - et.h / 2 - 14);
          ctx.textAlign = 'left';
        }
      }
    }
    if (!(D.hurtT > 0 && Math.floor(D.t * 14) % 2)) {
      const HS = HERO_SETS[D.cls || 'knight'];
      const step = D.hero.moving && Math.floor(D.t * 8) % 2;
      let frame;
      if (Math.abs(Math.cos(D.aim)) > 0.42) frame = step ? HS.S2 : HS.S1;
      else if (Math.sin(D.aim) < 0) frame = step ? HS.B2 : HS.B1;
      else frame = step ? HS.F2 : HS.F1;
      const hx = ox + D.hero.x, hy = oy + D.hero.y;
      ctx.save();
      ctx.translate(hx, hy + 2);
      ctx.scale(D.hero.face, 1);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(0, 12, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.drawImage(frame, -12, -13, 24, 26);
      ctx.restore();
      ctx.save();
      ctx.translate(hx, hy);
      ctx.rotate(D.aim + Math.PI / 2);
      const swing = D.atkAnim > 0 ? (1 - D.atkAnim / 0.16) * 10 : 0;
      const held = D.equip.sword ? iconFor(D.equip.sword) : ICON_SWORD;
      ctx.drawImage(held, -5, -30 - swing, 10, 14);
      ctx.restore();
      if (D.block && D.equip.shield) {
        ctx.save();
        ctx.translate(hx, hy);
        ctx.rotate(D.aim);
        ctx.strokeStyle = '#8fa2b8';
        ctx.lineWidth = 4;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(0, 0, 20, -1.1, 1.1);
        ctx.stroke();
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    }
    if (D.atkAnim > 0) {
      const p = 1 - D.atkAnim / 0.16;
      ctx.save();
      ctx.translate(ox + D.hero.x, oy + D.hero.y);
      ctx.rotate(D.atkDir);
      ctx.globalAlpha = (1 - p) * 0.75;
      ctx.strokeStyle = '#e8e0c8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, D.st.range * 0.55 + p * D.st.range * 0.45, -D.st.arc * 0.85, D.st.arc * 0.85);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.font = '600 13px ' + MONO;
    ctx.textAlign = 'center';
    for (const f of D.floats) {
      ctx.globalAlpha = Math.min(1, f.t * 2);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, ox + f.x, oy + f.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    ensureLight(VW, VH);
    lightCtx.globalCompositeOperation = 'source-over';
    lightCtx.fillStyle = 'rgba(5, 6, 3, 0.88)';
    lightCtx.fillRect(0, 0, lightCv.width, lightCv.height);
    lightCtx.globalCompositeOperation = 'destination-out';
    const punch = (px, py, r, a) => {
      const g = lightCtx.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, 'rgba(0, 0, 0, ' + a + ')');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      lightCtx.fillStyle = g;
      lightCtx.fillRect(px - r, py - r, r * 2, r * 2);
    };
    const breathe = reducedMotion ? 1 : 1 + 0.03 * Math.sin(D.t * 3);
    punch(ox + D.hero.x, oy + D.hero.y, D.st.light * breathe, 1);
    for (const tc of D.torches) {
      if (!inV(tc.x, tc.y)) continue;
      const sx = ox + tc.x * TILE + TILE / 2, sy = oy + tc.y * TILE + TILE - 11;
      if (sx < -160 || sx > VW + 160 || sy < -160 || sy > VH + 160) continue;
      const fl = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(D.t * 9 + tc.ph);
      punch(sx, sy, 120 * fl, 0.85);
    }
    for (const bz of D.braziers) {
      if (!inV(bz.x, bz.y)) continue;
      const sx = ox + bz.x * TILE + TILE / 2, sy = oy + bz.y * TILE + 12;
      if (sx < -140 || sx > VW + 140 || sy < -140 || sy > VH + 140) continue;
      const fl = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(D.t * 8 + bz.x * 2);
      punch(sx, sy, 105 * fl, 0.8);
    }
    ctx.drawImage(lightCv, 0, 0);
    ctx.restore(); // back to native pixels for the HUD

    // ---- HUD -------------------------------------------------------------
    ctx.font = '600 15px ' + MONO;
    ctx.fillStyle = '#c8cdd7';
    ctx.globalAlpha = 0.9;
    ctx.fillText('FLOOR ' + D.floor, 26, 34);
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
    ctx.fillText(Math.ceil(D.hero.hp) + ' / ' + D.hero.maxHp, 32, 58);
    // mana bar under health
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(26, 66, hbW, 12);
    ctx.fillStyle = '#3a6ea8';
    ctx.fillRect(26, 66, hbW * Math.max(0, D.mana / D.st.manaMax), 12);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.strokeRect(26.5, 66.5, hbW - 1, 11);
    ctx.fillStyle = '#c8d8e8';
    ctx.font = '600 9px ' + MONO;
    ctx.fillText(Math.floor(D.mana) + ' / ' + D.st.manaMax, 32, 75);
    ctx.font = '600 13px ' + MONO;
    ctx.fillStyle = '#8fa2b8';
    ctx.fillText('ARMOR ' + D.st.def + (D.equip.shield ? '  ·  BLOCK ' + D.st.blk : ''), 26, 96);
    ctx.fillStyle = '#d9a94e';
    ctx.fillText('GOLD ' + D.hero.gold, 26, 116);
    let spellY = 136;
    if (knowsRaise()) {
      ctx.fillStyle = '#9fd8a8';
      ctx.fillText('[E] RAISE DEAD 20mp', 26, spellY);
      spellY += 20;
    }
    const sp = activeSpell();
    if (sp) {
      const spInfo = { bolt: ['#e8763d', 'FIREBOLT 12mp'], nova: ['#5aa2e8', 'FROST NOVA 22mp'] }[sp];
      ctx.fillStyle = spInfo[0];
      ctx.fillText('[F] ' + spInfo[1], 26, spellY);
    }
    // minimap: discovered rooms in the corner, Isaac-style
    if (D.running) {
      const MS = 15, MG = 3;
      const mapW = GW * (MS + MG) - MG;
      const mx0 = W - mapW - 26, my0 = 26;
      const discovered = r => r.visited ||
        D.rooms.some(o => o.visited && Math.abs(o.gx - r.gx) + Math.abs(o.gy - r.gy) === 1);
      ctx.globalAlpha = 0.85;
      for (const r of D.rooms) {
        if (!discovered(r)) continue;
        const rx = mx0 + r.gx * (MS + MG), ry = my0 + r.gy * (MS + MG);
        if (r === D.curRoom) {
          ctx.fillStyle = '#c8cdd7';
          ctx.fillRect(rx, ry, MS, MS);
        } else if (r.visited) {
          ctx.fillStyle = '#565b48';
          ctx.fillRect(rx, ry, MS, MS);
        } else {
          ctx.strokeStyle = 'rgba(200, 205, 215, 0.4)';
          ctx.lineWidth = 1;
          ctx.strokeRect(rx + 0.5, ry + 0.5, MS - 1, MS - 1);
        }
        const mk = r.type === 'boss' ? '#a4372e' :
          r.type === 'treasure' ? '#b06ae0' :
          r.type === 'shop' ? '#d9a94e' : null;
        if (mk) {
          ctx.fillStyle = mk;
          ctx.fillRect(rx + MS / 2 - 2, ry + MS / 2 - 2, 5, 5);
        }
      }
      ctx.globalAlpha = 1;
    }
    const hbX = W / 2 - (4 * (SLOT + GAP) - GAP) / 2;
    for (let i = 0; i < 4; i++) {
      const s = { x: hbX + i * (SLOT + GAP), y: H - SLOT - 18 };
      drawSlot(s, D.hotbar[i], false);
      ctx.fillStyle = '#8a8f80';
      ctx.font = '600 10px ' + MONO;
      ctx.fillText('' + (i + 1), s.x + 4, s.y + 13);
    }
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
      const cw2 = 190, chh2 = 210, gap2 = 24;
      const x0 = W / 2 - (3 * cw2 + 2 * gap2) / 2;
      const y0 = H / 2 - chh2 / 2;
      ctx.font = '800 30px ' + MONO;
      ctx.fillStyle = '#c8cdd7';
      ctx.fillText('CHOOSE YOUR CLASS', W / 2, y0 - 40);
      D.clsBtns = [];
      CLASS_KEYS.forEach((ck, i) => {
        const cx2 = x0 + i * (cw2 + gap2);
        const cd = CLASSES[ck];
        const hov = D.invMx >= cx2 && D.invMx <= cx2 + cw2 && D.invMy >= y0 && D.invMy <= y0 + chh2;
        ctx.fillStyle = hov ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.05)';
        ctx.fillRect(cx2, y0, cw2, chh2);
        ctx.strokeStyle = cd.color;
        ctx.lineWidth = hov ? 2.5 : 1.5;
        ctx.strokeRect(cx2 + 0.75, y0 + 0.75, cw2 - 1.5, chh2 - 1.5);
        const hs = HERO_SETS[ck].F1;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(hs, cx2 + cw2 / 2 - 24, y0 + 30, 48, 52);
        ctx.fillStyle = cd.color;
        ctx.font = '800 15px ' + MONO;
        ctx.fillText(cd.name, cx2 + cw2 / 2, y0 + 118);
        ctx.fillStyle = '#8a8f80';
        ctx.font = '600 10px ' + MONO;
        ctx.fillText(cd.blurb, cx2 + cw2 / 2, y0 + 142);
        ctx.fillText('[' + (i + 1) + ']', cx2 + cw2 / 2, y0 + chh2 - 14);
        D.clsBtns.push({ x: cx2, y: y0, w: cw2, h: chh2, cls: ck });
      });
      ctx.font = '600 12px ' + MONO;
      ctx.fillStyle = '#8a8f80';
      ctx.fillText('WASD MOVES · MOUSE AIMS · LMB SWINGS · RMB BLOCKS · F CASTS · TAB BAG', W / 2, y0 + chh2 + 44);
      ctx.textAlign = 'left';
      drawPointer(D.invMx, D.invMy);
      ctx.textAlign = 'center';
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
      ctx.fillText('floor ' + D.floor + ' · ' + D.hero.gold + ' gold · ' + D.relics.length + ' relics · Enter or click to retry', W / 2, H / 2 + 26);
    }
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    if (D.running && !D.inv && !D.over) {
      const cxp = ARCADE_LOCK.cur.x, cyp = ARCADE_LOCK.cur.y;
      ctx.globalAlpha = 0.95;
      // dark halo so the reticle reads on any backdrop
      ctx.strokeStyle = 'rgba(10, 12, 6, 0.9)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cxp - 9, cyp); ctx.lineTo(cxp + 9, cyp);
      ctx.moveTo(cxp, cyp - 9); ctx.lineTo(cxp, cyp + 9);
      ctx.stroke();
      ctx.strokeStyle = '#e8e0c8';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(cxp - 8, cyp); ctx.lineTo(cxp + 8, cyp);
      ctx.moveTo(cxp, cyp - 8); ctx.lineTo(cxp, cyp + 8);
      ctx.stroke();
      ctx.fillStyle = '#e8a33d';
      ctx.fillRect(cxp - 1.5, cyp - 1.5, 3, 3);
      ctx.globalAlpha = 1;
    }

    if (D.inv) drawInventory();
    ctx.imageSmoothingEnabled = true;
  }

  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 1 / 30);
    if (window.MODE === 'dungeon') {
      // menu-ish states get a visible OS cursor (the inventory draws its
      // own canvas pointer instead); if the pointer lock isn't actually
      // held mid-game, fall back to the OS cursor there too
      stageEl.classList.toggle('freecursor',
        (!D.inv && (D.over || !D.running || D.paused)) || (!D.inv && !ARCADE_LOCK.locked()));
      if (!D.paused) {
        if (D.running) update(dt);
        draw();
      }
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
