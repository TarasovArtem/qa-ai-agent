/**
 * Deterministic scoring primitives for QA Agent Evaluation v6 (Roadmap #22G).
 *
 * Unlike v1-v5 (which re-score frozen, hand-curated QA-failure-triage
 * records - classification/shouldRetry/shouldCreateBug/correlation/
 * knowledge-grounding, see scoring.js/scoring-v2..v5.js), v6 evaluates a
 * different subject entirely: the QUALITY of the #22 Test Design pipeline
 * (RequirementModel v1 -> TestCaseModel v1 -> AutomationCandidate v1 ->
 * TestDesignReviewPackage v1 -> optional TestDesignReviewRecord v1). v6
 * reuses only the FRAMEWORK CONVENTIONS established by v1-v5 - the
 * dataset/baseline/evaluate/regression/scoring file quintet, `-v6` naming,
 * `{valid, errors: string[]}` validator shape, per-dimension (never
 * composite) scoring/regression, deterministic ordering, no Date.now()/
 * Math.random(), small duplicated primitives rather than cross-version
 * imports - never the QA-triage domain content itself.
 *
 * VALIDATION vs EVALUATION (Roadmap #22G, Section 4): this module assumes
 * every sample's `artifacts` have ALREADY been independently re-validated
 * by the real, frozen #22F production chain (buildTestDesignReviewPackage()
 * / validateGenerationChain()) - see evaluate-v6.js, which does that BEFORE
 * calling into this module and classifies a validation failure as
 * `INVALID_EVALUATION_INPUT`, never as a scored quality result. This module
 * itself never re-implements or duplicates that structural validation - it
 * only measures whether the CONTENT matches labeled gold expectations.
 *
 * EVALUATION IS OBSERVATIONAL (Roadmap #22G, Sections 5/71/150): nothing in
 * this module ever mutates a TestDesignReviewPackage/TestDesignReviewRecord,
 * approves anything, or overrides a human REJECT/REQUEST_CHANGES decision.
 * `reviewAlignment` measures agreement between a labeled expectation and an
 * ACTUAL status computed by the real, unmodified #22F
 * buildTestDesignReviewRecord()/validateApprovedTestDesignReview() - it is
 * a measurement, never an authorization path. See this module's own
 * `DIMENSIONS`/`CRITICAL_DIMENSIONS` split: `reviewAlignment` is
 * deliberately excluded from `CRITICAL_DIMENSIONS` (never gates
 * `qualityGatePassed`) because human review remains authoritative
 * elsewhere (#22F), not something this evaluator can grade a Test Design
 * artifact against as if it were an intrinsic property of the artifact.
 *
 * S-2 / H1-F1 (carried forward, never solved here): a `reviewAlignment`
 * "pass" means the ACTUAL TestDesignReviewRecord.status this evaluator
 * computed from a labeled decision fixture matches the GOLD expected
 * status - it is a content-comparison, not a cryptographic or
 * authentication claim (see test-design-review-record.js's own
 * "INTEGRITY IS NOT AUTHENTICITY" docstring, FUTURE_HUMAN_DECISION_PROVENANCE_GUARD).
 * Likewise `frameworkQuality` compares against the LABELED
 * frameworkCapability fixture, never an objectively verified project
 * truth (FUTURE_FRAMEWORK_CAPABILITY_PROVENANCE_GUARD, H1-F1).
 */

"use strict";

const { DECISIONS } = require("../generation/automation-candidate");
const { buildTestDesignReviewPackage } = require("../test-design/test-design-review-package");
const { buildTestDesignReviewRecord } = require("../test-design/test-design-review-record");

// The complete v6 quality-dimension vocabulary, in stable report order.
// `reviewAlignment` is intentionally last and intentionally excluded from
// CRITICAL_DIMENSIONS - see this module's own docstring.
const DIMENSIONS = Object.freeze(["requirementGrounding", "requirementCoverage", "traceability", "automationDecision", "frameworkQuality", "evidenceQuality", "reviewAlignment"]);

const CRITICAL_DIMENSIONS = Object.freeze(["requirementGrounding", "requirementCoverage", "traceability", "automationDecision", "frameworkQuality", "evidenceQuality"]);

// Same ternary vocabulary v1-v5 already use throughout (correlation*/
// knowledge* quality fields) - reused here as the per-case-per-dimension
// status, never redefined with different semantics.
const QUALITY_TERNARY_VALUES = Object.freeze(["pass", "partial", "fail", "not_applicable"]);

// --- small, deliberately duplicated primitives (see this module's own
// docstring: "small duplicated primitives, not a shared refactor" is the
// established v1-v5 convention - kept identical here, not imported from
// scoring.js/scoring-v5.js) ------------------------------------------------

function ratio(matched, total) {
  return total === 0 ? null : matched / total;
}

function toSet(arr) {
  return new Set(Array.isArray(arr) ? arr : []);
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function statusFromRatio(r) {
  if (r === null) return "not_applicable";
  if (r === 1) return "pass";
  if (r === 0) return "fail";
  return "partial";
}

function zeroCounts(values) {
  const out = {};
  for (const v of values) out[v] = 0;
  return out;
}

// --- per-dimension scorers ---------------------------------------------

// requirementCoverage: did the accepted RequirementModel contain every
// labeled expected requirement id?
function scoreRequirementCoverage(requirementModel, gold) {
  const expected = Array.isArray(gold.expectedRequirementIds) ? gold.expectedRequirementIds : [];
  if (expected.length === 0) return { status: "not_applicable", matched: 0, total: 0, missing: [] };
  const actualIds = toSet((requirementModel.requirements || []).map((r) => r.id));
  const missing = expected.filter((id) => !actualIds.has(id));
  const matched = expected.length - missing.length;
  return { status: statusFromRatio(ratio(matched, expected.length)), matched, total: expected.length, missing };
}

// requirementGrounding: for each labeled requirement, does its actual
// evidenceRefIds set exactly match the labeled expected evidence set?
function scoreRequirementGrounding(requirementModel, gold) {
  const entries = Array.isArray(gold.requirementGrounding) ? gold.requirementGrounding : [];
  if (entries.length === 0) return { status: "not_applicable", matched: 0, total: 0, mismatches: [] };
  const byId = new Map((requirementModel.requirements || []).map((r) => [r.id, r]));
  const mismatches = [];
  let matched = 0;
  for (const entry of entries) {
    const req = byId.get(entry.requirementId);
    const expectedSet = toSet(entry.expectedEvidenceRefIds);
    const actualSet = req ? toSet(req.evidenceRefIds) : new Set();
    if (req && setsEqual(expectedSet, actualSet)) {
      matched += 1;
    } else {
      mismatches.push({ requirementId: entry.requirementId, found: Boolean(req) });
    }
  }
  return { status: statusFromRatio(ratio(matched, entries.length)), matched, total: entries.length, mismatches };
}

// traceability: for each labeled requirement, is it referenced by at least
// one TestCaseModel test case's requirementIds?
function scoreTraceability(testCaseModel, gold) {
  const entries = Array.isArray(gold.traceability) ? gold.traceability : [];
  if (entries.length === 0) return { status: "not_applicable", matched: 0, total: 0, uncovered: [] };
  const covered = new Set();
  for (const tc of testCaseModel.testCases || []) {
    for (const reqId of tc.requirementIds || []) covered.add(reqId);
  }
  const uncovered = entries.filter((e) => !covered.has(e.requirementId)).map((e) => e.requirementId);
  const matched = entries.length - uncovered.length;
  return { status: statusFromRatio(ratio(matched, entries.length)), matched, total: entries.length, uncovered };
}

// automationDecision: exact decision match per labeled test case, plus a
// deterministic confusion matrix (rows=expected, cols=actual, in the
// frozen DECISIONS order).
function scoreAutomationDecision(automationCandidates, gold) {
  const entries = Array.isArray(gold.decisions) ? gold.decisions : [];
  if (entries.length === 0) return { status: "not_applicable", matched: 0, total: 0, mismatches: [], confusionMatrix: null };
  const byTestCaseId = new Map(automationCandidates.map((c) => [c.testCaseId, c]));
  const confusionMatrix = {};
  for (const expected of DECISIONS) confusionMatrix[expected] = zeroCounts(DECISIONS);
  const mismatches = [];
  let matched = 0;
  for (const entry of entries) {
    const candidate = byTestCaseId.get(entry.testCaseId);
    const actualDecision = candidate ? candidate.decision : null;
    if (actualDecision && DECISIONS.includes(actualDecision)) {
      confusionMatrix[entry.decision][actualDecision] += 1;
    }
    if (candidate && candidate.decision === entry.decision) {
      matched += 1;
    } else {
      mismatches.push({ testCaseId: entry.testCaseId, expected: entry.decision, actual: actualDecision });
    }
  }
  return { status: statusFromRatio(ratio(matched, entries.length)), matched, total: entries.length, mismatches, confusionMatrix };
}

// frameworkQuality: exact expected-framework-SET match per labeled test
// case - deliberately exact-set, not subset, since #22E's own
// validateFrameworkAuthorization() already guarantees the (weaker)
// subset-of-authorized property; this dimension measures whether the
// authorized choice was also the CORRECT one for this labeled case
// (Roadmap #22G Section 86).
function scoreFrameworkQuality(automationCandidates, gold) {
  const entries = (Array.isArray(gold.decisions) ? gold.decisions : []).filter((e) => Array.isArray(e.targetFrameworks));
  if (entries.length === 0) return { status: "not_applicable", matched: 0, total: 0, mismatches: [] };
  const byTestCaseId = new Map(automationCandidates.map((c) => [c.testCaseId, c]));
  const mismatches = [];
  let matched = 0;
  for (const entry of entries) {
    const candidate = byTestCaseId.get(entry.testCaseId);
    const expectedSet = toSet(entry.targetFrameworks);
    const actualSet = candidate ? toSet(candidate.targetFrameworks) : new Set();
    if (candidate && setsEqual(expectedSet, actualSet)) {
      matched += 1;
    } else {
      mismatches.push({ testCaseId: entry.testCaseId, expected: entry.targetFrameworks, actual: candidate ? candidate.targetFrameworks : null });
    }
  }
  return { status: statusFromRatio(ratio(matched, entries.length)), matched, total: entries.length, mismatches };
}

// evidenceQuality: per labeled candidate, both evidenceRefs identity and
// rationaleEvidenceRefIds must exactly match their own expected sets - a
// per-entry ternary (both match=pass, one matches=partial, neither
// matches or candidate missing=fail), aggregated the same way every other
// dimension is. This exercises the accepted #22E "F1" limitation
// (AUTOMATE may omit rationaleEvidenceRefIds) as a QUALITY SIGNAL only -
// it never changes the frozen AutomationCandidate v1 schema.
function scoreEvidenceQuality(automationCandidates, gold) {
  const entries = Array.isArray(gold.candidateEvidence) ? gold.candidateEvidence : [];
  if (entries.length === 0) return { status: "not_applicable", matched: 0, total: 0, partial: 0, mismatches: [] };
  const byTestCaseId = new Map(automationCandidates.map((c) => [c.testCaseId, c]));
  const mismatches = [];
  let matched = 0;
  let partial = 0;
  for (const entry of entries) {
    const candidate = byTestCaseId.get(entry.testCaseId);
    const expectedEvidence = toSet(entry.expectedEvidenceRefIds);
    const expectedRationale = toSet(entry.expectedRationaleEvidenceRefIds);
    const actualEvidence = candidate ? toSet((candidate.evidenceRefs || []).map((e) => e.id)) : new Set();
    const actualRationale = candidate ? toSet(candidate.rationaleEvidenceRefIds) : new Set();
    const evidenceOk = candidate && setsEqual(expectedEvidence, actualEvidence);
    const rationaleOk = candidate && setsEqual(expectedRationale, actualRationale);
    if (evidenceOk && rationaleOk) {
      matched += 1;
    } else if (evidenceOk || rationaleOk) {
      partial += 1;
      mismatches.push({ testCaseId: entry.testCaseId, evidenceOk: Boolean(evidenceOk), rationaleOk: Boolean(rationaleOk) });
    } else {
      mismatches.push({ testCaseId: entry.testCaseId, evidenceOk: false, rationaleOk: false });
    }
  }
  const status = matched === entries.length ? "pass" : matched + partial === 0 ? "fail" : "partial";
  return { status, matched, total: entries.length, partial, mismatches };
}

// reviewAlignment: is a labeled expected review outcome the SAME as the
// ACTUAL status computed by the real, unmodified #22F
// buildTestDesignReviewRecord() (already invoked by the caller before this
// scorer runs - see evaluate-v6.js). `actualStatus` is null when the case
// supplies no review-decision fixture.
function scoreReviewAlignment(gold, actualStatus) {
  if (!gold.reviewOutcome || actualStatus === null) {
    return { status: "not_applicable", expected: gold.reviewOutcome || null, actual: actualStatus };
  }
  return { status: actualStatus === gold.reviewOutcome ? "pass" : "fail", expected: gold.reviewOutcome, actual: actualStatus };
}

/**
 * Scores one v6 sample's already-accepted artifacts against its own gold
 * labels. `reviewActualStatus` (string|null) is computed by the caller via
 * the real buildTestDesignReviewRecord() and passed in - this function
 * never builds or validates a review record itself.
 */
function scoreSampleV6({ artifacts, gold }, reviewActualStatus) {
  const dims = {
    requirementCoverage: scoreRequirementCoverage(artifacts.requirementModel, gold),
    requirementGrounding: scoreRequirementGrounding(artifacts.requirementModel, gold),
    traceability: scoreTraceability(artifacts.testCaseModel, gold),
    automationDecision: scoreAutomationDecision(artifacts.automationCandidates, gold),
    frameworkQuality: scoreFrameworkQuality(artifacts.automationCandidates, gold),
    evidenceQuality: scoreEvidenceQuality(artifacts.automationCandidates, gold),
    reviewAlignment: scoreReviewAlignment(gold, reviewActualStatus),
  };
  const qualityGatePassed = CRITICAL_DIMENSIONS.every((d) => dims[d].status === "pass" || dims[d].status === "not_applicable");
  return { dimensions: dims, qualityGatePassed };
}

// Resolves a sample's `reviewDecisions` fixture (target/testCaseId/decision
// - never a hardcoded digest, since a digest is only meaningful once
// computed from real content) against the REAL, already-built
// reviewPackage.reviewTargets, then builds an ACTUAL TestDesignReviewRecord
// via the real, unmodified buildTestDesignReviewRecord(). Returns the
// actual `.status`, or null if the sample supplies no review-decision
// fixture, or a bounded string describing a build failure (treated as
// `reviewAlignment: fail` by scoreReviewAlignment via a non-matching,
// non-null actual value - never silently coerced to not_applicable, since
// a supplied-but-invalid fixture is a real mismatch, not an absence).
function resolveReviewActualStatus(reviewPackage, reviewDecisionsFixture) {
  if (!reviewDecisionsFixture) return null;
  const candidatesByTestCaseId = new Map(reviewPackage.automationCandidates.map((c) => [c.testCaseId, c]));
  const decisions = [];
  for (const target of reviewPackage.reviewTargets) {
    let fixtureEntry;
    if (target.artifactKind === "AutomationCandidate") {
      const candidate = reviewPackage.automationCandidates.find((c) => c.id === target.artifactId);
      const testCaseId = candidate ? candidate.testCaseId : null;
      fixtureEntry = reviewDecisionsFixture.find((d) => d.target === "AutomationCandidate" && d.testCaseId === testCaseId);
    } else {
      fixtureEntry = reviewDecisionsFixture.find((d) => d.target === target.artifactKind);
    }
    if (!fixtureEntry) return "MISSING_REVIEW_DECISION_FIXTURE";
    decisions.push({ artifactKind: target.artifactKind, artifactId: target.artifactId, artifactDigest: target.artifactDigest, decision: fixtureEntry.decision, comment: fixtureEntry.comment });
  }
  const result = buildTestDesignReviewRecord({ reviewPackage, reviewerId: "v6-evaluation-fixture-reviewer", reviewedAt: "2026-01-01T00:00:00.000Z", decisions });
  return result.ok ? result.reviewRecord.status : "REVIEW_RECORD_BUILD_FAILED";
}

/**
 * Scores an entire v6 dataset. Every sample's artifacts are independently
 * re-validated via the REAL, unmodified #22F buildTestDesignReviewPackage()
 * before any quality dimension is scored (Roadmap #22G "VALIDATION vs
 * EVALUATION") - a sample whose artifacts fail that real validation is
 * classified as `invalidInput` and excluded from every quality/regression
 * tally, never silently scored as a 0-quality sample.
 */
function evaluateDatasetV6(dataset) {
  const perSample = [];
  const dimensionTally = {};
  for (const dim of DIMENSIONS) dimensionTally[dim] = zeroCounts(QUALITY_TERNARY_VALUES);
  const automationDecisionConfusionMatrix = {};
  for (const expected of DECISIONS) automationDecisionConfusionMatrix[expected] = zeroCounts(DECISIONS);

  let qualityGatePassedCount = 0;
  let qualityGateFailedCount = 0;
  let invalidInputCount = 0;
  let weaknessesLabeled = 0;
  let weaknessesDetected = 0;
  let unexpectedWeaknessesOnPositiveCases = 0;

  for (const sample of dataset.samples) {
    const { requirementModel, testCaseModel, automationCandidates, frameworkCapability, projectProfile } = sample.artifacts;
    const pkgResult = buildTestDesignReviewPackage({
      requirementModel,
      testCaseModel,
      automationCandidates,
      frameworkCapability,
      projectProfile: projectProfile === null ? undefined : projectProfile,
      expectedProjectId: sample.projectId,
    });

    if (!pkgResult.ok) {
      invalidInputCount += 1;
      perSample.push({ id: sample.id, kind: sample.kind, invalidInput: true, errors: pkgResult.errors, qualityGatePassed: null, dimensions: null });
      continue;
    }

    const reviewActualStatus = resolveReviewActualStatus(pkgResult.reviewPackage, sample.reviewDecisions);
    const scored = scoreSampleV6(sample, reviewActualStatus);

    for (const dim of DIMENSIONS) dimensionTally[dim][scored.dimensions[dim].status] += 1;

    const decisionMatrix = scored.dimensions.automationDecision.confusionMatrix;
    if (decisionMatrix) {
      for (const expected of DECISIONS) {
        for (const actual of DECISIONS) {
          automationDecisionConfusionMatrix[expected][actual] += decisionMatrix[expected][actual];
        }
      }
    }

    if (scored.qualityGatePassed) qualityGatePassedCount += 1;
    else qualityGateFailedCount += 1;

    const expectedWeak = sample.metadata.expectedWeakDimensions;
    weaknessesLabeled += expectedWeak.length;
    for (const dim of expectedWeak) {
      if (scored.dimensions[dim].status !== "pass") weaknessesDetected += 1;
    }
    if (expectedWeak.length === 0) {
      const unexpected = DIMENSIONS.filter((d) => scored.dimensions[d].status === "fail" || scored.dimensions[d].status === "partial");
      unexpectedWeaknessesOnPositiveCases += unexpected.length;
    }

    perSample.push({ id: sample.id, kind: sample.kind, invalidInput: false, errors: [], qualityGatePassed: scored.qualityGatePassed, dimensions: scored.dimensions });
  }

  return {
    metrics: {
      totalSamples: dataset.samples.length,
      invalidInputCount,
      scorableCount: dataset.samples.length - invalidInputCount,
      qualityGate: { passed: qualityGatePassedCount, failed: qualityGateFailedCount },
      dimensions: dimensionTally,
      automationDecisionConfusionMatrix,
      weaknessDetection: { labeled: weaknessesLabeled, detected: weaknessesDetected, rate: ratio(weaknessesDetected, weaknessesLabeled) },
      falsePositives: unexpectedWeaknessesOnPositiveCases,
    },
    samples: perSample,
  };
}

module.exports = {
  DIMENSIONS,
  CRITICAL_DIMENSIONS,
  QUALITY_TERNARY_VALUES,
  ratio,
  statusFromRatio,
  toSet,
  setsEqual,
  zeroCounts,
  scoreRequirementCoverage,
  scoreRequirementGrounding,
  scoreTraceability,
  scoreAutomationDecision,
  scoreFrameworkQuality,
  scoreEvidenceQuality,
  scoreReviewAlignment,
  scoreSampleV6,
  resolveReviewActualStatus,
  evaluateDatasetV6,
};
