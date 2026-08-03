'use strict';
// ---- canvas sizing: one owner for the whole cabinet ---------------------
// Every game draws into the same #c in CSS pixels and assumes the backing
// store has been scaled for the display. This used to live inside pong.js,
// which meant deleting pong.js silently un-sized Tetris, Snake, Cards and the
// dungeon. It belongs here, where it runs before any game loads.
window.ARCADE_VIEW = (() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const view = { w: 0, h: 0, dpr: 1 };
  function resize() {
    view.dpr = Math.min(devicePixelRatio || 1, 2);
    view.w = innerWidth;
    view.h = innerHeight;
    canvas.width = view.w * view.dpr;
    canvas.height = view.h * view.dpr;
    // resetting width/height clears the transform, so re-apply it
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }
  addEventListener('resize', resize);
  resize();
  return view;
})();

// ---- shared cursor lock: games capture the pointer, Esc releases it -----
// While locked, the OS cursor is hidden and events only carry movement
// deltas, so a virtual cursor position is tracked here for games to read.
window.ARCADE_LOCK = (() => {
  const canvas = document.getElementById('c');
  const cur = { x: innerWidth / 2, y: innerHeight / 2 };
  // movement banked since a game last read it, for relative aiming
  const acc = { x: 0, y: 0 };
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
      // per-game locked-cursor sensitivity: twin-stick aiming wants a much
      // quicker hand than a pong paddle, which is tracking a slow target.
      // The settings slider scales both rather than replacing them.
      const base = window.MODE === 'geo' ? 1.7 : 0.6;
      const SENS = base * (window.ARCADE_SETTINGS ? ARCADE_SETTINGS.get('sens') : 1);
      // A high-polling-rate mouse fires many moves per frame and the browser
      // delivers them as one event with the rest folded into getCoalescedEvents.
      // Reading only the top-level movementX loses the shape of a fast flick;
      // integrating every sample keeps the sweep smooth at any poll rate.
      const samples = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
      let dx = 0, dy = 0;
      if (samples && samples.length) {
        for (const s of samples) { dx += s.movementX; dy += s.movementY; }
      } else {
        dx = e.movementX; dy = e.movementY;
      }
      // the raw movement is kept as well as the clamped cursor: a relative
      // aim (Geo Wars) must not lose motion when the cursor pins to an edge
      acc.x += dx * SENS;
      acc.y += dy * SENS;
      cur.x = Math.max(0, Math.min(innerWidth, cur.x + dx * SENS));
      cur.y = Math.max(0, Math.min(innerHeight, cur.y + dy * SENS));
    } else {
      acc.x += e.clientX - cur.x;
      acc.y += e.clientY - cur.y;
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
  // drain the banked movement; the caller gets everything since its last read
  function takeDelta() {
    const d = { x: acc.x, y: acc.y };
    acc.x = 0; acc.y = 0;
    return d;
  }
  return { cur, lock, unlock, locked, takeDelta };
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
