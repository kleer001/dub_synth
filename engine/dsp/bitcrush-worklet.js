// cyber/bitcrush-worklet.js — an AudioWorkletProcessor doing sample-rate reduction
// (sample-and-hold every `srDiv` samples) + bit-depth quantization. Runs on the
// audio render thread (off the main thread), the preferred path per
// cyberpunk_audio_spec.md §5 (ScriptProcessorNode is deprecated). fx.js loads this
// via ctx.audioWorklet.addModule(); a WaveShaper bitCurve() is the fallback.
//
// This file uses AudioWorklet globals (registerProcessor, AudioWorkletProcessor,
// sampleRate) that exist only on the render thread — so `node --check` (syntax only)
// is the right validation, not import.

class BitcrushProcessor extends AudioWorkletProcessor {
  // k-rate AudioParams so the engine can automate bits/srDiv smoothly.
  static get parameterDescriptors() {
    return [
      { name: "bits", defaultValue: 12, minValue: 1, maxValue: 16, automationRate: "k-rate" },
      { name: "srDiv", defaultValue: 1, minValue: 1, maxValue: 64, automationRate: "k-rate" },
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    // Per-channel sample-and-hold state (held value + phase counter).
    this._held = [];
    this._phase = [];
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const bits = Math.max(1, Math.round(params.bits[0]));
    const srDiv = Math.max(1, Math.round(params.srDiv[0]));
    const mix = params.mix[0];
    const levels = Math.pow(2, bits);

    for (let ch = 0; ch < output.length; ch++) {
      const inCh = input[ch] || input[0];
      const outCh = output[ch];
      if (this._held[ch] === undefined) { this._held[ch] = 0; this._phase[ch] = 0; }
      let held = this._held[ch];
      let phase = this._phase[ch];

      for (let i = 0; i < outCh.length; i++) {
        const dry = inCh ? inCh[i] : 0;
        // Sample-rate reduction: hold the input every `srDiv` samples.
        if (phase === 0) {
          // Bit-depth quantization of the freshly-sampled value.
          held = Math.round(dry * levels) / levels;
        }
        phase = (phase + 1) % srDiv;
        outCh[i] = dry * (1 - mix) + held * mix;
      }
      this._held[ch] = held;
      this._phase[ch] = phase;
    }
    return true; // keep the processor alive
  }
}

registerProcessor("bitcrush", BitcrushProcessor);
