// Pitch / harmony model: minor modes, degree→midi→frequency, chords, and the
// uncopyrightable idiom progressions from cyberpunk_audio_songs.md §5.

export const MODES = {
  aeolian: [0, 2, 3, 5, 7, 8, 10], // natural minor
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], // the dark/psychedelic one
  mixolydian: [0, 2, 4, 5, 7, 9, 10], // major with a flat-7 (the wistful Porcelain color)
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  minorPent: [0, 3, 5, 7, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Cents → a frequency ratio (1200 cents = one octave). The microtonal twin of a semitone
// transpose: a sung note's preserved intonation (analysis/vocal.js `detune`, in cents)
// becomes a multiply on its base frequency — trivial here because the voices are
// frequency-driven, not MIDI (no pitch-bend / MPE plumbing needed).
export const centsToRatio = (cents) => Math.pow(2, (cents || 0) / 1200);

// Fold any (possibly negative) semitone/degree number into a pitch class 0..11. The single
// home for the `((n % 12) + 12) % 12` idiom the analysis extractors lean on repeatedly.
export const pitchClass = (n) => ((n % 12) + 12) % 12;

export function tonicToMidi(tonic, octave = 3) {
  const i = typeof tonic === "number" ? tonic : NOTE_NAMES.indexOf(tonic);
  return 12 * (octave + 1) + (i < 0 ? 0 : i);
}

// 1-based scale degree → midi, wrapping octaves above/below.
export function degreeToMidi(rootMidi, mode, degree) {
  const scale = MODES[mode] || MODES.aeolian;
  const n = scale.length;
  const d = degree - 1;
  const oct = Math.floor(d / n);
  const idx = ((d % n) + n) % n;
  return rootMidi + oct * 12 + scale[idx];
}

// Triad/seventh stacked in thirds on a scale degree.
export function chordTones(rootMidi, mode, degree, size = 3) {
  const out = [];
  for (let i = 0; i < size; i++) out.push(degreeToMidi(rootMidi, mode, degree + i * 2));
  return out;
}

// Voice a chord UNDER a ceiling (B3 duck): drop any tone at/above `ceilingHz` by whole
// octaves until it sits below it (others unchanged), so a pad/stab stays out of the
// topline's register instead of colliding with it. No ceiling → freqs returned as-is.
export function voiceUnder(freqs, ceilingHz) {
  if (!ceilingHz) return freqs;
  return freqs.map((f) => { while (f >= ceilingHz && f > 1) f /= 2; return f; });
}

// Progression families (arrays of scale degrees). Lowercase-in-name = minor context.
export const PROGRESSIONS = {
  "i-VI-III-VII": [1, 6, 3, 7], // canonical uplifting-trance loop
  "vi-IV-I-V": [6, 4, 1, 5], // anthem cadence
  "i-VII-VI-VII": [1, 7, 6, 7], // rocking minor vamp
  andalusian: [1, 7, 6, 5], // Phrygian descent — acid/psy/industrial
  pedal: [1, 1, 1, 1], // hypnotic / dub / ambient
  "dorian-vamp": [1, 4, 1, 4], // i ⇄ IV — exploits Dorian's major-IV (house)
  "ii-V-i": [2, 5, 1, 1], // soulful/deep-house cadence (diatonic 7ths from the mode)
  "I-II-vii-iii": [1, 2, 7, 3], // floating major/Lydian filter-house vamp — no IV, no cadence (French house)
  "i-iv-v": [1, 4, 5, 4], // all-minor i/iv/v mode-mixing — the wistful deadmau5 progressive-house color
};
