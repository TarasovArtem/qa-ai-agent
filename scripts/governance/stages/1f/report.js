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
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { aggregate } = require("../../kernel/readiness");
const { validateResultRecord, cloneJson } = require("../../kernel/results");
const { isValidSubject, sameSubject } = require("../common");
const { CLASSIFICATION_CONTRACT } = require("./ci-classify");
const { UNMET_TRUST_PREREQUISITES } = require("./determination");
const { ciRunSourceObjectId, computeCiRunDigest } = require("./ci-evidence");

const SHA40 = /^[0-9a-f]{40}$/;
const REPOSITORY_ID = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const TRUST = ["PLATFORM_AUTHENTICATED", "OPERATOR_SUPPLIED"];
const EXECUTED_FROM = ["TARGET_TIP", "HEAD"];
const MAX_EXTERNAL_EVIDENCE = 256;
const MAX_CAPABILITY_IDS = 256;
const IMMUTABILITY_VALUES = new Set(["MUTABLE", "VERIFIED_PROVIDER", "VERIFIED_CRYPTO"]);
const SUPPORTED_REPORT_SCHEMA_VERSIONS = [1];

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
function validateCollectedCiRecord(record, subject, externalEvidence) {
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

  // Corrective C3 (W4-C2R-DEV-M2): a record produced past a completed,
  // validated run fetch always carries these run-evidence fields (see
  // stages/1f/ci-evidence.js#collectCiEvidence()'s final ciRecord() call); a
  // record from an earlier exit (fetch failure, wrong identity, in-progress
  // run) never does, and never requires CI-run externalEvidence (there is no
  // completed run to pin). When present, the finalized report must carry
  // EXACTLY ONE externalEvidence entry for THIS run, and its digest must
  // match what the observed evidence itself implies -- an unrelated, missing,
  // wrong-repository/HEAD/run/attempt, or digest-mismatched entry is rejected
  // rather than silently accepted or silently left absent.
  const runFields = ["repository", "workflowPath", "runId", "event", "attempt", "status", "requiredJobs", "missing", "failed", "pending", "skipped", "attemptHistory"];
  const hasRunEvidence = runFields.every((k) => Object.hasOwn(o, k));
  const someRunFields = runFields.some((k) => Object.hasOwn(o, k));
  if (someRunFields && !hasRunEvidence) return "the 1F.CI record's run-evidence fields are incomplete";
  if (hasRunEvidence) {
    if (typeof o.repository !== "string" || typeof o.workflowPath !== "string" || typeof o.runId !== "string") return "the 1F.CI record's run identity fields are malformed";
    // The record's `subject` (already checked equal to the report's subject
    // above) is the sole HEAD authority; the digest below binds to
    // record.subject.head, never to a headSha the observed payload might
    // otherwise claim, so there is no separate headSha field to trust here.
    const expectedSourceObjectId = ciRunSourceObjectId({ repository: o.repository, runId: o.runId });
    const matchingRun = externalEvidence.filter((e) => e.sourceObjectId === expectedSourceObjectId);
    if (matchingRun.length !== 1) return "the finalized report requires exactly one externalEvidence entry for the represented CI run";
    const expectedDigest = computeCiRunDigest({
      repository: o.repository, workflowPath: o.workflowPath, runId: o.runId, event: o.event, headSha: record.subject.head,
      attempt: o.attempt, status: o.status, requiredJobs: o.requiredJobs, missing: o.missing, failed: o.failed, pending: o.pending, skipped: o.skipped,
      attemptHistory: o.attemptHistory,
    });
    if (matchingRun[0].contentDigest !== expectedDigest) return "the CI-run externalEvidence entry's digest does not match the represented CI evidence";
    if (matchingRun[0].sourceVersion !== String(o.attempt)) return "the CI-run externalEvidence entry's version does not match the represented attempt";
    if (matchingRun[0].immutability !== "MUTABLE") return "CI-run evidence must be MUTABLE -- it is never VERIFIED_PROVIDER or VERIFIED_CRYPTO merely because it was collected or hashed";

    // W4-C2R-INFO-2: the observed facts a supplied record claims must remain
    // internally consistent with its own classification -- not a second
    // classifier, only a check that the SAME canonical facts the real
    // classifier (stages/1f/ci-classify.js) would have used are not
    // self-contradictory. CLEAN_FIRST_PASS specifically means "attempt 1, no
    // rerun, every required job succeeded": a record claiming that
    // classification while also claiming attempt > 1, or a non-empty
    // missing/failed/pending list, is rejected.
    if (o.classification === "CLEAN_FIRST_PASS") {
      if (o.attempt !== 1) return "CLEAN_FIRST_PASS is inconsistent with an attempt other than 1";
      if (Array.isArray(o.attemptHistory) && o.attemptHistory.length > 0) return "CLEAN_FIRST_PASS is inconsistent with a non-empty attempt history";
      if (!(Array.isArray(o.missing) && o.missing.length === 0)) return "CLEAN_FIRST_PASS is inconsistent with a non-empty missing-jobs list";
      if (!(Array.isArray(o.failed) && o.failed.length === 0)) return "CLEAN_FIRST_PASS is inconsistent with a non-empty failed-jobs list";
      if (!(Array.isArray(o.pending) && o.pending.length === 0)) return "CLEAN_FIRST_PASS is inconsistent with a non-empty pending-jobs list";
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
  if (typeof tc.mode !== "string") return false;
  if (!TRUST.includes(tc.invocationTrust)) return false;
  if (typeof tc.provider !== "string" || tc.provider.length === 0) return false;
  if (typeof tc.repositoryId !== "string" || !REPOSITORY_ID.test(tc.repositoryId)) return false;
  if (typeof tc.eventType !== "string" || tc.eventType.length === 0) return false;
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
  if (tc.rootPolicyDigest !== null && !isBoundedString(tc.rootPolicyDigest, 128)) return false;
  if (tc.basePolicyDigest !== null && !isBoundedString(tc.basePolicyDigest, 128)) return false;
  if (!EXECUTED_FROM.includes(tc.executedFrom)) return false;
  if (typeof tc.frameworkVersion !== "string" || tc.frameworkVersion.length === 0) return false;
  if (!Array.isArray(tc.targetSupportedCapabilities) || tc.targetSupportedCapabilities.length > MAX_CAPABILITY_IDS || !tc.targetSupportedCapabilities.every((c) => typeof c === "string")) return false;
  if (!Array.isArray(tc.targetSupportedSchemaVersions)) return false;
  if (!Array.isArray(tc.requiredCapabilities) || tc.requiredCapabilities.length > MAX_CAPABILITY_IDS || !tc.requiredCapabilities.every((c) => typeof c === "string")) return false;
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
  if (typeof m.headSha256 !== "string" && m.headSha256 !== null) return false;
  if (typeof m.baseGateSha256 !== "string" && m.baseGateSha256 !== null) return false;
  if (typeof m.basePolicySha256 !== "string" && m.basePolicySha256 !== null) return false;
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
 *   expectedDomainIds    the enabled-domain-id set aggregate() checks completeness against
 *   ci                   `{state: "NOT_COLLECTED"}` for Phase 1, or omitted when the
 *                        collected 1F.CI record is already present in `records`
 *
 * Returns { ok: true, report } | { ok: false, reason }. The report's own
 * `domains[]` is always DERIVED from `records[]` here, never trusted from a
 * caller-supplied value beyond the optional consistency check above.
 */
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
  if (input.trustedContext.headSha !== subject.head) return invalidInput("trustedContext.headSha does not match the subject");
  if (!Array.isArray(input.externalEvidence) || input.externalEvidence.length > MAX_EXTERNAL_EVIDENCE || !input.externalEvidence.every(isValidExternalEvidenceEntry)) {
    return invalidInput("externalEvidence must be a bounded array of canonical entries");
  }
  if (!isValidManifestProvenance(input.manifest)) return invalidInput("manifest provenance is malformed or incomplete");
  if (typeof input.reviewClass !== "string" || input.reviewClass.length === 0) return invalidInput("reviewClass is required");
  if (!Array.isArray(input.changedFiles) || !input.changedFiles.every((f) => typeof f === "string")) return invalidInput("changedFiles must be an array of strings");
  if (!Array.isArray(input.records)) return invalidInput("records must be an array");

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
    const problem = validateCollectedCiRecord(ciRecords[0], subject, input.externalEvidence);
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
  const aggregateInput = ci !== null ? [...input.records, ciNotCollectedRecord(subject)] : input.records;

  const agg = aggregate(aggregateInput, {
    expectedDomainIds: input.expectedDomainIds,
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

module.exports = { buildReport, isValidTrustedContext, isValidExternalEvidenceEntry, isValidManifestProvenance, SUPPORTED_REPORT_SCHEMA_VERSIONS };
