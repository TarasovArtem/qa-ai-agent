/**
 * GOV-AUTO-1 Wave 1 -- restricted repository path-pattern grammar.
 *
 * Policy files are repository input, so a pattern is never handed to a regular
 * expression engine. The grammar is deliberately tiny:
 *   - a pattern is `/`-separated segments, at most MAX_SEGMENTS, at most
 *     MAX_PATTERN_LENGTH characters;
 *   - a segment is literal characters [A-Za-z0-9._@+~-] and `*` (any run of
 *     characters within ONE segment, never across `/`);
 *   - `**` may appear as the FIRST segment (any number of leading directories,
 *     including none, e.g. `**` + `/*.md`) or as the LAST segment (one or more
 *     further segments, e.g. `docs/**`), never both and never elsewhere;
 *   - no `?`, `[`, `{`, `\`, no empty, `.` or `..` segment, no absolute path.
 * Matching is case-sensitive and bytewise (Git path identity): there is no case
 * folding and no Unicode normalization. Matching cost is bounded by
 * O(pattern * path) with an iterative wildcard matcher (no backtracking blow-up).
 */

"use strict";

const { deepFreeze } = require("../kernel/contracts");

const MAX_PATTERN_LENGTH = 200;
const MAX_SEGMENTS = 16;
const SEGMENT = /^[A-Za-z0-9._@+~*-]+$/;

/**
 * Parse a pattern. Returns { ok, pattern } where pattern is
 * { text, segments (fixed segments only), deep (trailing **), leadingDeep (leading **) }.
 */
function parsePathPattern(text) {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_PATTERN_LENGTH) return { ok: false };
  const all = text.split("/");
  if (all.length > MAX_SEGMENTS) return { ok: false };
  const leadingDeep = all.length > 1 && all[0] === "**";
  const deep = all[all.length - 1] === "**";
  if (leadingDeep && deep) return { ok: false };
  const fixed = all.slice(leadingDeep ? 1 : 0, deep ? all.length - 1 : all.length);
  for (const segment of fixed) {
    if (segment === "" || segment === "." || segment === ".." || segment.includes("**") || !SEGMENT.test(segment)) return { ok: false };
  }
  if (fixed.length === 0 && !deep) return { ok: false };
  return { ok: true, pattern: deepFreeze({ text, segments: fixed, deep, leadingDeep }) };
}

/** Iterative single-segment glob (`*` only), linear-ish and non-recursive. */
function matchSegment(glob, value) {
  let g = 0;
  let v = 0;
  let star = -1;
  let mark = 0;
  while (v < value.length) {
    if (g < glob.length && glob[g] === "*") {
      star = g;
      mark = v;
      g += 1;
    } else if (g < glob.length && glob[g] === value[v]) {
      g += 1;
      v += 1;
    } else if (star !== -1) {
      g = star + 1;
      mark += 1;
      v = mark;
    } else {
      return false;
    }
  }
  while (g < glob.length && glob[g] === "*") g += 1;
  return g === glob.length;
}

/** True when `path` (a validated repository-relative path) matches the parsed pattern. */
function matchPathPattern(pattern, path) {
  if (typeof path !== "string" || path.length === 0) return false;
  const parts = path.split("/");
  const n = pattern.segments.length;
  if (pattern.leadingDeep) {
    if (parts.length < n) return false;
    const offset = parts.length - n;
    for (let i = 0; i < n; i += 1) if (!matchSegment(pattern.segments[i], parts[offset + i])) return false;
    return true;
  }
  if (pattern.deep ? parts.length <= n : parts.length !== n) return false;
  for (let i = 0; i < n; i += 1) if (!matchSegment(pattern.segments[i], parts[i])) return false;
  return true;
}

function segmentCovers(baseSegment, candidateSegment) {
  if (baseSegment === "*" || baseSegment === candidateSegment) return true;
  return !candidateSegment.includes("*") && matchSegment(baseSegment, candidateSegment);
}

/**
 * True only when every path matched by `candidate` is provably matched by `base`
 * (conservative: an unprovable case is false). Used to tell a tightening
 * proposal (a subset of a base domain) from a loosening one.
 */
function patternCovers(base, candidate) {
  const b = base.segments;
  const c = candidate.segments;
  if (base.leadingDeep) {
    // Only the trailing fixed segments constrain the match; the candidate must be
    // bounded on the right (not a trailing `**`) and at least as long as the base tail.
    if (candidate.deep || c.length < b.length) return false;
    for (let i = 0; i < b.length; i += 1) if (!segmentCovers(b[i], c[c.length - b.length + i])) return false;
    return true;
  }
  if (candidate.leadingDeep) return false; // unbounded on the left cannot be covered by a bounded prefix
  if (base.deep) {
    if (c.length < b.length || (c.length === b.length && !candidate.deep)) return false;
    for (let i = 0; i < b.length; i += 1) if (!segmentCovers(b[i], c[i])) return false;
    return true;
  }
  if (candidate.deep || c.length !== b.length) return false;
  for (let i = 0; i < b.length; i += 1) if (!segmentCovers(b[i], c[i])) return false;
  return true;
}

module.exports = { parsePathPattern, matchPathPattern, patternCovers, MAX_PATTERN_LENGTH, MAX_SEGMENTS };
