'use strict';
// ---- shared cursor lock: games capture the pointer, Esc releases it -----
// While locked, the OS cursor is hidden and events only carry movement
// deltas, so a virtual cursor position is tracked here for games to read.
window.ARCADE_LOCK = (() => {
  const canvas = document.getElementById('c');
  const cur = { x: innerWidth / 2, y: innerHeight / 2 };
  let wantLock = false;
  const locked = () => document.pointerLockElement === canvas;
  function lock() {
    wantLock = true;
    if (!locked()) {
      try {
        const p = canvas.requestPointerLock();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* not available; game stays playable unlocked */ }
    }
  }
  function unlock() {
    wantLock = false;
    if (locked()) document.exitPointerLock();
  }
  addEventListener('pointermove', e => {
    if (locked()) {
      // per-game locked-cursor sensitivity: aiming in geo wants a quicker hand
      const SENS = window.MODE === 'geo' ? 0.9 : 0.6;
      cur.x = Math.max(0, Math.min(innerWidth, cur.x + e.movementX * SENS));
      cur.y = Math.max(0, Math.min(innerHeight, cur.y + e.movementY * SENS));
    } else {
      cur.x = e.clientX; cur.y = e.clientY;
    }
  });
  // Esc is consumed by the browser when it releases the lock, so games
  // listen for this event to pause themselves when the cursor escapes
  document.addEventListener('pointerlockchange', () => {
    if (!locked() && wantLock) {
      wantLock = false;
      dispatchEvent(new CustomEvent('arcadecursorunlock'));
    }
  });
  return { cur, lock, unlock, locked };
})();

// ---- shared CRT bezel: the rounded tube frame every screen sits behind --
window.ARCADE_FX = {
  bezel(ctx) {
    const W = innerWidth, H = innerHeight;
    const inset = 18, rad = 38;
    const x = inset, y = inset, w = W - inset * 2, h = H - inset * 2;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
    ctx.shadowColor = 'rgba(20, 22, 15, 0.55)';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#14160f';
    ctx.fill('evenodd');
    ctx.restore();
  },
};
