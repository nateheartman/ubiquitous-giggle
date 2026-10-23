/**
 * Choosing the folder notes are kept in (Settings → Storage): copy them to
 * a folder of your own (OneDrive, a USB drive…), open notes a folder already
 * has, or go back to ThoughtNotes's own folder. Each restarts the app.
 */

import { open } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { api } from './api';
import { databases } from './databases.svelte';
import { planner } from './planner.svelte';
import { store } from './store.svelte';
import { ui } from './ui.svelte';

/** Saves everything waiting, then has the Rust side switch folders, then restarts. */
async function switchFolder(change: () => Promise<void>) {
  const toast = ui.toast('Moving your notes…', undefined, 120_000);
  try {
    window.dispatchEvent(new Event('td:flush'));
    await Promise.all([store.flush(), planner.flush(), databases.flush()]);
    await change();
    await relaunch();
  } catch (e) {
    ui.dismissToast(toast);
    ui.error(e);
  }
}

export async function chooseDataFolder() {
  let dir: string | string[] | null;
  try {
    dir = await open({ directory: true, title: 'Choose a folder for your notes' });
  } catch (e) {
    ui.error(e);
    return;
  }
  if (typeof dir !== 'string') return;
  try {
    const { hasNotes, modified } = await api.dataFolderCheck(dir);
    if (hasNotes) {
      const when = modified ? `, last changed ${new Date(modified).toLocaleString()}` : '';
      const ok = await ui.confirm({
        title: 'Open the notes in that folder?',
        message: `${dir} already has ThoughtNotes notes${when}. ThoughtNotes will restart with those instead of the notes you have open, which stay where they are. To move the notes you have open, choose an empty folder.`,
        confirmLabel: 'Open Those Notes',
      });
      if (ok) await switchFolder(() => api.dataFolderMove(dir, true));
    } else {
      const ok = await ui.confirm({
        title: 'Keep your notes in this folder?',
        message: `Your notes and files are copied to ${dir}, and ThoughtNotes restarts using them. The folder they're in now keeps its copy as a backup. Don't open the same folder from two computers at once.`,
        confirmLabel: 'Move Notes',
      });
      if (ok) await switchFolder(() => api.dataFolderMove(dir, false));
    }
  } catch (e) {
    ui.error(e);
  }
}

/** Back to ThoughtNotes's own folder. `missing`: the chosen one wasn't
 *  there, so the notes open now are in ThoughtNotes's folder already. */
export async function useDefaultDataFolder(missing = false) {
  const ok = await ui.confirm(missing ? {
    title: 'Keep using this folder?',
    message: "ThoughtNotes stops looking for the folder you chose and keeps using the notes in its own folder, the ones open now. Nothing in the folder you chose is touched.",
    confirmLabel: 'Use This Folder',
  } : {
    title: "Go back to ThoughtNotes's own folder?",
    message: "Your notes and files are copied back to ThoughtNotes's own folder, and it restarts using them. The folder you chose keeps its copy, and any older notes in ThoughtNotes's folder are put aside in a \"Replaced\" folder, not deleted.",
    confirmLabel: 'Move Notes Back',
  });
  if (ok) await switchFolder(() => api.dataFolderReset());
}

/** At start-up: a chosen folder that wasn't there (a drive not plugged in). */
export async function warnIfFolderMissing() {
  const info = await api.dataInfo().catch(() => null);
  if (!info?.missingDir) return;
  ui.toast(
    `Your notes folder (${info.missingDir}) isn't there, so ThoughtNotes opened its own folder. Connect the drive and restart.`,
    { label: 'Restart', run: () => void relaunch() },
    30_000,
  );
}
