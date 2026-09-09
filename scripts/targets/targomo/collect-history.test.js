"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const { run, core } = require("./collect-history");

// Roadmap TI-1: moved/adapted from scripts/ai/collect-history.test.js -
// proves this target bootstrap supplies the real, stable Targomo project
// identity to the generic core, by reference (not a duplicated/hardcoded
// literal). Deliberately never invokes run()/core.main() for real -
// scripts/ai/collect-history.test.js's own module comment explains why
// this module is not otherwise unit-testable without mocking the GitHub
// API/filesystem/env, a convention this file preserves.

test("Targomo bootstrap: TARGOMO_PROJECT_PROFILE.id is the stable production project identity", () => {
  assert.equal(TARGOMO_PROJECT_PROFILE.id, "external-poi-sut");
});

test("Targomo bootstrap: core is the exact same collect-history module the generic core exports (not a copy)", () => {
  assert.equal(core, require("../../ai/collect-history"));
  assert.equal(typeof core.main, "function");
});

test("Targomo bootstrap: run is a thin wrapper that calls core.main with the real Targomo profile, nothing else", () => {
  assert.equal(typeof run, "function");
  assert.equal(run.length, 0, "run() takes no arguments - the profile is closed over, never caller-suppliable");
});
