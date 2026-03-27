/// Platform abstraction for system audio capture (loopback).
///
/// Each platform (Windows/macOS/Linux) implements the `SpeakerInput` trait
/// behind compile-time `#[cfg]` gates. A factory function selects the correct
/// implementation at build time with zero runtime overhead.

pub mod commands;

#[cfg(target_os = "windows")]
mod windows;

/// Trait that every platform-specific speaker capture must implement.
pub trait SpeakerInput: Send + 'static {
    /// Drain all available audio samples from the ring buffer.
    /// Returns an empty Vec when no new samples are available.
    fn read_samples(&mut self) -> Vec<f32>;

    /// The native sample rate of the capture device (e.g. 44100 or 48000).
    fn sample_rate(&self) -> u32;

    /// Stop the capture thread and release audio resources.
    fn stop(&mut self);
}

// --- Platform type aliases ---

#[cfg(target_os = "windows")]
pub type SpeakerStream = windows::WindowsSpeaker;

// Placeholder types for future platforms
#[cfg(target_os = "macos")]
pub type SpeakerStream = ();
#[cfg(target_os = "linux")]
pub type SpeakerStream = ();

/// Create a platform-specific speaker loopback capture stream.
/// `device_index`: optional device index (None = default output device).
pub fn create_speaker_stream(device_index: Option<usize>) -> Result<SpeakerStream, String> {
    #[cfg(target_os = "windows")]
    {
        windows::WindowsSpeaker::new(device_index)
    }
    #[cfg(target_os = "macos")]
    {
        let _ = device_index;
        Err("macOS audio capture not yet implemented".to_string())
    }
    #[cfg(target_os = "linux")]
    {
        let _ = device_index;
        Err("Linux audio capture not yet implemented".to_string())
    }
}
