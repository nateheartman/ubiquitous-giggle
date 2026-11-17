<script lang="ts">
  /**
   * Settings → Meetings → Meeting types: what tells the summarizer how to
   * write a meeting's summary. Built-ins keep their names but their
   * instructions can be changed (and reset); the user's own types can be
   * added, renamed and deleted. Kept on this Mac (meeting.svelte.ts).
   */
  import { meeting } from '../meeting.svelte';
  import { addCustom, deleteCustom, resetBuiltin, updateType, type BuiltinId, type TypesData } from '../meeting-types';
  import { t } from '../i18n';
  import { ui } from '../ui.svelte';

  let selected = $state('general');
  const chosen = $derived(meeting.typeList.find((x) => x.id === selected) ?? meeting.typeList[0]);

  function change(next: TypesData) {
    meeting.types = next;
    meeting.saveTypes();
  }

  function add() {
    const before = new Set(meeting.types.custom.map((c) => c.id));
    change(addCustom(meeting.types, t('settings.meetings.types.newName'), ''));
    selected = meeting.types.custom.find((c) => !before.has(c.id))?.id ?? selected;
  }

  async function remove() {
    const ok = await ui.confirm({
      title: t('settings.meetings.types.deleteTitle', { name: chosen.name }),
      message: t('settings.meetings.types.deleteMessage'),
      confirmLabel: t('settings.meetings.types.deleteConfirm'),
      danger: true,
    });
    if (!ok) return;
    change(deleteCustom(meeting.types, chosen.id));
    selected = 'general';
  }
</script>

<div class="group types">
  <div class="list" role="group" aria-label={t('settings.meetings.types.label')}>
    {#each meeting.typeList as type (type.id)}
      <button class="item" class:on={type.id === chosen.id} aria-pressed={type.id === chosen.id} onclick={() => (selected = type.id)}>{type.name || t('settings.meetings.types.untitled')}</button>
    {/each}
    <button class="btn small raised add" onclick={add}>{t('settings.meetings.types.add')}</button>
  </div>
  <div class="editor">
    {#if !chosen.builtin}
      <label class="field-label">
        {t('settings.meetings.types.name')}
        <input class="input" value={chosen.name} aria-label={t('settings.meetings.types.name')} oninput={(e) => change(updateType(meeting.types, chosen.id, { name: e.currentTarget.value }))} />
      </label>
    {/if}
    <label class="field-label">
      {t('settings.meetings.types.instructions')}
      <textarea
        class="input"
        rows="9"
        value={chosen.instructions}
        aria-label={t('settings.meetings.types.instructions')}
        placeholder={t('settings.meetings.types.placeholder')}
        oninput={(e) => change(updateType(meeting.types, chosen.id, { instructions: e.currentTarget.value }))}
      ></textarea>
    </label>
    <div class="buttons">
      {#if chosen.builtin && chosen.edited}
        <button class="btn small raised" onclick={() => change(resetBuiltin(meeting.types, chosen.id as BuiltinId))}>{t('settings.meetings.types.reset')}</button>
      {/if}
      {#if !chosen.builtin}
        <button class="btn small raised danger" onclick={() => void remove()}>{t('settings.meetings.types.delete')}</button>
      {/if}
    </div>
  </div>
</div>
<p class="group-note">{t('settings.meetings.types.hint')}</p>

<style>
  .types {
    display: flex;
    gap: 16px;
    padding: 12px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 170px;
    flex: none;
  }
  .item {
    text-align: left;
    padding: 6px 10px;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text);
    font: inherit;
    cursor: pointer;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .item:hover {
    background: var(--fill-2);
  }
  .item.on {
    background: var(--fill);
    font-weight: var(--fw-600);
  }
  .add {
    margin-top: 8px;
    align-self: flex-start;
  }
  .editor {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text-2);
    font-size: var(--fs-footnote);
  }
  .input {
    font: inherit;
    font-size: var(--fs-ui);
    color: var(--text);
    padding: 6px 8px;
    border-radius: var(--r-sm);
    border: 1px solid var(--separator);
    background: var(--bg);
  }
  textarea.input {
    resize: vertical;
    line-height: 1.45;
  }
  .buttons {
    display: flex;
    gap: 8px;
  }
  @media (max-width: 640px) {
    .types {
      flex-direction: column;
    }
    .list {
      width: auto;
    }
  }
</style>
