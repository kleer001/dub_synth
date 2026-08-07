// dub_synth/dsp/echo.js — the dub echo, and Live's Filter Delay.
//
// The echo is the genre. Everything here is built to Koçer's measured
// reconstruction of it (research/dub_techno_technique.md §2) rather than to a
// generic delay: a high-pass and a low-pass *inside* the feedback loop, a fixed
// ±8% stereo time offset instead of ping-pong, a time-based (not beat-synced)
// mode whose delay time can be modulated to produce the genre's pitch
// artefacts, and saturation in the loop for the RE-201's tape colour (§5).
//
// Every node here is a standard Web Audio node, so the whole thing renders
// through an OfflineAudioContext — no worklets.

import { satCurve } from "../core/dsp.js";
import { randomWalk, ride, sineLfo } from "./knob.js";

const MAX_DELAY = 2.0;

// Koçer's measured defaults (§2, the time-based delay example): feedback 90%,
// HPF 200 Hz, LPF 5 kHz, offset +8%L / -8%R, dry/wet 70%. Feedback starts lower
// here — 90% is the runaway setting a gesture rides *up* to, not a resting one.
const DEFAULTS = {
  time: 0.237,     // Listing, Sinking's measured stab echo: dotted ~237 ms (§6)
  feedback: 0.5,   // its measured feedback, and Live's Echo default
  wet: 0.7,        // its measured wet amount, and Live's Echo default
  dry: 1.0,
  hpf: 200,
  lpf: 5000,
  offset: 0.08,
  sat: 0.35,
  wow: 0.0006,     // tape wander, in seconds of delay-time swing
  // How far apart the two lines sit. Fully hard-panned lines are almost
  // decorrelated, which costs ~3 dB when the mix is summed to mono — and dub is
  // a sound-system genre, so mono survival is not optional. 0.8 keeps the width
  // obvious while leaving the channels partly correlated.
  spread: 0.8,
  // A governed ceiling. With saturation in the loop the echo self-limits rather
  // than diverging, but anything much above this stops being a repeat and
  // becomes a sustained wash that fills every gap the groove needs. The cap is
  // enforced on every path that can raise feedback, so no caller can wander past
  // it by accident.
  maxFeedback: 0.72,
};

export function makeDubEcho(ctx, opts = {}) {
  const p = { ...DEFAULTS, ...opts };
  const capFb = (v) => Math.min(v, p.maxFeedback);

  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  dry.gain.value = p.dry;
  wet.gain.value = p.wet;

  // Two independent lines. The ±8% time offset alone produces the
  // "non-mechanical, 'flawed' human perception of timing" — no panning
  // modulation involved (§2).
  const line = (pan) => {
    const delay = ctx.createDelay(MAX_DELAY);
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = p.hpf; hp.Q.value = 0.13;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = p.lpf; lp.Q.value = 0.21;
    const fb = ctx.createGain(); fb.gain.value = p.feedback;

    // Tape colour, as a dry/wet blend into a fixed tanh shaper.
    // node-web-audio-api forbids reassigning WaveShaperNode.curve, so the curve
    // is written once and `sat` crossfades rather than rebuilding it.
    const shaper = ctx.createWaveShaper();
    shaper.curve = satCurve(0.8);
    shaper.oversample = "4x";
    const clean = ctx.createGain(); clean.gain.value = 1 - p.sat;
    const dirty = ctx.createGain(); dirty.gain.value = p.sat;
    const sum = ctx.createGain();

    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;

    input.connect(delay);
    delay.connect(hp).connect(lp);
    lp.connect(clean).connect(sum);
    lp.connect(dirty).connect(shaper).connect(sum);
    sum.connect(fb).connect(delay);   // the loop
    sum.connect(panner).connect(wet); // the tap

    return { delay, hp, lp, fb, clean, dirty, panner };
  };

  p.feedback = capFb(p.feedback);
  const L = line(-p.spread);
  const R = line(p.spread);
  const lines = [L, R];

  input.connect(dry).connect(output);
  wet.connect(output);

  // Tape wander. A slow sine on both delay times; depth in seconds.
  const wowL = sineLfo(ctx, L.delay.delayTime, { rate: 0.31, depth: p.wow });
  const wowR = sineLfo(ctx, R.delay.delayTime, { rate: 0.27, depth: p.wow });

  let time = p.time;
  let offset = p.offset;
  const applyTime = (at) => {
    const l = Math.min(MAX_DELAY, time * (1 - offset));
    const r = Math.min(MAX_DELAY, time * (1 + offset));
    if (at === undefined) { L.delay.delayTime.value = l; R.delay.delayTime.value = r; }
    else { ride(L.delay.delayTime, l, at, 0.02); ride(R.delay.delayTime, r, at, 0.02); }
  };
  applyTime();

  return {
    input, output, wet, dry, lines,

    set(q = {}, at) {
      if (q.time !== undefined) { time = q.time; applyTime(at); }
      if (q.offset !== undefined) { offset = q.offset; applyTime(at); }
      for (const ln of lines) {
        if (q.feedback !== undefined) at === undefined ? (ln.fb.gain.value = capFb(q.feedback)) : ride(ln.fb.gain, capFb(q.feedback), at);
        if (q.hpf !== undefined) at === undefined ? (ln.hp.frequency.value = q.hpf) : ride(ln.hp.frequency, q.hpf, at);
        if (q.lpf !== undefined) at === undefined ? (ln.lp.frequency.value = q.lpf) : ride(ln.lp.frequency, q.lpf, at);
        if (q.sat !== undefined) { ln.clean.gain.value = 1 - q.sat; ln.dirty.gain.value = q.sat; }
      }
      if (q.wet !== undefined) at === undefined ? (wet.gain.value = q.wet) : ride(wet.gain, q.wet, at);
      if (q.dry !== undefined) at === undefined ? (dry.gain.value = q.dry) : ride(dry.gain, q.dry, at);
      if (q.wow !== undefined) { wowL.depth.value = q.wow; wowR.depth.value = q.wow; }
      if (q.spread !== undefined) { L.panner.pan.value = -q.spread; R.panner.pan.value = q.spread; }
      return this;
    },

    // The knob ride that marks a transition (§3). Feedback up, tail runs ~2
    // measures in the dub originals, then back down for a soft decay.
    throwFeedback(at, { peak = 0.95, rise = 0.15, hold = 1.0, fall = 1.2 } = {}) {
      for (const ln of lines) {
        ride(ln.fb.gain, capFb(peak), at, rise);
        ride(ln.fb.gain, p.feedback, at + rise + hold, fall);
      }
      return this;
    },

    // Koçer's core move (§2): feedback under a random-waveshape LFO at a
    // non-synchronised 4.26 Hz. This is the "human uncertainty" in the density
    // and dynamism of the repeats.
    rideFeedback({ rng, seconds, rate = 4.26, min = 0.25, max = 0.85, smooth = 1, start = 0 }) {
      let n = 0;
      const hi = capFb(max), lo = Math.min(min, hi);
      for (const ln of lines) n += randomWalk(ln.fb.gain, { rng, rate, min: lo, max: hi, smooth, start, seconds });
      return n;
    },

    // The slow counterpart (§2): low-pass cutoff on a 0.11 Hz sine, swinging
    // presence against depth. Incommensurable with the feedback walk on purpose.
    driftTone({ rate = 0.11, centre = 2750, depth = 2250, start = 0 } = {}) {
      return lines.map((ln) => sineLfo(ctx, ln.lp.frequency, { rate, depth, centre, start }));
    },

    // Time-based delay whose time is modulated — the source of dub's pitch
    // artefacts on the tail (§2). Koçer clamps the LFO to 40–80% of range with
    // 100% smoothing so the shifts stay musical.
    warpTime({ rng, seconds, rate = 1, low = 0.4, high = 0.8, smooth = 1, start = 0 }) {
      const min = time * low, max = time * high;
      let n = 0;
      for (const ln of lines) n += randomWalk(ln.delay.delayTime, { rng, rate, min, max, smooth, start, seconds });
      return n;
    },
  };
}

// Live's Filter Delay: three independent delay lines, each fed through its own
// band-pass, with its own time, feedback, level and pan. Named in the Basic
// Channel stab recipe (§5) as the last stage of the stab chain, at a dotted 1/8.
const DEFAULT_BANDS = [
  { freq: 160, q: 0.7, time: 0.237, feedback: 0.35, level: 0.5, pan: -0.6 },
  { freq: 900, q: 1.0, time: 0.237, feedback: 0.45, level: 0.7, pan: 0.0 },
  { freq: 3500, q: 1.4, time: 0.158, feedback: 0.30, level: 0.5, pan: 0.6 },
];

export function makeFilterDelay(ctx, { bands = DEFAULT_BANDS } = {}) {
  const input = ctx.createGain();
  const output = ctx.createGain();

  const built = bands.map((b) => {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = b.freq; bp.Q.value = b.q;
    const delay = ctx.createDelay(MAX_DELAY);
    delay.delayTime.value = b.time;
    const fb = ctx.createGain(); fb.gain.value = b.feedback;
    const level = ctx.createGain(); level.gain.value = b.level;
    const panner = ctx.createStereoPanner(); panner.pan.value = b.pan;

    input.connect(bp).connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(level).connect(panner).connect(output);
    return { bp, delay, fb, level, panner };
  });

  return {
    input, output, bands: built,
    set(i, q = {}, at) {
      const b = built[i];
      if (!b) throw new Error(`filter delay has no band ${i}`);
      if (q.freq !== undefined) at === undefined ? (b.bp.frequency.value = q.freq) : ride(b.bp.frequency, q.freq, at);
      if (q.time !== undefined) at === undefined ? (b.delay.delayTime.value = q.time) : ride(b.delay.delayTime, q.time, at);
      if (q.feedback !== undefined) at === undefined ? (b.fb.gain.value = q.feedback) : ride(b.fb.gain, q.feedback, at);
      if (q.level !== undefined) at === undefined ? (b.level.gain.value = q.level) : ride(b.level.gain, q.level, at);
      return this;
    },
  };
}
