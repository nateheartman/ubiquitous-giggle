// Databases: formulas that reach through a relation (Notion-style methods,
// current, list callbacks), and how fast they are on a big table.
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

/** Adds a formula property and returns its column. */
async function addFormula(page: Page, formula: string, name: string): Promise<number> {
  await page.click('.th.add');
  await page.click('.db-pop .pop-item:has-text("Formula")');
  await page.waitForTimeout(400);
  await page.keyboard.type(formula);
  await page.waitForTimeout(150);
  await page.locator('.formula-name, .modal-head input.name').first().fill(name);
  await page.locator('textarea.src').focus();
  await page.keyboard.press('Control+Enter');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  const col = await colOf(page, name);
  expect(col).toBeGreaterThanOrEqual(0);
  return col;
}

test('a formula sums a property of the rows a relation links to', async ({ page }) => {
  await open(page);

  await test.step('a database of lines with a Price', async () => {
    await newDatabase(page, 'Tasks', 'Lines');
    await page.click('.tab:has-text("All tasks")');
    await addRows(page, ['Pens', 'Paper', 'Ink']);
    await page.click('.th.add');
    await page.click('.db-pop .pop-item:has-text("Number")');
    await page.waitForTimeout(300);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Price');
    await page.keyboard.press('Enter');
    const price = await colOf(page, 'Price');
    expect(price).toBeGreaterThan(0);
    // Rows come in the order they were added.
    await cell(page, 0, price).click();
    for (const v of ['3', '4.5', '12']) {
      await page.keyboard.type(v);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
    }
    await expect(cell(page, 2, price)).toContainText('12');
  });

  await test.step('an Orders database with a relation to the lines', async () => {
    await newDatabase(page, 'Projects', 'Orders');
    await page.click('.tab:has-text("All projects")');
    await addRows(page, ['Order 1', 'Order 2']);
    await page.click('.th.add');
    await page.click('.db-pop .pop-item:has-text("Relation")');
    await page.waitForTimeout(300);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Items');
    await page.locator('.db-pop select').first().selectOption({ label: 'Lines' });
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    const rel = await colOf(page, 'Items');
    expect(rel).toBeGreaterThan(0);
    await cell(page, 0, rel).click();
    for (const line of ['Pens', 'Paper', 'Ink']) {
      await page.click(`.db-pop .pop-item:has-text("${line}")`);
      await page.waitForTimeout(150);
    }
    await page.keyboard.press('Escape');
    await expect(cell(page, 0, rel)).toContainText('Paper');
  });

  await test.step('the total of the prices', async () => {
    const total = await addFormula(page, 'prop("Items").map(current.prop("Price")).sum()', 'Total');
    await expect(cell(page, 0, total)).toHaveText('19.5');
    // An order with no lines has no total.
    await expect(cell(page, 1, total)).toHaveText('');
  });

  await test.step('the count of the dearer lines, with method calls and a list', async () => {
    const dear = await addFormula(page, 'prop("Items").filter(current.prop("Price") > 4).length()', 'Dear');
    await expect(cell(page, 0, dear)).toHaveText('2');
    const names = await addFormula(page, 'prop("Items").sort(current.prop("Price")).map(current).join(" < ")', 'By price');
    await expect(cell(page, 0, names)).toHaveText('Pens < Paper < Ink');
  });

  await test.step('a mistake shows where it is', async () => {
    await page.click('.th.add');
    await page.click('.db-pop .pop-item:has-text("Formula")');
    await page.waitForTimeout(400);
    await page.keyboard.type('prop("Items").nosuch()');
    await expect(page.locator('.result.error')).toContainText('nosuch()');
    await page.keyboard.press('Escape');
  });

  await test.step('renaming Items keeps the formulas working (and Price, a property of the other database, is left alone)', async () => {
    await page.click('.th:has-text("Items")');
    await page.waitForTimeout(200);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Lines in order');
    await page.keyboard.press('Enter');
    await expect(page.locator('.head .th', { hasText: 'Lines in order' })).toBeVisible();
    const total = await colOf(page, 'Total');
    await expect(cell(page, 0, total)).toHaveText('19.5');
  });
});

test('formulas reaching through a relation stay quick on 3000 rows', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const importCsv = async (name: string, rows: string[]) => {
    await page.click('.section-head:has-text("Databases") .section-add', { force: true });
    await page.setInputFiles('input[type=file][accept*=csv]', { name, mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n') + '\n') });
    await expect(page.locator('h1.title')).toHaveText(name.replace('.csv', ''), { timeout: 30_000 });
  };
  const items = ['Name,Price,Done'];
  for (let i = 0; i < 3000; i++) items.push(`Item ${i},${(i * 7) % 50},${i % 3 ? 'yes' : 'no'}`);
  await importCsv('stock.csv', items);
  const orders = ['Name,Note'];
  for (let i = 0; i < 3000; i++) orders.push(`Order ${i},n`);
  await importCsv('orders.csv', orders);
  await expect(page.locator('.db-row:has-text("orders") .count')).toHaveText('3000');

  // Linking 3000 orders by hand isn't realistic, so the relation is made through the app's own database module, the way a paste would.
  const result = await page.evaluate(async () => {
    // @ts-expect-error served by the dev server, and the same module instance the app uses
    const { databases } = await import('/src/lib/databases.svelte.ts');
    const dbs = Object.values(databases.schemas) as { id: string; name?: string }[];
    const find = (title: string) => dbs.find((d) => databases.rowsOf(d.id).length === 3000 && databases.props(d.id).some((p: { name: string }) => p.name === title))!;
    const stock = find('Price');
    const orders = find('Note');
    const rel = await databases.addProperty(orders.id, 'relation', { name: 'Lines', config: { database: stock.id } });
    const stockRows = databases.rowsOf(stock.id);
    const orderRows = databases.rowsOf(orders.id);
    // Each order links to 4 lines.
    databases.set(
      orderRows.map((r: unknown, i: number) => ({ row: r, prop: rel, value: [0, 1, 2, 3].map((k) => stockRows[(i * 4 + k) % stockRows.length].id) })),
      { undo: false, automate: false },
    );
    const total = await databases.addProperty(orders.id, 'formula', { name: 'Total', config: { expression: 'prop("Lines").map(current.prop("Price")).sum()' } });
    const busy = await databases.addProperty(orders.id, 'formula', {
      name: 'Busy',
      config: { expression: 'prop("Lines").filter(current.prop("Done")).map(current.prop("Price") * 2).sort().reverse().first()' },
    });
    // Evaluate every row's formulas, as sorting or filtering by them would.
    const timed = (p: unknown) => {
      const t0 = performance.now();
      let sum = 0;
      for (const r of orderRows) {
        const v = databases.formula(r, p);
        if (typeof v === 'number') sum += v;
      }
      return { ms: performance.now() - t0, sum };
    };
    const first = timed(total);
    const second = timed(total);
    const firstBusy = timed(busy);
    return { first, second, firstBusy, ids: { total: total.id, orders: orders.id } };
  });
  console.log(`3000 orders x 4 lines: Total over all rows ${result.first.ms.toFixed(0)} ms (again: ${result.second.ms.toFixed(0)} ms); Busy ${result.firstBusy.ms.toFixed(0)} ms`);
  test.info().annotations.push({ type: 'perf', description: `Total ${result.first.ms.toFixed(0)} ms, again ${result.second.ms.toFixed(0)} ms, Busy ${result.firstBusy.ms.toFixed(0)} ms for 3000 rows` });
  // Every order's total is 4 prices, so the sum over rows is bigger than zero, and nothing took seconds.
  expect(result.first.sum).toBeGreaterThan(0);
  expect(result.first.ms).toBeLessThan(3000);

  await test.step('the table shows the totals, sorted by them, without stalling', async () => {
    await expect(page.locator('h1.title')).toHaveText('orders');
    const shown = page.locator('.td[data-r="0"]').first();
    await expect(shown).toBeVisible();
    const t0 = Date.now();
    await page.click('.th:has-text("Total")');
    await page.locator('.db-pop .pop-item:has-text("Sort descending"), .db-pop .pop-item:has-text("Descending")').first().click();
    await expect.poll(async () => (await page.locator(`.td[data-r="0"][data-c="${await colOf(page, 'Total')}"]`).innerText()).trim(), { timeout: 15_000 }).not.toBe('');
    const ms = Date.now() - t0;
    console.log(`sorting 3000 rows by the relation formula, until the first row shows: ${ms} ms`);
    test.info().annotations.push({ type: 'perf', description: `sort by Total, 3000 rows: ${ms} ms` });
    expect(ms).toBeLessThan(10_000);
  });
});

test('formulas that read each other through a relation: loops and long chains are errors, short chains work', async ({ page }) => {
  await open(page);
  await page.click('.section-head:has-text("Databases") .section-add', { force: true });
  const csv = ['Name', ...[0, 1, 2, 3, 4, 5].map((i) => `R${i}`)].join('\n') + '\n';
  await page.setInputFiles('input[type=file][accept*=csv]', { name: 'chain.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('h1.title')).toHaveText('chain', { timeout: 15_000 });

  const out = await page.evaluate(async () => {
    // @ts-expect-error served by the dev server, and the same module instance the app uses
    const { databases } = await import('/src/lib/databases.svelte.ts');
    const db = Object.values(databases.schemas).find((d: any) => d.properties.some((p: any) => p.name === 'Name') && databases.rowsOf(d.id).length === 6) as { id: string };
    const rows = databases.rowsOf(db.id);
    const next = await databases.addProperty(db.id, 'relation', { name: 'Next', config: { database: db.id } });
    const me = await databases.addProperty(db.id, 'relation', { name: 'Me', config: { database: db.id } });
    // Each row links to the next one, and to itself.
    databases.set(
      rows.flatMap((r: any, i: number) => [
        { row: r, prop: next, value: i < rows.length - 1 ? [rows[i + 1].id] : [] },
        { row: r, prop: me, value: [r.id] },
      ]),
      { undo: false, automate: false },
    );
    const g = await databases.addProperty(db.id, 'formula', { name: 'G', config: { expression: 'empty(prop("Next")) ? 0 : prop("Next").first().prop("G") + 1' } });
    const loop = await databases.addProperty(db.id, 'formula', { name: 'Loop', config: { expression: 'prop("Me").first().prop("Loop")' } });
    const show = (v: any) => (v && v.message !== undefined ? 'error: ' + v.message : v);
    return { g: rows.map((r: any) => show(databases.formula(r, g))), loop: show(databases.formula(rows[0], loop)) };
  });
  // The last row has no next; each earlier one is one more than the one after it, up to three rows of reading through each other.
  expect(out.g[5]).toBe(0);
  expect(out.g[4]).toBe(1);
  expect(out.g[3]).toBe(2);
  expect(out.g[2]).toBe(3);
  expect(out.g[1]).toMatch(/^error/);
  expect(out.g[0]).toMatch(/^error/);
  expect(out.loop).toMatch(/^error/);
});
