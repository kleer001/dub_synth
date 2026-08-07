// dub_synth/corpus.js — the noise layer, from samples or from synthesis. Stage 6.
//
// Every one of the 50 dub techno tracks Koçer spectrum-analysed carries a noise
// layer, in one of three types: static, vinyl crackle, or a soundscape acting as
// a drone (research/dub_techno_technique.md §5). Oswald's position is that noise
// is not a defect to be removed — it "contributes to the vibe" and is integral.
//
// Synthesis reaches static convincingly. It reaches vinyl crackle badly, because
// crackle is sparse impulsive events over a hiss floor rather than a stationary
// process. It does not reach a shoreline or a room at all — which is exactly why
// The Salt On Her Cheeks opens and closes on a recording.
//
// So there are two sources here and they are chosen explicitly, never as a
// silent fallback. `sampleBed` requires its file and throws if the library is not
// mounted; `synthBed` never touches the disk. A caller that wants "samples if
// available" has to ask for that in so many words.
//
// The synthesized beds live in noise.js. This file reads the disk, which makes it
// unimportable in a browser, and the live desk needs the synthesized half.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeWav } from "./core/wav.js";
import { NOISE_TYPES, synthBed } from "./noise.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, "..", "data", "noise_corpus.json");

export { NOISE_TYPES, synthBed };

let cached = null;
export function loadManifest(path = MANIFEST) {
  if (cached && cached.path === path) return cached.data;
  const data = JSON.parse(readFileSync(path, "utf8"));
  cached = { path, data };
  return data;
}

// Pick an entry. `curatedOnly` defaults to true because the rest of the manifest
// is a name-proposed shortlist that no measurement could verify — see
// scan_samples.mjs for why that classifier was abandoned rather than shipped.
// Even the curated set is hand-narrowed rather than auditioned.
export function pickNoise({ rng, type = "static", curatedOnly = true, manifest = loadManifest() } = {}) {
  if (!NOISE_TYPES.includes(type)) throw new Error(`unknown noise type "${type}"`);
  const pool = manifest.entries.filter((e) => e.type === type && (!curatedOnly || e.curated));
  if (!pool.length) {
    throw new Error(`no ${curatedOnly ? "curated " : ""}"${type}" noise in the corpus — re-run dub_synth/scan_samples.mjs`);
  }
  return rng ? rng.pick(pool) : pool[0];
}

// Decode a corpus entry into an AudioBuffer. Throws if the library volume is not
// mounted — the manifest travels with the repo but the audio does not.
export function loadSample(ctx, entry) {
  let raw;
  try { raw = readFileSync(entry.path); }
  catch (e) { throw new Error(`sample library unreachable: ${entry.path} (${e.code ?? e.message})`); }
  const wav = decodeWav(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const buf = ctx.createBuffer(wav.channels.length, wav.channels[0].length, wav.sampleRate);
  for (let c = 0; c < wav.channels.length; c++) buf.copyToChannel(wav.channels[c], c);
  return buf;
}

// A looping bed built from a corpus entry. `hpf` keeps the bed out of the sub —
// the low end belongs to the kick and bass and stays dry (§1, §8).
export function sampleBed(ctx, entry, { gain = 0.05, hpf = 900, start = 0 } = {}) {
  const buf = loadSample(ctx, entry);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = hpf;
  const level = ctx.createGain();
  level.gain.value = gain;
  const output = ctx.createGain();
  src.connect(hp).connect(level).connect(output);
  src.start(start);
  return { output, source: src, level: level.gain, hp, entry };
}

// Convenience for the render harness: samples when explicitly asked and the
// library is reachable, synthesis when asked. The choice is the caller's; this
// only reports which one it got so a render can say so.
export function makeNoiseBed(ctx, { source = "synth", type = "static", rng, ...opts } = {}) {
  if (source === "sample") {
    const entry = pickNoise({ rng, type });
    return { ...sampleBed(ctx, entry, opts), source: "sample", type, describe: () => entry.path };
  }
  if (source === "synth") {
    return { ...synthBed(ctx, { type, rng, ...opts }), source: "synth", type, describe: () => `synthesized ${type}` };
  }
  throw new Error(`noise source must be "sample" or "synth", got "${source}"`);
}
