# 03 — Database formulas, Notion 2.0-compatible

## Why

The formula property (`src/lib/db/formula.ts`, `FormulaEditor.svelte`) has a hand-written parser/evaluator with about 40 functions in 5 groups (logic, math, text, dates, lists), and relations/rollups exist as property types. It covers the basics but can't do what people expect from Notion: variables, list processing, chaining through relations, regex. Formulas copied from Notion guides should mostly just work.

## Decision (made by the owner)

**Extend the existing engine toward Notion Formulas 2.0 syntax.** Do not embed a third-party engine, and do not switch to spreadsheet syntax. **Every formula that works today must keep working with the same result**: the current syntax (`{Prop}`, bare one-word names, `prop("X")`, `and/or/not`, `?:`, the operators) stays.

## What to add

### Syntax
- **Dot-method calls**: `x.f(a, b)` ≡ `f(x, a, b)` for every function. `prop("Tags").length()`, `{Due}.dateAdd(2, "days")`, chains `a.f().g()`.
- **Variables**: `let(name, value, expr)` and `lets(n1, v1, n2, v2, …, expr)`.
- **List callbacks** with Notion's implicit `current` and `index`: `map`, `filter`, `find`, `findIndex`, `some`, `every`, and `sort(list)` / `sort(list, current.prop("X"))`.
- **List literals** `[1, 2, 3]`.
- Keep `==`/`!=`/`and`/`or`; also accept Notion's `true`/`false` and `empty()` checks.

### Relations
- `prop("Relation")` returns a list of the related **rows** (a new `FValue` kind, e.g. `FRow`), shown as their titles when the result is rendered.
- `row.prop("X")` reads property X of a related row (including its formulas, with cycle protection and a depth limit of 3 → `FormulaError`).
- This makes `prop("Tasks").filter(current.prop("Done")).length()` and `prop("Items").map(current.prop("Price")).sum()` work.
- `Scope` needs a way to resolve a row id to its properties; wire it from where formulas are evaluated today (find the callers of `run`/`evaluate`). Keep evaluation cheap: memoize per render, as `now` is fixed per render.

### Functions (add the Notion 2.0 ones that are missing; names are Notion's)
- **Math**: `sum`, `mean` (alias `average`), `median`, `abs`, `ceil`, `floor`, `sqrt`, `cbrt`, `exp`, `ln`, `log10`, `log2`, `sign`, `pi`, `e`, `toNumber`, `format` (number → text).
- **Text**: `length`, `lower`, `upper`, `trim`, `substring`, `concat`, `padStart`, `padEnd`, `link(label, url)` (render as a link if cheap, else text), `test(text, regex)`, `match(text, regex)` (list), `replaceAll(text, regex, with)`, `replace` gains regex support. Regexes: JS syntax, with invalid patterns → a clear `FormulaError`.
- **Lists**: `first`, `last`, `unique`, `reverse`, `flat`, `includes`, `concat`, `count`, `sum`/`min`/`max` over lists, `empty`.
- **Dates**: `dateStart`, `dateEnd`, `dateRange`, `dateSubtract`, `parseDate`, `timestamp`, `fromTimestamp`, `today`, `minute`, `hour`, `day` (weekday 1–7), `date` (day of month), `week`, `month`, `year`.
- **Other**: `id()` (row id), `ifs` (exists, keep), `toText` (exists).
- Skip `style`/`unstyle` (no rich formula output yet): list it as a follow-up.
- Check every addition against the existing function table first; reuse, don't duplicate.

### Editor (`FormulaEditor.svelte`)
- The reference panel lists the new functions in their groups with signature, one-line description and an example (texts via `t()` in `dbAuto.json`, like the existing ones).
- Autocomplete after `.` offers methods; inside `map(`/`filter(`… it offers `current` and `index`.
- Error messages point at the position (`FormulaError.at`), as today.

## Constraints
- No new database migration; the formula text format stays the same, so old saves load.
- `renameProperty` and `references` must understand the new syntax (method chains, `current.prop("X")` refers to the *related* database, not this one, so it must not be renamed when a local property is renamed).
- Performance: a 3,000-row table with a `map/filter` formula over a relation must render without a visible stall. Measure it and report the number.

## Done when
- The checks in `00-conventions.md` pass.
- **Unit tests** for `formula.ts` (create the test setup if the repo has none for TS: Vitest is fine, add an `npm test` script) covering: every old function unchanged (golden tests written *before* you change the engine), every new function, method chains, `let/lets`, `current/index`, relation traversal, the cycle/depth guard, regex errors, `renameProperty` with the new syntax.
- A Playwright spec: create a relation between two databases, add the formula `prop("Items").map(current.prop("Price")).sum()`, and see the right total.
- A short `docs/formulas.md` user reference listing all functions with examples.
