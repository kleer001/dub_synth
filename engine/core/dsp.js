// DSP helpers. Pure curve/FFT functions (Node-testable) + AudioContext buffer
// factories (browser). Ported in spirit from web/audio.js (pink noise, impulse).

import { mulberry32 } from "./rng.js";

// ---- Seeded noise for buffer factories ----
//
// The noise-filled buffers below (noise beds, reverb impulses) are seeded from
// their OWN parameters, not from Math.random. An unseeded source makes every
// render of the same seed a different file, which defeats byte-comparing offline
// output — and a single shared stream would be worse, because then the buffer you
// get depends on how many other buffers were built first.
//
// Deriving the seed from the arguments means the same request always yields the
// same buffer, in any order, in any process. Pass `seed` for a different but
// still reproducible variant, or `random` to supply the stream outright.
function noiseSource({ seed = 0, random } = {}, ...params) {
  if (random) return random;
  let h = 0x811c9dc5; // FNV-1a
  for (const p of [seed, ...params]) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  }
  return mulberry32(h >>> 0);
}

// ---- WaveShaper curves (pure) ----

export function satCurve(amount = 1, n = 2048) {
  const c = new Float32Array(n);
  const k = amount * 4 + 0.001;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / norm;
  }
  return c;
}

// West-Coast wavefolder: fold the wave back on itself to add harmonics.
export function foldCurve(folds = 3, n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * folds;
    // triangle fold into [-1,1]
    c[i] = Math.abs((((x - 1) % 4) + 4) % 4 - 2) - 1;
  }
  return c;
}

export function clipCurve(drive = 2, n = 2048) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * drive;
    c[i] = Math.max(-1, Math.min(1, x));
  }
  return c;
}

// Bit-depth reduction (the cheap WaveShaper bitcrush fallback; true SR-reduction lives
// in the AudioWorklet).
export function bitCurve(bits = 6, n = 4096) {
  const levels = Math.pow(2, bits);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x * levels) / levels;
  }
  return c;
}

// Asymmetric diode-clipper (antiparallel diode pair): the negative half saturates sooner
// than the positive, so it adds EVEN harmonics (a warmer, tube/analog grit) on top of the
// odd ones — unlike the symmetric tanh `satCurve`. The DC offset the asymmetry introduces
// is removed downstream by the master DC-block highpass.
export function diodeCurve(amount = 1, n = 2048) {
  const c = new Float32Array(n);
  const k = amount * 3 + 1;
  let peak = 1e-9;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = x >= 0 ? 1 - Math.exp(-k * x) : -(1 - Math.exp(k * 1.6 * x)); // neg clips ~1.6× sooner
    c[i] = y;
    if (Math.abs(y) > peak) peak = Math.abs(y);
  }
  for (let i = 0; i < n; i++) c[i] /= peak; // normalize to ±1
  return c;
}

// ---- AudioContext buffer factories (browser) ----

export function whiteNoise(ctx, secs = 2, opts = {}) {
  const random = noiseSource(opts, "white", secs, ctx.sampleRate);
  const buf = ctx.createBuffer(1, (ctx.sampleRate * secs) | 0, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = random() * 2 - 1;
  return buf;
}

// Kellett 3-pole pink noise (from web/audio.js _makePink).
export function pinkNoise(ctx, secs = 3, opts = {}) {
  const random = noiseSource(opts, "pink", secs, ctx.sampleRate);
  const buf = ctx.createBuffer(1, (ctx.sampleRate * secs) | 0, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return buf;
}

// Synthesized reverb impulse (from web/audio.js _impulse). dark 0..1 = tail darkness.
// Seeded from its own parameters (see noiseSource) — the same decay/dark/stereo at
// the same sample rate always builds the same IR. `seed` picks a different room;
// `random` supplies the stream directly.
export function impulse(ctx, decay = 1.6, { dark = 0.6, stereo = true, seed = 0, random } = {}) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.max(0.05, decay)));
  const ch = stereo ? 2 : 1;
  const buf = ctx.createBuffer(ch, len, rate);
  const rnd = noiseSource({ seed, random }, "impulse", decay, dark, stereo, rate);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      lp = (rnd() * 2 - 1) * (1 - dark) + lp * dark;
      d[i] = lp * Math.pow(1 - i / len, 2.5);
    }
  }
  return buf;
}

// Synthesized SPRING-reverb impulse — the "lasery"/boing tail Ott puts on rimshots/snares
// (research/shpongle_technique.md §Ott). A spring's signature is DISPERSION: high frequencies
// travel through the coil faster than lows, so the onset is a downward "chirp" (a boing), with a
// bright, midrange-weighted, metallic/twangy color from the coil's resonant modes.
//   - dispersion: a swept-sine chirp from `chirpHi`→`chirpLo` over the first ~80 ms gives the boing.
//   - metallic color: a few inharmonic decaying partials (the coil modes) ring on top.
//   - body: bandpass-shaped noise centred in the mid (~`color` Hz) for the diffuse tail.
// All baked into a buffer so the ConvolverNode reproduces it identically offline (no WaveShaper,
// no live feedback — node-web-audio-api safe). color = mid centre Hz (brightness); decay = tail s.
// Seeding behaves as in impulse(): parameter-derived by default, `seed` for a
// different tank, `random` to supply the stream.
export function springImpulse(ctx, decay = 1.3, { color = 2000, stereo = true, seed = 0, random } = {}) {
  const rate = ctx.sampleRate;
  const len = Math.max(1, Math.floor(rate * Math.max(0.1, decay)));
  const ch = stereo ? 2 : 1;
  const buf = ctx.createBuffer(ch, len, rate);
  const rnd = noiseSource({ seed, random }, "spring", decay, color, stereo, rate);
  const twoPi = 2 * Math.PI;
  const chirpHi = Math.min(color * 2.2, rate * 0.42); // chirp starts bright …
  const chirpLo = color * 0.6;                         // … and dives to the low-mid (the "boing")
  const chirpDur = Math.min(0.09, decay * 0.5);        // dispersion window (~80 ms)
  // Inharmonic coil modes (metallic ring) — ratios spread off integer multiples so it's not pitched.
  const modes = [1.0, 1.83, 2.71, 3.46, 4.62];
  // State-variable bandpass coefficients for the noise body, resonant around `color` (mid-weighted,
  // metallic — NOT hissy). f maps the centre freq; q sets the resonance (narrow → ringy/twangy).
  const fSv = 2 * Math.sin(Math.PI * Math.min(color, rate * 0.45) / rate);
  const qSv = 1 / 3.5; // damping → moderately resonant band
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    const detune = c === 0 ? 1.0 : 1.014;              // L/R coil mistune → stereo spread
    const seed = c === 0 ? 0.0 : 0.5;                  // phase offset so channels decorrelate
    let svLp = 0, svBp = 0;                            // state-variable filter memory
    let chirpPhase = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const frac = i / len;
      const env = Math.pow(1 - frac, 2.2);             // exponential-ish tail
      // Dispersive chirp: instantaneous freq glides hi→lo across chirpDur (then holds at chirpLo).
      const cf = t < chirpDur ? chirpHi + (chirpLo - chirpHi) * (t / chirpDur) : chirpLo;
      chirpPhase += (twoPi * cf * detune) / rate;
      const chirpEnv = Math.exp(-t / (chirpDur * 1.6));
      let s = Math.sin(chirpPhase + seed) * chirpEnv * 0.7;
      // Metallic coil modes (decaying inharmonic partials).
      for (let m = 0; m < modes.length; m++) {
        const f = color * modes[m] * detune;
        const md = Math.exp(-t * (3 + m * 2.2));        // higher modes die faster
        s += Math.sin(twoPi * f * t + seed * (m + 1)) * md * (0.16 / (m + 1));
      }
      // Diffuse body: a resonant BANDPASS on noise, centred on `color` → mid-weighted metallic wash
      // (Chamberlin state-variable filter, bandpass tap) so the tail rings in the mid, not as hiss.
      const w = rnd() * 2 - 1;
      svLp += fSv * svBp;
      const hp = w - svLp - qSv * svBp;
      svBp += fSv * hp;
      s += svBp * 0.6;
      d[i] = s * env;
    }
    // Normalize per channel to keep the convolver send level predictable.
    let peak = 0;
    for (let i = 0; i < len; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; }
    if (peak > 0) { const g = 0.9 / peak; for (let i = 0; i < len; i++) d[i] *= g; }
  }
  return buf;
}

// ---- tiny radix-2 FFT (pure) for onset detection ----

export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1);
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// Hann-windowed magnitude spectrum of a pow2-length frame.
export function magnitude(frame) {
  const n = frame.length;
  const re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    re[i] = frame[i] * w;
  }
  fft(re, im);
  const mag = new Float32Array(n >> 1);
  for (let i = 0; i < n >> 1; i++) mag[i] = Math.hypot(re[i], im[i]);
  return mag;
}

export const nextPow2 = (x) => { let p = 1; while (p < x) p <<= 1; return p; };

// ---- granular pitch-shift control buffers (the shimmer-reverb octave-up feedback) ----
// Time-domain pitch shift via a linearly-ramped delay line: a delay whose time
// decreases at rate (ratio-1) reads the input ratio× faster → pitch up (and the reverse
// for pitch down). Two grains half a period apart, Hann-windowed — a Hann pair sums to
// exactly 1 — hide the ramp's reset discontinuity. These pure helpers build the control
// buffers; fx.js copies them into AudioBuffers and drives DelayNode.delayTime / gain.

export const pitchRatio = (semitones) => Math.pow(2, semitones / 12);

// Grain period (s): the delay sweeps the whole `window` exactly once per cycle, so the
// ramp slope is (ratio-1) — the rate the read head must drift to retune by `semitones`.
export function pitchPeriod(semitones, window = 0.1) {
  const k = Math.abs(pitchRatio(semitones) - 1);
  return k < 1e-4 ? window : window / k; // unison → no-op shifter
}

// Delay-time ramp over n samples: window→0 (descending) for up-shift, 0→window for
// down-shift. Monotonic and bounded to [0, window].
export function pitchRampSamples(n, window, up) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const frac = i / n;
    out[i] = up ? window * (1 - frac) : window * frac;
  }
  return out;
}

// Hann window over n samples: 0 at the seam, 1 at the centre; hann(i)+hann(i+n/2)=1.
export function hannSamples(n) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return out;
}
