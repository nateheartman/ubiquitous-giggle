/**
 * The macOS menu bar and window lifecycle, frontend half (see src-tauri/src/menu.rs).
 *
 * The native menu emits `td-menu` with an id. Most ids are shortcut ids and
 * run the same action as the keyboard shortcut. `savePdf` exports the open
 * page; `quit` flushes everything and then asks Rust to exit.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { CloseRequestedEvent } from '@tauri-apps/api/window';
import { exportPdf } from './page-actions';
import { store } from './store.svelte';
import type { ShortcutId } from './shortcuts.svelte';

const isMacOS = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

/**
 * Starts listening for menu events.
 * @param run runs an app-wide shortcut action by id
 * @param flush saves everything that is waiting to be written
 */
export async function installMenuEvents(run: (id: ShortcutId) => void, flush: () => Promise<unknown>): Promise<() => void> {
  if (!isMacOS) return () => {};
  const unlisten = await listen<string>('td-menu', async (event) => {
    const id = event.payload;
    if (id === 'quit') {
      try {
        window.dispatchEvent(new Event('td:flush'));
        await flush();
      } finally {
        await invoke('quit_app');
      }
    } else if (id === 'savePdf') {
      if (store.currentId) void exportPdf(store.currentId);
    } else {
      run(id as ShortcutId);
    }
  }).catch(() => () => {});
  return unlisten;
}

/**
 * Called at the end of the window's close handler, after the flush. On macOS
 * the red button hides the window instead of closing it (the app keeps running
 * in the Dock); everywhere else the close goes ahead.
 */
export async function hideInsteadOfClose(event: CloseRequestedEvent): Promise<void> {
  if (!isMacOS) return;
  event.preventDefault();
  await invoke('hide_main_window');
}
