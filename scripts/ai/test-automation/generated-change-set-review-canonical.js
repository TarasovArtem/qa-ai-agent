/**
 * Deterministic snapshot + canonicalization + content-digest primitives for
 * the #23E GeneratedChangeSet human review layer.
 *
 * This module is the trust boundary EVERY #23E caller-supplied input
 * crosses before it can influence a review package, a review record, or a
 * digest. It exists because a human approval must be bound to EXACT
 * reviewed content (mirrors #22F's own "PACKAGE DIGEST - CORE SECURITY
 * PROPERTY" rationale, now applied to proposed repository file content
 * rather than Test Design artifacts) - if the snapshot or the digest
 * computation could be influenced by caller-controlled object behavior (a
 * prototype trick, an overridden array method, a
 * `toJSON`/`valueOf`/`Symbol.toPrimitive` hook, a getter that answers
 * differently on a second read), the digest would not actually represent
 * what a human reviewer saw, defeating the entire point of this layer.
 *
 * Roadmap #23E: this is a FRESH, independent reimplementation of the same
 * hardened pattern test-design-review-canonical.js (#22F) and
 * generated-change-set.js (#23D) already established - never imported from
 * either. This repository's established convention is "small duplicated
 * primitives, not a shared refactor" across roadmap-stage boundaries, so a
 * future change to #22F's or #23D's own trust boundary can never silently
 * affect #23E's, and vice versa.
 *
 * SNAPSHOT: Object.create(null) + Object.defineProperty for records;
 * manual bracket-index reads for arrays, never a source-resolved method;
 * an explicit `ancestors` Set tracks the current recursion chain and
 * REJECTS a genuine cycle immediately (a CYCLE sentinel propagated through
 * every enclosing frame, never collapsed to `null` partway up - `null` is
 * itself a valid, ordinary value in this data domain, so collapsing a
 * cycle to `null` would make corrupted input indistinguishable from
 * legitimate content).
 *
 * CANONICALIZATION: converts an already-snapshotted (therefore already
 * caller-independent) plain-data tree into ONE deterministic string -
 * object keys sorted, arrays kept in their already-canonical order, every
 * value type explicitly handled, anything unsupported (undefined,
 * function, symbol, bigint, non-finite number, a non-plain-record object)
 * rejected outright rather than silently coerced. Because this function
 * only ever receives the OWNED snapshot tree - never the caller's original
 * object - it never has an opportunity to invoke a caller's `toJSON`,
 * `valueOf`, `Symbol.toPrimitive`, or iterator.
 *
 * DIGEST: SHA-256 (`node:crypto`, no dependency added) of a domain-
 * separated envelope - `"<DOMAIN_PREFIX><label>:" + canonical` - so a
 * digest computed for one artifact kind/purpose can never collide with, or
 * be silently reinterpreted as, a digest for a different kind/purpose even
 * if the underlying canonical payloads happen to be byte-identical.
 * Format: `"sha256:" + 64 lowercase hex characters` - the sole accepted
 * stored format, no shortened form, no uppercase, ever used for a binding
 * comparison.
 *
 * This module provides CONTENT INTEGRITY IDENTITY and STALE-APPROVAL
 * DETECTION only. It is NOT a digital signature, does NOT authenticate a
 * reviewer, and provides NO non-repudiation guarantee - see
 * generated-change-set-review-record.js's own docstring for
 * FUTURE_REVIEWER_IDENTITY_PROVENANCE_GUARD and
 * FUTURE_HUMAN_DECISION_PROVENANCE_GUARD, which this module deliberately
 * does not attempt to close.
 */

"use strict";

const crypto = require("node:crypto");

// Roadmap #23E: every digest computed by this module is prefixed with this
// exact string plus a caller-supplied label identifying WHAT is being
// hashed - see computeDigest() below. Deliberately versioned (":v1" in
// each label) so a future incompatible canonicalization change can never
// silently produce a digest indistinguishable from a v1 one. Uses the
// same literal domain prefix #22F/#23D already use - actual cross-
// artifact-kind collision prevention comes from the per-call `label`
// argument, not from this shared, repository-wide constant.
const DOMAIN_PREFIX = "qa-ai-agent:";

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Defines `key` on `out` as an ordinary OWN DATA property via
// [[DefineOwnProperty]] - never a plain `out[key] = value` assignment,
// which uses [[Set]] semantics and would let a caller-supplied own
// "__proto__" key silently change `out`'s actual prototype instead of
// becoming a visible own field.
function defineOwnSnapshotProperty(out, key, value) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

const CYCLE = Symbol("qa-ai-agent:generated-change-set-review:cycle-detected");

function snapshotValue(value, ancestors) {
  if (value === null || typeof value !== "object") return value; // primitives (including bigint), functions, symbols, undefined pass through unchanged - never invoked, never coerced
  if (ancestors.has(value)) return CYCLE;

  if (Array.isArray(value)) {
    ancestors.add(value);
    const length = value.length;
    if (typeof length !== "number" || !Number.isInteger(length) || length < 0) {
      ancestors.delete(value);
      return null;
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      ancestors.delete(value);
      return null;
    }
    const ownKeys = Object.keys(value);
    if (ownKeys.length !== length) {
      ancestors.delete(value);
      return null;
    }
    for (let i = 0; i < length; i += 1) {
      if (ownKeys[i] !== String(i)) {
        ancestors.delete(value);
        return null;
      }
    }
    const out = new Array(length);
    for (let i = 0; i < length; i += 1) {
      const key = String(i);
      const captured = value[key]; // direct indexed read, exactly once - never a source-resolved method
      const snapshotted = snapshotValue(captured, ancestors);
      if (snapshotted === CYCLE) {
        ancestors.delete(value);
        return CYCLE;
      }
      defineOwnSnapshotProperty(out, key, snapshotted);
    }
    ancestors.delete(value);
    return out;
  }

  if (!isPlainRecord(value)) return null; // Date/Map/Set/class instance
  if (Object.getOwnPropertySymbols(value).length > 0) return null; // fail-closed plain-data policy

  ancestors.add(value);
  const out = Object.create(null);
  for (const key of Object.keys(value)) {
    const captured = value[key]; // direct property read, exactly once - never a source-resolved method/getter re-read
    const snapshotted = snapshotValue(captured, ancestors);
    if (snapshotted === CYCLE) {
      ancestors.delete(value);
      return CYCLE;
    }
    defineOwnSnapshotProperty(out, key, snapshotted);
  }
  ancestors.delete(value);
  return out;
}

/**
 * Reads the ENTIRE caller-supplied `value` exactly once, at any nesting
 * depth, into a fresh, #23E-owned plain-data tree - never a live
 * reference back to the caller's original structure, never invoking a
 * caller-supplied `toJSON`/method/iterator/getter more than once per own
 * property, and never accepting a cyclic structure (explicit, bounded
 * rejection to `null` - never stack-depth exhaustion). A getter/accessor
 * that throws during this single read is caught here and reported as
 * `null` - the caller's own downstream shape validation then rejects it as
 * a bounded, structural error, never a raw exception, marker, or stack
 * trace.
 */
function snapshotOwnData(value) {
  try {
    const result = snapshotValue(value, new Set());
    return result === CYCLE ? null : result;
  } catch {
    return null;
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

function canonicalStringify(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalStringify: non-finite number is not valid digest input");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(value[k])}`).join(",")}}`;
  }
  throw new Error("canonicalStringify: unsupported value type for digest input");
}

function sha256Hex(input) {
  return crypto.createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Computes a domain-separated SHA-256 content digest of `value` (which
 * MUST already be owned, caller-independent snapshot data - never a raw
 * caller object). `label` identifies what is being hashed so digests for
 * different artifact kinds/purposes can never collide or be confused with
 * one another even if their canonical payloads happen to be identical
 * strings.
 *
 * Returns `"sha256:" + 64 lowercase hex characters`.
 */
function computeDigest(label, value) {
  const canonical = canonicalStringify(value);
  return `sha256:${sha256Hex(`${DOMAIN_PREFIX}${label}:${canonical}`)}`;
}

function isValidDigest(value) {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

module.exports = {
  isPlainRecord,
  snapshotOwnData,
  deepFreeze,
  canonicalStringify,
  computeDigest,
  isValidDigest,
  DIGEST_PATTERN,
};
