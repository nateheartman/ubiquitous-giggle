//! The speech and speaker models: what they are, where they live, and the one
//! download `/meet` ever makes (after the user agrees to it).
//!
//! Files come only from the two hosts named below, are fetched in pieces that
//! can be resumed, and are checked against a SHA-256 written into the app
//! before they're used. A file that doesn't match is deleted, never loaded.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

/// How a model is stored once downloaded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Pack {
    /// The file as downloaded.
    Plain,
    /// A .tar.bz2 holding the file named here, which is kept under `Model::file`.
    TarBz2(&'static str),
}

#[derive(Clone, Copy, Debug)]
pub struct Model {
    /// What the app calls it ("best", "speakers").
    pub id: &'static str,
    /// The file name under `models/`.
    pub file: &'static str,
    pub url: &'static str,
    /// SHA-256 of the download (the archive, for a packed model).
    pub sha256: &'static str,
    /// Bytes to download.
    pub size: u64,
    /// SHA-256 of the file kept on disk, when that isn't the download itself.
    kept_sha256: Option<&'static str>,
    pack: Pack,
}

/// Speech to text, from smallest to best. The hashes are the ones Hugging Face
/// publishes for these files (their LFS SHA-256).
pub const WHISPER: [Model; 3] = [
    Model {
        id: "fast",
        file: "ggml-base.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
        size: 147_964_211,
        kept_sha256: None,
        pack: Pack::Plain,
    },
    Model {
        id: "balanced",
        file: "ggml-small.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b",
        size: 487_601_967,
        kept_sha256: None,
        pack: Pack::Plain,
    },
    Model {
        id: "best",
        file: "ggml-large-v3-turbo-q5_0.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin",
        sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
        size: 574_041_195,
        kept_sha256: None,
        pack: Pack::Plain,
    },
];

/// Who is speaking: the segmentation model (pyannote 3.0) and the voice
/// embedding model (3D-Speaker CAM++, Chinese and English), from the
/// sherpa-onnx releases. k2-fsa publishes no hashes for these; the ones here
/// are from files downloaded and compared with a second download (and, for the
/// segmentation model, with Hugging Face's copy).
pub const SEGMENTATION: Model = Model {
    id: "segmentation",
    file: "pyannote-segmentation-3.0.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    sha256: "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488",
    size: 6_958_444,
    kept_sha256: Some("220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079"),
    pack: Pack::TarBz2("sherpa-onnx-pyannote-segmentation-3-0/model.onnx"),
};

pub const EMBEDDING: Model = Model {
    id: "embedding",
    file: "3dspeaker-campplus-zh-en.onnx",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
    sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
    size: 28_281_164,
    kept_sha256: None,
    pack: Pack::Plain,
};

/// Hosts a model URL may be on (the downloads redirect to their own CDNs,
/// which ureq follows; these are only the places the app starts from).
pub const HOSTS: [&str; 2] = ["https://huggingface.co/ggerganov/whisper.cpp/", "https://github.com/k2-fsa/sherpa-onnx/releases/"];

pub fn whisper(id: &str) -> Option<&'static Model> {
    WHISPER.iter().find(|m| m.id == id)
}

/// Everything a given speech-model choice needs on disk.
pub fn needed(whisper_id: &str) -> Option<Vec<&'static Model>> {
    Some(vec![whisper(whisper_id)?, &SEGMENTATION, &EMBEDDING])
}

pub fn path_of(dir: &Path, m: &Model) -> PathBuf {
    dir.join(m.file)
}

/// The SHA-256 of a file, read in pieces.
pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut f = File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Whether a model is on disk (by size: it was verified when it arrived, and
/// hashing half a gigabyte each time the Settings pane opens would be slow).
pub fn is_present(dir: &Path, m: &Model) -> bool {
    let kept = match m.pack {
        Pack::Plain => m.size,
        // The segmentation model is 5,992,913 bytes once unpacked.
        Pack::TarBz2(_) => KEPT_SEGMENTATION_SIZE,
    };
    fs::metadata(path_of(dir, m)).is_ok_and(|md| md.len() == kept)
}

const KEPT_SEGMENTATION_SIZE: u64 = 5_992_913;

/// Checks a model before it's loaded, and deletes it if it's wrong.
pub fn verify(dir: &Path, m: &Model) -> Result<(), String> {
    let path = path_of(dir, m);
    let want = m.kept_sha256.unwrap_or(m.sha256);
    match hash_file(&path) {
        Ok(h) if h == want => Ok(()),
        Ok(_) => {
            let _ = fs::remove_file(&path);
            Err(format!("{} didn't match its checksum and was removed. Download it again.", m.file))
        }
        Err(e) => Err(format!("{} can't be read: {e}", m.file)),
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelState {
    pub id: String,
    pub file: String,
    pub size: u64,
    pub present: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelsStatus {
    pub whisper: Vec<ModelState>,
    /// The two speaker models, which every choice of speech model shares.
    pub speakers: Vec<ModelState>,
    /// Bytes the downloaded models take.
    pub disk_bytes: u64,
}

fn state(dir: &Path, m: &Model) -> ModelState {
    ModelState { id: m.id.into(), file: m.file.into(), size: m.size, present: is_present(dir, m) }
}

pub fn status(dir: &Path) -> ModelsStatus {
    let disk_bytes = fs::read_dir(dir)
        .map(|rd| rd.flatten().filter_map(|e| e.metadata().ok()).filter(|m| m.is_file()).map(|m| m.len()).sum())
        .unwrap_or(0);
    ModelsStatus {
        whisper: WHISPER.iter().map(|m| state(dir, m)).collect(),
        speakers: [&SEGMENTATION, &EMBEDDING].iter().map(|m| state(dir, m)).collect(),
        disk_bytes,
    }
}

/// Removes every downloaded model (and half-finished downloads).
pub fn delete_all(dir: &Path) -> std::io::Result<()> {
    if dir.exists() {
        for e in fs::read_dir(dir)?.flatten() {
            if e.path().is_file() {
                fs::remove_file(e.path())?;
            }
        }
    }
    Ok(())
}

/// Progress of the download, as it's sent to the interface.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// The model now downloading (its `file`).
    pub file: String,
    /// Bytes of everything to download that have arrived, and the total.
    pub done: u64,
    pub total: u64,
    /// "downloading", "checking" or "unpacking".
    pub stage: &'static str,
}

/// Downloads whatever of `list` is missing into `dir`. `on_progress` is told
/// how it's going; `cancel` stops it between reads (the partial file is kept
/// so the next try resumes).
pub fn download(dir: &Path, list: &[&Model], cancel: &AtomicBool, on_progress: &mut dyn FnMut(Progress)) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let todo: Vec<&&Model> = list.iter().filter(|m| !is_present(dir, m)).collect();
    let total: u64 = todo.iter().map(|m| m.size).sum();
    let mut done_before = 0u64;
    for m in todo {
        fetch_one(dir, m, cancel, &mut |got, stage| {
            on_progress(Progress { file: m.file.into(), done: done_before + got, total, stage });
        })?;
        done_before += m.size;
    }
    Ok(())
}

fn fetch_one(dir: &Path, m: &Model, cancel: &AtomicBool, tick: &mut dyn FnMut(u64, &'static str)) -> Result<(), String> {
    if !HOSTS.iter().any(|h| m.url.starts_with(h)) {
        return Err("That model isn't hosted where ThoughtNotes expects.".into());
    }
    let part = dir.join(format!("{}.part", m.file));
    let mut have = fs::metadata(&part).map(|md| md.len()).unwrap_or(0);
    if have > m.size {
        let _ = fs::remove_file(&part);
        have = 0;
    }
    if have < m.size {
        let agent: ureq::Agent = ureq::Agent::config_builder()
            .timeout_connect(Some(Duration::from_secs(30)))
            .timeout_per_read(Some(Duration::from_secs(60)))
            .http_status_as_error(false)
            .user_agent("ThoughtNotes model download")
            .build()
            .into();
        let mut req = agent.get(m.url);
        if have > 0 {
            req = req.header("Range", format!("bytes={have}-"));
        }
        let mut resp = req.call().map_err(|e| format!("Couldn't reach the download server: {e}"))?;
        let status = resp.status().as_u16();
        let mut file = match status {
            206 => OpenOptions::new().append(true).open(&part),
            200 => {
                have = 0; // the server ignored the range: start over
                File::create(&part)
            }
            s => return Err(format!("The download server answered {s}.")),
        }
        .map_err(|e| e.to_string())?;
        let mut body = resp.body_mut().as_reader();
        let mut buf = vec![0u8; 256 * 1024];
        let mut got = have;
        let mut last_tick = std::time::Instant::now();
        loop {
            if cancel.load(Ordering::Relaxed) {
                let _ = file.flush();
                return Err("cancelled".into());
            }
            let n = body.read(&mut buf).map_err(|e| format!("The download was interrupted: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            got += n as u64;
            if last_tick.elapsed() > Duration::from_millis(150) {
                tick(got, "downloading");
                last_tick = std::time::Instant::now();
            }
        }
        file.flush().map_err(|e| e.to_string())?;
    }
    tick(m.size, "checking");
    let got = fs::metadata(&part).map(|md| md.len()).unwrap_or(0);
    if got != m.size {
        // Cut short: keep what's there so the next try resumes from it.
        return Err("The download ended early. Try again to continue it.".into());
    }
    let hash = hash_file(&part).map_err(|e| e.to_string())?;
    if hash != m.sha256 {
        let _ = fs::remove_file(&part);
        return Err(format!("{} didn't match its checksum, so it was discarded. Try again.", m.file));
    }
    let target = path_of(dir, m);
    match m.pack {
        Pack::Plain => fs::rename(&part, &target).map_err(|e| e.to_string())?,
        Pack::TarBz2(inner) => {
            tick(m.size, "unpacking");
            unpack(&part, inner, &target)?;
            let _ = fs::remove_file(&part);
            verify(dir, m)?;
        }
    }
    Ok(())
}

/// Pulls one file out of a .tar.bz2 into `target`.
fn unpack(archive: &Path, inner: &str, target: &Path) -> Result<(), String> {
    let f = File::open(archive).map_err(|e| e.to_string())?;
    let mut tar = tar::Archive::new(bzip2::read::BzDecoder::new(f));
    for entry in tar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        if entry.path().map_err(|e| e.to_string())?.to_string_lossy() == inner {
            let tmp = target.with_extension("tmp");
            let mut out = File::create(&tmp).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            out.sync_all().map_err(|e| e.to_string())?;
            fs::rename(&tmp, target).map_err(|e| e.to_string())?;
            return Ok(());
        }
    }
    Err(format!("The download didn't contain {inner}."))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    #[test]
    fn hashes_are_what_was_written_down() {
        let dir = TempDir::new("td-models");
        let p = dir.join("x");
        fs::write(&p, b"abc").unwrap();
        assert_eq!(hash_file(&p).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[test]
    fn a_wrong_file_is_refused_and_removed() {
        let dir = TempDir::new("td-models");
        let m = &EMBEDDING;
        fs::write(path_of(&dir, m), b"not the model").unwrap();
        assert!(verify(&dir, m).unwrap_err().contains("checksum"));
        assert!(!path_of(&dir, m).exists(), "a file that fails its check is deleted");
        assert!(verify(&dir, m).is_err(), "and a missing one is an error too");
    }

    #[test]
    fn presence_goes_by_size_and_status_adds_up() {
        let dir = TempDir::new("td-models");
        assert!(status(&dir).whisper.iter().all(|m| !m.present));
        fs::write(path_of(&dir, &EMBEDDING), vec![0u8; 10]).unwrap();
        assert!(!is_present(&dir, &EMBEDDING), "a half-written file isn't there yet");
        let f = File::create(path_of(&dir, &EMBEDDING)).unwrap();
        f.set_len(EMBEDDING.size).unwrap();
        assert!(is_present(&dir, &EMBEDDING));
        let st = status(&dir);
        assert!(st.speakers.iter().any(|m| m.present) && st.disk_bytes == EMBEDDING.size);
        delete_all(&dir).unwrap();
        assert_eq!(status(&dir).disk_bytes, 0);
    }

    #[test]
    fn the_catalogue_is_consistent() {
        assert_eq!(WHISPER.map(|m| m.id), ["fast", "balanced", "best"]);
        for m in WHISPER.iter().chain([&SEGMENTATION, &EMBEDDING]) {
            assert!(HOSTS.iter().any(|h| m.url.starts_with(h)), "{} is from a known host", m.id);
            assert_eq!(m.sha256.len(), 64);
            assert!(m.sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
        }
        assert_eq!(needed("best").unwrap().len(), 3);
        assert!(needed("huge").is_none());
    }

    #[test]
    fn refuses_a_model_from_another_host() {
        let dir = TempDir::new("td-models");
        let evil = Model { url: "https://example.com/model.bin", ..EMBEDDING };
        let err = download(&dir, &[&evil], &AtomicBool::new(false), &mut |_| {}).unwrap_err();
        assert!(err.contains("isn't hosted"));
    }

    #[test]
    fn unpacks_one_file_from_a_tarball() {
        let dir = TempDir::new("td-models");
        // Build a tiny .tar.bz2 with the layout the real one has.
        let archive = dir.join("a.tar.bz2");
        {
            let enc = bzip2::write::BzEncoder::new(File::create(&archive).unwrap(), bzip2::Compression::fast());
            let mut b = tar::Builder::new(enc);
            for (name, body) in [("pkg/readme.md", &b"hi"[..]), ("pkg/model.onnx", &b"onnx bytes"[..])] {
                let mut h = tar::Header::new_gnu();
                h.set_size(body.len() as u64);
                h.set_mode(0o644);
                h.set_cksum();
                b.append_data(&mut h, name, body).unwrap();
            }
            b.into_inner().unwrap().finish().unwrap();
        }
        let out = dir.join("m.onnx");
        unpack(&archive, "pkg/model.onnx", &out).unwrap();
        assert_eq!(fs::read(&out).unwrap(), b"onnx bytes");
        assert!(unpack(&archive, "pkg/missing", &dir.join("n")).is_err());
    }
}
