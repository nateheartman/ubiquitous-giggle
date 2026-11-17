//! Meeting summaries: a local LLM (Qwen3.5-4B through llama.cpp) reads the
//! transcript and writes a short Markdown summary shaped by the meeting's
//! type. Like the rest of `/meet`, nothing leaves the Mac.

/// Tokens the model reads and writes at once.
pub const N_CTX: u32 = 32_768;
/// The longest summary it may write.
pub const MAX_NEW: u32 = 1_500;

/// What every summary follows, whatever the meeting type asks for.
pub const BASE_RULES: &str = "You write the summary of a meeting from its transcript.
- Use only what the transcript says. Never invent names, numbers, dates, decisions or commitments.
- Call people by the speaker names as they appear in the transcript.
- Write in the same language as the transcript.
- Write Markdown using only `## ` headings, `- ` bullets, **bold** for people's names, and short paragraphs.
- Leave out any section that would be empty.
- Be brief: a few bullets per section.";

/// What each part of a long meeting is condensed to before the summary is written.
pub const CONDENSE: &str = "Write terse notes of this part of a meeting: who said what that matters, decisions, and commitments with their owners. Notes only, as `- ` bullets.";

pub fn system_prompt(instructions: &str) -> String {
    let own = instructions.trim();
    if own.is_empty() {
        BASE_RULES.to_string()
    } else {
        format!("{BASE_RULES}\n\n{own}")
    }
}

pub fn user_prompt(title: &str, lines: &[String]) -> String {
    let title = title.trim();
    let head = if title.is_empty() { String::new() } else { format!("Meeting: {title}\n\n") };
    format!("{head}Transcript:\n{}", lines.join("\n"))
}

/// Splits the transcript into pieces of at most `max` (as `measure` counts a
/// line, plus one for each line break), never cutting a line; a longer line
/// is a piece alone. The model counts in tokens, so it measures in tokens.
pub fn chunk_lines(lines: &[String], max: usize, measure: impl Fn(&str) -> usize) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut size = 0;
    for line in lines {
        let grow = measure(line) + 1;
        match out.last_mut() {
            Some(cur) if !cur.is_empty() && size + grow <= max + 1 => {
                cur.push(line.clone());
                size += grow;
            }
            _ => {
                out.push(vec![line.clone()]);
                size = grow;
            }
        }
    }
    out
}

/// The context for a prompt of `prompt_tokens`: room for it and the answer,
/// no more (the model's memory grows with it).
pub fn context_size(prompt_tokens: usize) -> u32 {
    (prompt_tokens as u32).saturating_add(MAX_NEW + 64).min(N_CTX)
}

/// Tokens the prompt may take, leaving room for the answer and the template.
pub fn prompt_budget() -> usize {
    N_CTX as usize - MAX_NEW as usize - 512
}

// ---- running the model

use llama_cpp_2::context::params::LlamaContextParams;
use llama_cpp_2::llama_backend::LlamaBackend;
use llama_cpp_2::llama_batch::LlamaBatch;
use llama_cpp_2::model::params::LlamaModelParams;
use llama_cpp_2::model::{LlamaChatMessage, LlamaModel};
use llama_cpp_2::sampling::LlamaSampler;
use std::num::NonZeroU32;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

/// Qwen3.5 thinks aloud before answering unless its thinking block is
/// given to it already closed.
const THINK_OFF: &str = "<think>\n\n</think>\n\n";
/// Prompt tokens sent to the model per step.
const STEP: usize = 512;

/// llama.cpp's backend can be started once per process.
fn backend() -> Result<&'static LlamaBackend, String> {
    static BACKEND: OnceLock<LlamaBackend> = OnceLock::new();
    static STARTING: Mutex<()> = Mutex::new(());
    let _one = STARTING.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(b) = BACKEND.get() {
        return Ok(b);
    }
    let mut b = LlamaBackend::init().map_err(|e| format!("Couldn't start the summary model: {e}"))?;
    b.void_logs();
    Ok(BACKEND.get_or_init(|| b))
}

fn prompt_text(model: &LlamaModel, system: &str, user: &str) -> Result<String, String> {
    let tmpl = model.chat_template(None).map_err(|e| format!("The summary model has no chat format: {e}"))?;
    let msg = |role: &str, text: &str| LlamaChatMessage::new(role.into(), text.into()).map_err(|e| e.to_string());
    let mut p = model.apply_chat_template(&tmpl, &[msg("system", system)?, msg("user", user)?], true).map_err(|e| e.to_string())?;
    p.push_str(THINK_OFF);
    Ok(p)
}

/// One answer from the model. `on_text` gets the answer so far and how many
/// tokens it has.
fn generate(backend: &LlamaBackend, model: &LlamaModel, prompt: &str, cancel: &AtomicBool, on_text: &mut dyn FnMut(&str, u32)) -> Result<String, String> {
    let vocab = model.vocab();
    let tokens = vocab.tokenize(prompt.as_bytes(), false, true);
    if tokens.is_empty() {
        return Ok(String::new());
    }
    let params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(context_size(tokens.len()))).with_n_batch(STEP as u32);
    let mut ctx = model.new_context(backend, params).map_err(|e| format!("Couldn't start the summary model: {e}"))?;
    let mut batch = LlamaBatch::new(STEP, 1);
    let last = tokens.len() - 1;
    for (n, piece) in tokens.chunks(STEP).enumerate() {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        batch.clear();
        for (i, t) in piece.iter().enumerate() {
            let pos = n * STEP + i;
            batch.add(*t, pos as i32, &[0], pos == last).map_err(|e| e.to_string())?;
        }
        ctx.decode(&mut batch).map_err(|e| format!("The summary model stopped: {e}"))?;
    }
    let mut sampler = LlamaSampler::chain_simple([LlamaSampler::temp(0.3), LlamaSampler::dist(1)]);
    let mut pos = tokens.len() as i32;
    let mut bytes = Vec::new();
    for made in 1..=MAX_NEW {
        if cancel.load(Ordering::SeqCst) {
            return Err("cancelled".into());
        }
        let tok = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(tok);
        if vocab.is_eog(tok) {
            break;
        }
        bytes.extend(vocab.token_to_piece(tok, false, None));
        // Only whole characters go out while a multi-byte one is half-written.
        let shown = match std::str::from_utf8(&bytes) {
            Ok(s) => s,
            Err(e) => std::str::from_utf8(&bytes[..e.valid_up_to()]).unwrap_or(""),
        };
        on_text(shown, made);
        batch.clear();
        batch.add(tok, pos, &[0], true).map_err(|e| e.to_string())?;
        pos += 1;
        ctx.decode(&mut batch).map_err(|e| format!("The summary model stopped: {e}"))?;
    }
    Ok(String::from_utf8_lossy(&bytes).trim().to_string())
}

/// Writes the summary of a meeting. A meeting too long for the model is read
/// in pieces, each condensed to notes, and the summary is written from those.
/// `on_text` gets the summary so far (empty while pieces are being read) and
/// a percentage.
pub fn run(model_path: &Path, title: &str, lines: &[String], instructions: &str, cancel: &AtomicBool, on_text: &mut dyn FnMut(&str, u8)) -> Result<String, String> {
    let backend = backend()?;
    let params = LlamaModelParams::default().with_n_gpu_layers(999);
    let model = LlamaModel::load_from_file(backend, model_path, &params).map_err(|e| format!("Couldn't load the summary model: {e}"))?;
    let system = system_prompt(instructions);
    let tokens = |text: &str| model.vocab().tokenize(text.as_bytes(), false, true).len();
    let pct = |from: f32, span: f32, made: u32| (from + span * (made as f32 / MAX_NEW as f32).min(1.0)).min(99.0) as u8;
    let mut lines = lines.to_vec();
    // A long meeting is condensed piece by piece (0–80%), as often as it takes to fit.
    let mut from = 0.0;
    for _round in 0..3 {
        let prompt = prompt_text(&model, &system, &user_prompt(title, &lines))?;
        if tokens(&prompt) <= prompt_budget() {
            return generate(backend, &model, &prompt, cancel, &mut |text, made| on_text(text, pct(from, 100.0 - from, made)));
        }
        // Each piece leaves room for the condensing instructions and the title.
        let pieces = chunk_lines(&lines, prompt_budget() - tokens(CONDENSE) - tokens(title) - 256, |l| tokens(l));
        if pieces.len() < 2 && lines.len() < 2 {
            return Err("This meeting is too long to summarize.".into());
        }
        let share = (80.0 - from) / 2.0 / pieces.len() as f32;
        let mut notes = Vec::new();
        for (i, piece) in pieces.iter().enumerate() {
            let prompt = prompt_text(&model, &system_prompt(CONDENSE), &user_prompt(title, piece))?;
            let at = from + share * i as f32;
            notes.push(generate(backend, &model, &prompt, cancel, &mut |_, made| on_text("", pct(at, share, made)))?);
        }
        from += share * pieces.len() as f32;
        lines = notes;
    }
    Err("This meeting is too long to summarize.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(n: usize, len: usize) -> Vec<String> {
        (0..n).map(|i| format!("{i}{}", "x".repeat(len - 1))).collect()
    }

    #[test]
    fn system_prompt_appends_type_instructions() {
        let p = system_prompt("  Focus on feedback.  ");
        assert!(p.starts_with(BASE_RULES));
        assert!(p.ends_with("\n\nFocus on feedback."));
        assert_eq!(system_prompt("   "), BASE_RULES);
    }

    #[test]
    fn user_prompt_has_title_and_lines() {
        let p = user_prompt("Project sync", &["Alice (0:05): Hello".into(), "Bob (0:09): Hi".into()]);
        assert!(p.starts_with("Meeting: Project sync\n\nTranscript:\n"));
        assert!(p.ends_with("Alice (0:05): Hello\nBob (0:09): Hi"));
        assert!(!user_prompt("  ", &["Alice (0:05): Hello".into()]).contains("Meeting:"));
    }

    #[test]
    fn chunks_keep_lines_whole_and_in_order() {
        let ls = lines(5, 10);
        let chunks = chunk_lines(&ls, 25, |l| l.len());
        assert_eq!(chunks.iter().map(Vec::len).collect::<Vec<_>>(), [2, 2, 1]);
        assert_eq!(chunks.concat(), ls);
    }

    #[test]
    fn an_overlong_line_is_its_own_chunk() {
        let ls = vec!["a".to_string(), "b".repeat(50), "c".to_string()];
        assert_eq!(chunk_lines(&ls, 10, |l| l.len()), vec![vec!["a".to_string()], vec!["b".repeat(50)], vec!["c".to_string()]]);
    }

    #[test]
    fn chunks_by_the_measure_given() {
        // Text where every character is a token (as in Chinese or Japanese) fills a piece sooner.
        let ls = vec!["会議の予定".to_string(); 4];
        let by_char = |l: &str| l.chars().count();
        assert_eq!(chunk_lines(&ls, 12, by_char).len(), 2);
        assert_eq!(chunk_lines(&ls, 12, |l| l.len() / 6).len(), 1, "fewer tokens per line: one piece");
    }

    #[test]
    fn the_context_fits_the_prompt() {
        assert_eq!(context_size(100), 100 + MAX_NEW + 64);
        assert_eq!(context_size(40_000), N_CTX);
    }

    #[test]
    fn the_budget_leaves_room_for_the_answer() {
        assert_eq!(prompt_budget(), N_CTX as usize - MAX_NEW as usize - 512);
    }
    /// The real model over a three-line meeting, then whisper again in the same
    /// process (llama's ggml must not disturb whisper's). Runs on request:
    /// THOUGHTNOTES_MEET_DIR=<folder with models/> cargo test writes_a_summary -- --ignored --nocapture
    #[test]
    #[ignore = "needs the downloaded models"]
    fn writes_a_summary_with_the_real_model() {
        let root = std::env::var_os("THOUGHTNOTES_MEET_DIR").map(std::path::PathBuf::from).expect("set THOUGHTNOTES_MEET_DIR to a folder with models/");
        let mdir = root.join("models");
        let lines: Vec<String> = [
            "Alice (0:00): We will review the Project schedule today.",
            "Bob (0:04): I think the launch date is realistic.",
            "Alice (0:08): Good. Bob will send the budget by Friday.",
        ]
        .map(String::from)
        .to_vec();
        let mut calls = 0;
        let cancel = std::sync::atomic::AtomicBool::new(false);
        let md = run(&crate::meet::models::path_of(&mdir, &crate::meet::models::SUMMARY), "Project sync", &lines, "Overview, decisions, action items.", &cancel, &mut |_, _| calls += 1).unwrap();
        println!("{md}");
        assert!(md.contains("## "), "has headings: {md}");
        assert!(md.contains("Bob"), "names the owner: {md}");
        assert!(calls > 1, "text streamed as it was written");

        let whisper = crate::meet::models::WHISPER.iter().find(|m| crate::meet::models::is_present(&mdir, m)).expect("a speech model");
        let wav = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/meet/fixtures/mic.wav");
        let audio = crate::meet::wav::WavReader::open(&wav).and_then(|r| r.read_all()).unwrap();
        let t = crate::meet::transcribe::run(&crate::meet::models::path_of(&mdir, whisper), &audio, Some("en"), |_| {}, std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false))).unwrap();
        let text: String = t.segs.iter().map(|s| s.text.as_str()).collect();
        assert!(text.contains("launch date"), "whisper still transcribes after llama ran: {text}");
    }

    #[test]
    fn llama_backend_loads_beside_whisper() {
        backend().unwrap();
        backend().unwrap(); // and again: started once, shared after
    }

    /// `cargo test` finds the llama dylibs on its own (it sets the loader's
    /// fallback path), so this checks what the bundled app relies on: the
    /// binary looks in `Contents/Frameworks`.
    #[test]
    fn binaries_look_for_the_dylibs_in_frameworks() {
        let exe = std::env::current_exe().unwrap();
        let out = std::process::Command::new("otool").arg("-l").arg(&exe).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(text.contains("@executable_path/../Frameworks"), "no Frameworks rpath in {}", exe.display());
    }
}
