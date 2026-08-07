// The scheduled-knob primitive behind dub_synth's modulation. Pure: it only
// writes automation events, so it can be tested against a recording stub with
// no audio context. What matters is that the same seed produces the same
// performance — that is what makes dub renders reproducible.

import { test } from "node:test";
import assert from "node:assert/strict";

import { makeRng } from "../engine/core/rng.js";
import { randomWalk, ride } from "../engine/dsp/knob.js";

// Records automation calls the way an AudioParam would receive them.
function stubParam(initial = 0) {
  const events = [];
  return {
    value: initial,
    events,
    cancelScheduledValues(t) { events.push(["cancel", t]); },
    setValueAtTime(v, t) { events.push(["set", v, t]); },
    linearRampToValueAtTime(v, t) { events.push(["ramp", v, t]); },
  };
}

const scheduled = (p) => p.events.filter((e) => e[0] !== "cancel");

test("randomWalk is deterministic for a given seed", () => {
  const run = (seed) => {
    const p = stubParam();
    randomWalk(p, { rng: makeRng(seed), rate: 4.26, min: 0.25, max: 0.85, seconds: 5 });
    return scheduled(p);
  };
  assert.deepEqual(run(7), run(7));
  assert.notDeepEqual(run(7), run(8));
});

test("randomWalk stays inside its range and its window", () => {
  const p = stubParam();
  randomWalk(p, { rng: makeRng(3), rate: 4.26, min: 0.25, max: 0.85, seconds: 5, start: 2 });
  const ev = scheduled(p);
  assert.ok(ev.length > 1, "expected multiple events");
  for (const [, v, t] of ev) {
    assert.ok(v >= 0.25 && v <= 0.85, `value ${v} out of range`);
    assert.ok(t >= 2 && t <= 7 + 1e-9, `time ${t} outside the window`);
  }
});

test("randomWalk event times are non-decreasing", () => {
  const p = stubParam();
  randomWalk(p, { rng: makeRng(11), rate: 3, min: 0, max: 1, smooth: 0.5, seconds: 4 });
  const times = scheduled(p).map((e) => e[2]);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] >= times[i - 1], `event ${i} goes backwards in time`);
  }
});

test("randomWalk rate sets the step count", () => {
  const count = (rate) => {
    const p = stubParam();
    randomWalk(p, { rng: makeRng(5), rate, min: 0, max: 1, seconds: 10 });
    // One event pair per step after the first; count distinct step onsets.
    return new Set(scheduled(p).map((e) => e[2].toFixed(6))).size;
  };
  assert.ok(count(4) > count(1), "a faster rate must schedule more steps");
});

test("smooth 0 gives sample-and-hold, smooth 1 gives ramps", () => {
  const kinds = (smooth) => {
    const p = stubParam();
    randomWalk(p, { rng: makeRng(2), rate: 2, min: 0, max: 1, smooth, seconds: 4 });
    return new Set(scheduled(p).map((e) => e[0]));
  };
  assert.deepEqual([...kinds(0)], ["set"]);
  assert.ok(kinds(1).has("ramp"), "smoothed walk must use ramps");
});

test("randomWalk rejects a non-positive rate or duration", () => {
  const p = stubParam();
  assert.throws(() => randomWalk(p, { rng: makeRng(1), rate: 0, min: 0, max: 1, seconds: 1 }));
  assert.throws(() => randomWalk(p, { rng: makeRng(1), rate: 4, min: 0, max: 1, seconds: 0 }));
});

test("ride holds then travels to the target", () => {
  const p = stubParam(0.5);
  ride(p, 0.9, 10, 0.25);
  const ev = scheduled(p);
  assert.deepEqual(ev[0], ["set", 0.5, 10]);
  assert.deepEqual(ev[1], ["ramp", 0.9, 10.25]);
});
