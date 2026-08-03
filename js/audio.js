'use strict';
// ---- ARCADE AUDIO -------------------------------------------------------
// The synth, the sequencer and the song book, lifted out of pong.js when the
// games moved to Rust. Every game — ported or not — drives sound through the
// window.ARCADE surface exported at the bottom.
window.MODE = 'menu';   // 'menu' | 'pong' | 'tetris' | 'snake' | 'geo' | 'cards' | 'dungeon'
(() => {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ---- audio -------------------------------------------------------------
  let AC = null;
  let sfxBus = null;
  const S = window.ARCADE_SETTINGS;
  // every one-shot lands here instead of on the destination directly, so the
  // game-volume slider has a single node to move
  function sfxOut() {
    if (!AC) return null;
    if (!sfxBus) {
      sfxBus = AC.createGain();
      sfxBus.gain.value = S ? S.get('sfx') : 1;
      sfxBus.connect(AC.destination);
    }
    return sfxBus;
  }
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (AC && AC.state === 'suspended') AC.resume();
    sfxOut();
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
    o.connect(g).connect(sfxOut() || AC.destination);
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
      o.connect(g).connect(sfxOut() || AC.destination);
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
    src.connect(f).connect(g).connect(sfxOut() || AC.destination);
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
    music.bus.gain.value = S ? S.get('music') : 0.5;
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
    const lvl = S ? S.get('music') : 0.5;
    if (music.bus) music.bus.gain.setTargetAtTime(music.on ? Math.max(0.0001, lvl) : 0.0001, AC.currentTime, 0.05);
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
  if (S) {
    S.onChange((k, v) => {
      if (!AC) return;
      if (k === 'sfx' && sfxBus) sfxBus.gain.setTargetAtTime(v, AC.currentTime, 0.03);
      if (k === 'music' && music.bus && music.on) {
        music.bus.gain.setTargetAtTime(Math.max(0.0001, v), AC.currentTime, 0.03);
      }
    });
  }

  // shared services for every game in the cabinet
  window.ARCADE = {
    audio, startMusic, toggleMusic, setStyle, bleep, sweep, hat, beat,
    suspend: () => { if (AC) AC.suspend(); },
    resume: () => { if (AC) AC.resume(); },
  };

  // the beat envelopes are read by every renderer, so keep them current
  // regardless of which game (or none) is on screen
  function beatLoop() {
    updateBeat();
    requestAnimationFrame(beatLoop);
  }
  requestAnimationFrame(beatLoop);
})();
