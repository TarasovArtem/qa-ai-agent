"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildGeneratedChangeSet, computeDigest: gcsComputeDigest, LABEL_FILE_CONTENT } = require("./generated-change-set");
const { buildGeneratedChangeSetReviewPackage, DIGEST_LABEL_PACKAGE } = require("./generated-change-set-review-package");
const { computeDigest } = require("./generated-change-set-review-canonical");
const {
  buildGeneratedChangeSetReviewRecord,
  recomputeReviewRecordDigest,
  validateApprovedGeneratedChangeSetReview,
  isValidTimestamp,
  reviewTargetKey,
  validateReviewTargetReferenceShape,
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

// =============================================================================
// Roadmap #23E-C1: fail-closed on a hand-forged, malformed reviewPackage
// (closes 23E-R-1). All fixtures below build a SELF-CONSISTENT
// packageDigest by hand (never via buildGeneratedChangeSetReviewPackage())
// so the recompute-digest check at the top of buildGeneratedChangeSetReviewRecord()
// passes and execution actually reaches the new structural validation -
// proving the fix, not merely an earlier, unrelated rejection.
// =============================================================================

function selfConsistentForgedPackage(reviewTargets, overrides = {}) {
  const content = {
    schemaVersion: 1, kind: "GeneratedChangeSetReviewPackage", projectId: "proj-1", framework: "cypress",
    automationPlanId: "plan-1", changeSetDigest: "sha256:" + "1".repeat(64), automationPlanDigest: "sha256:" + "2".repeat(64), repositoryContextDigest: "sha256:" + "3".repeat(64),
    reviewTargets,
    ...overrides,
  };
  return { ...content, packageDigest: computeDigest(DIGEST_LABEL_PACKAGE, content) };
}
const VALID_TARGET_DIGEST = "sha256:" + "4".repeat(64);

test("PRE-FIX REPRODUCTION CONTROL: a self-consistent forged package with reviewTargets:[{}] no longer throws - it returns a bounded rejection", () => {
  const pkg = selfConsistentForgedPackage([{}]);
  assert.doesNotThrow(() => {
    const result = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkg, reviewerId: "r1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
    for (const e of result.errors) assert.deepEqual(Object.keys(e).sort(), ["code", "message", "path"]);
  });
});

for (const [label, target] of [
  ["missing operation", { path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }],
  ["missing path", { operation: "CREATE", targetDigest: VALID_TARGET_DIGEST }],
  ["missing targetDigest", { operation: "CREATE", path: "cypress/e2e/x.cy.js" }],
]) {
  test(`malformed target (${label}) is a bounded rejection, never a thrown exception`, () => {
    const pkg = selfConsistentForgedPackage([target]);
    assert.doesNotThrow(() => {
      const result = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkg, reviewerId: "r1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions: [] });
      assert.equal(result.ok, false);
    });
  });
}

for (const [label, target] of [
  ["operation = null", { operation: null, path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }],
  ["operation = {}", { operation: {}, path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }],
  ["operation = 1", { operation: 1, path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }],
  ["operation = '' (empty)", { operation: "", path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }],
  ["operation = 'DELETE' (not in enum)", { operation: "DELETE", path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }],
  ["operation = 'RENAME'", { operation: "RENAME", path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }],
  ["operation = 'EXECUTE'", { operation: "EXECUTE", path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }],
  ["path = null", { operation: "CREATE", path: null, targetDigest: VALID_TARGET_DIGEST }],
  ["path = []", { operation: "CREATE", path: [], targetDigest: VALID_TARGET_DIGEST }],
  ["path = {}", { operation: "CREATE", path: {}, targetDigest: VALID_TARGET_DIGEST }],
  ["path = '' (empty)", { operation: "CREATE", path: "", targetDigest: VALID_TARGET_DIGEST }],
  ["path = '../etc/passwd' (traversal)", { operation: "CREATE", path: "../etc/passwd", targetDigest: VALID_TARGET_DIGEST }],
  ["path = '/etc/passwd' (absolute)", { operation: "CREATE", path: "/etc/passwd", targetDigest: VALID_TARGET_DIGEST }],
  ["path = 'C:\\\\evil.js' (windows drive)", { operation: "CREATE", path: "C:\\evil.js", targetDigest: VALID_TARGET_DIGEST }],
  ["targetDigest = null", { operation: "CREATE", path: "cypress/e2e/x.cy.js", targetDigest: null }],
  ["targetDigest = 42", { operation: "CREATE", path: "cypress/e2e/x.cy.js", targetDigest: 42 }],
  ["targetDigest = {}", { operation: "CREATE", path: "cypress/e2e/x.cy.js", targetDigest: {} }],
  ["targetDigest = '' (empty)", { operation: "CREATE", path: "cypress/e2e/x.cy.js", targetDigest: "" }],
  ["targetDigest too short", { operation: "CREATE", path: "cypress/e2e/x.cy.js", targetDigest: "sha256:abc" }],
  ["targetDigest uppercase hex", { operation: "CREATE", path: "cypress/e2e/x.cy.js", targetDigest: "sha256:" + "A".repeat(64) }],
  ["targetDigest missing sha256: prefix", { operation: "CREATE", path: "cypress/e2e/x.cy.js", targetDigest: "a".repeat(64) }],
] ) {
  test(`wrong-type/invalid target field (${label}) is a bounded rejection, never a thrown exception, never coerced`, () => {
    const pkg = selfConsistentForgedPackage([target]);
    assert.doesNotThrow(() => {
      const result = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkg, reviewerId: "r1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions: [] });
      assert.equal(result.ok, false, `expected rejection for ${label}`);
    });
  });
}

test("validateReviewTargetReferenceShape accepts a well-formed target and rejects a non-object target", () => {
  const errorsOk = [];
  validateReviewTargetReferenceShape({ operation: "CREATE", path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }, "$.t", errorsOk);
  assert.equal(errorsOk.length, 0);

  const errorsBad = [];
  validateReviewTargetReferenceShape(null, "$.t", errorsBad);
  assert.ok(errorsBad.length > 0);
  assert.equal(errorsBad[0].code, "INVALID_TYPE");
});

test("UNRESOLVED LOOKUP GUARD (direct): a genuinely valid, well-shaped target with a MODIFY operation that has no matching decision at all is a bounded rejection (missing-reference path, not a crash)", () => {
  const pkg = selfConsistentForgedPackage([{ operation: "MODIFY", path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST }]);
  assert.doesNotThrow(() => {
    const result = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkg, reviewerId: "r1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.message.includes("missing")));
  });
});

test("GENUINE PACKAGE NON-REGRESSION: a real, buildGeneratedChangeSetReviewPackage()-produced package still round-trips through the new structural validation with zero errors", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));
  const recResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(recResult.ok, true, JSON.stringify(recResult.errors));
  assert.equal(recResult.reviewRecord.status, "APPROVED");
});

test("ERROR PRIVACY: a malformed target's own fields (even if they carry secret-shaped content) never leak into the bounded error output", () => {
  const pkg = selfConsistentForgedPackage([{ operation: "SECRET_23E_C1_MARKER", path: "SECRET_23E_C1_MARKER", targetDigest: "SECRET_23E_C1_MARKER" }]);
  const result = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkg, reviewerId: "r1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions: [] });
  assert.equal(result.ok, false);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("SECRET_23E_C1_MARKER"), "malformed field values must never be echoed verbatim into bounded errors");
});

test("TOCTOU NON-REGRESSION: the new structural validation reads each reviewTargets field getter at most once during buildGeneratedChangeSetReviewRecord()'s own snapshot - no new post-snapshot caller reads", () => {
  const hostileTarget = {};
  Object.defineProperty(hostileTarget, "operation", { enumerable: true, configurable: true, get() { return "CREATE"; } });
  Object.defineProperty(hostileTarget, "path", { enumerable: true, configurable: true, get() { return "cypress/e2e/x.cy.js"; } });
  Object.defineProperty(hostileTarget, "targetDigest", { enumerable: true, configurable: true, get() { return VALID_TARGET_DIGEST; } });
  // Build the self-consistent forged package FIRST (this itself reads each
  // getter once, as part of the test's own forgery step - outside what
  // #23E promises to bound). Only THEN start counting, isolating exactly
  // what buildGeneratedChangeSetReviewRecord()'s own snapshot does.
  const pkg = selfConsistentForgedPackage([hostileTarget]);

  let operationReads = 0;
  let pathReads = 0;
  let digestReads = 0;
  Object.defineProperty(hostileTarget, "operation", { enumerable: true, configurable: true, get() { operationReads += 1; return "CREATE"; } });
  Object.defineProperty(hostileTarget, "path", { enumerable: true, configurable: true, get() { pathReads += 1; return "cypress/e2e/x.cy.js"; } });
  Object.defineProperty(hostileTarget, "targetDigest", { enumerable: true, configurable: true, get() { digestReads += 1; return VALID_TARGET_DIGEST; } });

  buildGeneratedChangeSetReviewRecord({ reviewPackage: pkg, reviewerId: "r1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions: [] });
  // The snapshot step reads each own property once; downstream structural
  // validation and reviewTargetKey() both then operate on the ALREADY-
  // SNAPSHOTTED plain value (never the original hostile getter object
  // again) - so total reads must stay at exactly 1 per field, not grow
  // with the number of new validation passes this correction added.
  assert.equal(operationReads, 1);
  assert.equal(pathReads, 1);
  assert.equal(digestReads, 1);
});

test("HOSTILE OBJECT NON-REGRESSION: a reviewTargets entry with a throwing operation getter is caught during snapshot and produces a bounded, private error (never a raw exception)", () => {
  const hostileTarget = { path: "cypress/e2e/x.cy.js", targetDigest: VALID_TARGET_DIGEST };
  Object.defineProperty(hostileTarget, "operation", { enumerable: true, get() { throw new Error("SECRET_GETTER_MARKER"); } });
  // A throwing getter makes it impossible to compute a genuinely self-
  // consistent packageDigest (the attacker's own forgery attempt would
  // throw identically) - so this fixture instead uses an arbitrary,
  // already-mismatched packageDigest, isolating what actually matters
  // here: does buildGeneratedChangeSetReviewRecord()'s OWN first snapshot
  // step (snapshotOwnData, which every prior #23E/#22F module already
  // guarantees catches a throwing getter and reports `null`) handle this
  // gracefully, rather than letting the throw propagate uncaught.
  const pkg = {
    schemaVersion: 1, kind: "GeneratedChangeSetReviewPackage", projectId: "proj-1", framework: "cypress",
    automationPlanId: "plan-1", changeSetDigest: "sha256:" + "1".repeat(64), automationPlanDigest: "sha256:" + "2".repeat(64), repositoryContextDigest: "sha256:" + "3".repeat(64),
    reviewTargets: [hostileTarget],
    packageDigest: "sha256:" + "9".repeat(64),
  };
  assert.doesNotThrow(() => {
    const result = buildGeneratedChangeSetReviewRecord({ reviewPackage: pkg, reviewerId: "r1", reviewedAt: "2026-08-28T10:00:00.000Z", decisions: [] });
    assert.equal(result.ok, false);
    assert.ok(!JSON.stringify(result).includes("SECRET_GETTER_MARKER"));
  });
});

test("COMPLETENESS CHECKS PRESERVED: missing/extra/duplicate decision rejection still works unchanged after the correction (non-regression)", () => {
  const { reviewPackage } = buildValidReviewPackage();
  const decisions = reviewPackage.reviewTargets.map((t) => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" }));

  // missing
  const missingResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "r1", reviewedAt: REVIEWED_AT, decisions: decisions.slice(0, 1) });
  assert.equal(missingResult.ok, false);

  // duplicate
  const dupResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "r1", reviewedAt: REVIEWED_AT, decisions: [...decisions, decisions[0]] });
  assert.equal(dupResult.ok, false);

  // extra/unknown
  const extraResult = buildGeneratedChangeSetReviewRecord({ reviewPackage, reviewerId: "r1", reviewedAt: REVIEWED_AT, decisions: [...decisions, { operation: "CREATE", path: "cypress/e2e/unrelated.cy.js", targetDigest: VALID_TARGET_DIGEST, decision: "APPROVE" }] });
  assert.equal(extraResult.ok, false);
});

// --- source integrity ------------------------------------------------------------

test("SOURCE INTEGRITY: this module's own source file contains zero NUL bytes", () => {
  const fs = require("fs");
  const buf = fs.readFileSync(require.resolve("./generated-change-set-review-record.js"));
  assert.equal(buf.filter((b) => b === 0).length, 0);
});
