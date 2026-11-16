# 01 — Merge Thought Desk 0.8.4 into ThoughtNotes

## Why

ThoughtNotes last merged upstream at Thought Desk 0.6.0 (`13585ed`). Upstream is now at 0.8.4 (`upstream/main`, ~40 commits): translations, a reworked settings screen, galaxy view, frozen table columns, draggable courses, table fixes, and **upstream's own native macOS support** (0.8.0). We want all of that, while keeping what makes ThoughtNotes a better Mac app and keeping it fully local.

## Decision (made by the owner)

**Upstream is the base.** Where upstream and the fork both solved the same Mac problem, take upstream's version. Then put back only the Mac features that upstream doesn't have. Hide everything that depends on the upstream author's servers.

## Steps

1. On a branch off `release/0.2.0`: `git fetch upstream && git merge upstream/main`. A trial merge conflicts in ~40 files.
2. Resolve conflicts with these rules:
   - **Upstream wins** for: keyboard handling / `Mod`=⌘ / ⌘ ⌥ labels (`platform.ts` `isMac`, `MOD`, `ALT`), the macOS window frame (`tauri.macos.conf.json`, `--traffic-lights`), translations (every hard-coded string the fork added must become a `t()` key), the settings rework, and all non-Mac features.
   - **Fork wins** for identity: product name `ThoughtNotes`, identifier `com.nateheartman.thoughtnotes`, icons, bundle/dmg config, README "About this fork" section, AGPL notices crediting Kusule, `package.json` name/description/repository.
   - `package-lock.json` / `Cargo.lock`: take upstream's, then re-run `npm install` / `cargo build` to regenerate with the fork's additions.
3. **Re-apply the fork-only Mac features** on top of upstream's code (reuse upstream's `isMac`; delete the fork's duplicate helpers where upstream has an equivalent):
   - Native menu bar (`src-tauri/src/menu.rs`, `src/lib/menu-events.ts`), including View → Zoom In / Zoom Out / Actual Size and ⌃⌘S to toggle the sidebar. Menu-owned shortcuts must not fire twice (see fork commits `2d45331`, `c01ad1f`).
   - Red button hides the window; the app stays in the Dock; Dock click reopens; ⌘Q flushes saves and then quits (`main.rs` `CloseRequested` / `RunEvent::Reopen` / `menu::request_quit`).
   - PDF export through WKWebView, showing just the page in light colours (`pdf.rs`, fork commit `9f310c9`).
   - Keep the fork's Mac Playwright specs (`mac-shortcuts`, `mac-settings`, `window-chrome`, the mac project in `playwright.config.ts`); update them to upstream's selectors/labels where needed rather than deleting assertions.
4. **Hide upstream's server-dependent features** so ThoughtNotes never contacts the upstream author's backend:
   - Add one switch, `src/lib/features.ts` exporting `CLOUD_FEATURES = false`, and gate on it: sync (settings pane, welcome/sign-in screens), cowork / "writing together", account/sign-in, the sponsor button / sponsor goal on Home, and any "relay" UI.
   - Rust: don't start sync, auth, cowork or relay background work unless a signed-in account exists (it never will). Register no `thoughtdesk://` deep-link scheme; if the deep-link plugin is needed to compile, switch its scheme to `thoughtnotes` and leave it inert.
   - Updater: keep `endpoints: []` and hide the "check for updates" UI (the fork has no release feed yet). Never point it at upstream's `latest.json`: that would replace ThoughtNotes with Thought Desk.
   - Leave the code in place (smaller future merges). Don't delete upstream modules.
   - Verify: `grep -rn "supabase.co\|clerk\.\|kusule1351\|thoughtdesk://" src src-tauri/src src-tauri/*.json` and confirm every hit is unreachable while `CLOUD_FEATURES` is false. Run the app in the browser stand-in and confirm no network requests go anywhere except localhost.
5. Bump version to **0.2.0** in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. In the README, add a line: "Based on Thought Desk 0.8.4."
6. Upstream e2e specs for hidden features (`sync-*.spec.ts`, `cowork.spec.ts`, `friends.spec.ts`, `account.spec.ts`): mark them skipped with a one-line reason (`test.skip(CLOUD_FEATURES === false, 'ThoughtNotes hides cloud features')` or equivalent), don't delete them.

## Done when

- The checks in `00-conventions.md` pass, plus the whole Playwright suite (minus the skipped cloud specs).
- `npm run app` launches, and you have checked by hand (screenshot or log) that: the native menu bar shows, ⌘W/red button hides and Dock click restores, PDF export works, the sidebar has no Sync/Account/Sponsor entries, and Settings → Courses still works.
- The merge is a real merge commit (keep upstream history; don't squash), followed by separate commits for the re-applied Mac features and the cloud gating.

## Not in scope

Work mode, formulas, `/meet` (tasks 02–04 build on top of this).
