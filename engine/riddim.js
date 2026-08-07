// dub_synth/riddim.js — the dry frame. Stage 5, first half.
//
// The riddim is the harmonised groove treated as a reusable object that the
// operator then performs on (research/dub_techno_technique.md §4). Its job in
// this engine is precisely the job Koçer says it does in the originals: to be a
// **fixed dry frame that constrains the wet** — "the rhythmic pattern
// concretized by the bass and percussion partitions … functions as a frame,
// preventing the output from deviating from the overall form of rhythm as the
// feedback amount increases" (§3).
//
// So this file is deliberately small and deliberately static. It is not a step
// sequencer with development; it is one bar that repeats while the mixer does
// the composing. Harmonic rate is near zero on purpose: two chords over 32 bars
// (Listing, Sinking), one triad plus a colour note (Aerial), a two-chord iv-i
// (Resonance) — that is the whole harmonic budget of the genre (§7.7).

import { degreeToMidi, midiToFreq, tonicToMidi } from "./core/music.js";
import { makeRng } from "./core/rng.js";

const STEPS = 16; // one bar at 16th resolution

// The three core reggae drum patterns, classified by where the kick falls (§4).
// Dub techno takes steppers; the others are here because the riddim is meant to
// be blended and embellished rather than played fixed.
export const DRUM_PATTERNS = {
  //                 1 e & a 2 e & a 3 e & a 4 e & a
  steppers: { kick: [1,0,0,0,1,0,0,0,1,0,0,0,1,0,0,0], snare: [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0] },
  rockers:  { kick: [1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], snare: [0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0] },
  oneDrop:  { kick: [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0], snare: [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0] },
};

// The hi-hat carries the accentuation (§4) and it sits off-beat — which is also
// what feeds the echo, since dub applies echo to off-beat material (§3).
const OFFBEAT_8THS = [2, 6, 10, 14];

// Progressions transcribed from the analysed tracks (§6), as scale degrees in the
// natural minor. Every one of them is one or two chords.
export const PROGRESSIONS = {
  aerial: [0],              // G minor, with Eb arriving as a colour note
  phylyps: [0],             // Gm and its inversions, nothing else
  listing: [0, 4],          // Bm - F#m, held 32 bars
  resonance: [3, 0],        // Cm/G - Gm, iv - i
  salt: [0, 4, 3],          // Dm/F - Am - G, the one track with real function
};

// Reggae bass patterns (Matheos, via §4). Scale-degree offsets from the chord root.
const BASS_SHAPES = {
  rootFifthOctave: [0, 4, 7],
  rootThirdFifth: [0, 2, 4],
};

// The groove operators, all from §4. Each takes a placed bass figure (a list of
// { step, degree, dead }) and returns a varied one. They are what keeps a riff
// that never changes pitch from sounding like a loop.
export const GROOVE_OPS = {
  // Shift the figure horizontally without changing its pitches. "Instantly makes
  // the groove more interesting"; unnoticed if not overdone.
  displace: (figure, n) => figure.map((e) => ({ ...e, step: (e.step + n + STEPS) % STEPS })),
  // Rest on a downbeat instead of playing it — Matheos calls this "breathing".
  breathe: (figure) => figure.filter((e) => e.step % 4 !== 0 || e.step === 0),
  // Muted percussive notes; a bassline using them consistently reads as percussion.
  deadNotes: (figure, steps) => figure.map((e) => (steps.includes(e.step) ? { ...e, dead: true } : e)),
  // Start somewhere other than the root. Reggae is groove-based; patterns need
  // not begin on the root.
  rotate: (figure, n) => figure.map((e, i, a) => ({ ...e, degree: a[(i + n) % a.length].degree })),
};

// Builds one bar of the riddim. `rng` only picks between documented options — it
// never invents material, because the frame has to stay fixed for the wet layer
// to be safe to push (§3).
//
// The per-bar variation draws from a stream derived from the bar NUMBER, not
// from a running one. A riddim is a thing you can look at: asking for bar 40
// twice has to give the same bar twice, whether it is being previewed, rendered,
// or re-rendered after an unrelated edit upstream.
export function makeRiddim({
  rng,
  tonic = "G",
  octave = 2,
  mode = "minor",
  pattern = "steppers",
  progression = "listing",
  barsPerChord = 16,
  bassShape = "rootFifthOctave",
  // How much the fixed frame breathes. These are the §4 groove operators'
  // likelihoods per bar, and they are the one genuinely continuous dial in the
  // riddim: at zero the bar is identical forever, and turned up the figure
  // displaces, rests and mutes without ever changing pitch. Defaults are the
  // measured-feel values the engine shipped with.
  groove = { displace: 0.35, breathe: 0.25, deadNotes: 0.30, rotate: 0.15 },
} = {}) {
  const drums = DRUM_PATTERNS[pattern];
  if (!drums) throw new Error(`unknown drum pattern "${pattern}"`);
  const degrees = PROGRESSIONS[progression];
  if (!degrees) throw new Error(`unknown progression "${progression}"`);
  const shape = BASS_SHAPES[bassShape];
  if (!shape) throw new Error(`unknown bass shape "${bassShape}"`);

  const bassRoot = tonicToMidi(tonic, octave);
  const stabRoot = tonicToMidi(tonic, octave + 2);

  // One figure, varied per bar by the groove operators rather than rewritten.
  const base = shape.map((degree, i) => ({ step: i * 4 + (i === 2 ? 2 : 0), degree, dead: false }));
  // Consumed once at construction; every bar's variation hangs off it.
  const barSalt = rng.int(1, 0x3fffffff);
  const barRng = (bar) => makeRng((barSalt + Math.imul(bar + 1, 0x9e3779b1)) >>> 0);

  return {
    steps: STEPS,
    pattern,
    groove,
    progression,
    degrees,
    barsPerChord,

    // Which chord is sounding in a given bar. Near-zero harmonic rate is the point.
    chordAt(bar) {
      return degrees[Math.floor(bar / barsPerChord) % degrees.length];
    },

    // The stab voicing: a triad on the current chord. One triad plus a colour
    // note is the genre's whole harmonic budget, so the "colour" is an added
    // seventh that appears only on some bars.
    stabChord(bar, { colour = false } = {}) {
      const deg = this.chordAt(bar);
      const tones = [0, 2, 4].map((d) => degreeToMidi(stabRoot, mode, deg + d));
      if (colour) tones.push(degreeToMidi(stabRoot, mode, deg + 6));
      return tones.map(midiToFreq);
    },

    // Stabs land off-beat — that placement is what the echo works on (§3).
    stabSteps(bar) {
      return bar % 2 === 0 ? [2, 10] : [2, 6, 10];
    },

    kickSteps: () => drums.kick.flatMap((v, i) => (v ? [i] : [])),
    snareSteps: () => drums.snare.flatMap((v, i) => (v ? [i] : [])),
    hatSteps: () => OFFBEAT_8THS.slice(),
    shakerSteps: () => [1, 3, 5, 7, 9, 11, 13, 15],

    // The bass figure for a bar, varied by the groove operators. The variation is
    // seeded and mild — displacement goes unnoticed if it is not exaggerated.
    bassFigure(bar) {
      const r = barRng(bar);
      const deg = this.chordAt(bar);
      let figure = base.map((e) => ({ ...e }));
      if (r.chance(groove.displace)) figure = GROOVE_OPS.displace(figure, r.pick([-2, -1, 1, 2]));
      if (r.chance(groove.breathe)) figure = GROOVE_OPS.breathe(figure);
      if (r.chance(groove.deadNotes)) figure = GROOVE_OPS.deadNotes(figure, [r.pick([6, 7, 14, 15])]);
      if (r.chance(groove.rotate)) figure = GROOVE_OPS.rotate(figure, 1);
      return figure.map((e) => ({
        ...e,
        hz: midiToFreq(degreeToMidi(bassRoot, mode, deg + e.degree)),
      }));
    },
  };
}
