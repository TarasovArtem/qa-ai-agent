"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateDatasetV6, validateSampleV6 } = require("./dataset-v6-schema");

function validSample(overrides = {}) {
  return {
    id: "TD-V6-TEST",
    scenario: "test",
    description: "test",
    projectId: "proj-x",
    kind: "positive",
    artifacts: {
      requirementModel: { projectId: "proj-x" },
      testCaseModel: { projectId: "proj-x" },
      automationCandidates: [{ projectId: "proj-x" }],
      frameworkCapability: { projectId: "proj-x" },
      projectProfile: null,
    },
    reviewDecisions: null,
    gold: {
      expectedRequirementIds: [],
      requirementGrounding: [],
      traceability: [],
      decisions: [],
      candidateEvidence: [],
      reviewOutcome: null,
      notApplicableDimensions: ["requirementCoverage", "requirementGrounding", "traceability", "automationDecision", "frameworkQuality", "evidenceQuality"],
    },
    metadata: { expectedWeakDimensions: [] },
    ...overrides,
  };
}

test("the real committed dataset-v6.json is valid", () => {
  const dataset = require("./dataset-v6.json");
  const result = validateDatasetV6(dataset);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("valid minimal sample is accepted", () => {
  assert.equal(validateSampleV6(validSample()).valid, true);
});

test("wrong dataset.version is rejected", () => {
  const result = validateDatasetV6({ version: 5, samples: [] });
  assert.equal(result.valid, false);
});

test("non-array samples is rejected", () => {
  const result = validateDatasetV6({ version: 6, samples: {} });
  assert.equal(result.valid, false);
});

test("duplicate sample ids are rejected, fail closed (no last-write-wins)", () => {
  const result = validateDatasetV6({ version: 6, samples: [validSample({ id: "TD-V6-DUP" }), validSample({ id: "TD-V6-DUP" })] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate sample id")));
});

test("unknown top-level sample field is rejected", () => {
  const result = validateSampleV6(validSample({ superQuality: 100 }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("superQuality")));
});

test("invalid sample.kind is rejected", () => {
  const result = validateSampleV6(validSample({ kind: "neutral" }));
  assert.equal(result.valid, false);
});

test("cross-project artifact (requirementModel.projectId mismatch) is rejected", () => {
  const sample = validSample();
  sample.artifacts.requirementModel = { projectId: "other-project" };
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("requirementModel.projectId")));
});

test("cross-project automationCandidates entry is rejected", () => {
  const sample = validSample();
  sample.artifacts.automationCandidates = [{ projectId: "other-project" }];
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("gold.decisions[].decision must be a known AutomationCandidate decision value", () => {
  const sample = validSample();
  sample.gold.decisions = [{ testCaseId: "tc-1", decision: "MAYBE", targetFrameworks: [] }];
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("gold.reviewOutcome must be a known review status or null", () => {
  const sample = validSample();
  sample.gold.reviewOutcome = "SOMETHING_ELSE";
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("unknown gold field is rejected", () => {
  const sample = validSample();
  sample.gold.bonusScore = 100;
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("metadata.expectedWeakDimensions must only name real dimensions", () => {
  const sample = validSample();
  sample.metadata.expectedWeakDimensions = ["notARealDimension"];
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("reviewDecisions entry with target=AutomationCandidate requires testCaseId", () => {
  const sample = validSample({ reviewDecisions: [{ target: "AutomationCandidate", decision: "APPROVE" }] });
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("reviewDecisions entry with target!=AutomationCandidate must not carry testCaseId", () => {
  const sample = validSample({ reviewDecisions: [{ target: "RequirementModel", testCaseId: "tc-1", decision: "APPROVE" }] });
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("reviewDecisions entry with an unknown decision value is rejected", () => {
  const sample = validSample({ reviewDecisions: [{ target: "RequirementModel", decision: "MAYBE" }] });
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("reviewDecisions may be explicitly null", () => {
  const sample = validSample({ reviewDecisions: null });
  assert.equal(validateSampleV6(sample).valid, true);
});

test("requirementGrounding entry expectation-target shape is validated", () => {
  const sample = validSample();
  sample.gold.requirementGrounding = [{ requirementId: "req-1" }]; // missing expectedEvidenceRefIds
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("null is rejected", () => {
  assert.equal(validateDatasetV6(null).valid, false);
});

test("array instead of dataset object is rejected", () => {
  assert.equal(validateDatasetV6([]).valid, false);
});

// --- explicit not-applicable contract (Roadmap #22G-C1, closes G-3) --------

test("an empty critical-dimension gold array WITHOUT a matching notApplicableDimensions declaration is rejected (ambiguous: intentional vs. forgotten label)", () => {
  const sample = validSample({ gold: { expectedRequirementIds: [], requirementGrounding: [], traceability: [], decisions: [], candidateEvidence: [], reviewOutcome: null, notApplicableDimensions: ["requirementGrounding", "traceability", "automationDecision", "frameworkQuality", "evidenceQuality"] } });
  // requirementCoverage's own gold.expectedRequirementIds is empty but NOT declared not_applicable
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("requirementCoverage") && e.includes("not declared")));
});

test("a populated critical-dimension gold array declared not_applicable is rejected as a contradiction", () => {
  const sample = validSample();
  sample.gold.expectedRequirementIds = ["req-1"]; // non-empty, but requirementCoverage is still declared not_applicable in the base fixture
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("requirementCoverage") && e.includes("contradiction")));
});

test("notApplicableDimensions rejects an unknown/non-critical dimension name (e.g. reviewAlignment, which is not critical, or a made-up name)", () => {
  const sample = validSample();
  sample.gold.notApplicableDimensions = [...sample.gold.notApplicableDimensions, "reviewAlignment"];
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("notApplicableDimensions rejects duplicate entries", () => {
  const sample = validSample();
  sample.gold.notApplicableDimensions = [...sample.gold.notApplicableDimensions, "requirementCoverage"];
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("automationDecision and frameworkQuality (sharing gold.decisions) must be declared not_applicable together, never only one", () => {
  const sample = validSample();
  sample.gold.notApplicableDimensions = sample.gold.notApplicableDimensions.filter((d) => d !== "frameworkQuality");
  // now automationDecision is declared not_applicable but frameworkQuality is not, while gold.decisions is still empty
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
});

test("a genuinely applicable dimension (non-empty gold array, not declared not_applicable) is accepted", () => {
  const sample = validSample();
  sample.gold.expectedRequirementIds = ["req-1"];
  sample.gold.notApplicableDimensions = sample.gold.notApplicableDimensions.filter((d) => d !== "requirementCoverage");
  const result = validateSampleV6(sample);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

// --- duplicate expectedWeakDimensions (Roadmap #22G-C1, closes G-4) --------

test("metadata.expectedWeakDimensions rejects duplicate entries (would double-count in the weakness-detection summary)", () => {
  const sample = validSample({ metadata: { expectedWeakDimensions: ["traceability", "traceability"] } });
  const result = validateSampleV6(sample);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("duplicate")));
});

test("metadata.expectedWeakDimensions accepts distinct entries, including two different weaknesses for the same case", () => {
  const sample = validSample({ metadata: { expectedWeakDimensions: ["automationDecision", "frameworkQuality"] } });
  const result = validateSampleV6(sample);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
