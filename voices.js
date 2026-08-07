// dub_synth/voices.js — the sound sources.
//
// Sparse music exposes everything, so these are built to the genre's stated
// specifications rather than to generic taste
// (research/dub_techno_technique.md §5):
//
//   kick   — "thumpy and stiff", and the axis everything else shapes around;
//            in Aerial it also carries the low end outright, because the track
//            has no bass instrument.
//   snare  — snappy, NO low end below 250 Hz, pitched up, bit-crushed and
//            downsampled, then high-passed around 150 Hz after processing.
//   stab   — resolution lowered and made jagged; a band-pass whose cutoff is
//            randomised by a low-Hz LFO to kill harshness; the result reads soft
//            because its high end is deliberately weakened.
//
// **Every voice is a persistent graph that is retriggered, never a graph built
// per note.** This is a hard requirement for an engine meant to run without end.
// Allocating nodes per hit means the node count grows without bound and the
// render loop revisits every one of them each block, so cost per second of audio
// climbs the longer you play — measured here at roughly 5x the sum of its parts
// after only 30 seconds. A fixed pool of oscillators and one looping noise
// buffer, with envelopes and pitches scheduled onto them, is flat instead.
//
// The consequence to respect: one voice cannot overlap itself. At this genre's
// tempo and decay times nothing does — the closest call is the shaker at 16ths
// (120 ms apart, 55 ms decay).
//
// Two voices run a slow seeded walk on their own filter — the stab's band-pass
// (§5's step for taking the harshness off) and the pad's cutoff, which is the
// pad's only motion (§7.7). A render knows how long it is and arms those once.
// A player does not, so each such voice also publishes its walk as a `walks`
// descriptor and `armVoiceWalks` re-arms it in spans. Without that the walks are
// only as long as whatever `seconds` they were built with, and the instrument
// quietly stops moving when it runs out.

import { bitCurve, satCurve, whiteNoise } from "./core/dsp.js";
import { randomWalk } from "./dsp/knob.js";

const FLOOR = 0.0001;

// Re-arm a voice's own walks over [start, start+seconds). `from` keeps the seam
// continuous; see dsp/knob.js.
export function armVoiceWalks(voice, { rng, start = 0, seconds }) {
  let n = 0;
  for (const w of voice?.walks ?? []) {
    randomWalk(w.param, {
      rng, rate: w.rate, min: w.min, max: w.max, smooth: 1,
      start, seconds, from: w.param.value,
    });
    n++;
  }
  return n;
}

// Retrigger an envelope on a persistent gain. cancelScheduledValues keeps a hit
// that lands during a previous tail from summing with it.
function strike(gain, at, peak, attack, decay) {
  gain.cancelScheduledValues(at);
  gain.setValueAtTime(FLOOR, at);
  gain.linearRampToValueAtTime(peak, at + attack);
  gain.exponentialRampToValueAtTime(FLOOR, at + attack + decay);
}

export function makeVoices(ctx, { rng, seconds, beat = 0.48 } = {}) {
  // One noise buffer and one looping source per percussive voice — not per hit.
  const noiseBuffer = whiteNoise(ctx, 2, { seed: rng ? rng.int(1, 1e6) : 0 });

  const noiseVoice = (dest, { hp = 7000, lp = 16000, pan = 0 } = {}) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    const hpf = ctx.createBiquadFilter(); hpf.type = "highpass"; hpf.frequency.value = hp;
    const lpf = ctx.createBiquadFilter(); lpf.type = "lowpass"; lpf.frequency.value = lp;
    const g = ctx.createGain(); g.gain.value = FLOOR;
    let tail = src.connect(hpf).connect(lpf).connect(g);
    if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; tail = tail.connect(p); }
    tail.connect(dest);
    src.start(0);
    return { gain: g.gain, hpf, lpf };
  };

  return {
    // Sine with a fast pitch drop. The rumble is a second, lower tail — one of the
    // conventional techno characteristics Phylyps Trak embodies.
    //
    // The rumble decay is clamped to fit INSIDE the beat. A tail longer than the
    // gap between kicks stops being a tail and becomes a continuous sub drone: it
    // then owns the mix by RMS while having no transient at all, and it masks its
    // own attack. Measured, that failure reads as a kick stem at 7 dB crest —
    // a kick should be nearer 15-20.
    kick(dest, { rumble = 0.22, rumbleDecay = beat * 0.55 } = {}) {
      const o = ctx.createOscillator();
      const g = ctx.createGain(); g.gain.value = FLOOR;
      o.type = "sine"; o.frequency.value = 43;
      o.connect(g).connect(dest);
      o.start(0);

      let r = null, rg = null;
      if (rumble > 0) {
        r = ctx.createOscillator();
        rg = ctx.createGain(); rg.gain.value = FLOOR;
        const rl = ctx.createBiquadFilter(); rl.type = "lowpass"; rl.frequency.value = 110;
        r.type = "sine"; r.frequency.value = 41;
        r.connect(rl).connect(rg).connect(dest);
        r.start(0);
      }
      return {
        at(t, { peak = 0.9 } = {}) {
          o.frequency.cancelScheduledValues(t);
          o.frequency.setValueAtTime(125, t);
          o.frequency.exponentialRampToValueAtTime(43, t + 0.085);
          strike(g.gain, t, peak, 0.003, 0.30);
          if (rg) strike(rg.gain, t + 0.01, rumble, 0.02, Math.min(rumbleDecay, beat * 0.8));
        },
      };
    },

    // Low saw under a low-pass. Kept dry and centred: the sub is the one thing
    // that must not be smeared by the wet layer.
    bass(dest) {
      const o = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain(); g.gain.value = FLOOR;
      o.type = "sawtooth"; o.frequency.value = 98;
      lp.type = "lowpass"; lp.frequency.value = 240; lp.Q.value = 0.9;
      o.connect(lp).connect(g).connect(dest);
      o.start(0);
      return {
        at(t, hz, dur, { peak = 0.5, dead = false } = {}) {
          o.frequency.setValueAtTime(hz, t);
          // A dead note is muted and percussive — it reads as rhythm, not pitch (§4).
          lp.frequency.setValueAtTime(dead ? 160 : 240, t);
          strike(g.gain, t, dead ? peak * 0.5 : peak, 0.02, dead ? 0.06 : dur);
        },
      };
    },

    // The Basic Channel stab chain: jagged (bit reduction), band-pass with a
    // randomised cutoff, high end weakened so it lands "soft". `tones` fixes how
    // many oscillators the voice owns; a chord with fewer simply silences the rest.
    // Cutoff defaults to 450 Hz: Attack Magazine's Basic Channel recipe puts the
    // stab's Auto Filter in bandpass at a 12 dB slope around 450 Hz with moderate
    // resonance, which is far darker than a first guess would place it — and the
    // darkness is most of why the sound reads as "dub chord" rather than "synth
    // chord". A BiquadFilter is 2-pole, matching that 12 dB slope.
    stab(dest, { cutoff = 450, crush = 0.5, pan = 0, tones = 4 } = {}) {
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass"; bp.frequency.value = cutoff; bp.Q.value = 0.9;
      const shaper = ctx.createWaveShaper();
      shaper.curve = bitCurve(6);
      const clean = ctx.createGain(); clean.gain.value = 1 - crush;
      const dirty = ctx.createGain(); dirty.gain.value = crush;
      const sum = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = 2600; lp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = FLOOR;

      const oscs = Array.from({ length: tones }, () => {
        const o = ctx.createOscillator();
        const og = ctx.createGain(); og.gain.value = 0;
        o.type = "square"; o.frequency.value = 440;
        o.connect(og).connect(bp);
        o.start(0);
        return { o, g: og.gain };
      });

      bp.connect(clean).connect(sum);
      bp.connect(dirty).connect(shaper).connect(sum);
      let tail = sum.connect(lp).connect(g);
      if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; tail = tail.connect(p); }
      tail.connect(dest);

      // The band-pass cutoff randomised by a low-Hz LFO — the step the Basic
      // Channel recipe uses to take the harshness off the stab (§5).
      const walks = [{ param: bp.frequency, rate: 0.35, min: cutoff * 0.7, max: cutoff * 1.6 }];
      if (rng && seconds) {
        randomWalk(bp.frequency, { rng, rate: 0.35, min: cutoff * 0.7, max: cutoff * 1.6, smooth: 1, seconds });
      }

      return {
        walks,
        at(t, hzs, { peak = 0.5, dur = 0.16 } = {}) {
          oscs.forEach((v, i) => {
            if (i < hzs.length) { v.o.frequency.setValueAtTime(hzs[i], t); v.g.setValueAtTime(1 / hzs.length, t); }
            else v.g.setValueAtTime(0, t);
          });
          strike(g.gain, t, peak, 0.004, dur);
        },
      };
    },

    // Snappy, stripped of everything below 250 Hz, and high-passed again at
    // 150 Hz after processing.
    snare(dest) {
      const n = noiseVoice(dest, { hp: 250, lp: 9000 });
      const o = ctx.createOscillator();
      const g = ctx.createGain(); g.gain.value = FLOOR;
      const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 150;
      o.type = "triangle"; o.frequency.value = 190;
      o.connect(hp).connect(g).connect(dest);
      o.start(0);
      return {
        at(t, { peak = 0.45 } = {}) {
          strike(n.gain, t, peak, 0.002, 0.16);
          o.frequency.cancelScheduledValues(t);
          o.frequency.setValueAtTime(330, t);
          o.frequency.exponentialRampToValueAtTime(190, t + 0.06);
          strike(g.gain, t, peak * 0.5, 0.002, 0.09);
        },
      };
    },

    hat(dest) {
      const n = noiseVoice(dest, { hp: 7500 });
      return { at: (t, { peak = 0.5 } = {}) => strike(n.gain, t, peak, 0.001, 0.035) };
    },

    shaker(dest) {
      const n = noiseVoice(dest, { hp: 5200, lp: 12000 });
      return { at: (t, { peak = 0.35 } = {}) => strike(n.gain, t, peak, 0.004, 0.055) };
    },

    // The wooden percussive instrument heard off to one side in Listing, Sinking.
    perc(dest, { hz = 780, pan = 0.55 } = {}) {
      const o = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain(); g.gain.value = FLOOR;
      const p = ctx.createStereoPanner(); p.pan.value = pan;
      o.type = "triangle"; o.frequency.value = hz;
      bp.type = "bandpass"; bp.frequency.value = hz; bp.Q.value = 6;
      o.connect(bp).connect(g).connect(p).connect(dest);
      o.start(0);
      return { at: (t, { peak = 0.4 } = {}) => strike(g.gain, t, peak, 0.001, 0.10) };
    },

    // A continuous chord bed rather than a triggered voice: the pad in these
    // records holds for 32 bars at a time, and its motion is the filter, not the
    // notes. The cutoff walks slowly under the same seeded hand as everything
    // else (§2).
    pad(dest, hzs, { peak = 0.10, cutoff = 700, warmth = 0.4 } = {}) {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass"; lp.frequency.value = cutoff; lp.Q.value = 1.1;
      const sat = ctx.createWaveShaper();
      sat.curve = satCurve(0.6);
      const clean = ctx.createGain(); clean.gain.value = 1 - warmth;
      const dirty = ctx.createGain(); dirty.gain.value = warmth;
      const sum = ctx.createGain();
      const g = ctx.createGain(); g.gain.value = peak;

      for (const hz of hzs) {
        for (const detune of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = "sawtooth"; o.frequency.value = hz; o.detune.value = detune;
          o.connect(lp);
          o.start(0);
        }
      }
      lp.connect(clean).connect(sum);
      lp.connect(dirty).connect(sat).connect(sum);
      sum.connect(g).connect(dest);

      const walks = [{ param: lp.frequency, rate: 0.05, min: 320, max: 1500 }];
      if (rng && seconds) {
        randomWalk(lp.frequency, { rng, rate: 0.05, min: 320, max: 1500, smooth: 1, seconds });
      }
      return { walks, cutoff: lp.frequency, level: g.gain };
    },
  };
}
