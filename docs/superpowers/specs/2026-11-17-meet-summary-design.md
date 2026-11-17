# Meeting summaries for `/meet` — design

Date: 2026-11-17 · Branch: `feature/meet-summary` (from `main` @ 53400bf)

## Intent

A `/meet` block today records a meeting and shows a speaker-labelled
transcript. People rarely reread a transcript; they want what was decided and
who owes what. Modelled on Notion's meeting notes, a finished meeting gets two
tabs, **Summary | Transcript**, and a per-meeting **meeting type** that tells
the summarizer what kind of summary to write. Everything stays on the Mac, like
the rest of `/meet`.

## Goals

- Summary and Transcript tabs on a finished meeting block.
- Meeting types: built-in **General** (default), **1:1**, **Team meeting**,
  **Sales call**, plus custom types with the user's own instructions. Built-in
  instructions can be edited and reset.
- Summaries are written by a local LLM, stored with the meeting, and can be
  regenerated after changing the type or its instructions.
- Summaries take part in search, copy, and Markdown/Word export like the
  transcript does.

## Non-goals

- An API-key / cloud summarizer (possible later as an opt-in alternative).
- Apple Foundation Models.
- Hand-editing the summary in place (regenerate replaces it; the user can copy
  it into the page).
- Live summaries while recording.
- Anything in the automations work (`feature/automations`).

## Anti-goals (a failure even if it "works")

- Any network traffic other than the summary-model download the user starts.
- The transcript leaving the Mac.
- A summary that invents decisions, owners or names not in the transcript.
- Freezing the editor while the model runs, or crashing whisper (see the
  linking finding below).

## Constraints

- macOS only (like all of `/meet`); minimum macOS 13. Other platforms keep
  hiding `/meet`.
- No schema migration: a meeting's data lives in its editor node's attributes,
  so the summary does too. (Nothing here touches `db.rs`; v15 is untouched.)
- House rules: generic example data in tests ("Alice", "Project"); every new
  message in `src/locales/en/*.json` with an `@note`; plurals as `one`/`other`;
  no telemetry.

## Approaches considered (decided: A)

| | Approach | Trade-off |
|---|---|---|
| **A** ✅ | Local LLM via llama.cpp (`llama-cpp-2`), downloaded like the speech models | Offline, macOS 13+, long context; ~2.7 GB download and a native-linking risk (resolved, below) |
| B | Apple Foundation Models | No download, but macOS 26+ with Apple Intelligence only, ~4k context forces chunking, needs a Swift bridge |
| C | User-supplied API key | Best quality, but the transcript leaves the Mac |

The user picked **A**.

### Spike result: how llama.cpp must be linked

whisper-rs and llama-cpp-2 each vendor their own **ggml**. Linked statically
into one binary, the linker silently kept one copy; llama.cpp then called
whisper's older `ggml_flash_attn_ext*` and aborted
(`GGML_ASSERT(a->op == GGML_OP_FLASH_ATTN_EXT)`). This would also have put
whisper at risk.

With llama-cpp-2's **`dynamic-link`** feature, llama.cpp and its ggml build as
dylibs (`libllama`, `libllama-common`, `libggml`, `libggml-base`,
`libggml-cpu`, `libggml-metal`; ~15 MB). Verified in a throwaway binary on the
real models:

- the executable imports **no** `ggml_*` symbols from the dylibs (whisper keeps
  its own static ggml); the dylibs are two-level-namespace, so llama binds only
  to its own ggml;
- whisper transcribes `meet/fixtures/mic.wav` correctly **before and after**
  llama runs in the same process;
- Qwen3.5-4B produced a clean Overview / Decisions / Action items summary of a
  3-turn transcript in ~4 s on an M4 (Metal, all layers on GPU).

So: `llama-cpp-2 = { version = "=0.1.161", default-features = false, features = ["metal", "dynamic-link"] }`
under `[target.'cfg(target_os = "macos")'.dependencies]`, pinned like the
other `/meet` crates.

## The model

- **Qwen3.5-4B, Q4_K_M GGUF** from `unsloth/Qwen3.5-4B-GGUF`:
  `https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf`,
  2 740 937 888 bytes, SHA-256
  `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`
  (Hugging Face's LFS hash; a local copy hashed identically). Apache-2.0.
- It joins the catalogue in `meet/models.rs` as `SUMMARY` (id `summary`), with
  the same resumable, hash-checked download. `HOSTS` gains
  `https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/`.
- It is **optional**: recording and transcribing never require it.
- Thinking is turned off by pre-filling an empty `<think>\n\n</think>\n\n`
  after the chat template's assistant prefix (as in the spike).

## Meeting types

- **Where they live:** the list of types (built-in and custom) is edited in
  **Settings › Meetings › Meeting types** and stored on this Mac next to the
  other meeting settings (localStorage, `thoughtnotes.meet.types.v1`).
- **Per meeting:** each meeting block stores the chosen `typeId` and, with its
  summary, a **copy** of the type's name and the instructions used. A page
  synced to another Mac (or a type later deleted) still shows which type wrote
  the summary, and Regenerate there uses that Mac's version of the type if it
  exists, else the stored copy.
- **Built-ins** (names and default instructions are i18n messages, each with
  an `@note` saying the text is sent to the local summarizing model):
  - **General** — Overview; Decisions; Action items (owner when named);
    Notes by speaker.
  - **1:1** — Overview; Feedback; Blockers & support needed; Follow-ups
    (owner when named).
  - **Team meeting** — Overview; Updates by person; Decisions; Action items;
    Open questions.
  - **Sales call** — Overview; Customer needs & pain points; Objections;
    Pricing / timeline mentioned; Next steps.
- Built-in instructions can be edited; an edited built-in shows **Reset to
  default**. Built-ins can't be deleted or renamed. Custom types have a name
  and instructions and can be added, edited and deleted.

## What a summary is

- Markdown in a narrow, known format: `##` headings, `-` bullets, `**bold**`
  for owners/names, plain paragraphs. The prompt asks for exactly that; the
  renderer treats anything else as plain text.
- Stored on the meeting node as:

  ```ts
  summary: {
    md: string;            // the summary
    typeId: string;        // which type wrote it
    typeName: string;      // its name at the time
    instructions: string;  // the instructions used
    at: number;            // when (ms since epoch)
    model: string;         // e.g. "qwen3.5-4b-q4_k_m"
  } | null
  typeId: string           // the type chosen for the next summary (default "general")
  ```

  `readAttrs` validates both (documents come from sync, paste, older versions).

## The prompt (Rust, `meet/summarize.rs`)

- **System:** fixed base rules (write only from the transcript; never invent
  names, numbers or commitments; use the speaker names as given; write in the
  transcript's language; Markdown with `##` headings and `-` bullets only; omit
  a section that has nothing) followed by the type's instructions.
- **User:** the meeting title, then the transcript as `Name (m:ss): text`
  lines, using the names the user gave speakers.
- Built with the model's own chat template (`LlamaModel::chat_template(None)`
  + `apply_chat_template`). Pure functions for building it, so it's unit-tested
  without the model.
- **Length:** context 32k tokens. An hour of talk is roughly 10–14k tokens, so
  most meetings fit in one pass. If the prompt won't fit with room for a
  ~1.5k-token answer, the transcript is split on turn boundaries into chunks,
  each chunk is condensed to notes, and the notes are summarized with the same
  type instructions.
- Sampling: temperature ~0.3, fixed seed, cap ~1500 new tokens.

## Running it

- New commands (macOS; `unsupported.rs` gets stubs):
  - `meeting_summarize { block, title, lines, instructions } -> String`, which
    streams progress events `td-meeting-summary { block, text, pct }` (partial
    text as it's written) and returns the final Markdown;
  - `meeting_summary_cancel { block }`.
- One summary at a time. The model is loaded for the run and dropped after, so
  ~3 GB isn't held while idle. A summary doesn't start while a recording is
  being processed (it waits, and the block says so).
- Runs off the main thread (like processing); errors come back as strings.

## Bundling

- The six dylibs are copied into `ThoughtNotes.app/Contents/Frameworks` via
  `bundle.macOS.frameworks` in `tauri.macos.conf.json`, and the app binary gets
  an rpath of `@executable_path/../Frameworks` (via `build.rs`). For
  `cargo test` / `tauri dev`, `build.rs` also adds an rpath to the directory
  where llama-cpp-sys-2 writes the dylibs. The spike needed exactly this
  (without an rpath it fails with `Library not loaded: @rpath/libggml-base.0.dylib`).
- Ad-hoc signing (`signingIdentity: "-"`) signs nested frameworks too; check
  the built `.app` launches.

## Interface

**Meeting block, finished state:**

```
┌ 👥  Weekly sync — Nov 17                                     ┐
│ [▶ audio player ─────────────────────────────]               │
│  Summary | Transcript                                        │
│ ─────────                                                    │
│  Type [Team meeting ▾]          ⟳ Regenerate   ⧉ Copy        │
│  ## Overview                                                 │
│  …                                                           │
│  ## Action items                                             │
│  - **Alice**: send the budget by Friday                      │
│  Written as Team meeting · Nov 17, 3:05 PM                   │
└──────────────────────────────────────────────────────────────┘
```

- Tabs are a proper `tablist`; the selected tab is remembered per block for the
  session. It opens on **Summary** when there is one, else **Transcript**.
- Summary tab states: *no model* (explains the optional ~2.7 GB download, with
  a **Download summary model** button opening the existing download sheet in a
  summary mode); *no summary yet* (**Summarize**); *writing* (text appears as
  it's written, **Cancel**); *waiting* (a recording is being processed);
  *failed* (reason + **Try again**); *done* (summary, footer with type and
  time).
- The **Type** menu lists built-ins then custom types, and ends with **Edit
  types…** (opens Settings › Meetings). If the chosen type or its instructions
  differ from what wrote the summary, a hint says so next to **Regenerate**.
- When a transcript arrives and the summary model is on disk, a summary is
  written automatically with the meeting's type (General by default). This
  happens only in the block's `apply()` step (the Mac that recorded it, at the
  moment the result is taken), never when a synced or pasted page opens.
- A second Summarize while one is running elsewhere queues; its block shows
  *waiting* until its turn.
- The audio player, speaker chips, transcript, Copy, Re-run speakers and
  Delete stay as they are, under the Transcript tab (the player sits above the
  tabs). Delete recording also clears the summary.
- The summary is rendered from the Markdown subset with Svelte elements (no
  `{@html}`), via a small parser in `src/lib/meeting-summary.ts`.

**Settings › Meetings:**

- A **Summary model** row: size, Download / Delete, progress (reusing the
  download plumbing).
- **Meeting types**: a list; selecting one shows its name (custom only) and an
  instructions textarea; **Add type**, **Delete** (custom), **Reset to
  default** (edited built-in).

## Text, search and export

`meetingText` (search, copy-as-text, exports) becomes: title, then the summary
(if any), then the transcript. `renderHTML` writes the summary as plain
paragraphs before the transcript, so copying the block into another app keeps
it. Markdown and Word exports (`markdown.ts`, `docx.ts`) put a "Summary"
section before the transcript.

## Browser mock and tests

- `src/dev-mock-meet.ts`: `meeting_summarize` streams a canned Markdown summary
  that names the type and echoes its instructions' first line; model presence
  for `summary`; steer flags `summaryModelMissing` and `failSummary`.
- **Rust:** prompt building (system/user content, names, chunking on turn
  boundaries, the fit check), catalogue consistency for the new model, the
  host check; an `#[ignore]` test that runs the real model when it's on disk.
- **Vitest:** `readAttrs` with/without/bad summary; the types store (defaults,
  edit, reset, add/delete custom, fallback when a meeting's type is gone);
  the Markdown-subset parser; `meetingText` including the summary.
- **Playwright** (browser mock): tabs switch; Summarize writes a summary;
  changing type shows the stale hint and Regenerate replaces it; a custom type
  added in Settings appears in the menu and is used; summary-model-missing
  path; a failed summary can be retried; Delete recording clears it; the
  summary is searchable and exported.

## Left to the builder

- Exact wording of messages and built-in instructions (within the outlines
  above).
- Chunk size and the condense prompt for very long meetings.
- How the download sheet distinguishes speech vs summary model (a prop or a
  second sheet).
- Whether "Delete models" in Settings also removes the summary model (proposed:
  separate Delete on the Summary model row; the existing one leaves it).
