//! Who spoke when, with sherpa-onnx: a segmentation model finds stretches of
//! one voice, an embedding model describes each, and clustering groups the
//! stretches into speakers. Loaded for one run, dropped after.

use super::attribute::Span;
use sherpa_rs::diarize::{Diarize, DiarizeConfig};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// How alike two stretches must be to count as one speaker. Lower means more
/// speakers are found. The three settings are the Meetings pane's choices.
pub fn threshold_for(sensitivity: &str) -> f32 {
    match sensitivity {
        "fewer" => 0.62,
        "more" => 0.42,
        _ => 0.5,
    }
}

/// Finds the speakers in `samples` (16 kHz mono). `speakers` is how many
/// people there are, when the user knows; otherwise the threshold decides.
/// `progress` gets 0–100.
pub fn run(
    segmentation: &Path,
    embedding: &Path,
    samples: Vec<f32>,
    speakers: Option<u32>,
    threshold: f32,
    progress: impl Fn(i32) + Send + 'static,
    cancel: Arc<AtomicBool>,
) -> Result<Vec<Span>, String> {
    let config = DiarizeConfig {
        // sherpa-onnx clusters by threshold when the count is not above zero.
        num_clusters: Some(speakers.map_or(-1, |n| n.clamp(1, 20) as i32)),
        threshold: Some(threshold),
        // Ignore blips shorter than a breath, and bridge pauses within a sentence.
        min_duration_on: Some(0.3),
        min_duration_off: Some(0.5),
        provider: Some("cpu".into()),
        debug: false,
    };
    let mut sd = Diarize::new(segmentation, embedding, config).map_err(|e| format!("Couldn't load the speaker models: {e}"))?;
    let c = cancel.clone();
    let spans = sd.compute(
        samples,
        Some(Box::new(move |done, total| {
            if total > 0 {
                progress((done as i64 * 100 / total as i64) as i32);
            }
            // Anything but 0 asks the library to stop.
            i32::from(c.load(Ordering::Relaxed))
        })),
    );
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    match spans {
        Ok(v) => Ok(v.into_iter().map(|s| Span { start: s.start, end: s.end, speaker: s.speaker }).collect()),
        // Silence gives no stretches at all: nobody spoke, which isn't a failure.
        Err(e) if e.to_string().contains("No segments") => Ok(Vec::new()),
        Err(e) => Err(format!("Speaker detection failed: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitivity_maps_to_thresholds() {
        assert!(threshold_for("fewer") > threshold_for("balanced"));
        assert!(threshold_for("more") < threshold_for("balanced"));
        assert_eq!(threshold_for("anything else"), threshold_for("balanced"));
    }
}
