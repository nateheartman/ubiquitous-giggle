/**
 * "This page" in relation filters: the token turns into the host page's id
 * before a view runs, and new rows take their relations from the filters
 * (all of them, or only the first when rows need match just one).
 */
import { describe, expect, test } from 'vitest';
import { NO_PAGE, THIS_PAGE, isToken, relationDefaults, resolveThisPage } from './query';
import type { FilterRule } from '../types';

const rule = (prop: string, value: unknown, op = 'hasAny'): FilterRule => ({ id: prop, prop, op, value }) as FilterRule;

describe('resolveThisPage', () => {
  test('swaps the token for the host and keeps fixed ids', () => {
    const [r] = resolveThisPage([rule('project', [THIS_PAGE, 'other'])], () => 'host');
    expect(r.value).toEqual(['host', 'other']);
  });

  test('a host the relation cannot point to matches nothing', () => {
    const [r] = resolveThisPage([rule('project', [THIS_PAGE])], () => null);
    expect(r.value).toEqual([NO_PAGE]);
  });

  test('rules without the token, and views without any, come back untouched', () => {
    const rules = [rule('project', ['a']), rule('status', 'x', 'is')];
    expect(resolveThisPage(rules, () => 'host')).toBe(rules);
  });

  test('asks per rule, so each relation checks its own database', () => {
    const out = resolveThisPage([rule('project', [THIS_PAGE]), rule('parent', [THIS_PAGE])], (r) => (r.prop === 'project' ? 'host' : null));
    expect(out.map((r) => r.value)).toEqual([['host'], [NO_PAGE]]);
  });

  test('does not change the stored rules', () => {
    const rules = [rule('project', [THIS_PAGE])];
    resolveThisPage(rules, () => 'host');
    expect(rules[0].value).toEqual([THIS_PAGE]);
  });
});

describe('relationDefaults', () => {
  const rules = [rule('project', ['p1']), rule('parent', ['p1', 'p2'])];

  test('all: every relation rule sets its relation', () => {
    expect([...relationDefaults(rules, 'all')]).toEqual([
      ['project', ['p1']],
      ['parent', ['p1', 'p2']],
    ]);
  });

  test('any: only the first rule, as in a Project OR Parent Project view', () => {
    expect([...relationDefaults(rules, 'any')]).toEqual([['project', ['p1']]]);
  });

  test('any: skips a first rule with nothing resolved and takes the next', () => {
    expect([...relationDefaults([rule('project', [NO_PAGE]), rule('parent', ['p2'])], 'any')]).toEqual([['parent', ['p2']]]);
  });

  test('never hands out the tokens', () => {
    expect([...relationDefaults([rule('project', [THIS_PAGE, NO_PAGE, 'p1'])], 'all')]).toEqual([['project', ['p1']]]);
    expect(relationDefaults([rule('project', [THIS_PAGE])], 'all').size).toBe(0);
    expect(isToken(THIS_PAGE) && isToken(NO_PAGE) && !isToken('p1')).toBe(true);
  });

  test('only "has any" sets a relation', () => {
    expect(relationDefaults([rule('project', ['p1'], 'hasNone'), rule('parent', ['p1'], 'isNotEmpty')], 'all').size).toBe(0);
  });

  test('the same relation twice joins its rows once', () => {
    expect([...relationDefaults([rule('project', ['a']), rule('project', ['a', 'b'])], 'all')]).toEqual([['project', ['a', 'b']]]);
  });
});
