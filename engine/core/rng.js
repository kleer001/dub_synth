// Seeded RNG (mulberry32). Audio sits outside any game determinism contract, but
// seeding *generation* (patterns, arrangement) makes the demos reproducible: same
// seed → same pattern. Real-time humanization may still use Math.random.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A seeded RNG object with the helpers the generators want.
export function makeRng(seed = 1) {
  const r = mulberry32(seed >>> 0 || 1);
  const api = {
    next: r,
    float: (a = 0, b = 1) => a + r() * (b - a),
    int: (a, b) => Math.floor(a + r() * (b - a + 1)),
    chance: (p) => r() < p,
    pick: (arr) => arr[(r() * arr.length) | 0],
    weighted: (entries) => {
      // entries: [[item, weight], ...]
      let tot = 0;
      for (const [, w] of entries) tot += w;
      let x = r() * tot;
      for (const [item, w] of entries) if ((x -= w) <= 0) return item;
      return entries[entries.length - 1][0];
    },
  };
  return api;
}
