//! Deterministic integer hashing of world coordinates. Every placement decision
//! (trees, plants, waterfalls) is a pure function of position and seed, so any
//! chunk computing it, in any order or worker, gets the same answer.

function mix(h) {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Uniform value in [0, 1) for (x, z) */
export function hash2(seed, x, z, salt = 0) {
  return mix(Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b9) ^ seed) / 4294967296;
}

/** Uniform value in [0, 1) for (x, y, z) */
export function hash3(seed, x, y, z, salt = 0) {
  return mix(Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x61c88647) ^ Math.imul(z, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b9) ^ seed) / 4294967296;
}

/** Seed number → 32-bit integer usable by the hashes (seeds may be fractional) */
export function seedInt(seed) {
  return mix(Math.floor(seed * 1000003) | 0);
}
