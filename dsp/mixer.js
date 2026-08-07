// dub_synth/dsp/mixer.js — the desk, as the instrument.
//
// The riddim model makes the sound-system operator a "macro-composer": someone
// who composes by deconstructing and reconstructing a finished whole in
// performance, with every instrument track individually manipulable through
// processors and faders (research/dub_techno_technique.md §4). Structure in the
// analysed records is made almost entirely of mixer gestures — muting the kick
// makes the break, muting the shaker makes the dip, muting the ride starts the
// descent (§7). So the mixer is not plumbing here; it is where the composition
// happens.
//
// Buses are named and arbitrary in number on purpose. Resonance's three stab
// layers each need their own echo, because the piece's four-bar call-and-
// response is produced by their *decays intersecting* — one shared echo bus
// cannot make that sound (§6, §8).

import { audible, ride } from "./knob.js";

export function makeDubMixer(ctx, { channels = [], buses = [] } = {}) {
  const output = ctx.createGain();
  const master = ctx.createGain();
  master.connect(output);

  // A bus is an insertion point: whatever FX block the caller drops in sits
  // between `input` and the master. Returns are post-FX, so riding a send
  // level rides how much of that channel the space hears — not its volume.
  // Every bus has a return level. Leaving returns at unity is what lets a wet
  // mix swamp its own dry signal: three echoes and three reverbs all summing at
  // 1.0 will always out-shout a kick, however high its fader goes.
  const busMap = new Map();
  for (const name of buses) {
    const input = ctx.createGain();
    const returnGain = ctx.createGain();
    returnGain.gain.value = 1;
    returnGain.connect(master);
    busMap.set(name, { name, input, return: returnGain, fx: null });
  }

  const chanMap = new Map();
  for (const name of channels) {
    const input = ctx.createGain();
    const fader = ctx.createGain();
    const mute = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const sends = new Map();

    input.connect(fader).connect(mute).connect(panner).connect(master);
    // Sends are post-fader, pre-mute: muting a channel silences its dry signal
    // while its echo tail keeps ringing. That tail-after-the-mute is the dub
    // drop-out, and wiring the send post-mute would throw it away.
    for (const [busName, bus] of busMap) {
      const send = ctx.createGain();
      send.gain.value = 0;
      fader.connect(send).connect(bus.input);
      sends.set(busName, send);
    }
    chanMap.set(name, { name, input, fader, mute, panner, sends });
  }

  const chan = (name) => {
    const c = chanMap.get(name);
    if (!c) throw new Error(`no channel "${name}"`);
    return c;
  };
  const bus = (name) => {
    const b = busMap.get(name);
    if (!b) throw new Error(`no bus "${name}"`);
    return b;
  };

  return {
    output, master,
    channels: chanMap, buses: busMap,
    channel: chan,
    bus,

    // Drop an FX block ({ input, output }) into a bus.
    insert(busName, fx) {
      const b = bus(busName);
      if (b.fx) throw new Error(`bus "${busName}" already has an insert`);
      b.input.connect(fx.input);
      fx.output.connect(b.return);
      b.fx = fx;
      return this;
    },

    // The genre's primary structural gesture (§7): sections are marked by
    // taking things away. `seconds` is the fade — 0.02 for a hard mute, longer
    // for the slow disappearances the outros use.
    mute(name, on, at, seconds = 0.02) {
      const g = chan(name).mute.gain;
      if (at === undefined) { g.value = on ? audible(0) : 1; return this; }
      ride(g, on ? audible(0) : 1, at, seconds);
      return this;
    },

    // The return level for a bus — how loud the space itself is, independent of
    // how much any channel sends to it.
    busLevel(busName, level, at, seconds = 0.4) {
      const g = bus(busName).return.gain;
      if (at === undefined) { g.value = level; return this; }
      ride(g, level, at, seconds);
      return this;
    },

    fader(name, level, at, seconds = 0.25) {
      const g = chan(name).fader.gain;
      if (at === undefined) { g.value = level; return this; }
      ride(g, level, at, seconds);
      return this;
    },

    pan(name, position, at, seconds = 0.25) {
      const g = chan(name).panner.pan;
      if (at === undefined) { g.value = position; return this; }
      ride(g, position, at, seconds);
      return this;
    },

    // Riding a send is how a layer is pushed into or pulled out of a space
    // without touching its level — Aerial's whole dynamic (§6): "all elements
    // that do not undergo significant changes in amplitude are transformed and
    // altered in their spatial perception through knob movements."
    send(name, busName, level, at, seconds = 0.4) {
      const c = chan(name);
      const g = c.sends.get(busName);
      if (!g) throw new Error(`channel "${name}" has no send to "${busName}"`);
      if (at === undefined) { g.gain.value = level; return this; }
      ride(g.gain, level, at, seconds);
      return this;
    },
  };
}
