// AIFF differs from WAV in three ways that each silently corrupt a decoder
// written from WAV habits: big-endian everything, an 80-bit extended float for
// the sample rate, and SIGNED 8-bit samples. Each gets a case here.
//
// The files are built in memory rather than committed as fixtures — the format
// is small enough to write, and a synthesized file can hold exact values to
// assert against instead of whatever a recording happens to contain.

import { test } from "node:test";
import assert from "node:assert/strict";

import { decodeAiff, sniffAudio } from "../engine/core/aiff.js";
import { decodeAudio, resample } from "../engine/core/audio.js";

// An 80-bit IEEE 754 extended float: sign(1) exponent(15) mantissa(64) with the
// leading integer bit explicit. 44100 is 0x400E AC44 0000 0000 0000.
function writeExtended(dv, off, value) {
  let exp = 16383 + 63;
  let m = value;
  while (m < 2 ** 63) { m *= 2; exp--; }
  dv.setUint16(off, exp, false);
  dv.setUint32(off + 2, Math.floor(m / 2 ** 32), false);
  dv.setUint32(off + 6, m >>> 0, false);
}

function buildAiff({ channels, bits, sampleRate, frames, sample }) {
  const bytes = bits / 8;
  const ssnd = 8 + frames * channels * bytes;
  const buf = new ArrayBuffer(12 + 8 + 18 + 8 + ssnd);
  const dv = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };

  str(0, "FORM"); dv.setUint32(4, buf.byteLength - 8, false); str(8, "AIFF");
  str(12, "COMM"); dv.setUint32(16, 18, false);
  dv.setInt16(20, channels, false);
  dv.setUint32(22, frames, false);
  dv.setInt16(26, bits, false);
  writeExtended(dv, 28, sampleRate);
  str(38, "SSND"); dv.setUint32(42, ssnd, false);
  dv.setUint32(46, 0, false); dv.setUint32(50, 0, false);

  let p = 54;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = sample(i, c);
      if (bits === 16) dv.setInt16(p, v, false);
      else if (bits === 8) dv.setInt8(p, v);
      p += bytes;
    }
  }
  return buf;
}

test("decodes a big-endian 16-bit stereo AIFF", () => {
  const ab = buildAiff({
    channels: 2, bits: 16, sampleRate: 44100, frames: 4,
    sample: (i, c) => (c === 0 ? [0, 16384, -16384, 32767][i] : [32767, 0, 8192, -8192][i]),
  });
  const d = decodeAiff(ab);
  assert.equal(d.sampleRate, 44100);
  assert.equal(d.channels.length, 2);
  assert.equal(d.channels[0].length, 4);
  assert.ok(Math.abs(d.channels[0][1] - 0.5) < 1e-4, "left channel scaled from big-endian int16");
  assert.ok(Math.abs(d.channels[0][2] + 0.5) < 1e-4);
  assert.ok(Math.abs(d.channels[1][0] - 1) < 1e-4, "channels are interleaved, not concatenated");
});

test("reads the sample rate out of the 80-bit extended float", () => {
  for (const rate of [8000, 22050, 44100, 48000, 96000]) {
    const ab = buildAiff({ channels: 1, bits: 16, sampleRate: rate, frames: 2, sample: () => 0 });
    assert.equal(decodeAiff(ab).sampleRate, rate, `${rate} Hz round-trips`);
  }
});

test("treats 8-bit AIFF samples as signed, unlike WAV", () => {
  // The WAV reading of these bytes would be (v - 128) / 128, putting silence at
  // -1.0 and a DC offset of half full scale on the whole file.
  const ab = buildAiff({
    channels: 1, bits: 8, sampleRate: 22050, frames: 3,
    sample: (i) => [0, 64, -64][i],
  });
  const d = decodeAiff(ab);
  assert.equal(d.channels[0][0], 0, "zero is silence, not -1");
  assert.ok(Math.abs(d.channels[0][1] - 0.5) < 1e-6);
  assert.ok(Math.abs(d.channels[0][2] + 0.5) < 1e-6);
});

test("sniffs containers and refuses anything else", () => {
  const aiff = buildAiff({ channels: 1, bits: 16, sampleRate: 44100, frames: 1, sample: () => 0 });
  assert.equal(sniffAudio(aiff), "aiff");

  const notAudio = new ArrayBuffer(32);
  new DataView(notAudio).setUint32(0, 0xdeadbeef, false);
  assert.equal(sniffAudio(notAudio), null);
  assert.throws(() => decodeAudio(notAudio), /unrecognised audio container/);
});

test("decodeAudio dispatches on the bytes, not on a filename", () => {
  const ab = buildAiff({ channels: 1, bits: 16, sampleRate: 48000, frames: 2, sample: () => 16384 });
  const d = decodeAudio(ab);
  assert.equal(d.sampleRate, 48000);
  assert.ok(Math.abs(d.channels[0][0] - 0.5) < 1e-4);
});

test("resample changes length by the rate ratio and is a no-op at parity", () => {
  const src = [Float32Array.from({ length: 441 }, (_, i) => Math.sin(i / 10))];
  const same = resample(src, 44100, 44100);
  assert.equal(same, src, "no copy when the rates already match");

  const up = resample(src, 44100, 48000);
  assert.equal(up[0].length, 480, "441 frames at 44.1k become 480 at 48k");
  assert.ok(Math.abs(up[0][0] - src[0][0]) < 1e-6, "the first frame is preserved");
});
