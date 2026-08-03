//! Small seeded PRNG.
//!
//! The JS originals reached for `Math.random()` everywhere. That is fine for a
//! single player, but a netplay host and guest have to agree on the world, so
//! every roll in the ported games goes through one seedable stream instead.

#[allow(dead_code)]
pub struct Rng {
    state: u64,
}

#[allow(dead_code)]
impl Rng {
    pub fn new(seed: u64) -> Self {
        // a zero state would stick, so nudge it
        Self {
            state: if seed == 0 { 0x9E3779B97F4A7C15 } else { seed },
        }
    }

    /// xorshift64*, plenty for particle jitter and spawn rolls
    fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }

    /// uniform in [0, 1), the `Math.random()` stand-in
    pub fn f(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// uniform in [lo, hi)
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        lo + self.f() * (hi - lo)
    }

    /// uniform in [-0.5, 0.5), the `Math.random() - 0.5` idiom
    pub fn signed(&mut self) -> f64 {
        self.f() - 0.5
    }

    /// uniform angle in [0, 2pi)
    pub fn angle(&mut self) -> f64 {
        self.f() * std::f64::consts::TAU
    }

    /// uniform integer in [0, n)
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        (self.next_u64() % n as u64) as usize
    }
}
