/**
 * GOV-AUTO-1 Wave 0 -- pure aggregation and readiness derivation (design
 * sections 7, 22).
 *
 * `aggregate()` derives its canonical plan from one kernel constant and bound
 * owner/consumer records. Caller options can only restate or tighten it. It never
 * inspects Git, the network, the filesystem or the clock.
 * readiness.state is reproducible solely from the records. Readiness is framework
 * attestation only: it never authorizes a merge, approves a PR, accepts risk,
 * completes a lifecycle stage or lowers a review class. Every underlying record
 * stays in the output; the summary is only a derived view.
 */

"use strict";

const { REASON, STATUS, STATUS_PRECEDENCE, READINESS, deepFreeze } = require("./contracts");
const { isPlainObject } = require("./validation");
const { validateResultRecord, canonicalJson, CHECK_ID } = require("./results");
const { DOMAIN_ID } = require("./graph");
const crypto = require("node:crypto");
const { REQUIRED_CHECK_IDS } = require("./completeness");

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

const MAX_REQUIRED_CHECK_IDS = 1024;
// A missing required ID is reported as `KERNEL.REQUIRED_RESULT.<id>`, which must itself
// stay a valid check ID (at most 128 characters), so a planned ID is at most 105.
const MAX_REQUIRED_CHECK_ID_LENGTH = 128 - "KERNEL.REQUIRED_RESULT.".length;

/**
 * Required-result completeness (Corrective C2, 1G R1): every ID in the caller's
 * completeness plan must be present as an actual valid record. A missing one is an
 * INCOMPLETE kernel record; presence is decided only from the records, never from
 * a summary. Returns kernel-generated records (empty when complete).
 */
function checkRequiredResults(validRecords, requiredCheckIds, subject) {
  const present = new Set(validRecords.map((r) => r.checkId));
  return [...requiredCheckIds].sort()
    .filter((id) => !present.has(id))
    .map((id) => kernelRecord(`KERNEL.REQUIRED_RESULT.${id}`, STATUS.INCOMPLETE, REASON.REQUIRED_RESULT_MISSING, "a result the completeness plan requires is missing", subject));
}

/**
 * Aggregate records into the derived overall status and readiness. Options:
 *   expectedDomainIds  enabled domain IDs from a validated graph (the
 *                      domain-result completeness invariant, GT-16);
 *   requiredCheckIds   the check IDs the run must contain (the mandatory-result
 *                      plan; Corrective C2, 1G R1);
 *   domainsProjection  a `domains[]` projection to check against the records.
 * Neither option establishes authority. Missing options still enforce the canonical
 * plan; an explicit narrow set fails closed with COMPLETENESS_PLAN_NARROWED.
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

  const opts = isPlainObject(options) ? options : {};
  const plan = deriveCompleteness(valid, runSubject, kernel);
  if (opts.expectedDomainIds !== undefined && (!Array.isArray(opts.expectedDomainIds) || canonicalJson([...opts.expectedDomainIds].sort()) !== canonicalJson(plan.domainIds))) {
    kernel.push(kernelRecord("KERNEL.EXPECTED_DOMAINS", STATUS.CONFIGURATION_ERROR, REASON.COMPLETENESS_PLAN_NARROWED, "caller domain set differs from the canonical bound set", runSubject));
  }
  let required = plan.requiredIds;
  if (opts.requiredCheckIds !== undefined) {
    const ids = opts.requiredCheckIds;
    if (!Array.isArray(ids) || ids.length > MAX_REQUIRED_CHECK_IDS || !ids.every((id) => typeof id === "string" && CHECK_ID.test(id) && id.length <= MAX_REQUIRED_CHECK_ID_LENGTH) || new Set(ids).size !== ids.length) {
      kernel.push(kernelRecord("KERNEL.REQUIRED_CHECKS", STATUS.CONFIGURATION_ERROR, REASON.RESULT_RECORD_INVALID, "invalid requiredCheckIds", runSubject));
    } else if (!required.every((id) => ids.includes(id))) {
      kernel.push(kernelRecord("KERNEL.REQUIRED_CHECKS", STATUS.CONFIGURATION_ERROR, REASON.COMPLETENESS_PLAN_NARROWED, "caller plan omits canonical requirements", runSubject));
    } else required = [...ids].sort();
  }
  kernel.push(...checkRequiredResults(valid, required, runSubject));
  if (plan.bound) kernel.push(...checkDomainResultCompleteness(valid, plan.domainIds, opts.domainsProjection, runSubject));
  const observed = { mode: runSubject ? runSubject.range.mode : null, requiredCheckIds: required, referenceFamilies: plan.families, domainIds: plan.domainIds };
  observed.planFingerprint = crypto.createHash("sha256").update(canonicalJson(observed)).digest("hex");
  const completenessStatus = plan.bound ? STATUS.PASS : valid.length === 0 ? STATUS.INCOMPLETE : STATUS.CONFIGURATION_ERROR;
  const completeness = { ...kernelRecord("KERNEL.COMPLETENESS", completenessStatus, plan.bound ? REASON.OK : REASON.COMPLETENESS_SOURCE_INVALID, "canonical completeness derived by the kernel", runSubject), observed };
  const suppliedCompleteness = valid.filter((r) => r.checkId === "KERNEL.COMPLETENESS");
  if (suppliedCompleteness.length === 1 && canonicalJson(suppliedCompleteness[0]) !== canonicalJson(completeness)) {
    kernel.push(kernelRecord("KERNEL.COMPLETENESS_BINDING", STATUS.CONFIGURATION_ERROR, REASON.COMPLETENESS_SOURCE_INVALID, "persisted completeness differs from recomputation", runSubject));
  }
  if (suppliedCompleteness.length === 0) kernel.push(completeness);

  // Re-consuming a report counts identical generated diagnostics once.
  for (let i = kernel.length - 1; i >= 0; i--) {
    const prior = valid.filter((r) => r.checkId === kernel[i].checkId);
    if (prior.length === 1 && canonicalJson(prior[0]) === canonicalJson(kernel[i])) kernel.splice(i, 1);
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

  // Design section 23: readiness carries `reasons[]`, derived only from the
  // records. Preserve every independently true non-neutral reason even when a
  // higher-precedence status determines `overallStatus`; a configuration error
  // must not hide missing mandatory results or unavailable provenance.
  const reasons = state === READINESS.READY ? [] : [...new Set(all
    .filter((r) => r.status !== STATUS.PASS && r.status !== STATUS.NOT_APPLICABLE)
    .map((r) => r.reasonCode))].sort();

  return deepFreeze({
    overallStatus,
    readiness: { state, dominantStatus: overallStatus, reasons, counts },
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

module.exports = { aggregate, checkDomainResultCompleteness, exitCodeFor };const DIGEST = /^[0-9a-f]{64}$/;
const digest = (v) => typeof v === "string" && DIGEST.test(v);

function deriveCompleteness(records, subject, failures) {
  const mode = subject && subject.range.mode;
  const map = REQUIRED_CHECK_IDS[mode];
  const requiredIds = map ? [...REQUIRED_CHECK_IDS.COMMON, ...map].sort() : [];
  const result = { requiredIds, families: [], domainIds: [], bound: Boolean(map) };
  const one = (id) => {
    const found = records.filter((r) => r.checkId === id);
    if (found.length !== 1) { result.bound = false; return null; }
    const r = found[0];
    const expectedOwner = id.split(".")[0];
    if (r.ownerStage !== expectedOwner || canonicalJson(r.subject) !== canonicalJson(subject)) { fail("KERNEL.OWNER." + id, REASON.COMPLETENESS_SOURCE_INVALID); return null; }
    return r;
  };
  const fail = (id, reason) => {
    result.bound = false;
    failures.push(kernelRecord(id, STATUS.CONFIGURATION_ERROR, reason, "canonical owner/consumer binding failed", subject));
  };
  const policy = one("1A.POLICY.EFFECTIVE");
  if (policy) {
    const o = policy.observed;
    if (policy.status !== STATUS.PASS || !isPlainObject(o) || !digest(o.policyFingerprint) || !Array.isArray(o.referenceFamilies) || o.referenceFamilies.length > 32 || !o.referenceFamilies.every((f) => typeof f === "string" && /^[A-Z][A-Z0-9]{0,15}$/.test(f)) || new Set(o.referenceFamilies).size !== o.referenceFamilies.length) fail("KERNEL.POLICY_SOURCE", REASON.COMPLETENESS_SOURCE_INVALID);
    else {
      result.families = [...o.referenceFamilies].sort();
      requiredIds.push(...result.families.map((f) => "1B.REFERENCES." + f));
      for (const id of ["1A.SCOPE.POLICY", "1A.SECRETS.POLICY", "1B.MARKDOWN.POLICY"]) {
        const used = one(id);
        if (used && (used.status !== STATUS.PASS || !isPlainObject(used.observed) || used.observed.policyFingerprint !== o.policyFingerprint || (id === "1B.MARKDOWN.POLICY" && (!Array.isArray(used.observed.referenceFamilies) || canonicalJson([...used.observed.referenceFamilies].sort()) !== canonicalJson(result.families))))) fail("KERNEL.POLICY_BINDING." + id, REASON.POLICY_BINDING_MISMATCH);
      }
      if (records.some((r) => r.checkId.startsWith("1B.REFERENCES.") && !result.families.includes(r.checkId.slice("1B.REFERENCES.".length)))) fail("KERNEL.REFERENCE_FAMILY", REASON.COMPLETENESS_SOURCE_INVALID);
    }
  }
  const owner = one("1A.POLICY.GATE_ANCHOR");
  const used = one("1E.DELTA.DOMAIN_SET");
  if (owner && used) {
    const a = owner.observed, b = used.observed;
    if (owner.status !== STATUS.PASS || used.status !== STATUS.PASS || !isPlainObject(a) || !isPlainObject(b)) fail("KERNEL.GRAPH_PROVENANCE", REASON.GRAPH_PROVENANCE_MISMATCH);
    else {
      if (a.baseGateSha256 !== null && b.baseGraphFingerprint === null) fail("KERNEL.BASE_GRAPH", REASON.BASE_GRAPH_UNBOUND);
      for (const side of ["base", "head"]) {
        const source = side + "GateSha256", semantic = side + "GraphFingerprint";
        const absent = a[source] === null && a[semantic] === null;
        if ((!absent && (!digest(a[source]) || !digest(a[semantic]))) || b[source] !== a[source] || b[semantic] !== a[semantic]) fail("KERNEL.GRAPH_PROVENANCE." + side, REASON.GRAPH_PROVENANCE_MISMATCH);
      }
      if (!Array.isArray(b.domainIds) || b.domainIds.length > 256 || !b.domainIds.every((id) => typeof id === "string" && DOMAIN_ID.test(id)) || new Set(b.domainIds).size !== b.domainIds.length) fail("KERNEL.DOMAIN_SOURCE", REASON.COMPLETENESS_SOURCE_INVALID);
      else if (result.bound) result.domainIds = [...b.domainIds].sort();
    }
  }
  // There is no reviewed adapter. A supplied PASS invocation record cannot
  // make a raw aggregation authoritative, even when its copied values are true.
  const invocation = one("1A.IDENTITY.INVOCATION");
  if (invocation && invocation.status === STATUS.PASS) failures.push(kernelRecord("KERNEL.INVOCATION_PROVENANCE", STATUS.INCOMPLETE, REASON.PLATFORM_PROVENANCE_UNAVAILABLE, "no reviewed non-caller-mintable platform adapter exists", subject));
  result.requiredIds.sort();
  return result;
}
