"use strict";

// GOV-AUTO-1 Wave 4 (1F) facade and boundary tests: the two canonical public
// interfaces (design section 18), no later-wave or GOV-VERIFY-1 residue, and
// the non-goal invariants (package surface unchanged, no self-observing CI,
// no independent readiness computation). 1F's own extensive per-module
// suites (ci-run, required-jobs, ci-classify, determination, ci-evidence,
// revalidation, report) already cover behavior; this file covers only the
// facade/boundary scope wave1.test.js/wave2.test.js/wave3.test.js already
// established for their own waves.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const nodePath = require("node:path");
const g = require("./index");
const { collectCiEvidence: directCollectCiEvidence } = require("./stages/1f/ci-evidence");
const { buildReport: directBuildReport } = require("./stages/1f/report");

const isPlainObjectLike = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

test("W4: collectCiEvidence and buildReport are exported through the canonical facade and are the actual Stage 1F implementations", () => {
  assert.equal(typeof g.collectCiEvidence, "function");
  assert.equal(g.collectCiEvidence, directCollectCiEvidence);
  assert.equal(typeof g.buildReport, "function");
  assert.equal(g.buildReport, directBuildReport);
});

test("W4: no internal Stage 1F helper is exported alongside the two public interfaces", () => {
  for (const name of [
    "fetchValidatedRun", "validateRunEvidence", "isGithubCiAdapter", "resolveGithubCiAdapter",
    "checkRequiredJobs", "classifyCiEvidence", "CLASSIFICATIONS",
    "validateDetermination", "isValidRecordBody", "isAuthorizedDeterminer", "resolveDeterminationMode", "checkBindings",
    "isDeterminationAdapter", "resolveDeterminationAdapter", // Corrective C1 (W4-SEC-H1)
    "isValidTrustedContext", "isValidExternalEvidenceEntry", "isValidManifestProvenance", "SUPPORTED_REPORT_SCHEMA_VERSIONS",
    "renderMarkdown", "revalidateEvidence",
  ]) {
    if (name === "revalidateEvidence") continue; // kernel-owned (design section 25a), genuinely public -- see below
    assert.equal(name in g, false, name);
  }
});

// ---------------------------------------------------------------- Corrective C1 (W4-DEV-L1): header-staleness regression

test("W4: the index header does not falsely claim Stage 1F is unimplemented, and does not prematurely claim Wave 4 / Stage 1F is merged or post-merge certified", () => {
  const text = fs.readFileSync(nodePath.join(__dirname, "index.js"), "utf8");
  assert.equal(/no CI-evidence or report-writing code/.test(text), false);
  assert.equal(/1F,\s*1G are not implemented/.test(text), false);
  assert.equal(/collectCiEvidence/.test(text), true);
  assert.equal(/buildReport/.test(text), true);
  assert.equal(/CERTIFIED_ON_MAIN/.test(text), false);
  assert.equal(/Stage 1G[^.]*not implemented/.test(text), true);
});

test("W4: revalidateEvidence is exported as a kernel interface (design section 25a explicitly names it kernel-owned), not a Stage 1F interface", () => {
  assert.equal(typeof g.revalidateEvidence, "function");
});

test("W4: no 1G or GOV-VERIFY-1 residue capability exists (merge-gate facts)", () => {
  for (const name of ["verifyMergeGate", "getBranchProtection", "computePackDiff"]) assert.equal(name in g, false, name);
});

test("W4: no stage source file contains a hard-coded live GitHub API call, workflow trigger, or rerun trigger -- all GitHub access is behind the injectable adapter seam", () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) sources.push(full);
    }
  };
  walk(nodePath.join(__dirname, "stages", "1f"));
  const text = sources.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const marker of ["gh api", "gh pr merge", "gh run rerun", "api.github.com", "workflow_dispatch", "octokit"]) {
    assert.equal(text.includes(marker), false, `no ${marker} in Stage 1F source`);
  }
  assert.equal(/require\(["']node:(net|http|https|dgram|tls)["']\)/.test(text), false, "no network module is required by Stage 1F source");
});

test("W4: no Stage 1F module recomputes readiness independently of kernel.aggregate()", () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) sources.push(full);
    }
  };
  walk(nodePath.join(__dirname, "stages", "1f"));
  for (const file of sources) {
    if (file.endsWith(`${nodePath.sep}report.js`)) continue; // the one module allowed to call aggregate()
    const text = fs.readFileSync(file, "utf8");
    assert.equal(/require\(.*kernel\/readiness/.test(text), false, `${file} must not import the kernel aggregator directly`);
  }
});

test("W4: the package surface is unchanged (governance is not published or exported)", () => {
  const pkg = JSON.parse(fs.readFileSync(nodePath.join(__dirname, "..", "..", "package.json"), "utf8"));
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  assert.equal(files.some((f) => /governance/.test(f)), false);
  const exportsMap = isPlainObjectLike(pkg.exports) ? pkg.exports : {};
  for (const value of Object.values(exportsMap)) assert.equal(/governance/.test(String(value)), false);
});

test("W4: the new REASON codes are unique, well-formed and additive (no synonym of an existing code)", () => {
  const names = Object.keys(g.REASON);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[A-Z][A-Z0-9_]*$/);
  for (const name of ["CI_NOT_COLLECTED", "STALE_EVIDENCE", "OWNER_SELF_DETERMINATION", "CI_REQUIRED_JOB_INCOMPLETE", "CI_REQUIRED_JOB_FAILED", "CI_UNEXPLAINED_RERUN"]) {
    assert.ok(names.includes(name), name);
  }
});
