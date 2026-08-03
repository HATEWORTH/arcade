//! Calls back into the JS shell.
//!
//! The audio engine — synth, sequencer and the whole song book — stays in
//! JavaScript under `window.ARCADE`, because it is shared with the games that
//! were not ported and porting it would buy nothing. Rust just triggers it.

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    pub fn error(msg: &str);

    #[wasm_bindgen(js_namespace = console, js_name = log)]
    pub fn log(msg: &str);
}

#[wasm_bindgen]
extern "C" {
    /// `window.ARCADE_WASM_HOST` — the shim the shell installs for us.
    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = bleep)]
    fn js_bleep(freq: f64, dur: f64, wave: &str, gain: f64);

    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = sweep)]
    fn js_sweep(from: f64, to: f64, dur: f64, wave: &str, gain: f64);

    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = hat)]
    fn js_hat(dur: f64, gain: f64);

    /// Beat envelopes the music engine derives from the audio clock.
    /// Returns [kick, snare, bass, arp, phase].
    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = beat)]
    fn js_beat() -> Vec<f64>;

    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = reducedMotion)]
    fn js_reduced_motion() -> bool;

    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = storageGet)]
    fn js_storage_get(key: &str) -> Option<String>;

    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = storageSet)]
    fn js_storage_set(key: &str, value: &str);

    /// Game-over / lifecycle notifications the shell turns into DOM overlays.
    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = event)]
    fn js_event(game: &str, name: &str, detail: &str);
}

pub fn bleep(freq: f64, dur: f64, wave: &str, gain: f64) {
    js_bleep(freq, dur, wave, gain);
}
pub fn sweep(from: f64, to: f64, dur: f64, wave: &str, gain: f64) {
    js_sweep(from, to, dur, wave, gain);
}
pub fn hat(dur: f64, gain: f64) {
    js_hat(dur, gain);
}
pub fn event(game: &str, name: &str, detail: &str) {
    js_event(game, name, detail);
}
pub fn reduced_motion() -> bool {
    js_reduced_motion()
}
pub fn storage_get(key: &str) -> Option<String> {
    js_storage_get(key)
}
pub fn storage_set(key: &str, value: &str) {
    js_storage_set(key, value);
}

/// Beat envelopes, defaulted to silence if the shim is missing.
#[derive(Default, Clone, Copy)]
pub struct Beat {
    pub kick: f64,
    pub snare: f64,
    pub bass: f64,
    pub arp: f64,
    pub phase: f64,
}

pub fn beat() -> Beat {
    let v = js_beat();
    if v.len() < 5 {
        return Beat::default();
    }
    Beat {
        kick: v[0],
        snare: v[1],
        bass: v[2],
        arp: v[3],
        phase: v[4],
    }
}
