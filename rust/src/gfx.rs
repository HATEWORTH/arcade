//! Canvas 2D wrapper.
//!
//! Both games are line-and-glow renderers: set a color, set a shadow, stroke a
//! path. This keeps the web-sys noise in one place so the game modules read
//! close to the JavaScript they were ported from.

use wasm_bindgen::JsCast;

use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

pub const CYAN: &str = "#8fce9a";
pub const MAGENTA: &str = "#e0459b";
pub const VIOLET: &str = "#4a2b7a";
pub const LIME: &str = "#e6cf5e";
pub const WHITE: &str = "#ffffff";

pub struct Gfx {
    pub ctx: CanvasRenderingContext2d,
    pub canvas: HtmlCanvasElement,
    pub w: f64,
    pub h: f64,
    pub dpr: f64,
}

impl Gfx {
    pub fn new(canvas_id: &str) -> Option<Self> {
        let win = web_sys::window()?;
        let doc = win.document()?;
        let canvas: HtmlCanvasElement = doc.get_element_by_id(canvas_id)?.dyn_into().ok()?;
        let ctx: CanvasRenderingContext2d = canvas
            .get_context("2d")
            .ok()??
            .dyn_into()
            .ok()?;
        let mut g = Gfx {
            ctx,
            canvas,
            w: 0.0,
            h: 0.0,
            dpr: 1.0,
        };
        g.resize();
        Some(g)
    }

    /// Match the backing store to the window, exactly as the JS `resize()` did.
    pub fn resize(&mut self) {
        let win = match web_sys::window() {
            Some(w) => w,
            None => return,
        };
        let dpr = win.device_pixel_ratio().min(2.0).max(1.0);
        let w = win.inner_width().ok().and_then(|v| v.as_f64()).unwrap_or(800.0);
        let h = win.inner_height().ok().and_then(|v| v.as_f64()).unwrap_or(600.0);
        if (w - self.w).abs() < 0.5 && (h - self.h).abs() < 0.5 && (dpr - self.dpr).abs() < 0.01 {
            return;
        }
        self.w = w;
        self.h = h;
        self.dpr = dpr;
        self.canvas.set_width((w * dpr) as u32);
        self.canvas.set_height((h * dpr) as u32);
        let _ = self.ctx.set_transform(dpr, 0.0, 0.0, dpr, 0.0, 0.0);
    }

    // ---- state ----------------------------------------------------------
    pub fn alpha(&self, a: f64) {
        self.ctx.set_global_alpha(a.clamp(0.0, 1.0));
    }
    pub fn stroke_color(&self, c: &str) {
        self.ctx.set_stroke_style_str(c);
    }
    pub fn fill_color(&self, c: &str) {
        self.ctx.set_fill_style_str(c);
    }
    pub fn shadow(&self, c: &str, blur: f64) {
        self.ctx.set_shadow_color(c);
        self.ctx.set_shadow_blur(blur);
    }
    pub fn no_shadow(&self) {
        self.ctx.set_shadow_blur(0.0);
    }
    pub fn line_width(&self, w: f64) {
        self.ctx.set_line_width(w);
    }
    pub fn line_cap(&self, c: &str) {
        self.ctx.set_line_cap(c);
    }
    pub fn line_join(&self, c: &str) {
        self.ctx.set_line_join(c);
    }
    pub fn composite(&self, mode: &str) {
        let _ = self.ctx.set_global_composite_operation(mode);
    }
    pub fn font(&self, f: &str) {
        self.ctx.set_font(f);
    }
    pub fn align(&self, a: &str) {
        self.ctx.set_text_align(a);
    }
    pub fn save(&self) {
        self.ctx.save();
    }
    pub fn restore(&self) {
        self.ctx.restore();
    }
    pub fn translate(&self, x: f64, y: f64) {
        let _ = self.ctx.translate(x, y);
    }
    pub fn rotate(&self, a: f64) {
        let _ = self.ctx.rotate(a);
    }

    // ---- primitives -----------------------------------------------------
    pub fn fill_rect(&self, x: f64, y: f64, w: f64, h: f64) {
        self.ctx.fill_rect(x, y, w, h);
    }
    pub fn stroke_rect(&self, x: f64, y: f64, w: f64, h: f64) {
        self.ctx.stroke_rect(x, y, w, h);
    }
    pub fn begin(&self) {
        self.ctx.begin_path();
    }
    pub fn move_to(&self, x: f64, y: f64) {
        self.ctx.move_to(x, y);
    }
    pub fn line_to(&self, x: f64, y: f64) {
        self.ctx.line_to(x, y);
    }
    pub fn close(&self) {
        self.ctx.close_path();
    }
    pub fn stroke(&self) {
        self.ctx.stroke();
    }
    pub fn fill(&self) {
        self.ctx.fill();
    }
    pub fn arc(&self, x: f64, y: f64, r: f64, a0: f64, a1: f64) {
        let _ = self.ctx.arc(x, y, r.max(0.0), a0, a1);
    }
    pub fn circle(&self, x: f64, y: f64, r: f64) {
        self.begin();
        self.arc(x, y, r, 0.0, std::f64::consts::TAU);
    }
    pub fn text(&self, s: &str, x: f64, y: f64) {
        let _ = self.ctx.fill_text(s, x, y);
    }

    /// One straight glowing segment — the workhorse of both games.
    #[allow(clippy::too_many_arguments)]
    pub fn glow_line(
        &self,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        color: &str,
        width: f64,
        blur: f64,
        alpha: f64,
    ) {
        self.alpha(alpha);
        self.stroke_color(color);
        self.line_width(width);
        self.shadow(color, blur);
        self.begin();
        self.move_to(x1, y1);
        self.line_to(x2, y2);
        self.stroke();
    }

    /// Radial gradient from `inner` at the center to transparent at the rim.
    pub fn radial(
        &self,
        x: f64,
        y: f64,
        r: f64,
        stops: &[(f64, &str)],
    ) -> Option<web_sys::CanvasGradient> {
        let g = self.ctx.create_radial_gradient(x, y, 0.0, x, y, r.max(0.01)).ok()?;
        for (at, color) in stops {
            let _ = g.add_color_stop(*at as f32, color);
        }
        Some(g)
    }

    pub fn fill_gradient(&self, g: &web_sys::CanvasGradient) {
        self.ctx.set_fill_style_canvas_gradient(g);
    }
}
