'use strict';
// ---- NEON CARDS: poker / blackjack / solitaire --------------------------
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const A = window.ARCADE;
  const menuEl = document.getElementById('cardsMenu');
  const launchEl = document.getElementById('launchOverlay');

  const CYAN = '#8fce9a', MAGENTA = '#e0459b', LIME = '#e6cf5e', INK = '#ececf1';
  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const isRed = s => s === 1 || s === 2;
  const MONO = 'Consolas, "Courier New", monospace';

  const stageEl = document.getElementById('stage');
  const C = { view: 'menu', chips: 200, mx: -1, my: -1 };
  try { C.chips = parseInt(localStorage.getItem('cardChips'), 10) || 200; } catch (e) {}
  function saveChips() {
    try { localStorage.setItem('cardChips', String(C.chips)); } catch (e) {}
  }
  function comp() {
    // busted wallets get comped back to 200 so play never dead-ends
    if (C.chips < 25) C.chips = 200;
  }

  function newDeck() {
    const d = [];
    for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) d.push({ r, s });
    for (let i = d.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [d[i], d[j]] = [d[j], d[i]];
    }
    return d;
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const inRect = (px, py, b) => b && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h;

  // ---- LCD skin (matches the splash screen) for the poker table ---------
  const LBG = '#c3c8b2', LCARD = '#cfd4be', LINK = '#2a2e22', LDIM = '#565b48';
  // drop shadows retired — this now just guarantees a clean shadow state
  function lcdShadow() {
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; ctx.shadowBlur = 0;
  }
  function lcdText(txt, x, y, size, color, align) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = color || LINK;
    ctx.font = '600 ' + size + 'px ' + MONO;
    ctx.textAlign = align || 'left';
    ctx.fillText(txt, x, y);
    lcdShadow(false);
    ctx.textAlign = 'left';
  }
  function lcdCard(x, y, w, h, card, faceUp, hover) {
    ctx.globalAlpha = 1;
    lcdShadow(true);
    if (!faceUp) {
      ctx.fillStyle = LINK;
      rr(x, y, w, h, 6); ctx.fill();
      lcdShadow(false);
      ctx.save();
      rr(x + 5, y + 5, w - 10, h - 10, 4); ctx.clip();
      ctx.strokeStyle = LBG;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      for (let d = -h; d < w; d += 8) { ctx.moveTo(x + d, y + h); ctx.lineTo(x + d + h, y); }
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.fillStyle = hover ? '#dde2c9' : LCARD;
    rr(x, y, w, h, 6); ctx.fill();
    lcdShadow(false);
    ctx.strokeStyle = LINK;
    ctx.lineWidth = hover ? 2 : 1.5;
    ctx.globalAlpha = 1;
    rr(x + 0.75, y + 0.75, w - 1.5, h - 1.5, 6); ctx.stroke();
    ctx.fillStyle = LINK;
    ctx.font = '600 ' + Math.round(w * 0.28) + 'px ' + MONO;
    ctx.textAlign = 'left';
    ctx.fillText(RANKS[card.r - 1], x + w * 0.1, y + w * 0.36);
    ctx.textAlign = 'center';
    ctx.font = Math.round(w * 0.5) + 'px ' + MONO;
    ctx.fillText(SUITS[card.s], x + w / 2, y + h * 0.68);
    ctx.textAlign = 'left';
  }
  function lcdButton(label, x, y, w, h, active) {
    const hover = active && C.mx >= x && C.mx <= x + w && C.my >= y && C.my <= y + h;
    ctx.globalAlpha = active ? 1 : 0.3;
    lcdShadow(true);
    ctx.fillStyle = hover ? '#dde2c9' : LINK;
    rr(x, y, w, h, 4); ctx.fill();
    lcdShadow(false);
    if (hover) {
      ctx.strokeStyle = LINK;
      ctx.lineWidth = 1.5;
      rr(x + 0.75, y + 0.75, w - 1.5, h - 1.5, 4); ctx.stroke();
    }
    ctx.fillStyle = hover ? LINK : LBG;
    ctx.font = '600 13px ' + MONO;
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y + h / 2 + 5);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    return { x, y, w, h, label };
  }

  // ---- poker: heads-up limit texas hold'em vs the house -----------------
  // Blinds 5/10, bets fixed at 10 preflop/flop and 20 on turn/river,
  // max 4 raises per street. Button alternates each hand; heads-up rules
  // (button posts the small blind and acts first preflop, last after).
  const HU = {
    cpu: 500, deck: [], pHole: [], cHole: [], board: [],
    pot: 0, curP: 0, curC: 0, actedP: false, actedC: false,
    raises: 0, street: 0, button: false, allIn: false,
    state: 'idle', msg: '', showCpu: false, at: 0, btns: [],
  };
  const HAND_NAMES = ['HIGH CARD', 'PAIR', 'TWO PAIR', 'THREE OF A KIND', 'STRAIGHT',
    'FLUSH', 'FULL HOUSE', 'FOUR OF A KIND', 'STRAIGHT FLUSH'];
  const rankHigh = r => r === 1 ? 14 : r;
  function score5(cs) {
    const rs = cs.map(c => rankHigh(c.r)).sort((a, b) => b - a);
    const cnt = {};
    for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
    const groups = Object.keys(cnt).map(Number).sort((a, b) => (cnt[b] - cnt[a]) || (b - a));
    const flush = cs.every(c => c.s === cs[0].s);
    const uniq = [...new Set(rs)];
    let straightHigh = 0;
    if (uniq.length === 5) {
      if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
      else if (uniq.join() === '14,5,4,3,2') straightHigh = 5;
    }
    const kick = groups.flatMap(r => Array(cnt[r]).fill(r));
    if (flush && straightHigh) return [8, straightHigh];
    if (cnt[groups[0]] === 4) return [7, ...kick];
    if (cnt[groups[0]] === 3 && cnt[groups[1]] === 2) return [6, ...kick];
    if (flush) return [5, ...rs];
    if (straightHigh) return [4, straightHigh];
    if (cnt[groups[0]] === 3) return [3, ...kick];
    if (cnt[groups[0]] === 2 && cnt[groups[1]] === 2) return [2, ...kick];
    if (cnt[groups[0]] === 2) return [1, ...kick];
    return [0, ...rs];
  }
  function cmpScore(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  function best7(cs) {
    let best = null;
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) {
      const s = score5(cs.filter((_, k) => k !== i && k !== j));
      if (!best || cmpScore(s, best) > 0) best = s;
    }
    return best;
  }

  function startPoker() {
    comp();
    if (HU.cpu < 40) HU.cpu = 500;
    newHand();
  }
  const unit = () => HU.street < 2 ? 10 : 20;
  const highBet = () => Math.max(HU.curP, HU.curC);
  function cpuLater() {
    HU.state = 'cpu';
    HU.at = performance.now() + 650 + Math.random() * 550;
  }
  function newHand() {
    comp();
    if (HU.cpu < 40) HU.cpu = 500;
    HU.deck = newDeck();
    HU.pHole = [HU.deck.pop(), HU.deck.pop()];
    HU.cHole = [HU.deck.pop(), HU.deck.pop()];
    HU.board = [];
    HU.pot = 0; HU.street = 0; HU.raises = 1; // big blind counts as first bet
    HU.allIn = false;
    HU.showCpu = false; HU.msg = '';
    HU.actedP = false; HU.actedC = false;
    HU.button = !HU.button;
    if (HU.button) {
      C.chips -= 5; HU.cpu -= 10;
      HU.curP = 5; HU.curC = 10;
      HU.state = 'player';   // player is small blind and acts first
    } else {
      C.chips -= 10; HU.cpu -= 5;
      HU.curP = 10; HU.curC = 5;
      cpuLater();
    }
    saveChips();
    A.bleep(520, 0.04, 'triangle', 0.03);
  }
  function endHand(winner, reason) {
    HU.pot += HU.curP + HU.curC;
    HU.curP = 0; HU.curC = 0;
    if (winner === 'p') { C.chips += HU.pot; A.sweep(500, 60, 0.4, 'sawtooth', 0.06); }
    else if (winner === 'c') { HU.cpu += HU.pot; A.bleep(200, 0.14, 'sawtooth', 0.04); }
    else { C.chips += HU.pot / 2; HU.cpu += HU.pot / 2; A.bleep(400, 0.08, 'triangle', 0.03); }
    HU.msg = winner === 'p' ? reason + '  +' + HU.pot : winner === null ? reason + '  ·  SPLIT' : reason;
    HU.pot = 0;
    HU.state = 'done';
    saveChips();
  }
  function doFold(who) {
    HU.showCpu = false;
    endHand(who === 'p' ? 'c' : 'p', who === 'p' ? 'YOU FOLD' : 'CPU FOLDS');
  }
  function doCheckCall(who) {
    const need = highBet() - (who === 'p' ? HU.curP : HU.curC);
    if (who === 'p') { const pay = Math.min(need, C.chips); C.chips -= pay; HU.curP += pay; HU.actedP = true; }
    else { const pay = Math.min(need, HU.cpu); HU.cpu -= pay; HU.curC += pay; HU.actedC = true; }
    A.bleep(need > 0 ? 600 : 440, 0.025, 'triangle', 0.025);
    afterAction(who);
  }
  function canRaise(who) {
    const stack = who === 'p' ? C.chips : HU.cpu;
    const cur = who === 'p' ? HU.curP : HU.curC;
    return HU.raises < 4 && stack >= (highBet() - cur) + unit();
  }
  function doRaise(who) {
    if (!canRaise(who)) { doCheckCall(who); return; }
    const target = highBet() + unit();
    if (who === 'p') { C.chips -= target - HU.curP; HU.curP = target; HU.actedP = true; HU.actedC = false; }
    else { HU.cpu -= target - HU.curC; HU.curC = target; HU.actedC = true; HU.actedP = false; }
    HU.raises++;
    A.bleep(720, 0.04, 'square', 0.03);
    afterAction(who);
  }
  // shove everything — capped at what the other stack can actually cover,
  // so heads-up needs no side pots
  function doAllIn(who) {
    const myCur = who === 'p' ? HU.curP : HU.curC;
    const myStack = who === 'p' ? C.chips : HU.cpu;
    const opCur = who === 'p' ? HU.curC : HU.curP;
    const opStack = who === 'p' ? HU.cpu : C.chips;
    const target = Math.min(myCur + myStack, opCur + opStack);
    if (target <= highBet()) { doCheckCall(who); return; }
    if (who === 'p') { C.chips -= target - HU.curP; HU.curP = target; HU.actedP = true; HU.actedC = false; }
    else { HU.cpu -= target - HU.curC; HU.curC = target; HU.actedC = true; HU.actedP = false; }
    HU.allIn = true;
    HU.raises = 9; // no re-raising an all-in
    A.sweep(300, 80, 0.3, 'sawtooth', 0.05);
    afterAction(who);
  }
  function afterAction(who) {
    saveChips();
    if (HU.actedP && HU.actedC && HU.curP === HU.curC) { advanceStreet(); return; }
    if (who === 'p') cpuLater(); else HU.state = 'player';
  }
  function advanceStreet() {
    HU.pot += HU.curP + HU.curC;
    HU.curP = 0; HU.curC = 0; HU.raises = 0;
    HU.actedP = false; HU.actedC = false;
    if (HU.street === 3) { showdown(); return; }
    // an all-in that's been called runs the rest of the board out face-up
    if (HU.allIn) {
      HU.showCpu = true;
      while (HU.board.length < 5) HU.board.push(HU.deck.pop());
      HU.street = 3;
      showdown();
      return;
    }
    HU.street++;
    if (HU.street === 1) HU.board.push(HU.deck.pop(), HU.deck.pop(), HU.deck.pop());
    else HU.board.push(HU.deck.pop());
    A.bleep(560, 0.03, 'triangle', 0.03);
    // postflop the non-button player acts first
    if (HU.button) cpuLater(); else HU.state = 'player';
  }
  function showdown() {
    HU.showCpu = true;
    const ps = best7([...HU.pHole, ...HU.board]);
    const cs = best7([...HU.cHole, ...HU.board]);
    const d = cmpScore(ps, cs);
    if (d > 0) endHand('p', 'YOU WIN · ' + HAND_NAMES[ps[0]]);
    else if (d < 0) endHand('c', 'CPU WINS · ' + HAND_NAMES[cs[0]]);
    else endHand(null, HAND_NAMES[ps[0]]);
  }
  // house AI: raw hand strength plus noise; bluffs a little, folds junk
  function cpuStrength() {
    if (HU.street === 0) {
      const hi = HU.cHole.map(c => rankHigh(c.r)).sort((a, b) => b - a);
      if (hi[0] === hi[1]) return 0.55 + hi[0] / 40;
      let s = (hi[0] + hi[1]) / 54;
      if (HU.cHole[0].s === HU.cHole[1].s) s += 0.06;
      if (hi[0] - hi[1] === 1) s += 0.04;
      return s;
    }
    const sc = best7([...HU.cHole, ...HU.board]);
    return Math.min(1, sc[0] / 8 + (sc[1] || 0) / 120 + (sc[0] > 0 ? 0.08 : 0));
  }
  function cpuAct() {
    const need = highBet() - HU.curC;
    const facing = need > 0;
    const s = cpuStrength() + (Math.random() - 0.5) * 0.16;
    // a monster occasionally shoves
    if (s > 0.86 && !HU.allIn && Math.random() < 0.5) { doAllIn('c'); return; }
    // calling an all-in (or any oversized bet) takes a real hand
    const callThr = need > unit() * 2 ? 0.5 : 0.33;
    if (s > 0.6 && canRaise('c')) doRaise('c');
    else if (!facing) {
      if (Math.random() < 0.12 && canRaise('c')) doRaise('c');
      else doCheckCall('c');
    }
    else if (s > callThr || Math.random() < 0.08) doCheckCall('c');
    else doFold('c');
  }
  // left-side reference: every hand type with a mini example hand
  const HAND_REF = [
    ['ROYAL FLUSH',  8, [['A', 0], ['K', 0], ['Q', 0], ['J', 0], ['10', 0]]],
    ['STR FLUSH',    8, [['9', 1], ['8', 1], ['7', 1], ['6', 1], ['5', 1]]],
    ['4 OF A KIND',  7, [['K', 0], ['K', 1], ['K', 2], ['K', 3], ['7', 0]]],
    ['FULL HOUSE',   6, [['Q', 0], ['Q', 1], ['Q', 2], ['4', 0], ['4', 3]]],
    ['FLUSH',        5, [['A', 3], ['J', 3], ['8', 3], ['6', 3], ['3', 3]]],
    ['STRAIGHT',     4, [['10', 0], ['9', 1], ['8', 2], ['7', 3], ['6', 0]]],
    ['3 OF A KIND',  3, [['7', 0], ['7', 1], ['7', 2], ['K', 3], ['2', 0]]],
    ['TWO PAIR',     2, [['J', 0], ['J', 1], ['4', 2], ['4', 3], ['9', 0]]],
    ['PAIR',         1, [['10', 0], ['10', 1], ['K', 2], ['6', 3], ['2', 0]]],
    ['HIGH CARD',    0, [['A', 0], ['Q', 1], ['9', 2], ['5', 3], ['3', 0]]],
  ];
  // shared side-panel geometry: the old left-edge slot and its right mirror
  function refGeom() {
    const W = innerWidth;
    const mw = 27, mg = 4;
    const pw = 5 * (mw + mg) - mg + 28;
    const cw = Math.min(84, W / 11), gap = cw * 0.22;
    const boardLeft = W / 2 - (5 * cw + 4 * gap) / 2;
    const near = boardLeft - 250;
    const x0L = Math.max(40, near - (near - 34) * 0.4);
    const pxL = x0L - 14;
    const pxR = W - pxL - pw;
    return { pw, pxL, x0L, pxR, x0R: pxR + 14 };
  }
  function bestOf(cs) {
    if (cs.length === 5) return score5(cs);
    if (cs.length === 6) {
      let best = null;
      for (let i = 0; i < 6; i++) {
        const s = score5(cs.filter((_, k) => k !== i));
        if (!best || cmpScore(s, best) > 0) best = s;
      }
      return best;
    }
    return best7(cs);
  }
  function drawHandRef() {
    const W = innerWidth, H = innerHeight;
    if (W < 980) return; // not enough room beside the table
    // which row matches your current best hand (once the flop is out)
    let hot = -1;
    if (HU.board.length >= 3 && HU.state !== 'idle') {
      const s = bestOf([...HU.pHole, ...HU.board]);
      hot = HAND_REF.findIndex(([, cat], i) =>
        cat === s[0] && (s[0] !== 8 || (i === 0) === (s[1] === 14)));
    }
    const mw = 27, mh = 37, mg = 4;
    const rowH = Math.min(72, Math.max(52, (H - 140) / HAND_REF.length));
    // mirrored to the right of the board, same distance as the old left spot
    const g2 = refGeom();
    const x0 = g2.x0R;
    const y0 = H / 2 - (HAND_REF.length * rowH) / 2 + 16;
    // panel frame + row dividers
    const pw = 5 * (mw + mg) - mg + 28;
    const px = x0 - 14, py = y0 - 26;
    const ph = HAND_REF.length * rowH + 18;
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = LINK;
    ctx.lineWidth = 1.5;
    lcdShadow(true);
    rr(px + 0.75, py + 0.75, pw - 1.5, ph - 1.5, 6); ctx.stroke();
    lcdShadow(false);
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < HAND_REF.length; i++) {
      const ly = y0 + i * rowH - 20.5;
      ctx.moveTo(px + 8, ly); ctx.lineTo(px + pw - 8, ly);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 0; i < HAND_REF.length; i++) {
      const [name, , cards] = HAND_REF[i];
      const y = y0 + i * rowH;
      const lit = i === hot;
      lcdText(name, x0, y, lit ? 14 : 12, lit ? LINK : LDIM);
      for (let j = 0; j < 5; j++) {
        const mx = x0 + j * (mw + mg), my = y + 7;
        ctx.globalAlpha = 1;
        ctx.fillStyle = lit ? LINK : LCARD;
        rr(mx, my, mw, mh, 3); ctx.fill();
        ctx.strokeStyle = LINK;
        ctx.lineWidth = 1;
        ctx.globalAlpha = lit ? 1 : 0.75;
        rr(mx + 0.5, my + 0.5, mw - 1, mh - 1, 3); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = lit ? LBG : LINK;
        ctx.textAlign = 'center';
        ctx.font = '600 12px ' + MONO;
        ctx.fillText(cards[j][0], mx + mw / 2, my + 15);
        ctx.font = '12px ' + MONO;
        ctx.fillText(SUITS[cards[j][1]], mx + mw / 2, my + 29);
        ctx.textAlign = 'left';
      }
    }
  }
  function drawPoker() {
    const W = innerWidth, H = innerHeight;
    const cw = Math.min(84, W / 11), chh = cw * 1.42, gap = cw * 0.22;
    // big bold title in the old guide slot on the left
    const tg = refGeom();
    ctx.fillStyle = LINK;
    ctx.font = '800 60px ' + MONO;
    ctx.textAlign = 'center';
    ctx.fillText("HOLD'EM", tg.pxL + tg.pw / 2, H * 0.25);
    lcdShadow(false);
    ctx.textAlign = 'left';
    // cpu hole cards, stack beside them
    const cy0 = H * 0.17;
    const cx0 = W / 2 - (2 * cw + gap) / 2;
    lcdText('CPU ' + HU.cpu, cx0 - 28, cy0 + chh / 2 + 6, 16, LINK, 'right');
    for (let i = 0; i < 2; i++) lcdCard(cx0 + i * (cw + gap), cy0, cw, chh, HU.cHole[i], HU.showCpu, false);
    if (HU.curC) lcdText('BET ' + HU.curC, W / 2, cy0 + chh + 24, 13, LDIM, 'center');
    if (HU.state === 'cpu') lcdText('CPU THINKING…', W / 2, cy0 + chh + 44, 11, LDIM, 'center');
    // board
    const bx0 = W / 2 - (5 * cw + 4 * gap) / 2, byy = H / 2 - chh / 2;
    lcdText('POT ' + (HU.pot + HU.curP + HU.curC), W / 2, byy - 16, 16, LINK, 'center');
    for (let i = 0; i < 5; i++) {
      const x = bx0 + i * (cw + gap);
      if (HU.board[i]) lcdCard(x, byy, cw, chh, HU.board[i], true, false);
      else {
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = LDIM;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        rr(x + 0.5, byy + 0.5, cw - 1, chh - 1, 6); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    }
    // player hole cards, stack beside them — the hand + buttons group is
    // centered in the space between the board and the bezel
    const boardBottom = H / 2 + chh / 2;
    const groupH = chh + 30 + 38;
    const py0 = (boardBottom + (H - 18)) / 2 - groupH / 2;
    lcdText('CHIPS ' + C.chips, cx0 - 28, py0 + chh / 2 + 6, 16, LINK, 'right');
    if (HU.button) lcdText('BUTTON', cx0 - 28, py0 + chh / 2 + 26, 11, LDIM, 'right');
    for (let i = 0; i < 2; i++) lcdCard(cx0 + i * (cw + gap), py0, cw, chh, HU.pHole[i], true, false);
    if (HU.curP) lcdText('BET ' + HU.curP, W / 2, py0 - 12, 13, LDIM, 'center');
    if (HU.msg) lcdText(HU.msg, W / 2, byy + chh + 42, 18, LINK, 'center');
    // actions
    HU.btns = [];
    const bw = 140, bh2 = 38, bg = 14, byb = py0 + chh + 30;
    if (HU.state === 'player') {
      const facing = highBet() - HU.curP > 0;
      const x0 = W / 2 - (4 * bw + 3 * bg) / 2;
      HU.btns.push(lcdButton('FOLD [F]', x0, byb, bw, bh2, true));
      HU.btns.push(lcdButton(facing ? 'CALL ' + (highBet() - HU.curP) + ' [C]' : 'CHECK [C]', x0 + bw + bg, byb, bw, bh2, true));
      HU.btns.push(lcdButton((highBet() > 0 ? 'RAISE ' : 'BET ') + unit() + ' [R]', x0 + 2 * (bw + bg), byb, bw, bh2, canRaise('p')));
      HU.btns.push(lcdButton('ALL IN [A]', x0 + 3 * (bw + bg), byb, bw, bh2, C.chips > 0));
    } else if (HU.state === 'done') {
      HU.btns.push(lcdButton('DEAL', W / 2 - bw / 2, byb, bw, bh2, true));
      lcdText('enter deals again', W / 2, byb + bh2 + 26, 11, LDIM, 'center');
    }
    drawHandRef();
  }
  function pokerClick(x, y) {
    for (const b of HU.btns) {
      if (inRect(x, y, b)) {
        if (b.label.startsWith('FOLD')) doFold('p');
        else if (b.label.startsWith('CALL') || b.label.startsWith('CHECK')) doCheckCall('p');
        else if (b.label.startsWith('RAISE') || b.label.startsWith('BET')) doRaise('p');
        else if (b.label.startsWith('ALL IN')) doAllIn('p');
        else newHand();
        return;
      }
    }
  }

  // ---- blackjack --------------------------------------------------------
  const BJ = { deck: [], player: [], dealer: [], phase: 'play', msg: '', bet: 25, canDouble: false, btns: [] };
  function bjValue(hand) {
    let v = 0, aces = 0;
    for (const c of hand) { v += c.r === 1 ? 11 : Math.min(10, c.r); if (c.r === 1) aces++; }
    while (v > 21 && aces > 0) { v -= 10; aces--; }
    return v;
  }
  function startBlackjack() {
    comp();
    BJ.bet = 25;
    C.chips -= BJ.bet; saveChips();
    BJ.deck = newDeck();
    BJ.player = [BJ.deck.pop(), BJ.deck.pop()];
    BJ.dealer = [BJ.deck.pop(), BJ.deck.pop()];
    BJ.phase = 'play';
    BJ.msg = '';
    BJ.canDouble = C.chips >= BJ.bet;
    A.bleep(520, 0.04, 'triangle', 0.03);
    if (bjValue(BJ.player) === 21) {
      if (bjValue(BJ.dealer) === 21) { BJ.msg = 'PUSH'; C.chips += BJ.bet; }
      else { BJ.msg = 'BLACKJACK  +' + (BJ.bet * 1.5); C.chips += BJ.bet * 2.5; A.sweep(500, 60, 0.4, 'sawtooth', 0.06); }
      saveChips();
      BJ.phase = 'done';
    }
  }
  function bjResolve() {
    while (bjValue(BJ.dealer) < 17) BJ.dealer.push(BJ.deck.pop());
    const p = bjValue(BJ.player), d = bjValue(BJ.dealer);
    if (d > 21 || p > d) { BJ.msg = 'YOU WIN  +' + BJ.bet; C.chips += BJ.bet * 2; A.sweep(500, 60, 0.4, 'sawtooth', 0.06); }
    else if (p === d) { BJ.msg = 'PUSH'; C.chips += BJ.bet; A.bleep(400, 0.08, 'triangle', 0.03); }
    else { BJ.msg = 'DEALER WINS'; A.bleep(200, 0.14, 'sawtooth', 0.04); }
    saveChips();
    BJ.phase = 'done';
  }
  function bjHit() {
    if (BJ.phase !== 'play') return;
    BJ.player.push(BJ.deck.pop());
    BJ.canDouble = false;
    A.bleep(600, 0.03, 'triangle', 0.025);
    if (bjValue(BJ.player) > 21) {
      BJ.msg = 'BUST';
      BJ.phase = 'done';
      A.bleep(180, 0.2, 'sawtooth', 0.05);
    }
  }
  function bjDouble() {
    if (BJ.phase !== 'play' || !BJ.canDouble) return;
    C.chips -= BJ.bet; BJ.bet *= 2; saveChips();
    BJ.player.push(BJ.deck.pop());
    if (bjValue(BJ.player) > 21) {
      BJ.msg = 'BUST';
      BJ.phase = 'done';
      A.bleep(180, 0.2, 'sawtooth', 0.05);
    } else bjResolve();
  }
  function drawBlackjack() {
    const W = innerWidth, H = innerHeight;
    const cw = Math.min(92, W / 9), chh = cw * 1.45, gap = cw * 0.28;
    // big bold title in the left slot, like the poker table
    const tg = refGeom();
    ctx.fillStyle = LINK;
    ctx.font = '800 44px ' + MONO;
    ctx.textAlign = 'center';
    ctx.fillText('BLACK', tg.pxL + tg.pw / 2, H * 0.25 - 24);
    ctx.fillText('JACK', tg.pxL + tg.pw / 2, H * 0.25 + 24);
    lcdShadow(false);
    ctx.textAlign = 'left';
    lcdText('CHIPS ' + C.chips, tg.pxL + tg.pw / 2, H * 0.25 + 64, 16, LINK, 'center');
    lcdText('BET ' + BJ.bet, tg.pxL + tg.pw / 2, H * 0.25 + 86, 13, LDIM, 'center');
    const drawHand = (hand, y, hideFirst) => {
      const x0 = W / 2 - (hand.length * cw + (hand.length - 1) * gap) / 2;
      for (let i = 0; i < hand.length; i++) {
        lcdCard(x0 + i * (cw + gap), y, cw, chh, hand[i], !(hideFirst && i === 0), false);
      }
    };
    const hide = BJ.phase === 'play';
    drawHand(BJ.dealer, H * 0.17, hide);
    lcdText('DEALER' + (hide ? '' : '  ' + bjValue(BJ.dealer)), W / 2, H * 0.17 - 14, 13, LDIM, 'center');
    drawHand(BJ.player, H * 0.56, false);
    lcdText('YOU  ' + bjValue(BJ.player), W / 2, H * 0.56 - 14, 13, LDIM, 'center');
    if (BJ.msg) lcdText(BJ.msg, W / 2, H * 0.47, 22, LINK, 'center');
    BJ.btns = [];
    const by = H * 0.56 + chh + 40, bw = 130, bh2 = 38, bg = 18;
    if (BJ.phase === 'play') {
      const x0 = W / 2 - (3 * bw + 2 * bg) / 2;
      BJ.btns.push(lcdButton('HIT [H]', x0, by, bw, bh2, true));
      BJ.btns.push(lcdButton('STAND [S]', x0 + bw + bg, by, bw, bh2, true));
      BJ.btns.push(lcdButton('DOUBLE [D]', x0 + 2 * (bw + bg), by, bw, bh2, BJ.canDouble));
    } else {
      BJ.btns.push(lcdButton('DEAL', W / 2 - bw / 2, by, bw, bh2, true));
      lcdText('enter deals again', W / 2, by + bh2 + 30, 12, LDIM, 'center');
    }
  }
  function bjClick(x, y) {
    for (const b of BJ.btns) {
      if (inRect(x, y, b)) {
        if (b.label.startsWith('HIT')) bjHit();
        else if (b.label.startsWith('STAND')) bjResolve();
        else if (b.label.startsWith('DOUBLE')) bjDouble();
        else startBlackjack();
        return;
      }
    }
  }

  // ---- solitaire: klondike, draw one, click to auto-move ----------------
  const SOL = { stock: [], waste: [], found: [[], [], [], []], tab: [], won: false };
  function startSolitaire() {
    const d = newDeck();
    SOL.stock = []; SOL.waste = []; SOL.found = [[], [], [], []]; SOL.tab = []; SOL.won = false;
    for (let i = 0; i < 7; i++) {
      const pile = [];
      for (let j = 0; j <= i; j++) pile.push({ c: d.pop(), up: j === i });
      SOL.tab.push(pile);
    }
    while (d.length) SOL.stock.push(d.pop());
    A.bleep(520, 0.04, 'triangle', 0.03);
  }
  function solLayout() {
    const W = innerWidth, H = innerHeight;
    const cw = Math.min(86, (W - 160) / 8), chh = cw * 1.4;
    const gap = (Math.min(W, 7 * (cw + 24)) - 7 * cw) / 8;
    const total = 7 * cw + 6 * gap;
    const x0 = W / 2 - total / 2;
    const colX = i => x0 + i * (cw + gap);
    return { cw, chh, colX, y0: 64, y1: 64 + chh + 34, dyUp: Math.max(22, chh * 0.24), dyDown: 10 };
  }
  function canFound(c, f) {
    const top = f[f.length - 1];
    return top ? (top.s === c.s && c.r === top.r + 1) : c.r === 1;
  }
  function canTab(c, pile) {
    const top = pile[pile.length - 1];
    return top ? (top.up && isRed(top.c.s) !== isRed(c.s) && c.r === top.c.r - 1) : c.r === 13;
  }
  function solFlip(pile) {
    if (pile.length && !pile[pile.length - 1].up) pile[pile.length - 1].up = true;
  }
  function solWinCheck() {
    if (SOL.found.every(f => f.length === 13)) {
      SOL.won = true;
      A.sweep(500, 60, 0.8, 'sawtooth', 0.08);
      A.hat(0.1, 0.2);
    }
  }
  // try to move a single card (from waste or a tableau top) somewhere useful
  function solMoveSingle(card, removeFn) {
    for (const f of SOL.found) {
      if (canFound(card, f)) {
        removeFn(); f.push(card);
        A.bleep(760, 0.03, 'triangle', 0.03);
        solWinCheck();
        return true;
      }
    }
    for (const pile of SOL.tab) {
      if (canTab(card, pile)) {
        removeFn(); pile.push({ c: card, up: true });
        A.bleep(600, 0.03, 'triangle', 0.025);
        return true;
      }
    }
    return false;
  }
  // shared hit-test so clicking and hover highlighting always agree
  function solHit(x, y) {
    const L = solLayout();
    if (inRect(x, y, { x: L.colX(0), y: L.y0, w: L.cw, h: L.chh })) return { type: 'stock' };
    if (SOL.waste.length && inRect(x, y, { x: L.colX(1), y: L.y0, w: L.cw, h: L.chh })) return { type: 'waste' };
    for (let i = 0; i < 7; i++) {
      const pile = SOL.tab[i];
      if (x < L.colX(i) || x > L.colX(i) + L.cw) continue;
      let cy = L.y1;
      const tops = [];
      for (let j = 0; j < pile.length; j++) {
        tops.push(cy);
        cy += pile[j].up ? L.dyUp : L.dyDown;
      }
      for (let j = pile.length - 1; j >= 0; j--) {
        const bottom = j === pile.length - 1 ? tops[j] + L.chh : tops[j + 1];
        if (y >= tops[j] && y <= bottom) return pile[j].up ? { type: 'tab', i, j } : null;
      }
    }
    return null;
  }
  function solClick(x, y) {
    if (SOL.won) { startSolitaire(); return; }
    const hit = solHit(x, y);
    if (!hit) return;
    if (hit.type === 'stock') {
      if (SOL.stock.length) SOL.waste.push(SOL.stock.pop());
      else { SOL.stock = SOL.waste.reverse(); SOL.waste = []; }
      A.bleep(520, 0.02, 'square', 0.02);
    } else if (hit.type === 'waste') {
      const card = SOL.waste[SOL.waste.length - 1];
      solMoveSingle(card, () => SOL.waste.pop());
    } else {
      const pile = SOL.tab[hit.i];
      const run = pile.slice(hit.j);
      if (run.length === 1) {
        if (solMoveSingle(run[0].c, () => pile.pop())) solFlip(pile);
      } else {
        for (const dest of SOL.tab) {
          if (dest !== pile && canTab(run[0].c, dest)) {
            pile.splice(hit.j);
            for (const e of run) dest.push(e);
            solFlip(pile);
            A.bleep(600, 0.03, 'triangle', 0.025);
            break;
          }
        }
      }
    }
  }
  function drawSolitaire() {
    const W = innerWidth, H = innerHeight;
    const L = solLayout();
    lcdText('SOLITAIRE', W - 34, 46, 17, LINK, 'right');
    lcdText('R redeals', W - 34, 68, 12, LDIM, 'right');
    const hov = SOL.won ? null : solHit(C.mx, C.my);
    // stock
    if (SOL.stock.length) lcdCard(L.colX(0), L.y0, L.cw, L.chh, null, false, hov && hov.type === 'stock');
    else {
      ctx.globalAlpha = hov && hov.type === 'stock' ? 0.8 : 0.35;
      ctx.strokeStyle = LDIM; ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      rr(L.colX(0) + 0.5, L.y0 + 0.5, L.cw - 1, L.chh - 1, 6); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // waste
    if (SOL.waste.length) lcdCard(L.colX(1), L.y0, L.cw, L.chh, SOL.waste[SOL.waste.length - 1], true, hov && hov.type === 'waste');
    // foundations
    for (let i = 0; i < 4; i++) {
      const f = SOL.found[i], fx = L.colX(3 + i);
      if (f.length) lcdCard(fx, L.y0, L.cw, L.chh, f[f.length - 1], true, false);
      else {
        ctx.globalAlpha = 0.35; ctx.strokeStyle = LDIM; ctx.lineWidth = 1;
        ctx.setLineDash([4, 5]);
        rr(fx + 0.5, L.y0 + 0.5, L.cw - 1, L.chh - 1, 6); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        lcdText('A', fx + L.cw / 2, L.y0 + L.chh / 2 + 6, 16, LDIM, 'center');
      }
    }
    // tableau: hovering a face-up card lights it and the run below it
    for (let i = 0; i < 7; i++) {
      const pile = SOL.tab[i];
      let cy = L.y1;
      for (let j = 0; j < pile.length; j++) {
        const lit = hov && hov.type === 'tab' && hov.i === i && j >= hov.j;
        lcdCard(L.colX(i), cy, L.cw, L.chh, pile[j].c, pile[j].up, lit);
        cy += pile[j].up ? L.dyUp : L.dyDown;
      }
    }
    if (SOL.won) {
      lcdText('CLEARED', W / 2, H / 2, 34, LINK, 'center');
      lcdText('click or enter for a new deal', W / 2, H / 2 + 34, 13, LDIM, 'center');
    }
  }

  // ---- shell ------------------------------------------------------------
  function showMenu() {
    C.view = 'menu';
    menuEl.classList.remove('hidden');
  }
  function quitToArcade() {
    C.view = 'menu';
    A.setStyle('neon');
    stageEl.classList.remove('freecursor');
    menuEl.classList.add('hidden');
    launchEl.classList.remove('hidden');
    window.MODE = 'menu';
  }
  document.getElementById('pickCards').addEventListener('click', () => {
    window.MODE = 'cards';
    A.setStyle('openttd');
    stageEl.classList.add('freecursor');
    launchEl.classList.add('hidden');
    showMenu();
  });
  addEventListener('pointermove', e => {
    if (window.MODE === 'cards') { C.mx = e.clientX; C.my = e.clientY; }
  });
  const startFns = { poker: startPoker, blackjack: startBlackjack, solitaire: startSolitaire };
  for (const view of ['poker', 'blackjack', 'solitaire']) {
    document.getElementById('pick' + view[0].toUpperCase() + view.slice(1)).addEventListener('click', () => {
      C.view = view;
      menuEl.classList.add('hidden');
      A.audio(); A.startMusic();
      startFns[view]();
    });
  }
  addEventListener('keydown', e => {
    if (window.MODE !== 'cards') return;
    if (C.view === 'menu') {
      if (e.key === 'Escape' || e.key === 'q' || e.key === 'Q') quitToArcade();
      return;
    }
    if (e.key === 'Escape') { showMenu(); return; }
    if (C.view === 'poker') {
      if (HU.state === 'player') {
        if (e.key === 'f' || e.key === 'F') doFold('p');
        else if (e.key === 'c' || e.key === 'C') doCheckCall('p');
        else if (e.key === 'r' || e.key === 'R') doRaise('p');
        else if (e.key === 'a' || e.key === 'A') doAllIn('p');
      }
      if (e.key === 'Enter' && HU.state === 'done') newHand();
    }
    if (C.view === 'blackjack') {
      if (e.key === 'h' || e.key === 'H') bjHit();
      if (e.key === 's' || e.key === 'S') bjResolve();
      if (e.key === 'd' || e.key === 'D') bjDouble();
      if (e.key === 'Enter' && BJ.phase === 'done') startBlackjack();
    }
    if (C.view === 'solitaire') {
      if (e.key === 'r' || e.key === 'R') startSolitaire();
      if (e.key === 'Enter' && SOL.won) startSolitaire();
    }
  });
  addEventListener('pointerdown', e => {
    if (window.MODE !== 'cards' || C.view === 'menu' || e.button !== 0) return;
    if (C.view === 'poker') pokerClick(e.clientX, e.clientY);
    else if (C.view === 'blackjack') bjClick(e.clientX, e.clientY);
    else if (C.view === 'solitaire') solClick(e.clientX, e.clientY);
  });

  function frame() {
    if (window.MODE === 'cards') {
      const W = innerWidth, H = innerHeight;
      ctx.globalAlpha = 1;
      // LCD screen, same flat sage as the splash
      ctx.fillStyle = LBG;
      ctx.fillRect(0, 0, W, H);
      if (C.view === 'poker' && HU.state === 'cpu' && performance.now() >= HU.at) cpuAct();
      if (C.view === 'poker') drawPoker();
      else if (C.view === 'blackjack') drawBlackjack();
      else if (C.view === 'solitaire') drawSolitaire();
      if (C.view !== 'menu') ARCADE_FX.bezel(ctx);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
