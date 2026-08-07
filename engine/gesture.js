// dub_synth/gesture.js — the gesture grammar. Stage 4, second half.
//
// Koçer's own criteria for where one section of a dub techno track ends and the
// next begins are: an element added or removed, LPF/HPF use, an amplitude
// change, a harmonic modification (research/dub_techno_technique.md §7). Four of
// those five are things a hand does to a mixer, not things a composer writes.
// So the unit of composition here is a *gesture*: a named move on the desk at a
// time.
//
// A gesture is plain data — { type, at, ... } — so a performance is a list that
// can be planned, logged, seeded, diffed, and replayed. Applying one is the only
// place that touches audio nodes.

import { restingSend } from "./rig.js";

// Every gesture type, with the move it makes and why the genre makes it.
export const GESTURES = {
  // Subtraction is the primary motion device (§7.4). The break in Phylyps Trak is
  // a muted kick; the dip in Resonance is a muted shaker; the descent in
  // Listing, Sinking starts by muting the ride. Nothing is added to make them.
  mute: ({ mix }, g) => mix.mute(g.channel, true, g.at, g.seconds ?? 0.02),
  unmute: ({ mix }, g) => mix.mute(g.channel, false, g.at, g.seconds ?? 0.02),

  // Feedback up to mark a boundary, then back down for a soft decay — the
  // transition primitive (§3). In the dub originals the tail self-feeds about two
  // measures before the knob comes back.
  throwFeedback: ({ fx }, g) => {
    const bus = fx[g.bus];
    if (!bus?.throwFeedback) throw new Error(`bus "${g.bus}" cannot take a feedback throw`);
    bus.throwFeedback(g.at, { peak: g.peak ?? 0.92, rise: g.rise ?? 0.15, hold: g.hold ?? 1.0, fall: g.fall ?? 1.2 });
  },

  // The filter as a structural instrument. In The Salt On Her Cheeks everything
  // but kick and bass starts under a low-pass and the filter opening *is* the
  // arc; closing it again produces what Koçer calls "isolation" (§6).
  sweep: ({ fx }, g) => {
    const bus = fx[g.bus];
    if (!bus?.set) throw new Error(`bus "${g.bus}" cannot be swept`);
    bus.set(g.hpf !== undefined ? { hpf: g.hpf } : { lpf: g.to }, g.at);
  },

  // Riding a send moves a layer through space without touching its level. Aerial's
  // entire dynamic is this: "all elements that do not undergo significant changes
  // in amplitude are transformed and altered in their spatial perception through
  // knob movements" (§6).
  sendRide: (rig, g) => rig.mix.send(g.channel, g.bus, g.to, g.at, g.seconds ?? 0.8),
  sendReturn: (rig, g) => rig.mix.send(g.channel, g.bus, restingSend(rig.spec, g.channel, g.bus), g.at, g.seconds ?? 1.6),

  fader: ({ mix }, g) => mix.fader(g.channel, g.to, g.at, g.seconds ?? 0.6),
  pan: ({ mix }, g) => mix.pan(g.channel, g.to, g.at, g.seconds ?? 0.8),

  // Reverb decay is performed, not set once: Aerial's sixth section gets its
  // character from the reverb decay and the echo feedback moving together (§6).
  reverbDecay: ({ fx }, g) => {
    const bus = fx[g.bus];
    if (!bus?.setDecay) throw new Error(`bus "${g.bus}" has no decay`);
    bus.setDecay(g.to);
  },

  // The shimmer opening up — Resonance's outro pushes everything but the bassline
  // into a huge space rather than fading it (§6).
  shimmerRise: ({ fx }, g) => {
    const bus = fx[g.bus ?? "shimmer"];
    if (!bus?.setFeedback) throw new Error(`bus "${g.bus ?? "shimmer"}" is not a shimmer`);
    bus.setFeedback(g.to, g.at, g.seconds ?? 4);
  },
};

export function applyGesture(rig, g) {
  const fn = GESTURES[g.type];
  if (!fn) throw new Error(`unknown gesture "${g.type}"`);
  fn(rig, g);
  return g;
}

export function applyAll(rig, gestures) {
  for (const g of gestures) applyGesture(rig, g);
  return gestures.length;
}

// A drop-out: several channels muted together and brought back after `bars`.
// Returns gestures rather than applying them, so a plan stays inspectable.
export function dropOut(channels, at, seconds, { fade = 0.05 } = {}) {
  return [
    ...channels.map((channel) => ({ type: "mute", channel, at, seconds: fade })),
    ...channels.map((channel) => ({ type: "unmute", channel, at: at + seconds, seconds: fade })),
  ];
}
