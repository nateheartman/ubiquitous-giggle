/**
 * Platform detection and the display side of keyboard shortcuts.
 *
 * "Mod" is the platform's command key: ⌘ on macOS, Ctrl elsewhere. On macOS
 * Ctrl is a separate modifier (Ctrl+click is a right-click, Ctrl+letter are
 * text-editing bindings), so it must never count as Mod there.
 *
 * Tests can force a platform by setting `globalThis.__TD_PLATFORM__` to
 * 'mac' (or anything else) before this module loads.
 */

function detectMac(): boolean {
  const forced = (globalThis as { __TD_PLATFORM__?: string }).__TD_PLATFORM__;
  if (forced !== undefined) return forced === 'mac';
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const p = nav.userAgentData?.platform || nav.platform || '';
  // iPhone/iPad report "iPhone"/"iPad"; they aren't targets, so Mac only.
  return /mac/i.test(p) || (!p && /Macintosh|Mac OS X/.test(nav.userAgent || ''));
}

export const isMac: boolean = detectMac();

type ModEvent = Pick<KeyboardEvent, 'ctrlKey' | 'metaKey'>;

/** Is the command modifier held (⌘ on Mac, Ctrl elsewhere)? Ctrl does not count on Mac. */
export const isModKey = (e: ModEvent): boolean => (isMac ? e.metaKey : e.ctrlKey);

/** Is Mac's Control held? Always false elsewhere (there it is Mod). */
export const isCtrlOnly = (e: ModEvent): boolean => isMac && e.ctrlKey;

/** True when no command-ish modifier is held (Ctrl, ⌘ or Alt/⌥). */
export const noMods = (e: Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'altKey'>): boolean =>
  !e.ctrlKey && !e.metaKey && !e.altKey;

const MAC_GLYPHS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' };
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod'];
const PC_NAMES: Record<string, string> = { Mod: 'Ctrl' };

/**
 * The parts of a combo as keycaps: modifiers (Mod, Ctrl, Alt, Shift) first,
 * then the key (already a display name). Apple order ⌃⌥⇧⌘ on Mac.
 */
export function formatKeys(parts: string[]): string[] {
  if (!isMac) return parts.map((p) => PC_NAMES[p] ?? p);
  const mods = MAC_ORDER.filter((m) => parts.includes(m)).map((m) => MAC_GLYPHS[m]);
  return [...mods, ...parts.filter((p) => !MAC_ORDER.includes(p))];
}

/** Joined for a tooltip: "Ctrl+Shift+L", or "⇧⌘L" on Mac. */
export const joinKeys = (keys: string[]): string => keys.join(isMac ? '' : '+');

/**
 * Label for a human-written combo such as "Mod+Shift+E" or "Alt+click":
 * "Ctrl+Shift+E" / "⇧⌘E", "Alt+click" / "⌥-click" (a trailing "click" is
 * written with a hyphen on Mac). Keys are shown as given.
 */
export function modLabel(combo: string): string {
  const parts = combo.split('+');
  const last = parts[parts.length - 1];
  if (isMac && last === 'click') {
    return joinKeys(formatKeys(parts.slice(0, -1))) + '-click';
  }
  return joinKeys(formatKeys(parts));
}

/** Keycaps for a human-written combo: ["Ctrl", "K"] / ["⌘", "K"]. */
export const modKeys = (combo: string): string[] => formatKeys(combo.split('+'));

/** The name of the Alt key: "Alt" / "⌥". */
export const altLabel: string = isMac ? '⌥' : 'Alt';
/** The name of the command key: "Ctrl" / "⌘". */
export const modName: string = isMac ? '⌘' : 'Ctrl';
