// Window chrome on Windows/Linux: the app draws its own window controls and
// needs no room for traffic lights.
import { test, expect, open } from './fixtures';

test('window controls are drawn; no Mac platform marker or inset', async ({ page }) => {
  await open(page);
  await expect(page.locator('.controls')).toHaveCount(1);
  await expect(page.locator('html')).not.toHaveClass(/\bmac\b/);
  const inset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--traffic-lights').trim());
  expect(inset).toBe('0px');
});

test('Ctrl is the command key and Alt+Arrow goes back', async ({ page, mod }) => {
  expect(mod).toBe('Control');
  await open(page);
  await page.keyboard.press(`${mod}+2`);
  await expect(page.locator('.sidebar .nav-main[aria-current=page]')).toContainText('Assignments');
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.locator('h1.view-title')).toHaveText(/Good|Working/);
  // Thought Desk takes Meta as Mod too off a Mac (the Windows key), so a key
  // that arrives as Meta still works.
  await page.keyboard.press('Meta+2');
  await expect(page.locator('.sidebar .nav-main[aria-current=page]')).toContainText('Assignments');
});
