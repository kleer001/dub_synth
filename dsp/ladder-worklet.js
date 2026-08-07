// AudioWorklet 4-pole (24 dB/oct) resonant ladder lowpass — the analog character a
// Web Audio BiquadFilter (2-pole, linear) can't give. This is what makes a 303/Moog bass
// growl: a cascade of four one-pole stages with a resonant feedback path and a cubic
// soft-clip nonlinearity (the Taylor head of tanh) that saturates as resonance climbs
// toward self-oscillation. Stilson/Smith-style tuning (the widely-used musicdsp "Moog
// VCF"), with a-rate `cutoff` so the per-note filter envelope sweeps smoothly.
//
// Loaded by fx.js via addModule(); makeLadder() wraps it with the biquad fallback.

// Stability bound on the resonant feedback (see the clamp in process()). Below the
// soft-clip's self-oscillation bifurcation, tuned by rendering a high-resonance bass.
const R_MAX = 1.4;

class LadderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "cutoff", defaultValue: 1000, minValue: 20, maxValue: 18000, automationRate: "a-rate" },
      { name: "resonance", defaultValue: 0.7, minValue: 0, maxValue: 1.25, automationRate: "a-rate" },
      { name: "drive", defaultValue: 1.0, minValue: 0.2, maxValue: 4.0, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.st = []; // per-channel filter state
    // Per-note nodes are created and torn down by makeFilter(); a disconnected worklet
    // keeps running until process() returns false (WebAudio spec #2658). dispose() posts
    // here so the node self-terminates and the audio thread can free it — without this the
    // engine leaks one running ladder processor per bass note.
    this._dead = false;
    this.port.onmessage = () => { this._dead = true; };
  }

  process(inputs, outputs, parameters) {
    if (this._dead) return false; // released after the note: stop processing, allow GC
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output.length) return true;
    const cutP = parameters.cutoff;
    const resP = parameters.resonance;
    const drive = parameters.drive.length ? parameters.drive[0] : 1.0;
    const sr = sampleRate;

    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch] || (input.length ? input[0] : null);
      const out = output[ch];
      let s = this.st[ch];
      if (!s) s = this.st[ch] = { y1: 0, y2: 0, y3: 0, y4: 0, ox: 0, o1: 0, o2: 0, o3: 0, px: 0 };

      for (let i = 0; i < out.length; i++) {
        const fc = cutP.length > 1 ? cutP[i] : cutP[0];
        const reso = resP.length > 1 ? resP[i] : resP[0];

        // Tuning at the 2× OVERSAMPLED rate (f is cutoff as a fraction of the oversampled
        // Nyquist): running the nonlinear stage at 2× and decimating pushes the
        // soft-clip's alias products above audio and folds far less back down.
        let f = fc / sr; // = 2*fc / (2*sr)
        if (f > 0.99) f = 0.99;
        else if (f < 0.0001) f = 0.0001;
        const k = 3.6 * f - 1.6 * f * f - 1; // resonance-corner tuning
        const p = (k + 1) * 0.5;
        const scale = Math.exp((1 - p) * 1.386249);
        // `scale` rises toward ~4 at low cutoff; at high resonance reso*scale would drive
        // the feedback past the soft-clip's bifurcation into a sustained high-frequency
        // squeal (numerical self-oscillation, not the musical sing-at-cutoff). Clamp the
        // feedback just below that threshold so the filter resonates hard but stays stable.
        const r = Math.min(reso * scale, R_MAX); // feedback amount

        // A tiny noise floor seeds self-oscillation: at high resonance the feedback
        // amplifies it into a clean sine (the analog filter "singing" from near-silence);
        // at low resonance it's ~ -80 dB and inaudible.
        const xin = drive * (inp ? inp[i] : 0) + 8e-5 * (Math.random() * 2 - 1);
        // Two sub-samples per output: the interpolated midpoint, then the sample.
        let acc = 0;
        const sub0 = 0.5 * (s.px + xin);
        for (let o = 0; o < 2; o++) {
          const x = (o === 0 ? sub0 : xin) - r * s.y4; // resonant feedback
          // four cascaded one-pole stages (bilinear)
          s.y1 = x * p + s.ox * p - k * s.y1; s.ox = x;
          s.y2 = s.y1 * p + s.o1 * p - k * s.y2; s.o1 = s.y1;
          s.y3 = s.y2 * p + s.o2 * p - k * s.y3; s.o2 = s.y2;
          s.y4 = s.y3 * p + s.o3 * p - k * s.y4; s.o3 = s.y3;
          s.y4 -= (s.y4 * s.y4 * s.y4) / 6; // cubic soft-clip — the growl
          acc += s.y4;
        }
        s.px = xin;
        out[i] = acc * 0.5; // 2-tap decimation: a null at the oversampled Nyquist
      }
    }
    return true;
  }
}

registerProcessor("moog-ladder", LadderProcessor);
