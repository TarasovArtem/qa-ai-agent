/**
 * GOV-AUTO-1 Wave 1 -- helpers shared by stages 1A and 1B (internal).
 *
 * Every record a stage emits is built through createRecordFactory(): it is bound
 * to one exact subject (head, tree, base, range) and is passed through the Wave 0
 * validateResultRecord before it is kept, so a stage can never emit an unbound
 * or malformed record. Detail text is bounded and redacted; it never carries raw
 * command output, raw file content or a raw secret.
 */

"use strict";

const { REASON, STATUS } = require("../kernel/contracts");
const { validateResultRecord } = require("../kernel/results");
const { redactString } = require("../safety/redaction");

// Characters that can spoof or corrupt a terminal, log or rendered report: C0 and C1
// controls (NUL, ESC, CR, LF, ...), DEL, bidirectional overrides/isolates/marks, zero-width
// and invisible formatting characters, line/paragraph separators and the byte-order mark.
// eslint-disable-next-line no-control-regex
const UNSAFE_DISPLAY = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

/**
 * Inert display text: every unsafe character becomes a visible `\uXXXX` escape, so a
 * finding stays diagnosable but can never move a cursor, colour a terminal, reorder text
 * or forge a line. This is the ONE sanitizer for untrusted text placed in a result record.
 */
function cleanText(text) {
  return String(text).replace(UNSAFE_DISPLAY, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Deeply sanitize every string inside a JSON-like value (keys are fixed framework labels). */
function cleanValue(value) {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map(cleanValue);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = cleanValue(value[key]);
    return out;
  }
  return value;
}

/** Bounded, redacted, single-line-safe text for `detail` fields. */
function safe(text) {
  // eslint-disable-next-line no-control-regex
  return redactString(cleanText(String(text).replace(/[\u0000-\u001f\u007f]/g, " ")), { maxLength: 300 });
}

/** True when `subject` is a valid Wave 0 subject (all-40-hex identity and a mode/from/to range). */
function isValidSubject(subject) {
  const probe = { checkId: "PROBE", ownerStage: "1A", status: STATUS.PASS, subject, observed: {}, expected: null, reasonCode: REASON.OK, detail: "", evidenceRefs: [] };
  return validateResultRecord(probe).ok === true;
}

/** Two subjects are the same run identity only when they are structurally identical. */
function sameSubject(a, b) {
  return isValidSubject(a) && isValidSubject(b) &&
    a.head === b.head && a.tree === b.tree && a.base === b.base &&
    a.range.mode === b.range.mode && a.range.from === b.range.from && a.range.to === b.range.to;
}

function createRecordFactory(subject, ownerStage) {
  const records = [];
  const add = (checkId, status, reasonCode, detail, observed = {}, expected = null) => {
    // Untrusted text (a Markdown fragment, a path, a token) can reach observed/expected, not just detail.
    const record = { checkId, ownerStage, status, subject, observed: cleanValue(observed), expected: cleanValue(expected), reasonCode, detail: safe(detail), evidenceRefs: [] };
    const checked = validateResultRecord(record);
    // A programming error (never input-driven): callers only pass bounded JSON values.
    if (!checked.ok) throw new Error(`internal error: invalid ${ownerStage} record ${checkId}: ${checked.problems.join("; ")}`);
    records.push(checked.record);
  };
  const notApplicable = (checkId, proof) => add(checkId, STATUS.NOT_APPLICABLE, REASON.OK, proof, { applicabilityProof: proof });
  return { records, add, notApplicable };
}

/** First `limit` items, bounded, for `observed` samples. */
function sample(list, limit = 10) {
  return list.slice(0, limit).map((item) => String(item).slice(0, 300));
}

module.exports = { safe, cleanText, cleanValue, isValidSubject, sameSubject, createRecordFactory, sample };
