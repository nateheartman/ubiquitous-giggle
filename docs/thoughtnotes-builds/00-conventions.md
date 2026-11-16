# ThoughtNotes 0.2.0 — shared build conventions

Every builder reads this first, then their own `NN-*.md`.

## The release

- ThoughtNotes is a macOS-first fork of Thought Desk (Rust + Tauri 2 + Svelte 5, AGPL-3.0-or-later).
- Release 0.2.0 = Thought Desk 0.8.4 merged in (task 01) + Work mode (02) + Notion-style formulas (03) + `/meet` local transcription (04).
- Integration branch: `release/0.2.0`. Task 01 lands first. Tasks 02–04 branch off `release/0.2.0` **after** 01 is merged and run in parallel.

## Ground rules

1. **Stay in your lane.** Only touch files your task needs. If you must edit a shared file (`SettingsModal.svelte`, `Sidebar.svelte`, `slash.ts`, `db.rs`, `main.rs`, `commands.rs`, `Cargo.toml`, `package.json`, `src/locales/en/*.json`), make small, additive edits, never reformat or reorder what's there, so the three branches merge cleanly.
2. **Database migrations** (`src-tauri/src/db.rs`, `PRAGMA user_version`): upstream ends at **13**. Version **14 is reserved for task 02 (Work mode)**, **15 for task 04 (/meet)** if it needs one. Task 03 must not add a migration. Write each migration so it doesn't depend on the other one existing (e.g. 15 must not assume 14's tables).
3. **i18n:** all user-facing text goes through `t()` with keys in `src/locales/en/*.json`, following the rules at the top of `.github/scripts/i18n-check.mjs` (camelCase keys, a `@note` for one-word messages and for any message with placeholders). Spanish (`es`) translations are optional; missing ones are counted, not errors.
4. **No calls to upstream's servers.** ThoughtNotes must never contact Kusule's Supabase/Clerk/relay/GitHub-release endpoints. If you add network access (only task 04 does, for model downloads), it goes to the model host named in your spec and only when the user starts it.
5. **Windows still compiles.** macOS-only code sits behind `#[cfg(target_os = "macos")]` (Rust) or `isMac` (TS), with a sensible fallback.
6. **Match the codebase's style:** comments explain *why* in plain sentences, like the existing files. Commit subjects are plain sentences in upstream's style ("Work mode: Courses become Areas"), not `feat:` prefixes. End every commit message with:
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`

## Definition of done (all must pass before you report back)

Run from the repo root:

```sh
npm ci
npm run check        # svelte-check: 0 errors (warnings you introduced: 0)
npm run i18n         # 0 errors
npm run build
(cd src-tauri && cargo test)
(cd src-tauri && cargo clippy --all-targets -- -D warnings)   # no NEW warnings vs. the base branch
npx playwright test <the specs you added or touched>
```

Add tests for what you build: Rust unit tests for backend logic, Playwright specs (see `tests/e2e/`, which use the browser stand-in in `src/dev-mock.ts`) for the UI, and unit tests where the repo has a pattern for them.

## Report back with

- Branch name and the commit list.
- The output summary of every check above (pass/fail counts).
- Anything you couldn't finish, any judgment calls you made that the spec didn't cover, and anything you had to change outside your lane.
