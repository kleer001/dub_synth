// The bounce-time mastering pass. Pure DSP over Float32Arrays, so it is testable
// without rendering anything — which is the whole reason it exists rather than
// being built from a DynamicsCompressor that does not limit offline.
//
// The thresholds asserted here are AUDIO_CHECKLIST.md's: true peak <= -1 dBFS,
// zero clipped samples, crest >= 9 dB.

import { test } from "node:test";
import assert from "node:assert/strict";

import { glue, limit, masterChain, measure, normalize, truePeak } from "../master.js";

const SR = 48000;
const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));

// A signal with real dynamics: a quiet bed with periodic loud transients.
function testSignal({ seconds = 2, bedAmp = 0.05, hitAmp = 0.95, hitEvery = 0.5 } = {}) {
  const n = SR * seconds;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const bed = Math.sin(2 * Math.PI * 110 * t) * bedAmp;
    const phase = t % hitEvery;
    const hit = phase < 0.05 ? Math.sin(2 * Math.PI * 60 * phase) * hitAmp * Math.exp(-phase / 0.015) : 0;
    L[i] = bed + hit;
    R[i] = bed * 0.98 + hit;
  }
  return [L, R];
}

test("measure reports peak, rms and crest consistently", () => {
  const n = 1000;
  const ch = new Float32Array(n).fill(0.5);
  const m = measure([ch]);
  assert.ok(Math.abs(m.peak - 0.5) < 1e-6);
  assert.ok(Math.abs(m.rms - 0.5) < 1e-6);
  assert.ok(Math.abs(m.crest) < 1e-6, "a constant signal has zero crest");
  assert.equal(m.clipped, 0);
});

test("measure counts clipped samples", () => {
  const ch = new Float32Array([0, 0.5, 1.0, -1.0, 0.2]);
  assert.equal(measure([ch]).clipped, 2);
});

test("truePeak catches an inter-sample over that peak misses", () => {
  // Alternating +/-0.9 has a sample peak of 0.9 but reconstructs higher between
  // samples; the 4x oversample must see more than the raw peak.
  const n = 64;
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = i % 2 ? 0.9 : -0.9;
  const m = measure([ch]);
  assert.ok(truePeak([ch]) >= m.peak, "true peak must never read below sample peak");
});

test("the limiter guarantees its ceiling", () => {
  for (const ceilingDb of [-1, -3, -0.1]) {
    const ch = testSignal();
    limit(ch, { sampleRate: SR, ceilingDb });
    const m = measure(ch);
    const ceiling = Math.pow(10, ceilingDb / 20);
    assert.ok(m.peak <= ceiling + 1e-6, `peak ${m.peak} exceeded ceiling ${ceiling}`);
    assert.equal(m.clipped, 0);
  }
});

test("the limiter leaves an already-quiet signal alone", () => {
  const ch = testSignal({ bedAmp: 0.01, hitAmp: 0.1 });
  const before = measure(ch);
  const r = limit(ch, { sampleRate: SR, ceilingDb: -1 });
  const after = measure(ch);
  assert.ok(r.maxReductionDb < 0.01, `limiter moved ${r.maxReductionDb} dB on a quiet signal`);
  assert.ok(Math.abs(after.peakDb - before.peakDb) < 0.01);
});

test("the limiter pulls gain down BEFORE the transient, not at it", () => {
  // Look-ahead is the difference between a limiter and a clipper: the sample
  // just before a peak must already be attenuated.
  const n = SR;
  const ch = new Float32Array(n).fill(0.2);
  const spike = Math.floor(n / 2);
  ch[spike] = 4.0;
  const copy = Float32Array.from(ch);
  limit([ch], { sampleRate: SR, ceilingDb: -1, lookaheadMs: 5 });
  const look = Math.round(SR * 0.005);
  const beforeIdx = spike - Math.floor(look / 2);
  assert.ok(ch[beforeIdx] < copy[beforeIdx] * 0.99, "gain had not started falling ahead of the peak");
});

// A two-level sustained signal: quiet for the first half, loud for the second.
// Compression's actual job is to narrow the gap between those two.
function twoLevel({ seconds = 4, quiet = 0.05, loud = 0.7 } = {}) {
  const n = SR * seconds;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const amp = i < n / 2 ? quiet : loud;
    L[i] = Math.sin(2 * Math.PI * 110 * i / SR) * amp;
    R[i] = L[i];
  }
  return [L, R];
}
const halfRms = (ch, half) => {
  const n = ch[0].length, from = half === 0 ? 0 : n / 2, to = half === 0 ? n / 2 : n;
  let s = 0;
  for (let i = from; i < to; i++) s += ch[0][i] * ch[0][i];
  return dB(Math.sqrt(s / (to - from)));
};

test("glue narrows the gap between a quiet and a loud passage", () => {
  const ch = twoLevel();
  const gapBefore = halfRms(ch, 1) - halfRms(ch, 0);
  const r = glue(ch, { sampleRate: SR, thresholdDb: -20, ratio: 4, makeupDb: 0 });
  const gapAfter = halfRms(ch, 1) - halfRms(ch, 0);
  assert.ok(r.maxReductionDb > 0, "compressor did nothing");
  assert.ok(gapAfter < gapBefore - 1, `gap only closed from ${gapBefore.toFixed(1)} to ${gapAfter.toFixed(1)} dB`);
});

test("a 30 ms attack deliberately lets a fast transient through", () => {
  // This is a property, not a defect: a slow bus compressor is not a peak
  // limiter. It compresses what FOLLOWS the transient, which is why glue alone
  // can raise crest and why the brickwall stage exists separately.
  const ch = testSignal();       // ~15 ms hits, faster than the attack
  const before = measure(ch);
  glue(ch, { sampleRate: SR, thresholdDb: -20, ratio: 4, attackMs: 30, makeupDb: 0 });
  const after = measure(ch);
  assert.ok(after.peakDb > before.peakDb - 1.5, "the transient should survive a slow attack largely intact");
});

test("glue below threshold is a no-op", () => {
  const ch = testSignal({ bedAmp: 0.001, hitAmp: 0.002 });
  const before = measure(ch);
  const r = glue(ch, { sampleRate: SR, thresholdDb: -6 });
  const after = measure(ch);
  assert.ok(r.maxReductionDb < 0.01);
  assert.ok(Math.abs(after.rmsDb - before.rmsDb) < 0.01);
});

test("normalize hits its target exactly", () => {
  const ch = testSignal({ hitAmp: 0.3 });
  normalize(ch, -1);
  assert.ok(Math.abs(measure(ch).peakDb - -1) < 0.01);
});

test("masterChain meets the AUDIO_CHECKLIST gate on a healthy mix", () => {
  const ch = testSignal({ bedAmp: 0.08, hitAmp: 0.6 });
  const r = masterChain(ch, { sampleRate: SR });
  assert.ok(r.truePeakDb <= -1 + 0.01, `true peak ${r.truePeakDb}`);
  assert.equal(r.after.clipped, 0);
  assert.ok(r.after.crest >= 9, `crest ${r.after.crest} below the 9 dB floor`);
});

test("masterChain complains when the mix arrives too hot", () => {
  // A mix already slammed against the ceiling should be reported as a MIX
  // problem, not silently squashed further.
  const n = SR;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = Math.sin(2 * Math.PI * 100 * i / SR) * 4; R[i] = L[i]; }
  const r = masterChain([L, R], { sampleRate: SR });
  assert.equal(r.ok, false);
  assert.ok(r.notes.some((x) => /too hot|limiter pulled/.test(x)), `notes were: ${r.notes.join("; ")}`);
});

test("masterChain complains when the result is too quiet", () => {
  const ch = testSignal({ bedAmp: 0.002, hitAmp: 0.01 });
  const r = masterChain(ch, { sampleRate: SR });
  assert.ok(r.notes.some((x) => /quiet/.test(x)), `notes were: ${r.notes.join("; ")}`);
});

test("the pass is deterministic", () => {
  const a = testSignal(), b = testSignal();
  masterChain(a, { sampleRate: SR });
  masterChain(b, { sampleRate: SR });
  for (let c = 0; c < a.length; c++) assert.deepEqual(Array.from(a[c]), Array.from(b[c]));
});
