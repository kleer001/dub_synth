// dub_synth/serve.mjs — the dev server for the live desk.
//
// The desk is plain ES modules importing the engine straight out of the repo
// (../rig.js, ../dsp/echo.js …), so it has to be served from the repo ROOT, not
// from ui/ — served from ui/ every one of those imports escapes the document
// root and 404s.
//
// Two things this does that `python -m http.server` does not:
//
//   no-store — a static server that lets the browser cache module files will
//   happily hand back a stale dsp/*.js after an edit, and the page then reports
//   the behaviour of code that is no longer on disk. That is an hour of chasing
//   a bug that is already fixed.
//
//   an adaptive port — a leftover server on the default otherwise kills the
//   launch with EADDRINUSE. Scan upward and say so when the port moves.

import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

const ROOT = dirname(fileURLToPath(import.meta.url));
const WANTED = Number(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

const freePort = (from) => new Promise((resolve) => {
  const probe = (p) => {
    if (p > from + 40) return resolve(from);
    const s = createConnection({ port: p, host: "127.0.0.1" });
    s.on("connect", () => { s.destroy(); probe(p + 1); });
    s.on("error", () => resolve(p));
  };
  probe(from);
});

const port = await freePort(WANTED);

createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const rel = normalize(url === "/" ? "/ui/index.html" : url).replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, rel);

  // Serving the repo means serving source; keep it inside the repo and nothing else.
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("outside the repo"); return; }

  let st;
  try { st = statSync(file); } catch { res.writeHead(404).end(`404 ${rel}`); return; }
  if (st.isDirectory()) { res.writeHead(404).end(`404 ${rel} is a directory`); return; }

  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-length": st.size,
    // The whole point: an edit is visible on the next reload, always.
    "cache-control": "no-store, must-revalidate",
  });
  createReadStream(file).pipe(res);
}).listen(port, "127.0.0.1", () => {
  if (port !== WANTED) console.log(`port ${WANTED} was busy — moved up to ${port}`);
  console.log(`dub_synth desk → http://127.0.0.1:${port}/ui/index.html`);
  console.log(`  ?seed=7&bpm=125&type=vinyl&worklet=0   (worklet=0 forces the granular pitch shifter)`);
});
