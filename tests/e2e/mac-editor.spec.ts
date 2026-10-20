// Editor shortcuts on a Mac: ⌘ is the modifier, Control is not, and Control+click
// is a context-menu click, never ⌘-click.
import { test, expect, open } from './fixtures';
import type { Page } from '@playwright/test';

test.use({ platform: 'mac' });

const doc = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__editor.getJSON()));
const tree = (page: Page, title: string) => page.locator('[role=tree][aria-label=Pages] .row', { hasText: title }).first();

async function newPage(page: Page, title: string, mod: string) {
  await open(page, '?fresh');
  await page.keyboard.press(`${mod}+n`);
  await expect(page.locator('h1.title')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror')).toBeFocused();
}

test('⌘B bolds and ⌘I italicises; Control+B does not', async ({ page, mod }) => {
  await newPage(page, 'Marks', mod);
  await page.keyboard.press('Control+b');
  await page.keyboard.type('plain ');
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.type('strong');
  await page.keyboard.press(`${mod}+b`);
  await page.keyboard.press(`${mod}+i`);
  await page.keyboard.type(' slanted');
  await expect(page.locator('.ProseMirror strong')).toHaveText('strong');
  await expect(page.locator('.ProseMirror em')).toHaveText(' slanted');
  await expect(page.locator('.ProseMirror')).toContainText('plain strong slanted');
});

test('⌘K with text selected makes a link, not a search', async ({ page, mod }) => {
  await newPage(page, 'Links', mod);
  await page.keyboard.type('visit docs');
  await page.keyboard.press('Shift+Home');
  await page.waitForTimeout(400); // the bubble menu follows the selection a beat later
  await page.keyboard.press(`${mod}+k`);
  const input = page.locator('.bubble .link-form input');
  await expect(input).toBeFocused();
  await expect(page.getByPlaceholder('Search pages, assignments, events and files')).toHaveCount(0);
  await page.keyboard.type('example.com');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror a')).toHaveText('visit docs');
  expect(await doc(page)).toContain('example.com');
});

test('⌘K without a selection is search', async ({ page, mod }) => {
  await newPage(page, 'Search', mod);
  await page.keyboard.press(`${mod}+k`);
  await expect(page.getByPlaceholder('Search pages, assignments, events and files')).toBeVisible();
});

test('⌘⇧E opens an inline formula', async ({ page, mod }) => {
  await newPage(page, 'Math', mod);
  await page.keyboard.type('Angle ');
  await page.keyboard.press(`${mod}+Shift+E`);
  await expect(page.locator('.math-pop textarea')).toBeFocused();
  await page.keyboard.type('\\theta');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(page.locator('.math-pop')).toHaveCount(0);
  await expect(page.locator('.math-inline .katex')).toHaveCount(1);
  expect(await doc(page)).toContain('"latex":"\\\\theta"');
});

test('⌘D duplicates the current block', async ({ page, mod }) => {
  await newPage(page, 'Dupes', mod);
  await page.keyboard.type('only once');
  await page.keyboard.press(`${mod}+d`);
  await expect(page.locator('.ProseMirror p', { hasText: 'only once' })).toHaveCount(2);
});

test('⌘Z undoes typing', async ({ page, mod }) => {
  await newPage(page, 'Undo', mod);
  await page.keyboard.type('gone soon');
  await page.waitForTimeout(600);
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('.ProseMirror')).not.toContainText('gone soon');
});

test.describe('clicks', () => {
  test('⌥-click in the sidebar opens the page beside; plain click does not', async ({ page }) => {
    await open(page);
    await tree(page, 'Getting started').click();
    await tree(page, 'Projects').click({ modifiers: ['Alt'] });
    await expect(page.locator('.side .pane-head .name')).toHaveText('Projects');
    await expect(page.locator('.titlebar')).toContainText('Getting started');
  });

  test('Control+click in the sidebar is not ⌘-click or ⌥-click', async ({ page }) => {
    await open(page);
    await tree(page, 'Getting started').click();
    await tree(page, 'Projects').click({ modifiers: ['Control'] });
    // Nothing opens beside; it is an ordinary click (the system's context-menu gesture).
    await expect(page.locator('.side .pane')).toHaveCount(0);
  });

  test('Control+click on a link does not open it; ⌘-click does', async ({ page, mod }) => {
    await newPage(page, 'Open link', mod);
    await page.keyboard.type('docs');
    await page.keyboard.press('Shift+Home');
    await page.waitForTimeout(400);
    await page.keyboard.press(`${mod}+k`);
    await page.keyboard.type('example.com');
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror a')).toHaveCount(1);
    // Record what the app asks the system to open.
    await page.evaluate(() => {
      const w = window as any;
      w.__opened = [];
      const inv = w.__TAURI_INTERNALS__.invoke;
      w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown, o: unknown) => {
        if (/opener/.test(cmd)) {
          w.__opened.push(cmd);
          return Promise.resolve(null);
        }
        return inv(cmd, args, o);
      };
    });
    const link = page.locator('.ProseMirror a');
    await link.click({ modifiers: ['Control'] });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as any).__opened)).toEqual([]);
    await link.click({ modifiers: ['Meta'] });
    await expect.poll(() => page.evaluate(() => (window as any).__opened.length)).toBeGreaterThan(0);
  });
});
