// Window chrome on a Mac: the native traffic lights replace the drawn
// window controls, and the left side leaves room for them.
import { test, expect, open } from './fixtures';

test.use({ platform: 'mac' });

test('no drawn window controls; <html> knows it is a Mac', async ({ page }) => {
  await open(page);
  await expect(page.locator('html')).toHaveClass(/\bmac\b/);
  await expect(page.locator('.controls')).toHaveCount(0);
  await expect(page.locator('[aria-label="Minimize"]')).toHaveCount(0);
  await expect(page.locator('[aria-label="Close"]')).toHaveCount(0);
});

test('the sidebar header leaves room for the traffic lights', async ({ page }) => {
  await open(page);
  const inset = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--traffic-lights').trim());
  expect(inset).toBe('72px');
  const pad = await page.locator('.sidebar .head').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(pad).toBeGreaterThanOrEqual(72);
});

test('with the sidebar hidden the title bar keeps clear of them', async ({ page, mod }) => {
  await open(page);
  await page.keyboard.press(`${mod}+Backslash`);
  await expect(page.locator('.sidebar')).toHaveCount(0);
  const pad = await page.locator('.titlebar').evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(pad).toBeGreaterThanOrEqual(72);
});
