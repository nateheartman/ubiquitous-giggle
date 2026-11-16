/**
 * In a page written together: what the other person just typed glows in
 * their cursor colour for a few seconds, then fades, so two people writing at
 * once can tell whose words are whose.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

/** How long new text glows. The fade is styled in app.css (.remote-glow). */
export const GLOW_MS = 3000;

/** Opening the page brings in its whole text at once, which isn't news. */
const SETTLE_MS = 2000;

const key = new PluginKey<DecorationSet>('remoteGlow');

/** Where a change from the sync really differs: from `start`, the old
 *  page's text up to `endA` became the new page's up to `endB`. The sync
 *  replaces whole paragraphs, so its own steps would cover too much, and
 *  would wipe out the glow on what was typed a moment before. */
function diff(tr: Transaction): { start: number; endA: number; endB: number } | null {
  const a = tr.before.content;
  const b = tr.doc.content;
  const start = a.findDiffStart(b);
  if (start == null) return null;
  const end = a.findDiffEnd(b);
  if (!end) return null;
  let { a: endA, b: endB } = end;
  // When the same text repeats, the two ends can cross.
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return { start, endA, endB };
}

export const RemoteGlow = Extension.create<{ color: () => string | undefined }>({
  name: 'remoteGlow',

  addOptions() {
    return { color: () => undefined };
  },

  addProseMirrorPlugins() {
    const color = this.options.color;
    const since = Date.now();
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            if (tr.getMeta(key) === 'fade') {
              const now = Date.now();
              return set.remove(set.find(undefined, undefined, (spec) => spec.until <= now));
            }
            const sync = tr.getMeta(ySyncPluginKey);
            if (!tr.docChanged) return set;
            if (!sync?.isChangeOrigin) return set.map(tr.mapping, tr.doc);
            const change = diff(tr);
            if (!change) return set;
            const { start, endA, endB } = change;
            set = set.map(new Mapping([new StepMap([start, endA - start, endB - start])]), tr.doc);
            // Not your own undo, nor the page arriving as it opens.
            const hue = color();
            if (endB <= start || sync.isUndoRedoOperation || Date.now() - since < SETTLE_MS || !hue) return set;
            return set.add(tr.doc, [Decoration.inline(start, endB, { class: 'remote-glow', style: `--glow: ${hue}` }, { until: Date.now() + GLOW_MS })]);
          },
        },
        props: {
          decorations: (state) => key.getState(state),
        },
        view: (view) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          return {
            // Takes faded glows off once their time is up.
            update(_view, prev) {
              const set = key.getState(view.state);
              if (!set || set === key.getState(prev)) return;
              const until = Math.min(...set.find().map((d) => d.spec.until as number));
              clearTimeout(timer);
              if (Number.isFinite(until)) timer = setTimeout(() => view.dispatch(view.state.tr.setMeta(key, 'fade')), Math.max(0, until - Date.now()) + 50);
            },
            destroy: () => clearTimeout(timer),
          };
        },
      }),
    ];
  },
});
