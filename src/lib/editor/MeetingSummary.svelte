<script lang="ts">
  /**
   * A meeting's Summary tab: the meeting type, the summary the local model
   * wrote (see meet/summarize.rs), and Summarize / Regenerate. It stays
   * mounted while the Transcript tab shows, so a summary being written goes
   * on; `visible` only hides it. Leaving the page stops a summary being
   * written (its block is gone, so there'd be nowhere to put it).
   */
  import { onDestroy, onMount, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { t } from '../i18n';
  import { fmt } from '../i18n/format';
  import { meeting, typeDefaults } from '../meeting.svelte';
  import { parseSummary } from '../meeting-summary';
  import { summaryLines, type BlockProps } from '../meeting-text';
  import { resolveType } from '../meeting-types';
  import { ui } from '../ui.svelte';

  let { p, visible, auto = false, onautodone }: { p: BlockProps; visible: boolean; auto?: boolean; onautodone?: () => void } = $props();

  const MODEL = 'qwen3.5-4b-q4_k_m';
  const block = crypto.randomUUID();
  const attrs = $derived(p.attrs);
  const summary = $derived(attrs.summary);
  /** The type the next summary is written as; one this Mac doesn't know comes from the summary's stored copy. */
  const current = $derived(resolveType(attrs.typeId, meeting.types, typeDefaults(), summary?.typeId === attrs.typeId ? summary : null));
  const options = $derived(meeting.typeList.some((x) => x.id === current.id) ? meeting.typeList : [...meeting.typeList, current]);
  const stale = $derived(!!summary && (summary.typeId !== current.id || summary.instructions !== current.instructions));
  const progress = $derived(meeting.summaries[block]);

  let running = $state(false);
  let error = $state<string | null>(null);
  let gone = false;

  const shown = $derived(parseSummary(progress?.state === 'writing' && progress.text ? progress.text : (summary?.md ?? '')));

  async function write() {
    if (running || !p.editable || !attrs.turns.length) return;
    error = null;
    if (!(await meeting.ensureSummaryModel())) return;
    running = true;
    const type = current;
    try {
      const md = await meeting.summarize(block, { title: attrs.title, lines: summaryLines(attrs.turns, attrs.names), instructions: type.instructions });
      if (!gone) p.update({ summary: { md, typeId: type.id, typeName: type.name, instructions: type.instructions, at: Date.now(), model: MODEL } });
    } catch (e) {
      if (String(e) !== 'cancelled' && !gone) error = String(e);
    } finally {
      running = false;
    }
  }

  // Written once, when the transcript has just arrived on the Mac that recorded it.
  $effect(() => {
    if (!auto) return;
    untrack(() => {
      onautodone?.();
      if (!summary && meeting.summaryReady()) void write();
    });
  });

  onMount(() => {
    if (!meeting.models) void meeting.refreshModels();
  });

  onDestroy(() => {
    gone = true;
    if (running) meeting.cancelSummary(block);
  });

  function chooseType(id: string) {
    if (id === '__edit') {
      ui.settingsSection = 'meetings';
      ui.settingsOpen = true;
      return;
    }
    p.update({ typeId: id });
  }

  async function copy() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary.md);
      ui.toast(t('blocks.meeting.summary.copied'));
    } catch (e) {
      ui.error(e);
    }
  }

  async function download() {
    await meeting.ensureSummaryModel();
  }
</script>

{#if visible}
  <div class="summary" role="tabpanel">
    <div class="bar">
      <label class="type">
        <span>{t('blocks.meeting.summary.type')}</span>
        <select value={current.id} disabled={!p.editable || running} aria-label={t('blocks.meeting.summary.type')} onchange={(e) => chooseType(e.currentTarget.value)}>
          {#each options as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
          <option value="__edit">{t('blocks.meeting.summary.editTypes')}</option>
        </select>
      </label>
      <span class="spacer"></span>
      {#if running}
        <button class="btn small raised" onclick={() => meeting.cancelSummary(block)}>{t('blocks.meeting.summary.cancel')}</button>
      {:else if meeting.summaryReady()}
        {#if p.editable && attrs.turns.length}
          <button class="btn small {summary ? 'raised' : 'primary'}" onclick={() => void write()}>
            <Icon name="restore" size={13} />{summary ? t('blocks.meeting.summary.regenerate') : t('blocks.meeting.summary.summarize')}
          </button>
        {/if}
        {#if summary}<button class="btn small raised" onclick={copy}><Icon name="copy" size={13} />{t('blocks.meeting.summary.copy')}</button>{/if}
      {/if}
    </div>

    {#if stale && !running}
      <p class="hint">{t('blocks.meeting.summary.stale', { type: summary?.typeName ?? '' })}</p>
    {/if}

    {#if running}
      <p class="stage" role="status">{progress?.state === 'waiting' ? t('blocks.meeting.summary.waiting') : t('blocks.meeting.summary.writing')}</p>
    {:else if error}
      <div class="problem">
        <strong>{t('blocks.meeting.summary.failed')}</strong>
        <span>{error}</span>
        <button class="btn small primary" onclick={() => void write()}>{t('blocks.meeting.summary.retry')}</button>
      </div>
    {:else if !summary && !meeting.summaryReady() && meeting.models}
      <div class="empty">
        <strong>{t('blocks.meeting.summary.noModel')}</strong>
        <span>{t('blocks.meeting.summary.noModelHint', { size: fmt.bytes(meeting.models.summary.size) })}</span>
        {#if p.editable}<button class="btn small primary" onclick={() => void download()}>{t('blocks.meeting.summary.download')}</button>{/if}
      </div>
    {:else if !summary}
      <p class="note">{t('blocks.meeting.summary.none')}</p>
    {/if}

    {#if shown.length && (summary || running)}
      <div class="summary-body" class:live={running}>
        {#each shown as b, i (i)}
          {#if b.kind === 'heading'}
            <h4>{#each b.parts as part, j (j)}{#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}</h4>
          {:else if b.kind === 'para'}
            <p>{#each b.parts as part, j (j)}{#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}</p>
          {:else if b.kind === 'list'}
            <ul>
              {#each b.items as item, k (k)}
                <li>{#each item as part, j (j)}{#if part.bold}<strong>{part.text}</strong>{:else}{part.text}{/if}{/each}</li>
              {/each}
            </ul>
          {/if}
        {/each}
      </div>
    {/if}
    {#if summary && !running}
      <p class="footer">{t('blocks.meeting.summary.footer', { type: summary.typeName, time: fmt.dateTime(summary.at) })}</p>
    {/if}
  </div>
{/if}

<style>
  .summary {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .type {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
    font-size: var(--fs-footnote);
  }
  .type select {
    min-width: 150px;
  }
  .spacer {
    flex: 1;
  }
  .hint,
  .note,
  .stage,
  .footer {
    margin: 0;
    color: var(--text-2);
    font-size: var(--fs-footnote);
  }
  .footer {
    color: var(--text-3);
  }
  .problem,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 12px;
    border-radius: var(--r-sm);
    background: var(--fill-2);
    color: var(--text-2);
  }
  .problem strong,
  .empty strong {
    color: var(--text);
  }
  .summary-body {
    color: var(--text);
    line-height: 1.5;
    user-select: text;
  }
  .summary-body.live {
    opacity: 0.85;
  }
  .summary-body h4 {
    margin: 12px 0 4px;
    font-size: var(--fs-callout);
    font-weight: var(--fw-600);
  }
  .summary-body h4:first-child {
    margin-top: 0;
  }
  .summary-body p {
    margin: 0 0 6px;
  }
  .summary-body ul {
    margin: 0 0 6px;
    padding-left: 20px;
  }
  .summary-body strong {
    font-weight: var(--fw-600);
  }
</style>
