<script lang="ts">
  import { MOD } from '../platform';
  /**
   * Writes a formula: properties show as pills and are suggested as you type,
   * the result for a real row shows live, and errors say what's wrong and
   * where. The formula is still saved as plain text (`prop("Price")`); the
   * pills are how the editor shows and edits it.
   */
  import { onDestroy, onMount, untrack } from 'svelte';
  import { Editor, getSchema } from '@tiptap/core';
  import { Fragment, Slice } from '@tiptap/pm/model';
  import { TextSelection } from '@tiptap/pm/state';
  import Modal from '../components/Modal.svelte';
  import Icon from '../components/Icon.svelte';
  import { databases } from '../databases.svelte';
  import { store } from '../store.svelte';
  import { CALLBACKS, FDate, FN_GROUPS, FN_GROUP_LABELS, FUNCTIONS, FormulaError, formatDateValue, run, toText, type FnGroup } from './formula';
  import { baseNodes, docToText, fragmentText, offsetToPos, posToOffset, textToDoc, textToNodes } from './formula-doc';
  import { PropRefView, formulaDecorations } from './formula-pill-view';
  import { rowDbBeforeDot } from './formula-pills';
  import { formatNumber, typeInfo } from './schema';
  import { t } from '../i18n';
  import Rich from '../i18n/Rich.svelte';
  import type { Property } from '../types';

  let { dbId, prop: propIn, onclose }: { dbId: string; prop: Property; onclose: () => void } = $props();
  const prop = untrack(() => propIn);

  let src = $state(untrack(() => prop.config.expression ?? ''));
  let name = $state(untrack(() => prop.name));
  let host: HTMLDivElement;
  let editor: Editor | null = null;
  let caret = $state(untrack(() => src.length));
  let pick = $state(0);
  let hovered = $state<{ name: string; sig: string; doc: string; example?: string } | null>(null);

  const others = $derived(databases.props(dbId).filter((p) => p.id !== prop.id));
  const rows = $derived(databases.rowsOf(dbId));
  let sampleIndex = $state(0);
  const sample = $derived(rows[sampleIndex] ?? rows[0]);

  /** The formula worked out for the sample row. The last answer is kept: the editor asks for it as it draws, and so does the result line. */
  let memo: { key: string; value: ReturnType<typeof run> | null } | null = null;
  function evaluate(text: string): ReturnType<typeof run> | null {
    if (!text.trim()) return null;
    const key = `${sample?.id ?? ''}\0${text}`;
    if (memo?.key === key) return memo.value;
    // The draft is evaluated against the row as it is now.
    const value = sample ? run(text, databases.scope(sample)) : run(text, { now: Date.now(), prop: (n) => (others.some((p) => p.name.toLowerCase() === n.toLowerCase()) ? null : undefined) });
    memo = { key, value };
    return value;
  }
  const result = $derived(evaluate(src));

  const extensions = [
    ...baseNodes,
    PropRefView,
    formulaDecorations({
      root: () => dbId,
      api: databases,
      iconOf: (type) => typeInfo(type as never).icon,
      errorAt: (text) => {
        const r = evaluate(text);
        return r instanceof FormulaError ? r.at : -1;
      },
      placeholder: () => t('dbAuto.formulaEditor.placeholder', { example: '{Price} * {Quantity}' }),
    }),
  ];

  /** Reads the document and the caret into the state the suggestions and the result are worked out from. */
  function sync() {
    if (!editor) return;
    const { doc, selection } = editor.state;
    src = docToText(doc);
    caret = posToOffset(doc, selection.head);
  }

  onMount(() => {
    const schema = getSchema(extensions);
    editor = new Editor({
      element: host,
      extensions,
      content: textToDoc(src, schema).toJSON(),
      autofocus: 'end',
      editorProps: {
        attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': t('dbAuto.formulaEditor.title'), spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' },
        handleKeyDown: (_view, e) => onKey(e),
        // Pasted text keeps its lines, and prop("X") in it becomes pills.
        handlePaste: (view, e) => {
          const text = e.clipboardData?.getData('text/plain');
          if (!text) return false;
          e.preventDefault();
          view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.from(textToNodes(text, view.state.schema)), 0, 0)).scrollIntoView());
          return true;
        },
        // Copying gives the formula as text.
        clipboardTextSerializer: (slice) => fragmentText(slice.content),
      },
      onTransaction: sync,
    });
    sync();
  });

  onDestroy(() => editor?.destroy());

  // Another row to try the formula on changes its result and so where its error is.
  $effect(() => {
    void sample?.id;
    editor?.view.dispatch(editor.state.tr);
  });

  /** The result, as the property's cells show it: dates as formatDate() writes them, which is formula output and stays English. */
  function show(v: unknown): string {
    if (v instanceof FDate) return formatDateValue(v);
    if (typeof v === 'number') return formatNumber(v, prop.config);
    if (typeof v === 'boolean') return v ? t('dbAuto.formulaEditor.resultTrue') : t('dbAuto.formulaEditor.resultFalse');
    if (Array.isArray(v)) return v.map((x) => toText(x)).join(', ') || t('dbAuto.formulaEditor.emptyList');
    const text = toText(v as never);
    return text === '' ? t('dbAuto.formulaEditor.empty') : t('dbAuto.formulaEditor.quoted', { text });
  }

  // ------------------------------------------------------------ suggestions

  /** What picking a suggestion puts in: a pill for a property, otherwise text. `from` is where in the text it replaces from. */
  type Suggestion = { kind: 'prop' | 'fn' | 'var'; label: string; insert: string; pill?: string; detail: string; icon: string; from: number };

  /** Whether the caret is inside the brackets of a function that works through a list item by item. */
  function insideCallback(before: string): boolean {
    const open: string[] = [];
    let quote = '';
    for (let i = 0; i < before.length; i++) {
      const c = before[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '“') quote = '”';
      else if (c === '‘') quote = '’';
      else if (c === '{') {
        const end = before.indexOf('}', i);
        if (end < 0) return false;
        i = end;
      } else if (c === '(') open.push(/([A-Za-z_]\w*)\s*$/.exec(before.slice(0, i))?.[1].toLowerCase() ?? '');
      else if (c === ')') open.pop();
    }
    return open.some((name) => CALLBACKS.has(name));
  }

  const suggestions = $derived.by((): Suggestion[] => {
    const before = src.slice(0, caret);
    const brace = before.lastIndexOf('{');
    const propSuggestion = (p: { name: string; type: string }, from: number): Suggestion => ({
      kind: 'prop',
      label: p.name,
      insert: '',
      pill: p.name,
      detail: typeInfo(p.type as never).label,
      icon: typeInfo(p.type as never).icon,
      from,
    });
    if (brace > before.lastIndexOf('}')) {
      const q = before.slice(brace + 1).toLowerCase();
      return others.filter((p) => p.name.toLowerCase().includes(q)).map((p) => propSuggestion(p, brace));
    }
    const fnSuggestion = (f: (typeof FUNCTIONS)[string], from: number): Suggestion => ({ kind: 'fn', label: `${f.name}()`, insert: `${f.name}(`, detail: f.doc, icon: 'function', from });
    // After a dot a function is called on what's before it: x.length(). On a row of a related database (current.) its properties come first.
    const dot = /\.([A-Za-z_]\w*)?$/.exec(before);
    if (dot) {
      const after = (dot[1] ?? '').toLowerCase();
      const relatedDb = rowDbBeforeDot(before, dbId, databases);
      const related = relatedDb
        ? databases
            .props(relatedDb)
            .filter((p) => p.name.toLowerCase().startsWith(after))
            .map((p) => propSuggestion(p, dot.index + 1))
        : [];
      const fns = Object.values(FUNCTIONS)
        .filter((f) => f.name.toLowerCase().startsWith(after))
        .map((f) => fnSuggestion(f, dot.index + 1));
      return [...related, ...fns].slice(0, 8);
    }
    const m = /[A-Za-z_][\w]*$/.exec(before);
    if (!m) return [];
    const q = m[0].toLowerCase();
    const fns = Object.values(FUNCTIONS)
      .filter((f) => f.name.toLowerCase().startsWith(q))
      .map((f) => fnSuggestion(f, m.index));
    // Inside map(, filter(... the item being worked on and its position are there to use.
    const vars = insideCallback(before)
      ? [
          { kind: 'var' as const, label: 'current', insert: 'current', detail: t('dbAuto.formulaEditor.currentItem'), icon: 'function', from: m.index },
          { kind: 'var' as const, label: 'index', insert: 'index', detail: t('dbAuto.formulaEditor.indexItem'), icon: 'function', from: m.index },
        ].filter((v) => v.label.startsWith(q))
      : [];
    const props = others.filter((p) => p.name.toLowerCase().startsWith(q)).map((p) => propSuggestion(p, m.index));
    return [...vars, ...props, ...fns].slice(0, 8);
  });

  $effect(() => {
    void suggestions.length;
    pick = 0;
  });

  /** Puts a pill or some text in place of the text from `from` (an offset in the formula) up to the caret, or at the caret. */
  function insert(what: { pill: string } | { text: string }, from?: number) {
    if (!editor) return;
    const { state, view } = editor;
    const to = state.selection.to;
    const start = from === undefined ? state.selection.from : Math.min(offsetToPos(state.doc, from), to);
    const node = 'pill' in what ? state.schema.nodes.propRef.create({ name: what.pill, scope: 'this' }) : state.schema.text(what.text);
    const tr = state.tr.replaceWith(start, to, node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(start + node.nodeSize)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  }

  function take(s: Suggestion) {
    insert(s.pill ? { pill: s.pill } : { text: s.insert }, s.from);
  }

  /** Puts a whole formula in, in place of what's there. */
  function replaceAll(text: string) {
    if (!editor) return;
    const { state, view } = editor;
    const tr = state.tr.replaceWith(0, state.doc.content.size, state.schema.nodes.paragraph.create(null, textToNodes(text, state.schema)));
    tr.setSelection(TextSelection.atEnd(tr.doc));
    view.dispatch(tr);
    view.focus();
  }

  function onKey(e: KeyboardEvent): boolean {
    if (!editor || e.isComposing) return false;
    const mod = e.ctrlKey || e.metaKey;
    const { state, view } = editor;
    if (e.key === 'Enter' && mod) {
      e.preventDefault();
      save();
      return true;
    }
    if (suggestions.length && !mod && !e.altKey) {
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        take(suggestions[pick]);
        return true;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        pick = (pick + 1) % suggestions.length;
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        pick = (pick - 1 + suggestions.length) % suggestions.length;
        return true;
      }
    }
    if (e.key === 'Enter' && !e.altKey) {
      // A formula can run over several lines; ⌘Enter or Done saves it.
      e.preventDefault();
      view.dispatch(state.tr.replaceSelectionWith(state.schema.nodes.hardBreak.create()).scrollIntoView());
      return true;
    }
    if (e.key === 'Tab' && !mod && !e.altKey) {
      e.preventDefault();
      if (e.shiftKey) {
        // Takes back up to one indent of spaces before the caret.
        const at = state.selection.$from;
        const spaces = / {1,4}$/.exec(at.parent.textBetween(0, at.parentOffset, undefined, '\n'))?.[0].length ?? 0;
        if (state.selection.empty && spaces) view.dispatch(state.tr.delete(at.pos - spaces, at.pos));
      } else view.dispatch(state.tr.insertText('    '));
      return true;
    }
    // A pill is one unit: Backspace and Delete take it whole.
    if ((e.key === 'Backspace' || e.key === 'Delete') && state.selection.empty && !mod && !e.altKey) {
      const here = state.selection.$from;
      const node = e.key === 'Backspace' ? here.nodeBefore : here.nodeAfter;
      if (node?.type.name === 'propRef') {
        e.preventDefault();
        const at = here.pos;
        view.dispatch(state.tr.delete(e.key === 'Backspace' ? at - node.nodeSize : at, e.key === 'Backspace' ? at : at + node.nodeSize));
        return true;
      }
    }
    return false;
  }

  function save() {
    databases.updateProperty(dbId, prop.id, { name: name.trim() || prop.name, config: { ...prop.config, expression: src.trim() } }, { immediate: true });
    onclose();
  }

  const fnsBy = (g: FnGroup) => Object.values(FUNCTIONS).filter((f) => f.group === g);

  /** Example formulas: their code is put in the box as it is (formulas are written in English). */
  const EXAMPLES = [
    { label: t('dbAuto.formulaEditor.example.multiply'), src: '{Price} * {Quantity}' },
    { label: t('dbAuto.formulaEditor.example.daysUntil'), src: 'daysUntil({Due})' },
    { label: t('dbAuto.formulaEditor.example.checkboxLabel'), src: 'if({Done}, "✓ Done", "Open")' },
    { label: t('dbAuto.formulaEditor.example.joinText'), src: '{First name} + " " + {Last name}' },
    { label: t('dbAuto.formulaEditor.example.stars'), src: 'repeat("★", {Rating})' },
  ];
</script>

<Modal onclose={onclose} width={760} label={t('dbAuto.formulaEditor.title')} top="8vh">
  <div class="modal-head">
    <h2><Icon name="function" size={18} /></h2>
    <input class="name" bind:value={name} placeholder={t('common.name')} aria-label={t('dbAuto.formulaEditor.propertyName')} />
    <button class="icon-btn" onclick={onclose} aria-label={t('common.actions.close')}><Icon name="x" /></button>
  </div>
  <div class="modal-body">
    <div class="editor">
      <div class="src" bind:this={host}></div>
      {#if suggestions.length}
        <div class="suggest" role="listbox">
          {#each suggestions as s, i (s.kind + s.label)}
            <button class="pop-item" class:active={i === pick} onmousemove={() => (pick = i)} onmousedown={(e) => e.preventDefault()} onclick={() => take(s)}>
              <Icon name={s.icon} size={14} />
              <span class="name">{s.label}</span>
              <span class="grow detail">{s.detail}</span>
            </button>
          {/each}
          <div class="tip"><Rich key="dbAuto.formulaEditor.tabToInsert" /></div>
        </div>
      {/if}
    </div>

    <div class="result" class:error={result instanceof FormulaError}>
      {#if result instanceof FormulaError}
        <Icon name="info" size={15} />
        <span>
          {#if result.at >= 0 && src}<Rich key="dbAuto.formulaEditor.errorAt" params={{ error: result.message, snippet: src.slice(Math.max(0, result.at - 8), result.at + 8) }}
              >{#snippet where(text: string)}<span class="where">{text}</span>{/snippet}</Rich
            >{:else}{result.message}{/if}
        </span>
      {:else if src.trim()}
        <span class="label">
          {#if sample}{t('dbAuto.formulaEditor.forRow', { title: store.byId.get(sample.id)?.title || t('common.untitled') })}{:else}{t('dbAuto.formulaEditor.result')}{/if}
        </span>
        <span class="value">{show(result)}</span>
        {#if rows.length > 1}
          <button class="icon-btn small" onclick={() => (sampleIndex = (sampleIndex + 1) % rows.length)} data-tip={t('dbAuto.formulaEditor.nextRow')}><Icon name="arrow-down" size={13} /></button>
        {/if}
      {:else}
        <span class="label">{t('dbAuto.formulaEditor.emptyResult')}</span>
      {/if}
    </div>

    <div class="ref">
      <section>
        <h3 class="eyebrow">{t('dbAuto.formulaEditor.properties')}</h3>
        <div class="items">
          {#each others as p (p.id)}
            <button
              class="ref-item"
              onmousedown={(e) => e.preventDefault()}
              onclick={() => insert({ pill: p.name })}
              onmouseenter={() => (hovered = { name: p.name, sig: typeInfo(p.type).label, doc: t('dbAuto.formulaEditor.insertProperty', { code: `{${p.name}}` }) })}
            >
              <Icon name={typeInfo(p.type).icon} size={13} /> {p.name}
            </button>
          {/each}
        </div>
        <h3 class="eyebrow">{t('dbAuto.formulaEditor.examples')}</h3>
        <div class="items">
          {#each EXAMPLES as ex (ex.src)}
            <button class="ref-item" onclick={() => replaceAll(ex.src)} onmouseenter={() => (hovered = { name: ex.label, sig: '', doc: ex.src })}>{ex.label}</button>
          {/each}
        </div>
      </section>
      <section class="fns">
        {#each FN_GROUPS as g (g)}
          <h3 class="eyebrow">{FN_GROUP_LABELS[g]}</h3>
          <div class="items">
            {#each fnsBy(g) as f (f.name)}
              <button
                class="ref-item mono"
                onmousedown={(e) => e.preventDefault()}
                onclick={() => insert({ text: `${f.name}(` })}
                onmouseenter={() => (hovered = { name: `${f.name}()`, sig: f.sig, doc: f.doc, example: f.example })}>{f.name}</button
              >
            {/each}
          </div>
        {/each}
      </section>
    </div>
    <div class="doc">
      {#if hovered}
        <strong>{hovered.name}</strong>{#if hovered.sig}<span class="sig"> · {hovered.sig}</span>{/if}
        <p>{hovered.doc}</p>
        {#if hovered.example}<p class="ex"><code>{hovered.example}</code></p>{/if}
      {:else}
        <p><Rich key="dbAuto.formulaEditor.help" params={{ example: '{Due}' }}>{#snippet code(text: string)}<code>{text}</code>{/snippet}</Rich></p>
      {/if}
    </div>
  </div>
  <div class="modal-foot">
    <span><Rich key="dbAuto.formulaEditor.saveHint" params={{ mod: MOD }} /></span>
    <div class="actions">
      <button class="btn" onclick={onclose}>{t('common.actions.cancel')}</button>
      <button class="btn primary" onclick={save}>{t('common.actions.done')}</button>
    </div>
  </div>
</Modal>

<style>
  .modal-head h2 {
    flex: none;
    display: grid;
    color: var(--text-2);
  }
  .name {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 8px;
    margin-left: -6px;
    border: none;
    border-radius: var(--r-sm);
    background: none;
    font-size: 17px;
    font-weight: var(--fw-650);
    letter-spacing: -0.016em;
    color: var(--text);
    outline: none;
  }
  .name:hover,
  .name:focus {
    background: var(--fill);
  }
  .editor {
    position: relative;
    /* Room for the focus ring above the box. */
    margin-top: 2px;
  }
  .src {
    display: block;
    width: 100%;
    min-height: 72px;
    max-height: 40vh;
    overflow-y: auto;
    padding: 10px 12px;
    border-radius: var(--r-md);
    background: var(--bg-grouped);
    box-shadow: inset 0 0 0 0.5px var(--hairline);
    font-family: var(--font-mono);
    font-size: 13.5px;
    line-height: 1.75;
    color: var(--text);
  }
  .src:focus-within {
    box-shadow: 0 0 0 1.5px var(--focus);
  }
  .src :global(.ProseMirror) {
    min-height: 52px;
    outline: none;
    white-space: pre-wrap;
    word-break: break-word;
    tab-size: 4;
  }
  .src :global(.ProseMirror p) {
    margin: 0;
  }
  .src :global(.is-empty::before) {
    content: attr(data-placeholder);
    float: left;
    height: 0;
    color: var(--text-3);
    pointer-events: none;
  }
  /* The colours: functions and methods, text, numbers, operators. */
  .src :global(.tok-fn) {
    color: var(--c-pink);
  }
  .src :global(.tok-str) {
    color: color-mix(in srgb, var(--c-green) 62%, var(--text));
  }
  .src :global(.tok-num) {
    color: color-mix(in srgb, var(--c-blue) 80%, var(--text));
  }
  .src :global(.tok-op) {
    color: var(--text-2);
  }
  .src :global(.tok-var) {
    color: color-mix(in srgb, var(--c-purple) 75%, var(--text));
  }
  .src :global(.err) {
    text-decoration: underline wavy var(--danger);
    text-underline-offset: 3px;
  }
  /* A property: a grey chip with its type's icon and its name. */
  .src :global(.pill) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0 1px;
    padding: 0 6px 0 4px;
    height: 1.45em;
    border-radius: 5px;
    background: var(--fill-2);
    box-shadow: inset 0 0 0 0.5px var(--hairline);
    font-family: var(--font-ui);
    font-size: 12.5px;
    line-height: 1;
    color: var(--text);
    vertical-align: middle;
    cursor: default;
    user-select: none;
  }
  .src :global(.pill .pill-icon) {
    display: grid;
    color: var(--text-2);
  }
  .src :global(.pill.ProseMirror-selectednode) {
    box-shadow: 0 0 0 1.5px var(--focus);
  }
  .src :global(.pill-missing) {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--danger);
    text-decoration: line-through;
  }
  .src :global(.pill-missing .pill-icon) {
    color: var(--danger);
  }
  .suggest {
    position: absolute;
    left: 8px;
    right: 8px;
    top: calc(100% + 4px);
    z-index: 2;
    padding: 4px;
    border-radius: var(--r-lg);
    background: var(--bg-elevated);
    box-shadow: var(--shadow-pop);
  }
  .suggest .name {
    flex: none;
    font-family: var(--font-mono);
    font-size: 12.5px;
  }
  .detail {
    color: var(--text-3);
    font-size: var(--fs-footnote);
  }
  .tip {
    padding: 4px 8px 2px;
    font-size: var(--fs-caption);
    color: var(--text-3);
  }
  .result {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    margin: 10px 0 16px;
    padding: 6px 8px 6px 12px;
    border-radius: var(--r-sm);
    background: var(--fill);
    font-size: var(--fs-ui);
  }
  .result .label {
    color: var(--text-3);
  }
  .result .value {
    flex: 1;
    min-width: 0;
    font-weight: var(--fw-600);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result.error {
    background: color-mix(in srgb, var(--danger) 10%, transparent);
    color: var(--danger);
  }
  .where {
    font-family: var(--font-mono);
    font-size: 12px;
    opacity: 0.8;
  }
  .icon-btn.small {
    width: 24px;
    height: 24px;
  }
  .ref {
    display: grid;
    grid-template-columns: 1fr 1.4fr;
    gap: 20px;
    max-height: 34vh;
    overflow-y: auto;
  }
  .eyebrow {
    margin: 10px 0 6px;
  }
  .eyebrow:first-child {
    margin-top: 0;
  }
  .items {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .ref-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 24px;
    padding: 0 8px;
    border-radius: var(--r-xs);
    background: var(--fill);
    font-size: var(--fs-footnote);
    color: var(--text);
    transition: background-color var(--dur-fast) var(--ease);
  }
  .ref-item:hover {
    background: var(--fill-3);
  }
  .ref-item.mono {
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .ref-item :global(.icon) {
    color: var(--text-2);
  }
  .doc {
    min-height: 56px;
    margin-top: 14px;
    padding: 10px 12px;
    border-radius: var(--r-sm);
    background: var(--bg-grouped);
    font-size: var(--fs-ui);
  }
  .doc p {
    margin: 2px 0 0;
    color: var(--text-2);
    line-height: 1.45;
  }
  .doc .sig {
    color: var(--text-3);
  }
  .doc code {
    font-family: var(--font-mono);
    font-size: 12px;
  }
</style>
