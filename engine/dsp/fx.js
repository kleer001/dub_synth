// dub_synth/dsp/fx.js — the full effect-builder library, carried over from the
// parent cyber_synth engine so this repo stands alone once it is split out.
//
// This is a deliberate copy, not an abstraction: dub_synth takes core/ and its FX
// vocabulary with it and leaves the parent's composition machinery behind, so the
// two files are free to diverge from here. The three AudioWorklet files it loads
// (phase-vocoder, ladder, bitcrush) sit alongside it for the same reason.
//
// Everything degrades to native nodes when no worklet is available, which is what
// keeps the offline-render requirement satisfied: an OfflineAudioContext has no
// audioWorklet, so the granular pitch shifter, the 2-pole biquad, and the
// waveshaper bitcrush are what actually render.
//
// cyber/fx.js — effect builders + the sidechain. Each builder returns a graph
// fragment { input, output, set(params), ... } the engine wires into its FX chain.
// Pure Web Audio, no libraries. Mirrors web/audio.js idioms: exponential ramps with
// a 0.0001 floor, convolver reverb on a send, parallel saturation bus, _ramp-style
// setTargetAtTime automation.
//
// Web-Audio trade-offs are commented inline. Shimmer reverb uses a hand-rolled pitch
// shifter (makePitchShifter — a granular delay-line shifter built from native nodes),
// so the octave-up shimmer is an actual pitch shift rather than an EQ brightness trick.

import { satCurve, clipCurve, foldCurve, bitCurve, diodeCurve, impulse, springImpulse, pitchPeriod, pitchRampSamples, hannSamples } from "../core/dsp.js";

const FLOOR = 0.0001;
const ramp = (param, to, tc, ctx) => param.setTargetAtTime(to, ctx.currentTime, Math.max(0.001, tc) / 3);

// Click-free topology change: dip a wet send to silence, run the (dis/re)connect under
// cover, then restore to the target level. Disconnecting a live node clicks; this masks
// it. Shared by every FX that rewires a feedback graph (reverb mode, delay ping-pong).
function dipAndRewire(wet, ctx, restore, rewireFn) {
  wet.gain.cancelScheduledValues(ctx.currentTime);
  ramp(wet.gain, FLOOR, 0.004, ctx);
  setTimeout(() => { rewireFn(); ramp(wet.gain, restore, 0.012, ctx); }, 15);
}

// ---- Sidechain pump ----------------------------------------------------------

// A GainNode the pumped buses route through. `trigger(t, depth, release)` writes a
// ducking envelope: drop to (1-depth) at the kick, recover via setTargetAtTime over
// ~release. The engine calls trigger() on every kick step — the four-on-the-floor
// breathing signature (spec §5).
export function makeSidechain(ctx) {
  const gain = ctx.createGain();
  gain.gain.value = 1;
  return {
    input: gain,
    output: gain,
    node: gain,
    trigger(t, depth = 0.7, release = 0.18) {
      const d = Math.max(0, Math.min(1, depth));
      const floor = Math.max(FLOOR, 1 - d);
      // Cancel any in-flight recovery, slam down at the kick, ease back up.
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(floor, t);
      gain.gain.setTargetAtTime(1, t + 0.005, Math.max(0.01, release) / 3);
    },
  };
}

// ---- Pump (ghost-trigger volume duck — the deadmau5/LFOTool move) -------------

// A GainNode the pumped buses route through, ducked on a GRID independent of the audible kick
// (vs makeSidechain which keys off the kick). `trigger(t, depth, release, curve)` slams to
// (1-depth) then recovers — exp (the classic compressor-ish curve) or lin (a more "drawn",
// LFOTool-flat ramp). The engine fires it every `pump.sync` 16ths, so the bass "breathes" on a
// fixed 1/8 (or 1/4) cycle even with no kick there — the signature deadmau5 pump.
export function makePump(ctx) {
  const gain = ctx.createGain();
  gain.gain.value = 1;
  return {
    input: gain,
    output: gain,
    node: gain,
    trigger(t, depth = 0.7, release = 0.18, curve = "exp") {
      const d = Math.max(0, Math.min(1, depth));
      const floor = Math.max(FLOOR, 1 - d);
      gain.gain.cancelScheduledValues(t);
      gain.gain.setValueAtTime(floor, t);
      if (curve === "lin") gain.gain.linearRampToValueAtTime(1, t + Math.max(0.01, release));
      else gain.gain.setTargetAtTime(1, t + 0.005, Math.max(0.01, release) / 3);
    },
    reset(t) { gain.gain.cancelScheduledValues(t); gain.gain.setTargetAtTime(1, t, 0.02); },
  };
}

// ---- Delay (tempo-synced, filtered feedback, ping-pong) ----------------------

// time16 = delay time in 16th-note steps; the engine pushes sps (seconds per 16th)
// via set({sps}). Feedback runs through a lowpass (darkening dub repeats). Ping-pong
// cross-feeds two L/R delays. `throw(t, amount, beats)` spikes the wet send.
export function makeDelay(ctx) {
  const input = ctx.createGain();
  const wet = ctx.createGain(); wet.gain.value = 0.16;
  const output = ctx.createGain();

  // Two delays (L/R) for ping-pong; merge to stereo.
  const dL = ctx.createDelay(2.0);
  const dR = ctx.createDelay(2.0);
  const fbL = ctx.createGain(); fbL.gain.value = 0.34;
  const fbR = ctx.createGain(); fbR.gain.value = 0.34;
  const lpL = ctx.createBiquadFilter(); lpL.type = "lowpass"; lpL.frequency.value = 3800;
  const lpR = ctx.createBiquadFilter(); lpR.type = "lowpass"; lpR.frequency.value = 3800;
  const panL = ctx.createStereoPanner(); panL.pan.value = -0.8;
  const panR = ctx.createStereoPanner(); panR.pan.value = 0.8;

  // Dub character: a saturation crossfade in each feedback path — a dry/wet blend so sat 0 is
  // transparent (existing genres unchanged). node-web-audio-api forbids reassigning a WaveShaper
  // curve, so we crossfade into a FIXED tanh shaper rather than rebuild the curve on set().
  const mkSat = () => ({
    dry: Object.assign(ctx.createGain(), {}), wet: Object.assign(ctx.createGain(), {}),
    shaper: (() => { const s = ctx.createWaveShaper(); s.curve = satCurve(0.8); s.oversample = "4x"; return s; })(),
    sum: ctx.createGain(),
  });
  const stL = mkSat(), stR = mkSat();
  stL.dry.gain.value = stR.dry.gain.value = 1; stL.wet.gain.value = stR.wet.gain.value = 0;
  // Tape wow: a slow LFO on both delay times. `drift` (seconds) sets depth; 0 = none.
  const wow = ctx.createOscillator(); wow.type = "sine"; wow.frequency.value = 0.3;
  const wowD = ctx.createGain(); wowD.gain.value = 0;
  wow.connect(wowD); wowD.connect(dL.delayTime); wowD.connect(dR.delayTime);
  try { wow.start(); } catch (_) {}

  let pingpong = true;
  let sps = 60 / 128 / 4;
  let time16 = 3;
  let synced = true;   // false → use freeSec (a fixed, non-tempo-locked delay time)
  let freeSec = 0.3;

  function rewire() {
    // Disconnect feedback returns then rebuild per the ping-pong toggle.
    try {
      lpL.disconnect(); lpR.disconnect(); fbL.disconnect(); fbR.disconnect();
      for (const st of [stL, stR]) { st.dry.disconnect(); st.wet.disconnect(); st.shaper.disconnect(); st.sum.disconnect(); }
    } catch (_) {}
    input.connect(dL);
    if (pingpong) input.connect(dR);
    // dL → lp → saturation crossfade → fb; cross-feed to the opposite delay for ping-pong, else self-feed.
    dL.connect(lpL); lpL.connect(stL.dry).connect(stL.sum); lpL.connect(stL.wet).connect(stL.shaper).connect(stL.sum); stL.sum.connect(fbL);
    dR.connect(lpR); lpR.connect(stR.dry).connect(stR.sum); lpR.connect(stR.wet).connect(stR.shaper).connect(stR.sum); stR.sum.connect(fbR);
    fbL.connect(pingpong ? dR : dL);
    fbR.connect(pingpong ? dL : dR);
    // Wet taps → pan → wet → output.
    dL.connect(panL).connect(wet);
    dR.connect(panR).connect(wet);
    wet.connect(output);
  }
  function applyTime() {
    const t = Math.max(0.001, synced ? time16 * sps : freeSec);
    dL.delayTime.setTargetAtTime(t, ctx.currentTime, 0.02);
    dR.delayTime.setTargetAtTime(t, ctx.currentTime, 0.02);
  }
  rewire(); applyTime();

  return {
    input, output, wet, fbL, fbR, // fbL/fbR exposed as modulation destinations
    set(p = {}) {
      if (p.sync !== undefined) synced = p.sync;
      if (p.timeMs !== undefined) freeSec = Math.max(0.001, p.timeMs / 1000);
      if (p.sps !== undefined) { sps = p.sps; applyTime(); }
      if (p.time16 !== undefined) { time16 = p.time16; applyTime(); }
      if (p.sync !== undefined || p.timeMs !== undefined) applyTime();
      if (p.feedback !== undefined) {
        const f = Math.min(0.95, p.feedback); // < unity (controlled feedback, fx doc §5)
        ramp(fbL.gain, f, 0.05, ctx); ramp(fbR.gain, f, 0.05, ctx);
      }
      if (p.lpf !== undefined) { ramp(lpL.frequency, p.lpf, 0.05, ctx); ramp(lpR.frequency, p.lpf, 0.05, ctx); }
      if (p.sat !== undefined) { const s = Math.max(0, Math.min(1, p.sat)); for (const st of [stL, stR]) { ramp(st.wet.gain, s, 0.05, ctx); ramp(st.dry.gain, 1 - s, 0.05, ctx); } }
      if (p.drift !== undefined) ramp(wowD.gain, Math.max(0, p.drift), 0.1, ctx);
      if (p.mix !== undefined) ramp(wet.gain, p.mix, 0.08, ctx);
      if (p.pingpong !== undefined && p.pingpong !== pingpong) {
        pingpong = p.pingpong;
        const restore = p.mix !== undefined ? p.mix : wet.gain.value;
        dipAndRewire(wet, ctx, restore, () => { rewire(); applyTime(); });
      }
    },
    // Dub "throw": spike the wet send for `beats` quarter-notes, then release.
    throw(t, amount = 0.6, beats = 1) {
      const back = wet.gain.value;
      wet.gain.cancelScheduledValues(t);
      wet.gain.setValueAtTime(Math.max(FLOOR, amount), t);
      wet.gain.setTargetAtTime(back, t + beats * sps * 4, (beats * sps * 4) / 3);
    },
  };
}

// ---- Real-time pitch shifter (granular delay-line / "varispeed") -------------

// A genuine pitch shifter on a LIVE signal, built entirely from native nodes — no
// AudioWorklet, no library. Two DelayNodes whose delayTime ramps linearly (descending =
// the read head drifts forward = pitch UP) are Hann-crossfaded; the window pair sums to
// exactly 1, so each ramp's reset jump lands where that grain's gain is 0 and is masked.
// Its main artifact is a granular warble at the grain period — which happens to be the
// lush, slightly-detuned texture a shimmer wants. Rebuild to change pitch.
export function makePitchShifter(ctx, { semitones = 12, window = 0.1 } = {}) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const up = semitones >= 0;
  const period = pitchPeriod(semitones, window);
  const n = Math.max(1, Math.round(period * ctx.sampleRate));

  const rampBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  rampBuf.getChannelData(0).set(pitchRampSamples(n, window, up));
  const fadeBuf = ctx.createBuffer(1, n, ctx.sampleRate);
  fadeBuf.getChannelData(0).set(hannSamples(n));

  const srcs = [];
  // Two grains, half a period out of phase, summed into output.
  for (const offset of [0, period / 2]) {
    const delay = ctx.createDelay(window + 0.05);
    delay.delayTime.value = 0; // the mod source supplies the (additive) delay time
    const g = ctx.createGain();
    g.gain.value = 0; // the fade source supplies the (additive) 0..1 window
    const mod = ctx.createBufferSource(); mod.buffer = rampBuf; mod.loop = true;
    const fad = ctx.createBufferSource(); fad.buffer = fadeBuf; fad.loop = true;
    mod.connect(delay.delayTime);
    fad.connect(g.gain);
    input.connect(delay).connect(g).connect(output);
    const t0 = ctx.currentTime + 0.03 + offset;
    mod.start(t0); fad.start(t0);
    srcs.push(mod, fad);
  }
  return {
    input,
    output,
    kind: "granular",
    setSemitones() {}, // granular shifter is built fixed; rebuild for a new interval
    dispose() { for (const s of srcs) { try { s.stop(); } catch (_) {} } },
  };
}

// The phase-vocoder AudioWorklet (cyber/phase-vocoder-worklet.js) — higher fidelity than
// the granular shifter. Loaded once per context; pitchWorkletReady() reports success so
// makeBestPitchShifter can pick the worklet synchronously afterwards.
// Build a once-per-context AudioWorklet module loader as a { load(ctx), ready() } pair,
// so the phase-vocoder and ladder loaders aren't copy-pasted singletons.
function makeWorkletLoader(file, warn) {
  let ready = false, tried = false;
  return {
    async load(ctx) {
      if (ready) return true;
      if (tried) return ready;
      tried = true;
      if (!ctx || !ctx.audioWorklet) return false;
      try { await ctx.audioWorklet.addModule(new URL(file, import.meta.url)); ready = true; }
      catch (e) { console.warn(warn, e?.message || e); }
      return ready;
    },
    ready: () => ready,
  };
}

const _pvLoader = makeWorkletLoader("./phase-vocoder-worklet.js", "[fx] phase-vocoder worklet unavailable; using the granular shifter:");
export const loadPitchWorklet = (ctx) => _pvLoader.load(ctx);
export const pitchWorkletReady = () => _pvLoader.ready();

// Best available real-time pitch shifter: the phase-vocoder worklet if loaded (clean, and
// the interval can be swept live via setSemitones), else the granular delay-line shifter.
export function makeBestPitchShifter(ctx, { semitones = 12 } = {}) {
  if (_pvLoader.ready()) {
    try {
      const node = new AudioWorkletNode(ctx, "phase-vocoder", {
        processorOptions: { fftFrameSize: 2048, osamp: 8 },
        channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
      });
      const input = ctx.createGain();
      const output = ctx.createGain();
      input.connect(node).connect(output);
      const pitch = node.parameters.get("pitch");
      pitch.setValueAtTime(Math.pow(2, semitones / 12), ctx.currentTime);
      return {
        input, output, kind: "phasevocoder",
        setSemitones(s) { pitch.setTargetAtTime(Math.pow(2, s / 12), ctx.currentTime, 0.04); },
        dispose() { try { node.disconnect(); } catch (_) {} },
      };
    } catch (e) {
      console.warn("[fx] phase-vocoder node failed; granular fallback:", e?.message || e);
    }
  }
  return makePitchShifter(ctx, { semitones });
}

// ---- Ladder filter (analog 4-pole) -------------------------------------------

// The moog-ladder AudioWorklet (cyber/ladder-worklet.js) — a nonlinear 24 dB/oct
// resonant lowpass, the analog character a 2-pole BiquadFilter can't give. Loaded once
// per context; makeFilter() returns it, or a BiquadFilter handle as the fallback.
const _ladderLoader = makeWorkletLoader("./ladder-worklet.js", "[fx] ladder worklet unavailable; using a 2-pole biquad:");
export const loadLadderWorklet = (ctx) => _ladderLoader.load(ctx);
export const ladderWorkletReady = () => _ladderLoader.ready();

// A resonant-lowpass handle { in, out, cutoff, resonance, dispose } with a UNIFORM
// interface: the 4-pole ladder worklet if loaded, else a BiquadFilter. `resonance` is the
// engine's biquad-style Q number; the ladder maps it into its own feedback range.
// `cutoff`/`resonance` are AudioParams the caller automates (the per-note 303 sweep).
export function makeFilter(ctx, { cutoff = 1000, resonance = 8, drive = 1.2 } = {}) {
  if (_ladderLoader.ready()) {
    try {
      const node = new AudioWorkletNode(ctx, "moog-ladder", { channelCount: 1, channelCountMode: "explicit" });
      const cut = node.parameters.get("cutoff");
      const res = node.parameters.get("resonance");
      cut.value = Math.max(20, Math.min(18000, cutoff));
      res.value = Math.max(0, Math.min(1.22, resonance / 16)); // Q≈8→0.5, Q≈16→1.0 (near self-osc)
      node.parameters.get("drive").value = drive;
      // The ladder model has a drooping passband (~ -7 dB); makeup gain so swapping it in
      // for the biquad doesn't drop the level.
      const makeup = ctx.createGain();
      makeup.gain.value = 1.7;
      node.connect(makeup);
      // Teardown: tell the processor to retire (return false) so it stops running on the
      // audio thread, THEN disconnect. Disconnect alone leaves the worklet processing.
      return { in: node, out: makeup, cutoff: cut, resonance: res, dispose() { try { node.port.postMessage(0); node.disconnect(); makeup.disconnect(); } catch (_) {} } };
    } catch (e) {
      console.warn("[fx] ladder node failed; biquad fallback:", e?.message || e);
    }
  }
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cutoff;
  lp.Q.value = resonance;
  return { in: lp, out: lp, cutoff: lp.frequency, resonance: lp.Q, dispose() {} };
}

// ---- Mastering EQ (per-genre pocket) -----------------------------------------

// 5-band mastering EQ: low-cut → low shelf → low-mid bell → high-mid bell → high shelf.
// `set(eqConfig)` ramps the bands; `on:false` flattens the bells/shelves and opens the
// low-cut for a clean bypass. A handle with .set(), like the rest of the FX.
export function makeEq(ctx) {
  const lowCut = ctx.createBiquadFilter(); lowCut.type = "highpass";
  const lowShelf = ctx.createBiquadFilter(); lowShelf.type = "lowshelf";
  const lowMid = ctx.createBiquadFilter(); lowMid.type = "peaking";
  const highMid = ctx.createBiquadFilter(); highMid.type = "peaking";
  const highShelf = ctx.createBiquadFilter(); highShelf.type = "highshelf";
  lowCut.connect(lowShelf).connect(lowMid).connect(highMid).connect(highShelf);
  const r = (param, v) => param.setTargetAtTime(v, ctx.currentTime, 0.08);
  const shelf = (node, b, on) => { r(node.frequency, b.freq); r(node.gain, on ? b.gain : 0); };
  const bell = (node, b, on) => { r(node.frequency, b.freq); r(node.Q, b.q); r(node.gain, on ? b.gain : 0); };
  return {
    input: lowCut, output: highShelf,
    set(e = {}) {
      const on = e.on !== false;
      r(lowCut.frequency, on ? e.lowCut : 10);
      shelf(lowShelf, e.lowShelf, on);
      bell(lowMid, e.lowMid, on);
      bell(highMid, e.highMid, on);
      shelf(highShelf, e.highShelf, on);
    },
  };
}

// Per-channel parametric EQ for a mixer strip: a 4-pole (two cascaded biquads, 24 dB/oct,
// Butterworth Q-pair → flat passband) HIGH-PASS + N fully-parametric peaking BELLS (addressable
// freq/gain/Q) + a HIGH-SHELF for air. Defaults are transparent (HPF parked at 10 Hz, all gains 0)
// so inserting it changes nothing until the mix — or the FFT balancer — dials a cut in. Subtractive
// EQ in the context of the mix; see docs/AUDIO_MCP.md (Web Audio = RBJ-cookbook biquads).
export function makeChannelEq(ctx, nBands = 3) {
  const hp1 = ctx.createBiquadFilter(); hp1.type = "highpass"; hp1.Q.value = 0.5412; // Butterworth-4
  const hp2 = ctx.createBiquadFilter(); hp2.type = "highpass"; hp2.Q.value = 1.3066; // (the pair sums flat)
  const bells = []; for (let i = 0; i < nBands; i++) { const b = ctx.createBiquadFilter(); b.type = "peaking"; bells.push(b); }
  const hs = ctx.createBiquadFilter(); hs.type = "highshelf";
  let node = hp1.connect(hp2);                    // connect() returns its destination
  for (const b of bells) node = node.connect(b);
  node.connect(hs);
  const r = (param, v) => param.setTargetAtTime(v, ctx.currentTime, 0.08);
  return {
    input: hp1, output: hs, bandCount: nBands,
    set(e = {}) {
      const on = e.on !== false;
      const hpFreq = (on && e.hp && e.hp.on !== false) ? e.hp.freq : 10; // 10 Hz = inaudible no-op
      r(hp1.frequency, hpFreq); r(hp2.frequency, hpFreq);
      const cfg = e.bands || [];
      for (let i = 0; i < bells.length; i++) {
        const b = cfg[i] || { freq: 1000, gain: 0, q: 1 };
        r(bells[i].frequency, b.freq); r(bells[i].Q, b.q ?? 1); r(bells[i].gain, on ? (b.gain || 0) : 0);
      }
      const sh = e.hs || { freq: 8000, gain: 0 };
      r(hs.frequency, sh.freq); r(hs.gain, on ? (sh.gain || 0) : 0);
    },
  };
}

// ---- Multiband compressor (master glue) --------------------------------------

// Split the master into 3 bands (low/mid/high) with Linkwitz-Riley-4 crossovers (two
// cascaded Butterworth biquads per edge, so the bands sum flat), compress each band
// independently with a DynamicsCompressorNode, then recombine. Per-band compression is
// the genre "glue" a single full-band compressor can't give — it tames the kick/sub
// without pumping the hats, etc. `set({ on })` cross-fades a clean bypass.
export function makeMultiband(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1; // bypass path (on:false)
  const wet = ctx.createGain(); wet.gain.value = 0;
  input.connect(dry).connect(output);
  wet.connect(output);

  // LR4 edge = two cascaded Butterworth (Q=0.707) biquads of the same type.
  const edge = (type, freq) => {
    const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter();
    a.type = b.type = type;
    a.frequency.value = b.frequency.value = freq;
    a.Q.value = b.Q.value = 0.7071;
    a.connect(b);
    return { in: a, out: b, freqs: [a.frequency, b.frequency] };
  };
  const band = () => {
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 6;
    const g = ctx.createGain();
    comp.connect(g).connect(wet);
    return { comp, g };
  };

  const low = band(), mid = band(), high = band();
  const lowLP = edge("lowpass", 250);
  const midHP = edge("highpass", 250), midLP = edge("lowpass", 3000);
  const highHP = edge("highpass", 3000);
  input.connect(lowLP.in); lowLP.out.connect(low.comp);
  input.connect(midHP.in); midHP.out.connect(midLP.in); midLP.out.connect(mid.comp);
  input.connect(highHP.in); highHP.out.connect(high.comp);

  const ramp = (param, v) => param.setTargetAtTime(v, ctx.currentTime, 0.06);
  const setBand = (b, p) => {
    if (!p) return;
    if (p.threshold !== undefined) ramp(b.comp.threshold, p.threshold);
    if (p.ratio !== undefined) ramp(b.comp.ratio, p.ratio);
    if (p.attack !== undefined) ramp(b.comp.attack, p.attack);
    if (p.release !== undefined) ramp(b.comp.release, p.release);
    if (p.gain !== undefined) ramp(b.g.gain, Math.pow(10, p.gain / 20)); // dB → linear makeup
  };

  return {
    input, output,
    set(p = {}) {
      if (p.on !== undefined) { ramp(wet.gain, p.on ? 1 : 0); ramp(dry.gain, p.on ? 0 : 1); }
      if (p.xoverLow !== undefined) { ramp(lowLP.freqs[0], p.xoverLow); ramp(lowLP.freqs[1], p.xoverLow); ramp(midHP.freqs[0], p.xoverLow); ramp(midHP.freqs[1], p.xoverLow); }
      if (p.xoverHigh !== undefined) { ramp(midLP.freqs[0], p.xoverHigh); ramp(midLP.freqs[1], p.xoverHigh); ramp(highHP.freqs[0], p.xoverHigh); ramp(highHP.freqs[1], p.xoverHigh); }
      setBand(low, p.low); setBand(mid, p.mid); setBand(high, p.high);
    },
  };
}

// ---- Reverb (convolver + switchable modes) -----------------------------------

// A ConvolverNode (core impulse()) with modes:
//  - "ducked":  wet ducked by the sidechain (engine routes wet through a duck gain).
//  - "shimmer": TRUE octave-up feedback — the wet tail runs through makePitchShifter
//               (+12 st) and a high-shelf lift, then back into the convolver: a real
//               rising sheen that re-pitches on every pass (the classic shimmer).
//  - "gated":   the wet is gated by a fast env on hits (engine calls gate()).
//  - "freeze":  hold the tail by sustaining the wet return (engine calls freeze()).
//  - "reverse": uses a reversed impulse so the wash swells INTO the hit.
//  - "spring":  a SYNTHESIZED dispersive spring impulse (core/dsp.js springImpulse) — the
//               chirpy "boing", bright/metallic, midrange-weighted tail Ott puts on rimshots/
//               snares (research/shpongle_technique.md §Ott). `springColor` sets the mid centre Hz.
export function makeReverb(ctx) {
  const input = ctx.createGain();   // sends arrive here
  const pre = ctx.createDelay(0.2); // pre-delay keeps transients clear
  pre.delayTime.value = 0.012;
  const conv = ctx.createConvolver();
  let decay = 1.8;
  conv.buffer = impulse(ctx, decay, { dark: 0.6, stereo: true });
  const wet = ctx.createGain(); wet.gain.value = 0.22;
  const duck = ctx.createGain(); duck.gain.value = 1; // sidechain-driven in "ducked"
  const output = ctx.createGain();

  // Shimmer feedback loop: tail → +12st pitch shifter → brighten → feed back.
  const shimFb = ctx.createGain(); shimFb.gain.value = 0;
  const shimShelf = ctx.createBiquadFilter();
  shimShelf.type = "highshelf"; shimShelf.frequency.value = 1800; shimShelf.gain.value = 6;
  let shifter = null; // lazily built on first shimmer use (its sources can't restart)

  let mode = "ducked";
  let springColor = 2000; // spring-mode mid centre Hz (brightness/metallic color)

  function rebuildImpulse(reverse) {
    const buf = mode === "spring"
      ? springImpulse(ctx, decay, { color: springColor, stereo: true })
      : impulse(ctx, decay, { dark: mode === "shimmer" ? 0.4 : 0.6, stereo: true });
    if (reverse) {
      for (let c = 0; c < buf.numberOfChannels; c++) buf.getChannelData(c).reverse();
    }
    conv.buffer = buf;
  }
  function wire() {
    try { conv.disconnect(); wet.disconnect(); duck.disconnect(); shimFb.disconnect(); shimShelf.disconnect(); if (shifter) shifter.output.disconnect(); } catch (_) {}
    input.connect(pre).connect(conv);
    conv.connect(wet).connect(duck).connect(output);
    if (mode === "shimmer") {
      // Tail → REAL +12st pitch shift → brighten → back into the convolver. Each pass
      // re-pitches an octave up, so the sheen rises — a genuine shimmer, not a fake.
      if (!shifter) shifter = makeBestPitchShifter(ctx, { semitones: 12 });
      conv.connect(shifter.input);
      shifter.output.connect(shimShelf).connect(shimFb).connect(conv);
    }
  }
  wire();

  return {
    input, output, duck, wet, // wet exposed as a modulation destination
    set(p = {}) {
      let needWire = false, needImpulse = false, reverse = mode === "reverse";
      if (p.decay !== undefined && p.decay !== decay) { decay = p.decay; needImpulse = true; }
      if (p.springColor !== undefined && p.springColor !== springColor) {
        springColor = p.springColor;
        if (mode === "spring") needImpulse = true; // color only affects the spring IR
      }
      if (p.mode !== undefined && p.mode !== mode) {
        mode = p.mode; needWire = true; needImpulse = true; reverse = mode === "reverse";
        shimFb.gain.value = mode === "shimmer" ? 0.45 : 0;
      }
      if (p.shimmer !== undefined) ramp(shimFb.gain, mode === "shimmer" ? p.shimmer : 0, 0.1, ctx);
      if (p.preDelay !== undefined) pre.delayTime.setTargetAtTime(p.preDelay, ctx.currentTime, 0.02);
      if (needWire) {
        // Rewire the convolver/shimmer-feedback under cover of a wet-send dip (engine
        // quantizes this to a downbeat too, but the dip protects any non-quantized call).
        const restore = p.mix !== undefined ? p.mix : wet.gain.value;
        dipAndRewire(wet, ctx, restore, () => { if (needImpulse) rebuildImpulse(reverse); wire(); });
      } else {
        if (p.mix !== undefined) ramp(wet.gain, p.mix, 0.1, ctx);
        if (needImpulse) rebuildImpulse(reverse);
      }
    },
    // "gated": clamp the wet with a fast env on a hit.
    gate(t, openMs = 90) {
      duck.gain.cancelScheduledValues(t);
      duck.gain.setValueAtTime(1, t);
      duck.gain.setTargetAtTime(FLOOR, t + openMs / 1000, 0.02);
    },
    // "freeze": hold the current wet return up (drone the tail).
    freeze(on, t = ctx.currentTime) {
      ramp(wet.gain, on ? Math.max(0.4, wet.gain.value) : 0.22, 0.2, ctx);
      // a high shimmer feedback also keeps the tail alive
      ramp(shimFb.gain, on ? 0.7 : (mode === "shimmer" ? 0.45 : 0), 0.2, ctx);
    },
    get mode() { return mode; },
  };
}

// ---- Drive / saturation ------------------------------------------------------

// WaveShaper (sat/clip) + tone lowpass + makeup gain. The parallel-grit core.
export function makeDrive(ctx) {
  const input = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = satCurve(0.001); shaper.oversample = "4x"; // anti-alias the saturation harmonics
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 6500;
  const makeup = ctx.createGain(); makeup.gain.value = 0.7;
  const output = ctx.createGain();
  input.connect(shaper).connect(tone).connect(makeup).connect(output);
  // mode: "tanh" (symmetric, odd harmonics) | "clip" (hard) | "diode" (asymmetric, +even
  // harmonics, warmer). The curve is rebuilt when mode OR amount changes.
  let mode = "tanh", amt = 0.001;
  const curveFor = () =>
    mode === "clip" ? clipCurve(1 + amt * 6)
    : mode === "diode" ? diodeCurve(Math.max(0.001, amt))
    : satCurve(Math.max(0.001, amt));
  return {
    input, output,
    set(p = {}) {
      const wasMode = mode, wasAmt = amt;
      if (p.mode !== undefined) mode = p.mode;
      if (p.kind !== undefined) mode = p.kind; // back-compat alias
      if (p.amount !== undefined) amt = p.amount;
      if (mode !== wasMode || amt !== wasAmt) shaper.curve = curveFor();
      if (p.tone !== undefined) ramp(tone.frequency, p.tone, 0.05, ctx);
      if (p.makeup !== undefined) ramp(makeup.gain, p.makeup, 0.05, ctx);
    },
  };
}

// ---- Per-channel fuzz (Big-Muff / Devilfish-303) -----------------------------
// A pre-gain stage drives the signal HOT into a saturator, then a tone lowpass and a makeup
// gain tame it. The pre-gain is the difference from makeDrive (which shapes the bus at its
// natural, modest level): fuzz needs the signal slammed into the curve. amount 0 = transparent
// (unity pre-gain, near-linear curve, unity makeup), so every channel can carry one for free.
export function makeFuzz(ctx) {
  const input = ctx.createGain();
  const pre = ctx.createGain(); pre.gain.value = 1;
  const shaper = ctx.createWaveShaper(); shaper.curve = satCurve(0.001); shaper.oversample = "4x";
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 7000;
  const makeup = ctx.createGain(); makeup.gain.value = 1;
  input.connect(pre).connect(shaper).connect(tone).connect(makeup);
  let mode = "tanh";
  return {
    input, output: makeup,
    set({ amount = 0, mode: m, tone: tn } = {}) {
      if (m !== undefined) mode = m;
      const a = Math.max(0, amount);
      pre.gain.setTargetAtTime(1 + a * 9, ctx.currentTime, 0.02);            // slam it into the curve
      const steep = Math.max(0.001, a * 5);
      shaper.curve = mode === "diode" ? diodeCurve(steep) : satCurve(steep); // diode = asymmetric/buzzier
      makeup.gain.setTargetAtTime(1 / (1 + a * 4), ctx.currentTime, 0.02);   // tame the level boost
      if (tn !== undefined) tone.frequency.setTargetAtTime(tn, ctx.currentTime, 0.02);
    },
  };
}

// Pre-baked asymmetric saturator — the analog "warmth"/meat. Unlike makeFuzz, the (asymmetric,
// diode-shaped) curve is set ONCE at construction and never reassigned, so it survives offline
// rendering (node-web-audio-api forbids WaveShaperNode.curve reassignment; the render shim swallows
// it, which leaves makeFuzz stuck on its initial symmetric curve and unable to make even harmonics).
// Asymmetry => even-order harmonics => warmth. Drive is the pre-gain (a freely-automatable GainNode):
// only the level INTO the fixed curve changes, never the curve. A DC-blocker removes the offset the
// asymmetry introduces. amount 0 = transparent, so every channel can carry one for free.
export function makeAsymSat(ctx) {
  const input = ctx.createGain();
  const pre = ctx.createGain(); pre.gain.value = 1;
  const shaper = ctx.createWaveShaper(); shaper.curve = diodeCurve(0.6); shaper.oversample = "4x"; // fixed asymmetric curve
  const dc = ctx.createBiquadFilter(); dc.type = "highpass"; dc.frequency.value = 18; dc.Q.value = 0.5; // block the DC the asymmetry adds
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 6000;
  const makeup = ctx.createGain(); makeup.gain.value = 1;
  // TRUE bypass via a dry/wet crossfade. The shaper curve is FIXED (node-web-audio-api forbids
  // WaveShaperNode.curve reassignment offline — the render shim only swallows the error, it doesn't
  // apply the new curve), so amount can't ride the curve; it must ride a parallel mix instead.
  // diodeCurve(0.6) is a real saturation (maps 0.2→0.43), NOT a unity slope — leaving it permanently
  // in-circuit coloured EVERY channel even at warmth 0. Start fully DRY so warmth 0 is truly clean.
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = 0;
  const out = ctx.createGain();
  input.connect(dry).connect(out);
  input.connect(pre).connect(shaper).connect(dc).connect(tone).connect(makeup).connect(wet).connect(out);
  return {
    input, output: out,
    set({ amount = 0, tone: tn } = {}) {
      const a = Math.max(0, amount);
      const mix = Math.min(1, a);                                          // crossfade dry↔wet by warmth
      pre.gain.setTargetAtTime(1 + a * 9, ctx.currentTime, 0.02);          // drive = level into the fixed curve
      makeup.gain.setTargetAtTime(1 / (1 + a * 3.5), ctx.currentTime, 0.02);
      wet.gain.setTargetAtTime(mix, ctx.currentTime, 0.02);
      dry.gain.setTargetAtTime(1 - mix, ctx.currentTime, 0.02);
      if (tn !== undefined) tone.frequency.setTargetAtTime(tn, ctx.currentTime, 0.02);
    },
  };
}

// ---- Wavefold (West-Coast) ---------------------------------------------------

export function makeFold(ctx) {
  const input = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  shaper.curve = foldCurve(1); shaper.oversample = "4x";
  const output = ctx.createGain();
  input.connect(shaper).connect(output);
  return {
    input, output,
    set(p = {}) { if (p.amount !== undefined) shaper.curve = foldCurve(1 + p.amount * 4); },
  };
}

// ---- Bitcrush (AudioWorklet preferred, WaveShaper fallback) -------------------

// Tries the AudioWorklet module; on failure falls back to a WaveShaper bitCurve()
// (bit-depth only — no true SR reduction without the worklet; commented as such).
export function makeBitcrush(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = 0;
  input.connect(dry).connect(output);

  const frag = {
    input, output,
    ready: false,
    _node: null,
    _shaper: null,
    set(p = {}) {
      // mix: crossfade dry/wet.
      if (p.mix !== undefined) {
        ramp(wet.gain, p.mix, 0.05, ctx);
        ramp(dry.gain, 1 - p.mix, 0.05, ctx);
      }
      if (frag._node) {
        if (p.bits !== undefined) frag._node.parameters.get("bits").setTargetAtTime(p.bits, ctx.currentTime, 0.02);
        if (p.srDiv !== undefined) frag._node.parameters.get("srDiv").setTargetAtTime(p.srDiv, ctx.currentTime, 0.02);
      } else if (frag._shaper && p.bits !== undefined) {
        frag._shaper.curve = bitCurve(p.bits);
      }
    },
    async init() {
      try {
        await ctx.audioWorklet.addModule(new URL("./bitcrush-worklet.js", import.meta.url));
        const node = new AudioWorkletNode(ctx, "bitcrush", { numberOfInputs: 1, numberOfOutputs: 1 });
        input.connect(node).connect(wet).connect(output);
        frag._node = node;
        frag.ready = true;
      } catch (e) {
        // Fallback: WaveShaper bit-depth quantization (no sample-rate reduction).
        const shaper = ctx.createWaveShaper();
        shaper.curve = bitCurve(8); shaper.oversample = "none";
        input.connect(shaper).connect(wet).connect(output);
        frag._shaper = shaper;
        frag.ready = true;
        console.warn("[fx] bitcrush worklet unavailable; using WaveShaper fallback:", e?.message || e);
      }
    },
  };
  return frag;
}

// ---- Ring modulator ----------------------------------------------------------

// Gain modulated by an oscillator: the carrier osc drives a gain whose audio input
// is the signal → classic AM/ring timbre.
export function makeRingmod(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const ring = ctx.createGain(); ring.gain.value = 0; // modulated by the osc
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = 0;
  const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = 0;
  const depth = ctx.createGain(); depth.gain.value = 1;
  osc.connect(depth).connect(ring.gain);
  input.connect(dry).connect(output);
  input.connect(ring).connect(wet).connect(output);
  let started = false;
  return {
    input, output,
    set(p = {}) {
      if (p.freq !== undefined) {
        osc.frequency.setTargetAtTime(Math.max(0, p.freq), ctx.currentTime, 0.02);
        if (!started && p.freq > 0) { try { osc.start(); started = true; } catch (_) {} }
      }
      if (p.mix !== undefined) { ramp(wet.gain, p.mix, 0.05, ctx); ramp(dry.gain, 1 - p.mix, 0.05, ctx); }
    },
  };
}

// ---- Chorus (Juno-style BBD) -------------------------------------------------

// Two LFO-modulated delay lines panned hard L/R — the lush, slightly-detuned 80s/
// synthwave widener a single supersaw can't give. `mix` crossfades dry/wet (0 = bypass);
// depth is the delay-time modulation in seconds, rate the LFO Hz, spread the stereo pan.
export function makeChorus(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = 0;
  input.connect(dry).connect(output);
  wet.connect(output);
  const base = 0.007; // 7 ms base delay
  const voices = [];
  for (const pan of [-0.7, 0.7]) {
    const inv = pan > 0; // right voice runs anti-phase for stereo width
    const d = ctx.createDelay(0.05); d.delayTime.value = base;
    const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.6;
    // Decorrelate L/R by INVERTING the right voice's modulation depth (anti-phase) — NOT by
    // detuning the LFO. `detune` shifts frequency, not phase: the old `detune = 90*100` (9000
    // cents = 90 semitones) ran the right LFO at ~108 Hz (audio-rate), spraying FM sidebands /
    // high-freq buzz into the right channel only. Anti-phase depth gives wide stereo with both
    // LFOs at the chorus rate and no artifacts.
    const depth = ctx.createGain(); depth.gain.value = inv ? -0.003 : 0.003;
    lfo.connect(depth).connect(d.delayTime);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    input.connect(d).connect(p).connect(wet);
    try { lfo.start(); } catch (_) {}
    voices.push({ d, lfo, depth, pan: p, inv });
  }
  return {
    input, output,
    set(p = {}) {
      if (p.rate !== undefined) for (const v of voices) v.lfo.frequency.setTargetAtTime(Math.max(0.01, p.rate), ctx.currentTime, 0.05);
      if (p.depth !== undefined) for (const v of voices) v.depth.gain.setTargetAtTime((v.inv ? -1 : 1) * Math.max(0, p.depth), ctx.currentTime, 0.05);
      if (p.spread !== undefined) { voices[0].pan.pan.setTargetAtTime(-p.spread, ctx.currentTime, 0.05); voices[1].pan.pan.setTargetAtTime(p.spread, ctx.currentTime, 0.05); }
      if (p.mix !== undefined) { ramp(wet.gain, p.mix, 0.08, ctx); ramp(dry.gain, 1 - 0.5 * p.mix, 0.08, ctx); }
    },
  };
}

// ---- Tape character (wow / flutter / saturation) -----------------------------

// A modulated delay (varispeed pitch instability) + soft saturation — the "warm analog
// imperfection" of synthwave/Boards-of-Canada. wow = slow pitch drift Hz, flutter = fast
// Hz, depth = seconds of modulation, drive = soft-clip amount, mix = dry/wet (0 = bypass).
// Real-time texture only (its LFOs never read the seed/clock — like the shimmer warble).
export function makeTape(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = 0;
  const d = ctx.createDelay(0.05); d.delayTime.value = 0.006;
  const wow = ctx.createOscillator(); wow.type = "sine"; wow.frequency.value = 0.6;
  const flutter = ctx.createOscillator(); flutter.type = "sine"; flutter.frequency.value = 6;
  const wowD = ctx.createGain(); wowD.gain.value = 0.0015;
  const flD = ctx.createGain(); flD.gain.value = 0.0003;
  wow.connect(wowD).connect(d.delayTime);
  flutter.connect(flD).connect(d.delayTime);
  const sat = ctx.createWaveShaper(); sat.curve = satCurve(0.001); sat.oversample = "2x";
  input.connect(dry).connect(output);
  input.connect(d).connect(sat).connect(wet).connect(output);
  try { wow.start(); flutter.start(); } catch (_) {}
  return {
    input, output,
    set(p = {}) {
      if (p.wow !== undefined) wow.frequency.setTargetAtTime(Math.max(0.01, p.wow), ctx.currentTime, 0.1);
      if (p.flutter !== undefined) flutter.frequency.setTargetAtTime(Math.max(0.1, p.flutter), ctx.currentTime, 0.1);
      if (p.depth !== undefined) { wowD.gain.setTargetAtTime(Math.max(0, p.depth), ctx.currentTime, 0.1); flD.gain.setTargetAtTime(Math.max(0, p.depth) * 0.2, ctx.currentTime, 0.1); }
      if (p.drive !== undefined) sat.curve = satCurve(Math.max(0.001, p.drive));
      if (p.mix !== undefined) { ramp(wet.gain, p.mix, 0.1, ctx); ramp(dry.gain, 1 - p.mix, 0.1, ctx); }
    },
  };
}

// ---- Phaser (allpass notch-sweep) --------------------------------------------

// A chain of allpass BiquadFilters whose `frequency` is swept by a shared LFO, with feedback
// and dry/wet mix — the classic moving-notch phaser. Per Ott/Shpongle (research/
// shpongle_technique.md §Ott): a phaser on the HIGHS spreads and softens hats/leads. Built from
// allpass biquads + delay + osc + gain (all faithful offline — no WaveShaper). Stereo width via
// ANTI-PHASE L/R modulation (right channel's depth inverted), NOT detune — see makeChorus for the
// detune-FM hazard. depth is the sweep amount in Hz, rate the LFO Hz, mix crossfades dry/wet.
export function makePhaser(ctx, stages = 6) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = 0;
  input.connect(dry).connect(output);
  wet.connect(output);
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  // Force a stereo up-mix BEFORE the splitter. A ChannelSplitter uses discrete channel
  // interpretation — feed it a mono bus and output 1 (R) is SILENT (no up-mix), so the right
  // allpass chain would process nothing and only dry-R survives (a hard L/R imbalance). An
  // explicit 2-channel "speakers" gain copies mono → L+R so both sides get real signal.
  const up = ctx.createGain(); up.channelCount = 2; up.channelCountMode = "explicit"; up.channelInterpretation = "speakers";
  input.connect(up).connect(split);
  const base = 800; // center frequency the notches sweep around (Hz)
  const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.4;
  try { lfo.start(); } catch (_) {}
  const sides = [];
  for (let ch = 0; ch < 2; ch++) {
    const inv = ch === 1; // right side runs anti-phase for stereo decorrelation
    const fb = ctx.createGain(); fb.gain.value = 0.4;
    const depth = ctx.createGain(); depth.gain.value = inv ? -800 : 800;
    lfo.connect(depth);
    const aps = [];
    const head = ctx.createGain(); // per-side input tap + feedback summing node
    split.connect(head, ch);
    let node = head;
    for (let i = 0; i < stages; i++) {
      const ap = ctx.createBiquadFilter();
      ap.type = "allpass";
      ap.frequency.value = base;
      ap.Q.value = 0.7;
      depth.connect(ap.frequency);
      node.connect(ap);
      node = ap;
      aps.push(ap);
    }
    // feedback: last allpass output → fb gain → back into the chain head
    node.connect(fb).connect(head);
    node.connect(merge, 0, ch);
    sides.push({ aps, fb, depth, inv });
  }
  merge.connect(wet);
  return {
    input, output,
    set(p = {}) {
      if (p.rate !== undefined) lfo.frequency.setTargetAtTime(Math.max(0.01, p.rate), ctx.currentTime, 0.05);
      if (p.depth !== undefined) for (const s of sides) s.depth.gain.setTargetAtTime((s.inv ? -1 : 1) * Math.max(0, p.depth), ctx.currentTime, 0.05);
      if (p.feedback !== undefined) for (const s of sides) s.fb.gain.setTargetAtTime(Math.max(0, Math.min(0.95, p.feedback)), ctx.currentTime, 0.05);
      if (p.stages !== undefined) {
        // engage only the first `stages` allpass sections; neutralize the rest (Q→0 = flat).
        const n = Math.max(1, Math.min(sides[0].aps.length, Math.round(p.stages)));
        for (const s of sides) for (let i = 0; i < s.aps.length; i++) s.aps[i].Q.setTargetAtTime(i < n ? 0.7 : 0.0001, ctx.currentTime, 0.05);
      }
      if (p.mix !== undefined) { ramp(wet.gain, p.mix, 0.08, ctx); ramp(dry.gain, 1 - p.mix, 0.08, ctx); }
    },
  };
}

// ---- Flanger (modulated short-delay comb) ------------------------------------

// A short (~1-5 ms) DelayNode whose delay time is LFO-swept, with feedback and dry/wet mix —
// the jet-sweep comb filter. Per Ott (research/shpongle_technique.md §Ott): widens/softens the
// highs. DelayNode + osc + gain (all faithful offline). Stereo width via ANTI-PHASE L/R sweep
// (right channel depth inverted), NOT detune. depth = delay-sweep amount in seconds, rate = LFO
// Hz, feedback = comb resonance, mix = dry/wet.
export function makeFlanger(ctx) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1;
  const wet = ctx.createGain(); wet.gain.value = 0;
  input.connect(dry).connect(output);
  wet.connect(output);
  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  // Force a stereo up-mix before the splitter (see makePhaser): a mono bus into a discrete
  // ChannelSplitter leaves output 1 (R) silent, so the right comb gets no signal.
  const up = ctx.createGain(); up.channelCount = 2; up.channelCountMode = "explicit"; up.channelInterpretation = "speakers";
  input.connect(up).connect(split);
  const base = 0.0025; // 2.5 ms base delay (center of the 1-5 ms sweep)
  // Decorrelate L/R with two genuinely different SUB-AUDIO rates (R = 1.27× L), NOT anti-phase.
  // The comb notch lands at 1/delayTime — a NONLINEAR map — so pure anti-phase (base±Δ) biases
  // high-band energy to one channel. Independent slow rates sweep each channel's notch
  // separately; their time-averaged spectra match, so L/R stay energy-balanced while still
  // decorrelated for width. Both rates are sub-audio (no FM artifacts) — phase/rate, NOT detune
  // (see makeChorus for the detune-FM hazard).
  const RATIO = 1.27;
  let rate0 = 0.25;
  const lfoL = ctx.createOscillator(); lfoL.type = "sine"; lfoL.frequency.value = rate0;
  const lfoR = ctx.createOscillator(); lfoR.type = "sine"; lfoR.frequency.value = rate0 * RATIO;
  try { lfoL.start(); lfoR.start(); } catch (_) {}
  const sides = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = ctx.createDelay(0.05); d.delayTime.value = base;
    const depth = ctx.createGain(); depth.gain.value = 0.0015;
    (ch === 0 ? lfoL : lfoR).connect(depth).connect(d.delayTime);
    const fb = ctx.createGain(); fb.gain.value = 0.3;
    const tap = ctx.createGain();
    split.connect(tap, ch);
    tap.connect(d);
    d.connect(fb).connect(d);          // comb feedback
    d.connect(merge, 0, ch);
    sides.push({ d, depth, fb });
  }
  merge.connect(wet);
  return {
    input, output,
    set(p = {}) {
      if (p.rate !== undefined) {
        rate0 = Math.max(0.01, p.rate);
        lfoL.frequency.setTargetAtTime(rate0, ctx.currentTime, 0.05);
        lfoR.frequency.setTargetAtTime(rate0 * RATIO, ctx.currentTime, 0.05); // R kept decorrelated
      }
      if (p.depth !== undefined) for (const s of sides) s.depth.gain.setTargetAtTime(Math.max(0, p.depth), ctx.currentTime, 0.05);
      if (p.feedback !== undefined) for (const s of sides) s.fb.gain.setTargetAtTime(Math.max(0, Math.min(0.95, p.feedback)), ctx.currentTime, 0.05);
      if (p.mix !== undefined) { ramp(wet.gain, p.mix, 0.08, ctx); ramp(dry.gain, 1 - 0.5 * p.mix, 0.08, ctx); }
    },
  };
}

// ---- Noise / hiss atmosphere bed ---------------------------------------------

// A persistent pink-noise layer through a slowly-swept bandpass — dub techno's "wind
// across a tundra" / tape-hiss bed. Always built (gain 0 when off) so a live genre switch
// can bring it in; the engine routes its output dry + into the reverb send.
export function makeNoiseBed(ctx) {
  const output = ctx.createGain(); output.gain.value = 0;
  const len = Math.max(1, (ctx.sampleRate * 2) | 0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0; // Paul Kellet pink-noise filter
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1200; bp.Q.value = 1.5;
  const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.05;
  const lfoD = ctx.createGain(); lfoD.gain.value = 600;
  lfo.connect(lfoD).connect(bp.frequency);
  src.connect(bp).connect(output);
  try { src.start(); lfo.start(); } catch (_) {}
  return {
    output,
    set(p = {}) {
      if (p.color !== undefined) bp.frequency.setTargetAtTime(Math.max(80, p.color), ctx.currentTime, 0.2);
      if (p.q !== undefined) bp.Q.setTargetAtTime(Math.max(0.1, p.q), ctx.currentTime, 0.2);
      if (p.sweep !== undefined) lfo.frequency.setTargetAtTime(Math.max(0.001, p.sweep), ctx.currentTime, 0.2);
      if (p.gain !== undefined) ramp(output.gain, Math.max(0, p.gain), 0.3, ctx);
    },
  };
}

// ---- Modulation matrix -------------------------------------------------------

// Modulation matrix. Three source kinds, each producing an ADDITIVE signal that is either
// connected to a destination AudioParam (persistent dests, resolved by the engine) or exposed
// via tap() for a voice to connect to a per-note param at note-on (per-voice dests):
//   lfo     OscillatorNode → depth gain   (shapes sine|tri|square|saw|ramp)
//   sh      ConstantSourceNode.offset re-randomized on the scheduler grid; `slew` is the lag
//           (≈0.005 snappy step ↔ ≈0.12 smoothed West-Coast S&H)
//   kickenv ConstantSourceNode.offset pulsed on each kick (sidechain-as-modulation)
// Determinism (spec §11): LFOs are oscillators (no RNG); S&H uses Math.random (real-time
// humanization, allowed); kick-env keys off the audible kick. Nothing reads/perturbs a seed.
export function makeModMatrix(ctx) {
  const lfos = {};     // name -> { osc, depth, target }
  const shList = [];   // i -> { node, depth, target, slew }
  const kickList = []; // i -> { node, depth, target, release, down }

  const oscType = (s) => s === "tri" ? "triangle" : s === "square" ? "square"
    : (s === "saw" || s === "ramp") ? "sawtooth" : "sine";

  function ensureLfo(name) {
    if (lfos[name]) return lfos[name];
    const osc = ctx.createOscillator(); osc.type = "sine";
    const depth = ctx.createGain(); depth.gain.value = 0;
    osc.connect(depth);
    try { osc.start(); } catch (_) {}
    return (lfos[name] = { osc, depth, target: null });
  }
  function ensureConst(list, i, extra) {
    if (list[i]) return list[i];
    const node = ctx.createConstantSource(); node.offset.value = 0;
    try { node.start(); } catch (_) {}
    return (list[i] = { node, target: null, depth: 0, ...extra });
  }
  // Re-point a source's additive output at a new destination AudioParam (or detach with null).
  function retarget(h, target) {
    if (target === h.target) return;
    const out = h.node || h.depth;
    try { out.disconnect(); } catch (_) {}
    if (target) out.connect(target);
    h.target = target;
  }

  return {
    // Wire an LFO: shape sine|tri|square|saw|ramp, rate Hz, depth in param units, target param.
    setLfo(name, { rate, depth, shape, target } = {}) {
      const l = ensureLfo(name);
      if (shape !== undefined) l.osc.type = oscType(shape);
      if (rate !== undefined) l.osc.frequency.setTargetAtTime(Math.max(0.001, rate), ctx.currentTime, 0.05);
      if (depth !== undefined) l.depth.gain.setTargetAtTime(depth, ctx.currentTime, 0.05);
      if (target !== undefined) retarget(l, target);
    },
    // Patterned wobble: schedule an abrupt LFO rate/depth change at the absolute time `t`
    // (not currentTime — so per-step changes land on the grid, not collapsed at render start).
    // The LFO must already exist (setLfo created it). No glide: the step boundary is hard so
    // the wobble rhythm reads as distinct cells (the dubstep "talking" wobble).
    setLfoAt(name, { rate, depth } = {}, t) {
      const l = lfos[name]; if (!l) return;
      if (rate !== undefined) l.osc.frequency.setValueAtTime(Math.max(0.001, rate), t);
      if (depth !== undefined) l.depth.gain.setValueAtTime(Math.max(0, depth), t);
    },
    // Sample & hold #i: tickSH writes a new random value (±depth) onto its ConstantSource offset,
    // glided over `slew` seconds; the source's output rides additively on the target param.
    setSHAt(i, { depth, target, slew } = {}) {
      const s = ensureConst(shList, i, { slew: 0.006 });
      if (depth !== undefined) s.depth = depth;
      if (slew !== undefined) s.slew = slew;
      if (target !== undefined) retarget(s, target);
    },
    setSH(p) { this.setSHAt(0, p); }, // legacy single-S&H shim
    // Kick envelope #i: kickPulse spikes the offset to ±depth on each kick, decaying back to 0.
    setKickEnv(i, { target, depth, release, down } = {}) {
      const k = ensureConst(kickList, i, { release: 0.12, down: false });
      if (depth !== undefined) k.depth = depth;
      if (release !== undefined) k.release = release;
      if (down !== undefined) k.down = down;
      if (target !== undefined) retarget(k, target);
    },
    // The additive signal node for a per-voice destination — a voice connect()s it at note-on.
    tap(kind, i) {
      if (kind === "lfo") return lfos[i] ? lfos[i].depth : null;
      if (kind === "sh") return shList[i] ? shList[i].node : null;
      if (kind === "kick") return kickList[i] ? kickList[i].node : null;
      return null;
    },
    tickSH(t) {
      for (const s of shList) if (s && s.depth) s.node.offset.setTargetAtTime((Math.random() * 2 - 1) * s.depth, t, Math.max(0.001, s.slew / 3));
    },
    kickPulse(t) {
      for (const k of kickList) {
        if (!k || !k.depth) continue;
        k.node.offset.cancelScheduledValues(t);
        k.node.offset.setValueAtTime(k.down ? -k.depth : k.depth, t);
        k.node.offset.setTargetAtTime(0, t + 0.005, Math.max(0.005, k.release) / 3);
      }
    },
    // Zero/detach any source not in `keep` (routes can shrink on a genre swap — no stale mod).
    pruneLfos(keep) { for (const name of Object.keys(lfos)) if (!keep.includes(name)) { const l = lfos[name]; try { l.depth.disconnect(); } catch (_) {} l.depth.gain.setTargetAtTime(0, ctx.currentTime, 0.05); l.target = null; } },
    pruneSH(keep) { shList.forEach((s, i) => { if (s && !keep.includes(i)) { s.depth = 0; retarget(s, null); } }); },
    pruneKick(keep) { kickList.forEach((k, i) => { if (k && !keep.includes(i)) { k.depth = 0; retarget(k, null); } }); },
    dispose() {
      for (const k of Object.keys(lfos)) { try { lfos[k].osc.stop(); } catch (_) {} }
      for (const s of shList) if (s) { try { s.node.stop(); } catch (_) {} }
      for (const k of kickList) if (k) { try { k.node.stop(); } catch (_) {} }
    },
  };
}
