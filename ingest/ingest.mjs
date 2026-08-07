// Stage 1 — ingest the Koçer thesis into a page-indexed corpus.
//
// Source: Bahadırhan Koçer, "Dub Techno as Orphic Experience: Auditory
// Aesthetics, Spatiality, and Sound" (M.A. thesis, İTÜ Musicology, 2023).
// The PDF itself is untracked raw input; this script regenerates everything
// derived from it.
//
//   node dub_synth/ingest/ingest.mjs
//
// Writes pages.jsonl (one record per PDF page, with the printed page label
// recovered from the running footer) and sections.json (the TOC, mapped from
// printed labels to PDF page indices).

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const PDF = resolve(REPO, 'research/sources/kocer_2023_dub_techno_orphic.pdf');
const OUT_PAGES = resolve(HERE, 'pages.jsonl');
const OUT_SECTIONS = resolve(HERE, 'sections.json');

// The thesis TOC, transcribed from the front matter. Printed page numbers, not
// PDF indices — resolvePdfPage() maps them. The trailing tag records which
// layer a section belongs to: 'technical' sections carry measurable material
// (signal chains, parameters, notation, timings), 'prose' carries the
// musicological and philosophical argument, 'mixed' interleaves both.
const TOC = [
  ['1', 'INTRODUCTION', 1, 'prose'],
  ['2', 'METHODOLOGY', 9, 'prose'],
  ['3', 'LITERATURE REVIEW', 13, 'prose'],
  ['4', 'ORPHIC EXPERIENCE: A NEW WAY TO ENGAGE WITH SOUND', 17, 'prose'],
  ['4.1', 'Orphic Media', 17, 'prose'],
  ['4.1.1', 'Abstract space and milieu', 19, 'prose'],
  ['4.1.2', 'Orpheus and the Sirens', 22, 'prose'],
  ['4.2', 'An Approach to Orphic Experience', 24, 'prose'],
  ['5', 'ECHOES OF THE PAST: THE HISTORY AND EVOLUTION OF DUB', 27, 'prose'],
  ['5.1', 'The Sound System Culture of Dub Music', 31, 'mixed'],
  ['5.2', 'Exploring the Production Foundations', 37, 'mixed'],
  ['5.2.1', 'The riddim', 40, 'technical'],
  ['5.2.2', 'Fundamental deconstruction of the dub echo', 47, 'technical'],
  ['5.2.2.1', 'The technical aspect', 48, 'technical'],
  ['5.2.2.2', 'The musical aspect', 58, 'technical'],
  ['6', 'PIONEERING THE FUTURE: THE BIRTH AND GROWTH OF TECHNO', 69, 'prose'],
  ['6.1', 'A Concise Approach to the Style', 69, 'prose'],
  ['6.2', 'From Studio to the Dancefloor', 72, 'prose'],
  ['6.2.1', 'Detroit techno', 91, 'prose'],
  ['6.2.1.1', "Model 500's No UFOs", 93, 'technical'],
  ['6.2.1.2', "Derrick May's Strings of Life", 100, 'technical'],
  ['6.2.2', 'Acid techno', 106, 'prose'],
  ['6.2.2.1', "Plastikman's Plasticine", 108, 'technical'],
  ['6.2.2.2', "Emmanuel Top's Acid Phase", 115, 'technical'],
  ['6.2.3', 'Minimal techno', 121, 'prose'],
  ['6.2.3.1', "Robert Hood's Minus", 126, 'technical'],
  ['6.2.3.2', "Daniel Bell's Baby Judy", 135, 'technical'],
  ['7', 'THE FUSION: A BRIEF HISTORY AND ANALYSIS OF DUB TECHNO', 143, 'prose'],
  ['7.1', 'The Invention Phase', 143, 'prose'],
  ['7.2', 'The Sound', 148, 'mixed'],
  ['7.2.1', 'A hauntological approach to noise', 156, 'mixed'],
  ['7.3', 'The Right Room Issue', 164, 'prose'],
  ['7.3.1', "Rhythm & Sound's Aerial", 171, 'technical'],
  ['7.3.2', "Basic Channel's Phylyps Trak", 178, 'technical'],
  ['7.3.3', "Yagya's The Salt On Her Cheeks", 186, 'technical'],
  ['7.3.4', "Overcast Sound's Listing, Sinking", 194, 'technical'],
  ['7.3.5', "Substance & Vainqueur's Resonance", 202, 'technical'],
  ['7.3.6', "Topdown Dialectic's B4", 211, 'technical'],
  ['8', 'DISCUSSION', 223, 'prose'],
  ['9', 'CONCLUSION', 245, 'prose'],
  ['REF', 'REFERENCES', 249, 'prose'],
  ['APP', 'APPENDICES', 259, 'prose'],
  ['APP.A.1', 'APPENDIX A.1', 261, 'prose'],
  ['CV', 'CURRICULUM VITAE', 271, 'prose'],
];

const text = execFileSync('pdftotext', ['-layout', PDF, '-'], {
  encoding: 'utf8',
  maxBuffer: 1 << 28,
});

// pdftotext emits a form feed between pages.
const rawPages = text.split('\f');
if (rawPages.at(-1).trim() === '') rawPages.pop();

// The running footer is the page label alone on the last non-empty line:
// arabic in the body, roman in the front matter.
const LABEL = /^\s*(\d{1,3}|[ivxlcdm]{1,7})\s*$/i;

const pages = rawPages.map((body, i) => {
  const lines = body.split('\n');
  let label = null;
  for (let j = lines.length - 1; j >= 0 && j >= lines.length - 4; j--) {
    const m = lines[j].match(LABEL);
    if (m) {
      label = m[1];
      break;
    }
  }
  const printed = label !== null && /^\d+$/.test(label) ? Number(label) : null;
  return {
    pdf_page: i + 1,
    label,
    printed,
    chars: body.length,
    text: body.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim(),
  };
});

const byPrinted = new Map();
for (const p of pages) if (p.printed !== null && !byPrinted.has(p.printed)) byPrinted.set(p.printed, p.pdf_page);

// Pages whose footer was swallowed by a full-bleed figure get interpolated from
// the nearest labelled neighbour, so every TOC entry resolves.
const resolvePdfPage = (printed) => {
  for (let d = 0; d <= 6; d++) {
    if (byPrinted.has(printed - d)) return byPrinted.get(printed - d) + d;
    if (byPrinted.has(printed + d)) return byPrinted.get(printed + d) - d;
  }
  throw new Error(`cannot locate printed page ${printed}`);
};

const sections = TOC.map(([num, title, printed, layer], i) => {
  const start = resolvePdfPage(printed);
  const nextPrinted = TOC[i + 1]?.[2];
  const end = nextPrinted === undefined ? pages.length : Math.max(start, resolvePdfPage(nextPrinted) - 1);
  return { num, title, layer, printed_start: printed, pdf_start: start, pdf_end: end };
});

writeFileSync(OUT_PAGES, pages.map((p) => JSON.stringify(p)).join('\n') + '\n');
writeFileSync(OUT_SECTIONS, JSON.stringify({ source: 'kocer_2023_dub_techno_orphic.pdf', pages: pages.length, sections }, null, 2) + '\n');

const labelled = pages.filter((p) => p.label !== null).length;
console.log(`${pages.length} pages -> pages.jsonl (${labelled} with a recovered footer label)`);
console.log(`${sections.length} sections -> sections.json`);
