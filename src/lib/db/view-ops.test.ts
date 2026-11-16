/**
 * A linked block's own views: the first change copies the database's views
 * into the block and then applies the edit, and nothing reaches the shared
 * ones.
 */
import { describe, expect, test } from 'vitest';
import { addTo, cloneViews, duplicateIn, moveIn, patchConfig, removeFrom, renameIn, setTemplateIn, withEdit } from './view-ops';
import type { DbView } from '../types';

const view = (id: string, sortKey: string, config: DbView['config'] = {}): DbView => ({ id, name: id, type: 'table', config, sortKey });
const shared = () => [view('all', 'a0', { sorts: [{ prop: 'due', dir: 'asc' }] }), view('board', 'a1')];
const numbered = (name: string, n: number) => `${name} ${n}`;

describe('withEdit (copy-on-write)', () => {
  test('a block still sharing copies the shared views first, then applies the edit', () => {
    const source = shared();
    const out = withEdit(null, source, (l) => patchConfig(l, 'all', { filters: [{ id: 'f', prop: 'project', op: 'hasAny', value: ['@this'] }] }));
    expect(out.adopted).toBe(true);
    expect(out.views.map((v) => v.id)).toEqual(['all', 'board']);
    expect(out.views[0].config.sorts).toEqual([{ prop: 'due', dir: 'asc' }]);
    expect(out.views[0].config.filters).toHaveLength(1);
  });

  test('the shared views are never written to', () => {
    const source = shared();
    const before = JSON.stringify(source);
    const out = withEdit(null, source, (l) => {
      patchConfig(l, 'all', { sorts: [] });
      renameIn(l, 'board', 'Mine');
      removeFrom(l, 'all');
    });
    expect(JSON.stringify(source)).toBe(before);
    expect(out.views.map((v) => v.name)).toEqual(['Mine']);
  });

  test('a block that owns its views edits its own, not the shared ones', () => {
    const own = [view('all', 'a0', { sorts: [] })];
    const source = shared();
    const out = withEdit(own, source, (l) => patchConfig(l, 'all', { match: 'any' }));
    expect(out.adopted).toBe(false);
    expect(out.views[0].config).toEqual({ sorts: [], match: 'any' });
    expect(out.views).toHaveLength(1);
    expect(own[0].config).toEqual({ sorts: [] });
    expect(source[0].config.match).toBeUndefined();
  });

  test('a copy shares nothing with the source (even nested values)', () => {
    const source = shared();
    const out = withEdit(null, source, () => {});
    (out.views[0].config.sorts as { dir: string }[])[0].dir = 'desc';
    expect(source[0].config.sorts).toEqual([{ prop: 'due', dir: 'asc' }]);
    expect(cloneViews(source)).toEqual(source);
  });
});

describe('edits to a list of views', () => {
  test('adding names a view after its layout, numbered if taken', () => {
    const l = shared();
    addTo(l, { id: 'x', type: 'table', config: {} }, 'all', numbered);
    addTo(l, { id: 'y', type: 'table', config: {} }, 'all', numbered);
    expect(l.map((v) => v.name)).toEqual(['all', 'board', 'all 2', 'all 3']);
    expect(l[2].sortKey > l[1].sortKey).toBe(true);
  });

  test('duplicating puts the copy after the original, with its settings', () => {
    const l = shared();
    duplicateIn(l, 'all', 'c', (n) => `Copy of ${n}`);
    const sorted = [...l].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1));
    expect(sorted.map((v) => v.id)).toEqual(['all', 'c', 'board']);
    expect(l.find((v) => v.id === 'c')?.config.sorts).toEqual([{ prop: 'due', dir: 'asc' }]);
  });

  test('the last view cannot be removed', () => {
    const l = [view('only', 'a0')];
    removeFrom(l, 'only');
    expect(l).toHaveLength(1);
  });

  test('moving reorders by sort key', () => {
    const l = shared();
    moveIn(l, 'board', 0);
    expect([...l].sort((a, b) => (a.sortKey < b.sortKey ? -1 : 1)).map((v) => v.id)).toEqual(['board', 'all']);
  });

  test('a default template goes to one view or all of them', () => {
    const l = shared();
    setTemplateIn(l, 't1', 'board');
    expect(l.map((v) => v.config.template)).toEqual([undefined, 't1']);
    setTemplateIn(l, 't2', null);
    expect(l.map((v) => v.config.template)).toEqual(['t2', 't2']);
  });
});
