'use strict';
// ---- ARCADE SETTINGS ----------------------------------------------------
// One store for every knob the player can turn, persisted to localStorage and
// readable by all six games. Loads before anything else so shared.js and
// audio.js can read it while they build.

window.ARCADE_SETTINGS = (() => {
  const KEY = 'arcadeSettings';

  // sens is a multiplier on each game's own base sensitivity, not an absolute:
  // a pong paddle tracking a slow ball and a twin-stick reticle crossing the
  // screen want very different bases, and one slider should scale both.
  const DEFAULTS = {
    sens: 1,        // 0.25 .. 3
    music: 0.5,     // 0 .. 1
    sfx: 1,         // 0 .. 1
    shake: 1,       // 0 .. 1.5
    particles: 1,   // 0.25 .. 1.5
    glow: 1,        // 0 or 1 — the expensive one on weak machines
  };

  let values = Object.assign({}, DEFAULTS);
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      for (const k in DEFAULTS) {
        if (typeof saved[k] === 'number' && isFinite(saved[k])) values[k] = saved[k];
      }
    }
  } catch (e) { /* private mode, corrupt json — defaults are fine */ }

  const listeners = [];

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(values)); } catch (e) {}
  }

  function get(k) {
    return values[k] !== undefined ? values[k] : DEFAULTS[k];
  }

  function set(k, v) {
    if (!(k in DEFAULTS)) return;
    const n = Number(v);
    if (!isFinite(n)) return;
    values[k] = n;
    save();
    for (const fn of listeners) {
      try { fn(k, n); } catch (e) { console.error('settings listener failed', e); }
    }
  }

  function reset() {
    values = Object.assign({}, DEFAULTS);
    save();
    for (const k in values) {
      for (const fn of listeners) {
        try { fn(k, values[k]); } catch (e) {}
      }
    }
  }

  return {
    get, set, reset,
    defaults: () => Object.assign({}, DEFAULTS),
    all: () => Object.assign({}, values),
    onChange: fn => listeners.push(fn),
  };
})();

// ---- the panel ----------------------------------------------------------
// This file loads before the markup exists, so the wiring waits for the DOM.
addEventListener('DOMContentLoaded', () => {
  const S = window.ARCADE_SETTINGS;
  const overlay = document.getElementById('settingsOverlay');
  if (!overlay) return;

  // key -> [slider, readout, how to render the value]
  const pct = v => Math.round(v * 100) + '%';
  const ROWS = {
    sens: ['setSens', 'outSens', v => v.toFixed(2) + '×'],
    music: ['setMusic', 'outMusic', pct],
    sfx: ['setSfx', 'outSfx', pct],
    glow: ['setGlow', 'outGlow', v => (v ? 'on' : 'off')],
    shake: ['setShake', 'outShake', pct],
    particles: ['setParticles', 'outParticles', pct],
  };

  function paint() {
    for (const key in ROWS) {
      const [slider, out, fmt] = ROWS[key];
      const el = document.getElementById(slider);
      const label = document.getElementById(out);
      if (!el) continue;
      const v = S.get(key);
      el.value = String(v);
      if (label) label.textContent = fmt(v);
    }
  }

  for (const key in ROWS) {
    const [slider, out, fmt] = ROWS[key];
    const el = document.getElementById(slider);
    const label = document.getElementById(out);
    if (!el) continue;
    el.addEventListener('input', () => {
      const v = Number(el.value);
      S.set(key, v);
      if (label) label.textContent = fmt(v);
    });
  }

  // Settings live in the pause menu, not on the home screen, so the panel has
  // to remember what it covered and put it back — and must never resume the
  // game underneath it.
  let isOpen = false;
  let cameFrom = null;
  const pause = document.getElementById('pauseOverlay');

  function show() {
    cameFrom = pause && !pause.classList.contains('hidden') ? pause : null;
    if (cameFrom) cameFrom.classList.add('hidden');
    overlay.classList.remove('hidden');
    isOpen = true;
    paint();
  }
  function hide() {
    overlay.classList.add('hidden');
    if (cameFrom) cameFrom.classList.remove('hidden');
    cameFrom = null;
    isOpen = false;
  }

  const openBtn = document.getElementById('pauseSettingsBtn');
  if (openBtn) {
    // the pause menu's other buttons dispatch through shared.js; this one is
    // ours, and the click must not fall through to "click resumes"
    openBtn.addEventListener('pointerdown', e => e.stopPropagation());
    openBtn.addEventListener('click', e => {
      e.stopPropagation();
      show();
    });
  }
  document.getElementById('settingsClose').addEventListener('click', hide);
  document.getElementById('settingsReset').addEventListener('click', () => {
    S.reset();
    paint();
  });
  // Esc backs out to the pause menu instead of unpausing, and clicks inside
  // the panel are the panel's business — the games listen on window for
  // "click to start" and "click resumes"
  addEventListener('keydown', e => {
    if (isOpen && e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      hide();
    }
  }, true);
  for (const ev of ['pointerdown', 'pointerup', 'click']) {
    overlay.addEventListener(ev, e => e.stopPropagation());
  }
  paint();
});
