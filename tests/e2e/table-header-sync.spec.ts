// tests/e2e/table-header-sync.spec.ts
// Verifies horizontal scroll synchronization between the header strip (.head-wrap)
// and the table body (.body) in both full-page and embedded layouts.
import type { Page } from '@playwright/test';
import { test, expect, open } from './fixtures';

test.use({ viewport: { width: 1280, height: 800 } });

/** Seeds a 30-column, 120-row database and a host page containing two embedded copies. */
async function seed(page: Page) {
  return page.evaluate(async () => {
    const invoke = (window as any).__TAURI_INTERNALS__.invoke as (cmd: string, args?: unknown) => Promise<any>;
    const k = (i: number) => `a${i.toString(36).padStart(4, '0')}`;
    const properties: any[] = [{ id: 'title', name: 'Name', type: 'title', config: {}, sortKey: k(0) }];
    for (let i = 0; i < 29; i++) {
      properties.push({
        id: `p${String(i).padStart(2, '0')}`,
        name: `Field ${String(i + 1).padStart(2, '0')}`,
        type: 'text',
        config: {},
        sortKey: k(i + 1),
      });
    }
    properties.push({
      id: 'stage',
      name: 'Stage',
      type: 'select',
      config: {
        options: [
          { id: 's1', name: 'Alpha', color: 'blue' },
          { id: 's2', name: 'Beta', color: 'green' },
        ],
      },
      sortKey: k(30),
    });
    const rows = Array.from({ length: 120 }, (_, i) => {
      const n = String(i + 1).padStart(3, '0');
      const cells: Record<string, string> = { stage: `s${(i % 2) + 1}` };
      for (let c = 0; c < 29; c++) {
        cells[`p${String(c).padStart(2, '0')}`] = `R${n} C${String(c + 2).padStart(2, '0')}`;
      }
      return { title: `Row ${n}`, sortKey: k(i), cells };
    });
    const made = await invoke('create_database', {
      parentId: null,
      title: 'Sync probe',
      icon: '',
      input: {
        properties,
        views: [{ id: 'table', name: 'Table', type: 'table', config: {}, sortKey: 'a0' }],
        rows,
      },
    });
    const host = await invoke('create_page', { parentId: null, title: 'Sync host', icon: '' });
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Two embedded table views.' }] },
        { type: 'databaseBlock', attrs: { id: made.page.id, view: 'table' } },
        { type: 'databaseBlock', attrs: { id: made.page.id, view: 'table' } },
      ],
    };
    await invoke('update_page', { id: host.id, patch: { content: JSON.stringify(doc) } });
    return { dbId: made.page.id as string, hostId: host.id as string };
  });
}

async function openSyncProbe(page: Page) {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);
  await page.locator('.sidebar .db-row .nav-main', { hasText: 'Sync probe' }).first().click();
  await expect(page.locator('.table .grid')).toBeVisible();
  await page.waitForTimeout(300);
}

async function openSyncHost(page: Page) {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);
  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Sync host' }).first().click();
  await expect(page.locator('.database-block .table').first()).toBeVisible();
  await page.waitForTimeout(300);
}

test('causal race: body drag is never pulled back by a delayed header echo', async ({ page }) => {
  await openSyncProbe(page);
  const table = page.locator('.table').first();

  const out = await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;

    // 1. body -> 600 and dispatch body scroll
    body.scrollLeft = 600;
    body.dispatchEvent(new Event('scroll'));
    const mirroredHead = headWrap.scrollLeft;

    // 2. body moves to 1200 without dispatch (e.g. rapid drag progression)
    body.scrollLeft = 1200;

    // 3. delayed header echo at 600 arrives
    headWrap.dispatchEvent(new Event('scroll'));
    const afterEchoBody = body.scrollLeft;

    // 4. dispatch latest body event
    body.dispatchEvent(new Event('scroll'));
    const finalHead = headWrap.scrollLeft;
    const finalBody = body.scrollLeft;

    return { mirroredHead, afterEchoBody, finalHead, finalBody };
  });

  expect(out.mirroredHead).toBe(600);
  // Body must remain 1200 instead of being reset to 600 by the delayed header echo
  expect(out.afterEchoBody).toBe(1200);
  expect(out.finalHead).toBe(1200);
  expect(out.finalBody).toBe(1200);
});

test('asynchronous event-loop and animation-frame settling keeps header and rows aligned', async ({ page }) => {
  await openSyncProbe(page);
  const table = page.locator('.table').first();

  await table.evaluate(async (el) => {
    const body = el.querySelector('.body') as HTMLElement;
    // Simulate multi-frame drag steps
    const steps = [150, 320, 540, 780, 1050];
    for (const pos of steps) {
      body.scrollLeft = pos;
      body.dispatchEvent(new Event('scroll'));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    }
  });

  await page.waitForTimeout(100);

  const diff = await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return Math.abs(headWrap.scrollLeft - body.scrollLeft);
  });
  expect(diff).toBeLessThanOrEqual(1);

  // Measure rectangle alignment of visible headers and cells
  const th = await table.locator('.th[data-prop="p05"]').boundingBox();
  const td = await table.locator('.td[data-r="0"][data-c="6"]').boundingBox();
  expect(th).not.toBeNull();
  expect(td).not.toBeNull();
  expect(Math.abs(th!.x - td!.x)).toBeLessThanOrEqual(1.5);
});

test('rapid movement and reversal preserves header alignment', async ({ page }) => {
  await openSyncProbe(page);
  const table = page.locator('.table').first();

  await table.evaluate(async (el) => {
    const body = el.querySelector('.body') as HTMLElement;
    // Rapid forward movement
    for (let x = 100; x <= 1400; x += 300) {
      body.scrollLeft = x;
      body.dispatchEvent(new Event('scroll'));
    }
    // Rapid reversal
    for (let x = 1200; x >= 200; x -= 300) {
      body.scrollLeft = x;
      body.dispatchEvent(new Event('scroll'));
    }
    body.scrollLeft = 200;
    body.dispatchEvent(new Event('scroll'));
  });

  await page.waitForTimeout(100);

  const state = await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return {
      headLeft: headWrap.scrollLeft,
      bodyLeft: body.scrollLeft,
      diff: Math.abs(headWrap.scrollLeft - body.scrollLeft),
    };
  });

  expect(state.bodyLeft).toBe(200);
  expect(state.headLeft).toBe(200);
  expect(state.diff).toBeLessThanOrEqual(1);
});

test('genuine header scroll leads the body sideways', async ({ page }) => {
  await openSyncProbe(page);
  const table = page.locator('.table').first();

  await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    headWrap.scrollLeft = 850;
    headWrap.dispatchEvent(new Event('scroll'));
  });

  await page.waitForTimeout(100);

  const state = await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return {
      headLeft: headWrap.scrollLeft,
      bodyLeft: body.scrollLeft,
      diff: Math.abs(headWrap.scrollLeft - body.scrollLeft),
    };
  });

  expect(state.headLeft).toBe(850);
  expect(state.bodyLeft).toBe(850);
  expect(state.diff).toBeLessThanOrEqual(1);

  // Rectangle check on column p04 (Field 05)
  const th = await table.locator('.th[data-prop="p04"]').boundingBox();
  const td = await table.locator('.td[data-r="0"][data-c="5"]').boundingBox();
  expect(th).not.toBeNull();
  expect(td).not.toBeNull();
  expect(Math.abs(th!.x - td!.x)).toBeLessThanOrEqual(1.5);
});

test('focusing offscreen header control reveals it and leads the body', async ({ page }) => {
  await openSyncProbe(page);
  const table = page.locator('.table').first();

  // Initially body is at 0
  const initialLeft = await table.evaluate((el) => (el.querySelector('.body') as HTMLElement).scrollLeft);
  expect(initialLeft).toBe(0);

  // The column header row has tabindex="-1" on individual column cells, while the
  // trailing Add Property button (.th.add) is a focusable button positioned at the
  // far right of the header strip past all 30 columns.
  const addButton = table.locator('.th.add');
  await addButton.focus();

  // Verify document.activeElement is indeed the focused button
  const isButtonActive = await page.evaluate(() => {
    const el = document.activeElement;
    return el?.tagName === 'BUTTON' && el.classList.contains('add');
  });
  expect(isButtonActive).toBe(true);

  await page.waitForTimeout(200);

  // Focus-driven reveal scrolled headWrap, and syncHeadScroll led the body
  const finalState = await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return {
      headLeft: headWrap.scrollLeft,
      bodyLeft: body.scrollLeft,
      diff: Math.abs(headWrap.scrollLeft - body.scrollLeft),
    };
  });

  expect(finalState.headLeft).toBeGreaterThan(1000);
  expect(finalState.bodyLeft).toBeGreaterThan(1000);
  expect(finalState.diff).toBeLessThanOrEqual(1);

  // Bounding box assertion: button is in the visible viewport
  const btnBox = await addButton.boundingBox();
  expect(btnBox).not.toBeNull();
  expect(btnBox!.x + btnBox!.width).toBeGreaterThan(0);
});

test('two simultaneous embedded copies do not control each other', async ({ page }) => {
  await openSyncHost(page);

  const tables = page.locator('.database-block .table');
  await expect(tables).toHaveCount(2);

  const table1 = tables.nth(0);
  const table2 = tables.nth(1);

  // Scroll first table to 500
  await table1.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 500;
    body.dispatchEvent(new Event('scroll'));
  });

  await page.waitForTimeout(100);

  const state1 = await table1.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return { head: headWrap.scrollLeft, body: body.scrollLeft };
  });

  const state2Initial = await table2.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return { head: headWrap.scrollLeft, body: body.scrollLeft };
  });

  expect(state1.body).toBe(500);
  expect(state1.head).toBe(500);
  // Table 2 must NOT have moved
  expect(state2Initial.body).toBe(0);
  expect(state2Initial.head).toBe(0);

  // Now scroll table 2 to 350
  await table2.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 350;
    body.dispatchEvent(new Event('scroll'));
  });

  await page.waitForTimeout(100);

  const state1After = await table1.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    return body.scrollLeft;
  });

  const state2After = await table2.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return { head: headWrap.scrollLeft, body: body.scrollLeft };
  });

  // Table 1 remains at 500, Table 2 is at 350
  expect(state1After).toBe(500);
  expect(state2After.body).toBe(350);
  expect(state2After.head).toBe(350);
});

test('embedded table: causal race delayed header echo does not pull body back', async ({ page }) => {
  await openSyncHost(page);
  const table = page.locator('.database-block .table').first();

  const out = await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;

    body.scrollLeft = 600;
    body.dispatchEvent(new Event('scroll'));

    body.scrollLeft = 1200;

    headWrap.dispatchEvent(new Event('scroll'));
    const afterEchoBody = body.scrollLeft;

    body.dispatchEvent(new Event('scroll'));
    const finalHead = headWrap.scrollLeft;
    const finalBody = body.scrollLeft;

    return { afterEchoBody, finalHead, finalBody };
  });

  expect(out.afterEchoBody).toBe(1200);
  expect(out.finalHead).toBe(1200);
  expect(out.finalBody).toBe(1200);
});

test('frozen columns stay pinned while scrolled body and header align', async ({ page }) => {
  await openSyncProbe(page);
  const table = page.locator('.table').first();

  // Freeze through Title column
  await table.locator('.head .th[data-prop="title"]').click();
  await page.locator('.db-pop button', { hasText: 'Freeze through this column' }).click();
  await page.waitForTimeout(300);

  // Scroll body to 1000
  await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 1000;
    body.dispatchEvent(new Event('scroll'));
  });

  await page.waitForTimeout(100);

  // Assert Title column header and Title cell remain pinned at the left edge
  const gutterBox = await table.locator('.tr .gutter').first().boundingBox();
  const titleThBox = await table.locator('.th.pinned[data-prop="title"]').boundingBox();
  const titleTdBox = await table.locator('.td.pinned[data-r="0"][data-c="0"]').boundingBox();

  expect(gutterBox).not.toBeNull();
  expect(titleThBox).not.toBeNull();
  expect(titleTdBox).not.toBeNull();

  // Gutter right edge aligns with Title left edge
  const gutterRight = gutterBox!.x + gutterBox!.width;
  expect(Math.abs(titleThBox!.x - gutterRight)).toBeLessThanOrEqual(2.5);
  expect(Math.abs(titleTdBox!.x - gutterRight)).toBeLessThanOrEqual(2.5);

  // Unfrozen column: non-optional check of alignment of a visible column
  const colIndex = 11;
  const colId = `p${String(colIndex - 1).padStart(2, '0')}`;
  const thBox = await table.locator(`.th[data-prop="${colId}"]`).boundingBox();
  const tdBox = await table.locator(`.td[data-r="0"][data-c="${colIndex}"]`).boundingBox();
  expect(thBox).not.toBeNull();
  expect(tdBox).not.toBeNull();
  expect(Math.abs(thBox!.x - tdBox!.x)).toBeLessThanOrEqual(1.5);
});

test('split pane: table maintains header alignment', async ({ page }) => {
  await open(page);
  await seed(page);
  await page.reload();
  await page.locator('.sidebar').waitFor();
  await page.waitForTimeout(300);

  // Open Sync probe in main view
  await page.locator('.sidebar .db-row .nav-main', { hasText: 'Sync probe' }).first().click();
  await expect(page.locator('.table .grid')).toBeVisible();

  // Open side pane with Ctrl+Shift+\
  await page.keyboard.press('Control+Shift+Backslash');
  await expect(page.locator('.side .pane')).toHaveCount(1);
  await page.keyboard.type('Sync host');
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);

  // Both panes now have tables: main has full-page table, side has embedded tables
  const mainTable = page.locator('.scroller .table').first();
  await mainTable.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 700;
    body.dispatchEvent(new Event('scroll'));
  });

  await page.waitForTimeout(100);

  const mainState = await mainTable.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return Math.abs(headWrap.scrollLeft - body.scrollLeft);
  });
  expect(mainState).toBeLessThanOrEqual(1);

  // Non-optional verification: side embedded table must be present and aligned
  const sideTable = page.locator('.side .database-block .table').first();
  await expect(sideTable).toBeVisible();

  await sideTable.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 450;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);
  const sideDiff = await sideTable.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return Math.abs(headWrap.scrollLeft - body.scrollLeft);
  });
  expect(sideDiff).toBeLessThanOrEqual(1);
});

test('viewport resizing maintains header and rows alignment across narrow and wide layouts', async ({ page }) => {
  await openSyncProbe(page);
  const table = page.locator('.table').first();

  // Scroll body to 600
  await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 600;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  // Resize viewport to 650px narrow
  await page.setViewportSize({ width: 650, height: 800 });
  await page.waitForTimeout(200);

  const narrowDiff = await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return Math.abs(headWrap.scrollLeft - body.scrollLeft);
  });
  expect(narrowDiff).toBeLessThanOrEqual(1);

  // Widen viewport to 1500px wide
  await page.setViewportSize({ width: 1500, height: 800 });
  await page.waitForTimeout(200);

  const wideDiff = await table.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return Math.abs(headWrap.scrollLeft - body.scrollLeft);
  });
  expect(wideDiff).toBeLessThanOrEqual(1);

  // Restore standard viewport
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(150);
});

test('view switching preserves header and rows alignment', async ({ page }) => {
  await openSyncProbe(page);
  const table = page.locator('.table').first();

  // Scroll body to 750
  await table.evaluate((el) => {
    const body = el.querySelector('.body') as HTMLElement;
    body.scrollLeft = 750;
    body.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  // Switch to another page in the sidebar
  await page.locator('[role=tree][aria-label=Pages] .row', { hasText: 'Sync host' }).first().click();
  await expect(page.locator('.database-block .table').first()).toBeVisible();
  await page.waitForTimeout(200);

  // Switch back to Sync probe
  await page.locator('.sidebar .db-row .nav-main', { hasText: 'Sync probe' }).first().click();
  await expect(page.locator('.table .grid')).toBeVisible();
  await page.waitForTimeout(200);

  // Assert header and body are aligned after view return
  const probeTable = page.locator('.table').first();
  const diff = await probeTable.evaluate((el) => {
    const headWrap = el.querySelector('.head-wrap') as HTMLElement;
    const body = el.querySelector('.body') as HTMLElement;
    return Math.abs(headWrap.scrollLeft - body.scrollLeft);
  });
  expect(diff).toBeLessThanOrEqual(1);
});
