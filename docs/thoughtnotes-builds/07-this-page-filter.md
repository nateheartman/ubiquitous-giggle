# 07 — "This page" relation filter, and new rows that inherit it

## Why
In Notion, a database row's page (say a Person or a Project) can hold a linked view of another database (Tasks, Meeting notes) filtered to `Relation contains **This page**`. The view then shows only that page's items, and **a new item added from that view gets the relation set to that page automatically**. The owner uses this constantly: adding tasks to a person, or meeting notes to a project. Owner's screenshot: a Tasks board inside a Project page, filtered `Project contains <this project>` OR `Parent Project contains <this project>`.

## What exists
- Filter rules: `FilterRule { id, prop, op, value }` in `types.ts`, operators in `src/lib/db/query.ts`. Relations are the `list` kind with `hasAny` / `hasNone` / empty ops.
- New rows already take values from simple filters: `#defaults()` in `src/lib/databases.svelte.ts` (select/status/checkbox/number/text/date). **Relations aren't handled.**
- Databases are embedded in pages through `DatabaseBlock.svelte` → `DatabaseView.svelte`.

## Behaviour
1. **"This page" as a filter value.** For a relation filter (`hasAny` / `hasNone`), the value picker (`FilterPanel.svelte`, `RelationPicker.svelte`) offers **This page** at the top, as a special token (e.g. `'@this'`) stored in the rule's value list alongside any fixed row ids. Shown as a chip "This page" with a page icon.
2. **Resolving it.** The view needs the **host page**: the page the database block sits in. Thread it from `DatabaseBlock` into `DatabaseView` and the query context. When a view is opened full-page (not embedded), or its host page isn't a row that the relation can point to, "This page" matches nothing, and the filter panel shows a quiet note ("This page isn't a row of <Projects>").
   - Also honour the token when the view is shown inside a row's page that's open as a side peek / sheet (`RowProperties` pages).
3. **New rows inherit it.** In `#defaults()`, a relation filter with `hasAny` whose values resolve (This page → host page id, plus any fixed ids) sets that relation on the new row. With the match mode `any` (OR) across several relation rules, as in the screenshot, set only the **first** matching rule, so a new task gets Project = this project but not Parent Project as well. With `all`, set all of them. Two-way relations must update the other side (`#linkNew` already does this; make sure it runs).
   - Applies to every way of adding a row from that view: the New button, `+` at the bottom/top of a table, a board column's `+`, calendar click, templates and forms.
4. **Also pre-fill from `is`/`contains` on a `course` property** (Areas in Work mode) if that's missing from `#defaults`.
5. Duplicating a page that holds such a view: the token stays `@this`, so the copy filters to *its* own page. (That's the point of a token rather than an id.) Templates likewise: a template page containing a "This page" view works for every row created from it. Test this.

## Constraints
- No migration: the token lives in the existing view config JSON.
- The `@this` token must never be written into a row's cells; resolve it first.
- Old views without the token behave exactly as before.
- Text through `t()` (`en/database.json`, `en/dbViews.json`).

## Done when
- Checks in `00-conventions.md` pass.
- Unit tests (Vitest) for resolving the token and for `#defaults` with relation filters in `all`/`any` modes.
- Playwright: a Projects DB and a Tasks DB with a two-way relation. Open project A's page, insert a linked Tasks view, filter Project contains This page → only A's tasks show. Click New → the task has Project = A, and A's Tasks relation lists it. Do the same in project B's page, through a template that contains the view → it shows only B's tasks.
