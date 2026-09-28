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
 */

"use strict";

const { REASON, STATUS, deepFreeze } = require("../../kernel/contracts");
const { isPlainObject } = require("../../kernel/validation");
const { aggregate } = require("../../kernel/readiness");
const { validateResultRecord } = require("../../kernel/results");
const { isValidSubject } = require("../common");

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
function buildReport(input) {
  if (!isPlainObject(input) || !isValidSubject(input.subject)) return invalidInput("a valid subject is required");
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
  const hasCollectedCi = input.records.some((r) => isPlainObject(r) && r.checkId === "1F.CI");
  const finalized = ci === null && hasCollectedCi;
  const ciValue = ci !== null ? ci : (hasCollectedCi ? { collected: true } : { state: "NOT_COLLECTED" });

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
