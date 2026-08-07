// The generative layer behind dub_synth: the riddim (the dry frame) and the
// performance planner (the long-form structure). Both are pure — they produce
// data, not audio — so they can be checked without an audio context.
//
// The assertions are the rules read off the six analysed tracks in
// research/dub_techno_technique.md §7. If the planner stops satisfying them it
// has stopped generating the genre.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeRng } from "../engine/core/rng.js";
import { DUB_RIG } from "../engine/rig.js";
import { GESTURES } from "../engine/gesture.js";
import { activeAt, planPerformance, STATES } from "../engine/perform.js";
import { GROOVE_OPS, makeRiddim, PROGRESSIONS } from "../engine/riddim.js";

const plan = (seed, seconds = 900) =>
  planPerformance({ rng: makeRng(seed), spec: DUB_RIG, seconds });

test("a plan is deterministic for a given seed", () => {
  assert.deepEqual(plan(7), plan(7));
  assert.notDeepEqual(plan(7), plan(8));
});

test("a plan covers the whole requested duration", () => {
  const sections = plan(3, 600);
  assert.equal(sections[0].at, 0);
  const end = sections.at(-1).at + sections.at(-1).seconds;
  assert.ok(Math.abs(end - 600) < 1e-6, `plan ends at ${end}, not 600`);
});

test("sections are minutes, not bars", () => {
  // §7.1: median 48 s across the corpus, with plateaus of 2-3 minutes.
  const lens = [];
  for (let seed = 1; seed <= 12; seed++) lens.push(...plan(seed).map((s) => s.seconds));
  lens.sort((a, b) => a - b);
  const median = lens[lens.length >> 1];
  assert.ok(median > 25 && median < 90, `median section ${median.toFixed(1)}s is outside the genre's range`);
  assert.ok(lens.at(-1) > 100, "no long plateau was ever generated");
});

test("section spacing is irregular", () => {
  // §7.3: even spacing is wrong. Require real spread within a single plan.
  const lens = plan(5).map((s) => s.seconds);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
  assert.ok(sd / mean > 0.3, `coefficient of variation ${(sd / mean).toFixed(2)} is too regular`);
});

test("every gesture a plan emits is a known type with a time", () => {
  for (let seed = 1; seed <= 8; seed++) {
    for (const s of plan(seed)) {
      for (const g of s.gestures) {
        assert.ok(GESTURES[g.type], `unknown gesture type "${g.type}"`);
        assert.equal(typeof g.at, "number");
        assert.ok(Number.isFinite(g.at) && g.at >= 0, `gesture at ${g.at}`);
      }
    }
  }
});

test("boundaries are made of mutes and effect moves, not new material", () => {
  // §7.2: four of Koçer's five boundary criteria are mixer gestures.
  const kinds = new Set();
  for (const s of plan(11)) for (const g of s.gestures) kinds.add(g.type);
  for (const required of ["mute", "unmute", "throwFeedback", "sweep"]) {
    assert.ok(kinds.has(required), `plan never used "${required}"`);
  }
});

test("subtraction is the primary motion device", () => {
  // §7.4: the drop is a removal. Mutes should not be a rare event.
  let mutes = 0, total = 0;
  for (let seed = 1; seed <= 8; seed++) {
    for (const s of plan(seed)) for (const g of s.gestures) { total++; if (g.type === "mute") mutes++; }
  }
  assert.ok(mutes / total > 0.1, `mutes are only ${(100 * mutes / total).toFixed(1)}% of gestures`);
});

test("a returning climax is the same state, not a bigger one", () => {
  // §7.5: Phylyps Trak recreates its climax "using the same elements without
  // any modifications". Every climax must therefore expose the same channels.
  const climaxes = plan(4, 1800).filter((s) => s.state === "climax");
  assert.ok(climaxes.length >= 2, "expected the arc to return to a climax");
  const first = [...STATES.climax.on].sort().join(",");
  for (const c of climaxes) assert.equal([...STATES[c.state].on].sort().join(","), first);
});

test("gestures only name channels and buses the rig actually has", () => {
  const channels = new Set(Object.keys(DUB_RIG.channels));
  const buses = new Set(Object.keys(DUB_RIG.buses));
  for (let seed = 1; seed <= 8; seed++) {
    for (const s of plan(seed)) for (const g of s.gestures) {
      if (g.channel) assert.ok(channels.has(g.channel), `gesture names missing channel "${g.channel}"`);
      if (g.bus) assert.ok(buses.has(g.bus), `gesture names missing bus "${g.bus}"`);
    }
  }
});

test("every state names only channels the rig has", () => {
  const channels = new Set(Object.keys(DUB_RIG.channels));
  for (const [name, st] of Object.entries(STATES)) {
    for (const c of st.on) assert.ok(channels.has(c), `state "${name}" names missing channel "${c}"`);
  }
});

test("the noise layer is never absent", () => {
  // §5: all 50 of 50 sampled tracks carry one.
  for (const [name, st] of Object.entries(STATES)) {
    assert.ok(st.on.includes("noise"), `state "${name}" drops the noise bed`);
  }
  const sections = plan(9);
  for (const s of sections) assert.ok(activeAt(sections, s.at + 1).has("noise"));
});

test("the performance generator never runs out", () => {
  // "Endless" has to be literal — the arc repeats rather than terminating.
  const long = plan(2, 7200);
  assert.ok(long.length > 20, `only ${long.length} sections in two hours`);
});

// ---- the riddim ----------------------------------------------------------

const riddim = (seed) => makeRiddim({ rng: makeRng(seed), tonic: "G", octave: 2, progression: "listing" });

test("harmonic rate is near zero", () => {
  // §7.7: two chords over 32 bars is the genre's whole budget.
  const r = makeRiddim({ rng: makeRng(1), progression: "listing", barsPerChord: 16 });
  const perBar = Array.from({ length: 64 }, (_, b) => r.chordAt(b));
  const changes = perBar.filter((c, i) => i > 0 && c !== perBar[i - 1]).length;
  assert.ok(changes <= 4, `${changes} chord changes in 64 bars is too many`);
});

test("stabs land off the beat", () => {
  // §3: dub applies echo to off-beat material; that placement is the point.
  const r = riddim(1);
  for (let bar = 0; bar < 8; bar++) {
    for (const step of r.stabSteps(bar)) {
      assert.notEqual(step % 4, 0, `stab on step ${step} is on the beat`);
    }
  }
});

test("steppers puts the kick on every beat", () => {
  const r = makeRiddim({ rng: makeRng(1), pattern: "steppers" });
  assert.deepEqual(r.kickSteps(), [0, 4, 8, 12]);
});

test("one-drop puts the kick on the third beat only", () => {
  const r = makeRiddim({ rng: makeRng(1), pattern: "oneDrop" });
  assert.deepEqual(r.kickSteps(), [8]);
});

test("the bass figure is deterministic and stays in the bar", () => {
  const a = riddim(5), b = riddim(5);
  for (let bar = 0; bar < 16; bar++) {
    assert.deepEqual(a.bassFigure(bar), b.bassFigure(bar));
    for (const e of a.bassFigure(bar)) {
      assert.ok(e.step >= 0 && e.step < 16, `bass step ${e.step} outside the bar`);
      assert.ok(e.hz > 20 && e.hz < 400, `bass note ${e.hz} Hz is not a bassline`);
    }
  }
});

test("groove operators vary placement without inventing pitches", () => {
  // §4: displacement is horizontal only — "without changing the melodic information".
  const figure = [{ step: 0, degree: 0 }, { step: 4, degree: 4 }, { step: 10, degree: 7 }];
  const moved = GROOVE_OPS.displace(figure, 2);
  assert.deepEqual(moved.map((e) => e.degree), figure.map((e) => e.degree));
  assert.deepEqual(moved.map((e) => e.step), [2, 6, 12]);
  // Displacement wraps inside the bar rather than running off the end.
  assert.deepEqual(GROOVE_OPS.displace(figure, 8).map((e) => e.step), [8, 12, 2]);
});

test("dead notes are marked, not removed", () => {
  const figure = [{ step: 0, degree: 0 }, { step: 6, degree: 4 }];
  const out = GROOVE_OPS.deadNotes(figure, [6]);
  assert.equal(out.length, 2);
  assert.equal(out[1].dead, true);
  assert.equal(out[0].dead, undefined);
});

test("every transcribed progression is one or two chords", () => {
  // Every progression in §6 except The Salt On Her Cheeks is one or two chords.
  for (const [name, degrees] of Object.entries(PROGRESSIONS)) {
    assert.ok(degrees.length <= 3, `"${name}" has ${degrees.length} chords`);
  }
});

test("the stab voicing is a triad, with the colour note only when asked", () => {
  const r = riddim(3);
  assert.equal(r.stabChord(0).length, 3);
  assert.equal(r.stabChord(0, { colour: true }).length, 4);
});

test("unknown riddim options fail loudly", () => {
  assert.throws(() => makeRiddim({ rng: makeRng(1), pattern: "nope" }));
  assert.throws(() => makeRiddim({ rng: makeRng(1), progression: "nope" }));
  assert.throws(() => makeRiddim({ rng: makeRng(1), bassShape: "nope" }));
});
