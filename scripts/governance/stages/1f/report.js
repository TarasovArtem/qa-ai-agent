/**
 * GOV-AUTO-1 Wave 4 / 1F -- buildReport() (design sections 18, 22, 23): report
 * assembly under Stage 1F ownership. The Wave 0 kernel remains the sole
 * readiness authority -- this module never recomputes overallStatus,
 * readiness or counts; it calls `kernel.aggregate()` exactly once and
 * places its output, unmodified, into the report envelope.
 *
 * Schema note (honest boundary, not a silent weakening): design section 23's
 * `trustedContext` field carries roughly twenty sub-fields, several of which
 * (`provider`, `repositoryId`, `eventType`, `workflowIdentity`,
 * `workflowBlobSha`, `collectorRunId`, `executedCommit`, `phase`, ...) are
 * not currently produced by Stage 1A's public `getGitIdentity()` output (see
 * the Wave 4 architecture-decision-gate finding on this exact gap). Rather
 * than silently omitting or fabricating them, `buildReport()` requires the
 * caller to supply an already-assembled, schema-conformant `trustedContext`
 * object -- exactly the object the design's own Phase-2 collector is
 * responsible for constructing (re-using 1A's identity/records plus its own
 * authenticated Phase-2 invocation context) -- and validates its shape in
 * full before using it. `manifest` and `changedFiles` are handled the same
 * way: caller-supplied, canonical-shape-validated, never re-derived here.
 *
 * CORRECTIVE C3 (W4-C2R-SEC-L1): every field this function reads from `input`
 * is untrusted, caller-supplied data, and JavaScript does not guarantee a
 * plain-looking property reads the same value twice (a getter, a later
 * mutation by the caller, or a `toJSON()` can all change what a second read
 * sees). Reading the same value twice -- once to validate it, again to
 * project it into the report -- is therefore a TOCTOU seam: a supplied 1F.CI
 * record could validate as CLEAN_FIRST_PASS and publish as
 * PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN. `buildReport()` now takes exactly one
 * bounded `cloneJson()` snapshot of every relevant input field before any
 * validation, and every check and the report itself read ONLY that snapshot
 * from that point on -- never `input` again. `cloneJson()` (`JSON.parse(JSON.stringify(...))`)
 * reads each property exactly once, so a getter fires at most once; it throws
 * on a cyclic reference or a BigInt (mapped here to the canonical
 * CONFIGURATION_ERROR-shaped rejection, never a partial report), and a
 * `toJSON()` result is validated downstream like any other supplied shape --
 * never trusted merely because it came from `toJSON()`.
 *
 * CORRECTIVE C3 (W4-C2R-DEV-M1): a report with neither an explicit Phase 1
 * `ci:{state:"NOT_COLLECTED"}` marker NOR a collected `1F.CI` record used to
 * fall through silently: `records[]` was aggregated as-is, with no CI
 * check contributed at all, so an otherwise-all-PASS report could reach
 * `READY` with zero CI evidence. Neither case is valid Stage 1F input, and
 * both are now rejected before aggregation.
 *
 * CORRECTIVE C3 (W4-C2R-DEV-L1): `finalized` used to be derived only from
 * whether `ci` was omitted and a collected record was present, with no cross-
 * check against `trustedContext.phase` -- a caller could claim `phase: 1`
 * while structuring the call as Phase 2 (or vice versa) and get a
 * `finalized`/`readiness` combination that contradicted its own declared
 * phase. The two are now required to agree.
 *
 * CORRECTIVE C4 (W4-C2R-DEV-M2 / W4-C3R-DEV-L1 / W4-C3R-DEV-L2 / W4-C3R-SEC-L1):
 * `validateCollectedCiRecord()` below was tightened along four axes -- see its
 * own doc comment and the `IDENTITY_FIELDS`/shape-matching note above it for
 * the exact rules: (1) a sparse PASS-mapped record with none of the
 * completed-run evidence fields is now rejected outright, not merely records
 * with a PARTIAL field subset; (2) every completed-run field is type/bound-
 * validated before it ever reaches `computeCiRunDigest()`, so a malformed
 * type fails closed with the canonical rejection rather than throwing; (3) an
 * authentic pre-completion (queued/waiting/in_progress) collector record is
 * now recognized as its own permissible shape, distinct from a partial
 * completed-run record; (4) a completed-run record's repository and event are
 * cross-bound to `trustedContext.repositoryId`/`eventType`.
 *
 * W4-C3R-INFO-2 (documented, not re-architected): the `cloneJson()` snapshot
 * at this function's boundary normalizes a few JSON-only-representable
 * distinctions -- `undefined` values and functions are dropped rather than
 * preserved, and `NaN`/`Infinity` become `null`. None of the fields this
 * module treats as authority-bearing (SHA-40 hex strings, canonical enum
 * values, digests, bounded strings, integers checked with `Number.isInteger`)
 * can silently acquire a different TRUSTED meaning through this normalization
 * -- a `null` or dropped key still fails the same explicit presence/type
 * checks a live `undefined` or a non-numeric value would have failed. This
 * has been checked field-by-field for the current schema; it is not a
 * standing guarantee for a future field added without the same check.
 */

"use strict";

const { REASON, STATUS, RANGE_MODES, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject, validateCapabilityId, validateFrameworkMetadata } = require("../../kernel/validation");
const { FRAMEWORK_METADATA } = require("../../framework-metadata");
const { aggregate } = require("../../kernel/readiness");
const { validateResultRecord, cloneJson, canonicalJson } = require("../../kernel/results");
const { DOMAIN_ID } = require("../../kernel/graph");
const { isValidSubject, sameSubject } = require("../common");
const { isValidBranchName } = require("../1a/trusted-context");
const { CLASSIFICATION_CONTRACT } = require("./ci-classify");
const { UNMET_TRUST_PREREQUISITES } = require("./determination");
const { ciRunSourceObjectId, isCiRunSourceObjectId, computeCiRunDigest } = require("./ci-evidence");
const { isDenseArray } = require("./required-jobs");

const SHA40 = /^[0-9a-f]{40}$/;
const REPOSITORY_ID = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const TRUST = ["PLATFORM_AUTHENTICATED", "OPERATOR_SUPPLIED"];
const EXECUTED_FROM = ["TARGET_TIP", "HEAD"];
const MAX_EXTERNAL_EVIDENCE = 256;
const MAX_CAPABILITY_IDS = 256;
const IMMUTABILITY_VALUES = new Set(["MUTABLE", "VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]);
const SUPPORTED_REPORT_SCHEMA_VERSIONS = [1];
const REVIEW_CLASSES = ["LIGHT", "HEAVY"];
const MAX_PARENTS = 8;

// Corrective C1 (1G M1): the results every report must contain before it can be
// READY. This is framework contract state, not caller input: each ID is a record
// the named stage always emits once it has run for the subject (a run that stops
// early already emits a non-PASS record, so a missing ID here only adds an
// INCOMPLETE). Per-domain 1E results are required through 1E.DELTA.DOMAIN_SET,
// the 1E-owned statement of which domains the run reports on. Records whose IDs
// depend on the effective policy (1B.REFERENCES.<family>) are required through
// 1A.POLICY.EFFECTIVE, the 1A-owned statement of the effective policy and its
// reference families, bound to 1B.MARKDOWN.POLICY (Corrective C2, 1G R2; see
// referenceFamilyPlan()).
const { REQUIRED_CHECK_IDS } = require("../../kernel/completeness");
// Check IDs buildReport() contributes (1F.CONTEXT.*) or contributed before the kernel
// became the completeness authority (1F.COMPLETENESS.*, Corrective C2); a caller-supplied
// record may not claim them.
const RESERVED_CHECK_ID = /^1F\.(CONTEXT\.|COMPLETENESS\.)/;

function reportRecord(subject, checkId, status, reasonCode, detail, observed) {
  const record = { checkId, ownerStage: "1F", status, subject, observed, expected: null, reasonCode, detail, evidenceRefs: [] };
  const checked = validateResultRecord(record);
  if (!checked.ok) throw new Error(`internal error: invalid ${checkId} record: ${checked.problems.join("; ")}`);
  return checked.record;
}

/**
 * Corrective C1 (1G M2): the execution context is folded into the SAME aggregation
 * as one record, so only a platform-authenticated run executed from the resolved
 * target tip can be READY (design section 14 rule 8 and "No self-validation";
 * manual mode). Head-executed output is advisory (INCOMPLETE, so NOT_READY); an
 * operator-supplied invocation is at best HUMAN_REVIEW_REQUIRED. Phase 1 is
 * already INCOMPLETE through its CI_NOT_COLLECTED record. The executed commit was
 * cross-checked against executedFrom before this point, so TARGET_TIP here means
 * executedCommit === resolvedTargetTip.
 */
function executionContextRecord(subject, tc) {
  const observed = { executedFrom: tc.executedFrom, invocationTrust: tc.invocationTrust, phase: tc.phase, executedCommit: tc.executedCommit, resolvedTargetTip: tc.resolvedTargetTip };
  if (tc.executedFrom !== "TARGET_TIP") {
    return reportRecord(subject, "1F.CONTEXT.EXECUTION", STATUS.INCOMPLETE, REASON.EXECUTION_NOT_FROM_TARGET_TIP, "the report was produced by head-executed framework code: advisory only, never READY", observed);
  }
  if (tc.invocationTrust !== "PLATFORM_AUTHENTICATED") {
    return reportRecord(subject, "1F.CONTEXT.EXECUTION", STATUS.HUMAN_REVIEW_REQUIRED, REASON.OPERATOR_INVOCATION, "operator-supplied invocation: at best human review, never READY", observed);
  }
  return reportRecord(subject, "1F.CONTEXT.EXECUTION", STATUS.PASS, REASON.OK, "platform-authenticated invocation executed from the resolved target tip", observed);
}

/**
 * Cross-field validation of the trusted context against the report subject
 * (Corrective C1, 1G L3/M2). Returns null when consistent, else the reason.
 */
function trustedContextContradiction(tc, subject) {
  if (tc.headSha !== subject.head) return "trustedContext.headSha does not match the subject";
  if (tc.mode !== subject.range.mode) return "trustedContext.mode does not match the subject range mode";
  if (tc.base !== subject.base || subject.range.from !== subject.base || subject.range.to !== subject.head) return "trustedContext.base does not match the subject base and range";
  if (tc.executedFrom === "TARGET_TIP" && tc.executedCommit !== tc.resolvedTargetTip) return "executedFrom is TARGET_TIP but executedCommit is not the resolved target tip";
  if (tc.executedFrom === "HEAD" && tc.executedCommit !== subject.head) return "executedFrom is HEAD but executedCommit is not the reviewed head";
  return null;
}

/**
 * The enabled-domain set the report must contain results for (Corrective C1, 1G
 * M1), taken from the 1E-owned 1E.DELTA.DOMAIN_SET record. A caller-supplied
 * expectedDomainIds may restate that set but can never narrow or replace it.
 * Returns { ok, ids } (ids null when 1E's record is absent; its absence is itself
 * a missing required result) or { ok:false, reason }.
 */
function requiredDomainIds(records, subject, callerIds) {
  const sets = records.filter((r) => isPlainObject(r) && r.checkId === "1E.DELTA.DOMAIN_SET");
  let ids = null;
  if (sets.length === 1) {
    const r = sets[0];
    const list = isPlainObject(r.observed) ? r.observed.domainIds : undefined;
    if (r.ownerStage !== "1E" || r.status !== STATUS.PASS || !sameSubject(r.subject, subject) || !Array.isArray(list) || list.length > 256 ||
        !list.every((id) => typeof id === "string" && DOMAIN_ID.test(id)) || new Set(list).size !== list.length) {
      return { ok: false, reason: "the 1E.DELTA.DOMAIN_SET record is malformed" };
    }
    ids = [...list].sort();
  }
  if (callerIds !== undefined) {
    if (!Array.isArray(callerIds)) return { ok: false, reason: "expectedDomainIds must be an array" };
    if (ids !== null && JSON.stringify([...callerIds].sort()) !== JSON.stringify(ids)) return { ok: false, reason: "expectedDomainIds differs from the 1E-reported domain set (it can never narrow it)" };
    if (ids === null) ids = callerIds;
  }
  return { ok: true, ids };
}

const FINGERPRINT = /^[0-9a-f]{64}$/;
const FAMILY_NAME = /^[A-Z][A-Z0-9]{0,15}$/;
const MAX_FAMILIES = 32;
const sortedJson = (list) => JSON.stringify([...list].sort());

/** The single record with this checkId, or null when there is none or several (a duplicate is the kernel's DUPLICATE_CHECK_ID). */
function onlyRecord(records, checkId) {
  const found = records.filter((r) => isPlainObject(r) && r.checkId === checkId);
  return found.length === 1 ? found[0] : null;
}

function isCapabilityProvenance(r, subject) {
  const o = r.observed;
  if (r.ownerStage !== "1A" || !sameSubject(r.subject, subject) || !isPlainObject(o)) return false;
  if (o.frameworkMetadataSource !== "TARGET_TIP" && o.frameworkMetadataSource !== "EXECUTING_FRAMEWORK") return false;
  if (typeof o.targetTip !== "string" || !SHA40.test(o.targetTip)) return false;
  if (o.executedCommit !== null && (typeof o.executedCommit !== "string" || !SHA40.test(o.executedCommit))) return false;
  if (o.executedCommit !== null || o.frameworkMetadataSource !== "EXECUTING_FRAMEWORK" || o.targetMetadata !== null) return false;
  if (!Array.isArray(o.required) || !o.required.every((c) => validateCapabilityId(c).ok)) return false;
  if (o.frameworkMetadataSource !== "TARGET_TIP") return o.targetMetadata === null;
  return o.executedCommit === o.targetTip && validateFrameworkMetadata(o.targetMetadata).ok;
}

/**
 * Cross-binding of trustedContext to the target provenance 1A established
 * (Corrective C2, 1G R3). 1A.POLICY.CAPABILITIES carries the target tip 1A resolved
 * itself, the platform-authenticated execution commit, and -- only when the run
 * executed from that tip -- the target framework metadata. trustedContext may
 * restate these facts but never establish them: a resolvedTargetTip/executedCommit
 * pair that merely agree with each other, a TARGET_TIP execution claim 1A did not
 * establish, or target capabilities / schema range / required capabilities that
 * differ from 1A's are rejected. Returns null when consistent, else the reason.
 * (An absent record is a missing required result and already INCOMPLETE.)
 */
function targetProvenanceContradiction(records, subject, tc) {
  const tipRecord = onlyRecord(records, "1A.IDENTITY.TARGET_TIP");
  if (tipRecord !== null && isPlainObject(tipRecord.observed) && Object.hasOwn(tipRecord.observed, "resolvedTargetTip") && tipRecord.observed.resolvedTargetTip !== tc.resolvedTargetTip) {
    return "trustedContext.resolvedTargetTip differs from the target tip 1A resolved";
  }
  const caps = onlyRecord(records, "1A.POLICY.CAPABILITIES");
  if (caps === null) return null;
  if (!isCapabilityProvenance(caps, subject)) return "the 1A.POLICY.CAPABILITIES record does not carry valid target provenance";
  const o = caps.observed;
  if (tc.resolvedTargetTip !== o.targetTip) return "trustedContext.resolvedTargetTip differs from the target tip 1A resolved";
  if (o.executedCommit !== null && tc.executedCommit !== o.executedCommit) return "trustedContext.executedCommit differs from the execution commit 1A established";
  if (sortedJson(tc.requiredCapabilities) !== sortedJson(o.required)) return "trustedContext.requiredCapabilities differs from the effective policy's required capabilities";
  if (tc.executedFrom === "TARGET_TIP") {
    if (o.frameworkMetadataSource !== "TARGET_TIP") return "executedFrom is TARGET_TIP but 1A did not establish that the run executed from the resolved target tip";
    const m = o.targetMetadata;
    if (tc.frameworkVersion !== m.frameworkVersion || sortedJson(tc.targetSupportedCapabilities) !== sortedJson(m.supportedCapabilities) ||
        tc.targetSupportedSchemaVersions.minSupported !== m.supportedSchemaVersions.minSupported || tc.targetSupportedSchemaVersions.maxSupported !== m.supportedSchemaVersions.maxSupported) {
      return "trustedContext target framework metadata differs from the target-tip metadata 1A established";
    }
  } else if (tc.frameworkVersion !== FRAMEWORK_METADATA.frameworkVersion || tc.targetSupportedCapabilities.length !== 0 || canonicalJson(tc.targetSupportedSchemaVersions) !== canonicalJson(FRAMEWORK_METADATA.supportedSchemaVersions)) {
    return "trustedContext target framework metadata differs from the unavailable target support";
  } else if (o.frameworkMetadataSource === "TARGET_TIP") {
    return "executedFrom is HEAD but 1A established that the run executed from the resolved target tip";
  }
  return null;
}

function invalidInput(detail) {
  return deepFreeze({ ok: false, report: null, reason: detail });
}

/** The canonical INCOMPLETE record a Phase 1 report's ci:{state:"NOT_COLLECTED"} must contribute to aggregation (design section 17). */
function ciNotCollectedRecord(subject) {
  const record = {
    checkId: "1F.CI", ownerStage: "1F", status: STATUS.INCOMPLETE, subject, observed: { collected: false },
    expected: null, reasonCode: REASON.CI_NOT_COLLECTED, detail: "CI evidence has not been collected (Phase 1)", evidenceRefs: [],
  };
  const checked = validateResultRecord(record);
  if (!checked.ok) throw new Error(`internal error: invalid 1F.CI NOT_COLLECTED record: ${checked.problems.join("; ")}`);
  return checked.record;
}

const DETERMINATION_FIELDS = ["authenticatedActor", "channelObjectId", "contentDigest", "determinationMode", "version"];
const ATTESTATION_FIELDS = ["attestationMode", "candidateClassification", "rerunObserved"];

function isValidAuthenticatedActor(actor) {
  return isPlainObject(actor) && Object.keys(actor).sort().join(",") === "accountId,accountType,provider" &&
    isBoundedString(actor.provider, 32) && isBoundedString(actor.accountId, 100) && isBoundedString(actor.accountType, 32);
}

// ---------------------------------------------------------------- Corrective C4: permissible 1F.CI observed shapes
//
// collectCiEvidence() (stages/1f/ci-evidence.js) produces exactly three
// families of `observed` shape, discriminated by KEY SET alone (never by
// value inspection, which would risk treating a malformed value as absent):
//   A. pre-completion, fetch failed / wrong identity: {classification, collected:false, reason}
//   B. pre-completion, not yet completed (queued/waiting/in_progress):
//      {classification, collected:true, status}
//   C. completed-run (any of the 5 classifications): {classification, status,
//      repository, workflowPath, runId, event, attempt, requiredJobs, missing,
//      failed, pending, skipped, attemptHistory}, optionally extended with the
//      full DETERMINATION_FIELDS or ATTESTATION_FIELDS set.
// A record matching none of these three key sets is rejected outright --
// never partially trusted, never inferred. This closes W4-C2R-DEV-M2 (a
// sparse {classification:"CLEAN_FIRST_PASS"} record with none of shape C's
// fields matched none of the OLD "all-or-nothing" checks below because those
// only fired when at least one run-evidence field was present) without
// reopening W4-C3R-DEV-L2 (an authentic shape-B in-progress record, which
// legitimately shares the `status` key with shape C but none of shape C's
// identity fields, was previously misclassified as "partial run evidence").

const IDENTITY_FIELDS = ["repository", "workflowPath", "runId", "event", "attempt", "requiredJobs", "missing", "failed", "pending", "skipped", "attemptHistory"];
const NOT_COMPLETED_STATUSES = new Set(["in_progress", "queued", "waiting"]);
const SHAPE_A_KEY_SET = new Set(["classification", "collected", "reason"]);
const SHAPE_B_KEY_SET = new Set(["classification", "collected", "status"]);
const COMPLETED_RUN_BASE_KEY_SET = new Set(["classification", "status", ...IDENTITY_FIELDS]);
const MAX_JOB_NAME = 200;
const MAX_JOBS_LIST = 256;
const MAX_ATTEMPTS_LIST = 64;
const MAX_ATTEMPT_NUMBER = 1000;
const RUN_EVENTS = new Set(["pull_request", "push"]);

function keySetsEqual(a, b) {
  return a.size === b.size && [...a].every((k) => b.has(k));
}

// Corrective C7 (W4-C6R-DEV-L2): Array.prototype.every() SKIPS holes in a
// sparse array, so a run-evidence field like `requiredJobs` or `attemptHistory`
// carrying a hole (`const a = []; a.length = 2; a[1] = "x";`) previously passed
// every check below vacuously -- the hole was never visited. isDenseArray()
// (imported from required-jobs.js, the single canonical detector, per
// W4-C4R-INFO-2's own factoring rationale) is now checked before any
// .every()-based validation runs here, exactly mirroring the same fix already
// applied to required-jobs.js#validateRequiredJobsPolicy().
function isJobNameArray(v, max) {
  return isDenseArray(v) && v.length <= max && v.every((j) => typeof j === "string" && j.length > 0 && j.length <= MAX_JOB_NAME);
}

function isValidAttemptHistoryEntry(e) {
  if (!isPlainObject(e)) return false;
  if (Object.keys(e).sort().join(",") !== "attempt,conclusion,failedJobs") return false;
  if (!Number.isInteger(e.attempt) || e.attempt < 1 || e.attempt > MAX_ATTEMPT_NUMBER) return false;
  if (typeof e.conclusion !== "string" || e.conclusion.length === 0 || e.conclusion.length > 32) return false;
  return isJobNameArray(e.failedJobs, MAX_JOBS_LIST);
}

/**
 * isValidCiRunIdentity(o) -- Corrective C4 (W4-C3R-DEV-L1). Full type/bound/
 * shape validation of every field a completed-run-shaped record carries,
 * called ONLY after key-set matching already confirmed the record is
 * shape C -- computeCiRunDigest() below must never receive a value that has
 * not passed this check first (a malformed type reaching it, e.g.
 * `requiredJobs: 5` or `attemptHistory: [null]`, would previously throw an
 * uncaught TypeError deep inside the digest computation instead of the
 * canonical `{ok:false, reason}` rejection every other input-validation
 * failure in this framework produces).
 */
function isValidCiRunIdentity(o) {
  if (typeof o.repository !== "string" || !REPOSITORY_ID.test(o.repository)) return false;
  if (typeof o.workflowPath !== "string" || o.workflowPath.length === 0 || o.workflowPath.length > 300) return false;
  if (typeof o.runId !== "string" || o.runId.length === 0 || o.runId.length > 64) return false;
  if (!RUN_EVENTS.has(o.event)) return false;
  if (!Number.isInteger(o.attempt) || o.attempt < 1 || o.attempt > MAX_ATTEMPT_NUMBER) return false;
  if (o.status !== "completed") return false;
  if (!isJobNameArray(o.requiredJobs, MAX_JOBS_LIST) || o.requiredJobs.length === 0) return false;
  if (new Set(o.requiredJobs).size !== o.requiredJobs.length) return false;
  if (!isJobNameArray(o.missing, MAX_JOBS_LIST)) return false;
  if (!isJobNameArray(o.failed, MAX_JOBS_LIST)) return false;
  if (!isJobNameArray(o.pending, MAX_JOBS_LIST)) return false;
  if (!isJobNameArray(o.skipped, MAX_JOBS_LIST)) return false;
  // Corrective C7 (W4-C6R-DEV-L2): same sparse-array guard as isJobNameArray()
  // above -- attemptHistory is itself an array-of-objects field subject to the
  // identical hole-skipping bypass, independently of the failedJobs field
  // nested inside each entry.
  return isDenseArray(o.attemptHistory) && o.attemptHistory.length <= MAX_ATTEMPTS_LIST && o.attemptHistory.every(isValidAttemptHistoryEntry);
}

/**
 * validateCollectedCiRecord(record, subject, externalEvidence) -- Corrective C2
 * (W4-C1-DEV-M1). Runtime validation (design section 20) of the one supplied
 * `1F.CI` record a finalized report's `ci` (design section 23) is projected
 * from, BEFORE that projection. Returns `null` when valid, else the reason.
 *
 * It validates the record against the canonical classification contract
 * (stages/1f/ci-classify.js#CLASSIFICATION_CONTRACT -- no second copy), so a
 * record whose classification is missing or non-canonical, whose status or
 * reasonCode contradicts its classification, or whose determination /
 * OWNER_ATTESTED metadata is partial, malformed, or attached to a
 * classification that did not accept it, is rejected rather than projected.
 * An accepted-determination claim must match exactly one `externalEvidence[]`
 * entry (channel object ID, digest and version), or it would escape design
 * section 25a's revalidation.
 *
 * It never computes readiness (kernel.aggregate() remains the sole authority)
 * and cannot authenticate a supplied record. It does know what the collector
 * can produce: while stages/1f/determination.js#UNMET_TRUST_PREREQUISITES is
 * non-empty, collectCiEvidence() cannot accept any determination, so a
 * PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN record did not come from it and is
 * rejected even when internally consistent (Corrective C2 / W4-SEC-H1).
 */
function validateCollectedCiRecord(record, subject, externalEvidence, trustedContext) {
  const checked = validateResultRecord(record);
  if (!checked.ok) return "the 1F.CI record is not a valid result record";
  if (record.ownerStage !== "1F") return "the 1F.CI record must be owned by stage 1F";
  if (!sameSubject(record.subject, subject)) return "the 1F.CI record's subject differs from the report subject";
  const o = record.observed;
  if (!isPlainObject(o)) return "the 1F.CI record has no observed evidence";
  if (typeof o.classification !== "string" || !Object.hasOwn(CLASSIFICATION_CONTRACT, o.classification)) return "the 1F.CI classification is missing or not one of the canonical classifications";
  const contract = CLASSIFICATION_CONTRACT[o.classification];
  if (record.status !== contract.status) return `the 1F.CI status ${record.status} contradicts classification ${o.classification}`;
  if (!contract.reasonCodes.includes(record.reasonCode)) return `the 1F.CI reasonCode ${record.reasonCode} contradicts classification ${o.classification}`;

  const determinationKeys = DETERMINATION_FIELDS.filter((k) => Object.hasOwn(o, k));
  const attestationKeys = ATTESTATION_FIELDS.filter((k) => Object.hasOwn(o, k));
  if (determinationKeys.length > 0 && determinationKeys.length !== DETERMINATION_FIELDS.length) return "the 1F.CI accepted-determination metadata is incomplete";
  if (attestationKeys.length > 0 && attestationKeys.length !== ATTESTATION_FIELDS.length) return "the 1F.CI OWNER_ATTESTED metadata is incomplete";
  const hasDetermination = determinationKeys.length > 0;
  const hasAttestation = attestationKeys.length > 0;

  if (o.classification === "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN" && !hasDetermination) return "a justified rerun requires accepted-determination evidence";
  if (hasDetermination) {
    if (o.classification !== "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN") return "accepted-determination metadata on a record whose classification did not accept a determination";
    if (o.determinationMode !== "SEPARATE_PERSON") return "only a SEPARATE_PERSON determination can justify a rerun";
    if (!isValidAuthenticatedActor(o.authenticatedActor)) return "the accepted determination's authenticatedActor is malformed";
    if (typeof o.contentDigest !== "string" || !/^[0-9a-f]{64}$/.test(o.contentDigest) || !isBoundedString(o.channelObjectId, 300) || !isBoundedString(o.version, 300)) {
      return "the accepted determination's digest, channel object ID or version is malformed";
    }
    const matching = externalEvidence.filter((e) => e.sourceObjectId === o.channelObjectId);
    if (matching.length !== 1) return "an accepted determination must match exactly one externalEvidence entry for its channel object";
    if (matching[0].contentDigest !== o.contentDigest || matching[0].sourceVersion !== o.version) return "the accepted determination's digest or version differs from its externalEvidence entry";
    if (UNMET_TRUST_PREREQUISITES.length > 0) return `PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN cannot be produced by collectCiEvidence() in this configuration (unmet: ${UNMET_TRUST_PREREQUISITES.join(", ")})`;
  }

  if (hasAttestation) {
    if (o.classification !== "HUMAN_REVIEW_REQUIRED" || record.reasonCode !== REASON.OWNER_SELF_DETERMINATION) return "OWNER_ATTESTED metadata requires HUMAN_REVIEW_REQUIRED with reasonCode OWNER_SELF_DETERMINATION";
    if (o.rerunObserved !== true || o.attestationMode !== "OWNER_ATTESTED" || o.candidateClassification !== "PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN") return "the OWNER_ATTESTED metadata is malformed";
  } else if (record.reasonCode === REASON.OWNER_SELF_DETERMINATION) {
    return "reasonCode OWNER_SELF_DETERMINATION requires the OWNER_ATTESTED metadata";
  }

  // Corrective C4 (W4-C2R-DEV-M2 / W4-C3R-DEV-L2): the record's observed key
  // set must match EXACTLY one of the three permissible shapes (see the
  // module note above `IDENTITY_FIELDS`); anything else -- including a sparse
  // record with none of shape C's fields, or a partial subset -- is rejected.
  const keySet = new Set(Object.keys(o));
  const someIdentityFields = IDENTITY_FIELDS.some((k) => keySet.has(k));
  const isShapeA = keySetsEqual(keySet, SHAPE_A_KEY_SET) && o.collected === false;
  const isShapeB = keySetsEqual(keySet, SHAPE_B_KEY_SET) && o.collected === true && NOT_COMPLETED_STATUSES.has(o.status);
  const completedRunKeySet = new Set([...COMPLETED_RUN_BASE_KEY_SET, ...(hasDetermination ? DETERMINATION_FIELDS : hasAttestation ? ATTESTATION_FIELDS : [])]);
  const isCompletedRunShaped = keySetsEqual(keySet, completedRunKeySet);

  if (!isShapeA && !isShapeB && !isCompletedRunShaped) {
    return someIdentityFields
      ? "the 1F.CI record's run-evidence fields are incomplete or contain unexpected fields"
      : "the 1F.CI record's observed evidence does not match a permissible shape (pre-completion fetch-failure, pre-completion not-yet-completed, or completed-run)";
  }

  // Corrective C6 (W4-C4R-INFO-3): matching shape A or B by KEY SET alone was
  // not enough -- the real collector (stages/1f/ci-evidence.js#collectCiEvidence())
  // only ever produces shape A with classification FAIL or INCOMPLETE (never
  // HUMAN_REVIEW_REQUIRED; PASS-mapped classifications are already excluded
  // above) and reasonCode CI_NOT_COLLECTED, and shape B with classification
  // INCOMPLETE and reasonCode CI_NOT_COLLECTED. A record claiming a shape the
  // collector recognizes but a classification/reasonCode combination it never
  // produces for that shape misrepresents collector semantics even though it
  // could never itself reach READY. Neither shape represents a completed,
  // pinned run, so neither may carry a CI-run externalEvidence entry either --
  // an unrelated one attached to a pre-completion record is rejected, never
  // silently ignored (design section 25a: evidence sources are never
  // ambiguous about what they represent).
  if (isShapeA) {
    if (o.classification !== "FAIL" && o.classification !== "INCOMPLETE") return "a pre-completion fetch-failure record can only classify FAIL or INCOMPLETE";
    if (record.reasonCode !== REASON.CI_NOT_COLLECTED) return "a pre-completion fetch-failure record must carry reasonCode CI_NOT_COLLECTED";
    if (!isBoundedString(o.reason, 200)) return "the 1F.CI record's fetch-failure reason is malformed";
    // Corrective C7 (W4-C6R-INFO-1): the real collector
    // (ci-evidence.js#collectCiEvidence()) derives shape A's classification
    // from the exact same rule -- `reason.startsWith("WRONG_")` (a run
    // fetched successfully but bound to the wrong repository/SHA/event/
    // workflow, ci-run.js's own WRONG_* identity-mismatch reasons) means
    // FAIL; every other fetch-failure reason (unreachable source, malformed
    // shape, no adapter, adapter threw, ambiguous job identity, or a
    // non-canonical adapter-supplied string normalized by
    // ci-run.js#normalizeFetchFailureReason()) means INCOMPLETE. A record
    // claiming the opposite pairing never came from the collector.
    const isWrongIdentityReason = o.reason.startsWith("WRONG_");
    if (isWrongIdentityReason && o.classification !== "FAIL") return "a WRONG_* fetch-failure reason can only classify FAIL";
    if (!isWrongIdentityReason && o.classification !== "INCOMPLETE") return "a non-WRONG_* fetch-failure reason can only classify INCOMPLETE";
    if (externalEvidence.some((e) => isCiRunSourceObjectId(e.sourceObjectId))) return "a pre-completion record cannot carry CI-run externalEvidence -- there is no completed run to pin";
  }
  if (isShapeB) {
    if (o.classification !== "INCOMPLETE") return "a pre-completion not-yet-completed record can only classify INCOMPLETE";
    if (record.reasonCode !== REASON.CI_NOT_COLLECTED) return "a pre-completion not-yet-completed record must carry reasonCode CI_NOT_COLLECTED";
    if (externalEvidence.some((e) => isCiRunSourceObjectId(e.sourceObjectId))) return "a pre-completion record cannot carry CI-run externalEvidence -- there is no completed run to pin";
  }

  // Every PASS-mapped classification (CLEAN_FIRST_PASS, and in a future
  // configuration PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN) requires the complete
  // CI-run evidence contract -- never merely "some run-evidence field was
  // present" (the exact reproduced W4-C2R-DEV-M2 defect: a bare
  // {classification:"CLEAN_FIRST_PASS"} record, matching neither shape A, B
  // nor C, must be rejected here, not silently accepted because it also
  // failed to match the OLD "someRunFields" partial-detection heuristic).
  if (contract.status === STATUS.PASS && !isCompletedRunShaped) return "a PASS-mapped classification requires the complete CI-run evidence contract";

  if (isCompletedRunShaped) {
    // Corrective C4 (W4-C3R-DEV-L1): every field is type/bound-validated
    // BEFORE any of it reaches computeCiRunDigest() -- a malformed type here
    // (e.g. requiredJobs: 5, attemptHistory: [null]) must fail closed with
    // the canonical rejection, never throw an uncaught TypeError.
    if (!isValidCiRunIdentity(o)) return "the 1F.CI record's run-evidence fields are malformed or out of bounds";

    // Corrective C4 (W4-C3R-SEC-L1): the represented run's repository and
    // event are cross-bound to the trusted invocation context. This is a
    // structural consistency check, not independent proof of platform
    // authentication -- trustedContext itself is caller-assembled input,
    // validated only for shape by isValidTrustedContext() above.
    if (o.repository !== trustedContext.repositoryId) return "the 1F.CI record's repository does not match trustedContext.repositoryId";
    // Corrective C1 (1G L3): the CI event proves the claim the mode makes
    // (pull_request for PR review, push for post-merge certification; design
    // section 25 rule 3), whatever invoked the collector.
    if (o.event !== expectedEventType(trustedContext.mode, "PLATFORM_AUTHENTICATED")) return "the 1F.CI record's event does not match the event trustedContext.mode requires";

    // The record's `subject` (already checked equal to the report's subject
    // above) is the sole HEAD authority; the digest below binds to
    // record.subject.head, never to a headSha the observed payload might
    // otherwise claim, so there is no separate headSha field to trust here.
    const expectedSourceObjectId = ciRunSourceObjectId({ repository: o.repository, runId: o.runId });
    // Corrective C4 (W4-C3R-INFO-3): every CI-run-shaped externalEvidence
    // entry -- not just one matching by ID -- is inspected; an unrelated
    // extra CI_RUN entry (e.g. for a different run) makes the report
    // ambiguous and is rejected, never silently ignored.
    const ciRunEntries = externalEvidence.filter((e) => isCiRunSourceObjectId(e.sourceObjectId));
    if (ciRunEntries.length !== 1 || ciRunEntries[0].sourceObjectId !== expectedSourceObjectId) {
      return "the finalized report requires exactly one CI-run externalEvidence entry, matching the represented run, and no unrelated CI-run entry";
    }
    const matchingRun = ciRunEntries[0];
    const expectedDigest = computeCiRunDigest({
      repository: o.repository, workflowPath: o.workflowPath, runId: o.runId, event: o.event, headSha: record.subject.head,
      attempt: o.attempt, status: o.status, requiredJobs: o.requiredJobs, missing: o.missing, failed: o.failed, pending: o.pending, skipped: o.skipped,
      attemptHistory: o.attemptHistory,
    });
    if (matchingRun.contentDigest !== expectedDigest) return "the CI-run externalEvidence entry's digest does not match the represented CI evidence";
    if (matchingRun.sourceVersion !== String(o.attempt)) return "the CI-run externalEvidence entry's version does not match the represented attempt";
    if (matchingRun.immutability !== "MUTABLE") return "CI-run evidence must be MUTABLE -- it is never VERIFIED_PROVIDER or VERIFIED_CRYPTO merely because it was collected or hashed";

    // W4-C2R-INFO-2: the observed facts a supplied record claims must remain
    // internally consistent with its own classification -- not a second
    // classifier, only a check that the SAME canonical facts the real
    // classifier (stages/1f/ci-classify.js) would have used are not
    // self-contradictory. CLEAN_FIRST_PASS specifically means "attempt 1, no
    // rerun, every required job succeeded, none skipped".
    if (o.classification === "CLEAN_FIRST_PASS") {
      if (o.attempt !== 1) return "CLEAN_FIRST_PASS is inconsistent with an attempt other than 1";
      if (o.attemptHistory.length > 0) return "CLEAN_FIRST_PASS is inconsistent with a non-empty attempt history";
      if (o.missing.length !== 0) return "CLEAN_FIRST_PASS is inconsistent with a non-empty missing-jobs list";
      if (o.failed.length !== 0) return "CLEAN_FIRST_PASS is inconsistent with a non-empty failed-jobs list";
      if (o.pending.length !== 0) return "CLEAN_FIRST_PASS is inconsistent with a non-empty pending-jobs list";
      if (o.skipped.length !== 0) return "CLEAN_FIRST_PASS is inconsistent with a non-empty skipped-jobs list";
    }

    // Corrective C7 (Shape C self-consistency): the same narrow,
    // non-classifying pattern W4-C2R-INFO-2 established for CLEAN_FIRST_PASS
    // above extended to the other three completed-run classifications, using
    // exactly the same boolean formula ci-classify.js#classifyCiEvidence()
    // itself reads off `complete`/`allSucceeded` -- `complete` means
    // `missing.length === 0 && pending.length === 0`, `allSucceeded` means
    // `complete && failed.length === 0 && skipped.length === 0`, and "hadRerun"
    // means `attempt > 1 || attemptHistory.length > 0`. This is not a second
    // classifier: it never inspects anything the real classifier itself does
    // not also read from these same four fields, and a completed-run-shaped
    // record's `missing`/`failed`/`pending`/`skipped` fields ARE the complete,
    // sufficient basis the real classifier uses -- there is no raw job list or
    // other data this check would need but lack. A completed-run record whose
    // own declared classification is impossible given its own declared job
    // outcome lists never came from the real collector and is rejected here,
    // the same way CLEAN_FIRST_PASS's self-contradiction already was.
    if (o.classification === "FAIL") {
      if (o.missing.length !== 0) return "FAIL is inconsistent with a non-empty missing-jobs list (an incomplete run classifies INCOMPLETE, not FAIL)";
      if (o.pending.length !== 0) return "FAIL is inconsistent with a non-empty pending-jobs list (an incomplete run classifies INCOMPLETE, not FAIL)";
      if (o.failed.length === 0 && o.skipped.length === 0) return "FAIL requires at least one failed or skipped required job";
    }
    if (o.classification === "INCOMPLETE") {
      if (o.missing.length === 0 && o.pending.length === 0) return "INCOMPLETE requires at least one missing or pending required job";
    }
    if (o.classification === "HUMAN_REVIEW_REQUIRED") {
      if (o.missing.length !== 0) return "HUMAN_REVIEW_REQUIRED is inconsistent with a non-empty missing-jobs list";
      if (o.pending.length !== 0) return "HUMAN_REVIEW_REQUIRED is inconsistent with a non-empty pending-jobs list";
      if (o.failed.length !== 0) return "HUMAN_REVIEW_REQUIRED is inconsistent with a non-empty failed-jobs list";
      if (o.skipped.length !== 0) return "HUMAN_REVIEW_REQUIRED is inconsistent with a non-empty skipped-jobs list";
      if (o.attempt <= 1 && o.attemptHistory.length === 0) return "HUMAN_REVIEW_REQUIRED requires a rerun (attempt > 1 or a non-empty attempt history)";
    }
  }
  return null;
}

/**
 * finalizedCiFromRecord(record) -- derives the report's `ci` (design section 23)
 * from the 1F.CI record ONLY after validateCollectedCiRecord() accepted it:
 * the classification plus the determination or OWNER_ATTESTED fields it carries.
 */
function finalizedCiFromRecord(record) {
  const o = record.observed;
  const ci = { classification: o.classification };
  for (const key of [...DETERMINATION_FIELDS, ...ATTESTATION_FIELDS]) if (Object.hasOwn(o, key)) ci[key] = o[key];
  return ci;
}

function isBoundedString(v, max) {
  return typeof v === "string" && v.length > 0 && v.length <= max;
}

/** The event a trusted invocation must carry (the same rule as stages/1a/trusted-context.js). */
function expectedEventType(mode, invocationTrust) {
  if (invocationTrust === "OPERATOR_SUPPLIED") return "manual";
  return mode === "PR_REVIEW" ? "pull_request" : "push";
}

function isValidTrustedContext(tc) {
  if (!isPlainObject(tc)) return false;
  const keys = Object.keys(tc).sort().join(",");
  const expected = [
    "base", "baseDerivation", "baseWorkflowBlobSha", "basePolicyDigest", "collectorRunId", "defaultBranch",
    "eventType", "executedCommit", "executedFrom", "frameworkVersion", "headSha", "invocationTrust", "mode",
    "phase", "provider", "repositoryId", "requiredCapabilities", "resolvedTargetTip", "rootPolicyDigest",
    "rootTip", "suppliedTargetSha", "targetRefName", "targetSupportedCapabilities", "targetSupportedSchemaVersions",
    "workflowBlobSha", "workflowIdentity",
  ].sort().join(",");
  if (keys !== expected) return false;
  // Corrective C1 (1G L3): enumerated and cross-field values are validated with the
  // same rules 1A applies to the trusted invocation context, never as free strings.
  if (typeof tc.mode !== "string" || !RANGE_MODES.includes(tc.mode)) return false;
  if (!TRUST.includes(tc.invocationTrust)) return false;
  if (typeof tc.provider !== "string" || tc.provider.length === 0) return false;
  if (typeof tc.repositoryId !== "string" || !REPOSITORY_ID.test(tc.repositoryId)) return false;
  if (tc.eventType !== expectedEventType(tc.mode, tc.invocationTrust)) return false;
  if (typeof tc.targetRefName !== "string" || tc.targetRefName.length === 0) return false;
  if (typeof tc.resolvedTargetTip !== "string" || !SHA40.test(tc.resolvedTargetTip)) return false;
  if (tc.suppliedTargetSha !== null && (typeof tc.suppliedTargetSha !== "string" || !SHA40.test(tc.suppliedTargetSha))) return false;
  if (typeof tc.headSha !== "string" || !SHA40.test(tc.headSha)) return false;
  if (typeof tc.base !== "string" || !SHA40.test(tc.base)) return false;
  if (typeof tc.baseDerivation !== "string" || tc.baseDerivation.length === 0) return false;
  if (tc.workflowIdentity !== null && !isBoundedString(tc.workflowIdentity, 300)) return false;
  if (tc.workflowBlobSha !== null && (typeof tc.workflowBlobSha !== "string" || !SHA40.test(tc.workflowBlobSha))) return false;
  if (tc.baseWorkflowBlobSha !== null && (typeof tc.baseWorkflowBlobSha !== "string" || !SHA40.test(tc.baseWorkflowBlobSha))) return false;
  if (typeof tc.defaultBranch !== "string" || tc.defaultBranch.length === 0) return false;
  if (typeof tc.rootTip !== "string" || !SHA40.test(tc.rootTip)) return false;
  if (tc.rootPolicyDigest !== null && (typeof tc.rootPolicyDigest !== "string" || !FINGERPRINT.test(tc.rootPolicyDigest))) return false;
  if (tc.basePolicyDigest !== null && (typeof tc.basePolicyDigest !== "string" || !FINGERPRINT.test(tc.basePolicyDigest))) return false;
  if (!EXECUTED_FROM.includes(tc.executedFrom)) return false;
  // frameworkVersion, targetSupportedCapabilities (capability-id@major, no duplicate)
  // and targetSupportedSchemaVersions ({minSupported, maxSupported}, min <= max) are
  // target framework metadata: validated by the one canonical kernel validator.
  if (!Array.isArray(tc.targetSupportedCapabilities) || tc.targetSupportedCapabilities.length > MAX_CAPABILITY_IDS) return false;
  const metadata = validateFrameworkMetadata({ frameworkVersion: tc.frameworkVersion, supportedCapabilities: tc.targetSupportedCapabilities, supportedSchemaVersions: tc.targetSupportedSchemaVersions });
  if (!metadata.ok) return false;
  if (!Array.isArray(tc.requiredCapabilities) || tc.requiredCapabilities.length > MAX_CAPABILITY_IDS) return false;
  if (!tc.requiredCapabilities.every((c) => validateCapabilityId(c).ok) || new Set(tc.requiredCapabilities).size !== tc.requiredCapabilities.length) return false;
  if (tc.phase !== 1 && tc.phase !== 2) return false;
  if (typeof tc.collectorRunId !== "string" || tc.collectorRunId.length === 0) return false;
  return typeof tc.executedCommit === "string" && SHA40.test(tc.executedCommit);
}

function isValidExternalEvidenceEntry(e) {
  if (!isPlainObject(e)) return false;
  const keys = Object.keys(e).sort().join(",");
  if (keys !== "collectedAt,contentDigest,immutability,sourceObjectId,sourceVersion") return false;
  if (!isBoundedString(e.sourceObjectId, 300) || !isBoundedString(e.sourceVersion, 300)) return false;
  if (typeof e.contentDigest !== "string" || !/^[0-9a-f]{64}$/.test(e.contentDigest)) return false;
  if (!isBoundedString(e.collectedAt, 64)) return false;
  return IMMUTABILITY_VALUES.has(e.immutability);
}

function isValidManifestProvenance(m) {
  if (!isPlainObject(m)) return false;
  const keys = Object.keys(m).sort().join(",");
  if (keys !== "baseAnchor,baseGateSha256,basePolicySha256,gatePath,headSha256,protectedProposals,schemaVersions") return false;
  if (typeof m.gatePath !== "string" || m.gatePath.length === 0) return false;
  if (!Array.isArray(m.schemaVersions)) return false;
  if (m.headSha256 !== null && (typeof m.headSha256 !== "string" || !FINGERPRINT.test(m.headSha256))) return false;
  if (m.baseGateSha256 !== null && (typeof m.baseGateSha256 !== "string" || !FINGERPRINT.test(m.baseGateSha256))) return false;
  if (m.basePolicySha256 !== null && (typeof m.basePolicySha256 !== "string" || !FINGERPRINT.test(m.basePolicySha256))) return false;
  if (m.baseAnchor !== "PRESENT" && m.baseAnchor !== "ABSENT") return false;
  return Array.isArray(m.protectedProposals);
}

/**
 * buildReport({ subject, tool, trustedContext, externalEvidence, manifest,
 *               reviewClass, changedFiles, records, domainsProjection,
 *               expectedDomainIds, ci })
 *
 *   subject             exact 1A identity
 *   tool                { name, version }
 *   trustedContext      caller-assembled, schema-conformant (see module doc)
 *   externalEvidence     array of the canonical 5-field entries (design section 23);
 *                        typically collectCiEvidence()'s own returned `externalEvidence`
 *   manifest            { gatePath, schemaVersions, headSha256, baseGateSha256,
 *                          basePolicySha256, baseAnchor, protectedProposals }
 *   reviewClass         string, copied verbatim -- never assigned or lowered here
 *   changedFiles        array of strings (from 1A)
 *   records             the pooled 1A-1F result records (each already validated
 *                        by its own producing stage) -- this is what is handed to
 *                        kernel.aggregate(); buildReport() never re-validates their
 *                        individual shape beyond what aggregate() itself already does
 *   domainsProjection    optional -- when supplied, checked against the 1E domain
 *                        records inside `records` via kernel.aggregate()'s own
 *                        checkDomainResultCompleteness(); a mismatch fails the report
 *   expectedDomainIds    optional restatement of the enabled-domain set; the required set
 *                        always comes from the 1E-owned 1E.DELTA.DOMAIN_SET record and
 *                        this value must equal it (Corrective C1, 1G M1)
 *   ci                   `{state: "NOT_COLLECTED"}` for Phase 1, or omitted when the
 *                        collected 1F.CI record is already present in `records`
 *
 * Returns { ok: true, report } | { ok: false, reason }. The report's own
 * `domains[]` is always DERIVED from `records[]` here, never trusted from a
 * caller-supplied value beyond the optional consistency check above.
 */
function ownerContextContradiction(records, subject, tc) {
  const bindings = [
    ["1A.IDENTITY.INVOCATION", ["mode", "invocationTrust", "repositoryId", "provider", "eventType"]],
    ["1A.IDENTITY.TARGET_TIP", ["targetRefName", "resolvedTargetTip", "suppliedTargetSha"]],
    ["1A.TARGET.PROTECTED", ["targetRefName"]],
    ["1A.POLICY.ROOT", ["defaultBranch", "rootTip", "rootPolicyDigest"]],
    ["1A.POLICY.ANCHOR", ["basePolicyDigest"]],
    ["1A.IDENTITY.WORKFLOW_ANCHOR", ["workflowIdentity", "workflowBlobSha", "baseWorkflowBlobSha"]],
  ];
  for (const [id, keys] of bindings) {
    const owner = onlyRecord(records, id);
    if (owner === null) continue; // missing canonical records remain required by the kernel
    const checked = validateResultRecord(owner);
    if (!checked.ok || owner.ownerStage !== "1A" || !sameSubject(owner.subject, subject) || !isPlainObject(owner.observed)) return "invalid canonical owner record " + id;
    for (const key of keys) if (!Object.hasOwn(owner.observed, key) || canonicalJson(tc[key]) !== canonicalJson(owner.observed[key])) return "trustedContext." + key + " differs from canonical " + id;
  }
  return null;
}

function buildReport(rawInput) {
  if (!isPlainObject(rawInput)) return invalidInput("input must be an object");
  // Corrective C3 (W4-C2R-SEC-L1): one bounded JSON snapshot, taken before any
  // validation, of every field this function reads. Every check below, and
  // the report itself, read ONLY `input` (the snapshot) from this point on --
  // never `rawInput` again.
  let input;
  try {
    input = cloneJson({
      subject: rawInput.subject, tool: rawInput.tool, trustedContext: rawInput.trustedContext,
      externalEvidence: rawInput.externalEvidence, manifest: rawInput.manifest, reviewClass: rawInput.reviewClass,
      changedFiles: rawInput.changedFiles, records: rawInput.records, ci: rawInput.ci,
      expectedDomainIds: rawInput.expectedDomainIds, domainsProjection: rawInput.domainsProjection,
      parents: rawInput.parents, branch: rawInput.branch,
    });
  } catch {
    return invalidInput("input could not be safely snapshotted (a cyclic reference, a BigInt, or a throwing toJSON)");
  }

  if (!isValidSubject(input.subject)) return invalidInput("a valid subject is required");
  const subject = input.subject;
  if (!isPlainObject(input.tool) || typeof input.tool.name !== "string" || typeof input.tool.version !== "string") return invalidInput("tool must be { name, version }");
  if (!isValidTrustedContext(input.trustedContext)) return invalidInput("trustedContext is malformed or incomplete");
  if (input.trustedContext.invocationTrust === "PLATFORM_AUTHENTICATED") return invalidInput("PLATFORM_PROVENANCE_UNAVAILABLE: no reviewed platform adapter exists");
  if (input.trustedContext.executedFrom === "TARGET_TIP" || ["workflowIdentity", "workflowBlobSha", "baseWorkflowBlobSha"].some((k) => input.trustedContext[k] !== null)) return invalidInput("operator input cannot establish TARGET_TIP or workflow provenance");
  const contradiction = trustedContextContradiction(input.trustedContext, subject);
  if (contradiction !== null) return invalidInput(contradiction);
  // Corrective C1 (1G L3): generatedFor's caller-supplied identity fields are
  // validated, never copied blindly (a branch name is author-controlled text).
  if (input.parents !== undefined && (!Array.isArray(input.parents) || input.parents.length > MAX_PARENTS || !input.parents.every((p) => typeof p === "string" && SHA40.test(p)))) {
    return invalidInput("parents must be a bounded array of full lowercase 40-hex SHAs");
  }
  if (input.branch !== undefined && input.branch !== "" && !isValidBranchName(input.branch)) return invalidInput("branch must be a valid branch name");
  if (!Array.isArray(input.externalEvidence) || input.externalEvidence.length > MAX_EXTERNAL_EVIDENCE || !input.externalEvidence.every(isValidExternalEvidenceEntry)) {
    return invalidInput("externalEvidence must be a bounded array of canonical entries");
  }
  if (!isValidManifestProvenance(input.manifest)) return invalidInput("manifest provenance is malformed or incomplete");
  if (!REVIEW_CLASSES.includes(input.reviewClass)) return invalidInput("reviewClass must be LIGHT or HEAVY");
  if (!Array.isArray(input.changedFiles) || !input.changedFiles.every((f) => typeof f === "string")) return invalidInput("changedFiles must be an array of strings");
  if (!Array.isArray(input.records)) return invalidInput("records must be an array");
  if (input.records.some((r) => isPlainObject(r) && typeof r.checkId === "string" && RESERVED_CHECK_ID.test(r.checkId))) {
    return invalidInput("records[] claims a check ID that only buildReport() itself contributes");
  }
  // Corrective C1 (1G L2/L3): the changed-file comparison must have run under the
  // same invocation trust as the report's trusted context.
  const agreement = input.records.filter((r) => isPlainObject(r) && r.checkId === "1A.DIFF.PLATFORM_AGREEMENT");
  if (agreement.some((r) => isPlainObject(r.observed) && Object.hasOwn(r.observed, "invocationTrust") && r.observed.invocationTrust !== input.trustedContext.invocationTrust)) {
    return invalidInput("the 1A changed-file comparison ran under a different invocation trust than trustedContext");
  }
  const domainSet = requiredDomainIds(input.records, subject, input.expectedDomainIds);
  if (!domainSet.ok) return invalidInput(domainSet.reason);
  // Corrective C2 (1G R3): the target tip, execution commit and target framework
  // metadata in trustedContext must be the ones 1A established.
  const ownerProblem = ownerContextContradiction(input.records, subject, input.trustedContext);
  if (ownerProblem !== null) return invalidInput(ownerProblem);
  const provenanceProblem = targetProvenanceContradiction(input.records, subject, input.trustedContext);
  if (provenanceProblem !== null) return invalidInput(provenanceProblem);

  const ci = input.ci === undefined ? null : input.ci;
  if (ci !== null && (!isPlainObject(ci) || ci.state !== "NOT_COLLECTED")) return invalidInput("ci must be omitted or exactly { state: \"NOT_COLLECTED\" } for a Phase 1 report");
  const hasCollectedCiRecordInInput = input.records.some((r) => isPlainObject(r) && r.checkId === "1F.CI");
  // Corrective C1 (W4-DEV-M1): a caller cannot claim Phase 1 (ci:{state:NOT_COLLECTED})
  // while also supplying an already-collected 1F.CI record -- that is contradictory,
  // mixed-phase input, not a report this function can honestly assemble.
  if (ci !== null && hasCollectedCiRecordInInput) return invalidInput("ci is { state: \"NOT_COLLECTED\" } (Phase 1) but records[] already contains a collected 1F.CI record (Phase 2) -- mixed-phase input is rejected");
  // Corrective C3 (W4-C2R-DEV-M1): the third, invalid case -- ci omitted AND no
  // collected 1F.CI record present -- used to fall through silently (no CI
  // check ever reached aggregation, so an otherwise-all-PASS report could
  // reach READY with zero CI evidence). Neither Phase 1 nor Phase 2 was
  // actually supplied; this is a configuration failure, not a report.
  if (ci === null && !hasCollectedCiRecordInInput) return invalidInput("ci must be either { state: \"NOT_COLLECTED\" } (Phase 1) or omitted with an already-collected 1F.CI record present in records[] (Phase 2); neither was supplied");
  // Corrective C2 (W4-C1-DEV-M1): a finalized report's `ci` is projected from
  // exactly one 1F.CI record, so that record is validated here -- before
  // aggregation or projection -- and a duplicate is rejected rather than
  // silently resolved by picking one.
  const ciRecords = input.records.filter((r) => isPlainObject(r) && r.checkId === "1F.CI");
  if (ciRecords.length > 1) return invalidInput("records[] contains more than one 1F.CI record -- a report has exactly one CI evidence record");
  if (ciRecords.length === 1) {
    const problem = validateCollectedCiRecord(ciRecords[0], subject, input.externalEvidence, input.trustedContext);
    if (problem !== null) return invalidInput(`invalid 1F.CI record: ${problem}`);
  }

  // Corrective C3 (W4-C2R-DEV-L1): the report's declared phase and its actual
  // CI-collection shape must agree. Phase 1 (trustedContext.phase === 1) is,
  // by definition, the deterministic pre-review that cannot observe its own
  // run (design section 17) -- it must supply the explicit NOT_COLLECTED
  // marker, never rely on a collected record. Phase 2 is the external
  // post-run collector -- it must never also claim the Phase 1 marker.
  const phase = input.trustedContext.phase;
  if (phase === 1 && ci === null) return invalidInput("trustedContext.phase is 1 (Phase 1) but ci was omitted -- Phase 1 requires the explicit ci: { state: \"NOT_COLLECTED\" } marker");
  if (phase === 2 && ci !== null) return invalidInput("trustedContext.phase is 2 (Phase 2) but ci is the explicit Phase 1 NOT_COLLECTED marker -- Phase 2 must omit ci");

  // Design section 17: "[Phase 1] cannot observe its own run, so it emits ci
  // as { state: NOT_COLLECTED }, which yields an INCOMPLETE record (reasonCode
  // CI_NOT_COLLECTED). Phase 1 therefore always reports readiness.state =
  // NOT_READY and never claims final readiness." A `ci` field that is merely
  // STORED in the envelope, without becoming a record `aggregate()` actually
  // sees, would let an otherwise-all-PASS Phase 1 report reach READY -- the
  // exact failure this record exists to prevent.
  const suppliedRecords = ci !== null ? [...input.records, ciNotCollectedRecord(subject)] : input.records;

  // D16: the kernel derives and binds its plan from records; 1F has no second plan.
  const aggregateInput = [...suppliedRecords, executionContextRecord(subject, input.trustedContext)];

  const agg = aggregate(aggregateInput, {
    expectedDomainIds: domainSet.ids === null ? undefined : domainSet.ids,
    domainsProjection: input.domainsProjection,
  });

  // The report's own records[] carries every canonical fact overallStatus/readiness were
  // actually derived from -- the caller-supplied records AND the kernel's own diagnostic
  // records (e.g. KERNEL.DOMAIN_RESULT.*, KERNEL.CHECK_ID.*) -- never only the former,
  // or a reader could not tell why the summary became what it did.
  const allRecords = [...agg.records, ...agg.kernelRecords];

  const domains = allRecords
    .filter((r) => Object.hasOwn(r, "domain"))
    .map((r) => ({ domainId: r.domain.domainId, effectiveLevel: r.domain.effectiveLevel, reasons: r.domain.reasons, fingerprint: r.domain.fingerprint }))
    .sort((a, b) => (a.domainId < b.domainId ? -1 : a.domainId > b.domainId ? 1 : 0));

  // ci === null means the caller omitted the field, relying on a collected
  // 1F.CI record inside records[] to represent a finalized Phase 2 report;
  // an explicit { state: "NOT_COLLECTED" } always means Phase 1, never finalized.
  const collectedCiRecord = ciRecords.length === 1 ? ciRecords[0] : null;
  const hasCollectedCi = collectedCiRecord !== null;
  const finalized = ci === null && hasCollectedCi;
  // Design section 23: `ci` is "the 1F record with classification and, when a
  // determination was accepted, {authenticatedActor, determinationMode,
  // contentDigest, channelObjectId, version}" (plus rerunObserved/attestationMode/
  // candidateClassification under OWNER_ATTESTED). Corrective C1 (W4-DEV-M1):
  // this is derived ONLY from the 1F.CI record already folded into aggregation
  // above -- never an independent, potentially contradictory caller-supplied
  // summary, and never a second, separately computed classification -- and,
  // since Corrective C2, only after validateCollectedCiRecord() accepted it.
  const ciValue = ci !== null ? ci : (hasCollectedCi ? finalizedCiFromRecord(collectedCiRecord) : { state: "NOT_COLLECTED" });

  const report = {
    schemaVersion: 1,
    tool: { name: input.tool.name, version: input.tool.version },
    generatedFor: { head: subject.head, tree: subject.tree, base: subject.base, parents: Array.isArray(input.parents) ? [...input.parents] : [], branch: typeof input.branch === "string" ? input.branch : "" },
    trustedContext: input.trustedContext,
    externalEvidence: [...input.externalEvidence],
    requiresRevalidation: true,
    finalized,
    manifest: input.manifest,
    reviewClass: input.reviewClass,
    changedFiles: [...input.changedFiles],
    records: allRecords,
    domains,
    ci: ciValue,
    humanReviewRequired: agg.humanReviewRequired,
    counts: agg.counts,
    overallStatus: agg.overallStatus,
    readiness: agg.readiness,
    notAuthorization: true,
  };

  return deepFreeze({ ok: true, report: deepFreeze(report) });
}

module.exports = { buildReport, isValidTrustedContext, isValidExternalEvidenceEntry, isValidManifestProvenance, SUPPORTED_REPORT_SCHEMA_VERSIONS, REQUIRED_CHECK_IDS };
