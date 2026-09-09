"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const { buildSystemPrompt } = require("../../ai/qa-agent-prompt");

// Roadmap TI-1: moved/adapted from scripts/ai/qa-agent-prompt.test.js -
// buildSystemPrompt() no longer defaults to Targomo's profile, so the
// exact current Targomo production persona sentence is proven here,
// against the real target-owned profile, rather than in the generic core
// test file (which now uses only synthetic profiles).
//
// Pins the exact current sentence, not just a substring match - Roadmap
// #19.2's original claim (byte-for-byte-unchanged production output) was
// intentionally superseded by Roadmap #19.5B, which deliberately
// generalized the persona away from a hardcoded "Cypress" noun and
// interpolated an explicit, defaulted frameworkId instead - this pins
// the current production-default sentence for the real Targomo profile.
const EXACT_PRODUCTION_PERSONA_SENTENCE =
  "You are a Senior QA Automation Engineer performing failure triage for an end-to-end test suite (current test framework: cypress) that tests a live, externally hosted third-party application (poi.targomo.com). The test suite does not control that application's code, infrastructure, or uptime.";

test("buildSystemPrompt: given the real Targomo profile, renders the exact, byte-for-byte current production persona sentence", () => {
  const prompt = buildSystemPrompt(TARGOMO_PROJECT_PROFILE);
  assert.ok(prompt.startsWith(EXACT_PRODUCTION_PERSONA_SENTENCE), "persona sentence must be byte-identical to the current production text");
});

test("buildSystemPrompt: the real Targomo profile with an explicit frameworkId renders the correct framework clause", () => {
  const prompt = buildSystemPrompt(TARGOMO_PROJECT_PROFILE, "playwright");
  assert.match(prompt, /current test framework: playwright/);
  assert.doesNotMatch(prompt, /current test framework: cypress/);
});
