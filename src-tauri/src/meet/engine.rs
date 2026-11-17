//! The commands behind `/meet`, and the recorder and processing jobs they run.
//!
//! Everything lives here in Rust, not in the page: a recording goes on when
//! the note is closed or another page opened, and the block finds it again by
//! its id. Each recording has a folder under `meetings/` holding its two
//! tracks and a `meta.json`; the tracks go once the transcript is made.

use super::attribute::{self, Mode, Turn};
use super::capture::{Notice, Options, Recorder};
use super::models::{self, ModelsStatus};
use super::{audio, diarize, summarize, transcribe, wav};
use crate::db::{Db, Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

/// Where models and recordings live: the app's own folder, never the notes
/// folder (which may be synced, and shouldn't carry gigabytes of models).
/// THOUGHTNOTES_MEET_DIR points it elsewhere, for testing.
fn root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    if let Some(dir) = std::env::var_os("THOUGHTNOTES_MEET_DIR").filter(|d| !d.is_empty()) {
        return Ok(PathBuf::from(dir));
    }
    Ok(app.path().app_local_data_dir()?)
}

fn models_dir(app: &AppHandle) -> Result<PathBuf> {
    Ok(root(app)?.join("models"))
}

/// A recording's folder. Ids are 32 hex digits and nothing else, so one can
/// never name a path outside `meetings/`.
fn rec_dir<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<PathBuf> {
    if id.len() != 32 || !id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) {
        return Err(Error("Unknown recording".into()));
    }
    Ok(root(app)?.join("meetings").join(id))
}

// ---- what's remembered about a recording

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
struct Meta {
    id: String,
    /// "recording", "recorded" (tracks saved, not yet processed), "processing",
    /// "done" or "failed".
    state: String,
    mic: bool,
    system: bool,
    duration_ms: u64,
    error: Option<String>,
    result: Option<MeetingResult>,
    notices: Vec<NoticeOut>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MeetingResult {
    /// The mixed recording, in the library.
    file_id: String,
    duration_ms: u64,
    turns: Vec<Turn>,
    language: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct NoticeOut {
    code: String,
    detail: String,
}

fn read_meta(dir: &Path) -> Option<Meta> {
    serde_json::from_slice(&std::fs::read(dir.join("meta.json")).ok()?).ok()
}

fn write_meta(dir: &Path, meta: &Meta) {
    if let Ok(bytes) = serde_json::to_vec(meta) {
        let tmp = dir.join("meta.json.tmp");
        if std::fs::write(&tmp, bytes).is_ok() {
            let _ = std::fs::rename(&tmp, dir.join("meta.json"));
        }
    }
}

// ---- what the interface is told

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    id: String,
    /// "recording", "paused", "recorded", "processing", "done" or "failed".
    state: String,
    mic: bool,
    system: bool,
    duration_ms: u64,
    /// While processing: "mixing", "transcribing", "speakers" or "saving", and how far along.
    stage: Option<String>,
    pct: Option<i32>,
    error: Option<String>,
    result: Option<MeetingResult>,
    notices: Vec<NoticeOut>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct LevelsOut {
    id: String,
    mic: f32,
    system: f32,
    elapsed_ms: u64,
    paused: bool,
    mic_silent: bool,
}

// ---- the running parts

struct Live {
    id: String,
    recorder: Recorder,
    meta: Meta,
}

struct Job {
    cancel: Arc<AtomicBool>,
    stage: String,
    pct: i32,
}

#[derive(Default)]
struct Inner {
    live: Option<Live>,
    jobs: HashMap<String, Job>,
}

/// Managed by the app: the recording in progress and the jobs working on
/// finished ones (a second recording can start while the first is processed).
#[derive(Default)]
pub struct MeetState {
    inner: Mutex<Inner>,
    downloading: AtomicBool,
    cancel_download: Arc<AtomicBool>,
    /// Held while a big model is loaded (the speech models while a recording
    /// is processed, or the summary model): one at a time, so they're never
    /// in memory together.
    model_gate: Mutex<()>,
    /// The summaries asked for, by block, and how to stop each.
    summary_cancel: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// The summary model's checksum was checked this run.
    summary_verified: AtomicBool,
}

/// Waits until no other model is loaded (see `MeetState::model_gate`).
pub(crate) fn model_gate(state: &MeetState) -> std::sync::MutexGuard<'_, ()> {
    state.model_gate.lock().unwrap_or_else(|p| p.into_inner())
}

/// Runs `f` once no other model is loaded.
fn with_models<T>(state: &MeetState, f: impl FnOnce() -> T) -> T {
    let _turn = model_gate(state);
    f()
}

fn lock(state: &MeetState) -> std::sync::MutexGuard<'_, Inner> {
    state.inner.lock().unwrap_or_else(|p| p.into_inner())
}

fn emit_status<R: Runtime>(app: &AppHandle<R>, status: &Status) {
    let _ = app.emit("td-meeting", status);
}

fn status_of_meta(meta: &Meta, job: Option<&Job>) -> Status {
    // A recording the app was closed on is still on disk: it can be processed now.
    let state = match (meta.state.as_str(), job) {
        ("recording", _) => "recorded",
        ("processing", None) => "recorded",
        (s, _) => s,
    };
    Status {
        id: meta.id.clone(),
        state: state.into(),
        mic: meta.mic,
        system: meta.system,
        duration_ms: meta.duration_ms,
        stage: job.map(|j| j.stage.clone()),
        pct: job.map(|j| j.pct),
        error: meta.error.clone(),
        result: meta.result.clone(),
        notices: meta.notices.clone(),
    }
}

fn current_status(app: &AppHandle, state: &MeetState, id: &str) -> Option<Status> {
    {
        let g = lock(state);
        if let Some(live) = g.live.as_ref().filter(|l| l.id == id) {
            let lv = live.recorder.levels();
            let mut s = status_of_meta(&live.meta, None);
            s.state = if lv.paused { "paused" } else { "recording" }.into();
            s.duration_ms = lv.elapsed_ms;
            return Some(s);
        }
        if let Some(job) = g.jobs.get(id) {
            let dir = rec_dir(app, id).ok()?;
            return read_meta(&dir).map(|m| status_of_meta(&m, Some(job)));
        }
    }
    let dir = rec_dir(app, id).ok()?;
    read_meta(&dir).map(|m| status_of_meta(&m, None))
}

// ---- settings and models

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// "fast", "balanced" or "best".
    model: String,
    /// A language code, or none to detect it.
    language: Option<String>,
    /// "fewer", "balanced" or "more" speakers.
    sensitivity: String,
    /// How many people there were, if the user said.
    speakers: Option<u32>,
    /// The meeting's title, for the audio file's name.
    title: String,
}

#[tauri::command(async)]
pub fn meeting_supported() -> bool {
    true
}

#[tauri::command(async)]
pub fn meeting_models_status(app: AppHandle) -> Result<ModelsStatus> {
    Ok(models::status(&models_dir(&app)?))
}

/// Downloads what `whisper` (a model choice) and the speaker models need and
/// don't have yet. Returns when done; progress goes out as `td-meeting-models`.
#[tauri::command(async)]
pub fn meeting_models_download(app: AppHandle, state: State<MeetState>, whisper: String) -> Result<()> {
    let list = models::needed(&whisper).ok_or_else(|| Error("Unknown model".into()))?;
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err(Error("A download is already running.".into()));
    }
    state.cancel_download.store(false, Ordering::SeqCst);
    let dir = models_dir(&app)?;
    let result = models::download(&dir, &list, &state.cancel_download, &mut |p| {
        let _ = app.emit("td-meeting-models", p);
    });
    state.downloading.store(false, Ordering::SeqCst);
    result.map_err(Error)
}

#[tauri::command]
pub fn meeting_models_cancel(state: State<MeetState>) {
    state.cancel_download.store(true, Ordering::SeqCst);
}

#[tauri::command(async)]
pub fn meeting_models_delete(app: AppHandle, state: State<MeetState>) -> Result<()> {
    {
        let g = lock(&state);
        if g.live.is_some() || !g.jobs.is_empty() || state.downloading.load(Ordering::SeqCst) {
            return Err(Error("Models are in use right now. Try again when the meeting has finished processing.".into()));
        }
    }
    models::delete_all(&models_dir(&app)?)?;
    Ok(())
}

/// Downloads the optional summary model. Progress goes out as
/// `td-meeting-models`, and `meeting_models_cancel` stops it, as for the
/// speech models.
#[tauri::command(async)]
pub fn meeting_summary_model_download(app: AppHandle, state: State<MeetState>) -> Result<()> {
    if state.downloading.swap(true, Ordering::SeqCst) {
        return Err(Error("A download is already running.".into()));
    }
    state.cancel_download.store(false, Ordering::SeqCst);
    let dir = models_dir(&app)?;
    let result = models::download(&dir, &[&models::SUMMARY], &state.cancel_download, &mut |p| {
        let _ = app.emit("td-meeting-models", p);
    });
    state.downloading.store(false, Ordering::SeqCst);
    result.map_err(Error)
}

/// How a summary is going, sent as `td-meeting-summary`.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SummaryProgress<'a> {
    block: &'a str,
    /// "waiting" (for a recording being processed, or another summary) or "writing".
    state: &'a str,
    text: &'a str,
    pct: u8,
}

/// Writes a meeting's summary with the local model and returns it (Markdown).
/// `lines` is the transcript as "Name (m:ss): text"; `instructions` come from
/// the meeting's type. `block` is the name progress goes out under and that
/// `meeting_summary_cancel` stops.
#[tauri::command(async)]
pub fn meeting_summarize(app: AppHandle, state: State<MeetState>, block: String, title: String, lines: Vec<String>, instructions: String) -> Result<String> {
    let mdir = models_dir(&app)?;
    if !models::is_present(&mdir, &models::SUMMARY) {
        return Err(Error("The summary model isn't downloaded yet.".into()));
    }
    let cancel = Arc::new(AtomicBool::new(false));
    state.summary_cancel.lock().unwrap_or_else(|p| p.into_inner()).insert(block.clone(), cancel.clone());
    let result = summarize_now(&app, &state, &mdir, &block, &title, &lines, &instructions, &cancel);
    state.summary_cancel.lock().unwrap_or_else(|p| p.into_inner()).remove(&block);
    result
}

#[allow(clippy::too_many_arguments)]
fn summarize_now(app: &AppHandle, state: &MeetState, mdir: &Path, block: &str, title: &str, lines: &[String], instructions: &str, cancel: &AtomicBool) -> Result<String> {
    let send = |st: &str, text: &str, pct: u8| {
        let _ = app.emit("td-meeting-summary", SummaryProgress { block, state: st, text, pct });
    };
    send("waiting", "", 0);
    // Recordings waiting to be processed go first; then wait for the model gate (a recording being
    // processed, or another summary).
    let _turn = loop {
        if cancel.load(Ordering::SeqCst) {
            return Err(Error("cancelled".into()));
        }
        if lock(state).jobs.is_empty() {
            match state.model_gate.try_lock() {
                Ok(g) => break g,
                Err(std::sync::TryLockError::Poisoned(p)) => break p.into_inner(),
                Err(std::sync::TryLockError::WouldBlock) => {}
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    };
    send("writing", "", 0);
    if !state.summary_verified.load(Ordering::SeqCst) {
        models::verify(mdir, &models::SUMMARY).map_err(Error)?;
        state.summary_verified.store(true, Ordering::SeqCst);
    }
    summarize::run(&models::path_of(mdir, &models::SUMMARY), title, lines, instructions, cancel, &mut |text, pct| send("writing", text, pct)).map_err(Error)
}

#[tauri::command]
pub fn meeting_summary_cancel(state: State<MeetState>, block: String) {
    if let Some(c) = state.summary_cancel.lock().unwrap_or_else(|p| p.into_inner()).get(&block) {
        c.store(true, Ordering::SeqCst);
    }
}

#[tauri::command(async)]
pub fn meeting_summary_model_delete(app: AppHandle, state: State<MeetState>) -> Result<()> {
    let _writing = state.model_gate.try_lock().map_err(|_| Error("The summary model is in use right now. Try again when the summary is written.".into()))?;
    if state.downloading.load(Ordering::SeqCst) {
        return Err(Error("A download is running. Try again when it has finished.".into()));
    }
    models::delete_one(&models_dir(&app)?, &models::SUMMARY)?;
    Ok(())
}

/// Opens the System Settings pane where a permission is granted.
#[tauri::command]
pub fn meeting_open_privacy(app: AppHandle, pane: String) -> Result<()> {
    let which = match pane.as_str() {
        "microphone" => "Privacy_Microphone",
        "screen" => "Privacy_ScreenCapture",
        _ => return Err(Error("Unknown pane".into())),
    };
    app.opener()
        .open_url(format!("x-apple.systempreferences:com.apple.preference.security?{which}"), None::<&str>)
        .map_err(|e| Error(e.to_string()))
}

// ---- recording

#[tauri::command(async)]
pub fn meeting_start(app: AppHandle, state: State<MeetState>, mic: bool, system: bool) -> Result<Status> {
    if !mic && !system {
        return Err(Error("Choose something to record.".into()));
    }
    let id = uuid::Uuid::new_v4().simple().to_string();
    let dir = rec_dir(&app, &id)?;
    {
        let g = lock(&state);
        if g.live.is_some() {
            return Err(Error("A meeting is already being recorded.".into()));
        }
    }
    let (recorder, notices) = Recorder::start(&dir, Options { mic, system }).map_err(Error)?;
    let meta = Meta {
        id: id.clone(),
        state: "recording".into(),
        mic: recorder_has(&dir, super::capture::MIC_FILE),
        system: recorder_has(&dir, super::capture::SYS_FILE),
        notices: notices.iter().map(notice_out).collect(),
        ..Default::default()
    };
    write_meta(&dir, &meta);
    let status = {
        let mut g = lock(&state);
        let mut s = status_of_meta(&meta, None);
        s.state = "recording".into();
        g.live = Some(Live { id: id.clone(), recorder, meta });
        s
    };
    emit_status(&app, &status);
    spawn_ticker(app.clone(), id);
    Ok(status)
}

fn recorder_has(dir: &Path, file: &str) -> bool {
    dir.join(file).exists()
}

fn notice_out(n: &Notice) -> NoticeOut {
    let (code, detail) = n.parts();
    NoticeOut { code: code.into(), detail }
}

/// Sends the levels to the interface ten times a second while `id` records.
fn spawn_ticker(app: AppHandle, id: String) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(100));
        let state = app.state::<MeetState>();
        let g = lock(&state);
        let Some(live) = g.live.as_ref().filter(|l| l.id == id) else { return };
        let lv = live.recorder.levels();
        let _ = app.emit(
            "td-meeting-levels",
            LevelsOut { id: id.clone(), mic: lv.mic, system: lv.sys, elapsed_ms: lv.elapsed_ms, paused: lv.paused, mic_silent: lv.mic_silent },
        );
    });
}

#[tauri::command(async)]
pub fn meeting_pause(app: AppHandle, state: State<MeetState>, id: String, paused: bool) -> Result<Status> {
    {
        let g = lock(&state);
        let live = g.live.as_ref().filter(|l| l.id == id).ok_or_else(|| Error("That recording isn't running.".into()))?;
        live.recorder.set_paused(paused);
    }
    let status = current_status(&app, &state, &id).ok_or_else(|| Error("Unknown recording".into()))?;
    emit_status(&app, &status);
    Ok(status)
}

/// Ends the recording in progress (if it's `id`), saving both tracks.
fn finish_recording<R: Runtime>(app: &AppHandle<R>, state: &MeetState, id: &str) -> Result<Meta> {
    let live = {
        let mut g = lock(state);
        match g.live.take() {
            Some(l) if l.id == id => l,
            other => {
                g.live = other;
                return Err(Error("That recording isn't running.".into()));
            }
        }
    };
    let dir = rec_dir(app, id)?;
    let finished = live.recorder.stop();
    let mut meta = live.meta;
    meta.state = "recorded".into();
    meta.duration_ms = finished.duration_ms;
    meta.mic = finished.mic.is_some();
    meta.system = finished.sys.is_some();
    write_meta(&dir, &meta);
    Ok(meta)
}

/// Stops the recording and starts turning it into a transcript.
#[tauri::command(async)]
pub fn meeting_stop(app: AppHandle, state: State<MeetState>, id: String, settings: Settings) -> Result<Status> {
    let meta = finish_recording(&app, &state, &id)?;
    if meta.duration_ms < 1000 {
        // A slip of the button: nothing to transcribe.
        let _ = std::fs::remove_dir_all(rec_dir(&app, &id)?);
        let status = Status { id, state: "discarded".into(), ..Default::default() };
        emit_status(&app, &status);
        return Ok(status);
    }
    start_processing(&app, &state, &id, settings)
}

/// Processes a recording that was saved but not finished (after a failure,
/// a cancel, or the app being closed mid-recording).
#[tauri::command(async)]
pub fn meeting_process(app: AppHandle, state: State<MeetState>, id: String, settings: Settings) -> Result<Status> {
    start_processing(&app, &state, &id, settings)
}

fn start_processing(app: &AppHandle, state: &MeetState, id: &str, settings: Settings) -> Result<Status> {
    let dir = rec_dir(app, id)?;
    let mut meta = read_meta(&dir).ok_or_else(|| Error("That recording is gone.".into()))?;
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut g = lock(state);
        if g.jobs.contains_key(id) {
            return Err(Error("That recording is already being processed.".into()));
        }
        g.jobs.insert(id.to_string(), Job { cancel: cancel.clone(), stage: "mixing".into(), pct: 0 });
    }
    meta.state = "processing".into();
    meta.error = None;
    write_meta(&dir, &meta);
    let status = current_status(app, state, id).ok_or_else(|| Error("Unknown recording".into()))?;
    emit_status(app, &status);

    let app2 = app.clone();
    let id2 = id.to_string();
    std::thread::Builder::new()
        .name("meet-process".into())
        .stack_size(16 << 20)
        .spawn(move || {
            let state = app2.state::<MeetState>();
            let outcome = with_models(&state, || process(&app2, &id2, &dir, &settings, &cancel));
            let mut meta = read_meta(&dir).unwrap_or_default();
            match outcome {
                Ok(result) => {
                    meta.state = "done".into();
                    meta.error = None;
                    meta.result = Some(result);
                    // The tracks have done their job.
                    for f in [super::capture::MIC_FILE, super::capture::SYS_FILE, "mix.wav"] {
                        let _ = std::fs::remove_file(dir.join(f));
                    }
                }
                Err(e) if e == "cancelled" => {
                    meta.state = "recorded".into();
                    meta.error = None;
                }
                Err(e) => {
                    // Kept as they are so Retry can run again.
                    meta.state = "failed".into();
                    meta.error = Some(e);
                }
            }
            write_meta(&dir, &meta);
            lock(&state).jobs.remove(&id2);
            if let Some(s) = current_status(&app2, &state, &id2) {
                emit_status(&app2, &s);
            }
        })
        .map_err(|e| Error(e.to_string()))?;
    Ok(status)
}

fn set_stage(app: &AppHandle, id: &str, stage: &str, pct: i32) {
    let state = app.state::<MeetState>();
    {
        let mut g = lock(&state);
        if let Some(j) = g.jobs.get_mut(id) {
            j.stage = stage.into();
            j.pct = pct;
        }
    }
    if let Some(s) = current_status(app, &state, id) {
        emit_status(app, &s);
    }
}

/// The whole pipeline for one recording: mix, transcribe, find speakers,
/// label, and store the audio in the library.
fn process(app: &AppHandle, id: &str, dir: &Path, settings: &Settings, cancel: &Arc<AtomicBool>) -> std::result::Result<MeetingResult, String> {
    let mdir = models_dir(app).map_err(|e| e.0)?;
    let model = models::whisper(&settings.model).ok_or("Unknown speech model")?;
    for m in models::needed(&settings.model).ok_or("Unknown speech model")? {
        if !models::is_present(&mdir, m) {
            return Err("The speech models aren't downloaded yet.".into());
        }
        models::verify(&mdir, m)?;
    }
    let meta = read_meta(dir).ok_or("The recording's notes are missing.")?;
    let tracks = Tracks::of(dir, &meta);
    let hooks = Hooks {
        stage: {
            let app = app.clone();
            let id = id.to_string();
            Arc::new(move |stage, pct| set_stage(&app, &id, stage, pct))
        },
        save: {
            let app = app.clone();
            Box::new(move |path, name| {
                let db = app.state::<Db>();
                db.import_file_from_path(path, name, "audio/wav").map(|f| f.id).map_err(|e| e.0)
            })
        },
    };
    run_pipeline(dir, &mdir, model, &tracks, settings, cancel, &hooks)
}

struct Tracks {
    mic: Option<PathBuf>,
    sys: Option<PathBuf>,
}

impl Tracks {
    fn of(dir: &Path, meta: &Meta) -> Tracks {
        let pick = |on: bool, f: &str| (on && dir.join(f).exists()).then(|| dir.join(f));
        Tracks { mic: pick(meta.mic, super::capture::MIC_FILE), sys: pick(meta.system, super::capture::SYS_FILE) }
    }
}

type StageFn = Arc<dyn Fn(&str, i32) + Send + Sync>;
type SaveFn = Box<dyn Fn(&Path, &str) -> std::result::Result<String, String>>;

/// What the pipeline needs from the app around it, so a test can run it bare.
struct Hooks {
    /// Told each stage and how far along it is (0-100).
    stage: StageFn,
    /// Stores the mixed audio in the library and returns its file id.
    save: SaveFn,
}

fn run_pipeline(
    dir: &Path,
    mdir: &Path,
    model: &models::Model,
    tracks: &Tracks,
    settings: &Settings,
    cancel: &Arc<AtomicBool>,
    hooks: &Hooks,
) -> std::result::Result<MeetingResult, String> {
    let check = || if cancel.load(Ordering::Relaxed) { Err("cancelled".to_string()) } else { Ok(()) };
    if tracks.mic.is_none() && tracks.sys.is_none() {
        return Err("The recording's audio is gone.".into());
    }

    // 1. One mixed buffer, with each track's loudness measured on the way.
    (hooks.stage)("mixing", 0);
    let mixed = audio::mix_tracks(tracks.mic.as_deref(), tracks.sys.as_deref()).map_err(|e| format!("Couldn't read the recording: {e}"))?;
    let duration_ms = mixed.samples.len() as u64 * 1000 / wav::RATE as u64;
    if mixed.samples.is_empty() {
        return Err("The recording is empty.".into());
    }
    let mix_path = dir.join("mix.wav");
    {
        let mut w = wav::WavWriter::create(&mix_path).map_err(|e| e.to_string())?;
        for piece in mixed.samples.chunks(1 << 16) {
            w.write_f32(piece).map_err(|e| e.to_string())?;
        }
        w.finish().map_err(|e| e.to_string())?;
    }
    check()?;

    // 2. Speech to text, once, over the mix.
    (hooks.stage)("transcribing", 0);
    let progress = {
        let stage = hooks.stage.clone();
        let mut last = -1;
        move |p: i32| {
            if p != last {
                last = p;
                stage("transcribing", p);
            }
        }
    };
    let env = mixed.env.clone();
    let transcript = transcribe::run(&models::path_of(mdir, model), &mixed.samples, settings.language.as_deref(), progress, cancel.clone())?;
    drop(mixed); // the mix is done with; the speaker model loads a track of its own
    check()?;

    // 3. Who spoke: the system track when there is one (the user's own voice
    // is told apart by loudness), otherwise the only track there is.
    let mode = if tracks.mic.is_some() && tracks.sys.is_some() { Mode::Both } else { Mode::Single };
    let diar_track = tracks.sys.as_ref().or(tracks.mic.as_ref()).ok_or("no audio")?;
    let spans = if transcript.segs.is_empty() {
        Vec::new()
    } else {
        (hooks.stage)("speakers", 0);
        let samples = wav::WavReader::open(diar_track).and_then(|r| r.read_all()).map_err(|e| e.to_string())?;
        let progress = {
            let stage = hooks.stage.clone();
            move |p: i32| stage("speakers", p)
        };
        diarize::run(
            &models::path_of(mdir, &models::SEGMENTATION),
            &models::path_of(mdir, &models::EMBEDDING),
            samples,
            settings.speakers,
            diarize::threshold_for(&settings.sensitivity),
            progress,
            cancel.clone(),
        )?
    };
    check()?;

    let pieces = attribute::attribute(&transcript.segs, &env, &spans, mode);
    let turns = attribute::merge_turns(&pieces);

    // 4. The audio goes into the library, attached to the page like any file.
    (hooks.stage)("saving", 100);
    let name = format!("{}.wav", file_stem(&settings.title));
    let file_id = (hooks.save)(&mix_path, &name)?;
    Ok(MeetingResult { file_id, duration_ms, turns, language: transcript.language })
}

/// A title as a file name: no slashes, and not empty.
fn file_stem(title: &str) -> String {
    let t: String = title.chars().filter(|c| !c.is_control() && !matches!(c, '/' | '\\' | ':')).collect();
    let t = t.trim();
    if t.is_empty() { "Meeting".into() } else { t.chars().take(80).collect() }
}

#[tauri::command]
pub fn meeting_cancel(state: State<MeetState>, id: String) {
    if let Some(job) = lock(&state).jobs.get(&id) {
        job.cancel.store(true, Ordering::SeqCst);
    }
}

#[tauri::command(async)]
pub fn meeting_status(app: AppHandle, state: State<MeetState>, id: String) -> Option<Status> {
    current_status(&app, &state, &id)
}

/// The recording in progress, if any: how the page finds it again after a reload.
#[tauri::command(async)]
pub fn meeting_active(app: AppHandle, state: State<MeetState>) -> Option<Status> {
    let id = lock(&state).live.as_ref().map(|l| l.id.clone())?;
    current_status(&app, &state, &id)
}

/// The block has taken the result into the note: the recording's folder can go.
#[tauri::command(async)]
pub fn meeting_ack(app: AppHandle, state: State<MeetState>, id: String) -> Result<()> {
    let busy = {
        let g = lock(&state);
        g.live.as_ref().is_some_and(|l| l.id == id) || g.jobs.contains_key(&id)
    };
    if !busy {
        let dir = rec_dir(&app, &id)?;
        if read_meta(&dir).is_some_and(|m| m.state == "done") {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
    Ok(())
}

/// Throws a recording away: stops it, cancels its processing, deletes its tracks.
#[tauri::command(async)]
pub fn meeting_discard(app: AppHandle, state: State<MeetState>, id: String) -> Result<()> {
    let dir = rec_dir(&app, &id)?;
    let live = {
        let mut g = lock(&state);
        if let Some(job) = g.jobs.get(&id) {
            job.cancel.store(true, Ordering::SeqCst);
        }
        match g.live.take() {
            Some(l) if l.id == id => Some(l),
            other => {
                g.live = other;
                None
            }
        }
    };
    if let Some(l) = live {
        let _ = l.recorder.stop();
    }
    // A job that was cancelled finishes on its own and rewrites meta.json, so wait for it.
    for _ in 0..100 {
        if !lock(&state).jobs.contains_key(&id) {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    let _ = std::fs::remove_dir_all(dir);
    let status = Status { id, state: "discarded".into(), ..Default::default() };
    emit_status(&app, &status);
    Ok(())
}

/// Runs the speaker model again over a finished meeting's audio and relabels
/// its turns, keeping "Me" where it was. `block` is only the name the progress
/// goes out under.
#[tauri::command(async)]
pub fn meeting_rediarize(app: AppHandle, db: State<Db>, block: String, file_id: String, turns: Vec<Turn>, speakers: Option<u32>, sensitivity: String) -> Result<Vec<Turn>> {
    let mdir = models_dir(&app)?;
    for m in [&models::SEGMENTATION, &models::EMBEDDING] {
        if !models::is_present(&mdir, m) {
            return Err(Error("The speaker models aren't downloaded yet.".into()));
        }
        models::verify(&mdir, m).map_err(Error)?;
    }
    let (path, _) = db.file_path(&file_id)?;
    let samples = wav::WavReader::open(&path).and_then(|r| r.read_all()).map_err(|e| Error(e.to_string()))?;
    let progress = {
        let app = app.clone();
        move |p: i32| {
            let _ = app.emit("td-meeting", Status { id: block.clone(), state: "reidentifying".into(), pct: Some(p), ..Default::default() });
        }
    };
    let spans = diarize::run(
        &models::path_of(&mdir, &models::SEGMENTATION),
        &models::path_of(&mdir, &models::EMBEDDING),
        samples,
        speakers,
        diarize::threshold_for(&sensitivity),
        progress,
        Arc::new(AtomicBool::new(false)),
    )
    .map_err(Error)?;
    Ok(attribute::merge_turns(&attribute::relabel(&turns, &spans)))
}

// ---- quitting

/// Called before a quit. While a recording is running it asks first; stopping
/// saves the tracks (they can be processed next time) and quits for real.
/// Returns whether it took the quit over.
pub fn confirm_quit<R: Runtime>(app: &AppHandle<R>) -> bool {
    let state = app.state::<MeetState>();
    let recording = lock(&state).live.as_ref().map(|l| l.id.clone());
    let Some(id) = recording else { return false };
    let app2 = app.clone();
    app.dialog()
        .message("A meeting is being recorded. Stop the recording and quit? What's been recorded so far is kept, and can be turned into a transcript next time.")
        .title("Stop recording?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Stop and Quit".into(), "Keep Recording".into()))
        .show(move |stop| {
            if stop {
                let state = app2.state::<MeetState>();
                if let Ok(meta) = finish_recording(&app2, &state, &id) {
                    emit_status(&app2, &status_of_meta(&meta, None));
                }
                crate::menu::request_quit(&app2);
            }
        });
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_come_from_titles() {
        assert_eq!(file_stem("Meeting — 2026-11-16 14:30"), "Meeting — 2026-11-16 1430");
        assert_eq!(file_stem("a/b\\c"), "abc");
        assert_eq!(file_stem("  "), "Meeting");
    }

    #[test]
    fn an_interrupted_recording_can_be_processed_again() {
        let meta = Meta { id: "x".into(), state: "recording".into(), mic: true, duration_ms: 5000, ..Default::default() };
        assert_eq!(status_of_meta(&meta, None).state, "recorded");
        let meta = Meta { state: "processing".into(), ..meta };
        assert_eq!(status_of_meta(&meta, None).state, "recorded", "no job is running, so it's waiting");
        let job = Job { cancel: Arc::new(AtomicBool::new(false)), stage: "speakers".into(), pct: 40 };
        let s = status_of_meta(&meta, Some(&job));
        assert_eq!((s.state.as_str(), s.stage.as_deref(), s.pct), ("processing", Some("speakers"), Some(40)));
        assert_eq!(status_of_meta(&Meta { state: "failed".into(), error: Some("boom".into()), ..Default::default() }, None).state, "failed");
    }

    #[test]
    fn processing_waits_for_a_summary() {
        let state = Arc::new(MeetState::default());
        let summary = model_gate(&state);
        let ran = Arc::new(AtomicBool::new(false));
        let t = {
            let (state, ran) = (state.clone(), ran.clone());
            std::thread::spawn(move || with_models(&state, || ran.store(true, Ordering::SeqCst)))
        };
        std::thread::sleep(Duration::from_millis(100));
        assert!(!ran.load(Ordering::SeqCst), "the speech models wait while the summary model is loaded");
        drop(summary);
        t.join().unwrap();
        assert!(ran.load(Ordering::SeqCst));
    }

    #[test]
    fn summaries_take_turns() {
        let state = Arc::new(MeetState::default());
        let inside = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let most = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let (state, inside, most) = (state.clone(), inside.clone(), most.clone());
                std::thread::spawn(move || {
                    let _g = model_gate(&state);
                    let now = inside.fetch_add(1, Ordering::SeqCst) + 1;
                    most.fetch_max(now, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(20));
                    inside.fetch_sub(1, Ordering::SeqCst);
                })
            })
            .collect();
        for t in threads {
            t.join().unwrap();
        }
        assert_eq!(most.load(Ordering::SeqCst), 1, "never two summaries at once");
    }

    /// The whole pipeline over the fixture call: the user on the microphone,
    /// two other voices on the system track. Needs the models, so it only runs on
    /// request: THOUGHTNOTES_MEET_DIR=<folder with models/> cargo test end_to_end -- --ignored --nocapture
    #[test]
    #[ignore = "needs the downloaded models"]
    fn end_to_end_over_the_fixture_call() {
        let root = std::env::var_os("THOUGHTNOTES_MEET_DIR").map(PathBuf::from).expect("set THOUGHTNOTES_MEET_DIR to a folder with models/");
        let mdir = root.join("models");
        let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/meet/fixtures");
        let mut ran = 0;
        for model in &models::WHISPER {
            if !models::is_present(&mdir, model) {
                println!("{}: not downloaded, skipped", model.id);
                continue;
            }
            let dir = crate::testutil::TempDir::new("td-e2e");
            for f in ["mic.wav", "system.wav"] {
                std::fs::copy(fixtures.join(f), dir.join(f)).unwrap();
            }
            let tracks = Tracks { mic: Some(dir.join("mic.wav")), sys: Some(dir.join("system.wav")) };
            let seen = Arc::new(Mutex::new(Vec::<String>::new()));
            let hooks = Hooks {
                stage: {
                    let seen = seen.clone();
                    Arc::new(move |stage, _| {
                        let mut s = seen.lock().unwrap();
                        if s.last().map(String::as_str) != Some(stage) {
                            s.push(stage.to_string());
                        }
                    })
                },
                save: Box::new(|path, name| {
                    assert!(name.ends_with(".wav") && path.exists());
                    Ok("file-id".into())
                }),
            };
            let settings = Settings { model: model.id.into(), language: Some("en".into()), sensitivity: "balanced".into(), speakers: None, title: "Fixture".into() };
            let started = std::time::Instant::now();
            let result = run_pipeline(&dir, &mdir, model, &tracks, &settings, &Arc::new(AtomicBool::new(false)), &hooks).unwrap();
            let secs = started.elapsed().as_secs_f32();
            println!("{} ({}): {secs:.1}s for {:.1}s of audio", model.id, model.file, result.duration_ms as f32 / 1000.0);
            for t in &result.turns {
                println!("  {} {:>5}-{:<5} {}", t.sp, t.s, t.e, t.t);
            }
            assert_eq!(*seen.lock().unwrap(), ["mixing", "transcribing", "speakers", "saving"]);
            assert_eq!(result.file_id, "file-id");
            let who: Vec<&str> = result.turns.iter().map(|t| t.sp.as_str()).collect();
            assert_eq!(who, ["1", "me", "2"], "Daniel, then the user, then Karen: {:?}", result.turns);
            assert!(result.turns[1].t.to_lowercase().contains("launch date"), "{:?}", result.turns[1]);
            assert!(result.turns[0].t.to_lowercase().contains("schedule") && result.turns[2].t.to_lowercase().contains("budget"));
            ran += 1;
        }
        assert!(ran > 0, "no speech model was downloaded in {}", mdir.display());
    }

    #[test]
    fn meta_round_trips_through_its_file() {
        let dir = crate::testutil::TempDir::new("td-meta");
        let meta = Meta {
            id: "a".repeat(32),
            state: "done".into(),
            result: Some(MeetingResult { file_id: "f".into(), duration_ms: 1000, turns: vec![Turn { sp: "me".into(), s: 0, e: 900, t: "hi".into() }], language: "en".into() }),
            notices: vec![NoticeOut { code: "screenDenied".into(), detail: String::new() }],
            ..Default::default()
        };
        write_meta(&dir, &meta);
        let back = read_meta(&dir).unwrap();
        assert_eq!(back.result, meta.result);
        assert_eq!(back.notices, meta.notices);
        assert!(read_meta(&dir.join("nowhere")).is_none());
    }
}
