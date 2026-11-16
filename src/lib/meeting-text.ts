/**
 * A meeting block's transcript as data and as text. The same turns are shown
 * in the block, copied, searched and written into Markdown and Word files, so
 * the wording of a line lives here once.
 */

import { t } from './i18n';

/** One speaker's turn: who ("me" or the voice's number), start and end in ms, and the words. */
export interface MeetingTurn {
  sp: string;
  s: number;
  e: number;
  t: string;
}

/** What a meeting node keeps (see editor/meeting.svelte.ts). */
export interface MeetingAttrs {
  /** The recording being made or processed (kept in Rust until its result is taken). */
  recId: string | null;
  title: string;
  /** What this meeting records. */
  mic: boolean;
  system: boolean;
  /** The mixed audio, a library file. */
  fileId: string | null;
  durationMs: number;
  turns: MeetingTurn[];
  /** Names the user gave speakers, by speaker key. */
  names: Record<string, string>;
  language: string;
}

/** What the meeting node hands its block. */
export interface BlockProps {
  attrs: MeetingAttrs;
  editable: boolean;
  /** The page the block is on, for the title bar's recording dot to lead back to. */
  pageId: string | null;
  /** Changes the node's attributes. */
  update: (patch: Partial<MeetingAttrs>) => void;
}

export const EMPTY_MEETING: MeetingAttrs = {
  recId: null,
  title: '',
  mic: true,
  system: true,
  fileId: null,
  durationMs: 0,
  turns: [],
  names: {},
  language: '',
};

/** "0:12", "12:05", "1:02:03". */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

/** How a speaker is called: the name the user gave, else "Me" or "Speaker 2". */
export function speakerName(sp: string, names: Record<string, string>): string {
  const given = names[sp]?.trim();
  if (given) return given;
  return sp === 'me' ? t('blocks.meeting.me') : t('blocks.meeting.speaker', { number: Number(sp) || 1 });
}

/** The speakers in the order they first spoke. */
export function speakerKeys(turns: MeetingTurn[]): string[] {
  return [...new Set(turns.map((x) => x.sp))];
}

/** One line of the plain-text transcript: "Dana · 0:12 · text". */
export function turnLine(turn: MeetingTurn, names: Record<string, string>): string {
  return `${speakerName(turn.sp, names)} · ${clock(turn.s)} · ${turn.t}`;
}

/** The whole transcript, a line per turn. */
export function transcriptText(turns: MeetingTurn[], names: Record<string, string>): string {
  return turns.map((x) => turnLine(x, names)).join('\n');
}

/** What a meeting is as text (search, copying, exports): its title, then the transcript. */
export function meetingText(a: Pick<MeetingAttrs, 'title' | 'turns' | 'names'>): string {
  const body = transcriptText(a.turns, a.names);
  return [a.title.trim(), body].filter(Boolean).join('\n');
}

/** Reads a node's attributes into a complete, safe `MeetingAttrs` (documents can come from anywhere: sync, paste, older versions). */
export function readAttrs(raw: Record<string, unknown> | null | undefined): MeetingAttrs {
  const a = raw ?? {};
  const turns = Array.isArray(a.turns)
    ? (a.turns as unknown[]).flatMap((x) => {
        const r = x as Partial<MeetingTurn> | null;
        return r && typeof r.sp === 'string' && typeof r.t === 'string' && Number.isFinite(r.s) && Number.isFinite(r.e) ? [{ sp: r.sp, s: Number(r.s), e: Number(r.e), t: r.t }] : [];
      })
    : [];
  const names: Record<string, string> = {};
  if (a.names && typeof a.names === 'object') for (const [k, v] of Object.entries(a.names)) if (typeof v === 'string') names[k] = v;
  return {
    recId: typeof a.recId === 'string' ? a.recId : null,
    title: typeof a.title === 'string' ? a.title : '',
    mic: a.mic !== false,
    system: a.system !== false,
    fileId: typeof a.fileId === 'string' ? a.fileId : null,
    durationMs: Number.isFinite(a.durationMs) ? Number(a.durationMs) : 0,
    turns,
    names,
    language: typeof a.language === 'string' ? a.language : '',
  };
}
