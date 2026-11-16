//! Sample-rate conversion, mixing and loudness, the plain arithmetic under
//! recording and processing.

use super::wav::{WavReader, RATE};
use std::io;
use std::path::Path;

/// Averages interleaved channels down to one.
pub fn to_mono(interleaved: &[f32], channels: usize) -> Vec<f32> {
    if channels <= 1 {
        return interleaved.to_vec();
    }
    interleaved.chunks_exact(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect()
}

/// Root-mean-square level of a block, 0 for an empty one.
pub fn rms(block: &[f32]) -> f32 {
    if block.is_empty() {
        return 0.0;
    }
    (block.iter().map(|s| s * s).sum::<f32>() / block.len() as f32).sqrt()
}

/// Streaming windowed-sinc conversion to 16 kHz. It keeps a short tail of the
/// input between calls, so blocks of any size can be fed in one after another.
pub struct Resampler {
    /// Input samples per output sample.
    ratio: f64,
    /// Low-pass cutoff relative to the input rate (1 when not shrinking).
    scale: f64,
    half: i64,
    buf: Vec<f32>,
    /// Absolute index (in input samples) of `buf[0]`.
    base: i64,
    /// Index of the next output sample.
    next: i64,
}

/// Zero crossings of the sinc on each side of the centre.
const LOBES: f64 = 8.0;

impl Resampler {
    pub fn new(in_rate: u32) -> Self {
        let ratio = in_rate as f64 / RATE as f64;
        let scale = (1.0 / ratio).min(1.0);
        let half = (LOBES / scale).ceil() as i64;
        Resampler { ratio, scale, half, buf: Vec::new(), base: 0, next: 0 }
    }

    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        if (self.ratio - 1.0).abs() < 1e-9 {
            return input.to_vec();
        }
        self.buf.extend_from_slice(input);
        let mut out = Vec::with_capacity((input.len() as f64 / self.ratio) as usize + 1);
        loop {
            let center = self.next as f64 * self.ratio;
            let first = center.floor() as i64 - self.half + 1;
            let last = center.floor() as i64 + self.half;
            if last >= self.base + self.buf.len() as i64 {
                break;
            }
            let mut sum = 0.0f64;
            for k in first..=last {
                let idx = k - self.base;
                if idx < 0 {
                    continue; // before the start of the stream
                }
                let x = (k as f64 - center) * self.scale;
                let window = 0.5 + 0.5 * (std::f64::consts::PI * x / LOBES).cos();
                let sinc = if x.abs() < 1e-9 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
                sum += self.buf[idx as usize] as f64 * sinc * window;
            }
            out.push((sum * self.scale) as f32);
            self.next += 1;
        }
        // Drop what no later output can reach.
        let keep_from = ((self.next as f64 * self.ratio).floor() as i64 - self.half).max(self.base);
        let drop = (keep_from - self.base) as usize;
        if drop > 0 {
            self.buf.drain(..drop);
            self.base = keep_from;
        }
        out
    }
}

/// How finely loudness is measured for attributing speech to "Me".
pub const HOP_SECS: f32 = 0.1;
const HOP: usize = (RATE as f32 * HOP_SECS) as usize;

/// Loudness of each 100 ms of the microphone and of the system audio.
#[derive(Default, Debug, Clone, PartialEq)]
pub struct Envelopes {
    pub mic: Vec<f32>,
    pub sys: Vec<f32>,
}

pub struct Mixed {
    pub samples: Vec<f32>,
    pub env: Envelopes,
}

/// Reads the microphone and system tracks block by block, adds them into one
/// buffer, and records each track's loudness on the way, so nothing is read
/// from disk twice. Either track may be absent. The result is scaled down
/// only if the sum would clip.
pub fn mix_tracks(mic: Option<&Path>, sys: Option<&Path>) -> io::Result<Mixed> {
    let mut readers = [mic.map(WavReader::open).transpose()?, sys.map(WavReader::open).transpose()?];
    let total = readers.iter().flatten().map(|r| r.len()).max().unwrap_or(0) as usize;
    let mut samples = vec![0f32; total];
    let mut env = [Vec::new(), Vec::new()];
    let mut block = vec![0f32; HOP * 50];
    for (t, reader) in readers.iter_mut().enumerate() {
        let Some(reader) = reader else { continue };
        let mut at = 0usize;
        loop {
            let n = reader.read_f32(&mut block)?;
            if n == 0 {
                break;
            }
            for (dst, src) in samples[at..at + n].iter_mut().zip(&block[..n]) {
                *dst += *src;
            }
            for piece in block[..n].chunks(HOP) {
                env[t].push(rms(piece));
            }
            at += n;
        }
    }
    let peak = samples.iter().fold(0f32, |m, s| m.max(s.abs()));
    if peak > 0.99 {
        let gain = 0.99 / peak;
        for s in &mut samples {
            *s *= gain;
        }
    }
    let [m, s] = env;
    Ok(Mixed { samples, env: Envelopes { mic: m, sys: s } })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meet::wav::WavWriter;
    use crate::testutil::TempDir;

    fn sine(freq: f32, rate: f32, n: usize, amp: f32) -> Vec<f32> {
        (0..n).map(|i| (i as f32 / rate * freq * std::f32::consts::TAU).sin() * amp).collect()
    }

    #[test]
    fn mono_averages_channels() {
        assert_eq!(to_mono(&[1.0, 0.0, 0.5, 0.5], 2), vec![0.5, 0.5]);
        assert_eq!(to_mono(&[0.25, 0.75], 1), vec![0.25, 0.75]);
    }

    #[test]
    fn resamples_48k_to_16k_keeping_a_tone_and_dropping_an_alias() {
        let mut r = Resampler::new(48_000);
        // 440 Hz survives; 20 kHz would alias into the band if it weren't filtered.
        let input: Vec<f32> = sine(440.0, 48_000.0, 48_000, 0.5).iter().zip(sine(20_000.0, 48_000.0, 48_000, 0.5)).map(|(a, b)| a + b).collect();
        let mut out = Vec::new();
        // Odd block sizes, as a device would deliver them.
        for block in input.chunks(1777) {
            out.extend(r.process(block));
        }
        assert!((out.len() as i64 - 16_000).abs() < 40, "about one second out: {}", out.len());
        let mid = &out[2000..14_000];
        let level = rms(mid);
        assert!((level - 0.3535).abs() < 0.03, "the 440 Hz tone keeps its level: {level}");
    }

    #[test]
    fn same_rate_passes_through() {
        let mut r = Resampler::new(16_000);
        assert_eq!(r.process(&[0.1, 0.2]), vec![0.1, 0.2]);
    }

    #[test]
    fn mixing_adds_tracks_and_measures_each() {
        let dir = TempDir::new("td-mix");
        let (a, b) = (dir.join("mic.wav"), dir.join("sys.wav"));
        let mut w = WavWriter::create(&a).unwrap();
        w.write_f32(&vec![0.2; 3200]).unwrap(); // 0.2 s
        w.finish().unwrap();
        let mut w = WavWriter::create(&b).unwrap();
        w.write_f32(&vec![0.0; 1600]).unwrap();
        w.write_f32(&vec![0.4; 3200]).unwrap(); // longer, and louder in its second half
        w.finish().unwrap();

        let m = mix_tracks(Some(&a), Some(&b)).unwrap();
        assert_eq!(m.samples.len(), 4800, "as long as the longer track");
        assert!((m.samples[0] - 0.2).abs() < 1e-3);
        assert!((m.samples[2000] - 0.6).abs() < 1e-3, "tracks add");
        assert_eq!(m.env.mic.len(), 2);
        assert_eq!(m.env.sys.len(), 3);
        assert!(m.env.mic[0] > 0.19 && m.env.sys[0] < 0.01 && m.env.sys[2] > 0.39);

        let only = mix_tracks(None, Some(&b)).unwrap();
        assert!(only.env.mic.is_empty() && only.samples.len() == 4800);
    }

    #[test]
    fn mixing_scales_down_only_when_it_would_clip() {
        let dir = TempDir::new("td-mix");
        let (a, b) = (dir.join("a.wav"), dir.join("b.wav"));
        for p in [&a, &b] {
            let mut w = WavWriter::create(p).unwrap();
            w.write_f32(&vec![0.8; 1000]).unwrap();
            w.finish().unwrap();
        }
        let m = mix_tracks(Some(&a), Some(&b)).unwrap();
        let peak = m.samples.iter().fold(0f32, |x, s| x.max(s.abs()));
        assert!((peak - 0.99).abs() < 1e-3, "{peak}");
    }
}
