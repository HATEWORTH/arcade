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

    /// One packet to the connected peer, via the shell's data channel.
    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = netSend)]
    fn js_net_send(data: &[u8]);

    /// Player graphics settings as [glow, shake, particles].
    ///
    /// Caught rather than plain: this is an optional shim, and an older cached
    /// shell that predates it would otherwise throw on every single frame and
    /// take the whole game down instead of just losing the settings.
    #[wasm_bindgen(js_namespace = ARCADE_WASM_HOST, js_name = gfx, catch)]
    fn js_gfx() -> Result<Vec<f64>, JsValue>;
}

/// Graphics knobs from the settings panel.
#[derive(Clone, Copy)]
pub struct GfxSettings {
    pub glow: f64,
    pub shake: f64,
    pub particles: f64,
}

impl Default for GfxSettings {
    fn default() -> Self {
        GfxSettings {
            glow: 1.0,
            shake: 1.0,
            particles: 1.0,
        }
    }
}

pub fn gfx_settings() -> GfxSettings {
    let v = match js_gfx() {
        Ok(v) => v,
        Err(_) => return GfxSettings::default(),
    };
    if v.len() < 3 {
        return GfxSettings::default();
    }
    GfxSettings {
        glow: v[0].clamp(0.0, 1.0),
        shake: v[1].clamp(0.0, 2.0),
        particles: v[2].clamp(0.0, 2.0),
    }
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
pub fn net_send(data: &[u8]) {
    js_net_send(data);
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
