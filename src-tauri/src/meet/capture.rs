//! Recording: the microphone through CoreAudio (cpal) and the Mac's own audio
//! through ScreenCaptureKit, each written to its own 16 kHz mono WAV file.
//!
//! Neither device callback touches the disk: it converts, measures the level
//! and hands the block to a writer thread. The streams themselves live on a
//! thread of their own (CoreAudio's aren't `Send`), which also tears them
//! down on stop.

use super::audio::{rms, to_mono, Resampler};
use super::wav::{WavWriter, RATE};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug)]
pub struct Options {
    pub mic: bool,
    pub system: bool,
}

/// What a recorder can't do, in words the interface turns into notices.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Notice {
    /// Screen Recording isn't allowed, so system audio is off.
    ScreenDenied,
    /// The system audio couldn't start for another reason.
    SystemFailed(String),
    /// There's no microphone, or it couldn't be opened.
    MicFailed(String),
}

impl Notice {
    /// The short code and detail sent to the interface.
    pub fn parts(&self) -> (&'static str, String) {
        match self {
            Notice::ScreenDenied => ("screenDenied", String::new()),
            Notice::SystemFailed(m) => ("systemFailed", m.clone()),
            Notice::MicFailed(m) => ("micFailed", m.clone()),
        }
    }
}

/// One track's live numbers, shared with the capture callback.
#[derive(Default)]
struct Meter {
    /// Level of the last block (an f32's bits).
    level: AtomicU32,
    /// The loudest sample seen (an f32's bits): zero all the way means a muted or blocked device.
    peak: AtomicU32,
    /// Samples written to the file.
    written: AtomicU64,
}

impl Meter {
    fn level(&self) -> f32 {
        f32::from_bits(self.level.load(Ordering::Relaxed))
    }
    fn peak(&self) -> f32 {
        f32::from_bits(self.peak.load(Ordering::Relaxed))
    }
}

struct Shared {
    paused: AtomicBool,
    t0: Instant,
    mic: Meter,
    sys: Meter,
}

/// What a capture callback hands its samples to.
#[derive(Clone)]
struct Sink {
    tx: Sender<Vec<f32>>,
    shared: Arc<Shared>,
    which: Which,
    /// Whether the first block has arrived (to pad a late start with silence).
    started: Arc<AtomicBool>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Which {
    Mic,
    Sys,
}

impl Sink {
    fn meter(&self) -> &Meter {
        match self.which {
            Which::Mic => &self.shared.mic,
            Which::Sys => &self.shared.sys,
        }
    }

    /// Takes a block of 16 kHz mono samples from a device callback.
    fn push(&self, block: Vec<f32>) {
        let m = self.meter();
        if self.shared.paused.load(Ordering::Relaxed) {
            m.level.store(0, Ordering::Relaxed);
            return;
        }
        m.level.store(rms(&block).to_bits(), Ordering::Relaxed);
        let peak = block.iter().fold(m.peak(), |p, s| p.max(s.abs()));
        m.peak.store(peak.to_bits(), Ordering::Relaxed);
        if !self.started.swap(true, Ordering::Relaxed) {
            // A track that starts late (the system audio takes a moment) is
            // padded, so both files line up with the clock.
            let late = self.shared.t0.elapsed().as_secs_f64() - block.len() as f64 / RATE as f64;
            if late > 0.15 && late < 60.0 {
                let _ = self.tx.send(vec![0.0; (late * RATE as f64) as usize]);
            }
        }
        let _ = self.tx.send(block);
    }
}

/// Writes blocks to a WAV file until the sender goes away, then finishes it.
fn spawn_writer(path: PathBuf, rx: Receiver<Vec<f32>>, shared: Arc<Shared>, which: Which) -> Result<JoinHandle<()>, String> {
    let mut wav = WavWriter::create(&path).map_err(|e| format!("Couldn't start the recording file: {e}"))?;
    Ok(std::thread::spawn(move || {
        let meter = match which {
            Which::Mic => &shared.mic,
            Which::Sys => &shared.sys,
        };
        for block in rx {
            if wav.write_f32(&block).is_err() {
                break; // out of disk space: keep what's there
            }
            meter.written.store(wav.len(), Ordering::Relaxed);
        }
        let _ = wav.finish();
    }))
}

/// A running capture: tell it to stop, and it ends its streams.
pub(super) struct Capture {
    pub(super) stop: Sender<()>,
    pub(super) thread: JoinHandle<()>,
}

impl Capture {
    fn end(self) {
        let _ = self.stop.send(());
        let _ = self.thread.join();
    }
}

pub struct Recorder {
    pub dir: PathBuf,
    shared: Arc<Shared>,
    captures: Vec<Capture>,
    writers: Vec<JoinHandle<()>>,
    have_mic: bool,
    have_sys: bool,
}

pub struct Finished {
    pub mic: Option<PathBuf>,
    pub sys: Option<PathBuf>,
    pub duration_ms: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Levels {
    pub mic: f32,
    pub sys: f32,
    pub elapsed_ms: u64,
    pub paused: bool,
    /// The microphone has been open for a while and heard nothing at all.
    pub mic_silent: bool,
}

pub const MIC_FILE: &str = "mic.wav";
pub const SYS_FILE: &str = "system.wav";

impl Recorder {
    /// Starts recording into `dir`. A source that can't start is left out and
    /// reported; it's an error only if nothing at all can be recorded.
    pub fn start(dir: &Path, opts: Options) -> Result<(Recorder, Vec<Notice>), String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let shared = Arc::new(Shared { paused: AtomicBool::new(false), t0: Instant::now(), mic: Meter::default(), sys: Meter::default() });
        let mut rec = Recorder { dir: dir.to_path_buf(), shared: shared.clone(), captures: vec![], writers: vec![], have_mic: false, have_sys: false };
        let mut notices = Vec::new();

        if opts.system {
            #[cfg(target_os = "macos")]
            if super::sck::screen_access() {
                match rec.add(Which::Sys, SYS_FILE, |sink| super::sck::start(sink_fn(sink))) {
                    Ok(()) => rec.have_sys = true,
                    Err(e) => notices.push(Notice::SystemFailed(e)),
                }
            } else {
                notices.push(Notice::ScreenDenied);
            }
        }
        if opts.mic {
            match rec.add(Which::Mic, MIC_FILE, start_mic) {
                Ok(()) => rec.have_mic = true,
                Err(e) => notices.push(Notice::MicFailed(e)),
            }
        }
        if !rec.have_mic && !rec.have_sys {
            let why = notices.iter().map(|n| n.parts().1).find(|s| !s.is_empty()).unwrap_or_else(|| "Nothing could be recorded.".into());
            return Err(why);
        }
        Ok((rec, notices))
    }

    fn add(&mut self, which: Which, file: &str, begin: impl FnOnce(Sink) -> Result<Capture, String>) -> Result<(), String> {
        let (tx, rx) = mpsc::channel();
        let writer = spawn_writer(self.dir.join(file), rx, self.shared.clone(), which)?;
        let sink = Sink { tx, shared: self.shared.clone(), which, started: Arc::new(AtomicBool::new(false)) };
        match begin(sink) {
            Ok(cap) => {
                self.captures.push(cap);
                self.writers.push(writer);
                Ok(())
            }
            Err(e) => {
                // The sink went with the failed capture, so the writer ends on its own.
                let _ = writer.join();
                let _ = std::fs::remove_file(self.dir.join(file));
                Err(e)
            }
        }
    }

    pub fn set_paused(&self, paused: bool) {
        self.shared.paused.store(paused, Ordering::Relaxed);
    }

    pub fn levels(&self) -> Levels {
        let s = &self.shared;
        let samples = s.mic.written.load(Ordering::Relaxed).max(s.sys.written.load(Ordering::Relaxed));
        let elapsed_ms = samples * 1000 / RATE as u64;
        Levels {
            mic: s.mic.level(),
            sys: s.sys.level(),
            elapsed_ms,
            paused: s.paused.load(Ordering::Relaxed),
            mic_silent: self.have_mic && elapsed_ms > 3000 && s.mic.peak() == 0.0,
        }
    }

    /// Ends the streams and finishes the files.
    pub fn stop(mut self) -> Finished {
        for c in self.captures.drain(..) {
            c.end();
        }
        // The capture threads held the senders; with them gone, the writers finish.
        for w in self.writers.drain(..) {
            let _ = w.join();
        }
        let s = &self.shared;
        let samples = s.mic.written.load(Ordering::Relaxed).max(s.sys.written.load(Ordering::Relaxed));
        Finished {
            mic: self.have_mic.then(|| self.dir.join(MIC_FILE)),
            sys: self.have_sys.then(|| self.dir.join(SYS_FILE)),
            duration_ms: samples * 1000 / RATE as u64,
        }
    }
}

// ---- the microphone

fn start_mic(sink: Sink) -> Result<Capture, String> {
    let (stop_tx, stop_rx) = mpsc::channel::<()>();
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
    let thread = std::thread::spawn(move || {
        let built = build_mic(sink);
        match built {
            Ok(stream) => {
                let _ = ready_tx.send(Ok(()));
                let _ = stop_rx.recv();
                drop(stream);
            }
            Err(e) => {
                let _ = ready_tx.send(Err(e));
            }
        }
    });
    match ready_rx.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => Ok(Capture { stop: stop_tx, thread }),
        Ok(Err(e)) => {
            let _ = thread.join();
            Err(e)
        }
        Err(_) => Err("The microphone didn't answer.".into()),
    }
}

fn build_mic(sink: Sink) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host.default_input_device().ok_or("There's no microphone to record from.")?;
    let config = device.default_input_config().map_err(|e| format!("The microphone can't be used: {e}"))?;
    let channels = config.channels() as usize;
    let rate = config.sample_rate() as u32;
    let fmt = config.sample_format();
    let resampler = Mutex::new(Resampler::new(rate));
    let err_fn = |e: cpal::Error| eprintln!("microphone: {e}");
    macro_rules! build {
        ($t:ty) => {{
            let sink = sink.clone();
            device.build_input_stream(
                config.into(),
                move |data: &[$t], _: &_| {
                    let floats: Vec<f32> = data.iter().map(|s| <f32 as cpal::FromSample<$t>>::from_sample_(*s)).collect();
                    let mono = to_mono(&floats, channels);
                    let out = resampler.lock().map(|mut r| r.process(&mono)).unwrap_or_default();
                    if !out.is_empty() {
                        sink.push(out);
                    }
                },
                err_fn,
                None,
            )
        }};
    }
    let stream = match fmt {
        cpal::SampleFormat::F32 => build!(f32),
        cpal::SampleFormat::I16 => build!(i16),
        cpal::SampleFormat::I32 => build!(i32),
        cpal::SampleFormat::I8 => build!(i8),
        other => return Err(format!("The microphone uses a sample format ({other}) this app can't read.")),
    }
    .map_err(|e| format!("The microphone couldn't be opened: {e}"))?;
    stream.play().map_err(|e| format!("The microphone couldn't start: {e}"))?;
    Ok(stream)
}

// ---- the Mac's own audio

/// Adapts a sink to what the ScreenCaptureKit side calls with each block of
/// mono samples at `SYSTEM_RATE`.
#[cfg(target_os = "macos")]
fn sink_fn(sink: Sink) -> impl Fn(&[f32]) + Send + Sync + 'static {
    let resampler = Mutex::new(Resampler::new(super::sck::SYSTEM_RATE));
    move |mono: &[f32]| {
        let out = resampler.lock().map(|mut r| r.process(mono)).unwrap_or_default();
        if !out.is_empty() {
            sink.push(out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notices_carry_a_code_and_a_detail() {
        assert_eq!(Notice::ScreenDenied.parts(), ("screenDenied", String::new()));
        assert_eq!(Notice::MicFailed("busy".into()).parts(), ("micFailed", "busy".to_string()));
    }

    #[test]
    fn a_sink_pads_a_late_start_and_drops_paused_audio() {
        let shared = Arc::new(Shared { paused: AtomicBool::new(false), t0: Instant::now() - Duration::from_secs(2), mic: Meter::default(), sys: Meter::default() });
        let (tx, rx) = mpsc::channel();
        let sink = Sink { tx, shared: shared.clone(), which: Which::Sys, started: Arc::new(AtomicBool::new(false)) };
        sink.push(vec![0.5; 1600]);
        let first = rx.recv().unwrap();
        assert!((first.len() as i64 - 32_000).abs() < 3200, "two seconds of silence first: {}", first.len());
        assert!(first.iter().all(|s| *s == 0.0));
        assert_eq!(rx.recv().unwrap().len(), 1600);
        assert!(shared.sys.level() > 0.4);

        shared.paused.store(true, Ordering::Relaxed);
        sink.push(vec![0.5; 1600]);
        assert!(rx.try_recv().is_err(), "nothing is written while paused");
        assert_eq!(shared.sys.level(), 0.0);
    }

    #[test]
    fn a_writer_thread_finishes_its_file() {
        let dir = crate::testutil::TempDir::new("td-cap");
        let shared = Arc::new(Shared { paused: AtomicBool::new(false), t0: Instant::now(), mic: Meter::default(), sys: Meter::default() });
        let (tx, rx) = mpsc::channel();
        let h = spawn_writer(dir.join("a.wav"), rx, shared.clone(), Which::Mic).unwrap();
        tx.send(vec![0.1; 8000]).unwrap();
        tx.send(vec![0.1; 8000]).unwrap();
        drop(tx);
        h.join().unwrap();
        assert_eq!(shared.mic.written.load(Ordering::Relaxed), 16_000);
        assert_eq!(super::super::wav::WavReader::open(&dir.join("a.wav")).unwrap().len(), 16_000);
    }
}
