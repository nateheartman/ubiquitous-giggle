/**
 * The formula editor's pills: opening a formula as pills and saving it back
 * must give the very same text, and `current.` inside nested callbacks must
 * find the right database at each level.
 */
import { describe, expect, test } from 'vitest';
import goldenSource from './formula.golden.test.ts?raw';
import { parse, run, FormulaError } from './formula';
import { colourSpans, currentDb, lex, pillExists, propText, rowDbBeforeDot, scanPills, type PropLookup } from './formula-pills';
import { docToText, offsetToPos, textToDoc, textToNodes } from './formula-doc';

/** Every formula the golden suite checks, read from its source (the suite itself stays as it is). */
const golden = goldenSource
  .split('\n')
  .flatMap((line: string) => {
    const m = /^\s*\[("(?:[^"\\]|\\.)*"),/.exec(line);
    return m ? [JSON.parse(m[1]) as string] : [];
  });

describe('opening a formula as pills and saving it back', () => {
  test('there are golden formulas to try', () => {
    expect(golden.length).toBeGreaterThan(300);
  });

  test.each(golden.map((f: string) => [f]))('%s is saved as it was written', (src) => {
    expect(docToText(textToDoc(src))).toBe(src);
  });

  test('every golden formula gives the same result once read back from pills', () => {
    const scope = { now: 0, prop: () => null };
    const outcome = (src: string) => {
      try {
        const r = run(src, scope);
        return r instanceof FormulaError ? `error: ${r.message}` : JSON.stringify(r);
      } catch (e) {
        return String(e);
      }
    };
    for (const src of golden) expect(outcome(docToText(textToDoc(src)))).toBe(outcome(src));
  });

  test('prop("X") and {X} become pills; bare names and text stay text', () => {
    const doc = textToDoc('prop("Price") * {Quantity} + Tax + "prop(\\"no\\")"');
    const pills: string[] = [];
    doc.descendants((n) => {
      if (n.type.name === 'propRef') pills.push(n.attrs.name);
    });
    expect(pills).toEqual(['Price', 'Quantity']);
  });

  test('a property named with quotes in it is written with them escaped, and parses', () => {
    expect(propText('He said "hi"')).toBe('prop("He said \\"hi\\"")');
    expect(() => parse(propText('He said "hi"'))).not.toThrow();
    expect(scanPills(propText('He said "hi"'))[0].name).toBe('He said "hi"');
  });

  test('new lines and indentation survive', () => {
    const src = 'if(\n    prop("A"),\n    1,\n\n    2\n)';
    const doc = textToDoc(src);
    expect(docToText(doc)).toBe(src);
    let breaks = 0;
    doc.descendants((n) => {
      if (n.type.name === 'hardBreak') breaks++;
    });
    expect(breaks).toBe(5);
  });

  test('newlines are whitespace to the parser', () => {
    const scope = { now: 0, prop: (n: string) => (n.toLowerCase() === 'a' ? 2 : undefined) };
    const one = run('if(prop("A") > 1, "big", "small")', scope);
    const many = run('if(\n  prop("A")\n    > 1,\n  "big",\n\t"small"\n)', scope);
    expect(many).toBe(one);
    expect(run('[1,\n2,\n3]\n  .length()', scope)).toBe(3);
    expect(run('prop("A")\n.round()', scope)).toBe(2);
  });

  test('pasted text with \\r\\n keeps its lines', () => {
    const nodes = textToNodes('1 +\r\n2');
    expect(nodes.map((n) => n.type.name)).toEqual(['text', 'hardBreak', 'text']);
  });

  test('pasting prop("X") text makes pills', () => {
    const nodes = textToNodes('prop("Price") + 1');
    expect(nodes[0].type.name).toBe('propRef');
    expect(nodes[0].attrs.name).toBe('Price');
  });

  test('a pill picked in the editor (no source) is written as prop("Name")', () => {
    const doc = textToDoc('{Price}');
    const pill = doc.firstChild!.firstChild!;
    expect(pill.attrs.src).toBe('{Price}');
    const schema = doc.type.schema;
    const fresh = schema.nodes.propRef.create({ name: 'Price', scope: 'this' });
    expect(docToText(schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, [fresh])))).toBe('prop("Price")');
  });

  test('text offsets map to document positions', () => {
    const doc = textToDoc('1 + prop("A") +\n2');
    expect(docToText(doc, 0, offsetToPos(doc, 4))).toBe('1 + ');
    expect(docToText(doc, 0, offsetToPos(doc, 13))).toBe('1 + prop("A")');
    expect(docToText(doc, 0, offsetToPos(doc, 16))).toBe('1 + prop("A") +\n');
  });
});

describe('finding pills', () => {
  test('text does not hold pills', () => {
    expect(scanPills('"prop(\\"A\\")" + "{B}"')).toEqual([]);
    expect(scanPills("prop('A') + 'x'")).toHaveLength(1);
  });

  test('a pill after a dot is a related one', () => {
    const [a, b] = scanPills('prop("Tasks").filter(current.prop("Status") != "Done")');
    expect(a.scope).toBe('this');
    expect(b.scope).toBe('related');
    expect(b.name).toBe('Status');
  });

  test('an unfinished formula does not stop the rest being found', () => {
    expect(scanPills('prop("A") + (prop("B"').map((p) => p.name)).toEqual(['A']);
    expect(() => lex('"never closed')).not.toThrow();
  });
});

describe('colours', () => {
  test('functions, text, numbers and operators', () => {
    const text = 'if(a >= 10, "x", length("y"))';
    const spans = colourSpans(text).map((s) => [text.slice(s.start, s.end), s.colour]);
    expect(spans).toContainEqual(['if', 'fn']);
    expect(spans).toContainEqual(['>', 'op']);
    expect(spans).toContainEqual(['=', 'op']);
    expect(spans).toContainEqual(['10', 'num']);
    expect(spans).toContainEqual(['"x"', 'str']);
    expect(spans).toContainEqual(['length', 'fn']);
  });

  test('a method is a function, current is a variable', () => {
    const text = 'x.filter(current > 1)';
    const spans = colourSpans(text).map((s) => [text.slice(s.start, s.end), s.colour]);
    expect(spans).toContainEqual(['filter', 'fn']);
    expect(spans).toContainEqual(['current', 'var']);
  });
});

// People -> Tasks -> Subtasks, as in the Notion screenshot: each database's properties by name.
const DBS: Record<string, { name: string; type: string; config: { database?: string } }[]> = {
  people: [
    { name: 'Name', type: 'title', config: {} },
    { name: 'Tasks', type: 'relation', config: { database: 'tasks' } },
    { name: 'Manager', type: 'relation', config: { database: 'people' } },
  ],
  tasks: [
    { name: 'Name', type: 'title', config: {} },
    { name: 'Status', type: 'status', config: {} },
    { name: 'Next Due', type: 'formula', config: {} },
    { name: 'Subtasks', type: 'relation', config: { database: 'subtasks' } },
    { name: 'Owner', type: 'relation', config: { database: 'people' } },
  ],
  subtasks: [
    { name: 'Name', type: 'title', config: {} },
    { name: 'Hours', type: 'number', config: {} },
  ],
  projects: [{ name: 'People', type: 'relation', config: { database: 'people' } }],
};
const api: PropLookup = { props: (db) => DBS[db] ?? [] };

describe('which database current belongs to', () => {
  test('not inside a callback', () => {
    expect(currentDb('prop("Tasks").length() + ', 'people', api)).toBeNull();
  });

  test('a relation property, as a method', () => {
    expect(currentDb('prop("Tasks").filter(current.', 'people', api)).toBe('tasks');
  });

  test('a relation property, with the function written the long way', () => {
    expect(currentDb('filter(prop("Tasks"), current.', 'people', api)).toBe('tasks');
    // Before the comma the list is still being written, and current doesn't exist yet.
    expect(currentDb('filter(', 'people', api)).toBeNull();
  });

  test('nested: People -> Tasks -> Subtasks', () => {
    const src = 'prop("Tasks").map(current.prop("Subtasks").filter(current.';
    expect(currentDb(src, 'people', api)).toBe('subtasks');
    // Back in the outer one once the inner is closed.
    expect(currentDb('prop("Tasks").map(current.prop("Subtasks").length() + current.', 'people', api)).toBe('tasks');
  });

  test('the screenshot: People.map(current.Tasks.filter(…).filter(…)).flat().unique()', () => {
    const open = 'prop("People").map(\n    current.prop("Tasks")\n        .filter(\n            current.prop("Status") != "Done"\n        ).filter(current.';
    expect(currentDb(open, 'projects', api)).toBe('tasks');
    expect(currentDb('prop("People").map(current.prop("Tasks")).flat().filter(current.', 'projects', api)).toBe('tasks');
  });

  test('a row after sort and first', () => {
    expect(rowDbBeforeDot('prop("Tasks").sort(current.prop("Next Due")).first().', 'people', api)).toBe('tasks');
    expect(rowDbBeforeDot('prop("Tasks").unique().', 'people', api)).toBeNull();
  });

  test('bare names and braces find the relation too', () => {
    expect(currentDb('Tasks.filter(current.', 'people', api)).toBe('tasks');
    expect(currentDb('{Tasks}.filter(current.', 'people', api)).toBe('tasks');
  });

  test('a relation back to its own database', () => {
    expect(currentDb('prop("Manager").filter(current.', 'people', api)).toBe('people');
  });

  test('unresolvable cases give null, not a guess', () => {
    expect(currentDb('prop("Name").filter(current.', 'people', api)).toBeNull();
    expect(currentDb('prop("Nope").filter(current.', 'people', api)).toBeNull();
    expect(currentDb('prop("Tasks").map(current.prop("Name")).filter(current.', 'people', api)).toBeNull();
    expect(currentDb('[1, 2].filter(current.', 'people', api)).toBeNull();
  });

  test('a dot after the partly typed name', () => {
    expect(rowDbBeforeDot('prop("Tasks").filter(current.Sta', 'people', api)).toBe('tasks');
  });
});

describe('whether a pill names a property that exists', () => {
  const check = (text: string, root = 'people') => scanPills(text).map((p) => pillExists(text, p, root, api));

  test('in this database, and in the related one after a dot', () => {
    expect(check('prop("Tasks").filter(current.prop("Status") != "Done")')).toEqual([
      { exists: true, type: 'relation' },
      { exists: true, type: 'status' },
    ]);
  });

  test('missing properties are reported', () => {
    expect(check('prop("Gone")')).toEqual([{ exists: false, type: null }]);
    expect(check('prop("Tasks").filter(current.prop("Hours"))')[1]).toEqual({ exists: false, type: null });
  });

  test('a related pill that cannot be placed is not called missing', () => {
    expect(check('[1].filter(current.prop("Whatever"))')[0]).toBeNull();
  });

  test('nested related pills use the right database at each level', () => {
    const text = 'prop("Tasks").map(current.prop("Subtasks").filter(current.prop("Hours") > 1))';
    expect(check(text).map((x) => x?.type)).toEqual(['relation', 'relation', 'number']);
  });
});
