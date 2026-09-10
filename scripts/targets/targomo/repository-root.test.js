"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TARGOMO_REPOSITORY_ROOT } = require("./repository-root");

// Roadmap FPI-2: TARGOMO_REPOSITORY_ROOT is the one small, target-owned
// source of truth every Targomo bootstrap (collect-context.js,
// collect-history.js, analyze-failure.js, aggregate-browser-context.js)
// supplies to the generic core as `repositoryRoot`. The generic core
// itself must never import this - see architecture-boundary.test.js's
// own core->targomo boundary proof.

test("TARGOMO_REPOSITORY_ROOT is an absolute path", () => {
  assert.equal(path.isAbsolute(TARGOMO_REPOSITORY_ROOT), true);
});

test("TARGOMO_REPOSITORY_ROOT resolves to this actual qa-ai-agent checkout root - the real package.json/scripts/ai directory tree lives directly under it", () => {
  assert.equal(fs.existsSync(path.join(TARGOMO_REPOSITORY_ROOT, "package.json")), true);
  assert.equal(fs.existsSync(path.join(TARGOMO_REPOSITORY_ROOT, "scripts", "ai", "repository-root.js")), true);
  assert.equal(fs.existsSync(path.join(TARGOMO_REPOSITORY_ROOT, "scripts", "targets", "targomo", "repository-root.js")), true);
});

test("TARGOMO_REPOSITORY_ROOT is computed once as a static constant, not a function - re-requiring this module returns the identical value", () => {
  delete require.cache[require.resolve("./repository-root")];
  const reloaded = require("./repository-root");
  assert.equal(reloaded.TARGOMO_REPOSITORY_ROOT, TARGOMO_REPOSITORY_ROOT);
});

test("TARGOMO_REPOSITORY_ROOT satisfies the generic core's own trusted-root contract (scripts/ai/repository-root.js)", () => {
  const { validateRepositoryRoot } = require("../../ai/repository-root");
  const result = validateRepositoryRoot(TARGOMO_REPOSITORY_ROOT);
  assert.equal(result.valid, true, `expected TARGOMO_REPOSITORY_ROOT to validate cleanly; errors: ${JSON.stringify(result.errors)}`);
  assert.equal(result.realRoot, fs.realpathSync(TARGOMO_REPOSITORY_ROOT));
});
