"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildTestDesignReviewPackage } = require("./test-design-review-package");
const { buildTestDesignReviewRecord, validateApprovedTestDesignReview, recomputeRecordDigest, DECISIONS, STATUSES, KIND, SCHEMA_VERSION } = require("./test-design-review-record");
const { computeDigest } = require("./test-design-review-canonical");
const { ERROR_CODES } = require("../generation/errors");

const PROJECT_ID = "proj-1";
const REVIEWED_AT = "2026-08-27T10:00:00.000Z";

function requirementModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: PROJECT_ID,
    evidenceRefs: [{ id: "evidence-0001", kind: "user_input", sourceId: "user-input-0001" }],
    requirements: [{ id: "req-1", text: "The login page must show an error on invalid credentials.", evidenceRefIds: ["evidence-0001"] }],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  };
}

function testCaseModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "TestCaseModel",
    id: "tcm-1",
    projectId: PROJECT_ID,
    requirementModelId: "rm-1",
    testCases: [
      {
        id: "tc-1",
        title: "Invalid login shows error",
        objective: "Verify an error is shown on invalid credentials.",
        requirementIds: ["req-1"],
        steps: [{ action: "Submit invalid credentials.", expectedResult: "An error message is displayed.", requirementIds: ["req-1"] }],
      },
    ],
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id: "ac-1",
    projectId: PROJECT_ID,
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "AUTOMATE",
    rationale: "Well grounded.",
    evidenceRefs: [],
    rationaleEvidenceRefIds: [],
    targetFrameworks: ["cypress"],
    ...overrides,
  };
}

function frameworkCapability(overrides = {}) {
  return { projectId: PROJECT_ID, supportedFrameworks: ["cypress"], ...overrides };
}

function buildPackage(overrides = {}) {
  const result = buildTestDesignReviewPackage({
    requirementModel: requirementModel(),
    testCaseModel: testCaseModel(),
    automationCandidates: [candidate()],
    frameworkCapability: frameworkCapability(),
    expectedProjectId: PROJECT_ID,
    ...overrides,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  return result.reviewPackage;
}

function approveAllDecisions(reviewPackage) {
  return reviewPackage.reviewTargets.map((t) => ({ artifactKind: t.artifactKind, artifactId: t.artifactId, artifactDigest: t.artifactDigest, decision: "APPROVE" }));
}

// --- happy path: complete approval ----------------------------------------------

test("a complete set of APPROVE decisions produces status APPROVED", () => {
  const pkg = buildPackage();
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) });
  assert.equal(result.ok, true);
  assert.equal(result.reviewRecord.status, "APPROVED");
  assert.equal(result.reviewRecord.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.reviewRecord.kind, KIND);
  assert.equal(result.reviewRecord.projectId, PROJECT_ID);
  assert.equal(result.reviewRecord.reviewPackageDigest, pkg.reviewPackageDigest);
});

test("validateApprovedTestDesignReview accepts a fresh, matching, APPROVED record", () => {
  const pkg = buildPackage();
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) }).reviewRecord;
  const approval = validateApprovedTestDesignReview(pkg, rec, { expectedProjectId: PROJECT_ID });
  assert.equal(approval.ok, true);
});

test("the returned record is deep-frozen", () => {
  const pkg = buildPackage();
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) }).reviewRecord;
  assert.ok(Object.isFrozen(rec));
  assert.ok(Object.isFrozen(rec.decisions));
});

test("DECISIONS and STATUSES export the exact frozen vocabularies", () => {
  assert.deepEqual(DECISIONS, ["APPROVE", "REQUEST_CHANGES", "REJECT"]);
  assert.deepEqual(STATUSES, ["APPROVED", "CHANGES_REQUESTED", "REJECTED"]);
});

// --- REQUEST_CHANGES / REJECT block approval -------------------------------------

test("one REQUEST_CHANGES decision among otherwise-APPROVE decisions yields status CHANGES_REQUESTED and blocks approval", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "REQUEST_CHANGES", comment: "please clarify the rationale" };
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions }).reviewRecord;
  assert.equal(rec.status, "CHANGES_REQUESTED");
  const approval = validateApprovedTestDesignReview(pkg, rec, { expectedProjectId: PROJECT_ID });
  assert.equal(approval.ok, false);
});

test("one REJECT decision yields status REJECTED even if every other decision is APPROVE, and blocks approval", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "REJECT", comment: "not grounded" };
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions }).reviewRecord;
  assert.equal(rec.status, "REJECTED");
  const approval = validateApprovedTestDesignReview(pkg, rec, { expectedProjectId: PROJECT_ID });
  assert.equal(approval.ok, false);
});

test("REJECT outranks REQUEST_CHANGES when both are present (status is REJECTED, not CHANGES_REQUESTED)", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "REQUEST_CHANGES", comment: "x" };
  decisions[1] = { ...decisions[1], decision: "REJECT", comment: "y" };
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions }).reviewRecord;
  assert.equal(rec.status, "REJECTED");
});

// --- decision completeness attacks ------------------------------------------------

test("a missing decision entry for a reviewTargets artifact is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg).slice(0, -1);
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD));
});

test("an extra decision entry naming an artifact not in reviewTargets is rejected", () => {
  const pkg = buildPackage();
  const decisions = [...approveAllDecisions(pkg), { artifactKind: "AutomationCandidate", artifactId: "ac-does-not-exist", artifactDigest: "sha256:" + "0".repeat(64), decision: "APPROVE" }];
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE));
});

test("a duplicate decision entry for the same artifact is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions.push({ ...decisions[0] });
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.DUPLICATE_ID));
});

test("a decision entry with a wrong (stale) artifactDigest is treated as not matching, not as approving the current artifact", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], artifactDigest: "sha256:" + "1".repeat(64) };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
});

test("a decision entry with the wrong artifactKind for a real artifactId/digest is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], artifactKind: "TestCaseModel" };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
});

test("an unknown decision value is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "MAYBE" };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.INVALID_ENUM));
});

test("an unknown field on a decision entry is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], extraField: true };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.UNKNOWN_FIELD));
});

// --- human-feedback bound tests ---------------------------------------------------

test("REQUEST_CHANGES without a comment is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "REQUEST_CHANGES" };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD));
});

test("REJECT without a comment is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "REJECT" };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
});

test("APPROVE without a comment is accepted (comment is optional for APPROVE)", () => {
  const pkg = buildPackage();
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) });
  assert.equal(result.ok, true);
});

test("an overlong comment is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "REJECT", comment: "x".repeat(5000) };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
});

test("an empty/whitespace-only comment on REJECT is rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "REJECT", comment: "   " };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
});

// --- reviewerId / reviewedAt validation -------------------------------------------

test("a missing/empty reviewerId is rejected", () => {
  const pkg = buildPackage();
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) });
  assert.equal(result.ok, false);
});

test("a non-ISO-8601 reviewedAt is rejected", () => {
  const pkg = buildPackage();
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: "27 Aug 2026", decisions: approveAllDecisions(pkg) });
  assert.equal(result.ok, false);
});

test("a reviewedAt with a non-UTC offset is rejected (UTC 'Z' only)", () => {
  const pkg = buildPackage();
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: "2026-08-27T10:00:00.000+02:00", decisions: approveAllDecisions(pkg) });
  assert.equal(result.ok, false);
});

// --- stale-approval regression -----------------------------------------------------

test("STALE APPROVAL: a record approved for package A does not approve package B, built from a mutated candidate with the same ids", () => {
  const pkgA = buildPackage();
  const recA = buildTestDesignReviewRecord({ reviewPackage: pkgA, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkgA) }).reviewRecord;

  const pkgB = buildPackage({ automationCandidates: [candidate({ rationale: "A materially different rationale after the fact." })] });
  assert.notEqual(pkgA.reviewPackageDigest, pkgB.reviewPackageDigest, "sanity: the mutated package must actually have a different digest");

  const staleApproval = validateApprovedTestDesignReview(pkgB, recA, { expectedProjectId: PROJECT_ID });
  assert.equal(staleApproval.ok, false);
  assert.ok(staleApproval.errors.some((e) => e.code === ERROR_CODES.INVALID_REFERENCE));
});

// --- cross-project / cross-package replay ------------------------------------------

test("CROSS-PROJECT REPLAY: an APPROVED record from one project cannot approve a same-content-shape package from another project", () => {
  const pkgProjA = buildPackage();
  const recProjA = buildTestDesignReviewRecord({ reviewPackage: pkgProjA, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkgProjA) }).reviewRecord;

  const pkgProjB = buildTestDesignReviewPackage({
    requirementModel: requirementModel({ projectId: "proj-2" }),
    testCaseModel: testCaseModel({ projectId: "proj-2" }),
    automationCandidates: [candidate({ projectId: "proj-2" })],
    frameworkCapability: frameworkCapability({ projectId: "proj-2" }),
    expectedProjectId: "proj-2",
  }).reviewPackage;

  const replay = validateApprovedTestDesignReview(pkgProjB, recProjA, { expectedProjectId: "proj-2" });
  assert.equal(replay.ok, false);
});

test("CROSS-PACKAGE REPLAY: a record approved for one package cannot approve an unrelated package in the same project", () => {
  const pkg1 = buildPackage();
  const rec1 = buildTestDesignReviewRecord({ reviewPackage: pkg1, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg1) }).reviewRecord;

  const pkg2 = buildPackage({ requirementModel: requirementModel({ id: "rm-2" }), testCaseModel: testCaseModel({ id: "tcm-2", requirementModelId: "rm-2" }), automationCandidates: [candidate({ testCaseModelId: "tcm-2" })] });

  const replay = validateApprovedTestDesignReview(pkg2, rec1, { expectedProjectId: PROJECT_ID });
  assert.equal(replay.ok, false);
});

test("expectedProjectId mismatched against an otherwise-valid, self-consistent approval is rejected", () => {
  const pkg = buildPackage();
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) }).reviewRecord;
  const result = validateApprovedTestDesignReview(pkg, rec, { expectedProjectId: "some-other-project" });
  assert.equal(result.ok, false);
});

// --- digest tampering / status tampering --------------------------------------------

test("DIGEST TAMPERING: a record whose stored recordDigest was altered fails recomputeRecordDigest verification", () => {
  const pkg = buildPackage();
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) }).reviewRecord;
  const tampered = { ...rec, recordDigest: "sha256:" + "f".repeat(64) };
  assert.notEqual(recomputeRecordDigest(tampered), tampered.recordDigest);
  const approval = validateApprovedTestDesignReview(pkg, tampered, { expectedProjectId: PROJECT_ID });
  assert.equal(approval.ok, false);
});

test("STATUS TAMPERING: a CHANGES_REQUESTED record with its status field hand-flipped to APPROVED is rejected via the digest mismatch, never trusted", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = { ...decisions[0], decision: "REQUEST_CHANGES", comment: "fix it" };
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions }).reviewRecord;
  assert.equal(rec.status, "CHANGES_REQUESTED");
  const forged = { ...rec, status: "APPROVED" };
  const approval = validateApprovedTestDesignReview(pkg, forged, { expectedProjectId: PROJECT_ID });
  assert.equal(approval.ok, false);
});

test("PACKAGE TAMPERING: a reviewPackage with a hand-edited field (digest no longer matches) fails validateApprovedTestDesignReview even with an otherwise-valid record", () => {
  const pkg = buildPackage();
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) }).reviewRecord;
  const tamperedPkg = { ...pkg, projectId: PROJECT_ID, automationCandidates: [{ ...pkg.automationCandidates[0], decision: "DO_NOT_AUTOMATE" }] };
  const approval = validateApprovedTestDesignReview(tamperedPkg, rec, { expectedProjectId: PROJECT_ID });
  assert.equal(approval.ok, false);
});

// --- decision-array prototype / cycle / getter attacks ------------------------------

test("a __proto__ own key inside a decision entry never pollutes the global prototype and is safely rejected", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  decisions[0] = JSON.parse(`{"__proto__": {"polluted": true}, "artifactKind": "${decisions[0].artifactKind}", "artifactId": "${decisions[0].artifactId}", "artifactDigest": "${decisions[0].artifactDigest}", "decision": "APPROVE"}`);
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(({}).polluted, undefined);
  assert.equal(result.ok, false);
});

test("a caller array with an overridden .map on decisions is never invoked and is safely rejected", () => {
  const pkg = buildPackage();
  let calls = 0;
  const decisions = approveAllDecisions(pkg);
  decisions.map = () => { calls += 1; return []; };
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(calls, 0);
  assert.equal(result.ok, false);
});

test("a getter that throws while reading a decision entry field is caught and reported as a bounded structural error", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  Object.defineProperty(decisions[0], "decision", {
    get() { throw new Error("boom"); },
    enumerable: true,
  });
  assert.doesNotThrow(() => buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions }));
  const result = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions });
  assert.equal(result.ok, false);
});

test("a cyclic reviewPackage passed directly to buildTestDesignReviewRecord is safely rejected, never causing a stack overflow", () => {
  const pkg = buildPackage();
  const cyclic = { ...pkg };
  cyclic.self = cyclic;
  assert.doesNotThrow(() => buildTestDesignReviewRecord({ reviewPackage: cyclic, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) }));
  const result = buildTestDesignReviewRecord({ reviewPackage: cyclic, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions: approveAllDecisions(pkg) });
  assert.equal(result.ok, false);
});

// --- round-trip / determinism --------------------------------------------------------

test("building a record twice from identical inputs produces the same recordDigest (determinism)", () => {
  const pkg = buildPackage();
  const decisions = approveAllDecisions(pkg);
  const recA = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions }).reviewRecord;
  const recB = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions }).reviewRecord;
  assert.equal(recA.recordDigest, recB.recordDigest);
});

test("decisions in the record are ordered by reviewPackage.reviewTargets order, never by caller-supplied decisions[] order", () => {
  const pkg = buildPackage();
  const decisions = [...approveAllDecisions(pkg)].reverse();
  const rec = buildTestDesignReviewRecord({ reviewPackage: pkg, reviewerId: "reviewer-1", reviewedAt: REVIEWED_AT, decisions }).reviewRecord;
  assert.deepEqual(
    rec.decisions.map((d) => d.artifactKind + ":" + d.artifactId),
    pkg.reviewTargets.map((t) => t.artifactKind + ":" + t.artifactId)
  );
});

// --- no side effects -------------------------------------------------------------------

test("this module performs no filesystem/network/child_process/provider access (source scan)", () => {
  const fs = require("node:fs");
  const src = fs.readFileSync(require.resolve("./test-design-review-record.js"), "utf8");
  assert.ok(!/require\(["']node:fs["']\)/.test(src));
  assert.ok(!/require\(["']fs["']\)/.test(src));
  assert.ok(!/require\(["']node:child_process["']\)/.test(src));
  assert.ok(!/require\(["']child_process["']\)/.test(src));
  assert.ok(!/require\(["']node:https?["']\)/.test(src));
});

// --- source-integrity regression (#22F-C1 / finding S-1) -------------------------------
//
// A prior revision of this file contained two literal NUL bytes inside its
// internal reviewTargetKey() helper (an accidental corruption, not a design
// choice) - Git and GitHub's own PR diff view both treat a file containing a
// NUL byte as binary, which made this file's diff unreviewable on GitHub.
// This test reads the module's own source as raw bytes and permanently
// guards against that regression recurring, in this file or any other #22F
// source file.

test("SOURCE INTEGRITY: this module's own source file contains zero NUL bytes and is plain, GitHub-diffable text", () => {
  const fs = require("node:fs");
  const buf = fs.readFileSync(require.resolve("./test-design-review-record.js"));
  const nulCount = buf.filter((b) => b === 0).length;
  assert.equal(nulCount, 0, "a NUL byte anywhere in this source file makes Git/GitHub treat the whole file as binary, defeating PR review");
  // every byte must be a printable/whitespace ASCII character - this module
  // is plain JS source, never binary or extended-charset content.
  const hasUnexpectedControlByte = buf.some((b) => b < 32 && b !== 9 && b !== 10 && b !== 13);
  assert.equal(hasUnexpectedControlByte, false, "an unexpected control byte was found in this source file");
});

test("SOURCE INTEGRITY: every sibling #22F source file also contains zero NUL bytes", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  for (const name of ["test-design-review-canonical.js", "test-design-review-package.js", "test-design-review-record.js"]) {
    const buf = fs.readFileSync(path.join(__dirname, name));
    assert.equal(buf.filter((b) => b === 0).length, 0, `${name} must contain zero NUL bytes`);
  }
});

// --- key-encoding collision safety (#22F-C1 / finding S-1 correction) ------------------
//
// reviewTargetKey() is an internal (unexported) helper, so these tests
// exercise it only through the public buildTestDesignReviewRecord() API,
// per the same "do not expand the public API merely to test a private
// helper" convention used throughout this codebase. A hand-assembled but
// digest-self-consistent TestDesignReviewPackage-shaped object lets these
// tests supply artifactKind/artifactId pairs that would collide under a
// naive, delimiter-free string concatenation - proving the actual encoding
// used in production does NOT collide.

const COLLISION_DIGEST = "sha256:" + "1".repeat(64);

function syntheticPackage(reviewTargets) {
  const content = {
    schemaVersion: 1,
    kind: "TestDesignReviewPackage",
    projectId: PROJECT_ID,
    requirementModel: {},
    testCaseModel: {},
    automationCandidates: [],
    frameworkCapability: { projectId: PROJECT_ID, supportedFrameworks: [] },
    projectProfile: null,
    reviewTargets,
  };
  return { ...content, reviewPackageDigest: computeDigest("test-design-review-package:v1", content) };
}

test("KEY COLLISION SAFETY: (kind='ab', id='c') and (kind='a', id='bc') - which collide under naive concatenation - are treated as distinct review targets", () => {
  const targetA = { artifactKind: "ab", artifactId: "c", artifactDigest: COLLISION_DIGEST };
  const targetB = { artifactKind: "a", artifactId: "bc", artifactDigest: COLLISION_DIGEST };
  const pkg = syntheticPackage([targetA, targetB]);

  // approving ONLY target A must still report target B as missing - if the
  // internal key encoding collided, B would be incorrectly satisfied by A's
  // decision and this record would be accepted.
  const onlyA = buildTestDesignReviewRecord({
    reviewPackage: pkg,
    reviewerId: "reviewer-1",
    reviewedAt: REVIEWED_AT,
    decisions: [{ artifactKind: "ab", artifactId: "c", artifactDigest: COLLISION_DIGEST, decision: "APPROVE" }],
  });
  assert.equal(onlyA.ok, false);
  assert.ok(onlyA.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD));

  // approving both distinct targets succeeds normally.
  const both = buildTestDesignReviewRecord({
    reviewPackage: pkg,
    reviewerId: "reviewer-1",
    reviewedAt: REVIEWED_AT,
    decisions: [
      { artifactKind: "ab", artifactId: "c", artifactDigest: COLLISION_DIGEST, decision: "APPROVE" },
      { artifactKind: "a", artifactId: "bc", artifactDigest: COLLISION_DIGEST, decision: "APPROVE" },
    ],
  });
  assert.equal(both.ok, true);
  assert.equal(both.reviewRecord.status, "APPROVED");
});

test("KEY COLLISION SAFETY: a second boundary split ('a','bcd' vs 'ab','cd' vs 'abc','d') also produces three distinct targets, none satisfying another", () => {
  const targets = [
    { artifactKind: "a", artifactId: "bcd", artifactDigest: COLLISION_DIGEST },
    { artifactKind: "ab", artifactId: "cd", artifactDigest: COLLISION_DIGEST },
    { artifactKind: "abc", artifactId: "d", artifactDigest: COLLISION_DIGEST },
  ];
  const pkg = syntheticPackage(targets);

  // approving only the first of the three must leave the other two missing.
  const onlyFirst = buildTestDesignReviewRecord({
    reviewPackage: pkg,
    reviewerId: "reviewer-1",
    reviewedAt: REVIEWED_AT,
    decisions: [{ artifactKind: "a", artifactId: "bcd", artifactDigest: COLLISION_DIGEST, decision: "APPROVE" }],
  });
  assert.equal(onlyFirst.ok, false);
  assert.ok(onlyFirst.errors.some((e) => e.code === ERROR_CODES.MISSING_FIELD));

  const allThree = buildTestDesignReviewRecord({
    reviewPackage: pkg,
    reviewerId: "reviewer-1",
    reviewedAt: REVIEWED_AT,
    decisions: targets.map((t) => ({ artifactKind: t.artifactKind, artifactId: t.artifactId, artifactDigest: t.artifactDigest, decision: "APPROVE" })),
  });
  assert.equal(allThree.ok, true);
  assert.equal(allThree.reviewRecord.status, "APPROVED");
});

// --- S-2: plain digest is integrity, not provenance (documented, non-blocking) ---------
//
// This test intentionally demonstrates, and documents, an ACCEPTED
// domain-layer limitation (see this module's own docstring,
// FUTURE_HUMAN_DECISION_PROVENANCE_GUARD): computeDigest()/canonicalStringify()
// are plain, unkeyed SHA-256 - not an HMAC or signature - so a caller with
// access to this module's exported primitives can hand-construct a
// structurally valid, digest-self-consistent TestDesignReviewRecord without
// ever going through buildTestDesignReviewRecord(). validateApprovedTestDesignReview()
// therefore proves CONTENT INTEGRITY (the record was not altered after this
// exact shape was serialized) and STALE-APPROVAL PROTECTION (an approval is
// bound to one exact reviewPackage content), but it does NOT and cannot
// prove that a human, or the buildTestDesignReviewRecord() completeness
// checks, ever produced the record. This is expected and accepted at the
// domain layer for #22F; provenance/authentication is explicitly deferred
// to a future, authenticated orchestration layer (FUTURE_HUMAN_DECISION_PROVENANCE_GUARD).

test("DOCUMENTED LIMITATION: a hand-constructed record with a correctly recomputed digest passes validateApprovedTestDesignReview() - this is expected integrity-only behavior, not a bypass of any #22F claim", () => {
  const pkg = buildPackage();
  const forgedContent = {
    schemaVersion: SCHEMA_VERSION,
    kind: KIND,
    projectId: pkg.projectId,
    reviewPackageDigest: pkg.reviewPackageDigest,
    reviewerId: "hand-constructed-reviewer-id",
    reviewedAt: REVIEWED_AT,
    decisions: approveAllDecisions(pkg).map((d) => ({ ...d, comment: null })),
    status: "APPROVED",
  };
  const forgedRecord = { ...forgedContent, recordDigest: computeDigest("test-design-review-record:v1", forgedContent) };

  const approval = validateApprovedTestDesignReview(pkg, forgedRecord, { expectedProjectId: PROJECT_ID });
  assert.equal(approval.ok, true, "a self-consistent digest proves integrity, not provenance - see FUTURE_HUMAN_DECISION_PROVENANCE_GUARD");
});
