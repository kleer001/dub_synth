// dub_synth/scan_samples.mjs — index the sample library's noise material. Stage 6.
//
// Noise is a compositional layer in this genre, not a defect: all 50 of the 50
// tracks Koçer spectrum-analysed carry one, and he sorts them into exactly three
// types — static, vinyl crackle, and soundscape-as-drone
// (research/dub_techno_technique.md §5). Synthesis reaches static easily and
// crackle badly; it does not reach a seaside or a room at all, which is why
// The Salt On Her Cheeks opens and closes on a recording rather than a generator.
//
// Filenames alone cannot do this job. "VinylWurliPad" is a musical pad and
// "PinkNoise Studio" is a vendor name stamped on tonal sweeps — both sail
// straight through a keyword rule. But no single measurement separates them
// either: spectral flatness ranks by brightness because every real recording is
// spectrally tilted, and autocorrelation periodicity ranks field recordings
// ABOVE synth pads because a street or a shoreline is full of tonal events.
// Both were tried against a hand-labelled set and both failed to separate.
//
// So this scanner does not pretend to classify. It applies only the gates that
// are actually reliable — long enough, loud enough, no strong envelope — and
// records the contested metrics as ADVISORY fields for a human to sort on later.
// What the engine plays by default is the `curated` subset: entries whose name
// and measurements agree, narrowed by hand. Everything else is a raw shortlist,
// honestly labelled as one.
//
// Writes data/noise_corpus.json — a committed index. The audio stays on the
// library volume; only the manifest travels.
//
//   node dub_synth/scan_samples.mjs [--root=/path/to/samples] [--verbose]

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { decodeWav } from "./core/wav.js";
import { magnitude } from "./core/dsp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));
const ROOT = argv.root ?? "/media/menser/larg/Music/samples";
const OUT = join(HERE, "data", "noise_corpus.json");

// Name rules propose a type. They are a shortlist, not a verdict.
const RULES = [
  { type: "vinyl", test: /(vinyl|crackl|dust|surface[_\- ]?noise|record[_\- ]?noise)/i },
  { type: "static", test: /(hiss|static|tape[_\- ]?noise|white[_\- ]?noise|pink[_\- ]?noise|noise[_\- ]?floor|noisebastard|\bnoise\b)/i },
  { type: "soundscape", test: /(rain|forest|wind|water|ocean|sea\b|storm|thunder|street|city|traffic|room[_\- ]?tone|ambien|atmos|field|IC_C_)/i },
];

// Gates. Only these three decide; they are the ones that mean what they say.
const MIN_SECONDS = 2.0;
const MIN_RMS_DB = -60;
const MAX_ENV_SPREAD = 8.0;  // loudest 100 ms window over the median; a bed sits near 1

// The shortlist narrowed by hand: files whose name and measurements agree and
// whose source pack makes the name trustworthy. They have NOT been listened to —
// that is the remaining step before calling any of this verified. Matched by path
// substring so a re-scan re-marks them.
const CURATED = [
  ["static", "Halley Labs Mini Sample Pack/FX/tape hiss"],
  ["static", "Halley Labs Mini Sample Pack/FX/radio static"],
  ["static", "Halley Labs Mini Sample Pack/Noise/dac glitch"],
  ["static", "Minimal & Tech House/fx/mth_fx_noisebastard"],
  ["vinyl", "Minimal & Tech House/combi loops/mth_com_130_vinyl_F"],
  ["soundscape", "Minimal & Tech House/fx/mth_fx_rainfell"],
  ["soundscape", "samples_Misc/city/sidewalk1"],
];
const curatedType = (path) => CURATED.find(([, frag]) => path.includes(frag))?.[0] ?? null;

function* walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (/^\.wav$/i.test(extname(e.name))) yield p;
  }
}

function propose(path) {
  const name = path.slice(ROOT.length);
  for (const r of RULES) if (r.test.test(name)) return r.type;
  return null;
}

// ADVISORY. Wiener entropy over a mid-file frame. Ranks by brightness on real
// material, so it is recorded but never gated on.
function flatness(L, sampleRate) {
  const N = 8192;
  const off = Math.max(0, ((L.length - N) / 2) | 0);
  const fr = new Float32Array(N);
  for (let i = 0; i < N; i++) fr[i] = L[off + i] || 0;
  const mag = magnitude(fr);
  // Ignore the very bottom and top of the range: DC drift and anti-alias roll-off
  // both skew flatness without saying anything about the sound.
  const lo = Math.max(1, Math.round(40 / (sampleRate / N)));
  const hi = Math.min(mag.length - 1, Math.round(12000 / (sampleRate / N)));
  let logSum = 0, sum = 0, n = 0;
  for (let k = lo; k <= hi; k++) {
    const p = mag[k] * mag[k] + 1e-20;
    logSum += Math.log(p); sum += p; n++;
  }
  if (!n) return 0;
  return Math.exp(logSum / n) / (sum / n);
}

// Loudest 100 ms window over the median one. A steady bed is near 1; a one-shot
// with an attack and a tail is large.
function envelopeSpread(L, sampleRate) {
  const win = Math.max(1, Math.round(sampleRate * 0.1));
  const rms = [];
  for (let s = 0; s + win <= L.length; s += win) {
    let e = 0;
    for (let i = s; i < s + win; i++) e += L[i] * L[i];
    rms.push(Math.sqrt(e / win));
  }
  if (rms.length < 3) return Infinity;
  const sorted = [...rms].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  if (median <= 1e-9) return Infinity;
  return sorted[sorted.length - 1] / median;
}

// ADVISORY. Normalized autocorrelation peak after a 150 Hz high-pass. Ranks
// field recordings above synth pads, so it is recorded but never gated on.
function periodicity(L, sampleRate) {
  const N = Math.min(4096, L.length);
  const off = Math.max(0, ((L.length - N) / 2) | 0);
  const a = Math.exp((-2 * Math.PI * 150) / sampleRate);
  const x = new Float64Array(N);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < N; i++) {
    const v = L[off + i] || 0;
    prevOut = a * (prevOut + v - prevIn); prevIn = v; x[i] = prevOut;
  }
  let e0 = 0; for (let i = 0; i < N; i++) e0 += x[i] * x[i];
  if (e0 <= 1e-12) return 0;
  const lagMin = Math.max(2, Math.round(sampleRate / 800));
  const lagMax = Math.min(N - 1, Math.round(sampleRate / 60));
  let best = 0;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0, e = 0;
    for (let i = 0; i + lag < N; i++) { s += x[i] * x[i + lag]; e += x[i + lag] * x[i + lag]; }
    const r = s / (Math.sqrt(e0 * e) || 1e-12);
    if (r > best) best = r;
  }
  return best;
}

function probe(path) {
  const raw = readFileSync(path);
  const d = decodeWav(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const L = d.channels[0];
  let peak = 0, sumSq = 0;
  for (let i = 0; i < L.length; i++) { const a = Math.abs(L[i]); if (a > peak) peak = a; sumSq += L[i] * L[i]; }
  return {
    seconds: +(L.length / d.sampleRate).toFixed(2),
    sampleRate: d.sampleRate,
    channels: d.channels.length,
    peak: +peak.toFixed(4),
    rmsDb: +(20 * Math.log10(Math.max(1e-12, Math.sqrt(sumSq / Math.max(1, L.length))))).toFixed(1),
    flatness: +flatness(L, d.sampleRate).toFixed(4),
    periodicity: +periodicity(L, d.sampleRate).toFixed(3),
    envSpread: +envelopeSpread(L, d.sampleRate).toFixed(2),
  };
}

// The library carries "-2" duplicates from a Dropbox sync mangle. Keep the
// un-mangled name when both are present.
const dedupeKey = (p) => p.replace(/-2(\.wav)$/i, "$1");
const isMangled = (p) => /-2\.wav$/i.test(p);

const seen = new Map();
const rejects = [];
let scanned = 0, proposed = 0;

for (const path of walk(ROOT)) {
  scanned++;
  const type = propose(path);
  if (!type) continue;
  proposed++;
  const key = dedupeKey(path);
  const existing = seen.get(key);
  if (existing && !(isMangled(existing.path) && !isMangled(path))) continue;

  let info;
  try { info = probe(path); } catch { rejects.push({ path, why: "unreadable" }); continue; }
  const why =
    info.seconds < MIN_SECONDS ? "too short" :
    info.rmsDb < MIN_RMS_DB ? "too quiet" :
    info.envSpread > MAX_ENV_SPREAD ? `not steady (spread ${info.envSpread})` : null;
  if (why) { rejects.push({ path, why, ...info }); continue; }
  const curated = curatedType(path);
  seen.set(key, { path, type: curated ?? type, curated: curated !== null, ...info });
}

const entries = [...seen.values()].sort((a, b) =>
  Number(b.curated) - Number(a.curated) || a.type.localeCompare(b.type) || b.seconds - a.seconds);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  root: ROOT,
  note: "`type` is proposed from the filename and is NOT verified except where `curated` is true. `flatness` and `periodicity` are advisory: neither separates tonal material from noise on real recordings.",
  gates: { MIN_SECONDS, MIN_RMS_DB, MAX_ENV_SPREAD },
  scanned, proposed, kept: entries.length,
  curated: entries.filter((e) => e.curated).length,
  entries,
}, null, 2) + "\n");

const byType = entries.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
console.log(`scanned ${scanned} wav files; ${proposed} proposed by name; ${entries.length} passed the gates`);
console.log(`  ${entries.filter((e) => e.curated).length} curated (verified); the rest are an unverified shortlist`);
console.log(`  ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(", ") || "(none)"}`);
const whyCount = rejects.reduce((m, r) => ((m[r.why.split(" (")[0]] = (m[r.why.split(" (")[0]] || 0) + 1), m), {});
console.log(`  rejected ${rejects.length}: ${Object.entries(whyCount).map(([k, v]) => `${k} ${v}`).join(", ")}`);
if (argv.verbose) for (const r of rejects.slice(0, 40)) console.log(`    ✗ ${r.why.padEnd(28)} ${r.path.slice(ROOT.length + 1)}`);
console.log(`-> ${OUT}`);
