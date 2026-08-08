fresh

## Summary

dub_synth grew from an offline-only renderer into a **live playable browser instrument**
this session, plus a public README/landing page and a root reorganisation. Everything is
committed and pushed to `origin/main` (tip `5ce8f35`); working tree clean; 49/49 tests pass;
the default render is byte-identical to before the session's refactors.

The engine is now shared by two front ends: `tools/render.mjs` (offline bounce) and
`ui/engine.js` (realtime scheduler). Anything under `engine/` must import cleanly in a
browser — that constraint is what makes them the same instrument.

No blocking work is outstanding. The items below are opportunities, not breakage.

## Todos

### Parallel

- [ ] #1 `--headroom` under-trims kicks whose peak-to-sustained ratio differs from the
      synth kick's. `FAC Kick 13-2` lands at −1.91 dBFS true peak instead of −1.00,
      leaving ~0.9 dB unused. Workaround exists (`--trim=`). A real fix means the headroom
      target adapting to measured crest — bigger change, wants a decision first.
- [ ] #2 Hosted desk (GitHub Pages) can't reach sampled kicks — `/samples/` is a dev-server
      mount only. `ui/engine.js loadKick` throws a clear message; the Riddim panel does not
      yet surface it as disabled state. Cosmetic.
- [ ] #3 The pad still holds one chord for its lifetime; `setRiddim` rebuilds it on a
      progression/tonic change. Works, but the rebuild drops and recreates oscillators —
      fine at riddim rate, would not be at gesture rate.
- [ ] #4 Voice-internal walk spans use `STEPS_PER_SPAN = 4`; the pad's 0.05 Hz walk therefore
      re-arms every 80 s. Unverified whether the seam is audible on the pad specifically.

## Context

**Where things live** (root was reorganised this session — imports were retargeted):
- `engine/` — the instrument, incl. `core/` and `dsp/` which moved *with* it so intra-engine
  imports were unchanged. `corpus.js` is the deliberate Node-only file (reads disk); the
  synthesized noise beds live apart in `noise.js` so the browser can import them.
- `tools/` — `render.mjs`, `stems.mjs`, `serve.mjs`, `scan_kicks.mjs`, `scan_samples.mjs`
- `ui/` — `index.html`, `app.js`, `engine.js`; root `index.html` is the Pages landing page
- Pages: main branch, /root. Live at `https://kleer001.github.io/dub_synth/` and `/ui/`

**Hard-won facts — do not re-derive:**
- A **WaveShaper clamps its input to [−1,1] whatever its curve says.** `masterbus.neutral()`
  used to linearise the curve as a "bypass"; everything over full scale read as exactly
  0.0 dBFS, hiding a +4 dB overshoot from both `stems` and `--headroom`. It now routes
  around the shaper. Any new measurement path must do the same.
- **Per-note node allocation is real and expensive**: 1.15/1.18/1.14 ms per audio-second for
  a persistent voice vs 4.99/19.84/40.74 at 30/120/300 s for one BufferSource per hit
  (~36× by five minutes; Chrome measures the same shape). Fixed patterns get stamped into a
  bar-length buffer and looped by one node — `voices.sampleKick`.
- **The shimmer loop is shifter-dependent.** Stable at feedback 0.42 on the granular pitch
  shifter, grows +9.6 dB/s on the phase-vocoder worklet, settles only at 0.22. `makeShimmer`
  caps per-shifter. `?worklet=0` forces granular for A/B.
- **`ride()` opens with `cancelScheduledValues`**, so offline the first feedback throw kills
  that bus's walk permanently. The live engine's chunked re-arm repairs this incidentally.
- **Sample rates must be converted, never assumed** — `core/audio.js toAudioBuffer`
  resamples; `sampleKick` throws on a mismatched buffer (44.1k in a 48k ctx = 8.8% sharp).
- Mix diagnostics: `glue maxReductionDb` is the single worst transient, **not** how hard the
  glue works. Avg is 1.8–2.6 dB = ordinary. `master.js` only warns above 5 dB.
- **Beat swing (~16.5 dB) has no documented target and nothing moves it** — not the kick
  (all 13 tried), not echoA (−5 dB changed it 0.01). Treated as structural, not a fault.
  Do not chase it again without a spec number.

**Testing the desk without disturbing the user:** route `engine.output` through a
zero-gain node to `ctx.destination` and tap an analyser *before* it — the graph still
computes, nothing is audible. Always leave the page stopped (context suspended) when done.
`window.dubsynth` exposes `{ ctx, engine, rig, DUB_RIG }`.

**Verification ritual** after any engine change: `npm test`, then a 120 s render `cmp`'d
against a known-good WAV for byte-identity, then `npm run stems` / `--headroom` if levels
moved. Renders are slow (~30 s for 120 s, ~76 s for 300 s) — background them.

**Dev server**: `npm run desk` serves the repo root with `no-store` (a caching static server
hands back stale `dsp/*.js` and you debug code that isn't on disk — this cost real time) and
mounts the sample library at `/samples/` from `DUB_SAMPLES` (default
`/media/menser/larg/Music/samples`).

## Next Step

Nothing is blocked. If picking this up cold, the most valuable item is **#1** — decide
whether `--headroom` should adapt its target to measured crest, since that's the one thing
standing between a sampled-kick render and hitting −1.00 dBFS true peak automatically.

Otherwise the instrument is in a good state to simply *play* and let taste drive the next
change rather than metrics.

/home/menser/Dropbox/ai/code/dub_synth
