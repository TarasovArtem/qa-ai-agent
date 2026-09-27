/**
 * GOV-AUTO-1 Wave 2 / 1C -- canonical evidence result-set contract (private).
 * Corrective C3 (Wave 2 C2 re-review, W2-C1-SEC-H1 / W2-C2-SEC-M1).
 *
 * The C2 re-review proved that per-record structural validity (stages/common.js#
 * validateStageResult()) is not enough: a caller can hand-construct a `records[]`
 * array containing ONE well-formed-looking `1C.EVIDENCE.ROW_INDEX` record and
 * nothing else, and get it trusted as if it were genuine checkEvidenceModel()
 * output -- because nothing checked whether the RECORD SET as a whole was even
 * plausible as that function's output. This module is that stronger, 1C-specific
 * check: "internally self-consistent" (the documented composition trust model's
 * own words) means the exact canonical check-set checkEvidenceModel() actually
 * emits, complete and free of duplicates -- not an arbitrary bag of individually
 * valid records.
 *
 * The required shape was derived by tracing every `return done()` in ./evidence.js,
 * not assumed:
 *   - "1C.EVIDENCE.CONFIG" is emitted one or more times: once per problematic
 *     document/table found while selecting evidence tables (0 or more), PLUS
 *     exactly one terminal summary/NOT_APPLICABLE record. It is the only
 *     canonical check whose count is not fixed (confirmed by direct probe: a
 *     mix of one malformed table and one clean table produces TWO CONFIG
 *     records in genuine output) -- so CONFIG is required to appear at least
 *     once, never required to appear exactly once.
 *   - "1C.EVIDENCE.STRUCTURE", "1C.EVIDENCE.PREMISES", "1C.EVIDENCE.PROPAGATION",
 *     "1C.EVIDENCE.PROMOTION_WORDING" and "1C.EVIDENCE.ROW_INDEX" are each added
 *     through exactly one of several MUTUALLY EXCLUSIVE branches or early
 *     returns -- every reachable path for a valid subject emits each of these
 *     exactly once, never zero, never more than one.
 * A checkId outside this known set, a missing required singleton, or a
 * duplicated required singleton can never be genuine output, however
 * individually well-formed each present record is -- the whole result-set is
 * rejected.
 *
 * This module deliberately does NOT reject legitimate cross-record combinations
 * such as STRUCTURE=FAIL coexisting with ROW_INDEX=PASS: a table with one bad
 * row and one clean row genuinely produces exactly that (STRUCTURE fails on the
 * bad row; ROW_INDEX still PASSes as a container, correctly reporting the clean
 * row's own PASS status, since the bad row was never added to the row set at
 * all -- confirmed by direct probe). A blanket status-poisoning rule would
 * reject real producer output, which design section 34 (and this module's own
 * purpose) explicitly forbids. Requiring the canonical check-set to be complete
 * and unique is sufficient to close both W2-C1-SEC-H1 and W2-C2-SEC-M1 without
 * inventing any such rule.
 *
 * No cryptographic provenance is invented here (design sections 20/39-40): a
 * same-subject 1C result is accepted once it is structurally valid, canonical,
 * complete, unique by canonical check ID and (for ROW_INDEX) individually
 * well-formed -- exactly the "internal self-consistency" the trust model always
 * promised, no stronger.
 */

"use strict";

const { STATUS } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { validateStageResult, isValidStatus } = require("../common");

const CONFIG_CHECK_ID = "1C.EVIDENCE.CONFIG";
const ROW_INDEX_CHECK_ID = "1C.EVIDENCE.ROW_INDEX";
// Every canonical 1C check other than CONFIG: exactly one record required, never more.
const REQUIRED_SINGLETON_CHECKS = ["1C.EVIDENCE.STRUCTURE", "1C.EVIDENCE.PREMISES", "1C.EVIDENCE.PROPAGATION", "1C.EVIDENCE.PROMOTION_WORDING", ROW_INDEX_CHECK_ID];
// Model choice (design section 19): strict exact known-set. An unrecognized 1C.EVIDENCE.*
// checkId is rejected outright rather than silently allowed to coexist, because nothing
// here can prove a future/unknown record type could never alter trust semantics.
const KNOWN_CHECK_IDS = new Set([CONFIG_CHECK_ID, ...REQUIRED_SINGLETON_CHECKS]);

/**
 * Extract the per-row projection from an already canonically-unique ROW_INDEX record.
 * Never called until the containing result-set has passed completeness/uniqueness
 * validation below. Returns null when the record did not resolve PASS, or is malformed,
 * or contains a duplicate row id -- the whole projection is rejected, never a partial
 * one (preserves corrective C2 / W2-C1-SEC-M1 behavior).
 */
function extractRowIndex(record) {
  if (record.status !== STATUS.PASS) return null;
  if (!isPlainObject(record.observed) || !Array.isArray(record.observed.rows)) return null;
  const map = new Map();
  for (const entry of record.observed.rows) {
    if (!isPlainObject(entry) || typeof entry.id !== "string" || !isValidStatus(entry.status)) return null;
    if (map.has(entry.id)) return null;
    map.set(entry.id, entry.status);
  }
  return map;
}

/**
 * validateEvidenceStageResult(value, subject)
 *   -> { ok: true, result, rowIndex: Map<id,status>|null }
 *    | { ok: false, reason: string }
 *
 * `result` is exactly what stages/common.js#validateStageResult() returned (untouched).
 * `rowIndex` is a Map when the (now guaranteed-unique) ROW_INDEX record itself resolved
 * to a usable PASS projection, else null: a structurally valid, complete result-set
 * (ok: true) can still carry no usable projection for THIS run (e.g. ROW_INDEX itself is
 * INCOMPLETE because the row-index bound was exceeded) -- that is a fact about this run,
 * not a defect in the result-set's shape (design section 10/23).
 */
function validateEvidenceStageResult(value, subject) {
  const result = validateStageResult(value, subject, "1C");
  if (!result) return { ok: false, reason: "not a valid 1C stage result for this subject" };

  const byCheckId = new Map();
  for (const record of result.records) {
    if (!KNOWN_CHECK_IDS.has(record.checkId)) return { ok: false, reason: `unknown 1C check id ${record.checkId}` };
    if (!byCheckId.has(record.checkId)) byCheckId.set(record.checkId, []);
    byCheckId.get(record.checkId).push(record);
  }

  if (!byCheckId.has(CONFIG_CHECK_ID)) return { ok: false, reason: "missing required 1C.EVIDENCE.CONFIG record" };
  for (const checkId of REQUIRED_SINGLETON_CHECKS) {
    const records = byCheckId.get(checkId) || [];
    if (records.length !== 1) return { ok: false, reason: `expected exactly one ${checkId} record, found ${records.length}` };
  }

  const rowIndexRecord = byCheckId.get(ROW_INDEX_CHECK_ID)[0];
  return { ok: true, result, rowIndex: extractRowIndex(rowIndexRecord) };
}

module.exports = { validateEvidenceStageResult };
