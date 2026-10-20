// Every default shortcut on a Mac: ⌘ fires it (once), Control does not, and
// Alt+Arrow no longer goes back. Runs in the `mac` project (platform 'mac').
import { test, expect, open } from './fixtures';
import type { Page } from '@playwright/test';

test.use({ platform: 'mac' });

const sidebar = (page: Page) => page.locator('.sidebar');
const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const searchBox = (page: Page) => page.getByPlaceholder('Search pages, assignments, events and files');
const sheet = (page: Page) => page.locator('[aria-label="Keyboard shortcuts"]');
const settings = (page: Page) => page.getByRole('dialog', { name: 'Settings' });
const viewTitle = (page: Page, text: string) => page.locator('.sidebar .nav-main[aria-current=page]', { hasText: text });
const home = (page: Page) => page.locator('h1.view-title').filter({ hasText: /Good|Working/ });

/** Sidebar toggles animate, so wait for it to settle before reading its state. */
const settle = (page: Page) => page.waitForTimeout(500);

test('platform is Mac', async ({ page }) => {
  await open(page);
  expect(await page.evaluate(() => (globalThis as any).__TD_PLATFORM__)).toBe('mac');
  expect(await page.evaluate(() => navigator.platform)).toBe('MacIntel');
});

test.describe('⌘ fires every default shortcut', () => {
  test('⌘K and ⌘P open search; Esc closes it', async ({ page, mod }) => {
    await open(page);
    for (const k of ['k', 'p']) {
      await page.keyboard.press(`${mod}+${k}`);
      await expect(searchBox(page)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(searchBox(page)).toHaveCount(0);
    }
  });

  test('⌘N makes exactly one new page', async ({ page, mod }) => {
    await open(page);
    const count = () => page.locator('[role=tree][aria-label=Pages] .row').count();
    const before = await count();
    await page.keyboard.press(`${mod}+n`);
    await expect(page.locator('h1.title')).toBeFocused();
    await page.keyboard.type('Mac page');
    await expect(page.locator('.sidebar .row', { hasText: 'Mac page' })).toHaveCount(1);
    await settle(page);
    expect(await count()).toBe(before + 1);
  });

  test('⌃⌘S toggles the sidebar exactly once per press', async ({ page, mod }) => {
    await open(page);
    await expect(sidebar(page)).toHaveCount(1);
    await page.keyboard.press(`Control+${mod}+KeyS`);
    await settle(page);
    await expect(sidebar(page)).toHaveCount(0);
    await page.keyboard.press(`Control+${mod}+KeyS`);
    await settle(page);
    await expect(sidebar(page)).toHaveCount(1);
  });

  test('⌘\\ toggles the sidebar exactly once per press', async ({ page, mod }) => {
    await open(page);
    await expect(sidebar(page)).toHaveCount(1);
    await page.keyboard.press(`${mod}+Backslash`);
    await settle(page);
    await expect(sidebar(page)).toHaveCount(0);
    await page.keyboard.press(`${mod}+Backslash`);
    await settle(page);
    await expect(sidebar(page)).toHaveCount(1);
    // A double fire would have left it where it began after one press.
    await page.keyboard.press(`${mod}+Backslash`);
    await settle(page);
    await expect(sidebar(page)).toHaveCount(0);
  });

  test('⌘⇧\\ opens and closes split view', async ({ page, mod }) => {
    await open(page);
    await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Getting started' }).first().click();
    await page.keyboard.press(`${mod}+Shift+Backslash`);
    await expect(page.locator('.side .pane')).toHaveCount(1);
    await page.keyboard.press(`${mod}+Shift+Backslash`);
    await expect(page.locator('.side .pane')).toHaveCount(0);
  });

  test('⌘⇧L switches light/dark once per press', async ({ page, mod }) => {
    await open(page);
    const before = await theme(page);
    await page.keyboard.press(`${mod}+Shift+KeyL`);
    await expect.poll(() => theme(page)).not.toBe(before);
    await settle(page);
    await page.keyboard.press(`${mod}+Shift+KeyL`);
    await expect.poll(() => theme(page)).toBe(before);
  });

  test('⌘, opens Settings', async ({ page, mod }) => {
    await open(page);
    await page.keyboard.press(`${mod}+Comma`);
    await expect(settings(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings(page)).toHaveCount(0);
  });

  test('⌘/ opens and closes the shortcuts sheet', async ({ page, mod }) => {
    await open(page);
    await page.keyboard.press(`${mod}+Slash`);
    await expect(sheet(page)).toHaveCount(1);
    await page.keyboard.press(`${mod}+Slash`);
    await expect(sheet(page)).toHaveCount(0);
  });

  test('⌘1–5 go Home, Assignments, Calendar, Files, Flashcards', async ({ page, mod }) => {
    await open(page);
    const views: [string, string][] = [
      ['2', 'Assignments'],
      ['3', 'Calendar'],
      ['4', 'Files'],
      ['5', 'Flashcards'],
    ];
    for (const [n, title] of views) {
      await page.keyboard.press(`${mod}+${n}`);
      await expect(viewTitle(page, title)).toBeVisible();
    }
    await page.keyboard.press(`${mod}+1`);
    await expect(home(page)).toBeVisible();
  });

  test('⌘[ goes back and ⌘] goes forward', async ({ page, mod }) => {
    await open(page);
    await page.keyboard.press(`${mod}+2`);
    await expect(viewTitle(page, 'Assignments')).toBeVisible();
    await page.keyboard.press(`${mod}+4`);
    await expect(viewTitle(page, 'Files')).toBeVisible();
    await page.keyboard.press(`${mod}+BracketLeft`);
    await expect(viewTitle(page, 'Assignments')).toBeVisible();
    await page.keyboard.press(`${mod}+BracketRight`);
    await expect(viewTitle(page, 'Files')).toBeVisible();
  });

  test('⌘⇧Space opens Quick Capture', async ({ page, mod }) => {
    await open(page);
    await page.keyboard.press(`${mod}+Shift+Space`);
    await expect(page.locator('.modal', { hasText: 'Quick Capture' })).toBeVisible();
  });
});

test.describe('Control does not fire them on a Mac', () => {
  test('Control+<key> does nothing for any default', async ({ page }) => {
    await open(page);
    await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Getting started' }).first().click();
    const before = { theme: await theme(page), rows: await page.locator('.sidebar .row').count(), title: await page.locator('.titlebar').innerText() };
    for (const key of ['k', 'p', 'n', 'Backslash', 'Shift+Backslash', 'Shift+KeyL', 'Comma', 'Slash', 'BracketLeft', 'BracketRight', '1', '2', '3', '4', '5', 'Shift+Space']) {
      await page.keyboard.press(`Control+${key}`);
    }
    await settle(page);
    await expect(searchBox(page)).toHaveCount(0);
    await expect(settings(page)).toHaveCount(0);
    await expect(sheet(page)).toHaveCount(0);
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page.locator('.side .pane')).toHaveCount(0);
    await expect(sidebar(page)).toHaveCount(1);
    expect(await theme(page)).toBe(before.theme);
    expect(await page.locator('.sidebar .row').count()).toBe(before.rows);
    expect(await page.locator('.titlebar').innerText()).toBe(before.title);
  });

  test('Alt+ArrowLeft/Right does not go back or forward', async ({ page, mod }) => {
    await open(page);
    await page.keyboard.press(`${mod}+2`);
    await expect(viewTitle(page, 'Assignments')).toBeVisible();
    await page.keyboard.press('Alt+ArrowLeft');
    await settle(page);
    await expect(viewTitle(page, 'Assignments')).toBeVisible();
    await page.keyboard.press(`${mod}+BracketLeft`);
    await expect(home(page)).toBeVisible();
    await page.keyboard.press('Alt+ArrowRight');
    await settle(page);
    await expect(home(page)).toBeVisible();
  });
});

test.describe('the native menu', () => {
  // src/lib/menu-events.ts listens for the `td-menu` event (the dev mock
  // supports events), which the Rust menu emits with a shortcut id.
  const emit = (page: Page, payload: string) =>
    page.evaluate((p) => (window as any).__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'td-menu', payload: p }), payload);

  test('a td-menu "sidebar" event toggles the sidebar once', async ({ page }) => {
    await open(page);
    await expect(sidebar(page)).toHaveCount(1);
    await emit(page, 'sidebar');
    await settle(page);
    await expect(sidebar(page)).toHaveCount(0);
    await emit(page, 'sidebar');
    await settle(page);
    await expect(sidebar(page)).toHaveCount(1);
  });

  test('td-menu events run other commands (settings, help, goCalendar)', async ({ page }) => {
    await open(page);
    await emit(page, 'settings');
    await expect(settings(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await emit(page, 'help');
    await expect(sheet(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await emit(page, 'goCalendar');
    await expect(viewTitle(page, 'Calendar')).toBeVisible();
  });
});
