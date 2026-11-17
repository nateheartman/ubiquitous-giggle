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

/// Splits the transcript into pieces of at most `max_chars` (counting the line
/// breaks between lines), never cutting a line; a longer line is a piece alone.
pub fn chunk_lines(lines: &[String], max_chars: usize) -> Vec<Vec<String>> {
    let mut out: Vec<Vec<String>> = Vec::new();
    let mut size = 0;
    for line in lines {
        let grow = line.len() + 1;
        match out.last_mut() {
            Some(cur) if !cur.is_empty() && size + grow <= max_chars + 1 => {
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

/// Tokens the prompt may take, leaving room for the answer and the template.
pub fn prompt_budget() -> usize {
    N_CTX as usize - MAX_NEW as usize - 512
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
        let chunks = chunk_lines(&ls, 25);
        assert_eq!(chunks.iter().map(Vec::len).collect::<Vec<_>>(), [2, 2, 1]);
        assert_eq!(chunks.concat(), ls);
    }

    #[test]
    fn an_overlong_line_is_its_own_chunk() {
        let ls = vec!["a".to_string(), "b".repeat(50), "c".to_string()];
        assert_eq!(chunk_lines(&ls, 10), vec![vec!["a".to_string()], vec!["b".repeat(50)], vec!["c".to_string()]]);
    }

    #[test]
    fn the_budget_leaves_room_for_the_answer() {
        assert_eq!(prompt_budget(), N_CTX as usize - MAX_NEW as usize - 512);
    }
    #[test]
    fn llama_backend_loads_beside_whisper() {
        let _b = llama_cpp_2::llama_backend::LlamaBackend::init().unwrap();
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
