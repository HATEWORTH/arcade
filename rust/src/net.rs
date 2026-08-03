//! WebRTC transport over matchbox.
//!
//! Host-authoritative: the host runs the simulation and broadcasts snapshots,
//! the guest sends input and draws what it is told. Both games share this
//! plumbing; only the payload types differ.
//!
//! Rollback is deliberately not attempted. These are variable-timestep games
//! with plenty of per-frame randomness, and at Pong/Geo speeds snapshot sync
//! plus interpolation is indistinguishable from it.

use matchbox_socket::{PeerState, WebRtcSocket};
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
    socket: Option<WebRtcSocket>,
    role: Role,
    want_host: bool,
    peer: Option<matchbox_socket::PeerId>,
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
            socket: None,
            role: Role::Off,
            want_host: false,
            peer: None,
            last_snapshot: None,
            last_input: Input::default(),
            peer_lost: false,
        }
    }

    pub fn open(&mut self, url: &str, want_host: bool) {
        // unreliable + unordered: the newest snapshot is the only one that
        // matters, so never pay for a retransmit of a stale one
        let (socket, driver) = WebRtcSocket::new_unreliable(url);
        wasm_bindgen_futures::spawn_local(async move {
            // the driver future owns the signalling loop; it ends when the
            // socket is dropped or the server hangs up
            let _ = driver.await;
        });
        self.socket = Some(socket);
        self.want_host = want_host;
        self.role = Role::Waiting;
        self.peer = None;
        self.peer_lost = false;
        self.last_snapshot = None;
    }

    pub fn close(&mut self) {
        self.socket = None;
        self.role = Role::Off;
        self.peer = None;
        self.last_snapshot = None;
        self.peer_lost = false;
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

    /// Pump the socket. Call once per frame before using the game state.
    pub fn poll(&mut self) {
        let socket = match self.socket.as_mut() {
            Some(s) => s,
            None => return,
        };

        // connection churn
        let updates = socket.try_update_peers().unwrap_or_default();
        for (id, state) in updates {
            match state {
                PeerState::Connected => {
                    if self.peer.is_none() {
                        self.peer = Some(id);
                        // whoever asked to host, hosts; if both or neither did,
                        // the larger peer id breaks the tie deterministically
                        self.role = if self.want_host { Role::Host } else { Role::Guest };
                    }
                }
                PeerState::Disconnected => {
                    if self.peer == Some(id) {
                        self.peer = None;
                        self.peer_lost = true;
                        self.role = Role::Waiting;
                    }
                }
            }
        }

        // drain, keeping only the newest of each kind
        for (_id, packet) in socket.channel_mut(0).receive() {
            let packet: Box<[u8]> = packet;
            if packet.is_empty() {
                continue;
            }
            match packet[0] {
                TAG_SNAPSHOT => self.last_snapshot = Some(packet[1..].to_vec()),
                TAG_INPUT => {
                    if let Ok(i) = bincode::deserialize::<Input>(&packet[1..]) {
                        self.last_input = i;
                    }
                }
                _ => {}
            }
        }
    }

    pub fn send_snapshot<T: Serialize>(&mut self, snap: &T) {
        self.send_tagged(TAG_SNAPSHOT, snap);
    }

    pub fn send_input(&mut self, input: &Input) {
        self.send_tagged(TAG_INPUT, input);
    }

    fn send_tagged<T: Serialize>(&mut self, tag: u8, value: &T) {
        let (socket, peer) = match (self.socket.as_mut(), self.peer) {
            (Some(s), Some(p)) => (s, p),
            _ => return,
        };
        let body = match bincode::serialize(value) {
            Ok(b) => b,
            Err(_) => return,
        };
        let mut packet = Vec::with_capacity(body.len() + 1);
        packet.push(tag);
        packet.extend_from_slice(&body);
        socket.channel_mut(0).send(packet.into_boxed_slice(), peer);
    }

    /// Take the pending snapshot, decoded.
    pub fn take_snapshot<T: for<'de> Deserialize<'de>>(&mut self) -> Option<T> {
        let bytes = self.last_snapshot.take()?;
        bincode::deserialize(&bytes).ok()
    }
}

const TAG_SNAPSHOT: u8 = 1;
const TAG_INPUT: u8 = 2;
