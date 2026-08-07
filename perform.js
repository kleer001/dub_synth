// dub_synth/perform.js — the generative layer. Stage 5, second half.
//
// This is the file that answers "how does it go on forever without repeating or
// wandering". The genre's own answer, read off six analysed tracks
// (research/dub_techno_technique.md §7), is *not* harmonic or melodic
// development. It is:
//
//   1. Sections are minutes, not bars — median 48 s, mean 60 s, range 3 s-3:11.
//   2. Boundaries are effect moves and mutes, not new material.
//   3. Spacing is irregular and accelerating: long plateaus early, boundaries
//      clustering toward the climax, one long tail. Even spacing is wrong.
//   4. Subtraction is the primary motion device. The drop is a removal.
//   5. Climaxes repeat verbatim. There is no development obligation.
//   6. The ending need not restore the beginning.
//   7. Harmonic rate is near zero (that part lives in riddim.js).
//
// The planner is a generator so that "endless" is literal: it yields sections
// forever and the caller stops pulling when it has enough. A finite render just
// takes the first N seconds' worth. Everything is drawn from a seeded RNG, so
// the same seed is the same performance.

import { dropOut } from "./gesture.js";

// The energy ladder the sections walk. Each state names which channels are
// audible; motion between states is therefore mostly muting and unmuting.
// Modelled on the analysed arrangements: kick+pad exposition, additive build to a
// climax, dips made by subtraction, a long reduced tail.
export const STATES = {
  intro:     { on: ["pad", "noise", "stabC"], label: "space before the palette" },
  exposition:{ on: ["kick", "bass", "pad", "noise", "stabA"], label: "the frame states itself" },
  build:     { on: ["kick", "bass", "pad", "noise", "stabA", "stabB", "hat"], label: "second stab fills the gaps" },
  climax:    { on: ["kick", "bass", "pad", "noise", "stabA", "stabB", "stabC", "hat", "shaker", "perc"], label: "everything audible" },
  dip:       { on: ["kick", "bass", "pad", "noise", "stabA", "stabB"], label: "presence pulled out from under it" },
  lull:      { on: ["kick", "noise", "stabC"], label: "after the climax" },
  outro:     { on: ["pad", "noise", "stabC"], label: "pushed into the space" },
};

const ALL_CHANNELS = Object.keys(STATES).reduce((set, k) => {
  for (const c of STATES[k].on) set.add(c);
  return set;
}, new Set(["kick", "bass", "pad", "noise", "stabA", "stabB", "stabC", "hat", "shaker", "perc"]));

// The arc, as a sequence of states. It is walked with repeats rather than
// developed — rule 5. Phylyps Trak recreates its climax "using the same elements
// without any modifications", so a returning climax is the same state, not a
// bigger one.
const ARC = ["intro", "exposition", "build", "climax", "dip", "climax", "lull", "build", "climax", "outro"];

// Section lengths, in seconds, drawn to match the measured distribution: long
// plateaus early, tightening toward each climax. `tension` 0..1 is how close the
// arc is to its peak.
function sectionSeconds(rng, state, tension) {
  if (state === "intro") return rng.float(20, 45);
  if (state === "outro") return rng.float(60, 190);      // the long tail
  if (state === "dip") return rng.float(8, 35);           // the brief drops
  // Plateaus early (up to ~3 min), tightening as tension rises — rule 3.
  const ceiling = 190 - 130 * tension;
  return rng.float(28, Math.max(45, ceiling));
}

// Which gestures mark the move from one state to the next. Boundaries are made
// of mutes and effect moves — rule 2 — so this is where rules 2 and 4 live.
function boundaryGestures(rng, { from, to, at, seconds, spec }) {
  const gestures = [];
  const wasOn = new Set(STATES[from]?.on ?? []);
  const nowOn = new Set(STATES[to].on);

  // Removals first, and they are the loud part of the transition.
  for (const c of ALL_CHANNELS) {
    if (wasOn.has(c) && !nowOn.has(c)) {
      gestures.push({ type: "mute", channel: c, at, seconds: to === "outro" ? rng.float(2, 6) : rng.float(0.02, 0.4) });
    }
  }
  for (const c of ALL_CHANNELS) {
    if (!wasOn.has(c) && nowOn.has(c)) {
      gestures.push({ type: "unmute", channel: c, at, seconds: rng.float(0.02, 1.2) });
    }
  }

  // A feedback throw articulates the boundary itself (§3). Which echo gets it
  // depends on which stab layers are live.
  const liveEchoes = ["stabA", "stabB", "stabC"].filter((s) => nowOn.has(s) || wasOn.has(s))
    .map((s) => ({ stabA: "echoA", stabB: "echoB", stabC: "echoC" })[s]);
  if (liveEchoes.length) {
    gestures.push({
      type: "throwFeedback", bus: rng.pick(liveEchoes), at,
      peak: rng.float(0.86, 0.95), rise: rng.float(0.1, 0.4),
      hold: rng.float(1.5, 4.5), fall: rng.float(1.0, 3.0),
    });
  }

  // The filter as structure (§6, The Salt On Her Cheeks): entering a reduced
  // state closes the echo tone down, leaving it opens back up.
  const reducing = ["dip", "lull", "outro"].includes(to);
  for (const bus of ["echoA", "echoB", "echoC"]) {
    gestures.push({ type: "sweep", bus, to: reducing ? rng.float(600, 1400) : rng.float(2600, 6000), at });
  }

  // Spatial motion without amplitude change — Aerial's whole dynamic (§6).
  const rideable = [...nowOn].filter((c) => Object.keys(spec.channels[c]?.sends ?? {}).length);
  if (rideable.length) {
    const channel = rng.pick(rideable);
    const bus = rng.pick(Object.keys(spec.channels[channel].sends));
    gestures.push({ type: "sendRide", channel, bus, to: rng.float(0.6, 1.0), at, seconds: rng.float(1, 4) });
    gestures.push({ type: "sendReturn", channel, bus, at: at + seconds * 0.6, seconds: rng.float(2, 6) });
  }

  // The outro pushes everything into the shimmer rather than fading it — the
  // ending need not restore the beginning (rule 6).
  if (to === "outro") {
    gestures.push({ type: "shimmerRise", to: 0.7, at, seconds: rng.float(4, 12) });
    gestures.push({ type: "reverbDecay", bus: "plate", to: rng.float(5, 8) });
  }
  if (to === "intro") gestures.push({ type: "shimmerRise", to: 0.42, at, seconds: 4 });

  return gestures;
}

// Yields sections forever. Each is { index, state, at, seconds, gestures }.
export function* performance({ rng, spec, startAt = 0 }) {
  let at = startAt;
  let previous = null;
  for (let i = 0; ; i++) {
    const state = ARC[i % ARC.length];
    // Tension is where this section sits between the arc's climaxes.
    const tension = { intro: 0, exposition: 0.2, build: 0.6, climax: 1, dip: 0.5, lull: 0.15, outro: 0 }[state];
    const seconds = sectionSeconds(rng, state, tension);
    const gestures = boundaryGestures(rng, { from: previous, to: state, at, seconds, spec });

    // Inside a long plateau, nothing structural happens — but the hand does not
    // stop. A mid-section drop-out is the "brief dip" Resonance makes by muting
    // only the shakers, or the break Phylyps Trak makes by muting the kick (§7.4).
    if (seconds > 70 && rng.chance(0.7)) {
      const victims = STATES[state].on.filter((c) => c !== "noise" && c !== "pad");
      if (victims.length) {
        const when = at + seconds * rng.float(0.35, 0.7);
        gestures.push(...dropOut([rng.pick(victims)], when, rng.float(3, 10)));
        gestures.push({ type: "throwFeedback", bus: rng.pick(["echoA", "echoB", "echoC"]), at: when, peak: rng.float(0.88, 0.96) });
      }
    }

    yield { index: i, state, label: STATES[state].label, at, seconds, gestures };
    previous = state;
    at += seconds;
  }
}

// Materialise `seconds` worth of performance. The last section is truncated
// rather than dropped, so the plan always covers the whole render.
export function planPerformance({ rng, spec, seconds, startAt = 0 }) {
  const sections = [];
  for (const s of performance({ rng, spec, startAt })) {
    if (s.at >= startAt + seconds) break;
    const clipped = Math.min(s.seconds, startAt + seconds - s.at);
    sections.push({ ...s, seconds: clipped, gestures: s.gestures.filter((g) => g.at < startAt + seconds) });
    if (s.at + s.seconds >= startAt + seconds) break;
  }
  return sections;
}

// The channels audible at a given time, for the note layer to consult.
export function activeAt(sections, t) {
  let state = sections[0]?.state;
  for (const s of sections) if (t >= s.at) state = s.state; else break;
  return new Set(STATES[state]?.on ?? []);
}
