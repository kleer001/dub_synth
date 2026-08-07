// dub_synth/dsp/lfo.js — the LFO tool, carried over from GLITCHFIELD.
//
// Ported from the sibling instrument's modulation engine (`../glitchfield`,
// `rollLFOs` / `lfoValue` / `updateMod`). What is worth having is its vocabulary:
// four shapes, tempo-synced divisions from four measures down to a 1/16, a
// deterministic roll from a seed, and **meta-modulation** — an LFO that re-rates
// or re-depths another LFO, which is what stops a modulation bed from settling
// into a pattern you can hear.
//
// One thing had to change in the port. GLITCHFIELD evaluates its LFOs per frame
// in a requestAnimationFrame loop and writes the result to AudioParams, which
// cannot render offline — there are no frames in an OfflineAudioContext. So here
// an LFO is either a **native OscillatorNode** (sine, triangle and square are all
// native types, sample-accurate and free) or, for the random shape, a **scheduled
// walk** onto the param. Both render offline and both stay inside the seeded
// contract.
//
// Two rate systems, deliberately: `div` is tempo-synced in beats, `hz` is free.
// Dub needs both — Koçer's echo modulation is explicitly non-synchronised because
// that is what reads as a hand, while a filter that breathes with the bar reads as
// arrangement (research/dub_techno_technique.md §2).

import { mulberry32 } from "../core/rng.js";
import { randomWalk } from "./knob.js";

// Musical divisions, in beats. GLITCHFIELD's ladder, unchanged.
export const LFO_DIVS = [
  { label: "4m", beats: 16 }, { label: "3m", beats: 12 }, { label: "2m", beats: 8 },
  { label: "1/1", beats: 4 }, { label: "1/2", beats: 2 }, { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 }, { label: "1/16", beats: 0.25 },
];

export const SHAPES = ["sine", "triangle", "square", "random"];
const NATIVE = { sine: "sine", triangle: "triangle", square: "square" };

export const divToHz = (beats, bpm) => bpm / 60 / beats;

// Attach one LFO to an AudioParam. `centre` sets the param's own value and the
// LFO swings ±depth around it. Returns a handle whose `rate` and `depth` are
// themselves AudioParams — which is what makes meta-modulation possible.
export function attachLfo(ctx, param, {
  shape = "sine", div, hz, bpm = 125, depth = 1, centre,
  phase = 0, rng, seconds, smooth = 1, start = 0,
} = {}) {
  if (!SHAPES.includes(shape)) throw new Error(`unknown LFO shape "${shape}"`);
  const freq = hz ?? divToHz(div ?? 4, bpm);
  if (centre !== undefined) param.value = centre;

  if (shape === "random") {
    // No native random oscillator, and a worklet would not render offline — so
    // the walk is scheduled ahead of time, exactly as knob.js does it.
    if (!rng || !seconds) throw new Error("a random-shape LFO needs `rng` and `seconds` to schedule its walk");
    const span = depth;
    const base = centre ?? param.value;
    randomWalk(param, { rng, rate: freq, min: base - span, max: base + span, smooth, start, seconds });
    return { shape, freq, scheduled: true, rate: null, depth: null };
  }

  const osc = ctx.createOscillator();
  osc.type = NATIVE[shape];
  osc.frequency.value = freq;
  // A phase offset on a native oscillator is a start-time offset.
  const amount = ctx.createGain();
  amount.gain.value = depth;
  osc.connect(amount).connect(param);
  osc.start(start + (phase % 1) / Math.max(1e-6, freq));
  return { shape, freq, scheduled: false, osc, rate: osc.frequency, depth: amount.gain };
}

// Meta-modulation: one LFO drives another's rate or depth. GLITCHFIELD's
// `lfoRate` / `lfoDepth` meta targets, expressed as a signal connection instead
// of a per-frame write. Only works on native (non-scheduled) LFOs — a scheduled
// walk has already been written by the time this could apply.
export function metaModulate(ctx, target, { kind = "depth", shape = "sine", div = 12, hz, bpm = 125, amount = 0.4, start = 0 } = {}) {
  const param = kind === "rate" ? target.rate : target.depth;
  if (!param) throw new Error(`cannot meta-modulate the ${kind} of a scheduled LFO`);
  const scale = kind === "rate" ? target.freq * amount : amount;
  return attachLfo(ctx, param, { shape, div, hz, bpm, depth: scale, start });
}

// Deterministic LFO specs from a seed — GLITCHFIELD's `rollLFOs`, with its shape
// weighting (sine twice, triangle twice, square, random) and its one fast slot.
// Targets are left to the caller: this repo's parameters are not that repo's.
export function rollLfos(seed, count = 6, { fastSlot = true } = {}) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const r = mulberry32(seed * 97 + k * 29 + 11);
    const fast = fastSlot && k === 0;
    const idx = fast ? 4 + Math.floor(r() * 4) : Math.floor(r() * 5);
    const shape = ["sine", "sine", "triangle", "triangle", "square", "random"][Math.floor(r() * 6)];
    let depth = 0.2 + r() * 0.32;
    if (fast) depth += 0.18;
    out.push({ div: LFO_DIVS[Math.min(idx, LFO_DIVS.length - 1)].beats, shape, depth });
  }
  return out;
}
