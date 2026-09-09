"use strict";

/**
 * Roadmap TI-1 (Targomo Independence, Explicit Target Profile Boundary):
 * dependency-free, source-text architecture regression proving the core
 * invariant this stage establishes:
 *
 *   CORE -> TARGOMO active runtime dependencies: ZERO
 *
 * No generic core runtime module (scripts/ai/**, excluding this file and
 * other *.test.js files) may reference the concrete Targomo profile
 * constant, or import anything under the target-owned
 * scripts/targets/targomo/ tree. The reverse (target -> core) is the
 * intended, and separately proven, direction.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const AI_ROOT = path.resolve(__dirname);
const TARGETS_TARGOMO_ROOT = path.resolve(__dirname, "..", "targets", "targomo");

function listJsFilesRecursive(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listJsFilesRecursive(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

// Matches actual code dependencies (a require() call, or a destructuring
// import binding TARGOMO_PROJECT_PROFILE), never prose. project-profile.js
// itself legitimately mentions "TARGOMO_PROJECT_PROFILE" in its own
// docstring, explaining what it used to contain and where that moved to -
// that is documentation, not a dependency, and must not false-positive
// here.
const FORBIDDEN_PATTERNS = [
  /require\(["'][^"']*targets[\\/]targomo[^"']*["']\)/,
  /\{[^}]*\bTARGOMO_PROJECT_PROFILE\b[^}]*\}\s*=\s*require/,
];

test("architecture boundary: no generic core runtime file imports scripts/targets/targomo/ or destructures TARGOMO_PROJECT_PROFILE from a require()", () => {
  const violations = [];
  for (const file of listJsFilesRecursive(AI_ROOT)) {
    if (file.endsWith(".test.js")) continue; // test files are exempt - see the positive/negative proofs elsewhere
    if (path.basename(file) === "architecture-boundary.test.js") continue;
    const content = fs.readFileSync(file, "utf8");
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(`${path.relative(AI_ROOT, file)} matches forbidden pattern ${pattern}`);
      }
    }
  }
  assert.deepEqual(violations, [], `generic core runtime must never import target-owned code:\n${violations.join("\n")}`);
});

test("architecture boundary (positive proof): the target-owned Targomo tree does import from generic core", () => {
  const bootstrapFiles = ["collect-context.js", "collect-history.js", "analyze-failure.js"];
  for (const name of bootstrapFiles) {
    const content = fs.readFileSync(path.join(TARGETS_TARGOMO_ROOT, name), "utf8");
    assert.match(content, /require\(["']\.\.\/\.\.\/ai\//, `${name} must import the generic core`);
  }
});

test("architecture boundary: the target profile itself lives only under scripts/targets/targomo/", () => {
  assert.equal(fs.existsSync(path.join(TARGETS_TARGOMO_ROOT, "project-profile.js")), true);
  const coreProfileExports = require("./project-profile");
  assert.equal("TARGOMO_PROJECT_PROFILE" in coreProfileExports, false, "the generic core contract must not export a concrete target profile");
  const coreProfileSource = fs.readFileSync(path.join(AI_ROOT, "project-profile.js"), "utf8");
  assert.doesNotMatch(coreProfileSource, /poi\.targomo\.com/, "the target's own hostname must never appear in generic core source");
});
