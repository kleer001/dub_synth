# dub_synth

**An endless dub techno engine — a mixer you perform, built to a measured specification of the genre.**

### ▶ [Play it in the browser](https://kleer001.github.io/dub_synth/ui/)

Headless Node for rendering, plain ES modules for the live desk, zero runtime dependencies.

---

## The idea

Dub techno's own account of itself is that composition happens at the **mixer**, not on a grid.
One bar of riddim repeats unchanged while a hand rides feedback, filters, sends and mutes over
it. So the composable unit here is a *gesture on a channel*, and long-form structure is made by
taking things away rather than by adding parts.

That has consequences you can hear:

- **Three stab layers, each with its own echo.** The four-bar call-and-response comes from
  their decays intersecting — one shared echo bus collapses it into a single voice and the
  effect disappears.
- **A feedback walk anchored to the eighth note and deliberately detuned off it.** At 125 BPM
  that lands 2.2% sharp, slipping a whole cycle every ~5.6 bars — grid-adjacent and never
  locking, which is what a hand riding in time with a track actually does.
- **No sidechain ducking.** The wet sits under the dry by level. This is a source decision, not
  a stylistic one: across 302 pages the technique appears once, describing a different genre.
- **Sections of minutes, spaced irregularly.** Median 48 s, range 3 s to 3:11, with long
  plateaus early and boundaries clustering toward each climax. The drop is a removal.
- **Harmonic rate near zero.** Two chords over 32 bars is the whole budget.

## The specification is a document, not taste

Every design decision traces to the measurable layer of:

> Bahadırhan Koçer, *Dub Techno as Orphic Experience: Auditory Aesthetics, Spatiality, and
> Sound.* M.A. thesis, İstanbul Technical University, Musicology Programme, June 2023, 302 pp.
> Advisor: Ozan Baysal.
> **Open access:** <https://polen.itu.edu.tr/items/2205c9a9-6bbd-48d9-a382-afc55fa26803>

The thesis is half musicology and half media philosophy. Its philosophical spine is not
reproduced here. What is reproduced is the part with numbers in it: signal chains, named gear,
echo parameters, tempi, chord progressions, drum patterns, section timings, tonal balance.
Koçer's own measurements — his echo deconstruction and his six track analyses with spectra and
notation — are primary; what he attributes to others is marked as secondary in the digest.

`research/dub_techno_technique.md` is that digest, and the code cites its sections at the point
of use (`§2` for echo modulation, `§3` for the dry-frame rule, `§7` for structure). The source
PDF is not vendored; `ingest/` regenerates the corpus from it.

## Run it

```bash
git clone https://github.com/kleer001/dub_synth
cd dub_synth && npm install        # one dev dependency, for offline rendering

npm run desk                       # the live desk at http://127.0.0.1:8080
npm run render -- --seconds=300 --seed=7 --out=/tmp/dub.wav
```

| command | what it does |
|---|---|
| `npm run desk` | serve the live browser desk |
| `npm run render` | render offline to a WAV and measure it |
| `npm run plan` | print the section plan, no audio |
| `npm run headroom` | measure the master trim the rig should carry |
| `npm run stems` | solo every channel and bus, report each contribution |
| `npm run scan-kicks` | re-index a sample library for the kick shelf |
| `npm test` | pure logic, no audio context |

`render` also takes `--bpm`, `--kick=<name>`, `--noise=synth|sample`, `--type=static|vinyl|soundscape`,
and `--raw` to skip the bounce-time mastering pass.

The desk takes its settings as URL parameters: `?seed=7&bpm=125&type=vinyl`.

## Playing it

The desk is a mixer, not an arrangement view. Ten channels, seven bus returns, and the full
10×7 send matrix at full size — because riding a send is the primary dynamic in this music,
so it gets the space a piano roll would get elsewhere.

- **Drag faders.** The meter is the fader's own track; the faint line partway up each one is
  that channel's resting level from the rig, so you can see how far you have ridden from it.
- **Grab a violet knob** to override its automation. It goes `TOUCH`, the underlying walk keeps
  running, and releasing hands it back.
- **Drag matrix cells**, including the hatched ones — those are wired paths sitting at zero.
- **The arc ribbon** shows sections as the generator yields them. You can hold it or jump it.
  You cannot draw it.
- **The Riddim panel** changes the frame — drum pattern, progression, tonic, bass shape, kick,
  and how much the groove breathes. Changes land on the next bar line.

Sampled kicks need a local sample library, which the dev server mounts and the repo does not
vendor — WAV and AIFF are both decoded in-repo, so the shelf is not limited to whichever format
a pack happens to ship. The hosted desk plays the synthesized kick.

## Layout

```
index.html     the landing page
ui/            the live desk — index.html, app.js, engine.js (the realtime scheduler)
engine/        the instrument
  rig.js         DUB_RIG: channels, sends, bus returns, master trim — the desk as data
  gesture.js     the gesture vocabulary; gestures are plain data so a plan is inspectable
  perform.js     a generator that yields sections forever (this is what "endless" means)
  riddim.js      the dry frame — patterns, progressions, groove operators
  voices.js      sound sources as persistent, retriggered graphs
  corpus.js      the noise layer from samples; noise.js is the synthesized half
  kicks.js       the kick shelf
  master.js      bounce-time glue + look-ahead limiter, pure DSP over Float32Arrays
  dsp/           echo, spaces, mixer, knob, lfo, the effect library and 3 worklets
  core/          seeded RNG, DSP/FFT, music theory, WAV + AIFF, resampling, measurement
tools/         render, stems, serve, and the sample scanners
research/      the digest the whole thing is built to
data/          committed manifests; the audio they point at is not vendored
test/          pure logic
```

## Constraints worth knowing

Break these and something that currently works quietly stops.

- **Offline-renderable is non-negotiable.** No browser-only node in a required path. Worklets
  may be preferred but must degrade, because an `OfflineAudioContext` has no `audioWorklet` —
  and where the two paths differ in behaviour, the difference has to be governed. The shimmer's
  feedback loop is stable at 0.42 on the granular pitch shifter and grows at +9.6 dB/s on the
  phase vocoder, so its ceiling is per-shifter.
- **Never express a repeating part as a stream of events.** Scheduling one node per hit means
  the graph keeps every node it was given, so cost per audio-second climbs with length —
  measured at ~36× by five minutes, in both engines. Voices are persistent graphs whose
  envelopes are scheduled; fixed patterns are stamped into a bar and looped by one node.
- **Determinism.** Same seed → byte-identical WAV. Four independent RNG streams (plan, knobs,
  notes, impulses) so editing one layer does not reshuffle the others and ruin an A/B.
- **Levels are derived, not guessed.** `npm run stems` locates faults; `npm run headroom`
  prints the trim to paste back. Re-run after any change to channels, buses, returns or voices.
  Targets: true peak ≤ −1 dBFS, zero clipped samples, crest ≥ 9 dB, width −10…−20 dB.
- **Reverb impulses are normalised to unit energy** and `ConvolverNode.normalize` is off,
  otherwise a bus return level tracks decay time instead of the fader.

## License

MIT. See [LICENSE](LICENSE).

The thesis this is built from is the author's own work, cited above and freely available; none
of it is reproduced here beyond the technical measurements a specification needs.
