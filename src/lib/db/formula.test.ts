/**
 * The formula engine's Notion-style additions: method calls, let/lets, list
 * callbacks (current, index), list literals, relations as rows, regexes, and
 * the new functions. The old behaviour is pinned by formula.golden.test.ts.
 */
import { describe, expect, test } from 'vitest';
import { FDate, FLink, FRow, FUNCTIONS, FormulaError, parse, references, renameProperty, run, type FValue, type Scope } from './formula';
import { HopGuard, LoopGuard } from './formula-scope';
import { NOW, day, scopeOf, show } from './fixture';

const ev = (src: string, extra: Record<string, FValue> = {}) => show(run(src, scopeOf(extra)));
const fails = (src: string, extra: Record<string, FValue> = {}) => run(src, scopeOf(extra)) instanceof FormulaError;
const message = (src: string) => {
  const r = run(src, scopeOf());
  return r instanceof FormulaError ? r.message : `no error: ${String(show(r))}`;
};

describe('method calls', () => {
  test('x.f(a, b) is f(x, a, b)', () => {
    expect(ev('{Tags}.length()')).toBe(3);
    expect(ev('"Hello".upper()')).toBe('HELLO');
    expect(ev('{Due}.dateAdd(2, "days")')).toBe('date:2026-10-16');
    expect(ev('"a-b".replace("-", "+")')).toBe('a+b');
    expect(ev('(10).round()')).toBe(10);
    expect(ev('10.round()')).toBe(10);
    expect(ev('1.5.round()')).toBe(2);
    expect(ev('7.toText() + "x"')).toBe('7x');
    expect(ev('1.5 + .5 + 5.')).toBe(7);
    expect(ev('[3, 1].sort().first()')).toBe(1);
  });
  test('prop("X") can start a chain', () => {
    expect(ev('prop("Tags").length()')).toBe(3);
    expect(ev('prop("Name").lower().length()')).toBe(13);
  });
  test('chains', () => {
    expect(ev('{Words}.sort().first()')).toBe('a');
    expect(ev('{Tags}.unique().join(" / ")')).toBe('Exam / Essay');
    expect(ev('"  Hi  ".trim().upper().concat("!")')).toBe('HI!');
    expect(ev('{Due}.dateSubtract(1, "weeks").formatDate("MMM D")')).toBe('Oct 7');
  });
  test('a method binds tighter than operators and unary minus', () => {
    expect(ev('1 + {Nums}.length() * 2')).toBe(7);
    expect(ev('-{Nums}.first()')).toBe(-3);
    expect(ev('not {Tags}.empty()')).toBe(true);
  });
  test('lazy functions work as methods too', () => {
    expect(ev('{Done}.if("yes", "no")')).toBe('yes');
    expect(ev('{Empty}.ifEmpty("none")')).toBe('none');
  });
  test('a method needs a name and brackets', () => {
    expect(fails('{Tags}.')).toBe(true);
    expect(fails('{Tags}.length')).toBe(true);
    expect(fails('{Tags}.nosuch()')).toBe(true);
    expect(message('{Tags}.nosuch()')).toContain('nosuch()');
  });
  test('arity is checked with the receiver counted', () => {
    expect(fails('{Tags}.first(1)')).toBe(true);
    expect(fails('{Price}.round(1, 2)')).toBe(true);
  });
  test('errors point at the method', () => {
    const r = run('1 + {Tags}.nosuch()', scopeOf());
    expect(r instanceof FormulaError && r.at).toBe(11);
  });
});

describe('list literals', () => {
  test('write a list in brackets', () => {
    expect(ev('[1, 2, 3]')).toEqual([1, 2, 3]);
    expect(ev('[]')).toEqual([]);
    expect(ev('["a", {Price}, 1 + 1]')).toEqual(['a', 10, 2]);
    expect(ev('[[1, 2], [3]]')).toEqual([[1, 2], [3]]);
  });
  test('and use them', () => {
    expect(ev('[3, 1, 2].sort()')).toEqual([1, 2, 3]);
    expect(ev('[1, 2, 3].sum()')).toBe(6);
    expect(ev('[1, 2] == [1, 2]')).toBe(true);
  });
  test('an unclosed one is an error', () => {
    expect(fails('[1, 2')).toBe(true);
    expect(fails('[1 2]')).toBe(true);
  });
});

describe('let and lets', () => {
  test('let names a value', () => {
    expect(ev('let(x, 5, x * 2)')).toBe(10);
    expect(ev('let(total, {Price} * {Quantity}, total + total / 10)')).toBe(33);
  });
  test('lets: each value sees the ones before it', () => {
    expect(ev('lets(a, 2, b, a * 3, a + b)')).toBe(8);
    expect(ev('lets(a, 1, a, a + 1, a)')).toBe(2);
  });
  test('names are one bare word and are not case sensitive', () => {
    expect(ev('let(Total, 4, total + TOTAL)')).toBe(8);
    expect(fails('let("x", 1, x)')).toBe(true);
    expect(fails('let({x}, 1, x)')).toBe(true);
    expect(fails('let(f(1), 1, 2)')).toBe(true);
  });
  test('arity', () => {
    expect(fails('let(x, 1)')).toBe(true);
    expect(fails('lets(x, 1)')).toBe(true);
    expect(fails('lets(x, 1, y, 2)')).toBe(true);
  });
  test('a variable shadows a property of the same name only inside the let', () => {
    expect(ev('let(price, 1, price) + {Price}')).toBe(11);
    expect(ev('let(price, 1, {Price})')).toBe(10);
    expect(ev('let(price, 1, prop("Price"))')).toBe(10);
    expect(ev('let(x, 1, 2) + x', { x: 100 })).toBe(102);
  });
  test('nested', () => {
    expect(ev('let(a, 1, let(b, a + 1, a + b))')).toBe(3);
  });
});

describe('list callbacks', () => {
  test('map with current and index', () => {
    expect(ev('{Nums}.map(current * 10)')).toEqual([30, 10, 20]);
    expect(ev('map({Nums}, index)')).toEqual([0, 1, 2]);
    expect(ev('{Words}.map(current + index)')).toEqual(['b0', 'a1', 'c2']);
  });
  test('filter', () => {
    expect(ev('{Nums}.filter(current > 1)')).toEqual([3, 2]);
    expect(ev('{Tags}.filter(current == "Exam").length()')).toBe(2);
    expect(ev('{Nums}.filter(index > 0)')).toEqual([1, 2]);
  });
  test('find and findIndex', () => {
    expect(ev('{Nums}.find(current < 3)')).toBe(1);
    expect(ev('{Nums}.find(current > 9)')).toBe(null);
    expect(ev('{Nums}.findIndex(current < 3)')).toBe(1);
    expect(ev('{Nums}.findIndex(current > 9)')).toBe(-1);
  });
  test('some and every', () => {
    expect(ev('{Nums}.some(current > 2)')).toBe(true);
    expect(ev('{Nums}.some(current > 3)')).toBe(false);
    expect(ev('{Nums}.every(current > 0)')).toBe(true);
    expect(ev('{Nums}.every(current > 1)')).toBe(false);
    expect(ev('[].every(current > 1)')).toBe(true);
    expect(ev('[].some(current > 1)')).toBe(false);
  });
  test('sort with and without a key', () => {
    expect(ev('{Nums}.sort()')).toEqual([1, 2, 3]);
    expect(ev('{Nums}.sort(-current)')).toEqual([3, 2, 1]);
    expect(ev('["bb", "a", "ccc"].sort(length(current))')).toEqual(['a', 'bb', 'ccc']);
    expect(ev('sort({Words}, current)')).toEqual(['a', 'b', 'c']);
  });
  test('sorting by date', () => {
    const dates = [day(2026, 3, 1), day(2026, 1, 1), day(2026, 2, 1)];
    expect(ev('d.sort(current)', { d: dates })).toEqual(['date:2026-01-01', 'date:2026-02-01', 'date:2026-03-01']);
  });
  test('callbacks nest, the inner current hiding the outer; let carries it through', () => {
    expect(ev('[1, 2].map([10, 20].map(current + 1))')).toEqual([[11, 21], [11, 21]]);
    expect(ev('[1, 2].map(let(outer, current, [10, 20].map(current + outer)))')).toEqual([[11, 21], [12, 22]]);
  });
  test('current outside a callback is just a property (and so missing)', () => {
    expect(fails('current')).toBe(true);
    expect(ev('current + 1', { current: 4 })).toBe(5);
  });
  test('a callback needs both values', () => {
    expect(fails('map({Nums})')).toBe(true);
    expect(fails('filter({Nums}, 1, 2)')).toBe(true);
  });
  test('an error inside a callback is reported', () => {
    expect(fails('{Nums}.map(nosuch(current))')).toBe(true);
    expect(fails('{Nums}.map(current / 0)')).toBe(true);
  });
  test('callbacks over a non-list work on the one value', () => {
    expect(ev('{Price}.map(current + 1)')).toEqual([11]);
    expect(ev('{Empty}.map(current + 1)')).toEqual([]);
  });
});

describe('new list functions', () => {
  test('reverse, flat, includes', () => {
    expect(ev('{Nums}.reverse()')).toEqual([2, 1, 3]);
    expect(ev('flat([[1, 2], [3], 4])')).toEqual([1, 2, 3, 4]);
    expect(ev('[[1, [2]]].flat()')).toEqual([1, [2]]);
    expect(ev('{Tags}.includes("exam")')).toBe(true);
    expect(ev('{Tags}.includes("x")')).toBe(false);
  });
  test('concat joins lists as lists and texts as text', () => {
    expect(ev('concat([1, 2], [3])')).toEqual([1, 2, 3]);
    expect(ev('concat({Tags}, {Words}).length()')).toBe(6);
    expect(ev('concat("a", "b")')).toBe('ab');
    expect(ev('concat({Tags})')).toBe('Exam, Essay, Exam');
  });
  test('first, last, count, unique, sum, min, max, empty over lists', () => {
    expect(ev('{Nums}.first()')).toBe(3);
    expect(ev('{Nums}.last()')).toBe(2);
    expect(ev('{Tags}.unique().count()')).toBe(2);
    expect(ev('{Nums}.sum()')).toBe(6);
    expect(ev('{Nums}.min()')).toBe(1);
    expect(ev('{Nums}.max()')).toBe(3);
    expect(ev('[].empty()')).toBe(true);
    expect(ev('{Nums}.empty()')).toBe(false);
  });
});

describe('new math functions', () => {
  test.each([
    ['mean(1, 2, 3, 4)', 2.5],
    ['mean({Nums})', 2],
    ['median(1, 5, 3)', 3],
    ['median(1, 2, 3, 4)', 2.5],
    ['median({Nums})', 2],
    ['cbrt(27)', 3],
    ['exp(0)', 1],
    ['ln(1)', 0],
    ['ln(e())', 1],
    ['log10(1000)', 3],
    ['log2(8)', 3],
    ['sign(-4)', -1],
    ['sign(0)', 0],
    ['sign(9)', 1],
    ['pi()', 3.14159265359],
    ['e()', 2.71828182846],
    ['round(pi(), 2)', 3.14],
    ['abs(-3).sqrt().round(2)', 1.73],
    ['toNumber("7") + 1', 8],
    ['toText(7) + "x"', '7x'],
  ])('%s', (src, expected) => {
    expect(ev(src)).toBe(expected);
  });
  test('empty in, empty out', () => {
    expect(ev('mean({Empty})')).toBe(null);
    expect(ev('median({Empty})')).toBe(null);
    expect(ev('cbrt({Empty})')).toBe(null);
    expect(ev('ln({Empty})')).toBe(null);
    expect(ev('sign({Empty})')).toBe(null);
  });
  test('a logarithm needs a number above zero', () => {
    expect(fails('ln(0)')).toBe(true);
    expect(fails('log10(-1)')).toBe(true);
    expect(fails('log2(0)')).toBe(true);
  });
  test('a property called e or pi is still a property', () => {
    expect(ev('e + pi', { e: 1, pi: 2 })).toBe(3);
  });
});

describe('new text functions', () => {
  test.each([
    ['substring("Thought", 1, 4)', 'hou'],
    ['substring("Thought", 4)', 'ght'],
    ['"Thought".substring(0, 2)', 'Th'],
    ['padStart("7", 3, "0")', '007'],
    ['padStart("abc", 2, "0")', 'abc'],
    ['padStart("7", 3)', '  7'],
    ['padEnd("7", 3, "0")', '700'],
    ['"7".padEnd(4, "ab")', '7aba'],
    ['toText({Done})', 'true'],
  ])('%s', (src, expected) => {
    expect(ev(src)).toBe(expected);
  });
  test('link makes a link that reads as its label', () => {
    const v = run('link("Docs", "https://example.com")', scopeOf());
    expect(v).toBeInstanceOf(FLink);
    expect((v as FLink).url).toBe('https://example.com');
    expect(ev('link("Docs", "https://example.com") + "!"')).toBe('Docs!');
    expect(ev('link("Docs", "x").length()')).toBe(4);
  });
  test('test, match and replaceAll take JavaScript regular expressions', () => {
    expect(ev('test("abc123", "\\\\d+")')).toBe(true);
    expect(ev('test("abc", "\\\\d")')).toBe(false);
    expect(ev('{Name}.test("^Th")')).toBe(true);
    expect(ev('match("a1b22c333", "\\\\d+")')).toEqual(['1', '22', '333']);
    expect(ev('match("a1b22", "([a-z])(\\\\d)")')).toEqual(['a', '1', 'b', '2']);
    expect(ev('match("abc", "\\\\d")')).toEqual([]);
    expect(ev('replaceAll("a1b22", "\\\\d", "#")')).toBe('a#b##');
    expect(ev('replaceAll("john smith", "(\\\\w+) (\\\\w+)", "$2, $1")')).toBe('smith, john');
  });
  test('replace is still plain text, so a "." or "(" is just that', () => {
    expect(ev('replace("a.b.c", ".", "-")')).toBe('a-b-c');
    expect(ev('replace("f(x)", "(", "[")')).toBe('f[x)');
  });
  test('a bad pattern is a clear error', () => {
    for (const src of ['test("a", "(")', 'match("a", "[")', 'replaceAll("a", "*", "b")']) {
      expect(fails(src), src).toBe(true);
      expect(message(src)).toMatch(/can.t read the pattern/);
    }
    expect(message('test("a", "(")')).toContain('test()');
  });
});

describe('new date functions', () => {
  test('dateRange, dateStart, dateEnd', () => {
    expect(ev('dateStart(dateRange({Start}, {Due}))')).toBe('date:2026-09-30');
    expect(ev('dateEnd(dateRange({Start}, {Due}))')).toBe('date:2026-10-14');
    expect(ev('dateRange({Start}, {Due}).dateEnd().formatDate("D")')).toBe('14');
    // No end: the end is the date itself.
    expect(ev('dateEnd({Due})')).toBe('date:2026-10-14');
    expect(ev('dateStart({Empty})')).toBe(null);
    expect(ev('dateEnd({Empty})')).toBe(null);
  });
  test('a database date with an end keeps it', () => {
    const range = new FDate(day(2026, 10, 1).ms, false, day(2026, 10, 9));
    expect(ev('dateEnd(r)', { r: range })).toBe('date:2026-10-09');
    expect(ev('dateStart(r)', { r: range })).toBe('date:2026-10-01');
    expect(ev('r == date("2026-10-01")', { r: range })).toBe(true);
  });
  test('parseDate, timestamp, fromTimestamp', () => {
    expect(ev('parseDate("2026-10-14")')).toBe('date:2026-10-14');
    expect(fails('parseDate("nonsense")')).toBe(true);
    expect(ev('timestamp({Due})')).toBe(day(2026, 10, 14).ms);
    expect(ev('fromTimestamp(timestamp({Meeting}))')).toBe('date:2026-10-14T15:30');
    expect(ev('timestamp({Empty})')).toBe(null);
    expect(ev('fromTimestamp({Empty})')).toBe(null);
  });
  test('week is the ISO week', () => {
    expect(ev('week(date("2026-01-01"))')).toBe(1);
    expect(ev('week(date("2026-10-14"))')).toBe(42);
    expect(ev('week(date("2024-12-30"))')).toBe(1);
    expect(ev('week(date("2021-01-03"))')).toBe(53);
    expect(ev('week({Empty})')).toBe(null);
  });
  test('the old day() and weekday() are as they were', () => {
    // Notion's day() is the weekday; here it has always been the day of the month, so weekday() is the weekday.
    expect(ev('day({Due})')).toBe(14);
    expect(ev('weekday({Due})')).toBe(3);
    expect(ev('minute({Meeting}) + hour({Meeting})')).toBe(45);
    expect(ev('today().year()')).toBe(2026);
  });
});

/** A small world of related rows, wired like databases.svelte.ts does it, using its hop limit and loop guard. */
function world() {
  interface Row {
    id: string;
    title: string;
    props: Record<string, FValue | { formula: string }>;
  }
  const rows = new Map<string, Row>();
  const add = (id: string, title: string, props: Row['props']) => rows.set(id, { id, title, props });
  const row = (id: string) => new FRow(id, rows.get(id)!.title);
  // The guards are the very ones databases.svelte.ts uses; only the lookup of values is stand-in.
  const hops = new HopGuard(3, () => new FormulaError('too many linked rows'));
  const loops = new LoopGuard();

  function scope(r: Row, related = false): Scope {
    return {
      now: NOW,
      id: r.id,
      prop: (name) => {
        const key = Object.keys(r.props).find((k) => k.toLowerCase() === name.trim().toLowerCase());
        if (key === undefined) return undefined;
        const read = (): FValue => {
          const v = r.props[key];
          if (v && typeof v === 'object' && !Array.isArray(v) && 'formula' in v) {
            const out = loops.run(`${r.id}:${key}`, () => new FormulaError('loop'), () => run(v.formula, scope(r)));
            if (out instanceof FormulaError) throw new FormulaError(`{${key}}: ${out.message}`);
            return out;
          }
          return v as FValue;
        };
        return related ? hops.within(read) : read();
      },
      row: (fr) => (rows.has(fr.id) ? scope(rows.get(fr.id)!, true) : undefined),
    };
  }
  const evalIn = (id: string, src: string) => show(run(src, scope(rows.get(id)!)));
  return { add, row, evalIn, rows };
}

describe('relations: rows as values', () => {
  const w = world();
  w.add('i1', 'Pens', { Price: 3, Qty: 2, Done: true, Total: { formula: '{Price} * {Qty}' } });
  w.add('i2', 'Paper', { Price: 4.5, Qty: 4, Done: false, Total: { formula: '{Price} * {Qty}' } });
  w.add('i3', 'Ink', { Price: 12, Qty: 1, Done: true, Total: { formula: '{Price} * {Qty}' } });
  w.add('o1', 'Order 1', { Items: [w.row('i1'), w.row('i2'), w.row('i3')], Empty: [] });
  w.add('o2', 'Order 2', { Items: [], Empty: [] });

  test('a relation is a list of rows that read as their titles', () => {
    expect(w.evalIn('o1', 'prop("Items")')).toHaveLength(3);
    expect(w.evalIn('o1', 'prop("Items").join(", ")')).toBe('Pens, Paper, Ink');
    expect(w.evalIn('o1', 'prop("Items").length()')).toBe(3);
    expect(w.evalIn('o1', 'prop("Items").contains("paper")')).toBe(true);
    expect(w.evalIn('o1', 'prop("Items").first() + "!"')).toBe('Pens!');
    expect(w.evalIn('o1', 'prop("Items").first() == "Pens"')).toBe(true);
    expect(w.evalIn('o1', 'prop("Items").sort().last()')).toBe('row:Pens');
    expect(w.evalIn('o1', '{Items}.map(current).join("+")')).toBe('Pens+Paper+Ink');
  });
  test('row.prop("X") reads a property of the related row', () => {
    expect(w.evalIn('o1', 'prop("Items").first().prop("Price")')).toBe(3);
    expect(w.evalIn('o1', 'prop("Items").map(current.prop("Price"))')).toEqual([3, 4.5, 12]);
    expect(w.evalIn('o1', 'prop("Items").map(current.prop("Price")).sum()')).toBe(19.5);
    expect(w.evalIn('o1', 'prop("Items").map(prop(current, "Price")).sum()')).toBe(19.5);
  });
  test('filter, find, some, every, sort over rows', () => {
    expect(w.evalIn('o1', 'prop("Items").filter(current.prop("Done")).length()')).toBe(2);
    expect(w.evalIn('o1', 'prop("Items").filter(current.prop("Price") > 4).map(current.prop("Price")).sum()')).toBe(16.5);
    expect(w.evalIn('o1', 'prop("Items").find(current.prop("Price") > 4)')).toBe('row:Paper');
    expect(w.evalIn('o1', 'prop("Items").some(current.prop("Done") == false)')).toBe(true);
    expect(w.evalIn('o1', 'prop("Items").every(current.prop("Done"))')).toBe(false);
    expect(w.evalIn('o1', 'prop("Items").sort(current.prop("Price")).map(current).join(", ")')).toBe('Pens, Paper, Ink');
    expect(w.evalIn('o1', 'prop("Items").sort(-current.prop("Price")).first()')).toBe('row:Ink');
  });
  test("a related row's formulas are read too", () => {
    expect(w.evalIn('o1', 'prop("Items").map(current.prop("Total")).sum()')).toBe(6 + 18 + 12);
  });
  test('an empty relation gives an empty list, and no total', () => {
    expect(w.evalIn('o2', 'prop("Items").map(current.prop("Price")).sum()')).toBe(null);
    expect(w.evalIn('o2', 'prop("Items").length()')).toBe(0);
    expect(w.evalIn('o2', 'prop("Items").filter(current.prop("Done")).length()')).toBe(0);
  });
  test('a missing property is an error', () => {
    expect(w.evalIn('o1', 'prop("Items").first().prop("Nope")')).toBe('error');
  });
  test('id() is the row id', () => {
    expect(w.evalIn('o1', 'id()')).toBe('o1');
    expect(w.evalIn('o1', 'prop("Items").first().prop("Done")')).toBe(true);
  });
  test('prop on something that is not a row is an error', () => {
    expect(w.evalIn('o1', '"x".prop("Price")')).toBe('error');
    expect(w.evalIn('o1', 'prop("Items").map(current.prop("Nope"))')).toBe('error');
  });
  test('a row whose host cannot be found is an error, not a crash', () => {
    const s = scopeOf();
    const r = run('r.prop("X")', { ...s, prop: (n) => (n === 'r' ? new FRow('gone', 'Gone') : s.prop(n)) });
    expect(r).toBeInstanceOf(FormulaError);
  });
});

describe('relations: loops and depth', () => {
  test('a formula that reads itself through a relation is a loop error, not a hang', () => {
    const w = world();
    w.add('a', 'A', { F: { formula: 'prop("Friends").first().prop("F")' } });
    w.rows.get('a')!.props.Friends = [w.row('a')];
    const out = w.evalIn('a', 'prop("F")');
    expect(out).toBe('error');
  });
  test('two rows whose formulas read each other', () => {
    const w = world();
    w.add('a', 'A', { F: { formula: 'prop("Other").first().prop("F")' } });
    w.add('b', 'B', { F: { formula: 'prop("Other").first().prop("F")' } });
    w.rows.get('a')!.props.Other = [w.row('b')];
    w.rows.get('b')!.props.Other = [w.row('a')];
    expect(w.evalIn('a', 'prop("F")')).toBe('error');
  });
  test('a chain of related formulas up to the depth limit works; past it, an error', () => {
    const w = world();
    // r0 reads r1's G, which reads r2's G, … each G is one hop down. The limit is 3 hops.
    for (let i = 0; i < 6; i++) w.add(`r${i}`, `R${i}`, {});
    for (let i = 0; i < 6; i++) {
      w.rows.get(`r${i}`)!.props.Next = i < 5 ? [w.row(`r${i + 1}`)] : [];
      w.rows.get(`r${i}`)!.props.G = { formula: i < 5 ? 'prop("Next").first().prop("G") + 1' : '0' };
    }
    expect(w.evalIn('r4', 'prop("Next").first().prop("G")')).toBe(0); // 1 hop
    expect(w.evalIn('r2', 'prop("Next").first().prop("G")')).toBe(2); // 3 hops: r3's G reads r4's G reads r5's G
    expect(w.evalIn('r1', 'prop("Next").first().prop("G")')).toBe('error'); // 4 hops
  });
});

describe('references and renaming with the new syntax', () => {
  const names = (src: string) => [...references(parse(src))].sort();
  test("current.prop(\"X\") is the related row's property, not this database's", () => {
    expect(names('prop("Items").map(current.prop("Price")).sum()')).toEqual(['items']);
    expect(names('prop("Items").filter(current.prop("Done")).length() + {Tax}')).toEqual(['items', 'tax']);
  });
  test('variables are not properties', () => {
    expect(names('let(x, {Price}, x * 2)')).toEqual(['price']);
    expect(names('lets(a, {A}, b, a + {B}, a * b)')).toEqual(['a', 'b']);
    expect(names('{Nums}.map(current + index)')).toEqual(['nums']);
  });
  test('a bare word that is not a variable here is still a property', () => {
    expect(names('let(x, 1, x) + price')).toEqual(['price']);
    expect(names('current + 1')).toEqual(['current']);
  });
  test('lists and methods', () => {
    expect(names('[{A}, {B}].sum().round(2)')).toEqual(['a', 'b']);
  });

  test.each([
    ['prop("Items").map(current.prop("Price")).sum()', 'Items', 'Lines', '{Lines}.map(current.prop("Price")).sum()'],
    ['prop("Items").map(current.prop("Price")).sum()', 'Price', 'Cost', 'prop("Items").map(current.prop("Price")).sum()'],
    ['{Price}.round(2) + prop("Tax")', 'Tax', 'VAT', '{Price}.round(2) + {VAT}'],
    ['{Price}.round(2) + prop("Tax")', 'Price', 'Cost', '{Cost}.round(2) + prop("Tax")'],
    ['let(x, Price, x * 2)', 'Price', 'Cost', 'let(x, {Cost}, x * 2)'],
    ['let(price, 1, price) + Price', 'Price', 'Cost', 'let(price, 1, price) + {Cost}'],
    ['{Nums}.map(current + index)', 'Nums', 'Values', '{Values}.map(current + index)'],
    ['[{A}, {A}].sum()', 'A', 'B', '[{B}, {B}].sum()'],
    // Typing a new name renames on every key: "Lines " (with its space) on the way to "Lines in".
    ['{Lines }.length()', 'Lines ', 'Lines in', '{Lines in}.length()'],
    ['prop("Items").filter(prop(current, "Done"))', 'Done', 'X', 'prop("Items").filter(prop(current, "Done"))'],
  ])('%s', (src, from, to, expected) => {
    expect(renameProperty(src, from, to)).toBe(expected);
  });

  test('renaming a property called like a variable renames only the real one', () => {
    expect(renameProperty('{Nums}.map(current * 2) + current', 'current', 'Now')).toBe('{Nums}.map(current * 2) + {Now}');
    expect(renameProperty('{Nums}.map(current * 2)', 'current', 'Now')).toBe('{Nums}.map(current * 2)');
  });
});

describe('equality and ordering with rows and links', () => {
  test('rows compare by title text (as relations always have) and by id with each other', () => {
    const a = new FRow('1', 'Apple');
    const b = new FRow('2', 'Apple');
    expect(ev('a == "apple"', { a })).toBe(true);
    expect(ev('a == b', { a, b })).toBe(false);
    expect(ev('a == a', { a })).toBe(true);
    expect(ev('a < "Banana"', { a })).toBe(true);
    expect(ev('[a, b].unique().length()', { a, b })).toBe(2);
    expect(ev('a.length()', { a })).toBe(5);
    expect(ev('empty(a)', { a })).toBe(false);
    expect(ev('empty(a)', { a: new FRow('3', '') })).toBe(true);
  });
});

describe('the function table', () => {
  test('every function has a description, a group and sensible arity', () => {
    for (const f of Object.values(FUNCTIONS)) {
      expect(f.doc, f.name).toBeTruthy();
      expect(f.min, f.name).toBeGreaterThanOrEqual(0);
      expect(f.max === undefined || f.max >= f.min, f.name).toBe(true);
      expect(f.run || f.lazy, f.name).toBeTruthy();
    }
  });
  test('the Notion 2.0 names the spec lists are all there', () => {
    const wanted = [
      'let', 'lets', 'map', 'filter', 'find', 'findIndex', 'some', 'every', 'sort', 'sum', 'mean', 'average', 'median', 'abs', 'ceil', 'floor', 'sqrt', 'cbrt', 'exp', 'ln', 'log10',
      'log2', 'sign', 'pi', 'e', 'toNumber', 'format', 'length', 'lower', 'upper', 'trim', 'substring', 'concat', 'padStart', 'padEnd', 'link', 'test', 'match', 'replace',
      'replaceAll', 'first', 'last', 'unique', 'reverse', 'flat', 'includes', 'count', 'min', 'max', 'empty', 'dateStart', 'dateEnd', 'dateRange', 'dateSubtract', 'parseDate',
      'timestamp', 'fromTimestamp', 'today', 'minute', 'hour', 'day', 'date', 'week', 'month', 'year', 'id', 'ifs', 'toText', 'prop',
    ];
    for (const name of wanted) expect(FUNCTIONS[name.toLowerCase()], name).toBeDefined();
  });
  test('every example in the reference parses', () => {
    for (const f of Object.values(FUNCTIONS)) if (f.example) expect(() => parse(f.example!), `${f.name}: ${f.example}`).not.toThrow();
  });
});

describe('Notion formulas, copied over', () => {
  test.each([
    ['prop("Tags").length() > 2 ? "many" : "few"', 'many'],
    ['{Nums}.map(current * 2).sum()', 12],
    ['{Words}.sort().join("")', 'abc'],
    ['lets(a, 3, b, 4, sqrt(a * a + b * b))', 5],
    ['if({Score} > 80 and {Done}, "pass", "fail")', 'pass'],
    ['{Due}.dateSubtract(1, "days").formatDate("YYYY-MM-DD")', '2026-10-13'],
    ['{Words}.filter(current != "a").length()', 2],
    ['{Name}.replaceAll("[aeiou]", "").length()', 9],
    ['{Name}.split(" ").map(current.slice(0, 1)).join("")', 'TN'],
    ['{Tags}.unique().sort().join(" · ")', 'Essay · Exam'],
    ['{Nums}.sort().at(0) + {Nums}.sort().at(2)', 4],
    ['empty({Empty}) and not empty({Name})', true],
  ])('%s', (src, expected) => {
    expect(ev(src)).toEqual(expected);
  });
});
