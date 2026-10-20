// Keyboard behaviour with the platform forced to macOS (the UA stays Chromium's):
// ⌘ is Mod, Control is not, and labels use Apple glyphs.
import { test, expect, open } from './fixtures';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { __TD_PLATFORM__?: string }).__TD_PLATFORM__ = 'mac';
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel', configurable: true });
  });
});

test('⌘K opens search; Ctrl+K does not', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(300);
  await expect(page.getByPlaceholder('Search pages, assignments, events and files')).toHaveCount(0);
  await page.keyboard.press('Meta+k');
  await expect(page.getByPlaceholder('Search pages, assignments, events and files')).toBeVisible();
});

test('tooltips and hints use Apple glyphs', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Meta+Slash');
  await expect(page.locator('.foot kbd', { hasText: '⌘' })).toBeVisible();
  await expect(page.locator('kbd', { hasText: 'Ctrl' })).toHaveCount(0);
});
