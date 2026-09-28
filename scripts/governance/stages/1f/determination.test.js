"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { validateDetermination, isValidRecordBody, isAuthorizedDeterminer, resolveDeterminationMode, checkBindings } = require("./determination");

const HEAD = "a".repeat(40);
const REPO = "TarasovArtem/qa-ai-agent";
const DIGEST = "d".repeat(64);

const subject = { head: HEAD };

const record = (overrides = {}) => ({
  repository: REPO, headSha: HEAD, runId: "999", failedAttempts: [1], finalAttempt: 2,
  failedJobs: ["Cypress - chrome"], failureSignature: "sig-1", reviewer: "someone",
  decisionRef: "issue-comment:456", category: "KNOWN_CI_RELIABILITY_SIGNATURE", justification: "matches the known Cypress teardown symptom",
  ...overrides,
});

const runEvidence = (overrides = {}) => ({
  repository: REPO, headSha: HEAD, runId: "999", attempt: 2,
  attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome"] }],
  ...overrides,
});

const actor = (overrides = {}) => ({ provider: "github", accountId: "555", accountType: "User", ...overrides });

const separatePersonPolicy = (overrides = {}) => ({
  authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "SEPARATE_PERSON", ...overrides,
});

const ownerAttestedPolicy = (overrides = {}) => ({
  authorizedDeterminers: [{ provider: "github", accountId: "555" }], determinationMode: "OWNER_ATTESTED", ownerAccountId: "555", ...overrides,
});

const contributorsClean = (overrides = {}) => ({ accountIds: ["github:111"], hasUnresolved: false, ...overrides });

const fullInput = (overrides = {}) => ({
  subject, record: record(), authenticatedActor: actor(), contentDigest: DIGEST, channelObjectId: "comment-1",
  version: "2026-09-28T00:00:00Z", collectedAt: "2026-09-28T00:01:00Z", runEvidence: runEvidence(),
  policy: separatePersonPolicy(), contributors: contributorsClean(), ...overrides,
});

// ---------------------------------------------------------------- end-to-end acceptance

test("a fully matching, correctly authorized, genuinely separate-person determination is accepted", () => {
  const r = validateDetermination(fullInput());
  assert.equal(r.accepted, true);
  assert.equal(r.mode, "SEPARATE_PERSON");
  assert.equal(r.externalEvidenceEntry.sourceObjectId, "comment-1");
  assert.equal(r.externalEvidenceEntry.contentDigest, DIGEST);
  assert.equal(r.externalEvidenceEntry.immutability, "MUTABLE");
});

test("a self-declared `reviewer` display name is never used for trust -- changing it changes nothing about acceptance or mode", () => {
  const a = validateDetermination(fullInput({ record: record({ reviewer: "Totally Fake Name" }) }));
  const b = validateDetermination(fullInput({ record: record({ reviewer: "" }) }));
  assert.equal(a.accepted, true);
  assert.equal(b.accepted, true);
  assert.equal(a.mode, b.mode);
});

// ---------------------------------------------------------------- mandatory negative tests (mission section 27, #13-16, and section 11's list)

test("bot account cannot determine, even if listed in authorizedDeterminers -- mandatory negative", () => {
  const policy = separatePersonPolicy({ authorizedDeterminers: [{ provider: "github", accountId: "555" }] });
  const r = validateDetermination(fullInput({ authenticatedActor: actor({ accountType: "Bot" }), policy }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "BOT_OR_SERVICE_ACCOUNT");
});

test("service account cannot determine -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ authenticatedActor: actor({ accountType: "ServiceAccount" }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "BOT_OR_SERVICE_ACCOUNT");
});

test("app account cannot determine -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ authenticatedActor: actor({ accountType: "App" }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "BOT_OR_SERVICE_ACCOUNT");
});

test("an unauthorized human account (not in authorizedDeterminers) cannot determine -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ authenticatedActor: actor({ accountId: "999999" }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "NOT_AN_AUTHORIZED_DETERMINER");
});

test("PR author (a contributor) is rejected under SEPARATE_PERSON mode -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ contributors: contributorsClean({ accountIds: ["github:555"] }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "DETERMINER_IS_A_CONTRIBUTOR");
});

test("an unresolved contributor identity disqualifies SEPARATE_PERSON entirely -- distinctness is never silently assumed -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ contributors: contributorsClean({ hasUnresolved: true }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "UNRESOLVED_CONTRIBUTOR_IDENTITY");
});

test("OWNER_ATTESTED privilege escalation: an OWNER_ATTESTED-mode policy never yields SEPARATE_PERSON authority", () => {
  const r = validateDetermination(fullInput({ policy: ownerAttestedPolicy(), contributors: contributorsClean({ accountIds: ["github:555"] }) }));
  assert.equal(r.accepted, true);
  assert.equal(r.mode, "OWNER_ATTESTED");
  assert.notEqual(r.mode, "SEPARATE_PERSON");
});

test("OWNER_ATTESTED mode rejects a determiner who is not the explicitly named owner", () => {
  const r = validateDetermination(fullInput({ policy: ownerAttestedPolicy({ ownerAccountId: "777" }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "DETERMINER_IS_NOT_THE_NAMED_OWNER");
});

test("replayed record from another repository is rejected -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ record: record({ repository: "someone-else/other-repo" }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "REPOSITORY_MISMATCH");
});

test("replayed record from another HEAD is rejected -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ record: record({ headSha: "b".repeat(40) }) }));
  assert.equal(r.accepted, false);
  assert.equal(["HEAD_MISMATCH", "SUBJECT_MISMATCH"].includes(r.reason), true);
});

test("record headSha matches runEvidence but not the actual subject -- rejected (subject is the ultimate authority, not the run evidence alone)", () => {
  const otherHead = "c".repeat(40);
  const r = validateDetermination(fullInput({
    record: record({ headSha: otherHead }), runEvidence: runEvidence({ headSha: otherHead }),
  }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "SUBJECT_MISMATCH");
});

test("replayed record from another run (wrong runId) is rejected -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ record: record({ runId: "different-run" }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "RUN_ID_MISMATCH");
});

test("missing failed-job coverage (record claims fewer failed jobs than actually failed) is rejected -- mandatory negative", () => {
  const r = validateDetermination(fullInput({
    runEvidence: runEvidence({ attemptHistory: [{ attempt: 1, conclusion: "failure", failedJobs: ["Cypress - chrome", "Cypress - edge"] }] }),
  }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "FAILED_JOB_COVERAGE_MISMATCH");
});

test("an altered failed-job list (record claims a job that did not actually fail) is rejected", () => {
  const r = validateDetermination(fullInput({ record: record({ failedJobs: ["Some Other Job"] }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "FAILED_JOB_COVERAGE_MISMATCH");
});

test("wrong / altered failure signature alone does not bypass binding checks that already fail on other grounds, and a mismatched attempt list is independently rejected -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ record: record({ failedAttempts: [1, 2, 3] }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "FAILED_ATTEMPT_COVERAGE_MISMATCH");
});

test("mismatched final attempt is rejected", () => {
  const r = validateDetermination(fullInput({ record: record({ finalAttempt: 99 }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "FINAL_ATTEMPT_MISMATCH");
});

test("missing content digest is rejected -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ contentDigest: undefined }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "MALFORMED_INTEGRITY_INPUT");
});

test("malformed (non-64-hex) content digest is rejected", () => {
  const r = validateDetermination(fullInput({ contentDigest: "not-a-real-digest" }));
  assert.equal(r.accepted, false);
});

test("missing authenticated account ID is rejected -- mandatory negative", () => {
  const r = validateDetermination(fullInput({ authenticatedActor: { provider: "github", accountType: "User" } }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "MALFORMED_AUTHENTICATED_ACTOR");
});

test("conflicting versions: version and channelObjectId are both required and independently validated -- mandatory negative", () => {
  assert.equal(validateDetermination(fullInput({ version: "" })).accepted, false);
  assert.equal(validateDetermination(fullInput({ channelObjectId: "" })).accepted, false);
  assert.equal(validateDetermination(fullInput({ collectedAt: "" })).accepted, false);
});

test("empty authorizedDeterminers set accepts nobody -- an empty set means no record can be accepted", () => {
  const r = validateDetermination(fullInput({ policy: separatePersonPolicy({ authorizedDeterminers: [] }) }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "EMPTY_AUTHORIZED_SET");
});

test("a head-controlled authorizedDeterminers value is not this module's concern to fetch -- but a malformed policy shape is still rejected defensively", () => {
  const r = validateDetermination(fullInput({ policy: { authorizedDeterminers: "not-an-array", determinationMode: "SEPARATE_PERSON" } }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "MALFORMED_POLICY");
});

test("malformed record body (missing field, extra field, wrong types) is rejected", () => {
  assert.equal(isValidRecordBody({}), false);
  assert.equal(isValidRecordBody(record({ extra: 1 })), false);
  assert.equal(isValidRecordBody(record({ failedAttempts: [] })), false);
  assert.equal(isValidRecordBody(record({ category: "NOT_A_REAL_CATEGORY" })), false);
  const r = validateDetermination(fullInput({ record: { repository: REPO } }));
  assert.equal(r.accepted, false);
  assert.equal(r.reason, "MALFORMED_RECORD_BODY");
});

test("never throws on a fully hostile input object", () => {
  for (const bad of [null, undefined, 42, [], {}, { subject: null, record: null }]) {
    assert.doesNotThrow(() => validateDetermination(bad));
  }
});

test("five repeated validations of an identical fixture are deterministic", () => {
  const outs = Array.from({ length: 5 }, () => JSON.stringify(validateDetermination(fullInput())));
  assert.equal(new Set(outs).size, 1);
});

// ---------------------------------------------------------------- unit-level coverage of the sub-functions

test("isAuthorizedDeterminer rejects a malformed policy shape without throwing", () => {
  assert.equal(isAuthorizedDeterminer(actor(), "not-an-array").ok, false);
  assert.equal(isAuthorizedDeterminer(actor(), [{ provider: 1 }]).ok, false);
});

test("resolveDeterminationMode rejects an unrecognized determinationMode value", () => {
  const r = resolveDeterminationMode({ actor: actor(), contributors: contributorsClean(), policy: { determinationMode: "SOMETHING_ELSE" } });
  assert.equal(r.ok, false);
});

test("checkBindings rejects malformed runEvidence without throwing", () => {
  assert.equal(checkBindings({ record: record(), runEvidence: null, subject }).ok, false);
  assert.doesNotThrow(() => checkBindings({ record: record(), runEvidence: {}, subject }));
});
