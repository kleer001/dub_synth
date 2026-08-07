// dub_synth/ui/engine.js — the engine, played live.
//
// render.mjs schedules a whole performance before a single sample is computed:
// every note, every gesture, and ~2500 knob-walk events per echo, all written
// onto the graph up front. That is correct for a bounce and impossible for an
// instrument, because an instrument does not know what it will be asked to do
// next. So this file replaces the one part of render.mjs that cannot survive the
// move — the "schedule everything" loop — and reuses the rest untouched.
//
// The clock is the standard two-clock arrangement: a coarse setInterval wakes up
// often enough to be reliable, looks a short way into the future, and hands the
// audio clock precise times for anything falling inside that window. Nothing is
// scheduled by the timer itself; the timer only decides *when to schedule*.
//
// The consequence that matters musically: the §2 knob walks are re-armed in
// chunks rather than written once. That is not just an accommodation, it repairs
// something. `ride` opens with cancelScheduledValues, so offline the first
// feedback throw on a bus deletes that bus's walk for the rest of the render and
// the echo goes static. Here the next chunk re-arms it, so a throw is a gesture
// over the walk instead of the end of it.

import { makeRng } from "../core/rng.js";
import { DUB_RIG, buildRig } from "../rig.js";
import { applyGesture } from "../gesture.js";
import { performance as sections } from "../perform.js";
import { makeRiddim } from "../riddim.js";
import { makeVoices } from "../voices.js";
import { synthBed } from "../noise.js";
import { loadPitchWorklet } from "../dsp/fx.js";

// How far ahead to schedule, and how often to wake. The window has to comfortably
// exceed the timer's worst-case lateness or a note lands in the past and Web
// Audio fires it immediately, which is audible as a flam.
const LOOKAHEAD = 0.35;
const TICK_MS = 60;
// Knob-walk re-arm chunk. Long enough that the per-chunk cost is trivial, short
// enough that a feedback throw is repaired within a musical moment.
const CHUNK = 1.5;
// Voice-internal walks (the stab band-pass, the pad cutoff) are written in one
// go because voices.js owns those params and does not hand them back. An hour is
// not forever; see `horizonEndsAt` on the returned engine.
const VOICE_HORIZON = 3600;

export function createEngine(ctx, opts = {}) {
  const {
    seed = 7, bpm = 125, tonic = "G", octave = 2,
    progression = "listing", pattern = "steppers",
    noiseType = "static", onSection = null,
  } = opts;

  const BEAT = 60 / bpm, STEP = BEAT / 4, BAR = BEAT * 4;

  // The same four independent streams render.mjs derives, for the same reason:
  // editing one layer must not reshuffle the others.
  const planRng = makeRng(seed);
  const knobRng = makeRng(seed ^ 0x4b4e4f42);
  const noteRng = makeRng(seed ^ 0x4e4f5445);
  const irRng = makeRng(seed ^ 0x5eed);

  const rig = buildRig(ctx, DUB_RIG, { random: irRng.next });
  const riddim = makeRiddim({ rng: noteRng, tonic, octave, progression, pattern, barsPerChord: 16 });
  const voices = makeVoices(ctx, { rng: noteRng, seconds: VOICE_HORIZON, beat: BEAT });
  const ch = (name) => rig.mix.channel(name).input;

  // One persistent voice per part, retriggered — never a graph per note.
  const parts = {
    kick: voices.kick(ch("kick")),
    bass: voices.bass(ch("bass")),
    hat: voices.hat(ch("hat")),
    shaker: voices.shaker(ch("shaker")),
    rim: voices.snare(ch("perc")),
    wood: voices.perc(ch("perc")),
    stabA: voices.stab(ch("stabA"), { cutoff: 1100, pan: -0.15 }),
    stabB: voices.stab(ch("stabB"), { cutoff: 2000, pan: 0.2 }),
    stabC: voices.stab(ch("stabC"), { cutoff: 2600 }),
  };
  voices.pad(ch("pad"), riddim.stabChord(0).map((hz) => hz / 2));

  const bed = synthBed(ctx, { type: noiseType, rng: noteRng, gain: 1, hpf: 900 });
  bed.output.connect(ch("noise"));

  // §2's rates, derived the same way render.mjs derives them.
  const WALK_RATE = (2 / BEAT) * (1 + 0.0224);   // 4.26 Hz at 125 BPM
  const DRIFT_RATE = 0.11;
  const WALKS = [
    ["echoA", { min: 0.28, max: 0.62 }],
    ["echoB", { min: 0.20, max: 0.42 }],
    ["echoC", { min: 0.30, max: 0.66 }],
  ];
  for (const [bus] of WALKS) rig.fx[bus].driftTone({ rate: DRIFT_RATE, centre: 2750, depth: 2250 });

  // Params the hand is currently on. A held param is skipped by the re-armer, so
  // the walk keeps running in the model while the fader wins at the output — and
  // releasing hands it straight back at the next chunk.
  const held = new Set();

  let t0 = 0;                 // audio time the performance began
  let bar = 0;                // next bar to schedule
  let chunk = 0;              // next walk chunk to arm, in performance time
  let plan = null;            // the endless section generator
  let nextSection = null;     // pulled but not yet applied
  let live = [];              // sections already applied, for reporting
  let timer = null;
  let state = "stopped";

  const now = () => ctx.currentTime - t0;   // performance time

  function armWalks(from, seconds) {
    for (const [bus, range] of WALKS) {
      if (held.has(`${bus}.feedback`)) continue;
      rig.fx[bus].rideFeedback({ rng: knobRng, seconds, rate: WALK_RATE, start: t0 + from, ...range });
    }
    if (!held.has("echoC.time")) {
      // The one LFO §2 beat-syncs, at the 1/4 it names.
      rig.fx.echoC.warpTime({ rng: knobRng, seconds, rate: 1 / BEAT, low: 0.55, high: 0.85, start: t0 + from });
    }
  }

  function scheduleBar(n) {
    const base = t0 + n * BAR;
    const at = (step) => base + step * STEP;

    for (const s of riddim.kickSteps()) parts.kick.at(at(s));
    for (const s of riddim.hatSteps()) parts.hat.at(at(s));
    for (const s of riddim.shakerSteps()) parts.shaker.at(at(s));
    parts.rim.at(at(8), { peak: 0.3 });
    if (n % 2 === 1) parts.wood.at(at(14));

    for (const e of riddim.bassFigure(n)) parts.bass.at(at(e.step), e.hz, BEAT * 0.9, { dead: e.dead });

    const chord = riddim.stabChord(n, { colour: n % 8 === 7 });
    for (const s of riddim.stabSteps(n)) {
      parts.stabA.at(at(s), chord);
      parts.stabB.at(at(s) + STEP * 2, chord.map((h) => h * 1.5), { dur: 0.11, peak: 0.4 });
    }
    if (n % 4 === 0) parts.stabC.at(at(6), chord.map((h) => h * 2), { dur: 0.09, peak: 0.32 });
  }

  function tick() {
    const horizon = now() + LOOKAHEAD;

    // Sections, and the gestures that mark their boundaries. Gesture times are
    // in performance time, so they shift onto the audio clock by t0.
    while (nextSection && nextSection.at < horizon) {
      const s = nextSection;
      for (const g of s.gestures) applyGesture(rig, { ...g, at: t0 + g.at });
      live.push(s);
      if (live.length > 64) live.shift();
      onSection?.(s, live);
      nextSection = plan.next().value;
    }

    while (bar * BAR < horizon) scheduleBar(bar++);
    while (chunk < horizon) { armWalks(chunk, CHUNK); chunk += CHUNK; }
  }

  return {
    ctx, rig, riddim, voices, bed,
    bpm, beat: BEAT, bar: BAR, step: STEP,
    get state() { return state; },
    get time() { return state === "stopped" ? 0 : now(); },
    get sections() { return live; },
    get output() { return rig.output; },
    // Voice-internal walks are written once, so the engine is honest about how
    // long it is good for rather than claiming an endlessness it does not have.
    get horizonEndsAt() { return VOICE_HORIZON; },

    // The shimmer's octave is a real pitch shift; in a browser that can be the
    // phase-vocoder worklet instead of the granular fallback. Must run before
    // buildRig to take effect, so callers await this and then construct.
    async start() {
      if (state === "running") return this;
      if (ctx.state === "suspended") await ctx.resume();
      // stop() silences the desk, so a restart has to hand the channels back to
      // the plan before the first section's gestures land on them.
      for (const name of Object.keys(DUB_RIG.channels)) rig.mix.mute(name, false, ctx.currentTime, 0.02);
      t0 = ctx.currentTime + 0.12;      // a beat of slack so the first bar is not late
      bar = 0; chunk = 0; live = [];
      plan = sections({ rng: planRng, spec: DUB_RIG });
      nextSection = plan.next().value;
      state = "running";
      tick();
      timer = setInterval(tick, TICK_MS);
      return this;
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      state = "stopped";
      // Silence the desk rather than tearing the graph down — the voices are
      // persistent by design and rebuilding them is the thing this engine
      // exists to avoid.
      for (const name of Object.keys(DUB_RIG.channels)) rig.mix.mute(name, true, ctx.currentTime, 0.08);
      return this;
    },

    // Called by the UI when a hand takes a param, and again when it lets go.
    hold(key, on) { on ? held.add(key) : held.delete(key); return this; },
    isHeld: (key) => held.has(key),
  };
}

// Load the worklet, then build. Separate because addModule is async and the rig
// has to be constructed after it to pick the better shifter.
export async function bootEngine(ctx, opts = {}) {
  // ?worklet=0 forces the granular shifter, which is what an OfflineAudioContext
  // gets. Keeping the switch makes the two shimmer paths directly comparable.
  if (opts.worklet !== false) await loadPitchWorklet(ctx);
  return createEngine(ctx, opts);
}
