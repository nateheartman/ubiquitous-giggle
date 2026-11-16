# 05 — Project progress (% complete)

## Why
In Work mode, a Project's tasks are planner tasks (assignments with `projectId`), not database rows, so a formula can't compute progress. The owner wants % complete on the project itself.

## Behaviour
- **Project view** (`ProjectView.svelte`): under the outcome/deadline header, a progress bar with the label "3 of 5 tasks done · 60%". Done = task `status === 'done'`. Archived/deleted tasks don't count. A project with no tasks shows "No tasks yet" and no bar.
- **Sidebar** project rows: a small progress ring or fill (pick the one that fits the existing sidebar style, and keep it subtle), with the % in the row's tooltip.
- **Area view** (CourseView in Work mode): its list of projects shows each project's % as well.
- When a project's status is set to `done`, keep showing the bar (it may be less than 100%; that's the user's call).
- One derived value in `planner.svelte.ts` (e.g. `progressByProject: Map<id, {done, total}>`), reused by all three places. No backend change and no migration.
- Text through `t()` in `en/planner.json` with @notes and plural forms ("1 of 1 task done").
- Use the app's existing colour tokens (the project's colour for the fill), and check it in both light and dark themes.

## Done when
- Checks in `00-conventions.md` pass.
- Playwright: a project with 3 tasks, complete 2 → 67% in the view, sidebar tooltip and area view; archive one task → recalculates; no tasks → "No tasks yet".
