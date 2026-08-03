//! Pong: a tunnel, two paddles and a ball with spin.
//!
//! Ported from js/pong.js. World space is x,y in [-1,1] and z in [0 (you) ..
//! DEPTH (them)], projected with a simple perspective divide.

use crate::bridge::{self, Beat};
use crate::gfx::{Gfx, CYAN, LIME, MAGENTA, VIOLET, WHITE};
use crate::net::{Input, Net};
use crate::rng::Rng;
use serde::{Deserialize, Serialize};
use std::f64::consts::{PI, TAU};

const DEPTH: f64 = 6.0;
const FOV: f64 = 2.6;
const MAX_HP: i32 = 7;
const PADDLE_W: f64 = 0.42;
const PADDLE_H: f64 = 0.34;
const BALL_R: f64 = 0.075;

#[derive(Clone, Copy)]
struct Proj {
    x: f64,
    y: f64,
    s: f64,
}

#[derive(Clone, Default)]
struct Ball {
    x: f64,
    y: f64,
    z: f64,
    vx: f64,
    vy: f64,
    vz: f64,
    spin_x: f64,
    spin_y: f64,
    power: bool,
    held: bool,
    trail: Vec<(f64, f64, f64)>,
}

impl Ball {
    fn new(z: f64, vx: f64, vy: f64, vz: f64) -> Self {
        Ball {
            z,
            vx,
            vy,
            vz,
            ..Default::default()
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Paddle {
    x: f64,
    y: f64,
    px: f64,
    py: f64,
    vx: f64,
    vy: f64,
    charge: f64,
    charging: bool,
}

struct Particle {
    x: f64,
    y: f64,
    z: f64,
    vx: f64,
    vy: f64,
    vz: f64,
    life: f64,
    decay: f64,
    color: String,
    len: f64,
}

struct Star {
    x: f64,
    y: f64,
    z: f64,
    tw: f64,
}

struct Float {
    text: String,
    color: String,
    x: f64,
    y: f64,
    t: f64,
}

#[derive(Clone, Copy, PartialEq)]
enum Power {
    Wide,
    Slow,
    Shield,
}

impl Power {
    fn color(&self) -> &'static str {
        match self {
            Power::Wide => "#e6cf5e",
            Power::Slow => "#d99a4e",
            Power::Shield => "#6a9fd8",
        }
    }
    fn label(&self) -> &'static str {
        match self {
            Power::Wide => "WIDE PADDLE",
            Power::Slow => "SLOW-MO",
            Power::Shield => "SHIELD",
        }
    }
}

struct Pickup {
    kind: Power,
    x: f64,
    y: f64,
    t: f64,
}

/// What the host sends the guest each frame.
#[derive(Serialize, Deserialize, Default)]
struct Snapshot {
    hp_you: i32,
    hp_cpu: i32,
    /// host paddle (drawn as the far paddle on the guest)
    host: (f32, f32),
    /// guest paddle as the host resolved it
    guest: (f32, f32),
    balls: Vec<(f32, f32, f32, bool)>,
    rally: u16,
    running: bool,
    serve_timer: f32,
    holding: bool,
}

pub struct Pong {
    g: Gfx,
    rng: Rng,
    pub running: bool,
    paused: bool,
    hp_you: i32,
    hp_cpu: i32,
    holding: bool,
    rally: i32,
    shake: f64,
    flash: f64,
    flash_color: String,
    pulse: f64,
    pulse_z: f64,
    pulse_dir: f64,
    serve_timer: f64,
    player: Paddle,
    cpu: Paddle,
    balls: Vec<Ball>,
    particles: Vec<Particle>,
    stars: Vec<Star>,
    floats: Vec<Float>,
    pickup: Option<Pickup>,
    eff_wide: f64,
    eff_slow: f64,
    eff_shield: i32,
    pointer_x: f64,
    pointer_y: f64,
    t: f64,
    beat: Beat,
    reduced: bool,
    pub net: Net,
    /// guest-side view of the world, rebuilt from snapshots
    remote: Snapshot,
    secondary_edge: bool,
}

impl Pong {
    pub fn new(canvas_id: &str, seed: u64) -> Option<Self> {
        let g = Gfx::new(canvas_id)?;
        let mut rng = Rng::new(seed);
        let mut stars = Vec::with_capacity(90);
        for _ in 0..90 {
            stars.push(Star {
                x: rng.signed() * 6.0,
                y: rng.signed() * 6.0,
                z: rng.f() * DEPTH,
                tw: rng.f() * TAU,
            });
        }
        let mut p = Pong {
            g,
            rng,
            running: false,
            paused: false,
            hp_you: MAX_HP,
            hp_cpu: MAX_HP,
            holding: false,
            rally: 0,
            shake: 0.0,
            flash: 0.0,
            flash_color: WHITE.into(),
            pulse: 0.0,
            pulse_z: 0.0,
            pulse_dir: 1.0,
            serve_timer: 0.0,
            player: Paddle::default(),
            cpu: Paddle::default(),
            balls: Vec::new(),
            particles: Vec::new(),
            stars,
            floats: Vec::new(),
            pickup: None,
            eff_wide: 0.0,
            eff_slow: 0.0,
            eff_shield: 0,
            pointer_x: 0.0,
            pointer_y: 0.0,
            t: 0.0,
            beat: Beat::default(),
            reduced: bridge::reduced_motion(),
            net: Net::new(),
            remote: Snapshot::default(),
            secondary_edge: false,
        };
        p.serve(1.0);
        p.running = false;
        Some(p)
    }

    pub fn net_open(&mut self, host: bool) {
        self.net.open(host);
    }

    // ---- geometry -------------------------------------------------------
    fn view_scale(&self) -> f64 {
        self.g.w.min(self.g.h) * 0.45
    }
    fn project(&self, x: f64, y: f64, z: f64) -> Proj {
        let s = FOV / (FOV + z);
        let vs = self.view_scale();
        Proj {
            x: self.g.w / 2.0 + x * s * vs,
            y: self.g.h / 2.0 + y * s * vs,
            s,
        }
    }

    pub fn pointer(&mut self, cx: f64, cy: f64) {
        let vs = self.view_scale();
        self.pointer_x = (cx - self.g.w / 2.0) / vs;
        self.pointer_y = (cy - self.g.h / 2.0) / vs;
    }

    pub fn button(&mut self, button: i32, down: bool) {
        if button == 2 {
            if down {
                self.secondary_edge = true;
                if self.running && !self.paused {
                    self.launch_serve();
                }
            }
            return;
        }
        if down {
            if self.running && !self.holding {
                self.player.charging = true;
            }
        } else {
            self.player.charging = false;
        }
    }

    pub fn hud(&self) -> String {
        format!("{}|{}|{}", self.hp_you, self.hp_cpu, self.rally)
    }

    // ---- match flow -----------------------------------------------------
    pub fn start(&mut self) {
        self.hp_you = MAX_HP;
        self.hp_cpu = MAX_HP;
        self.rally = 0;
        self.cpu.x = 0.0;
        self.cpu.y = 0.0;
        self.pickup = None;
        self.eff_wide = 0.0;
        self.eff_slow = 0.0;
        self.eff_shield = 0;
        self.floats.clear();
        self.particles.clear();
        self.player_serve_hold();
        self.running = true;
    }

    fn serve(&mut self, dir: f64) {
        let speed = 3.2 + (self.rally as f64 * 0.18).min(2.6);
        let a = self.rng.angle();
        self.balls.clear();
        self.balls.push(Ball::new(
            if dir > 0.0 { 0.4 } else { DEPTH - 0.4 },
            a.cos() * 0.7,
            a.sin() * 0.5,
            speed * dir,
        ));
        self.serve_timer = 0.9;
    }

    fn player_serve_hold(&mut self) {
        self.balls.clear();
        let mut b = Ball::new(0.18, 0.0, 0.0, 0.0);
        b.held = true;
        self.balls.push(b);
        self.holding = true;
        self.serve_timer = 0.0;
    }

    fn launch_serve(&mut self) {
        if !self.holding {
            return;
        }
        let (pvx, pvy) = (self.player.vx, self.player.vy);
        let (jx, jy) = (self.rng.signed() * 0.4, self.rng.signed() * 0.4);
        if let Some(b) = self.balls.first_mut() {
            b.held = false;
            b.vz = 3.2;
            b.vx = pvx * 0.4 + jx;
            b.vy = pvy * 0.4 + jy;
        } else {
            return;
        }
        self.holding = false;
        self.pulse = 1.0;
        self.pulse_z = 0.0;
        self.pulse_dir = 1.0;
        bridge::bleep(320.0, 0.06, "square", 0.05);
    }

    fn end_match(&mut self, won: bool) {
        self.running = false;
        bridge::event(
            "pong",
            "over",
            &format!("{}|{}|{}", if won { 1 } else { 0 }, self.hp_you, self.hp_cpu),
        );
    }

    fn burst(&mut self, x: f64, y: f64, z: f64, color: &str, count: usize, power: f64) {
        for _ in 0..count {
            let a = self.rng.angle();
            let sp = (0.6 + self.rng.f() * 1.6) * power;
            self.particles.push(Particle {
                x,
                y,
                z,
                vx: a.cos() * sp,
                vy: a.sin() * sp,
                vz: self.rng.signed() * sp * 1.4,
                life: 1.0,
                decay: 1.4 + self.rng.f() * 1.6,
                color: color.to_string(),
                len: 0.05 + self.rng.f() * 0.08,
            });
        }
    }

    fn player_w(&self) -> f64 {
        PADDLE_W * if self.eff_wide > 0.0 { 1.5 } else { 1.0 }
    }

    fn spawn_powerup(&mut self) {
        let kind = match self.rng.below(3) {
            0 => Power::Wide,
            1 => Power::Slow,
            _ => Power::Shield,
        };
        self.pickup = Some(Pickup {
            kind,
            x: 0.72,
            y: 0.72,
            t: 8.0,
        });
    }

    fn apply_power(&mut self, kind: Power, x: f64, y: f64) {
        match kind {
            Power::Wide => self.eff_wide = 10.0,
            Power::Slow => self.eff_slow = 6.0,
            Power::Shield => self.eff_shield = (self.eff_shield + 1).min(2),
        }
        self.floats.push(Float {
            text: kind.label().into(),
            color: kind.color().into(),
            x,
            y,
            t: 1.4,
        });
        let c = kind.color().to_string();
        self.burst(x, y, 0.0, &c, 24, 1.2);
        bridge::bleep(880.0, 0.18, "triangle", 0.07);
    }

    /// A ball got past a paddle.
    fn damage(&mut self, to_player: bool, idx: usize, amount: i32) {
        let (bx, by, bz) = {
            let b = &self.balls[idx];
            (b.x, b.y, b.z)
        };
        if to_player {
            self.hp_you = (self.hp_you - amount).max(0);
            bridge::sweep(300.0, 90.0, 0.3, "sawtooth", 0.06);
            self.flash_color = MAGENTA.into();
            self.burst(bx, by, bz, MAGENTA, 46, 1.6);
        } else {
            self.hp_cpu = (self.hp_cpu - amount).max(0);
            self.hp_you = (self.hp_you + 1).min(MAX_HP);
            self.spawn_powerup();
            bridge::sweep(500.0, 900.0, 0.3, "triangle", 0.06);
            self.flash_color = CYAN.into();
            self.burst(bx, by, bz, CYAN, 46, 1.6);
        }
        self.burst(bx, by, bz, WHITE, 18, 2.2);
        self.flash = 0.22;
        self.shake = 8.0;
        self.balls.remove(idx);
        if self.hp_you <= 0 {
            self.end_match(false);
            return;
        }
        if self.hp_cpu <= 0 {
            self.end_match(true);
            return;
        }
        if self.balls.is_empty() {
            self.rally = 0;
            if to_player {
                self.serve(-1.0);
            } else {
                self.player_serve_hold();
            }
        }
    }

    fn wall_hit(&mut self, x: f64, y: f64, z: f64) {
        bridge::bleep(200.0, 0.03, "square", 0.03);
        self.burst(x, y, z, LIME, 8, 0.7);
        self.shake = self.shake.max(3.0);
    }

    // ---- simulation -----------------------------------------------------
    fn update(&mut self, dt: f64) {
        let pw = self.player_w();
        let lim = 1.0 - 0.02;
        let tx = self
            .pointer_x
            .clamp(-lim + pw / 2.0, lim - pw / 2.0);
        let ty = self
            .pointer_y
            .clamp(-lim + PADDLE_H / 2.0, lim - PADDLE_H / 2.0);
        self.player.px = self.player.x;
        self.player.py = self.player.y;
        let k = (dt * 18.0).min(1.0);
        self.player.x += (tx - self.player.x) * k;
        self.player.y += (ty - self.player.y) * k;
        self.player.vx = (self.player.x - self.player.px) / dt.max(1e-4);
        self.player.vy = (self.player.y - self.player.py) / dt.max(1e-4);

        if self.player.charging {
            self.player.charge = (self.player.charge + dt * 1.6).min(1.0);
        } else {
            self.player.charge = (self.player.charge - dt * 3.0).max(0.0);
        }

        if !self.running {
            return;
        }

        // The far paddle is either a networked human or the built-in CPU.
        if self.net.is_host() {
            let i = self.net.last_input;
            self.cpu.x = (i.x as f64).clamp(-1.0 + PADDLE_W / 2.0, 1.0 - PADDLE_W / 2.0);
            self.cpu.y = (i.y as f64).clamp(-1.0 + PADDLE_H / 2.0, 1.0 - PADDLE_H / 2.0);
        } else {
            self.update_cpu(dt);
        }

        if self.eff_wide > 0.0 {
            self.eff_wide -= dt;
        }
        if self.eff_slow > 0.0 {
            self.eff_slow -= dt;
        }
        if let Some(p) = self.pickup.as_mut() {
            p.t -= dt;
            let (px, py, kind, expired) = (p.x, p.y, p.kind, p.t <= 0.0);
            if expired {
                self.pickup = None;
            } else if (self.player.x - px).abs() < pw / 2.0 + 0.07
                && (self.player.y - py).abs() < PADDLE_H / 2.0 + 0.07
            {
                self.pickup = None;
                self.apply_power(kind, px, py);
            }
        }

        if self.holding {
            let (x, y) = (self.player.x, self.player.y);
            if let Some(b) = self.balls.first_mut() {
                b.x = x;
                b.y = y;
                b.z = 0.18;
                b.trail.clear();
            }
            return;
        }

        if self.serve_timer > 0.0 {
            self.serve_timer -= dt;
            return;
        }

        let bdt = if self.eff_slow > 0.0 { dt * 0.55 } else { dt };
        let mut i = 0;
        while i < self.balls.len() {
            if self.step_ball(i, bdt, dt, pw) {
                // the ball was consumed (scored); indices shifted
                return;
            }
            i += 1;
        }
    }

    fn update_cpu(&mut self, dt: f64) {
        let mut threat: Option<(f64, f64)> = None;
        let mut best = f64::INFINITY;
        for b in &self.balls {
            if b.vz > 0.0 {
                let d = DEPTH - b.z;
                if d < best {
                    best = d;
                    threat = Some((b.x, b.y));
                }
            }
        }
        let diff = 1.9 + (((MAX_HP - self.hp_cpu) as f64) * 0.14).min(1.1);
        let urgency = if threat.is_some() {
            1.0 - (best / DEPTH).min(1.0)
        } else {
            0.3
        };
        let speed = diff * (0.35 + 0.65 * urgency);
        let (aim_x, aim_y) = threat.unwrap_or((0.0, 0.0));
        let step = speed * dt;
        self.cpu.x += (aim_x - self.cpu.x).clamp(-step, step);
        self.cpu.y += (aim_y - self.cpu.y).clamp(-step, step);
        self.cpu.x = self.cpu.x.clamp(-1.0 + PADDLE_W / 2.0, 1.0 - PADDLE_W / 2.0);
        self.cpu.y = self.cpu.y.clamp(-1.0 + PADDLE_H / 2.0, 1.0 - PADDLE_H / 2.0);
    }

    /// Advance one ball. Returns true if it was removed by scoring.
    fn step_ball(&mut self, i: usize, bdt: f64, dt: f64, pw: f64) -> bool {
        {
            let b = &mut self.balls[i];
            b.vx += b.spin_x * bdt;
            b.vy += b.spin_y * bdt;
            b.x += b.vx * bdt;
            b.y += b.vy * bdt;
            b.z += b.vz * bdt;
        }

        // wall bounces
        let mut hits: Vec<(f64, f64, f64)> = Vec::new();
        {
            let b = &mut self.balls[i];
            if b.x > 1.0 - BALL_R {
                b.x = 1.0 - BALL_R;
                b.vx = -b.vx.abs();
                hits.push((b.x, b.y, b.z));
            }
            if b.x < -1.0 + BALL_R {
                b.x = -1.0 + BALL_R;
                b.vx = b.vx.abs();
                hits.push((b.x, b.y, b.z));
            }
            if b.y > 1.0 - BALL_R {
                b.y = 1.0 - BALL_R;
                b.vy = -b.vy.abs();
                hits.push((b.x, b.y, b.z));
            }
            if b.y < -1.0 + BALL_R {
                b.y = -1.0 + BALL_R;
                b.vy = b.vy.abs();
                hits.push((b.x, b.y, b.z));
            }
        }
        for (x, y, z) in hits {
            self.wall_hit(x, y, z);
        }

        // near plane: you
        let near = {
            let b = &self.balls[i];
            b.z <= 0.0 && b.vz < 0.0
        };
        if near && self.resolve_near(i, dt, pw) {
            return true;
        }

        // far plane: them
        let far = {
            let b = &self.balls[i];
            b.z >= DEPTH && b.vz > 0.0
        };
        if far && self.resolve_far(i) {
            return true;
        }

        let b = &mut self.balls[i];
        let lat = 2.8;
        b.vx = b.vx.clamp(-lat, lat);
        b.vy = b.vy.clamp(-lat, lat);
        b.trail.push((b.x, b.y, b.z));
        if b.trail.len() > 26 {
            b.trail.remove(0);
        }
        false
    }

    fn resolve_near(&mut self, i: usize, dt: f64, pw: f64) -> bool {
        // rewind to the instant it crossed z=0 — a fast ball can otherwise
        // drift past the paddle edge between contact and the check
        let (bx, by, back) = {
            let b = &mut self.balls[i];
            let back = b.z / b.vz;
            b.x -= b.vx * back;
            b.y -= b.vy * back;
            (b.x, b.y, back)
        };
        let pf = (back / dt.max(1e-4)).clamp(0.0, 1.0);
        let px_at = self.player.x - (self.player.x - self.player.px) * pf;
        let py_at = self.player.y - (self.player.y - self.player.py) * pf;
        let r = BALL_R * 1.9;

        if (bx - px_at).abs() < pw / 2.0 + r && (by - py_at).abs() < PADDLE_H / 2.0 + r {
            let pow = self.player.charge;
            self.player.charge = 0.0;
            let nx = (bx - px_at) / (pw / 2.0 + r);
            let ny = (by - py_at) / (PADDLE_H / 2.0 + r);
            let edge = nx.abs().max(ny.abs()).min(1.0);
            let (pvx, pvy) = (self.player.vx, self.player.vy);
            let swipe = pvx.hypot(pvy);
            let rogue = edge * (swipe * 0.5).min(1.0);
            let (rx, ry) = (
                self.rng.signed() * rogue * 2.6,
                self.rng.signed() * rogue * 2.6,
            );
            {
                let b = &mut self.balls[i];
                b.z = 0.0;
                b.power = pow > 0.4;
                b.vz = (b.vz.abs() * 1.045 + 0.12) * (1.0 + pow * 0.9) * (1.0 - edge * edge * 0.18);
                b.vx += nx * nx.abs() * 3.4;
                b.vy += ny * ny.abs() * 3.4;
                b.vx += pvx * 0.25 * (1.0 + edge);
                b.vy += pvy * 0.25 * (1.0 + edge);
                b.vx += rx;
                b.vy += ry;
                b.spin_x = pvx * (0.35 + edge * 0.45);
                b.spin_y = pvy * (0.35 + edge * 0.45);
            }
            self.rally += 1;
            self.shake = 9.0 + pow * 6.0;
            self.pulse = 1.0;
            self.pulse_z = 0.0;
            self.pulse_dir = 1.0;
            if pow > 0.4 {
                bridge::bleep(110.0, 0.22, "square", 0.12);
                self.burst(bx, by, 0.0, WHITE, 30, 1.6);
            } else {
                bridge::bleep(320.0, 0.06, "square", 0.05);
            }
            self.burst(bx, by, 0.0, CYAN, 22, 1.1);
            false
        } else if self.eff_shield > 0 {
            self.eff_shield -= 1;
            {
                let b = &mut self.balls[i];
                b.z = 0.0;
                b.vz = b.vz.abs();
            }
            self.burst(bx, by, 0.0, "#6a9fd8", 26, 1.3);
            bridge::bleep(300.0, 0.18, "triangle", 0.09);
            self.shake = self.shake.max(6.0);
            false
        } else {
            self.damage(true, i, 1);
            true
        }
    }

    fn resolve_far(&mut self, i: usize) -> bool {
        let (bx, by) = {
            let b = &mut self.balls[i];
            let back = (b.z - DEPTH) / b.vz;
            b.x -= b.vx * back;
            b.y -= b.vy * back;
            (b.x, b.y)
        };
        let (cx, cy) = (self.cpu.x, self.cpu.y);
        if (bx - cx).abs() < PADDLE_W / 2.0 + BALL_R * 1.9
            && (by - cy).abs() < PADDLE_H / 2.0 + BALL_R * 1.9
        {
            {
                let b = &mut self.balls[i];
                b.z = DEPTH;
                b.power = false;
                b.vz = -(b.vz.abs() * 1.03 + 0.08);
                b.vx += (bx - cx) * 2.0;
                b.vy += (by - cy) * 2.0;
                b.spin_x *= 0.4;
                b.spin_y *= 0.4;
            }
            self.rally += 1;
            self.pulse = 1.0;
            self.pulse_z = DEPTH;
            self.pulse_dir = -1.0;
            bridge::bleep(240.0, 0.05, "square", 0.04);
            self.burst(bx, by, DEPTH, MAGENTA, 22, 1.1);
            false
        } else {
            let power = self.balls[i].power;
            self.damage(false, i, if power { 2 } else { 1 });
            true
        }
    }

    fn update_fx(&mut self, dt: f64) {
        self.floats.retain_mut(|f| {
            f.t -= dt;
            f.t > 0.0
        });
        self.particles.retain_mut(|p| {
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.z += p.vz * dt;
            let d = 1.0 - dt * 1.6;
            p.vx *= d;
            p.vy *= d;
            p.vz *= d;
            p.life -= p.decay * dt;
            p.life > 0.0 && p.z > -0.5 && p.z < DEPTH + 2.0
        });
        if self.pulse > 0.0 {
            self.pulse -= dt * 1.4;
            self.pulse_z += self.pulse_dir * dt * 7.0;
        }
        self.shake = (self.shake - dt * 40.0).max(0.0);
        self.flash = (self.flash - dt * 1.6).max(0.0);
        for s in &mut self.stars {
            s.z -= dt * 0.5;
            if s.z < 0.0 {
                s.z += DEPTH;
            }
        }
    }

    // ---- frame ----------------------------------------------------------
    pub fn frame(&mut self, dt: f64) {
        self.g.resize();
        self.beat = bridge::beat();
        self.t += dt;

        if self.net.is_guest() {
            // the host owns the world; we send our paddle and draw its answer
            let input = Input {
                x: self.pointer_x.clamp(-1.0, 1.0) as f32,
                y: self.pointer_y.clamp(-1.0, 1.0) as f32,
                buttons: (self.player.charging as u8) | ((self.secondary_edge as u8) << 1),
            };
            self.net.send_input(&input);
            self.secondary_edge = false;
            if let Some(snap) = self.net.take_snapshot::<Snapshot>() {
                self.apply_snapshot(snap);
            }
            self.update_fx(dt);
            self.draw();
            return;
        }

        self.secondary_edge = false;
        if !self.paused {
            self.update(dt);
            self.update_fx(dt);
        }
        if self.net.is_host() {
            let snap = self.snapshot();
            self.net.send_snapshot(&snap);
        }
        self.draw();
    }

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            hp_you: self.hp_you,
            hp_cpu: self.hp_cpu,
            host: (self.player.x as f32, self.player.y as f32),
            guest: (self.cpu.x as f32, self.cpu.y as f32),
            balls: self
                .balls
                .iter()
                .map(|b| (b.x as f32, b.y as f32, b.z as f32, b.power))
                .collect(),
            rally: self.rally.max(0) as u16,
            running: self.running,
            serve_timer: self.serve_timer as f32,
            holding: self.holding,
        }
    }

    /// Rebuild the guest's view. The guest sees the tunnel from its own end,
    /// so depth is mirrored: the host's paddle becomes the far one.
    fn apply_snapshot(&mut self, s: Snapshot) {
        self.hp_you = s.hp_cpu;
        self.hp_cpu = s.hp_you;
        self.running = s.running;
        self.rally = s.rally as i32;
        self.serve_timer = s.serve_timer as f64;
        self.holding = false;
        // our paddle: trust our own local motion for feel, but stay honest
        // about where the host actually put us
        self.player.x += (s.guest.0 as f64 - self.player.x) * 0.35;
        self.player.y += (s.guest.1 as f64 - self.player.y) * 0.35;
        self.cpu.x = s.host.0 as f64;
        self.cpu.y = s.host.1 as f64;
        self.balls.clear();
        for (x, y, z, power) in &s.balls {
            let mut b = Ball::new(DEPTH - *z as f64, 0.0, 0.0, 0.0);
            b.x = *x as f64;
            b.y = *y as f64;
            b.power = *power;
            self.balls.push(b);
        }
        self.remote = s;
    }

    // ---- draw -----------------------------------------------------------
    fn draw(&mut self) {
        let g = &self.g;
        let (w, h) = (g.w, g.h);
        g.composite("source-over");
        g.alpha(1.0);
        g.no_shadow();
        g.fill_color("rgba(18, 20, 13, 0.5)");
        g.fill_rect(0.0, 0.0, w, h);

        g.save();
        if self.shake > 0.0 && !self.reduced {
            let (sx, sy) = (
                self.rng.signed() * self.shake,
                self.rng.signed() * self.shake,
            );
            g.translate(sx, sy);
        }
        g.composite("lighter");
        g.line_cap("round");

        self.draw_stars();
        self.draw_tunnel();
        self.draw_markers();
        self.draw_cpu_paddle();
        self.draw_balls();
        self.draw_particles();
        self.draw_shield();
        self.draw_pickup();
        self.draw_player_paddle();
        self.draw_floats();

        self.g.restore();
        self.draw_flash();

        let g = &self.g;
        g.composite("source-over");
        g.alpha(1.0);
        g.no_shadow();
    }

    fn draw_stars(&self) {
        let g = &self.g;
        for s in &self.stars {
            let p = self.project(s.x, s.y, s.z);
            if p.x < -20.0 || p.x > g.w + 20.0 || p.y < -20.0 || p.y > g.h + 20.0 {
                continue;
            }
            let tw = 0.3 + 0.25 * (self.t * 2.0 + s.tw).sin() + self.beat.arp * 0.35;
            g.alpha((tw * p.s).min(1.0));
            g.fill_color(VIOLET);
            g.shadow(VIOLET, 6.0 + self.beat.arp * 6.0);
            g.fill_rect(p.x, p.y, 2.0, 2.0);
        }
    }

    fn rect3d(&self, hw: f64, hh: f64, xo: f64, yo: f64, z: f64, color: &str, width: f64, blur: f64, alpha: f64) -> [Proj; 4] {
        let q = [
            self.project(xo - hw, yo - hh, z),
            self.project(xo + hw, yo - hh, z),
            self.project(xo + hw, yo + hh, z),
            self.project(xo - hw, yo + hh, z),
        ];
        let g = &self.g;
        g.alpha(alpha);
        g.stroke_color(color);
        g.line_width(width);
        g.shadow(color, blur);
        g.begin();
        g.move_to(q[0].x, q[0].y);
        g.line_to(q[1].x, q[1].y);
        g.line_to(q[2].x, q[2].y);
        g.line_to(q[3].x, q[3].y);
        g.close();
        g.stroke();
        q
    }

    fn draw_tunnel(&self) {
        const RINGS: i32 = 9;
        let wave_z = (self.beat.phase % 1.0) * DEPTH;
        for i in 0..=RINGS {
            let z = (i as f64 / RINGS as f64) * DEPTH;
            let near = 1.0 - z / DEPTH;
            let mut alpha = 0.16 + near * 0.22 + self.beat.kick * 0.09;
            let mut width = 1.0 + near * 1.2 + self.beat.kick * 1.4;
            let mut color = VIOLET;
            let wd = (z - wave_z).abs();
            if wd < 0.7 && self.beat.bass > 0.0 {
                alpha = (alpha + (1.0 - wd / 0.7) * self.beat.bass * 0.28).min(0.75);
                width += (1.0 - wd / 0.7) * self.beat.bass * 1.6;
            }
            if self.pulse > 0.0 && (z - self.pulse_z).abs() < 0.45 {
                alpha = (alpha + self.pulse * 0.8).min(1.0);
                width += self.pulse * 2.5;
                color = if self.pulse_z < DEPTH / 2.0 { CYAN } else { MAGENTA };
            }
            let bs = 1.0 + self.beat.kick * 0.012;
            self.rect3d(bs, bs, 0.0, 0.0, z, color, width, 14.0 + self.beat.kick * 10.0, alpha);
        }
        let g = &self.g;
        for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            let n = self.project(sx, sy, 0.0);
            let f = self.project(sx, sy, DEPTH);
            g.glow_line(n.x, n.y, f.x, f.y, VIOLET, 1.4, 12.0, 0.5);
        }
    }

    fn draw_markers(&self) {
        if !self.running {
            return;
        }
        let g = &self.g;
        for b in &self.balls {
            let z = b.z.clamp(0.0, DEPTH);
            let col = if b.power { WHITE } else { LIME };
            let close = 1.0 - z / DEPTH;
            let la = 0.14 + close * 0.4;
            let lw = 1.2 + close * 1.2;
            let pairs = [
                (self.project(-1.0, b.y, 0.0), self.project(-1.0, b.y, z)),
                (self.project(1.0, b.y, 0.0), self.project(1.0, b.y, z)),
                (self.project(b.x, -1.0, 0.0), self.project(b.x, -1.0, z)),
                (self.project(b.x, 1.0, 0.0), self.project(b.x, 1.0, z)),
            ];
            for (p0, p1) in pairs {
                g.glow_line(p0.x, p0.y, p1.x, p1.y, col, lw, 8.0, la);
            }
            self.rect3d(1.0, 1.0, 0.0, 0.0, z, col, 1.0 + close, 6.0, 0.08 + close * 0.2);
        }
    }

    fn draw_cpu_paddle(&self) {
        let g = &self.g;
        g.line_cap("butt");
        g.line_join("miter");
        self.rect3d(
            PADDLE_W / 2.0,
            PADDLE_H / 2.0,
            self.cpu.x,
            self.cpu.y,
            DEPTH,
            MAGENTA,
            2.4 + self.beat.snare * 1.2,
            18.0 + self.beat.snare * 14.0,
            0.95,
        );
        g.line_cap("round");
        let q = [
            self.project(self.cpu.x - PADDLE_W / 2.0, self.cpu.y - PADDLE_H / 2.0, DEPTH),
            self.project(self.cpu.x + PADDLE_W / 2.0, self.cpu.y - PADDLE_H / 2.0, DEPTH),
            self.project(self.cpu.x + PADDLE_W / 2.0, self.cpu.y + PADDLE_H / 2.0, DEPTH),
            self.project(self.cpu.x - PADDLE_W / 2.0, self.cpu.y + PADDLE_H / 2.0, DEPTH),
        ];
        g.alpha(0.12);
        g.fill_color(MAGENTA);
        g.begin();
        g.move_to(q[0].x, q[0].y);
        g.line_to(q[1].x, q[1].y);
        g.line_to(q[2].x, q[2].y);
        g.line_to(q[3].x, q[3].y);
        g.fill();
    }

    fn draw_balls(&self) {
        if !(self.running || self.particles.is_empty()) {
            return;
        }
        let g = &self.g;
        let vs = self.view_scale();
        for (bi, b) in self.balls.iter().enumerate() {
            let col = if b.power { WHITE } else { LIME };
            let fade = if b.power {
                "rgba(255,255,255,0)"
            } else {
                "rgba(230,207,94,0)"
            };
            for (i, (tx, ty, tz)) in b.trail.iter().enumerate() {
                let pr = self.project(*tx, *ty, *tz);
                let f = i as f64 / b.trail.len().max(1) as f64;
                g.alpha(f * 0.35);
                g.fill_color(col);
                g.shadow(col, 10.0);
                g.circle(pr.x, pr.y, BALL_R * vs * pr.s * f * 0.7);
                g.fill();
            }
            let bp = self.project(b.x, b.y, b.z);
            let r = (BALL_R * vs * bp.s).max(2.0) * (1.0 + self.beat.kick * 0.18);
            g.alpha(1.0);
            if let Some(grad) = g.radial(
                bp.x,
                bp.y,
                r * 2.4,
                &[(0.0, "#ffffff"), (0.35, col), (1.0, fade)],
            ) {
                g.fill_gradient(&grad);
            } else {
                g.fill_color(col);
            }
            g.shadow(col, 24.0);
            g.circle(bp.x, bp.y, r * 2.4);
            g.fill();

            if self.serve_timer > 0.0 && bi == 0 {
                g.alpha(0.8);
                g.stroke_color(WHITE);
                g.line_width(2.0);
                g.shadow(WHITE, 12.0);
                g.begin();
                g.arc(
                    bp.x,
                    bp.y,
                    r * 3.2,
                    -PI / 2.0,
                    -PI / 2.0 + (1.0 - self.serve_timer / 0.9) * TAU,
                );
                g.stroke();
            }
        }
    }

    fn draw_particles(&self) {
        let g = &self.g;
        g.line_width(1.6);
        for p in &self.particles {
            let a = self.project(p.x, p.y, p.z);
            let b = self.project(
                p.x + p.vx * p.len,
                p.y + p.vy * p.len,
                p.z + p.vz * p.len,
            );
            g.alpha(p.life.max(0.0) * 0.9);
            g.stroke_color(&p.color);
            g.shadow(&p.color, 8.0);
            g.begin();
            g.move_to(a.x, a.y);
            g.line_to(b.x, b.y);
            g.stroke();
        }
    }

    fn draw_shield(&self) {
        if self.eff_shield > 0 && self.running {
            let sp = 0.22 + 0.05 * (self.t * 2.2).sin();
            self.rect3d(
                0.99,
                0.99,
                0.0,
                0.0,
                0.02,
                "#6a9fd8",
                1.5 + self.eff_shield as f64 * 0.8,
                10.0,
                sp,
            );
        }
    }

    fn draw_pickup(&self) {
        let pu = match (&self.pickup, self.running) {
            (Some(p), true) => p,
            _ => return,
        };
        let g = &self.g;
        let pp = self.project(pu.x, pu.y, 0.0);
        let sz = 0.06 * self.view_scale() * pp.s;
        let fade = (pu.t / 1.5).min(1.0);
        let color = pu.kind.color();
        g.save();
        g.translate(pp.x, pp.y);
        g.rotate(self.t * 1.2);
        g.alpha(0.85 * fade);
        g.stroke_color(color);
        g.shadow(color, 14.0);
        g.line_width(2.0);
        g.stroke_rect(-sz, -sz, sz * 2.0, sz * 2.0);
        g.rotate(-self.t * 2.8);
        g.alpha(0.5 * fade);
        g.stroke_rect(-sz * 0.55, -sz * 0.55, sz * 1.1, sz * 1.1);
        g.restore();
        g.alpha(0.75 * fade);
        g.fill_color(color);
        g.shadow(color, 8.0);
        g.font("600 11px Consolas, monospace");
        g.align("center");
        g.text(pu.kind.label(), pp.x, pp.y + sz + 18.0);
        g.align("left");
    }

    fn draw_player_paddle(&self) {
        let g = &self.g;
        let phw = self.player_w() / 2.0;
        let q = [
            self.project(self.player.x - phw, self.player.y - PADDLE_H / 2.0, 0.0),
            self.project(self.player.x + phw, self.player.y - PADDLE_H / 2.0, 0.0),
            self.project(self.player.x + phw, self.player.y + PADDLE_H / 2.0, 0.0),
            self.project(self.player.x - phw, self.player.y + PADDLE_H / 2.0, 0.0),
        ];
        let chg = self.player.charge;
        g.alpha(0.1 + chg * 0.08);
        g.fill_color(CYAN);
        g.begin();
        g.move_to(q[0].x, q[0].y);
        g.line_to(q[1].x, q[1].y);
        g.line_to(q[2].x, q[2].y);
        g.line_to(q[3].x, q[3].y);
        g.fill();

        if chg > 0.02 {
            g.alpha(chg * 0.8);
            g.stroke_color(WHITE);
            g.line_width(1.5 + chg * 1.5);
            g.shadow(WHITE, 8.0 + chg * 12.0);
            let inset = (1.0 - chg) * 14.0 + 6.0;
            g.stroke_rect(
                q[0].x.min(q[2].x) + inset,
                q[0].y.min(q[2].y) + inset,
                (q[2].x - q[0].x).abs() - inset * 2.0,
                (q[2].y - q[0].y).abs() - inset * 2.0,
            );
        }
        g.alpha(0.95);
        g.stroke_color(CYAN);
        g.line_width(3.0 + self.beat.kick * 1.5 + chg * 1.5);
        g.shadow(CYAN, 22.0 + self.beat.kick * 16.0 + chg * 18.0);
        g.line_cap("butt");
        g.line_join("miter");
        g.begin();
        g.move_to(q[0].x, q[0].y);
        g.line_to(q[1].x, q[1].y);
        g.line_to(q[2].x, q[2].y);
        g.line_to(q[3].x, q[3].y);
        g.close();
        g.stroke();
        g.line_cap("round");

        if self.holding && self.running {
            let hp = self.project(self.player.x, self.player.y - PADDLE_H / 2.0 - 0.14, 0.0);
            g.alpha(0.75 + 0.2 * (self.t * 3.0).sin());
            g.fill_color(CYAN);
            g.shadow(CYAN, 8.0);
            g.font("600 12px Consolas, monospace");
            g.align("center");
            g.text("RIGHT CLICK TO SERVE", hp.x, hp.y);
            g.align("left");
        }
    }

    fn draw_floats(&self) {
        let g = &self.g;
        for f in &self.floats {
            let fp = self.project(f.x, f.y - (1.4 - f.t) * 0.25, 0.0);
            g.alpha((f.t / 1.4).min(1.0) * 0.9);
            g.fill_color(&f.color);
            g.shadow(&f.color, 10.0);
            g.font("600 13px Consolas, monospace");
            g.align("center");
            g.text(&f.text, fp.x, fp.y);
            g.align("left");
        }
    }

    fn draw_flash(&self) {
        if self.flash <= 0.0 {
            return;
        }
        let g = &self.g;
        let (cx, cy) = (g.w / 2.0, g.h / 2.0);
        g.composite("lighter");
        g.alpha(self.flash * 0.4);
        g.no_shadow();
        if let Some(grad) = g.radial(
            cx,
            cy,
            g.w.min(g.h) * 0.45,
            &[(0.0, &self.flash_color), (1.0, "rgba(0,0,0,0)")],
        ) {
            g.fill_gradient(&grad);
            g.fill_rect(0.0, 0.0, g.w, g.h);
        }
    }
}
