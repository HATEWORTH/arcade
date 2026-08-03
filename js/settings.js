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
  const launch = document.getElementById('launchOverlay');
  if (!overlay || !launch) return;

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

  let open = false;
  function show(on) {
    open = on;
    overlay.classList.toggle('hidden', !on);
    // the launch menu and the panel share the screen, so swap them
    launch.classList.toggle('hidden', on || window.MODE !== 'menu');
    if (on) paint();
  }

  document.getElementById('settingsToggle').addEventListener('click', () => show(true));
  document.getElementById('settingsClose').addEventListener('click', () => show(false));
  document.getElementById('settingsReset').addEventListener('click', () => {
    S.reset();
    paint();
  });
  // Esc backs out, and clicks inside the panel are the panel's business —
  // the games listen on window for "click to start"
  addEventListener('keydown', e => {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      show(false);
    }
  }, true);
  for (const ev of ['pointerdown', 'pointerup', 'click']) {
    overlay.addEventListener(ev, e => e.stopPropagation());
  }
  paint();
});
