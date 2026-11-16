/**
 * The browser stand-in for `/meet`'s Rust side (see src-tauri/src/meet): it
 * pretends to record, "processes" a canned call, and sends the same events
 * the real recorder does, so the interface tests can walk every state.
 *
 * Tests steer it through `window.__TD_MEET__`, set before the page loads:
 *   modelsMissing  the speech models aren't downloaded yet
 *   failDownload   the download fails
 *   failProcessing processing fails (once)
 *   screenDenied   system audio can't start: only the microphone is recorded
 *   micSilent      the microphone hears nothing
 *   tick           milliseconds between steps (default 40)
 */

import { emit } from '@tauri-apps/api/event';
import type { FileMeta } from './lib/types';

interface Steer {
  modelsMissing?: boolean;
  failDownload?: boolean;
  failProcessing?: boolean;
  screenDenied?: boolean;
  micSilent?: boolean;
  tick?: number;
}
const steer = (): Steer => (window as unknown as { __TD_MEET__?: Steer }).__TD_MEET__ ?? {};

interface Status {
  id: string;
  state: string;
  mic: boolean;
  system: boolean;
  durationMs: number;
  stage?: string | null;
  pct?: number | null;
  error?: string | null;
  result?: unknown;
  notices: { code: string; detail: string }[];
}

const TURNS = [
  { sp: '1', s: 300, e: 3800, t: 'Welcome everyone. Today we will review the project schedule.' },
  { sp: 'me', s: 4570, e: 7800, t: 'Thanks Daniel. I think the launch date is realistic.' },
  { sp: '2', s: 8410, e: 11680, t: 'I agree. We should confirm the budget next week.' },
];

const recs = new Map<string, Status & { timer?: ReturnType<typeof setInterval>; cancel?: boolean; paused?: boolean; title?: string }>();
let present = { whisper: false, speakers: false, started: false };
let downloading = false;
let cancelDownload = false;
let failedOnce = false;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tick = () => steer().tick ?? 40;

function modelsStatus() {
  if (!present.started) {
    present = { whisper: !steer().modelsMissing, speakers: !steer().modelsMissing, started: true };
  }
  return {
    whisper: [
      { id: 'fast', file: 'ggml-base.en.bin', size: 147964211, present: present.whisper },
      { id: 'balanced', file: 'ggml-small.bin', size: 487601967, present: present.whisper },
      { id: 'best', file: 'ggml-large-v3-turbo-q5_0.bin', size: 574041195, present: present.whisper },
    ],
    speakers: [
      { id: 'segmentation', file: 'pyannote-segmentation-3.0.onnx', size: 6958444, present: present.speakers },
      { id: 'embedding', file: '3dspeaker-campplus-zh-en.onnx', size: 28281164, present: present.speakers },
    ],
    diskBytes: present.whisper ? 700_000_000 : 0,
  };
}

const publish = (s: Status) => emit('td-meeting', { ...s, timer: undefined });

/** Eight seconds of near-silence at 8 kHz, enough for an audio element to load and seek in. */
function silentWav(seconds: number): Uint8Array {
  const rate = 8000;
  const n = rate * seconds;
  const out = new Uint8Array(44 + n);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  tag(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  tag(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true);
  tag(36, 'data');
  v.setUint32(40, n, true);
  out.fill(128, 44);
  return out;
}

async function processRec(r: NonNullable<ReturnType<typeof recs.get>>, addFile: (name: string, bytes: Uint8Array) => FileMeta) {
  r.cancel = false;
  r.state = 'processing';
  const stages: [string, number[]][] = [['mixing', [0]], ['transcribing', [0, 40, 80, 100]], ['speakers', [0, 60]], ['saving', [100]]];
  for (const [stage, pcts] of stages) {
    for (const pct of pcts) {
      if (r.cancel) {
        r.state = 'recorded';
        r.stage = null;
        await publish(r);
        return;
      }
      r.stage = stage;
      r.pct = pct;
      await publish(r);
      await wait(tick());
    }
  }
  if (steer().failProcessing && !failedOnce) {
    failedOnce = true;
    r.state = 'failed';
    r.stage = null;
    r.error = 'The speech model could not be loaded.';
    await publish(r);
    return;
  }
  const file = addFile(`${r.title || 'Meeting'}.wav`, silentWav(12));
  r.state = 'done';
  r.stage = null;
  r.error = null;
  r.result = { fileId: file.id, durationMs: 12282, turns: TURNS, language: 'en' };
  await publish(r);
}

export async function meetCommand(cmd: string, a: Record<string, any>, addFile: (name: string, bytes: Uint8Array) => FileMeta): Promise<unknown> {
  switch (cmd) {
    case 'meeting_supported':
      return true;
    case 'meeting_models_status':
      return modelsStatus();
    case 'meeting_models_download': {
      if (downloading) throw 'A download is already running.';
      downloading = true;
      cancelDownload = false;
      try {
        const total = 600_000_000;
        for (let i = 1; i <= 4; i++) {
          if (cancelDownload) throw 'cancelled';
          await emit('td-meeting-models', { file: 'ggml-large-v3-turbo-q5_0.bin', done: (total * i) / 4, total, stage: 'downloading' });
          await wait(tick());
        }
        if (steer().failDownload) throw "The download server answered 503.";
        present = { whisper: true, speakers: true, started: true };
      } finally {
        downloading = false;
      }
      return null;
    }
    case 'meeting_models_cancel':
      cancelDownload = true;
      return null;
    case 'meeting_models_delete':
      present = { whisper: false, speakers: false, started: true };
      return null;
    case 'meeting_open_privacy':
      (window as unknown as { __meetPrivacy?: string }).__meetPrivacy = a.pane;
      return null;
    case 'meeting_start': {
      const id = crypto.randomUUID().replace(/-/g, '');
      const notices: Status['notices'] = [];
      let system = !!a.system;
      if (system && steer().screenDenied) {
        system = false;
        notices.push({ code: 'screenDenied', detail: '' });
      }
      const r: Status & { timer?: ReturnType<typeof setInterval>; paused?: boolean } = { id, state: 'recording', mic: !!a.mic, system, durationMs: 0, notices };
      recs.set(id, r);
      let elapsed = 0;
      r.timer = setInterval(() => {
        if (!r.paused) elapsed += 100;
        r.durationMs = elapsed;
        const wave = Math.abs(Math.sin(elapsed / 300));
        void emit('td-meeting-levels', {
          id,
          mic: r.mic && !r.paused ? 0.05 + 0.2 * wave : 0,
          system: r.system && !r.paused ? 0.03 + 0.1 * (1 - wave) : 0,
          elapsedMs: elapsed,
          paused: !!r.paused,
          micSilent: !!steer().micSilent && elapsed > 600,
        });
      }, 100);
      await publish(r);
      return { ...r, timer: undefined };
    }
    case 'meeting_pause': {
      const r = recs.get(a.id);
      if (!r) throw 'That recording isn\'t running.';
      (r as { paused?: boolean }).paused = !!a.paused;
      r.state = a.paused ? 'paused' : 'recording';
      await publish(r);
      return { ...r, timer: undefined };
    }
    case 'meeting_stop': {
      const r = recs.get(a.id);
      if (!r) throw 'That recording isn\'t running.';
      clearInterval((r as { timer?: ReturnType<typeof setInterval> }).timer);
      (r as { title?: string }).title = a.settings?.title;
      r.state = 'processing';
      r.stage = 'mixing';
      r.pct = 0;
      void processRec(r as never, addFile);
      return { ...r, timer: undefined };
    }
    case 'meeting_process': {
      const r = recs.get(a.id);
      if (!r) throw 'That recording is gone.';
      (r as { title?: string }).title = a.settings?.title;
      void processRec(r as never, addFile);
      return { ...r, timer: undefined };
    }
    case 'meeting_cancel':
      (recs.get(a.id) as { cancel?: boolean } | undefined)!.cancel = true;
      return null;
    case 'meeting_status': {
      const r = recs.get(a.id);
      return r ? { ...r, timer: undefined } : null;
    }
    case 'meeting_active': {
      const r = [...recs.values()].find((x) => x.state === 'recording' || x.state === 'paused');
      return r ? { ...r, timer: undefined } : null;
    }
    case 'meeting_ack':
      recs.delete(a.id);
      return null;
    case 'meeting_discard': {
      const r = recs.get(a.id);
      if (r) clearInterval((r as { timer?: ReturnType<typeof setInterval> }).timer);
      recs.delete(a.id);
      await emit('td-meeting', { id: a.id, state: 'discarded', mic: false, system: false, durationMs: 0, notices: [] });
      return null;
    }
    case 'meeting_rediarize': {
      for (const pct of [0, 50, 100]) {
        await emit('td-meeting', { id: a.block, state: 'reidentifying', mic: false, system: false, durationMs: 0, pct, notices: [] });
        await wait(tick());
      }
      // Everyone but "me" is one person when the user says there were two in all.
      const turns = (a.turns as typeof TURNS).map((x) => (x.sp === 'me' || !a.speakers ? x : { ...x, sp: a.speakers <= 2 ? '1' : x.sp }));
      return turns.reduce<typeof TURNS>((out, x) => {
        const last = out[out.length - 1];
        if (last && last.sp === x.sp) last.t += ` ${x.t}`, (last.e = x.e);
        else out.push({ ...x });
        return out;
      }, []);
    }
    default:
      return null;
  }
}
