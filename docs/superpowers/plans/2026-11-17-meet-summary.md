# Meeting summaries for `/meet` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Summary | Transcript tabs on a finished `/meet` block, with per-meeting types (built-in + custom) that steer a local Qwen3.5-4B summary, stored in the block and regenerable.

**Architecture:** Rust gains `meet/summarize.rs` (pure prompt building + a llama.cpp runner) and two commands; llama.cpp ships as dylibs (`dynamic-link`) so its ggml never meets whisper's. The page side adds a summary to the meeting node's attributes, a types store in localStorage, a Markdown-subset renderer, and a Summary tab; the browser mock stands in for the model.

**Tech Stack:** Rust (Tauri 2, `llama-cpp-2 =0.1.161` metal+dynamic-link), Svelte 5 runes, TipTap, Vitest (node env, no Svelte plugin), Playwright against `src/dev-mock-meet.ts`.

**Spec:** `docs/superpowers/specs/2026-11-17-meet-summary-design.md`

## Global Constraints

- Work in worktree `thought-desk-meet-summary`, branch `feature/meet-summary`. Don't touch `src/lib/automate.svelte.ts`, `src/lib/db/automation.ts`, `src/lib/db/auto/`, `src-tauri/src/automations.rs`, `src-tauri/src/db.rs`.
- No schema migration. Summary lives in the meeting node's attributes.
- `/meet` is macOS-only: new Rust code under `#[cfg(target_os = "macos")]` modules; `unsupported.rs` gets matching stubs.
- Model: `https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf`, size `2_740_937_888`, sha256 `00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4`, id `summary`, model tag `qwen3.5-4b-q4_k_m`.
- Inference: `N_CTX = 32_768`, `MAX_NEW = 1_500`, temperature `0.3`, seed `1`, all layers on GPU (`with_n_gpu_layers(999)`), thinking off by appending `"<think>\n\n</think>\n\n"` after the template's assistant prefix.
- Every new English message in `src/locales/en/*.json` has an `"@key"` note; plurals are `{ "one", "other" }` objects. Built-in type instructions' notes say they're sent to the on-device summarizing model.
- Tests and fixtures use generic data ("Alice", "Project", "Task"); no real personal data.
- No network except the user-started model download; no telemetry.
- Commit after each task with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push or merge.

## Review Focus

1. **A meeting from an older version / another Mac / a paste** (no `summary`, malformed `summary`, unknown `typeId`): renders Transcript normally, Summary tab offers Summarize, and Regenerate falls back to the stored instructions copy, then General. → Task 5 & 7 tests.
2. **A custom type deleted while a meeting uses it:** the picker shows the stored type name as the current choice instead of a blank select; Regenerate uses the stored instructions. → Task 7 test `resolveType falls back to the stored copy`.
3. **Leaving the page or closing the block mid-summary:** the Rust run finishes or is cancelled without crashing; reopening shows the previous summary or Summarize, never a stuck "writing". → Task 9 e2e `leaving mid-summary leaves no stuck state`.
4. **Summarize while a recording is processing, or twice at once:** second request shows *waiting* and runs after; no two models in memory. → Task 4 Rust test on the queue + Task 9 e2e `a second summary waits its turn`.
5. **Model output outside the Markdown subset** (code fences, `#`/`###`, numbered lists, HTML tags): shown as plain text, never as HTML. → Task 6 test `anything else is plain text`.

---

### Task 1: Link llama.cpp as dylibs and bundle them

**Files:**
- Modify: `src-tauri/Cargo.toml` (macOS deps block, next to whisper-rs)
- Modify: `src-tauri/build.rs`
- Modify: `src-tauri/tauri.macos.conf.json` (`bundle.macOS.frameworks`)
- Test: `src-tauri/src/meet/summarize.rs` (new, `#[cfg(test)]` only for now) and `src-tauri/src/meet/mod.rs`

**Interfaces:**
- Produces: crate `llama_cpp_2` available on macOS; module `meet::summarize` registered in `mod.rs` under `#[cfg(target_os = "macos")]`.

- [ ] **Step 1:** Add to the macOS deps with a comment on why it's dynamic (spike: static link let llama call whisper's ggml and abort):
  `llama-cpp-2 = { version = "=0.1.161", default-features = false, features = ["metal", "dynamic-link"] }`
- [ ] **Step 2: Write the failing test** in `summarize.rs`:
  ```rust
  #[test]
  fn llama_backend_loads_beside_whisper() {
      let _b = llama_cpp_2::llama_backend::LlamaBackend::init().unwrap();
  }
  ```
- [ ] **Step 3:** Run `cargo test --manifest-path src-tauri/Cargo.toml meet::summarize` — expect FAIL with `dyld: Library not loaded: @rpath/libggml-base.0.dylib`.
- [ ] **Step 4:** In `build.rs`, on macOS add `cargo:rustc-link-arg=-Wl,-rpath,@executable_path/../Frameworks` and an absolute rpath to the profile dir (`OUT_DIR` up three levels, i.e. `target/<profile>`, where llama-cpp-sys-2 writes `lib*.dylib`).
- [ ] **Step 5:** Re-run the test — expect PASS.
- [ ] **Step 6:** Add `bundle.macOS.frameworks` listing the six install names from `target/release/`: `libllama.0.dylib`, `libllama-common.0.dylib`, `libggml.0.dylib`, `libggml-base.0.dylib`, `libggml-cpu.0.dylib`, `libggml-metal.0.dylib` (paths relative to `src-tauri/`). Check with `otool -L` on the built binary that these are exactly the `@rpath` names it needs.
- [ ] **Step 7:** Run the whole Rust suite `cargo test --manifest-path src-tauri/Cargo.toml` — expect all existing meet tests still PASS (whisper unaffected).
- [ ] **Step 8:** Commit `build: link llama.cpp as dylibs beside whisper for /meet summaries`.

### Task 2: The summary model in the catalogue

**Files:**
- Modify: `src-tauri/src/meet/models.rs`
- Modify: `src-tauri/src/meet/engine.rs` (two commands), `src-tauri/src/meet/unsupported.rs`, `src-tauri/src/main.rs`

**Interfaces:**
- Produces (Rust): `pub const SUMMARY: Model`; `ModelsStatus.summary: ModelState` (serialized `summary`); `delete_all` leaves `SUMMARY.file`; `pub fn delete_one(dir, m) -> io::Result<()>`.
- Produces (commands): `meeting_summary_model_download(app, state) -> Result<()>` (progress on `td-meeting-models` like the speech models, sharing the `downloading`/`cancel_download` flags so `meeting_models_cancel` cancels it); `meeting_summary_model_delete(app, state) -> Result<()>` (refuses while a summary runs).

- [ ] **Step 1: Failing tests** in `models.rs` tests:
  - `the_catalogue_is_consistent` extended: `SUMMARY.url` starts with a `HOSTS` entry; `SUMMARY.sha256.len() == 64`; `SUMMARY.size == 2_740_937_888`.
  - `delete_all_keeps_the_summary_model`: write fake files named `ggml-base.en.bin` and `SUMMARY.file` into a temp dir, `delete_all`, assert only the summary file remains.
  - `status_reports_the_summary_model`: a temp file of `SUMMARY.size` bytes (sparse via `set_len`) → `status(dir).summary.present == true`.
- [ ] **Step 2:** Run `cargo test … meet::models` — expect FAIL (no `SUMMARY`).
- [ ] **Step 3:** Implement: `SUMMARY` (file `Qwen3.5-4B-Q4_K_M.gguf`, `Pack::Plain`), `HOSTS` becomes `[&str; 3]` adding `https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/`, `status`, `delete_all` skip, `delete_one`. Then the two commands, stubs in `unsupported.rs`, and registration in `main.rs`.
- [ ] **Step 4:** Run the models tests — expect PASS. Run `cargo test … meet` — PASS.
- [ ] **Step 5:** Commit `feat(meet): summary model in the download catalogue`.

### Task 3: Prompt building (pure)

**Files:**
- Modify: `src-tauri/src/meet/summarize.rs`

**Interfaces:**
- Produces:
  - `pub const BASE_RULES: &str` — the fixed system rules from the spec (only from the transcript; never invent names, numbers or commitments; use speaker names as given; write in the transcript's language; Markdown with `##` headings, `-` bullets, `**bold**` only; omit empty sections).
  - `pub fn system_prompt(instructions: &str) -> String` = `BASE_RULES` + `"\n\n"` + trimmed instructions (just `BASE_RULES` when blank).
  - `pub fn user_prompt(title: &str, lines: &[String]) -> String` = `"Meeting: {title}\n\nTranscript:\n"` + lines joined by `\n` (title line omitted when blank).
  - `pub fn chunk_lines(lines: &[String], max_chars: usize) -> Vec<Vec<String>>` — consecutive groups, never splitting a line; a single line longer than `max_chars` is its own chunk.
  - `pub const CONDENSE: &str` — the per-chunk instruction ("Write terse notes of this part of a meeting: who said what that matters, decisions, commitments with owners. Notes only.").
  - `pub fn prompt_budget() -> usize` = `N_CTX - MAX_NEW - 512` (tokens).

- [ ] **Step 1: Failing tests:**
  - `system_prompt_appends_type_instructions`: contains `BASE_RULES` then `"Focus on feedback."`; blank instructions → equals `BASE_RULES`.
  - `user_prompt_has_title_and_lines`: `user_prompt("Project sync", &["Alice (0:05): Hello".into()])` contains `"Meeting: Project sync"` and ends with `"Alice (0:05): Hello"`; blank title has no `"Meeting:"`.
  - `chunks_keep_lines_whole_and_in_order`: 5 lines of 10 chars, `max_chars = 25` → 3 chunks `[2,2,1]`; flattening equals the input.
  - `an_overlong_line_is_its_own_chunk`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(meet): summary prompt building`.

### Task 4: The runner and commands

**Files:**
- Modify: `src-tauri/src/meet/summarize.rs`, `src-tauri/src/meet/engine.rs`, `src-tauri/src/meet/unsupported.rs`, `src-tauri/src/main.rs`

**Interfaces:**
- Consumes: Task 2 `SUMMARY`, `models::verify`; Task 3 prompt functions.
- Produces:
  - `pub fn run(model_path: &Path, title: &str, lines: &[String], instructions: &str, cancel: &AtomicBool, on_text: &mut dyn FnMut(&str, u8)) -> Result<String, String>` — loads model, uses `model.chat_template(None)` + `apply_chat_template(…, true)` + the think prefill; tokenizes; if over `prompt_budget()`, chunk with `max_chars = prompt_budget() * 3`, condense each chunk with `CONDENSE` (pct 0–80 across chunks), then summarize the joined notes (80–100); streams decoded text via `on_text(text_so_far, pct)`; stops on EOG, `MAX_NEW`, or cancel (`Err("cancelled")`). Returns trimmed Markdown.
  - Event `td-meeting-summary` payload `{ block: String, state: "waiting" | "writing", text: String, pct: u8 }` (camelCase).
  - `#[tauri::command(async)] meeting_summarize(app, state: State<MeetState>, block: String, title: String, lines: Vec<String>, instructions: String) -> Result<String>`: errors `"The summary model isn't downloaded yet."` if absent; verifies hash once per app run (cache a `summary_verified: AtomicBool` in `MeetState`); waits (emitting `waiting`) while `jobs` is non-empty or another summary holds the `summary_lock: Mutex<()>`; registers `block → Arc<AtomicBool>` in `summary_cancel: Mutex<HashMap<…>>`.
  - `#[tauri::command] meeting_summary_cancel(state, block: String)`.
  - `meeting_summary_model_delete` (Task 2) and `meeting_models_delete` refuse while `summary_lock` is held.

- [ ] **Step 1: Failing test** `summaries_take_turns`: two threads each acquire the summary gate via a small `fn gate(state: &MeetState) -> MutexGuard<()>`; assert they never overlap (shared counter never exceeds 1).
- [ ] **Step 2: Failing test** `#[ignore] writes_a_summary_with_the_real_model` — skips with a message unless `models/Qwen3.5-4B-Q4_K_M.gguf` exists under the app data dir (`~/Library/Application Support/com.nateheartman.thoughtnotes/models`); runs `run()` on three lines ("Alice (0:00): We will review the Project schedule.", "Bob (0:04): The launch date is realistic.", "Alice (0:08): Bob will send the budget by Friday.") with General instructions; asserts output contains `"##"` and `"Bob"`, and that `on_text` was called more than once.
- [ ] **Step 3:** Run both (the ignored one with `-- --ignored`) — FAIL.
- [ ] **Step 4:** Implement; register commands; add stubs.
- [ ] **Step 5:** Run `cargo test … meet` and `cargo test … meet::summarize -- --ignored` — PASS. Also run the existing ignored whisper test after the summary test in one invocation to confirm whisper still works after llama in-process.
- [ ] **Step 6:** Commit `feat(meet): local summary runner and commands`.

### Task 5: Summary in the meeting node, text and exports

**Files:**
- Modify: `src/lib/meeting-text.ts`, `src/lib/editor/meeting.svelte.ts`, `src/lib/markdown.ts`, `src/lib/docx.ts`
- Test: `src/lib/meeting-text.test.ts` (new; if importing `./i18n` fails under node, `vi.mock('./i18n', () => ({ t: (k: string) => k }))`)

**Interfaces:**
- Produces:
  ```ts
  export interface MeetingSummary { md: string; typeId: string; typeName: string; instructions: string; at: number; model: string }
  // MeetingAttrs gains: summary: MeetingSummary | null; typeId: string  (EMPTY_MEETING: null, 'general')
  export function summaryLines(turns: MeetingTurn[], names: Record<string, string>): string[]  // "Alice (0:05): text"
  ```
  `meetingText` = title, summary md, transcript (blank parts dropped). Node gains `summary` and `typeId` attributes. `renderHTML` adds one `<p data-summary>` per non-empty summary line before the turns. Markdown export: after the title, `**Summary**` then the summary md verbatim, then the turns. Word export: a bold "Summary" paragraph, then one paragraph per summary line (headings bold, `- ` bullets as plain paragraphs prefixed "• "), then the turns. Delete recording (`MeetingBlock.removeRecording`) also sets `summary: null`.
- New message: `blocks.meeting.summaryHeading` ("Summary", used in exports).

- [ ] **Step 1: Failing tests:** `readAttrs keeps a valid summary`; `readAttrs drops a malformed summary` (missing `md`, non-string fields → `null`); `readAttrs defaults typeId to general`; `summaryLines uses given names and clock`; `meetingText puts the summary between title and transcript`.
- [ ] **Step 2:** `npx vitest run src/lib/meeting-text.test.ts` — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Extend `tests/e2e/exports.spec.ts` only if it already covers meetings; otherwise export assertions go in Task 10.
- [ ] **Step 6:** Commit `feat(meet): keep a summary with the meeting`.

### Task 6: Markdown-subset renderer

**Files:**
- Create: `src/lib/meeting-summary.ts`, `src/lib/meeting-summary.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Inline = { text: string; bold: boolean };
  export type SummaryBlock = { kind: 'heading' | 'para'; parts: Inline[] } | { kind: 'list'; items: Inline[][] };
  export function parseSummary(md: string): SummaryBlock[];
  ```
  `## x` → heading; consecutive `- x` / `* x` → one list; other non-blank lines → para; `**x**` → bold part; anything else (other `#` levels, `1.`, backticks, `<tags>`) stays literal text.

- [ ] **Step 1: Failing tests:** `headings, lists and paragraphs`; `bold runs inside a bullet` (`- **Alice**: send the budget` → `[{text:'Alice',bold:true},{text:': send the budget',bold:false}]`); `anything else is plain text` (`### x`, `1. y`, `<b>z</b>`, a fenced block → paras whose text equals the source lines); `an unclosed ** is literal`.
- [ ] **Step 2–4:** run FAIL → implement → PASS (`npx vitest run src/lib/meeting-summary.test.ts`).
- [ ] **Step 5:** Commit `feat(meet): safe renderer for summary markdown`.

### Task 7: Meeting types

**Files:**
- Create: `src/lib/meeting-types.ts`, `src/lib/meeting-types.test.ts`
- Modify: `src/lib/meeting.svelte.ts` (reactive store), `src/locales/en/blocks.json` or `settings.json` (built-in names/instructions)

**Interfaces:**
- Produces (pure, no i18n import; built-ins passed in):
  ```ts
  export type BuiltinId = 'general' | 'oneOnOne' | 'team' | 'sales';
  export const BUILTIN_IDS: BuiltinId[];
  export interface TypesData { overrides: Partial<Record<BuiltinId, string>>; custom: { id: string; name: string; instructions: string }[] }
  export interface MeetingType { id: string; name: string; instructions: string; builtin: boolean; edited: boolean }
  export type Defaults = Record<BuiltinId, { name: string; instructions: string }>;
  export function listTypes(data: TypesData, defaults: Defaults): MeetingType[];      // built-ins in BUILTIN_IDS order, then custom
  export function resolveType(id: string, data: TypesData, defaults: Defaults, stored?: { typeName: string; instructions: string } | null): MeetingType; // unknown id → stored copy (id kept, builtin false) → general
  export function readTypes(raw: unknown): TypesData;                                  // validates localStorage JSON
  export function addCustom(data: TypesData, name: string, instructions: string, id?: string): TypesData;
  export function updateType(data: TypesData, id: string, patch: { name?: string; instructions?: string }): TypesData; // built-ins: instructions only
  export function resetBuiltin(data: TypesData, id: BuiltinId): TypesData;
  export function deleteCustom(data: TypesData, id: string): TypesData;
  ```
- In `meeting.svelte.ts`: `types = $state<TypesData>(…)` from `thoughtnotes.meet.types.v1`, `saveTypes()`, `typeDefaults(): Defaults` built from `t('blocks.meeting.types.<id>.name' | '.instructions')`, getter `typeList`.
- Messages (each with `@` notes): `types.general|oneOnOne|team|sales.name` = "General", "1:1", "Team meeting", "Sales call"; `.instructions` with the spec's section outlines.

- [ ] **Step 1: Failing tests:** `lists built-ins then custom`; `editing a built-in marks it edited and reset restores it`; `built-ins can't be renamed`; `custom types are added, updated and deleted`; `resolveType falls back to the stored copy` (unknown id + stored → name/instructions from stored); `resolveType with nothing stored falls back to general`; `readTypes ignores junk` (non-object, bad custom entries).
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** `npm run i18n` — PASS. Commit `feat(meet): meeting types`.

### Task 8: Page-side client and browser mock

**Files:**
- Modify: `src/lib/meeting.svelte.ts`, `src/dev-mock-meet.ts`

**Interfaces:**
- Consumes: Task 2/4 commands and event.
- Produces on `meeting`:
  - `ModelsStatus.summary: ModelState`; `summaryReady(m?): boolean`.
  - `summaries = $state<Record<string, { state: 'waiting' | 'writing'; text: string; pct: number }>>({})` fed by `td-meeting-summary`.
  - `summarize(block: string, req: { title: string; lines: string[]; instructions: string }): Promise<string>` (clears `summaries[block]` in `finally`); `cancelSummary(block: string): void`.
  - `ensureSummaryModel(): Promise<boolean>` — like `ensureModels`, but opens the sheet with `sheet.kind = 'summary'` (sheet state becomes `{ kind: 'speech' | 'summary'; resolve }`); `startDownload()` calls `meeting_summary_model_download` when `kind === 'summary'`; `deleteSummaryModel()`.
- Mock: `modelsStatus()` gains `summary` (present unless `summaryModelMissing`); `meeting_summary_model_download` mirrors the speech download events; `meeting_summary_model_delete`; `meeting_summarize` emits `waiting` while a mock processing job or another mock summary runs, then streams in ~6 steps of `tick()` the text:
  ```
  ## Overview
  A meeting about the project schedule.

  ## Decisions
  - The launch date stays.

  ## Action items
  - **Speaker 2**: confirm the budget next week.

  ## Notes
  - {first non-blank line of instructions}
  ```
  (The mock never sees the type name, so e2e tests tell types apart by the Notes line and by the block's own footer.) `failSummary` steer fails the first call with `"The summary couldn't be written."`; `meeting_summary_cancel` rejects the pending call with `"cancelled"`. Add the new steer flags to the header comment.

- [ ] **Step 1:** Implement both; `npm run check` (svelte-check) — 0 errors.
- [ ] **Step 2:** Commit `feat(meet): summary client and browser stand-in`.

### Task 9: Summary | Transcript tabs in the block

**Files:**
- Create: `src/lib/editor/MeetingSummary.svelte`
- Modify: `src/lib/editor/MeetingBlock.svelte`, `src/locales/en/blocks.json`
- Test: `tests/e2e/meet-summary.spec.ts` (new; copy `steer`, `newPage`, `addMeeting`, `recordAndFinish` helpers from `meet.spec.ts`)

**Interfaces:**
- Consumes: Tasks 5–8.
- `MeetingSummary.svelte` props: `{ p: BlockProps }`. Owns a per-component `block = crypto.randomUUID()`. Toolbar: `Type` `<select>` (types from `meeting.typeList`; if `attrs.typeId` isn't listed, an extra option named from `attrs.summary?.typeName`), last option "Edit types…" opening Settings › Meetings (use the existing settings-open helper in `ui`), Regenerate/Summarize, Copy (copies `summary.md`). States per spec: no model, none yet, waiting, writing (live text via `parseSummary`, Cancel), failed (message + Try again), done (+ footer "Written as {type} · {time}"; stale hint when `attrs.typeId !== summary.typeId` or resolved instructions `!== summary.instructions`). On success `p.update({ summary: { md, typeId, typeName, instructions, at: Date.now(), model: 'qwen3.5-4b-q4_k_m' } })`.
- Exported helper from the same module (`<script module>`): `autoSummarize(p: BlockProps)`, called by `MeetingBlock.apply()` after the transcript is put in, only when `meeting.summaryReady()`.
- `MeetingBlock`: in `done` mode, the player stays above a `role="tablist"` with tabs "Summary" / "Transcript"; default Summary if `attrs.summary` else Transcript; chips, turns, actions and the re-run panel move under Transcript.
- Messages (all with notes): `tabs.summary`, `tabs.transcript`, `summary.type`, `summary.editTypes`, `summary.summarize`, `summary.regenerate`, `summary.cancel`, `summary.copy`, `summary.copied`, `summary.writing`, `summary.waiting`, `summary.failed`, `summary.retry`, `summary.stale` ("Written as {type}. Regenerate to use the current type."), `summary.footer` ("Written as {type} · {time}"), `summary.noModel`, `summary.noModelHint` (mentions the size via `{size}`), `summary.download`, `summary.none`.

- [ ] **Step 1: Failing e2e tests** (`npm run e2e -- tests/e2e/meet-summary.spec.ts`):
  - `a finished meeting opens on Summary with a written summary, and Transcript shows the turns` (auto-summary: wait for `## Overview` rendered as a heading "Overview").
  - `changing the type shows the stale hint and Regenerate replaces the summary` (pick "1:1"; hint visible; Regenerate; Notes line now shows 1:1's first instruction line; footer says "1:1").
  - `without the summary model, Transcript works and Summary offers the download` (`summaryModelMissing`; Download opens the sheet; after it, Summarize works).
  - `a failed summary says why and can be tried again` (`failSummary`).
  - `Cancel stops a summary and leaves the previous one`.
  - `a second summary waits its turn` (two meeting blocks; second shows "Waiting").
  - `leaving mid-summary leaves no stuck state` (navigate to another page during writing, come back: either the summary or Summarize, not "Writing").
  - `Delete recording clears the summary`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; also `npm run e2e -- tests/e2e/meet.spec.ts` stays green (update its selectors only where the turns moved under the Transcript tab).
- [ ] **Step 5:** `npm run i18n`, `npm run check` — PASS. Commit `feat(meet): Summary and Transcript tabs`.

### Task 10: Settings — summary model and meeting types

**Files:**
- Create: `src/lib/ui/MeetingTypes.svelte`
- Modify: `src/lib/ui/MeetingSettings.svelte`, `src/lib/components/MeetingModelsSheet.svelte`, `src/locales/en/settings.json`
- Test: `tests/e2e/meet-summary.spec.ts`

**Interfaces:**
- Consumes: Task 7 store functions, Task 8 client.
- Settings › Meetings gains a "Summary model" row (size from `models.summary.size` via `fmt`, Download / Delete with confirm, progress) and a "Meeting types" section (`MeetingTypes.svelte`): list on the left/top, editor with Name (custom only) and Instructions textarea (saved on input, debounced through `meeting.saveTypes()`), buttons Add type, Delete (custom, confirm), Reset to default (edited built-in). `MeetingModelsSheet` reads `meeting.sheet.kind` for its title, body and size.
- Messages under `settings.meetings.summary.*` and `settings.meetings.types.*` with notes; the sheet's summary-mode title/body.

- [ ] **Step 1: Failing e2e tests:**
  - `a custom type added in Settings appears in the menu and steers the summary` (add "Project review" with instructions "List risks first."; in the block pick it, Regenerate; Notes shows "List risks first."; footer "Project review").
  - `an edited built-in shows Reset to default, which restores it`.
  - `Settings shows the summary model and can delete it` (after delete, block's Summary tab shows the download offer).
  - `the summary is searched and exported` (search finds a word only in the summary; Markdown export contains "**Summary**" and "## Overview").
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat(meet): summary model and meeting types in Settings`.

### Task 11: Full verification

- [ ] `npm run i18n` — no problems.
- [ ] `npx vitest run` — all pass.
- [ ] `npm run check` — 0 errors, 0 warnings introduced.
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` — all pass; plus `-- --ignored` for `meet::summarize` on this Mac (model present).
- [ ] `npm run e2e -- tests/e2e/meet.spec.ts tests/e2e/meet-summary.spec.ts tests/e2e/exports.spec.ts tests/e2e/i18n.spec.ts` — all pass.
- [ ] `npm run tauri build -- --bundles app`; `otool -L` on `Contents/MacOS/*` shows the six `@rpath` dylibs and they exist in `Contents/Frameworks`; launch the `.app`, record a short meeting, see a summary.
- [ ] Commit any fixes; leave the branch unpushed.
