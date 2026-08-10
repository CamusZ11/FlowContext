use crate::display_geometry::DisplayGeometry;
use crate::platform_window::{ShowIntent, WindowPlacement};
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum WindowControllerError {
    #[error("window operation failed: {0}")]
    Operation(String),
}

/// The window-controller knows only user intent and platform-neutral physical
/// rectangles. Native APIs live behind `platform_window`, keeping Windows from
/// inheriting any macOS-specific fullscreen or menu-bar behavior.
pub trait WindowPort {
    fn prepare_overlay(&mut self) -> Result<(), String>;
    fn place_and_show(&mut self, placement: WindowPlacement) -> Result<(), String>;
    fn hide_at(&mut self, x: f64, y: f64) -> Result<(), String>;
    fn is_visible(&self) -> bool;
}

#[derive(Clone, Copy, Debug)]
pub struct WindowController {
    saved_width: f64,
    min_width: f64,
    max_width: f64,
    pub animation_ms: u64,
}

impl WindowController {
    pub const fn new(saved_width: f64, min_width: f64, max_width: f64) -> Self {
        Self {
            saved_width,
            min_width,
            max_width,
            animation_ms: 120,
        }
    }

    pub fn width(&self) -> f64 {
        if self.saved_width.is_finite() {
            self.saved_width.clamp(self.min_width, self.max_width)
        } else {
            self.min_width
        }
    }

    pub fn show<W: WindowPort>(
        &self,
        window: &mut W,
        display: &DisplayGeometry,
    ) -> Result<(), WindowControllerError> {
        self.show_with_intent(window, display, ShowIntent::Passive)
    }

    pub fn show_with_intent<W: WindowPort>(
        &self,
        window: &mut W,
        display: &DisplayGeometry,
        intent: ShowIntent,
    ) -> Result<(), WindowControllerError> {
        let placement = WindowPlacement::new(display.panel_bounds(self.width()), intent);
        window
            .prepare_overlay()
            .and_then(|_| window.place_and_show(placement))
            .map_err(WindowControllerError::Operation)
    }

    pub fn hide<W: WindowPort>(
        &self,
        window: &mut W,
        display: &DisplayGeometry,
    ) -> Result<(), WindowControllerError> {
        window
            .hide_at(
                display.monitor_bounds.x + display.monitor_bounds.width,
                display.monitor_bounds.y,
            )
            .map_err(WindowControllerError::Operation)
    }

    pub fn toggle<W: WindowPort>(
        &self,
        window: &mut W,
        display: &DisplayGeometry,
    ) -> Result<(), WindowControllerError> {
        if window.is_visible() {
            self.hide(window, display)
        } else {
            self.show(window, display)
        }
    }
}
