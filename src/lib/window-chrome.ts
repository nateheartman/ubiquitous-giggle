import { getCurrentWindow } from '@tauri-apps/api/window';

import { isMac } from './platform';

export const isMacChrome = isMac;

let started = false;

/**
 * Mirrors native window state onto <html> so CSS can react:
 *   data-platform="mac"  - macOS: native traffic lights replace WindowControls
 *   data-fullscreen      - set while fullscreen (macOS hides the lights, so the
 *                          left inset reserved for them is released)
 * Idempotent; safe to call from several components.
 */
export function startWindowChromeSync() {
  if (started || typeof document === 'undefined') return;
  started = true;
  const root = document.documentElement;
  if (isMacChrome) root.dataset.platform = 'mac';
  if (!isMacChrome) return;
  try {
    const win = getCurrentWindow();
    const sync = async () => {
      try {
        root.toggleAttribute('data-fullscreen', await win.isFullscreen());
      } catch {
        /* not running inside Tauri */
      }
    };
    void sync();
    void win.onResized(sync);
  } catch {
    /* not running inside Tauri */
  }
}
