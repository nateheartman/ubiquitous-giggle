/**
 * How the formula editor draws its document: property pills (an icon and a
 * name), colours for the parts of the formula, a mark where an error is, and
 * the placeholder. All of it is decoration over the text, so none of it ends
 * up in what's saved.
 */
import { mount, unmount } from 'svelte';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import Icon from '../components/Icon.svelte';
import { t } from '../i18n';
import { PropRef, docToText, offsetToPos, segments } from './formula-doc';
import { colourSpans, pillExists, type PropLookup } from './formula-pills';

export interface PillHost {
  /** The database the formula belongs to. */
  root(): string;
  api: PropLookup;
  /** The icon the property menu uses for a type of property. */
  iconOf(type: string): string;
  /** Where in the text the formula's error is, or -1. */
  errorAt(text: string): number;
  placeholder(): string;
}

interface PillInfo {
  icon: string;
  related: boolean;
  missing: boolean;
}

/** The pill as a node view: the chip itself, with its icon drawn by the app's Icon component. */
export const PropRefView = PropRef.extend({
  addNodeView() {
    return ({ node, decorations }) => {
      const dom = document.createElement('span');
      dom.contentEditable = 'false';
      dom.setAttribute('role', 'img');
      dom.setAttribute('data-prop-ref', '');
      const holder = document.createElement('span');
      holder.className = 'pill-icon';
      const label = document.createElement('span');
      label.className = 'pill-name';
      dom.append(holder, label);
      let icon = '';
      let mounted: ReturnType<typeof mount> | null = null;

      const draw = (name: string, info: PillInfo | undefined) => {
        const want = info?.icon ?? 'function';
        if (want !== icon) {
          if (mounted) void unmount(mounted);
          holder.textContent = '';
          mounted = mount(Icon, { target: holder, props: { name: want, size: 12 } });
          icon = want;
        }
        label.textContent = name;
        dom.setAttribute('aria-label', t(info?.missing ? 'dbAuto.formulaEditor.pillMissing' : 'dbAuto.formulaEditor.pillLabel', { name }));
      };
      const infoOf = (ds: readonly Decoration[]) => ds.map((d) => (d.spec as { pill?: PillInfo }).pill).find(Boolean);
      draw(node.attrs.name, infoOf(decorations));

      return {
        dom,
        update(next, ds) {
          if (next.type !== node.type) return false;
          draw(next.attrs.name, infoOf(ds));
          return true;
        },
        // Clicking or dragging the pill is the editor's to handle: it is one unit.
        ignoreMutation: () => true,
        destroy() {
          if (mounted) void unmount(mounted);
        },
      };
    };
  },
});

const key = new PluginKey('formulaDecorations');

/** The decorations: pills' state, colours, the error mark and the placeholder. */
export function formulaDecorations(host: PillHost) {
  return Extension.create({
    name: 'formulaDecorations',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key,
          props: {
            decorations(state) {
              const { doc } = state;
              const text = docToText(doc);
              const segs = segments(doc);
              const out: Decoration[] = [];

              if (!text) {
                out.push(Decoration.node(0, doc.content.size, { class: 'is-empty', 'data-placeholder': host.placeholder() }));
                return DecorationSet.create(doc, out);
              }

              for (const s of segs) {
                if (s.kind !== 'pill') continue;
                // After a dot it's a property of a linked row, whatever it was when it was put there.
                const related = /\.\s*$/.test(text.slice(0, s.off));
                const found = pillExists(text, { start: s.off, end: s.off + s.len, name: s.node.attrs.name, scope: related ? 'related' : 'this', src: '' }, host.root(), host.api);
                const missing = found?.exists === false;
                const pill: PillInfo = { icon: missing ? 'info' : found?.type ? host.iconOf(found.type) : 'function', related, missing };
                out.push(Decoration.node(s.pos, s.pos + s.node.nodeSize, { class: `pill${related ? ' pill-related' : ''}${missing ? ' pill-missing' : ''}` }, { pill }));
              }

              for (const c of colourSpans(text)) {
                for (const s of segs) {
                  if (s.kind !== 'text') continue;
                  const a = Math.max(c.start, s.off);
                  const b = Math.min(c.end, s.off + s.len);
                  if (a < b) out.push(Decoration.inline(s.pos + (a - s.off), s.pos + (b - s.off), { class: `tok-${c.colour}` }));
                }
              }

              const at = host.errorAt(text);
              if (at >= 0) {
                const word = /^\w+|^\S/.exec(text.slice(at))?.[0].length ?? 1;
                const from = offsetToPos(doc, Math.min(at, Math.max(0, text.length - 1)));
                let to = offsetToPos(doc, Math.min(at + word, text.length));
                // An error on a pill marks the whole pill.
                if (to <= from) to = from + 1;
                out.push(Decoration.inline(from, Math.min(to, doc.content.size), { class: 'err' }));
              }
              return DecorationSet.create(doc, out);
            },
          },
        }),
      ];
    },
  });
}
