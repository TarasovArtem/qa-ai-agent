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

const { REASON, STATUS, STATUS_PRECEDENCE } = require("../kernel/contracts");
const { validateResultRecord } = require("../kernel/results");
const { redactString } = require("../safety/redaction");
const { isPlainObject } = require("../kernel/validation");

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

/** True for a genuine Wave 0 STATUS value (canonical five, or the neutral NOT_APPLICABLE). */
function isValidStatus(value) {
  return typeof value === "string" && (STATUS_PRECEDENCE.includes(value) || value === STATUS.NOT_APPLICABLE);
}

/**
 * The worse of two Wave 0 statuses (design section 22 precedence). NOT_APPLICABLE is
 * neutral (never wins). An unrecognized value on EITHER side is never trusted to win or
 * lose by an accidental `indexOf(-1)` comparison: it fails closed to CONFIGURATION_ERROR,
 * the worst status, so a forged/malformed status can never understate severity.
 */
function worseStatus(a, b) {
  if (a === STATUS.NOT_APPLICABLE) return isValidStatus(b) ? b : STATUS.CONFIGURATION_ERROR;
  if (b === STATUS.NOT_APPLICABLE) return isValidStatus(a) ? a : STATUS.CONFIGURATION_ERROR;
  if (!isValidStatus(a) || !isValidStatus(b)) return STATUS.CONFIGURATION_ERROR;
  return STATUS_PRECEDENCE.indexOf(a) <= STATUS_PRECEDENCE.indexOf(b) ? a : b;
}

// Deliberately larger than any stage's own MAX_ROWS bound (currently 5000 in both 1C and
// 1D): this validator is an outer safety net against a genuinely malformed hand-built
// structure, not the mechanism that reports a stage's own row-count bound as INCOMPLETE --
// that stays each stage's own job, with its own reason code and observed counters.
const MAX_STRUCTURE_TABLES = 4000;
const MAX_STRUCTURE_ROWS_PER_TABLE = 20_000;

/**
 * Runtime-validate a value claiming to be parseMarkdown()'s public frozen structure,
 * before any Wave 2 stage relies on its shape. `checkEvidenceModel()` and
 * `checkConsistency()` are public interfaces: a caller can construct this input by
 * hand, so it is never trusted merely because it looks like 1B's own output.
 */
function isValidMarkdownStructure(structure) {
  if (!isPlainObject(structure) || structure.ok !== true) return false;
  if (typeof structure.path !== "string") return false;
  if (!Array.isArray(structure.headings) || !Array.isArray(structure.anchors) || !Array.isArray(structure.links) || !Array.isArray(structure.definitions)) return false;
  if (!Array.isArray(structure.tables) || structure.tables.length > MAX_STRUCTURE_TABLES) return false;
  for (const table of structure.tables) {
    if (!isPlainObject(table)) return false;
    if (!Number.isInteger(table.line) || !Array.isArray(table.header) || !table.header.every((h) => typeof h === "string")) return false;
    if (!Array.isArray(table.rows) || table.rows.length > MAX_STRUCTURE_ROWS_PER_TABLE) return false;
    for (const row of table.rows) {
      if (!isPlainObject(row) || !Number.isInteger(row.line)) return false;
      if (!Array.isArray(row.cells) || !row.cells.every((c) => typeof c === "string")) return false;
    }
  }
  return true;
}

/**
 * Runtime-validate a value claiming to be the frozen result of 1C's checkEvidenceModel()
 * for the given subject, before 1D trusts any status from it (design: no forged pseudo-
 * record can influence a later stage). Returns the value unchanged when valid, else null
 * -- callers treat null exactly like "no result supplied", never a crash.
 */
function validateStageResult(value, subject, ownerStage) {
  if (!isPlainObject(value) || !Array.isArray(value.records) || !sameSubject(value.subject, subject)) return null;
  if (value.records.length > 256) return null;
  for (const record of value.records) {
    if (!isPlainObject(record) || record.ownerStage !== ownerStage) return null;
    if (validateResultRecord(record).ok !== true) return null;
  }
  if (value.rowIndex !== undefined) {
    if (!Array.isArray(value.rowIndex) || value.rowIndex.length > 5000) return null;
    for (const entry of value.rowIndex) {
      if (!isPlainObject(entry) || typeof entry.id !== "string" || entry.id.length === 0 || entry.id.length > 64 || !isValidStatus(entry.status)) return null;
    }
  }
  return value;
}

module.exports = { safe, cleanText, cleanValue, isValidSubject, sameSubject, createRecordFactory, sample, isValidStatus, worseStatus, isValidMarkdownStructure, validateStageResult };
