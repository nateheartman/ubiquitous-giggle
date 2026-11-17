<script lang="ts">
  /** Settings → Meetings: which speech model, the language, what to record by default, the models on disk, the summary model and meeting types. */
  import { onMount } from 'svelte';
  import Switch from './Switch.svelte';
  import MeetingTypes from './MeetingTypes.svelte';
  import { LANGUAGES, meeting, type Quality, type Sensitivity } from '../meeting.svelte';
  import { i18n, t } from '../i18n';
  import { formatBytes } from '../time';
  import { fmt } from '../i18n/format';
  import { ui } from '../ui.svelte';

  onMount(() => void meeting.refreshModels());

  const QUALITIES: { id: Quality; name: () => string }[] = [
    { id: 'fast', name: () => t('settings.meetings.model.fast') },
    { id: 'balanced', name: () => t('settings.meetings.model.balanced') },
    { id: 'best', name: () => t('settings.meetings.model.best') },
  ];

  const names = $derived.by(() => {
    try {
      return new Intl.DisplayNames([i18n.locale], { type: 'language' });
    } catch {
      return null;
    }
  });
  const languages = $derived(
    LANGUAGES.map((code) => ({ code, label: names?.of(code) ?? code })).sort((a, b) => a.label.localeCompare(b.label, i18n.locale)),
  );

  const m = $derived(meeting.models);
  const sizeOf = (id: string) => m?.whisper.find((x) => x.id === id);

  function set<K extends keyof typeof meeting.settings>(key: K, value: (typeof meeting.settings)[K]) {
    meeting.settings[key] = value;
    meeting.save();
  }

  async function removeSummary() {
    const ok = await ui.confirm({
      title: t('settings.meetings.summary.confirmTitle'),
      message: t('settings.meetings.summary.confirmMessage'),
      confirmLabel: t('settings.meetings.summary.confirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await meeting.deleteSummaryModel();
    } catch (e) {
      ui.error(e);
    }
  }

  async function remove() {
    const ok = await ui.confirm({
      title: t('settings.meetings.disk.confirmTitle'),
      message: t('settings.meetings.disk.confirmMessage'),
      confirmLabel: t('settings.meetings.disk.confirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      await meeting.deleteModels();
    } catch (e) {
      ui.error(e);
    }
  }
</script>

<div class="group">
  <div class="group-row">
    <div class="row-label">
      {t('settings.meetings.model.label')}
      <small>{t('settings.meetings.model.hint')}</small>
    </div>
    <div class="field sel">
      <select value={meeting.settings.model} aria-label={t('settings.meetings.model.label')} onchange={(e) => set('model', e.currentTarget.value as Quality)}>
        {#each QUALITIES as q (q.id)}
          {@const info = sizeOf(q.id)}
          <option value={q.id}>{t('settings.meetings.model.detail', { name: q.name(), size: info ? formatBytes(info.size) : '' })}{info?.present ? ` · ${t('settings.meetings.model.downloaded')}` : ''}{q.id === 'fast' ? ` · ${t('settings.meetings.model.englishOnly')}` : ''}</option>
        {/each}
      </select>
    </div>
  </div>
  <div class="group-row">
    <div class="row-label">
      {t('settings.meetings.language.label')}
      <small>{t('settings.meetings.language.hint')}</small>
    </div>
    <div class="field sel">
      <select value={meeting.settings.language} aria-label={t('settings.meetings.language.label')} onchange={(e) => set('language', e.currentTarget.value)}>
        <option value="auto">{t('settings.meetings.language.auto')}</option>
        {#each languages as l (l.code)}<option value={l.code}>{l.label}</option>{/each}
      </select>
    </div>
  </div>
  <div class="group-row">
    <div class="row-label">
      {t('settings.meetings.sources.label')}
      <small>{t('settings.meetings.sources.hint')}</small>
    </div>
    <div class="switches">
      <label class="sw"><Switch on={meeting.settings.mic} label={t('blocks.meeting.sources.mic')} onchange={() => set('mic', !meeting.settings.mic)} />{t('blocks.meeting.sources.mic')}</label>
      <label class="sw"><Switch on={meeting.settings.system} label={t('blocks.meeting.sources.system')} onchange={() => set('system', !meeting.settings.system)} />{t('blocks.meeting.sources.system')}</label>
    </div>
  </div>
  <div class="group-row">
    <div class="row-label">
      {t('settings.meetings.sensitivity.label')}
      <small>{t('settings.meetings.sensitivity.hint')}</small>
    </div>
    <div class="field sel">
      <select value={meeting.settings.sensitivity} aria-label={t('settings.meetings.sensitivity.label')} onchange={(e) => set('sensitivity', e.currentTarget.value as Sensitivity)}>
        <option value="fewer">{t('settings.meetings.sensitivity.fewer')}</option>
        <option value="balanced">{t('settings.meetings.sensitivity.balanced')}</option>
        <option value="more">{t('settings.meetings.sensitivity.more')}</option>
      </select>
    </div>
  </div>
  <div class="group-row">
    <div class="row-label">
      {t('settings.meetings.disk.label')}
      <small>{m && m.diskBytes > 0 ? t('settings.meetings.disk.used', { size: formatBytes(m.diskBytes) }) : t('settings.meetings.disk.none')}</small>
    </div>
    <button class="btn small raised" disabled={!m || m.diskBytes === 0} onclick={() => void remove()}>{t('settings.meetings.disk.delete')}</button>
  </div>
</div>
<p class="group-note">{t('settings.meetings.local')}</p>

<h3 class="group-title">{t('settings.meetings.summary.title')}</h3>
<div class="group">
  <div class="group-row">
    <div class="row-label">
      {t('settings.meetings.summary.label')}
      <small>{m?.summary.present ? t('settings.meetings.summary.present', { size: fmt.bytes(m.summary.size) }) : t('settings.meetings.summary.missing', { size: fmt.bytes(m?.summary.size ?? 0) })}</small>
    </div>
    {#if m?.summary.present}
      <button class="btn small raised" onclick={() => void removeSummary()}>{t('settings.meetings.summary.delete')}</button>
    {:else}
      <button class="btn small raised" disabled={!m} onclick={() => void meeting.ensureSummaryModel()}>{t('blocks.meeting.summary.download')}</button>
    {/if}
  </div>
</div>

<h3 class="group-title">{t('settings.meetings.types.title')}</h3>
<MeetingTypes />

<style>
  .sel {
    width: 250px;
    flex: none;
  }
  .switches {
    display: flex;
    gap: 16px;
  }
  .sw {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--text-2);
  }
</style>
