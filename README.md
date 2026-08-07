# dub_synth

An endless dub techno engine: a mixer you perform, rather than a sequence you play.

Dub techno's own account of itself is that the composition happens at the desk. The riddim —
one bar of kick, bass and off-beat stabs — repeats unchanged while a hand moves feedback,
filters, sends and mutes over the top of it. That is the shape of this engine. The composable
unit is a **gesture on a channel**, not a note on a grid, and structure is made by *taking
things away* across minute-scale sections.

It runs headless in Node through an `OfflineAudioContext`, with zero runtime dependencies.

## Where the specification came from

Every design decision here cites [`research/dub_techno_technique.md`](research/dub_techno_technique.md),
a digest derived from Bahadırhan Koçer's M.A. thesis *Dub Techno as Orphic Experience: Auditory
Aesthetics, Spatiality, and Sound* (İstanbul Technical University, Musicology, 2023, 302 pp.,
[open access](https://polen.itu.edu.tr/items/2205c9a9-6bbd-48d9-a382-afc55fa26803)).

The thesis is half musicology and half media philosophy. The digest keeps only the measurable
layer — echo parameters with numbers, tempi, chord progressions, drum patterns, section timings,
tonal balance — and that layer is unusually concrete, because Koçer reconstructed the dub echo
from scratch in Ableton and measured it:

- Feedback under a **random-waveshape LFO at a non-synchronised 4.26 Hz**, against a **0.11 Hz
  sine** on the low-pass cutoff. The ratio is ~39:1 on purpose, so the motion never repeats.
- A **±8% stereo delay-time offset** — that alone produces the "flawed" human timing, with no
  panning modulation involved.
- A **time-based** delay whose delay time is modulated, which is what makes dub's pitch artefacts
  on the tail. A beat-synced delay cannot make that sound.
- *Listing, Sinking*'s measured stab echo: **237 ms dotted, 50% feedback, 70% wet**.

`ingest/` carries the machinery that produced the digest: the full thesis as a page-indexed
corpus, a section map tagging each of 44 sections technical / prose / mixed, and the 36 rendered
pages whose notation, spectra and structure charts text extraction cannot reach. The source PDF
itself is not vendored; re-fetch it from the link above and run `node ingest/ingest.mjs`.

## Run it

```sh
npm install                       # node-web-audio-api, dev-only
npm run render -- --seconds=300   # → /tmp/dub.wav, with a full measurement report
npm run plan                      # print the section plan without rendering
npm run stems                     # solo every channel and bus; see what each contributes
npm run headroom                  # measure the master trim the rig should carry
npm test
```

Renders are **byte-reproducible from their seed** — `--seed=7` twice gives the identical file.
That is load-bearing, not a nicety: it is what makes an A/B meaningful.

```sh
node render.mjs --seconds=600 --seed=42 --noise=sample --type=vinyl --out=/tmp/take.wav
```

## Layout

```
render.mjs      the offline harness: builds the rig, plans a performance, lays the riddim,
                renders, masters, and measures
stems.mjs       solos every channel and bus and reports rms/peak/crest/share
rig.js          DUB_RIG — the desk as data: channels, sends, bus returns, master trim
gesture.js      the gesture grammar: mute, throwFeedback, sweep, sendRide, fader, reverbDecay,
                shimmerRise. Gestures are plain data, so a performance is inspectable.
perform.js      the generative layer — a generator that yields sections forever
riddim.js       the dry frame: drum patterns, transcribed progressions, groove operators
voices.js       the sound sources, as persistent graphs that are retriggered
corpus.js       the noise layer, from the sample library or from synthesis
master.js       bounce-time mastering: glue compressor + look-ahead limiter, pure DSP
dsp/            echo, spaces, mixer, the scheduled-knob primitive, the LFO tool, and a full
                effect library with its three AudioWorklets
core/           seeded RNG, DSP + FFT, music theory, WAV codec, measurement helpers
ingest/         the thesis as a page-indexed corpus, its section map, and figure renders
research/       the derived digest every design decision cites
data/           the sample-library index for the noise layer
```

## Constraints this engine holds to

Each was learned by measurement and each is load-bearing.

- **Everything must render offline.** No browser-only nodes, no AudioWorklet in any required
  path. A block that cannot run through an `OfflineAudioContext` cannot be measured, tested or
  bounced, so it does not go in. The worklets present all degrade to native nodes.
- **Voices are persistent graphs, retriggered — never a graph per note.** Allocating per hit
  makes the node count grow without bound and the render loop revisit all of it every block, so
  cost per second of audio climbs the longer you play. Measured at ~5× the sum of its parts after
  only 30 seconds.
- **Noise is seeded from its own parameters**, not from `Math.random` and not from a shared
  stream — a shared stream would make the buffer you get depend on how many others were built
  first.
- **No sidechain ducking.** The wet sits under the dry *by level*, which is the genre's own
  stated mechanism. Sidechaining everything to the kick is a reflex from other genres; the source
  mentions the technique once in 302 pages, describing an acid techno track.
- **Levels are machinery, not taste.** `--headroom` derives the master trim from the p99.9
  sustained level; `stems.mjs` says what each layer actually contributes; `master.js` reports
  when the *mix* is the problem instead of quietly compressing it.

## State

Prototype, and honest about it. It renders, measures clean, and holds its constraints — a
five-minute take lands at true peak −1.7 dBFS, 0 clipped samples, crest 16.6 dB, mono-sum loss
0.36 dB. What it does not yet have: any live/browser surface (it is headless only), a hand-
auditioned noise corpus (`data/noise_corpus.json` marks 8 entries curated, meaning hand-narrowed
by name and measurement, not listened to), and a solved tonal-vs-noise classifier for the sample
library — three approaches were tried and none separated the classes, so the scanner deliberately
does not pretend to.

## License

MIT.
