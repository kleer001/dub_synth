// dub_synth/dsp/knob.js — the hand on the knob.
//
// Dub's motion comes from a person moving parameters during the mix, not from
// notes changing (research/dub_techno_technique.md §3, §4). Koçer reproduces
// that hand with an LFO set to a **random waveshape at a non-synchronised
// rate** — explicitly not sine or square, because predictability is what the
// gesture is meant to defeat (§2).
//
// Web Audio has no random-waveshape LFO node, and an AudioWorklet would break
// the offline-render requirement. So the walk is *scheduled* onto the
// AudioParam ahead of time. That also keeps it inside core/rng.js's seeded
// contract: same seed → same performance → reproducible renders.

const FLOOR = 0.0001;

// A deliberate move of a knob: hold, then travel to `to` over `seconds`.
// This is the transition primitive — §3: "increasing the amount of feedback is
// a dominating notion for reinforcing, embellishing, or organizing the
// transition from one part to the next."
export function ride(param, to, at, seconds = 0.25) {
  param.cancelScheduledValues(at);
  param.setValueAtTime(param.value, at);
  param.linearRampToValueAtTime(to, at + Math.max(0.001, seconds));
  return param;
}

// The random-waveshape LFO. Steps to a new uniform value every 1/rate seconds,
// gliding into it over `smooth` of the step (smooth 1 = continuous motion,
// smooth 0 = sample-and-hold jumps).
//
// Koçer's measured settings (§2): feedback amount driven at rate 4.26 Hz;
// delay time driven at a 1/4-note rate with 100% smoothing and its range
// clamped to 40–80% to keep the pitch artefacts from running away.
// `from` is for a walk that is being re-armed rather than started: an endless
// player schedules a walk in spans, and without it every span boundary would
// jump the parameter to a fresh random value. Given the value the walk is
// actually sitting at, the first move ramps out of it instead, so the seam is
// inaudible. A one-shot walk (the whole-render case) omits it and is unchanged.
export function randomWalk(param, { rng, rate, min, max, smooth = 1, start = 0, seconds, from }) {
  if (!(rate > 0)) throw new Error("randomWalk needs a positive rate");
  if (!(seconds > 0)) throw new Error("randomWalk needs a positive duration");
  const step = 1 / rate;
  const glide = Math.min(Math.max(smooth, 0), 1) * step;
  const end = start + seconds;

  param.cancelScheduledValues(start);
  let value = rng.float(min, max);
  if (from === undefined) {
    param.setValueAtTime(value, start);
  } else {
    param.setValueAtTime(from, start);
    if (glide > 0) param.linearRampToValueAtTime(value, Math.min(start + glide, end));
    else param.setValueAtTime(value, start);
  }

  let events = 1;
  for (let t = start + step; t < end; t += step) {
    const next = rng.float(min, max);
    if (glide > 0) {
      param.setValueAtTime(value, t);
      param.linearRampToValueAtTime(next, Math.min(t + glide, end));
    } else {
      param.setValueAtTime(next, t);
    }
    value = next;
    events++;
  }
  return events;
}

// A plain sine LFO as a live signal, summed into the param. Used for the slow
// non-synchronous drift Koçer puts on filter cutoff — 0.11 Hz against the
// feedback walk's 4.26 Hz, a ratio near 39:1, so the two never line up (§2).
//
// `centre` sets the param's own value; the oscillator swings ±depth around it.
export function sineLfo(ctx, param, { rate, depth, centre, start = 0 }) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.value = rate;
  const amount = ctx.createGain();
  amount.gain.value = depth;
  osc.connect(amount).connect(param);
  if (centre !== undefined) param.value = centre;
  osc.start(start);
  return { osc, depth: amount.gain };
}

// Exponential ramps need a non-zero floor; mutes and send rides use this.
export const audible = (v) => Math.max(FLOOR, v);
