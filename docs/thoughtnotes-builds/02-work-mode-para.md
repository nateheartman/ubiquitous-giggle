# 02 — Work mode: School or Work, with PARA-lite

## Why

Thought Desk is built around school: Courses, Assignments, grades, study. ThoughtNotes should also fit people at work. Instead of a second app, a **mode switch** re-labels and reshapes the school structures into the **PARA** method (Projects, Areas, Resources, Archive) by Tiago Forte:

- **Projects**: short-term efforts with an outcome and a deadline.
- **Areas**: ongoing responsibilities with no end date (what Courses become).
- **Resources**: reference material (what the file Library becomes).
- **Archive**: inactive items from the other three.

## Decisions (made by the owner)

- Depth: **PARA-lite** (below). Not wording-only, and not a sidebar rebuilt around PARA folders.
- The switch appears **on first launch** and in **Settings**.

## Behaviour

### The switch
- A workspace setting `mode: 'school' | 'work'`. Store it the same way other workspace settings are stored. Existing workspaces default to `school`, so nothing changes for current users.
- **First launch** (the Welcome / onboarding flow): one step asks "How will you use ThoughtNotes?" with two cards: **School** (courses, assignments, grades) and **Work** (areas, projects, tasks). Choosing one sets the mode. It can be skipped (school).
- **Settings**: a "Mode" control (segmented School | Work) with one line saying that switching only changes labels and what's shown, and that no data is deleted.
- Switching is instant and reversible. All data survives switching back and forth.

### Wording (Work mode)
| School | Work |
|---|---|
| Course / Courses | Area / Areas |
| Assignment / Assignments | Task / Tasks |
| Teacher, Office hours, Room (course fields) | Owner, Notes, Location (keep the same fields, new labels) |
| Files / Library (sidebar name) | Resources |
| Lecture notes | Notes |

Implement this as a **vocabulary overlay on the i18n layer**, not as `if (mode)` scattered through components: e.g. `src/locales/en/work.json` holding override texts keyed by the existing message key, which `t()` consults first when the mode is `work`. Every message that says course/assignment/teacher/lecture/grade/semester/study needs an override (grep the en locale files). The i18n checker must accept the overlay file (overlay keys must exist in the base; placeholders must match), so extend `.github/scripts/i18n-check.mjs` accordingly.

### Hidden in Work mode
- Grades / GPA (`grades.ts` and its UI).
- School-only course fields that make no sense at work, if any (decide per field, list them in your report).
- Flashcards/study stay available (they're useful at work too), unchanged.

### Projects (new, Work mode only)
- A Project has: name, colour, optional **Area**, **outcome** (one line: what "done" looks like), optional **deadline** (date), status `active | done`, a notes page (same pattern as a Course's `pageId`), position, timestamps, `archivedAt`.
- Tasks (assignments) gain an optional `projectId`, alongside `courseId` (Area). A task can belong to an Area, a Project, both, or neither.
- **Sidebar**: in Work mode, a "Projects" section above "Areas" listing active projects (drag to reorder, like courses), each opening a **Project view** modelled on `CourseView.svelte`: outcome, deadline with days left, the Area, open/done tasks, the notes page.
- Assignment/Task sheet: a Project picker next to the Area picker (Work mode only).
- Calendar shows project deadlines as all-day markers.
- Database `course` property type: in Work mode it's labelled "Area". Add a `project` property type only if it's cheap; otherwise list it as a follow-up.
- Backend: migration **v14** creates `projects` and adds `assignments.project_id` and `courses.archived_at`. Commands follow the pattern of the course commands in `planner.rs` / `commands.rs`. Rust unit tests for create/update/archive/delete and for deleting a project un-linking its tasks (not deleting them).
- Projects should **not** be added to the sync code (cloud features are hidden), but nothing in sync may break because of the new columns.

### Archive (both kinds)
- Areas and Projects can be **archived** (right-click → Archive, and in Settings). Archived ones leave the sidebar and pickers, and their tasks are hidden from Home/due-soon. They're listed in an **Archive** section (in Settings → Areas & Projects, with Restore). Archiving never deletes.
- In School mode, archiving courses works the same way ("Archive course", e.g. last semester), which is useful on its own.

### Resources
- In Work mode the Library is labelled **Resources**. No structural change.

## Done when

- The checks in `00-conventions.md` pass.
- Playwright specs: choosing Work on first launch; switching in Settings relabels the sidebar, the course view and the assignment sheet; creating a project with an area and deadline; assigning a task to it; archiving and restoring an area and a project; switching back to School shows everything as before.
- No hard-coded "Area"/"Project" strings outside the locale files.

## Not in scope

A PARA-shaped sidebar with pages filed into P/A/R/A folders; templates; moving pages between areas automatically.
