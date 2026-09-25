/**
 * GOV-AUTO-1 Wave 0 -- pure aggregation and readiness derivation (design
 * sections 7, 22).
 *
 * `aggregate()` depends only on the records it is given: it never inspects Git,
 * the network, the filesystem or the clock, and it never interprets meaning.
 * readiness.state is reproducible solely from the records. Readiness is framework
 * attestation only: it never authorizes a merge, approves a PR, accepts risk,
 * completes a lifecycle stage or lowers a review class. Every underlying record
 * stays in the output; the summary is only a derived view.
 */

"use strict";

const { REASON, STATUS, STATUS_PRECEDENCE, READINESS, deepFreeze } = require("./contracts");
const { isPlainObject } = require("./validation");
const { validateResultRecord, canonicalJson } = require("./results");
const { DOMAIN_ID } = require("./graph");

function kernelRecord(checkId, status, reasonCode, detail, subject) {
  return { checkId, ownerStage: "KERNEL", status, subject: subject || null, observed: null, expected: null, reasonCode, detail, evidenceRefs: [] };
}

function domainResults(records) {
  return records.filter((r) => Object.hasOwn(r, "domain"));
}

/**
 * Domain-result completeness (design section 7 synchronization invariant):
 * every enabled domain has exactly one domain result record; a duplicate, a
 * missing result, a result for an unknown domain and a differing `domains[]`
 * projection are all reported, never deduplicated or inferred as unchanged.
 * Returns kernel-generated records (empty when complete).
 */
function checkDomainResultCompleteness(validRecords, expectedDomainIds, projection, subject) {
  const out = [];
  const results = domainResults(validRecords);
  const counts = new Map();
  for (const r of results) counts.set(r.domain.domainId, (counts.get(r.domain.domainId) || 0) + 1);
  for (const id of [...expectedDomainIds].sort()) {
    const n = counts.get(id) || 0;
    if (n === 0) out.push(kernelRecord(`KERNEL.DOMAIN_RESULT.${id}`, STATUS.INCOMPLETE, REASON.DOMAIN_RESULT_MISSING, "enabled domain has no result record", subject));
    else if (n > 1) out.push(kernelRecord(`KERNEL.DOMAIN_RESULT.${id}`, STATUS.CONFIGURATION_ERROR, REASON.DOMAIN_RESULT_DUPLICATE, "enabled domain has several result records", subject));
  }
  const expected = new Set(expectedDomainIds);
  for (const id of [...counts.keys()].sort()) {
    if (!expected.has(id)) out.push(kernelRecord(`KERNEL.DOMAIN_RESULT.${id}`, STATUS.CONFIGURATION_ERROR, REASON.DOMAIN_RESULT_UNKNOWN, "result for a domain that is not an enabled domain", subject));
  }
  if (projection !== undefined) {
    const derived = results
      .map((r) => ({ domainId: r.domain.domainId, effectiveLevel: r.domain.effectiveLevel, reasons: r.domain.reasons, fingerprint: r.domain.fingerprint }))
      .sort((a, b) => (a.domainId < b.domainId ? -1 : a.domainId > b.domainId ? 1 : 0));
    let same = false;
    if (Array.isArray(projection) && projection.every((p) => isPlainObject(p) && typeof p.domainId === "string")) {
      const given = projection
        .map((p) => ({ domainId: p.domainId, effectiveLevel: p.effectiveLevel, reasons: p.reasons, fingerprint: p.fingerprint }))
        .sort((a, b) => (a.domainId < b.domainId ? -1 : a.domainId > b.domainId ? 1 : 0));
      same = canonicalJson(given) === canonicalJson(derived);
    }
    if (!same) out.push(kernelRecord("KERNEL.DOMAIN_PROJECTION", STATUS.CONFIGURATION_ERROR, REASON.DOMAIN_PROJECTION_MISMATCH, "domains[] projection differs from the canonical records", subject));
  }
  return out;
}

function hasApplicabilityProof(record) {
  return isPlainObject(record.observed) && typeof record.observed.applicabilityProof === "string" && record.observed.applicabilityProof.length > 0;
}

/**
 * Aggregate records into the derived overall status and readiness. Options:
 *   expectedDomainIds  enabled domain IDs from a validated graph (enables the
 *                      domain-result completeness invariant);
 *   domainsProjection  a `domains[]` projection to check against the records.
 * Never throws for bad records: they become CONFIGURATION_ERROR kernel records.
 */
function aggregate(records, options = {}) {
  const kernel = [];
  const valid = [];
  const input = Array.isArray(records) ? records : [];
  if (!Array.isArray(records)) kernel.push(kernelRecord("KERNEL.RECORDS", STATUS.CONFIGURATION_ERROR, REASON.RESULT_RECORD_INVALID, "records must be an array"));

  input.forEach((candidate, index) => {
    const checked = validateResultRecord(candidate);
    if (checked.ok) valid.push(checked.record);
    else kernel.push(kernelRecord(`KERNEL.RECORD.${index}`, STATUS.CONFIGURATION_ERROR, REASON.RESULT_RECORD_INVALID, "record failed runtime validation"));
  });

  // Duplicate check IDs are never silently resolved.
  const seen = new Map();
  for (const r of valid) seen.set(r.checkId, (seen.get(r.checkId) || 0) + 1);
  for (const [id, n] of [...seen.entries()].sort()) {
    if (n > 1) kernel.push(kernelRecord(`KERNEL.CHECK_ID.${id}`, STATUS.CONFIGURATION_ERROR, REASON.DUPLICATE_CHECK_ID, "checkId is not unique within the run"));
  }

  // All records must be about the same exact identity (design section 25).
  const subjects = new Set(valid.map((r) => canonicalJson(r.subject)));
  const runSubject = valid.length > 0 ? valid[0].subject : null;
  if (subjects.size > 1) kernel.push(kernelRecord("KERNEL.SUBJECT", STATUS.FAIL, REASON.SUBJECT_MISMATCH, "records carry different subjects", runSubject));

  // NOT_APPLICABLE is valid only with a recorded applicability proof.
  for (const r of valid) {
    if (r.status === STATUS.NOT_APPLICABLE && !hasApplicabilityProof(r)) {
      kernel.push(kernelRecord(`KERNEL.APPLICABILITY.${r.checkId}`, STATUS.INCOMPLETE, REASON.APPLICABILITY_NOT_PROVEN, "not-applicable record has no applicability proof", runSubject));
    }
  }

  if (options.expectedDomainIds !== undefined) {
    const ids = options.expectedDomainIds;
    if (Array.isArray(ids) && ids.every((id) => typeof id === "string" && DOMAIN_ID.test(id)) && new Set(ids).size === ids.length) {
      kernel.push(...checkDomainResultCompleteness(valid, ids, options.domainsProjection, runSubject));
    } else {
      kernel.push(kernelRecord("KERNEL.EXPECTED_DOMAINS", STATUS.CONFIGURATION_ERROR, REASON.RESULT_RECORD_INVALID, "expectedDomainIds must be unique valid domain IDs", runSubject));
    }
  }

  const all = [...valid, ...kernel];
  const counts = {};
  for (const s of Object.values(STATUS)) counts[s] = 0;
  for (const r of all) counts[r.status] += 1;
  // Design section 7: READY when every record is PASS or a proven NOT_APPLICABLE.
  // An unproven NOT_APPLICABLE already produced an INCOMPLETE kernel record above,
  // so a run made only of neutral records reaching this point is fully proven. An
  // empty run has no record at all and stays INCOMPLETE (nothing was established).
  const overallStatus = STATUS_PRECEDENCE.find((s) => counts[s] > 0) || (counts[STATUS.NOT_APPLICABLE] > 0 ? STATUS.PASS : STATUS.INCOMPLETE);
  const state =
    overallStatus === STATUS.PASS ? READINESS.READY
      : overallStatus === STATUS.HUMAN_REVIEW_REQUIRED ? READINESS.HUMAN_REVIEW_REQUIRED
        : READINESS.NOT_READY;

  return deepFreeze({
    overallStatus,
    readiness: { state, dominantStatus: overallStatus, counts },
    counts,
    humanReviewRequired: all.filter((r) => r.status === STATUS.HUMAN_REVIEW_REQUIRED).map((r) => r.checkId),
    records: valid,
    kernelRecords: kernel,
    notAuthorization: true,
  });
}

/** Optional CLI exit-code mapping (design section 22); the report stays authoritative. */
function exitCodeFor(overallStatus) {
  switch (overallStatus) {
    case STATUS.PASS: return 0;
    case STATUS.FAIL: return 1;
    case STATUS.CONFIGURATION_ERROR: return 2;
    case STATUS.HUMAN_REVIEW_REQUIRED: return 3;
    case STATUS.INCOMPLETE: return 4;
    default: return 5;
  }
}

module.exports = { aggregate, checkDomainResultCompleteness, exitCodeFor };
