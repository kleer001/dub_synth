// One decode entry point for the sample paths, dispatching on what the bytes
// actually are rather than on a filename. Four callers need it — the renderer,
// the noise corpus, the kick scanner and the live desk — and they should not
// each be guessing from an extension.
//
// The desk uses this rather than ctx.decodeAudioData for two reasons: browser
// support for AIFF is not something to rely on, and decoding the same way in
// both engines means a kick sounds identical on the desk and in the bounce.

import { decodeWav } from "./wav.js";
import { decodeAiff, sniffAudio } from "./aiff.js";

export function decodeAudio(arrayBuffer) {
  const kind = sniffAudio(arrayBuffer);
  if (kind === "wav") return decodeWav(arrayBuffer);
  if (kind === "aiff") return decodeAiff(arrayBuffer);
  throw new Error("unrecognised audio container — expected RIFF/WAVE or FORM/AIFF");
}

// Linear resample. A sample library is whatever rate it was recorded at, and the
// context is 48k: copying frames across that gap without resampling plays a
// 44.1 kHz one-shot 8.8% fast and a semitone and a half sharp. Linear is enough
// for a percussive one-shot of a few hundred milliseconds; it would not be for a
// sustained tonal loop.
export function resample(channels, from, to) {
  if (!from || from === to) return channels;
  const ratio = from / to;
  const n = Math.max(1, Math.round(channels[0].length / ratio));
  return channels.map((src) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * ratio;
      const i0 = Math.floor(x);
      const i1 = Math.min(i0 + 1, src.length - 1);
      const f = x - i0;
      out[i] = src[i0] * (1 - f) + src[i1] * f;
    }
    return out;
  });
}

// Decoded bytes → an AudioBuffer at the context's own rate, ready to stamp or
// play without a pitch error.
export function toAudioBuffer(ctx, decoded) {
  const chans = resample(decoded.channels, decoded.sampleRate, ctx.sampleRate);
  const buf = ctx.createBuffer(chans.length, chans[0].length, ctx.sampleRate);
  for (let c = 0; c < chans.length; c++) buf.copyToChannel(chans[c], c);
  return buf;
}
