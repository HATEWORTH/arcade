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

// ---- shared CRT bezel: the rounded tube frame every screen sits behind --
// fine static grain used to dither the low-alpha gradient washes —
// without it the 8-bit gradients band visibly on the near-black substrate
let grainPat = null;
function grainPattern(ctx) {
  if (grainPat) return grainPat;
  const c = document.createElement('canvas');
  c.width = 160; c.height = 160;
  const g = c.getContext('2d');
  const img = g.createImageData(160, 160);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() < 0.5 ? 0 : 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 9; // ~3.5% alpha, half lightening, half darkening
  }
  g.putImageData(img, 0, 0);
  grainPat = ctx.createPattern(c, 'repeat');
  return grainPat;
}

window.ARCADE_FX = {
  grain(ctx) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = grainPattern(ctx);
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  },
  // dark-LCD substrate: same glass as the sage screens with the backlight
  // off — olive-tinted black, a faint warm hotspot, edges falling away
  screen(ctx) {
    const W = innerWidth, H = innerHeight;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#12140d';
    ctx.fillRect(0, 0, W, H);
    let g = ctx.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.62);
    g.addColorStop(0, 'rgba(214, 226, 168, 0.05)');
    g.addColorStop(1, 'rgba(214, 226, 168, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.78);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0.32)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    this.grain(ctx);
  },
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
