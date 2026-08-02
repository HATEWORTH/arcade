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

// ---- pause menu buttons: dispatch to whichever game is active -----------
// pointerdown is swallowed so the games' "click resumes" handlers don't
// fire when the click was meant for a button
addEventListener('DOMContentLoaded', () => {
  for (const [id, evt] of [['pauseMenuBtn', 'arcadequit'], ['pauseRestartBtn', 'arcaderestart']]) {
    const btn = document.getElementById(id);
    btn.addEventListener('pointerdown', e => e.stopPropagation());
    btn.addEventListener('click', () => dispatchEvent(new CustomEvent(evt)));
  }
});

// ---- shared screen fill -------------------------------------------------
window.ARCADE_FX = {
  // dark-LCD substrate: same glass as the sage screens, backlight off
  screen(ctx) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#12140d';
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  },
};
