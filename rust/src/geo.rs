//! Geo Wars: twin-stick survival over a spring-mass grid.
//!
//! Ported from js/geo.js. Screen space throughout — the arena is the window.
//! Co-op is host-authoritative: the host simulates both ships and the whole
//! board, the guest sends its stick and draws the answer.

use crate::bridge;
use crate::gfx::{Gfx, CYAN, LIME, MAGENTA, WHITE};
use crate::net::{Input, Net};
use crate::rng::Rng;
use serde::{Deserialize, Serialize};
use std::f64::consts::{PI, TAU};

const GRID_SPACING: f64 = 44.0;

/// Inside this many pixels of the reticle the ship keeps its last heading
/// instead of chasing an unstable angle.
const AIM_DEADZONE: f64 = 26.0;
/// The reticle is carried relative to the ship rather than parked at an
/// absolute screen point: mouse movement pushes it out, and movement older
/// than about a second stops counting, so it eases back in when you hold
/// still. Where the ship flies is WASD's business alone.
const AIM_REACH: f64 = 300.0;
const AIM_FADE: f64 = 0.45;

/// One identity color per player, hull included — not just the glow. Both
/// ships used to be stroked white with only a faint colored halo to tell them
/// apart, which is unreadable once the swarm is on top of you.
///
/// Neither color belongs to anything else on screen: enemies are magenta
/// (chaser), cyan (drifter), lime (weaver) and near-white (bit), bullets are
/// lime, wells are magenta. Amber is otherwise unused, and the ship is the
/// only triangle in the game.
const SHIP_COLORS: [&str; 2] = [CYAN, "#f2903c"];
fn ship_color(i: usize) -> &'static str {
    SHIP_COLORS[i % SHIP_COLORS.len()]
}

/// Every mob is a handful of line segments — no sprites anywhere in this game,
/// which is why adding one is code rather than art. Each has a silhouette you
/// can read at a glance and exactly one trick.
#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
enum Kind {
    #[default]
    Chaser,
    Drifter,
    Weaver,
    Bit,
    /// hexagon — breaks into two shards when shot
    Splitter,
    /// small triangle, fast, born from a splitter
    Shard,
    /// cross — hangs back and shoots at you
    Sniper,
    /// double square — deflects shots that hit its front
    Bulwark,
    /// spoked ring — roots itself, charges, then detonates a wave
    Pulsar,
}

impl Kind {
    fn color(&self) -> &'static str {
        match self {
            Kind::Chaser => MAGENTA,
            Kind::Drifter => CYAN,
            Kind::Weaver => LIME,
            Kind::Bit => "#f2f2f2",
            Kind::Splitter => "#c37ae6",
            Kind::Shard => "#d9a2f0",
            Kind::Sniper => "#f2903c",
            Kind::Bulwark => "#6a9fd8",
            Kind::Pulsar => "#e8d44e",
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Ship {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    mov_x: f64,
    mov_y: f64,
    aim_x: f64,
    aim_y: f64,
    /// Heading held between updates. Deriving it from the cursor vector every
    /// frame makes the ship spin when the cursor is on top of it, because
    /// atan2 of a near-zero vector is noise.
    aim_a: f64,
    firing: bool,
    fire_t: f64,
    alive: bool,
}

#[derive(Clone, Copy)]
struct Bullet {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
}

#[derive(Clone, Copy, Default)]
struct Enemy {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    kind: Kind,
    r: f64,
    spd: f64,
    wob: f64,
    fade: f64,
    pv: i32,
    /// shot cooldown for the sniper, charge for the pulsar
    cool: f64,
    /// hits still to take. Zero and one both mean one — only the mobs whose
    /// trick needs time to land bother setting it, because a pulsar that dies
    /// to the first stray bullet never gets to do the one thing it is for.
    hp: i32,
    /// heading it presents, which is the side a bulwark can block from
    face: f64,
}

/// A shot from a sniper. The swarm could only ever touch you before; this is
/// the first thing in the game that can hit you from across the arena.
#[derive(Clone, Copy)]
struct EBullet {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    life: f64,
}

struct Particle {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    life: f64,
    decay: f64,
    color: String,
    len: f64,
    grav: bool,
}

/// A soft light stamped on a detonation. The line shards read as debris;
/// this is the heat they came off.
struct Flash {
    x: f64,
    y: f64,
    r: f64,
    life: f64,
    decay: f64,
}

struct Spray {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    life: f64,
}

#[derive(Clone, Copy)]
struct Hole {
    x: f64,
    y: f64,
    r: f64,
    hp: i32,
    eaten: i32,
    flash: f64,
    spray_a: f64,
}

#[derive(Clone, Copy)]
struct Shock {
    x: f64,
    y: f64,
    rad: f64,
    speed: f64,
    max_rad: f64,
}

struct GridPt {
    x: f64,
    y: f64,
    ox: f64,
    oy: f64,
    vx: f64,
    vy: f64,
    fx: f64,
    fy: f64,
    damp: f64,
    pin: bool,
}

struct Spring {
    a: Option<usize>,
    b: usize,
    k: f64,
    d: f64,
    target: f64,
}

struct Dust {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    s: f64,
    ph: f64,
    f: f64,
}

struct Blob {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    r: f64,
    tint: &'static str,
}

#[derive(Serialize, Deserialize, Default)]
struct Snapshot {
    ships: Vec<(f32, f32, f32, f32, bool)>,
    bullets: Vec<(f32, f32, f32, f32)>,
    enemies: Vec<(f32, f32, Kind, f32, f32, f32, f32)>,
    ebullets: Vec<(f32, f32, f32, f32)>,
    holes: Vec<(f32, f32, f32, f32)>,
    shocks: Vec<(f32, f32, f32, f32)>,
    score: u32,
    mult: u8,
    lives: i8,
    kills: u32,
    time: f32,
    running: bool,
}

pub struct Geo {
    g: Gfx,
    rng: Rng,
    pub running: bool,
    paused: bool,
    ships: Vec<Ship>,
    bullets: Vec<Bullet>,
    ebullets: Vec<EBullet>,
    enemies: Vec<Enemy>,
    parts: Vec<Particle>,
    spray: Vec<Spray>,
    flashes: Vec<Flash>,
    holes: Vec<Hole>,
    shocks: Vec<Shock>,
    hole_t: f64,
    score: u32,
    kills: u32,
    lives: i32,
    inv: f64,
    mult: u32,
    mult_t: f64,
    next_life: u32,
    spawn_t: f64,
    time: f64,
    shake: f64,
    best: u32,
    keys_left: bool,
    keys_right: bool,
    keys_up: bool,
    keys_down: bool,
    grid_pts: Vec<GridPt>,
    springs: Vec<Spring>,
    grid_cols: usize,
    grid_rows: usize,
    grid_w: f64,
    grid_h: f64,
    dust: Vec<Dust>,
    blobs: Vec<Blob>,
    t: f64,
    reduced: bool,
    /// Where this player is pointing, in screen pixels. Kept apart from the
    /// ship slots because on the guest the snapshot owns those every frame.
    local_aim: (f64, f64),
    /// The reticle's offset from our own ship, in screen pixels.
    aim_off: (f64, f64),
    pub net: Net,
}

impl Geo {
    pub fn new(canvas_id: &str, seed: u64) -> Option<Self> {
        let g = Gfx::new(canvas_id)?;
        let rng = Rng::new(seed);
        let best = bridge::storage_get("geoBest")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);
        let mut geo = Geo {
            g,
            rng,
            running: false,
            paused: false,
            ships: vec![Ship::default()],
            bullets: Vec::new(),
            ebullets: Vec::new(),
            enemies: Vec::new(),
            parts: Vec::new(),
            spray: Vec::new(),
            flashes: Vec::new(),
            holes: Vec::new(),
            shocks: Vec::new(),
            hole_t: 12.0,
            score: 0,
            kills: 0,
            lives: 4,
            inv: 0.0,
            mult: 1,
            mult_t: 0.0,
            next_life: 20000,
            spawn_t: 1.0,
            time: 0.0,
            shake: 0.0,
            best,
            keys_left: false,
            keys_right: false,
            keys_up: false,
            keys_down: false,
            grid_pts: Vec::new(),
            springs: Vec::new(),
            grid_cols: 0,
            grid_rows: 0,
            grid_w: 0.0,
            grid_h: 0.0,
            dust: Vec::new(),
            blobs: Vec::new(),
            t: 0.0,
            reduced: bridge::reduced_motion(),
            local_aim: (0.0, 0.0),
            aim_off: (0.0, -140.0),
            net: Net::new(),
        };
        geo.init_atmos();
        geo.prime();
        Some(geo)
    }

    pub fn net_open(&mut self, host: bool) {
        self.net.open(host);
        // co-op needs a second hull
        if self.ships.len() < 2 {
            let mut s = Ship {
                alive: true,
                ..Default::default()
            };
            s.x = self.g.w * 0.5 + 60.0;
            s.y = self.g.h * 0.5;
            s.aim_x = s.x;
            s.aim_y = s.y - 100.0;
            s.aim_a = -std::f64::consts::FRAC_PI_2;
            self.ships.push(s);
        }
    }

    fn init_atmos(&mut self) {
        let (w, h) = (self.g.w, self.g.h);
        self.dust.clear();
        for _ in 0..90 {
            self.dust.push(Dust {
                x: self.rng.f() * w,
                y: self.rng.f() * h,
                vx: self.rng.signed() * 26.0,
                vy: self.rng.signed() * 26.0,
                s: 0.6 + self.rng.f() * 1.6,
                ph: self.rng.f() * 6.28,
                f: 0.4 + self.rng.f() * 1.6,
            });
        }
        let tints = [
            "224, 69, 155",
            "143, 206, 154",
            "69, 116, 224",
            "195, 122, 230",
        ];
        self.blobs.clear();
        for tint in tints {
            self.blobs.push(Blob {
                x: self.rng.f() * w,
                y: self.rng.f() * h,
                vx: self.rng.signed() * 9.0,
                vy: self.rng.signed() * 9.0,
                r: 200.0 + self.rng.f() * 280.0,
                tint,
            });
        }
    }

    /// Absolute cursor position, which this game deliberately ignores — the
    /// reticle is relative to the ship. Kept so the shared shell can call it
    /// for every game without special-casing.
    pub fn pointer(&mut self, _x: f64, _y: f64) {}

    /// Mouse movement since the last report, in screen pixels.
    pub fn aim_delta(&mut self, dx: f64, dy: f64) {
        self.aim_off.0 += dx;
        self.aim_off.1 += dy;
        let d = self.aim_off.0.hypot(self.aim_off.1);
        if d > AIM_REACH {
            let k = AIM_REACH / d;
            self.aim_off.0 *= k;
            self.aim_off.1 *= k;
        }
    }

    /// Carry the reticle along with the ship and let old movement decay out.
    /// Runs every frame on whichever hull is ours.
    fn sync_reticle(&mut self, dt: f64) {
        let keep = (-dt / AIM_FADE).exp();
        self.aim_off.0 *= keep;
        self.aim_off.1 *= keep;
        let idx = if self.net.is_guest() { 1 } else { 0 };
        let off = self.aim_off;
        if let Some(s) = self.ships.get_mut(idx) {
            s.aim_x = s.x + off.0;
            s.aim_y = s.y + off.1;
            self.local_aim = (s.aim_x, s.aim_y);
        }
    }

    pub fn button(&mut self, button: i32, down: bool) {
        if button != 0 {
            return;
        }
        let idx = if self.net.is_guest() { 1 } else { 0 };
        if let Some(s) = self.ships.get_mut(idx) {
            s.firing = down && self.running;
        }
    }

    pub fn key(&mut self, name: &str, down: bool) {
        match name {
            "a" | "arrowleft" => self.keys_left = down,
            "d" | "arrowright" => self.keys_right = down,
            "w" | "arrowup" => self.keys_up = down,
            "s" | "arrowdown" => self.keys_down = down,
            _ => {}
        }
    }

    pub fn hud(&self) -> String {
        format!(
            "{}|{}|{}|{}|{}",
            self.score,
            self.best.max(self.score),
            self.kills,
            self.time as u32,
            self.lives
        )
    }

    fn prime(&mut self) {
        let (w, h) = (self.g.w, self.g.h);
        for (i, s) in self.ships.iter_mut().enumerate() {
            s.x = w / 2.0 + if i == 0 { 0.0 } else { 70.0 };
            s.y = h / 2.0;
            s.vx = 0.0;
            s.vy = 0.0;
            s.mov_x = 0.0;
            s.mov_y = 0.0;
            s.aim_x = s.x;
            s.aim_y = h * 0.3;
            s.aim_a = -std::f64::consts::FRAC_PI_2;
            s.fire_t = 0.0;
            s.firing = false;
            s.alive = true;
        }
        self.bullets.clear();
        self.ebullets.clear();
        self.enemies.clear();
        self.parts.clear();
        self.spray.clear();
        self.flashes.clear();
        self.holes.clear();
        self.shocks.clear();
        self.hole_t = 12.0;
        self.score = 0;
        self.kills = 0;
        self.lives = 4;
        self.inv = 0.0;
        self.mult = 1;
        self.mult_t = 0.0;
        self.next_life = 20000;
        self.spawn_t = 1.0;
        self.time = 0.0;
        self.shake = 0.0;
        self.build_grid();
    }

    pub fn start(&mut self) {
        self.prime();
        self.running = true;
    }

    // ---- spring grid ----------------------------------------------------
    fn build_grid(&mut self) {
        let (w, h) = (self.g.w, self.g.h);
        self.grid_w = w;
        self.grid_h = h;
        let over = GRID_SPACING * 1.5;
        let (gx, gy) = (-over, -over);
        let (gw, gh) = (w + over * 2.0, h + over * 2.0);
        let cols = ((gw / GRID_SPACING).round() as usize).max(4);
        let rows = ((gh / GRID_SPACING).round() as usize).max(4);
        self.grid_cols = cols;
        self.grid_rows = rows;
        self.grid_pts.clear();
        self.springs.clear();
        for r in 0..=rows {
            for c in 0..=cols {
                let x = gx + (c as f64 / cols as f64) * gw;
                let y = gy + (r as f64 / rows as f64) * gh;
                let pin = c == 0 || r == 0 || c == cols || r == rows;
                self.grid_pts.push(GridPt {
                    x,
                    y,
                    ox: x,
                    oy: y,
                    vx: 0.0,
                    vy: 0.0,
                    fx: 0.0,
                    fy: 0.0,
                    damp: 0.98,
                    pin,
                });
            }
        }
        let idx = |c: usize, r: usize| r * (cols + 1) + c;
        for r in 0..=rows {
            for c in 0..=cols {
                let i = idx(c, r);
                if c % 2 == 0 && r % 2 == 0 && !self.grid_pts[i].pin {
                    self.springs.push(Spring {
                        a: None,
                        b: i,
                        k: 0.012,
                        d: 0.06,
                        target: 0.0,
                    });
                }
                if c > 0 {
                    self.springs.push(self.make_spring(idx(c - 1, r), i));
                }
                if r > 0 {
                    self.springs.push(self.make_spring(idx(c, r - 1), i));
                }
            }
        }
    }

    fn make_spring(&self, a: usize, b: usize) -> Spring {
        let pa = &self.grid_pts[a];
        let pb = &self.grid_pts[b];
        Spring {
            a: Some(a),
            b,
            k: 0.4,
            d: 0.14,
            target: (pa.x - pb.x).hypot(pa.y - pb.y) * 0.95,
        }
    }

    fn grid_update(&mut self) {
        for s in &self.springs {
            match s.a {
                None => {
                    let p = &mut self.grid_pts[s.b];
                    p.fx += (p.ox - p.x) * s.k - p.vx * s.d;
                    p.fy += (p.oy - p.y) * s.k - p.vy * s.d;
                }
                Some(ai) => {
                    let (ax, ay, avx, avy) = {
                        let a = &self.grid_pts[ai];
                        (a.x, a.y, a.vx, a.vy)
                    };
                    let (bx, by, bvx, bvy) = {
                        let b = &self.grid_pts[s.b];
                        (b.x, b.y, b.vx, b.vy)
                    };
                    let (dx, dy) = (ax - bx, ay - by);
                    let len = dx.hypot(dy);
                    if len <= s.target {
                        continue; // springs only pull
                    }
                    let str_ = (len - s.target) / len;
                    let (dvx, dvy) = (bvx - avx, bvy - avy);
                    let fx = s.k * dx * str_ - dvx * s.d;
                    let fy = s.k * dy * str_ - dvy * s.d;
                    self.grid_pts[ai].fx -= fx;
                    self.grid_pts[ai].fy -= fy;
                    self.grid_pts[s.b].fx += fx;
                    self.grid_pts[s.b].fy += fy;
                }
            }
        }
        for p in &mut self.grid_pts {
            if p.pin {
                p.fx = 0.0;
                p.fy = 0.0;
                p.vx = 0.0;
                p.vy = 0.0;
                p.damp = 0.95;
                continue;
            }
            p.vx += p.fx;
            p.vy += p.fy;
            p.x += p.vx;
            p.y += p.vy;
            p.fx = 0.0;
            p.fy = 0.0;
            p.vx *= p.damp;
            p.vy *= p.damp;
            p.damp = 0.95;
        }
    }

    fn grid_explosive(&mut self, force: f64, x: f64, y: f64, radius: f64) {
        let r2 = radius * radius;
        for p in &mut self.grid_pts {
            let (dx, dy) = (p.x - x, p.y - y);
            let d2 = dx * dx + dy * dy;
            if d2 < r2 {
                let f = 100.0 * force / (10000.0 + d2);
                p.fx += dx * f;
                p.fy += dy * f;
                p.damp *= 0.6;
            }
        }
    }

    fn grid_implosive(&mut self, force: f64, x: f64, y: f64, radius: f64) {
        let r2 = radius * radius;
        for p in &mut self.grid_pts {
            let (dx, dy) = (x - p.x, y - p.y);
            let d2 = dx * dx + dy * dy;
            if d2 < r2 {
                let f = 10.0 * force / (100.0 + d2);
                p.fx += dx * f;
                p.fy += dy * f;
                p.damp *= 0.6;
            }
        }
    }

    fn flash(&mut self, x: f64, y: f64, r: f64, decay: f64) {
        self.flashes.push(Flash { x, y, r, life: 1.0, decay });
    }

    /// Particle counts scale with the graphics setting; always leave at least
    /// one so an effect never silently vanishes.
    fn scaled(&self, n: usize) -> usize {
        (((n as f64) * self.g.particle_scale).round() as usize).max(1)
    }

    // ---- effects --------------------------------------------------------
    fn burst(&mut self, x: f64, y: f64, color: &str, n: usize, power: f64) {
        for _ in 0..self.scaled(n) {
            let a = self.rng.angle();
            let sp = (30.0 + self.rng.f().powi(2) * 380.0) * power;
            let white = self.rng.f() < 0.22;
            self.parts.push(Particle {
                x,
                y,
                vx: a.cos() * sp,
                vy: a.sin() * sp,
                life: 1.0,
                decay: 1.0 + self.rng.f() * 2.2,
                color: if white { WHITE.into() } else { color.to_string() },
                len: 4.0 + self.rng.f() * 14.0,
                grav: false,
            });
        }
    }

    fn enemy_burst(&mut self, x: f64, y: f64) {
        let h1 = self.rng.f() * 360.0;
        let h2 = h1 + self.rng.f() * 120.0;
        for _ in 0..self.scaled(40) {
            let a = self.rng.angle();
            let sp = 1080.0 * (1.0 - 1.0 / (1.0 + self.rng.f() * 9.0));
            let hue = ((h1 + (h2 - h1) * self.rng.f()) % 360.0).floor();
            self.parts.push(Particle {
                x,
                y,
                vx: a.cos() * sp,
                vy: a.sin() * sp,
                life: 1.0,
                decay: 0.8 + self.rng.f() * 1.4,
                color: format!("hsl({hue}, 60%, 68%)"),
                len: 4.0 + self.rng.f() * 12.0,
                grav: true,
            });
        }
    }

    fn player_burst(&mut self, x: f64, y: f64) {
        for _ in 0..self.scaled(300) {
            let a = self.rng.angle();
            let sp = 1080.0 * (1.0 - 1.0 / (1.0 + self.rng.f() * 9.0));
            let white = self.rng.f() < 0.5;
            self.parts.push(Particle {
                x,
                y,
                vx: a.cos() * sp,
                vy: a.sin() * sp,
                life: 1.0,
                decay: 0.5 + self.rng.f() * 0.6,
                color: if white { "#ffffff".into() } else { "#ccc966".into() },
                len: 6.0 + self.rng.f() * 14.0,
                grav: false,
            });
        }
    }

    fn ring_burst(&mut self, x: f64, y: f64) {
        // this one has to keep reading as a ring, so thin the spokes rather
        // than let the count drop far enough to break the circle
        let n = self.scaled(150).max(24);
        let off = self.rng.f() * (TAU / n as f64);
        let hue = ((self.t * 180.0) % 360.0).floor();
        for k in 0..n {
            let a = (TAU * k as f64) / n as f64 + off;
            let spd = 480.0 + self.rng.f() * 480.0;
            self.parts.push(Particle {
                x: x + a.cos() * 4.0,
                y: y + a.sin() * 4.0,
                vx: a.cos() * spd,
                vy: a.sin() * spd,
                life: 1.0,
                decay: 0.65 + self.rng.f() * 0.35,
                color: format!("hsl({hue}, 65%, 74%)"),
                len: 6.0 + self.rng.f() * 12.0,
                grav: false,
            });
        }
    }

    // ---- scoring --------------------------------------------------------
    fn add_points(&mut self, base: u32) {
        self.score += base * self.mult;
        while self.score >= self.next_life {
            self.next_life += 20000;
            self.lives += 1;
            bridge::sample("life", 0.18);
        }
    }
    fn bump_mult(&mut self) {
        self.mult_t = 0.8;
        if self.mult < 20 {
            self.mult += 1;
        }
    }
    fn save_best(&mut self) {
        if self.score > self.best {
            self.best = self.score;
            bridge::storage_set("geoBest", &self.best.to_string());
        }
    }

    fn die(&mut self) {
        self.running = false;
        for s in &mut self.ships {
            s.firing = false;
        }
        let (x, y) = (self.ships[0].x, self.ships[0].y);
        self.player_burst(x, y);
        self.flash(x, y, 260.0, 1.1);
        self.grid_explosive(120.0, x, y, 300.0);
        self.shake = 16.0;
        self.save_best();
        bridge::sample("death", 0.22);
        bridge::event(
            "geo",
            "over",
            &format!(
                "{}|{}|{}|{}",
                self.score, self.best, self.kills, self.time as u32
            ),
        );
    }

    fn ship_hit(&mut self) {
        self.lives -= 1;
        self.mult = 1;
        self.mult_t = 0.0;
        let (x, y) = (self.ships[0].x, self.ships[0].y);
        self.player_burst(x, y);
        self.flash(x, y, 200.0, 1.5);
        self.grid_explosive(100.0, x, y, 280.0);
        self.shake = 14.0;
        bridge::sample("hit", 0.2);
        bridge::hat(0.09, 0.12);
        let corpses: Vec<(f64, f64, Kind)> =
            self.enemies.iter().map(|e| (e.x, e.y, e.kind)).collect();
        for (ex, ey, kind) in corpses {
            self.burst(ex, ey, kind.color(), 6, 1.0);
        }
        self.enemies.clear();
        for i in (0..self.holes.len()).rev() {
            self.explode_hole(i, false);
        }
        self.inv = 2.0;
        if self.lives <= 0 {
            self.die();
        }
    }

    fn spawn_enemy(&mut self) {
        let (w, h) = (self.g.w, self.g.h);
        let side = self.rng.below(4);
        let (mut x, mut y) = match side {
            0 => (self.rng.f() * w, 10.0),
            1 => (self.rng.f() * w, h - 10.0),
            2 => (10.0, self.rng.f() * h),
            _ => (w - 10.0, self.rng.f() * h),
        };
        let (sx, sy) = (self.ships[0].x, self.ships[0].y);
        if (x - sx).hypot(y - sy) < 200.0 {
            x = w - x;
            y = h - y;
        }
        // weights ramp in with time so a new run still opens simple
        let t = self.time;
        let pool: [(Kind, f64); 7] = [
            (Kind::Chaser, 30.0),
            (Kind::Drifter, 22.0),
            (Kind::Weaver, if t > 25.0 { 18.0 } else { 0.0 }),
            (Kind::Splitter, if t > 20.0 { 14.0 } else { 0.0 }),
            (Kind::Sniper, if t > 15.0 { 12.0 } else { 0.0 }),
            (Kind::Bulwark, if t > 35.0 { 12.0 } else { 0.0 }),
            (Kind::Pulsar, if t > 45.0 { 9.0 } else { 0.0 }),
        ];
        let total: f64 = pool.iter().map(|(_, w)| w).sum();
        let mut roll = self.rng.f() * total;
        let mut kind = Kind::Chaser;
        for (k, w) in pool {
            roll -= w;
            if roll <= 0.0 {
                kind = k;
                break;
            }
        }
        let a = self.rng.angle();
        let e = match kind {
            Kind::Weaver => Enemy {
                kind, r: 9.0, spd: 200.0 + t, wob: self.rng.f() * 6.28, pv: 3, ..Default::default()
            },
            Kind::Drifter => Enemy {
                kind, r: 11.0, vx: a.cos() * 150.0, vy: a.sin() * 150.0, pv: 1, ..Default::default()
            },
            Kind::Splitter => Enemy {
                kind, r: 14.0, spd: 78.0 + t * 0.7, pv: 3, hp: 2, ..Default::default()
            },
            Kind::Sniper => Enemy {
                // hangs back at range; the cooldown is staggered so a pair
                // of them never fires in lockstep
                kind, r: 10.0, spd: 96.0 + t * 0.5, pv: 4,
                cool: 1.2 + self.rng.f() * 1.4, ..Default::default()
            },
            Kind::Bulwark => Enemy {
                kind, r: 13.0, spd: 74.0 + t * 0.6, pv: 4, hp: 3, ..Default::default()
            },
            Kind::Pulsar => Enemy {
                kind, r: 12.0, spd: 0.0, pv: 5, cool: 2.6, hp: 4, ..Default::default()
            },
            _ => Enemy {
                kind: Kind::Chaser, r: 12.0, spd: 110.0 + t * 1.4, pv: 2, ..Default::default()
            },
        };
        self.enemies.push(Enemy { x, y, fade: 1.0, ..e });
    }

    fn spawn_hole(&mut self) {
        let (w, h) = (self.g.w, self.g.h);
        let (mut x, mut y) = (0.0, 0.0);
        for _ in 0..20 {
            x = 80.0 + self.rng.f() * (w - 160.0);
            y = 80.0 + self.rng.f() * (h - 160.0);
            if (x - self.ships[0].x).hypot(y - self.ships[0].y) >= 300.0 {
                break;
            }
        }
        let a = self.rng.angle();
        self.holes.push(Hole {
            x,
            y,
            r: 13.0,
            hp: 10,
            eaten: 0,
            flash: 0.0,
            spray_a: a,
        });
        bridge::sample("hole", 0.16);
    }

    fn explode_hole(&mut self, i: usize, with_bits: bool) {
        if i >= self.holes.len() {
            return;
        }
        let h = self.holes.remove(i);
        self.hole_t = 18.0 + self.rng.f() * 8.0;
        self.shocks.push(Shock {
            x: h.x,
            y: h.y,
            rad: 8.0,
            speed: 660.0,
            max_rad: 700.0,
        });
        self.grid_explosive(140.0, h.x, h.y, 420.0);
        self.flash(h.x, h.y, 300.0, 1.3);
        self.ring_burst(h.x, h.y);
        self.shake = 18.0;
        bridge::sample("blast", 0.26);
        bridge::hat(0.12, 0.2);
        if with_bits {
            let n = h.eaten.min(14).max(0) as usize;
            for k in 0..n {
                let a = (k as f64 / n as f64) * TAU;
                let spd = 230.0 + self.rng.f() * 90.0;
                self.enemies.push(Enemy {
                    x: h.x + a.cos() * (h.r + 8.0),
                    y: h.y + a.sin() * (h.r + 8.0),
                    kind: Kind::Bit,
                    r: 5.0,
                    spd,
                    pv: 1,
                    ..Default::default()
                });
            }
        }
    }

    // ---- simulation -----------------------------------------------------
    fn update(&mut self, dt: f64) {
        self.sync_reticle(dt);
        self.time += dt;
        let (w, h) = (self.g.w, self.g.h);

        if self.mult > 1 {
            self.mult_t -= dt;
            if self.mult_t <= 0.0 {
                self.mult = 1;
            }
        }

        // local stick for ship 0; ship 1 is driven by the netplay input
        let mut ax = 0.0;
        let mut ay = 0.0;
        if self.keys_left {
            ax -= 1.0;
        }
        if self.keys_right {
            ax += 1.0;
        }
        if self.keys_up {
            ay -= 1.0;
        }
        if self.keys_down {
            ay += 1.0;
        }
        let thrusting = ax != 0.0 || ay != 0.0;

        let guest = self.net.last_input;
        let n_ships = self.ships.len();
        for i in 0..n_ships {
            let (sax, say, firing) = if i == 0 {
                (ax, ay, self.ships[0].firing)
            } else {
                (guest.x as f64, guest.y as f64, guest.primary())
            };
            if i == 1 {
                self.ships[1].firing = firing;
                // without this the guest's ship keeps its spawn heading, so it
                // drifts toward one fixed point and fires the same way forever
                if guest.aim_x != 0.0 || guest.aim_y != 0.0 {
                    self.ships[1].aim_x = guest.aim_x as f64;
                    self.ships[1].aim_y = guest.aim_y as f64;
                }
            }
            let m = sax.hypot(say).max(1.0);
            let k = (dt * 14.0).min(1.0);
            {
                let s = &mut self.ships[i];
                s.mov_x += ((sax / m) - s.mov_x) * k;
                s.mov_y += ((say / m) - s.mov_y) * k;
                s.vx += s.mov_x * 3100.0 * dt;
                s.vy += s.mov_y * 3100.0 * dt;
                let drag = (1.0 - dt * 1.8).max(0.0);
                s.vx *= drag;
                s.vy *= drag;
                let sp = s.vx.hypot(s.vy);
                if sp > 560.0 {
                    s.vx *= 560.0 / sp;
                    s.vy *= 560.0 / sp;
                }
                s.x += s.vx * dt;
                s.y += s.vy * dt;
                if s.x < 14.0 {
                    s.x = 14.0;
                    s.vx = s.vx.abs() * 0.55;
                }
                if s.x > w - 14.0 {
                    s.x = w - 14.0;
                    s.vx = -s.vx.abs() * 0.55;
                }
                if s.y < 14.0 {
                    s.y = 14.0;
                    s.vy = s.vy.abs() * 0.55;
                }
                if s.y > h - 14.0 {
                    s.y = h - 14.0;
                    s.vy = -s.vy.abs() * 0.55;
                }
                s.fire_t -= dt;
                // hold the heading when the reticle is basically on top of us
                let ad2 = (s.aim_x - s.x).hypot(s.aim_y - s.y);
                if ad2 > AIM_DEADZONE {
                    s.aim_a = (s.aim_y - s.y).atan2(s.aim_x - s.x);
                }
            }

            // twin cannons
            let fire = self.ships[i].firing && self.ships[i].fire_t <= 0.0;
            if fire {
                let spread = self.rng.signed() * 0.08 + self.rng.signed() * 0.08;
                let s = self.ships[i];
                let aim_a = s.aim_a + spread;
                let (ca, sa) = (aim_a.cos(), aim_a.sin());
                for side in [-5.0, 5.0] {
                    self.bullets.push(Bullet {
                        x: s.x + ca * 16.0 - sa * side,
                        y: s.y + sa * 16.0 + ca * side,
                        vx: ca * 950.0,
                        vy: sa * 950.0,
                    });
                }
                self.ships[i].fire_t = 0.1;
                bridge::sample("shoot", 0.045);
            }
        }

        // exhaust
        if thrusting {
            let s = self.ships[0];
            let ssp = s.vx.hypot(s.vy).max(1.0);
            let (ux, uy) = (s.vx / ssp, s.vy / ssp);
            let (px, py) = (s.x - ux * 14.0, s.y - uy * 14.0);
            let (bvx, bvy) = (-ux * 180.0, -uy * 180.0);
            let wob = (self.t * 10.0).sin() * 0.6;
            let (pvx, pvy) = (bvy * wob, -bvx * wob);
            let jitter = (self.rng.signed() * 60.0, self.rng.signed() * 60.0);
            let streams = [
                (bvx + jitter.0, bvy + jitter.1, "#ffbb1e"),
                (bvx + pvx, bvy + pvy, "#c82609"),
                (bvx - pvx, bvy - pvy, "#c82609"),
            ];
            for (vx, vy, color) in streams {
                let len = 5.0 + self.rng.f() * 6.0;
                self.parts.push(Particle {
                    x: px,
                    y: py,
                    vx,
                    vy,
                    life: 0.55,
                    decay: 1.7,
                    color: color.into(),
                    len,
                    grav: true,
                });
            }
        }

        // spawn pressure
        self.spawn_t -= dt;
        if self.spawn_t <= 0.0 {
            self.spawn_enemy();
            self.spawn_t = (1.05 - self.time * 0.012).max(0.22);
        }

        self.update_bullets(dt, w, h);
        self.update_enemies(dt, w, h);
        self.update_ebullets(dt, w, h);
        self.separate_enemies(dt);
        self.update_holes(dt);
        self.update_shocks(dt);
        self.collide(dt);
    }

    fn update_bullets(&mut self, dt: f64, w: f64, h: f64) {
        let mut wall_hits: Vec<(f64, f64)> = Vec::new();
        let mut nudges: Vec<(f64, f64)> = Vec::new();
        let mut i = self.bullets.len();
        while i > 0 {
            i -= 1;
            let b = &mut self.bullets[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            let (bx, by) = (b.x, b.y);
            nudges.push((bx, by));
            if bx < 3.0 || bx > w - 3.0 || by < 3.0 || by > h - 3.0 {
                wall_hits.push((bx, by));
                self.bullets.remove(i);
            }
        }
        for (x, y) in nudges {
            self.grid_explosive(3.5, x, y, 70.0);
        }
        for (x, y) in wall_hits {
            for _ in 0..self.scaled(12) {
                let a = self.rng.angle();
                let sp = self.rng.f() * 540.0;
                let len = 3.0 + self.rng.f() * 6.0;
                self.parts.push(Particle {
                    x,
                    y,
                    vx: a.cos() * sp,
                    vy: a.sin() * sp,
                    life: 0.6,
                    decay: 1.4,
                    color: "#9fd4f0".into(),
                    len,
                    grav: false,
                });
            }
        }
    }

    fn update_enemies(&mut self, dt: f64, w: f64, h: f64) {
        let (tx, ty) = (self.ships[0].x, self.ships[0].y);
        let mut shots: Vec<(f64, f64, f64)> = Vec::new();
        let mut blasts: Vec<(f64, f64)> = Vec::new();
        for en in &mut self.enemies {
            if en.fade > 0.0 {
                en.fade -= dt;
                continue;
            }
            let (dx, dy) = (tx - en.x, ty - en.y);
            let d = dx.hypot(dy).max(1.0);
            match en.kind {
                Kind::Drifter => {
                    en.x += en.vx * dt;
                    en.y += en.vy * dt;
                    if en.x < en.r || en.x > w - en.r {
                        en.vx *= -1.0;
                        en.x = en.x.clamp(en.r, w - en.r);
                    }
                    if en.y < en.r || en.y > h - en.r {
                        en.vy *= -1.0;
                        en.y = en.y.clamp(en.r, h - en.r);
                    }
                    en.face = en.vy.atan2(en.vx);
                }
                Kind::Sniper => {
                    // holds a firing line: closes if you run, backs off if you
                    // charge it, and shoots whenever the cooldown lapses
                    let want = 300.0;
                    let dir = if d > want + 40.0 {
                        1.0
                    } else if d < want - 40.0 {
                        -1.0
                    } else {
                        0.0
                    };
                    en.x += (dx / d) * en.spd * dir * dt;
                    en.y += (dy / d) * en.spd * dir * dt;
                    // and sidesteps so it is never a stationary target
                    en.x += (-dy / d) * en.spd * 0.45 * dt;
                    en.y += (dx / d) * en.spd * 0.45 * dt;
                    en.face = dy.atan2(dx);
                    en.cool -= dt;
                    if en.cool <= 0.0 {
                        en.cool = 2.4;
                        shots.push((en.x, en.y, en.face));
                    }
                }
                Kind::Pulsar => {
                    // rooted. winds up, then lets go of a wave.
                    en.cool -= dt;
                    if en.cool <= 0.0 {
                        en.cool = 3.4;
                        blasts.push((en.x, en.y));
                    }
                }
                Kind::Bulwark => {
                    // advances shield-first, so the front is the wrong side
                    en.x += (dx / d) * en.spd * dt;
                    en.y += (dy / d) * en.spd * dt;
                    en.face = dy.atan2(dx);
                }
                _ => {
                    let mut vx = (dx / d) * en.spd;
                    let mut vy = (dy / d) * en.spd;
                    if en.kind == Kind::Weaver {
                        en.wob += dt * 7.0;
                        let wv = en.wob.sin() * en.spd * 0.7;
                        vx += (-dy / d) * wv;
                        vy += (dx / d) * wv;
                    }
                    en.x += vx * dt;
                    en.y += vy * dt;
                    en.face = vy.atan2(vx);
                }
            }
        }
        for (x, y, a) in shots {
            let sp = 240.0;
            self.ebullets.push(EBullet {
                x: x + a.cos() * 12.0,
                y: y + a.sin() * 12.0,
                vx: a.cos() * sp,
                vy: a.sin() * sp,
                life: 4.0,
            });
            bridge::sample("sniper", 0.1);
        }
        for (x, y) in blasts {
            self.shocks.push(Shock {
                x,
                y,
                rad: 10.0,
                speed: 420.0,
                max_rad: 240.0,
            });
            self.grid_explosive(70.0, x, y, 240.0);
            self.flash(x, y, 150.0, 2.0);
            self.burst(x, y, Kind::Pulsar.color(), 14, 0.9);
            bridge::sample("pulse", 0.16);
            // the wave itself is what hurts, and only near the ring
            let s = self.ships[0];
            let d = (s.x - x).hypot(s.y - y);
            if self.inv <= 0.0 && d < 120.0 {
                self.ship_hit();
                return;
            }
        }
    }

    /// Sniper fire in flight.
    fn update_ebullets(&mut self, dt: f64, w: f64, h: f64) {
        let (sx, sy) = (self.ships[0].x, self.ships[0].y);
        let mut hit = false;
        let mut i = self.ebullets.len();
        while i > 0 {
            i -= 1;
            let b = &mut self.ebullets[i];
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.life -= dt;
            let (bx, by, dead) = (b.x, b.y, b.life <= 0.0);
            if dead || bx < 0.0 || bx > w || by < 0.0 || by > h {
                self.ebullets.remove(i);
                continue;
            }
            if self.inv <= 0.0 && (bx - sx).hypot(by - sy) < 12.0 {
                self.ebullets.remove(i);
                hit = true;
                break;
            }
        }
        if hit {
            self.ship_hit();
        }
    }

    fn separate_enemies(&mut self, dt: f64) {
        let n = self.enemies.len();
        for i in 0..n {
            if self.enemies[i].fade > 0.0 {
                continue;
            }
            for j in (i + 1)..n {
                if self.enemies[j].fade > 0.0 {
                    continue;
                }
                let (ax, ay, ar) = (self.enemies[i].x, self.enemies[i].y, self.enemies[i].r);
                let (bx, by, br) = (self.enemies[j].x, self.enemies[j].y, self.enemies[j].r);
                let (dx, dy) = (ax - bx, ay - by);
                let d2 = dx * dx + dy * dy;
                let rr = ar + br;
                if d2 < rr * rr && d2 > 0.01 {
                    let f = 600.0 * dt / (d2 + 1.0);
                    self.enemies[i].x += dx * f;
                    self.enemies[i].y += dy * f;
                    self.enemies[j].x -= dx * f;
                    self.enemies[j].y -= dy * f;
                }
            }
        }
    }

    fn update_holes(&mut self, dt: f64) {
        if self.holes.is_empty() {
            self.hole_t -= dt;
            if self.hole_t <= 0.0 {
                self.spawn_hole();
            }
        }
        let mut i = self.holes.len();
        while i > 0 {
            i -= 1;
            if i >= self.holes.len() {
                continue;
            }
            let (hx, hy, hr);
            {
                let h = &mut self.holes[i];
                h.flash = (h.flash - dt).max(0.0);
                h.spray_a -= (TAU / 50.0) * 60.0 * dt;
                hx = h.x;
                hy = h.y;
                hr = h.r;
            }
            let breath = (self.holes[i].spray_a / 2.0).sin() * 5.0 + 9.0;
            self.grid_implosive(breath, hx, hy, 180.0);

            const PR: f64 = 250.0;
            // ship pull
            if self.inv <= 0.0 {
                let s = self.ships[0];
                let (dx, dy) = (hx - s.x, hy - s.y);
                let d = dx.hypot(dy).max(1.0);
                if d < PR {
                    let k = 1.0 - d / PR;
                    self.ships[0].vx += (dx / d) * 2000.0 * k * dt;
                    self.ships[0].vy += (dy / d) * 2000.0 * k * dt;
                }
                if d < hr + 10.0 {
                    self.ship_hit();
                    return;
                }
            }
            // bullets are pushed away, and chip the well
            let mut j = self.bullets.len();
            let mut popped = false;
            while j > 0 {
                j -= 1;
                if j >= self.bullets.len() {
                    continue;
                }
                let (bx, by) = (self.bullets[j].x, self.bullets[j].y);
                let (dx, dy) = (hx - bx, hy - by);
                let d = dx.hypot(dy).max(1.0);
                if d < PR {
                    self.bullets[j].vx -= (dx / d) * 1000.0 * dt;
                    self.bullets[j].vy -= (dy / d) * 1000.0 * dt;
                }
                if d < hr + 4.0 {
                    self.bullets.remove(j);
                    self.holes[i].hp -= 1;
                    self.holes[i].flash = 0.12;
                    self.burst(bx, by, MAGENTA, 3, 0.5);
                    if self.holes[i].hp <= 0 {
                        self.add_points(50);
                        self.bump_mult();
                        self.explode_hole(i, true);
                        popped = true;
                        break;
                    }
                }
            }
            if popped || i >= self.holes.len() {
                continue;
            }
            // enemies get dragged in
            let mut j = self.enemies.len();
            while j > 0 {
                j -= 1;
                if self.enemies[j].fade > 0.0 {
                    continue;
                }
                let (ex, ey, er) = (self.enemies[j].x, self.enemies[j].y, self.enemies[j].r);
                let (dx, dy) = (hx - ex, hy - ey);
                let d = dx.hypot(dy).max(1.0);
                if d < PR {
                    let k = 1.0 - d / PR;
                    let pull = 420.0 * k * dt;
                    self.enemies[j].x += (dx / d) * pull;
                    self.enemies[j].y += (dy / d) * pull;
                    if self.enemies[j].kind == Kind::Drifter {
                        self.enemies[j].vx += (dx / d) * 900.0 * k * dt;
                        self.enemies[j].vy += (dy / d) * 900.0 * k * dt;
                    }
                }
                if d < hr + er {
                    let kind = self.enemies[j].kind;
                    self.enemies.remove(j);
                    self.holes[i].eaten += 1;
                    self.holes[i].r = (self.holes[i].r + 0.5).min(26.0);
                    self.burst(ex, ey, kind.color(), 5, 0.6);
                    bridge::bleep(130.0, 0.05, "sine", 0.025);
                }
            }
            // orbiting jet
            if ((self.t * 4.0).floor() as i64) % 2 == 0 && self.spray.len() < 220 {
                let sp = 720.0 + self.rng.f() * 180.0;
                let a = self.holes[i].spray_a;
                let (vx, vy) = (a.cos() * sp, a.sin() * sp);
                let (jx, jy) = (self.rng.signed() * 10.0, self.rng.signed() * 10.0);
                self.spray.push(Spray {
                    x: hx + vy * 0.033 + jx,
                    y: hy - vx * 0.033 + jy,
                    vx,
                    vy,
                    life: 3.2,
                });
            }
            if i < self.holes.len() && self.holes[i].eaten >= 15 {
                self.explode_hole(i, true);
            }
        }
    }

    fn update_shocks(&mut self, dt: f64) {
        let mut i = self.shocks.len();
        while i > 0 {
            i -= 1;
            let s = self.shocks[i];
            self.shocks[i].rad += s.speed * dt;
            let s = self.shocks[i];
            let tug = |x: f64, y: f64| {
                let (dx, dy) = (s.x - x, s.y - y);
                let d = dx.hypot(dy).max(1.0);
                let band = (-((d - s.rad).powi(2)) / (2.0 * 48.0 * 48.0)).exp();
                ((dx / d) * band, (dy / d) * band)
            };
            let (sx, sy) = tug(self.ships[0].x, self.ships[0].y);
            self.ships[0].vx += sx * 1500.0 * dt;
            self.ships[0].vy += sy * 1500.0 * dt;
            for en in &mut self.enemies {
                let (ex, ey) = tug(en.x, en.y);
                en.x += ex * 320.0 * dt;
                en.y += ey * 320.0 * dt;
            }
            for b in &mut self.bullets {
                let (tx, ty) = tug(b.x, b.y);
                b.vx += tx * 2200.0 * dt;
                b.vy += ty * 2200.0 * dt;
            }
            if self.shocks[i].rad > self.shocks[i].max_rad {
                self.shocks.remove(i);
            }
        }
    }

    fn collide(&mut self, dt: f64) {
        // bullets vs enemies
        let mut i = self.enemies.len();
        while i > 0 {
            i -= 1;
            if i >= self.enemies.len() {
                continue;
            }
            let (ex, ey, er, pv, kind, face) = {
                let e = &self.enemies[i];
                (e.x, e.y, e.r, e.pv, e.kind, e.face)
            };
            let mut j = self.bullets.len();
            while j > 0 {
                j -= 1;
                let b = self.bullets[j];
                if (b.x - ex).hypot(b.y - ey) >= er + 4.0 {
                    continue;
                }
                // a bulwark eats anything that comes at its shielded side, so
                // you have to get around it instead of holding the trigger
                if kind == Kind::Bulwark {
                    let incoming = (ey - b.y).atan2(ex - b.x);
                    let mut off = (incoming - face).abs() % TAU;
                    if off > PI {
                        off = TAU - off;
                    }
                    if off > PI - 1.1 {
                        self.bullets.remove(j);
                        self.burst(b.x, b.y, Kind::Bulwark.color(), 4, 0.5);
                        bridge::bleep(320.0, 0.04, "square", 0.03);
                        continue;
                    }
                }
                self.bullets.remove(j);
                if self.enemies[i].hp > 1 {
                    self.enemies[i].hp -= 1;
                    // visible chip so it is obvious the thing is taking damage
                    self.burst(b.x, b.y, kind.color(), 4, 0.6);
                    self.flash(b.x, b.y, 26.0, 5.0);
                    bridge::sample("kill", 0.05);
                    continue;
                }
                self.enemies.remove(i);
                self.kills += 1;
                self.add_points((pv.max(1) as u32) * 10);
                self.bump_mult();
                self.enemy_burst(ex, ey);
                self.flash(ex, ey, 54.0, 3.4);
                self.grid_explosive(15.0, ex, ey, 110.0);
                self.shake = self.shake.max(5.0);
                bridge::sample("kill", 0.1);
                if self.kills % 4 == 0 {
                    bridge::hat(0.04, 0.05);
                }
                // killing a splitter does not clear the space, it doubles it
                if kind == Kind::Splitter {
                    for k in 0..2 {
                        let a = self.rng.angle() + k as f64 * PI;
                        self.enemies.push(Enemy {
                            x: ex + a.cos() * 14.0,
                            y: ey + a.sin() * 14.0,
                            kind: Kind::Shard,
                            r: 7.0,
                            spd: 190.0 + self.time * 0.8,
                            pv: 1,
                            fade: 0.35,
                            ..Default::default()
                        });
                    }
                }
                break;
            }
        }

        // enemies vs ship
        if self.inv > 0.0 {
            self.inv -= dt;
        } else {
            let (sx, sy) = (self.ships[0].x, self.ships[0].y);
            let hit = self
                .enemies
                .iter()
                .any(|e| e.fade <= 0.0 && (e.x - sx).hypot(e.y - sy) < e.r + 10.0);
            if hit {
                self.ship_hit();
            }
        }
    }

    fn fx(&mut self, dt: f64) {
        self.t += dt;
        let holes: Vec<(f64, f64)> = self.holes.iter().map(|h| (h.x, h.y)).collect();

        // vortex spray
        let mut i = self.spray.len();
        while i > 0 {
            i -= 1;
            let p = &mut self.spray[i];
            for (hx, hy) in &holes {
                let (dx, dy) = (hx - p.x, hy - p.y);
                let d = dx.hypot(dy).max(1.0);
                let (nx, ny) = (dx / d, dy / d);
                let g = 36_000_000.0 / (d * d + 10_000.0);
                p.vx += nx * g * dt;
                p.vy += ny * g * dt;
                if d < 400.0 {
                    let tg = 162_000.0 / (d + 100.0);
                    p.vx += ny * tg * dt;
                    p.vy += -nx * tg * dt;
                }
            }
            let damp = 0.94f64.powf(dt * 60.0);
            p.vx *= damp;
            p.vy *= damp;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= dt;
            if p.life <= 0.0 {
                self.spray.remove(i);
            }
        }

        let mut i = self.parts.len();
        while i > 0 {
            i -= 1;
            let p = &mut self.parts[i];
            if p.grav {
                for (hx, hy) in &holes {
                    let (dx, dy) = (hx - p.x, hy - p.y);
                    let d = dx.hypot(dy).max(1.0);
                    let g = 36_000_000.0 / (d * d + 10_000.0);
                    p.vx += (dx / d) * g * dt;
                    p.vy += (dy / d) * g * dt;
                    if d < 400.0 {
                        let tg = 162_000.0 / (d + 100.0);
                        p.vx += (dy / d) * tg * dt;
                        p.vy += (-dx / d) * tg * dt;
                    }
                }
            }
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.vx *= 1.0 - dt * 2.5;
            p.vy *= 1.0 - dt * 2.5;
            p.life -= p.decay * dt;
            if p.life <= 0.0 {
                self.parts.remove(i);
            }
        }

        self.flashes.retain_mut(|f| {
            f.life -= f.decay * dt;
            f.life > 0.0
        });
        self.shake = (self.shake - dt * 30.0).max(0.0);

        let (w, h) = (self.g.w, self.g.h);
        for p in &mut self.dust {
            let (mut vx, mut vy) = (p.vx, p.vy);
            for (hx, hy) in &holes {
                let (dx, dy) = (hx - p.x, hy - p.y);
                let d = dx.hypot(dy).max(1.0);
                if d < 300.0 {
                    let k = (1.0 - d / 300.0) * 60.0;
                    vx += (dx / d) * k;
                    vy += (dy / d) * k;
                }
            }
            p.x += vx * dt;
            p.y += vy * dt;
            if p.x < 0.0 {
                p.x += w;
            }
            if p.x > w {
                p.x -= w;
            }
            if p.y < 0.0 {
                p.y += h;
            }
            if p.y > h {
                p.y -= h;
            }
        }
        for b in &mut self.blobs {
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            if b.x < -b.r {
                b.x += w + b.r * 2.0;
            }
            if b.x > w + b.r {
                b.x -= w + b.r * 2.0;
            }
            if b.y < -b.r {
                b.y += h + b.r * 2.0;
            }
            if b.y > h + b.r {
                b.y -= h + b.r * 2.0;
            }
        }

        if (self.grid_w - w).abs() > 0.5 || (self.grid_h - h).abs() > 0.5 {
            self.build_grid();
        }
        self.grid_update();
    }

    // ---- frame ----------------------------------------------------------
    pub fn frame(&mut self, dt: f64) {
        self.g.resize();

        if self.net.is_guest() {
            self.sync_reticle(dt);
            let s = *self.ships.get(1).unwrap_or(&self.ships[0]);
            let mut ax = 0.0;
            let mut ay = 0.0;
            if self.keys_left {
                ax -= 1.0;
            }
            if self.keys_right {
                ax += 1.0;
            }
            if self.keys_up {
                ay -= 1.0;
            }
            if self.keys_down {
                ay += 1.0;
            }
            self.net.send_input(&Input {
                x: ax as f32,
                y: ay as f32,
                aim_x: self.local_aim.0 as f32,
                aim_y: self.local_aim.1 as f32,
                buttons: s.firing as u8,
            });
            if let Some(snap) = self.net.take_snapshot::<Snapshot>() {
                self.apply_snapshot(snap);
            }
            self.fx(dt);
            self.draw();
            return;
        }

        if !self.paused {
            if self.running {
                self.update(dt);
            }
            self.fx(dt);
        }
        if self.net.is_host() {
            let snap = self.snapshot();
            self.net.send_snapshot(&snap);
        }
        self.draw();
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            ships: self
                .ships
                .iter()
                .map(|s| {
                    (
                        s.x as f32,
                        s.y as f32,
                        s.aim_x as f32,
                        s.aim_y as f32,
                        s.alive,
                    )
                })
                .collect(),
            bullets: self
                .bullets
                .iter()
                .map(|b| (b.x as f32, b.y as f32, b.vx as f32, b.vy as f32))
                .collect(),
            enemies: self
                .enemies
                .iter()
                .map(|e| {
                    (
                        e.x as f32, e.y as f32, e.kind, e.r as f32,
                        e.fade as f32, e.cool as f32, e.face as f32,
                    )
                })
                .collect(),
            ebullets: self
                .ebullets
                .iter()
                .map(|b| (b.x as f32, b.y as f32, b.vx as f32, b.vy as f32))
                .collect(),
            holes: self
                .holes
                .iter()
                .map(|h| (h.x as f32, h.y as f32, h.r as f32, h.flash as f32))
                .collect(),
            shocks: self
                .shocks
                .iter()
                .map(|s| (s.x as f32, s.y as f32, s.rad as f32, s.max_rad as f32))
                .collect(),
            score: self.score,
            mult: self.mult.min(255) as u8,
            lives: self.lives.clamp(-128, 127) as i8,
            kills: self.kills,
            time: self.time as f32,
            running: self.running,
        }
    }

    fn apply_snapshot(&mut self, s: Snapshot) {
        self.running = s.running;
        self.score = s.score;
        self.mult = s.mult as u32;
        self.lives = s.lives as i32;
        self.kills = s.kills;
        self.time = s.time as f64;
        while self.ships.len() < s.ships.len() {
            self.ships.push(Ship::default());
        }
        let local = self.local_aim;
        for (i, (x, y, ax, ay, alive)) in s.ships.iter().enumerate() {
            let sh = &mut self.ships[i];
            // ease toward the authoritative position so packet loss does not jolt
            sh.x += (*x as f64 - sh.x) * 0.4;
            sh.y += (*y as f64 - sh.y) * 0.4;
            if i == 1 {
                // our own hull: point it at our reticle right now rather than
                // waiting a round trip, or turning feels like it is on a rope
                sh.aim_x = local.0;
                sh.aim_y = local.1;
                let _ = &local;
            } else {
                sh.aim_x = *ax as f64;
                sh.aim_y = *ay as f64;
            }
            // the guest never runs update(), so nothing else refreshes the
            // drawn heading — every ship would keep the angle it spawned with
            let d = (sh.aim_x - sh.x).hypot(sh.aim_y - sh.y);
            if d > AIM_DEADZONE {
                sh.aim_a = (sh.aim_y - sh.y).atan2(sh.aim_x - sh.x);
            }
            sh.alive = *alive;
        }
        self.bullets = s
            .bullets
            .iter()
            .map(|(x, y, vx, vy)| Bullet {
                x: *x as f64,
                y: *y as f64,
                vx: *vx as f64,
                vy: *vy as f64,
            })
            .collect();
        self.enemies = s
            .enemies
            .iter()
            .map(|(x, y, kind, r, fade, cool, face)| Enemy {
                x: *x as f64,
                y: *y as f64,
                kind: *kind,
                r: *r as f64,
                fade: *fade as f64,
                cool: *cool as f64,
                face: *face as f64,
                pv: 1,
                ..Default::default()
            })
            .collect();
        self.ebullets = s
            .ebullets
            .iter()
            .map(|(x, y, vx, vy)| EBullet {
                x: *x as f64,
                y: *y as f64,
                vx: *vx as f64,
                vy: *vy as f64,
                life: 1.0,
            })
            .collect();
        self.holes = s
            .holes
            .iter()
            .map(|(x, y, r, flash)| Hole {
                x: *x as f64,
                y: *y as f64,
                r: *r as f64,
                hp: 10,
                eaten: 0,
                flash: *flash as f64,
                spray_a: self.t * -7.5,
            })
            .collect();
        self.shocks = s
            .shocks
            .iter()
            .map(|(x, y, rad, max_rad)| Shock {
                x: *x as f64,
                y: *y as f64,
                rad: *rad as f64,
                speed: 660.0,
                max_rad: *max_rad as f64,
            })
            .collect();
    }

    // ---- draw -----------------------------------------------------------
    fn draw(&mut self) {
        let (w, h) = (self.g.w, self.g.h);
        {
            let g = &self.g;
            g.composite("source-over");
            g.alpha(1.0);
            g.no_shadow();
            g.fill_color("#12140d"); // ARCADE_FX.screen substrate
            g.fill_rect(0.0, 0.0, w, h);
        }

        // nebula washes
        for b in &self.blobs {
            let inner = format!("rgba({}, 0.05)", b.tint);
            let outer = format!("rgba({}, 0)", b.tint);
            if let Some(grad) = self
                .g
                .radial(b.x, b.y, b.r, &[(0.0, &inner), (1.0, &outer)])
            {
                self.g.alpha(1.0);
                self.g.fill_gradient(&grad);
                self.g
                    .fill_rect(b.x - b.r, b.y - b.r, b.r * 2.0, b.r * 2.0);
            }
        }
        self.g.fill_color(WHITE);
        for p in &self.dust {
            self.g
                .alpha(0.07 + 0.11 * (0.5 + 0.5 * (self.t * p.f + p.ph).sin()));
            self.g.fill_rect(p.x, p.y, p.s, p.s);
        }

        self.g.save();
        if self.shake > 0.0 && !self.reduced {
            let (sx, sy) = (
                self.rng.signed() * self.shake * self.g.shake_scale,
                self.rng.signed() * self.shake * self.g.shake_scale,
            );
            self.g.translate(sx, sy);
        }

        self.draw_grid();
        self.draw_holes();
        self.draw_spray();
        self.draw_shocks();
        self.draw_bullets();
        self.draw_ebullets();
        for i in 0..self.enemies.len() {
            self.draw_enemy(i);
        }
        self.draw_flashes();
        self.draw_reticle();
        self.draw_ships();
        self.draw_parts();
        self.draw_hud();
        self.g.restore();
    }

    fn draw_grid(&self) {
        let g = &self.g;
        let (cols, rows) = (self.grid_cols, self.grid_rows);
        if self.grid_pts.is_empty() {
            return;
        }
        let at = |c: usize, r: usize| &self.grid_pts[r * (cols + 1) + c];
        g.stroke_color(WHITE);
        g.line_width(1.0);
        g.alpha(0.09);
        g.begin();
        for r in 0..=rows {
            for c in 0..=cols {
                let p = at(c, r);
                if c > 0 {
                    let q = at(c - 1, r);
                    g.move_to(q.x, q.y);
                    g.line_to(p.x, p.y);
                }
                if r > 0 {
                    let q = at(c, r - 1);
                    g.move_to(q.x, q.y);
                    g.line_to(p.x, p.y);
                }
            }
        }
        g.stroke();
        g.alpha(0.045);
        g.begin();
        for r in 1..=rows {
            for c in 1..=cols {
                let p = at(c, r);
                let left = at(c - 1, r);
                let up = at(c, r - 1);
                let ul = at(c - 1, r - 1);
                g.move_to((ul.x + up.x) / 2.0, (ul.y + up.y) / 2.0);
                g.line_to((left.x + p.x) / 2.0, (left.y + p.y) / 2.0);
                g.move_to((ul.x + left.x) / 2.0, (ul.y + left.y) / 2.0);
                g.line_to((up.x + p.x) / 2.0, (up.y + p.y) / 2.0);
            }
        }
        g.stroke();
    }

    fn draw_holes(&self) {
        let g = &self.g;
        for h in &self.holes {
            let rr = h.r * (1.0 + 0.1 * (self.t * 10.0).sin()) + if h.flash > 0.0 { 3.0 } else { 0.0 };
            g.alpha(1.0);
            g.fill_color("#000000");
            g.circle(h.x, h.y, rr);
            g.fill();
            g.stroke_color(MAGENTA);
            g.shadow(MAGENTA, 16.0);
            g.line_width(2.5);
            g.alpha(0.95);
            g.circle(h.x, h.y, rr + 2.0);
            g.stroke();
            g.no_shadow();
        }
    }

    fn draw_spray(&self) {
        let g = &self.g;
        g.line_width(1.6);
        g.line_cap("round");
        g.stroke_color("#c37ae6");
        g.shadow("#c37ae6", 6.0);
        for p in &self.spray {
            let s = p.vx.hypot(p.vy).max(1.0);
            g.alpha(p.life.min(1.0) * (s / 260.0).min(1.0) * 0.8);
            g.begin();
            g.move_to(p.x, p.y);
            let l = (4.0 + s * 0.018).min(16.0);
            g.line_to(p.x + (p.vx / s) * l, p.y + (p.vy / s) * l);
            g.stroke();
        }
        g.no_shadow();
        g.line_cap("butt");
    }

    fn draw_shocks(&self) {
        let g = &self.g;
        for s in &self.shocks {
            let fade = 1.0 - s.rad / s.max_rad;
            g.stroke_color(WHITE);
            g.shadow(MAGENTA, 12.0);
            for k in 0..2 {
                g.alpha(fade * if k == 1 { 0.2 } else { 0.45 });
                g.line_width(if k == 1 { 1.2 } else { 2.2 });
                g.circle(s.x, s.y, (s.rad - k as f64 * 22.0).max(1.0));
                g.stroke();
            }
            g.no_shadow();
        }
    }

    fn draw_bullets(&self) {
        let g = &self.g;
        g.stroke_color(LIME);
        g.shadow(LIME, 8.0);
        g.line_width(2.0);
        g.alpha(0.9);
        g.begin();
        for b in &self.bullets {
            g.move_to(b.x, b.y);
            g.line_to(b.x - b.vx * 0.013, b.y - b.vy * 0.013);
        }
        g.stroke();
        g.no_shadow();
    }

    /// The detonation cores, added on top of the scene rather than over it.
    fn draw_flashes(&self) {
        if self.flashes.is_empty() || !self.g.glow_ready() {
            return;
        }
        let g = &self.g;
        g.composite("lighter");
        for f in &self.flashes {
            let a = f.life.clamp(0.0, 1.0);
            // swells as it fades, the way a real flash blooms out
            let r = f.r * (1.6 - a * 0.6);
            g.alpha(a * a * 0.85);
            g.draw_glow(f.x, f.y, r);
        }
        g.alpha(1.0);
        g.composite("source-over");
    }

    /// Sniper fire: hot, small, and unmistakably not yours.
    fn draw_ebullets(&self) {
        if self.ebullets.is_empty() {
            return;
        }
        let g = &self.g;
        let c = Kind::Sniper.color();
        g.stroke_color(c);
        g.shadow(c, 10.0);
        g.line_width(2.4);
        g.alpha(0.95);
        g.begin();
        for b in &self.ebullets {
            g.move_to(b.x, b.y);
            g.line_to(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
        }
        g.stroke();
        g.no_shadow();
    }

    fn draw_enemy_shape(&self, i: usize, r: f64, alpha: f64) {
        let en = &self.enemies[i];
        let g = &self.g;
        let c = en.kind.color();
        g.stroke_color(c);
        g.shadow(c, 10.0);
        g.line_width(2.0);
        g.alpha(alpha);
        g.begin();
        match en.kind {
            Kind::Bit => {
                g.arc(en.x, en.y, r, 0.0, TAU);
            }
            Kind::Chaser => {
                g.move_to(en.x, en.y - r);
                g.line_to(en.x + r, en.y);
                g.line_to(en.x, en.y + r);
                g.line_to(en.x - r, en.y);
            }
            Kind::Drifter => {
                g.move_to(en.x - r, en.y - r);
                g.line_to(en.x + r, en.y - r);
                g.line_to(en.x + r, en.y + r);
                g.line_to(en.x - r, en.y + r);
            }
            Kind::Weaver | Kind::Shard => {
                g.move_to(en.x, en.y - r);
                g.line_to(en.x + r, en.y + r);
                g.line_to(en.x - r, en.y + r);
            }
            Kind::Splitter => {
                // hexagon: reads as "this is made of smaller pieces"
                for k in 0..6 {
                    let a = (k as f64 / 6.0) * TAU - PI / 2.0;
                    let (px, py) = (en.x + a.cos() * r, en.y + a.sin() * r);
                    if k == 0 {
                        g.move_to(px, py);
                    } else {
                        g.line_to(px, py);
                    }
                }
            }
            Kind::Sniper => {
                // a cross, drawn as one open path — no fill to close
                g.move_to(en.x - r, en.y);
                g.line_to(en.x + r, en.y);
                g.move_to(en.x, en.y - r);
                g.line_to(en.x, en.y + r);
            }
            Kind::Bulwark => {
                g.move_to(en.x - r, en.y - r);
                g.line_to(en.x + r, en.y - r);
                g.line_to(en.x + r, en.y + r);
                g.line_to(en.x - r, en.y + r);
            }
            Kind::Pulsar => {
                g.arc(en.x, en.y, r * 0.55, 0.0, TAU);
                for k in 0..6 {
                    let a = (k as f64 / 6.0) * TAU;
                    g.move_to(en.x + a.cos() * r * 0.6, en.y + a.sin() * r * 0.6);
                    g.line_to(en.x + a.cos() * r, en.y + a.sin() * r);
                }
            }
        }
        g.close();
        g.stroke();

        // the tells: which side of a bulwark is armored, and how close a
        // pulsar is to going off
        if en.kind == Kind::Bulwark && en.fade <= 0.0 {
            g.alpha(alpha * 0.9);
            g.line_width(3.0);
            g.begin();
            g.arc(en.x, en.y, r + 4.0, en.face - 1.1, en.face + 1.1);
            g.stroke();
        }
        if en.kind == Kind::Pulsar && en.fade <= 0.0 {
            let charge = 1.0 - (en.cool / 3.4).clamp(0.0, 1.0);
            g.alpha(alpha * (0.25 + charge * 0.7));
            g.line_width(1.0 + charge * 2.0);
            g.begin();
            g.arc(en.x, en.y, r + 6.0 + charge * 60.0, 0.0, TAU);
            g.stroke();
        }
        g.no_shadow();
    }

    fn draw_enemy(&self, i: usize) {
        let (fade, r) = (self.enemies[i].fade, self.enemies[i].r);
        if fade > 0.0 {
            self.draw_enemy_shape(i, r * (1.0 + fade), fade * 0.35);
            self.draw_enemy_shape(i, r, (1.0 - fade) * 0.9);
        } else {
            self.draw_enemy_shape(i, r, 0.9);
        }
    }

    /// The reticle, drawn because there is nothing else to show it: the OS
    /// cursor is hidden under pointer lock and the aim no longer lives at a
    /// screen position you could guess at.
    fn draw_reticle(&self) {
        let idx = if self.net.is_guest() { 1 } else { 0 };
        let s = match self.ships.get(idx) {
            Some(s) => s,
            None => return,
        };
        let reach = self.aim_off.0.hypot(self.aim_off.1);
        if reach < AIM_DEADZONE {
            return; // collapsed onto the hull — the ship's nose says it all
        }
        let g = &self.g;
        let col = ship_color(idx);
        // fades in with how far out you have pushed it
        g.alpha((reach / 90.0).min(1.0) * 0.55);
        g.stroke_color(col);
        g.shadow(col, 8.0);
        g.line_width(1.4);
        let (x, y) = (s.aim_x, s.aim_y);
        for (dx, dy) in [(-1.0, 0.0), (1.0, 0.0), (0.0, -1.0), (0.0, 1.0)] {
            g.begin();
            g.move_to(x + dx * 4.0, y + dy * 4.0);
            g.line_to(x + dx * 10.0, y + dy * 10.0);
            g.stroke();
        }
        g.no_shadow();
        g.alpha(1.0);
    }

    fn draw_ships(&self) {
        let g = &self.g;
        for (i, s) in self.ships.iter().enumerate() {
            if i == 0 && self.inv > 0.0 && ((self.t * 12.0).floor() as i64) % 2 != 0 {
                continue;
            }
            let a = s.aim_a;
            let col = ship_color(i);
            g.stroke_color(col);
            g.shadow(col, 14.0);
            g.line_width(2.0);
            g.alpha(1.0);
            g.begin();
            g.move_to(s.x + a.cos() * 15.0, s.y + a.sin() * 15.0);
            g.line_to(s.x + (a + 2.5).cos() * 11.0, s.y + (a + 2.5).sin() * 11.0);
            g.line_to(s.x + (a - 2.5).cos() * 11.0, s.y + (a - 2.5).sin() * 11.0);
            g.close();
            g.stroke();
            g.no_shadow();
        }
    }

    fn draw_parts(&self) {
        let g = &self.g;
        g.line_width(1.4);
        g.line_cap("round");
        for p in &self.parts {
            let s = p.vx.hypot(p.vy).max(1.0);
            g.alpha(p.life.max(0.0) * 0.7);
            g.stroke_color(&p.color);
            g.begin();
            g.move_to(p.x, p.y);
            g.line_to(p.x + (p.vx / s) * p.len, p.y + (p.vy / s) * p.len);
            g.stroke();
        }
        g.line_cap("butt");
    }

    fn draw_hud(&self) {
        let g = &self.g;
        let (w, _h) = (g.w, g.h);
        g.alpha(0.85);
        g.fill_color("#ececf1");
        g.font("600 17px Consolas, \"Courier New\", monospace");
        g.align("left");
        g.text(&format!("SCORE {}", self.score), 14.0, 28.0);
        g.alpha(if self.mult > 1 { 0.95 } else { 0.5 });
        g.fill_color(if self.mult > 1 { LIME } else { "#ececf1" });
        g.text(&format!("x{}", self.mult), 14.0, 50.0);
        g.alpha(0.4);
        g.fill_color("#ececf1");
        g.font("600 13px Consolas, \"Courier New\", monospace");
        g.text(&format!("BEST {}", self.best.max(self.score)), 14.0, 70.0);
        g.font("600 17px Consolas, \"Courier New\", monospace");
        g.alpha(0.85);
        for i in 0..self.lives.max(0) {
            let lx = w - 22.0 - i as f64 * 24.0;
            let ly = 22.0;
            g.begin();
            g.move_to(lx, ly - 8.0);
            g.line_to(lx + 7.0, ly + 6.0);
            g.line_to(lx - 7.0, ly + 6.0);
            g.close();
            g.stroke_color(WHITE);
            g.line_width(1.5);
            g.stroke();
        }
        let _ = PI;
    }
}
