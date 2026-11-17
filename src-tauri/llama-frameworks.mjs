// Gathers llama.cpp's dylibs (meeting summaries, see Cargo.toml) into
// src-tauri/frameworks/, which tauri.macos.conf.json ("files") ships in
// Contents/Frameworks. Runs as the bundle's beforeBundleCommand, after the
// Rust build: for a universal build the two architectures' copies are joined
// with lipo; otherwise the one build's copies are taken as they are.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DYLIBS = ['libllama.0.dylib', 'libllama-common.0.dylib', 'libggml.0.dylib', 'libggml-base.0.dylib', 'libggml-cpu.0.dylib', 'libggml-metal.0.dylib'];

const here = dirname(fileURLToPath(import.meta.url));
const target = process.env.CARGO_TARGET_DIR || join(here, 'target');
const triple = process.env.TAURI_ENV_TARGET_TRIPLE || '';
const profile = process.env.TAURI_ENV_DEBUG === 'true' ? 'debug' : 'release';
const out = join(here, 'frameworks');

if (process.platform === 'darwin') {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const dirs =
    triple === 'universal-apple-darwin'
      ? ['aarch64-apple-darwin', 'x86_64-apple-darwin'].map((t) => join(target, t, profile))
      : // Tauri names the host's triple even for a plain build (which writes to target/<profile>), so take whichever has the libraries.
        [[join(target, triple, profile), join(target, profile)].find((d) => triple && existsSync(join(d, DYLIBS[0]))) ?? join(target, profile)];
  for (const lib of DYLIBS) {
    const parts = dirs.map((d) => join(d, lib));
    const missing = parts.find((p) => !existsSync(p));
    if (missing) throw new Error(`llama.cpp library not built: ${missing}`);
    if (parts.length > 1) execFileSync('lipo', ['-create', ...parts, '-output', join(out, lib)]);
    else copyFileSync(parts[0], join(out, lib)); // follows the symlink to the versioned file
  }
  console.log(`llama.cpp: ${DYLIBS.length} libraries in ${out}`);
}
