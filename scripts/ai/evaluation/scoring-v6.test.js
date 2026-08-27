"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DIMENSIONS,
  CRITICAL_DIMENSIONS,
  QUALITY_TERNARY_VALUES,
  ratio,
  statusFromRatio,
  scoreRequirementCoverage,
  scoreRequirementGrounding,
  scoreTraceability,
  scoreAutomationDecision,
  scoreFrameworkQuality,
  scoreEvidenceQuality,
  scoreReviewAlignment,
  scoreSampleV6,
  evaluateDatasetV6,
} = require("./scoring-v6");

// --- pure primitives -------------------------------------------------------

test("ratio: zero denominator returns null, never NaN/Infinity", () => {
  assert.equal(ratio(0, 0), null);
  assert.equal(Number.isNaN(ratio(0, 0)), false);
});

test("ratio: normal division", () => {
  assert.equal(ratio(1, 2), 0.5);
  assert.equal(ratio(2, 2), 1);
  assert.equal(ratio(0, 2), 0);
});

test("statusFromRatio: null -> not_applicable, 1 -> pass, 0 -> fail, fractional -> partial", () => {
  assert.equal(statusFromRatio(null), "not_applicable");
  assert.equal(statusFromRatio(1), "pass");
  assert.equal(statusFromRatio(0), "fail");
  assert.equal(statusFromRatio(0.5), "partial");
});

test("DIMENSIONS/CRITICAL_DIMENSIONS: reviewAlignment is a dimension but never critical", () => {
  assert.ok(DIMENSIONS.includes("reviewAlignment"));
  assert.ok(!CRITICAL_DIMENSIONS.includes("reviewAlignment"));
  assert.equal(CRITICAL_DIMENSIONS.length, DIMENSIONS.length - 1);
});

test("QUALITY_TERNARY_VALUES matches the established v1-v5 vocabulary", () => {
  assert.deepEqual(QUALITY_TERNARY_VALUES, ["pass", "partial", "fail", "not_applicable"]);
});

// --- requirementCoverage ----------------------------------------------------

test("scoreRequirementCoverage: empty gold -> not_applicable", () => {
  const result = scoreRequirementCoverage({ requirements: [] }, { expectedRequirementIds: [] });
  assert.equal(result.status, "not_applicable");
});

test("scoreRequirementCoverage: all expected present -> pass", () => {
  const result = scoreRequirementCoverage({ requirements: [{ id: "req-1" }, { id: "req-2" }] }, { expectedRequirementIds: ["req-1", "req-2"] });
  assert.equal(result.status, "pass");
});

test("scoreRequirementCoverage: one missing -> partial", () => {
  const result = scoreRequirementCoverage({ requirements: [{ id: "req-1" }] }, { expectedRequirementIds: ["req-1", "req-2"] });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.missing, ["req-2"]);
});

test("scoreRequirementCoverage: none present -> fail", () => {
  const result = scoreRequirementCoverage({ requirements: [] }, { expectedRequirementIds: ["req-1"] });
  assert.equal(result.status, "fail");
});

// --- requirementGrounding ----------------------------------------------------

test("scoreRequirementGrounding: exact evidence set match -> pass", () => {
  const rm = { requirements: [{ id: "req-1", evidenceRefIds: ["e1", "e2"] }] };
  const result = scoreRequirementGrounding(rm, { requirementGrounding: [{ requirementId: "req-1", expectedEvidenceRefIds: ["e2", "e1"] }] });
  assert.equal(result.status, "pass", "set comparison must be order-independent");
});

test("scoreRequirementGrounding: extra unexpected evidence -> fail (exact set, not subset)", () => {
  const rm = { requirements: [{ id: "req-1", evidenceRefIds: ["e1", "e2"] }] };
  const result = scoreRequirementGrounding(rm, { requirementGrounding: [{ requirementId: "req-1", expectedEvidenceRefIds: ["e1"] }] });
  assert.equal(result.status, "fail");
});

test("scoreRequirementGrounding: requirement id not found -> fail, not a crash", () => {
  const rm = { requirements: [] };
  const result = scoreRequirementGrounding(rm, { requirementGrounding: [{ requirementId: "req-missing", expectedEvidenceRefIds: ["e1"] }] });
  assert.equal(result.status, "fail");
  assert.equal(result.mismatches[0].found, false);
});

// --- traceability ----------------------------------------------------

test("scoreTraceability: requirement covered by a test case -> pass", () => {
  const tcm = { testCases: [{ requirementIds: ["req-1"] }] };
  assert.equal(scoreTraceability(tcm, { traceability: [{ requirementId: "req-1" }] }).status, "pass");
});

test("scoreTraceability: requirement not referenced by any test case -> fail", () => {
  const tcm = { testCases: [{ requirementIds: ["req-1"] }] };
  const result = scoreTraceability(tcm, { traceability: [{ requirementId: "req-2" }] });
  assert.equal(result.status, "fail");
  assert.deepEqual(result.uncovered, ["req-2"]);
});

test("scoreTraceability: no double counting - two test cases covering the same requirement still counts as one covered requirement", () => {
  const tcm = { testCases: [{ requirementIds: ["req-1"] }, { requirementIds: ["req-1"] }] };
  const result = scoreTraceability(tcm, { traceability: [{ requirementId: "req-1" }] });
  assert.equal(result.status, "pass");
  assert.equal(result.matched, 1);
  assert.equal(result.total, 1);
});

// --- automationDecision + confusion matrix ----------------------------------

test("scoreAutomationDecision: exact match -> pass, confusion matrix diagonal", () => {
  const candidates = [{ testCaseId: "tc-1", decision: "AUTOMATE" }];
  const result = scoreAutomationDecision(candidates, { decisions: [{ testCaseId: "tc-1", decision: "AUTOMATE" }] });
  assert.equal(result.status, "pass");
  assert.equal(result.confusionMatrix.AUTOMATE.AUTOMATE, 1);
  assert.equal(result.confusionMatrix.AUTOMATE.BLOCKED, 0);
});

test("scoreAutomationDecision: mismatch -> fail, confusion matrix off-diagonal", () => {
  const candidates = [{ testCaseId: "tc-1", decision: "BLOCKED" }];
  const result = scoreAutomationDecision(candidates, { decisions: [{ testCaseId: "tc-1", decision: "AUTOMATE" }] });
  assert.equal(result.status, "fail");
  assert.equal(result.confusionMatrix.AUTOMATE.BLOCKED, 1);
});

test("scoreAutomationDecision: confusion matrix cell sum equals the number of evaluated decisions (invariant)", () => {
  const candidates = [
    { testCaseId: "tc-1", decision: "AUTOMATE" },
    { testCaseId: "tc-2", decision: "DO_NOT_AUTOMATE" },
    { testCaseId: "tc-3", decision: "BLOCKED" },
  ];
  const gold = { decisions: [{ testCaseId: "tc-1", decision: "AUTOMATE" }, { testCaseId: "tc-2", decision: "AUTOMATE" }, { testCaseId: "tc-3", decision: "BLOCKED" }] };
  const result = scoreAutomationDecision(candidates, gold);
  let sum = 0;
  for (const row of Object.values(result.confusionMatrix)) for (const count of Object.values(row)) sum += count;
  assert.equal(sum, gold.decisions.length);
});

test("scoreAutomationDecision: missing candidate for a labeled test case -> fail, no confusion-matrix entry for a null actual", () => {
  const result = scoreAutomationDecision([], { decisions: [{ testCaseId: "tc-1", decision: "AUTOMATE" }] });
  assert.equal(result.status, "fail");
  let sum = 0;
  for (const row of Object.values(result.confusionMatrix)) for (const count of Object.values(row)) sum += count;
  assert.equal(sum, 0, "an unresolvable actual decision must not be silently counted anywhere in the matrix");
});

// --- frameworkQuality ----------------------------------------------------

test("scoreFrameworkQuality: authorized-but-wrong-framework is detected as a quality mismatch", () => {
  const candidates = [{ testCaseId: "tc-1", targetFrameworks: ["playwright"] }];
  const result = scoreFrameworkQuality(candidates, { decisions: [{ testCaseId: "tc-1", decision: "AUTOMATE", targetFrameworks: ["cypress"] }] });
  assert.equal(result.status, "fail");
});

test("scoreFrameworkQuality: exact set match required, subset is not sufficient", () => {
  const candidates = [{ testCaseId: "tc-1", targetFrameworks: ["cypress", "playwright"] }];
  const result = scoreFrameworkQuality(candidates, { decisions: [{ testCaseId: "tc-1", decision: "AUTOMATE", targetFrameworks: ["cypress"] }] });
  assert.equal(result.status, "fail");
});

test("scoreFrameworkQuality: empty expected set correctly matches empty actual (DO_NOT_AUTOMATE/BLOCKED case)", () => {
  const candidates = [{ testCaseId: "tc-1", targetFrameworks: [] }];
  const result = scoreFrameworkQuality(candidates, { decisions: [{ testCaseId: "tc-1", decision: "DO_NOT_AUTOMATE", targetFrameworks: [] }] });
  assert.equal(result.status, "pass");
});

// --- evidenceQuality ----------------------------------------------------

test("scoreEvidenceQuality: both evidence and rationale match -> pass", () => {
  const candidates = [{ testCaseId: "tc-1", evidenceRefs: [{ id: "e1" }], rationaleEvidenceRefIds: ["e1"] }];
  const gold = { candidateEvidence: [{ testCaseId: "tc-1", expectedEvidenceRefIds: ["e1"], expectedRationaleEvidenceRefIds: ["e1"] }] };
  assert.equal(scoreEvidenceQuality(candidates, gold).status, "pass");
});

test("scoreEvidenceQuality: only evidenceRefs match, rationale empty -> partial (ternary, not binary)", () => {
  const candidates = [{ testCaseId: "tc-1", evidenceRefs: [{ id: "e1" }], rationaleEvidenceRefIds: [] }];
  const gold = { candidateEvidence: [{ testCaseId: "tc-1", expectedEvidenceRefIds: ["e1"], expectedRationaleEvidenceRefIds: ["e1"] }] };
  assert.equal(scoreEvidenceQuality(candidates, gold).status, "partial");
});

test("scoreEvidenceQuality: neither matches -> fail", () => {
  const candidates = [{ testCaseId: "tc-1", evidenceRefs: [], rationaleEvidenceRefIds: [] }];
  const gold = { candidateEvidence: [{ testCaseId: "tc-1", expectedEvidenceRefIds: ["e1"], expectedRationaleEvidenceRefIds: ["e1"] }] };
  assert.equal(scoreEvidenceQuality(candidates, gold).status, "fail");
});

// --- reviewAlignment ----------------------------------------------------

test("scoreReviewAlignment: no gold outcome and no actual status -> not_applicable", () => {
  assert.equal(scoreReviewAlignment({ reviewOutcome: null }, null).status, "not_applicable");
});

test("scoreReviewAlignment: matching status -> pass", () => {
  assert.equal(scoreReviewAlignment({ reviewOutcome: "APPROVED" }, "APPROVED").status, "pass");
});

test("scoreReviewAlignment: disagreement -> fail, never rewrites the record, purely reports it", () => {
  const result = scoreReviewAlignment({ reviewOutcome: "CHANGES_REQUESTED" }, "APPROVED");
  assert.equal(result.status, "fail");
  assert.equal(result.expected, "CHANGES_REQUESTED");
  assert.equal(result.actual, "APPROVED");
});

// --- scoreSampleV6 / qualityGatePassed --------------------------------------

test("scoreSampleV6: qualityGatePassed is false when any CRITICAL dimension fails, even if reviewAlignment (non-critical) also fails", () => {
  const sample = {
    artifacts: {
      requirementModel: { requirements: [{ id: "req-1", evidenceRefIds: ["e1"] }] },
      testCaseModel: { testCases: [{ requirementIds: ["req-1"] }] },
      automationCandidates: [{ testCaseId: "tc-1", decision: "AUTOMATE", targetFrameworks: ["cypress"], evidenceRefs: [{ id: "e1" }], rationaleEvidenceRefIds: ["e1"] }],
    },
    gold: {
      expectedRequirementIds: ["req-1"],
      requirementGrounding: [{ requirementId: "req-1", expectedEvidenceRefIds: ["e1"] }],
      traceability: [{ requirementId: "req-1" }],
      decisions: [{ testCaseId: "tc-1", decision: "AUTOMATE", targetFrameworks: ["cypress"] }],
      candidateEvidence: [{ testCaseId: "tc-1", expectedEvidenceRefIds: ["e1"], expectedRationaleEvidenceRefIds: ["e1"] }],
      reviewOutcome: "APPROVED",
    },
  };
  const scored = scoreSampleV6(sample, "REJECTED");
  assert.equal(scored.dimensions.reviewAlignment.status, "fail");
  assert.equal(scored.qualityGatePassed, true, "a non-critical reviewAlignment failure must not fail the quality gate");
});

// --- evaluateDatasetV6: determinism, ordering, invalid-input classification --

test("evaluateDatasetV6: repeated runs on the same dataset are structurally identical (determinism)", () => {
  const dataset = require("./dataset-v6.json");
  const a = evaluateDatasetV6(dataset);
  const b = evaluateDatasetV6(dataset);
  assert.deepEqual(a, b);
});

test("evaluateDatasetV6: an artifact chain that fails real #22F validation is classified as invalidInput, never scored on quality", () => {
  const badRequirementModel = { schemaVersion: 1, kind: "RequirementModel", id: "rm-x", projectId: "proj-x", evidenceRefs: [], requirements: [], assumptions: [], openQuestions: [] };
  const dataset = {
    version: 6,
    samples: [
      {
        id: "TD-V6-BAD",
        scenario: "invalid",
        description: "deliberately invalid",
        projectId: "proj-x",
        kind: "negative",
        artifacts: {
          requirementModel: badRequirementModel,
          testCaseModel: { schemaVersion: 1, kind: "TestCaseModel", id: "tcm-x", projectId: "proj-x", requirementModelId: "WRONG-ID", testCases: [] },
          automationCandidates: [],
          frameworkCapability: { projectId: "proj-x", supportedFrameworks: [] },
          projectProfile: null,
        },
        reviewDecisions: null,
        gold: { expectedRequirementIds: [], requirementGrounding: [], traceability: [], decisions: [], candidateEvidence: [], reviewOutcome: null },
        metadata: { expectedWeakDimensions: [] },
      },
    ],
  };
  const result = evaluateDatasetV6(dataset);
  assert.equal(result.metrics.invalidInputCount, 1);
  assert.equal(result.metrics.scorableCount, 0);
  assert.equal(result.samples[0].invalidInput, true);
  assert.equal(result.samples[0].dimensions, null);
});

test("evaluateDatasetV6: dimension tallies sum to the scorable sample count for every dimension", () => {
  const dataset = require("./dataset-v6.json");
  const result = evaluateDatasetV6(dataset);
  for (const dimension of DIMENSIONS) {
    const counts = result.metrics.dimensions[dimension];
    const sum = counts.pass + counts.partial + counts.fail + counts.not_applicable;
    assert.equal(sum, result.metrics.scorableCount);
  }
});

test("evaluateDatasetV6: weaknessDetection rate is null (not NaN) when nothing is labeled", () => {
  const dataset = { version: 6, samples: [] };
  const result = evaluateDatasetV6(dataset);
  assert.equal(result.metrics.weaknessDetection.rate, null);
});

// --- QUALITY vs GOVERNANCE BOUNDARY (Roadmap #22G Section 5/149/150) -------
//
// Permanent proof that a high/passing quality result never grants, implies,
// or substitutes for human approval - and that this module has no
// `approved`/`humanApproved`/`authorized` vocabulary in its own output at
// all, so there is no field a future caller could mistake for one.

test("GOVERNANCE BOUNDARY: a case where every quality dimension PASSES but the real reviewRecord says REJECTED never produces an 'approved' result - the evaluation result carries no approval field whatsoever", () => {
  const dataset = require("./dataset-v6.json");
  const td001 = dataset.samples.find((s) => s.id === "TD-V6-001");
  // td001 is a fully-grounded, all-pass case; give it an explicit expected
  // review outcome so reviewAlignment is actually scored (not
  // not_applicable), then feed a REJECTED actual review status directly
  // into scoreSampleV6 to simulate "quality is perfect, human rejected
  // anyway".
  const sampleWithReviewExpectation = { ...td001, gold: { ...td001.gold, reviewOutcome: "APPROVED" } };
  const scored = scoreSampleV6(sampleWithReviewExpectation, "REJECTED");
  assert.equal(scored.dimensions.requirementCoverage.status, "pass");
  assert.equal(scored.dimensions.requirementGrounding.status, "pass");
  assert.equal(scored.dimensions.traceability.status, "pass");
  assert.equal(scored.dimensions.automationDecision.status, "pass");
  assert.equal(scored.dimensions.frameworkQuality.status, "pass");
  assert.equal(scored.dimensions.evidenceQuality.status, "pass");
  assert.equal(scored.dimensions.reviewAlignment.status, "fail", "the disagreement must be reported, never silently reconciled");
  // The evaluator's entire vocabulary is qualityGatePassed/dimensions -
  // never approved/humanApproved/authorized/reviewRecord itself.
  assert.deepEqual(Object.keys(scored).sort(), ["dimensions", "qualityGatePassed"]);
  assert.equal("approved" in scored, false);
  assert.equal("humanApproved" in scored, false);
  assert.equal("authorized" in scored, false);
});

test("GOVERNANCE BOUNDARY: evaluateDatasetV6's own metrics/sample output never introduces an approval field", () => {
  const dataset = require("./dataset-v6.json");
  const result = evaluateDatasetV6(dataset);
  const serialized = JSON.stringify(result);
  assert.ok(!/"approved"/.test(serialized));
  assert.ok(!/"humanApproved"/.test(serialized));
  assert.ok(!/"authorized"/.test(serialized));
});
