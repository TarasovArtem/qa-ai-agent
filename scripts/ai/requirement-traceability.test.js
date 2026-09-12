"use strict";

/**
 * Roadmap RTI-5 (Requirement <-> Test Traceability / Coverage): unit
 * coverage for scripts/ai/requirement-traceability.js - the structural
 * mapping/aggregation layer between RTI-1 RequirementArtifact[] and RTI-4
 * TestDesignArtifact[]. Covers every worked matrix from the RTI-5 mission
 * itself (zero-criteria, criterion coverage, multiple-tests-per-criterion,
 * unmapped designs, orphan/duplicate/malformed-input rejection), the
 * structured-provenance-only adversarial probes (misleading id/title/
 * objective, index-shift, criterionId reorder stability), determinism,
 * immutability, freeze, JSON-safety, source independence, and RTI-3
 * independence.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { buildRequirementTraceability, analyzeRequirementsCoverage } = require("./requirement-traceability");

function req(overrides = {}) {
  return {
    id: "REQ-X",
    type: "requirement",
    title: "Example requirement",
    source: { type: "file", location: "requirements.json" },
    ...overrides,
  };
}

function td(overrides = {}) {
  return {
    id: "REQ-X::test::1",
    requirementId: "REQ-X",
    title: "Example requirement",
    objective: "Verify that: c",
    expectedResults: ["c"],
    source: { requirementId: "REQ-X" },
    ...overrides,
  };
}

// --- zero-criteria matrix (§56) --------------------------------------------

test("RTI-5 zero-criteria (§56): no acceptance criteria, no tests -> UNCOVERED, requirementLevelCovered=false", () => {
  const [result] = analyzeRequirementsCoverage([req({ id: "REQ-1", content: "c" })], []);
  assert.equal(result.status, "UNCOVERED");
  assert.equal(result.totalCriteria, 0);
  assert.equal(result.coveredCriteria, 0);
  assert.equal(result.uncoveredCriteria, 0);
  assert.deepEqual(result.criteria, []);
  assert.equal(result.requirementLevelCovered, false);
  assert.deepEqual(result.requirementLevelTestIds, []);
  assert.deepEqual(result.unmappedTestDesignIds, []);
});

test("RTI-5 zero-criteria (§56): no acceptance criteria, one requirement-level test -> FULLY_COVERED", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1" } })];
  const [result] = analyzeRequirementsCoverage(requirements, testDesigns);
  assert.equal(result.status, "FULLY_COVERED");
  assert.equal(result.requirementLevelCovered, true);
  assert.deepEqual(result.requirementLevelTestIds, ["T-1"]);
});

test("RTI-5 zero-criteria (§56): multiple requirement-level tests -> FULLY_COVERED, all ids in input order", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  const testDesigns = [
    td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1" } }),
    td({ id: "T-2", requirementId: "REQ-1", source: { requirementId: "REQ-1" } }),
  ];
  const [result] = analyzeRequirementsCoverage(requirements, testDesigns);
  assert.equal(result.status, "FULLY_COVERED");
  assert.deepEqual(result.requirementLevelTestIds, ["T-1", "T-2"]);
});

// --- criterion coverage matrix (§57) ----------------------------------------

function threeCriteriaRequirement() {
  return req({
    id: "REQ-3AC",
    content: "c",
    acceptanceCriteria: [{ id: "AC-1", text: "one" }, { id: "AC-2", text: "two" }, { id: "AC-3", text: "three" }],
  });
}

test("RTI-5 criterion coverage (§57): 3 criteria, zero tests -> UNCOVERED", () => {
  const [result] = analyzeRequirementsCoverage([threeCriteriaRequirement()], []);
  assert.equal(result.status, "UNCOVERED");
  assert.equal(result.totalCriteria, 3);
  assert.equal(result.coveredCriteria, 0);
  assert.equal(result.uncoveredCriteria, 3);
  assert.ok(result.criteria.every((c) => c.covered === false));
});

test("RTI-5 criterion coverage (§57): 3 criteria, AC1 only -> PARTIALLY_COVERED", () => {
  const testDesigns = [td({ id: "T-1", source: { requirementId: "REQ-3AC", criterionId: "AC-1" }, requirementId: "REQ-3AC" })];
  const [result] = analyzeRequirementsCoverage([threeCriteriaRequirement()], testDesigns);
  assert.equal(result.status, "PARTIALLY_COVERED");
  assert.equal(result.coveredCriteria, 1);
  assert.equal(result.uncoveredCriteria, 2);
});

test("RTI-5 criterion coverage (§57): 3 criteria, AC1+AC3 -> PARTIALLY_COVERED, AC2 explicitly uncovered", () => {
  const testDesigns = [
    td({ id: "T-1", requirementId: "REQ-3AC", source: { requirementId: "REQ-3AC", criterionId: "AC-1" } }),
    td({ id: "T-3", requirementId: "REQ-3AC", source: { requirementId: "REQ-3AC", criterionId: "AC-3" } }),
  ];
  const [result] = analyzeRequirementsCoverage([threeCriteriaRequirement()], testDesigns);
  assert.equal(result.status, "PARTIALLY_COVERED");
  assert.equal(result.coveredCriteria, 2);
  assert.equal(result.uncoveredCriteria, 1);
  assert.equal(result.criteria[0].covered, true);
  assert.equal(result.criteria[1].covered, false);
  assert.equal(result.criteria[1].criterionId, "AC-2");
  assert.equal(result.criteria[2].covered, true);
});

test("RTI-5 criterion coverage (§57): all 3 criteria referenced -> FULLY_COVERED", () => {
  const testDesigns = [
    td({ id: "T-1", requirementId: "REQ-3AC", source: { requirementId: "REQ-3AC", criterionId: "AC-1" } }),
    td({ id: "T-2", requirementId: "REQ-3AC", source: { requirementId: "REQ-3AC", criterionId: "AC-2" } }),
    td({ id: "T-3", requirementId: "REQ-3AC", source: { requirementId: "REQ-3AC", criterionId: "AC-3" } }),
  ];
  const [result] = analyzeRequirementsCoverage([threeCriteriaRequirement()], testDesigns);
  assert.equal(result.status, "FULLY_COVERED");
  assert.equal(result.coveredCriteria, 3);
  assert.equal(result.uncoveredCriteria, 0);
});

// --- multiple tests per criterion (§58) -------------------------------------

test("RTI-5 multiple tests per criterion (§58): two tests referencing the same criterion count once, both listed in order", () => {
  const requirement = req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] });
  const testDesigns = [
    td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-1" } }),
    td({ id: "T-2", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-1" } }),
  ];
  const [result] = analyzeRequirementsCoverage([requirement], testDesigns);
  assert.equal(result.coveredCriteria, 1);
  assert.deepEqual(result.criteria[0].testDesignIds, ["T-1", "T-2"]);
});

// --- criterionIndex mapping (positional fallback) ---------------------------

test("RTI-5: acceptance criteria without ids are traced/covered by criterionIndex", () => {
  const requirement = req({ id: "REQ-NOID", content: "c", acceptanceCriteria: [{ text: "one" }, { text: "two" }] });
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-NOID", source: { requirementId: "REQ-NOID", criterionIndex: 1 } })];
  const [result] = analyzeRequirementsCoverage([requirement], testDesigns);
  assert.equal(result.criteria[0].covered, false);
  assert.equal(result.criteria[0].criterionIndex, 0);
  assert.equal(result.criteria[1].covered, true);
  assert.equal(result.criteria[1].criterionIndex, 1);
  assert.deepEqual(result.criteria[1].testDesignIds, ["T-1"]);
});

test("RTI-5: an id-based and an index-based reference to the SAME criterion both count toward its coverage", () => {
  const requirement = req({ id: "REQ-MIX", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] });
  const testDesigns = [
    td({ id: "T-1", requirementId: "REQ-MIX", source: { requirementId: "REQ-MIX", criterionId: "AC-1" } }),
    td({ id: "T-2", requirementId: "REQ-MIX", source: { requirementId: "REQ-MIX", criterionIndex: 0 } }),
  ];
  const [result] = analyzeRequirementsCoverage([requirement], testDesigns);
  assert.equal(result.coveredCriteria, 1);
  assert.deepEqual(result.criteria[0].testDesignIds, ["T-1", "T-2"]);
});

// --- unmapped test matrix (§59) ---------------------------------------------

test("RTI-5 unmapped (§59): requirement has ACs, a test references the requirement only -> unmapped, not counted as coverage", () => {
  const requirement = req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }, { id: "AC-2", text: "t2" }] });
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1" } })];
  const [result] = analyzeRequirementsCoverage([requirement], testDesigns);
  assert.equal(result.status, "UNCOVERED");
  assert.equal(result.coveredCriteria, 0);
  assert.deepEqual(result.unmappedTestDesignIds, ["T-1"]);
});

// --- orphan / referential-integrity matrix (§60) ----------------------------

test("RTI-5 orphan (§60): unknown requirement reference rejects, no partial output", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-GHOST", source: { requirementId: "REQ-GHOST" } })];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_INCONSISTENT_REFERENCE/);
  assert.throws(() => analyzeRequirementsCoverage(requirements, testDesigns), /TRACEABILITY_INCONSISTENT_REFERENCE/);
});

test("RTI-5 orphan (§60): requirementId/source.requirementId mismatch rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-OTHER" } })];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_INCONSISTENT_REFERENCE/);
});

test("RTI-5 orphan (§60): unknown criterionId rejects, no unmapped downgrade", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-999" } })];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_INCONSISTENT_REFERENCE/);
});

test("RTI-5 orphan (§60): negative criterionIndex rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionIndex: -1 } })];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 orphan (§60): fractional criterionIndex rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionIndex: 1.5 } })];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 orphan (§60): out-of-range criterionIndex rejects, no clipping", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionIndex: 4 } })];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_INCONSISTENT_REFERENCE/);
});

test("RTI-5 orphan (§60): criterion reference on a zero-criteria requirement rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionIndex: 0 } })];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_INCONSISTENT_REFERENCE/);
});

test("RTI-5 orphan (§60): criterionId and criterionIndex both present rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-1", criterionIndex: 0 } })];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_INCONSISTENT_REFERENCE/);
});

// --- duplicate matrix (§61) -------------------------------------------------

test("RTI-5 duplicate (§61): duplicate requirement id rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "a" }), req({ id: "REQ-1", content: "b" })];
  assert.throws(() => buildRequirementTraceability(requirements, []), /TRACEABILITY_COLLECTION_INVALID/);
});

test("RTI-5 duplicate (§61): duplicate criterion id within one requirement rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "a" }, { id: "AC-1", text: "b" }] })];
  assert.throws(() => buildRequirementTraceability(requirements, []), /TRACEABILITY_COLLECTION_INVALID/);
});

test("RTI-5 duplicate (§61): duplicate test design id rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  const testDesigns = [
    td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1" } }),
    td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1" } }),
  ];
  assert.throws(() => buildRequirementTraceability(requirements, testDesigns), /TRACEABILITY_COLLECTION_INVALID/);
});

// --- malformed test design input (§62) --------------------------------------

test("RTI-5 malformed input (§62): null/string/array/{} test design entries all reject", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  for (const malformed of [null, "not an object", [], {}]) {
    assert.throws(() => buildRequirementTraceability(requirements, [malformed]), /TRACEABILITY_INPUT_INVALID/);
  }
});

test("RTI-5 malformed input (§62): missing/empty id rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  assert.throws(() => buildRequirementTraceability(requirements, [td({ id: undefined })]), /TRACEABILITY_INPUT_INVALID/);
  assert.throws(() => buildRequirementTraceability(requirements, [td({ id: "" })]), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 malformed input (§62): missing requirementId rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  assert.throws(() => buildRequirementTraceability(requirements, [td({ requirementId: undefined })]), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 malformed input (§62): invalid/missing source rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  assert.throws(() => buildRequirementTraceability(requirements, [td({ source: undefined })]), /TRACEABILITY_INPUT_INVALID/);
  assert.throws(() => buildRequirementTraceability(requirements, [td({ source: "nope" })]), /TRACEABILITY_INPUT_INVALID/);
  assert.throws(() => buildRequirementTraceability(requirements, [td({ source: null })]), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 malformed input (§62): missing source.requirementId rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  assert.throws(() => buildRequirementTraceability(requirements, [td({ source: {} })]), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 malformed input (§62): invalid criterionId (non-string, empty) rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] })];
  assert.throws(() => buildRequirementTraceability(requirements, [td({ source: { requirementId: "REQ-1", criterionId: 5 } })]), /TRACEABILITY_INPUT_INVALID/);
  assert.throws(() => buildRequirementTraceability(requirements, [td({ source: { requirementId: "REQ-1", criterionId: "" } })]), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 malformed input (§62): invalid criterionIndex (non-number, string) rejects", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ text: "t" }] })];
  assert.throws(() => buildRequirementTraceability(requirements, [td({ source: { requirementId: "REQ-1", criterionIndex: "0" } })]), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 malformed input: a hostile getter-backed source is never invoked and fails closed", () => {
  const requirements = [req({ id: "REQ-1", content: "c" })];
  let getterCalls = 0;
  const hostile = td({});
  Object.defineProperty(hostile, "source", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("must never be invoked");
    },
  });
  assert.throws(() => buildRequirementTraceability(requirements, [hostile]), /TRACEABILITY_INPUT_INVALID/);
  assert.equal(getterCalls, 0);
});

// --- malformed requirement input (§63): delegated to RTI-1, not re-implemented ---

test("RTI-5 malformed requirement input (§63): an invalid RequirementArtifact is rejected via RTI-1's own validator", () => {
  assert.throws(() => buildRequirementTraceability([{ id: "REQ-1" }], []), /TRACEABILITY_INPUT_INVALID/);
  assert.throws(() => buildRequirementTraceability([{ id: "REQ-1" }], []), /REQUIREMENT_ARTIFACT_INVALID/);
});

// --- empty collections (§29/§30) --------------------------------------------

test("RTI-5 (§29): an empty requirements array is rejected, never silently treated as zero coverage results", () => {
  assert.throws(() => buildRequirementTraceability([], []), /TRACEABILITY_INPUT_INVALID/);
  assert.throws(() => analyzeRequirementsCoverage([], []), /TRACEABILITY_INPUT_INVALID/);
});

test("RTI-5 (§30): an empty testDesigns array is valid - every requirement is UNCOVERED", () => {
  const requirements = [req({ id: "REQ-1", content: "c" }), req({ id: "REQ-2", content: "c" })];
  const links = buildRequirementTraceability(requirements, []);
  assert.deepEqual(links, []);
  const results = analyzeRequirementsCoverage(requirements, []);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.status === "UNCOVERED"));
});

// --- adversarial structured-provenance tests (§33-38) -----------------------

test("RTI-5 adversarial (§33): a misleading test id prefix never influences traceability", () => {
  const requirements = [req({ id: "REQ-A", content: "c" })];
  const testDesigns = [td({ id: "REQ-WRONG::test::999", requirementId: "REQ-A", source: { requirementId: "REQ-A" } })];
  const [link] = buildRequirementTraceability(requirements, testDesigns);
  assert.equal(link.requirementId, "REQ-A");
  assert.equal(link.testDesignId, "REQ-WRONG::test::999");
});

test("RTI-5 adversarial (§34): a misleading title never influences traceability", () => {
  const requirements = [req({ id: "REQ-A", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] })];
  const testDesigns = [
    td({ id: "T-1", requirementId: "REQ-A", title: "REQ-B — AC 9", source: { requirementId: "REQ-A", criterionId: "AC-1" } }),
  ];
  const [link] = buildRequirementTraceability(requirements, testDesigns);
  assert.equal(link.requirementId, "REQ-A");
  assert.equal(link.criterionId, "AC-1");
});

test("RTI-5 adversarial (§35): a misleading objective mentioning another requirement id has no effect", () => {
  const requirements = [req({ id: "REQ-A", content: "c" })];
  const testDesigns = [
    td({ id: "T-1", requirementId: "REQ-A", objective: "Verify that: see also REQ-OTHER for context", source: { requirementId: "REQ-A" } }),
  ];
  const [result] = analyzeRequirementsCoverage(requirements, testDesigns);
  assert.equal(result.requirementId, "REQ-A");
  assert.equal(result.requirementLevelCovered, true);
});

test("RTI-5 adversarial (§36): criterionIndex resolves against the exact snapshot supplied - it is never carried over from a prior snapshot", () => {
  const oldRequirement = req({ id: "REQ-SHIFT", content: "c", acceptanceCriteria: [{ text: "AC0" }, { text: "AC1" }] });
  const oldDesigns = [td({ id: "T-1", requirementId: "REQ-SHIFT", source: { requirementId: "REQ-SHIFT", criterionIndex: 1 } })];
  const oldResult = analyzeRequirementsCoverage([oldRequirement], oldDesigns)[0];
  assert.equal(oldResult.criteria[1].covered, true);

  // New snapshot: a criterion is inserted at position 0 - the SAME
  // TestDesignArtifact (still criterionIndex: 1) now resolves against the
  // NEW array position 1 ("AC1" from the old snapshot has moved to
  // position 2 and is no longer what criterionIndex:1 means).
  const newRequirement = req({ id: "REQ-SHIFT", content: "c", acceptanceCriteria: [{ text: "NEW" }, { text: "AC0" }, { text: "AC1" }] });
  const newResult = analyzeRequirementsCoverage([newRequirement], oldDesigns)[0];
  assert.equal(newResult.criteria[1].covered, true, "resolves against the NEW snapshot's position 1 (\"AC0\"), not the old semantic AC1");
  assert.equal(newResult.criteria[2].covered, false, "the old AC1, now at position 2, is NOT considered covered by the stale index");
});

test("RTI-5 adversarial (§37): criterionId-based resolution is stable across acceptanceCriteria reordering", () => {
  const before = req({ id: "REQ-REORDER", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "one" }, { id: "AC-2", text: "two" }] });
  const after = req({ id: "REQ-REORDER", content: "c", acceptanceCriteria: [{ id: "AC-2", text: "two" }, { id: "AC-1", text: "one" }] });
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-REORDER", source: { requirementId: "REQ-REORDER", criterionId: "AC-2" } })];

  const beforeResult = analyzeRequirementsCoverage([before], testDesigns)[0];
  const afterResult = analyzeRequirementsCoverage([after], testDesigns)[0];

  const beforeAC2 = beforeResult.criteria.find((c) => c.criterionId === "AC-2");
  const afterAC2 = afterResult.criteria.find((c) => c.criterionId === "AC-2");
  assert.equal(beforeAC2.covered, true);
  assert.equal(afterAC2.covered, true, "criterionId resolution must still find AC-2 after reordering");
});

test("RTI-5 adversarial (§38): criterionIndex is resolved purely positionally, never by comparing criterion text", () => {
  const requirement = req({ id: "REQ-POS", content: "c", acceptanceCriteria: [{ text: "alpha" }, { text: "beta" }] });
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-POS", source: { requirementId: "REQ-POS", criterionIndex: 0 } })];
  const result = analyzeRequirementsCoverage([requirement], testDesigns)[0];
  assert.equal(result.criteria[0].covered, true);
  assert.equal(result.criteria[1].covered, false);
});

// --- traceability-first / derivation (§31) ----------------------------------

test("RTI-5 (§31): analyzeRequirementsCoverage's counts are consistent with buildRequirementTraceability's own links for the same input", () => {
  const requirement = req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "a" }, { id: "AC-2", text: "b" }] });
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-1" } })];

  const links = buildRequirementTraceability([requirement], testDesigns);
  const [coverage] = analyzeRequirementsCoverage([requirement], testDesigns);

  assert.equal(links.length, 1);
  assert.equal(coverage.coveredCriteria, links.filter((l) => l.criterionId || l.criterionIndex !== undefined).length);
});

// --- order preservation -----------------------------------------------------

test("RTI-5: requirement, criteria, and test-id order are preserved throughout, no hidden sort", () => {
  const requirements = [
    req({ id: "REQ-B", content: "c", acceptanceCriteria: [{ id: "Z", text: "z" }, { id: "A", text: "a" }] }),
    req({ id: "REQ-A", content: "c" }),
  ];
  const testDesigns = [
    td({ id: "T-2", requirementId: "REQ-B", source: { requirementId: "REQ-B", criterionId: "A" } }),
    td({ id: "T-1", requirementId: "REQ-B", source: { requirementId: "REQ-B", criterionId: "Z" } }),
  ];
  const results = analyzeRequirementsCoverage(requirements, testDesigns);
  assert.deepEqual(results.map((r) => r.requirementId), ["REQ-B", "REQ-A"]);
  assert.deepEqual(results[0].criteria.map((c) => c.criterionId), ["Z", "A"]);

  const links = buildRequirementTraceability(requirements, testDesigns);
  assert.deepEqual(links.map((l) => l.testDesignId), ["T-2", "T-1"]);
});

// --- determinism / immutability / freeze / JSON-safety ----------------------

test("RTI-5: identical input produces byte-identical output on repeated calls (determinism)", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-1" } })];
  const a = analyzeRequirementsCoverage(requirements, testDesigns);
  const b = analyzeRequirementsCoverage(requirements, testDesigns);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test("RTI-5: neither requirements nor testDesigns is mutated", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-1" } })];
  const beforeReq = JSON.stringify(requirements);
  const beforeTd = JSON.stringify(testDesigns);
  analyzeRequirementsCoverage(requirements, testDesigns);
  buildRequirementTraceability(requirements, testDesigns);
  assert.equal(JSON.stringify(requirements), beforeReq);
  assert.equal(JSON.stringify(testDesigns), beforeTd);
});

test("RTI-5: every level of both outputs is frozen", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-1" } })];

  const links = buildRequirementTraceability(requirements, testDesigns);
  assert.ok(Object.isFrozen(links));
  assert.ok(Object.isFrozen(links[0]));

  const results = analyzeRequirementsCoverage(requirements, testDesigns);
  assert.ok(Object.isFrozen(results));
  assert.ok(Object.isFrozen(results[0]));
  assert.ok(Object.isFrozen(results[0].criteria));
  assert.ok(Object.isFrozen(results[0].criteria[0]));
  assert.ok(Object.isFrozen(results[0].criteria[0].testDesignIds));
  assert.ok(Object.isFrozen(results[0].unmappedTestDesignIds));

  const [zeroCritResult] = analyzeRequirementsCoverage([req({ id: "REQ-Z", content: "c" })], []);
  assert.ok(Object.isFrozen(zeroCritResult.requirementLevelTestIds));

  assert.throws(() => {
    "use strict";
    results[0].status = "MUTATED";
  }, TypeError);
});

test("RTI-5: both outputs round-trip through JSON without semantic loss", () => {
  const requirements = [req({ id: "REQ-1", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] })];
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-1", source: { requirementId: "REQ-1", criterionId: "AC-1" } })];
  const links = buildRequirementTraceability(requirements, testDesigns);
  const results = analyzeRequirementsCoverage(requirements, testDesigns);
  assert.deepEqual(JSON.parse(JSON.stringify(links)), links);
  assert.deepEqual(JSON.parse(JSON.stringify(results)), results);
});

// --- source independence ----------------------------------------------------

test("RTI-5: coverage/traceability does not depend on requirement.source.type/location (source independence)", () => {
  const base = { id: "REQ-SRC", type: "requirement", title: "t", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] };
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-SRC", source: { requirementId: "REQ-SRC", criterionId: "AC-1" } })];
  const viaFile = analyzeRequirementsCoverage([{ ...base, source: { type: "file", location: "x.json" } }], testDesigns);
  const viaFuture = analyzeRequirementsCoverage([{ ...base, source: { type: "future-system", location: "y" } }], testDesigns);
  assert.deepEqual(JSON.parse(JSON.stringify(viaFile)), JSON.parse(JSON.stringify(viaFuture)));
});

// --- RTI-3 independence: non-READY requirements are accepted structurally ---

test("RTI-5 (§39): a structurally valid but RTI-3 non-READY requirement (vague content) is still accepted and analyzed purely structurally", () => {
  const requirement = req({ id: "REQ-VAGUE", content: "The API should respond quickly." });
  const testDesigns = [td({ id: "T-1", requirementId: "REQ-VAGUE", source: { requirementId: "REQ-VAGUE" } })];
  const [result] = analyzeRequirementsCoverage([requirement], testDesigns);
  assert.equal(result.status, "FULLY_COVERED");
});
