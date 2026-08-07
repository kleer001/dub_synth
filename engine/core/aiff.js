// Minimal AIFF / AIFC decode (pure, zero-dep), returning the same shape as
// decodeWav so callers can treat the two interchangeably.
//
// AIFF is Apple's answer to RIFF and differs in three ways that each break a
// decoder written from WAV habits:
//
//   1. Everything is BIG-endian, including the chunk sizes.
//   2. The sample rate is an 80-bit IEEE 754 extended float, a format nothing
//      else in the stack uses and which JavaScript has no primitive for.
//   3. 8-bit samples are SIGNED. WAV's are unsigned with a 128 bias, so reusing
//      that path puts a DC offset of half full scale on every 8-bit file.
//
// AIFC is the same container with a compression type on the COMM chunk. The
// uncompressed types are handled — 'NONE'/'twos' (big-endian PCM), 'sowt'
// (little-endian PCM, which is what most Mac tools actually write), and the
// float variants. Anything genuinely compressed throws rather than returning
// something plausible and wrong.

// The 80-bit extended float: sign(1) exponent(15) mantissa(64), with the leading
// integer bit explicit rather than implied as in float32/64. Read as
// mantissa * 2^(exponent - 16383 - 63).
function readExtended(dv, off) {
  const expField = dv.getUint16(off, false);
  const sign = expField & 0x8000 ? -1 : 1;
  const exponent = expField & 0x7fff;
  const hi = dv.getUint32(off + 2, false);
  const lo = dv.getUint32(off + 6, false);
  if (exponent === 0 && hi === 0 && lo === 0) return 0;
  const mantissa = hi * 2 ** 32 + lo;
  return sign * mantissa * 2 ** (exponent - 16383 - 63);
}

export function decodeAiff(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== "FORM") throw new Error("not an AIFF file (no FORM)");
  const form = tag(8);
  if (form !== "AIFF" && form !== "AIFC") throw new Error(`not an AIFF file (FORM type "${form}")`);

  let p = 12;
  let channels = 0, frames = 0, bits = 0, sampleRate = 0, compression = "NONE";
  let dataOffset = -1, dataBytes = 0;

  while (p + 8 <= dv.byteLength) {
    const id = tag(p);
    const size = dv.getUint32(p + 4, false);
    const body = p + 8;
    if (id === "COMM") {
      channels = dv.getInt16(body, false);
      frames = dv.getUint32(body + 2, false);
      bits = dv.getInt16(body + 6, false);
      sampleRate = readExtended(dv, body + 8);
      if (form === "AIFC" && size >= 22) compression = tag(body + 18);
    } else if (id === "SSND") {
      // SSND carries its own offset and blockSize before the samples.
      const ssndOffset = dv.getUint32(body, false);
      dataOffset = body + 8 + ssndOffset;
      dataBytes = Math.max(0, size - 8 - ssndOffset);
    }
    p = body + size + (size % 2);          // chunks are padded to even lengths
  }

  if (!channels || !sampleRate) throw new Error("AIFF has no usable COMM chunk");
  if (dataOffset < 0) throw new Error("AIFF has no SSND chunk");

  const little = compression === "sowt";
  const isFloat = compression === "fl32" || compression === "FL32" ||
                  compression === "fl64" || compression === "FL64";
  if (!little && !isFloat && compression !== "NONE" && compression !== "twos") {
    throw new Error(`AIFF compression "${compression}" is not decodable here — uncompressed only`);
  }
  if (isFloat) bits = compression === "fl64" || compression === "FL64" ? 64 : 32;

  const bytes = Math.ceil(bits / 8);
  const available = Math.floor(dataBytes / (bytes * channels));
  const n = frames > 0 ? Math.min(frames, available) : available;
  const out = Array.from({ length: channels }, () => new Float32Array(n));

  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      const o = dataOffset + (i * channels + c) * bytes;
      let s;
      if (isFloat) s = bits === 64 ? dv.getFloat64(o, little) : dv.getFloat32(o, little);
      else if (bits === 16) s = dv.getInt16(o, little) / 0x8000;
      else if (bits === 8) s = dv.getInt8(o) / 128;          // signed, unlike WAV
      else if (bits === 32) s = dv.getInt32(o, little) / 0x80000000;
      else if (bits === 24) {
        const b0 = dv.getUint8(o), b1 = dv.getUint8(o + 1), b2 = dv.getUint8(o + 2);
        let v = little ? (b0 | (b1 << 8) | (b2 << 16)) : ((b0 << 16) | (b1 << 8) | b2);
        if (v & 0x800000) v |= ~0xffffff;
        s = v / 0x800000;
      } else s = 0;
      out[c][i] = s;
    }
  }
  return { sampleRate, channels: out };
}

// Decode by container rather than by extension, so a caller that has bytes and
// no filename still gets the right one.
export function sniffAudio(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  if (dv.byteLength < 12) return null;
  const t = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (t(0) === "RIFF" && t(8) === "WAVE") return "wav";
  if (t(0) === "FORM" && (t(8) === "AIFF" || t(8) === "AIFC")) return "aiff";
  return null;
}
