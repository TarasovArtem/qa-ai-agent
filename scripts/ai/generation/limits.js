/**
 * Centralized v1 bounds for the shared QA generation contracts
 * (Roadmap #22/23-F0: RequirementModel, TestCaseModel, AutomationCandidate,
 * AutomationPlan).
 *
 * Every contract/validator in scripts/ai/generation/ reads its limits from
 * here - none of them hardcode their own magic number. These are
 * conservative v1 values chosen to be generous enough for a real requirement
 * document or test suite while still bounding worst-case payload size (the
 * same "bounded, not unlimited" posture scripts/ai/collect-context.js
 * already applies to relevantFiles via MAX_FILE_BYTES/MAX_TOTAL_RELEVANT_BYTES).
 * A v2 contract is free to choose different limits; a v1 validator never
 * silently changes these.
 */

"use strict";

const LIMITS = Object.freeze({
  // Machine identifiers (model/requirement/test-case/candidate/plan/
  // reference ids). Generous enough for a human-authored or
  // producer-generated slug, short enough to keep every id trivially
  // loggable and diffable.
  ID_MAX_LENGTH: 128,

  // Short, single-purpose human text: titles, evidence-ref locations,
  // precondition lines.
  SHORT_TEXT_MAX_LENGTH: 300,

  // Longer free-text fields: requirement text, rationale, assumption/
  // open-question text, step action/expectedResult, planned-change purpose.
  LONG_TEXT_MAX_LENGTH: 4000,

  // Array-count bounds. Chosen to comfortably cover one real requirement
  // document / one real test suite's worth of content while keeping a
  // single artifact's worst-case size bounded and reviewable.
  MAX_EVIDENCE_REFS: 50,
  MAX_REQUIREMENTS: 200,
  MAX_ASSUMPTIONS: 100,
  MAX_OPEN_QUESTIONS: 100,
  MAX_TEST_STEPS: 50,
  MAX_TEST_CASES: 200,
  MAX_PLANNED_CHANGES: 100,
  MAX_VALIDATION_STEPS: 50,
  MAX_RELATED_IDS: 50,
});

module.exports = { LIMITS };
