//! 16 kHz mono 16-bit WAV files: the format every recording is kept in.
//!
//! The writer patches its header as it goes, so a recording that was cut off
//! (a crash, a power cut) is still a playable file up to the last patch. The
//! reader trusts the file's length over a header that was never finished.

use std::fs::File;
use std::io::{self, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::Path;

/// Every file the recorder writes, and what whisper and the speaker models read.
pub const RATE: u32 = 16_000;
/// How often the writer rewrites its header (in samples): every ten seconds.
const PATCH_EVERY: u64 = RATE as u64 * 10;

pub struct WavWriter {
    out: BufWriter<File>,
    samples: u64,
    since_patch: u64,
}

impl WavWriter {
    pub fn create(path: &Path) -> io::Result<Self> {
        let mut w = WavWriter { out: BufWriter::new(File::create(path)?), samples: 0, since_patch: 0 };
        w.out.write_all(&header(0))?;
        Ok(w)
    }

    /// Samples written so far.
    pub fn len(&self) -> u64 {
        self.samples
    }

    pub fn write_f32(&mut self, samples: &[f32]) -> io::Result<()> {
        let mut bytes = Vec::with_capacity(samples.len() * 2);
        for &s in samples {
            bytes.extend_from_slice(&to_i16(s).to_le_bytes());
        }
        self.out.write_all(&bytes)?;
        self.samples += samples.len() as u64;
        self.since_patch += samples.len() as u64;
        if self.since_patch >= PATCH_EVERY {
            self.patch()?;
        }
        Ok(())
    }

    /// Writes `count` samples of silence.
    #[cfg(test)]
    pub fn write_silence(&mut self, count: u64) -> io::Result<()> {
        let chunk = vec![0f32; 4096];
        let mut left = count;
        while left > 0 {
            let n = left.min(chunk.len() as u64) as usize;
            self.write_f32(&chunk[..n])?;
            left -= n as u64;
        }
        Ok(())
    }

    /// Rewrites the sizes in the header to match what's been written.
    fn patch(&mut self) -> io::Result<()> {
        self.out.flush()?;
        let file = self.out.get_mut();
        let bytes = (self.samples * 2) as u32;
        file.seek(SeekFrom::Start(4))?;
        file.write_all(&(36 + bytes).to_le_bytes())?;
        file.seek(SeekFrom::Start(40))?;
        file.write_all(&bytes.to_le_bytes())?;
        file.seek(SeekFrom::End(0))?;
        self.since_patch = 0;
        Ok(())
    }

    pub fn finish(mut self) -> io::Result<u64> {
        self.patch()?;
        self.out.flush()?;
        Ok(self.samples)
    }
}

fn to_i16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * 32767.0).round() as i16
}

fn header(data_bytes: u32) -> [u8; 44] {
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36 + data_bytes).to_le_bytes());
    h[8..16].copy_from_slice(b"WAVEfmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&1u16.to_le_bytes()); // mono
    h[24..28].copy_from_slice(&RATE.to_le_bytes());
    h[28..32].copy_from_slice(&(RATE * 2).to_le_bytes());
    h[32..34].copy_from_slice(&2u16.to_le_bytes());
    h[34..36].copy_from_slice(&16u16.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    h
}

pub struct WavReader {
    input: BufReader<File>,
    /// Samples in the file, and how many are left to read.
    total: u64,
    left: u64,
}

impl WavReader {
    /// Opens a 16 kHz mono 16-bit file (what this app writes, and what
    /// `say --data-format=LEI16@16000` makes).
    pub fn open(path: &Path) -> io::Result<Self> {
        let bad = |m: &str| io::Error::new(io::ErrorKind::InvalidData, m.to_string());
        let file = File::open(path)?;
        let file_len = file.metadata()?.len();
        let mut input = BufReader::new(file);
        let mut riff = [0u8; 12];
        input.read_exact(&mut riff)?;
        if &riff[0..4] != b"RIFF" || &riff[8..12] != b"WAVE" {
            return Err(bad("not a WAV file"));
        }
        let mut pos = 12u64;
        let mut format_ok = false;
        loop {
            let mut chunk = [0u8; 8];
            input.read_exact(&mut chunk).map_err(|_| bad("no audio in the WAV file"))?;
            pos += 8;
            let size = u32::from_le_bytes(chunk[4..8].try_into().unwrap()) as u64;
            match &chunk[0..4] {
                b"fmt " => {
                    let mut fmt = vec![0u8; size as usize];
                    input.read_exact(&mut fmt)?;
                    let tag = u16::from_le_bytes([fmt[0], fmt[1]]);
                    let channels = u16::from_le_bytes([fmt[2], fmt[3]]);
                    let rate = u32::from_le_bytes([fmt[4], fmt[5], fmt[6], fmt[7]]);
                    let bits = u16::from_le_bytes([fmt[14], fmt[15]]);
                    if tag != 1 || channels != 1 || rate != RATE || bits != 16 {
                        return Err(bad("expected 16 kHz mono 16-bit audio"));
                    }
                    format_ok = true;
                    pos += size;
                    // Chunks are padded to an even size.
                    if size % 2 == 1 {
                        input.seek_relative(1)?;
                        pos += 1;
                    }
                }
                b"data" => {
                    if !format_ok {
                        return Err(bad("the WAV file has no format"));
                    }
                    let room = file_len.saturating_sub(pos);
                    // A header that was never finished says 0 (or the maximum): go by the file.
                    let bytes = if size == 0 || size > room { room } else { size };
                    let total = bytes / 2;
                    return Ok(WavReader { input, total, left: total });
                }
                _ => {
                    input.seek_relative(size as i64 + (size % 2) as i64)?;
                    pos += size + size % 2;
                }
            }
        }
    }

    pub fn len(&self) -> u64 {
        self.total
    }

    /// Reads up to `buf.len()` samples as floats in -1..1; returns how many.
    pub fn read_f32(&mut self, buf: &mut [f32]) -> io::Result<usize> {
        let want = (buf.len() as u64).min(self.left) as usize;
        let mut bytes = vec![0u8; want * 2];
        self.input.read_exact(&mut bytes)?;
        for (out, pair) in buf.iter_mut().zip(bytes.chunks_exact(2)) {
            *out = i16::from_le_bytes([pair[0], pair[1]]) as f32 / 32768.0;
        }
        self.left -= want as u64;
        Ok(want)
    }

    /// The whole file, as floats. Only for the one buffer a model needs.
    pub fn read_all(mut self) -> io::Result<Vec<f32>> {
        let mut out = vec![0f32; self.left as usize];
        let n = self.read_f32(&mut out)?;
        out.truncate(n);
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::TempDir;

    fn tone(n: usize) -> Vec<f32> {
        (0..n).map(|i| (i as f32 * 0.05).sin() * 0.5).collect()
    }

    #[test]
    fn round_trips_samples() {
        let dir = TempDir::new("td-wav");
        let path = dir.join("a.wav");
        let data = tone(40_000);
        let mut w = WavWriter::create(&path).unwrap();
        w.write_f32(&data[..1000]).unwrap();
        w.write_f32(&data[1000..]).unwrap();
        assert_eq!(w.finish().unwrap(), 40_000);
        assert_eq!(std::fs::metadata(&path).unwrap().len(), 44 + 80_000);

        let r = WavReader::open(&path).unwrap();
        assert_eq!(r.len(), 40_000);
        let back = r.read_all().unwrap();
        assert_eq!(back.len(), data.len());
        for (a, b) in data.iter().zip(&back) {
            assert!((a - b).abs() < 1.0 / 16_000.0, "{a} vs {b}");
        }
    }

    #[test]
    fn reads_in_pieces_and_clamps() {
        let dir = TempDir::new("td-wav");
        let path = dir.join("b.wav");
        let mut w = WavWriter::create(&path).unwrap();
        w.write_f32(&[2.0, -2.0, 0.0]).unwrap();
        w.write_silence(5000).unwrap();
        w.finish().unwrap();
        let mut r = WavReader::open(&path).unwrap();
        assert_eq!(r.len(), 5003);
        let mut buf = [0f32; 2];
        assert_eq!(r.read_f32(&mut buf).unwrap(), 2);
        assert!(buf[0] > 0.999 && buf[1] < -0.999, "out-of-range samples clip, they don't wrap");
        let mut rest = vec![0f32; 10_000];
        assert_eq!(r.read_f32(&mut rest).unwrap(), 5001);
    }

    #[test]
    fn a_recording_cut_off_before_its_header_was_finished_still_reads() {
        let dir = TempDir::new("td-wav");
        let path = dir.join("c.wav");
        let mut w = WavWriter::create(&path).unwrap();
        w.write_f32(&tone(3000)).unwrap();
        // Flush the bytes but never patch the header, as a crash would leave it.
        w.out.flush().unwrap();
        std::mem::forget(w);
        let r = WavReader::open(&path).unwrap();
        assert_eq!(r.len(), 3000, "the length comes from the file, not the header's 0");
    }

    #[test]
    fn refuses_other_formats() {
        let dir = TempDir::new("td-wav");
        let path = dir.join("d.wav");
        let mut h = header(0);
        h[24..28].copy_from_slice(&44_100u32.to_le_bytes());
        std::fs::write(&path, h).unwrap();
        assert!(WavReader::open(&path).is_err());
        std::fs::write(&path, b"not audio at all").unwrap();
        assert!(WavReader::open(&path).is_err());
    }
}
