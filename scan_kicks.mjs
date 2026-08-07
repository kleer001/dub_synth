// dub_synth/scan_kicks.mjs — index kick one-shots for the kick selector.
//
//   node scan_kicks.mjs [--root=/path/to/samples] [--top=12]
//
// Writes data/kicks.json. As with the noise corpus, the manifest travels with
// the repo and the audio does not — the library is mounted, never vendored.
//
// Ranking is by the genre's own stated preferences rather than by taste: §1 puts
// the spectral centre of gravity at 20-350 Hz in every analysed track, and §5
// calls the kick "thumpy and stiff". So a good candidate here is one whose energy
// is overwhelmingly below 350 Hz and whose tail is short enough to sit inside the
// beat — voices.js already documents what happens when a kick rings longer than
// the gap between kicks: it stops being a transient and becomes a sub drone that
// owns the mix by RMS.
//
// Unlike the noise scanner this measurement is not advisory: "how much energy is
// under 350 Hz" and "when does it fall below -40 dB" are unambiguous, and they
// separate the candidates cleanly. No classifier is being guessed at.

import { readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeWav } from "./core/wav.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));
const ROOT = argv.root ?? process.env.DUB_SAMPLES ?? "/media/menser/larg/Music/samples";
const TOP = Number(argv.top ?? 12);
const OUT = join(HERE, "data", "kicks.json");

function* walk(dir, depth = 0) {
  if (depth > 6) return;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (/\.wav$/i.test(e.name)) yield p;
  }
}

const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));
const rows = [];

for (const path of walk(ROOT)) {
  if (!/kick|\bbd\b/i.test(path)) continue;
  let st;
  try { st = statSync(path); } catch { continue; }
  if (st.size > 2_000_000) continue;              // a loop, not a one-shot

  let wav;
  try {
    const raw = readFileSync(path);
    wav = decodeWav(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  } catch { continue; }

  const x = wav.channels[0], sr = wav.sampleRate;
  if (!x || x.length < 64 || x.length / sr > 2.5) continue;

  let peak = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > peak) peak = a; }
  if (peak < 1e-4) continue;

  // Where it falls below 1% of peak — the usable length, not the file length.
  let tail = x.length;
  for (let i = x.length - 1; i >= 0; i--) if (Math.abs(x[i]) > peak * 0.01) { tail = i; break; }

  // One-pole at 350 Hz: the §1 band, measured as a share of total energy.
  const a = Math.exp((-2 * Math.PI * 350) / sr);
  let lp = 0, lowE = 0, allE = 0;
  for (let i = 0; i < x.length; i++) { lp = (1 - a) * x[i] + a * lp; lowE += lp * lp; allE += x[i] * x[i]; }

  rows.push({
    name: path.split("/").at(-1).replace(/\.wav$/i, ""),
    path,
    ms: Math.round((tail / sr) * 1000),
    sampleRate: sr,
    channels: wav.channels.length,
    lowShare: +(lowE / Math.max(1e-12, allE)).toFixed(3),
    peakDb: +dB(peak).toFixed(1),
  });
}

// Low-dominant first, then short. A 185 ms kick at 96% under 350 Hz is the shape
// the genre asks for; a 600 ms one is a drone with a transient on the front.
rows.sort((p, q) => (q.lowShare - p.lowShare) || (p.ms - q.ms));
const curated = rows.filter((r) => r.lowShare >= 0.9 && r.ms <= 320).slice(0, TOP);

writeFileSync(OUT, JSON.stringify({
  root: ROOT,
  scanned: rows.length,
  criteria: "lowShare >= 0.90 (energy under 350 Hz, §1) and tail <= 320 ms (§5 stiff)",
  entries: curated.map((r) => ({ ...r, rel: relative(ROOT, r.path) })),
}, null, 2) + "\n");

console.log(`scanned ${rows.length} kick one-shots under ${ROOT}`);
console.log(`kept ${curated.length}:`);
for (const r of curated) console.log(`  ${String(Math.round(r.lowShare * 100)).padStart(3)}% low  ${String(r.ms).padStart(4)} ms  ${r.name}`);
console.log(`wrote ${relative(HERE, OUT)}`);
