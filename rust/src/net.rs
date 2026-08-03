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
#[derive(Serialize, Deserialize, Clone, Copy, Default, Debug)]
pub struct Input {
    pub x: f32,
    pub y: f32,
    /// bit 0: primary held, bit 1: secondary pressed this frame
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

pub struct Net {
    role: Role,
    want_host: bool,
    /// newest snapshot the guest has received
    pub last_snapshot: Option<Vec<u8>>,
    /// newest input the host has received
    pub last_input: Input,
    pub peer_lost: bool,
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
            peer_lost: false,
        }
    }

    /// Enter the lobby. The shell owns the actual connection; this just
    /// records which side of it we asked to be.
    pub fn open(&mut self, want_host: bool) {
        self.want_host = want_host;
        self.role = Role::Waiting;
        self.peer_lost = false;
        self.last_snapshot = None;
        self.last_input = Input::default();
    }

    pub fn close(&mut self) {
        self.role = Role::Off;
        self.last_snapshot = None;
        self.peer_lost = false;
    }

    /// The shell reports the data channel opening or the peer vanishing.
    pub fn peer(&mut self, connected: bool) {
        if self.role == Role::Off {
            return;
        }
        if connected {
            self.role = if self.want_host { Role::Host } else { Role::Guest };
        } else if self.is_live() {
            self.peer_lost = true;
            self.role = Role::Waiting;
        }
    }

    /// The shell delivers one packet off the wire. Only the newest of each
    /// kind is kept — stale snapshots and inputs are worthless.
    pub fn packet(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        match data[0] {
            TAG_SNAPSHOT => self.last_snapshot = Some(data[1..].to_vec()),
            TAG_INPUT => {
                if let Ok(i) = bincode::deserialize::<Input>(&data[1..]) {
                    self.last_input = i;
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
        let mut packet = Vec::with_capacity(body.len() + 1);
        packet.push(tag);
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
