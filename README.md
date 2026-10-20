# ThoughtNotes

## About this fork

ThoughtNotes is a macOS-native fork of [Thought Desk](https://github.com/kusule1351-hue/thought-desk) by Kusule. It keeps the same Rust + Tauri 2 + Svelte 5 core and adds native traffic-light window chrome, a real menu bar, Command-key shortcuts, Finder wording, and `.app` / `.dmg` bundles. Windows builds keep working. Like upstream, it is licensed under **AGPL-3.0-or-later**; the original copyright belongs to Kusule.

## Build on macOS

```sh
# Toolchain (Xcode Command Line Tools are enough)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin

npm ci
npm run app          # dev build with hot reload
npm run bundle       # release build: src-tauri/target/release/bundle/macos/ThoughtNotes.app and bundle/dmg/*.dmg

# Universal (Apple Silicon + Intel) build
npm run tauri -- build --target universal-apple-darwin
# output: src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/
```

Local builds are ad-hoc signed, not notarized. If macOS blocks a downloaded copy, right-click the app and choose **Open**, or run `xattr -cr /Applications/ThoughtNotes.app`.

---

A fast, local-first notes workspace in the spirit of Notion: nested pages, a block editor, full-text search, databases, plus assignments, a calendar and a file library that all link together. It has a custom title bar, a vertical sidebar and a black-and-white look with optional accent colors. Built with **Rust + Tauri 2 + TypeScript** (Svelte 5 components).

## Download

**Windows 10 and 11:** get the `_x64-setup.exe` installer (about 3 MB) from the [latest release](https://github.com/kusule1351-hue/thought-desk/releases/latest). The installer isn't code-signed yet, so Windows may show "Windows protected your PC": click **More info**, then **Run anyway**. A Microsoft Store version and Linux builds are coming soon.

## Why it's light

| | Thought Desk | Typical Electron notes app |
|---|---|---|
| Installer / binary | ~4.4 MB exe | 80–200 MB |
| Memory, open | ~115 MB | 300–600 MB |
| Memory, minimized | ~95 MB | unchanged |

*Private working set summed over all processes, measured on Windows 11 with the release build.*

- **System WebView instead of a bundled Chromium.** Tauri renders with the WebView2 runtime that ships with Windows.
- **Tiny frontend runtime.** Svelte compiles to plain DOM code; the JS heap sits around 3–5 MB.
- **Only one editor is alive at a time.** Opening a page destroys the previous editor; the sidebar only loads page titles, never bodies.
- **Trims itself when minimized.** The Rust side hides and suspends the WebView and sets WebView2's memory target to *low*. Everything is restored when the window comes back. See `src-tauri/src/memory.rs`.
- **Size-optimized release profile** (LTO, `opt-level = "s"`, stripped, `panic = "abort"`).

### Built for years of notes

Tested against a workspace of 7,500 pages (a 2 MB book among them), 2,000 files, 3,000 assignments and events, 11,000 open to-dos and 17,000 flashcards:

- **Bodies live apart from the page list.** Listing pages, counting and recent pages never read through page text.
- **Links, to-dos and flashcards are indexed on save.** Backlinks, file usage, Home and the flashcard counts are lookups, not a parse of every page (file usage went from 92 s to 7 ms).
- **Storage work never runs on the UI thread,** so a slow query can't freeze the window.
- **Long lists render as you scroll**: Home, Assignments, Files, Flashcards, tags, Trash and big sidebar folders.
- **Big media streams in chunks.** Audio, video and PDFs are served as byte ranges instead of being read into memory whole.
- **The database gives space back** when you delete things for good.

Databases were tested the same way: a 50,000-row tracker linked to a 5,000-row one, 40 smaller databases, notes on thousands of rows and 100,000 edits:

- **Saving a value takes about 0.2 ms**, and loading every row at start-up about 0.2 s. Rows keep their gallery picture with them, so listing them never reads their pages.
- **A row's place in its database is its own order key,** so deleting or restoring one row never renumbers the other 50,000 (it took over a minute; now it's instant).
- **Big tables stay quick in the window:** rows aren't wrapped one value at a time, sort values are worked out once per row, search remembers each row's text between keystrokes, and rows out of sight skip layout. Sorting 50,000 rows takes about 0.3 s, editing a cell 0.1 s.
- **New rows appear at the top of the view** instead of drawing every row down to the end, and board columns show their first 50 cards with more on request.
- **Nothing piles up:** until a copy first syncs, rows deleted for good leave no note behind in the sync outbox.
- **No leaks:** 40 rounds through databases, pages, Home, the Calendar and search leave the page's memory, elements and listeners where they were.

## Features

- **Welcome screen:** a new install opens on four short steps: your name (Home greets you by it), how the app looks (light, dark or matching the system, an accent color and a writing font, applied as you choose), three things worth knowing (`/`, `Ctrl+K`, Home), and you're set. All of it can be changed in Settings, which can also show the welcome again. People who used the app before don't see it.
- **A gentle first run:** Home shows a "Get set up for the semester" checklist (add courses, bring in your class schedule, add an assignment, make a flashcard deck) that ticks itself off and can be hidden. An empty page offers starters (lecture notes, study guide, flashcards, checklist, database), the Calendar explains how to import a Canvas, Google or Outlook schedule until it has one, and Flashcards offers to start a deck.
- **Page icons:** about 120 line icons for subjects and everyday life (search them, tint them in any label colour), or an emoji if you prefer. Everything the app names itself (courses, lecture notes, the Inbox, database templates) gets a line icon in its course's colour.
- **Split view:** a second page or database beside the one you're on, each with its own editor. Open one with Alt+click (sidebar or a link in your notes), "Open to the Side" in a page's menu, Alt+Enter in search, or the split button / `Ctrl+Shift+\` (an empty side offers recent pages and a search). Or drag: a page from the sidebar onto the right half opens it beside, onto the left opens it there; drag the side pane's header to the left (or the page's name in the title bar to the right) to swap sides or move the open page over. Drag the divider to resize (double-click evens it out), swap sides, or move the side page to the main view. The split and its width are remembered; on a narrow window the side hides until there's room. Page margins follow each pane's width.
- **Block editor:** headings, to-dos, bullets, numbers, toggles, quotes, callouts, code, tables (resizable columns), images, dividers.
- **Math (LaTeX, typeset with KaTeX):** type `$x^2$` for a formula in a sentence, `$$` then Space for one on its own line, or press `Ctrl+Shift+E` (it turns selected text into math). Click a formula to edit it in place; it updates as you type and keeps its last good form while a command is half-typed. Typing `\` suggests commands with a preview, Tab moves between the empty `{}` slots a suggestion leaves (and then out of the group), braces close themselves, and a Symbols palette has structures, Greek letters, operators, relations and arrows (it wraps selected LaTeX, e.g. into `\sqrt{…}`). Arrow keys stop on a formula so Enter edits it; Backspace in an empty one removes it. Chemistry works too (`\ce{2H2 + O2 -> 2H2O}`).
- **Math comes along:** pasting text with `\( \)`, `\[ \]`, `$ $` or `$$ $$` (ChatGPT's copy button, a `.md` or `.tex` file) brings it in typeset along with its headings, lists, bold and code, while prices like "$5 and $10" stay text; pasted KaTeX or MathML pages (ChatGPT, Wikipedia) keep their LaTeX. Flashcards can hold formulas on either side, search finds a formula's LaTeX, Markdown export writes `$…$` / `$$…$$`, and Word export turns every formula into a real, editable Word equation. KaTeX loads the first time a page shows math, with only its woff2 fonts bundled.
- **`/` command menu** with fuzzy matching, and **Markdown shortcuts** (`#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `---`).
- **Block handle:** hover a block, drag `⋮⋮` to move it, click it for *Turn into / Duplicate / Move / Delete*, or press `+` to insert below.
- **Formatting bubble** on selection: bold, italic, underline, strike, code, highlight, links, and turn into.
- **Pages:** nested pages, sub-page blocks (`/page`), and inline page links (`@`) that stay in sync when pages are renamed.
- **Sidebar:** drag pages to reorder or nest, favorites, a Databases section, collapsible sections, resizable width (double-click the edge to reset).
- **Databases:** rows you can see as a **table, board, gallery, list, calendar, chart, timeline or form**, each view with its own filters, sorts, groups and shown properties. Start empty or from nine templates (Tasks, Projects, Reading list, Habit tracker, Study log, Budget, Applications, People, Recipes), import a `.csv` (column types are guessed: numbers, dates, checkboxes, choices, links), or paste rows straight from a spreadsheet. Every row is also a page, with room for notes under its properties; the first picture in it becomes its gallery cover.
- **Properties:** text, number (plain, commas, percent, five currencies; shown as a figure, a bar or a ring), select, multi-select, status (to do / in progress / done stages), date (ranges and times, typed as "Friday" or "tomorrow 3pm"), checkbox, URL, email, phone, **course**, **tags**, **files** from the library, auto ID, created and edited times, **relations** (two-way, to the same or another database) **rollups** (sum, average, count, percent done…) and **buttons**. Changing a property's type converts its values.
- **Timeline:** rows as bars from their start date to their end (one date with a range, or two date properties), on a scale of days, weeks, months or quarters. Drag a bar to move it, drag its ends to change how long it runs, and click an empty lane to give a row without a date one.
- **Forms:** a form view is the quickest way to add a row: one question per property (choices as buttons, dates and links with their pickers), required questions, and a heading and note of your own. *Edit form* picks and orders the questions.
- **Templates:** a template is a row to start from: its values, icon and page (a checklist, headings, a quote to fill in) are copied into each new row. Make one from the *New* button's menu or save any row as one (*Save as Template*); edit it like any row, and make it the default for a view or for every view.
- **Sub-items:** turn them on in a table or list's settings and rows can sit under other rows, folded until opened. Each row's parent and sub-items are a two-way relation, so they also show on the row's page, in rollups and in formulas.
- **Buttons and automations:** a button property does something in one click (set properties, add a row to any database and link it back, open the page or a link). Automations do the same on their own when a row is added or a property changes: *when Status becomes Done, set Finished to today*. They read as sentences, can be switched off, and their changes undo together with the edit that set them off.
- **Formulas:** `{Price} * {Qty}` or `if({Done}, "✓", "")`, with 53 functions for logic, math, text, dates and lists. The editor autocompletes properties and functions, explains each one, and shows the result for a real row as you type; renaming a property updates the formulas that use it.
- **Fast to work in:** a spreadsheet-like table (arrow keys, `Enter` or just start typing to edit, `Tab`, `Shift`+arrows to select, `Ctrl+C` / `Ctrl+V`, `Ctrl+D` fills down, `Delete` clears, `Ctrl+Enter` opens the row), column summaries (sum, average, count, percent checked…), drag cards between board columns, drag rows to reorder, filters for every type, with dates like "this week" or "within the next 7 days", and its own undo and redo.
- **Databases fit in:** `/database` puts a new one inside a page and `/linked database` shows an existing one there, with its own view. Rows with a date show on the Calendar and can be dragged to another day, `Ctrl+K` finds rows by any value, course, tag and file properties use the app's own courses, tags and library, and databases share Trash, Favorites, Duplicate and CSV export with pages.
- **Home:** the start screen: today's events, what's due soon, open to-dos from every page, recent pages and files, and your tags.
- **Quick Capture:** `Ctrl+Shift+Space` (even while the app is in the background) or the box on Home. Save a to-do or a note to your Inbox page, or an assignment or event straight to the planner.
- **Tags** on pages, assignments, events and files, with colors, a sidebar section, a page per tag, and `#tag` search.
- **Backlinks:** pages, assignments and events show which pages link to them ("Linked from").
- **To-dos roll up:** checkboxes written in any page collect on Home, where you can check them off.
- **Assignments:** due dates (with optional times), courses with colors, status (to do / in progress / done), priority, notes, attachments and a linked notes page. Grouped as Overdue, Today, Tomorrow, This Week, Later; quick add, course filters and search.
- **Calendar:** month view with a day agenda (due assignments, events, pages written that day) and a week view with a time grid. Events can be all-day or timed, span days, repeat daily/weekly/monthly, carry a course, color and location, and link a notes page. Drag events and assignments to reschedule.
- **One session of a repeat:** open a class from the calendar and choose *This Event* or *All Events*. Changing, dragging or deleting just one session splits it off the series, which skips that date; *Skip This Date* and *Delete Series* sit side by side.
- **Calendar import:** bring in a `.ics` file from Canvas, Google Calendar or Outlook (Calendar → Import, Settings, or `Ctrl+K`). A preview lets you pick what to import and whether each entry is an event or an assignment. Time zones are converted, weekly "Mon/Wed/Fri" classes become one repeat per weekday, skipped and moved sessions carry over, and Canvas "Title [Course]" entries are matched to courses (created if needed). Importing the same file again updates instead of duplicating.
- **Course hubs:** each course has a page of its own (sidebar → Courses): the next two weeks of classes, open assignments, notes, files from its assignments, and details (teacher, email, office hours, room).
- **Lecture notes in one click:** *Take Notes* on a class (in the calendar, Home, a course hub or the event sheet) opens a dated page, "Biology lecture — Oct 14", filed inside the course's notes folder and linked to that exact session. The course's *Take Notes* button picks the class under way.
- **Flashcards:** type `/flashcard` in any page for a card with a front and a back (Enter moves to the back, then on to the next card, so a whole deck can be typed in one go). Every page with cards is a deck; the Flashcards view (`Ctrl+5`) groups decks by course and shows what's due, new and mastered. Study sessions use spaced repetition (Again / Hard / Good / Easy, keys `1`–`4`, `Space` to flip), so each card comes back just before you'd forget it. *Study* buttons sit on the deck's page, its course and Home's summary.
- **Grades:** give an assignment a score (points earned / possible) and a category. Each course shows its current grade and letter, weighted by category ("Exams 60%, Labs 40%") or by total points when there are no weights; weights are edited right on the course page.
- **Export as PDF or Word:** *Export as PDF* opens the print dialog with just the page, in light colors (choose *Save as PDF*). *Export as Word* writes a real `.docx` to Downloads, with Word heading styles, lists, to-dos, tables, images, code and flashcards, ready to hand in. Markdown export is still there too.
- **Reminders:** system notifications the evening before (or the morning of) a due date, an hour before anything with a due time, and 5–30 minutes before timed events. They're scheduled on the Rust side, so they fire even while the window is minimized.
- **Files:** one library for everything you add: imports, drops, attachments and images in pages. Grid or list, filters by type and an *Unused* filter, previews for images, PDFs, audio, video and text, *Open in default app*, *Show in folder*, *Save a copy*, and where each file is used.
- **One workspace:** `@` links a page to pages, assignments, events or files (assignment chips show a live check and due date); `/assignment`, `/event` and `/file` create or insert them from a page; a notes page links back to its assignment; due assignments show in the calendar; files dropped anywhere land in the library.
- **Search:** `Ctrl+K` over pages (SQLite FTS5 with prefix matching and a substring fallback), assignments, events and files, with quick *Go to* and *Create* actions.
- **Trash:** one trash for pages, assignments, events and files: soft delete with *Undo*, restore (pages with their sub-pages), permanent delete, empty trash.
- **Custom title bar:** back/forward, breadcrumbs, save status, favorite, page menu, and Windows-style window controls. Drag anywhere on the bar; double-click maximizes.
- **Settings:** light / dark / system theme, six color themes (Default, Paper, Slate, Sage, Rose, Dusk) plus **Custom**, made on a color wheel (pick a hue and how strongly it tints; light and dark versions are generated with readable text), accent color (Graphite, nine colors, or any color from a wheel, brightness slider or hex code), Default / Serif / Mono page fonts, small text, spell check, Quick Capture from anywhere, first day of the week, calendar import, reminders, courses.
- **Your own keyboard shortcuts:** Settings → Keyboard Shortcuts lists every command; click one and press new keys. Clashes are caught (a shortcut moves from the command that had it; editor keys like Ctrl+B are kept), Backspace removes a shortcut, and each can be reset. Tooltips follow your choices, and the system-wide Quick Capture key re-registers with Windows.
- Window size and position are remembered, a second launch focuses the running window, and changes autosave and are flushed on close/minimize.

## Keyboard

| Keys | Action |
|---|---|
| `Ctrl+K` / `Ctrl+P` | Search (with text selected in the editor, `Ctrl+K` adds a link) |
| `Ctrl+N` | New page |
| `Ctrl+Shift+Space` | Quick Capture (system-wide when enabled in Settings) |
| `Ctrl+1` … `Ctrl+5` | Home / Assignments / Calendar / Files / Flashcards |
| `←` / `→`, `T` | Calendar: previous or next month or week, today |
| `Ctrl+\` | Toggle sidebar |
| `Ctrl+Shift+\` | Split view |
| `Alt+←` / `Alt+→`, mouse back/forward | Navigate history |
| `Ctrl+Shift+L` | Toggle dark mode |
| `Ctrl+,` | Settings |
| `Ctrl+/` | Every shortcut on one sheet |
| `Ctrl+Shift+E` | Inline math (or turn the selection into math) |
| `Ctrl+D` | Duplicate block |
| `Ctrl+Click` on a link | Open in browser |
| `Ctrl+Z` / `Ctrl+Y` in a database | Undo / redo database edits |

These are the defaults; every app shortcut can be changed in Settings → Keyboard Shortcuts.

## Develop

Requirements: Node 20+, Rust (stable, MSVC toolchain on Windows), WebView2 runtime (preinstalled on Windows 10/11).

```bash
git clone https://github.com/kusule1351-hue/thought-desk.git
cd thought-desk
npm install
npm run app        # desktop app with hot reload (tauri dev)
npm run dev        # UI only, in a browser, with an in-memory fake backend
npm run check      # type-check the frontend
npm run e2e        # interface tests: drive the UI in Chromium (tests/e2e)
npm run bundle     # release build + Windows installer
```

```bash
cd src-tauri && cargo test   # storage tests
cd src-tauri && cargo test --release stress -- --ignored --nocapture --exact stress::stress   # heavy-workspace benchmark
cd src-tauri && cargo test --release stress_databases -- --ignored --nocapture                # 55,000-row database benchmark
```

## Data

Everything lives in one SQLite database (`thoughtdesk.db`, WAL mode) plus a `files/` folder for the file library (stored under random names; the database keeps their real names). On Windows that's `%APPDATA%\app.thoughtdesk.desktop\`, and **Settings → Storage** shows the exact path. Back up that folder to back up your notes.

Set `THOUGHTDESK_DATA_DIR` to use a different folder, e.g. a portable copy on a USB drive.

**Ready for sync.** Databases are stored so that two copies can later be merged without a server deciding who wins. Each install has a device id; every edit to a cell, property, view, automation or row's title, icon, place or deletion carries a hybrid logical clock stamp, and changed records are queued in an outbox. Merging keeps the newest stamp per cell, so two people editing different cells of the same row both keep their edits; deleted properties and views stay as tombstones so a deletion can't be undone by an older copy. Row order uses fractional keys, so moving a row never renumbers the others. The `sync_pending` / `sync_apply` / `sync_sent` commands are the hooks an online service will use (`src-tauri/src/sync.rs`, `databases.rs`). Page bodies and the rest of the workspace aren't stamped yet.

## Layout

```
src/                     TypeScript + Svelte UI
  App.svelte             shell, global shortcuts, window show/close handling
  lib/store.svelte.ts    page tree state, navigation history (pages and views), debounced saving
  lib/planner.svelte.ts  courses, assignments and events
  lib/library.svelte.ts  the file library
  lib/tags.svelte.ts     tags; lib/todos.svelte.ts to-dos rolled up from pages; lib/capture.ts Quick Capture
  lib/databases.svelte.ts databases: rows, values, saving, undo, import and export
  lib/db/                database views (table, board, gallery, list, calendar, chart, timeline, form), pickers, formula
                         language, query engine (filters, sorts, groups), templates, CSV, order keys
  lib/editor/            TipTap editor: slash menu, @-links, block handle, callouts, file blocks…
  lib/views/             Home, Assignments, Calendar (month and week), Files and tag pages
  lib/sheets/            assignment and event editors, file preview
  lib/components/        sidebar, title bar, search, settings, trash, menus
  lib/ui/                shared controls: segmented control, switch, swatches, rows…
  dev-mock.ts            fake backend for `npm run dev` (dev only, not bundled)
tests/e2e/               interface tests (Playwright), run against `npm run dev`
src-tauri/src/
  db.rs                  SQLite schema and migrations, page tree, trash, FTS search (+ tests)
  planner.rs             courses, assignments, events (+ tests)
  library.rs             file library: import, rename, usage (+ tests)
  organize.rs            tags, backlinks, to-dos rolled up from pages (+ tests)
  commands.rs            Tauri commands
  cards.rs               flashcards: decks, reviews (+ tests)
  databases.rs           database schemas, properties, views, automations, rows and templates, merging copies (+ tests)
  sync.rs                device id, hybrid logical clocks, outbox
  files.rs               `tdfile://` protocol (byte ranges), stray-file cleanup
  stress.rs              heavy-workspace benchmark (`cargo test --release stress -- --ignored`)
  memory.rs              WebView2 suspend/trim while minimized, idle, or after Settings
```

## Contributing

Fixes, measurements and ideas are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up, test and send a pull request. Contributors sign a short [Contributor License Agreement](CLA.md) once, on their first pull request. Questions, ideas or just want to chat? Join the [Discord](https://discord.gg/JEaUHwz5bP).

## License

Copyright (C) 2026 Kusule

Thought Desk is free software: you can redistribute it and/or modify it under the terms of the [GNU Affero General Public License](LICENSE) as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. If you distribute a modified version, or let people use one over a network, you must make its source code available under the same license.

The license covers the code, not the Thought Desk name or logo: forks and redistributed versions need their own name and logo.

The interface uses [Inter](https://rsms.me/inter/) by Rasmus Andersson, bundled under the SIL Open Font License 1.1.
