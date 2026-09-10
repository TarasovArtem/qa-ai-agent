"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const { TARGOMO_REPOSITORY_ROOT } = require("./repository-root");
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

// Roadmap FPI-2 argument-identity proof (not just "was called"): spies on
// core.main() and asserts the EXACT object identity of both the profile
// and repositoryRoot arguments run() forwards. The original core.main is
// restored unconditionally, including on failure.
test("Targomo bootstrap: run() threads the exact TARGOMO_PROJECT_PROFILE and TARGOMO_REPOSITORY_ROOT values into core.main - argument identity, not merely invocation", (t) => {
  const originalMain = core.main;
  let captured = null;
  core.main = (args) => {
    captured = args;
    return "SENTINEL_RETURN_VALUE";
  };
  t.after(() => {
    core.main = originalMain;
  });

  const returned = run();

  assert.ok(captured, "core.main must have been called");
  assert.equal(captured.profile, TARGOMO_PROJECT_PROFILE, "profile must be the exact TARGOMO_PROJECT_PROFILE object, not a copy");
  assert.equal(captured.repositoryRoot, TARGOMO_REPOSITORY_ROOT, "repositoryRoot must be the exact TARGOMO_REPOSITORY_ROOT value, not a copy or a different root");
  assert.equal(returned, "SENTINEL_RETURN_VALUE", "run() must return core.main()'s own return value unchanged");
});
