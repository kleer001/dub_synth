// dub_synth/kicks.js — the kick sample shelf.
//
// The synthesized kick in voices.js is built to §5's "thumpy and stiff" and is
// the default. This is the alternative: a small curated shelf of one-shots from
// a mounted library, indexed by scan_kicks.mjs and ranked by the genre's own
// stated preferences (§1's 20-350 Hz dominance, §5's short stiff tail).
//
// As with the noise corpus, the manifest travels with the repo and the audio does
// not. Nothing here reads the disk — decoding differs between Node and a browser,
// so each caller hands in bytes and the shared part is only the index.

import manifest from "./data/kicks.json" with { type: "json" };

export const KICKS = manifest.entries;
export const kickRoot = manifest.root;

export function findKick(name) {
  if (!name || name === "synth") return null;
  const hit = KICKS.find((k) => k.name === name)
    ?? KICKS.find((k) => k.name.toLowerCase().startsWith(String(name).toLowerCase()));
  if (!hit) {
    throw new Error(`unknown kick "${name}" — known: synth, ${KICKS.map((k) => k.name).join(", ")}`);
  }
  return hit;
}

// The URL the dev server mounts a kick at. serve.mjs maps /samples/ onto the
// library root so the desk can fetch what the manifest points at.
export const kickUrl = (entry) => `/samples/${entry.rel.split("/").map(encodeURIComponent).join("/")}`;
