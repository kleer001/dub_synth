// dub_synth/stems.mjs — what is each layer actually contributing?
//
// "The kick is too far in the background" is not a fixable statement until you
// know what is in front of it. This solos every channel and every return bus in
// turn, renders each, and reports its level and crest — so a mix decision is made
// against numbers instead of against a memory of the last listen.
//
// Read it this way: `rms` is how much of the mix that layer is, and `crest` is
// whether it is a transient or a wall. A sustained layer (pad, noise, a wet bus)
// with an rms near the kick's will bury the kick no matter how high its fader
// goes, because the kick is only present 4% of the time and the wall is present
// all of it.
//
//   node dub_synth/stems.mjs [--seconds=24] [--seed=7] [--bpm=125]

let nwa;
try { nwa = await import("node-web-audio-api"); }
catch { console.error("needs node-web-audio-api (dev only)"); process.exit(1); }
{
  const d = Object.getOwnPropertyDescriptor(nwa.WaveShaperNode.prototype, "curve");
  if (d && d.set) {
    const set = d.set;
    Object.defineProperty(nwa.WaveShaperNode.prototype, "curve", {
      configurable: true, get: d.get, set(v) { try { set.call(this, v); } catch (_) {} },
    });
  }
}

const { makeRng } = await import("./core/rng.js");
const { DUB_RIG, buildRig } = await import("./rig.js");
const { applyAll } = await import("./gesture.js");
const { planPerformance } = await import("./perform.js");
const { makeRiddim } = await import("./riddim.js");
const { makeVoices } = await import("./voices.js");
const { makeNoiseBed } = await import("./corpus.js");
const { measure } = await import("./master.js");

const argv = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, "").split("=");
  return [k, v === undefined ? true : v];
}));
const SECONDS = Number(argv.seconds ?? 24);
const SEED = Number(argv.seed ?? 7);
const BPM = Number(argv.bpm ?? 125);
const SR = 48000;
const BEAT = 60 / BPM, STEP = BEAT / 4, BAR = BEAT * 4;

// Build the same performance every time so the stems are comparable to each
// other and to the full mix.
async function render({ soloChannel = null, soloBus = null, dryOnly = false } = {}) {
  const planRng = makeRng(SEED), knobRng = makeRng(SEED ^ 0x4b4e4f42);
  const noteRng = makeRng(SEED ^ 0x4e4f5445), irRng = makeRng(SEED ^ 0x5eed);
  const ctx = new nwa.OfflineAudioContext(2, Math.ceil(SECONDS * SR), SR);
  const rig = buildRig(ctx, DUB_RIG, { random: irRng.next });
  rig.master.neutral();
  rig.output.connect(ctx.destination);

  for (const [bus, cfg] of [["echoA", { min: 0.28, max: 0.62 }], ["echoB", { min: 0.20, max: 0.42 }], ["echoC", { min: 0.30, max: 0.66 }]]) {
    rig.fx[bus].rideFeedback({ rng: knobRng, seconds: SECONDS, rate: 4.26, ...cfg });
    rig.fx[bus].driftTone({ rate: 0.11, centre: 2750, depth: 2250 });
  }
  applyAll(rig, planPerformance({ rng: planRng, spec: DUB_RIG, seconds: SECONDS }).flatMap((x) => x.gestures));

  // Solo AFTER the plan is written, and cancel its automation first — a scheduled
  // mute overrides a plain .value write, so setting the value alone silently does
  // nothing and every "solo" comes back as the full mix.
  const channels = Object.keys(DUB_RIG.channels);
  const force = (param, v) => { param.cancelScheduledValues(0); param.setValueAtTime(v, 0); };
  if (soloChannel) for (const c of channels) force(rig.mix.channel(c).mute.gain, c === soloChannel ? 1 : 0);
  if (soloChannel || dryOnly) for (const b of Object.keys(DUB_RIG.buses)) force(rig.mix.bus(b).return.gain, 0);
  if (soloBus) {
    for (const c of channels) force(rig.mix.channel(c).mute.gain, 1);
    for (const b of Object.keys(DUB_RIG.buses)) force(rig.mix.bus(b).return.gain, b === soloBus ? (DUB_RIG.buses[b].ret ?? 1) : 0);
    for (const c of channels) rig.mix.channel(c).panner.disconnect();  // wet only: cut every dry path
  }

  const riddim = makeRiddim({ rng: noteRng, tonic: "G", octave: 2, progression: "listing", barsPerChord: 16 });
  const voices = makeVoices(ctx, { rng: noteRng, seconds: SECONDS });
  const ch = (n) => rig.mix.channel(n).input;
  const kick = voices.kick(ch("kick")), bass = voices.bass(ch("bass"));
  const hat = voices.hat(ch("hat")), shaker = voices.shaker(ch("shaker"));
  const rim = voices.snare(ch("perc")), wood = voices.perc(ch("perc"));
  const stabA = voices.stab(ch("stabA"), { cutoff: 1100, pan: -0.15 });
  const stabB = voices.stab(ch("stabB"), { cutoff: 2000, pan: 0.2 });
  const stabC = voices.stab(ch("stabC"), { cutoff: 2600 });
  voices.pad(ch("pad"), riddim.stabChord(0).map((hz) => hz / 2));

  for (let bar = 0; bar < Math.ceil(SECONDS / BAR); bar++) {
    const t0 = bar * BAR, at = (n) => t0 + n * STEP;
    for (const n of riddim.kickSteps()) if (at(n) < SECONDS) kick.at(at(n));
    for (const n of riddim.hatSteps()) if (at(n) < SECONDS) hat.at(at(n));
    for (const n of riddim.shakerSteps()) if (at(n) < SECONDS) shaker.at(at(n));
    if (at(8) < SECONDS) rim.at(at(8), { peak: 0.3 });
    if (bar % 2 === 1 && at(14) < SECONDS) wood.at(at(14));
    for (const e of riddim.bassFigure(bar)) if (at(e.step) < SECONDS) bass.at(at(e.step), e.hz, BEAT * 0.9, { dead: e.dead });
    const chord = riddim.stabChord(bar, { colour: bar % 8 === 7 });
    for (const n of riddim.stabSteps(bar)) {
      if (at(n) >= SECONDS) continue;
      stabA.at(at(n), chord);
      stabB.at(at(n) + STEP * 2, chord.map((h) => h * 1.5), { dur: 0.11, peak: 0.4 });
    }
    if (bar % 4 === 0 && at(6) < SECONDS) stabC.at(at(6), chord.map((h) => h * 2), { dur: 0.09, peak: 0.32 });
  }
  const bed = makeNoiseBed(ctx, { source: "synth", type: "static", rng: noteRng, gain: 1, hpf: 900 });
  bed.output.connect(ch("noise"));

  const buf = await ctx.startRendering();
  const L = Float32Array.from(buf.getChannelData(0));
  const R = Float32Array.from(buf.getChannelData(1));
  await new Promise((r) => setTimeout(r, 5));
  return measure([L, R]);
}

const row = (label, m, ref) => {
  const share = ref ? `${(100 * Math.pow(10, (m.rmsDb - ref.rmsDb) / 20)).toFixed(1).padStart(6)}%` : "      ";
  console.log(`  ${label.padEnd(14)} rms ${m.rmsDb.toFixed(1).padStart(7)} dB   peak ${m.peakDb.toFixed(1).padStart(6)} dB   crest ${m.crest.toFixed(1).padStart(5)} dB ${share}`);
};

const t0 = Date.now();
console.log(`stem report — ${SECONDS}s @ ${BPM} BPM, seed ${SEED} (master bus neutral)\n`);
const full = await render();
row("FULL MIX", full);
const dry = await render({ dryOnly: true });
row("dry only", dry, full);
console.log("");
for (const c of Object.keys(DUB_RIG.channels)) row(c, await render({ soloChannel: c }), full);
console.log("");
for (const b of Object.keys(DUB_RIG.buses)) row(`bus ${b}`, await render({ soloBus: b }), full);
console.log(`\n  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
