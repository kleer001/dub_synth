// core/metrics.js — shared audio measurement helpers. Lifted verbatim (numerically) out of
// render.mjs so the CLI tool and the render-regression harness measure with ONE
// implementation, not two (docs/design/modular_track_rack.md §regression harness). Pure:
// takes Float32 channel data, returns numbers. Uses the repo FFT (core/dsp.js) — no deps.

import { magnitude } from "./dsp.js";

export const DEFAULT_SR = 48000;
const dB = (x) => 10 * Math.log10(Math.max(1e-12, x));

// Peak / RMS(dB) / DC offset / stereo width(dB). `R` optional (mono → width 0, R=L).
export function stats({ L, R }) {
  const Rc = R || L;
  let peak = 0, sum = 0, dc = 0, side = 0, mid = 0;
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i]);
    if (a > peak) peak = a;
    sum += L[i] * L[i];
    dc += L[i];
    const s = L[i] - Rc[i], m = L[i] + Rc[i];
    side += s * s; mid += m * m;
  }
  const n = Math.max(1, L.length);
  return { peak, rmsDb: dB(sum / n), dc: dc / n, widthDb: dB(side / Math.max(1e-12, mid)) };
}

// 16k-point FFT at the buffer midpoint → spectral centroid + lo/mid/hi band energy
// (< 200 Hz / < 2 kHz / rest). Large window = clean harmonic separation (CLAUDE.md).
export function spectrum({ L }, sr = DEFAULT_SR, N = 16384) {
  const off = (L.length / 2) | 0, fr = new Float32Array(N);
  for (let i = 0; i < N; i++) fr[i] = L[off + i] || 0;
  const mag = magnitude(fr);
  let lo = 0, md = 0, hi = 0, cn = 0, cd = 0;
  for (let k = 0; k < mag.length; k++) {
    const f = k * sr / N;
    if (f < 200) lo += mag[k]; else if (f < 2000) md += mag[k]; else hi += mag[k];
    cn += f * mag[k]; cd += mag[k];
  }
  return { centroid: cd > 0 ? cn / cd : 0, lo, md, hi };
}
