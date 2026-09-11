"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateRequirementArtifact,
  assertValidRequirementArtifact,
  ARTIFACT_TYPES,
  RELATIONSHIP_TYPES,
} = require("./requirement-artifact");

// Roadmap RTI-1: generic core contract - synthetic values only, no real
// external requirement source import (Jira/Xray/TestRail/Azure DevOps/etc
// are never referenced anywhere in this file).

function minimalArtifact(overrides = {}) {
  return {
    id: "REQ-001",
    type: "requirement",
    title: "Users can reset their password",
    content: "A user who has forgotten their password can request a reset link by email.",
    source: { type: "file", location: "requirements.md" },
    ...overrides,
  };
}

// --- valid shapes ------------------------------------------------------

test("validateRequirementArtifact: accepts a minimal valid artifact", () => {
  const { valid, errors } = validateRequirementArtifact(minimalArtifact());
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateRequirementArtifact: accepts a full artifact using every optional field", () => {
  const artifact = minimalArtifact({
    acceptanceCriteria: [
      { id: "AC-1", text: "Given a registered email, a reset link is sent within 60 seconds." },
      { text: "The reset link expires after 24 hours." },
    ],
    priority: "P1",
    labels: ["auth", "self-service"],
    relationships: [
      { type: "parent", targetId: "EPIC-9" },
      { type: "implements", targetId: "REQ-000" },
    ],
    contentHash: "sha256:abc123",
    metadata: { jiraProject: "AUTH", nested: { arbitrary: [1, 2, "three"] } },
  });
  const { valid, errors } = validateRequirementArtifact(artifact);
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateRequirementArtifact: accepts an artifact with acceptanceCriteria but no content", () => {
  const { valid } = validateRequirementArtifact(
    minimalArtifact({ content: undefined, acceptanceCriteria: [{ text: "Only acceptance criteria, no free-text content." }] })
  );
  assert.equal(valid, true);
});

test("validateRequirementArtifact: two semantically different artifact types validate through the identical, source-agnostic path", () => {
  const userStory = minimalArtifact({ id: "US-1", type: "user-story" });
  const businessRule = minimalArtifact({ id: "BR-1", type: "business-rule", source: { type: "jira", sourceId: "PROJ-142", system: "Jira" } });
  assert.equal(validateRequirementArtifact(userStory).valid, true);
  assert.equal(validateRequirementArtifact(businessRule).valid, true);
});

test("ARTIFACT_TYPES: every declared type independently validates", () => {
  for (const type of ARTIFACT_TYPES) {
    const { valid, errors } = validateRequirementArtifact(minimalArtifact({ type }));
    assert.equal(valid, true, `type "${type}" should be valid: ${errors.join("; ")}`);
  }
});

test("validateRequirementArtifact: does not mutate a frozen valid input", () => {
  const frozen = Object.freeze(minimalArtifact());
  const { valid } = validateRequirementArtifact(frozen);
  assert.equal(valid, true);
});

// --- required fields -----------------------------------------------------

test("validateRequirementArtifact: rejects null/non-object input without throwing", () => {
  assert.equal(validateRequirementArtifact(null).valid, false);
  assert.equal(validateRequirementArtifact(undefined).valid, false);
  assert.equal(validateRequirementArtifact("REQ-001").valid, false);
  assert.equal(validateRequirementArtifact([]).valid, false);
  assert.equal(validateRequirementArtifact(() => {}).valid, false);
});

test("validateRequirementArtifact: rejects a missing id", () => {
  const artifact = minimalArtifact();
  delete artifact.id;
  const { valid, errors } = validateRequirementArtifact(artifact);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes(".id")));
});

test("validateRequirementArtifact: rejects an empty-string id", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ id: "" })).valid, false);
});

test("validateRequirementArtifact: rejects a missing type", () => {
  const artifact = minimalArtifact();
  delete artifact.type;
  assert.equal(validateRequirementArtifact(artifact).valid, false);
});

test("validateRequirementArtifact: rejects an unrecognized type (fails closed, never free text)", () => {
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ type: "epic" }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes(".type")));
});

test("validateRequirementArtifact: rejects a missing title", () => {
  const artifact = minimalArtifact();
  delete artifact.title;
  assert.equal(validateRequirementArtifact(artifact).valid, false);
});

test("validateRequirementArtifact: rejects an artifact with neither content nor acceptanceCriteria", () => {
  const artifact = minimalArtifact();
  delete artifact.content;
  const { valid, errors } = validateRequirementArtifact(artifact);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("at least one of content")));
});

test("validateRequirementArtifact: rejects an empty-string content", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ content: "" })).valid, false);
});

test("validateRequirementArtifact: rejects a missing source", () => {
  const artifact = minimalArtifact();
  delete artifact.source;
  const { valid, errors } = validateRequirementArtifact(artifact);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes(".source")));
});

test("validateRequirementArtifact: rejects a source missing its own required type", () => {
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ source: { location: "requirements.md" } }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("source.type")));
});

test("validateRequirementArtifact: rejects an unknown source key", () => {
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ source: { type: "file", credential: "token-x" } }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("source.credential")));
});

test("validateRequirementArtifact: rejects a non-object source", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ source: "file" })).valid, false);
});

// --- acceptanceCriteria ---------------------------------------------------

test("validateRequirementArtifact: rejects an empty acceptanceCriteria array", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: [] })).valid, false);
});

test("validateRequirementArtifact: rejects an acceptanceCriteria entry missing text", () => {
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: [{ id: "AC-1" }] }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("acceptanceCriteria[0].text")));
});

test("validateRequirementArtifact: rejects an acceptanceCriteria entry with an unknown key", () => {
  const { valid, errors } = validateRequirementArtifact(
    minimalArtifact({ acceptanceCriteria: [{ text: "ok", extra: "x" }] })
  );
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("acceptanceCriteria[0]")));
});

test("validateRequirementArtifact: rejects a non-array acceptanceCriteria", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: "text" })).valid, false);
});

// --- relationships ---------------------------------------------------------

test("validateRequirementArtifact: accepts a relationships entry for every declared relationship type", () => {
  for (const type of RELATIONSHIP_TYPES) {
    const { valid, errors } = validateRequirementArtifact(
      minimalArtifact({ relationships: [{ type, targetId: "REQ-999" }] })
    );
    assert.equal(valid, true, `relationship type "${type}" should be valid: ${errors.join("; ")}`);
  }
});

test("validateRequirementArtifact: rejects an unrecognized relationship type", () => {
  assert.equal(
    validateRequirementArtifact(minimalArtifact({ relationships: [{ type: "linked-to", targetId: "REQ-999" }] })).valid,
    false
  );
});

test("validateRequirementArtifact: rejects a relationship missing targetId", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ relationships: [{ type: "related" }] })).valid, false);
});

test("validateRequirementArtifact: relationships targetId is validated only for shape, never resolved against a real artifact", () => {
  // No collection of artifacts exists anywhere in this call - a
  // non-existent targetId is still structurally valid (see this module's
  // own docstring: relationship-target resolution is a deferred RTI-2+
  // collection-level concern, never this single-artifact validator's job).
  const { valid } = validateRequirementArtifact(
    minimalArtifact({ relationships: [{ type: "related", targetId: "REQ-DOES-NOT-EXIST-ANYWHERE" }] })
  );
  assert.equal(valid, true);
});

// --- RTI1-R-*: nested acceptanceCriteria[]/relationships[] hardening -------
//
// Permanent regression coverage for the independent-review finding that
// the original lighter (isPlainObject() + direct field access) nested
// validation permitted getter execution, an uncaught exception escaping
// validateRequirementArtifact() entirely, and silent acceptance of
// inherited/non-enumerable/class-instance entries - exactly mirroring the
// FPI1-R-1/R-5/R-6 test classes already established for the outer
// artifact/source above, now applied to the nested entry objects too.

// --- RTI1-R-1: prototype / class-instance hardening (nested) ---------------

test("RTI1-R-1: an acceptanceCriteria entry that is a class instance (custom prototype) is REJECTED", () => {
  class HostileCriterion {
    constructor() {
      this.text = "looks legitimate";
    }
  }
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: [new HostileCriterion()] }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("acceptanceCriteria[0]")));
});

test("RTI1-R-1: a relationships entry that is a class instance (custom prototype) is REJECTED", () => {
  class HostileRelationship {
    constructor() {
      this.type = "related";
      this.targetId = "REQ-2";
    }
  }
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ relationships: [new HostileRelationship()] }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("relationships[0]")));
});

test("RTI1-R-1: an acceptanceCriteria/relationships entry whose prototype is itself another object is REJECTED, inherited fields never consulted", () => {
  const inheritedCriterion = Object.create({ text: "inherited, not own" });
  const inheritedRelationship = Object.create({ type: "related", targetId: "REQ-2" });
  assert.equal(validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: [inheritedCriterion] })).valid, false);
  assert.equal(validateRequirementArtifact(minimalArtifact({ relationships: [inheritedRelationship] })).valid, false);
});

test("RTI1-R-1: Object.create(null) acceptanceCriteria/relationships entries with all required own fields are ACCEPTED (null-prototype plain data)", () => {
  const criterion = Object.assign(Object.create(null), { text: "ok" });
  const relationship = Object.assign(Object.create(null), { type: "related", targetId: "REQ-2" });
  assert.equal(Object.getPrototypeOf(criterion), null);
  assert.equal(Object.getPrototypeOf(relationship), null);
  assert.equal(validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: [criterion] })).valid, true);
  assert.equal(validateRequirementArtifact(minimalArtifact({ relationships: [relationship] })).valid, true);
});

// --- RTI1-R-5: non-enumerable own fields (nested) ---------------------------

test("RTI1-R-5: a non-enumerable own acceptanceCriteria[].text is REJECTED as present-but-invalid, never silently treated as absent", () => {
  const criterion = {};
  Object.defineProperty(criterion, "text", { value: "hidden", enumerable: false, writable: true, configurable: true });
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: [criterion] }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("acceptanceCriteria[0].text")));
});

test("RTI1-R-5: a non-enumerable own relationships[].targetId is REJECTED as present-but-invalid, never silently treated as absent", () => {
  const relationship = { type: "related" };
  Object.defineProperty(relationship, "targetId", { value: "REQ-2", enumerable: false, writable: true, configurable: true });
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ relationships: [relationship] }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("relationships[0].targetId")));
});

test("RTI1-R-5: a non-enumerable unknown key on a nested entry can never smuggle a hidden value into a required field slot", () => {
  const criterion = { text: "real, legitimate text" };
  Object.defineProperty(criterion, "hiddenPayload", { value: "invisible to Object.keys", enumerable: false, configurable: true });
  const { valid } = validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: [criterion] }));
  // The visible, own-enumerable "text" is genuinely valid, so this must
  // pass - the point of this test is only that the hidden key is provably
  // never read/trusted as data (see the getter tests below for the
  // stronger, execution-based proof).
  assert.equal(valid, true);
});

// --- RTI1-R-6: accessor-backed nested fields never execute ------------------

test("RTI1-R-6: a stable accessor-backed acceptanceCriteria[].text is REJECTED and its getter is NEVER invoked", () => {
  let calls = 0;
  const criterion = {};
  Object.defineProperty(criterion, "text", {
    get() {
      calls += 1;
      return "hostile getter value";
    },
    enumerable: true,
    configurable: true,
  });
  const { valid } = validateRequirementArtifact(minimalArtifact({ acceptanceCriteria: [criterion] }));
  assert.equal(valid, false);
  assert.equal(calls, 0, "the acceptanceCriteria[].text getter must never be invoked during validation");
});

test("RTI1-R-6: a throwing accessor-backed acceptanceCriteria[].text never escapes validateRequirementArtifact()", () => {
  const criterion = {};
  Object.defineProperty(criterion, "text", {
    get() {
      throw new Error("HOSTILE");
    },
    enumerable: true,
    configurable: true,
  });
  const artifact = minimalArtifact({ acceptanceCriteria: [criterion] });
  assert.doesNotThrow(() => validateRequirementArtifact(artifact));
  assert.equal(validateRequirementArtifact(artifact).valid, false);
});

test("RTI1-R-6: a stable accessor-backed relationships[].targetId is REJECTED and its getter is NEVER invoked", () => {
  let calls = 0;
  const relationship = { type: "related" };
  Object.defineProperty(relationship, "targetId", {
    get() {
      calls += 1;
      return "REQ-2";
    },
    enumerable: true,
    configurable: true,
  });
  const { valid } = validateRequirementArtifact(minimalArtifact({ relationships: [relationship] }));
  assert.equal(valid, false);
  assert.equal(calls, 0, "the relationships[].targetId getter must never be invoked during validation");
});

test("RTI1-R-6: a throwing accessor-backed relationships[].targetId never escapes validateRequirementArtifact() (was: uncaught exception)", () => {
  const relationship = { type: "related" };
  Object.defineProperty(relationship, "targetId", {
    get() {
      throw new Error("HOSTILE");
    },
    enumerable: true,
    configurable: true,
  });
  const artifact = minimalArtifact({ relationships: [relationship] });
  assert.doesNotThrow(() => validateRequirementArtifact(artifact));
  assert.equal(validateRequirementArtifact(artifact).valid, false);
});

test("RTI1-R-6: a throwing accessor-backed relationships[].type never escapes validateRequirementArtifact()", () => {
  const relationship = { targetId: "REQ-2" };
  Object.defineProperty(relationship, "type", {
    get() {
      throw new Error("HOSTILE");
    },
    enumerable: true,
    configurable: true,
  });
  const artifact = minimalArtifact({ relationships: [relationship] });
  assert.doesNotThrow(() => validateRequirementArtifact(artifact));
  assert.equal(validateRequirementArtifact(artifact).valid, false);
});

test("RTI1-R-6: assertValidRequirementArtifact() with a throwing nested accessor produces the stable REQUIREMENT_ARTIFACT_INVALID error, never the raw getter exception", () => {
  const criterion = {};
  Object.defineProperty(criterion, "text", {
    get() {
      throw new Error("HOSTILE");
    },
    enumerable: true,
    configurable: true,
  });
  const artifact = minimalArtifact({ acceptanceCriteria: [criterion] });
  assert.throws(() => assertValidRequirementArtifact(artifact, "test caller"), /REQUIREMENT_ARTIFACT_INVALID/);
});

// --- labels / priority / contentHash ---------------------------------------

test("validateRequirementArtifact: rejects duplicate labels", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ labels: ["auth", "auth"] })).valid, false);
});

test("validateRequirementArtifact: rejects an empty labels array", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ labels: [] })).valid, false);
});

test("validateRequirementArtifact: rejects an empty-string priority", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ priority: "" })).valid, false);
});

test("validateRequirementArtifact: accepts an arbitrary non-empty priority string (no fixed scheme)", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ priority: "Must Have" })).valid, true);
  assert.equal(validateRequirementArtifact(minimalArtifact({ priority: "P0" })).valid, true);
});

// --- unknown top-level keys / metadata --------------------------------------

test("validateRequirementArtifact: rejects an unknown top-level key", () => {
  const { valid, errors } = validateRequirementArtifact(minimalArtifact({ status: "open" }));
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("status")));
});

test("validateRequirementArtifact: accepts arbitrary JSON-safe nested metadata", () => {
  assert.equal(
    validateRequirementArtifact(minimalArtifact({ metadata: { a: { b: { c: [1, "two", null, true] } } } })).valid,
    true
  );
});

test("validateRequirementArtifact: rejects metadata containing a function value", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ metadata: { hook: () => {} } })).valid, false);
});

test("validateRequirementArtifact: rejects metadata nested beyond the depth bound", () => {
  let deep = { leaf: true };
  for (let i = 0; i < 10; i++) deep = { nested: deep };
  assert.equal(validateRequirementArtifact(minimalArtifact({ metadata: deep })).valid, false);
});

test("validateRequirementArtifact: rejects a non-plain-object metadata (array/class instance)", () => {
  assert.equal(validateRequirementArtifact(minimalArtifact({ metadata: [1, 2, 3] })).valid, false);
  class Hostile {}
  assert.equal(validateRequirementArtifact(minimalArtifact({ metadata: new Hostile() })).valid, false);
});

// --- FPI1-R-1: prototype / class-instance hardening -------------------------

test("FPI1-R-1: an object whose prototype is itself another object (non-Object.prototype, non-null) is REJECTED outright, inherited fields never consulted", () => {
  const hostile = Object.create(minimalArtifact());
  hostile.id = "REQ-OWN"; // only id is own; type/title/content/source are inherited via the prototype chain
  const { valid, errors } = validateRequirementArtifact(hostile);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("must be a plain, JSON-like object")));
});

test("FPI1-R-1: a hostile custom-class artifact is REJECTED even with all fields present", () => {
  class HostileArtifact {
    constructor() {
      Object.assign(this, minimalArtifact());
    }
  }
  assert.equal(validateRequirementArtifact(new HostileArtifact()).valid, false);
});

test("FPI1-R-1: Object.create(null) with all required own fields is ACCEPTED (null-prototype plain data)", () => {
  const artifact = Object.assign(Object.create(null), minimalArtifact());
  assert.equal(Object.getPrototypeOf(artifact), null);
  assert.equal(validateRequirementArtifact(artifact).valid, true);
});

// --- FPI1-R-5: non-enumerable own fields -------------------------------------

test("FPI1-R-5: a non-enumerable own id is REJECTED as present-but-invalid, never silently treated as absent", () => {
  const artifact = minimalArtifact();
  delete artifact.id;
  Object.defineProperty(artifact, "id", { value: "REQ-001", enumerable: false, writable: true, configurable: true });
  const { valid, errors } = validateRequirementArtifact(artifact);
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes(".id")));
});

// --- FPI1-R-6: accessor-backed fields never execute --------------------------

test("FPI1-R-6: a stable accessor-backed id is REJECTED and its getter is NEVER invoked", () => {
  const artifact = minimalArtifact();
  delete artifact.id;
  let calls = 0;
  Object.defineProperty(artifact, "id", {
    get() {
      calls += 1;
      return "REQ-001";
    },
    enumerable: true,
    configurable: true,
  });
  const { valid } = validateRequirementArtifact(artifact);
  assert.equal(valid, false);
  assert.equal(calls, 0, "the getter must never be invoked during validation");
});

test("FPI1-R-6: a throwing accessor-backed id never escapes validateRequirementArtifact()", () => {
  const artifact = minimalArtifact();
  delete artifact.id;
  Object.defineProperty(artifact, "id", {
    get() {
      throw new Error("hostile getter");
    },
    enumerable: true,
    configurable: true,
  });
  assert.doesNotThrow(() => validateRequirementArtifact(artifact));
  assert.equal(validateRequirementArtifact(artifact).valid, false);
});

// --- JSON round-trip / data-only ---------------------------------------------

test("validateRequirementArtifact: a valid artifact survives a JSON round-trip unchanged and remains valid", () => {
  const artifact = minimalArtifact({ labels: ["auth"], relationships: [{ type: "related", targetId: "REQ-2" }] });
  const roundTripped = JSON.parse(JSON.stringify(artifact));
  assert.deepEqual(roundTripped, artifact);
  assert.equal(validateRequirementArtifact(roundTripped).valid, true);
});

// --- assertValidRequirementArtifact -----------------------------------------

test("assertValidRequirementArtifact: returns the exact same object reference when valid", () => {
  const artifact = minimalArtifact();
  assert.equal(assertValidRequirementArtifact(artifact, "test caller"), artifact);
});

test("assertValidRequirementArtifact: throws REQUIREMENT_ARTIFACT_REQUIRED for undefined", () => {
  assert.throws(() => assertValidRequirementArtifact(undefined, "test caller"), /REQUIREMENT_ARTIFACT_REQUIRED/);
});

test("assertValidRequirementArtifact: throws REQUIREMENT_ARTIFACT_REQUIRED for null", () => {
  assert.throws(() => assertValidRequirementArtifact(null, "test caller"), /REQUIREMENT_ARTIFACT_REQUIRED/);
});

test("assertValidRequirementArtifact: throws REQUIREMENT_ARTIFACT_INVALID with a bounded, deterministic message for malformed input", () => {
  assert.throws(() => assertValidRequirementArtifact({ id: "REQ-1" }, "test caller"), /REQUIREMENT_ARTIFACT_INVALID/);
});

test("assertValidRequirementArtifact: error message never fabricates/guesses content for an invalid artifact", () => {
  try {
    assertValidRequirementArtifact({ id: "REQ-1" }, "test caller");
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(err.message.includes("test caller"));
    assert.ok(!err.message.includes("undefined behavior"));
  }
});

test("assertValidRequirementArtifact: is deterministic - identical input always yields the identical result", () => {
  const artifact = minimalArtifact();
  const first = validateRequirementArtifact(artifact);
  const second = validateRequirementArtifact(artifact);
  assert.deepEqual(first, second);
});
