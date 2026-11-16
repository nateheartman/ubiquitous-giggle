import { Node } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import MeetingBlock from './MeetingBlock.svelte';
import { EMPTY_MEETING, meetingText, readAttrs, speakerName, turnLine, type BlockProps, type MeetingAttrs } from '../meeting-text';
import { store } from '../store.svelte';

/**
 * A meeting: recorded on this Mac, with its transcript and who said what. The
 * attributes hold everything (the title, the turns, the speakers' names, and
 * the library file with the audio), so the transcript is part of the page:
 * it's searched, synced and exported with it. See MeetingBlock.svelte.
 */
export const MeetingNode = Node.create({
  name: 'meeting',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  // The attributes are all kept as one piece in the HTML (data-meeting), below.
  addAttributes() {
    const attr = <K extends keyof MeetingAttrs>(key: K) => ({ default: EMPTY_MEETING[key], rendered: false });
    return {
      recId: attr('recId'),
      title: attr('title'),
      mic: attr('mic'),
      system: attr('system'),
      fileId: attr('fileId'),
      durationMs: attr('durationMs'),
      turns: attr('turns'),
      names: attr('names'),
      language: attr('language'),
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-meeting]',
        getAttrs: (el) => {
          try {
            // A pasted copy never joins the recording it was copied from.
            return { ...readAttrs(JSON.parse((el as HTMLElement).dataset.meeting ?? '{}')), recId: null };
          } catch {
            return { ...EMPTY_MEETING };
          }
        },
      },
    ];
  },

  // The transcript is written out as plain paragraphs as well, so whatever
  // reads the HTML (copying to another app, search, export) gets the words.
  renderHTML({ node }) {
    const a = readAttrs(node.attrs);
    return [
      'div',
      { 'data-meeting': JSON.stringify({ ...a, recId: null }), class: 'meeting-static' },
      ['p', {}, a.title],
      ...a.turns.map((turn) => ['p', { 'data-speaker': speakerName(turn.sp, a.names) }, turnLine(turn, a.names)] as [string, Record<string, string>, string]),
    ];
  },
  renderText: ({ node }) => meetingText(readAttrs(node.attrs)),

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement('div');
      dom.className = 'meeting-block';
      dom.contentEditable = 'false';
      const props: BlockProps = $state({
        attrs: readAttrs(node.attrs),
        editable: editor.isEditable,
        pageId: store.currentId,
        update: (patch) => {
          const pos = typeof getPos === 'function' ? getPos() : undefined;
          if (pos === undefined || editor.isDestroyed) return;
          const current = editor.state.doc.nodeAt(pos);
          if (!current || current.type.name !== 'meeting') return;
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch }));
        },
      });
      const app = mount(MeetingBlock, { target: dom, props: { p: props } });
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== 'meeting') return false;
          props.attrs = readAttrs(updated.attrs);
          props.editable = editor.isEditable;
          return true;
        },
        // Typing, clicks and drags inside are the block's own.
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy: () => void unmount(app),
      };
    };
  },
});
