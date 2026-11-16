/**
 * Marks the page blocks that must never skip painting. Blocks out of sight
 * skip it (app.css), which seals each one in and leaves it undrawn until the
 * next frame:
 *
 * - `holds-float`: a block holding a database. Its menus and cell editors
 *   float over the page from inside it and would be cut off at the block's
 *   edges. Only blocks that can hold other blocks are looked into, so a page
 *   of thousands of paragraphs costs next to nothing per keystroke.
 * - `has-caret`: the block the caret is in. A line Enter has just made isn't
 *   drawn yet, and Chrome leaves the caret behind a key typed into it before
 *   the next frame: a quick "$$ " came out as "$ $", "ab" as "ba".
 */

import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const FLOATS = 'databaseBlock';
const LISTS = new Set(['bulletList', 'orderedList', 'taskList']);

function holds(node: PMNode): boolean {
  if (node.type.name === FLOATS) return true;
  if (node.isTextblock || node.isLeaf) return false;
  let found = false;
  node.descendants((n) => {
    if (found || n.isTextblock) return false;
    if (n.type.name === FLOATS) found = true;
    return !found;
  });
  return found;
}

function marks(doc: PMNode): DecorationSet {
  const out: Decoration[] = [];
  doc.forEach((block, at) => {
    if (!holds(block)) return;
    out.push(Decoration.node(at, at + block.nodeSize, { class: 'holds-float' }));
    // The items of a long list are sealed one by one too.
    if (LISTS.has(block.type.name))
      block.forEach((item, off) => {
        if (holds(item)) out.push(Decoration.node(at + 1 + off, at + 1 + off + item.nodeSize, { class: 'holds-float' }));
      });
  });
  return DecorationSet.create(doc, out);
}

/** The top-level block around the caret, and its item if it's a list. */
function caret(state: EditorState): Decoration[] {
  const { $head } = state.selection;
  if ($head.depth < 1) return [];
  const out = [Decoration.node($head.before(1), $head.after(1), { class: 'has-caret' })];
  if ($head.depth >= 2 && LISTS.has($head.node(1).type.name))
    out.push(Decoration.node($head.before(2), $head.after(2), { class: 'has-caret' }));
  return out;
}

const key = new PluginKey<DecorationSet>('floatSafe');

export const FloatSafe = Extension.create({
  name: 'floatSafe',
  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => marks(state.doc),
          apply: (tr, set) => (tr.docChanged ? marks(tr.doc) : set),
        },
        props: { decorations: (state) => key.getState(state)!.add(state.doc, caret(state)) },
      }),
    ];
  },
});
