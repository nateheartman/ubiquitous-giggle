/**
 * What every interface test starts from: a fresh browser (so the stand-in
 * storage is empty and seeds the example pages), and a watch on the page's
 * errors. A test fails if the app throws or logs an error, even when every
 * step it checks went right.
 */
import { test as base, expect, type Page } from '@playwright/test';

export type EmulatedPlatform = 'win' | 'mac';

export const test = base.extend<{ errors: string[]; platform: EmulatedPlatform; emulate: void; mod: 'Meta' | 'Control' }>({
  /**
   * The OS the app thinks it runs on. The suite defaults to Windows/Linux
   * shortcuts (Ctrl) whatever the host is; `test.use({ platform: 'mac' })`
   * (or the `mac` project) makes the page a Mac: __TD_PLATFORM__ for the app and
   * navigator.platform for ProseMirror's own "Mod-" mapping.
   */
  platform: ['win', { option: true }],
  emulate: [
    async ({ page, platform }, use) => {
      await page.addInitScript((p) => {
        (globalThis as { __TD_PLATFORM__?: string }).__TD_PLATFORM__ = p;
        Object.defineProperty(navigator, 'platform', { get: () => (p === 'mac' ? 'MacIntel' : 'Win32'), configurable: true });
      }, platform);
      await use();
    },
    { auto: true },
  ],
  /** The app's command key under the emulated platform ('Meta' = ⌘ on Mac, else 'Control'). */
  mod: async ({ platform }, use) => {
    await use(platform === 'mac' ? 'Meta' : 'Control');
  },
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(`uncaught: ${e.stack ?? e}`));
      page.on('console', (m) => {
        // Full Chrome (unlike the headless shell) asks for a favicon the dev server lacks.
        if (m.type() === 'error' && !m.location().url.endsWith('/favicon.ico')) errors.push(`console: ${m.text()}`);
      });
      await use(errors);
      expect(errors, 'errors in the page').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** Opens the app (with `query`, like '?fresh') and waits for it to be ready to use. */
export async function open(page: Page, query = '') {
  await page.goto('/' + query);
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);
}

/** The mod key as Playwright names it: shortcuts use Ctrl on Windows and Linux. */
export const MOD = 'Control';

/**
 * The key for the browser's own editing commands (copy, select all) while the
 * page pretends to be Windows: Chrome on a Mac host only does those with Cmd,
 * and the app (not seeing Ctrl) leaves them alone. Playwright's `ControlOrMeta`
 * follows the host, which is exactly what native commands need.
 */
export const NATIVE_MOD = 'ControlOrMeta';
