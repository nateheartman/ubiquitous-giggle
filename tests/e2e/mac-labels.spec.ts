// What a Mac shows: Apple glyphs (⌘ ⇧ ⌥) wherever a shortcut is named, and the
// word "Ctrl" nowhere.
import { test, expect, open } from './fixtures';
import type { Page } from '@playwright/test';

test.use({ platform: 'mac' });

/** Every shortcut hint currently in the page: tooltips' keys and keycaps. */
const hints = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll('[data-tip-key]')].map((e) => e.getAttribute('data-tip-key') ?? '').concat([...document.querySelectorAll('kbd')].map((k) => k.textContent ?? '')));

const noCtrl = (texts: string[]) => expect(texts.filter((t) => /Ctrl|Alt\b/.test(t)), 'hints that still use PC names').toEqual([]);

test('tooltips in the sidebar and title bar use glyphs', async ({ page }) => {
  await open(page);
  const keys = await hints(page);
  expect(keys.length).toBeGreaterThan(5);
  noCtrl(keys);
  expect(keys.some((k) => k.includes('⌘'))).toBe(true);
  // Shown for real, too.
  await page.locator('.sidebar [data-tip="New page"][data-tip-key]').hover();
  await expect(page.locator('.tooltip, [role=tooltip]').first()).toContainText('⌘N');
});

test('the shortcuts sheet is all glyphs', async ({ page, mod }) => {
  await open(page);
  await page.keyboard.press(`${mod}+Slash`);
  const sheet = page.locator('[aria-label="Keyboard shortcuts"]');
  await expect(sheet).toHaveCount(1);
  await expect(sheet).not.toContainText('Ctrl');
  await expect(sheet.locator('kbd', { hasText: '⌘' }).first()).toBeVisible();
  await expect(sheet.locator('kbd', { hasText: '⇧' }).first()).toBeVisible();
  // Back/forward are ⌘[ and ⌘], not Alt+arrows.
  await expect(sheet).not.toContainText('Alt');
  await expect(sheet.locator('kbd', { hasText: '[' }).first()).toBeVisible();
  noCtrl(await hints(page));
});

test('Settings → Keyboard shows glyph keycaps, including the editor list', async ({ page, mod }) => {
  await open(page);
  await page.keyboard.press(`${mod}+Comma`);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await dialog.locator('#settings-keyboard').scrollIntoViewIfNeeded();
  await expect(dialog).not.toContainText('Ctrl');
  await expect(dialog.locator('kbd', { hasText: '⌘' }).first()).toBeVisible();
});

test('the slash menu, bubble menu and page menu have no Ctrl', async ({ page, mod }) => {
  await open(page);
  await page.keyboard.press(`${mod}+n`);
  await page.keyboard.type('Labels');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const menu = page.locator('.suggest');
  await expect(menu).toBeVisible();
  await expect(menu).not.toContainText('Ctrl');
  await expect(menu).not.toContainText('Alt');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');

  await page.keyboard.type('select me');
  await page.keyboard.press(`${mod}+a`);
  const bubble = page.locator('.bubble');
  await expect(bubble.locator('[data-tip="Bold"]')).toBeVisible();
  expect(await bubble.locator('[data-tip-key]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tip-key')))).toEqual(
    expect.arrayContaining(['⌘B', '⌘I', '⌘U', '⇧⌘S', '⌘E', '⇧⌘E', '⇧⌘H', '⌘K']),
  );
  noCtrl(await hints(page));
});

test('"Alt+click" is written ⌥-click', async ({ page }) => {
  await open(page);
  // The empty split pane explains how to fill it.
  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Getting started' }).first().click();
  await page.keyboard.press('Meta+Shift+Backslash');
  const pane = page.locator('.side .pane');
  await expect(pane).toContainText('⌥-click');
  await expect(pane).not.toContainText('Alt+click');
  await expect(pane).not.toContainText('Ctrl');
  await page.keyboard.press('Meta+Shift+Backslash');

  // And the page menu names it on "Open to the Side".
  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Getting started' }).first().click({ button: 'right' });
  const side = page.locator('[role=menuitem], .menu button, .ctx button', { hasText: 'Open to the Side' }).first();
  await expect(side).toContainText('⌥-click');
});

test('the welcome tour never says Ctrl', async ({ page }) => {
  await page.goto('/?fresh&welcome');
  const welcome = page.locator('.welcome');
  await expect(welcome).toHaveCount(1);
  await page.keyboard.type('Alex');
  const next = page.locator('.welcome .nav .btn.primary');
  for (let i = 0; i < 3; i++) {
    await expect(welcome).not.toContainText('Ctrl');
    await expect(welcome).not.toContainText('Alt+');
    await next.click();
  }
  await expect(welcome).not.toContainText('Ctrl');
  expect(await hints(page)).not.toContain('Ctrl');
});
