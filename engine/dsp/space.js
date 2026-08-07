// dub_synth/dsp/space.js — the three reverbs the analysed records actually use.
//
// Aerial's drum kit is "brought into the dub context with the help of spring
// reverb"; its stabs are "reverberated in a wet manner, using a relatively high
// pre-delay ratio"; Resonance opens and closes on shimmer reverb
// (research/dub_techno_technique.md §6). So: a short dispersive spring on
// percussion, a long plate held off the transient by a large pre-delay on the
// melodic layer, and a rising shimmer for the introduction and the outro.
//
// All three are convolvers over impulses synthesized in core/dsp.js, so they
// render offline. Reverb sits on a send, never as an insert — the source stays
// dry and the space is a separate, ridable channel (§8; cf.
// research/shpongle_technique.md).

import { impulse, springImpulse } from "../core/dsp.js";
import { makeBestPitchShifter } from "./fx.js";
import { ride } from "./knob.js";

// Scale an impulse to unit energy. Convolution multiplies RMS by sqrt(sum of the
// IR's squares), so normalising that to 1 makes the convolver a unity-gain
// process: the bus return then sets how loud the space is, and lengthening the
// decay makes the tail longer WITHOUT making it louder. Web Audio's own
// `normalize` flag does something different and decay-dependent, which is why it
// is switched off in favour of this.
function normalizeIr(buffer, energy = 1) {
  let sum = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
  }
  const norm = Math.sqrt(sum / buffer.numberOfChannels);
  if (norm <= 1e-12) return buffer;
  const g = energy / norm;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= g;
  }
  return buffer;
}

function convolverSend(ctx, buffer, { preDelay, wet }) {
  const input = ctx.createGain();
  const pre = ctx.createDelay(0.5);
  pre.delayTime.value = preDelay;
  const conv = ctx.createConvolver();
  // normalize defaults to TRUE, which rescales the impulse by its own energy —
  // for a synthesized multi-second IR that is a ~40 dB attenuation, and it makes
  // the bus return level meaningless because the reverb's loudness then depends
  // on its decay time rather than on the fader. Turn it off and let the return
  // set the level. It has to be set BEFORE the buffer: normalization is applied
  // at assignment.
  conv.normalize = false;
  conv.buffer = normalizeIr(buffer);
  const level = ctx.createGain();
  level.gain.value = wet;
  const output = ctx.createGain();

  input.connect(pre).connect(conv).connect(level).connect(output);
  return { input, output, pre, conv, level };
}

// Spring: short, dispersive, midrange-weighted — the chirpy tank on the drums.
// `color` is the mid centre the springImpulse leans on. `random` is the impulse's
// noise source — pass a seeded () => [0,1) so the IR is the same every render.
export function makeSpring(ctx, { decay = 1.1, color = 2000, preDelay = 0.004, wet = 1, random } = {}) {
  const g = convolverSend(ctx, springImpulse(ctx, decay, { color, stereo: true, random }), { preDelay, wet });
  return {
    ...g,
    // Decay changes rebuild the impulse; do it between sections, not under a note.
    setDecay(seconds, { color: c = color } = {}) {
      g.conv.buffer = normalizeIr(springImpulse(ctx, seconds, { color: c, stereo: true, random }));
      return this;
    },
    setLevel(v, at) { at === undefined ? (g.level.gain.value = v) : ride(g.level.gain, v, at); return this; },
    setPreDelay(v, at) { at === undefined ? (g.pre.delayTime.value = v) : ride(g.pre.delayTime, v, at); return this; },
  };
}

// Plate: the long wet space for stabs and pads. The default pre-delay is 90 ms
// — the "relatively high pre-delay ratio" Koçer hears on Aerial's stabs, which
// is what keeps a very wet reverb from smearing the off-beat attack.
export function makePlate(ctx, { decay = 3.2, dark = 0.6, preDelay = 0.09, wet = 1, random } = {}) {
  const g = convolverSend(ctx, impulse(ctx, decay, { dark, stereo: true, random }), { preDelay, wet });
  return {
    ...g,
    // Reverb decay is a performed parameter in this genre: Aerial's sixth
    // section gets its character from "the decay of reverb and an increase in
    // the feedback knob" moving together (§6).
    setDecay(seconds, { dark: d = dark } = {}) {
      g.conv.buffer = impulse(ctx, seconds, { dark: d, stereo: true, random });
      return this;
    },
    setLevel(v, at) { at === undefined ? (g.level.gain.value = v) : ride(g.level.gain, v, at); return this; },
    setPreDelay(v, at) { at === undefined ? (g.pre.delayTime.value = v) : ride(g.pre.delayTime, v, at); return this; },
  };
}

// Shimmer: the tail is pitched up an octave and fed back into the convolver, so
// each pass rises. Resonance's introduction is "a large space created through
// the use of shimmer reverb and noise effects", and its ending pushes everything
// but the bassline into that same space (§6).
//
// The shift is a real one. makeBestPitchShifter takes the phase-vocoder worklet
// in a browser and the granular delay-line shifter offline — so the octave is
// genuine in both, rather than a high-shelf pretending to be one.
export function makeShimmer(ctx, {
  decay = 4.5, dark = 0.4, preDelay = 0.02, wet = 1, feedback = 0.30,
  semitones = 12, brighten = 6, seed, random,
} = {}) {
  const g = convolverSend(ctx, impulse(ctx, decay, { dark, stereo: true, seed, random }), { preDelay, wet });

  // The feedback loop runs a pitch shifter back into a unity-gain convolver, so
  // it is the one place here that can genuinely run away — and how far it can be
  // pushed depends on WHICH shifter it got, which is not something a caller can
  // see. makeBestPitchShifter hands back the granular delay-line shifter offline
  // and the phase-vocoder worklet in a browser, and a phase vocoder re-analysing
  // its own output is not the same system: measured by driving this loop
  // continuously and reading its slope, the granular path holds level at
  // feedback 0.42 while the vocoder path grows at +9.6 dB/s at the same setting,
  // and only settles at 0.22.
  //
  // So the ceiling is per-shifter and enforced on every path that can raise
  // feedback, the way makeDubEcho governs its own. Without it the rig's own
  // 0.42 — and shimmerRise's 0.7 at the outro — silently detonate in a browser
  // while measuring clean offline.
  const shifter = makeBestPitchShifter(ctx, { semitones });
  const maxFeedback = shifter.kind === "phasevocoder" ? 0.22 : 1;
  const capFb = (v) => Math.min(v, maxFeedback);
  const shelf = ctx.createBiquadFilter();
  shelf.type = "highshelf"; shelf.frequency.value = 1800; shelf.gain.value = brighten;
  const fb = ctx.createGain();
  fb.gain.value = capFb(feedback);

  g.conv.connect(shifter.input);
  shifter.output.connect(shelf).connect(fb).connect(g.conv);

  return {
    ...g, shifter, feedback: fb.gain,
    setDecay(seconds, { dark: d = dark } = {}) {
      g.conv.buffer = normalizeIr(impulse(ctx, seconds, { dark: d, stereo: true, seed, random }));
      return this;
    },
    // The rise is a performed parameter: Resonance's outro pushes the space open
    // rather than fading it.
    setFeedback(v, at, seconds = 2) {
      const c = capFb(v);
      at === undefined ? (fb.gain.value = c) : ride(fb.gain, c, at, seconds);
      return this;
    },
    get maxFeedback() { return maxFeedback; },
    setLevel(v, at) { at === undefined ? (g.level.gain.value = v) : ride(g.level.gain, v, at); return this; },
    setPreDelay(v, at) { at === undefined ? (g.pre.delayTime.value = v) : ride(g.pre.delayTime, v, at); return this; },
  };
}
