//! Click-through decision (W-M6-5).
#![allow(dead_code)]
//!
//! The pet page reports chrome rects and model hit names; the shell decides
//! whether `setIgnoreCursorEvents` should be on. Pixel-perfect hits come from
//! `window.__DSH_FRIEND_PET__.hitTest` in the injected bridge.

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HitRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl HitRect {
    pub fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x < self.x + self.w && y < self.y + self.h
    }
}

/// `true` → the OS window should ignore the cursor (click falls through).
pub fn decide_ignore_cursor(
    click_through: bool,
    over_window: bool,
    over_chrome: bool,
    model_hits: usize,
) -> bool {
    if !click_through {
        return false;
    }
    if !over_window {
        return true;
    }
    if over_chrome || model_hits > 0 {
        return false;
    }
    true
}

pub fn any_rect_contains(rects: &[HitRect], x: f64, y: f64) -> bool {
    rects.iter().any(|rect| rect.contains(x, y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disabled_never_ignores() {
        assert!(!decide_ignore_cursor(false, true, false, 0));
        assert!(!decide_ignore_cursor(false, false, false, 0));
    }

    #[test]
    fn outside_window_ignores_when_enabled() {
        assert!(decide_ignore_cursor(true, false, false, 0));
    }

    #[test]
    fn chrome_or_model_keeps_events() {
        assert!(!decide_ignore_cursor(true, true, true, 0));
        assert!(!decide_ignore_cursor(true, true, false, 1));
    }

    #[test]
    fn transparent_pixel_ignores() {
        assert!(decide_ignore_cursor(true, true, false, 0));
    }

    #[test]
    fn rect_hit_is_half_open() {
        let rect = HitRect {
            x: 10.0,
            y: 20.0,
            w: 30.0,
            h: 40.0,
        };
        assert!(rect.contains(10.0, 20.0));
        assert!(rect.contains(39.9, 59.9));
        assert!(!rect.contains(40.0, 20.0));
        assert!(!rect.contains(10.0, 60.0));
        assert!(any_rect_contains(&[rect], 15.0, 25.0));
        assert!(!any_rect_contains(&[rect], 0.0, 0.0));
    }
}
