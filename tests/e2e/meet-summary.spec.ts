// /meet summaries: the Summary and Transcript tabs, meeting types, and the
// summary model. The local model is stood in for by src/dev-mock-meet.ts,
// whose canned summary ends with a "Notes" line echoing the type's first
// instruction line, so tests can tell which type wrote it.
import { test, expect, open } from './fixtures';
import type { Page } from '@playwright/test';

async function steer(page: Page, options: Record<string, unknown> = {}) {
  await page.addInitScript((o) => {
    (window as any).__TD_MEET__ = { tick: 25, ...o };
  }, options);
}

async function newPage(page: Page, title: string) {
  await open(page, '?fresh');
  await page.keyboard.press('Control+n');
  await expect(page.locator('h1.title')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror')).toBeFocused();
}

async function addMeeting(page: Page) {
  await page.keyboard.type('/meet');
  await expect(page.locator('.suggest .row', { hasText: 'Meeting' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.meeting').last()).toBeVisible();
}

const block = (page: Page, i = 0) => page.locator('.meeting').nth(i);
const tab = (page: Page, name: 'Summary' | 'Transcript', i = 0) => block(page, i).getByRole('tab', { name });
const summary = (page: Page, i = 0) => block(page, i).locator('.summary-body');
/** The line under a summary: "Written as <type> · <time>". */
const footer = (page: Page, i: number | string = 0, type?: string) =>
  typeof i === 'string' ? block(page).locator('.footer', { hasText: `Written as ${i}` }) : block(page, i).locator('.footer', { hasText: `Written as ${type}` });

async function recordAndFinish(page: Page, i = 0) {
  await block(page, i).getByRole('button', { name: 'Record' }).click();
  await expect(block(page, i).getByText('Recording', { exact: true })).toBeVisible();
  await block(page, i).getByRole('button', { name: 'Stop' }).click();
  await expect(tab(page, 'Transcript', i)).toBeVisible({ timeout: 10_000 });
}

const GENERAL_FIRST_LINE = 'Write these sections:';

test('a finished meeting opens on Summary with a written summary, and Transcript shows the turns', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(tab(page, 'Summary')).toHaveAttribute('aria-selected', 'true');
  await expect(summary(page).getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 10_000 });
  await expect(summary(page).locator('strong', { hasText: 'Speaker 2' })).toBeVisible();
  await expect(footer(page, 'General')).toBeVisible();
  await expect(block(page).locator('.turn')).toHaveCount(0);
  await tab(page, 'Transcript').click();
  await expect(block(page).locator('.turn')).toHaveCount(3);
  await expect(summary(page)).toHaveCount(0);
});

test('changing the type shows the stale hint and Regenerate replaces the summary', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(footer(page, 'General')).toBeVisible({ timeout: 10_000 });
  await block(page).getByLabel('Meeting type').selectOption({ label: '1:1' });
  await expect(block(page).getByText(/Regenerate to use the current type/)).toBeVisible();
  await block(page).getByRole('button', { name: 'Regenerate' }).click();
  await expect(footer(page, '1:1')).toBeVisible({ timeout: 10_000 });
  await expect(summary(page)).toContainText('This is a one-on-one between two people.');
  await expect(block(page).getByText(/Regenerate to use the current type/)).toHaveCount(0);
});

test('without the summary model, Transcript works and Summary offers the download', async ({ page }) => {
  await steer(page, { summaryModelMissing: true });
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(tab(page, 'Transcript')).toHaveAttribute('aria-selected', 'true');
  await expect(block(page).locator('.turn')).toHaveCount(3);
  await tab(page, 'Summary').click();
  await block(page).getByRole('button', { name: 'Download summary model' }).click();
  const sheet = page.locator('.sheet');
  await expect(sheet).toContainText('2.7 GB');
  await sheet.getByRole('button', { name: /Download/ }).click();
  await expect(sheet).toHaveCount(0, { timeout: 10_000 });
  await block(page).getByRole('button', { name: 'Summarize' }).click();
  await expect(summary(page).getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 10_000 });
});

test('a failed summary says why and can be tried again', async ({ page }) => {
  await steer(page, { failSummary: true });
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(block(page).getByText("The summary couldn't be written.")).toBeVisible({ timeout: 10_000 });
  await block(page).getByRole('button', { name: 'Try again' }).click();
  await expect(summary(page).getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 10_000 });
});

test('Cancel stops a summary and leaves the previous one', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(footer(page, 'General')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => ((window as any).__TD_MEET__.summaryTick = 400));
  await block(page).getByLabel('Meeting type').selectOption({ label: 'Sales call' });
  await block(page).getByRole('button', { name: 'Regenerate' }).click();
  await block(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(block(page).getByRole('button', { name: 'Regenerate' })).toBeVisible();
  await expect(footer(page, 'General')).toBeVisible();
  await expect(summary(page)).toContainText(GENERAL_FIRST_LINE);
});

test('a second summary waits its turn', async ({ page }) => {
  await steer(page, { summaryTick: 600 });
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page, 0);
  await page.locator('.ProseMirror').press('Control+End');
  await page.keyboard.press('Enter');
  await addMeeting(page);
  await recordAndFinish(page, 1);
  await expect(block(page, 1).getByText('Waiting for another summary or recording to finish…')).toBeVisible();
  await expect(footer(page, 0, 'General')).toBeVisible({ timeout: 15_000 });
  await expect(footer(page, 1, 'General')).toBeVisible({ timeout: 15_000 });
});

test('leaving mid-summary leaves no stuck state', async ({ page }) => {
  await steer(page, { summaryTick: 300 });
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(block(page).getByText('Writing the summary…')).toBeVisible();
  await page.keyboard.press('Control+n');
  await page.keyboard.type('Other');
  await page.getByRole('treeitem', { name: 'Project sync' }).click();
  await expect(block(page)).toBeVisible();
  await expect(block(page).getByText('Writing the summary…')).toHaveCount(0, { timeout: 15_000 });
  await tab(page, 'Summary').click();
  await expect(block(page).getByText('Writing the summary…')).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: /Summarize|Regenerate/ })).toBeVisible();
});

test('Delete recording clears the summary', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(footer(page, 'General')).toBeVisible({ timeout: 10_000 });
  await tab(page, 'Transcript').click();
  await block(page).getByRole('button', { name: 'Delete recording' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(block(page).getByRole('button', { name: 'Record' })).toBeVisible();
  const doc = await page.evaluate(() => JSON.stringify((window as any).__editor.getJSON()));
  expect(doc).not.toContain('Overview');
});

// ---- Settings

async function openMeetingsSettings(page: Page) {
  await page.keyboard.press('Control+,');
  await page.getByRole('tab', { name: 'Meetings' }).click();
}

test('a custom type added in Settings appears in the menu and steers the summary', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Project sync');
  await openMeetingsSettings(page);
  await page.getByRole('button', { name: 'Add type' }).click();
  await page.getByLabel('Type name').fill('Project review');
  await page.getByLabel('Instructions').fill('List risks first.');
  await page.keyboard.press('Escape');
  await page.locator('.ProseMirror').click();
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(footer(page, 'General')).toBeVisible({ timeout: 10_000 });
  await block(page).getByLabel('Meeting type').selectOption({ label: 'Project review' });
  await block(page).getByRole('button', { name: 'Regenerate' }).click();
  await expect(footer(page, 'Project review')).toBeVisible({ timeout: 10_000 });
  await expect(summary(page)).toContainText('List risks first.');
});

test('an edited built-in shows Reset to default, which restores it', async ({ page }) => {
  await steer(page);
  await open(page, '?fresh');
  await openMeetingsSettings(page);
  await page.getByRole('button', { name: 'Team meeting' }).click();
  await expect(page.getByLabel('Type name')).toHaveCount(0);
  const instructions = page.getByLabel('Instructions');
  await instructions.fill('Blockers first.');
  await page.getByRole('button', { name: 'Reset to default' }).click();
  await expect(instructions).toHaveValue(/This is a team meeting\./);
  await expect(page.getByRole('button', { name: 'Reset to default' })).toHaveCount(0);
});

test('Settings shows the summary model and can delete it', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Project sync');
  await openMeetingsSettings(page);
  await expect(page.getByText('Summary model')).toBeVisible();
  await page.getByRole('button', { name: 'Delete summary model' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download summary model' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.locator('.ProseMirror').click();
  await addMeeting(page);
  await recordAndFinish(page);
  await tab(page, 'Summary').click();
  await expect(block(page).getByRole('button', { name: 'Download summary model' })).toBeVisible();
});

test('the summary is searched and exported', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Project sync');
  await addMeeting(page);
  await recordAndFinish(page);
  await expect(footer(page, 'General')).toBeVisible({ timeout: 10_000 });
  const text = await page.evaluate(() => (window as any).__editor.getText({ blockSeparator: '\n' }) as string);
  expect(text).toContain('The launch date stays.');
  const md = await page.evaluate(async () => {
    const { toMarkdown } = await import('/src/lib/markdown.ts');
    return toMarkdown((window as any).__editor.getJSON(), 'Project sync', () => '');
  });
  expect(md).toContain('**Summary**');
  expect(md).toContain('## Overview');
});
