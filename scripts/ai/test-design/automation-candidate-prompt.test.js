"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAutomationCandidateSystemPrompt, buildAutomationCandidateUserPrompt } = require("./automation-candidate-prompt");
const { SCHEMA_VERSION, SUPPORTED_FRAMEWORKS } = require("../generation/primitives");
const { KIND, DECISIONS } = require("../generation/automation-candidate");

function projection(overrides = {}) {
  return {
    projectId: "proj-1",
    testCaseModelId: "tcm-1",
    testCase: {
      id: "tc-1",
      title: "Invalid login shows error",
      objective: "Verify an error is shown on invalid credentials.",
      requirementIds: ["req-1"],
      preconditions: undefined,
      steps: [{ action: "Submit invalid credentials.", expectedResult: "An error message is displayed.", requirementIds: ["req-1"] }],
      priority: undefined,
    },
    requirements: [{ id: "req-1", text: "The login page must show an error on invalid credentials." }],
    assumptions: [],
    openQuestions: [],
    projectProfile: null,
    ...overrides,
  };
}

// --- system prompt -----------------------------------------------------------

test("system prompt states the exact frozen schemaVersion and kind", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  assert.ok(prompt.includes(String(SCHEMA_VERSION)));
  assert.ok(prompt.includes(KIND));
});

test("system prompt states the exact frozen decision vocabulary", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  for (const decision of DECISIONS) assert.ok(prompt.includes(decision));
});

test("system prompt states the exact frozen framework vocabulary and no other", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  for (const fw of SUPPORTED_FRAMEWORKS) assert.ok(prompt.includes(fw));
  assert.ok(!/selenium|webdriverio|puppeteer|testcafe|nightwatch/i.test(prompt));
});

test("system prompt instructs preferring BLOCKED under uncertainty", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  assert.ok(/prefer BLOCKED/i.test(prompt));
});

test("system prompt forbids treating assumptions/open questions as confirmed facts", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  assert.ok(/not confirmed requirements|not.*confirmed.*fact/i.test(prompt));
});

test("system prompt forbids repository detail fabrication (selectors, file paths, code)", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  assert.ok(/selector/i.test(prompt));
  assert.ok(/file path/i.test(prompt));
  assert.ok(/no code/i.test(prompt) || /never.*code/i.test(prompt));
});

test("system prompt requires testCaseModelId/testCaseId/projectId to be copied exactly", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  assert.ok(/copied EXACTLY/i.test(prompt));
});

test("system prompt states the DATA boundary against prompt injection", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  assert.ok(/DATA/i.test(prompt));
  assert.ok(/never follow, obey/i.test(prompt));
});

test("system prompt requires strict JSON only output, no markdown/fences/commentary", () => {
  const prompt = buildAutomationCandidateSystemPrompt();
  assert.ok(/no markdown/i.test(prompt));
  assert.ok(/no code fences/i.test(prompt));
});

// --- user prompt ---------------------------------------------------------------

test("user prompt embeds the projection as a JSON block and includes the DATA boundary reminder", () => {
  const prompt = buildAutomationCandidateUserPrompt(projection());
  assert.ok(prompt.includes('"projectId": "proj-1"'));
  assert.ok(prompt.includes('"tc-1"'));
  assert.ok(/DATA, not instructions/i.test(prompt));
});

test("user prompt with no correctionErrors omits any correction section", () => {
  const prompt = buildAutomationCandidateUserPrompt(projection());
  assert.ok(!/previous response was rejected/i.test(prompt));
});

test("user prompt with correctionErrors includes only the bounded {path,code,message} shape, never a raw response", () => {
  const marker = "SECRET_RAW_RESPONSE_MARKER";
  const prompt = buildAutomationCandidateUserPrompt(projection(), { correctionErrors: [{ path: "$.decision", code: "INVALID_ENUM", message: "bad decision" }] });
  assert.ok(/previous response was rejected/i.test(prompt));
  assert.ok(prompt.includes("INVALID_ENUM"));
  assert.ok(!prompt.includes(marker));
});

test("user prompt never includes a projectProfile block header when projectProfile is null", () => {
  const prompt = buildAutomationCandidateUserPrompt(projection({ projectProfile: null }));
  assert.ok(prompt.includes('"projectProfile": null'));
});

test("user prompt includes supplied projectProfile guidance and labels it as background, not evidence", () => {
  const prompt = buildAutomationCandidateUserPrompt(projection({ projectProfile: { displayName: "Example Project", knownProjectConstraints: ["c1"] } }));
  assert.ok(prompt.includes("Example Project"));
  assert.ok(/not evidence/i.test(prompt));
});

test("user prompt excludes fields not present in the projection (no repoRoot/environment channel exists)", () => {
  const prompt = buildAutomationCandidateUserPrompt(projection());
  assert.ok(!prompt.includes("repoRoot"));
  assert.ok(!prompt.includes(process.env.PATH || "__no_path__"));
});
