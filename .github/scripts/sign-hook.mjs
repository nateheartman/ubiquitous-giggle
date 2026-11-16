// The release build's signing hook. Tauri runs it on each file it would sign
// (bundle.windows.signCommand, which .github/workflows/release.yml sets), and
// NSIS on the uninstaller it makes. The signing itself happens in SignPath,
// between two builds:
//
//   SIGN_HOOK=out  the first build hands out the app and the uninstaller,
//                  as they go into the installer, to $SIGN_HOOK_DIR/out;
//   SIGN_HOOK=in   the second build puts the signed ones from
//                  $SIGN_HOOK_DIR/in in their place.
//
// The installer itself is signed after the second build, as a whole. The NSIS
// plugin DLLs it unpacks are left as they come: they're built by NSIS and
// Tauri, and SignPath signs only what this project builds.
import fs from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
const mode = process.env.SIGN_HOOK;
const dir = process.env.SIGN_HOOK_DIR;
if (!file || !fs.existsSync(file) || (mode !== 'out' && mode !== 'in') || !dir) {
  console.error('sign-hook: for the release workflow, with SIGN_HOOK=out or in, SIGN_HOOK_DIR and a file to sign.');
  process.exit(1);
}

const name = path.basename(file);
// NSIS hands over the uninstaller under a temporary name, so it's the file
// that's none of the others.
const kind = /\.dll$/i.test(name) ? 'plugin' : /-setup\.exe$/i.test(name) ? 'installer' : name === 'thought-desk.exe' ? 'app' : 'uninstaller';
const as = { app: 'thought-desk.exe', uninstaller: 'uninstall.exe' }[kind];

if (!as) {
  console.error(`sign-hook: ${kind} ${name} left as it is`);
} else if (mode === 'out') {
  const to = path.join(dir, 'out', as);
  // One of each: a second would be a file this hook doesn't know about.
  if (fs.existsSync(to)) {
    console.error(`sign-hook: ${as} was already handed out, so what is ${file}?`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(file, to);
  console.error(`sign-hook: handed out ${as} (${name})`);
} else {
  const from = path.join(dir, 'in', as);
  if (!fs.existsSync(from)) {
    console.error(`sign-hook: there's no signed ${as} in ${path.dirname(from)}`);
    process.exit(1);
  }
  fs.copyFileSync(from, file);
  console.error(`sign-hook: put the signed ${as} in place of ${name}`);
}
