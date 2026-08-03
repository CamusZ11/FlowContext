use crate::hot_zone::MonitorRect;
use thiserror::Error;

#[derive(Debug, Error, PartialEq)]
pub enum WindowControllerError {
    #[error("window operation failed: {0}")]
    Operation(String),
}

pub trait WindowPort {
    fn prepare_overlay(&mut self) -> Result<(), String>;
    fn set_physical_size(&mut self, width: f64, height: f64) -> Result<(), String>;
    fn set_physical_position(&mut self, x: f64, y: f64) -> Result<(), String>;
    fn set_always_on_top(&mut self, value: bool) -> Result<(), String>;
    fn show(&mut self) -> Result<(), String>;
    fn hide(&mut self) -> Result<(), String>;
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
        monitor: MonitorRect,
    ) -> Result<(), WindowControllerError> {
        let scale = monitor.scale_factor.max(0.0001);
        let width = self.width() * scale;
        let height = monitor.height;
        let x = monitor.right() - width;
        let y = monitor.y;
        window
            .prepare_overlay()
            .and_then(|_| window.set_physical_size(width, height))
            .and_then(|_| window.set_physical_position(x, y))
            .and_then(|_| window.set_always_on_top(true))
            .and_then(|_| window.show())
            .map_err(WindowControllerError::Operation)
    }

    pub fn hide<W: WindowPort>(
        &self,
        window: &mut W,
        monitor: MonitorRect,
    ) -> Result<(), WindowControllerError> {
        let x = monitor.right();
        let y = monitor.y;
        window
            .set_physical_position(x, y)
            .and_then(|_| window.hide())
            .map_err(WindowControllerError::Operation)
    }

    pub fn toggle<W: WindowPort>(
        &self,
        window: &mut W,
        monitor: MonitorRect,
    ) -> Result<(), WindowControllerError> {
        if window.is_visible() {
            self.hide(window, monitor)
        } else {
            self.show(window, monitor)
        }
    }
}
