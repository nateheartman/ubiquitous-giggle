// Makes what a release publishes (.github/workflows/release.yml).
//
//   node release-files.mjs windows <installer> <folder>
//     Puts the Windows installer, once SignPath has signed it, in the folder
//     under the name GitHub will show, with its update signature (made with
//     the key in TAURI_SIGNING_PRIVATE_KEY and its password). The macOS and
//     Linux updates get theirs from `tauri build` itself.
//
//   node release-files.mjs publish <folder> <notes file>
//     Writes latest.json, which tells installed copies on every system about
//     the release, from the updates and signatures in the folder, and the
//     release's notes. SIGNED=true says the Windows installer is code-signed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
const repo = process.env.GITHUB_REPOSITORY ?? 'kusule1351-hue/thought-desk';
const tag = `v${version}`;
const [mode, ...args] = process.argv.slice(2);

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (mode === 'windows') {
  const [installer, out] = args;
  if (!installer || !out) fail('Usage: node release-files.mjs windows <installer> <folder>');
  // GitHub turns the space in an uploaded file's name into a dot, so the
  // files get that name here, and latest.json points at it.
  const exe = path.join(out, `Thought.Desk_${version}_x64-setup.exe`);
  fs.mkdirSync(out, { recursive: true });
  fs.copyFileSync(installer, exe);
  // The update signature, bound to the version as `tauri build` binds it.
  execFileSync(process.execPath, [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'signer', 'sign', '--app-version', version, exe], { stdio: 'inherit' });
} else if (mode === 'publish') {
  const [dir, notesFile] = args;
  if (!dir || !notesFile) fail('Usage: node release-files.mjs publish <folder> <notes file>');
  // A tag for another version would publish this one under the wrong number.
  if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF_NAME !== tag)
    fail(`The tag ${process.env.GITHUB_REF_NAME} doesn't match the app's version, ${version} (src-tauri/tauri.conf.json).`);

  const files = fs.readdirSync(dir);
  const update = (suffix, optional = false) => {
    const name = files.find((f) => f.endsWith(suffix));
    if (!name || !files.includes(`${name}.sig`)) return optional ? null : fail(`No ${suffix} with its signature in ${dir}.`);
    const signature = fs.readFileSync(path.join(dir, `${name}.sig`), 'utf8');
    return { signature, url: `https://github.com/${repo}/releases/download/${tag}/${name}` };
  };
  // The Mac update is one universal app, for Apple silicon and Intel alike.
  const windows = update('_x64-setup.exe');
  const mac = update('_universal.app.tar.gz');
  // Each Linux copy updates the way it was installed, so there's no entry
  // for Linux as a whole: an AppImage never gets a .deb, nor the other way.
  const appImage = update('_amd64.AppImage');
  const deb = update('_amd64.deb', true);
  const latest = {
    version,
    // The app shows only the version; what's new is on the release page.
    notes: `What's new: https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: new Date().toISOString(),
    platforms: {
      'windows-x86_64': windows,
      'windows-x86_64-nsis': windows,
      'darwin-aarch64': mac,
      'darwin-x86_64': mac,
      'linux-x86_64-appimage': appImage,
      ...(deb && { 'linux-x86_64-deb': deb }),
    },
  };
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(latest, null, 2) + '\n');

  const windowsSigning =
    process.env.SIGNED === 'true'
      ? 'The Windows installer and app are signed: free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org). See the [code signing policy](https://thoughtdesk.org/code-signing).'
      : `The Windows installer isn't code-signed yet, so Windows may show "Windows protected your PC": click **More info**, then **Run anyway**.`;
  fs.writeFileSync(
    notesFile,
    [
      `**Download** below:`,
      ``,
      `- **Windows 10 and 11:** \`Thought.Desk_${version}_x64-setup.exe\``,
      `- **macOS** (Apple silicon and Intel): \`Thought.Desk_${version}_universal.dmg\``,
      `- **Linux:** \`Thought.Desk_${version}_amd64.AppImage\`, or \`Thought.Desk_${version}_amd64.deb\` for Debian and Ubuntu`,
      ``,
      `Already on 0.5.1 or later? Thought Desk offers this update by itself.`,
      ``,
      windowsSigning,
      ``,
    ].join('\n'),
  );
  console.log(`latest.json and the notes for ${tag} are ready, with ${files.length} files in ${dir}.`);
} else {
  fail('Usage: node release-files.mjs windows|publish …');
}
