// Deterministic hashes and random numbers for the world and the UI. No three.js here: the indexer window
// draws the stand-in covers with the same helpers.

/** A small seeded random generator (mulberry32): the same seed gives the same sequence. */
export function seeded(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/** FNV-1a hash of a string. */
export function hashStr(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
