/** The sidebar items that can be turned off (Pages always shows), and hiding them. */

import { prefs } from './prefs.svelte';
import { ui } from './ui.svelte';

export const SIDEBAR_ITEMS: { key: string; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'assignments', label: 'Assignments' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'files', label: 'Files' },
  { key: 'cards', label: 'Flashcards' },
  { key: 'favorites', label: 'Favorites' },
  { key: 'courses', label: 'Courses' },
  { key: 'databases', label: 'Databases' },
  { key: 'tags', label: 'Tags' },
];

export function shownInSidebar(key: string): boolean {
  return !prefs.sidebarHidden[key];
}

export function setShownInSidebar(key: string, shown: boolean) {
  prefs.sidebarHidden[key] = !shown;
}

/** Right-click on a sidebar item: hide it, or open the list of them all. */
export function sidebarItemMenu(e: MouseEvent, key: string) {
  e.preventDefault();
  e.stopPropagation();
  const label = SIDEBAR_ITEMS.find((i) => i.key === key)?.label ?? key;
  ui.openMenu({
    x: e.clientX,
    y: e.clientY,
    items: [
      {
        label: 'Hide from Sidebar',
        icon: 'eye-off',
        action: () => {
          setShownInSidebar(key, false);
          ui.toast(`${label} is hidden. Settings → Sidebar shows it again.`, { label: 'Undo', run: () => setShownInSidebar(key, true) });
        },
      },
      { label: 'Customize Sidebar…', icon: 'sliders', action: () => (ui.settingsOpen = true) },
    ],
  });
}
