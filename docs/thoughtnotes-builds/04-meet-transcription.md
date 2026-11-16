# 04 — `/meet`: local meeting recording, transcription and speaker labels

## Why

Record a meeting straight into a note and get a transcript with who-said-what, **entirely on this Mac**. No audio or text leaves the device; the only network use is downloading the models once, after the user agrees to it.

## Decisions (made by the owner)

- Capture **microphone + system audio**, so calls in Zoom/Meet/Teams include the other people.
- Local models for both transcription and diarization (speaker labels).

## Builder's stack (the orchestrator's call; deviate only with a reason in your report)

- **Transcription:** `whisper-rs` (whisper.cpp) with the Metal feature on macOS. Models are whisper.cpp GGML files from Hugging Face `ggerganov/whisper.cpp`:
  - Fast: `ggml-base.en.bin` (~142 MB, English only)
  - Balanced: `ggml-small.bin` (~466 MB)
  - **Best (default):** `ggml-large-v3-turbo-q5_0.bin` (~574 MB)
  - Language: auto-detect, or a fixed language from Settings.
- **Diarization:** `sherpa-rs` (sherpa-onnx) offline speaker diarization: pyannote segmentation-3.0 ONNX + a 3D-Speaker / WeSpeaker embedding ONNX, from the k2-fsa sherpa-onnx model releases. Clustering threshold tunable; optional "number of speakers" hint.
- **Mic capture:** `cpal`. **System audio:** ScreenCaptureKit audio capture (macOS 13+; e.g. the `screencapturekit` crate, or a small Objective-C/Swift shim if the crate falls short), behind `#[cfg(target_os = "macos")]`.
- Pin exact crate versions, and verify SHA-256 for every downloaded model (hard-code the hashes).

## Flow

1. **`/meet`** in the slash menu (`src/lib/editor/slash.ts`, near `assignment`/`event`) inserts a **Meeting block** (a Tiptap node with a Svelte NodeView): a title (defaulting to "Meeting — <date time>"), a **Record** button, and the sources (Mic ✓, System audio ✓).
2. **First use:** if models are missing, a sheet explains the download (names, sizes, that it's one-time and everything then runs offline) and shows progress, with Cancel. Models live in the app's data directory under `models/`, resumable, and are verified by hash.
3. **Permissions:** the microphone prompt (`NSMicrophoneUsageDescription` in Info.plist, the `com.apple.security.device.audio-input` entitlement) and Screen Recording for system audio. If Screen Recording is denied, fall back to mic-only with a clear notice and a button that opens the right System Settings pane.
4. **Recording:** a timer, two live level meters (Mic, System), Pause/Resume, Stop. The mic and system streams are written to **separate** 16 kHz mono WAV files in a temp folder. Recording must survive the note being closed or switching pages: the recorder lives in Rust, and the block reattaches to it. Only one recording at a time. A small red dot in the title bar while recording; ⌘Q asks to stop first.
5. **Processing** (background thread, progress events to the block: "Transcribing 42%", "Identifying speakers"):
   - Mix both tracks → transcribe **once** with whisper (segment + word timestamps).
   - Diarize the **system** track → Speaker 1, 2, …
   - Attribute each transcript segment: if mic energy clearly dominates system energy during it → **"Me"**; otherwise the overlapping diarized speaker. (This keeps the user's own voice labelled without diarizing them, and handles speaker bleed better than diarizing the mix.)
   - Mic-only recordings (in person, or no permission): diarize the mic track and label Speaker 1, 2, … (no "Me").
   - Merge consecutive segments by the same speaker into one turn.
6. **Result** in the block:
   - An audio player for the mixed recording, saved as a **library file** attached to the page (existing library APIs), so it shows in Files/Resources and is exported with the page.
   - The **transcript**: turns as `Speaker · 00:12 · text`. Clicking a timestamp seeks the player. **Speaker chips** at the top: click to rename ("Speaker 2" → "Dana") and every turn updates.
   - Actions: Copy transcript (plain text), Re-run speaker detection (with a number-of-speakers hint), Delete recording.
   - Storage: segments as JSON in the node's attributes; `renderHTML` must also output the transcript as plain text so **search, Markdown/DOCX/PDF export** include it. Check search indexing picks it up.
7. Temp WAVs are deleted after a successful run. If processing fails, keep them and offer Retry.

## Settings (a "Meetings" pane)

Model choice (Fast / Balanced / Best, with sizes and what's downloaded), language (Auto or a list), default sources, "Delete downloaded models" (shows disk use), and a line that everything runs locally.

## Constraints

- **No database migration needed** (audio = library file, transcript = page content, settings = existing settings store). If you find you truly need one, it's **v15** (see conventions).
- Windows must still compile: mic-only via cpal; system audio and Metal are macOS-only (`cfg`). Hiding `/meet` on Windows is acceptable if whisper/sherpa won't build there; say which you chose.
- Keep the app's light footprint: models load only while processing and are dropped afterwards; nothing is loaded at startup.
- **The release bundle must work, not just `npm run app`.** Any dylibs (onnxruntime, etc.) must be bundled and found at runtime inside `ThoughtNotes.app` (Tauri `bundle.macOS.frameworks` or static linking). Prove it: `npm run bundle`, launch the built `.app` from Finder, record 20 seconds with `say` playing through the speakers, and get a transcript.
- Long meetings: a 90-minute recording must process without loading all audio into memory more than once, and without blocking the UI.

## Done when

- The checks in `00-conventions.md` pass.
- Rust tests: WAV writing/mixing, the energy-based "Me" attribution (synthetic tensor fixtures), turn merging, model hash verification, and an end-to-end test over a short fixture WAV (generated with `say` and committed, under 1 MB) that's `#[ignore]` by default if models are absent, and that you ran yourself with models present.
- Playwright (browser stand-in, with the Rust side mocked in `dev-mock.ts`): `/meet` inserts the block; the record → stop → processing → transcript states render; renaming a speaker updates all turns; timestamps seek.
- Your report includes the measured time to process the fixture with each model on this Mac.

## Not in scope

Live captions while recording, AI summaries or action items, calendar auto-start, iOS.
