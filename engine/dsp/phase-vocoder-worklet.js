// AudioWorklet pitch shifter — the high-fidelity path (no granular warble; pitch
// decoupled from time). This MIRRORS cyber/phase-vocoder-core.js verbatim: AudioWorklet
// global scope can't ES-import, so the algorithm (Bernsee's public-domain smbPitchShift)
// is inlined here. Keep the two in sync; the core module is the one that's unit-tested.
//
// Loaded by fx.js via ctx.audioWorklet.addModule(). Exposes a k-rate `pitch` AudioParam
// (ratio; 2 = +1 octave) so the shift can be swept live without rebuilding the node.

const TWO_PI = 2 * Math.PI;

function smbFft(fftBuffer, fftFrameSize, sign) {
  for (let i = 2; i < 2 * fftFrameSize - 2; i += 2) {
    let j = 0;
    for (let bitm = 2; bitm < 2 * fftFrameSize; bitm <<= 1) {
      if (i & bitm) j++;
      j <<= 1;
    }
    if (i < j) {
      let t = fftBuffer[i]; fftBuffer[i] = fftBuffer[j]; fftBuffer[j] = t;
      t = fftBuffer[i + 1]; fftBuffer[i + 1] = fftBuffer[j + 1]; fftBuffer[j + 1] = t;
    }
  }
  const passes = Math.round(Math.log(fftFrameSize) / Math.log(2));
  let le = 2;
  for (let k = 0; k < passes; k++) {
    le <<= 1;
    const le2 = le >> 1;
    let ur = 1.0, ui = 0.0;
    const arg = Math.PI / (le2 >> 1);
    const wr = Math.cos(arg), wi = sign * Math.sin(arg);
    for (let j = 0; j < le2; j += 2) {
      let p1r = j, p1i = j + 1, p2r = j + le2, p2i = j + le2 + 1;
      for (let i = j; i < 2 * fftFrameSize; i += le) {
        const tr = fftBuffer[p2r] * ur - fftBuffer[p2i] * ui;
        const ti = fftBuffer[p2r] * ui + fftBuffer[p2i] * ur;
        fftBuffer[p2r] = fftBuffer[p1r] - tr;
        fftBuffer[p2i] = fftBuffer[p1i] - ti;
        fftBuffer[p1r] += tr;
        fftBuffer[p1i] += ti;
        p1r += le; p1i += le; p2r += le; p2i += le;
      }
      const tr = ur * wr - ui * wi;
      ui = ur * wi + ui * wr;
      ur = tr;
    }
  }
}

// One independent shifter per channel (carries its own STFT state).
class Voice {
  constructor(fftFrameSize, osamp) {
    this.fftFrameSize = fftFrameSize;
    this.osamp = osamp;
    const f = fftFrameSize;
    this.inFIFO = new Float32Array(f);
    this.outFIFO = new Float32Array(f);
    this.fft = new Float32Array(2 * f);
    this.lastPhase = new Float32Array(f / 2 + 1);
    this.sumPhase = new Float32Array(f / 2 + 1);
    this.outAccum = new Float32Array(2 * f);
    this.anaFreq = new Float32Array(f);
    this.anaMagn = new Float32Array(f);
    this.synFreq = new Float32Array(f);
    this.synMagn = new Float32Array(f);
    this.rover = 0;
    // Precompute the Hann window once (constant); the hop loop is the render-thread hot
    // path — avoids a per-bin Math.cos every hop. Mirrors phase-vocoder-core.js.
    this.window = new Float32Array(f);
    for (let k = 0; k < f; k++) this.window[k] = 0.5 - 0.5 * Math.cos((TWO_PI * k) / f);
  }
  process(indata, outdata, pitchShift, sr) {
    const { fftFrameSize, osamp } = this;
    const fftFrameSize2 = fftFrameSize / 2;
    const stepSize = fftFrameSize / osamp;
    const freqPerBin = sr / fftFrameSize;
    const expct = (TWO_PI * stepSize) / fftFrameSize;
    const inFifoLatency = fftFrameSize - stepSize;
    if (this.rover === 0) this.rover = inFifoLatency;
    const g = this.fft;
    for (let i = 0; i < indata.length; i++) {
      this.inFIFO[this.rover] = indata[i];
      outdata[i] = this.outFIFO[this.rover - inFifoLatency];
      this.rover++;
      if (this.rover >= fftFrameSize) {
        this.rover = inFifoLatency;
        for (let k = 0; k < fftFrameSize; k++) {
          g[2 * k] = this.inFIFO[k] * this.window[k];
          g[2 * k + 1] = 0;
        }
        smbFft(g, fftFrameSize, -1);
        for (let k = 0; k <= fftFrameSize2; k++) {
          const real = g[2 * k], imag = g[2 * k + 1];
          const magn = 2 * Math.sqrt(real * real + imag * imag);
          const phase = Math.atan2(imag, real);
          let tmp = phase - this.lastPhase[k];
          this.lastPhase[k] = phase;
          tmp -= k * expct;
          let qpd = Math.trunc(tmp / Math.PI);
          if (qpd >= 0) qpd += qpd & 1; else qpd -= qpd & 1;
          tmp -= Math.PI * qpd;
          tmp = (osamp * tmp) / TWO_PI;
          this.anaMagn[k] = magn;
          this.anaFreq[k] = k * freqPerBin + tmp * freqPerBin;
        }
        for (let k = 0; k <= fftFrameSize2; k++) { this.synMagn[k] = 0; this.synFreq[k] = 0; }
        for (let k = 0; k <= fftFrameSize2; k++) {
          const index = Math.round(k * pitchShift);
          if (index <= fftFrameSize2) {
            this.synMagn[index] += this.anaMagn[k];
            this.synFreq[index] = this.anaFreq[k] * pitchShift;
          }
        }
        for (let k = 0; k <= fftFrameSize2; k++) {
          const magn = this.synMagn[k];
          let tmp = this.synFreq[k];
          tmp -= k * freqPerBin;
          tmp /= freqPerBin;
          tmp = (TWO_PI * tmp) / osamp;
          tmp += k * expct;
          this.sumPhase[k] += tmp;
          const phase = this.sumPhase[k];
          g[2 * k] = magn * Math.cos(phase);
          g[2 * k + 1] = magn * Math.sin(phase);
        }
        for (let k = fftFrameSize + 2; k < 2 * fftFrameSize; k++) g[k] = 0;
        smbFft(g, fftFrameSize, 1);
        for (let k = 0; k < fftFrameSize; k++) {
          this.outAccum[k] += (2 * this.window[k] * g[2 * k]) / (fftFrameSize2 * osamp);
        }
        for (let k = 0; k < stepSize; k++) this.outFIFO[k] = this.outAccum[k];
        this.outAccum.copyWithin(0, stepSize, stepSize + fftFrameSize);
        for (let k = 0; k < inFifoLatency; k++) this.inFIFO[k] = this.inFIFO[k + stepSize];
      }
    }
  }
}

class PhaseVocoderProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: "pitch", defaultValue: 2.0, minValue: 0.25, maxValue: 4.0, automationRate: "k-rate" }];
  }
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.fftFrameSize = o.fftFrameSize || 2048;
    this.osamp = o.osamp || 8;
    this.voices = [];
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || !input.length) return true; // nothing connected yet — stay alive
    const pitch = params.pitch.length ? params.pitch[0] : 2.0;
    for (let ch = 0; ch < output.length; ch++) {
      if (!this.voices[ch]) this.voices[ch] = new Voice(this.fftFrameSize, this.osamp);
      this.voices[ch].process(input[ch] || input[0], output[ch], pitch, sampleRate);
    }
    return true;
  }
}

registerProcessor("phase-vocoder", PhaseVocoderProcessor);
