//! Meeting summaries: a local LLM (Qwen3.5-4B through llama.cpp) reads the
//! transcript and writes a short Markdown summary shaped by the meeting's
//! type. Like the rest of `/meet`, nothing leaves the Mac.

#[cfg(test)]
mod tests {
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
