// dub_synth/ui/app.js — the desk, wired to the engine.
//
// Every control here moves a real AudioParam on the graph engine.js built. The
// layout argument is unchanged from the study it grew out of: composition in this
// genre happens at the mixer (research/dub_techno_technique.md §4, §7), so the
// send matrix gets the space a piano roll would get elsewhere, and the plan is a
// ribbon you can watch but not draw.
//
// Two things are deliberately not knobs. The master trim is a measured number
// (`npm run render -- --headroom`), and the §2 knob walks run at 4.26 Hz and
// 0.11 Hz — rates no hand can play. The walks are shown, and can be overridden by
// grabbing them, but they are not something you dial.

import { DUB_RIG } from "../rig.js";
import { bootEngine } from "./engine.js";
import { KICKS } from "../kicks.js";
import { DRUM_PATTERNS, PROGRESSIONS } from "../riddim.js";

const q = new URLSearchParams(location.search);
const OPTS = {
  seed: Number(q.get("seed") ?? 7),
  bpm: Number(q.get("bpm") ?? 125),
  tonic: q.get("tonic") ?? "G",
  progression: q.get("progression") ?? "listing",
  pattern: q.get("pattern") ?? "steppers",
  noiseType: q.get("type") ?? "static",
  worklet: q.get("worklet") !== "0",
};

const CHANNELS = Object.keys(DUB_RIG.channels);
const BUSES = Object.keys(DUB_RIG.buses);

// Colour is identity, and it has to be the same colour in the strip, the matrix
// row and the detail header. Grouped by role: drums warm, stabs blue, the rest
// their own.
const HUE = {
  kick: "#c8553d", bass: "#8e3b6b", stabA: "#1f5f8b", stabB: "#3486ab", stabC: "#58a7c4",
  hat: "#d98c3f", shaker: "#c9a227", perc: "#a8763e", pad: "#6a4c93", noise: "#7a8471",
  echoA: "#1f5f8b", echoB: "#3486ab", echoC: "#58a7c4", fdelay: "#5b7fa6",
  spring: "#4c8b5a", plate: "#3f8f86", shimmer: "#6a4c93",
};
const BUS_BLURB = {
  echoA: "dotted 1/8 · 237 ms", echoB: "1/16 · 120 ms", echoC: "time-based · 480 ms · warped",
  fdelay: "3 bands · 160 / 900 / 3500 Hz", spring: "decay 1.0 s · colour 2200 Hz",
  plate: "decay 3.4 s · pre-delay 90 ms", shimmer: "decay 5.0 s · +12 st",
};
const BUS_KIND = { echo: "ECHO", filterDelay: "FILT DLY", spring: "CONVOLVE", plate: "CONVOLVE", shimmer: "CONVOLVE" };
const SC = { intro:"#dfe6ea", exposition:"#cfe0e8", build:"#e8d9c2", climax:"#e9bfae",
             dip:"#dcd8e6", lull:"#d9e2dc", outro:"#e6e2da" };
const BADGE = { climax:"var(--hot)", build:"var(--warn)", dip:"var(--auto)" };

const $ = (s) => document.querySelector(s);
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const taper = (v) => Math.pow(clamp(v,0,1), 1/1.8);
const untaper = (p) => Math.pow(clamp(p,0,1), 1.8);
const dB = (v) => v <= .0011 ? "-∞" : (20*Math.log10(v)).toFixed(1);
const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(Math.floor(s%60)).padStart(2,"0")}`;

// ── local mirror of the desk, so the UI can be built and dragged before audio ──
const chState = CHANNELS.map((id) => ({
  id, c: HUE[id], f: DUB_RIG.channels[id].fader, p: DUB_RIG.channels[id].pan,
  sends: { ...DUB_RIG.channels[id].sends }, mute: false, solo: false, lv: 0, pk: 0,
}));
const retState = BUSES.map((id) => ({
  id, c: HUE[id], f: DUB_RIG.buses[id].ret ?? 1, kind: BUS_KIND[DUB_RIG.buses[id].fx],
  blurb: BUS_BLURB[id], opts: DUB_RIG.buses[id].opts ?? {}, mute: false, solo: false, lv: 0, pk: 0,
}));
const masterState = { id: "master", c: "#4a463f", f: DUB_RIG.master, mute: false, solo: false, lv: 0, pk: 0 };
const byId = (id) => chState.find((c) => c.id === id) ?? retState.find((r) => r.id === id);

let engine = null, ctx = null, analysers = new Map(), selected = "echoA";

// ── a drag that works the same for every control ──────────────────────────────
function drag(el, get, set, { axis="y", scale=150 } = {}) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault(); e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, v0 = get();
    const move = (ev) => set(v0 + (axis === "y" ? (y0 - ev.clientY) : (ev.clientX - x0)) / scale, true);
    const up = () => {
      try { el.releasePointerCapture(e.pointerId); } catch {}
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      set(get(), false);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  });
}

const at = () => ctx ? ctx.currentTime : 0;

// Solo is "mute everything not soloed", recomputed over the whole desk rather
// than tracked incrementally — there is no state to drift that way.
//
// The subtlety: the performance is muting and unmuting these same channels as it
// moves between sections (§7.4 — structure is made by taking things away). So
// while nothing is soloed, this only touches channels the hand has actually
// claimed, and leaves the rest to the plan. Solo is the exception; soloing means
// taking the whole desk.
function applyMutes(changed = null) {
  if (!engine) return;
  const soloing = chState.some((c) => c.solo);
  for (const c of chState) {
    if (!soloing && !c.mute && c !== changed) continue;
    engine.rig.mix.mute(c.id, c.mute || (soloing && !c.solo), at(), 0.02);
  }
  const busSolo = retState.some((r) => r.solo);
  for (const r of retState) {
    if (!busSolo && !r.mute && r !== changed) continue;
    engine.rig.mix.busLevel(r.id, (r.mute || (busSolo && !r.solo)) ? 0.0001 : r.f, at(), 0.05);
  }
}

// ── channel / return / master strip ───────────────────────────────────────────
function strip(o, kind) {
  const el = document.createElement("div");
  el.className = "strip" + (kind === "ret" ? " ret" : "");
  el.dataset.id = o.id;
  el.style.borderTopColor = o.c;

  const head = kind === "ch"
    ? `<div class="sendrow">${BUSES.map((b) =>
        `<s title="${o.id} → ${b}"><b data-send="${b}" style="background:${o.c};height:${Math.round((o.sends[b]||0)*6)+1}px"></b></s>`).join("")}</div>`
    : `<div class="lock">${o.kind ?? ""}</div>`;

  el.innerHTML = `
    <div class="nm">${o.id}<em class="readout">${dB(o.f)}</em></div>
    ${head}
    <div class="faderarea">
      <div class="fader" title="resting level from DUB_RIG: ${o.f.toFixed(3)}">
        <div class="lv"></div><div class="pk"></div>
        <div class="u" style="bottom:${taper(o.f)*100}%"></div><div class="cap2"></div>
      </div>
    </div>
    ${kind === "ch" ? `<div class="pan"><div class="pantrack"><div class="mid"></div><div class="kn"></div></div><div class="pv"></div></div>` : ``}
    <div class="ms">
      <button class="m" aria-pressed="false">M</button>
      <button class="s" aria-pressed="false">S</button>
    </div>`;

  const cap = el.querySelector(".cap2"), read = el.querySelector(".readout");
  const paint = () => { cap.style.bottom = taper(o.f)*100 + "%"; read.textContent = dB(o.f); };
  drag(el.querySelector(".fader"), () => taper(o.f), (p) => {
    o.f = untaper(clamp(p,0,1)); paint();
    if (!engine) return;
    if (kind === "ch") engine.rig.mix.fader(o.id, o.f, at(), 0.03);
    else if (o.id === "master") engine.rig.master.setTrim(o.f, at(), 0.05);
    else engine.rig.mix.busLevel(o.id, o.f, at(), 0.05);
  }, { scale: 140 });
  paint();

  if (kind === "ch") {
    const pt = el.querySelector(".pantrack"), kn = el.querySelector(".kn"), pv = el.querySelector(".pv");
    const pp = () => {
      kn.style.left = ((o.p + 1) / 2 * 100) + "%";
      pv.textContent = Math.abs(o.p) < .02 ? "C" : (o.p < 0 ? "L" : "R") + Math.round(Math.abs(o.p)*100);
    };
    drag(pt, () => o.p, (v) => { o.p = clamp(v,-1,1); pp(); engine?.rig.mix.pan(o.id, o.p, at(), 0.05); },
         { axis: "x", scale: 70 });
    pp();
  }

  const mb = el.querySelector(".m"), sb = el.querySelector(".s");
  mb.onclick = (e) => { e.stopPropagation(); o.mute = !o.mute; mb.setAttribute("aria-pressed", o.mute); el.dataset.mute = o.mute ? "1":"0"; applyMutes(o); };
  sb.onclick = (e) => { e.stopPropagation(); o.solo = !o.solo; sb.setAttribute("aria-pressed", o.solo); applyMutes(o); };

  el.__o = o; el.__lv = el.querySelector(".lv"); el.__pk = el.querySelector(".pk");
  return el;
}

chState.forEach((c) => $("#chstrips").appendChild(strip(c, "ch")));
retState.forEach((r) => {
  const el = strip(r, "ret");
  el.addEventListener("click", () => select(r.id));
  $("#retstrips").appendChild(el);
});
{
  const el = strip(masterState, "ret");
  el.classList.add("master"); el.classList.remove("ret");
  el.querySelector(".lock").outerHTML =
    `<div class="trimrow"><em>trim</em><span>${DUB_RIG.master}</span></div>
     <div class="lock">MEASURED<br>--headroom</div>`;
  $("#masterstrip").appendChild(el);
}

// ── send matrix ───────────────────────────────────────────────────────────────
{
  const t = document.createElement("table");
  t.innerHTML = `<thead><tr><th class="rowh">channel</th>${BUSES.map((b)=>`<th>${b}</th>`).join("")}</tr></thead>`;
  const tb = document.createElement("tbody");
  for (const c of chState) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="rowh"><i style="background:${c.c}"></i>${c.id}</td>`;
    for (const b of BUSES) {
      const td = document.createElement("td");
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.innerHTML = `<div class="cf"></div><span class="cn"></span>`;
      const cf = cell.querySelector(".cf"), cn = cell.querySelector(".cn");
      const paint = () => {
        const v = c.sends[b] || 0;
        cell.dataset.off = v <= .001 ? "1" : "0";
        cf.style.height = Math.round(v*100) + "%";
        cf.style.background = c.c + "33";
        cn.textContent = v <= .001 ? "·" : v.toFixed(2);
        const dot = document.querySelector(`.strip[data-id="${c.id}"] b[data-send="${b}"]`);
        if (dot) dot.style.height = Math.round(v*6)+1 + "px";
      };
      const push = () => engine?.rig.mix.send(c.id, b, Math.max(0.0001, c.sends[b]), at(), 0.06);
      drag(cell, () => c.sends[b] || 0, (v) => { c.sends[b] = clamp(v,0,1); paint(); push(); }, { scale: 85 });
      cell.addEventListener("dblclick", () => { c.sends[b] = 0; paint(); push(); });
      cell.addEventListener("click", () => select(b));
      paint();
      td.appendChild(cell); tr.appendChild(td);
    }
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  $("#matrix").appendChild(t);
}

// ── knobs ─────────────────────────────────────────────────────────────────────
const A0 = -135, A1 = 135;
function knob(label, io, { min=0, max=1, fmt=(v)=>v.toFixed(2), auto=false } = {}) {
  const cell = document.createElement("div");
  cell.className = "knobcell";
  if (auto) cell.dataset.auto = "1";
  cell.innerHTML = `
    <div class="knob"><svg viewBox="0 0 52 52">
      <circle cx="26" cy="26" r="21" fill="none" stroke="var(--sunk)" stroke-width="5"/>
      <path class="ghost" fill="none" stroke="var(--auto)" stroke-width="5" stroke-linecap="round" opacity="${auto?.34:0}"/>
      <path class="val" fill="none" stroke="var(--accent)" stroke-width="5" stroke-linecap="round"/>
      <circle cx="26" cy="26" r="15" fill="var(--panel)" stroke="var(--line-2)"/>
      <line class="ptr" x1="26" y1="26" x2="26" y2="13" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>
    </svg><div class="kv"></div></div>
    <div class="kl">${label}</div>
    ${auto ? `<span class="tag on">AUTO</span>` : ``}`;

  const norm = (v) => (v - min) / (max - min);
  const ang = (n) => A0 + n * (A1 - A0);
  const arc = (n0, n1) => {
    const r = 21, rad = (a) => (a - 90) * Math.PI / 180;
    const a0 = rad(ang(n0)), a1 = rad(ang(n1));
    return `M ${26+r*Math.cos(a0)} ${26+r*Math.sin(a0)} A ${r} ${r} 0 ${Math.abs(ang(n1)-ang(n0))>180?1:0} 1 ${26+r*Math.cos(a1)} ${26+r*Math.sin(a1)}`;
  };
  const val = cell.querySelector(".val"), ghost = cell.querySelector(".ghost"),
        ptr = cell.querySelector(".ptr"), kv = cell.querySelector(".kv"), tag = cell.querySelector(".tag");

  cell.paint = (v, gv) => {
    const n = clamp(norm(v), 0, 1);
    val.setAttribute("d", arc(0.0001, Math.max(n, .0002)));
    ptr.setAttribute("transform", `rotate(${ang(n)} 26 26)`);
    kv.textContent = fmt(v);
    if (auto && gv != null) ghost.setAttribute("d", arc(0.0001, Math.max(clamp(norm(gv),0,1), .0002)));
  };
  drag(cell.querySelector(".knob"), () => norm(io.get()), (n, livedrag) => {
    io.set(min + clamp(n,0,1)*(max-min));
    if (auto && tag) {
      tag.className = "tag " + (livedrag ? "touch" : "on");
      tag.textContent = livedrag ? "TOUCH" : "AUTO";
      io.hold?.(livedrag);
    }
    cell.paint(io.get(), io.get());
  }, { scale: 130 });
  cell.paint(io.get(), io.get());
  return cell;
}

// ── detail panel ──────────────────────────────────────────────────────────────
let fbKnob = null, cur = retState[0];

function select(id) {
  cur = retState.find((r) => r.id === id) ?? cur;
  selected = cur.id;
  document.querySelectorAll(".strip").forEach((s) => s.dataset.sel = s.dataset.id === cur.id ? "1" : "0");
  $("#dtitle").textContent = cur.id;
  const feeders = chState.filter((c) => (c.sends[cur.id]||0) > .001).map((c) => c.id).join(", ");
  $("#dsub").textContent = `${cur.blurb} · ← ${feeders || "nothing feeding it"}`;
  buildDetail();
}

function buildDetail() {
  const K = $("#dknobs"), R = $("#drates");
  K.innerHTML = ""; R.innerHTML = ""; fbKnob = null;
  const fx = engine?.rig.fx[cur.id];
  const isEcho = cur.id.startsWith("echo");

  K.appendChild(knob("return", {
    get: () => cur.f,
    set: (v) => { cur.f = v; engine?.rig.mix.busLevel(cur.id, v, at(), 0.05); },
  }));

  if (isEcho) {
    cur._fb ??= DUB_RIG.buses[cur.id].opts.feedback;
    fbKnob = knob("feedback", {
      get: () => cur._fb,
      set: (v) => { cur._fb = v; fx?.set({ feedback: v }, at()); },
      hold: (on) => engine?.hold(`${cur.id}.feedback`, on),
    }, { min: 0, max: 0.72, auto: true });
    K.appendChild(fbKnob);

    cur._time ??= DUB_RIG.buses[cur.id].opts.time;
    K.appendChild(knob("time ms", {
      get: () => cur._time,
      set: (v) => { cur._time = v; fx?.set({ time: v }, at()); },
    }, { min: 0.02, max: 1.2, fmt: (v) => String(Math.round(v*1000)) }));

    cur._lpf ??= 2750;
    K.appendChild(knob("tone hz", {
      get: () => cur._lpf,
      set: (v) => { cur._lpf = v; fx?.set({ lpf: v }, at()); },
    }, { min: 300, max: 8000, fmt: (v) => String(Math.round(v)) }));

    cur._sat ??= 0.35;
    K.appendChild(knob("sat", { get: () => cur._sat, set: (v) => { cur._sat = v; fx?.set({ sat: v }); } }));
  } else {
    cur._dec ??= cur.opts.decay ?? 3;
    K.appendChild(knob("decay s", {
      get: () => cur._dec,
      // Rebuilding an impulse is not a per-frame operation, so this lands on
      // release rather than during the drag.
      set: (v) => { cur._dec = v; },
    }, { min: 0.2, max: 8, fmt: (v) => v.toFixed(1) }));
    cur._pre ??= cur.opts.preDelay ?? 0.02;
    K.appendChild(knob("pre-dly", {
      get: () => cur._pre,
      set: (v) => { cur._pre = v; fx?.setPreDelay(v, at()); },
    }, { min: 0, max: 0.3, fmt: (v) => String(Math.round(v*1000)) }));
    if (cur.id === "shimmer") {
      cur._sfb ??= cur.opts.feedback ?? 0.42;
      K.appendChild(knob("rise", {
        get: () => cur._sfb,
        set: (v) => { cur._sfb = v; fx?.setFeedback(v, at(), 0.4); },
      }, { min: 0, max: 0.8 }));
    }
  }

  const beat = 60 / OPTS.bpm;
  const walkHz = (2 / beat) * 1.0224, warpHz = 1 / beat;
  R.innerHTML = `
    <div class="rate grid">
      <div class="rl"><b>feedback walk</b><span>random · §2</span></div>
      <button class="chip">1/8</button>
      <div class="slider"><div class="sf" style="width:52%"></div><div class="st">+2.24%</div></div>
      <svg class="wave" viewBox="0 0 56 18"><polyline fill="none" stroke="var(--accent)" stroke-width="1.4"
        points="0,12 6,5 12,14 18,7 24,13 30,4 36,11 42,15 48,6 56,10"/></svg>
      <div class="derived">${walkHz.toFixed(2)} Hz</div>
    </div>
    <div class="rate free">
      <div class="rl"><b>tone drift</b><span>sine · unsynced</span></div>
      <div class="slider"><div class="sf" style="width:41%"></div><div class="st">9.09 s</div></div>
      <svg class="wave" viewBox="0 0 56 18"><path fill="none" stroke="var(--auto)" stroke-width="1.4"
        d="M0,9 C9,-1 19,19 28,9 C37,-1 47,19 56,9"/></svg>
      <div class="derived">0.11 Hz</div>
    </div>
    <div class="rate note">
      <div class="rl"><b>time warp</b><span>random · beat-synced</span></div>
      <button class="chip">1/4</button>
      <div class="slider"><div class="sf" style="width:62%"></div><div class="st">40–80%</div></div>
      <svg class="wave" viewBox="0 0 56 18"><polyline fill="none" stroke="var(--ok)" stroke-width="1.4"
        points="0,13 14,13 14,5 28,5 28,14 42,14 42,7 56,7"/></svg>
      <div class="derived">${warpHz.toFixed(2)} Hz</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-top:2px">
      <button id="throw" ${isEcho ? "" : "disabled style=\"opacity:.4\""}>THROW</button>
      <span class="dim mono" style="font-size:9px">peak 0.92 · rise 0.15 s · hold 2.4 s · fall 1.8 s</span>
    </div>`;

  const th = $("#throw");
  if (th && isEcho) th.onclick = () => {
    fx?.throwFeedback(at(), { peak: 0.92, rise: 0.15, hold: 2.4, fall: 1.8 });
    th.dataset.fire = "1"; setTimeout(() => th.dataset.fire = "0", 180);
  };

  // Reverb decay rebuilds an impulse, so it fires once on release.
  const dk = K.querySelector(".knobcell");
  if (!isEcho && dk) {
    dk.addEventListener("pointerup", () => fx?.setDecay?.(cur._dec), true);
  }
}

// ── arc ribbon: sections as they arrive, not a plan drawn in advance ───────────
const arcEl = $("#arc"), head = $("#head");
let shown = [];
function onSection(s, all) {
  shown = all.slice(-12);
  const span = shown.reduce((a, b) => a + b.seconds, 0) || 1;
  arcEl.querySelectorAll(".sec").forEach((n) => n.remove());
  for (const p of shown) {
    const d = document.createElement("div");
    d.className = "sec";
    d.style.flex = p.seconds;
    d.style.background = SC[p.state];
    d.title = `${p.state} — ${Math.round(p.seconds)}s, ${p.gestures.length} gestures — ${p.label}`;
    d.innerHTML = `<div class="g">${"<i></i>".repeat(Math.min(p.gestures.length,8))}</div><b>${p.state}</b><u>${fmt(p.at)}</u>`;
    arcEl.insertBefore(d, head);
  }
  $("#statebadge").textContent = s.state.toUpperCase();
  $("#statebadge").style.background = BADGE[s.state] ?? "var(--ink-2)";
  $("#statelabel").textContent = s.label;
  $("#seclabel").textContent = `section ${s.index + 1} of ∞`;
}

// ── metering: a real analyser tapped off each channel and bus ─────────────────
function tapMeters() {
  const tap = (node, key) => {
    const a = ctx.createAnalyser();
    a.fftSize = 1024; a.smoothingTimeConstant = 0;
    node.connect(a);
    analysers.set(key, { a, buf: new Float32Array(a.fftSize) });
  };
  for (const c of CHANNELS) tap(engine.rig.mix.channel(c).panner, c);
  for (const b of BUSES) tap(engine.rig.mix.bus(b).return, b);
  tap(engine.output, "master");
}

function meterOf(key) {
  const m = analysers.get(key);
  if (!m) return 0;
  m.a.getFloatTimeDomainData(m.buf);
  let s = 0;
  for (let i = 0; i < m.buf.length; i++) s += m.buf[i] * m.buf[i];
  return Math.sqrt(s / m.buf.length);
}

// ── frame loop ────────────────────────────────────────────────────────────────
let last = performance.now();
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  const running = engine?.state === "running";

  if (running) {
    $("#clock").textContent = fmt(engine.time);
    // the playhead sweeps the current (last) section
    const cs = shown.at(-1);
    if (cs) {
      const span = shown.reduce((a, b) => a + b.seconds, 0) || 1;
      const before = shown.slice(0, -1).reduce((a, b) => a + b.seconds, 0);
      const into = clamp(engine.time - cs.at, 0, cs.seconds);
      head.style.left = ((before + into) / span * 100) + "%";
    }
  }

  // the feedback walk, read off the live param rather than modelled
  if (fbKnob && engine) {
    const line = engine.rig.fx[cur.id]?.lines?.[0];
    if (line) {
      const auto = line.fb.gain.value;
      fbKnob.paint(auto, auto);
      cur._fb = auto;
    }
  }

  for (const el of document.querySelectorAll(".strip")) {
    const o = el.__o; if (!o) continue;
    const target = running ? Math.min(1, meterOf(o.id) * 3.2) : 0;
    o.lv += (target - o.lv) * (target > o.lv ? .6 : .12);
    o.pk = Math.max(o.pk - dt * .4, o.lv);
    el.__lv.style.height = (o.lv * 100) + "%";
    el.__pk.style.bottom = (o.pk * 100) + "%";
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);


// ── riddim panel ──────────────────────────────────────────────────────────────
// A panel of documented choices, not a step grid. The options are exactly the
// ones riddim.js exposes and the source names (§4's three drum patterns, §6's
// five transcribed progressions), so nothing here can invent material the frame
// is not supposed to have.
const TONICS = ["C", "D", "Eb", "F", "G", "A", "Bb"];
const SHAPES = ["rootFifthOctave", "rootThirdFifth"];
const GROOVE_LABEL = { displace: "displace", breathe: "breathe", deadNotes: "dead notes", rotate: "rotate" };

function optionRow(host, values, current, onPick, sub = () => "") {
  host.innerHTML = "";
  for (const v of values) {
    const b = document.createElement("button");
    b.className = "opt";
    b.setAttribute("aria-pressed", String(v === current));
    b.innerHTML = `${v}${sub(v) ? `<small>${sub(v)}</small>` : ""}`;
    b.onclick = async () => {
      await onPick(v);
      [...host.children].forEach((c) => c.setAttribute("aria-pressed", String(c === b)));
    };
    host.appendChild(b);
  }
}

function buildRiddimPanel() {
  if (!engine) return;
  const o = engine.riddimOpts;

  optionRow($("#r-kick"), ["synth", ...KICKS.map((k) => k.name)], o.kick,
    async (v) => { $("#f-kick").textContent = await engine.setKick(v === "synth" ? null : v); },
    (v) => { const k = KICKS.find((x) => x.name === v); return k ? `${k.ms} ms · ${Math.round(k.lowShare*100)}% low` : "§5 synthesis"; });

  optionRow($("#r-pattern"), Object.keys(DRUM_PATTERNS), o.pattern,
    (v) => { engine.setRiddim({ pattern: v }); $("#f-pat").textContent = v; });

  optionRow($("#r-prog"), Object.keys(PROGRESSIONS), o.progression,
    (v) => { engine.setRiddim({ progression: v }); $("#f-prog").textContent = v; },
    (v) => `${PROGRESSIONS[v].length} chord${PROGRESSIONS[v].length > 1 ? "s" : ""}`);

  optionRow($("#r-tonic"), TONICS, o.tonic,
    (v) => { engine.setRiddim({ tonic: v }); $("#f-key").textContent = `${v} minor`; });

  optionRow($("#r-shape"), SHAPES, o.bassShape ?? "rootFifthOctave",
    (v) => engine.setRiddim({ bassShape: v }));

  const G = $("#r-groove");
  G.innerHTML = "";
  for (const [key, label] of Object.entries(GROOVE_LABEL)) {
    const row = document.createElement("div");
    row.className = "gsl";
    row.innerHTML = `<b>${label}</b><div class="slider"><div class="sf"></div><div class="st"></div></div>`;
    const sf = row.querySelector(".sf"), st = row.querySelector(".st");
    let v = engine.riddimOpts.groove[key];
    const paint = () => { sf.style.width = v * 100 + "%"; st.textContent = v.toFixed(2); };
    drag(row.querySelector(".slider"), () => v, (nv, live) => {
      v = clamp(nv, 0, 1); paint();
      if (!live) engine.setRiddim({ groove: { [key]: v } });
    }, { axis: "x", scale: 170 });
    paint();
    G.appendChild(row);
  }
}

const openPanel = (on) => {
  $("#scrim").dataset.open = on ? "1" : "0";
  $("#riddim").dataset.open = on ? "1" : "0";
  if (on) buildRiddimPanel();
};
$("#riddimbtn").onclick = () => openPanel($("#riddim").dataset.open !== "1");
$("#scrim").onclick = () => openPanel(false);
window.addEventListener("keydown", (e) => { if (e.key === "Escape") openPanel(false); });

// ── boot ──────────────────────────────────────────────────────────────────────
$("#f-seed").textContent = OPTS.seed;
$("#f-bpm").textContent = OPTS.bpm;
$("#f-key").textContent = `${OPTS.tonic} minor`;
$("#f-prog").textContent = OPTS.progression;
$("#f-pat").textContent = OPTS.pattern;
$("#f-noise").textContent = `synth · ${OPTS.noiseType}`;
$("#f-kick").textContent = "synth";
$("#chnote").textContent = "seed / bpm / key are set at boot — ?seed=7&bpm=125&type=vinyl";

const play = $("#play");
play.disabled = true;
select("echoA");

// The context is created up front but starts suspended, so every control is
// bound before a note plays; the play button is the gesture that resumes it.
ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
bootEngine(ctx, { ...OPTS, onSection }).then((e) => {
  engine = e;
  engine.output.connect(ctx.destination);
  // A live instrument is worth being able to poke at from the console.
  window.dubsynth = { ctx, engine, rig: e.rig, DUB_RIG };
  tapMeters();
  buildDetail();
  buildRiddimPanel();
  play.disabled = false;
  $("#statelabel").textContent = "ready — press play";
}).catch((err) => {
  console.error("[dub_synth] boot failed:", err);
  $("#statelabel").textContent = "boot failed — see console";
});

play.onclick = async () => {
  if (!engine) return;
  if (engine.state === "running") {
    engine.stop();
    play.dataset.on = "0"; play.innerHTML = "&#9654;";
    $("#statebadge").textContent = "IDLE";
  } else {
    await engine.start();
    applyMutes();
    play.dataset.on = "1"; play.textContent = "■";
  }
};

window.addEventListener("keydown", (ev) => {
  if (ev.code === "Space" && ev.target === document.body) { ev.preventDefault(); play.click(); }
});
