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
 * Corrective C2 (1G R1): kernel aggregate() is READY only with an explicit
 * completeness plan. Stage-level tests judge one stage's OWN records, so this
 * states exactly that scope: the plan is the check IDs the stage emitted plus
 * an explicit enabled-domain set (none by default). It never widens what can be
 * READY -- report-level completeness is covered by buildReport() and the kernel
 * tests, which supply the real plan.
 */
function stagePlan(records, expectedDomainIds = []) {
  return { expectedDomainIds, requiredCheckIds: [...new Set(records.map((r) => r.checkId))] };
}

module.exports = { H, T, B, SUBJECT, record, domainRecord, domainDecl, stagePlan };
