//! `/meet`: record a meeting on this Mac and turn it into a transcript with
//! speaker labels, entirely on the device. The microphone and the Mac's own
//! audio are recorded to separate files, whisper.cpp writes the transcript and
//! sherpa-onnx finds the speakers; nothing leaves the Mac except the one-time
//! download of the models, which the user starts (`models.rs`).
//!
//! macOS only: the capture, the Metal build of whisper and the bundled ONNX
//! runtime are all built for it. Other systems get commands that say so, and
//! the interface hides `/meet` there.

#[cfg(target_os = "macos")]
mod attribute;
#[cfg(target_os = "macos")]
mod audio;
#[cfg(target_os = "macos")]
mod capture;
#[cfg(target_os = "macos")]
mod diarize;
#[cfg(target_os = "macos")]
mod engine;
#[cfg(target_os = "macos")]
mod models;
#[cfg(target_os = "macos")]
mod sck;
#[cfg(target_os = "macos")]
mod summarize;
#[cfg(target_os = "macos")]
mod transcribe;
#[cfg(target_os = "macos")]
mod wav;

#[cfg(target_os = "macos")]
pub use engine::*;

#[cfg(not(target_os = "macos"))]
mod unsupported;
#[cfg(not(target_os = "macos"))]
pub use unsupported::*;
