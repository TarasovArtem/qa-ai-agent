"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateProjectKnowledgeConfig, assertValidProjectKnowledgeConfig } = require("./project-knowledge-config");

// Roadmap FPI-1: generic core contract - synthetic values only, no real
// target import.

test("validateProjectKnowledgeConfig: accepts a config with an explicit projectKnowledgeUnitsDir", () => {
  const { valid, errors } = validateProjectKnowledgeConfig({
    projectId: "shop-demo",
    projectKnowledgeUnitsDir: "qa/knowledge",
  });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateProjectKnowledgeConfig: accepts a config with projectId only (no Knowledge directory required)", () => {
  const { valid, errors } = validateProjectKnowledgeConfig({ projectId: "shop-demo" });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateProjectKnowledgeConfig: rejects an absolute projectKnowledgeUnitsDir", () => {
  assert.equal(
    validateProjectKnowledgeConfig({ projectId: "shop-demo", projectKnowledgeUnitsDir: "/etc/passwd" }).valid,
    false
  );
});

test("validateProjectKnowledgeConfig: rejects a traversal projectKnowledgeUnitsDir", () => {
  assert.equal(
    validateProjectKnowledgeConfig({ projectId: "shop-demo", projectKnowledgeUnitsDir: "../secrets" }).valid,
    false
  );
});

test("validateProjectKnowledgeConfig: rejects an empty-string projectKnowledgeUnitsDir", () => {
  assert.equal(validateProjectKnowledgeConfig({ projectId: "shop-demo", projectKnowledgeUnitsDir: "" }).valid, false);
});

test("validateProjectKnowledgeConfig: rejects a framework outer key", () => {
  const { valid, errors } = validateProjectKnowledgeConfig({ projectId: "shop-demo", framework: "cypress" });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("framework")));
});

test("validateProjectKnowledgeConfig: rejects a repositoryRoot outer key", () => {
  const { valid, errors } = validateProjectKnowledgeConfig({ projectId: "shop-demo", repositoryRoot: "/tmp/x" });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("repositoryRoot")));
});

test("validateProjectKnowledgeConfig: rejects an unknown outer key", () => {
  assert.equal(validateProjectKnowledgeConfig({ projectId: "shop-demo", extra: "x" }).valid, false);
});

test("validateProjectKnowledgeConfig: rejects a missing projectId", () => {
  const { valid, errors } = validateProjectKnowledgeConfig({ projectKnowledgeUnitsDir: "qa/knowledge" });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("projectId")));
});

test("validateProjectKnowledgeConfig: rejects an empty-string projectId", () => {
  assert.equal(validateProjectKnowledgeConfig({ projectId: "" }).valid, false);
});

test("validateProjectKnowledgeConfig: rejects null/non-object input without throwing", () => {
  assert.equal(validateProjectKnowledgeConfig(null).valid, false);
  assert.equal(validateProjectKnowledgeConfig(undefined).valid, false);
  assert.equal(validateProjectKnowledgeConfig("shop-demo").valid, false);
  assert.equal(validateProjectKnowledgeConfig([]).valid, false);
});

test("validateProjectKnowledgeConfig: does not mutate a frozen valid input", () => {
  const frozen = Object.freeze({ projectId: "shop-demo", projectKnowledgeUnitsDir: "qa/knowledge" });
  const { valid } = validateProjectKnowledgeConfig(frozen);
  assert.equal(valid, true);
});

// --- assertValidProjectKnowledgeConfig --------------------------------------

test("assertValidProjectKnowledgeConfig: returns the config unchanged when valid", () => {
  const config = { projectId: "shop-demo", projectKnowledgeUnitsDir: "qa/knowledge" };
  assert.equal(assertValidProjectKnowledgeConfig(config, "test caller"), config);
});

test("assertValidProjectKnowledgeConfig: throws PROJECT_KNOWLEDGE_CONFIG_REQUIRED for undefined", () => {
  assert.throws(
    () => assertValidProjectKnowledgeConfig(undefined, "test caller"),
    /PROJECT_KNOWLEDGE_CONFIG_REQUIRED: test caller/
  );
});

test("assertValidProjectKnowledgeConfig: throws PROJECT_KNOWLEDGE_CONFIG_REQUIRED for null", () => {
  assert.throws(
    () => assertValidProjectKnowledgeConfig(null, "test caller"),
    /PROJECT_KNOWLEDGE_CONFIG_REQUIRED: test caller/
  );
});

test("assertValidProjectKnowledgeConfig: throws PROJECT_KNOWLEDGE_CONFIG_INVALID for a malformed non-null config, naming the caller and reason", () => {
  assert.throws(
    () => assertValidProjectKnowledgeConfig({ projectId: "", projectKnowledgeUnitsDir: "qa" }, "test caller"),
    /PROJECT_KNOWLEDGE_CONFIG_INVALID: test caller.*projectId/
  );
});

test("assertValidProjectKnowledgeConfig: throws PROJECT_KNOWLEDGE_CONFIG_INVALID for an empty object", () => {
  assert.throws(
    () => assertValidProjectKnowledgeConfig({}, "test caller"),
    /PROJECT_KNOWLEDGE_CONFIG_INVALID: test caller/
  );
});

// --- Roadmap FPI-1 corrective hardening (FPI1-R-1/R-2/R-4) -----------------
//
// Regression coverage for the independent strict adversarial review's
// exact reproduced findings, mirrored from
// scripts/ai/framework-runtime-config.test.js's own corrective section.

// FPI1-R-1: prototype-inheritance validation bypass -------------------------

test("FPI1-R-1: an object with ZERO own properties that inherits projectId is REJECTED (was: ACCEPTED)", () => {
  const hostile = Object.create({ projectId: "shop-demo" });
  assert.deepEqual(Object.keys(hostile), []);
  assert.equal(hostile.projectId, "shop-demo"); // inherited, not own
  assert.equal(validateProjectKnowledgeConfig(hostile).valid, false);
});

test("FPI1-R-1: a config object that only inherits projectKnowledgeUnitsDir (via a non-plain prototype) is REJECTED at the outer plain-data gate, never reaching field-level consumption", () => {
  // Unlike FrameworkRuntimeConfig's `reports`, ProjectKnowledgeConfig has
  // no nested object of its own - so any prototype-chain trick that would
  // let an inherited projectKnowledgeUnitsDir reach validation necessarily
  // also gives the OUTER config object a non-Object.prototype/non-null
  // prototype, which the isPlainDataObject() gate already rejects outright
  // (see the "ZERO own properties" test above for the same top-level
  // guarantee). This proves the inherited value can never be silently
  // treated as present-and-safe.
  const proto = { projectKnowledgeUnitsDir: "../escape" }; // would be REJECTED if ever validated
  const config = Object.create(proto, { projectId: { value: "shop-demo", enumerable: true } });
  assert.equal(Object.prototype.hasOwnProperty.call(config, "projectKnowledgeUnitsDir"), false);
  assert.equal(validateProjectKnowledgeConfig(config).valid, false);
});

test("FPI1-R-1: an own projectKnowledgeUnitsDir explicitly set to undefined is treated as absent (unchanged optional-field semantics)", () => {
  const config = { projectId: "shop-demo", projectKnowledgeUnitsDir: undefined };
  assert.equal(Object.prototype.hasOwnProperty.call(config, "projectKnowledgeUnitsDir"), true);
  assert.equal(validateProjectKnowledgeConfig(config).valid, true);
});

test("FPI1-R-1: a class instance is REJECTED as a config object", () => {
  class HostileConfig {}
  const instance = Object.assign(new HostileConfig(), { projectId: "shop-demo" });
  assert.equal(validateProjectKnowledgeConfig(instance).valid, false);
});

test("FPI1-R-1: a Date/Map is REJECTED as a config object", () => {
  assert.equal(validateProjectKnowledgeConfig(new Date()).valid, false);
  assert.equal(validateProjectKnowledgeConfig(new Map([["projectId", "shop-demo"]])).valid, false);
});

test("FPI1-R-1: Object.create(null) with an own projectId is ACCEPTED (null-prototype plain data)", () => {
  const config = Object.create(null);
  config.projectId = "shop-demo";
  assert.equal(Object.getPrototypeOf(config), null);
  assert.equal(validateProjectKnowledgeConfig(config).valid, true);
});

test("FPI1-R-1: an ordinary plain-object literal remains valid after JSON round-trip", () => {
  const original = { projectId: "shop-demo", projectKnowledgeUnitsDir: "qa/knowledge" };
  const roundTripped = JSON.parse(JSON.stringify(original));
  assert.equal(validateProjectKnowledgeConfig(roundTripped).valid, true);
});

// FPI1-R-2: unbounded unknown-key diagnostics --------------------------------

test("FPI1-R-2: a single 100,000-character unknown key produces a bounded validate() result and a bounded assert() message", () => {
  const config = { projectId: "shop-demo" };
  config["X".repeat(100000)] = "irrelevant";

  const { valid, errors } = validateProjectKnowledgeConfig(config);
  assert.equal(valid, false);
  assert.ok(errors.join("; ").length < 500, `expected a bounded joined message, got length ${errors.join("; ").length}`);

  let thrown;
  try {
    assertValidProjectKnowledgeConfig(config, "probe");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown);
  assert.ok(thrown.message.length < 1500, `expected a bounded assert message, got length ${thrown.message.length}`);
  assert.ok(thrown.message.startsWith("PROJECT_KNOWLEDGE_CONFIG_INVALID:"));
});

test("FPI1-R-2: 500 unknown keys produce a bounded validate() result and a bounded assert() message", () => {
  const config = { projectId: "shop-demo" };
  for (let i = 0; i < 500; i++) config["unknownKey" + i] = i;

  const { errors } = validateProjectKnowledgeConfig(config);
  assert.ok(errors.length <= 9, `expected at most 8 reported unknown keys + 1 summary line, got ${errors.length}`);

  let thrown;
  try {
    assertValidProjectKnowledgeConfig(config, "probe");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown.message.length < 1500, `expected a bounded assert message, got length ${thrown.message.length}`);
});

// FPI1-R-4: Windows drive-relative path --------------------------------------

test("FPI1-R-4: Windows drive-relative projectKnowledgeUnitsDir (no separator after the drive letter) is REJECTED (was: ACCEPTED)", () => {
  assert.equal(validateProjectKnowledgeConfig({ projectId: "shop-demo", projectKnowledgeUnitsDir: "C:foo" }).valid, false);
  assert.equal(validateProjectKnowledgeConfig({ projectId: "shop-demo", projectKnowledgeUnitsDir: "c:foo" }).valid, false);
});

test("FPI1-R-4: ordinary repository-relative projectKnowledgeUnitsDir remains ACCEPTED (unchanged)", () => {
  assert.equal(
    validateProjectKnowledgeConfig({ projectId: "shop-demo", projectKnowledgeUnitsDir: "qa/knowledge" }).valid,
    true
  );
});

// --- Roadmap FPI-1 corrective C2 (FPI1-R-5/R-6) -----------------------------
//
// Regression coverage mirrored from
// scripts/ai/framework-runtime-config.test.js's own corrective C2 section -
// own-ness alone (FPI1-R-1's fix) is not sufficient; required/consumed
// fields must also be ENUMERABLE (FPI1-R-5) and DATA descriptors, never
// accessors (FPI1-R-6).

test("FPI1-R-5: a non-enumerable own projectId is REJECTED, and validate() agrees before and after a JSON round-trip (was: valid before, invalid after)", () => {
  const config = {};
  Object.defineProperty(config, "projectId", { value: "shop-demo", enumerable: false, writable: true, configurable: true });
  const original = validateProjectKnowledgeConfig(config);
  const roundTripped = validateProjectKnowledgeConfig(JSON.parse(JSON.stringify(config)));
  assert.equal(original.valid, false);
  assert.equal(roundTripped.valid, false);
});

test("FPI1-R-5: a non-enumerable own projectKnowledgeUnitsDir is REJECTED as present-but-invalid, never silently treated as absent", () => {
  const config = { projectId: "shop-demo" };
  Object.defineProperty(config, "projectKnowledgeUnitsDir", {
    value: "qa/knowledge",
    enumerable: false,
    writable: true,
    configurable: true,
  });
  assert.equal(validateProjectKnowledgeConfig(config).valid, false);
});

test("FPI1-R-5: a normal valid config remains valid after a JSON round-trip (unchanged, still true)", () => {
  const original = { projectId: "shop-demo", projectKnowledgeUnitsDir: "qa/knowledge" };
  assert.equal(validateProjectKnowledgeConfig(JSON.parse(JSON.stringify(original))).valid, true);
});

// --- FPI1-R-6: accessor-backed fields must never execute --------------------

test("FPI1-R-6: a stable (non-throwing) accessor-backed projectId is REJECTED and its getter is NEVER invoked (was: getter invoked, field accepted)", () => {
  let calls = 0;
  const config = {};
  Object.defineProperty(config, "projectId", {
    enumerable: true,
    configurable: true,
    get() {
      calls++;
      return "shop-demo";
    },
  });
  const result = validateProjectKnowledgeConfig(config);
  assert.equal(result.valid, false);
  assert.equal(calls, 0, "the getter must never be invoked during validation");
});

test("FPI1-R-6: a throwing accessor-backed projectId never escapes validateProjectKnowledgeConfig() (was: uncontrolled exception)", () => {
  let calls = 0;
  const config = {};
  Object.defineProperty(config, "projectId", {
    enumerable: true,
    configurable: true,
    get() {
      calls++;
      throw new Error("GETTER_SIDE_EFFECT");
    },
  });
  const result = validateProjectKnowledgeConfig(config);
  assert.equal(result.valid, false);
  assert.equal(calls, 0);
});

test("FPI1-R-6: a throwing accessor-backed optional projectKnowledgeUnitsDir never escapes validateProjectKnowledgeConfig() and is never invoked (was: uncontrolled exception)", () => {
  let calls = 0;
  const config = { projectId: "shop-demo" };
  Object.defineProperty(config, "projectKnowledgeUnitsDir", {
    enumerable: true,
    configurable: true,
    get() {
      calls++;
      throw new Error("DIR_GETTER_SIDE_EFFECT");
    },
  });
  const result = validateProjectKnowledgeConfig(config);
  assert.equal(result.valid, false);
  assert.equal(calls, 0, "the throwing optional-field getter must never be invoked");
});

test("FPI1-R-6: assertValidProjectKnowledgeConfig() with a throwing accessor field produces the stable PROJECT_KNOWLEDGE_CONFIG_INVALID error, never the raw getter exception", () => {
  const config = {};
  Object.defineProperty(config, "projectId", {
    enumerable: true,
    configurable: true,
    get() {
      throw new Error("PROJECT_ID_GETTER_SIDE_EFFECT");
    },
  });
  let thrown;
  try {
    assertValidProjectKnowledgeConfig(config, "test caller");
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown);
  assert.ok(thrown.message.startsWith("PROJECT_KNOWLEDGE_CONFIG_INVALID: test caller"));
  assert.equal(thrown.message.includes("PROJECT_ID_GETTER_SIDE_EFFECT"), false);
});
