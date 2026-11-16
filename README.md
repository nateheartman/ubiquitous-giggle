# ThoughtNotes

Based on Thought Desk 0.8.4.

## About this fork

ThoughtNotes is a macOS-native fork of [Thought Desk](https://github.com/kusule1351-hue/thought-desk) by Kusule. It keeps the same Rust + Tauri 2 + Svelte 5 core and adds a real menu bar, hide-on-close with Dock reopen, a light-colour PDF export through WKWebView, and `.app` / `.dmg` bundles. Everything upstream has for writing, planning and studying is here: pages inside pages, a block editor, databases with formulas, assignments, a calendar, flashcards, tabs and split view, and Spanish and English interfaces. Windows builds keep working. Like upstream, it is licensed under **AGPL-3.0-or-later**; the original copyright belongs to Kusule.

ThoughtNotes is fully local. Thought Desk's online features (sync, writing together, accounts, sponsor links and its update feed) are switched off in the interface (`src/lib/features.ts`) and never contact the upstream author's servers.

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

Tests, where your notes are stored and how the code is laid out: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Contributors

<table>
<tr>
<td align="center" width="140"><a href="https://github.com/kusule1351-hue"><img src="https://github.com/kusule1351-hue.png?size=120" width="64" height="64" alt=""><br><b>Khuselbayar Enkhmunkh</b></a><br><sub>Creator</sub></td>
<td align="center" width="140"><a href="https://github.com/brandonrbridges"><img src="https://github.com/brandonrbridges.png?size=120" width="64" height="64" alt=""><br><b>Brandon Bridges</b></a><br><sub>Search, indexes and speed</sub></td>
<td align="center" width="140"><a href="https://github.com/huy-victor"><img src="https://github.com/huy-victor.png?size=120" width="64" height="64" alt=""><br><b>Victor Huy</b></a><br><sub>Frozen table columns</sub></td>
<td align="center" width="140"><a href="https://github.com/Kewsito"><img src="https://github.com/Kewsito.png?size=120" width="64" height="64" alt=""><br><b>Kevin Salinas</b></a><br><sub>Spanish translation</sub></td>
</tr>
</table>

Thank you to everyone who has [contributed](https://github.com/kusule1351-hue/thought-desk/graphs/contributors).

## License

Copyright (C) 2026 Kusule; macOS fork by Nate Heartman. Thought Desk and ThoughtNotes are free software under the [GNU Affero General Public License](LICENSE), version 3 or later: if you distribute a modified version, or let people use one over a network, you must share its source under the same license.

The license covers the code, not the Thought Desk name or logo: forks and redistributed versions need their own name and logo. The interface uses [Inter](https://rsms.me/inter/) by Rasmus Andersson, under the SIL Open Font License 1.1.
