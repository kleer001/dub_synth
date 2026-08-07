// dub_synth/render.mjs — render a performance offline and measure it.
//
// The offline-renderable constraint is hard: if a block cannot run through an
// OfflineAudioContext it cannot be measured, tested, or bounced to a stem, so it
// does not go in. This harness enforces that end to end — it builds the rig,
// plans a performance, lays the riddim under it, and renders the result.
//
//   node dub_synth/render.mjs [--seconds=300] [--seed=7] [--noise=synth|sample]
//                             [--type=static|vinyl|soundscape] [--out=/tmp/dub.wav]
//                             [--plan]      print the section plan and exit
//                             [--headroom]  measure the pre-master level and print
//                                           the master trim the rig should carry
//                             [--raw]       skip the bounce-time mastering pass
//                             [--stems]     solo each channel and each bus in turn
//                                           and report what it contributes
//
// Levels are machinery here, not taste. node-web-audio-api's DynamicsCompressor
// does not limit — it inflates — so nothing in the graph relies on it: the master
// bus is biquads, a gain and a tanh waveshaper, and the real dynamics happen at
// bounce time in master.js where they can be computed exactly. The one number
// that has to move when the rig changes is DUB_RIG.master, and --headroom is
// what tells you its value instead of leaving it to be guessed.

import { writeFileSync } from "node:fs";

let nwa;
try { nwa = await import("node-web-audio-api"); }
catch { console.error("dub_synth/render.mjs needs node-web-audio-api (dev only):\n  npm install --save-dev node-web-audio-api"); process.exit(1); }

// node-web-audio-api forbids reassigning WaveShaperNode.curve; make the setter
// forgiving so a re-set is a no-op rather than a crash.
{
  const d = Object.getOwnPropertyDescriptor(nwa.WaveShaperNode.prototype, "curve");
  if (d && d.set) {
    const set = d.set;
    Object.defineProperty(nwa.WaveShaperNode.prototype, "curve", {
      configurable: true, get: d.get, set(v) { try { set.call(this, v); } catch (_) {} },
    });
  }
}

const { makeRng } = await import("../engine/core/rng.js");
const { knobRates } = await import("../engine/dsp/knob.js");
const { stats } = await import("../engine/core/metrics.js");
const { magnitude } = await import("../engine/core/dsp.js");
const { encodeWav } = await import("../engine/core/wav.js");
const { DUB_RIG, buildRig } = await import("../engine/rig.js");
const { applyAll } = await import("../engine/gesture.js");
const { planPerformance } = await import("../engine/perform.js");
const { makeRiddim } = await import("../engine/riddim.js");
const { makeVoices } = await import("../engine/voices.js");
const { makeNoiseBed } = await import("../engine/corpus.js");
const { findKick } = await import("../engine/kicks.js");
const { decodeAudio, toAudioBuffer } = await import("../engine/core/audio.js");
const { readFileSync: readFile } = await import("node:fs");
const { masterChain, measure } = await import("../engine/master.js");

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));
const SECONDS = Number(argv.seconds ?? 300);
const SEED = Number(argv.seed ?? 7);
const OUT = argv.out ?? "/tmp/dub.wav";
const NOISE = argv.noise ?? "synth";
const NOISE_TYPE = argv.type ?? "static";
const KICK = argv.kick ?? "synth";
const HEADROOM = Boolean(argv.headroom);
const STEMS = Boolean(argv.stems);
const RAW = Boolean(argv.raw);
const SR = 48000;

// Phylyps Trak is 144 and Aerial is 123; the genre's centre is around 125.
const BPM = Number(argv.bpm ?? 125);
const BEAT = 60 / BPM;
const STEP = BEAT / 4;
const BAR = BEAT * 4;

// Separate streams, so changing one layer does not reshuffle the others —
// otherwise every A/B moves two things at once.
const planRng = makeRng(SEED);
const knobRng = makeRng(SEED ^ 0x4b4e4f42);
const noteRng = makeRng(SEED ^ 0x4e4f5445);
const irRng = makeRng(SEED ^ 0x5eed);

const sections = planPerformance({ rng: planRng, spec: DUB_RIG, seconds: SECONDS });

const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
if (argv.plan) {
  console.log(`performance plan — ${SECONDS}s, seed ${SEED}`);
  for (const s of sections) {
    console.log(`  ${String(s.index + 1).padStart(2)}  ${mmss(s.at)}  ${String(Math.round(s.seconds)).padStart(4)}s  ${s.state.padEnd(11)} ${String(s.gestures.length).padStart(2)} gestures — ${s.label}`);
  }
  const lens = sections.map((x) => x.seconds).sort((a, b) => a - b);
  console.log(`  ${sections.length} sections, median ${Math.round(lens[lens.length >> 1])}s, range ${Math.round(lens[0])}-${Math.round(lens.at(-1))}s`);
  process.exit(0);
}

const ctx = new nwa.OfflineAudioContext(2, Math.ceil(SECONDS * SR), SR);
const rig = buildRig(ctx, DUB_RIG, { random: irRng.next });
// --headroom reads the TRUE pre-master level, so the master chain is flattened
// out of the way first. Measuring through your own processing tells you nothing.
if (HEADROOM) rig.master.neutral();
rig.output.connect(ctx.destination);

// The hand on the knobs, running the whole length (§2). The rates are derived in
// dsp/knob.js so this file, stems.mjs and the live desk cannot drift apart.
const { walk: WALK_RATE, drift: DRIFT_RATE, warp: WARP_RATE } = knobRates(BEAT);

// The walk ranges are per-bus because the delay TIME sets how much feedback a bus
// can carry: the shorter the echo, the denser the same feedback figure sounds.
for (const [bus, cfg] of Object.entries(DUB_RIG.buses).filter(([, d]) => d.walk).map(([n, d]) => [n, d.walk])) {
  rig.fx[bus].rideFeedback({ rng: knobRng, seconds: SECONDS, rate: WALK_RATE, ...cfg });
  rig.fx[bus].driftTone({ rate: DRIFT_RATE, centre: 2750, depth: 2250 });
}
// One echo runs time-based with a modulated delay time — the pitch artefacts (§2).
rig.fx.echoC.warpTime({ rng: knobRng, seconds: SECONDS, rate: WARP_RATE, low: 0.55, high: 0.85 });

const gestureCount = applyAll(rig, sections.flatMap((s) => s.gestures));

// --- the riddim -----------------------------------------------------------
const riddim = makeRiddim({ rng: noteRng, tonic: "G", octave: 2, progression: "listing", barsPerChord: 16 });
const voices = makeVoices(ctx, { rng: noteRng, seconds: SECONDS });
const ch = (name) => rig.mix.channel(name).input;

// One persistent voice per part, retriggered — never a graph per note. See
// voices.js: allocating per hit makes cost per audio-second climb with length,
// which an endless engine cannot afford.
// --kick=synth (the §5 synthesis) or a name from data/kicks.json. A sampled kick
// is ONE looping bar, not a source per hit — see voices.js for the measurement.
const kickEntry = findKick(KICK);
let kick = null;
if (kickEntry) {
  const raw = readFile(kickEntry.path);
  const decoded = decodeAudio(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const kbuf = toAudioBuffer(ctx, decoded);
  kick = voices.sampleKick(ch("kick"), { buffer: kbuf, steps: riddim.kickSteps(), bar: BAR });
  kick.start(0);
} else {
  kick = voices.kick(ch("kick"));
}
const bass = voices.bass(ch("bass"));
const hat = voices.hat(ch("hat"));
const shaker = voices.shaker(ch("shaker"));
const rim = voices.snare(ch("perc"));
const wood = voices.perc(ch("perc"));
const stabA = voices.stab(ch("stabA"), { cutoff: 1100, pan: -0.15 });
const stabB = voices.stab(ch("stabB"), { cutoff: 2000, pan: 0.2 });
const stabC = voices.stab(ch("stabC"), { cutoff: 2600 });

// The pad holds continuously; its motion is the filter, not the notes (§7.7).
voices.pad(ch("pad"), riddim.stabChord(0).map((hz) => hz / 2));

const bars = Math.ceil(SECONDS / BAR);
for (let bar = 0; bar < bars; bar++) {
  const t0 = bar * BAR;
  const stepAt = (n) => t0 + n * STEP;

  // The sampled kick is a loop; only the synthesized one is triggered per step.
  if (kick.kind !== "loop") {
    for (const n of riddim.kickSteps()) {
      if (stepAt(n) >= SECONDS) continue;
      kick.at(stepAt(n));
    }
  }
  for (const n of riddim.hatSteps()) if (stepAt(n) < SECONDS) hat.at(stepAt(n));
  for (const n of riddim.shakerSteps()) if (stepAt(n) < SECONDS) shaker.at(stepAt(n));
  // The rimshot lands on the third beat, as in The Salt On Her Cheeks (§6).
  if (stepAt(8) < SECONDS) rim.at(stepAt(8), { peak: 0.3 });
  if (bar % 2 === 1 && stepAt(14) < SECONDS) wood.at(stepAt(14));

  for (const e of riddim.bassFigure(bar)) {
    if (stepAt(e.step) < SECONDS) bass.at(stepAt(e.step), e.hz, BEAT * 0.9, { dead: e.dead });
  }

  // Stabs off-beat, one layer per echo, each with its own voicing and register.
  const chord = riddim.stabChord(bar, { colour: bar % 8 === 7 });
  for (const n of riddim.stabSteps(bar)) {
    if (stepAt(n) >= SECONDS) continue;
    stabA.at(stepAt(n), chord);
    stabB.at(stepAt(n) + STEP * 2, chord.map((h) => h * 1.5), { dur: 0.11, peak: 0.4 });
  }
  if (bar % 4 === 0 && stepAt(6) < SECONDS) {
    stabC.at(stepAt(6), chord.map((h) => h * 2), { dur: 0.09, peak: 0.32 });
  }
}

// --- the noise layer ------------------------------------------------------
const bed = makeNoiseBed(ctx, { source: NOISE, type: NOISE_TYPE, rng: noteRng, gain: 1, hpf: 900 });
bed.output.connect(ch("noise"));

// --- render, master, measure ----------------------------------------------
const buf = await ctx.startRendering();
const L = Float32Array.from(buf.getChannelData(0));
const R = Float32Array.from(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0));
const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));

// --headroom: report the pre-master level and the trim that would land it right.
// The p99.9 sample is the SUSTAINED loud level — it ignores the rare transient a
// limiter should be catching anyway, so trimming to it sets the mix rather than
// the peaks. Lifted in method from the parent render.mjs --headroom.
if (HEADROOM) {
  const all = new Float32Array(L.length * 2);
  all.set(L, 0); all.set(R, L.length);
  for (let i = 0; i < all.length; i++) all[i] = Math.abs(all[i]);
  all.sort();
  const p999 = all[Math.floor(all.length * 0.999)];
  const m = measure([L, R]);
  // Target for the SUSTAINED level going into the master bus. Set so that after
  // gentle glue and a limiter catching only transients, the file lands near
  // -1 dBFS with a crest in AUDIO_CHECKLIST.md's healthy 9-13 dB band. Too low
  // and the master has nothing to do and the take ships quiet; too high and the
  // limiter starts doing the mixing.
  const TARGET = 0.5;
  console.log(`pre-master headroom — ${mmss(SECONDS)} @ ${BPM} BPM, seed ${SEED} (master bus neutral)`);
  console.log(`  peak          ${m.peakDb.toFixed(2)} dBFS`);
  console.log(`  p99.9         ${dB(p999).toFixed(2)} dBFS   (the sustained level)`);
  console.log(`  rms           ${m.rmsDb.toFixed(2)} dB`);
  console.log(`  crest         ${m.crest.toFixed(2)} dB`);
  console.log(`\n  suggest DUB_RIG.master = ${(TARGET / Math.max(1e-9, p999)).toFixed(3)}`);
  process.exit(0);
}

const beforeMaster = measure([L, R]);
const mastered = RAW ? null : masterChain([L, R], { sampleRate: SR });

const s = stats({ L, R });

// core/metrics.js's spectrum() splits at 200 Hz / 2 kHz; the genre's fingerprint
// needs its own bands (§1: 20-350 dominant, 800-3000 scooped).
const N = 16384;
const frame = new Float32Array(N);
{
  const off = ((L.length - N) / 2) | 0;
  for (let i = 0; i < N; i++) frame[i] = L[off + i] || 0;
}
const mag = magnitude(frame);
const band = (lo, hi) => {
  const binHz = SR / N;
  let sum = 0, n = 0;
  for (let i = Math.max(1, Math.round(lo / binHz)); i <= Math.round(hi / binHz) && i < mag.length; i++) { sum += mag[i] * mag[i]; n++; }
  return dB(Math.sqrt(sum / Math.max(1, n)));
};
const low = band(20, 350), mid = band(800, 3000), high = band(4000, 12000);

// Mono survival matters: this is a sound-system genre and the rig it is played
// on is often summed (§4, sonic dominance).
let stereoE = 0, monoE = 0;
for (let i = 0; i < L.length; i++) { const m = (L[i] + R[i]) / 2; monoE += m * m; stereoE += (L[i] * L[i] + R[i] * R[i]) / 2; }
const monoLoss = 10 * Math.log10(Math.max(1e-12, stereoE / L.length)) - 10 * Math.log10(Math.max(1e-12, monoE / L.length));

// Beat-level dynamics: how much the level moves across one beat. Dub techno is
// deep techno and "lacks sharp rises and falls", so a modest figure is correct
// here — a large one would mean the mix is pumping, which is the wrong genre.
// A figure near zero is the other failure: a wall with no groove in it.
const beatEnv = (periodSec) => {
  const w = Math.max(1, (SR * 0.004) | 0), env = [];
  for (let i = 0; i < L.length; i += w) { let e = 0; for (let j = i; j < i + w && j < L.length; j++) e += L[j] * L[j]; env.push(Math.sqrt(e / w)); }
  const P = Math.max(2, Math.round(periodSec * SR / w));
  const acc = new Array(P).fill(0), cnt = new Array(P).fill(0);
  for (let i = (env.length * 0.3) | 0; i < env.length; i++) { acc[i % P] += env[i]; cnt[i % P]++; }
  const cyc = acc.map((a, i) => a / Math.max(1, cnt[i])).filter((x) => x > 1e-7);
  if (cyc.length < 2) return 0;
  return dB(Math.max(...cyc)) - dB(Math.min(...cyc));
};

console.log(`dub_synth — ${mmss(SECONDS)} @ ${BPM} BPM, seed ${SEED}`);
console.log(`  sections      ${sections.length} (${gestureCount} gestures)`);
console.log(`  noise         ${bed.describe()}`);
console.log(`  kick          ${kickEntry ? `${kickEntry.name} (${kickEntry.ms} ms, ${Math.round(kickEntry.lowShare*100)}% under 350 Hz)` : "synthesized"}`);
console.log(`  pre-master    peak ${beforeMaster.peakDb.toFixed(2)} dBFS, crest ${beforeMaster.crest.toFixed(2)} dB`);
if (mastered) {
  console.log(`  glue          ${mastered.glue.maxReductionDb.toFixed(2)} dB max reduction, ${mastered.glue.makeupDb.toFixed(2)} dB makeup`);
  console.log(`  limiter       ${mastered.limit.maxReductionDb.toFixed(2)} dB max reduction`);
}
console.log(`  peak          ${dB(s.peak).toFixed(2)} dBFS`);
if (mastered) console.log(`  true peak     ${mastered.truePeakDb.toFixed(2)} dBFS`);
console.log(`  rms           ${s.rmsDb.toFixed(2)} dB`);
console.log(`  crest         ${(dB(s.peak) - s.rmsDb).toFixed(2)} dB`);
console.log(`  dc            ${s.dc.toFixed(5)}`);
console.log(`  width         ${s.widthDb.toFixed(2)} dB`);
console.log(`  mono loss     ${monoLoss.toFixed(2)} dB`);
console.log(`  beat swing    ${beatEnv(BEAT).toFixed(2)} dB across one beat`);
console.log(`  low(20-350)   ${low.toFixed(1)} dB`);
console.log(`  mid(0.8-3k)   ${mid.toFixed(1)} dB   (low-mid tilt ${(low - mid).toFixed(1)} dB)`);
console.log(`  high(4-12k)   ${high.toFixed(1)} dB`);
if (mastered && !mastered.ok) for (const note of mastered.notes) console.log(`  ! ${note}`);

writeFileSync(OUT, Buffer.from(encodeWav([L, R], SR)));
console.log(`  wrote ${OUT}`);
