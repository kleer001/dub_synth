# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

An endless dub techno engine. The genre's own account of itself is that composition happens at
the **mixer**, not on a grid: one bar of riddim repeats unchanged while a hand rides feedback,
filters, sends and mutes over it. So the composable unit here is a *gesture on a channel*, and
long-form structure is made by taking things away.

Headless Node, zero runtime dependencies, everything driven through an `OfflineAudioContext`.

## Commands

```bash
npm run render -- --seconds=300 --seed=7 --out=/tmp/dub.wav
npm run render -- --plan          # section plan, no audio
npm run render -- --headroom      # measure the master trim the rig should carry
npm run render -- --raw           # skip the bounce-time mastering pass
npm run stems                     # solo every channel and bus, report each contribution
npm run scan-samples              # re-index the sample library for the noise layer
npm test                          # node --test test/**/*.test.js — pure logic, no audio context
```

`render.mjs` also takes `--noise=synth|sample --type=static|vinyl|soundscape --bpm=N`.

## The specification is a document, not taste

Every design decision traces to `research/dub_techno_technique.md` — a digest of Koçer's 2023
İTÜ thesis, which contains measured echo parameters, six notated track analyses, and section
timings from which the long-form model is derived. **Cite the section at the point of use in a
comment**, the way the existing files do (`§2` for echo modulation, `§3` for the dry-frame rule,
`§7` for structure). Before changing musical behaviour, read the relevant section rather than
reasoning from genre intuition — intuition imported from adjacent genres has been wrong here more
than once.

`ingest/` regenerates the corpus the digest was built from. The source PDF is not vendored;
re-fetch it into `research/sources/` from
`https://polen.itu.edu.tr/items/2205c9a9-6bbd-48d9-a382-afc55fa26803` and run
`node ingest/ingest.mjs`.

## Architecture

```
render.mjs   the harness: rig → performance plan → riddim → render → master → measure
stems.mjs    the mix diagnostic; use it before changing any level
rig.js       DUB_RIG: channels, sends, bus returns, master trim — the desk as data
gesture.js   the gesture vocabulary; gestures are plain data so a plan is inspectable
perform.js   a generator that yields sections forever (this is what "endless" means)
riddim.js    the dry frame — patterns, progressions, groove operators
voices.js    sound sources as persistent, retriggered graphs
corpus.js    the noise layer, sample or synth, chosen explicitly
master.js    bounce-time glue + look-ahead limiter, pure DSP over Float32Arrays
dsp/         echo, spaces, mixer, knob, lfo, and the full effect library + 3 worklets
core/        seeded RNG, DSP/FFT, music theory, WAV, measurement
```

## Load-bearing constraints

Break any of these and something that currently works will quietly stop.

- **Offline-renderable is non-negotiable.** No browser-only node in a required path. Worklets may
  be *preferred* but must degrade to native nodes, because an `OfflineAudioContext` has no
  `audioWorklet`.
- **Never allocate audio nodes per note.** Voices are persistent graphs whose envelopes and
  pitches are scheduled. Per-hit allocation makes render cost climb with length — measured at ~5×
  the sum of its parts after 30 seconds — which an endless engine cannot afford. The tradeoff to
  respect: a voice cannot overlap itself.
- **Determinism.** Same seed → byte-identical WAV. `core/dsp.js` seeds its noise from its own
  parameters (FNV-1a over the arguments), and `render.mjs` derives four independent streams from
  the seed (plan, knobs, notes, impulses) so editing one layer does not reshuffle the others and
  ruin an A/B. Verify with two renders and `cmp`.
- **No sidechain ducking.** The wet sits under the dry by level (§3's dry backcloth). This is a
  source decision, not a stylistic one.
- **Reverb impulses are normalised to unit energy** and `ConvolverNode.normalize` is off. Web
  Audio's own flag rescales by the impulse's energy, which is ~40 dB of attenuation on a
  synthesized multi-second IR and makes a bus return level track decay time instead of the fader.

## Mixing and mastering

Levels are derived, not guessed.

1. `npm run stems` — solos every channel and bus and reports rms / peak / crest / share. Use it
   before changing a level. It is what located every mix fault so far.
2. `npm run render -- --headroom` — flattens the master bus, measures the p99.9 *sustained* level,
   and prints the `DUB_RIG.master` trim to paste back. **Re-run after any change to channels,
   buses, returns or voices.**
3. `master.js` returns `notes` naming what is wrong with the *mix* when the limiter or the glue
   has to work too hard, rather than quietly squashing it.

Targets, inherited from the parent project's audio checklist: true peak ≤ −1 dBFS, zero clipped
samples, crest ≥ 9 dB (healthy 9–13; higher means dynamic, not hot), full-mix width −10…−20 dB.
Mono-sum loss matters — this is a sound-system genre. **Never present a render you have not
measured.**

Do not reach for a `DynamicsCompressor` in the graph: under `node-web-audio-api` it does not
limit, it inflates to roughly a constant level regardless of input, so anything built on it
measures as a lie offline and behaves differently in a browser. Dynamics that need real detection
belong in `master.js`, where they are computed exactly.

## Working method

- **Measure, don't guess.** When the artifact is a signal, build an objective read and look at the
  numbers before forming a theory. A large-window FFT, a band split, a stem report.
- **Distrust the instrument before the output.** If a measurement disagrees with what you hear,
  suspect the harness first. A stem report that silently soloed nothing, and a convolver that was
  40 dB down, both looked like mix problems and were not.
- **After one failed attempt, stop guessing and bisect.** Reduce to a minimal reproduction and
  diff against a known-good control.
- **A metric that does not separate your labelled cases is not a metric.** Three candidate
  tonal-vs-noise classifiers were tried against hand-labelled files and all three failed; the
  scanner records them as advisory rather than shipping a classifier that does not work.
