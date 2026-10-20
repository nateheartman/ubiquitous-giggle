// Settings → Keyboard on a Mac: a shortcut needs ⌘ (⌥ and Control alone are not
// enough), and the system's own keys are reserved.
import { test, expect, open } from './fixtures';
import type { Page } from '@playwright/test';

test.use({ platform: 'mac' });

const row = (page: Page, label: string) => page.locator('.group-row', { has: page.locator('.row-label', { hasText: new RegExp(`^\\s*${label}(\\s|$)`) }) }).first();

async function record(page: Page, label: string) {
  await open(page);
  await page.keyboard.press('Meta+Comma');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  await row(page, label).locator('.keys-btn').scrollIntoViewIfNeeded();
  await row(page, label).locator('.keys-btn').click();
  await expect(row(page, label).locator('.listening')).toBeVisible();
}

test('a shortcut without ⌘ is refused, with a note naming ⌘', async ({ page }) => {
  await record(page, 'Light or dark');
  for (const combo of ['Control+Shift+KeyJ', 'Alt+KeyJ', 'Shift+KeyJ']) {
    await page.keyboard.press(combo);
    await expect(row(page, 'Light or dark').locator('small.error')).toContainText('⌘');
    await expect(row(page, 'Light or dark').locator('.listening')).toBeVisible();
  }
});

test('⌘ plus a key is accepted and then works', async ({ page }) => {
  await record(page, 'Light or dark');
  await page.keyboard.press('Meta+Shift+KeyJ');
  await expect(row(page, 'Light or dark').locator('.combo')).toHaveText('⇧⌘J');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme);
  const before = await theme();
  await page.keyboard.press('Meta+Shift+KeyJ');
  await expect.poll(theme).not.toBe(before);
  // The old one no longer does.
  await page.waitForTimeout(500);
  const mid = await theme();
  await page.keyboard.press('Meta+Shift+KeyL');
  await page.waitForTimeout(500);
  expect(await theme()).toBe(mid);
});

for (const [key, what] of [
  ['KeyQ', 'Quit'],
  ['KeyW', 'Close window'],
  ['KeyH', 'Hide'],
  ['KeyM', 'Minimize'],
] as const) {
  test(`⌘${key.slice(3)} is reserved (${what})`, async ({ page }) => {
    await record(page, 'Light or dark');
    await page.keyboard.press(`Meta+${key}`);
    const note = row(page, 'Light or dark').locator('small.error');
    await expect(note).toContainText(what);
    await expect(note).toContainText(`⌘${key.slice(3)}`);
    // Still recording: nothing was assigned.
    await expect(row(page, 'Light or dark').locator('.listening')).toBeVisible();
  });
}

test('the default back/forward are ⌘[ and ⌘] in Settings', async ({ page }) => {
  await open(page);
  await page.keyboard.press('Meta+Comma');
  await expect(row(page, 'Back').locator('.combo')).toHaveText('⌘[');
  await expect(row(page, 'Forward').locator('.combo')).toHaveText('⌘]');
});
