'use strict';
window.MODE = 'menu';   // 'menu' | 'pong' | 'tetris' | 'snake' | 'geo' | 'cards'
(() => {
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const startOverlay = document.getElementById('startOverlay');
  const endOverlay = document.getElementById('endOverlay');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const launchOverlay = document.getElementById('launchOverlay');
  const hudEl = document.getElementById('pongHud');
  const hpYouEl = document.getElementById('hpYou');
  const hpCpuEl = document.getElementById('hpCpu');
  const verdictEl = document.getElementById('verdict');
  const finalScoreEl = document.getElementById('finalScore');

  const CYAN = '#8fce9a', MAGENTA = '#e0459b', VIOLET = '#4a2b7a', LIME = '#e6cf5e', WHITE = '#ffffff';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- world space -------------------------------------------------------
  // Tunnel: x in [-1,1], y in [-1,1], z in [0 (player) .. DEPTH (cpu)]
  const DEPTH = 6;
  const FOV = 2.6;         // perspective strength
  const MAX_HP = 7;
  const PADDLE_W = 0.42, PADDLE_H = 0.34;
  const BALL_R = 0.075;

  let W = 0, H = 0, DPR = 1, cx = 0, cy = 0, viewScale = 0;

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    cx = W / 2; cy = H / 2;
    // Near plane (z=0) projects at full scale, so keep it inside the screen:
    // half-extent must stay under min(W,H)/2, with margin for glow + bezel.
    viewScale = Math.min(W, H) * 0.45;
  }
  addEventListener('resize', resize);
  resize();

  // Perspective projection of world point -> screen
  function project(x, y, z) {
    const s = FOV / (FOV + z);
    return { x: cx + x * s * viewScale, y: cy + y * s * viewScale, s };
  }

  // ---- audio -------------------------------------------------------------
  let AC = null;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (AC && AC.state === 'suspended') AC.resume();
  }
  function bleep(freq, dur, type, vol) {
    if (!AC) return;
    const t = AC.currentTime;
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), t + dur);
    g.gain.setValueAtTime(vol || 0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(AC.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  // "drowning" synth: detuned saw pair sweeping down into the depths
  function sweep(f0, f1, dur, type, vol) {
    if (!AC) return;
    const t0 = AC.currentTime;
    for (const det of [1, 1.012]) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type || 'sawtooth';
      o.frequency.setValueAtTime(f0 * det, t0);
      o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur);
      g.gain.setValueAtTime((vol || 0.06) / 2, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(AC.destination);
      o.start(t0); o.stop(t0 + dur + 0.05);
    }
  }
  let hatBuf = null;
  function hat(vol, dur) {
    if (!AC) return;
    if (!hatBuf) {
      hatBuf = AC.createBuffer(1, AC.sampleRate * 0.15, AC.sampleRate);
      const d = hatBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    const t0 = AC.currentTime;
    const src = AC.createBufferSource(); src.buffer = hatBuf;
    const f = AC.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 8000;
    const g = AC.createGain();
    g.gain.setValueAtTime(vol || 0.06, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.06));
    src.connect(f).connect(g).connect(AC.destination);
    src.start(t0); src.stop(t0 + (dur || 0.06) + 0.02);
  }

  const sfx = {
    playerHit: () => bleep(220, 0.12, 'square', 0.09),
    cpuHit:    () => bleep(160, 0.12, 'square', 0.07),
    wall:      () => bleep(520, 0.05, 'triangle', 0.045),
    scoreYou:  () => { bleep(440, 0.1, 'square', 0.08); setTimeout(() => bleep(660, 0.14, 'square', 0.08), 90); },
    scoreCpu:  () => { bleep(200, 0.16, 'sawtooth', 0.07); setTimeout(() => bleep(140, 0.22, 'sawtooth', 0.07), 110); },
  };

  // ---- chiptune engine ---------------------------------------------------
  // Peaceful sci-fi chiptune: a rotating playlist of procedurally-synthesized
  // tracks. Soft triangle/sine voices, sparse half-time drums, long feedback
  // echo. Each song plays `bars` bars, then hands off to the next.
  const music = {
    on: true, started: false, songIndex: 0, bpm: 92, style: 'neon',
    startTime: 0, nextStepTime: 0, step: 0,
    timer: null,
    bus: null, delay: null, delayNode: null,
  };
  // musical clock read by the renderer every frame
  const beat = { phase: 0, bar: 0, kick: 0, snare: 0, bass: 0, arp: 0 };

  const NOTE = n => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz
  // Patterns are 16-step bars; -1 = rest. Multi-bar patterns cycle.
  const SONGS = [
    { name: 'Drift', bpm: 92, bars: 16,               // C minor, floating
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      hat:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      snare: null,
      bassWave: 'triangle',
      bass: [
        [36,-1,-1,-1, -1,-1,43,-1, 36,-1,-1,-1, 39,-1,-1,-1],
        [34,-1,-1,-1, -1,-1,41,-1, 31,-1,-1,-1, 34,-1,-1,-1],
      ],
      arpWave: 'triangle',
      arp: [
        [60,-1,63,-1, 67,-1,70,-1, 72,-1,70,-1, 67,-1,63,-1],
        [58,-1,62,-1, 65,-1,69,-1, 70,-1,69,-1, 65,-1,62,-1],
      ],
      leadWave: 'sine',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [72,-1,-1,75, -1,-1,74,-1, 70,-1,-1,-1, 67,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [48, 44, 46, 43],
    },
    { name: 'Aurora', bpm: 84, bars: 16,              // A minor, slow shimmer
      kick:  [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      snare: null,
      bassWave: 'triangle',
      bass: [
        [45,-1,-1,-1, -1,-1,-1,-1, 40,-1,-1,-1, -1,-1,-1,-1],
        [41,-1,-1,-1, -1,-1,48,-1, 43,-1,-1,-1, -1,-1,-1,-1],
      ],
      arpWave: 'sine',
      arp: [
        [57,-1,60,-1, 64,-1,69,-1, 72,-1,69,-1, 64,-1,60,-1],
        [53,-1,57,-1, 60,-1,65,-1, 69,-1,65,-1, 60,-1,57,-1],
      ],
      leadWave: 'triangle',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [76,-1,-1,74, -1,-1,72,-1, 69,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [72,-1,-1,69, -1,-1,71,-1, 69,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [45, 40, 41, 43],
    },
    { name: 'Solar Wind', bpm: 100, bars: 16,         // D dorian, warm drift
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      snare: [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      bassWave: 'triangle',
      bass: [
        [38,-1,-1,38, -1,-1,45,-1, 38,-1,-1,-1, 41,-1,43,-1],
        [36,-1,-1,36, -1,-1,43,-1, 36,-1,-1,-1, 38,-1,40,-1],
      ],
      arpWave: 'triangle',
      arp: [
        [62,-1,65,-1, 69,-1,74,-1, 72,-1,69,-1, 65,-1,62,-1],
        [60,-1,64,-1, 67,-1,72,-1, 71,-1,67,-1, 64,-1,60,-1],
      ],
      leadWave: 'sine',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [74,-1,-1,77, -1,-1,76,-1, 74,-1,-1,71, -1,-1,69,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [50, 48, 53, 45],
    },
  ];

  // per-game playlists: tetris goes medieval, the card room plays it jaunty
  const MEDIEVAL_SONGS = [
    { name: 'Torchlight Court', bpm: 96, bars: 16,     // D dorian, drone court dance
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      snare: null,
      bassWave: 'square',
      bass: [
        [38,-1,-1,-1, 45,-1,-1,-1, 38,-1,-1,-1, 45,-1,-1,-1],
        [36,-1,-1,-1, 43,-1,-1,-1, 36,-1,-1,-1, 43,-1,-1,-1],
      ],
      arpWave: 'square',
      arp: [
        [62,-1,65,-1, 69,-1,65,-1, 62,-1,65,-1, 69,-1,72,-1],
        [60,-1,64,-1, 67,-1,64,-1, 60,-1,64,-1, 67,-1,71,-1],
      ],
      leadWave: 'square',
      lead: [
        [74,-1,-1,72, 74,-1,77,-1, 74,-1,72,-1, 69,-1,-1,-1],
        [72,-1,-1,71, 72,-1,74,-1, 72,-1,69,-1, 67,-1,-1,-1],
        [65,-1,67,-1, 69,-1,72,-1, 74,-1,72,-1, 69,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [50, 48, 50, 45],
    },
    { name: 'Wassail Round', bpm: 104, bars: 16,       // G mixolydian, tavern dance
      kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      snare: null,
      bassWave: 'square',
      bass: [
        [43,-1,-1,-1, 43,-1,50,-1, 43,-1,-1,-1, 41,-1,-1,-1],
        [39,-1,-1,-1, 39,-1,46,-1, 39,-1,-1,-1, 41,-1,-1,-1],
      ],
      arpWave: 'square',
      arp: [
        [67,-1,71,-1, 74,-1,71,-1, 67,-1,71,-1, 74,-1,76,-1],
        [65,-1,69,-1, 72,-1,69,-1, 65,-1,69,-1, 72,-1,74,-1],
      ],
      leadWave: 'square',
      lead: [
        [79,-1,-1,78, 79,-1,74,-1, 71,-1,74,-1, 67,-1,-1,-1],
        [77,-1,-1,76, 77,-1,72,-1, 69,-1,72,-1, 65,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [74,-1,76,-1, 77,-1,76,-1, 74,-1,71,-1, 67,-1,-1,-1],
      ],
      pads: [55, 51, 53, 55],
    },
    { name: 'Cloister Bells', bpm: 82, bars: 16,       // A aeolian, slow chant
      kick:  [1,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0],
      hat:   [0,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare: null,
      bassWave: 'square',
      bass: [
        [33,-1,-1,-1, -1,-1,-1,-1, 40,-1,-1,-1, -1,-1,-1,-1],
        [31,-1,-1,-1, -1,-1,-1,-1, 38,-1,-1,-1, -1,-1,-1,-1],
      ],
      arpWave: 'sine',
      arp: [
        [57,-1,-1,60, -1,-1,64,-1, -1,69,-1,-1, 64,-1,60,-1],
        [55,-1,-1,59, -1,-1,62,-1, -1,67,-1,-1, 62,-1,59,-1],
      ],
      leadWave: 'sine',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [76,-1,-1,-1, 74,-1,-1,-1, 72,-1,-1,-1, 69,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [71,-1,-1,-1, 72,-1,-1,-1, 69,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [45, 43, 41, 40],
    },
  ];
  const OPENTTD_SONGS = [
    { name: 'High Street Shuffle', bpm: 116, bars: 16, // F major, walking-bass lounge
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      hat:   [0,0,1,0, 1,0,1,0, 0,0,1,0, 1,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      bassWave: 'triangle',
      bass: [
        [41,-1,-1,-1, 45,-1,-1,-1, 48,-1,-1,-1, 50,-1,-1,-1],
        [53,-1,-1,-1, 50,-1,-1,-1, 48,-1,-1,-1, 45,-1,-1,-1],
        [46,-1,-1,-1, 50,-1,-1,-1, 53,-1,-1,-1, 50,-1,-1,-1],
        [48,-1,-1,-1, 47,-1,-1,-1, 46,-1,-1,-1, 43,-1,-1,-1],
      ],
      arpWave: 'sine',
      arp: [
        [-1,-1,69,-1, -1,-1,72,-1, -1,-1,76,-1, -1,-1,72,-1],
        [-1,-1,69,-1, -1,-1,74,-1, -1,-1,77,-1, -1,-1,74,-1],
        [-1,-1,70,-1, -1,-1,74,-1, -1,-1,77,-1, -1,-1,74,-1],
        [-1,-1,67,-1, -1,-1,72,-1, -1,-1,76,-1, -1,-1,72,-1],
      ],
      leadWave: 'triangle',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [77,-1,76,-1, 74,-1,72,-1, 69,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [72,-1,74,-1, 76,-1,77,-1, 79,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [41, 41, 46, 43],
    },
    { name: 'Branch Line Bounce', bpm: 124, bars: 16,  // C major, brisk commuter swing
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,1,0],
      hat:   [0,0,1,0, 1,0,1,0, 0,0,1,0, 1,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      bassWave: 'triangle',
      bass: [
        [36,-1,-1,-1, 40,-1,-1,-1, 43,-1,-1,-1, 45,-1,-1,-1],
        [48,-1,-1,-1, 45,-1,-1,-1, 43,-1,-1,-1, 40,-1,-1,-1],
        [41,-1,-1,-1, 45,-1,-1,-1, 48,-1,-1,-1, 45,-1,-1,-1],
        [43,-1,-1,-1, 42,-1,-1,-1, 41,-1,-1,-1, 38,-1,-1,-1],
      ],
      arpWave: 'sine',
      arp: [
        [-1,-1,64,-1, -1,-1,67,-1, -1,-1,72,-1, -1,-1,67,-1],
        [-1,-1,64,-1, -1,-1,69,-1, -1,-1,72,-1, -1,-1,69,-1],
        [-1,-1,65,-1, -1,-1,69,-1, -1,-1,72,-1, -1,-1,69,-1],
        [-1,-1,62,-1, -1,-1,67,-1, -1,-1,71,-1, -1,-1,67,-1],
      ],
      leadWave: 'triangle',
      lead: [
        [72,-1,74,-1, 76,-1,-1,-1, 74,-1,72,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [77,-1,76,-1, 74,-1,72,-1, 74,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [36, 41, 36, 43],
    },
    { name: 'Tram Depot Waltz', bpm: 100, bars: 16,    // B-flat major, easy sway
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      hat:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      snare: null,
      bassWave: 'triangle',
      bass: [
        [46,-1,-1,-1, 50,-1,-1,-1, 53,-1,-1,-1, 50,-1,-1,-1],
        [43,-1,-1,-1, 46,-1,-1,-1, 50,-1,-1,-1, 46,-1,-1,-1],
        [44,-1,-1,-1, 48,-1,-1,-1, 51,-1,-1,-1, 48,-1,-1,-1],
        [41,-1,-1,-1, 45,-1,-1,-1, 48,-1,-1,-1, 45,-1,-1,-1],
      ],
      arpWave: 'sine',
      arp: [
        [-1,-1,70,-1, -1,-1,74,-1, -1,-1,77,-1, -1,-1,74,-1],
        [-1,-1,67,-1, -1,-1,70,-1, -1,-1,74,-1, -1,-1,70,-1],
        [-1,-1,68,-1, -1,-1,72,-1, -1,-1,75,-1, -1,-1,72,-1],
        [-1,-1,65,-1, -1,-1,69,-1, -1,-1,72,-1, -1,-1,69,-1],
      ],
      leadWave: 'triangle',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [74,-1,-1,72, 74,-1,77,-1, 74,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [72,-1,-1,70, 72,-1,74,-1, 70,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [46, 43, 44, 41],
    },
  ];
  const PONG_SONGS = [
    { name: 'Vector Drive', bpm: 112, bars: 16,        // A minor, steady synth drive
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      bassWave: 'square',
      bass: [
        [33,-1,33,-1, 33,-1,36,-1, 33,-1,33,-1, 40,-1,38,-1],
        [31,-1,31,-1, 31,-1,34,-1, 31,-1,31,-1, 38,-1,36,-1],
      ],
      arpWave: 'square',
      arp: [
        [57,-1,60,-1, 64,-1,60,-1, 57,-1,60,-1, 64,-1,69,-1],
        [55,-1,59,-1, 62,-1,59,-1, 55,-1,59,-1, 62,-1,67,-1],
      ],
      leadWave: 'sawtooth',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [76,-1,74,-1, 72,-1,69,-1, 71,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [72,-1,71,-1, 69,-1,67,-1, 69,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [45, 43, 41, 40],
    },
    { name: 'Tunnel Runner', bpm: 120, bars: 16,       // E minor, urgent pulse
      kick:  [1,0,0,0, 0,0,1,0, 1,0,0,0, 0,0,1,0],
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,1],
      bassWave: 'square',
      bass: [
        [28,-1,28,-1, 35,-1,28,-1, 28,-1,28,-1, 33,-1,31,-1],
        [26,-1,26,-1, 33,-1,26,-1, 26,-1,26,-1, 31,-1,28,-1],
      ],
      arpWave: 'triangle',
      arp: [
        [64,-1,67,-1, 71,-1,67,-1, 64,-1,67,-1, 71,-1,74,-1],
        [62,-1,66,-1, 69,-1,66,-1, 62,-1,66,-1, 69,-1,71,-1],
      ],
      leadWave: 'square',
      lead: [
        [79,-1,-1,78, 76,-1,74,-1, 76,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [74,-1,-1,72, 71,-1,69,-1, 71,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [40, 38, 36, 35],
    },
    { name: 'Afterimage', bpm: 100, bars: 16,          // D minor, moody glide
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      snare: null,
      bassWave: 'triangle',
      bass: [
        [38,-1,-1,-1, -1,-1,45,-1, 38,-1,-1,-1, 41,-1,43,-1],
        [36,-1,-1,-1, -1,-1,43,-1, 36,-1,-1,-1, 38,-1,41,-1],
      ],
      arpWave: 'sine',
      arp: [
        [62,-1,65,-1, 69,-1,65,-1, 62,-1,65,-1, 69,-1,74,-1],
        [65,-1,70,-1, 74,-1,70,-1, 65,-1,70,-1, 74,-1,77,-1],
      ],
      leadWave: 'sine',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [74,-1,-1,72, -1,-1,70,-1, 69,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [70,-1,-1,69, -1,-1,67,-1, 65,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [50, 46, 48, 45],
    },
  ];
  const SNAKE_SONGS = [
    { name: 'Signal Hunt', bpm: 104, bars: 16,         // E phrygian, coiled slither
      kick:  [1,0,0,1, 0,0,1,0, 0,1,0,0, 1,0,0,0],
      hat:   [0,0,1,0, 0,1,0,0, 0,0,1,0, 0,1,0,0],
      snare: null,
      bassWave: 'square',
      bass: [
        [40,-1,-1,40, -1,-1,41,-1, 40,-1,-1,-1, 43,-1,41,-1],
        [38,-1,-1,38, -1,-1,40,-1, 38,-1,-1,-1, 41,-1,40,-1],
      ],
      arpWave: 'triangle',
      arp: [
        [64,-1,65,-1, 67,-1,65,-1, 64,-1,67,-1, 71,-1,67,-1],
        [62,-1,64,-1, 65,-1,64,-1, 62,-1,65,-1, 69,-1,65,-1],
      ],
      leadWave: 'triangle',
      lead: [
        [76,-1,-1,77, 76,-1,74,-1, 71,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [77,-1,-1,76, 74,-1,72,-1, 71,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [52, 50, 52, 48],
    },
    { name: 'Cold Blood', bpm: 86, bars: 16,           // A minor, patient stalk
      kick:  [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      hat:   [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      snare: null,
      bassWave: 'triangle',
      bass: [
        [33,-1,-1,-1, -1,-1,-1,-1, 36,-1,-1,-1, -1,-1,40,-1],
        [31,-1,-1,-1, -1,-1,-1,-1, 33,-1,-1,-1, -1,-1,38,-1],
      ],
      arpWave: 'sine',
      arp: [
        [57,-1,-1,60, -1,-1,64,-1, -1,-1,60,-1, 64,-1,-1,-1],
        [55,-1,-1,59, -1,-1,62,-1, -1,-1,59,-1, 62,-1,-1,-1],
      ],
      leadWave: 'sine',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [72,-1,-1,-1, 71,-1,-1,-1, 69,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [45, 43, 45, 40],
    },
    { name: 'Vivarium', bpm: 112, bars: 16,            // D dorian, wriggling run
      kick:  [1,0,0,0, 0,0,1,0, 0,0,1,0, 0,0,0,0],
      hat:   [0,1,0,1, 0,1,0,1, 0,1,0,1, 0,1,0,1],
      snare: null,
      bassWave: 'square',
      bass: [
        [38,-1,38,-1, -1,-1,41,-1, 38,-1,38,-1, 45,-1,43,-1],
        [36,-1,36,-1, -1,-1,40,-1, 36,-1,36,-1, 43,-1,41,-1],
      ],
      arpWave: 'square',
      arp: [
        [62,-1,64,-1, 65,-1,67,-1, 69,-1,67,-1, 65,-1,64,-1],
        [60,-1,62,-1, 64,-1,65,-1, 67,-1,65,-1, 64,-1,62,-1],
      ],
      leadWave: 'triangle',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [74,-1,76,-1, 77,-1,76,-1, 74,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [69,-1,71,-1, 72,-1,71,-1, 69,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [50, 48, 50, 53],
    },
  ];
  const GEO_SONGS = [
    { name: 'Swarm Theory', bpm: 132, bars: 16,        // C minor, relentless drive
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,1,0],
      hat:   [0,0,1,0, 0,0,1,0, 0,0,1,0, 0,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      bassWave: 'sawtooth',
      bass: [
        [36,-1,36,-1, 36,-1,39,-1, 36,-1,36,-1, 43,-1,41,-1],
        [34,-1,34,-1, 34,-1,36,-1, 34,-1,34,-1, 39,-1,38,-1],
      ],
      arpWave: 'square',
      arp: [
        [60,-1,63,-1, 67,-1,63,-1, 60,-1,63,-1, 67,-1,72,-1],
        [58,-1,62,-1, 65,-1,62,-1, 58,-1,62,-1, 65,-1,70,-1],
      ],
      leadWave: 'sawtooth',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [75,-1,74,-1, 72,-1,70,-1, 72,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [70,-1,72,-1, 74,-1,75,-1, 79,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [48, 46, 48, 43],
    },
    { name: 'Event Horizon', bpm: 140, bars: 16,       // G minor, full sprint
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      hat:   [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      bassWave: 'square',
      bass: [
        [31,-1,31,-1, 31,-1,34,-1, 31,-1,31,-1, 38,-1,36,-1],
        [29,-1,29,-1, 29,-1,31,-1, 29,-1,29,-1, 36,-1,34,-1],
      ],
      arpWave: 'square',
      arp: [
        [55,-1,58,-1, 62,-1,58,-1, 55,-1,58,-1, 62,-1,67,-1],
        [53,-1,57,-1, 60,-1,57,-1, 53,-1,57,-1, 60,-1,65,-1],
      ],
      leadWave: 'square',
      lead: [
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [79,-1,77,-1, 74,-1,72,-1, 74,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [77,-1,79,-1, 82,-1,79,-1, 77,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [43, 41, 43, 38],
    },
    { name: 'Particle Storm', bpm: 126, bars: 16,      // A minor, syncopated surge
      kick:  [1,0,0,1, 0,0,1,0, 1,0,0,1, 0,0,1,0],
      hat:   [0,0,1,0, 1,0,1,0, 0,0,1,0, 1,0,1,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,1,0],
      bassWave: 'sawtooth',
      bass: [
        [33,-1,-1,33, -1,-1,36,-1, 33,-1,-1,33, 40,-1,38,-1],
        [29,-1,-1,29, -1,-1,33,-1, 29,-1,-1,29, 36,-1,33,-1],
      ],
      arpWave: 'triangle',
      arp: [
        [57,-1,60,-1, 64,-1,60,-1, 57,-1,60,-1, 64,-1,69,-1],
        [53,-1,57,-1, 60,-1,57,-1, 53,-1,57,-1, 60,-1,64,-1],
      ],
      leadWave: 'square',
      lead: [
        [76,-1,-1,74, 72,-1,71,-1, 72,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [-1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1, -1,-1,-1,-1],
        [71,-1,-1,72, 74,-1,76,-1, 79,-1,-1,-1, -1,-1,-1,-1],
      ],
      pads: [45, 41, 45, 40],
    },
  ];
  const PLAYLISTS = {
    neon: SONGS,
    pong: PONG_SONGS,
    snake: SNAKE_SONGS,
    geo: GEO_SONGS,
    medieval: MEDIEVAL_SONGS,
    openttd: OPENTTD_SONGS,
  };
  function playlist() { return PLAYLISTS[music.style] || SONGS; }
  // switch playlist; takes effect at the next scheduled step, starting
  // from a random track so each visit opens differently
  function setStyle(name) {
    if (music.style === name || !PLAYLISTS[name]) return;
    music.style = name;
    music.songIndex = Math.floor(Math.random() * PLAYLISTS[name].length);
    music.step = 0;
  }

  let noiseBuf = null;
  function musicBus() {
    if (music.bus) return;
    music.bus = AC.createGain();
    music.bus.gain.value = 0.5;
    // spacey feedback delay (dotted-eighth, retimed per song)
    const delay = AC.createDelay(2);
    music.delayNode = delay;
    delay.delayTime.value = (60 / music.bpm / 4) * 3;
    const fb = AC.createGain(); fb.gain.value = 0.36;
    const damp = AC.createBiquadFilter(); damp.type = 'lowpass'; damp.frequency.value = 2000;
    music.delay = AC.createGain(); music.delay.gain.value = 0.32;
    music.delay.connect(delay); delay.connect(damp); damp.connect(fb); fb.connect(delay);
    delay.connect(music.bus);
    music.bus.connect(AC.destination);
    // shared noise buffer for hats / snare
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.3, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function voice(type, freq, when, dur, vol, opts) {
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    if (opts && opts.slideTo) o.frequency.exponentialRampToValueAtTime(opts.slideTo, when + dur);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(vol, when + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    g.connect(music.bus);
    if (opts && opts.echo) g.connect(music.delay);
    o.start(when); o.stop(when + dur + 0.05);
  }
  function noise(when, dur, vol, hpFreq) {
    const src = AC.createBufferSource(); src.buffer = noiseBuf;
    const f = AC.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hpFreq;
    const g = AC.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(music.bus);
    src.start(when); src.stop(when + dur + 0.02);
  }

  const toastEl = document.getElementById('trackToast');
  function announce(name, when) {
    const ms = Math.max(0, (when - AC.currentTime) * 1000);
    setTimeout(() => {
      toastEl.textContent = '♪ ' + name;
      toastEl.classList.add('show');
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(() => toastEl.classList.remove('show'), 4500);
    }, ms);
  }

  function scheduleStep(song, step, when) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const st = 60 / song.bpm / 4;
    if (song.kick[s16]) voice('sine', 110, when, 0.22, 0.3, { slideTo: 48 });
    if (song.hat[s16]) noise(when, 0.05, 0.05, 7000);
    if (song.snare && song.snare[s16]) noise(when, 0.14, 0.08, 1200);
    const bn = song.bass[bar % song.bass.length][s16];
    if (bn >= 0) voice(song.bassWave, NOTE(bn), when, st * 3.2, 0.10);
    const an = song.arp[bar % song.arp.length][s16];
    if (an >= 0) voice(song.arpWave, NOTE(an), when, st * 1.6, 0.05, { echo: true });
    const ln = song.lead[bar % song.lead.length][s16];
    if (ln >= 0) voice(song.leadWave, NOTE(ln), when, st * 3.4, 0.07, { echo: true });
    // slow detuned pad, once per bar
    if (s16 === 0) {
      const root = song.pads[bar % song.pads.length];
      voice('sawtooth', NOTE(root) * 0.997, when, st * 16, 0.02, { echo: true });
      voice('sawtooth', NOTE(root + 7) * 1.003, when, st * 16, 0.016, { echo: true });
    }
  }

  function schedulerTick() {
    if (!AC || !music.on) return;
    while (music.nextStepTime < AC.currentTime + 0.15) {
      const list = playlist();
      const song = list[music.songIndex % list.length];
      const st = 60 / song.bpm / 4;
      if (music.step === 0) {
        music.bpm = song.bpm;
        music.startTime = music.nextStepTime;
        if (music.delayNode) music.delayNode.delayTime.setValueAtTime(st * 3, Math.max(0, music.nextStepTime - 0.05));
        announce(song.name, music.nextStepTime);
      }
      scheduleStep(song, music.step, music.nextStepTime);
      music.step++;
      music.nextStepTime += st;
      if (music.step >= song.bars * 16) {
        music.step = 0;
        music.songIndex = (music.songIndex + 1) % list.length;
        music.nextStepTime += 60 / song.bpm; // one-beat breath between tracks
      }
    }
  }
  function startMusic() {
    if (!AC || music.started) return;
    musicBus();
    music.started = true;
    music.step = 0;
    music.songIndex = Math.floor(Math.random() * playlist().length);
    music.startTime = AC.currentTime + 0.1;
    music.nextStepTime = music.startTime;
    music.timer = setInterval(schedulerTick, 25);
  }
  function toggleMusic() {
    music.on = !music.on;
    if (music.bus) music.bus.gain.setTargetAtTime(music.on ? 0.5 : 0.0001, AC.currentTime, 0.05);
  }
  addEventListener('keydown', e => { if (e.key === 'm' || e.key === 'M') toggleMusic(); });

  // Per-frame: derive beat envelopes from the audio clock so visuals lock to it
  function updateBeat() {
    if (reducedMotion) {
      // prefers-reduced-motion: no rhythmic pulsing at all
      beat.phase = 0; beat.bar = 0;
      beat.kick = 0; beat.snare = 0; beat.bass = 0; beat.arp = 0;
      return;
    }
    if (!AC || !music.started || !music.on) {
      // no music -> slow ambient breath so the scene still feels alive
      beat.phase = (performance.now() / 1000) * (music.bpm / 60) * 0.5;
      const ph = beat.phase % 1;
      beat.kick = Math.max(0, 1 - ph * 2.5) * 0.3;
      beat.bass = beat.kick; beat.snare = 0; beat.arp = 0;
      beat.bar = Math.floor(beat.phase / 4);
      return;
    }
    const list = playlist();
    const song = list[music.songIndex % list.length];
    const tBeats = (AC.currentTime - music.startTime) * (song.bpm / 60);
    if (tBeats < 0) { beat.kick = 0; beat.snare = 0; beat.bass = 0; beat.arp = 0; return; }
    beat.phase = tBeats;
    beat.bar = Math.floor(tBeats / 4);
    const step = tBeats * 4;              // current 16th, fractional
    const s16i = Math.floor(step);
    const s16 = s16i % 16;
    const frac = step - s16i;
    // envelope: 1 at the step onset, decays over the step
    const env = k => k ? Math.max(0, 1 - frac * 1.15) : 0;
    beat.kick  = env(song.kick[s16]);
    beat.snare = song.snare ? env(song.snare[s16]) : 0;
    const barIdx = Math.floor(s16i / 16);
    beat.bass = song.bass[barIdx % song.bass.length][s16] >= 0 ? Math.max(0, 1 - frac * 1.3) : 0;
    beat.arp  = song.arp[barIdx % song.arp.length][s16] >= 0 ? Math.max(0, 1 - frac * 2) : 0;
  }

  // ---- state -------------------------------------------------------------
  const game = {
    running: false, paused: false,
    hpYou: MAX_HP, hpCpu: MAX_HP,
    holding: false,    // player is holding the serve (no time limit)
    rally: 0,
    shake: 0,
    flash: 0,          // full-screen flash alpha
    flashColor: WHITE,
    pulse: 0,          // tunnel ring pulse (travels on impact)
    pulseZ: 0,
    pulseDir: 1,
    serveTimer: 0,     // countdown before ball moves
    serveDir: 1,
  };
  const player = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, charge: 0, charging: false };
  const cpu = { x: 0, y: 0 };
  const balls = [];
  function makeBall(z, vx, vy, vz) {
    return { x: 0, y: 0, z, vx, vy, vz, spinX: 0, spinY: 0, power: false, trail: [] };
  }
  const particles = [];
  const stars = [];
  for (let i = 0; i < 90; i++) {
    stars.push({ x: (Math.random() * 2 - 1) * 3, y: (Math.random() * 2 - 1) * 3, z: Math.random() * DEPTH, tw: Math.random() * Math.PI * 2 });
  }

  function serve(dir) {
    const speed = 3.2 + Math.min(game.rally * 0.18, 2.6);
    const a = Math.random() * Math.PI * 2;
    balls.length = 0;
    balls.push(makeBall(dir > 0 ? 0.4 : DEPTH - 0.4, Math.cos(a) * 0.7, Math.sin(a) * 0.5, speed * dir));
    game.serveTimer = 0.9;
    game.serveDir = dir;
  }

  // player serve: ball rides on your paddle with no time limit —
  // position yourself, then right-click to launch it
  function playerServeHold() {
    balls.length = 0;
    const b = makeBall(0.18, 0, 0, 0);
    b.held = true;
    balls.push(b);
    game.holding = true;
    game.serveTimer = 0;
  }
  function launchServe() {
    if (!game.holding) return;
    const b = balls[0];
    if (!b) return;
    game.holding = false;
    b.held = false;
    b.vz = 3.2;
    b.vx = player.vx * 0.4 + (Math.random() - 0.5) * 0.4;
    b.vy = player.vy * 0.4 + (Math.random() - 0.5) * 0.4;
    game.pulse = 1; game.pulseZ = 0; game.pulseDir = 1;
    sfx.playerHit();
  }


  function renderBars() {
    for (const [el, hp] of [[hpYouEl, game.hpYou], [hpCpuEl, game.hpCpu]]) {
      el.innerHTML = '';
      for (let i = 0; i < MAX_HP; i++) {
        const c = document.createElement('i');
        if (i < hp) c.className = 'on';
        el.appendChild(c);
      }
    }
  }

  function resetMatch() {
    game.hpYou = MAX_HP; game.hpCpu = MAX_HP; game.rally = 0;
    renderBars();
    cpu.x = 0; cpu.y = 0;
    powerup = null;
    effects.wide = 0; effects.slow = 0; effects.shield = 0;
    floats.length = 0;
    playerServeHold();
  }

  // ---- particles (geometry-wars line shards) -----------------------------
  function burst(x, y, z, color, count, power) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.6 + Math.random() * 1.6) * power;
      particles.push({
        x, y, z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        vz: (Math.random() - 0.5) * sp * 1.4,
        life: 1, decay: 1.4 + Math.random() * 1.6,
        color,
        len: 0.05 + Math.random() * 0.08,
      });
    }
  }

  // ---- input -------------------------------------------------------------
  const pointer = { x: 0, y: 0 };
  function onMove(clientX, clientY) {
    // map screen -> world plane at z=0
    pointer.x = (clientX - cx) / viewScale;
    pointer.y = (clientY - cy) / viewScale;
  }
  addEventListener('pointermove', () => onMove(ARCADE_LOCK.cur.x, ARCADE_LOCK.cur.y));
  addEventListener('touchmove', e => {
    if (e.touches[0]) onMove(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });

  function startGame() {
    audio();
    startMusic();
    resetMatch();
    game.running = true;
    ARCADE_LOCK.lock();
    startOverlay.classList.add('hidden');
    endOverlay.classList.add('hidden');
  }
  addEventListener('arcadecursorunlock', () => {
    if (window.MODE === 'pong' && game.running && !game.paused) togglePause();
  });
  addEventListener('arcadequit', () => {
    if (window.MODE === 'pong') quitToMenu();
  });
  addEventListener('arcaderestart', () => {
    if (window.MODE !== 'pong') return;
    game.paused = false;
    pauseOverlay.classList.add('hidden');
    if (AC) AC.resume();
    startGame();
  });
  function togglePause() {
    if (!game.running) return;
    game.paused = !game.paused;
    player.charging = false;
    if (game.paused) ARCADE_LOCK.unlock(); else ARCADE_LOCK.lock();
    pauseOverlay.classList.toggle('hidden', !game.paused);
    if (AC) { if (game.paused) AC.suspend(); else AC.resume(); }
  }
  function quitToMenu() {
    game.paused = false;
    game.running = false;
    ARCADE_LOCK.unlock();
    setStyle('neon');
    if (AC) AC.resume();
    pauseOverlay.classList.add('hidden');
    startOverlay.classList.add('hidden');
    endOverlay.classList.add('hidden');
    hudEl.classList.add('hidden');
    launchOverlay.classList.remove('hidden');
    window.MODE = 'menu';
  }
  addEventListener('keydown', e => {
    if (window.MODE !== 'pong') return;
    if (e.key === 'Escape') togglePause();
    if ((e.key === 'q' || e.key === 'Q') && (game.paused || !game.running)) quitToMenu();
  });
  document.getElementById('pickPong').addEventListener('click', () => {
    window.MODE = 'pong';
    setStyle('pong');
    launchOverlay.classList.add('hidden');
    hudEl.classList.remove('hidden');
  });
  addEventListener('pointerdown', e => {
    if (window.MODE !== 'pong') return;
    onMove(ARCADE_LOCK.cur.x, ARCADE_LOCK.cur.y);
    if (e.button === 2) {           // right click launches a held serve
      if (game.running && !game.paused) launchServe();
      return;
    }
    if (game.paused) { togglePause(); return; }
    if (!game.running) startGame();
    else if (!game.holding) player.charging = true;
  });
  addEventListener('contextmenu', e => { if (window.MODE === 'pong') e.preventDefault(); });
  addEventListener('pointerup', () => { player.charging = false; });
  addEventListener('pointercancel', () => { player.charging = false; });

  // ---- power-ups ---------------------------------------------------------
  // Scoring drops a pickup box at the bottom-right of your grid; hover your
  // paddle over it to grab it before it expires.
  const POWER_TYPES = [
    { id: 'wide',   color: '#e6cf5e', label: 'WIDE PADDLE' },
    { id: 'slow',   color: '#d99a4e', label: 'SLOW-MO' },
    { id: 'shield', color: '#6a9fd8', label: 'SHIELD' },
  ];
  let powerup = null;                    // {id, color, label, x, y, t}
  const effects = { wide: 0, slow: 0, shield: 0 };
  const floats = [];                     // rising pickup labels

  function spawnPowerup() {
    const kind = POWER_TYPES[Math.floor(Math.random() * POWER_TYPES.length)];
    powerup = { ...kind, x: 0.72, y: 0.72, t: 8 };
  }
  function playerW() { return PADDLE_W * (effects.wide > 0 ? 1.5 : 1); }
  function applyPower(pu) {
    if (pu.id === 'wide') effects.wide = 10;
    if (pu.id === 'slow') effects.slow = 6;
    if (pu.id === 'shield') effects.shield = Math.min(2, effects.shield + 1);
    floats.push({ text: pu.label, color: pu.color, x: pu.x, y: pu.y, t: 1.4 });
    burst(pu.x, pu.y, 0, pu.color, 24, 1.2);
    bleep(880, 0.18, 'triangle', 0.07);
  }

  // ---- scoring -----------------------------------------------------------
  function endMatch(youWon) {
    game.running = false;
    ARCADE_LOCK.unlock();
    verdictEl.textContent = youWon ? 'YOU WIN' : 'GAME OVER';
    verdictEl.className = 'verdict ' + (youWon ? 'win' : 'lose');
    finalScoreEl.innerHTML = 'Core integrity ' + game.hpYou + ' &ndash; ' + game.hpCpu;
    setTimeout(() => endOverlay.classList.remove('hidden'), 650);
  }

  // A ball got past a paddle: drain HP, despawn that ball, keep any others live
  function damage(toPlayer, b, amount) {
    if (toPlayer) {
      game.hpYou = Math.max(0, game.hpYou - amount);
      sfx.scoreCpu();
      game.flashColor = MAGENTA;
      burst(b.x, b.y, b.z, MAGENTA, 46, 1.6);
    } else {
      game.hpCpu = Math.max(0, game.hpCpu - amount);
      game.hpYou = Math.min(MAX_HP, game.hpYou + 1);  // scoring repairs your core
      spawnPowerup();
      sfx.scoreYou();
      game.flashColor = CYAN;
      burst(b.x, b.y, b.z, CYAN, 46, 1.6);
    }
    burst(b.x, b.y, b.z, WHITE, 18, 2.2);
    renderBars();
    game.flash = 0.22;
    game.shake = 8;
    balls.splice(balls.indexOf(b), 1);
    if (game.hpYou <= 0) { endMatch(false); return; }
    if (game.hpCpu <= 0) { endMatch(true); return; }
    if (balls.length === 0) {
      game.rally = 0;
      // the side that scored serves next: CPU serves automatically,
      // you hold the ball until you right-click
      if (toPlayer) serve(-1);
      else playerServeHold();
    }
  }

  // ---- update ------------------------------------------------------------
  function update(dt) {
    // player paddle chases pointer (slight smoothing keeps velocity meaningful)
    const pw = playerW();
    const lim = 1 - 0.02;
    const tx = Math.max(-lim + pw / 2, Math.min(lim - pw / 2, pointer.x));
    const ty = Math.max(-lim + PADDLE_H / 2, Math.min(lim - PADDLE_H / 2, pointer.y));
    player.px = player.x; player.py = player.y;
    player.x += (tx - player.x) * Math.min(1, dt * 18);
    player.y += (ty - player.y) * Math.min(1, dt * 18);
    player.vx = (player.x - player.px) / Math.max(dt, 1e-4);
    player.vy = (player.y - player.py) / Math.max(dt, 1e-4);

    // power charge: builds while the button is held, bleeds off when released
    if (player.charging) player.charge = Math.min(1, player.charge + dt * 1.6);
    else player.charge = Math.max(0, player.charge - dt * 3);

    if (!game.running) return;

    // cpu paddle: chases whichever incoming ball is closest to its wall
    let threat = null, threatDist = Infinity;
    for (const b of balls) {
      if (b.vz > 0) {
        const d = DEPTH - b.z;
        if (d < threatDist) { threatDist = d; threat = b; }
      }
    }
    const diff = 1.9 + Math.min((MAX_HP - game.hpCpu) * 0.14, 1.1); // rubber-bands with damage dealt
    const urgency = threat ? 1 - Math.min(1, threatDist / DEPTH) : 0.3;
    const cpuSpeed = diff * (0.35 + 0.65 * urgency);
    const aimX = threat ? threat.x : 0, aimY = threat ? threat.y : 0;
    cpu.x += Math.max(-cpuSpeed * dt, Math.min(cpuSpeed * dt, (aimX - cpu.x)));
    cpu.y += Math.max(-cpuSpeed * dt, Math.min(cpuSpeed * dt, (aimY - cpu.y)));
    cpu.x = Math.max(-1 + PADDLE_W / 2, Math.min(1 - PADDLE_W / 2, cpu.x));
    cpu.y = Math.max(-1 + PADDLE_H / 2, Math.min(1 - PADDLE_H / 2, cpu.y));

    // power-up lifecycle: expire, or collect by hovering the paddle over it
    if (effects.wide > 0) effects.wide -= dt;
    if (effects.slow > 0) effects.slow -= dt;
    if (powerup) {
      powerup.t -= dt;
      if (powerup.t <= 0) powerup = null;
      else if (Math.abs(player.x - powerup.x) < pw / 2 + 0.07 &&
               Math.abs(player.y - powerup.y) < PADDLE_H / 2 + 0.07) {
        applyPower(powerup);
        powerup = null;
      }
    }

    // held serve: ball rides on your paddle until you right-click
    if (game.holding) {
      const b = balls[0];
      if (b) { b.x = player.x; b.y = player.y; b.z = 0.18; b.trail.length = 0; }
      return;
    }

    if (game.serveTimer > 0) { game.serveTimer -= dt; return; }

    const bdt = effects.slow > 0 ? dt * 0.55 : dt;  // slow-mo power-up
    for (const b of balls) {
      // spin bends the ball's path
      b.vx += b.spinX * bdt;
      b.vy += b.spinY * bdt;

      b.x += b.vx * bdt;
      b.y += b.vy * bdt;
      b.z += b.vz * bdt;

      // wall bounces
      if (b.x > 1 - BALL_R) { b.x = 1 - BALL_R; b.vx = -Math.abs(b.vx); wallHit(b); }
      if (b.x < -1 + BALL_R) { b.x = -1 + BALL_R; b.vx = Math.abs(b.vx); wallHit(b); }
      if (b.y > 1 - BALL_R) { b.y = 1 - BALL_R; b.vy = -Math.abs(b.vy); wallHit(b); }
      if (b.y < -1 + BALL_R) { b.y = -1 + BALL_R; b.vy = Math.abs(b.vy); wallHit(b); }

      // near plane: player
      if (b.z <= 0 && b.vz < 0) {
        // rewind x/y to the instant the ball crossed z=0 — testing at the
        // frame-end position lets fast balls drift past the paddle edge
        // between the visual contact and the check
        const back = b.z / b.vz; // time elapsed since crossing (>= 0)
        b.x -= b.vx * back;
        b.y -= b.vy * back;
        // the paddle also moved during the frame — rewind it to the same instant
        const pf = Math.min(1, Math.max(0, back / Math.max(dt, 1e-4)));
        const pxAt = player.x - (player.x - player.px) * pf;
        const pyAt = player.y - (player.y - player.py) * pf;
        // collide against the ball you SEE: the drawn ball (core + glow) is
        // much larger than the physics core, so use the visible radius
        const R = BALL_R * 1.9;
        if (Math.abs(b.x - pxAt) < pw / 2 + R &&
            Math.abs(b.y - pyAt) < PADDLE_H / 2 + R) {
          const pow = player.charge;
          player.charge = 0;
          b.z = 0;
          b.power = pow > 0.4; // powered balls deal double damage if they get through
          // where on the paddle it hit (-1..1) and how fast the paddle was swiping
          const nx = (b.x - pxAt) / (pw / 2 + R);
          const ny = (b.y - pyAt) / (PADDLE_H / 2 + R);
          const edge = Math.min(1, Math.max(Math.abs(nx), Math.abs(ny)));
          const swipe = Math.hypot(player.vx, player.vy);
          // glancing blows bleed a little forward speed
          b.vz = (Math.abs(b.vz) * 1.045 + 0.12) * (1 + pow * 0.9) * (1 - edge * edge * 0.18);
          // off-center contact kicks harder the closer to the edge it lands
          b.vx += nx * Math.abs(nx) * 3.4;
          b.vy += ny * Math.abs(ny) * 3.4;
          // a swiping paddle drags the ball with it — more so on edge contact
          b.vx += player.vx * 0.25 * (1 + edge);
          b.vy += player.vy * 0.25 * (1 + edge);
          // an edge nip during a fast swipe goes rogue: unpredictable deflection
          const rogue = edge * Math.min(1, swipe * 0.5);
          b.vx += (Math.random() - 0.5) * rogue * 2.6;
          b.vy += (Math.random() - 0.5) * rogue * 2.6;
          // spin bends the flight path; edge hits shear extra spin onto it
          b.spinX = player.vx * (0.35 + edge * 0.45);
          b.spinY = player.vy * (0.35 + edge * 0.45);
          game.rally++;
          game.shake = 9 + pow * 6;
          game.pulse = 1; game.pulseZ = 0; game.pulseDir = 1;
          if (pow > 0.4) {
            bleep(110, 0.22, 'square', 0.12);
            burst(b.x, b.y, 0, WHITE, 30, 1.6);
          } else {
            sfx.playerHit();
          }
          burst(b.x, b.y, 0, CYAN, 22, 1.1);
        } else if (effects.shield > 0) {
          // shield takes the hit and bats the ball back
          effects.shield--;
          b.z = 0;
          b.vz = Math.abs(b.vz);
          burst(b.x, b.y, 0, '#6a9fd8', 26, 1.3);
          bleep(300, 0.18, 'triangle', 0.09);
          game.shake = Math.max(game.shake, 6);
        } else {
          damage(true, b, 1);
          return;
        }
      }

      // far plane: cpu
      if (b.z >= DEPTH && b.vz > 0) {
        const back = (b.z - DEPTH) / b.vz;
        b.x -= b.vx * back;
        b.y -= b.vy * back;
        if (Math.abs(b.x - cpu.x) < PADDLE_W / 2 + BALL_R * 1.9 &&
            Math.abs(b.y - cpu.y) < PADDLE_H / 2 + BALL_R * 1.9) {
          b.z = DEPTH;
          b.power = false;
          b.vz = -(Math.abs(b.vz) * 1.03 + 0.08);
          b.vx += (b.x - cpu.x) * 2.0;
          b.vy += (b.y - cpu.y) * 2.0;
          b.spinX *= 0.4; b.spinY *= 0.4;
          game.rally++;
          game.pulse = 1; game.pulseZ = DEPTH; game.pulseDir = -1;
          sfx.cpuHit();
          burst(b.x, b.y, DEPTH, MAGENTA, 22, 1.1);
        } else {
          damage(false, b, b.power ? 2 : 1);
          return;
        }
      }

      // clamp lateral speed so it stays playable
      const latMax = 2.8;
      b.vx = Math.max(-latMax, Math.min(latMax, b.vx));
      b.vy = Math.max(-latMax, Math.min(latMax, b.vy));

      b.trail.push({ x: b.x, y: b.y, z: b.z });
      if (b.trail.length > 26) b.trail.shift();
    }
  }

  function wallHit(b) {
    sfx.wall();
    burst(b.x, b.y, b.z, LIME, 8, 0.7);
    game.shake = Math.max(game.shake, 3);
  }

  function updateFx(dt) {
    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].t -= dt;
      if (floats[i].t <= 0) floats.splice(i, 1);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.vx *= (1 - dt * 1.6); p.vy *= (1 - dt * 1.6); p.vz *= (1 - dt * 1.6);
      p.life -= p.decay * dt;
      if (p.life <= 0 || p.z < -0.5 || p.z > DEPTH + 2) particles.splice(i, 1);
    }
    if (game.pulse > 0) {
      game.pulse -= dt * 1.4;
      game.pulseZ += game.pulseDir * dt * 7; // pulse travels away from the impacted end
    }
    game.shake = Math.max(0, game.shake - dt * 40);
    game.flash = Math.max(0, game.flash - dt * 1.6);
    for (const s of stars) {
      s.z -= dt * 0.5;
      if (s.z < 0) s.z += DEPTH;
    }
  }

  // ---- draw --------------------------------------------------------------
  function glowLine(x1, y1, x2, y2, color, width, blur, alpha) {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawRect3D(hw, hh, xoff, yoff, z, color, width, blur, alpha) {
    const a = project(xoff - hw, yoff - hh, z);
    const b = project(xoff + hw, yoff - hh, z);
    const c = project(xoff + hw, yoff + hh, z);
    const d = project(xoff - hw, yoff + hh, z);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.stroke();
    return [a, b, c, d];
  }

  let t = 0;
  function draw(dt) {
    t += dt;
    // fade instead of clear -> phosphor persistence
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(5, 5, 7, 0.5)';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (game.shake > 0 && !reducedMotion) {
      ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // starfield behind the tunnel — twinkles with the arpeggio
    for (const s of stars) {
      const p = project(s.x, s.y, s.z);
      if (p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) continue;
      const tw = 0.3 + 0.25 * Math.sin(t * 2 + s.tw) + beat.arp * 0.35;
      ctx.globalAlpha = Math.min(1, tw * p.s);
      ctx.fillStyle = VIOLET;
      ctx.shadowColor = VIOLET;
      ctx.shadowBlur = 6 + beat.arp * 6;
      ctx.fillRect(p.x, p.y, 2, 2);
    }

    // tunnel rings — the whole tunnel thumps on the kick, and a beat-wave
    // rolls from the near wall into the depths once per beat
    const RINGS = 9;
    const waveZ = (beat.phase % 1) * DEPTH;
    for (let i = 0; i <= RINGS; i++) {
      const z = (i / RINGS) * DEPTH;
      const near = 1 - z / DEPTH;
      let alpha = 0.16 + near * 0.22 + beat.kick * 0.09;
      let width = 1 + near * 1.2 + beat.kick * 1.4;
      let color = VIOLET;
      // traveling beat wave (bass-note colored) — kept low-contrast for
      // photosensitive safety; the motion sells the beat, not the brightness
      const wd = Math.abs(z - waveZ);
      if (wd < 0.7 && beat.bass > 0) {
        alpha = Math.min(0.75, alpha + (1 - wd / 0.7) * beat.bass * 0.28);
        width += (1 - wd / 0.7) * beat.bass * 1.6;
      }
      // impact pulse ring
      if (game.pulse > 0 && Math.abs(z - game.pulseZ) < 0.45) {
        alpha = Math.min(1, alpha + game.pulse * 0.8);
        width += game.pulse * 2.5;
        color = game.pulseZ < DEPTH / 2 ? CYAN : MAGENTA;
      }
      // breathe scale: rings expand a hair on the kick
      const bs = 1 + beat.kick * 0.012;
      drawRect3D(bs, bs, 0, 0, z, color, width, 14 + beat.kick * 10, alpha);
    }
    // tunnel corner rails
    const n0 = project(-1, -1, 0), n1 = project(1, -1, 0), n2 = project(1, 1, 0), n3 = project(-1, 1, 0);
    const f0 = project(-1, -1, DEPTH), f1 = project(1, -1, DEPTH), f2 = project(1, 1, DEPTH), f3 = project(-1, 1, DEPTH);
    glowLine(n0.x, n0.y, f0.x, f0.y, VIOLET, 1.4, 12, 0.5);
    glowLine(n1.x, n1.y, f1.x, f1.y, VIOLET, 1.4, 12, 0.5);
    glowLine(n2.x, n2.y, f2.x, f2.y, VIOLET, 1.4, 12, 0.5);
    glowLine(n3.x, n3.y, f3.x, f3.y, VIOLET, 1.4, 12, 0.5);

    // ball depth markers: guide lines on all four walls run from the near
    // plane to the ball's depth — their endpoints show how close it is —
    // plus a ring at that depth. Everything brightens as the ball approaches.
    if (game.running) {
      for (const b of balls) {
        const z = Math.max(0, Math.min(DEPTH, b.z));
        const col = b.power ? WHITE : LIME;
        const close = 1 - z / DEPTH;              // 0 far -> 1 at your face
        const la = 0.14 + close * 0.4;
        const lw = 1.2 + close * 1.2;
        // left / right walls track the ball's height; top / bottom its x
        const pairs = [
          [project(-1, b.y, 0), project(-1, b.y, z)],
          [project(1, b.y, 0), project(1, b.y, z)],
          [project(b.x, -1, 0), project(b.x, -1, z)],
          [project(b.x, 1, 0), project(b.x, 1, z)],
        ];
        for (const [p0, p1] of pairs) glowLine(p0.x, p0.y, p1.x, p1.y, col, lw, 8, la);
        drawRect3D(1, 1, 0, 0, z, col, 1 + close, 6, 0.08 + close * 0.2);
      }
    }

    // cpu paddle (far, draw first) — glow swells on the snare
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    drawRect3D(PADDLE_W / 2, PADDLE_H / 2, cpu.x, cpu.y, DEPTH, MAGENTA, 2.4 + beat.snare * 1.2, 18 + beat.snare * 14, 0.95);
    ctx.lineCap = 'round';
    // shadow projection of cpu paddle onto far plane grid (subtle fill)
    {
      const q = drawRect3D(PADDLE_W / 2, PADDLE_H / 2, cpu.x, cpu.y, DEPTH, MAGENTA, 1, 0, 0.0);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = MAGENTA;
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.lineTo(q[2].x, q[2].y); ctx.lineTo(q[3].x, q[3].y);
      ctx.fill();
    }

    // trails + balls
    if (game.running || particles.length === 0) {
      for (const b of balls) {
        const col = b.power ? WHITE : LIME;
        const colFade = b.power ? 'rgba(255,255,255,0)' : 'rgba(230,207,94,0)';
        for (let i = 0; i < b.trail.length; i++) {
          const p = b.trail[i];
          const pr = project(p.x, p.y, p.z);
          const f = i / b.trail.length;
          ctx.globalAlpha = f * 0.35;
          ctx.fillStyle = col;
          ctx.shadowColor = col;
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(pr.x, pr.y, BALL_R * viewScale * pr.s * f * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
        const bp = project(b.x, b.y, b.z);
        const r = Math.max(2, BALL_R * viewScale * bp.s) * (1 + beat.kick * 0.18);
        ctx.globalAlpha = 1;
        const grad = ctx.createRadialGradient(bp.x, bp.y, 0, bp.x, bp.y, r * 2.4);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.35, col);
        grad.addColorStop(1, colFade);
        ctx.fillStyle = grad;
        ctx.shadowColor = col;
        ctx.shadowBlur = 24;
        ctx.beginPath();
        ctx.arc(bp.x, bp.y, r * 2.4, 0, Math.PI * 2);
        ctx.fill();
        // serve countdown ring on the served ball
        if (game.serveTimer > 0 && b === balls[0]) {
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = WHITE;
          ctx.lineWidth = 2;
          ctx.shadowBlur = 12;
          ctx.shadowColor = WHITE;
          ctx.beginPath();
          ctx.arc(bp.x, bp.y, r * 3.2, -Math.PI / 2, -Math.PI / 2 + (1 - game.serveTimer / 0.9) * Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // particles: line shards
    ctx.lineWidth = 1.6;
    for (const p of particles) {
      const a = project(p.x, p.y, p.z);
      const b = project(p.x + p.vx * p.len, p.y + p.vy * p.len, p.z + p.vz * p.len);
      ctx.globalAlpha = Math.max(0, p.life) * 0.9;
      ctx.strokeStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // shield: a faint blue frame across your goal plane while charges remain
    if (effects.shield > 0 && game.running) {
      const sp = 0.22 + 0.05 * Math.sin(t * 2.2);
      drawRect3D(0.99, 0.99, 0, 0, 0.02, '#6a9fd8', 1.5 + effects.shield * 0.8, 10, sp);
    }

    // power-up pickup box (bottom-right of your grid)
    if (powerup && game.running) {
      const pp = project(powerup.x, powerup.y, 0);
      const sz = 0.06 * viewScale * pp.s;
      const fade = Math.min(1, powerup.t / 1.5);
      ctx.save();
      ctx.translate(pp.x, pp.y);
      ctx.rotate(t * 1.2);
      ctx.globalAlpha = 0.85 * fade;
      ctx.strokeStyle = powerup.color;
      ctx.shadowColor = powerup.color;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 2;
      ctx.strokeRect(-sz, -sz, sz * 2, sz * 2);
      ctx.rotate(-t * 2.8);
      ctx.globalAlpha = 0.5 * fade;
      ctx.strokeRect(-sz * 0.55, -sz * 0.55, sz * 1.1, sz * 1.1);
      ctx.restore();
      ctx.globalAlpha = 0.75 * fade;
      ctx.fillStyle = powerup.color;
      ctx.shadowColor = powerup.color;
      ctx.shadowBlur = 8;
      ctx.font = '600 11px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(powerup.label, pp.x, pp.y + sz + 18);
    }

    // player paddle (near, drawn last, semi-transparent so you see through)
    {
      const phw = playerW() / 2;
      const q = [
        project(player.x - phw, player.y - PADDLE_H / 2, 0),
        project(player.x + phw, player.y - PADDLE_H / 2, 0),
        project(player.x + phw, player.y + PADDLE_H / 2, 0),
        project(player.x - phw, player.y + PADDLE_H / 2, 0),
      ];
      const chg = player.charge;
      ctx.globalAlpha = 0.1 + chg * 0.08;
      ctx.fillStyle = CYAN;
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.lineTo(q[2].x, q[2].y); ctx.lineTo(q[3].x, q[3].y);
      ctx.fill();
      // charge meter: white inner frame grows as the power hit charges
      if (chg > 0.02) {
        ctx.globalAlpha = chg * 0.8;
        ctx.strokeStyle = WHITE;
        ctx.lineWidth = 1.5 + chg * 1.5;
        ctx.shadowColor = WHITE;
        ctx.shadowBlur = 8 + chg * 12;
        const inset = (1 - chg) * 14 + 6;
        ctx.strokeRect(
          Math.min(q[0].x, q[2].x) + inset, Math.min(q[0].y, q[2].y) + inset,
          Math.abs(q[2].x - q[0].x) - inset * 2, Math.abs(q[2].y - q[0].y) - inset * 2
        );
      }
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = CYAN;
      ctx.lineWidth = 3 + beat.kick * 1.5 + chg * 1.5;
      ctx.shadowColor = CYAN;
      ctx.shadowBlur = 22 + beat.kick * 16 + chg * 18;
      ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(q[0].x, q[0].y); ctx.lineTo(q[1].x, q[1].y); ctx.lineTo(q[2].x, q[2].y); ctx.lineTo(q[3].x, q[3].y);
      ctx.closePath();
      ctx.stroke();
      ctx.lineCap = 'round';
      // held serve hint above the paddle
      if (game.holding && game.running) {
        const hp = project(player.x, player.y - PADDLE_H / 2 - 0.14, 0);
        ctx.globalAlpha = 0.75 + 0.2 * Math.sin(t * 3);
        ctx.fillStyle = CYAN;
        ctx.shadowColor = CYAN;
        ctx.shadowBlur = 8;
        ctx.font = '600 12px Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillText('RIGHT CLICK TO SERVE', hp.x, hp.y);
      }
    }

    // rising pickup labels
    for (const f of floats) {
      const fp = project(f.x, f.y - (1.4 - f.t) * 0.25, 0);
      ctx.globalAlpha = Math.min(1, f.t / 1.4) * 0.9;
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 10;
      ctx.font = '600 13px Consolas, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, fp.x, fp.y);
    }

    ctx.restore();

    // score glow: a soft centered bloom, never a full-screen flash
    // (large-area high-contrast flashes are a photosensitive-seizure trigger)
    if (game.flash > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = game.flash * 0.4;
      ctx.shadowBlur = 0;
      const fg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * 0.45);
      fg.addColorStop(0, game.flashColor);
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);
    }

    // vignette
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    const vg = ctx.createRadialGradient(cx, cy, Math.min(W, H) * 0.35, cx, cy, Math.max(W, H) * 0.75);
    vg.addColorStop(0, 'rgba(5,5,7,0)');
    vg.addColorStop(1, 'rgba(5,5,7,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // ---- loop --------------------------------------------------------------
  // shared services for the other arcade games
  window.ARCADE = {
    audio, startMusic, toggleMusic, setStyle, bleep, sweep, hat, beat,
    suspend: () => { if (AC) AC.suspend(); },
    resume: () => { if (AC) AC.resume(); },
  };

  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    dt = Math.min(dt, 1 / 30);
    updateBeat();
    // pong only renders in its own mode; the menu splash is a solid card
    if (window.MODE === 'pong' && !game.paused) {
      update(dt);
      updateFx(dt);
      draw(dt);
      ARCADE_FX.bezel(ctx);
    }
    requestAnimationFrame(frame);
  }
  serve(1);
  game.running = false;
  requestAnimationFrame(frame);
})();
