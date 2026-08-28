"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGeneratedChangeSet, computeDigest: gcsComputeDigest, LABEL_FILE_CONTENT } = require("./generated-change-set");
const { buildGeneratedChangeSetReviewPackage } = require("./generated-change-set-review-package");
const {
  buildGeneratedChangeSetReviewRecord,
  recomputeReviewRecordDigest,
  validateApprovedGeneratedChangeSetReview,
  isValidTimestamp,
  reviewTargetKey,
  DECISIONS,
  STATUSES,
} = require("./generated-change-set-review-record");

function validPlan(overrides = {}) {
  return {
    schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1",
    automationCandidateId: "cand-1", framework: "cypress",
    plannedChanges: [
      { path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "Add coverage." },
      { path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "Update it." },
    ],
    ...overrides,
  };
}
function validContext(overrides = {}) {
  return {
    projectId: "proj-1", framework: "cypress",
    repositoryEvidence: [
      { evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" },
      { evidenceRef: { location: "cypress/e2e/tests/existing_spec.cy.js" }, content: "describe('old', () => {});" },
    ],
    ...overrides,
  };
}

function buildValidReviewPackage() {
  const plan = validPlan();
  const context = validContext();
  const changes = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('x', () => {});" },
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: gcsComputeDigest(LABEL_FILE_CONTENT, "describe('old', () => {});"), content: "describe('new', () => {});" },
  ];
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const pkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(pkgResult.ok, true, JSON.stringify(pkgResult.errors));
  return { plan, context, generatedChangeSet: built.generatedChangeSet, reviewPackage: pkgResult.reviewPackage };
}

function allApproveDecisions(reviewPackage) {
  return reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
}

const REVIEWED_AT = "2026-08-28T10:00:00.000Z";

// --- valid record / status derivation ----------------------------------------

test("all APPROVE decisions produce status APPROVED, and the approval gate passes", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  assert.equal(recResult.reviewRecord.status, "APPROVED");
  assert.equal(recResult.reviewRecord.projectId, "proj-1");
  assert.equal(recResult.reviewRecord.packageDigest, reviewPackage.packageDigest);
  const gate = validateApprovedGeneratedChangeSetReview(reviewPackage, recResult.reviewRecord, { expectedProjectId: "proj-1" });
  assert.equal(gate.ok, true, JSON.stringify(gate.errors));
});

test("a single REQUEST_CHANGES decision (with required reason) produces status CHANGES_REQUESTED, gate fails", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { ...decisions[0], decision: "REQUEST_CHANGES", reason: "please fix the selector" };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  assert.equal(recResult.reviewRecord.status, "CHANGES_REQUESTED");
  const gate = validateApprovedGeneratedChangeSetReview(reviewPackage, recResult.reviewRecord, {});
  assert.equal(gate.ok, false);
});

test("a single REJECT decision (with required reason) produces status REJECTED, gate fails", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { ...decisions[0], decision: "REJECT", reason: "wrong framework usage" };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  assert.equal(recResult.reviewRecord.status, "REJECTED");
  const gate = validateApprovedGeneratedChangeSetReview(reviewPackage, recResult.reviewRecord, {});
  assert.equal(gate.ok, false);
});

for (const [a, b, expected] of [
  ["APPROVE", "REQUEST_CHANGES", "CHANGES_REQUESTED"],
  ["APPROVE", "REJECT", "REJECTED"],
  ["REQUEST_CHANGES", "REJECT", "REJECTED"],
]) {
  test(`mixed decisions [${a}, ${b}] derive status ${expected}`, () => {
    const { reviewPackage } = buildValidReviewPackage();
    const decisions = allApproveDecisions(reviewPackage);
    decisions[0] = { ...decisions[0], decision: a, reason: a === "APPROVE" ? undefined : "reason" };
    decisions[1] = { ...decisions[1], decision: b, reason: b === "APPROVE" ? undefined : "reason" };
    const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
    assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
    assert.equal(recResult.reviewRecord.status, expected);
  });
}

// --- decision completeness ----------------------------------------------------

test("missing decision (fewer entries than reviewTargets) is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage).slice(0, 1);
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
  assert.ok(recResult.errors.some((e) => e.message.includes("missing")));
});

test("extra decision (unknown target) is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = [...allApproveDecisions(reviewPackage), { operation: "CREATE", path: "cypress/e2e/tests/unrelated.cy.js", targetDigest: "sha256:" + "0".repeat(64), decision: "APPROVE" }];
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
});

test("duplicate decision for the same target is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const base = allApproveDecisions(reviewPackage);
  const decisions = [...base, base[0]];
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
  assert.ok(recResult.errors.some((e) => e.code === "DUPLICATE_ID"));
});

test("a duplicate decision that is byte-identical to another is still rejected (no silent dedup)", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const base = allApproveDecisions(reviewPackage);
  const decisions = [base[0], { ...base[0] }, base[1]];
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
});

// --- target-digest binding (path-only replay attack) --------------------------

test("wrong targetDigest for a real path is rejected (path-only approval attack)", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { ...decisions[0], targetDigest: "sha256:" + "0".repeat(64) };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
});

test("a decision for a stale target digest (older content at the same path) does not satisfy the newer target", () => {
  const { plan, context, reviewPackage: oldPackage } = buildValidReviewPackage();
  const oldDecisions = allApproveDecisions(oldPackage);
  // Build a NEW change set with different CREATE content at the same path.
  const newChanges = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('DIFFERENT', () => {});" },
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: gcsComputeDigest(LABEL_FILE_CONTENT, "describe('old', () => {});"), content: "describe('new', () => {});" },
  ];
  const newBuilt = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: newChanges });
  assert.equal(newBuilt.ok, true);
  const newPkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: newBuilt.generatedChangeSet });
  assert.equal(newPkgResult.ok, true);
  // Attempt to build a record for the NEW package using the OLD (stale) decisions.
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: newPkgResult.reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: oldDecisions });
  assert.equal(recResult.ok, false);
});

// --- reason / comment bounds --------------------------------------------------

test("REQUEST_CHANGES without a reason is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { operation: decisions[0].operation, path: decisions[0].path, targetDigest: decisions[0].targetDigest, decision: "REQUEST_CHANGES" };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
});

test("REJECT without a reason is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { operation: decisions[0].operation, path: decisions[0].path, targetDigest: decisions[0].targetDigest, decision: "REJECT" };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
});

test("APPROVE with no reason is accepted (reason is optional for APPROVE)", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
});

test("an overlong reason is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { ...decisions[0], decision: "REJECT", reason: "x".repeat(4001) };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
});

test("an overlong top-level comment is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage), comment: "x".repeat(4001) });
  assert.equal(recResult.ok, false);
});

test("a bounded top-level comment is accepted and preserved", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage), comment: "Looks good overall." });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  assert.equal(recResult.reviewRecord.comment, "Looks good overall.");
});

// --- reviewerId / reviewedAt --------------------------------------------------

test("a missing/empty reviewerId is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  assert.equal(recResult.ok, false);
});

test("isValidTimestamp accepts UTC ISO-8601 and rejects local offsets / bare dates", () => {
  assert.equal(isValidTimestamp("2026-08-28T10:00:00.000Z"), true);
  assert.equal(isValidTimestamp("2026-08-28T10:00:00Z"), true);
  assert.equal(isValidTimestamp("2026-08-28T10:00:00+02:00"), false);
  assert.equal(isValidTimestamp("2026-08-28"), false);
  assert.equal(isValidTimestamp("not a date"), false);
});

test("a non-ISO-8601 reviewedAt is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: "not a date", decisions: allApproveDecisions(reviewPackage) });
  assert.equal(recResult.ok, false);
});

// --- reviewPackage integrity at record-build time ----------------------------

test("a reviewPackage with a tampered packageDigest is rejected at record-build time (not only later at the gate)", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const tamperedPackage = { ...reviewPackage, packageDigest: "sha256:" + "0".repeat(64) };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage: tamperedPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  assert.equal(recResult.ok, false);
});

// --- record digest / tamper detection ----------------------------------------

test("recomputeReviewRecordDigest matches for a genuine record, and detects tamper", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  assert.equal(recomputeReviewRecordDigest(recResult.reviewRecord), recResult.reviewRecord.recordDigest);
  const tampered = { ...recResult.reviewRecord, status: "REJECTED" };
  assert.notEqual(recomputeReviewRecordDigest(tampered), recResult.reviewRecord.recordDigest);
});

test("STATUS TAMPERING: a CHANGES_REQUESTED record with status hand-flipped to APPROVED fails the gate via digest mismatch", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { ...decisions[0], decision: "REQUEST_CHANGES", reason: "x" };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  const tampered = { ...recResult.reviewRecord, status: "APPROVED" };
  const gate = validateApprovedGeneratedChangeSetReview(reviewPackage, tampered, {});
  assert.equal(gate.ok, false);
});

// --- approval gate: stale / replay protection --------------------------------

test("STALE APPROVAL: an approved record does not approve a package built from a different (but same-shaped) GeneratedChangeSet", () => {
  const { plan, context, reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  assert.equal(recResult.ok, true);

  const driftedChanges = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('DRIFTED', () => {});" },
    { operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: gcsComputeDigest(LABEL_FILE_CONTENT, "describe('old', () => {});"), content: "describe('new', () => {});" },
  ];
  const driftedBuilt = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: driftedChanges });
  assert.equal(driftedBuilt.ok, true);
  const driftedPkgResult = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: driftedBuilt.generatedChangeSet });
  assert.equal(driftedPkgResult.ok, true);

  const gate = validateApprovedGeneratedChangeSetReview(driftedPkgResult.reviewPackage, recResult.reviewRecord, {});
  assert.equal(gate.ok, false);
});

test("CROSS-PACKAGE REPLAY: a record approved for one package cannot approve an unrelated package in the same project", () => {
  const { reviewPackage: packageA } = buildValidReviewPackage();
  const recResultA = buildGeneratedChangeSetReviewRecord({ reviewPackage: packageA, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(packageA) });
  assert.equal(recResultA.ok, true);

  // A different, unrelated valid change set/package in the same project.
  const otherPlan = validPlan({ id: "plan-2", plannedChanges: [{ path: "cypress/e2e/tests/other.cy.js", operation: "CREATE", purpose: "Other." }] });
  const otherContext = validContext({ repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }] });
  const otherBuilt = buildGeneratedChangeSet({ automationPlan: otherPlan, repositoryContext: otherContext, changes: [{ operation: "CREATE", path: "cypress/e2e/tests/other.cy.js", baseContentDigest: null, content: "describe('other', () => {});" }] });
  assert.equal(otherBuilt.ok, true);
  const packageBResult = buildGeneratedChangeSetReviewPackage({ automationPlan: otherPlan, repositoryContext: otherContext, generatedChangeSet: otherBuilt.generatedChangeSet });
  assert.equal(packageBResult.ok, true);

  const gate = validateApprovedGeneratedChangeSetReview(packageBResult.reviewPackage, recResultA.reviewRecord, {});
  assert.equal(gate.ok, false);
});

test("CROSS-PROJECT REPLAY: expectedProjectId mismatch is rejected even for an otherwise-valid approval", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  const gate = validateApprovedGeneratedChangeSetReview(reviewPackage, recResult.reviewRecord, { expectedProjectId: "OTHER-PROJECT" });
  assert.equal(gate.ok, false);
});

test("PACKAGE TAMPERING: a reviewPackage with a hand-edited field (digest no longer matches) fails the gate even with an otherwise-valid record", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  const tamperedPackage = { ...reviewPackage, reviewTargets: [{ ...reviewPackage.reviewTargets[0], purpose: "HAND-EDITED" }, reviewPackage.reviewTargets[1]] };
  const gate = validateApprovedGeneratedChangeSetReview(tamperedPackage, recResult.reviewRecord, {});
  assert.equal(gate.ok, false);
});

// --- approval gate authority: proves NO write/execute/merge capability ------

test("AUTHORITY TEST: a fully APPROVED valid review exposes no write/apply/commit/push/execute/merge operation anywhere in the module", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  const gate = validateApprovedGeneratedChangeSetReview(reviewPackage, recResult.reviewRecord, {});
  assert.equal(gate.ok, true);
  // The gate result itself carries no capability - just {ok, errors}.
  assert.deepEqual(Object.keys(gate).sort(), ["errors", "ok"]);

  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("./generated-change-set-review-record.js"), "utf8");
  for (const forbidden of ["writeFile", "appendFile", "unlink(", "require(\"child_process\")", "require(\"node:child_process\")", "exec(", "spawn(", "git ", "gh pr", "octokit", "createPullRequest"]) {
    assert.ok(!src.includes(forbidden), `production source must not contain "${forbidden}"`);
  }
});

// --- reviewTargetKey collision safety (mirrors #22F's own hardened check) ---

test("KEY COLLISION SAFETY: operation='a'/path='bc' and operation='ab'/path='c' - which collide under naive concatenation - are treated as distinct targets", () => {
  const digest = "sha256:" + "1".repeat(64);
  const keyA = reviewTargetKey({ operation: "a", path: "bc", targetDigest: digest });
  const keyB = reviewTargetKey({ operation: "ab", path: "c", targetDigest: digest });
  assert.notEqual(keyA, keyB);
});

// --- immutability / JSON round trip ------------------------------------------

test("returned reviewRecord is deeply immutable", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  const rec = recResult.reviewRecord;
  assert.ok(Object.isFrozen(rec));
  assert.ok(Object.isFrozen(rec.decisions));
  assert.ok(Object.isFrozen(rec.decisions[0]));
  assert.throws(() => { "use strict"; rec.status = "REJECTED"; });
});

test("reviewRecord is JSON-round-trip stable with the same recordDigest", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: allApproveDecisions(reviewPackage) });
  const roundTripped = JSON.parse(JSON.stringify(recResult.reviewRecord));
  assert.equal(recomputeReviewRecordDigest(roundTripped), recResult.reviewRecord.recordDigest);
});

test("decision input order does not affect the resulting record (canonicalized to reviewTargets order)", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisionsForward = allApproveDecisions(reviewPackage);
  const decisionsReversed = [...decisionsForward].reverse();
  const recA = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: decisionsForward });
  const recB = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: decisionsReversed });
  assert.equal(recA.ok, true);
  assert.equal(recB.ok, true);
  assert.equal(recA.reviewRecord.recordDigest, recB.reviewRecord.recordDigest);
});

// --- hostile-object matrix -----------------------------------------------------

test("a __proto__-named own key on a decision entry is rejected as an ordinary unknown field, never pollutes the prototype", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  const hostile = Object.defineProperty({ ...decisions[0] }, "__proto__", { value: { polluted: true }, enumerable: true, configurable: true });
  decisions[0] = hostile;
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
  assert.equal(({}).polluted, undefined);
});

test("a decisions array with a hostile overridden .map property is never invoked and is safely rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  let invoked = false;
  Object.defineProperty(decisions, "map", { value: () => { invoked = true; return []; }, enumerable: true, configurable: true });
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(invoked, false);
  assert.equal(recResult.ok, false);
});

test("a getter that throws while reading a decision entry field is caught and reported as a bounded structural error", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  const hostile = { ...decisions[0] };
  Object.defineProperty(hostile, "decision", { enumerable: true, get() { throw new Error("SECRET_RECORD_MARKER"); } });
  decisions[0] = hostile;
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
  assert.ok(!JSON.stringify(recResult).includes("SECRET_RECORD_MARKER"));
});

test("a cyclic decisions array is safely rejected, never causing a stack overflow", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions.push(decisions);
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
});

// --- reviewer identity / decision authenticity limitations (documented) -----

test("DOCUMENTED LIMITATION: a hand-constructed record with a correctly recomputed digest passes the gate - this is expected integrity-only behavior, not authentication", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const { computeDigest } = require("./generated-change-set-review-canonical");
  const { DIGEST_LABEL_RECORD } = require("./generated-change-set-review-record");
  const decisions = reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE", reason: null }));
  const recordContent = {
    schemaVersion: 1, kind: "GeneratedChangeSetReviewRecord", projectId: reviewPackage.projectId,
    packageDigest: reviewPackage.packageDigest, reviewerId: "totally-fabricated-reviewer", reviewedAt: REVIEWED_AT,
    decisions, status: "APPROVED", comment: null,
  };
  const handConstructed = { ...recordContent, recordDigest: computeDigest(DIGEST_LABEL_RECORD, recordContent) };
  const gate = validateApprovedGeneratedChangeSetReview(reviewPackage, handConstructed, {});
  assert.equal(gate.ok, true, "hand-construction bypassing buildGeneratedChangeSetReviewRecord() is expected to pass integrity checks - this proves the digest is content-identity only, never authentication");
});

// --- enums ---------------------------------------------------------------------

test("DECISIONS and STATUSES enums are exactly the documented values", () => {
  assert.deepEqual([...DECISIONS], ["APPROVE", "REQUEST_CHANGES", "REJECT"]);
  assert.deepEqual([...STATUSES], ["APPROVED", "CHANGES_REQUESTED", "REJECTED"]);
});

test("an unknown decision value is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { ...decisions[0], decision: "AUTO_APPROVE" };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
});

test("an unknown field on a decision entry is rejected", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = allApproveDecisions(reviewPackage);
  decisions[0] = { ...decisions[0], safeToApply: true };
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, false);
  assert.ok(recResult.errors.some((e) => e.code === "UNKNOWN_FIELD"));
});

// --- source integrity ------------------------------------------------------------

test("SOURCE INTEGRITY: this module's own source file contains zero NUL bytes", () => {
  const fs = require("fs");
  const buf = fs.readFileSync(require.resolve("./generated-change-set-review-record.js"));
  assert.equal(buf.filter((b) => b === 0).length, 0);
});
