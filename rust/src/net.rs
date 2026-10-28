//! WebRTC transport, driven by the JS shell.
//!
//! Signalling and the RTCPeerConnection live in JavaScript (trystero over
//! public nostr relays — no server of ours anywhere; the room code is both
//! the rendezvous point and the handshake-encryption secret). Rust sees four
//! things: a peer appeared, a peer left, bytes arrived, send these bytes.
//!
//! Host-authoritative: the host runs the simulation and broadcasts snapshots,
//! the guest sends input and draws what it is told. Both games share this
//! plumbing; only the payload types differ.
//!
//! Rollback is deliberately not attempted. These are variable-timestep games
//! with plenty of per-frame randomness, and at Pong/Geo speeds snapshot sync
//! plus interpolation is indistinguishable from it.

use crate::bridge;
use serde::{Deserialize, Serialize};

/// What the guest sends upstream every frame.
///
/// `x`/`y` is the stick: a paddle position in Pong, a movement axis in Geo.
/// `aim` is where the guest is pointing, in screen pixels — Geo needs it and
/// Pong ignores it. Without it the host had nothing to steer or fire player
/// two with, so their ship kept the heading it spawned with forever.
#[derive(Serialize, Deserialize, Clone, Copy, Default, Debug)]
pub struct Input {
    pub x: f32,
    pub y: f32,
    pub aim_x: f32,
    pub aim_y: f32,
    /// bit 0: primary held, bit 1: secondary pressed this frame, bit 2: the
    /// guest wants a rematch; bits 4-7 are a game's own (Geo counts bomb
    /// presses there, so a dropped packet can't lose one)
    pub buttons: u8,
}

#[allow(dead_code)]
impl Input {
    pub fn primary(&self) -> bool {
        self.buttons & 1 != 0
    }
    pub fn secondary(&self) -> bool {
        self.buttons & 2 != 0
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Off,
    Waiting,
    Host,
    Guest,
}

/// Connection edges a game reacts to once, taken with `Net::take_event`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NetEvent {
    Joined,
    Lost,
}

/// A guest input older than this is treated as released: a peer that paused,
/// backgrounded its tab or dropped off must not keep "holding fire" forever.
const INPUT_STALE: f64 = 0.25;

pub struct Net {
    role: Role,
    want_host: bool,
    /// newest snapshot the guest has received
    pub last_snapshot: Option<Vec<u8>>,
    /// newest input the host has received
    last_input: Input,
    /// seconds since `last_input` arrived
    input_age: f64,
    pub peer_lost: bool,
    event: Option<NetEvent>,
    /// The channel is unordered, so packets carry a sequence number and
    /// anything not newer than the last one applied is dropped — otherwise a
    /// late snapshot rubber-bands the board and a late input the stick.
    send_seq: u32,
    recv_snap_seq: u32,
    recv_input_seq: u32,
}

impl Default for Net {
    fn default() -> Self {
        Self::new()
    }
}

#[allow(dead_code)]
impl Net {
    pub fn new() -> Self {
        Net {
            role: Role::Off,
            want_host: false,
            last_snapshot: None,
            last_input: Input::default(),
            input_age: 0.0,
            peer_lost: false,
            event: None,
            send_seq: 0,
            recv_snap_seq: 0,
            recv_input_seq: 0,
        }
    }

    fn reset_stream(&mut self) {
        self.last_snapshot = None;
        self.last_input = Input::default();
        self.input_age = 0.0;
        self.send_seq = 0;
        self.recv_snap_seq = 0;
        self.recv_input_seq = 0;
    }

    /// Enter the lobby. The shell owns the actual connection; this just
    /// records which side of it we asked to be.
    pub fn open(&mut self, want_host: bool) {
        self.want_host = want_host;
        self.role = Role::Waiting;
        self.peer_lost = false;
        self.event = None;
        self.reset_stream();
    }

    pub fn close(&mut self) {
        self.role = Role::Off;
        self.peer_lost = false;
        self.event = None;
        self.reset_stream();
    }

    /// The shell reports the data channel opening or the peer vanishing.
    pub fn peer(&mut self, connected: bool) {
        if self.role == Role::Off {
            return;
        }
        if connected {
            if !self.is_live() {
                // a fresh peer numbers its packets from zero again
                self.reset_stream();
                self.event = Some(NetEvent::Joined);
            }
            self.role = if self.want_host { Role::Host } else { Role::Guest };
        } else if self.is_live() {
            self.peer_lost = true;
            self.role = Role::Waiting;
            // the departed player's last stick and trigger must not live on
            self.reset_stream();
            self.event = Some(NetEvent::Lost);
        }
    }

    /// The most recent connection edge, if any, consumed by the caller.
    pub fn take_event(&mut self) -> Option<NetEvent> {
        self.event.take()
    }

    /// Advance the input clock; called once per frame.
    pub fn age(&mut self, dt: f64) {
        self.input_age += dt;
    }

    /// The guest's current input, or neutral if it has gone quiet.
    pub fn input(&self) -> Input {
        if self.input_age > INPUT_STALE {
            // release what is held; the press counters in the high bits are
            // history, not a held button, and must not read as new presses
            Input { buttons: self.last_input.buttons & !0x07, ..self.last_input }
        } else {
            self.last_input
        }
    }

    /// The shell delivers one packet off the wire. Only the newest of each
    /// kind is kept — stale snapshots and inputs are worthless.
    pub fn packet(&mut self, data: &[u8]) {
        if data.len() < 5 {
            return;
        }
        let seq = u32::from_le_bytes([data[1], data[2], data[3], data[4]]);
        let body = &data[5..];
        match data[0] {
            TAG_SNAPSHOT if seq > self.recv_snap_seq => {
                self.recv_snap_seq = seq;
                self.last_snapshot = Some(body.to_vec());
            }
            TAG_INPUT if seq > self.recv_input_seq => {
                if let Ok(i) = bincode::deserialize::<Input>(body) {
                    self.recv_input_seq = seq;
                    self.last_input = i;
                    self.input_age = 0.0;
                }
            }
            _ => {}
        }
    }

    pub fn status(&self) -> &'static str {
        match self.role {
            Role::Off => "off",
            Role::Waiting => "waiting",
            Role::Host => "host",
            Role::Guest => "guest",
        }
    }

    pub fn wants_host(&self) -> bool {
        self.want_host
    }
    pub fn role(&self) -> Role {
        self.role
    }
    pub fn is_host(&self) -> bool {
        self.role == Role::Host
    }
    pub fn is_guest(&self) -> bool {
        self.role == Role::Guest
    }
    pub fn is_live(&self) -> bool {
        matches!(self.role, Role::Host | Role::Guest)
    }

    pub fn send_snapshot<T: Serialize>(&mut self, snap: &T) {
        self.send_tagged(TAG_SNAPSHOT, snap);
    }

    pub fn send_input(&mut self, input: &Input) {
        self.send_tagged(TAG_INPUT, input);
    }

    fn send_tagged<T: Serialize>(&mut self, tag: u8, value: &T) {
        if !self.is_live() {
            return;
        }
        let body = match bincode::serialize(value) {
            Ok(b) => b,
            Err(_) => return,
        };
        self.send_seq += 1;
        let mut packet = Vec::with_capacity(body.len() + 5);
        packet.push(tag);
        packet.extend_from_slice(&self.send_seq.to_le_bytes());
        packet.extend_from_slice(&body);
        bridge::net_send(&packet);
    }

    /// Take the pending snapshot, decoded.
    pub fn take_snapshot<T: for<'de> Deserialize<'de>>(&mut self) -> Option<T> {
        let bytes = self.last_snapshot.take()?;
        bincode::deserialize(&bytes).ok()
    }
}

const TAG_SNAPSHOT: u8 = 1;
const TAG_INPUT: u8 = 2;

#[cfg(test)]
mod tests {
    use super::*;

    fn input_packet(seq: u32, x: f32, buttons: u8) -> Vec<u8> {
        let mut p = vec![TAG_INPUT];
        p.extend_from_slice(&seq.to_le_bytes());
        p.extend(bincode::serialize(&Input { x, buttons, ..Default::default() }).unwrap());
        p
    }

    fn live_host() -> Net {
        let mut n = Net::new();
        n.open(true);
        n.peer(true);
        n
    }

    #[test]
    fn stale_packets_are_dropped() {
        let mut n = live_host();
        n.packet(&input_packet(2, 0.5, 0));
        n.packet(&input_packet(1, -0.5, 0)); // overtaken on the wire
        assert_eq!(n.input().x, 0.5);
        n.packet(&input_packet(3, 0.25, 0));
        assert_eq!(n.input().x, 0.25);
    }

    #[test]
    fn quiet_peer_releases_held_buttons_but_keeps_counters() {
        let mut n = live_host();
        n.packet(&input_packet(1, 0.0, 0x31)); // firing, bomb count 3
        assert!(n.input().primary());
        n.age(1.0);
        assert!(!n.input().primary());
        assert_eq!(n.input().buttons >> 4, 3);
    }

    #[test]
    fn losing_the_peer_forgets_its_input_and_reports_once() {
        let mut n = live_host();
        assert_eq!(n.take_event(), Some(NetEvent::Joined));
        n.packet(&input_packet(5, 1.0, 1));
        n.peer(false);
        assert_eq!(n.take_event(), Some(NetEvent::Lost));
        assert_eq!(n.take_event(), None);
        assert!(!n.input().primary());
        // a new peer starts its numbering again and must be heard
        n.peer(true);
        n.packet(&input_packet(1, 0.75, 0));
        assert_eq!(n.input().x, 0.75);
    }

    #[test]
    fn short_packets_are_ignored() {
        let mut n = live_host();
        n.packet(&[TAG_INPUT, 1, 0]);
        assert_eq!(n.input().x, 0.0);
    }
}
