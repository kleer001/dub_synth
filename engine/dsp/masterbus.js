// dub_synth/dsp/masterbus.js — the master chain, in the graph.
//
// Shaped after GLITCHFIELD's master chain (`../glitchfield`: pre → anti-mud EQ →
// limiter → master gain → tanh clip) and this repo's own mix discipline in
// AUDIO_CHECKLIST.md. Two rules from that checklist drive everything here:
//
//   "Mastering = glue, not a brickwall."  A tanh master at SAT 0.6 keeps a
//   healthy crest; SAT 2.0 slams it to ~5 dB and ships hot on every take.
//   "Kick owns the sub; the bass sits above it."
//
// **There is deliberately no DynamicsCompressor in this chain.** Under
// node-web-audio-api it does not limit — it inflates the output to roughly a
// constant level regardless of input, so a graph that leans on it measures as a
// lie offline and behaves differently in a browser. Everything here is a biquad,
// a gain, or a waveshaper, all of which render identically both ways. The
// dynamics that need real detection happen at bounce time in master.js, where
// they can be computed exactly.
//
// Chain: input → anti-mud dip → tilt shelves → trim → tanh clip → output

import { satCurve } from "../core/dsp.js";
import { ride } from "./knob.js";

export const MASTER_DEFAULTS = {
  // A peaking dip where a wet dub mix piles up. GLITCHFIELD watches this band
  // live and dips it proportionally; offline there are no frames to watch from,
  // so it is declared and measured instead of inferred — `--headroom` reports
  // the band so the number is chosen from evidence rather than taste.
  mudHz: 300,
  mudQ: 1.1,
  mudGain: -2.5,
  // The genre is low-dominant and mid-scooped by measurement, not by taste
  // (research/dub_techno_technique.md §1) — but the analysed records are still
  // *balanced* up top, and a shelf is how the air comes back without undoing
  // the scoop.
  airHz: 6000,
  airGain: 2.0,
  subHz: 45,
  subGain: 0,
  // AUDIO_CHECKLIST.md §3: 0.6 is the proven-healthy tanh drive.
  sat: 0.6,
  trim: 1.0,
};

export function makeMasterBus(ctx, opts = {}) {
  const p = { ...MASTER_DEFAULTS, ...opts };

  const input = ctx.createGain();
  const output = ctx.createGain();

  const mud = ctx.createBiquadFilter();
  mud.type = "peaking"; mud.frequency.value = p.mudHz; mud.Q.value = p.mudQ; mud.gain.value = p.mudGain;

  const air = ctx.createBiquadFilter();
  air.type = "highshelf"; air.frequency.value = p.airHz; air.gain.value = p.airGain;

  const sub = ctx.createBiquadFilter();
  sub.type = "lowshelf"; sub.frequency.value = p.subHz; sub.gain.value = p.subGain;

  const trim = ctx.createGain();
  trim.gain.value = p.trim;

  // Glue, not a brickwall. The curve is normalised so unity in stays unity out
  // and `sat` only changes how the peaks bend.
  const clip = ctx.createWaveShaper();
  clip.curve = satCurve(p.sat);
  clip.oversample = "4x";

  input.connect(mud).connect(sub).connect(air).connect(trim).connect(clip).connect(output);

  return {
    input, output, mud, air, sub, trim, clip,
    // The trim is the one number that has to move when the rig changes. It is
    // set from a measurement, never guessed — see render.mjs --headroom.
    setTrim(v, at, seconds = 0.5) {
      if (at === undefined) { trim.gain.value = v; return this; }
      ride(trim.gain, v, at, seconds);
      return this;
    },
    setMud(dB, at, seconds = 0.5) {
      if (at === undefined) { mud.gain.value = dB; return this; }
      ride(mud.gain, dB, at, seconds);
      return this;
    },
    // Bypass everything but the trim, to read the true pre-master level. This is
    // how the headroom tool avoids measuring its own processing.
    // A WaveShaper clamps its INPUT to [-1, 1] whatever its curve says, so
    // linearising the curve is not a bypass: anything hotter than full scale
    // still comes out at exactly full scale. Measured through that, every
    // over-unity stem reports "peak 0.0 dB" and the one thing the diagnostic
    // exists to find — an element pushing past the ceiling — is the one thing it
    // cannot show. Route around the shaper instead. One-way, and only ever used
    // by the measuring tools.
    neutral() {
      mud.gain.value = 0; air.gain.value = 0; sub.gain.value = 0;
      trim.gain.value = 1;
      try { trim.disconnect(clip); } catch (_) {}
      trim.connect(output);
      return this;
    },
  };
}
