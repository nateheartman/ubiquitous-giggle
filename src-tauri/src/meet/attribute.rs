//! Who said what: puts a name on each stretch of the transcript.
//!
//! With both tracks, speech where the microphone clearly outweighs the system
//! audio is the user ("Me"); everything else is whoever the speaker model
//! heard on the system track around then. That labels the user's own voice
//! without running it through the speaker model, and speaker bleed from the
//! speakers into the microphone can't turn the other side of a call into "Me",
//! since there the system track is the louder one.

use super::audio::{Envelopes, HOP_SECS};
use serde::{Deserialize, Serialize};

/// One word with the time it was said, in seconds from the start.
#[derive(Clone, Debug, PartialEq)]
pub struct Word {
    pub text: String,
    pub start: f32,
    pub end: f32,
}

/// One stretch of transcribed speech.
#[derive(Clone, Debug, PartialEq)]
pub struct Seg {
    pub start: f32,
    pub end: f32,
    pub text: String,
    /// Empty when the model gave no word timings; the segment is then one unit.
    pub words: Vec<Word>,
}

/// A stretch the speaker model assigned to one voice (0-based, in its own order).
#[derive(Clone, Debug, PartialEq)]
pub struct Span {
    pub start: f32,
    pub end: f32,
    pub speaker: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Who {
    Me,
    /// The speaker model's own number for a voice.
    Voice(i32),
}

/// What was recorded, which decides where "Me" can come from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    /// Microphone and system audio: spans are from the system track.
    Both,
    /// One track only (in person, or no permission): spans are from it and nobody is "Me".
    Single,
}

/// A speaker's turn as it's stored in the note: times in milliseconds, and a
/// speaker key that is `"me"` or the voice's number from 1 in order of first
/// speaking.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Turn {
    pub sp: String,
    pub s: u32,
    pub e: u32,
    pub t: String,
}

/// The microphone has to be this much louder than the system audio to be "Me".
const ME_RATIO: f32 = 2.0;
/// ...and above this level (about -48 dBFS), or a quiet room's hiss would count.
const ME_FLOOR: f32 = 0.004;
/// A change of speaker shorter than this many words is treated as noise in the timings.
const MIN_RUN_WORDS: usize = 3;
/// How far from a spoken word the nearest span may be and still be its speaker (seconds).
const NEAR: f32 = 1.5;

fn mean_over(env: &[f32], start: f32, end: f32) -> f32 {
    if env.is_empty() {
        return 0.0;
    }
    let from = ((start / HOP_SECS).floor() as usize).min(env.len() - 1);
    let to = ((end / HOP_SECS).ceil() as usize).clamp(from + 1, env.len());
    env[from..to].iter().sum::<f32>() / (to - from) as f32
}

/// Whether the user, and not the other side of a call, was speaking.
pub fn is_me(env: &Envelopes, start: f32, end: f32) -> bool {
    let mic = mean_over(&env.mic, start, end);
    let sys = mean_over(&env.sys, start, end);
    mic > ME_FLOOR && mic > sys * ME_RATIO
}

/// The voice that overlaps `[start, end]` the most, or failing that the
/// nearest one within a second and a half.
fn voice_at(spans: &[Span], start: f32, end: f32) -> Option<i32> {
    let mut best: Option<(f32, i32)> = None;
    for s in spans {
        let overlap = end.min(s.end) - start.max(s.start);
        if overlap > 0.0 && best.map_or(true, |(o, _)| overlap > o) {
            best = Some((overlap, s.speaker));
        }
    }
    if let Some((_, v)) = best {
        return Some(v);
    }
    let mid = (start + end) / 2.0;
    spans
        .iter()
        .map(|s| (if mid < s.start { s.start - mid } else { (mid - s.end).max(0.0) }, s.speaker))
        .filter(|(d, _)| *d <= NEAR)
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, v)| v)
}

/// A piece of the transcript with one speaker.
#[derive(Clone, Debug, PartialEq)]
pub struct Piece {
    pub who: Who,
    pub start: f32,
    pub end: f32,
    pub text: String,
}

/// Labels each word, folds one-off flips back into their neighbours, and cuts
/// the segments where the speaker really changes.
pub fn attribute(segs: &[Seg], env: &Envelopes, spans: &[Span], mode: Mode) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let mut last_voice = 0;
    for seg in segs {
        let whole;
        let words: &[Word] = if seg.words.is_empty() {
            whole = [Word { text: seg.text.clone(), start: seg.start, end: seg.end }];
            &whole
        } else {
            &seg.words
        };
        let mut labels: Vec<Who> = words
            .iter()
            .map(|w| {
                if mode == Mode::Both && is_me(env, w.start, w.end) {
                    Who::Me
                } else {
                    let v = voice_at(spans, w.start, w.end).unwrap_or(last_voice);
                    last_voice = v;
                    Who::Voice(v)
                }
            })
            .collect();
        smooth(&mut labels);
        let mut from = 0;
        while from < words.len() {
            let mut to = from + 1;
            while to < words.len() && labels[to] == labels[from] {
                to += 1;
            }
            let text = words[from..to].iter().map(|w| w.text.as_str()).collect::<String>();
            let text = text.trim();
            if !text.is_empty() {
                pieces.push(Piece { who: labels[from], start: words[from].start, end: words[to - 1].end, text: text.to_string() });
            }
            from = to;
        }
    }
    pieces
}

/// Absorbs speaker runs shorter than `MIN_RUN_WORDS` into the longer neighbour.
fn smooth(labels: &mut [Who]) {
    loop {
        let mut runs: Vec<(usize, usize)> = Vec::new(); // (start, len)
        for i in 0..labels.len() {
            match runs.last_mut() {
                Some((s, l)) if labels[*s] == labels[i] => *l += 1,
                _ => runs.push((i, 1)),
            }
        }
        if runs.len() < 2 {
            return;
        }
        let Some(short) = (0..runs.len()).filter(|&r| runs[r].1 < MIN_RUN_WORDS).min_by_key(|&r| runs[r].1) else {
            return;
        };
        let prev = short.checked_sub(1).map(|r| runs[r]);
        let next = runs.get(short + 1).copied();
        let into = match (prev, next) {
            (Some(p), Some(n)) => if p.1 >= n.1 { p } else { n },
            (Some(p), None) => p,
            (None, Some(n)) => n,
            (None, None) => return,
        };
        let label = labels[into.0];
        let (s, l) = runs[short];
        for x in &mut labels[s..s + l] {
            *x = label;
        }
    }
}

/// Joins neighbouring pieces by the same speaker into turns, and numbers the
/// voices from 1 in the order they first speak.
pub fn merge_turns(pieces: &[Piece]) -> Vec<Turn> {
    let mut order: Vec<i32> = Vec::new();
    let mut turns: Vec<Turn> = Vec::new();
    let mut last: Option<Who> = None;
    for p in pieces {
        let sp = match p.who {
            Who::Me => "me".to_string(),
            Who::Voice(v) => {
                let n = order.iter().position(|x| *x == v).unwrap_or_else(|| {
                    order.push(v);
                    order.len() - 1
                });
                (n + 1).to_string()
            }
        };
        let ms = |s: f32| (s.max(0.0) * 1000.0).round() as u32;
        match turns.last_mut() {
            Some(t) if last == Some(p.who) => {
                t.e = ms(p.end).max(t.e);
                t.t.push(' ');
                t.t.push_str(&p.text);
            }
            _ => turns.push(Turn { sp, s: ms(p.start), e: ms(p.end), t: p.text.clone() }),
        }
        last = Some(p.who);
    }
    turns
}

/// Labels turns that already exist (re-running speaker detection): "Me" turns
/// stay as they are, the rest take the voice found around them. Returns the
/// pieces, ready for `merge_turns`.
pub fn relabel(turns: &[Turn], spans: &[Span]) -> Vec<Piece> {
    turns
        .iter()
        .map(|t| {
            let (start, end) = (t.s as f32 / 1000.0, t.e as f32 / 1000.0);
            let who = if t.sp == "me" { Who::Me } else { Who::Voice(voice_at(spans, start, end).unwrap_or(0)) };
            Piece { who, start, end, text: t.t.clone() }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Loudness frames (100 ms each): `(from_secs, to_secs, level)` blocks, quiet elsewhere.
    fn env_of(blocks: &[(f32, f32, f32)], secs: f32) -> Vec<f32> {
        let mut v = vec![0.0005; (secs / HOP_SECS) as usize];
        for &(a, b, level) in blocks {
            for i in (a / HOP_SECS) as usize..((b / HOP_SECS) as usize).min(v.len()) {
                v[i] = level;
            }
        }
        v
    }

    fn word(text: &str, start: f32, end: f32) -> Word {
        Word { text: text.into(), start, end }
    }

    fn seg(words: Vec<Word>) -> Seg {
        Seg { start: words[0].start, end: words.last().unwrap().end, text: words.iter().map(|w| w.text.as_str()).collect(), words }
    }

    #[test]
    fn the_microphone_clearly_louder_is_me() {
        let env = Envelopes { mic: env_of(&[(0.0, 2.0, 0.1)], 4.0), sys: env_of(&[(2.0, 4.0, 0.1)], 4.0) };
        assert!(is_me(&env, 0.2, 1.8));
        assert!(!is_me(&env, 2.2, 3.8), "the other side speaking is not me");
        // Speaker bleed: the microphone hears a quieter copy of the system audio.
        let bleed = Envelopes { mic: env_of(&[(0.0, 2.0, 0.03)], 2.0), sys: env_of(&[(0.0, 2.0, 0.1)], 2.0) };
        assert!(!is_me(&bleed, 0.0, 2.0));
        // Room hiss alone, nobody on the system track, is not speech.
        let hiss = Envelopes { mic: env_of(&[(0.0, 2.0, 0.002)], 2.0), sys: env_of(&[], 2.0) };
        assert!(!is_me(&hiss, 0.0, 2.0));
        // Both talking at once with similar loudness is not clearly me.
        let both = Envelopes { mic: env_of(&[(0.0, 2.0, 0.1)], 2.0), sys: env_of(&[(0.0, 2.0, 0.08)], 2.0) };
        assert!(!is_me(&both, 0.0, 2.0));
    }

    #[test]
    fn me_and_two_voices_in_a_call() {
        let env = Envelopes { mic: env_of(&[(0.0, 2.0, 0.1)], 8.0), sys: env_of(&[(2.0, 5.0, 0.1), (5.0, 8.0, 0.1)], 8.0) };
        let spans = [Span { start: 2.0, end: 5.0, speaker: 7 }, Span { start: 5.0, end: 8.0, speaker: 3 }];
        let segs = [
            seg(vec![word(" Hello", 0.1, 0.5), word(" everyone", 0.5, 1.0), word(" thanks", 1.0, 1.4), word(" for", 1.4, 1.7)]),
            seg(vec![word(" Glad", 2.1, 2.5), word(" to", 2.5, 2.8), word(" be", 2.8, 3.2), word(" here", 3.2, 4.0)]),
            seg(vec![word(" Same", 5.2, 5.8), word(" here", 5.8, 6.5), word(" really", 6.5, 7.0)]),
        ];
        let turns = merge_turns(&attribute(&segs, &env, &spans, Mode::Both));
        let who: Vec<&str> = turns.iter().map(|t| t.sp.as_str()).collect();
        assert_eq!(who, ["me", "1", "2"], "voices are numbered by who spoke first");
        assert_eq!(turns[0].t, "Hello everyone thanks for");
        assert_eq!((turns[1].s, turns[1].e), (2100, 4000));
    }

    #[test]
    fn a_segment_is_cut_where_the_speaker_changes_but_not_at_a_blip() {
        let env = Envelopes { mic: env_of(&[(0.0, 2.0, 0.1)], 6.0), sys: env_of(&[(2.0, 6.0, 0.1)], 6.0) };
        let spans = [Span { start: 2.0, end: 6.0, speaker: 0 }];
        // One long segment that runs from me into the other person.
        let s = seg(vec![
            word(" So", 0.2, 0.5), word(" I", 0.5, 0.8), word(" think", 0.8, 1.2), word(" yes", 1.2, 1.9),
            word(" Right", 2.1, 2.5), word(" exactly", 2.5, 3.2), word(" agreed", 3.2, 4.0),
        ]);
        let turns = merge_turns(&attribute(&[s], &env, &spans, Mode::Both));
        assert_eq!(turns.iter().map(|t| t.sp.as_str()).collect::<Vec<_>>(), ["me", "1"]);
        assert_eq!(turns[0].t, "So I think yes");

        // A single word in the wrong place (bad timings) doesn't split a turn.
        let blip = seg(vec![
            word(" a", 2.1, 2.4), word(" b", 2.4, 2.7), word(" c", 0.5, 0.8), word(" d", 3.0, 3.3), word(" e", 3.3, 3.6),
        ]);
        let turns = merge_turns(&attribute(&[blip], &env, &spans, Mode::Both));
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].t, "a b c d e");
    }

    #[test]
    fn one_track_has_no_me() {
        // Loud microphone, but there's nothing to compare it with: everyone is a numbered voice.
        let env = Envelopes { mic: env_of(&[(0.0, 4.0, 0.1)], 4.0), sys: vec![] };
        let spans = [Span { start: 0.0, end: 2.0, speaker: 1 }, Span { start: 2.0, end: 4.0, speaker: 0 }];
        let segs = [
            seg(vec![word(" one", 0.1, 0.6), word(" two", 0.6, 1.2), word(" three", 1.2, 1.9)]),
            seg(vec![word(" four", 2.1, 2.6), word(" five", 2.6, 3.2), word(" six", 3.2, 3.9)]),
        ];
        let turns = merge_turns(&attribute(&segs, &env, &spans, Mode::Single));
        assert_eq!(turns.iter().map(|t| t.sp.as_str()).collect::<Vec<_>>(), ["1", "2"]);
    }

    #[test]
    fn words_in_a_gap_take_the_nearest_voice_and_segments_without_words_still_count() {
        let spans = [Span { start: 0.0, end: 1.0, speaker: 4 }, Span { start: 3.0, end: 4.0, speaker: 9 }];
        assert_eq!(voice_at(&spans, 1.1, 1.4), Some(4), "just after the first span");
        assert_eq!(voice_at(&spans, 2.6, 2.9), Some(9), "just before the second");
        assert_eq!(voice_at(&spans, 10.0, 10.5), None, "too far from anyone");
        let env = Envelopes::default();
        let bare = Seg { start: 0.1, end: 0.9, text: " hi there".into(), words: vec![] };
        let turns = merge_turns(&attribute(&[bare], &env, &spans, Mode::Single));
        assert_eq!(turns, vec![Turn { sp: "1".into(), s: 100, e: 900, t: "hi there".into() }]);
    }

    #[test]
    fn merging_joins_neighbours_only() {
        let p = |who, s: f32, e: f32, t: &str| Piece { who, start: s, end: e, text: t.into() };
        let turns = merge_turns(&[
            p(Who::Voice(5), 0.0, 1.0, "a"),
            p(Who::Voice(5), 1.2, 2.0, "b"),
            p(Who::Me, 2.0, 3.0, "c"),
            p(Who::Voice(5), 3.0, 4.0, "d"),
            p(Who::Voice(2), 4.0, 5.0, "e"),
        ]);
        assert_eq!(turns.len(), 4);
        assert_eq!(turns[0], Turn { sp: "1".into(), s: 0, e: 2000, t: "a b".into() });
        assert_eq!(turns[2].sp, "1", "the same voice later keeps its number");
        assert_eq!(turns[3].sp, "2");
    }

    #[test]
    fn re_running_keeps_me_and_relabels_the_rest() {
        let turns = [
            Turn { sp: "me".into(), s: 0, e: 2000, t: "hello".into() },
            Turn { sp: "1".into(), s: 2000, e: 4000, t: "hi".into() },
            Turn { sp: "2".into(), s: 4000, e: 6000, t: "hey".into() },
        ];
        // The new run finds a single voice for everything after the first two seconds.
        let spans = [Span { start: 2.0, end: 6.0, speaker: 0 }];
        let merged = merge_turns(&relabel(&turns, &spans));
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].sp, "me");
        assert_eq!(merged[1], Turn { sp: "1".into(), s: 2000, e: 6000, t: "hi hey".into() });
    }
}
