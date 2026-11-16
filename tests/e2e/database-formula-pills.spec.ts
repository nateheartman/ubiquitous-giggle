// The formula editor shows properties as pills: picked from suggestions, deleted whole,
// related ones after `current.`, and saved as plain `prop("…")` text.
import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

const cell = (page: Page, r: number, c: number) => page.locator(`.td[data-r="${r}"][data-c="${c}"]`);
const colOf = async (page: Page, name: string) => (await page.locator('.head .th').allTextContents()).findIndex((t) => t.trim().startsWith(name));
const editor = (page: Page) => page.locator('.src .ProseMirror');

async function newDatabase(page: Page, template: string, name: string) {
  await page.click('.section-head:has-text("Databases") .section-add', { force: true });
  await page.click(`.tile:has-text("${template}")`);
  await page.waitForTimeout(500);
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
}

async function addRows(page: Page, titles: string[]) {
  for (const t of titles) {
    await page.click('button.new');
    await page.waitForTimeout(300);
    await page.keyboard.type(t);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
  }
}

/** Jobs (a Tasks database, one of three Done) and Batches (Projects) with a relation "Tasks" to the jobs. */
async function setUp(page: Page) {
  await open(page);
  await newDatabase(page, 'Tasks', 'Jobs');
  await page.click('.tab:has-text("All tasks")');
  await addRows(page, ['Wash', 'Dry', 'Fold']);
  await newDatabase(page, 'Projects', 'Batches');
  await page.click('.tab:has-text("All projects")');
  await addRows(page, ['Batch 1']);
  await page.click('.th.add');
  await page.click('.db-pop .pop-item:has-text("Relation")');
  await page.waitForTimeout(300);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Tasks');
  await page.locator('.db-pop select').first().selectOption({ label: 'Jobs' });
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  const rel = await colOf(page, 'Tasks');
  expect(rel).toBeGreaterThan(0);
  await cell(page, 0, rel).click();
  for (const job of ['Wash', 'Dry', 'Fold']) {
    await page.click(`.db-pop .pop-item:has-text("${job}")`);
    await page.waitForTimeout(150);
  }
  await page.keyboard.press('Escape');
  // Fold is Done (set the way a paste would, which is quicker than the picker).
  await page.evaluate(async () => {
    // @ts-expect-error served by the dev server, and the same module instance the app uses
    const { databases } = await import('/src/lib/databases.svelte.ts');
    const dbs = Object.values(databases.schemas) as { id: string }[];
    const jobs = dbs.find((d) => databases.rowsOf(d.id).some((r: { id: string }) => databases.title(r.id) === 'Fold'))!;
    const status = databases.props(jobs.id).find((p: { name: string }) => p.name === 'Status');
    const done = status.config.options.find((o: { name: string }) => o.name === 'Done');
    const fold = databases.rowsOf(jobs.id).find((r: { id: string }) => databases.title(r.id) === 'Fold');
    databases.set([{ row: fold, prop: status, value: done.id }], { undo: false, automate: false });
  });
}

async function openNewFormula(page: Page) {
  await page.click('.th.add');
  await page.click('.db-pop .pop-item:has-text("Formula")');
  await expect(editor(page)).toBeFocused();
}

test('properties are pills: pick, delete whole, related after current., saved as prop() text', async ({ page }) => {
  await setUp(page);
  await openNewFormula(page);

  await test.step('typing Sta and picking Status makes a pill, and Backspace deletes it whole', async () => {
    await page.keyboard.type('Sta');
    await expect(page.locator('.suggest .pop-item').first()).toContainText('Status');
    await page.keyboard.press('Enter');
    const pill = page.locator('.src .pill');
    await expect(pill).toHaveCount(1);
    await expect(pill).toHaveText('Status');
    await expect(pill).toHaveAttribute('aria-label', 'property Status');
    await page.keyboard.press('Backspace');
    await expect(page.locator('.src .pill')).toHaveCount(0);
    await expect(editor(page)).toHaveText('');
  });

  await test.step('prop("Tasks").filter(current.Status != "Done").length() built only through suggestions', async () => {
    await page.keyboard.type('Tasks');
    await expect(page.locator('.suggest .pop-item').first()).toContainText('Tasks');
    await page.keyboard.press('Tab');
    await page.keyboard.type('.fil');
    await expect(page.locator('.suggest .pop-item').first()).toContainText('filter()');
    await page.keyboard.press('Tab');
    await page.keyboard.type('cur');
    await page.keyboard.press('Tab');
    await page.keyboard.type('.');
    // After current. the suggestions are the properties of the linked database (Jobs), not of Batches.
    await expect(page.locator('.suggest .pop-item', { hasText: 'Priority' })).toBeVisible();
    await expect(page.locator('.suggest .pop-item', { hasText: 'Tags' })).toHaveCount(0);
    await page.keyboard.type('Sta');
    await page.keyboard.press('Tab');
    await page.keyboard.type(' != "Done")');
    await page.keyboard.type('.len');
    await page.keyboard.press('Tab');
    await page.keyboard.type(')');
    const pills = page.locator('.src .pill');
    await expect(pills).toHaveCount(2);
    await expect(pills.nth(0)).not.toHaveClass(/pill-related/);
    await expect(pills.nth(1)).toHaveClass(/pill-related/);
    await expect(pills.nth(1)).toHaveText('Status');
    // The sample row, Batch 1, has three jobs and one is Done.
    await expect(page.locator('.result .value')).toHaveText('2');
    await expect(page.locator('.result.error')).toHaveCount(0);
    await page.screenshot({ path: process.env.PILLS_SHOT ?? 'test-results/formula-pills.png' });
  });

  await test.step('saved as plain text, and reopening shows the same pills', async () => {
    await page.locator('.modal-head input.name').fill('Open jobs');
    await editor(page).focus();
    await page.keyboard.press('Control+Enter');
    await expect(page.locator('.src')).toHaveCount(0);
    // The property menu the formula was opened from is still there; Escape closes it.
    await page.keyboard.press('Escape');
    const col = await colOf(page, 'Open jobs');
    expect(col).toBeGreaterThan(0);
    await expect(cell(page, 0, col)).toHaveText('2');
    const saved = await page.evaluate(async () => {
      // @ts-expect-error served by the dev server
      const { databases } = await import('/src/lib/databases.svelte.ts');
      for (const d of Object.values(databases.schemas) as { id: string }[]) {
        const p = databases.props(d.id).find((x: { name: string }) => x.name === 'Open jobs');
        if (p) return p.config.expression as string;
      }
      return '';
    });
    expect(saved).toBe('prop("Tasks").filter(current.prop("Status") != "Done").length()');
    await page.click('.th:has-text("Open jobs")');
    await page.click('.db-pop .formula');
    await expect(page.locator('.src .pill')).toHaveCount(2);
    await expect(page.locator('.src .pill-related')).toHaveText('Status');
    await page.keyboard.press('Escape');
  });
});

test('related pills, pasted text, newlines and indentation, and a missing property', async ({ page }) => {
  await setUp(page);
  await openNewFormula(page);

  await test.step('pasting prop("X") text turns it into pills and keeps its lines', async () => {
    await page.evaluate(() => {
      const el = document.querySelector('.src .ProseMirror') as HTMLElement;
      const data = new DataTransfer();
      data.setData('text/plain', 'prop("Tasks")\n    .filter(\n        current.prop("Status") != "Done"\n    ).length()');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('.src .pill')).toHaveCount(2);
    await expect(page.locator('.src .pill-related')).toHaveText('Status');
    await expect(page.locator('.result .value')).toHaveText('2');
  });

  await test.step('nested: each level of current. suggests the properties of its own database', async () => {
    // Jobs get a relation "Subtasks" to the database that has a Rating (the Reading list).
    await page.evaluate(async () => {
      // @ts-expect-error served by the dev server, and the same module instance the app uses
      const { databases } = await import('/src/lib/databases.svelte.ts');
      const dbs = Object.values(databases.schemas) as { id: string }[];
      const jobs = dbs.find((d) => databases.rowsOf(d.id).some((r: { id: string }) => databases.title(r.id) === 'Fold'))!;
      const books = dbs.find((d) => databases.props(d.id).some((p: { name: string }) => p.name === 'Rating'))!;
      await databases.addProperty(jobs.id, 'relation', { name: 'Subtasks', config: { database: books.id } });
    });
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    const first = page.locator('.suggest .pop-item').first();
    await page.keyboard.type('Tasks');
    await page.keyboard.press('Tab');
    await page.keyboard.type('.map');
    await expect(first).toContainText('map()');
    await page.keyboard.press('Tab');
    await page.keyboard.type('cur');
    await page.keyboard.press('Tab');
    await page.keyboard.type('.Sub');
    await expect(first).toContainText('Subtasks');
    await page.keyboard.press('Tab');
    await page.keyboard.type('.fil');
    await page.keyboard.press('Tab');
    await page.keyboard.type('cur');
    await page.keyboard.press('Tab');
    await page.keyboard.type('.');
    // Two levels down: the properties of the Reading list, not of Jobs or Batches.
    await expect(page.locator('.suggest .pop-item', { hasText: 'Rating' })).toBeVisible();
    await expect(page.locator('.suggest .pop-item', { hasText: 'Subtasks' })).toHaveCount(0);
    await page.keyboard.type('Rat');
    await page.keyboard.press('Tab');
    await page.keyboard.type(' > 3)).flat().length()');
    const related = page.locator('.src .pill-related');
    await expect(related).toHaveCount(2);
    await expect(related.nth(0)).toHaveText('Subtasks');
    await expect(related.nth(1)).toHaveText('Rating');
    await expect(page.locator('.src .pill-missing')).toHaveCount(0);
    await expect(page.locator('.result.error')).toHaveCount(0);
    await page.screenshot({ path: process.env.PILLS_NESTED_SHOT ?? 'test-results/formula-pills-nested.png' });
  });

  await test.step('Enter adds a line, Tab four spaces, and Tab with a suggestion inserts it instead', async () => {
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('1 +');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('2');
    await expect(page.locator('.result .value')).toHaveText('3');
    await expect(page.locator('.src .ProseMirror br:not(.ProseMirror-trailingBreak)')).toHaveCount(1);
  });

  await test.step('a pill for a property that is gone is red, and the formula says so', async () => {
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.evaluate(() => {
      const el = document.querySelector('.src .ProseMirror') as HTMLElement;
      const data = new DataTransfer();
      data.setData('text/plain', 'prop("Vanished") + 1');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(page.locator('.src .pill-missing')).toHaveText('Vanished');
    await expect(page.locator('.src .pill-missing')).toHaveAttribute('aria-label', 'property Vanished (not found)');
    await expect(page.locator('.result.error')).toContainText('Vanished');
  });

  await test.step('the reference panel inserts a pill at the cursor', async () => {
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.locator('.ref .ref-item:has-text("Progress")').first().click();
    await expect(page.locator('.src .pill')).toHaveText('Progress');
    await expect(editor(page)).toBeFocused();
  });
});
