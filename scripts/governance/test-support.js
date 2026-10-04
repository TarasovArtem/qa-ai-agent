"use strict";

// Shared test helpers (internal; not part of the public kernel interface).
const H = "a".repeat(40);
const T = "b".repeat(40);
const B = "c".repeat(40);

const SUBJECT = Object.freeze({ head: H, tree: T, base: B, range: { mode: "PR_REVIEW", from: B, to: H } });

function record(overrides = {}) {
  return {
    checkId: "1A.HEAD_MATCH",
    ownerStage: "1A",
    status: "PASS",
    subject: JSON.parse(JSON.stringify(SUBJECT)),
    observed: { head: H },
    expected: { head: H },
    reasonCode: "OK",
    detail: "",
    evidenceRefs: [],
    ...overrides,
  };
}

function domainRecord(domainId, effectiveLevel = "PRESERVATION_CHECK_ONLY", overrides = {}) {
  return record({
    checkId: `1E.DOMAIN.${domainId}`,
    ownerStage: "1E",
    status: effectiveLevel === "HUMAN_REVIEW_REQUIRED" ? "HUMAN_REVIEW_REQUIRED" : "PASS",
    reasonCode: effectiveLevel === "HUMAN_REVIEW_REQUIRED" ? "MEANING_DEPENDENCY_CHANGED" : "OK",
    domain: { domainId, effectiveLevel, reasons: [], evidenceRefs: [], dependencyState: "UNCHANGED", fingerprint: null },
    ...overrides,
  });
}

function domainDecl(domainId, overrides = {}) {
  return {
    domainId,
    enabled: true,
    ownerStage: "1B",
    dependsOn: [],
    derivedFrom: [],
    protectedInputs: ["docs/x.md#a"],
    reviewModes: ["DEEP_REVIEW_REQUIRED", "PRESERVATION_CHECK_ONLY"],
    ...overrides,
  };
}

/**
 * Caller-supplied completeness-plan data for stage-level tests. Under D16 this
 * helper carries no completeness authority: it can only restate or tighten the
 * kernel contract. Canonical completeness is derived by the kernel from its
 * framework map and canonical owner statements.
 */
function stagePlan(records, expectedDomainIds = []) {
  return { expectedDomainIds, requiredCheckIds: [...new Set(records.map((r) => r.checkId))] };
}

/**
 * Canonical test data for kernel aggregation tests. This is deliberately built
 * from the kernel-owned map, not from the records a test happens to supply.
 * The invocation models the current operator producer state. A complete public
 * aggregate therefore retains HUMAN_REVIEW_REQUIRED without platform authority.
 */
function canonicalRecords({ subject = SUBJECT, domainIds = [], overrides = {}, extras = [] } = {}) {
  const { REQUIRED_CHECK_IDS } = require("./kernel/completeness");
  const policyFingerprint = "d".repeat(64);
  const ids = [...REQUIRED_CHECK_IDS.COMMON, ...REQUIRED_CHECK_IDS[subject.range.mode]];
  const observedFor = (checkId) => {
    if (checkId === "1A.IDENTITY.INVOCATION") return { mode: subject.range.mode, invocationTrust: "OPERATOR_SUPPLIED", provider: "github", repositoryId: "owner/repo", eventType: "manual" };
    if (checkId === "1A.POLICY.EFFECTIVE") return { source: "ROOT_POLICY", policyFingerprint, referenceFamilies: [] };
    if (checkId === "1A.SCOPE.POLICY" || checkId === "1A.SECRETS.POLICY") return { policyFingerprint };
    if (checkId === "1B.MARKDOWN.POLICY") return { policyFingerprint, referenceFamilies: [] };
    if (checkId === "1A.POLICY.GATE_ANCHOR") return { baseGateSha256: null, headGateSha256: null, baseGraphFingerprint: null, headGraphFingerprint: null };
    if (checkId === "1E.DELTA.DOMAIN_SET") return { domainIds: [...domainIds].sort(), baseGateSha256: null, headGateSha256: null, baseGraphFingerprint: null, headGraphFingerprint: null };
    return {};
  };
  const required = ids.map((checkId) => {
    const base = record({ checkId, ownerStage: checkId.slice(0, 2), subject: JSON.parse(JSON.stringify(subject)), observed: observedFor(checkId) });
    if (checkId === "1A.IDENTITY.INVOCATION") {
      base.status = "HUMAN_REVIEW_REQUIRED";
      base.reasonCode = "OPERATOR_INVOCATION";
    }
    return Object.hasOwn(overrides, checkId) ? { ...base, ...overrides[checkId] } : base;
  });
  return [...required, ...domainIds.map((id) => domainRecord(id, "PRESERVATION_CHECK_ONLY", { subject: JSON.parse(JSON.stringify(subject)) })), ...extras];
}

module.exports = { H, T, B, SUBJECT, record, domainRecord, domainDecl, stagePlan, canonicalRecords };
