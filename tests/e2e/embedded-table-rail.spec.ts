// tests/e2e/embedded-table-rail.spec.ts
// Verifies the compact top horizontal scroll rail for embedded tables:
// visibility rules, range matching, echo guarding, bidirectional synchronization,
// dynamic resizing, and instance independence.
import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

test.use({ viewport: { width: 1280, height: 800 } });

/** Seeds wide and narrow databases and a host page with embedded tables. */
async function seed(page: Page) {
  return page.evaluate(async () => {
    const invoke = (window as any).__TAURI_INTERNALS__.invoke as (cmd: string, args?: unknown) => Promise<any>;
    const k = (i: number) => `a${i.toString(36).padStart(4, '0')}`;

    // 1. Wide database (overflows horizontally)
    const wideProps: any[] = [{ id: 'title', name: 'Name', type: 'title', config: {}, sortKey: k(0) }];
    for (let i = 0; i < 24; i++) {
      wideProps.push({
        id: `p${String(i).padStart(2, '0')}`,
        name: `Column ${String(i + 1).padStart(2, '0')}`,
        type: 'text',
        config: {},
        sortKey: k(i + 1),
      });
    }
    const wideRows = Array.from({ length: 40 }, (_, i) => {
      const n = String(i + 1).padStart(3, '0');
      const cells: Record<string, string> = {};
      for (let c = 0; c < 24; c++) {
        cells[`p${String(c).padStart(2, '0')}`] = `Val ${n}-${c + 1}`;
      }
      return { title: `Row ${n}`, sortKey: k(i), cells };
    });
    const wideDb = await invoke('create_database', {
      parentId: null,
      title: 'Wide Probe',
      icon: '',
      input: {
        properties: wideProps,
        views: [{ id: 'table', name: 'Table', type: 'table', config: {}, sortKey: 'a0' }],
        rows: wideRows,
      },
    });

    // 2. Narrow database (does NOT overflow horizontally)
    const narrowProps: any[] = [
      { id: 'title', name: 'Item', type: 'title', config: {}, sortKey: k(0) },
      { id: 'tag', name: 'Tag', type: 'text', config: {}, sortKey: k(1) },
    ];
    const narrowRows = [
      { title: 'Alpha', sortKey: k(0), cells: { tag: 'A' } },
      { title: 'Beta', sortKey: k(1), cells: { tag: 'B' } },
    ];
    const narrowDb = await invoke('create_database', {
      parentId: null,
      title: 'Narrow Probe',
      icon: '',
      input: {
        properties: narrowProps,
        views: [{ id: 'table', name: 'Table', type: 'table', config: {}, sortKey: 'a0' }],
        rows: narrowRows,
      },
    });

    // 3. Host page embedding two wide tables and one narrow table
    const host = await invoke('create_page', { parentId: null, title: 'Rail Host', icon: '' });
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'First wide table' }] },
        { type: 'databaseBlock', attrs: { id: wideDb.page.id, view: 'table' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Narrow table' }] },
        { type: 'databaseBlock', attrs: { id: narrowDb.page.id, view: 'table' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second wide table' }] },
        { type: 'databaseBlock', attrs: { id: wideDb.page.id, view: 'table' } },
      ],
    };
    await invoke('update_page', { id: host.id, patch: { content: JSON.stringify(doc) } });
    return { wideId: wideDb.page.id as string, narrowId: narrowDb.page.id as string, hostId: host.id as string };
  });
}

test('top rail is hidden in full-page views and narrow embedded tables', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  // 1. Full-page view of wide database -> no top rail
  await page.locator('.sidebar .db-row .nav-main', { hasText: 'Wide Probe' }).first().click();
  await expect(page.locator('.table .grid')).toBeVisible();
  await page.waitForTimeout(200);
  expect(await page.locator('.table .rail').count()).toBe(0);

  // 2. Open host page with embedded tables
  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  await page.waitForTimeout(400);

  const blocks = page.locator('.database-block');
  await expect(blocks).toHaveCount(3);

  // Block 1 (Wide): rail is visible
  const wideTable1 = blocks.nth(0).locator('.table');
  await expect(wideTable1.locator('.rail')).toBeVisible();

  // Block 2 (Narrow): rail is hidden (no overflow)
  const narrowTable = blocks.nth(1).locator('.table');
  expect(await narrowTable.locator('.rail').count()).toBe(0);

  // Block 3 (Wide): rail is visible
  const wideTable2 = blocks.nth(2).locator('.table');
  await expect(wideTable2.locator('.rail')).toBeVisible();
});

test('rail range matches body scrollWidth and clientWidth at both endpoints', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();
  await page.waitForTimeout(200);

  const dims = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return {
      bodyScrollW: body.scrollWidth,
      bodyClientW: body.clientWidth,
      railScrollW: rail.scrollWidth,
      railClientW: rail.clientWidth,
      bodyMaxScroll: body.scrollWidth - body.clientWidth,
      railMaxScroll: rail.scrollWidth - rail.clientWidth,
    };
  });

  // Range must match
  expect(dims.bodyScrollW).toBeGreaterThan(dims.bodyClientW);
  expect(Math.abs(dims.railScrollW - dims.bodyScrollW)).toBeLessThanOrEqual(1);
  expect(Math.abs(dims.railClientW - dims.bodyClientW)).toBeLessThanOrEqual(1);
  expect(Math.abs(dims.railMaxScroll - dims.bodyMaxScroll)).toBeLessThanOrEqual(1);

  // Scroll to max endpoint
  await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = body.scrollWidth - body.clientWidth;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const endPositions = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { bodyLeft: body.scrollLeft, railLeft: rail.scrollLeft };
  });
  expect(Math.abs(endPositions.railLeft - endPositions.bodyLeft)).toBeLessThanOrEqual(1);

  // Scroll back to start endpoint
  await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 0;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const startPositions = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { bodyLeft: body.scrollLeft, railLeft: rail.scrollLeft };
  });
  expect(startPositions.bodyLeft).toBe(0);
  expect(startPositions.railLeft).toBe(0);
});

test('delayed rail echo does not pull body back, and genuine rail move leads body', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();

  const out = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;

    // 1. Body scrolls to 600, mirrors to rail
    body.scrollLeft = 600;
    body.dispatchEvent(new Event('scroll'));
    const mirroredRail = rail.scrollLeft;

    // 2. Body moves to 1200 before rail echo arrives
    body.scrollLeft = 1200;

    // 3. Delayed rail echo arrives with rail at 600
    rail.dispatchEvent(new Event('scroll'));
    const afterEchoBody = body.scrollLeft;

    // 4. A genuine rail gesture to 900 leads body
    rail.scrollLeft = 900;
    rail.dispatchEvent(new Event('scroll'));
    const afterRailMove = body.scrollLeft;

    return { mirroredRail, afterEchoBody, afterRailMove };
  });

  expect(out.mirroredRail).toBe(600);
  // Echo must NOT pull body back from 1200 to 600
  expect(out.afterEchoBody).toBe(1200);
  // Genuine rail move leads body to 900
  expect(out.afterRailMove).toBe(900);
});

test('rail move keeps column headers and cells aligned', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();

  // Scroll via rail to 800
  await table.evaluate((el) => {
    const rail = el.querySelector('.rail') as HTMLElement;
    rail.scrollLeft = 800;
    rail.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  // Check header and row rectangles alignment
  const th = await table.locator('.th[data-prop="p05"]').boundingBox();
  const td = await table.locator('.td[data-r="0"][data-c="6"]').boundingBox();
  expect(th).not.toBeNull();
  expect(td).not.toBeNull();
  expect(Math.abs(th!.x - td!.x)).toBeLessThanOrEqual(1.5);
});

test('genuine header movement also updates the top rail, and newer body movement takes precedence', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();

  // 1. Scroll header strip to 850
  await table.evaluate((el) => {
    const head = el.querySelector('.head-wrap') as HTMLElement;
    head.scrollLeft = 850;
    head.dispatchEvent(new Event('scroll'));
  });

  await expect.poll(async () => table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const head = el.querySelector('.head-wrap') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { body: body.scrollLeft, head: head.scrollLeft, rail: rail.scrollLeft };
  })).toEqual({ body: 850, head: 850, rail: 850 });

  // 2. Newer body movement during pending header-led event:
  const afterNewBodyFromHead = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const head = el.querySelector('.head-wrap') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    head.scrollLeft = 1200;
    head.dispatchEvent(new Event('scroll'));
    body.scrollLeft = 600;
    body.dispatchEvent(new Event('scroll'));
    return { body: body.scrollLeft, head: head.scrollLeft, rail: rail.scrollLeft };
  });
  expect(afterNewBodyFromHead).toEqual({ body: 600, head: 600, rail: 600 });
  await expect.poll(async () => table.evaluate((el) => ({
    body: (el.querySelector('.body') as HTMLElement).scrollLeft,
    head: (el.querySelector('.head-wrap') as HTMLElement).scrollLeft,
    rail: (el.querySelector('.rail') as HTMLElement).scrollLeft,
  }))).toEqual({ body: 600, head: 600, rail: 600 });

  // 3. Newer body movement during pending rail-led event:
  const afterNewBodyFromRail = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const head = el.querySelector('.head-wrap') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    rail.scrollLeft = 1100;
    rail.dispatchEvent(new Event('scroll'));
    body.scrollLeft = 500;
    body.dispatchEvent(new Event('scroll'));
    return { body: body.scrollLeft, head: head.scrollLeft, rail: rail.scrollLeft };
  });
  expect(afterNewBodyFromRail).toEqual({ body: 500, head: 500, rail: 500 });
  await expect.poll(async () => table.evaluate((el) => ({
    body: (el.querySelector('.body') as HTMLElement).scrollLeft,
    head: (el.querySelector('.head-wrap') as HTMLElement).scrollLeft,
    rail: (el.querySelector('.rail') as HTMLElement).scrollLeft,
  }))).toEqual({ body: 500, head: 500, rail: 500 });
});

test('dynamic viewport resizing updates rail range and dimensions', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();

  // Initial measurements at 1280px viewport
  const initDims = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return {
      bodyScrollW: body.scrollWidth,
      bodyClientW: body.clientWidth,
      railScrollW: rail.scrollWidth,
      railClientW: rail.clientWidth,
      maxDiff: Math.abs((rail.scrollWidth - rail.clientWidth) - (body.scrollWidth - body.clientWidth)),
    };
  });
  expect(Math.abs(initDims.railScrollW - initDims.bodyScrollW)).toBeLessThanOrEqual(1);
  expect(Math.abs(initDims.railClientW - initDims.bodyClientW)).toBeLessThanOrEqual(1);
  expect(initDims.maxDiff).toBeLessThanOrEqual(1);

  // Narrow viewport to 700px
  await page.setViewportSize({ width: 700, height: 800 });
  await page.waitForTimeout(300);

  const narrowDims = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return {
      bodyScrollW: body.scrollWidth,
      bodyClientW: body.clientWidth,
      railScrollW: rail.scrollWidth,
      railClientW: rail.clientWidth,
      maxDiff: Math.abs((rail.scrollWidth - rail.clientWidth) - (body.scrollWidth - body.clientWidth)),
    };
  });
  expect(narrowDims.railClientW).toBeLessThan(initDims.railClientW);
  expect(Math.abs(narrowDims.railScrollW - narrowDims.bodyScrollW)).toBeLessThanOrEqual(1);
  expect(Math.abs(narrowDims.railClientW - narrowDims.bodyClientW)).toBeLessThanOrEqual(1);
  expect(narrowDims.maxDiff).toBeLessThanOrEqual(1);

  // Widen viewport to 1600px
  await page.setViewportSize({ width: 1600, height: 800 });
  await page.waitForTimeout(300);

  const wideDims = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return {
      bodyScrollW: body.scrollWidth,
      bodyClientW: body.clientWidth,
      railScrollW: rail.scrollWidth,
      railClientW: rail.clientWidth,
      maxDiff: Math.abs((rail.scrollWidth - rail.clientWidth) - (body.scrollWidth - body.clientWidth)),
    };
  });
  expect(wideDims.railClientW).toBeGreaterThan(narrowDims.railClientW);
  expect(Math.abs(wideDims.railScrollW - wideDims.bodyScrollW)).toBeLessThanOrEqual(1);
  expect(Math.abs(wideDims.railClientW - wideDims.bodyClientW)).toBeLessThanOrEqual(1);
  expect(wideDims.maxDiff).toBeLessThanOrEqual(1);

  // Restore standard viewport
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(200);
});

test('column hide/show switches rail visibility, and remounted rail matches clamped body scroll', async ({ page }) => {
  await open(page);
  const info = await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const table = page.locator('.database-block .table').first();
  await expect(table.locator('.rail')).toBeVisible();

  // Scroll body to 400
  await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 400;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const beforeHide = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { body: body.scrollLeft, rail: rail.scrollLeft };
  });
  expect(beforeHide.body).toBe(400);
  expect(beforeHide.rail).toBe(400);

  // Hide 23 of the 24 columns via store so table fits in view (no overflow)
  await page.evaluate(async ({ wideId }) => {
    const databases = (window as any).databases;
    const hidden = Array.from({ length: 23 }, (_, i) => `p${String(i).padStart(2, '0')}`);
    databases.updateView(wideId, 'table', { hidden });
  }, { wideId: info.wideId });

  // Rail should hide because table no longer overflows
  await expect(table.locator('.rail')).toHaveCount(0);

  // When content no longer overflows, browser legitimately clamps body.scrollLeft
  const clampedBodyScroll = await table.evaluate((el) => (el.querySelector('.body') as HTMLElement).scrollLeft);
  expect(clampedBodyScroll).toBe(0);

  // Restore columns so table overflows again
  await page.evaluate(async ({ wideId }) => {
    const databases = (window as any).databases;
    databases.updateView(wideId, 'table', { hidden: [] });
  }, { wideId: info.wideId });

  // Rail remounts and is visible
  await expect(table.locator('.rail')).toBeVisible();

  // Verify rail initializes to match the actual post-clamp body position
  const afterUnhide = await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return {
      bodyLeft: body.scrollLeft,
      railLeft: rail.scrollLeft,
      diff: Math.abs(rail.scrollLeft - body.scrollLeft),
    };
  });
  expect(afterUnhide.bodyLeft).toBe(clampedBodyScroll);
  expect(afterUnhide.diff).toBeLessThanOrEqual(1);
});

test('multiple independent embedded instances do not control each other', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Rail Host' }).first().click();
  const blocks = page.locator('.database-block');
  const table1 = blocks.nth(0).locator('.table');
  const table2 = blocks.nth(2).locator('.table');

  await expect(table1.locator('.rail')).toBeVisible();
  await expect(table2.locator('.rail')).toBeVisible();

  // Move table 1 via rail to 450
  await table1.evaluate((el) => {
    const rail = el.querySelector('.rail') as HTMLElement;
    rail.scrollLeft = 450;
    rail.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const t1State = await table1.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { body: body.scrollLeft, rail: rail.scrollLeft };
  });
  const t2State = await table2.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { body: body.scrollLeft, rail: rail.scrollLeft };
  });

  expect(t1State.body).toBe(450);
  expect(t1State.rail).toBe(450);
  expect(t2State.body).toBe(0);
  expect(t2State.rail).toBe(0);

  // Move table 2 via rail to 700
  await table2.evaluate((el) => {
    const rail = el.querySelector('.rail') as HTMLElement;
    rail.scrollLeft = 700;
    rail.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const t1StateAfter = await table1.evaluate((el) => (el.querySelector('.body') as HTMLElement).scrollLeft);
  const t2StateAfter = await table2.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    const rail = el.querySelector('.rail') as HTMLElement;
    return { body: body.scrollLeft, rail: rail.scrollLeft };
  });

  expect(t1StateAfter).toBe(450);
  expect(t2StateAfter.body).toBe(700);
  expect(t2StateAfter.rail).toBe(700);
});
