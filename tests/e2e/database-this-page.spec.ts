// Databases: a relation filter on "This page", and new rows that take the
// relation from it. A Tasks view inside a project's page shows only that
// project's tasks, and a task made there is linked to the project.
import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

const cell = (page: Page, r: number, c: number) => page.locator(`.td[data-r="${r}"][data-c="${c}"]`);
const colOf = async (page: Page, name: string) =>
  (await page.locator('.head .th').allTextContents()).findIndex((t) => t.trim().startsWith(name));

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

/** Opens a row of the table in view as its own page. */
async function openRow(page: Page, title: string) {
  const c = page.locator('.td[data-c="0"]', { hasText: title }).first();
  await c.hover();
  await c.locator('.open').click({ force: true });
  await expect(page.locator('h1.title')).toHaveText(title);
}

/** Puts a linked view of `database` at the end of the open page. */
async function linkView(page: Page, database: string) {
  await page.click('.ProseMirror');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/linked');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.click(`.menu .item:has-text("${database}")`);
  await expect(page.locator('.database-block .dbv')).toHaveCount(1);
  // The "All tasks" table is the view that carries the filter.
  await page.locator('.database-block .tab:has-text("All tasks")').click();
}

test('a Tasks view filtered to "This page" shows its own page\'s tasks and files new ones there', async ({ page }) => {
  await open(page);
  await newDatabase(page, 'Projects', 'Work projects');
  await page.click('.tab:has-text("All projects")');
  await addRows(page, ['Alpha', 'Beta']);
  await newDatabase(page, 'Tasks', 'Work tasks');
  await page.click('.tab:has-text("All tasks")');
  await addRows(page, ['Alpha one', 'Alpha two', 'Beta one']);

  await test.step('a two-way Project relation, linked up', async () => {
    await page.click('.th.add');
    await page.click('.db-pop .pop-item:has-text("Relation")');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Project');
    await page.locator('.db-pop select').first().selectOption({ label: 'Work projects' });
    await page.locator('.db-pop .pop-row:has-text("Two-way") button[role=switch]').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    const rel = await colOf(page, 'Project');
    for (const [r, project] of [[0, 'Alpha'], [1, 'Alpha'], [2, 'Beta']] as const) {
      await cell(page, r, rel).click();
      await page.click(`.db-pop .pop-item:has-text("${project}")`);
      await page.waitForTimeout(150);
      await page.keyboard.press('Escape');
      await expect(cell(page, r, rel)).toContainText(project);
    }
  });

  await test.step('open Alpha, link the tasks, and filter Project to This page', async () => {
    await page.click('.sidebar .db-row:has-text("Work projects") .nav-main');
    await page.click('.tab:has-text("All projects")');
    await openRow(page, 'Alpha');
    await linkView(page, 'Work tasks');
    const block = page.locator('.database-block');
    await expect(block).toContainText('Beta one');
    await block.locator('.icon-btn[aria-label="Filter"]').click();
    await page.click('.popover button:has-text("Add a filter")');
    await page.locator('.filters select').first().selectOption({ label: 'ProjectRelation' });
    await page.click('.filters .choice:has-text("This page")');
    // Let the panel settle before closing it: a resize still pending when it goes trips Popover's observer (not this feature's).
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await expect(block.locator('.chip', { hasText: 'This page' })).toBeVisible();
    await expect(block).toContainText('Alpha one');
    await expect(block).toContainText('Alpha two');
    await expect(block).not.toContainText('Beta one');
  });

  await test.step('New makes a task of this project, and the project lists it', async () => {
    const block = page.locator('.database-block');
    await block.locator('button.new').click();
    await page.waitForTimeout(300);
    await page.keyboard.type('Alpha three');
    await page.keyboard.press('Enter');
    await expect(block).toContainText('Alpha three');
    await expect(block.locator('.td', { hasText: 'Alpha' }).first()).toBeVisible();
    // The relation holds the project, not the token.
    await expect(block).not.toContainText('@this');
    await page.click('.sidebar .db-row:has-text("Work projects") .nav-main');
    await page.click('.tab:has-text("All projects")');
    const tasks = await colOf(page, 'Work tasks');
    await expect(cell(page, 0, tasks)).toContainText('Alpha three');
    await expect(cell(page, 1, tasks)).not.toContainText('Alpha three');
  });

  await test.step('on its own (no host page) the view shows nothing, and says why', async () => {
    await page.click('.sidebar .db-row:has-text("Work tasks") .nav-main');
    await expect(page.locator('.td[data-c="0"]', { hasText: 'Alpha one' })).toHaveCount(0);
    await page.click('.tools .icon-btn[aria-label="Filter"]');
    await expect(page.locator('.filters .note')).toContainText("This page isn't a row of Work projects");
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
  });

  await test.step('a template holding the view works for every project made from it', async () => {
    await page.click('.sidebar .db-row:has-text("Work projects") .nav-main');
    await page.click('.tab:has-text("All projects")');
    await page.click('.new-more');
    await page.click('.popover .pop-item:has-text("New template")');
    await page.waitForTimeout(500);
    await page.keyboard.type('Project kit');
    await linkView(page, 'Work tasks');
    await page.waitForTimeout(800);
    await page.click('.db-row:has-text("Work projects") .nav-main');
    await page.click('.new-more');
    await page.click('.popover .pop-item:has-text("Project kit")');
    await page.waitForTimeout(300);
    await page.keyboard.type('Gamma');
    await page.keyboard.press('Enter');
    await openRow(page, 'Gamma');
    const block = page.locator('.database-block');
    await expect(block.locator('.dbv')).toHaveCount(1);
    await expect(block).not.toContainText('Alpha one');
    await block.locator('button.new').click();
    await page.waitForTimeout(300);
    await page.keyboard.type('Gamma one');
    await page.keyboard.press('Enter');
    await expect(block).toContainText('Gamma one');
    await expect(block).not.toContainText('Alpha');
    await expect(block).not.toContainText('Beta');
  });
});
