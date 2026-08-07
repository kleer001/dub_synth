// dub_synth/master.js — the bounce-time mastering pass.
//
// Pure DSP over Float32Array channels: no audio context, no nodes, no library.
// That is the point. node-web-audio-api's DynamicsCompressor does not limit —
// it inflates the output to roughly a constant level whatever goes in — so any
// dynamics stage built from it measures as a lie offline and behaves differently
// in a browser. Computing the gain reduction here instead makes the result exact,
// identical every run, and testable without rendering anything.
//
// The targets are this repo's, from AUDIO_CHECKLIST.md:
//   true-peak   ≤ -1 dBFS        (inter-sample clipping)
//   clipped     0 samples
//   crest       ≥ 9 dB, healthy 9-13   — the "too hot" detector
//   "Mastering = glue, not a brickwall."
//
// So the defaults here are gentle: a slow bus compressor doing a couple of dB,
// then a look-ahead limiter that only catches what is left. If the limiter is
// working hard, the mix upstream is wrong — `report()` says so out loud rather
// than quietly squashing it.

const dB = (x) => 20 * Math.log10(Math.max(1e-12, x));
const fromDb = (d) => Math.pow(10, d / 20);

// Peak across all channels, oversampled 4x by linear interpolation so
// inter-sample overs are caught the way check_audio.mjs catches them.
export function truePeak(channels) {
  let tp = 0;
  for (const ch of channels) {
    for (let i = 1; i < ch.length; i++) {
      const a = ch[i - 1], b = ch[i];
      for (let k = 0; k < 4; k++) {
        const v = Math.abs(a + (b - a) * (k / 4));
        if (v > tp) tp = v;
      }
    }
  }
  return tp;
}

export function measure(channels) {
  const n = channels[0].length;
  let peak = 0, sumSq = 0, clipped = 0;
  for (let i = 0; i < n; i++) {
    let frame = 0;
    for (const ch of channels) {
      const a = Math.abs(ch[i]);
      if (a > frame) frame = a;
      sumSq += ch[i] * ch[i];
    }
    if (frame > peak) peak = frame;
    if (frame >= 0.997) clipped++;
  }
  const rms = Math.sqrt(sumSq / (n * channels.length));
  return { peak, peakDb: dB(peak), rms, rmsDb: dB(rms), crest: dB(peak) - dB(rms), clipped };
}

// A feedforward bus compressor. One detector across all channels so the stereo
// image cannot be pulled apart by unequal gain reduction. Soft knee, RMS-ish
// detection via a one-pole on the rectified sum.
export function glue(channels, {
  sampleRate = 48000,
  thresholdDb = -11,
  ratio = 1.8,
  kneeDb = 6,
  attackMs = 30,
  releaseMs = 250,
  makeupDb = null,   // null = auto, so the stage is level-neutral by design
} = {}) {
  const n = channels[0].length;
  const aAtt = Math.exp(-1 / (sampleRate * attackMs / 1000));
  const aRel = Math.exp(-1 / (sampleRate * releaseMs / 1000));

  // Gain computer in dB, with a quadratic knee.
  const computeDb = (levelDb) => {
    const over = levelDb - thresholdDb;
    if (over <= -kneeDb / 2) return 0;
    if (over >= kneeDb / 2) return over - over / ratio;
    const x = over + kneeDb / 2;
    return (1 - 1 / ratio) * (x * x) / (2 * kneeDb);
  };

  let env = 0, gr = 0, maxGr = 0, sumGr = 0;
  const reduction = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of channels) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
    // Envelope follower on the detector signal.
    env = peak > env ? peak : env * aRel + peak * (1 - aRel);
    const target = computeDb(dB(env));
    // Attack is fast onto more reduction, release is slow off it.
    gr = target > gr ? gr * aAtt + target * (1 - aAtt) : gr * aRel + target * (1 - aRel);
    reduction[i] = gr;
    if (gr > maxGr) maxGr = gr;
    sumGr += gr;
  }

  const makeup = makeupDb === null ? maxGr * 0.5 : makeupDb;
  const makeupLin = fromDb(makeup);
  for (const ch of channels) {
    for (let i = 0; i < n; i++) ch[i] *= fromDb(-reduction[i]) * makeupLin;
  }
  return { maxReductionDb: maxGr, avgReductionDb: sumGr / n, makeupDb: makeup };
}

// A look-ahead brickwall limiter. The gain envelope is computed first, then
// smoothed backwards over the look-ahead window so the gain is already down
// before the transient arrives — which is what stops a limiter from clicking.
export function limit(channels, {
  sampleRate = 48000,
  ceilingDb = -1,
  lookaheadMs = 5,
  releaseMs = 60,
} = {}) {
  const n = channels[0].length;
  const ceiling = fromDb(ceilingDb);
  const look = Math.max(1, Math.round(sampleRate * lookaheadMs / 1000));
  const relCoef = Math.exp(-1 / (sampleRate * releaseMs / 1000));

  // Required gain per sample, ≤ 1.
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (const ch of channels) { const a = Math.abs(ch[i]); if (a > peak) peak = a; }
    need[i] = peak > ceiling ? ceiling / peak : 1;
  }

  // Backwards minimum over the look-ahead window: the gain dips ahead of the peak.
  const env = new Float32Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let m = need[i];
    const end = Math.min(n - 1, i + look);
    for (let j = i + 1; j <= end; j++) if (need[j] < m) m = need[j];
    env[i] = m;
  }

  // Forward release smoothing, so recovery is gradual but attack stays instant.
  let g = 1, minG = 1;
  for (let i = 0; i < n; i++) {
    g = env[i] < g ? env[i] : g * relCoef + env[i] * (1 - relCoef);
    if (g < minG) minG = g;
    for (const ch of channels) ch[i] *= g;
  }

  // The look-ahead smoothing can still leave a hair over the ceiling; a final
  // hard clamp guarantees the file cannot clip.
  let clamped = 0;
  for (const ch of channels) {
    for (let i = 0; i < n; i++) {
      if (ch[i] > ceiling) { ch[i] = ceiling; clamped++; }
      else if (ch[i] < -ceiling) { ch[i] = -ceiling; clamped++; }
    }
  }
  return { maxReductionDb: -dB(minG), clamped };
}

// Peak-normalise. Used to level-match takes before an A/B so "louder" cannot
// masquerade as "better" (AUDIO_CHECKLIST.md §5).
export function normalize(channels, targetDb = -1) {
  const target = fromDb(targetDb);
  const { peak } = measure(channels);
  if (peak === 0) return 1;
  const g = target / peak;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  return g;
}

// The whole pass, and a verdict. `verdict` names what is wrong with the MIX,
// not with the master — if the limiter had to work hard or the crest collapsed,
// the answer is upstream gain staging, not more processing here.
export function masterChain(channels, {
  sampleRate = 48000,
  glue: glueOpts = {},
  limit: limitOpts = {},
  skipGlue = false,
} = {}) {
  const before = measure(channels);
  const g = skipGlue ? { maxReductionDb: 0, avgReductionDb: 0, makeupDb: 0 } : glue(channels, { sampleRate, ...glueOpts });
  const l = limit(channels, { sampleRate, ...limitOpts });
  const after = measure(channels);
  const tp = truePeak(channels);

  const notes = [];
  if (l.maxReductionDb > 6) notes.push(`limiter pulled ${l.maxReductionDb.toFixed(1)} dB — the mix is too hot before the master, lower the trim`);
  if (g.maxReductionDb > 5) notes.push(`glue pulled ${g.maxReductionDb.toFixed(1)} dB — that is compression doing the mixing, raise its threshold`);
  if (after.peakDb < -3) notes.push(`peak ${after.peakDb.toFixed(1)} dBFS is quiet — raise DUB_RIG.master (re-run --headroom)`);
  if (after.crest < 9) notes.push(`crest ${after.crest.toFixed(1)} dB is below the 9 dB floor — this will read as slammed`);
  if (after.clipped > 0) notes.push(`${after.clipped} clipped samples survived the limiter`);
  if (dB(tp) > -1 + 0.01) notes.push(`true peak ${dB(tp).toFixed(2)} dBFS is above the -1 dBFS ceiling`);

  return { before, after, truePeakDb: dB(tp), glue: g, limit: l, ok: notes.length === 0, notes };
}
