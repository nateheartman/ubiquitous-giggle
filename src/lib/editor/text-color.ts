/**
 * Coloured text and coloured highlights. Both keep a palette key ("red"),
 * not a colour, so app.css can draw it readably in every theme: text is
 * darkened on light pages and lightened on dark ones, highlights are tints.
 */

import { Mark, mergeAttributes } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';
import { PALETTE } from '../colors';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textColor: {
      setTextColor: (color: string) => ReturnType;
      unsetTextColor: () => ReturnType;
    };
  }
}

/** A palette key, or null for anything else (pasted styles, old values). */
const paletteKey = (value: string | null): string | null => (PALETTE.some((c) => c.key === value) ? value : null);

const colorAttr = (dataAttr: string) => ({
  color: {
    default: null,
    parseHTML: (el: HTMLElement) => paletteKey(el.getAttribute(dataAttr)),
    renderHTML: (attrs: { color?: string | null }) => (attrs.color ? { [dataAttr]: attrs.color } : {}),
  },
});

export const TextColor = Mark.create({
  name: 'textColor',

  addAttributes: () => colorAttr('data-text-color'),

  parseHTML: () => [{ tag: 'span[data-text-color]', getAttrs: (el) => (paletteKey(el.getAttribute('data-text-color')) ? null : false) }],

  renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes), 0],

  addCommands() {
    return {
      setTextColor:
        (color) =>
        ({ commands }) =>
          commands.setMark(this.name, { color }),
      unsetTextColor:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});

/** The highlight mark, in the theme's highlight colour or a palette tint. */
export const ColorHighlight = Highlight.extend({
  addAttributes: () => colorAttr('data-color'),
});
