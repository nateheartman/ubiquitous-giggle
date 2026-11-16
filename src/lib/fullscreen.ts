import { getCurrentWindow } from '@tauri-apps/api/window';

/** macOS hides the traffic lights in fullscreen: mirror that onto <html> so the
 *  room kept for them (app.css: --traffic-lights) is given back. */
export function watchFullscreen() {
  try {
    const win = getCurrentWindow();
    const sync = async () => {
      try {
        document.documentElement.toggleAttribute('data-fullscreen', await win.isFullscreen());
      } catch {
        /* the browser stand-in has no window */
      }
    };
    void sync();
    void win.onResized(sync).catch(() => {});
  } catch {
    /* not running inside Tauri */
  }
}
