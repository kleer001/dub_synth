# Dub techno — technique, sound, and long-form structure

The actionable residue of Bahadırhan Koçer, *Dub Techno as Orphic Experience: Auditory
Aesthetics, Spatiality, and Sound* (M.A. thesis, İstanbul Technical University, Musicology
Programme, June 2023, 302 pp.; advisor Ozan Baysal). Open access at İTÜ DSpace:
`https://polen.itu.edu.tr/items/2205c9a9-6bbd-48d9-a382-afc55fa26803`.

The thesis is half musicology and half media philosophy. Its philosophical spine — orphic
experience, Derridean hauntology, the neoliberal "failure of the future," the right-room
question as psychoacoustics — is **not** reproduced here. What is reproduced is the measurable
layer: signal chains, named gear, echo parameters with numbers, tempi, chord progressions,
drum patterns, section timings, and tonal balance. Page references are to the thesis's own
printed page numbers.

Koçer's own technical measurements (§5.2.2, his echo deconstruction, and §7.3, his six track
analyses with spectra and notation) are **primary** — he made them. Everything he attributes to
Oswald, Dub Monitor, Spruill, Baines, Esen, Matheos, or the survey participants is
**secondary**, and marked where it matters.

Companion reads in this repo: `edm_theory.md` for the mode/progression vocabulary,
`song_construction_basics.md` for the phrase-and-motif grammar that sparse music exposes,
`shpongle_technique.md` for reverb-on-sends and saturation-not-EQ warmth (the same production
posture, a different genre), `game_music_structure.md` for the anti-wandering problem in
unbounded-length music.

---

## 1. The genre in numbers

| Quantity | Value | Source |
|---|---|---|
| Tempo, general | ~120–130 BPM, four-on-the-floor | Spruill, via p. 150 |
| Tempo, measured | 123 (*Aerial*), 144 (*Phylyps Trak*) | pp. 175, 185 |
| Final section begins at | 4:52 – 9:24 (tracks run past it) | structure schemes, §7.3 |
| Sections per track | 6 – 15 | structure schemes, §7.3 |
| Section length (n = 46) | median 48 s, mean 60 s, range 3 s – 3:11 | derived from §7.3 |
| Spectral centre of gravity | dominant 20–350 Hz in every analysed track | §7.3 tonal balance, pp. 218–221 |
| Mid-range (800 Hz – 3 kHz) | weak in **all six** tracks | pp. 218–221 |
| Noise layer | present in 50/50 sampled tracks, 1994–2022 | Chart 7.1, pp. 159–161 |

Two findings are worth stating as constraints rather than observations:

- **Every analysed track is low-dominant and mid-scooped.** The tonal-balance comparison against
  iZotope's reference curve (pp. 218–221) finds low-frequency dominance in all six and mid-range
  weakness in all six. *B4* falls below the guide range everywhere except the lows, extremely so
  above 8 kHz (p. 221). A dub techno mix that reads flat across the mid-band is not the sound.
- **The genre carries no bass part by default.** *Aerial* has no distinct bass instrument at all;
  its low end is carried by kick and tom (p. 177). *B4*'s "bass" is a pulsating layer that
  *functions as* the kick (p. 214). Where a bassline exists (*Salt*, *Listing, Sinking*,
  *Resonance*) it is a slow riff, not a driver.

---

## 2. The dub echo, technically (§5.2.2.1, pp. 48–58)

Koçer reconstructs the effect from scratch in Ableton Live 11, stock Echo + LFO only, measuring
with iZotope RX9. Test signal: a pure sine at C4 = 261.626 Hz (A440), later a sawtooth. These are
his measured settings — the closest thing to a specification the genre has.

**Baseline (Live's Echo defaults).** L/R modes linked, sync'd to a dotted 1/8, delay offset 0%
both channels, feedback 50%, dry/wet 70%, panning modulation off, output band-passed with a soft
slope from 50 Hz to 5 kHz, no Q set. Result: the two channels are *identical* copies, perfectly
superimposed in amplitude and frequency; the tail falls below −85 dB after 4 s. Koçer's word for
it is **"non-organic"** (pp. 49–50). This is the reference point the rest of the moves depart from.

**Runaway feedback.** Feedback to 100% (the plug-in permits beyond 100%). What matters is not the
value but that in authentic dub the feedback is "subjected to sharp fluctuations through
improvisation" — the feedback knob governs the **density** and **dynamism** of the result
(pp. 51–52).

**Feedback under random modulation** — the core move (pp. 52–54):
- Feedback amount driven by an LFO at a **non-synchronised 4.26 Hz** with a **random waveshape**
  (explicitly *not* sine or square — predictability is the enemy).
- Low-pass cutoff driven by a second, sine LFO at **0.11 Hz** — slow, non-synchronous drift in
  "the balance of presence and depth."
- LPF **Q = 57%**; the resulting movement swings the perceived presence between **500 Hz and
  5 kHz**.
- On the echo's dry path: HPF **Q 0.13, cutoff 271 Hz**; LPF **Q 0.21, cutoff 1.87 kHz**.
- The two LFO rates are deliberately incommensurable (4.26 Hz vs 0.11 Hz — a ratio of ~39) so the
  combined motion never repeats audibly. The LFO stands in for the hand on the knob.

**Stereo timing offset.** Delay offset **+8% right / −8% left**, everything else default. This
alone produces the "non-mechanical, 'flawed' human perception of timing" without any panning
modulation (pp. 54–55).

**Delay-time modulation** — the source of dub's pitch artefacts (pp. 55–56):
- Delay mode switched from beat-sync to **time-based**.
- Feedback **90%**, HPF **200 Hz**, LPF **5 kHz**, offset **+8%L / −8%R**, L/R linked.
- Time knob mapped to a random-waveshape LFO, **1/4 rate, 100% smoothing**, LFO range clamped to
  **40%–80%** to prevent extreme jumps.
- Consequence: sudden movement on delay time produces **pitch shifts in the tail** — Koçer names
  these "a distinguishing element for the sound of dub music." The spectrum shows the initial
  frequency changing on each repeat and the gaps between beats becoming asymmetrical.

**Harmonically rich source.** Sawtooth, 4 voices at 30% unison, LPF cutoff on a random LFO at
**0.88 Hz**, LPF **Q = 59%**, echo at near-default after the oscillator. The point: filtering
creates "a fluctuation between two contrasting auditory qualities, **presence and deepness**"
only when the input has harmonics to roll off. A sine gives you nothing to filter (pp. 57–58).

---

## 3. The dub echo, musically (§5.2.2.2, pp. 58–67)

Derived from notated 8-measure analyses of King Tubby & Augustus Pablo's *King Tubby Meets
Rockers Uptown* (1976) and Linton Kwesi Johnson's *Reality Dub* (1980). Koçer's own conclusions,
lightly condensed:

- **The alterable parameters are: time, panning, LPF/HPF cutoff, feedback amount.** Timing,
  panning, wobble and noise artefacts can all be dialled digitally to match the analog originals.
- **Raising feedback at a chosen moment temporarily rewrites both the harmonic and the rhythmic
  setting.** When one track's echo tail expands and overlaps another's, the intersecting dominant
  frequencies produce a harmony that is not in the written notation. These intersections are
  brief, real, and are the point.
- **Any parameter may be moved abruptly or gradually.** There is no rule that says smooth.
- **Feedback increase is the transition device.** It reinforces, embellishes, or organises the
  move from one section, measure, or chord progression to the next. Transitions are *articulated
  by effects*, not by adding parts.
- **Echo is applied to off-beat material.** In *Reality Dub* the echo goes exclusively to chords
  and notes sounding off-beat — Koçer calls this "a common method." The off-beat staccato guitar
  and melodica chops (the *skank*) are the echo's natural food.
- **Tail length in practice:** in *King Tubby Meets Rockers Uptown* the echo self-feeds for about
  **two measures**, then feedback is pulled down for a soft decay.
- **The rhythm section is a dry frame that constrains the wet.** Bass and drums provide a "dry
  backcloth"; the fixed pattern *prevents the output from deviating from the overall form* as
  feedback rises. The frame is what makes extreme effect motion safe. Drum-kit echo is held at a
  **consistent** feedback level while melodic tracks are ridden.
- **Improvised feedback is not obligatory.** Koçer is explicit: many dub tracks never move the
  echo parameters at all. Static, subtle echo is a legitimate setting.
- **Echo is not the only effect.** Advanced delay, reverb, phaser, flanger, chorus, distortion,
  bit reduction and filtering are all stylistically load-bearing.

---

## 4. The riddim substrate (§5.2.1, pp. 40–46)

Dub techno inherits its rhythmic grammar from reggae by way of dub. The **riddim** is the whole
harmonised groove treated as a reusable backing object, with each instrument track individually
manipulable by the operator through processors and faders and re-arranged by improvisation. Veal's
term for the operator is **"macro-composer"** (Veal 2007, p. 85, via p. 40) — someone who composes
by deconstructing and reconstructing a finished whole in performance. That is the correct mental
model for a dub techno engine: not a note sequencer, a **mixer being played**.

**The three core drum patterns** (Macdonald/Zahner, via pp. 41–42):

| Pattern | Kick | Feel |
|---|---|---|
| **One-drop** | beat 3 only | most characteristic reggae; upbeat hi-hat accents |
| **Rockers** | beats 1 and 3 (snare 2 and 4) | the ska/rock connection |
| **Steppers** | every beat — four-on-the-floor | "modern"; the one dub techno adopts |

They are blended and embellished, never played fixed. The **hi-hat carries the accentuation**.

**Bass patterns** (Matheos 1998, via pp. 43–45): **root–fifth–octave** is the most common,
**root–third–fifth** next. Groove techniques, all applicable as generative operators:
- **Rhythmic displacement** — shift the pattern horizontally in the bar without changing its
  pitches. Unnoticed if not overdone; "instantly makes the groove more interesting."
- **Crossing the bar line** — hold a note across the barline in two-bar phrases; or substitute a
  rest at the same spot for variation.
- **Breathing** — rest on downbeats rather than playing them.
- **Dead notes** — muted percussive notes; a bassline using them consistently reads as percussion.
- **Slides** replacing rests, for an organic (fretless-like) contour.
- **Moving patterns** — transposition of the whole figure.
- **Vary the starting note.** Reggae is groove-based; patterns need not begin on the root.

**Syncopation** comes from ska's after-beat accentuation. The off-beat guitar chop is the
**skank**, filling between main beats with scratchy chords. In dub techno the skank becomes the
**stab**.

**Low frequency is the genre's physical substrate**, not an EQ preference. Henriques's "sonic
dominance" — the bassline "vibrating the flesh, playing on the bone" — describes sound-system
listening where lows are felt on the skin rather than heard (Henriques 2003, pp. 452–453, via
p. 45).

---

## 5. The dub techno sound (§7.2, pp. 148–156)

**Lineage.** Moritz von Oswald + Mark Ernestus, Berlin, invented on a mixing procedure rather than
grown from a scene. Their labels in order: **Maurizio** (1992), **Basic Channel** (1993), **Main
Street** (1994), **Chain Reaction** (1995), **Rhythm & Sound** (1997) (p. 145). The phrase "dub
techno" itself only entered use around 2001 — before that it was "the sound of Basic Channel"
(Dub Monitor, via p. 146).

**The signature is a delay style, not a synthesis style** (Dub Monitor, via p. 150). Early Oswald
/ Ernestus echo was the **Roland RE-201 Space Echo** — but unlike the TB-303 in acid techno, the
RE-201 is not itself definitional; the *practice* is. The parameters live-improvised by the
producer — delay time, feedback, HPF/LPF, panning — are what make it dub.

**The stab chain** (Attack Magazine's Basic-Channel-style guide, Esen 2021, via p. 151) —
secondary but concrete and consistent with everything measured:
1. Lower the stab's resolution; make it "jagged" (bit reduction / downsampling).
2. Band-pass-modelled filter, **cutoff randomised by a low-Hz LFO**, to kill harshness.
3. Result reads as "soft" — high-end information deliberately weakened.
4. **Dotted-1/8 filter delay** on the output.

**The snare** (same source): snappy, **no low end below 250 Hz**, pitched up, bit-crushed and
downsampled, then high-passed around 150 Hz after processing.

**Noise is a part, not a defect.** Oswald: he does not regard noise as a flaw, it "contributes to
the vibe," it is integral (p. 152). Spruill locates the genre's spatiality precisely in the
"tiniest hints of hiss and fuzz," and notes that "every element in the mix is given breathing
space and, accordingly, takes on a sense of the organic" (p. 152).

**Live mixing is the production method.** Asked how he keeps echoes from over-clouding the track,
Oswald answers "live mixing" (p. 151). His stated posture — "If it is done, it's done. If there
are mistakes, there are mistakes… if the vibe is right, let's go for it" — is the genre's tolerance
for artefact stated plainly.

**Where it sits.** Dub techno is a sub-genre of **deep techno**: relatively low tempo, soft sound,
distinct subtlety, *no sharp rises and falls* (Dub Monitor, via p. 153). It intersects dub, techno
and electronic ambient; tracks without percussion at all, sometimes under 100 BPM, are still
released as dub techno (p. 154).

**Noise taxonomy** (Chart 7.1, pp. 159–161 — 50 Discogs-tagged tracks, 1994–2022, spectrum
analysed). Three types: **static** (majority — hardware electrical noise, still deliberately
present in 2022 productions when no hardware generates it), **vinyl crackle**, and **soundscape**
(rain, forest, indoor — functioning as drone). Every one of the 50 carries one.

---

## 6. Six track anatomies (§7.3, pp. 171–221)

Koçer's own analyses: spectrum, notation, sequencer views, section boundaries drawn at
"occurrences" — element added or removed, LPF/HPF use, amplitude change, harmonic modification.

### *Aerial* — Rhythm & Sound, 2002 (pp. 171–178)
- **123 BPM**, 8 sections, 9:15+.
- Palette: noise layer, drum kit (BD/LT/SD/CH), dub stabs, vocals, later ethnic percussion.
- **No bass instrument** — kick and tom carry the low end.
- Stabs: **off-beat**, low-pass softened, wet reverb with a **high pre-delay ratio**. Folded
  sequencer range G4–D#5 over rows G / Bb / D / Eb — a **G minor triad with Eb as the colour
  note**; notation in two flats.
- Drums brought into dub context with **spring reverb**.
- The vocal melody is the "glue" between bars and the track's only dynamic element besides effects.
- Section boundaries: 00:00 / 00:31 / 03:20 / 04:32 / 04:41 / 06:21 / 06:40 / 09:15 — note the
  2:49 section-2 plateau, then four boundaries inside 130 seconds.
- Koçer's summary: everything that does *not* change in amplitude is instead **transformed in
  spatial perception through knob movements**. Frequency of those changes increases monotonically
  from section 1 to section 7.
- Survey: 78% headphones.

### *Phylyps Trak* — Basic Channel, 1993 (pp. 178–185)
- **144 BPM**, **15 sections**, 9:24+.
- Opens with **Gm/Bb stabs at high feedback through a 1/16 echo** — the echo "triggers the groove
  between stabs, taking advantage of the high feedback amount in the gaps." Stabs run through
  phasers, distortion, and other texture processors. Folded range Bb2–G3.
- Second stab layer fills the first's gaps with **G minor inversions**.
- Kick is the axis: four-on-the-floor with **rumble**; all dynamics shape around it.
- The echo makes the layers "blend together, dissolve, and form a kind of **harmonised layer**" —
  Koçer names this as a source of the hypnotic sensation: the echo alters the harmonic context
  progressively through intermingling.
- Structure: 00:00 / 00:38 / 01:20 / 01:47 / 02:01 / 02:47 / 03:58 / 05:00 / 05:17 / 05:26 /
  05:42 / 06:57 / 07:50 / 08:30 / 09:24. **Two climaxes** (§5–6, recreated identically at §11)
  with drops between; break before the first climax made by **muting the kick**; 32-second fade-out.
- Survey: 85.4% dancefloor — attributed to kick hardness, transient-rich percussion, and tempo.

### *The Salt On Her Cheeks* — Yagya, 2012 (pp. 186–193)
- 7 sections, ~6 min. Opens and closes on a **seaside soundscape** — the track is framed by it.
- Palette: four-on-the-floor kick, shaker, bass (F2–D3), off-beat stabs (D3–C4), pad, rimshot on
  beat 3, and from §5 a **sine-like soft key melody** as narrative element.
- Pad progression: **Dm/F – Am – G**. The only analysed track with real functional harmony.
- **LPF is the structural instrument.** Everything but kick and bass starts filtered; the filter
  opening *is* the arc. Koçer describes the resulting **expansion–contraction of the mix space**;
  closing the LPF on the pads produces "isolation."
- Structure: 00:00 / 00:03 / 00:35 / 01:11 / 03:49 / 04:40 / 05:38. Section 4 runs **2 min 38 s
  with no significant change** — deliberately "suspended" or "anchored to a certain mode."
- Survey: 73.2% headphones.

### *Listing, Sinking* — Overcast Sound, 2016 (pp. 194–201)
- 7 sections, 8:33+. **Only four elements**: drums, pad, stabs, bass.
- Pad: **Bm – F#m over a 32-bar harmonic sequence** — two chords, held.
- **Stab echo, exact:** dotted time ≈ **237 ms**, **50% feedback**, **70% wet**. Koçer flags this
  as the backbone of the piece; the echo "audibly alters the perceived rhythm by placing [the
  stabs] on a specific click axis."
- Structure: 00:00 / 01:03 / 02:07 / 03:12 / 06:23 / 07:35 / 08:33. Section 4 is **3 min 11 s** —
  the longest single section in the corpus.
- Additive-then-subtractive: kick+pad → stabs → hats → ride (climax) → ride out → hats out →
  ends on one solo echoed stab.
- Survey: 58.5% dancefloor — the closest split.

### *Resonance* — Substance & Vainqueur, 2007 (pp. 202–210)
- 9 sections, 8:20+. Palette: shimmer reverb, noise, phaser, **three stab layers**, kick, bass
  (Bb1–C2), shaker, and a **noisy Cm drone "backcloth."**
- Stab progression: **Cm/G – Gm (iv–i)**.
- The three stab layers hold a **four-bar call-and-response** with each other, produced *by their
  echo tails*, not by their notes. Layer 1's echo is restrained, layer 2 takes sudden feedback
  spikes (e.g. at 01:42), layer 3 is heavily articulated. Layer 2 is tuned to match the shaker's
  rhythm in the high band, "manipulating the perception of the shaker."
- Koçer diagrams the echo decays intersecting (Figs 7.35–7.36) and states the mechanism: high
  feedback lets decays from different stab layers overlap, and the overlap **alters spatial and
  musical perception** — layers rise and fall in "presence" independently of amplitude.
- Structure: 00:00 / 00:30 / 01:16 / 02:46 / 03:17 / 05:26 / 05:54 / 07:34 / 08:20. Sections 4 and
  6 are **shaker-mute and kick-mute dips** — subtraction used as motion.
- Ends deliberately *unlike* it started: everything but the bassline pushed into shimmer reverb.
- Survey: 73.2% dancefloor.

### *B4* — Topdown Dialectic, 2018 (pp. 211–216)
- 6 sections, 04:52+. The outlier: **every layer originates from sonic artefacts** — vinyl
  crackle and pops used at "a radical level," with melodic, harmonic and percussive parts all
  produced by manipulating the same source material (microsampling, the *Clicks & Cuts* lineage).
- Key sounds **F minor**; a **pulsating bass layer functions as the kick** and owns everything
  below 300 Hz.
- Built on **8-bar blocks joined by noise-transition embellishments**. From §3 a **sine tone
  ringing Db fills every drop** — three elements (pulsating bass, distinct movement, sine tone)
  form an 8-bar narrative that runs to the end.
- Structure is explicitly **non-linear**: sections marked by recurring motif patterns rather than
  by additive arrangement. Drops and rises made with **LPF** on the 3–6 kHz band.
- Tonal balance: below the reference guide range *everywhere except the lows*, extremely so above
  8 kHz.
- Survey: 70.7% headphones.

---

## 7. The long-form structure model

What the six schemes agree on, stated as rules:

1. **Sections are minutes, not bars.** Median 48 s across the corpus, but plateaus of 2–3 minutes
   with nothing happening are normal and deliberate (*Salt* §4 = 2:38, *Listing* §4 = 3:11,
   *Aerial* §2 = 2:49).
2. **Boundaries are effect moves and mutes, not new material.** Koçer's own boundary criteria are:
   element added or removed, LPF/HPF use, amplitude change, harmonic modification. Four of those
   five are mixer gestures.
3. **Section spacing is irregular and accelerating.** Long plateaus early, boundaries clustering
   toward and around the climax, one long tail. *Aerial* runs 31 s → 169 s → 72 s → 9 s → 100 s →
   19 s → 155 s. Even spacing is wrong.
4. **Subtraction is the primary motion device.** Muting the kick makes the break (*Phylyps Trak*
   §4). Muting the shaker makes the dip (*Resonance* §4). Muting the ride starts the descent
   (*Listing, Sinking* §5). The drop is a *removal*, never an impact.
5. **Climaxes repeat verbatim.** *Phylyps Trak* recreates its §5–6 climax at §11 "using the same
   elements without any modifications." There is no development obligation.
6. **The ending need not restore the beginning.** *Resonance* ends with a different setup than it
   started; *Salt* returns exactly to its soundscape. Both are used.
7. **Harmonic rate is near zero.** Two chords over 32 bars (*Listing, Sinking*), a three-chord
   loop (*Salt*), a two-chord iv–i (*Resonance*), one triad plus a colour note (*Aerial*), one
   minor chord and its inversions (*Phylyps Trak*).
8. **Fade-outs are long.** *Phylyps Trak* ≈ 32 s.

The genre's answer to the anti-wandering problem (cf. `game_music_structure.md`) is therefore not
harmonic or melodic development. It is a **fixed dry frame** — kick, bass, one chord — under a
**continuously modulated wet layer**, with **mutes** marking structure. Interest per unit time is
produced by effect-parameter motion and by echo tails from separate layers intersecting into
harmonies nobody notated.

---

## 8. What this means for a generative engine

Design consequences that follow directly from the above. Cite the relevant section of this doc at
the point of use in code.

- **Model the mixer, not the score.** The composable unit is a *gesture on a channel* — a feedback
  ride, a mute, a filter sweep, a send level — over a static pattern. The riddim's macro-composer
  model (§4) is the architecture.
- **Two modulation timescales, deliberately incommensurable.** §2 gives the ratio in hard numbers:
  a fast random-waveshape LFO (~4 Hz) on feedback, a slow sine (~0.1 Hz) on filter cutoff. Random
  waveshape, not sine or square, for anything that stands in for a hand.
- **Feedback is the transition primitive.** §3: raise feedback to mark a boundary; hold it steady
  on drums; ride it on melodic layers; let the tail run ~2 measures before pulling it back.
- **The echo must be able to pitch-shift.** §2: a time-based (not beat-synced) delay whose delay
  time is modulated produces the genre's characteristic pitch artefacts on the tail. A fixed
  sync'd delay cannot make this sound.
- **Stereo asymmetry is a fixed ±8% delay offset**, not a pan modulation (§2).
- **Layer echoes must be allowed to collide.** §6 (*Resonance*): three stab layers at high feedback
  produce a four-bar call-and-response and unnotated harmony purely through overlapping decays.
  Independent sends per layer, not one shared echo bus.
- **Budget the spectrum low and scoop the mids.** §1: 20–350 Hz dominant, 800 Hz–3 kHz weak, high
  end balanced-to-absent. Keep the low end dry (cf. `shpongle_technique.md` on sub-kept-dry).
- **The stab is the melodic instrument, and it is off-beat.** One minor triad plus a colour tone is
  a sufficient harmonic budget (§6, §7.7). Off-beat placement is what the echo needs to work on
  (§3).
- **A noise bed is mandatory, not decorative.** §5: static, vinyl crackle, or environmental
  soundscape-as-drone. Present in 50/50 sampled tracks.
- **Structure by mute and filter over minute-scale sections with irregular spacing** (§7). A
  section-change generator that fires evenly, or that adds a new part at each boundary, produces
  the wrong genre.
- **The wet sits under the dry by LEVEL, not by ducking.** Sidechaining every element to the kick
  is a four-on-the-floor reflex from other genres and it is not this one: across the thesis's 302
  pages the technique appears exactly once, on p. 178 of the PDF (printed p. 148 region) describing
  Emmanuel Top's *Acid Phase* — an acid techno track. Dub techno's own stated mechanism is §3's
  **dry backcloth**: bass and drums hold a fixed, dry frame and the wet output is heard against it,
  constrained by the frame rather than pumped by it. Deep techno "lacks sharp rises and falls"
  (§5). If a kick is inaudible in a dub mix, the fault is return levels, feedback, and fader
  balance — not the absence of a compressor.
