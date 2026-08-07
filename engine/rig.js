// dub_synth/rig.js — the network. Stage 4, first half.
//
// Dub is a performance on a desk, so before any gesture can be played there has
// to be a desk to play it on: which channels exist, which spaces exist, how much
// of each channel each space hears, and how loud each space returns. That routing
// is the instrument's body, and it is declared here as data rather than wired by
// hand at each call site.
//
// The shape comes straight from the analysed records
// (research/dub_techno_technique.md §6):
//   - Three stab layers, each with its OWN echo. Resonance's four-bar
//     call-and-response is produced by the layers' decays intersecting; a single
//     shared echo bus collapses that into one voice and the effect disappears.
//   - Spring on the drums (Aerial), plate with a long pre-delay on the melodic
//     layer (Aerial's stabs), shimmer for the introduction and outro (Resonance).
//   - A noise channel that is always present and never soloed (§5: all 50 of 50
//     sampled tracks carry one).
//   - No bass send to anything. The low end stays dry — that is what keeps a mix
//     this wet from turning to mud (§1, §8), and it is AUDIO_CHECKLIST.md's
//     "kick owns the sub" stated as routing.
//
// Two mix rules are enforced structurally rather than left to taste, because
// getting them wrong is what makes a dub mix collapse:
//
//   `ret` — every bus has a RETURN level. Six wet buses all returning at unity
//   will out-shout any kick, whatever its fader says. The wet layer is loud
//   because it never stops, not because any one repeat is loud.
//
// There is deliberately NO sidechain ducking here. Sidechaining every element to
// the kick is a four-on-the-floor EDM reflex, and it is not this genre: across
// the 302 pages of the source thesis the technique is mentioned exactly once, on
// p119, describing an *acid techno* track. Dub techno's own mechanism is stated
// plainly instead — the bass and percussion form a **dry backcloth** that the wet
// output sits under BY LEVEL (§3), and the structure comes from muting things
// (§7.4). Deep techno "lacks sharp rises and falls"; a pumping mix is the wrong
// genre. If the kick is not audible, the fix is the returns and the faders.

import { makeDubEcho, makeFilterDelay } from "./dsp/echo.js";
import { makePlate, makeShimmer, makeSpring } from "./dsp/space.js";
import { makeDubMixer } from "./dsp/mixer.js";
import { makeMasterBus } from "./dsp/masterbus.js";

// Send levels are the resting state; the performance rides them from here.
export const DUB_RIG = {
  channels: {
    kick:   { fader: 0.72, pan: 0,     sends: { spring: 0.08 } },
    bass:   { fader: 0.55, pan: 0,     sends: {} },
    stabA:  { fader: 0.34, pan: -0.15, sends: { echoA: 0.85, fdelay: 0.35, plate: 0.35 } },
    stabB:  { fader: 0.26, pan: 0.20,  sends: { echoB: 0.75, plate: 0.25 } },
    stabC:  { fader: 0.22, pan: 0.05,  sends: { echoC: 0.90, shimmer: 0.30 } },
    hat:    { fader: 0.18, pan: 0.35,  sends: { spring: 0.45 } },
    shaker: { fader: 0.15, pan: -0.40, sends: { spring: 0.30 } },
    perc:   { fader: 0.14, pan: 0.55,  sends: { plate: 0.55, echoB: 0.40 } },
    pad:    { fader: 0.30, pan: 0,     sends: { plate: 0.50, shimmer: 0.35 } },
    noise:  { fader: 0.08, pan: -0.20, sends: {} },
  },
  // Each bus names the block it inserts, the options it is built with, and its
  // return level `ret` — how loud that space is in the mix, independent of how
  // much any channel sends to it. The returns are where the wet layer is kept
  // under the dry frame.
  buses: {
    // Listing, Sinking's measured stab echo: dotted ~237 ms, 50% feedback, 70% wet.
    // `walk` is the §2 feedback ride's range for this bus, and it belongs here
    // rather than at the three call sites that arm it: the range is a property of
    // the echo, and how hot a bus is allowed to get is a mix decision.
    echoA:   { fx: "echo", opts: { time: 0.237, feedback: 0.42, wet: 1, dry: 0 }, ret: 0.30, walk: { min: 0.28, max: 0.50 } },
    // Phylyps Trak's first stabs sit on a 1/16 echo at high feedback.
    // A 1/16 echo is faithful to Phylyps Trak, but a 1/16 IS dense — at 125 BPM
    // it repeats 8 times a second, so its feedback and return have to be the
    // lowest of the three or it becomes the loudest thing in the mix. Measured at
    // feedback 0.46 / return 0.28 it was 76% of the whole track, peaking as loud
    // as the kick.
    echoB:   { fx: "echo", opts: { time: 0.120, feedback: 0.36, wet: 1, dry: 0 }, ret: 0.18, walk: { min: 0.20, max: 0.42 } },
    // The heavily articulated third layer — long, and ridden hardest.
    echoC:   { fx: "echo", opts: { time: 0.480, feedback: 0.52, wet: 1, dry: 0 }, ret: 0.42, walk: { min: 0.30, max: 0.66 } },
    fdelay:  { fx: "filterDelay", opts: {}, ret: 0.55 },
    spring:  { fx: "spring", opts: { decay: 1.0, color: 2200 }, ret: 0.85 },
    plate:   { fx: "plate", opts: { decay: 3.4, preDelay: 0.09 }, ret: 0.30 },
    shimmer: { fx: "shimmer", opts: { decay: 5.0, feedback: 0.42 }, ret: 0.18 },
  },
  // The pre-master trim. It is a MEASURED number, not a taste one — run
  // `node dub_synth/render.mjs --headroom` after any change to channels, buses,
  // returns or voices, and paste what it suggests. Getting this wrong is what
  // made the mix read hot when the rig grew from six channels to ten.
  master: 0.713,
  masterBus: {},
};

const BUILDERS = {
  echo: makeDubEcho,
  filterDelay: makeFilterDelay,
  spring: makeSpring,
  plate: makePlate,
  shimmer: makeShimmer,
};
const NEEDS_NOISE = new Set(["spring", "plate", "shimmer"]);

// Builds the desk and returns the handles a performance needs. `random` seeds the
// reverb impulses; give it its own stream so changing a reverb does not reshuffle
// the knob walks (core/dsp.js noiseSource explains why that matters).
export function buildRig(ctx, spec = DUB_RIG, { random, masterBus = true } = {}) {
  const mix = makeDubMixer(ctx, {
    channels: Object.keys(spec.channels),
    buses: Object.keys(spec.buses),
  });

  const fx = {};
  for (const [name, def] of Object.entries(spec.buses)) {
    const build = BUILDERS[def.fx];
    if (!build) throw new Error(`rig bus "${name}" wants unknown fx "${def.fx}"`);
    fx[name] = build(ctx, NEEDS_NOISE.has(def.fx) ? { ...def.opts, random } : def.opts);
    mix.insert(name, fx[name]);
    mix.busLevel(name, def.ret ?? 1);
  }

  for (const [name, ch] of Object.entries(spec.channels)) {
    mix.fader(name, ch.fader);
    mix.pan(name, ch.pan);
    for (const [bus, level] of Object.entries(ch.sends)) mix.send(name, bus, level);
  }
  mix.master.gain.value = 1;

  const master = masterBus ? makeMasterBus(ctx, { ...spec.masterBus, trim: spec.master }) : null;
  let output = mix.output;
  if (master) { mix.output.connect(master.input); output = master.output; }

  return { mix, fx, spec, master, output };
}

// The resting send level for a channel/bus pair — what a ride returns to.
export function restingSend(spec, channel, bus) {
  return spec.channels[channel]?.sends?.[bus] ?? 0;
}
