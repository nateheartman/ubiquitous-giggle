/**
 * `/meet`, the page's half: what the Rust recorder is doing (it lives there,
 * so a recording goes on when the note is closed), the speech models on disk,
 * and the settings that belong to meetings. The meeting block, the title bar's
 * red dot, the Meetings settings and the download sheet all read from here.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { MeetingTurn } from './meeting-text';
import { t } from './i18n';
import { listTypes, readTypes, type Defaults, type MeetingType, type TypesData } from './meeting-types';

export interface RecNotice {
  code: 'screenDenied' | 'systemFailed' | 'micFailed' | string;
  detail: string;
}

export interface RecResult {
  fileId: string;
  durationMs: number;
  turns: MeetingTurn[];
  language: string;
}

/** What Rust says about one recording. */
export interface RecStatus {
  id: string;
  /** recording, paused, recorded (saved, no transcript yet), processing, done, failed, discarded, reidentifying. */
  state: string;
  mic: boolean;
  system: boolean;
  durationMs: number;
  stage?: 'mixing' | 'transcribing' | 'speakers' | 'saving' | null;
  pct?: number | null;
  error?: string | null;
  result?: RecResult | null;
  notices: RecNotice[];
}

export interface RecLevels {
  id: string;
  mic: number;
  system: number;
  elapsedMs: number;
  paused: boolean;
  micSilent: boolean;
}

export interface ModelState {
  id: string;
  file: string;
  size: number;
  present: boolean;
}

export interface ModelsStatus {
  whisper: ModelState[];
  speakers: ModelState[];
  diskBytes: number;
}

export interface DownloadProgress {
  file: string;
  done: number;
  total: number;
  stage: 'downloading' | 'checking' | 'unpacking';
}

export type Quality = 'fast' | 'balanced' | 'best';
export type Sensitivity = 'fewer' | 'balanced' | 'more';

interface MeetSettings {
  model: Quality;
  /** A language code, or `auto`. */
  language: string;
  sensitivity: Sensitivity;
  mic: boolean;
  system: boolean;
}

const KEY = 'thoughtnotes.meet.v1';
const TYPES_KEY = 'thoughtnotes.meet.types.v1';

function loadTypes(): TypesData {
  try {
    return readTypes(JSON.parse(localStorage.getItem(TYPES_KEY) ?? 'null'));
  } catch {
    return readTypes(null);
  }
}

/** The built-in meeting types, in the interface's language. */
export function typeDefaults(): Defaults {
  return {
    general: { name: t('blocks.meeting.types.general.name'), instructions: t('blocks.meeting.types.general.instructions') },
    oneOnOne: { name: t('blocks.meeting.types.oneOnOne.name'), instructions: t('blocks.meeting.types.oneOnOne.instructions') },
    team: { name: t('blocks.meeting.types.team.name'), instructions: t('blocks.meeting.types.team.instructions') },
    sales: { name: t('blocks.meeting.types.sales.name'), instructions: t('blocks.meeting.types.sales.instructions') },
  };
}
const DEFAULTS: MeetSettings = { model: 'best', language: 'auto', sensitivity: 'balanced', mic: true, system: true };

function readSettings(): MeetSettings {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<MeetSettings>;
    return {
      model: p.model === 'fast' || p.model === 'balanced' || p.model === 'best' ? p.model : DEFAULTS.model,
      language: typeof p.language === 'string' && p.language ? p.language : DEFAULTS.language,
      sensitivity: p.sensitivity === 'fewer' || p.sensitivity === 'more' ? p.sensitivity : DEFAULTS.sensitivity,
      mic: p.mic !== false,
      system: p.system !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Languages whisper knows well enough to offer by name (the rest are auto-detected). */
export const LANGUAGES = ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'cs', 'el', 'tr', 'ru', 'uk', 'he', 'ar', 'hi', 'id', 'vi', 'th', 'zh', 'ja', 'ko'] as const;

class Meeting {
  /** False off a Mac (and until Rust has answered): `/meet` is hidden. */
  supported = $state(false);
  models = $state<ModelsStatus | null>(null);
  statuses = $state<Record<string, RecStatus>>({});
  levels = $state<Record<string, RecLevels>>({});
  download = $state<{ progress: DownloadProgress | null; running: boolean; error: string | null }>({ progress: null, running: false, error: null });
  /** The download sheet, while it's open: resolves true once the models are there. */
  sheet = $state<{ resolve: (ok: boolean) => void } | null>(null);
  settings = $state<MeetSettings>(readSettings());
  /** Meeting types: edited built-ins and the user's own, kept on this Mac. */
  types = $state<TypesData>(loadTypes());
  typeList: MeetingType[] = $derived(listTypes(this.types, typeDefaults()));
  /** Which page each recording was started on (for the title bar's dot to go back to). */
  pages: Record<string, string> = {};

  #started = false;

  /** The recording or paused one, if any. */
  recording = $derived(Object.values(this.statuses).find((s) => s.state === 'recording' || s.state === 'paused'));

  init() {
    if (this.#started) return;
    this.#started = true;
    void (async () => {
      // The page can load a moment before the backend (or its stand-in) answers.
      for (let tries = 0; tries < 20; tries++) {
        try {
          this.supported = await invoke<boolean>('meeting_supported');
          break;
        } catch {
          this.supported = false;
          await new Promise((r) => setTimeout(r, 150));
        }
      }
      if (!this.supported) return;
      try {
        await listen<RecStatus>('td-meeting', (e) => this.#take(e.payload));
        await listen<RecLevels>('td-meeting-levels', (e) => (this.levels[e.payload.id] = e.payload));
        await listen<DownloadProgress>('td-meeting-models', (e) => (this.download.progress = e.payload));
        const active = await invoke<RecStatus | null>('meeting_active');
        if (active) this.#take(active);
      } catch (e) {
        console.warn('meeting events unavailable', e);
      }
    })();
  }

  #take(s: RecStatus) {
    if (s.state === 'discarded') {
      delete this.statuses[s.id];
      delete this.levels[s.id];
      return;
    }
    // Progress sent for a re-run belongs to the block that asked, not a recording of its own.
    this.statuses[s.id] = { ...this.statuses[s.id], ...s };
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify($state.snapshot(this.settings)));
    } catch {
      /* storage unavailable: the choice lasts until the app closes */
    }
  }

  saveTypes() {
    try {
      localStorage.setItem(TYPES_KEY, JSON.stringify($state.snapshot(this.types)));
    } catch {
      /* storage unavailable: the types last until the app closes */
    }
  }

  // ---- models

  async refreshModels(): Promise<ModelsStatus | null> {
    try {
      this.models = await invoke<ModelsStatus>('meeting_models_status');
    } catch {
      this.models = null;
    }
    return this.models;
  }

  /** Whether everything the chosen quality needs is on disk. */
  ready(m: ModelsStatus | null = this.models): boolean {
    if (!m) return false;
    return !!m.whisper.find((x) => x.id === this.settings.model)?.present && m.speakers.every((x) => x.present);
  }

  /** Bytes still to download for the chosen quality. */
  missingBytes(m: ModelsStatus | null = this.models): number {
    if (!m) return 0;
    const need = [m.whisper.find((x) => x.id === this.settings.model), ...m.speakers];
    return need.reduce((n, x) => n + (x && !x.present ? x.size : 0), 0);
  }

  /**
   * True when the models are there. If they aren't, opens the sheet that
   * explains the download and waits for the person to download them or
   * close it.
   */
  async ensureModels(): Promise<boolean> {
    await this.refreshModels();
    if (this.ready()) return true;
    if (this.sheet) return false;
    this.download = { progress: null, running: false, error: null };
    return new Promise<boolean>((resolve) => {
      this.sheet = { resolve };
    });
  }

  closeSheet(ok: boolean) {
    const s = this.sheet;
    this.sheet = null;
    s?.resolve(ok);
  }

  async startDownload() {
    if (this.download.running) return;
    this.download = { progress: null, running: true, error: null };
    try {
      await invoke('meeting_models_download', { whisper: this.settings.model });
      await this.refreshModels();
      this.download = { progress: null, running: false, error: null };
      if (this.ready()) this.closeSheet(true);
    } catch (e) {
      const msg = String(e);
      this.download = { progress: null, running: false, error: msg === 'cancelled' ? null : msg };
      await this.refreshModels();
    }
  }

  cancelDownload() {
    void invoke('meeting_models_cancel');
  }

  async deleteModels() {
    await invoke('meeting_models_delete');
    await this.refreshModels();
  }

  // ---- recording

  processArgs(title: string, speakers: number | null = null) {
    return {
      model: this.settings.model,
      language: this.settings.language === 'auto' ? null : this.settings.language,
      sensitivity: this.settings.sensitivity,
      speakers,
      title,
    };
  }

  /** Starts recording; returns the new recording's id, or null if the models were declined. */
  async start(opts: { mic: boolean; system: boolean }, pageId: string | null): Promise<string | null> {
    if (!(await this.ensureModels())) return null;
    const s = await invoke<RecStatus>('meeting_start', opts);
    this.#take(s);
    if (pageId) this.pages[s.id] = pageId;
    return s.id;
  }

  async pause(id: string, paused: boolean) {
    this.#take(await invoke<RecStatus>('meeting_pause', { id, paused }));
  }

  async stop(id: string, title: string) {
    this.#take(await invoke<RecStatus>('meeting_stop', { id, settings: this.processArgs(title) }));
  }

  /** Processes a saved recording again (after a failure, a cancel, or the app closing). */
  async process(id: string, title: string) {
    if (!(await this.ensureModels())) return;
    this.#take(await invoke<RecStatus>('meeting_process', { id, settings: this.processArgs(title) }));
  }

  cancel(id: string) {
    void invoke('meeting_cancel', { id });
  }

  async discard(id: string) {
    await invoke('meeting_discard', { id });
    delete this.statuses[id];
    delete this.levels[id];
  }

  /** What Rust knows of a recording now (null: it's gone). */
  async refresh(id: string): Promise<RecStatus | null> {
    const s = await invoke<RecStatus | null>('meeting_status', { id });
    if (s) this.#take(s);
    else delete this.statuses[id];
    return s;
  }

  /** The block has put a finished result into the note. */
  async ack(id: string) {
    await invoke('meeting_ack', { id });
    delete this.statuses[id];
    delete this.levels[id];
  }

  openPrivacy(pane: 'screen' | 'microphone') {
    void invoke('meeting_open_privacy', { pane });
  }

  /** Works out who said what again over the saved audio. `block` names where progress goes. */
  async rediarize(block: string, fileId: string, turns: MeetingTurn[], speakers: number | null): Promise<MeetingTurn[]> {
    return invoke<MeetingTurn[]>('meeting_rediarize', { block, fileId, turns, speakers, sensitivity: this.settings.sensitivity });
  }
}

export const meeting = new Meeting();
meeting.init();
