//! Speech to text with whisper.cpp (Metal on Apple silicon). The model is
//! loaded for one run and dropped when it ends.

use super::attribute::{Seg, Word};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub struct Transcript {
    pub segs: Vec<Seg>,
    /// The language whisper settled on ("en"), for the record.
    pub language: String,
}

/// Transcribes `audio` (16 kHz mono floats). `language` is a code like "en",
/// or None to let the model decide. `progress` gets 0–100.
pub fn run(
    model: &Path,
    audio: &[f32],
    language: Option<&str>,
    progress: impl FnMut(i32) + 'static,
    cancel: Arc<AtomicBool>,
) -> Result<Transcript, String> {
    let mut cparams = WhisperContextParameters::default();
    cparams.use_gpu(true);
    let ctx = WhisperContext::new_with_params(model, cparams).map_err(|e| format!("Couldn't load the speech model: {e}"))?;
    let mut state = ctx.create_state().map_err(|e| format!("Couldn't start the speech model: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(threads());
    // English-only models are told so; the others detect it unless one was chosen.
    let is_english_only = model.file_name().is_some_and(|n| n.to_string_lossy().contains(".en."));
    params.set_language(match (is_english_only, language) {
        (true, _) => Some("en"),
        (false, Some(l)) => Some(l),
        (false, None) => Some("auto"),
    });
    params.set_translate(false);
    params.set_token_timestamps(true);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_suppress_blank(true);
    params.set_suppress_nst(true);
    // A long meeting is many minutes of context a wrong word can echo through
    // (the "stuck repeating" failure); each window stands on its own.
    params.set_no_context(true);
    params.set_progress_callback_safe(progress);
    let c = cancel.clone();
    params.set_abort_callback_safe(move || c.load(Ordering::Relaxed));

    state.full(params, audio).map_err(|e| {
        if cancel.load(Ordering::Relaxed) {
            "cancelled".to_string()
        } else {
            format!("Transcription failed: {e}")
        }
    })?;
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }

    let eot = ctx.token_eot();
    let mut segs = Vec::new();
    for seg in state.as_iter() {
        let text = seg.to_str_lossy().map_err(|e| e.to_string())?.to_string();
        if is_noise(&text) || seg.no_speech_probability() > 0.85 {
            continue;
        }
        let mut words: Vec<Word> = Vec::new();
        for i in 0..seg.n_tokens() {
            let Some(tok) = seg.get_token(i) else { continue };
            let data = tok.token_data();
            if data.id >= eot {
                continue; // timestamps and other markers
            }
            let piece = tok.to_str_lossy().map_err(|e| e.to_string())?.to_string();
            let (t0, t1) = (data.t0.max(0) as f32 / 100.0, data.t1.max(0) as f32 / 100.0);
            // A new word starts with a space; anything else continues the last.
            match words.last_mut() {
                Some(w) if !piece.starts_with(' ') => {
                    w.text.push_str(&piece);
                    w.end = t1.max(w.end);
                }
                _ => words.push(Word { text: piece, start: t0, end: t1.max(t0) }),
            }
        }
        // Timings are in hundredths of a second from the start of the audio.
        let (start, end) = (seg.start_timestamp() as f32 / 100.0, seg.end_timestamp() as f32 / 100.0);
        // Keep each word inside its segment: token times can wander.
        for w in &mut words {
            w.start = w.start.clamp(start, end);
            w.end = w.end.clamp(w.start, end);
        }
        segs.push(Seg { start, end, text, words });
    }
    let language = whisper_rs::get_lang_str(state.full_lang_id_from_state()).unwrap_or("en").to_string();
    Ok(Transcript { segs, language })
}

/// Cores worth using: the performance cores, not the whole chip, so the Mac
/// stays usable while it works.
fn threads() -> i32 {
    let n = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    (n.saturating_sub(2)).clamp(2, 8) as i32
}

/// Whisper's stand-ins for silence and sound: "[BLANK_AUDIO]", "(music)", "♪".
pub fn is_noise(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return true;
    }
    let bracketed = (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')')) || (t.starts_with('*') && t.ends_with('*'));
    bracketed || t.chars().all(|c| matches!(c, '♪' | '♫' | ' ' | '.' | '-'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spots_whispers_stand_ins_for_silence() {
        for n in ["[BLANK_AUDIO]", " (soft music) ", "♪♪", "*sigh*", "", " ... "] {
            assert!(is_noise(n), "{n:?}");
        }
        for s in [" Hello there.", "[1] is the first item", "Yes (maybe)."] {
            assert!(!is_noise(s), "{s:?}");
        }
    }
}
