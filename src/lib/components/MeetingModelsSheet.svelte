<script lang="ts">
  /**
   * The one place `/meet` goes online: explains what's about to be downloaded
   * (once, from the model publishers), then does it with a Cancel. After
   * that everything runs on this Mac.
   */
  import Modal from './Modal.svelte';
  import { meeting, type Quality } from '../meeting.svelte';
  import { t } from '../i18n';
  import { fmt } from '../i18n/format';
  import { formatBytes } from '../time';

  const NAMES: Record<Quality, () => string> = {
    fast: () => t('settings.meetings.model.fast'),
    balanced: () => t('settings.meetings.model.balanced'),
    best: () => t('settings.meetings.model.best'),
  };

  const m = $derived(meeting.models);
  const speech = $derived(m?.whisper.find((x) => x.id === meeting.settings.model));
  const speakers = $derived(m?.speakers ?? []);
  const forSummary = $derived(meeting.sheet?.kind === 'summary');
  const total = $derived(forSummary ? (m?.summary.present ? 0 : (m?.summary.size ?? 0)) : meeting.missingBytes());
  const size = (n: number) => (forSummary ? fmt.bytes(n) : formatBytes(n));
  const title = $derived(forSummary ? t('blocks.meeting.models.summaryTitle') : t('blocks.meeting.models.title'));
  const d = $derived(meeting.download);
  const pct = $derived(d.progress && d.progress.total ? Math.min(100, Math.floor((d.progress.done / d.progress.total) * 100)) : 0);

  function close() {
    if (d.running) meeting.cancelDownload();
    meeting.closeSheet(false);
  }
</script>

<Modal onclose={close} width={480} label={title}>
  <div class="sheet">
    <h2>{title}</h2>
    <p class="lead">{forSummary ? t('blocks.meeting.models.summaryBody') : t('blocks.meeting.models.body')}</p>
    <ul class="list">
      {#if forSummary}
        <li>
          <span>{t('blocks.meeting.models.summaryModel')}</span>
          <span class="size">{m?.summary.present ? t('settings.meetings.model.downloaded') : fmt.bytes(m?.summary.size ?? 0)}</span>
        </li>
      {:else if speech}
        <li>
          <span>{t('blocks.meeting.models.speechModel', { name: NAMES[meeting.settings.model]() })}</span>
          <span class="size">{speech.present ? t('settings.meetings.model.downloaded') : formatBytes(speech.size)}</span>
        </li>
      {/if}
      {#if !forSummary}<li>
        <span>{t('blocks.meeting.models.speakerModels')}</span>
        <span class="size">{speakers.every((x) => x.present) ? t('settings.meetings.model.downloaded') : formatBytes(speakers.reduce((n, x) => n + (x.present ? 0 : x.size), 0))}</span>
      </li>{/if}
    </ul>
    <p class="total">{t('blocks.meeting.models.total', { size: size(total) })}</p>

    {#if d.running}
      <div class="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><span style:width="{pct}%"></span></div>
      <p class="status" role="status">
        {#if d.progress?.stage === 'checking'}{t('blocks.meeting.models.checking')}
        {:else if d.progress?.stage === 'unpacking'}{t('blocks.meeting.models.unpacking')}
        {:else}{t('blocks.meeting.models.downloading', { percent: fmt.number(pct) })}{/if}
      </p>
    {:else if d.error}
      <p class="error" role="alert">{t('blocks.meeting.models.failed', { reason: d.error })}</p>
    {/if}

    <div class="buttons">
      <button class="btn raised" onclick={close}>{t('common.actions.cancel')}</button>
      {#if !d.running}
        <button class="btn primary" onclick={() => void meeting.startDownload()}>{d.error ? t('blocks.meeting.models.retry') : t('blocks.meeting.models.download')}</button>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .sheet {
    padding: 22px 24px 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  h2 {
    margin: 0;
    font-size: var(--fs-callout);
    font-weight: var(--fw-650);
  }
  .lead {
    margin: 0;
    color: var(--text-2);
    line-height: 1.5;
  }
  .list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    border-radius: var(--r-md);
    background: var(--bg-grouped);
    box-shadow: inset 0 0 0 1px var(--separator);
  }
  .list li {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
  }
  .list li + li {
    border-top: 1px solid var(--separator);
  }
  .size {
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .total {
    margin: 0;
    color: var(--text-3);
    text-align: right;
  }
  .bar {
    height: 8px;
    border-radius: 4px;
    background: var(--fill-3);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 150ms linear;
  }
  .status {
    margin: 0;
    color: var(--text-2);
  }
  .error {
    margin: 0;
    color: var(--c-red);
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
