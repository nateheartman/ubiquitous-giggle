//! The Mac's own audio (a call's other side, a video) through ScreenCaptureKit.
//! macOS 13 or later, and the Screen Recording permission. No video is kept:
//! the stream is asked for the smallest picture it will give and the frames
//! are never read.

use super::capture::Capture;
use screencapturekit::cm::CMSampleBuffer;
use screencapturekit::prelude::*;
use std::sync::mpsc;
use std::time::Duration;

/// What the stream is asked for. Mono at the common rate; the recorder
/// converts it to 16 kHz.
pub const SYSTEM_RATE: u32 = 48_000;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Whether Screen Recording is allowed. If it isn't, asks once (the system
/// shows its own prompt) and answers for now: a permission granted just now
/// only takes effect after a restart of the app.
pub fn screen_access() -> bool {
    // SAFETY: both are plain CoreGraphics calls with no arguments.
    unsafe {
        if CGPreflightScreenCaptureAccess() {
            return true;
        }
        let _ = CGRequestScreenCaptureAccess();
    }
    false
}

struct Audio<F: Fn(&[f32]) + Send + Sync + 'static>(F);

impl<F: Fn(&[f32]) + Send + Sync + 'static> SCStreamOutputTrait for Audio<F> {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, kind: SCStreamOutputType) {
        if kind != SCStreamOutputType::Audio {
            return;
        }
        let Ok(list) = sample.audio_buffer_list() else { return };
        let mono = mono_from(list.iter().map(|b| (b.number_channels as usize, b.data())));
        if !mono.is_empty() {
            (self.0)(&mono);
        }
    }
}

/// Folds ScreenCaptureKit's buffers into one mono block. They arrive as
/// 32-bit floats, either one buffer per channel or one interleaved buffer.
fn mono_from<'a>(buffers: impl Iterator<Item = (usize, &'a [u8])>) -> Vec<f32> {
    let planes: Vec<Vec<f32>> = buffers
        .map(|(channels, bytes)| {
            let floats: Vec<f32> = bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect();
            super::audio::to_mono(&floats, channels.max(1))
        })
        .collect();
    let n = planes.iter().map(Vec::len).min().unwrap_or(0);
    (0..n).map(|i| planes.iter().map(|p| p[i]).sum::<f32>() / planes.len() as f32).collect()
}

/// Starts system audio capture; `on_audio` gets each block of mono samples
/// at `SYSTEM_RATE`. The stream lives on a thread of its own until stopped.
pub fn start(on_audio: impl Fn(&[f32]) + Send + Sync + 'static) -> Result<Capture, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let thread = std::thread::spawn(move || match begin(on_audio) {
        Ok(stream) => {
            let _ = ready_tx.send(Ok(()));
            let _ = stop_rx.recv();
            let _ = stream.stop_capture();
        }
        Err(e) => {
            let _ = ready_tx.send(Err(e));
        }
    });
    match ready_rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => Ok(Capture { stop: stop_tx, thread }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => Err("System audio didn't start in time.".into()),
    }
}

fn begin(on_audio: impl Fn(&[f32]) + Send + Sync + 'static) -> Result<SCStream, String> {
    let content = SCShareableContent::get().map_err(|e| format!("System audio isn't available: {e}"))?;
    let display = content.displays().into_iter().next().ok_or("No display to capture audio from.")?;
    let filter = SCContentFilter::create().with_display(&display).with_excluding_windows(&[]).build().map_err(|e| e.to_string())?;
    let config = SCStreamConfiguration::new()
        // The picture is never used; make it as small as can be.
        .with_width(2)
        .with_height(2)
        .with_captures_audio(true)
        .with_sample_rate(SYSTEM_RATE as i32)
        .with_channel_count(1)
        // This app's own sounds (the notification chime) aren't part of a meeting.
        .with_excludes_current_process_audio(true);
    let mut stream = SCStream::new(&filter, &config).map_err(|e| e.to_string())?;
    stream.add_output_handler(Audio(on_audio), SCStreamOutputType::Audio).map_err(|e| e.to_string())?;
    stream.start_capture().map_err(|e| format!("System audio couldn't start: {e}"))?;
    Ok(stream)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(v: &[f32]) -> Vec<u8> {
        v.iter().flat_map(|f| f.to_le_bytes()).collect()
    }

    #[test]
    fn folds_planar_and_interleaved_buffers_to_mono() {
        let left = bytes(&[1.0, 0.0]);
        let right = bytes(&[0.0, 1.0]);
        let planar = mono_from([(1, &left[..]), (1, &right[..])].into_iter());
        assert_eq!(planar, vec![0.5, 0.5]);
        let inter = bytes(&[1.0, 0.0, 0.0, 1.0]);
        assert_eq!(mono_from([(2, &inter[..])].into_iter()), vec![0.5, 0.5]);
        assert!(mono_from(std::iter::empty()).is_empty());
    }
}
