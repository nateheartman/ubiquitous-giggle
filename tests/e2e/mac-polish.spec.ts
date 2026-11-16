// Mac details Thought Desk doesn't have: ⌘ and the wheel zoom, the file
// manager is called Finder, and fullscreen gives back the traffic lights' room.
import { test, expect, open } from './fixtures';
import type { Page } from '@playwright/test';

test.use({ platform: 'mac' });

const zoom = (page: Page) => page.evaluate(() => Number(document.documentElement.style.zoom || 1));

test('⌘ + scroll zooms, a plain scroll does not', async ({ page }) => {
  await open(page);
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(200);
  expect(await zoom(page)).toBe(1);
  await page.keyboard.down('Meta');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Meta');
  await expect.poll(() => zoom(page)).toBe(1.1);
  await page.keyboard.down('Meta');
  await page.mouse.wheel(0, 100);
  await page.keyboard.up('Meta');
  await expect.poll(() => zoom(page)).toBe(1);
});

test("a file's menu says Show in Finder", async ({ page, mod }) => {
  await open(page);
  await page.keyboard.press(`${mod}+4`);
  await page.locator('.view-title', { hasText: 'Files' }).waitFor();
  await page.getByText('syllabus', { exact: false }).first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Show in Finder' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Show in Folder' })).toHaveCount(0);
});

test('fullscreen gives back the room kept for the traffic lights', async ({ page }) => {
  await open(page);
  const inset = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--traffic-lights').trim());
  expect(await inset()).toBe('72px');
  await page.evaluate(() => document.documentElement.setAttribute('data-fullscreen', ''));
  expect(await inset()).toBe('0px');
});
