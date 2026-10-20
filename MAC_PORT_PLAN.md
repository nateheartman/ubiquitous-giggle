# Thought Desk → macOS native port plan

Upstream: https://github.com/kusule1351-hue/thought-desk (Tauri 2 + Rust + Svelte 5, AGPL-3.0)
Fork target: https://github.com/nateheartman/ubiquitous-giggle

Strategy: keep the code **cross-platform** and branch on platform (`cfg(target_os = "macos")` in Rust,
an `isMac` flag in the UI). That keeps upstream merges cheap and Windows keeps working.

## Audit: what is Windows-specific today

| # | Area | Where | Problem on macOS |
|---|------|-------|------------------|
| 1 | Frameless window | `tauri.conf.json` `decorations:false` + `WindowControls.svelte` | Draws Windows-style min/max/close at top-right, Segoe glyphs, Win11 red close. No traffic lights. |
| 2 | WebView2 flags | `tauri.conf.json` `additionalBrowserArgs` | WebView2-only switches; meaningless on WKWebView. |
| 3 | Bundle targets | `tauri.conf.json` `targets:["nsis"]`, `webviewInstallMode` | No `.app` / `.dmg`. |
| 4 | Mod key | `shortcuts.svelte.ts` `comboOf` treats `ctrlKey \|\| metaKey` as Mod | On Mac, Ctrl+click is right-click and Ctrl+key are Emacs text bindings; Mod must be ⌘ only. |
| 5 | Key labels | `KEY_NAMES.Mod='Ctrl'` + ~38 hard-coded "Ctrl+…" / "Alt+click" strings (BubbleMenu, blocks.ts, slash.ts, ShortcutsHelp, StudySheet, TableView, page-actions, SplitPane) | Should read ⌘ ⌥ ⇧ ⌃ glyphs. |
| 6 | Raw `ctrlKey` checks | App, StudySheet, Welcome, SearchPalette, MathEditor, TableView, FormulaEditor, CalendarView, ShortcutsEditor, editor/extensions | Same as #4. |
| 7 | Default shortcuts | Back/Forward = `Alt+←/→`; Redo `Mod+Y`; reserved `Alt+F4` | Mac: ⌘[ / ⌘], ⌘⇧Z; reserve ⌘Q ⌘W ⌘H ⌘M ⌘⌥H. |
| 8 | PDF export | `pdf.rs` uses WebView2 `PrintToPdf`; non-Windows returns an error | Implement with `WKWebView createPDFWithConfiguration` (objc2-web-kit) or fall back to print dialog. |
| 9 | Memory trimming | `memory.rs` WebView2-only, no-op elsewhere | Fine as no-op; verify minimize/visibility flush still fires. |
| 10 | App menu | none (Windows has none) | Mac needs a real menu bar: App (About, Settings ⌘,, Hide, Quit), Edit (cut/copy/paste/undo — required for ⌘C/⌘V in WKWebView), View, Window, Help. |
| 11 | Window lifecycle | close = quit | Mac: red button / ⌘W hides window, app stays in Dock; Dock click (`RunEvent::Reopen`) re-shows. ⌘Q flushes and quits. |
| 12 | Titlebar double-click | custom drag region | Should zoom (or minimize, per system pref) like native. |
| 13 | Fonts | `--font-ui` prefers Inter then Segoe | Fine (Inter is bundled), but add `-apple-system` ahead of Segoe; check SF for system UI bits. |
| 14 | Scrollbars | custom `::-webkit-scrollbar` | Consider native overlay scrollbars on Mac. |
| 15 | Copy text | "Restore Down", "Show in Explorer"-style wording | "Zoom", "Show in Finder". |
| 16 | CI / release | Windows runner, NSIS | Add `macos-latest` job; release universal `.dmg`. |
| 17 | Identity / license | identifier `app.thoughtdesk.desktop`; your repo had Apache-2.0 LICENSE | **Decided:** productName `ThoughtNotes`, identifier `com.nateheartman.thoughtnotes`. Keep upstream attribution in README/About. **AGPL-3.0 must be kept** (fork of AGPL code); Apache LICENSE gets replaced. |
| 18 | Toolchain | Rust not installed on this Mac | `rustup` + targets `aarch64-apple-darwin`, `x86_64-apple-darwin`. Xcode CLT present (enough). |

## Workstreams (one Sonnet agent each, own git worktree, disjoint files)

**A — Window chrome** · `tauri.conf.json` (+ new `tauri.macos.conf.json` / `tauri.windows.conf.json` overrides), `WindowControls.svelte`, `TitleBar.svelte`, `Welcome.svelte` (layout only), `Sidebar.svelte` (top padding), capabilities
- macOS: `decorations:true`, `titleBarStyle:"Overlay"`, `hiddenTitle:true`, `trafficLightPosition` aligned to titlebar height.
- Move WebView2 args / NSIS settings into the Windows override file.
- Hide `WindowControls` on Mac; reserve ~78px left inset for traffic lights (sidebar header, or titlebar when sidebar hidden); drop inset in fullscreen.
- Double-click titlebar → zoom. Optional: sidebar vibrancy.

**B — Keyboard & labels** · new `src/lib/platform.ts`, `shortcuts.svelte.ts`, every `ctrlKey` site, every hard-coded "Ctrl"/"Alt+click" label
- `isMac`; `comboOf` maps ⌘→Mod and ⌃→Ctrl separately on Mac.
- Labels render as ⌘⇧L (no `+`) on Mac; helper `modLabel()` used everywhere strings are hard-coded.
- Mac defaults: Back ⌘[, Forward ⌘], Redo ⌘⇧Z; reserved list gets ⌘Q/W/H/M; drop Alt+F4.
- Ctrl+click must not trigger Mod behaviours (it's a context-menu click).

**C — Native backend** · `main.rs`, `pdf.rs`, `memory.rs`, `Cargo.toml`, new `menu.rs`
- Native menu bar (App/Edit/View/Window/Help) wired to UI events (`td-menu` with ids → existing commands).
- Hide-on-close + Dock reopen; ⌘Q flushes via the existing `td:flush` path.
- PDF export via WKWebView on macOS.
- Confirm data dir (`~/Library/Application Support/<id>`), notifications permission, global shortcut.

**D — Bundle, CI, look** · `tauri.conf.json` bundle section (coordinated with A at merge), `.github/workflows/*`, `app.css`, README
- Targets `app`,`dmg`; `minimumSystemVersion` 11.0; ad-hoc signing now, Developer ID/notarization hooks later.
- CI: macOS check job + universal dmg release.
- Fonts/scrollbars/Finder wording polish.

**E — Tests** · `tests/e2e/*`, `playwright.config.ts`, `dev-mock.ts`
- Add a Mac-emulated Playwright project (UA/platform override) covering ⌘ shortcuts, labels, no Windows controls, Ctrl+click → context menu.

## Stage gates (verified by the lead, not the agents)

- **Gate 0 – setup**: install Rust; fork history pushed to your repo (AGPL); baseline `npm run check`, `cargo test`, `tauri dev` launch on Mac. Record what already breaks.
- **Gate 1 – A, B, C in parallel** → merge worktrees; `npm run check`, `cargo test`, e2e green; launch app, screenshot traffic lights, test ⌘ shortcuts, copy/paste, menu, close/reopen, PDF.
- **Gate 2 – D, E** → `tauri build` produces `.app` + `.dmg`; launch the bundled app; Mac e2e project green; CI green on PR.
- **Gate 3 – ship**: PR to `main` on your repo with a summary of verified behaviour.
