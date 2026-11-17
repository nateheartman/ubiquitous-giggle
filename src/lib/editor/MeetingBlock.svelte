<script lang="ts">
  /**
   * A meeting inside a page: record it, then read who said what. The
   * recording runs in Rust (see meeting.svelte.ts), so this block can come
   * and go while it goes on; it finds its recording again by id.
   */
  import { onMount, untrack } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import Switch from '../ui/Switch.svelte';
  import MeetingSummary from './MeetingSummary.svelte';
  import { fileUrl } from '../api';
  import { t } from '../i18n';
  import { fmt } from '../i18n/format';
  import { library } from '../library.svelte';
  import { meeting } from '../meeting.svelte';
  import { clock, speakerKeys, speakerName, transcriptText, type BlockProps, type MeetingTurn } from '../meeting-text';
  import { ui } from '../ui.svelte';

  let { p }: { p: BlockProps } = $props();

  const attrs = $derived(p.attrs);
  const status = $derived(attrs.recId ? meeting.statuses[attrs.recId] : undefined);
  const levels = $derived(attrs.recId ? meeting.levels[attrs.recId] : undefined);
  const hasTranscript = $derived(attrs.turns.length > 0 || !!attrs.fileId);
  /** What to show: the finished transcript wins over everything. */
  const mode = $derived.by(() => {
    if (hasTranscript) return 'done';
    if (!attrs.recId) return 'idle';
    switch (status?.state) {
      case 'recording':
      case 'paused':
        return 'recording';
      case 'processing':
        return 'processing';
      case 'recorded':
        return 'recorded';
      case 'failed':
        return 'failed';
      case 'done':
        return 'processing'; // the result is being put into the note just now
      default:
        return 'checking';
    }
  });
  const file = $derived(attrs.fileId ? library.byId.get(attrs.fileId) : undefined);
  const busy = $derived(mode === 'recording' || mode === 'processing');

  // ---- coming back to a recording that went on without this block

  let applying = false;
  async function apply(id: string) {
    const r = meeting.statuses[id]?.result;
    if (!r || applying) return;
    applying = true;
    p.update({ recId: null, fileId: r.fileId, durationMs: r.durationMs, turns: r.turns, language: r.language, names: attrs.names });
    // The transcript just arrived on this Mac: write its summary if the model is here.
    if (meeting.summaryReady() && !attrs.summary) {
      tab = 'summary';
      autoSummary = true;
    }
    // The library has a new file (Rust stored the audio); the Files view should know.
    void library.load();
    await meeting.ack(id).catch(() => {});
    applying = false;
  }

  onMount(() => {
    const id = attrs.recId;
    if (!id || hasTranscript) return;
    void meeting.refresh(id).then((s) => {
      // A recording that no longer exists (the app's data was cleared): back to the start.
      if (!s) p.update({ recId: null });
    });
  });

  $effect(() => {
    const id = attrs.recId;
    if (id && status?.state === 'done' && status.result && !hasTranscript) void apply(id);
  });

  // ---- Summary | Transcript

  // Opens on the summary when there is one (the choice then stays the reader's).
  let tab = $state<'summary' | 'transcript'>(untrack(() => (p.attrs.summary ? 'summary' : 'transcript')));
  let autoSummary = $state(false);

  // ---- the controls

  let starting = $state(false);
  async function record() {
    if (starting || !p.editable) return;
    starting = true;
    try {
      const id = await meeting.start({ mic: attrs.mic, system: attrs.system }, p.pageId);
      if (id) p.update({ recId: id, title: attrs.title || '' });
    } catch (e) {
      ui.error(e);
    } finally {
      starting = false;
    }
  }

  const act = (fn: () => Promise<unknown>) => () => void fn().catch(ui.error);
  const pauseOrResume = act(() => meeting.pause(attrs.recId!, status?.state !== 'paused'));
  const stop = act(() => meeting.stop(attrs.recId!, attrs.title));
  const retry = act(() => meeting.process(attrs.recId!, attrs.title));
  const discard = act(async () => {
    await meeting.discard(attrs.recId!);
    p.update({ recId: null });
  });

  // ---- the level meters

  /** A level (0..1 amplitude) as a share of the bar: 60 dB of range, so quiet speech still moves it. */
  function bar(level: number | undefined): number {
    if (!level || level <= 0) return 0;
    return Math.max(0, Math.min(1, (20 * Math.log10(level) + 60) / 60));
  }

  // ---- the result

  let audio = $state<HTMLAudioElement | null>(null);
  let now = $state(0);

  function seek(turn: MeetingTurn) {
    if (!audio) return;
    audio.currentTime = turn.s / 1000;
    void audio.play().catch(() => {});
  }

  const activeTurn = $derived(attrs.turns.findIndex((x, i) => now * 1000 >= x.s && (i === attrs.turns.length - 1 || now * 1000 < attrs.turns[i + 1].s)));
  const keys = $derived(speakerKeys(attrs.turns));

  let renaming = $state<{ sp: string; value: string } | null>(null);
  function commitName() {
    if (!renaming) return;
    const names = { ...attrs.names };
    const v = renaming.value.trim();
    if (v) names[renaming.sp] = v;
    else delete names[renaming.sp];
    renaming = null;
    p.update({ names });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(transcriptText(attrs.turns, attrs.names));
      ui.toast(t('blocks.meeting.copied'));
    } catch (e) {
      ui.error(e);
    }
  }

  let rerunOpen = $state(false);
  let rerunCount = $state('');
  let rerunning = $state(false);
  /** Progress of a re-run arrives under the audio file's id. */
  const rerunPct = $derived(attrs.fileId ? (meeting.statuses[attrs.fileId]?.pct ?? 0) : 0);
  async function rerun() {
    if (!attrs.fileId || rerunning) return;
    const n = Number.parseInt(rerunCount, 10);
    const key = attrs.fileId;
    rerunOpen = false;
    if (!(await meeting.ensureModels())) return;
    rerunning = true;
    try {
      const turns = await meeting.rediarize(key, key, $state.snapshot(attrs.turns), n > 0 ? n : null);
      // Names belong to a speaker's number, which may now mean someone else.
      p.update({ turns, names: Object.fromEntries(Object.entries(attrs.names).filter(([k]) => k === 'me')) });
    } catch (e) {
      ui.error(e);
    } finally {
      delete meeting.statuses[key];
      rerunning = false;
    }
  }

  async function removeRecording() {
    const ok = await ui.confirm({ title: t('blocks.meeting.deleteConfirmTitle'), message: t('blocks.meeting.deleteConfirmMessage'), confirmLabel: t('blocks.meeting.deleteConfirm'), danger: true });
    if (!ok) return;
    const id = attrs.fileId;
    p.update({ fileId: null, turns: [], names: {}, durationMs: 0, language: '', recId: null, summary: null });
    if (id && library.byId.get(id) && !library.byId.get(id)!.deletedAt) await library.trash(id).catch(() => {});
  }

  const stageText = $derived.by(() => {
    switch (status?.stage) {
      case 'transcribing':
        return t('blocks.meeting.stage.transcribing', { percent: fmt.number(status.pct ?? 0) });
      case 'speakers':
        return t('blocks.meeting.stage.speakers');
      case 'saving':
        return t('blocks.meeting.stage.saving');
      default:
        return t('blocks.meeting.stage.mixing');
    }
  });
  const stagePct = $derived(status?.stage === 'transcribing' ? (status.pct ?? 0) : status?.stage === 'speakers' ? (status.pct ?? 0) : status?.stage === 'saving' ? 100 : 0);

  const notices = $derived.by(() => {
    const out: { text: string; button?: { label: string; run: () => void } }[] = [];
    for (const n of status?.notices ?? []) {
      if (n.code === 'screenDenied')
        out.push({ text: t('blocks.meeting.notice.screenDenied'), button: { label: t('blocks.meeting.notice.screenSettings'), run: () => meeting.openPrivacy('screen') } });
      else if (n.code === 'systemFailed') out.push({ text: t('blocks.meeting.notice.systemFailed', { reason: n.detail }) });
      else if (n.code === 'micFailed') out.push({ text: t('blocks.meeting.notice.micFailed', { reason: n.detail }), button: { label: t('blocks.meeting.notice.micSettings'), run: () => meeting.openPrivacy('microphone') } });
    }
    if (levels?.micSilent) out.push({ text: t('blocks.meeting.notice.micSilent'), button: { label: t('blocks.meeting.notice.micSettings'), run: () => meeting.openPrivacy('microphone') } });
    return out;
  });
</script>

<div class="meeting" data-mode={mode}>
  <header class="head">
    <span class="glyph" class:live={mode === 'recording'} aria-hidden="true"><Icon name="users" size={17} /></span>
    <input
      class="title"
      value={attrs.title}
      placeholder={t('blocks.meeting.titleLabel')}
      aria-label={t('blocks.meeting.titleLabel')}
      readonly={!p.editable}
      oninput={(e) => p.update({ title: e.currentTarget.value })}
      onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
    />
    {#if mode === 'recording'}
      <span class="badge live"><span class="dot"></span>{status?.state === 'paused' ? t('blocks.meeting.paused') : t('blocks.meeting.recording')}</span>
    {/if}
  </header>

  {#if mode === 'idle'}
    <div class="row">
      <div class="sources" role="group" aria-label={t('blocks.meeting.sources.label')}>
        <label class="source"><Switch on={attrs.mic} label={t('blocks.meeting.sources.mic')} onchange={() => p.editable && p.update({ mic: !attrs.mic })} />{t('blocks.meeting.sources.mic')}</label>
        <label class="source"><Switch on={attrs.system} label={t('blocks.meeting.sources.system')} onchange={() => p.editable && p.update({ system: !attrs.system })} />{t('blocks.meeting.sources.system')}</label>
      </div>
      <button class="btn primary record" disabled={!p.editable || starting || (!attrs.mic && !attrs.system)} onclick={record}>
        <span class="rec-dot" aria-hidden="true"></span>{t('blocks.meeting.record')}
      </button>
    </div>
  {:else if mode === 'recording'}
    <div class="row">
      <span class="timer" aria-live="off">{clock(levels?.elapsedMs ?? status?.durationMs ?? 0)}</span>
      <div class="meters">
        {#if status?.mic}
          <div class="meter" role="meter" aria-label={t('blocks.meeting.sources.micLevel')} aria-valuemin={0} aria-valuemax={1} aria-valuenow={bar(levels?.mic)}>
            <span class="meter-name">{t('blocks.meeting.sources.mic')}</span>
            <span class="track"><span class="fill" style:width="{bar(levels?.mic) * 100}%"></span></span>
          </div>
        {/if}
        {#if status?.system}
          <div class="meter" role="meter" aria-label={t('blocks.meeting.sources.systemLevel')} aria-valuemin={0} aria-valuemax={1} aria-valuenow={bar(levels?.system)}>
            <span class="meter-name">{t('blocks.meeting.sources.system')}</span>
            <span class="track"><span class="fill" style:width="{bar(levels?.system) * 100}%"></span></span>
          </div>
        {/if}
      </div>
      <button class="btn raised" onclick={pauseOrResume}>
        {#if status?.state === 'paused'}<Icon name="chevron-right" size={13} stroke={2.4} />{t('blocks.meeting.resume')}{:else}<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1.2" /><rect x="14" y="4" width="5" height="16" rx="1.2" /></svg>{t('blocks.meeting.pause')}{/if}
      </button>
      <button class="btn primary" onclick={stop}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2.5" /></svg>{t('blocks.meeting.stop')}
      </button>
    </div>
  {:else if mode === 'processing'}
    <div class="row">
      <div class="progress">
        <span class="stage" role="status">{stageText}</span>
        <span class="track wide"><span class="fill solid" style:width="{stagePct}%"></span></span>
      </div>
      <button class="btn raised" onclick={() => attrs.recId && meeting.cancel(attrs.recId)}>{t('blocks.meeting.cancel')}</button>
    </div>
  {:else if mode === 'recorded' || mode === 'failed'}
    <div class="problem">
      <strong>{mode === 'failed' ? t('blocks.meeting.failed') : t('blocks.meeting.interrupted')}</strong>
      <span>{mode === 'failed' ? (status?.error ?? '') : t('blocks.meeting.interruptedHint')}</span>
    </div>
    <div class="row end">
      <button class="btn raised" onclick={discard}>{t('blocks.meeting.discard')}</button>
      <button class="btn primary" onclick={retry}>{mode === 'failed' ? t('blocks.meeting.retry') : t('blocks.meeting.process')}</button>
    </div>
  {:else if mode === 'checking'}
    <div class="row"><span class="stage">{t('common.loading')}</span></div>
  {:else}
    {#if file && !file.deletedAt && !file.missing}
      <audio bind:this={audio} class="player" controls preload="metadata" src={fileUrl(file.stored)} aria-label={t('blocks.meeting.player')} ontimeupdate={(e) => (now = e.currentTarget.currentTime)}></audio>
    {:else if attrs.fileId && library.loaded}
      <p class="note">{t('blocks.meeting.audioMissing')}</p>
    {/if}

    <div class="tabs" role="tablist" aria-label={t('blocks.meeting.tabs.label')}>
      <button role="tab" class="tab" aria-selected={tab === 'summary'} tabindex={tab === 'summary' ? 0 : -1} onclick={() => (tab = 'summary')}>{t('blocks.meeting.tabs.summary')}</button>
      <button role="tab" class="tab" aria-selected={tab === 'transcript'} tabindex={tab === 'transcript' ? 0 : -1} onclick={() => (tab = 'transcript')}>{t('blocks.meeting.tabs.transcript')}</button>
    </div>

    <MeetingSummary {p} visible={tab === 'summary'} auto={autoSummary} onautodone={() => (autoSummary = false)} />

    {#if tab === 'transcript'}
    {#if keys.length}
      <div class="chips" role="group" aria-label={t('blocks.meeting.speakers')}>
        {#each keys as sp (sp)}
          {#if renaming?.sp === sp}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="chip-input"
              aria-label={t('blocks.meeting.speakerName')}
              bind:value={renaming.value}
              autofocus
              onblur={commitName}
              onkeydown={(e) => {
                if (e.key === 'Enter') commitName();
                else if (e.key === 'Escape') renaming = null;
              }}
            />
          {:else}
            <button
              class="chip"
              data-speaker={sp}
              data-tone={sp === 'me' ? 'me' : Number(sp) % 6}
              disabled={!p.editable}
              data-tip={t('blocks.meeting.renameSpeaker', { name: speakerName(sp, attrs.names) })}
              onclick={() => (renaming = { sp, value: attrs.names[sp] ?? speakerName(sp, attrs.names) })}
            >{speakerName(sp, attrs.names)}</button>
          {/if}
        {/each}
      </div>
    {/if}

    <div class="turns">
      {#each attrs.turns as turn, i (i)}
        <div class="turn" class:active={i === activeTurn} data-speaker={turn.sp}>
          <span class="who" data-tone={turn.sp === 'me' ? 'me' : Number(turn.sp) % 6}>{speakerName(turn.sp, attrs.names)}</span>
          <button class="time" onclick={() => seek(turn)} data-tip={t('blocks.meeting.seek', { time: clock(turn.s) })} aria-label={t('blocks.meeting.seek', { time: clock(turn.s) })}>{clock(turn.s)}</button>
          <span class="said">{turn.t}</span>
        </div>
      {:else}
        <p class="note">{t('blocks.meeting.empty')}</p>
      {/each}
    </div>

    <div class="actions">
      <button class="btn small raised" onclick={copy}><Icon name="copy" size={13} />{t('blocks.meeting.copy')}</button>
      {#if p.editable && attrs.fileId}
        <button class="btn small raised" disabled={rerunning} onclick={() => (rerunOpen = !rerunOpen)} aria-expanded={rerunOpen}>
          {rerunning ? t('blocks.meeting.stage.reidentifying', { percent: fmt.number(rerunPct) }) : t('blocks.meeting.rerun')}
        </button>
        <button class="btn small raised danger" onclick={removeRecording}><Icon name="trash" size={13} />{t('blocks.meeting.delete')}</button>
      {/if}
    </div>
    {#if rerunOpen}
      <div class="rerun">
        <label>
          {t('blocks.meeting.rerunCount')}
          <input type="number" min="1" max="20" inputmode="numeric" placeholder={t('blocks.meeting.rerunAuto')} bind:value={rerunCount} onkeydown={(e) => e.key === 'Enter' && void rerun()} />
        </label>
        <button class="btn small primary" onclick={() => void rerun()}>{t('blocks.meeting.rerunGo')}</button>
      </div>
    {/if}
    {/if}
  {/if}

  {#each notices as n}
    <p class="notice">
      <span>{n.text}</span>
      {#if n.button}<button class="btn small raised" onclick={n.button.run}>{n.button.label}</button>{/if}
    </p>
  {/each}
  {#if busy}<span class="sr" aria-live="polite">{mode === 'processing' ? stageText : ''}</span>{/if}
</div>

<style>
  .tabs {
    display: flex;
    gap: 2px;
    border-bottom: 1px solid var(--separator);
  }
  .tab {
    padding: 6px 10px;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
    background: none;
    color: var(--text-2);
    font: inherit;
    font-weight: var(--fw-600);
    cursor: pointer;
  }
  .tab[aria-selected='true'] {
    color: var(--text);
    border-bottom-color: var(--accent, var(--text));
  }
  .tab:focus-visible {
    outline: 2px solid var(--accent, var(--text));
    outline-offset: -2px;
    border-radius: var(--r-xs);
  }
  .meeting {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin: 6px 0;
    padding: 12px 14px;
    border-radius: var(--r-md);
    background: var(--bg-grouped);
    box-shadow: inset 0 0 0 1px var(--separator);
    font-family: var(--font-ui);
    font-size: var(--fs-ui);
    color: var(--text);
    user-select: text;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .glyph {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: var(--r-sm);
    background: var(--fill-2);
    color: var(--text-2);
  }
  .glyph.live {
    background: color-mix(in srgb, var(--c-red) 16%, transparent);
    color: var(--c-red);
  }
  .title {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: var(--fs-callout);
    font-weight: var(--fw-600);
    color: var(--text);
    background: transparent;
    border: 0;
    outline: 0;
    padding: 4px 6px;
    margin: 0 -6px;
    border-radius: var(--r-xs);
  }
  .title:focus {
    background: var(--fill);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--fs-footnote);
    font-weight: var(--fw-600);
    color: var(--c-red);
  }
  .dot,
  .rec-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--c-red);
  }
  .badge .dot {
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .badge .dot {
      animation: none;
    }
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .row.end {
    justify-content: flex-end;
  }
  .sources {
    display: flex;
    gap: 16px;
    flex: 1;
    flex-wrap: wrap;
  }
  .source {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
  }
  .record {
    gap: 8px;
  }
  .record .rec-dot {
    background: currentColor;
    opacity: 0.9;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .btn.danger {
    color: var(--c-red);
  }
  .timer {
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-callout);
    font-weight: var(--fw-600);
    min-width: 56px;
  }
  .meters {
    flex: 1;
    min-width: 160px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .meter {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .meter-name {
    width: 84px;
    color: var(--text-3);
    font-size: var(--fs-footnote);
  }
  .track {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--fill-3);
    overflow: hidden;
  }
  .track.wide {
    height: 8px;
  }
  .fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--c-green, #34c759), var(--c-green, #34c759) 70%, var(--c-red));
    background-size: 100vw 100%;
    transition: width 90ms linear;
  }
  .fill.solid {
    background: var(--accent);
    transition: width 200ms var(--ease);
  }
  .progress {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .stage {
    color: var(--text-2);
  }
  .problem {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .problem span {
    color: var(--text-2);
  }
  .player {
    width: 100%;
    height: 36px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip,
  .who {
    --tone: var(--text-2);
  }
  [data-tone='me'] {
    --tone: var(--accent);
  }
  [data-tone='0'] {
    --tone: var(--c-blue, #0a84ff);
  }
  [data-tone='1'] {
    --tone: var(--c-green, #34c759);
  }
  [data-tone='2'] {
    --tone: var(--c-orange, #ff9500);
  }
  [data-tone='3'] {
    --tone: var(--c-purple, #af52de);
  }
  [data-tone='4'] {
    --tone: var(--c-pink, #ff2d55);
  }
  [data-tone='5'] {
    --tone: var(--c-teal, #30b0c7);
  }
  .chip {
    padding: 3px 10px;
    border-radius: 999px;
    font: inherit;
    font-size: var(--fs-footnote);
    font-weight: var(--fw-600);
    color: var(--tone);
    background: color-mix(in srgb, var(--tone) 14%, transparent);
    cursor: pointer;
  }
  .chip:disabled {
    cursor: default;
  }
  .chip-input {
    font: inherit;
    font-size: var(--fs-footnote);
    padding: 3px 10px;
    width: 140px;
    border-radius: 999px;
    border: 1px solid var(--separator-strong);
    background: var(--bg);
    color: var(--text);
    outline: 0;
  }
  .turns {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 420px;
    overflow-y: auto;
  }
  .turn {
    display: grid;
    grid-template-columns: 110px 48px 1fr;
    gap: 8px;
    align-items: baseline;
    padding: 5px 6px;
    border-radius: var(--r-xs);
    line-height: 1.45;
  }
  .turn.active {
    background: var(--fill-2);
  }
  .who {
    font-weight: var(--fw-600);
    color: var(--tone);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    font: inherit;
    font-variant-numeric: tabular-nums;
    font-size: var(--fs-footnote);
    color: var(--text-3);
    text-align: left;
    padding: 0;
    cursor: pointer;
  }
  .time:hover {
    color: var(--text);
    text-decoration: underline;
  }
  .said {
    color: var(--text);
    font-family: var(--font-page);
    font-size: var(--fs-body-ui);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .rerun {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-2);
  }
  .rerun label {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .rerun input {
    width: 72px;
    font: inherit;
    padding: 4px 8px;
    border-radius: var(--r-xs);
    border: 1px solid var(--separator-strong);
    background: var(--bg);
    color: var(--text);
  }
  .note {
    margin: 0;
    color: var(--text-3);
  }
  .notice {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0;
    padding: 8px 10px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--c-orange, #ff9500) 14%, transparent);
    color: var(--text);
  }
  .notice span {
    flex: 1;
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
  }
</style>
