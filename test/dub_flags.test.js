// The flag surface of the offline tools, against the docs that describe it. Pure
// string work over the sources, so it runs with no audio context.
//
// Both directions are faults. A flag that is parsed but absent from its tool's
// usage block cannot be found by anyone reading --help. A flag in the usage block
// that nothing parses is worse: it no-ops in silence and the user believes the
// run did what the docs said it did.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

// The leading comment block is the tool's own --help; it ends at the first line
// that is not a comment.
const documentedFlags = (src) => {
  const lines = src.split("\n");
  const end = lines.findIndex((l) => !l.startsWith("//"));
  return new Set(lines.slice(0, end).flatMap((l) => [...l.matchAll(/--([a-z]+)/g)].map((m) => m[1])));
};

// Every flag the tool actually reads. process.argv is the raw array, not a flag.
const parsedFlags = (src) =>
  new Set([...src.matchAll(/(?<!process\.)argv\.([a-z]+)/g)].map((m) => m[1]));

const missing = (a, b) => [...a].filter((x) => !b.has(x)).sort();

// A flag can be parsed into a binding and then go nowhere, which reads as a
// working flag from every angle except the behaviour. The bindings are
// SCREAMING_CASE by convention, so a name that occurs once is its own
// declaration and nothing else.
const deadBindings = (src) =>
  [...src.matchAll(/^const ([A-Z][A-Z_]*) = [^\n]*\bargv\b/gm)]
    .map((m) => m[1])
    .filter((name) => [...src.matchAll(new RegExp(`\\b${name}\\b`, "g"))].length < 2)
    .sort();

for (const tool of ["tools/render.mjs", "tools/stems.mjs"]) {
  test(`${tool} documents every flag it reads and reads every flag it documents`, () => {
    const src = read(tool);
    const parsed = parsedFlags(src), documented = documentedFlags(src);
    assert.ok(parsed.size > 0, "no flags parsed — the reader regex has stopped matching");
    assert.deepEqual(missing(parsed, documented), [], "parsed but missing from the usage block");
    assert.deepEqual(missing(documented, parsed), [], "in the usage block but never read");
    assert.deepEqual(deadBindings(src), [], "parsed into a binding that nothing reads");
  });
}

test("every npm script is in the README command table", () => {
  const readme = read("README.md");
  const { scripts } = JSON.parse(read("package.json"));
  const undocumented = Object.keys(scripts).filter(
    (s) => !readme.includes(s === "test" ? "`npm test`" : `\`npm run ${s}\``));
  assert.deepEqual(undocumented, [], "scripts the README never names");
});
