"use strict";

// GOV-AUTO-1 Wave 4 / 1F WP1: canonical facade reconciliation for the Wave 3
// (1E) public interface. 1E's own extensive suite (delta-review.test.js,
// fingerprint.test.js, regions.test.js) already covers 1E's behavior; this
// file only covers the facade/boundary invariants WP1 is responsible for --
// the same narrow scope wave1.test.js and wave2.test.js already established
// for their own waves.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const g = require("./index");
const { computeDeltaReview: directComputeDeltaReview } = require("./stages/1e/delta-review");

const isPlainObjectLike = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

test("W3: computeDeltaReview is exported through the canonical facade and is the actual Stage 1E implementation", () => {
  assert.equal(typeof g.computeDeltaReview, "function");
  assert.equal(g.computeDeltaReview, directComputeDeltaReview);
});

test("W3: no internal Stage 1E helper is exported alongside the public interface", () => {
  for (const name of ["parseSelector", "extractRegion", "frameRegion", "hashFramedRegions", "canonicalizeBytes", "validRecordsFor", "validateTopologicalOrder"]) {
    assert.equal(name in g, false, name);
  }
});

test("W3: existing Wave 0-2 public interfaces are unchanged by the facade addition", () => {
  for (const name of [
    "validateResultRecord", "aggregate", "checkDomainResultCompleteness", "exitCodeFor", "validateGraph",
    "validateManifest", "parseManifestText", "parseManifestBytes",
    "getGitIdentity", "getChangedFiles", "checkScope", "scanSecrets",
    "parseMarkdown", "checkReferences", "checkEvidenceModel", "checkConsistency",
  ]) {
    assert.equal(typeof g[name], "function", name);
  }
});

test("W3: requiring the facade introduces no circular-dependency failure", () => {
  delete require.cache[require.resolve("./index")];
  assert.doesNotThrow(() => require("./index"));
});

test("W3: the package surface is unchanged (governance is not published or exported)", () => {
  const pkg = JSON.parse(fs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8"));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  assert.equal(files.some((f) => /governance/.test(f)), false);
  const exportsMap = isPlainObjectLike(pkg.exports) ? pkg.exports : {};
  for (const value of Object.values(exportsMap)) assert.equal(/governance/.test(String(value)), false);
});

test("W3: no 1G or GOV-VERIFY-1 residue capability exists yet (merge-gate facts) -- collectCiEvidence/buildReport are intentionally excluded from this Wave 3 boundary list: Wave 4 (1F) adds them; see a future wave4.test.js for the Wave 4 boundary", () => {
  for (const name of ["computeFingerprints", "verifyMergeGate", "getBranchProtection", "computePackDiff"]) assert.equal(name in g, false, name);
});

test("W3: the index header comment no longer claims 1E is unimplemented", () => {
  const text = fs.readFileSync(nodePath.join(__dirname, "index.js"), "utf8");
  assert.equal(/1E\.\.1G are not implemented/.test(text), false);
  assert.equal(/computeDeltaReview/.test(text), true);
});
