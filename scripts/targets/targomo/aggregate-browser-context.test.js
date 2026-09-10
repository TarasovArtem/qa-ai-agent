"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { TARGOMO_REPOSITORY_ROOT } = require("./repository-root");
const { run, core } = require("./aggregate-browser-context");

// Roadmap FPI-2: this bootstrap replaces the workflow's former direct
// `node scripts/ai/aggregate-browser-context.js` invocation - the generic
// aggregator now requires an explicit repositoryRoot, so Targomo supplies
// its own TARGOMO_REPOSITORY_ROOT here, exactly mirroring the existing
// ai:collect/ai:history/ai:analyze bootstrap pattern.

test("Targomo bootstrap: core is the exact same aggregate-browser-context module the generic core exports (not a copy)", () => {
  assert.equal(core, require("../../ai/aggregate-browser-context"));
  assert.equal(typeof core.main, "function");
});

// Argument-identity proof (not just "was called"): temporarily replaces
// core.main with a capturing spy, calls the real run(), and asserts the
// EXACT object identity of the repositoryRoot argument that reached the
// generic core - proving run() forwards TARGOMO_REPOSITORY_ROOT itself,
// never a copy, a re-derived value, or a different root entirely. The
// original core.main is restored unconditionally, including on failure.
test("Targomo bootstrap: run() threads the exact TARGOMO_REPOSITORY_ROOT value into core.main - argument identity, not merely invocation", (t) => {
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
  assert.equal(captured.repositoryRoot, TARGOMO_REPOSITORY_ROOT, "repositoryRoot must be the exact TARGOMO_REPOSITORY_ROOT value, not a copy or a different root");
  assert.deepEqual(Object.keys(captured), ["repositoryRoot"], "run() must forward nothing beyond repositoryRoot to the generic aggregator");
  assert.equal(returned, "SENTINEL_RETURN_VALUE", "run() must return core.main()'s own return value unchanged");
});

test("Targomo bootstrap: run is a thin wrapper taking no arguments - repositoryRoot is closed over, never caller-suppliable", () => {
  assert.equal(typeof run, "function");
  assert.equal(run.length, 0);
});
