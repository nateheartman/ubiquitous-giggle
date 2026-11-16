<script lang="ts">
  /** A project (Work mode): its outcome, deadline, tasks and notes. Modelled on CourseView. */
  import PageIcon from '../components/PageIcon.svelte';
  import Icon from '../components/Icon.svelte';
  import AssignmentRow from '../ui/AssignmentRow.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import ProgressBar from '../ui/ProgressBar.svelte';
  import { clock } from '../clock.svelte';
  import { PALETTE, colorVar } from '../colors';
  import { diffDays } from '../dates';
  import { planner } from '../planner.svelte';
  import { store } from '../store.svelte';
  import { relativeTime } from '../time';
  import { t } from '../i18n';
  import { ui } from '../ui.svelte';

  let { id }: { id: string } = $props();

  const project = $derived(planner.projectById.get(id));
  const area = $derived(project?.areaId ? planner.courseById.get(project.areaId) : undefined);
  const folder = $derived.by(() => {
    const p = project?.pageId ? store.byId.get(project.pageId) : undefined;
    return p && !p.deletedAt ? p : undefined;
  });

  const tasks = $derived(planner.live.filter((a) => a.projectId === id));
  const open = $derived(tasks.filter((a) => a.status !== 'done'));
  const done = $derived(tasks.length - open.length);
  const progress = $derived(planner.progressByProject.get(id));
  const notes = $derived(folder ? store.children(folder.id) : []);

  /** Whole days until the deadline: negative once it has passed. */
  const daysLeft = $derived(project?.deadline ? diffDays(clock.today, project.deadline) : null);
  const deadlineText = $derived.by(() => {
    if (daysLeft === null) return t('planner.project.noDeadline');
    if (daysLeft < 0) return t('planner.project.overdueBy', { count: -daysLeft });
    if (daysLeft === 0) return t('planner.project.dueToday');
    return t('planner.project.daysLeft', { count: daysLeft });
  });

  const summary = $derived(
    [project?.status === 'done' ? t('planner.project.statusDone') : deadlineText, t('planner.project.openTasks', { count: open.length })].join(' · '),
  );

  function areaMenu(e: MouseEvent) {
    ui.openMenuAt(
      e.currentTarget as Element,
      [
        { label: t('planner.project.noArea'), icon: 'x', checked: !project?.areaId, action: () => planner.updateProject(id, { areaId: null }) },
        ...(planner.activeCourses.length ? [{ separator: true } as const] : []),
        ...planner.activeCourses.map((c) => ({
          label: c.name || t('common.untitled'),
          dot: colorVar(c.color),
          checked: project?.areaId === c.id,
          action: () => planner.updateProject(id, { areaId: c.id }),
        })),
      ],
      { alignRight: true },
    );
  }

  function menu(e: MouseEvent) {
    const p = project;
    if (!p) return;
    ui.openMenuAt(
      e.currentTarget as Element,
      [
        {
          label: t('sheets.renameMenu'),
          icon: 'pencil',
          action: async () => {
            const res = await ui.prompt({ title: t('planner.project.renameTitle'), value: p.name, confirmLabel: t('common.actions.rename'), icon: 'flag' });
            if (res) planner.updateProject(p.id, { name: res.value });
          },
        },
        { label: folder ? t('planner.project.openFolder') : t('planner.project.createFolder'), icon: 'folder', action: () => void openFolder() },
        { separator: true },
        { header: t('sheets.color') },
        ...PALETTE.map((c) => ({
          label: c.label,
          dot: colorVar(c.key),
          checked: p.color === c.key,
          action: () => planner.updateProject(p.id, { color: c.key }),
        })),
        { separator: true },
        { label: t('planner.archive.project'), icon: 'archive', action: () => void planner.setProjectArchived(p.id, true) },
        { label: t('planner.project.delete'), icon: 'trash', danger: true, action: () => void planner.deleteProject(p.id) },
      ],
      { alignRight: true },
    );
  }

  async function openFolder() {
    const pageId = await planner.projectFolder(id);
    if (pageId) store.open(pageId);
  }
</script>

{#if project}
  <div class="view project" data-testid="project-view" style:--course={colorVar(project.color)}>
    <header class="view-head">
      <div>
        <div class="eyebrow">{t('planner.project.singular')}</div>
        <h1 class="view-title"><span class="project-dot" style:--c={colorVar(project.color)}></span>{project.name || t('common.untitled')}</h1>
        <p class="view-sub">{summary}</p>
        <div class="progress" data-testid="project-progress">
          {#if progress}
            <ProgressBar done={progress.done} total={progress.total} color={colorVar(project.color)} label={t('planner.project.progressBar')} />
            <span class="progress-text">{t('planner.project.progress', { done: progress.done, count: progress.total, percent: planner.percentDone(progress) })}</span>
          {:else}
            <span class="progress-text">{t('planner.project.noTasksYet')}</span>
          {/if}
        </div>
      </div>
      <div class="view-actions">
        <button class="icon-btn" onclick={menu} data-tip={t('planner.project.options')} aria-label={t('planner.project.options')}><Icon name="more" /></button>
        <button class="btn" onclick={() => planner.updateProject(id, { status: project.status === 'done' ? 'active' : 'done' })}>
          <Icon name={project.status === 'done' ? 'undo' : 'check'} size={15} stroke={2.2} />
          {project.status === 'done' ? t('planner.project.reopen') : t('planner.project.markDone')}
        </button>
        <button class="btn" onclick={() => planner.newAssignment({ projectId: id, courseId: project.areaId })}><Icon name="plus" size={15} stroke={2.2} /> {t('planner.project.newTask')}</button>
        <button class="btn primary" onclick={() => void planner.newProjectNote(id)}><Icon name="note" size={15} stroke={2} /> {t('planner.project.newNote')}</button>
      </div>
    </header>

    <div class="columns">
      <div class="col">
        <section>
          <h2 class="group-title">
            <span>{t('planner.project.tasks')}</span>
            <span class="count">{done ? t('sheets.courseView.doneCount', { count: done }) : ''}</span>
          </h2>
          {#if open.length}
            <div class="group">
              {#each open as a (a.id)}
                <AssignmentRow {a} />
              {/each}
            </div>
          {:else}
            <div class="group">
              <EmptyState compact icon="assignment" title={t('sheets.courseView.nothingOpen')} text={t('planner.project.nothingOpenText')} />
            </div>
          {/if}
        </section>
      </div>

      <div class="col">
        <section>
          <h2 class="group-title"><span>{t('sheets.details')}</span></h2>
          <div class="group">
            <div class="group-row compact detail">
              <span class="detail-icon"><Icon name="flag" size={15} /></span>
              <span class="detail-label">{t('planner.project.outcome')}</span>
              <label class="field">
                <input
                  value={project.outcome}
                  placeholder={t('planner.project.outcomePlaceholder')}
                  aria-label={t('planner.project.outcome')}
                  oninput={(e) => planner.updateProject(id, { outcome: e.currentTarget.value }, { typing: true })}
                />
              </label>
            </div>
            <div class="group-row compact detail">
              <span class="detail-icon"><Icon name="calendar" size={15} /></span>
              <span class="detail-label">
                {t('planner.project.deadline')}
                <small class="deadline-state" class:late={daysLeft !== null && daysLeft < 0 && project.status !== 'done'}>{deadlineText}</small>
              </span>
              <label class="field">
                <input
                  type="date"
                  value={project.deadline ?? ''}
                  aria-label={t('planner.project.deadline')}
                  onchange={(e) => planner.updateProject(id, { deadline: e.currentTarget.value || null })}
                />
              </label>
            </div>
            <div class="group-row compact detail">
              <span class="detail-icon"><Icon name="book" size={15} /></span>
              <span class="detail-label">{t('common.course')}</span>
              <button class="btn small raised picker" onclick={areaMenu}>
                {#if area}<span class="dot" style:--dot={colorVar(area.color)}></span>{area.name || t('common.untitled')}{:else}<span class="muted">{t('sheets.coursePicker.none')}</span>{/if}
                <Icon name="chevron-down" size={12} stroke={2.2} />
              </button>
            </div>
          </div>
        </section>

        <section>
          <h2 class="group-title">
            <span>{t('sheets.section.notes')}</span>
            <button class="see-all" onclick={() => void planner.newProjectNote(id)}>{t('sheets.courseView.newNote')} <Icon name="plus" size={12} stroke={2.2} /></button>
          </h2>
          <div class="group">
            {#each notes.slice(0, 8) as p (p.id)}
              <button class="group-row compact link-row" onclick={() => store.open(p.id)}>
                <span class="page-icon">{#if p.icon}<PageIcon icon={p.icon} />{:else}<Icon name={store.defaultIcon(p)} size={16} />{/if}</span>
                <span class="page-title">{p.title || t('common.untitled')}</span>
                <span class="meta">{relativeTime(p.updatedAt)}</span>
              </button>
            {:else}
              <EmptyState compact icon="note" title={t('sheets.courseView.noNotes')} text={t('planner.project.noNotesText')} />
            {/each}
          </div>
        </section>
      </div>
    </div>
  </div>
{:else}
  <div class="view">
    <EmptyState icon="flag" title={t('planner.project.gone')} text={t('planner.project.goneText')} />
  </div>
{/if}

<style>
  .progress {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 360px;
    margin-top: 10px;
  }
  .progress-text {
    font-size: var(--fs-footnote);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .project-dot {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin: 0 12px 4px 2px;
    border-radius: 50%;
    background: var(--c);
    vertical-align: middle;
  }
  .col > section + section {
    margin-top: 24px;
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    gap: 0 32px;
    align-items: start;
  }
  .see-all {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: var(--h-xs);
    padding: 0 6px 0 8px;
    margin-right: -6px;
    border-radius: var(--r-xs);
    font-size: var(--fs-footnote);
    font-weight: var(--fw-500);
    color: var(--text-3);
    transition:
      background-color var(--dur-fast) var(--ease),
      color var(--dur-fast) var(--ease);
  }
  .see-all:hover {
    background: var(--fill);
    color: var(--text);
  }
  .count {
    font-weight: var(--fw-500);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .detail {
    justify-content: flex-start;
    gap: 12px;
  }
  .detail-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    color: var(--text-3);
  }
  .detail-label {
    flex: none;
    display: flex;
    flex-direction: column;
    width: 96px;
    font-size: var(--fs-body-ui);
    font-weight: var(--fw-500);
    color: var(--text);
  }
  .deadline-state {
    font-size: var(--fs-footnote);
    font-weight: var(--fw-400);
    color: var(--text-3);
  }
  .deadline-state.late {
    color: var(--c-red);
  }
  .detail .field,
  .detail .picker {
    flex: 1;
  }
  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--dot);
  }
  .muted {
    color: var(--text-3);
  }

  .link-row {
    width: 100%;
    justify-content: flex-start;
    gap: 12px;
    text-align: left;
    transition: background-color var(--dur-fast) var(--ease);
  }
  .link-row:hover {
    background: var(--fill);
  }
  .group > .link-row:first-child {
    border-top-left-radius: var(--r-md);
    border-top-right-radius: var(--r-md);
  }
  .group > .link-row:last-child {
    border-bottom-left-radius: var(--r-md);
    border-bottom-right-radius: var(--r-md);
  }
  .page-icon {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    font-size: 16px;
    color: var(--text-3);
  }
  .page-title {
    flex: 1;
    min-width: 0;
    font-size: var(--fs-body-ui);
    font-weight: var(--fw-500);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .meta {
    flex: none;
    font-size: var(--fs-footnote);
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }

  /* One column when the pane is narrow (pane-size.ts). */
  :global([data-below-720]) .columns {
    grid-template-columns: minmax(0, 1fr);
  }
  :global([data-below-720]) .columns > .col + .col {
    margin-top: 24px;
  }
</style>
