// /meet: recording a meeting into a note and reading who said what. The Rust
// recorder is stood in for by src/dev-mock-meet.ts, which sends the events the
// real one does; tests steer it with `window.__TD_MEET__`.
import { test, expect, open } from './fixtures';
import type { Page } from '@playwright/test';

const doc = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__editor.getJSON()));
const text = (page: Page) => page.evaluate(() => (window as any).__editor.getText({ blockSeparator: '\n' }) as string);

/** Steers the pretend recorder. Set before the app loads. Without the summary model, so a finished meeting opens on its transcript (summaries: meet-summary.spec.ts). */
async function steer(page: Page, options: Record<string, unknown> = {}) {
  await page.addInitScript((o) => {
    (window as any).__TD_MEET__ = { tick: 25, summaryModelMissing: true, ...o };
  }, options);
}

/** A new page called `title`, with the caret in its body. */
async function newPage(page: Page, title: string) {
  await open(page, '?fresh');
  await page.keyboard.press('Control+n');
  await expect(page.locator('h1.title')).toBeFocused();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ProseMirror')).toBeFocused();
}

/** Types /meet and picks it. */
async function addMeeting(page: Page) {
  await page.keyboard.type('/meet');
  await expect(page.locator('.suggest .row', { hasText: 'Meeting' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.meeting')).toBeVisible();
}

const block = (page: Page) => page.locator('.meeting');

/** Records and stops: ends with the transcript showing. */
async function recordAndFinish(page: Page) {
  await block(page).getByRole('button', { name: 'Record' }).click();
  await expect(block(page).getByText('Recording', { exact: true })).toBeVisible();
  await block(page).getByRole('button', { name: 'Stop' }).click();
  await expect(block(page).locator('.turn')).toHaveCount(3, { timeout: 10_000 });
}

test('/meet adds a meeting block with a dated title, both sources on, and a Record button', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Standup');
  await addMeeting(page);
  await expect(block(page).getByRole('textbox', { name: 'Meeting title' })).toHaveValue(/^Meeting — /);
  await expect(block(page).getByRole('switch', { name: 'Mic' })).toHaveAttribute('aria-checked', 'true');
  await expect(block(page).getByRole('switch', { name: 'System audio' })).toHaveAttribute('aria-checked', 'true');
  await expect(block(page).getByRole('button', { name: 'Record' })).toBeEnabled();
  // A meeting needs something to record.
  await block(page).getByRole('switch', { name: 'Mic' }).click();
  await block(page).getByRole('switch', { name: 'System audio' }).click();
  await expect(block(page).getByRole('button', { name: 'Record' })).toBeDisabled();
});

test('record, pause, stop, process, and a transcript with speakers appears', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Project call');
  await addMeeting(page);
  await block(page).getByRole('textbox', { name: 'Meeting title' }).fill('Launch review');

  await block(page).getByRole('button', { name: 'Record' }).click();
  await test.step('recording shows a timer, two level meters and a red dot in the title bar', async () => {
    await expect(block(page).getByRole('meter', { name: 'Microphone level' })).toBeVisible();
    await expect(block(page).getByRole('meter', { name: 'System audio level' })).toBeVisible();
    await expect(page.locator('.titlebar .rec-dot')).toBeVisible();
    await expect(block(page).locator('.timer')).not.toHaveText('0:00');
  });
  await test.step('pause and resume', async () => {
    await block(page).getByRole('button', { name: 'Pause' }).click();
    await expect(block(page).getByText('Paused', { exact: true })).toBeVisible();
    await block(page).getByRole('button', { name: 'Resume' }).click();
    await expect(block(page).getByText('Recording', { exact: true })).toBeVisible();
  });
  await test.step('stop: processing shows its stages, then the transcript', async () => {
    await block(page).getByRole('button', { name: 'Stop' }).click();
    await expect(block(page).getByRole('status').first()).toContainText(/Preparing audio|Transcribing|Identifying speakers|Saving/);
    await expect(block(page).locator('.turn')).toHaveCount(3, { timeout: 10_000 });
    await expect(page.locator('.titlebar .rec-dot')).toHaveCount(0);
  });
  await test.step('turns read Speaker · time · text', async () => {
    await expect(block(page).locator('.turn').nth(0)).toContainText('Speaker 1');
    await expect(block(page).locator('.turn').nth(0)).toContainText('0:00');
    await expect(block(page).locator('.turn').nth(0)).toContainText('review the project schedule');
    await expect(block(page).locator('.turn').nth(1)).toContainText('Me');
    await expect(block(page).locator('.turn').nth(2)).toContainText('Speaker 2');
    await expect(block(page).getByRole('group', { name: 'Speakers' }).locator('.chip')).toHaveText(['Speaker 1', 'Me', 'Speaker 2']);
  });
  await test.step('the audio is a library file and the transcript is in the page', async () => {
    const json = await doc(page);
    expect(json).toContain('"type":"meeting"');
    expect(json).toContain('"title":"Launch review"');
    expect(json).toContain('launch date is realistic');
    await expect(block(page).locator('audio')).toHaveCount(1);
    const files = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('list_files'));
    expect(files.some((f: { name: string }) => f.name === 'Launch review.wav')).toBe(true);
  });
});

test('clicking a speaker renames them everywhere', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Names');
  await addMeeting(page);
  await recordAndFinish(page);
  // One person was heard twice: re-run detection with two people in the room.
  await block(page).getByRole('button', { name: 'Re-run speaker detection' }).click();
  await block(page).getByLabel('People in the meeting').fill('2');
  await block(page).getByRole('button', { name: 'Run', exact: true }).click();
  await expect(block(page).locator('.turn')).toHaveCount(3);
  await expect(block(page).locator('.turn .who', { hasText: 'Speaker 1' })).toHaveCount(2);

  await block(page).locator('.chip', { hasText: 'Speaker 1' }).click();
  await block(page).getByLabel('Speaker name').fill('Dana');
  await page.keyboard.press('Enter');
  await expect(block(page).locator('.turn .who', { hasText: 'Dana' })).toHaveCount(2);
  await expect(block(page).locator('.chip', { hasText: 'Dana' })).toHaveCount(1);
  await expect.poll(async () => JSON.parse(await doc(page)).content[0].attrs.names).toEqual({ '1': 'Dana' });
  // Emptying the name puts the default back.
  await block(page).locator('.chip', { hasText: 'Dana' }).click();
  await block(page).getByLabel('Speaker name').fill('');
  await page.keyboard.press('Enter');
  await expect(block(page).locator('.turn .who', { hasText: 'Speaker 1' })).toHaveCount(2);
});

test('a timestamp seeks the recording; Copy puts the transcript on the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await steer(page);
  await newPage(page, 'Seek');
  await addMeeting(page);
  await recordAndFinish(page);
  const audio = block(page).locator('audio');
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.readyState)).toBeGreaterThan(0);
  await block(page).locator('.turn').nth(2).getByRole('button', { name: /Play from 0:08/ }).click();
  await expect.poll(() => audio.evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(8);
  await expect(block(page).locator('.turn').nth(2)).toHaveClass(/active/);

  await block(page).getByRole('button', { name: 'Copy transcript' }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split('\n')).toEqual([
    'Speaker 1 · 0:00 · Welcome everyone. Today we will review the project schedule.',
    'Me · 0:04 · Thanks Daniel. I think the launch date is realistic.',
    'Speaker 2 · 0:08 · I agree. We should confirm the budget next week.',
  ]);
});

test('the transcript is the page: searched, exported and kept when the page reopens', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Findable');
  await addMeeting(page);
  await recordAndFinish(page);

  await test.step('the page text (what search indexes) has the transcript', async () => {
    const t = await text(page);
    expect(t).toContain('Me · 0:04 · Thanks Daniel. I think the launch date is realistic.');
    expect(t).toContain('Speaker 2 · 0:08');
  });
  await test.step('Markdown and the HTML copy carry it too', async () => {
    const out = await page.evaluate(async () => {
      const md = await import('/src/lib/markdown.ts' as string);
      const json = (window as any).__editor.getJSON();
      return { md: md.toMarkdown(json, 'T', () => ''), html: (window as any).__editor.getHTML() as string };
    });
    expect(out.md).toContain('**Me** · 0:04 · Thanks Daniel. I think the launch date is realistic.');
    expect(out.html).toContain('Speaker 2 · 0:08 · I agree.');
  });
  await test.step('search finds the page by what was said', async () => {
    await page.waitForTimeout(500); // the page saves a moment after the last change
    const hits = await page.evaluate(() => (window as any).__TAURI_INTERNALS__.invoke('search', { query: 'budget', limit: 5 }));
    expect(hits.map((h: { title: string }) => h.title)).toContain('Findable');
  });
  await test.step('leaving the page and coming back shows the same transcript', async () => {
    await page.keyboard.press('Control+n');
    await expect(page.locator('h1.title')).toBeFocused();
    await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Findable' }).first().click();
    await expect(block(page).locator('.turn')).toHaveCount(3);
  });
});

test('a recording goes on when the note is left, and the block finds it again', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Long call');
  await addMeeting(page);
  await block(page).getByRole('button', { name: 'Record' }).click();
  await expect(block(page).getByText('Recording', { exact: true })).toBeVisible();

  // Another page: nothing of the block is on screen, but the dot is.
  await page.locator('.titlebar').click();
  await page.keyboard.press('Control+n');
  await expect(page.locator('h1.title')).toBeFocused();
  await page.keyboard.type('Other');
  await expect(page.locator('.meeting')).toHaveCount(0);
  const dot = page.locator('.rec-chip');
  await expect(dot).toBeVisible();

  // The dot leads back, and the block is still recording.
  await dot.click();
  await expect(block(page).getByText('Recording', { exact: true })).toBeVisible();
  const t1 = await block(page).locator('.timer').textContent();
  await expect.poll(async () => block(page).locator('.timer').textContent()).not.toBe(t1);
  await block(page).getByRole('button', { name: 'Stop' }).click();
  await expect(block(page).locator('.turn')).toHaveCount(3, { timeout: 10_000 });
});

test('processing that finishes while the note is closed is picked up when it opens again', async ({ page }) => {
  await steer(page, { tick: 120 });
  await newPage(page, 'Away');
  await addMeeting(page);
  await block(page).getByRole('button', { name: 'Record' }).click();
  await expect(block(page).getByText('Recording', { exact: true })).toBeVisible();
  await block(page).getByRole('button', { name: 'Stop' }).click();
  await expect(block(page).getByRole('status').first()).toBeVisible();
  // Leave before it ends.
  await page.keyboard.press('Control+n');
  await expect(page.locator('h1.title')).toBeFocused();
  await page.waitForTimeout(2500);
  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Away' }).first().click();
  await expect(block(page).locator('.turn')).toHaveCount(3, { timeout: 10_000 });
});

test('the first Record explains the model download, and Cancel leaves nothing started', async ({ page }) => {
  await steer(page, { modelsMissing: true });
  await newPage(page, 'First use');
  await addMeeting(page);
  await block(page).getByRole('button', { name: 'Record' }).click();
  const sheet = page.getByRole('dialog', { name: 'Download the speech models' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('everything runs on this Mac');
  await expect(sheet).toContainText('Speech to text: Best');
  await expect(sheet).toContainText('MB in total');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: 'Record' })).toBeVisible();
  await expect(page.locator('.titlebar .rec-dot')).toHaveCount(0);

  // Asked again, downloading carries on into the recording.
  await block(page).getByRole('button', { name: 'Record' }).click();
  await sheet.getByRole('button', { name: 'Download' }).click();
  await expect(sheet).toHaveCount(0, { timeout: 10_000 });
  await expect(block(page).getByText('Recording', { exact: true })).toBeVisible();
});

test('a failed download says why and can be tried again', async ({ page }) => {
  await steer(page, { modelsMissing: true, failDownload: true });
  await newPage(page, 'Offline');
  await addMeeting(page);
  await block(page).getByRole('button', { name: 'Record' }).click();
  const sheet = page.getByRole('dialog', { name: 'Download the speech models' });
  await sheet.getByRole('button', { name: 'Download' }).click();
  await expect(sheet.getByRole('alert')).toContainText('503');
  await expect(sheet.getByRole('button', { name: 'Try again' })).toBeVisible();
});

test('without Screen Recording the meeting records the mic only, and says how to fix it', async ({ page }) => {
  await steer(page, { screenDenied: true });
  await newPage(page, 'No screen');
  await addMeeting(page);
  await block(page).getByRole('button', { name: 'Record' }).click();
  await expect(block(page).getByRole('meter', { name: 'Microphone level' })).toBeVisible();
  await expect(block(page).getByRole('meter', { name: 'System audio level' })).toHaveCount(0);
  await expect(block(page).locator('.notice')).toContainText("Screen Recording isn't allowed");
  await block(page).getByRole('button', { name: 'Open Screen Recording settings' }).click();
  expect(await page.evaluate(() => (window as any).__meetPrivacy)).toBe('screen');
});

test('a microphone that hears nothing is called out', async ({ page }) => {
  await steer(page, { micSilent: true });
  await newPage(page, 'Muted');
  await addMeeting(page);
  await block(page).getByRole('button', { name: 'Record' }).click();
  await expect(block(page).locator('.notice')).toContainText("isn't picking up any sound");
  await block(page).getByRole('button', { name: 'Open Microphone settings' }).click();
  expect(await page.evaluate(() => (window as any).__meetPrivacy)).toBe('microphone');
});

test('a failed run can be retried and keeps the recording until it works', async ({ page }) => {
  await steer(page, { failProcessing: true });
  await newPage(page, 'Retry');
  await addMeeting(page);
  await block(page).getByRole('button', { name: 'Record' }).click();
  await expect(block(page).getByText('Recording', { exact: true })).toBeVisible();
  await block(page).getByRole('button', { name: 'Stop' }).click();
  await expect(block(page)).toContainText("The transcript couldn't be made", { timeout: 10_000 });
  await expect(block(page)).toContainText('speech model could not be loaded');
  await block(page).getByRole('button', { name: 'Retry' }).click();
  await expect(block(page).locator('.turn')).toHaveCount(3, { timeout: 10_000 });
});

test('Delete recording clears the audio and transcript after asking', async ({ page }) => {
  await steer(page);
  await newPage(page, 'Delete');
  await addMeeting(page);
  await recordAndFinish(page);
  await block(page).getByRole('button', { name: 'Delete recording and transcript' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(block(page).locator('.turn')).toHaveCount(0);
  await expect(block(page).getByRole('button', { name: 'Record' })).toBeVisible();
});

test('Settings has a Meetings pane for the model, language and the models on disk', async ({ page }) => {
  await steer(page);
  await open(page, '?fresh');
  await page.keyboard.press('Control+,');
  await page.getByRole('tab', { name: 'Meetings' }).click();
  await expect(page.getByText('Everything runs on this Mac.')).toBeVisible();
  const model = page.getByLabel('Quality');
  await expect(model).toHaveValue('best');
  await model.selectOption('balanced');
  await page.getByLabel('Language', { exact: true }).selectOption('es');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('thoughtnotes.meet.v1')!))).toMatchObject({ model: 'balanced', language: 'es' });
  await expect(page.getByText('700.0 MB on this Mac').or(page.getByText(/MB on this Mac/))).toBeVisible();
  await page.getByRole('button', { name: 'Delete models' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('None downloaded')).toBeVisible();
});
