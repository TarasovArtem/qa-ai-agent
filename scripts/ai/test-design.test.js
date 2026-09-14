"use strict";

/**
 * Roadmap RTI-4 (Test Design Generation): unit coverage for
 * scripts/ai/test-design.js - the deterministic layer that converts an
 * RTI-3 READY RequirementArtifact into generic TestDesignArtifact[].
 * Covers every worked example from the RTI-4 mission itself, the RTI-3
 * READY gate composition, no-invention invariants, determinism, source
 * immutability/independence, collection atomicity, and the duplicate-
 * criterion-id defense.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { generateTestDesign, generateTestDesigns, assertValidTestDesignArtifact } = require("./test-design");

function art(overrides = {}) {
  return {
    id: "REQ-X",
    type: "requirement",
    title: "Example requirement",
    source: { type: "file", location: "requirements.json" },
    ...overrides,
  };
}

// --- worked examples from the mission --------------------------------------

test("RTI-4 worked example (§57): a basic READY content-only requirement generates exactly one test design", () => {
  const designs = generateTestDesign(art({ id: "REQ-1", content: "When valid credentials are supplied, the API returns HTTP 200." }));
  assert.equal(designs.length, 1);
  assert.equal(designs[0].id, "REQ-1::test::1");
  assert.equal(designs[0].requirementId, "REQ-1");
  assert.equal(designs[0].objective, "Verify that: When valid credentials are supplied, the API returns HTTP 200.");
  assert.deepEqual(designs[0].expectedResults, ["When valid credentials are supplied, the API returns HTTP 200."]);
  assert.deepEqual(designs[0].source, { requirementId: "REQ-1" });
});

test("RTI-4 worked example (§58): a requirement with structured acceptance criteria generates one design per criterion, traced by id", () => {
  const designs = generateTestDesign(
    art({
      id: "REQ-2",
      content: "The search service must meet defined behavior.",
      acceptanceCriteria: [
        { id: "AC-1", text: "When query is valid, matching results are returned." },
        { id: "AC-2", text: "95% of searches complete within 2 seconds." },
      ],
    })
  );
  assert.equal(designs.length, 2);
  assert.equal(designs[0].id, "REQ-2::test::1");
  assert.equal(designs[0].source.criterionId, "AC-1");
  assert.equal(designs[1].id, "REQ-2::test::2");
  assert.equal(designs[1].source.criterionId, "AC-2");
});

test("RTI-4 worked example (§59): acceptance criteria without ids are traced by criterionIndex, never a fabricated id", () => {
  const designs = generateTestDesign(
    art({ id: "REQ-3", content: "c", acceptanceCriteria: [{ text: "AC text one" }, { text: "AC text two" }] })
  );
  assert.equal(designs[0].source.criterionIndex, 0);
  assert.equal("criterionId" in designs[0].source, false);
  assert.equal(designs[1].source.criterionIndex, 1);
});

test("RTI-4 worked example (§61): a scalability claim RTI-3 marks AMBIGUOUS refuses generation", () => {
  const artifact = art({ id: "REQ-SCALE", content: "The system should be scalable.", acceptanceCriteria: [{ text: "99.9% uptime." }] });
  assert.throws(() => generateTestDesign(artifact), /TEST_DESIGN_REQUIREMENT_NOT_READY/);
});

test("RTI-4 worked example (§62): an unrelated HTTP-status signal that leaves a performance claim AMBIGUOUS refuses generation", () => {
  const artifact = art({ id: "REQ-PERF", content: "The API should respond quickly.", acceptanceCriteria: [{ text: "Return HTTP 200." }] });
  assert.throws(() => generateTestDesign(artifact), /TEST_DESIGN_REQUIREMENT_NOT_READY/);
});

test("RTI-4 worked example (§63): a related duration threshold makes the requirement READY and generation succeeds, preserving the explicit threshold only", () => {
  const designs = generateTestDesign(
    art({ id: "REQ-PERF2", content: "The API should respond quickly.", acceptanceCriteria: [{ text: "95% of responses complete within 2 seconds." }] })
  );
  assert.equal(designs.length, 1);
  assert.match(designs[0].objective, /95% of responses complete within 2 seconds\./);
  assert.equal(/\b(1 second|500 ?ms|3 seconds)\b/i.test(JSON.stringify(designs)), false, "must never invent an additional threshold");
});

test("RTI-4 worked example (§64): an explicit placeholder refuses generation", () => {
  assert.throws(() => generateTestDesign(art({ id: "REQ-TBD", content: "Timeout must be TBD." })), /TEST_DESIGN_REQUIREMENT_NOT_READY/);
});

test("RTI-4 worked example (§65): a subjective claim refuses generation", () => {
  assert.throws(() => generateTestDesign(art({ id: "REQ-SUBJ", content: "The UI should be intuitive." })), /TEST_DESIGN_REQUIREMENT_NOT_READY/);
});

// --- no-invention invariants (§66-69) ---------------------------------------

test("RTI-4 no-invention (§66): a positive-path token requirement never generates an invented negative-path variant", () => {
  const [design] = generateTestDesign(art({ id: "REQ-TOKEN", content: "Valid token returns HTTP 200." }));
  const serialized = JSON.stringify(design).toLowerCase();
  for (const invented of ["401", "403", "expired", "missing", "invalid"]) {
    assert.equal(serialized.includes(invented), false, `must not invent "${invented}"`);
  }
});

test("RTI-4 no-invention (§67): a status-display requirement never invents domain status values", () => {
  const [design] = generateTestDesign(art({ id: "REQ-ORDER", content: "Order status is displayed." }));
  const serialized = JSON.stringify(design).toLowerCase();
  for (const invented of ["pending", "shipped", "cancelled", "completed"]) {
    assert.equal(serialized.includes(invented), false, `must not invent status "${invented}"`);
  }
});

test("RTI-4 no-invention (§68): an actor-free requirement never invents an actor/role", () => {
  const [design] = generateTestDesign(art({ id: "REQ-CSV", content: "Report can be exported as CSV." }));
  const serialized = JSON.stringify(design).toLowerCase();
  for (const invented of ["admin", "manager", "guest"]) {
    assert.equal(serialized.includes(invented), false, `must not invent actor "${invented}"`);
  }
});

test("RTI-4 no-invention (§69): a requirement with no explicit UI mention never invents UI procedure", () => {
  const [design] = generateTestDesign(art({ id: "REQ-CSV2", content: "Report can be exported as CSV." }));
  const serialized = JSON.stringify(design).toLowerCase();
  for (const invented of ["button", "menu", "dialog", "click", "download icon"]) {
    assert.equal(serialized.includes(invented), false, `must not invent UI element "${invented}"`);
  }
});

test("RTI-4 no-invention: output contract never contains steps/preconditions/testType/priority fields (none exist without a legitimate source)", () => {
  const [design] = generateTestDesign(art({ id: "REQ-SHAPE", content: "c" }));
  assert.deepEqual(Object.keys(design).sort(), ["expectedResults", "id", "objective", "requirementId", "source", "title"]);
});

// --- non-READY rejection matrix ---------------------------------------------

test("RTI-4 non-READY rejection matrix: PARTIALLY_TESTABLE refuses generation", () => {
  const artifact = art({
    id: "REQ-PARTIAL",
    content: "When valid credentials are supplied, return HTTP 200.",
    acceptanceCriteria: [{ text: "Response must include user id." }, { text: "Response should be fast." }],
  });
  assert.throws(() => generateTestDesign(artifact), /TEST_DESIGN_REQUIREMENT_NOT_READY/);
});

test("RTI-4 non-READY rejection matrix: AMBIGUOUS refuses generation", () => {
  assert.throws(() => generateTestDesign(art({ id: "REQ-AMBIG", content: "The search results should load quickly." })), /TEST_DESIGN_REQUIREMENT_NOT_READY/);
});

test("RTI-4 non-READY rejection matrix: MISSING_INFORMATION refuses generation", () => {
  assert.throws(() => generateTestDesign(art({ id: "REQ-MISSING", content: "The timeout must be TBD." })), /TEST_DESIGN_REQUIREMENT_NOT_READY/);
});

test("RTI-4 non-READY rejection matrix: UNTESTABLE refuses generation", () => {
  assert.throws(() => generateTestDesign(art({ id: "REQ-UNTESTABLE", content: "The product should delight users." })), /TEST_DESIGN_REQUIREMENT_NOT_READY/);
});

test("RTI-4 non-READY rejection: error message includes artifactId and quality status, no generated remediation", () => {
  try {
    generateTestDesign(art({ id: "REQ-ERRSHAPE", content: "The system should be scalable." }));
    assert.fail("expected throw");
  } catch (err) {
    assert.match(err.message, /REQ-ERRSHAPE/);
    assert.match(err.message, /AMBIGUOUS/);
    assert.equal(/should be|try|consider|recommend/i.test(err.message), false, "must not contain invented remediation advice");
  }
});

// --- collection API ----------------------------------------------------------

test("generateTestDesigns: preserves input order, concatenated flat", () => {
  const results = generateTestDesigns([
    art({ id: "REQ-C", content: "Return HTTP 200." }),
    art({ id: "REQ-A", content: "Return HTTP 201." }),
    art({ id: "REQ-B", content: "Return HTTP 202." }),
  ]);
  assert.deepEqual(results.map((r) => r.requirementId), ["REQ-C", "REQ-A", "REQ-B"]);
});

test("generateTestDesigns: is atomic - one non-READY artifact fails the whole call, never a partial result", () => {
  const artifacts = [
    art({ id: "REQ-1", content: "Return HTTP 200." }),
    art({ id: "REQ-2", content: "The system should be scalable.", acceptanceCriteria: [{ text: "99.9% uptime." }] }),
    art({ id: "REQ-3", content: "Return HTTP 204." }),
  ];
  assert.throws(() => generateTestDesigns(artifacts), /TEST_DESIGN_REQUIREMENT_NOT_READY.*REQ-2/s);
});

test("generateTestDesigns: rejects a non-array input", () => {
  assert.throws(() => generateTestDesigns({}), /TEST_DESIGN_INPUT_INVALID/);
});

test("generateTestDesigns: rejects undefined/null", () => {
  assert.throws(() => generateTestDesigns(undefined), /TEST_DESIGN_INPUT_REQUIRED/);
  assert.throws(() => generateTestDesigns(null), /TEST_DESIGN_INPUT_REQUIRED/);
});

test("generateTestDesigns: rejects an invalid item, referencing its index", () => {
  const artifacts = [art({ id: "REQ-OK", content: "Return HTTP 200." }), { id: "bad-only" }];
  assert.throws(() => generateTestDesigns(artifacts), /TEST_DESIGN_INPUT_INVALID.*artifacts\[1\]/s);
});

test("generateTestDesigns: rejects duplicate requirement ids, no silent overwrite", () => {
  const artifacts = [art({ id: "DUP", content: "c1" }), art({ id: "DUP", content: "c2" })];
  assert.throws(() => generateTestDesigns(artifacts), /TEST_DESIGN_COLLECTION_INVALID/);
});

test("generateTestDesigns: an empty array is accepted and returns an empty result array", () => {
  assert.deepEqual(generateTestDesigns([]), []);
});

test("generateTestDesigns: cross-artifact isolation - one precise requirement never supplies missing semantics to another", () => {
  const artifacts = [art({ id: "REQ-VAGUE", content: "The API should respond quickly." }), art({ id: "REQ-PRECISE", content: "Response time is 2 seconds." })];
  assert.throws(() => generateTestDesigns(artifacts), /TEST_DESIGN_REQUIREMENT_NOT_READY.*REQ-VAGUE/s);
});

// --- duplicate criterion id defense ------------------------------------------

test("RTI-4 duplicate criterion id defense: two acceptanceCriteria sharing the same id fails closed, not ambiguous traceability", () => {
  const artifact = art({
    id: "REQ-DUPAC",
    content: "c",
    acceptanceCriteria: [
      { id: "AC-1", text: "first" },
      { id: "AC-1", text: "second" },
    ],
  });
  assert.throws(() => generateTestDesign(artifact), /TEST_DESIGN_GENERATION_FAILED.*AC-1/s);
});

test("RTI-4 duplicate criterion id defense: distinct criterion ids within one artifact generate normally", () => {
  const designs = generateTestDesign(
    art({ id: "REQ-OK-IDS", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "first" }, { id: "AC-2", text: "second" }] })
  );
  assert.equal(designs.length, 2);
});

test("RTI-4 duplicate criterion id defense: the same criterion id across DIFFERENT artifacts is fine (never cross-artifact ambiguity)", () => {
  const results = generateTestDesigns([
    art({ id: "REQ-A", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "a" }] }),
    art({ id: "REQ-B", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "b" }] }),
  ]);
  assert.equal(results.length, 2);
});

// --- determinism / immutability / source independence -----------------------

test("RTI-4 determinism (§73): repeated generation on the same artifact yields deep-equal output, stable ids and order", () => {
  const input = art({ id: "REQ-DET", content: "c", acceptanceCriteria: [{ text: "t1" }, { text: "t2" }] });
  const first = generateTestDesign(input);
  const second = generateTestDesign(input);
  assert.deepEqual(first, second);
});

test("RTI-4 immutability: the input RequirementArtifact is never mutated by generation", () => {
  const input = art({ id: "REQ-IMMUT", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] });
  const before = JSON.parse(JSON.stringify(input));
  generateTestDesign(input);
  assert.deepEqual(input, before);
});

test("RTI-4 result model: top-level design, expectedResults array, and source object are all frozen", () => {
  const [design] = generateTestDesign(art({ id: "REQ-FREEZE", content: "c" }));
  assert.equal(Object.isFrozen(design), true);
  assert.equal(Object.isFrozen(design.expectedResults), true);
  assert.equal(Object.isFrozen(design.source), true);
});

test("RTI-4 result model: result is JSON-serializable and round-trips cleanly", () => {
  const designs = generateTestDesign(art({ id: "REQ-JSON", content: "c", acceptanceCriteria: [{ id: "AC-1", text: "t" }] }));
  const roundTripped = JSON.parse(JSON.stringify(designs));
  assert.deepEqual(roundTripped, JSON.parse(JSON.stringify(designs)));
});

test("RTI-4 source independence (§75): identical requirement semantics differing only in source.type produce deep-equal test designs", () => {
  const base = { id: "REQ-SRC-EQ", type: "requirement", title: "t", content: "Return HTTP 200." };
  const viaFile = generateTestDesign({ ...base, source: { type: "file", location: "a.json" } });
  const viaOther = generateTestDesign({ ...base, source: { type: "totally-different-source-kind", location: "b" } });
  assert.deepEqual(JSON.parse(JSON.stringify(viaFile)), JSON.parse(JSON.stringify(viaOther)));
});

test("RTI-4 test id stability (§74): generated ids/design content stay stable across differing source.location", () => {
  const base = { id: "REQ-LOC-EQ", type: "requirement", title: "t", content: "Return HTTP 200." };
  const a = generateTestDesign({ ...base, source: { type: "file", location: "a/b/c.json" } });
  const b = generateTestDesign({ ...base, source: { type: "file", location: "totally/different/path.json" } });
  assert.equal(a[0].id, b[0].id);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

// --- input safety / hostile getter -------------------------------------------

test("RTI-4 input safety: RTI-1 validation runs before any generation-relevant property access - a hostile getter is never invoked", () => {
  let getterCalls = 0;
  const hostile = {
    id: "REQ-1",
    type: "requirement",
    title: "t",
    source: { type: "file", location: "x.json" },
    get content() {
      getterCalls++;
      return "c";
    },
  };
  assert.throws(() => generateTestDesign(hostile), /REQUIREMENT_ARTIFACT_INVALID/);
  assert.equal(getterCalls, 0, "the hostile getter must never be invoked - RTI-1 rejects it before any read");
});

test("RTI-4 input safety: undefined/null artifact fails closed via RTI-1's own REQUIREMENT_ARTIFACT_REQUIRED", () => {
  assert.throws(() => generateTestDesign(undefined), /REQUIREMENT_ARTIFACT_REQUIRED/);
  assert.throws(() => generateTestDesign(null), /REQUIREMENT_ARTIFACT_REQUIRED/);
});

test("RTI-4 input safety: a structurally invalid artifact fails closed via RTI-1's own REQUIREMENT_ARTIFACT_INVALID, never silently generated", () => {
  assert.throws(() => generateTestDesign({ id: "R1" }), /REQUIREMENT_ARTIFACT_INVALID/);
});

// --- ID strategy --------------------------------------------------------------

test("RTI-4 ID strategy: deterministic requirementId::test::ordinal shape, never random/time-based", () => {
  const designs = generateTestDesign(
    art({ id: "REQ-77", content: "c", acceptanceCriteria: [{ text: "a" }, { text: "b" }, { text: "c" }] })
  );
  assert.deepEqual(designs.map((d) => d.id), ["REQ-77::test::1", "REQ-77::test::2", "REQ-77::test::3"]);
});

test("RTI-4 ID strategy: test ids remain collision-free across a collection (namespaced by unique requirementId)", () => {
  const results = generateTestDesigns([
    art({ id: "REQ-1", content: "c", acceptanceCriteria: [{ text: "a" }, { text: "b" }] }),
    art({ id: "REQ-2", content: "c", acceptanceCriteria: [{ text: "a" }, { text: "b" }] }),
  ]);
  const ids = results.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

// --- type / metadata / priority / labels independence ------------------------

test("RTI-4 type independence: generation applies uniformly across artifact types", () => {
  for (const type of ["requirement", "user-story", "non-functional-requirement", "api-contract", "bug"]) {
    const designs = generateTestDesign(art({ id: `REQ-TYPE-${type}`, type, content: "Return HTTP 200." }));
    assert.equal(designs.length, 1);
  }
});

test("RTI-4 does not use metadata/labels/priority as generation authority", () => {
  const a = generateTestDesign(art({ id: "REQ-META", content: "Return HTTP 200.", metadata: { a: 1 }, labels: ["x"], priority: "high" }));
  const b = generateTestDesign(art({ id: "REQ-META", content: "Return HTTP 200.", metadata: { totallyDifferent: true }, labels: ["y", "z"], priority: "low" }));
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

// --- error model / bounded detail --------------------------------------------

test("RTI-4 error model: error messages are bounded and do not dump entire artifact content", () => {
  const artifacts = [{ id: "bad" }];
  try {
    generateTestDesigns(artifacts);
    assert.fail("expected throw");
  } catch (err) {
    assert.equal(err.message.length < 2000, true);
  }
});

// --- RTI-8 activation: assertValidTestDesignArtifact ------------------------

function validTestDesign(overrides = {}) {
  return {
    id: "REQ-X::test::1",
    requirementId: "REQ-X",
    title: "Example requirement — AC 1",
    objective: "Verify that: something happens.",
    expectedResults: ["something happens."],
    source: { requirementId: "REQ-X", criterionId: "AC1" },
    ...overrides,
  };
}

test("RTI-8: assertValidTestDesignArtifact accepts a real generateTestDesign() output unchanged", () => {
  const [design] = generateTestDesign(art({ id: "REQ-V1", content: "Return HTTP 200." }));
  assert.equal(assertValidTestDesignArtifact(design, "test"), design);
});

test("RTI-8: assertValidTestDesignArtifact accepts every design in a full acceptanceCriteria batch, including the max-length worst case", () => {
  const longTitle = "T".repeat(200);
  const longText = "X".repeat(20000);
  const criteria = Array.from({ length: 200 }, (_, i) => ({ id: `AC${i}`, text: longText }));
  const requirement = art({ id: "R".repeat(190), title: longTitle, acceptanceCriteria: criteria });
  const designs = generateTestDesigns([requirement]);
  assert.equal(designs.length, 200);
  for (const design of designs) assertValidTestDesignArtifact(design, "test");
});

test("RTI-8: assertValidTestDesignArtifact accepts a manually-constructed canonical artifact (content-only shape, no criterionId/criterionIndex)", () => {
  const design = validTestDesign({ source: { requirementId: "REQ-X" } });
  assert.equal(assertValidTestDesignArtifact(design, "test"), design);
});

test("RTI-8: assertValidTestDesignArtifact accepts criterionId-only", () => {
  assertValidTestDesignArtifact(validTestDesign({ source: { requirementId: "REQ-X", criterionId: "AC1" } }), "test");
});

test("RTI-8: assertValidTestDesignArtifact accepts criterionIndex-only", () => {
  assertValidTestDesignArtifact(validTestDesign({ source: { requirementId: "REQ-X", criterionIndex: 0 } }), "test");
});

test("RTI-8: assertValidTestDesignArtifact rejects undefined/null with TEST_DESIGN_ARTIFACT_REQUIRED", () => {
  for (const bad of [undefined, null]) {
    assert.throws(() => assertValidTestDesignArtifact(bad, "test"), /TEST_DESIGN_ARTIFACT_REQUIRED:/);
  }
});

test("RTI-8: assertValidTestDesignArtifact rejects missing/empty id", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ id: undefined }), "test"), /TEST_DESIGN_ARTIFACT_INVALID/);
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ id: "" }), "test"), /TEST_DESIGN_ARTIFACT_INVALID/);
});

test("RTI-8: assertValidTestDesignArtifact rejects an unknown top-level key", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ bogus: 1 }), "test"), /unknown key "bogus"/);
});

test("RTI-8: assertValidTestDesignArtifact rejects missing requirementId", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ requirementId: undefined }), "test"), /TEST_DESIGN_ARTIFACT_INVALID/);
});

test("RTI-8: assertValidTestDesignArtifact rejects source.requirementId !== requirementId", () => {
  assert.throws(
    () => assertValidTestDesignArtifact(validTestDesign({ requirementId: "REQ-X", source: { requirementId: "REQ-OTHER" } }), "test"),
    /source\.requirementId: must equal/
  );
});

test("RTI-8: assertValidTestDesignArtifact rejects missing title", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ title: undefined }), "test"), /TEST_DESIGN_ARTIFACT_INVALID/);
});

test("RTI-8: assertValidTestDesignArtifact rejects missing objective", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ objective: undefined }), "test"), /TEST_DESIGN_ARTIFACT_INVALID/);
});

test("RTI-8: assertValidTestDesignArtifact rejects empty expectedResults", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ expectedResults: [] }), "test"), /expectedResults/);
});

test("RTI-8: assertValidTestDesignArtifact rejects non-array expectedResults", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ expectedResults: "not an array" }), "test"), /expectedResults/);
});

test("RTI-8: assertValidTestDesignArtifact rejects an invalid expectedResults element", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ expectedResults: ["ok", ""] }), "test"), /expectedResults/);
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ expectedResults: ["ok", 42] }), "test"), /expectedResults/);
});

test("RTI-8: assertValidTestDesignArtifact rejects missing source", () => {
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ source: undefined }), "test"), /TEST_DESIGN_ARTIFACT_INVALID/);
});

test("RTI-8: assertValidTestDesignArtifact rejects an unknown source key", () => {
  assert.throws(
    () => assertValidTestDesignArtifact(validTestDesign({ source: { requirementId: "REQ-X", bogus: 1 } }), "test"),
    /source\.bogus: unknown key/
  );
});

test("RTI-8: assertValidTestDesignArtifact rejects an empty criterionId", () => {
  assert.throws(
    () => assertValidTestDesignArtifact(validTestDesign({ source: { requirementId: "REQ-X", criterionId: "" } }), "test"),
    /source\.criterionId/
  );
});

test("RTI-8: assertValidTestDesignArtifact rejects a negative criterionIndex", () => {
  assert.throws(
    () => assertValidTestDesignArtifact(validTestDesign({ source: { requirementId: "REQ-X", criterionIndex: -1 } }), "test"),
    /source\.criterionIndex/
  );
});

test("RTI-8: assertValidTestDesignArtifact rejects a non-integer criterionIndex", () => {
  assert.throws(
    () => assertValidTestDesignArtifact(validTestDesign({ source: { requirementId: "REQ-X", criterionIndex: 1.5 } }), "test"),
    /source\.criterionIndex/
  );
});

test("RTI-8: assertValidTestDesignArtifact rejects criterionId AND criterionIndex both present (ambiguous - the generator never emits both)", () => {
  assert.throws(
    () => assertValidTestDesignArtifact(validTestDesign({ source: { requirementId: "REQ-X", criterionId: "AC1", criterionIndex: 0 } }), "test"),
    /criterionId and criterionIndex must not both be present/
  );
});

test("RTI-8: assertValidTestDesignArtifact never invokes an accessor getter on untrusted input", () => {
  let getterCalled = false;
  const hostileSource = { requirementId: "REQ-X" };
  Object.defineProperty(hostileSource, "criterionId", {
    get() {
      getterCalled = true;
      return "x";
    },
    enumerable: true,
  });
  assert.throws(() => assertValidTestDesignArtifact(validTestDesign({ source: hostileSource }), "test"), /TEST_DESIGN_ARTIFACT_INVALID/);
  assert.equal(getterCalled, false);
});

test("RTI-8: assertValidTestDesignArtifact is not fooled by a value inherited from a polluted Object.prototype", () => {
  const sentinelKey = "__td_validator_sentinel__";
  Object.defineProperty(Object.prototype, sentinelKey, { value: "x", enumerable: true, configurable: true });
  try {
    const design = validTestDesign();
    assert.equal(sentinelKey in design, true);
    assert.equal(Object.keys(design).includes(sentinelKey), false);
    assert.equal(assertValidTestDesignArtifact(design, "test"), design);
  } finally {
    delete Object.prototype[sentinelKey];
  }
});

test("RTI-8: assertValidTestDesignArtifact does not mutate the artifact", () => {
  const design = validTestDesign();
  const before = JSON.stringify(design);
  assertValidTestDesignArtifact(design, "test");
  assert.equal(JSON.stringify(design), before);
});
