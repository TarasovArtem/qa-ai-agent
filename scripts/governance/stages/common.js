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

/** Bounded, redacted, single-line-safe text for `detail` fields. */
function safe(text) {
  // eslint-disable-next-line no-control-regex
  return redactString(String(text).replace(/[\u0000-\u001f\u007f]/g, " "), { maxLength: 300 });
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
    const record = { checkId, ownerStage, status, subject, observed, expected, reasonCode, detail: safe(detail), evidenceRefs: [] };
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

module.exports = { safe, isValidSubject, sameSubject, createRecordFactory, sample };
