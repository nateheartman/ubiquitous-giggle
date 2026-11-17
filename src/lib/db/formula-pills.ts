/**
 * The text side of the formula editor's pills. A formula is saved as plain
 * text, so the editor turns that text into pills when it opens (and when text
 * is pasted) and back into text on every change. Everything here works on
 * text only, so it can be tested without an editor or a database: finding
 * the property references, working out which database `current` belongs to
 * inside nested map/filter, and splitting text into colour spans.
 *
 * The lexer is deliberately forgiving. The real tokenizer in formula.ts throws
 * on the first problem, but a formula being typed is unfinished almost all of
 * the time, and the pills and suggestions still have to work then.
 */
import { CALLBACKS } from './formula';

export interface PillSpan {
  /** Where the reference starts and ends in the text. */
  start: number;
  end: number;
  name: string;
  /** `related` after a dot (`current.prop("X")`): a property of another database's row. */
  scope: 'this' | 'related';
  /** The text exactly as it was written, so an untouched formula is saved the way it was typed. */
  src: string;
}

/** What the editor needs to know about databases: their properties, and where relations lead. */
export interface PropLookup {
  props(dbId: string): { name: string; type: string; config: { database?: string } }[];
}

// ------------------------------------------------------------------- lexing

type Kind = 'str' | 'num' | 'id' | 'brace' | 'p' | 'op' | 'ws';
export interface Tok {
  kind: Kind;
  /** For text: what it says (escapes read as the formula language reads them); for a brace: the name. */
  v: string;
  a: number;
  b: number;
}

const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' };

/** Splits text into tokens without ever failing: an unclosed string runs to the end. */
export function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const a = i;
    if (/\s/.test(c)) {
      while (i < src.length && /\s/.test(src[i])) i++;
      out.push({ kind: 'ws', v: src.slice(a, i), a, b: i });
    } else if (QUOTES[c]) {
      const close = QUOTES[c];
      let s = '';
      i++;
      while (i < src.length && src[i] !== close && !(close === '”' && src[i] === '"')) {
        if (src[i] === '\\' && i + 1 < src.length) {
          const e = src[++i];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else s += src[i];
        i++;
      }
      if (i < src.length) i++;
      out.push({ kind: 'str', v: s, a, b: i });
    } else if (c === '{') {
      const end = src.indexOf('}', i + 1);
      if (end < 0) {
        i++;
        out.push({ kind: 'op', v: c, a, b: i });
      } else {
        i = end + 1;
        out.push({ kind: 'brace', v: src.slice(a + 1, end).trim(), a, b: i });
      }
    } else if (/[A-Za-z_]/.test(c)) {
      while (i < src.length && /\w/.test(src[i])) i++;
      out.push({ kind: 'id', v: src.slice(a, i), a, b: i });
    } else if (/\d/.test(c) || (c === '.' && /\d/.test(src[i + 1] ?? ''))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      let len = m ? m[0].length : 1;
      // "10.round()": a dot before a letter starts a method call, not a decimal.
      if (m && m[0].endsWith('.') && /[A-Za-z_]/.test(src[i + len] ?? '')) len--;
      i += len;
      out.push({ kind: 'num', v: src.slice(a, i), a, b: i });
    } else if ('()[].,'.includes(c)) {
      i++;
      out.push({ kind: 'p', v: c, a, b: i });
    } else {
      i++;
      out.push({ kind: 'op', v: c, a, b: i });
    }
  }
  return out;
}

const significant = (toks: Tok[]) => toks.filter((t) => t.kind !== 'ws');

// -------------------------------------------------------------------- pills

/** `prop("X")` in a source text: its name written back with the same escapes the formula language reads. */
export function propText(name: string): string {
  return `prop("${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
}

/** The property references in a formula: `prop("X")` and `{X}`, except inside text. */
export function scanPills(text: string): PillSpan[] {
  const all = lex(text);
  const toks = significant(all);
  const out: PillSpan[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.kind === 'brace' && tok.v) {
      out.push({ start: tok.a, end: tok.b, name: tok.v, scope: 'this', src: text.slice(tok.a, tok.b) });
    } else if (tok.kind === 'id' && tok.v.toLowerCase() === 'prop' && toks[i + 1]?.v === '(' && toks[i + 1].kind === 'p' && toks[i + 2]?.kind === 'str' && toks[i + 3]?.v === ')' && toks[i + 3].kind === 'p') {
      // The string must have been closed, or the ")" after it is part of the text.
      const q = text[toks[i + 2].b - 1];
      if (!(q === QUOTES[text[toks[i + 2].a]] || (QUOTES[text[toks[i + 2].a]] === '”' && q === '"'))) continue;
      const end = toks[i + 3].b;
      const related = toks[i - 1]?.kind === 'p' && toks[i - 1].v === '.';
      out.push({ start: tok.a, end, name: toks[i + 2].v, scope: related ? 'related' : 'this', src: text.slice(tok.a, end) });
      i += 3;
    }
  }
  return out;
}

// ------------------------------------------------------------------ colours

export type Colour = 'fn' | 'str' | 'num' | 'op' | 'var' | 'kw';
export interface ColourSpan {
  start: number;
  end: number;
  colour: Colour;
}

const WORD_OPS = new Set(['and', 'or', 'not']);
const KEYWORDS = new Set(['true', 'false']);

/** Which stretches of the text to colour, and how. */
export function colourSpans(text: string): ColourSpan[] {
  const toks = significant(lex(text));
  const out: ColourSpan[] = [];
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    const add = (colour: Colour) => out.push({ start: tok.a, end: tok.b, colour });
    if (tok.kind === 'str') add('str');
    else if (tok.kind === 'num') add('num');
    else if (tok.kind === 'op') {
      if ('=!<>+-*/%^&|?:≠≤≥'.includes(tok.v)) add('op');
    } else if (tok.kind === 'id') {
      const word = tok.v.toLowerCase();
      if (toks[i + 1]?.v === '(' && toks[i + 1].kind === 'p') add('fn');
      else if (WORD_OPS.has(word)) add('op');
      else if (KEYWORDS.has(word)) add('num');
      else if (word === 'current' || word === 'index') add('var');
    }
  }
  return out;
}

// ----------------------------------------------------- where `current` points

/** What a piece of formula stands for, as far as the editor can tell: rows of a database, a list of such lists, or one row. */
type Val = { kind: 'rows' | 'lists' | 'row'; db: string } | null;

/** Index of the bracket that closes the one at `open`, in `toks` (significant tokens only). */
function closing(toks: Tok[], open: number): number {
  let depth = 0;
  for (let i = open; i < toks.length; i++) {
    const t = toks[i];
    if (t.kind !== 'p') continue;
    if (t.v === '(' || t.v === '[') depth++;
    else if (t.v === ')' || t.v === ']') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** The arguments of a call as token lists, `open` being its "(". */
function args(toks: Tok[], open: number): { list: Tok[][]; end: number } {
  const end = closing(toks, open);
  const stop = end < 0 ? toks.length : end;
  const list: Tok[][] = [];
  let cur: Tok[] = [];
  let depth = 0;
  for (let i = open + 1; i < stop; i++) {
    const t = toks[i];
    if (t.kind === 'p' && (t.v === '(' || t.v === '[')) depth++;
    if (t.kind === 'p' && (t.v === ')' || t.v === ']')) depth--;
    if (t.kind === 'p' && t.v === ',' && depth === 0) {
      list.push(cur);
      cur = [];
    } else cur.push(t);
  }
  if (cur.length || list.length) list.push(cur);
  return { list, end };
}

const KEEPS_ROWS = new Set(['filter', 'sort', 'unique', 'reverse']);
const ONE_ROW = new Set(['first', 'last', 'at', 'find']);

class Resolver {
  constructor(
    private api: PropLookup,
    private root: string,
  ) {}

  /** A relation property of a database: the database it leads to. */
  private relation(db: string, name: string): string | null {
    const p = this.api.props(db).find((x) => x.name.toLowerCase() === name.toLowerCase());
    return p && p.type === 'relation' && p.config.database ? p.config.database : null;
  }

  /** `current` is a row of the database on top of `ctx`. */
  value(toks: Tok[], ctx: (string | null)[]): Val {
    const [first] = toks;
    if (!first) return null;
    let i = 0;
    let val: Val = null;
    if (first.kind === 'brace') {
      val = this.rootProp(first.v);
      i = 1;
    } else if (first.kind === 'id') {
      const word = first.v.toLowerCase();
      const call = toks[1]?.v === '(' && toks[1].kind === 'p';
      if (word === 'current' && !call) {
        const top = ctx[ctx.length - 1];
        val = top ? { kind: 'row', db: top } : null;
        i = 1;
      } else if (word === 'prop' && call) {
        const a = args(toks, 1);
        if (a.list[0]?.length === 1 && a.list[0][0].kind === 'str') val = this.rootProp(a.list[0][0].v);
        i = a.end < 0 ? toks.length : a.end + 1;
      } else if (call) {
        // A function used the long way: filter(list, test) is list.filter(test).
        const a = args(toks, 1);
        val = a.list[0] ? this.value(a.list[0], ctx) : null;
        val = this.step(val, word, a.list.slice(1), ctx);
        i = a.end < 0 ? toks.length : a.end + 1;
      } else {
        val = this.rootProp(first.v);
        i = 1;
      }
    } else if (first.kind === 'p' && first.v === '(') {
      const end = closing(toks, 0);
      val = this.value(toks.slice(1, end < 0 ? toks.length : end), ctx);
      i = end < 0 ? toks.length : end + 1;
    } else return null;
    while (i < toks.length) {
      if (toks[i].v !== '.' || toks[i + 1]?.kind !== 'id') return null;
      const word = toks[i + 1].v.toLowerCase();
      if (toks[i + 2]?.v === '(' && toks[i + 2].kind === 'p') {
        const a = args(toks, i + 2);
        val = this.step(val, word, a.list, ctx);
        i = a.end < 0 ? toks.length : a.end + 1;
      } else return null;
    }
    return val;
  }

  private rootProp(name: string): Val {
    const db = this.relation(this.root, name);
    return db ? { kind: 'rows', db } : null;
  }

  private step(val: Val, word: string, given: Tok[][], ctx: (string | null)[]): Val {
    if (!val) return null;
    if (word === 'prop' && val.kind === 'row') {
      const arg = given[0];
      const db = arg?.length === 1 && arg[0].kind === 'str' ? this.relation(val.db, arg[0].v) : null;
      return db ? { kind: 'rows', db } : null;
    }
    if (val.kind === 'rows') {
      if (KEEPS_ROWS.has(word)) return val;
      if (ONE_ROW.has(word)) return { kind: 'row', db: val.db };
      if (word === 'flat') return val;
      if (word === 'map' && given[0]) {
        const inner = this.value(given[0], [...ctx, val.db]);
        if (inner?.kind === 'rows') return { kind: 'lists', db: inner.db };
        if (inner?.kind === 'row') return { kind: 'rows', db: inner.db };
      }
      return null;
    }
    if (val.kind === 'lists') {
      if (word === 'flat') return { kind: 'rows', db: val.db };
      if (KEEPS_ROWS.has(word)) return val;
    }
    return null;
  }
}

interface OpenCall {
  name: string;
  /** Index (among significant tokens) of the "(". */
  open: number;
  /** Index of the first top-level comma, or -1. */
  comma: number;
}

/** The brackets still open at the end of the tokens. */
function openCalls(toks: Tok[]): OpenCall[] {
  const stack: OpenCall[] = [];
  toks.forEach((t, i) => {
    if (t.kind !== 'p') return;
    if (t.v === '(') stack.push({ name: toks[i - 1]?.kind === 'id' ? toks[i - 1].v.toLowerCase() : '', open: i, comma: -1 });
    else if (t.v === '[') stack.push({ name: '', open: i, comma: -1 });
    else if (t.v === ')' || t.v === ']') stack.pop();
    else if (t.v === ',' && stack.length && stack[stack.length - 1].comma < 0) stack[stack.length - 1].comma = i;
  });
  return stack;
}

/** Where the chain that ends just before token `end` begins: `a.b(c).d` read backwards from the "." before what follows. */
function chainStart(toks: Tok[], end: number): number {
  let j = end - 1;
  let start = end;
  for (;;) {
    const t = toks[j];
    if (!t) break;
    let s: number;
    if (t.kind === 'p' && (t.v === ')' || t.v === ']')) {
      let depth = 0;
      let m = -1;
      for (let k = j; k >= 0; k--) {
        const x = toks[k];
        if (x.kind !== 'p') continue;
        if (x.v === ')' || x.v === ']') depth++;
        else if (x.v === '(' || x.v === '[') {
          depth--;
          if (depth === 0) {
            m = k;
            break;
          }
        }
      }
      if (m < 0) break;
      s = m > 0 && toks[m].v === '(' && toks[m - 1].kind === 'id' ? m - 1 : m;
    } else if (t.kind === 'id' || t.kind === 'brace' || t.kind === 'str' || t.kind === 'num') s = j;
    else break;
    start = s;
    if (toks[s - 1]?.kind === 'p' && toks[s - 1].v === '.') j = s - 2;
    else break;
  }
  return start;
}

/**
 * The database whose rows `current` stands for at the end of `before`, going through however many map/filter calls the caret is inside. Null when it isn't in
 * one, or can't be worked out (the editor then offers plain suggestions).
 */
export function currentDb(before: string, root: string, api: PropLookup): string | null {
  const ctx = contextOf(significant(lex(before)), root, api);
  return ctx[ctx.length - 1] ?? null;
}

/** The row database for each callback the end of `toks` is inside, outermost first; null for one that can't be told. */
function contextOf(toks: Tok[], root: string, api: PropLookup): (string | null)[] {
  const r = new Resolver(api, root);
  const ctx: (string | null)[] = [];
  for (const call of openCalls(toks)) {
    if (!CALLBACKS.has(call.name)) continue;
    const nameAt = call.open - 1;
    let receiver: Tok[];
    if (toks[nameAt - 1]?.kind === 'p' && toks[nameAt - 1].v === '.') {
      // list.filter(…): the list is what comes before the dot.
      receiver = toks.slice(chainStart(toks, nameAt - 1), nameAt - 1);
    } else if (call.comma >= 0) {
      // filter(list, …): only after the list is `current` there.
      receiver = toks.slice(call.open + 1, call.comma);
    } else continue;
    const val = r.value(receiver, ctx);
    ctx.push(val?.kind === 'rows' ? val.db : null);
  }
  return ctx;
}

/**
 * After a dot at the end of `before` (`current.` or `current.Sta`): the
 * database that row belongs to, when the thing before the dot is a row.
 */
export function rowDbBeforeDot(before: string, root: string, api: PropLookup): string | null {
  const all = significant(lex(before));
  let end = all.length;
  if (all[end - 1]?.kind === 'id' && all[end - 2]?.v === '.') end--;
  if (all[end - 1]?.v !== '.' || all[end - 1].kind !== 'p') return null;
  const toks = all.slice(0, end - 1);
  const ctx = contextOf(toks, root, api);
  const val = new Resolver(api, root).value(toks.slice(chainStart(toks, toks.length)), ctx);
  return val?.kind === 'row' ? val.db : null;
}

/**
 * Whether the property a pill names exists: in this database for a plain one, in the related
 * database for one after a dot. Null when that database can't be worked out (then it's not called missing).
 */
export function pillExists(text: string, pill: PillSpan, root: string, api: PropLookup): { exists: boolean; type: string | null } | null {
  let db: string | null = root;
  if (pill.scope === 'related') {
    // The "." before it is the last thing in the text before the pill.
    const before = text.slice(0, pill.start);
    db = rowDbBeforeDot(before.replace(/\s+$/, ''), root, api);
    if (!db) return null;
  }
  const p = api.props(db).find((x) => x.name.toLowerCase() === pill.name.toLowerCase());
  return { exists: !!p, type: p?.type ?? null };
}
