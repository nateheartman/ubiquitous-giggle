// Work mode: a project shows how far along it is (tasks done out of all of
// them) in its own view, as a ring and tooltip in the sidebar, and in its
// area's list of projects. Deleted tasks don't count.
import { test, expect, open, MOD } from './fixtures';
import type { Page } from '@playwright/test';

const sidebar = (page: Page) => page.locator('.sidebar');
const navRow = (page: Page, name: string | RegExp) => sidebar(page).locator('.nav-row', { hasText: name });

async function switchToWork(page: Page) {
  await page.keyboard.press(`${MOD}+Comma`);
  await page.locator('#settings-tab-general').click();
  await Promise.all([page.waitForEvent('load'), page.getByRole('radio', { name: 'Work', exact: true }).click()]);
  await page.locator('.sidebar').waitFor();
  await page.keyboard.press('Escape');
}

async function addProject(page: Page, name: string) {
  await page.getByTestId('projects-section').locator('.section-add').click();
  await page.getByPlaceholder('Project name').fill(name);
  await page.getByRole('button', { name: 'Add Project' }).click();
  await expect(page.getByTestId('project-view')).toBeVisible();
}

async function addTask(page: Page, title: string) {
  await page.locator('.view-head').getByRole('button', { name: 'Task' }).click();
  await page.getByPlaceholder('New task').fill(title);
  await page.getByRole('button', { name: 'Add Task' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
}

test('a project shows its progress in its view, the sidebar and its area, and it recalculates', async ({ page }) => {
  await open(page);
  await switchToWork(page);
  const progress = page.getByTestId('project-progress');

  await test.step('a project with no tasks says so and has no bar', async () => {
    await addProject(page, 'Launch website');
    await expect(progress).toHaveText('No tasks yet');
    await expect(progress.getByRole('progressbar')).toHaveCount(0);
    await expect(navRow(page, 'Launch website').locator('.nav-main')).not.toHaveAttribute('data-tip', /.+/);
    await expect(navRow(page, 'Launch website').locator('.dot.ring')).toHaveCount(0);
  });

  await test.step('put it in an area and add three tasks', async () => {
    await page.getByRole('button', { name: /None/ }).click();
    await page.getByRole('menuitem', { name: 'Biology' }).click();
    for (const title of ['Draft home page', 'Pick a host', 'Write copy']) await addTask(page, title);
    await expect(progress).toContainText('0 of 3 tasks done · 0%');
  });

  await test.step('two done is 67% in the view, the sidebar tooltip and the area view', async () => {
    const check = page.getByRole('checkbox', { name: 'Mark as done' });
    await check.first().click();
    await check.first().click();
    await expect(progress).toContainText('2 of 3 tasks done · 67%');
    await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '67');
    await expect(navRow(page, 'Launch website').locator('.nav-main')).toHaveAttribute('data-tip', '67% done (2 of 3)');
    await expect(navRow(page, 'Launch website').locator('.dot.ring')).toHaveCount(1);

    await navRow(page, 'Biology').locator('.nav-main').click();
    const row = page.getByTestId('area-projects').locator('.link-row', { hasText: 'Launch website' });
    await expect(row).toContainText('67%');
    await row.click();
    await expect(page.getByTestId('project-view')).toBeVisible();
  });

  await test.step('deleting the open task recalculates: 2 of 2', async () => {
    await page.locator('.a-row', { hasText: 'Write copy' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to Trash' }).click();
    await expect(progress).toContainText('2 of 2 tasks done · 100%');
    await expect(navRow(page, 'Launch website').locator('.nav-main')).toHaveAttribute('data-tip', '100% done (2 of 2)');
  });

  await test.step('a finished project keeps its bar, and one task reads "1 of 1 task done"', async () => {
    await page.getByRole('button', { name: 'Mark Done' }).click();
    await expect(progress.getByRole('progressbar')).toBeVisible();
    await addProject(page, 'Tiny');
    await addTask(page, 'Only task');
    await expect(progress).toContainText('0 of 1 task done · 0%');
    await page.getByRole('checkbox', { name: 'Mark as done' }).click();
    await expect(progress).toContainText('1 of 1 task done · 100%');
  });
});
