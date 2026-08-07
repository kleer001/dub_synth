// Minimal PCM WAV encode/decode (pure, zero-dep). Used by: the headless found-rhythm
// pipeline test (decode a real WAV in Node), fetch_samples.mjs (render local loops),
// and the browser bounce/resample path (OfflineAudioContext → WAV download).

export function encodeWav(channels, sampleRate) {
  const numCh = channels.length;
  const len = channels[0].length;
  const blockAlign = numCh * 2; // 16-bit
  const dataSize = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(buf);
  let p = 0;
  const str = (s) => { for (let i = 0; i < s.length; i++) dv.setUint8(p++, s.charCodeAt(i)); };
  const u32 = (v) => { dv.setUint32(p, v, true); p += 4; };
  const u16 = (v) => { dv.setUint16(p, v, true); p += 2; };
  str("RIFF"); u32(36 + dataSize); str("WAVE");
  str("fmt "); u32(16); u16(1); u16(numCh); u32(sampleRate); u32(sampleRate * blockAlign); u16(blockAlign); u16(16);
  str("data"); u32(dataSize);
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      dv.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      p += 2;
    }
  }
  return buf;
}

// Robust chunk-walking decoder for 8/16/32-bit PCM and 32-bit float WAV.
export function decodeWav(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("not a WAV file");
  let p = 12, fmt = null, dataOffset = -1, dataSize = 0;
  while (p + 8 <= dv.byteLength) {
    const id = tag(p);
    const size = dv.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "fmt ") {
      fmt = {
        format: dv.getUint16(body, true),
        channels: dv.getUint16(body + 2, true),
        sampleRate: dv.getUint32(body + 4, true),
        bits: dv.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
    }
    p = body + size + (size & 1);
  }
  if (!fmt || dataOffset < 0) throw new Error("missing fmt/data chunk");
  const { channels, sampleRate, bits, format } = fmt;
  const bytes = bits / 8;
  const frames = Math.floor(dataSize / (bytes * channels));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const o = dataOffset + (i * channels + c) * bytes;
      let s;
      if (bits === 16) s = dv.getInt16(o, true) / 0x8000;
      else if (bits === 8) s = (dv.getUint8(o) - 128) / 128;
      else if (bits === 32 && format === 3) s = dv.getFloat32(o, true);
      else if (bits === 32) s = dv.getInt32(o, true) / 0x80000000;
      else if (bits === 24) {
        const b0 = dv.getUint8(o), b1 = dv.getUint8(o + 1), b2 = dv.getUint8(o + 2);
        let v = b0 | (b1 << 8) | (b2 << 16);
        if (v & 0x800000) v |= ~0xffffff;
        s = v / 0x800000;
      } else s = 0;
      out[c][i] = s;
    }
  }
  return { sampleRate, channels: out };
}

// Mono-mix helper.
export function toMono(decoded) {
  const { channels, sampleRate } = decoded;
  if (channels.length === 1) return { sampleRate, data: channels[0] };
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const ch of channels) s += ch[i];
    out[i] = s / channels.length;
  }
  return { sampleRate, data: out };
}
