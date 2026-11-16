/**
 * What the formula tests evaluate against: one fixed "now" and one row of
 * properties, so results never depend on the day the tests run.
 */
import { FDate, FRow, FormulaError, toText, type FValue, type Scope } from './formula';

export const NOW = new Date(2026, 9, 10, 12, 0).getTime(); // Oct 10, 2026, noon (local time)

export const day = (y: number, m: number, d: number, h?: number, mi?: number) => new FDate(new Date(y, m - 1, d, h ?? 0, mi ?? 0).getTime(), h !== undefined);

export const PROPS: Record<string, FValue> = {
  price: 10,
  quantity: 3,
  score: 85,
  name: 'Thought Notes',
  text42: '42',
  done: true,
  notdone: false,
  tags: ['Exam', 'Essay', 'Exam'],
  nums: [3, 1, 2],
  words: ['b', 'a', 'c'],
  due: day(2026, 10, 14),
  start: day(2026, 9, 30),
  meeting: day(2026, 10, 14, 15, 30),
  empty: null,
  emptytext: '',
  'due date': day(2026, 10, 14),
  status: 'Doing',
};

export function scopeOf(extra: Record<string, FValue> = {}): Scope {
  const all = { ...PROPS, ...extra };
  return { now: NOW, prop: (name) => all[name.trim().toLowerCase()] };
}

/** A result as plain, comparable data: dates as "date:2026-10-14" ("…T15:30" with a time), errors as "error". */
export function show(v: FValue | FormulaError): unknown {
  if (v instanceof FormulaError) return 'error';
  if (v instanceof FDate) {
    const x = new Date(v.ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `date:${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}${v.time ? `T${p(x.getHours())}:${p(x.getMinutes())}` : ''}`;
  }
  if (v instanceof FRow) return `row:${v.title}`;
  if (Array.isArray(v)) return v.map(show);
  if (typeof v === 'number' && Number.isNaN(v)) return 'NaN';
  return v;
}

export { toText };
