/**
 * The formula editor's document: one paragraph of text, line breaks and
 * property pills. The saved formula stays plain text, so this file is the
 * bridge. A pill is an atom that writes itself back as `prop("Name")`, or as
 * the exact words it was read from, so opening and saving a formula without
 * touching it leaves the text as it was.
 */
import { Node, getSchema, mergeAttributes } from '@tiptap/core';
import type { Fragment, Node as PMNode, Schema } from '@tiptap/pm/model';
import { propText, scanPills } from './formula-pills';

const Doc = Node.create({ name: 'doc', topNode: true, content: 'paragraph+' });

// Spaces and indentation are part of a formula's layout, so none of it is collapsed.
const Paragraph = Node.create({
  name: 'paragraph',
  group: 'block',
  content: 'inline*',
  whitespace: 'pre',
  parseHTML: () => [{ tag: 'p', preserveWhitespace: 'full' }],
  renderHTML: ({ HTMLAttributes }) => ['p', HTMLAttributes, 0],
});

const Text = Node.create({ name: 'text', group: 'inline' });

const HardBreak = Node.create({
  name: 'hardBreak',
  inline: true,
  group: 'inline',
  selectable: false,
  parseHTML: () => [{ tag: 'br' }],
  renderHTML: ({ HTMLAttributes }) => ['br', HTMLAttributes],
});

/** A reference to a property: one unit, deleted whole. */
export const PropRef = Node.create({
  name: 'propRef',
  inline: true,
  group: 'inline',
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      name: { default: '' },
      // `related` when it follows a dot: a property of a linked row, not of this database.
      scope: { default: 'this' },
      // What it was written as, so saving an untouched formula doesn't change its spelling.
      src: { default: '' },
    };
  },
  parseHTML: () => [{ tag: 'span[data-prop-ref]', getAttrs: (el) => ({ name: (el as HTMLElement).getAttribute('data-prop-ref') ?? '', scope: (el as HTMLElement).getAttribute('data-scope') ?? 'this' }) }],
  renderHTML: ({ node, HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes, { 'data-prop-ref': node.attrs.name, 'data-scope': node.attrs.scope, class: 'pill' }), node.attrs.name],
});

export const baseNodes = [Doc, Paragraph, Text, HardBreak];
export const formulaNodes = [...baseNodes, PropRef];

let cached: Schema | null = null;
export function formulaSchema(): Schema {
  return (cached ??= getSchema(formulaNodes));
}

// ------------------------------------------------------------- text <-> doc

/** The inline content for some formula text: pills where it names properties, hard breaks for new lines. */
function inlineOf(text: string, schema: Schema): PMNode[] {
  const out: PMNode[] = [];
  const plain = (s: string) => {
    s.split('\n').forEach((line, i) => {
      if (i > 0) out.push(schema.nodes.hardBreak.create());
      if (line) out.push(schema.text(line));
    });
  };
  let at = 0;
  for (const p of scanPills(text)) {
    plain(text.slice(at, p.start));
    out.push(schema.nodes.propRef.create({ name: p.name, scope: p.scope, src: p.src }));
    at = p.end;
  }
  plain(text.slice(at));
  return out;
}

/** What goes into the editor for this text (for pasting, which also converts `prop("X")` to pills). */
export function textToNodes(text: string, schema: Schema = formulaSchema()): PMNode[] {
  return inlineOf(text.replace(/\r\n?/g, '\n'), schema);
}

export function textToDoc(text: string, schema: Schema = formulaSchema()): PMNode {
  return schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, textToNodes(text, schema)));
}

/** How one node is written in the formula. */
function writeNode(n: PMNode): string {
  if (n.type.name === 'hardBreak') return '\n';
  if (n.type.name === 'propRef') return n.attrs.src || propText(n.attrs.name);
  return n.text ?? '';
}

/** The formula text of a copied piece of the document (pills as `prop("X")`, so what's copied pastes back as pills). */
export function fragmentText(f: Fragment): string {
  let out = '';
  f.forEach((n, _o, i) => {
    if (n.isInline) out += writeNode(n);
    else {
      if (i > 0) out += '\n';
      out += fragmentText(n.content);
    }
  });
  return out;
}

/** The formula text of a document, or of the part of it between two positions. */
export function docToText(doc: PMNode, from = 0, to = doc.content.size): string {
  let out = '';
  doc.forEach((block, blockPos, index) => {
    if (index > 0) out += '\n';
    block.forEach((child, childPos) => {
      const a = blockPos + 1 + childPos;
      const b = a + child.nodeSize;
      if (b <= from || a >= to) return;
      if (child.isText) out += child.text!.slice(Math.max(0, from - a), Math.min(child.nodeSize, to - a));
      else out += writeNode(child);
    });
  });
  return out;
}

// --------------------------------------------------------------- positions

export interface Seg {
  /** Position of the piece in the document. */
  pos: number;
  /** Where it starts in the formula text, and how long it is there. */
  off: number;
  len: number;
  kind: 'text' | 'pill' | 'break';
  node: PMNode;
}

/** The pieces of a document in order, each with where it sits in the document and in the text. */
export function segments(doc: PMNode): Seg[] {
  const out: Seg[] = [];
  let off = 0;
  doc.forEach((block, blockPos, index) => {
    if (index > 0) off += 1;
    block.forEach((child, childPos) => {
      const pos = blockPos + 1 + childPos;
      const len = child.isText ? child.nodeSize : writeNode(child).length;
      out.push({ pos, off, len, kind: child.isText ? 'text' : child.type.name === 'hardBreak' ? 'break' : 'pill', node: child });
      off += len;
    });
  });
  return out;
}

/** The document position that is `off` characters into the formula text. */
export function offsetToPos(doc: PMNode, off: number): number {
  const segs = segments(doc);
  for (const s of segs) {
    if (off > s.off + s.len) continue;
    if (s.kind === 'text') return s.pos + Math.max(0, off - s.off);
    return off <= s.off || off < s.off + s.len ? s.pos : s.pos + 1;
  }
  const last = segs[segs.length - 1];
  return last ? last.pos + last.node.nodeSize : 1;
}

/** How many characters of formula text come before this document position. */
export function posToOffset(doc: PMNode, pos: number): number {
  let off = 0;
  for (const s of segments(doc)) {
    const end = s.pos + s.node.nodeSize;
    if (pos >= end) {
      off = s.off + s.len;
      continue;
    }
    if (pos <= s.pos) return s.off;
    return s.kind === 'text' ? s.off + (pos - s.pos) : s.off;
  }
  return off;
}
