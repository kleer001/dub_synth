// dub_synth/noise.js — the synthesized half of the noise layer.
//
// Every one of the 50 dub techno tracks Koçer spectrum-analysed carries a noise
// layer, in one of three types: static, vinyl crackle, or a soundscape acting as
// a drone (research/dub_techno_technique.md §5). Oswald's position is that noise
// is not a defect to be removed — it "contributes to the vibe" and is integral.
//
// This file holds the beds that can be *made* rather than recorded, and it holds
// them apart from corpus.js for one reason: corpus.js reads the disk, so it
// cannot be imported into a browser. The live desk needs a noise layer too, and
// the alternative to splitting was a second copy of the same synthesis.
//
// Synthesis reaches static convincingly. It reaches vinyl crackle badly unless
// crackle is modelled as what it physically is — sparse impulsive events over a
// hiss floor — rather than as a stationary process. It does not reach a shoreline
// or a room at all, which is exactly why The Salt On Her Cheeks opens and closes
// on a recording. So there is no synthesized soundscape here; asking for one
// throws rather than quietly handing back something else.

import { pinkNoise, whiteNoise } from "./core/dsp.js";

export const NOISE_TYPES = ["static", "vinyl", "soundscape"];

export function synthBed(ctx, { type = "static", rng, seconds = 4, gain = 0.05, hpf = 900, start = 0 } = {}) {
  const output = ctx.createGain();
  const level = ctx.createGain();
  level.gain.value = gain;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = hpf;

  if (type === "static") {
    const src = ctx.createBufferSource();
    src.buffer = pinkNoise(ctx, seconds, { seed: rng ? rng.int(1, 1e6) : 0 });
    src.loop = true;
    src.connect(hp).connect(level).connect(output);
    src.start(start);
    return { output, source: src, level: level.gain, hp };
  }

  if (type === "vinyl") {
    // Crackle: a quiet hiss floor with sparse pops scattered over it. The pops
    // are what a stationary noise generator cannot produce.
    const buf = whiteNoise(ctx, seconds, { seed: rng ? rng.int(1, 1e6) : 0 });
    const d = buf.getChannelData(0);
    const r = rng ?? { float: () => Math.random(), int: (a, b) => a + Math.floor(Math.random() * (b - a + 1)) };
    for (let i = 0; i < d.length; i++) d[i] *= 0.08;
    const pops = Math.round(seconds * r.float(18, 40));
    for (let p = 0; p < pops; p++) {
      const at = r.int(0, d.length - 200);
      const amp = r.float(0.15, 0.9);
      const len = r.int(8, 90);
      for (let i = 0; i < len; i++) d[at + i] += amp * Math.exp(-i / (len * 0.3)) * (i % 2 ? -1 : 1);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true;
    src.connect(hp).connect(level).connect(output);
    src.start(start);
    return { output, source: src, level: level.gain, hp };
  }

  throw new Error(`no synthesized bed for "${type}" — a place has to be recorded; use sampleBed`);
}
