// Tabs: each one a place with its own back and forward, like a browser's.
import type { Page } from '@playwright/test';
import { test, expect, open, MOD, CLICK_MOD } from './fixtures';

test.use({ viewport: { width: 1360, height: 820 } });

const tabStrip = (page: Page) => page.locator('.titlebar [role=tablist]');
const tab = (page: Page, name: string) => page.locator('.titlebar [role=tab]', { hasText: name });
const title = (page: Page) => page.locator('.scroller h1.title');
const tree = (page: Page, name: string) => page.locator('[role=tree][aria-label=Pages] .row', { hasText: name }).first();

test('pages open in new tabs, each with its own history', async ({ page }) => {
  await open(page);
  await expect(tabStrip(page), 'one tab: the title bar shows breadcrumbs').toHaveCount(0);

  await test.step('Open in New Tab from the page menu', async () => {
    await tree(page, 'Getting started').click();
    await expect(title(page)).toHaveText('Getting started');
    await page.locator('.titlebar [data-tip="More"]').click();
    await page.getByRole('menuitem', { name: 'Open in New Tab' }).click();
    await expect(page.locator('.titlebar [role=tab]')).toHaveCount(2);
    await expect(tab(page, 'Getting started')).toHaveCount(2);
  });

  await test.step('moving in one tab leaves the other where it was', async () => {
    await tree(page, 'Projects').click();
    await expect(title(page)).toHaveText('Projects');
    await expect(page.locator('.titlebar [role=tab][aria-selected=true]')).toContainText('Projects');
    await tab(page, 'Getting started').click();
    await expect(title(page)).toHaveText('Getting started');
    await tab(page, 'Projects').click();
    await expect(title(page)).toHaveText('Projects');
  });

  await test.step('Back works per tab', async () => {
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(title(page), 'this tab came from Getting started').toHaveText('Getting started');
    await page.keyboard.press('Alt+ArrowRight');
    await expect(title(page)).toHaveText('Projects');
    // The first tab came from Home, not from the other tab's page.
    await tab(page, 'Getting started').click();
    await page.keyboard.press('Alt+ArrowLeft');
    await expect(page.locator('h1.view-title').first()).toBeVisible();
    await expect(page.locator('.titlebar [role=tab][aria-selected=true]')).toContainText('Home');
    await expect(tab(page, 'Projects'), 'the other tab is still on its page').toHaveCount(1);
  });
});

test('Ctrl+click and middle-click open in the background; shortcuts switch and close', async ({ page }) => {
  await open(page);
  await tree(page, 'Getting started').click();

  await tree(page, 'Projects').click({ modifiers: [CLICK_MOD] });
  await tree(page, 'Study plan').click({ button: 'middle' });
  await expect(page.locator('.titlebar [role=tab]')).toHaveCount(3);
  await expect(title(page), 'background tabs leave this one showing').toHaveText('Getting started');

  // In the order they were opened: Getting started, Projects, Study plan.
  await page.keyboard.press(`${MOD}+Tab`);
  await expect(title(page)).toHaveText('Projects');
  await page.keyboard.press(`${MOD}+Tab`);
  await expect(title(page)).toHaveText('Study plan');
  await page.keyboard.press(`${MOD}+Shift+Tab`);
  await expect(title(page)).toHaveText('Projects');

  await page.keyboard.press(`${MOD}+w`);
  await expect(page.locator('.titlebar [role=tab]')).toHaveCount(2);
  await expect(tab(page, 'Projects')).toHaveCount(0);
  await expect(title(page), 'closing shows the next tab').toHaveText('Study plan');

  // Middle-click a tab closes it; the last tab can't be closed.
  await tab(page, 'Study plan').click({ button: 'middle' });
  await expect(tabStrip(page)).toHaveCount(0);
  await expect(title(page)).toHaveText('Getting started');
  await page.keyboard.press(`${MOD}+w`);
  await expect(title(page)).toHaveText('Getting started');
});

test('a new tab opens on Home, and tabs come back after a restart', async ({ page }) => {
  await open(page);
  await tree(page, 'Getting started').click();
  await page.locator('.titlebar [data-tip="New tab"]').click();
  await expect(page.locator('h1.view-title').first()).toBeVisible();
  await expect(page.locator('.titlebar [role=tab][aria-selected=true]')).toContainText('Home');
  await page.keyboard.press(`${MOD}+t`);
  await expect(page.locator('.titlebar [role=tab]')).toHaveCount(3);
  await tree(page, 'Projects').click();

  await page.waitForTimeout(400);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await expect(page.locator('.titlebar [role=tab]')).toHaveCount(3);
  await expect(page.locator('.titlebar [role=tab][aria-selected=true]')).toContainText('Projects');
  await expect(title(page)).toHaveText('Projects');
  await tab(page, 'Getting started').click();
  await expect(title(page)).toHaveText('Getting started');
});

test('a tab whose page was deleted lands on Home', async ({ page }) => {
  await open(page);
  await tree(page, 'Getting started').click();
  await tree(page, 'Design review').click({ modifiers: [CLICK_MOD] });
  await tree(page, 'Design review').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
  await tab(page, 'Design review').click();
  await expect(page.locator('h1.view-title').first()).toBeVisible();
  await expect(page.locator('.titlebar [role=tab][aria-selected=true]')).toContainText('Home');
});

test('in a narrow window tabs shrink to icons and the title bar still fits', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 700 });
  await open(page);
  await tree(page, 'Getting started').click();
  for (const name of ['Projects', 'Study plan', 'Design review', 'Biology']) await tree(page, name).click({ modifiers: [CLICK_MOD] });
  await page.keyboard.press(`${MOD}+Shift+Tab`);
  await expect(page.locator('.titlebar [role=tab]')).toHaveCount(5);
  const order = await page.locator('.titlebar [role=tab]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tip')));
  expect(order, 'opened one after another, in order').toEqual(['Getting started', 'Projects', 'Study plan', 'Design review', 'Biology']);

  const box = (sel: string) => page.locator(sel).first().boundingBox();
  const width = page.viewportSize()!.width;
  // Everything in the title bar is on screen: the window controls end at the edge.
  for (const sel of ['.titlebar [data-tip="New tab"]', '.titlebar [data-tip="More"]', '.titlebar [aria-label="Split view"]']) {
    const b = await box(sel);
    expect(b, sel).not.toBeNull();
    expect(b!.x + b!.width, sel).toBeLessThanOrEqual(width);
  }
  // Every tab keeps at least its icon, and the active one is in view.
  const sizes = await page.locator('.titlebar [role=tab]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  for (const w of sizes) expect(w).toBeGreaterThanOrEqual(30);
  const strip = await box('.titlebar [role=tablist]');
  const active = await box('.titlebar [role=tab][aria-selected=true]');
  expect(active!.x).toBeGreaterThanOrEqual(strip!.x - 1);
  expect(active!.x + active!.width).toBeLessThanOrEqual(strip!.x + strip!.width + 1);
});
