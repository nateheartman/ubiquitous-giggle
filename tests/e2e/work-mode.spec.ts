// School or Work: the mode chosen on first launch or in Settings re-labels the
// app (Courses become Areas, Assignments become Tasks, Files become Resources),
// hides grades, and adds Projects. Areas and projects can be archived and
// restored. Switching back shows everything as it was.
import { test, expect, open, MOD } from './fixtures';
import type { Page } from '@playwright/test';

const sidebar = (page: Page) => page.locator('.sidebar');
const navRow = (page: Page, name: string | RegExp) => sidebar(page).locator('.nav-row', { hasText: name });
const sectionTitle = (page: Page, name: string) => sidebar(page).locator('.section-title', { hasText: name });

/** A local calendar date as the app writes it ("2026-11-16"), `offset` days from today. */
const localDate = (page: Page, offset: number) =>
  page.evaluate((offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, offset);

/** Settings → General → Mode; the window restarts in the mode. */
async function switchMode(page: Page, label: 'School' | 'Work') {
  await page.keyboard.press(`${MOD}+Comma`);
  await page.locator('#settings-tab-general').click();
  await Promise.all([page.waitForEvent('load'), page.getByRole('radio', { name: label, exact: true }).click()]);
  await page.locator('.sidebar').waitFor();
}

test('Work on first launch re-labels the app and the welcome carries on', async ({ page }) => {
  const next = page.locator('.welcome .nav .btn.primary');
  const step = (text: string | RegExp) => page.locator('.welcome h1', { hasText: text });
  await page.goto('/?fresh&welcome');
  await expect(page.locator('.welcome input')).toBeFocused();
  await page.keyboard.type('Sam');
  await page.keyboard.press('Enter');

  await test.step('one step asks how it will be used, with School and Work', async () => {
    await expect(step('How will you use ThoughtNotes?')).toBeVisible();
    await expect(page.locator('.welcome .choice.mode')).toHaveText([/School.*Courses, assignments, grades/, /Work.*Areas, projects, tasks/]);
  });

  await test.step('Work restarts the window in its words and the welcome goes on from there', async () => {
    await Promise.all([page.waitForEvent('load'), page.locator('.welcome .choice.mode[data-mode="work"]').click()]);
    await expect(step('Make it yours')).toBeVisible();
    await next.click();
    await expect(step('Three things')).toBeVisible();
    await expect(page.locator('.welcome')).toContainText('Today\'s meetings');
    await next.click();
    await expect(page.locator('.welcome')).toContainText('add your areas and tasks');
  });

  await test.step('it lands in Work mode: Projects above Areas, Tasks, Resources', async () => {
    await page.keyboard.press('Enter');
    await expect(page.locator('.welcome')).toHaveCount(0);
    await expect(sectionTitle(page, 'Projects')).toBeVisible();
    await expect(sectionTitle(page, 'Areas')).toBeVisible();
    await expect(sidebar(page).locator('nav.views')).toContainText('Tasks');
    await expect(sidebar(page).locator('nav.views')).toContainText('Resources');
    await expect(sidebar(page)).not.toContainText('Courses');
    await expect(sidebar(page)).not.toContainText('Assignments');
  });
});

test('School stays the default, and the question can be skipped', async ({ page }) => {
  await page.goto('/?fresh&welcome');
  await expect(page.locator('.welcome input')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.welcome h1', { hasText: 'How will you use ThoughtNotes?' })).toBeVisible();
  await page.locator('.welcome .nav .btn.primary').click();
  await expect(page.locator('.welcome h1', { hasText: 'Make it yours' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expect(page.locator('.welcome')).toHaveCount(0);
  await expect(sectionTitle(page, 'Courses')).toBeVisible();
  await expect(sectionTitle(page, 'Projects')).toHaveCount(0);
  await expect(sidebar(page).locator('nav.views')).toContainText('Assignments');
});

test('switching in Settings relabels the sidebar, the area view and the task sheet, and back again', async ({ page }) => {
  await open(page);

  await test.step('School: Courses, Assignments, grades', async () => {
    await expect(sectionTitle(page, 'Courses')).toBeVisible();
    await navRow(page, 'Biology').locator('.nav-main').click();
    await expect(page.locator('.view-head .eyebrow')).toHaveText('Course');
    await expect(page.getByText('Teacher', { exact: true })).toBeVisible();
    await expect(page.locator('.view-head')).toContainText('open assignment');
    await expect(page.getByText('Current grade')).toBeVisible();
  });

  await switchMode(page, 'Work');
  await page.keyboard.press('Escape');

  await test.step('Work: the sidebar speaks work', async () => {
    await expect(sectionTitle(page, 'Areas')).toBeVisible();
    await expect(sectionTitle(page, 'Projects')).toBeVisible();
    await expect(sectionTitle(page, 'Courses')).toHaveCount(0);
    await expect(sidebar(page).locator('nav.views')).toContainText('Tasks');
    await expect(sidebar(page).locator('nav.views')).toContainText('Resources');
  });

  await test.step('the area view: Owner and Location, no grades', async () => {
    await navRow(page, 'Biology').locator('.nav-main').click();
    await expect(page.locator('.view-head .eyebrow')).toHaveText('Area');
    await expect(page.getByText('Owner', { exact: true })).toBeVisible();
    await expect(page.getByText('Location', { exact: true })).toBeVisible();
    await expect(page.getByText('Teacher', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Current grade')).toHaveCount(0);
    await expect(page.locator('.view-head')).toContainText('open task');
  });

  await test.step('the task sheet: Task, a Project picker, no score', async () => {
    await page.locator('.view-head').getByRole('button', { name: 'Task' }).click();
    const sheet = page.locator('.modal');
    await expect(sheet).toHaveAttribute('aria-label', 'New Task');
    await expect(sheet.getByText('Project', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Area', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.modal').waitFor({ state: 'detached' });
  });

  await test.step('Settings: the pane is Areas & Projects, and the mode survives a restart', async () => {
    await page.keyboard.press(`${MOD}+Comma`);
    await expect(page.locator('#settings-tab-courses')).toContainText('Areas & Projects');
    await page.reload();
    await page.locator('.sidebar').waitFor();
    await expect(sectionTitle(page, 'Projects')).toBeVisible();
  });

  await switchMode(page, 'School');
  await page.keyboard.press('Escape');

  await test.step('back in School everything is as before, data intact', async () => {
    await expect(sectionTitle(page, 'Courses')).toBeVisible();
    await expect(sectionTitle(page, 'Projects')).toHaveCount(0);
    await expect(sidebar(page).locator('nav.views')).toContainText('Assignments');
    await expect(sidebar(page).locator('nav.views')).toContainText('Files');
    await navRow(page, 'Biology').locator('.nav-main').click();
    await expect(page.locator('.view-head .eyebrow')).toHaveText('Course');
    await expect(page.getByText('Current grade')).toBeVisible();
  });
});

test('a project with an area and a deadline, a task in it, and its deadline on the calendar', async ({ page }) => {
  await open(page);
  await switchMode(page, 'Work');
  await page.keyboard.press('Escape');

  await test.step('add a project from the sidebar', async () => {
    await page.getByTestId('projects-section').locator('.section-add').click();
    await page.getByPlaceholder('Project name').fill('Launch website');
    await page.getByRole('button', { name: 'Add Project' }).click();
    await expect(page.getByTestId('project-view')).toBeVisible();
    await expect(page.locator('.view-head .eyebrow')).toHaveText('Project');
    await expect(navRow(page, 'Launch website')).toHaveCount(1);
  });

  await test.step('give it an outcome, a deadline and an area', async () => {
    await page.getByLabel('Outcome').fill('The site is live');
    const in3 = await localDate(page, 3);
    await page.getByLabel('Deadline', { exact: true }).fill(in3);
    await expect(page.locator('.view-sub')).toContainText('3 days left');
    await page.getByRole('button', { name: /None/ }).click();
    await page.getByRole('menuitem', { name: 'Biology' }).click();
    await expect(page.getByTestId('project-view').locator('.picker')).toContainText('Biology');
  });

  await test.step('add a task to the project from its view', async () => {
    await page.locator('.view-head').getByRole('button', { name: 'Task' }).click();
    await page.getByPlaceholder('New task').fill('Draft the home page');
    await page.getByRole('button', { name: 'Add Task' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(page.locator('.view-sub')).toContainText('1 open task');
    await expect(page.locator('.group').filter({ hasText: 'Draft the home page' })).toBeVisible();
    // The task is in the project and in its area, and the sidebar counts it.
    await expect(navRow(page, 'Launch website').locator('.count')).toHaveText('1');
  });

  await test.step('an existing task can be moved into the project with the picker', async () => {
    await sidebar(page).locator('nav.views').getByText('Tasks').click();
    await page.getByText('Lab report: osmosis').click();
    await page.getByTestId('project-picker').click();
    await page.getByRole('menuitem', { name: 'Launch website' }).click();
    await expect(page.getByTestId('project-picker')).toContainText('Launch website');
    await page.locator('.modal').getByRole('button', { name: 'Close' }).click();
    await expect(page.locator('.modal')).toHaveCount(0);
    await expect(navRow(page, 'Launch website').locator('.count')).toHaveText('2');
  });

  await test.step('the deadline shows on the calendar as an all-day marker', async () => {
    // Due today, so it is on screen in both the week and the month whatever day this runs.
    await navRow(page, 'Launch website').locator('.nav-main').click();
    await page.getByLabel('Deadline', { exact: true }).fill(await localDate(page, 0));
    await expect(page.locator('.view-sub')).toContainText('Due today');
    await sidebar(page).locator('nav.views').getByText('Calendar').click();
    await page.getByRole('radio', { name: 'Week', exact: true }).click();
    await expect(page.locator('.chip-ev.deadline', { hasText: 'Launch website' })).toBeVisible();
    await page.getByRole('radio', { name: 'Month', exact: true }).click();
    await expect(page.locator('.item.deadline', { hasText: 'Launch website' })).toBeVisible();
    await page.locator('.item.deadline', { hasText: 'Launch website' }).click();
    await expect(page.getByTestId('project-view')).toBeVisible();
  });
});

test('areas and projects are archived and restored, and nothing is deleted', async ({ page }) => {
  await open(page);
  await switchMode(page, 'Work');
  await page.keyboard.press('Escape');

  // A project with a task due soon, in the area Biology too.
  await page.getByTestId('projects-section').locator('.section-add').click();
  await page.getByPlaceholder('Project name').fill('Q4 plan');
  await page.getByRole('button', { name: 'Add Project' }).click();
  await page.locator('.view-head').getByRole('button', { name: 'Task' }).click();
  await page.getByPlaceholder('New task').fill('Review budget');
  await page.locator('.modal input[type="date"]').first().fill(await localDate(page, 0));
  await page.getByRole('button', { name: 'Add Task' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);

  await test.step('archiving the project removes it from the sidebar and hides its tasks from Home', async () => {
    await sidebar(page).locator('nav.views').getByText('Home').click();
    await expect(page.locator('.view').getByText('Review budget')).toBeVisible();
    await navRow(page, 'Q4 plan').locator('.nav-main').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Archive Project' }).click();
    await expect(navRow(page, 'Q4 plan')).toHaveCount(0);
    await expect(page.locator('.view').getByText('Review budget')).toHaveCount(0);
  });

  await test.step('archiving an area (right-click) takes it out of the sidebar and pickers', async () => {
    await navRow(page, 'Biology').locator('.nav-main').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Archive Area' }).click();
    await expect(navRow(page, 'Biology')).toHaveCount(0);
    await expect(navRow(page, 'History')).toHaveCount(1);
  });

  await test.step('Settings lists them in the Archive, with Restore', async () => {
    await page.keyboard.press(`${MOD}+Comma`);
    await page.locator('#settings-tab-courses').click();
    const archive = page.getByTestId('settings-archive');
    await expect(archive).toContainText('Biology');
    await expect(archive).toContainText('Q4 plan');
    await archive.locator('.group-row', { hasText: 'Biology' }).getByRole('button', { name: 'Restore' }).click();
    await archive.locator('.group-row', { hasText: 'Q4 plan' }).getByRole('button', { name: 'Restore' }).click();
    await expect(archive).toContainText('Nothing is archived');
    await page.keyboard.press('Escape');
  });

  await test.step('restored, they are back with their tasks', async () => {
    await expect(navRow(page, 'Biology')).toHaveCount(1);
    await expect(navRow(page, 'Q4 plan')).toHaveCount(1);
    await sidebar(page).locator('nav.views').getByText('Home').click();
    await expect(page.locator('.view').getByText('Review budget')).toBeVisible();
  });
});

test('archiving a course works in School mode too', async ({ page }) => {
  await open(page);
  await navRow(page, 'History').locator('.nav-main').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Archive Course' }).click();
  await expect(navRow(page, 'History')).toHaveCount(0);
  await page.keyboard.press(`${MOD}+Comma`);
  await page.locator('#settings-tab-courses').click();
  await expect(page.locator('#settings-tab-courses')).toContainText('Courses');
  await expect(page.getByTestId('settings-archive')).toContainText('History');
  await page.getByTestId('settings-archive').getByRole('button', { name: 'Restore' }).click();
  await page.keyboard.press('Escape');
  await expect(navRow(page, 'History')).toHaveCount(1);
});
