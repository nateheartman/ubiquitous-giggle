import { Node, mergeAttributes } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import DatabaseBlock from '../db/DatabaseBlock.svelte';
import { t } from '../i18n';
import { store } from '../store.svelte';
import type { DbView } from '../types';

/**
 * A database shown inside a page: its views, rows and toolbar, live. The
 * block remembers which view it shows; the database itself lives on (in the
 * sidebar) if the block is deleted.
 */
export const DatabaseNode = Node.create({
  name: 'databaseBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  // The page the editor shows: what "This page" in the database's relation filters means.
  addOptions: () => ({ host: null as string | null }),

  addAttributes: () => ({
    id: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-database'),
      renderHTML: (attrs: Record<string, any>) => ({ 'data-database': attrs.id }),
    },
    view: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute('data-view'),
      renderHTML: (attrs: Record<string, any>) => (attrs.view ? { 'data-view': attrs.view } : {}),
    },
    // A linked block's own views (null: it shares the database's). They live here so a copy of the page, a template or an export carries them.
    views: {
      default: null,
      parseHTML: (el: HTMLElement) => {
        try {
          return JSON.parse(el.getAttribute('data-views') ?? 'null');
        } catch {
          return null;
        }
      },
      renderHTML: (attrs: Record<string, any>) => (attrs.views ? { 'data-views': JSON.stringify(attrs.views) } : {}),
    },
  }),
  parseHTML: () => [{ tag: 'div[data-database]' }],
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes)];
  },
  renderText: ({ node }) => store.byId.get(node.attrs.id)?.title || t('blocks.database.fallbackTitle'),

  addNodeView() {
    const host = this.options.host;
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'database-block';
      dom.contentEditable = 'false';
      const props = $state({
        id: node.attrs.id as string,
        view: (node.attrs.view as string | null) ?? null,
        host,
        views: ((node.attrs.views as DbView[] | null) ?? null) as DbView[] | null,
        onviews: (views: DbView[]) => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined || editor.isDestroyed) return;
          const current = editor.state.doc.nodeAt(pos);
          if (!current) return;
          props.views = views;
          // Changing a filter isn't something to undo word by word with the page's text.
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, views }).setMeta('addToHistory', false));
        },
        onview: (view: string) => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined || editor.isDestroyed) return;
          const current = editor.state.doc.nodeAt(pos);
          if (!current) return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, view }));
        },
      });
      const app = mount(DatabaseBlock, { target: dom, props });
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== 'databaseBlock' || updated.attrs.id !== props.id) return false;
          props.view = updated.attrs.view ?? null;
          props.views = updated.attrs.views ?? null;
          return true;
        },
        // Everything inside is the database's: typing, clicks, paste, drags.
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => void unmount(app),
      };
    };
  },
});
