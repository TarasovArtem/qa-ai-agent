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
