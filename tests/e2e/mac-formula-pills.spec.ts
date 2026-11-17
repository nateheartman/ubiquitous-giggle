// The formula editor on a Mac: the hint reads ⌘, ⌘Enter saves, and pills work the same.
import { test, expect, open } from './fixtures';

test.use({ platform: 'mac' });

test('⌘Enter saves a formula built from pills, and the hint says ⌘', async ({ page, mod }) => {
  const warnings: string[] = [];
  page.on('console', (m) => {
    if (/\[svelte\]|derived_inert/.test(m.text())) warnings.push(m.text());
  });
  await open(page);
  await page.click('.section-head:has-text("Databases") .section-add', { force: true });
  await page.click('.tile:has-text("Tasks")');
  await page.waitForTimeout(500);
  await page.keyboard.type('Jobs');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.click('.tab:has-text("All tasks")');
  await page.click('.th.add');
  await page.click('.db-pop .pop-item:has-text("Formula")');
  const editor = page.locator('.src .ProseMirror');
  await expect(editor).toBeFocused();
  await expect(page.locator('.modal-foot')).toContainText('⌘');
  await expect(page.locator('.modal-foot')).not.toContainText('Ctrl');

  await page.keyboard.type('Sta');
  await page.keyboard.press('Enter');
  await expect(page.locator('.src .pill')).toHaveText('Status');
  // Enter after a pick is a new line, not a save.
  await page.keyboard.type(' == "Done"');
  await page.keyboard.press('Control+Enter');
  await expect(page.locator('.src')).toHaveCount(1);
  await page.keyboard.press(`${mod}+Enter`);
  await expect(page.locator('.src')).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(warnings).toEqual([]);
});
