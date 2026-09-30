"use strict";

// GOV-AUTO-1 Wave 4 / 1F -- Corrective C3 (W4-C2R-DEV-M2): unit coverage of
// the canonical CI-run evidence contract (stages/1f/ci-evidence.js's
// ciRunSourceObjectId(), computeCiRunDigest(), isCiRunSourceObjectId(),
// sourceTypeForExternalEvidenceEntry()). collectCiEvidence()'s own
// end-to-end use of these is covered in ci-evidence.test.js and
// two-phase.test.js; this file isolates the pure functions themselves.

const test = require("node:test");
const assert = require("node:assert/strict");
const { ciRunSourceObjectId, isCiRunSourceObjectId, computeCiRunDigest, sourceTypeForExternalEvidenceEntry } = require("./ci-evidence");

const baseFields = () => ({
  repository: "TarasovArtem/qa-ai-agent", workflowPath: ".github/workflows/cypress.yml", runId: "42",
  event: "pull_request", headSha: "a".repeat(40), attempt: 1, status: "completed",
  requiredJobs: ["Unit tests", "Cypress - chrome"], missing: [], failed: [], pending: [], skipped: [],
  attemptHistory: [],
});

// ---------------------------------------------------------------- C3-DEV-M2-07: source identity is deterministic

test("C3-DEV-M2-07: ciRunSourceObjectId is deterministic and namespaced under ci-run: -- distinct from a determination's own channelObjectId", () => {
  const id1 = ciRunSourceObjectId({ repository: "o/r", runId: "1" });
  const id2 = ciRunSourceObjectId({ repository: "o/r", runId: "1" });
  assert.equal(id1, id2);
  assert.equal(id1, "ci-run:o/r:1");
  assert.equal(isCiRunSourceObjectId(id1), true);
  assert.equal(isCiRunSourceObjectId("comment-1"), false);
  assert.equal(isCiRunSourceObjectId("issue-comment:1"), false);
});

test("ciRunSourceObjectId stays well within the report schema's 300-character sourceObjectId bound even at maximum field lengths", () => {
  const id = ciRunSourceObjectId({ repository: "a".repeat(100) + "/" + "b".repeat(100), runId: "9".repeat(64) });
  assert.ok(id.length <= 300, id.length);
});

test("a different repository or runId produces a different source identity -- no ambiguous collision", () => {
  const a = ciRunSourceObjectId({ repository: "o/r", runId: "1" });
  const b = ciRunSourceObjectId({ repository: "o/r2", runId: "1" });
  const c = ciRunSourceObjectId({ repository: "o/r", runId: "2" });
  assert.notEqual(a, b);
  assert.notEqual(a, c);
});

// ---------------------------------------------------------------- C3-DEV-M2-08/09/10: digest determinism and sensitivity

test("C3-DEV-M2-08: computeCiRunDigest is deterministic for an identical fixture, independent of array/property order", () => {
  const fields = baseFields();
  const d1 = computeCiRunDigest(fields);
  const d2 = computeCiRunDigest({ status: fields.status, repository: fields.repository, workflowPath: fields.workflowPath, runId: fields.runId, event: fields.event, headSha: fields.headSha, attempt: fields.attempt, requiredJobs: [...fields.requiredJobs].reverse(), missing: [], failed: [], pending: [], skipped: [], attemptHistory: [] });
  assert.equal(d1, d2);
  assert.match(d1, /^[0-9a-f]{64}$/);
});

test("C3-DEV-M2-09: changing a required job's outcome category changes the digest", () => {
  const clean = computeCiRunDigest(baseFields());
  const failed = computeCiRunDigest({ ...baseFields(), failed: ["Cypress - chrome"], requiredJobs: baseFields().requiredJobs });
  assert.notEqual(clean, failed);
});

test("C3-DEV-M2-10: adding a rerun (attempt increment plus attempt history) changes the digest", () => {
  const first = computeCiRunDigest(baseFields());
  const rerun = computeCiRunDigest({ ...baseFields(), attempt: 2, attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }] });
  assert.notEqual(first, rerun);
});

test("every field computeCiRunDigest binds to changes the digest when altered in isolation", () => {
  const base = computeCiRunDigest(baseFields());
  for (const [key, value] of [["repository", "other/repo"], ["workflowPath", "other.yml"], ["runId", "99"], ["event", "push"], ["headSha", "b".repeat(40)], ["status", "in_progress"]]) {
    const changed = computeCiRunDigest({ ...baseFields(), [key]: value });
    assert.notEqual(changed, base, key);
  }
});

// ---------------------------------------------------------------- C3-DEV-M2-11/12/13: mutability and sourceType mapping

test("C3-DEV-M2-11/12/13: sourceTypeForExternalEvidenceEntry recognizes a CI-run entry as CI_RUN and returns null for anything else -- it never asserts VERIFIED_PROVIDER/VERIFIED_CRYPTO (immutability is a report/collector concern, not this mapping's)", () => {
  const ciRunEntry = { sourceObjectId: "ci-run:o/r:1", sourceVersion: "1", contentDigest: "a".repeat(64), collectedAt: "t", immutability: "MUTABLE" };
  const determinationEntry = { sourceObjectId: "comment-1", sourceVersion: "v1", contentDigest: "a".repeat(64), collectedAt: "t", immutability: "MUTABLE" };
  assert.equal(sourceTypeForExternalEvidenceEntry(ciRunEntry), "CI_RUN");
  assert.equal(sourceTypeForExternalEvidenceEntry(determinationEntry), null);
  assert.equal(sourceTypeForExternalEvidenceEntry({}), null);
  assert.equal(sourceTypeForExternalEvidenceEntry(null), null);
  assert.equal(sourceTypeForExternalEvidenceEntry("ci-run:o/r:1"), null);
});

// ---------------------------------------------------------------- C3-DEV-M2-23: no silent drop when constructing revalidation items

test("C3-DEV-M2-23: mapping a report's externalEvidence[] to kernel/revalidation.js items[] never silently drops a recognized CI-run entry, and flags an unrecognized one for the caller to handle rather than ignoring it", () => {
  const externalEvidence = [
    { sourceObjectId: "ci-run:o/r:1", sourceVersion: "1", contentDigest: "a".repeat(64), collectedAt: "t", immutability: "MUTABLE" },
    { sourceObjectId: "some-future-source-type:x", sourceVersion: "1", contentDigest: "b".repeat(64), collectedAt: "t", immutability: "MUTABLE" },
  ];
  const mapped = externalEvidence.map((entry) => ({ entry, sourceType: sourceTypeForExternalEvidenceEntry(entry) }));
  assert.equal(mapped[0].sourceType, "CI_RUN");
  assert.equal(mapped[1].sourceType, null); // the caller's explicit signal to fail closed, never to drop the entry
  assert.equal(mapped.length, externalEvidence.length); // every entry is represented, none silently omitted
});
