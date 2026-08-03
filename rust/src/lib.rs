//! Arcade games compiled to WebAssembly.
//!
//! The JS shell still owns the page: overlays, mode switching, pointer lock and
//! the audio engine. This crate owns simulation and canvas rendering for the
//! games that have been ported, plus the WebRTC transport they share.

mod bridge;
mod geo;
mod gfx;
mod net;
mod pong;
mod rng;

use std::cell::RefCell;
use wasm_bindgen::prelude::*;

thread_local! {
    static PONG: RefCell<Option<pong::Pong>> = const { RefCell::new(None) };
    static GEO: RefCell<Option<geo::Geo>> = const { RefCell::new(None) };
}

#[wasm_bindgen(start)]
pub fn boot() {
    std::panic::set_hook(Box::new(|info| {
        bridge::error(&format!("arcade wasm panic: {info}"));
    }));
}

/// Build (or rebuild) a game's state. Called when the player picks it.
#[wasm_bindgen]
pub fn init(game: &str, canvas_id: &str, seed: f64) {
    let seed = seed.abs() as u64;
    match game {
        "pong" => PONG.with(|c| *c.borrow_mut() = pong::Pong::new(canvas_id, seed)),
        "geo" => GEO.with(|c| *c.borrow_mut() = geo::Geo::new(canvas_id, seed)),
        _ => bridge::error(&format!("init: unknown game {game}")),
    }
}

/// Advance and render one frame. `dt` is seconds, already clamped by the shell.
#[wasm_bindgen]
pub fn tick(game: &str, dt: f64) {
    match game {
        "pong" => PONG.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.frame(dt);
            }
        }),
        "geo" => GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.frame(dt);
            }
        }),
        _ => {}
    }
}

/// Start a match.
#[wasm_bindgen]
pub fn start(game: &str) {
    match game {
        "pong" => PONG.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.start();
            }
        }),
        "geo" => GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.start();
            }
        }),
        _ => {}
    }
}

/// True while a match is live — the shell uses this to decide what a click means.
#[wasm_bindgen]
pub fn running(game: &str) -> bool {
    match game {
        "pong" => PONG.with(|c| c.borrow().as_ref().map(|g| g.running).unwrap_or(false)),
        "geo" => GEO.with(|c| c.borrow().as_ref().map(|g| g.running).unwrap_or(false)),
        _ => false,
    }
}

/// Pointer position in CSS pixels, forwarded from the shell's pointer lock.
#[wasm_bindgen]
pub fn pointer(game: &str, x: f64, y: f64) {
    match game {
        "pong" => PONG.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.pointer(x, y);
            }
        }),
        "geo" => GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.pointer(x, y);
            }
        }),
        _ => {}
    }
}

/// Mouse button edges. `button` follows the DOM: 0 left, 2 right.
#[wasm_bindgen]
pub fn button(game: &str, button: i32, down: bool) {
    match game {
        "pong" => PONG.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.button(button, down);
            }
        }),
        "geo" => GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.button(button, down);
            }
        }),
        _ => {}
    }
}

/// Keyboard edges, lower-cased key names.
#[wasm_bindgen]
pub fn key(game: &str, name: &str, down: bool) {
    if game == "geo" {
        GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.key(name, down);
            }
        });
    }
}

/// Values the shell mirrors into DOM overlays (HP pips, score lines).
#[wasm_bindgen]
pub fn hud(game: &str) -> String {
    match game {
        "pong" => PONG.with(|c| c.borrow().as_ref().map(|g| g.hud()).unwrap_or_default()),
        "geo" => GEO.with(|c| c.borrow().as_ref().map(|g| g.hud()).unwrap_or_default()),
        _ => String::new(),
    }
}

/// Open a netplay session. `role` is "host" or "guest". The shell owns the
/// actual connection and feeds it in via `net_peer` / `net_packet`.
#[wasm_bindgen]
pub fn net_open(game: &str, role: &str) {
    let host = role == "host";
    match game {
        "pong" => PONG.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.net_open(host);
            }
        }),
        "geo" => GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.net_open(host);
            }
        }),
        _ => {}
    }
}

/// The shell reports the peer's data channel opening (true) or dying (false).
#[wasm_bindgen]
pub fn net_peer(game: &str, connected: bool) {
    match game {
        "pong" => PONG.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.net.peer(connected);
            }
        }),
        "geo" => GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.net.peer(connected);
            }
        }),
        _ => {}
    }
}

/// The shell delivers one packet received from the peer.
#[wasm_bindgen]
pub fn net_packet(game: &str, data: &[u8]) {
    match game {
        "pong" => PONG.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.net.packet(data);
            }
        }),
        "geo" => GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.net.packet(data);
            }
        }),
        _ => {}
    }
}

#[wasm_bindgen]
pub fn net_close(game: &str) {
    match game {
        "pong" => PONG.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.net.close();
            }
        }),
        "geo" => GEO.with(|c| {
            if let Some(g) = c.borrow_mut().as_mut() {
                g.net.close();
            }
        }),
        _ => {}
    }
}

/// "off" | "waiting" | "host" | "guest" — drives the lobby text in the shell.
#[wasm_bindgen]
pub fn net_status(game: &str) -> String {
    match game {
        "pong" => PONG.with(|c| {
            c.borrow()
                .as_ref()
                .map(|g| g.net.status().to_string())
                .unwrap_or_else(|| "off".into())
        }),
        "geo" => GEO.with(|c| {
            c.borrow()
                .as_ref()
                .map(|g| g.net.status().to_string())
                .unwrap_or_else(|| "off".into())
        }),
        _ => "off".into(),
    }
}
