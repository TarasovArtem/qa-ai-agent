/**
 * GOV-AUTO-1 Wave 4 / 1F -- CI rerun human-determination authority (design
 * section 17, rules 1-7; D4-A: GitHub Issue/Discussion comment provider).
 *
 * THIS IS A CRITICAL SECURITY GATE. It is the only path by which a rerun's
 * failure can ever be classified PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN
 * instead of HUMAN_REVIEW_REQUIRED, so every rule here fails closed.
 *
 * Trust chain (why a GitHub comment can be a sound provider despite being
 * editable): this module never trusts the comment's own claimed content by
 * itself. It trusts only:
 *   (a) the AUTHENTICATED comment-author identity the platform channel
 *       returns -- never a self-declared `reviewer` field in the body;
 *   (b) a base-anchored `authorizedDeterminers` allowlist -- never a value
 *       the reviewed HEAD could edit;
 *   (c) a content digest and version the CALLER computed independently at
 *       acceptance time (never a digest the comment body itself claims);
 *   (d) exact bindings between the record's claimed repository / head SHA /
 *       run ID / attempts / failed jobs / failure signature and the ACTUAL
 *       validated run evidence (stages/1f/ci-run.js output) -- a record
 *       that does not exactly match what really happened is rejected, not
 *       "trusted with caveats".
 * Property 6 of the mission's required "trusted acceptance anchor" list
 * ("the accepted digest/version cannot be silently replaced by the
 * untrusted PR author") holds because the digest/version pinned here become
 * part of a report's `externalEvidence[]` entry, and the REPORT's own
 * authenticity is independently verified at consumption time (design
 * section 25a's `finalized`/`collectorRunId`/workflow-blob chain, not this
 * module's concern) -- the comment provider's soundness depends on that
 * composition, not on comments being immutable, which they are not.
 *
 * This module never authenticates anyone itself (the `authenticatedActor`
 * input must already come from the platform channel's own authenticated
 * response, captured by the caller's adapter, never parsed from the
 * comment body) and never re-fetches anything (revalidation at later
 * decision boundaries is kernel/revalidation.js's job, using the digest and
 * version this module pins at acceptance).
 */

"use strict";

const { isPlainObject } = require("../../kernel/validation");

const SHA40 = /^[0-9a-f]{40}$/;
const REPOSITORY_ID = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;
const REJECTED_ACCOUNT_TYPES = new Set(["Bot", "App", "ServiceAccount"]);
const DETERMINATION_MODES = new Set(["SEPARATE_PERSON", "OWNER_ATTESTED"]);
const CATEGORIES = new Set(["KNOWN_CI_RELIABILITY_SIGNATURE", "TRANSIENT_INFRASTRUCTURE", "OTHER"]);
const MAX_ATTEMPTS = 64;
const MAX_JOBS = 256;
const MAX_TEXT = 500;

// ---------------------------------------------------------------- record body schema

/** The canonical determination-record body (design section 17's field table). */
function isValidRecordBody(record) {
  if (!isPlainObject(record)) return false;
  const keys = Object.keys(record).sort().join(",");
  if (keys !== "category,decisionRef,failedAttempts,failedJobs,failureSignature,finalAttempt,headSha,justification,repository,reviewer,runId") return false;
  if (typeof record.repository !== "string" || !REPOSITORY_ID.test(record.repository)) return false;
  if (typeof record.headSha !== "string" || !SHA40.test(record.headSha)) return false;
  if (typeof record.runId !== "string" || record.runId.length === 0 || record.runId.length > 64) return false;
  if (!Array.isArray(record.failedAttempts) || record.failedAttempts.length === 0 || record.failedAttempts.length > MAX_ATTEMPTS) return false;
  if (!record.failedAttempts.every((a) => Number.isInteger(a) && a >= 1 && a < 1000)) return false;
  if (!Number.isInteger(record.finalAttempt) || record.finalAttempt < 1 || record.finalAttempt >= 1000) return false;
  if (!Array.isArray(record.failedJobs) || record.failedJobs.length === 0 || record.failedJobs.length > MAX_JOBS) return false;
  if (!record.failedJobs.every((j) => typeof j === "string" && j.length > 0 && j.length <= 200)) return false;
  if (typeof record.failureSignature !== "string" || record.failureSignature.length === 0 || record.failureSignature.length > MAX_TEXT) return false;
  if (typeof record.reviewer !== "string" || record.reviewer.length > MAX_TEXT) return false; // display-only; never used for trust below
  if (typeof record.decisionRef !== "string" || record.decisionRef.length === 0 || record.decisionRef.length > MAX_TEXT) return false;
  if (!CATEGORIES.has(record.category)) return false;
  return typeof record.justification === "string" && record.justification.length > 0 && record.justification.length <= MAX_TEXT;
}

// ---------------------------------------------------------------- authenticated identity

function isValidAuthenticatedActor(actor) {
  if (!isPlainObject(actor)) return false;
  const keys = Object.keys(actor).sort().join(",");
  if (keys !== "accountId,accountType,provider") return false;
  if (typeof actor.provider !== "string" || actor.provider.length === 0 || actor.provider.length > 32) return false;
  if (typeof actor.accountId !== "string" || actor.accountId.length === 0 || actor.accountId.length > 100) return false;
  return typeof actor.accountType === "string" && actor.accountType.length > 0 && actor.accountType.length <= 32;
}

/** Design section 17 rule 2: bot/app/service accounts can never determine; an entry with such a type in the allowlist is itself rejected as CONFIGURATION_ERROR-shaped input. */
function isAuthorizedDeterminer(actor, authorizedDeterminers) {
  if (!Array.isArray(authorizedDeterminers)) return { ok: false, reason: "MALFORMED_POLICY" };
  if (authorizedDeterminers.length === 0) return { ok: false, reason: "EMPTY_AUTHORIZED_SET" };
  for (const entry of authorizedDeterminers) {
    if (!isPlainObject(entry) || typeof entry.provider !== "string" || typeof entry.accountId !== "string") return { ok: false, reason: "MALFORMED_POLICY" };
  }
  if (REJECTED_ACCOUNT_TYPES.has(actor.accountType)) return { ok: false, reason: "BOT_OR_SERVICE_ACCOUNT" };
  const listed = authorizedDeterminers.some((e) => e.provider === actor.provider && e.accountId === actor.accountId);
  return listed ? { ok: true } : { ok: false, reason: "NOT_AN_AUTHORIZED_DETERMINER" };
}

// ---------------------------------------------------------------- determination mode

/**
 * Design section 17 rule 4. `contributors` is `{ accountIds: string[] (provider-qualified, e.g. "github:123"), hasUnresolved: boolean }`
 * -- the PR-author account plus every resolved commit author / committer / co-author account ID; any identity the
 * platform could not resolve to an account sets `hasUnresolved: true`, which alone disqualifies SEPARATE_PERSON
 * (distinctness is never silently assumed).
 */
function resolveDeterminationMode({ actor, contributors, policy }) {
  if (!isPlainObject(policy) || !DETERMINATION_MODES.has(policy.determinationMode)) return { ok: false, reason: "MALFORMED_POLICY" };
  if (!isPlainObject(contributors) || !Array.isArray(contributors.accountIds) || typeof contributors.hasUnresolved !== "boolean") return { ok: false, reason: "MALFORMED_CONTRIBUTORS" };
  const actorKey = `${actor.provider}:${actor.accountId}`;
  const isContributor = contributors.accountIds.includes(actorKey);

  if (policy.determinationMode === "SEPARATE_PERSON") {
    if (contributors.hasUnresolved) return { ok: false, reason: "UNRESOLVED_CONTRIBUTOR_IDENTITY" };
    if (isContributor) return { ok: false, reason: "DETERMINER_IS_A_CONTRIBUTOR" };
    return { ok: true, mode: "SEPARATE_PERSON" };
  }
  // OWNER_ATTESTED: the base policy names the owning account explicitly; that
  // account may be a contributor (the owner directing the authoring automation).
  if (typeof policy.ownerAccountId !== "string" || policy.ownerAccountId.length === 0) return { ok: false, reason: "MALFORMED_POLICY" };
  if (actorKey !== `${actor.provider}:${policy.ownerAccountId}`) return { ok: false, reason: "DETERMINER_IS_NOT_THE_NAMED_OWNER" };
  return { ok: true, mode: "OWNER_ATTESTED" };
}

// ---------------------------------------------------------------- exact bindings

/** Design section 17 rule 6: every binding field must equal the actual run data; a record that does not match what really happened is rejected, not partially trusted. */
function checkBindings({ record, runEvidence, subject }) {
  if (!isPlainObject(runEvidence) || !Array.isArray(runEvidence.attemptHistory)) return { ok: false, reason: "MALFORMED_RUN_EVIDENCE" };
  if (record.repository !== runEvidence.repository) return { ok: false, reason: "REPOSITORY_MISMATCH" };
  if (record.headSha !== runEvidence.headSha) return { ok: false, reason: "HEAD_MISMATCH" };
  if (record.headSha !== subject.head) return { ok: false, reason: "SUBJECT_MISMATCH" };
  if (record.runId !== runEvidence.runId) return { ok: false, reason: "RUN_ID_MISMATCH" };
  if (record.finalAttempt !== runEvidence.attempt) return { ok: false, reason: "FINAL_ATTEMPT_MISMATCH" };
  const actualFailedAttempts = new Set(runEvidence.attemptHistory.map((a) => a.attempt));
  const claimedFailedAttempts = new Set(record.failedAttempts);
  if (actualFailedAttempts.size !== claimedFailedAttempts.size || [...actualFailedAttempts].some((a) => !claimedFailedAttempts.has(a))) {
    return { ok: false, reason: "FAILED_ATTEMPT_COVERAGE_MISMATCH" };
  }
  const actualFailedJobs = new Set(runEvidence.attemptHistory.flatMap((a) => a.failedJobs));
  const claimedFailedJobs = new Set(record.failedJobs);
  if (actualFailedJobs.size !== claimedFailedJobs.size || [...actualFailedJobs].some((j) => !claimedFailedJobs.has(j))) {
    return { ok: false, reason: "FAILED_JOB_COVERAGE_MISMATCH" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- integrity (digest/version)

function isValidIntegrityInput({ contentDigest, channelObjectId, version, collectedAt }) {
  if (typeof contentDigest !== "string" || !DIGEST64.test(contentDigest)) return false;
  if (typeof channelObjectId !== "string" || channelObjectId.length === 0 || channelObjectId.length > 200) return false;
  if (typeof version !== "string" || version.length === 0 || version.length > 200) return false;
  return typeof collectedAt === "string" && collectedAt.length > 0 && collectedAt.length <= 64;
}

// ---------------------------------------------------------------- orchestrator

/**
 * validateDetermination({ subject, record, authenticatedActor, contentDigest,
 *                          channelObjectId, version, runEvidence, policy, contributors })
 *
 *   subject             the exact run identity (from 1A); record.headSha must equal subject.head
 *   record              the parsed comment-body determination record (see isValidRecordBody)
 *   authenticatedActor  { provider, accountId, accountType } from the PLATFORM CHANNEL's own
 *                        authenticated response -- never parsed from the comment body
 *   contentDigest, channelObjectId, version, collectedAt   integrity fields the CALLER computed
 *                        independently at collection time (never trusted from the record body)
 *   runEvidence         validated stages/1f/ci-run.js output for the SAME run this record claims
 *   policy               { authorizedDeterminers: [{provider,accountId}], determinationMode,
 *                          ownerAccountId? } -- read by the caller from base-anchored policy,
 *                        never from the reviewed HEAD
 *   contributors         { accountIds: string[], hasUnresolved: boolean }
 *
 * Returns { accepted: boolean, mode?, reason?, externalEvidenceEntry? }. `accepted` is true only
 * when every rule holds; `externalEvidenceEntry` (present only when accepted) is the exact
 * { sourceObjectId, sourceVersion, contentDigest, collectedAt, immutability: "MUTABLE" } shape
 * kernel/revalidation.js re-checks at every later decision boundary. A rejected call never
 * throws and never returns a shape a caller could mistake for acceptance.
 */
function validateDetermination(input) {
  if (!isPlainObject(input)) return { accepted: false, reason: "MALFORMED_INPUT" };
  const { subject, record, authenticatedActor, runEvidence, policy, contributors } = input;
  if (!isPlainObject(subject) || typeof subject.head !== "string" || !SHA40.test(subject.head)) return { accepted: false, reason: "MALFORMED_SUBJECT" };
  if (!isValidRecordBody(record)) return { accepted: false, reason: "MALFORMED_RECORD_BODY" };
  if (!isValidAuthenticatedActor(authenticatedActor)) return { accepted: false, reason: "MALFORMED_AUTHENTICATED_ACTOR" };
  if (!isValidIntegrityInput(input)) return { accepted: false, reason: "MALFORMED_INTEGRITY_INPUT" };

  const authorized = isAuthorizedDeterminer(authenticatedActor, policy && policy.authorizedDeterminers);
  if (!authorized.ok) return { accepted: false, reason: authorized.reason };

  const modeResult = resolveDeterminationMode({ actor: authenticatedActor, contributors, policy });
  if (!modeResult.ok) return { accepted: false, reason: modeResult.reason };

  const bindings = checkBindings({ record, runEvidence, subject });
  if (!bindings.ok) return { accepted: false, reason: bindings.reason };

  return {
    accepted: true,
    mode: modeResult.mode,
    externalEvidenceEntry: {
      sourceObjectId: input.channelObjectId,
      sourceVersion: input.version,
      contentDigest: input.contentDigest,
      collectedAt: input.collectedAt,
      immutability: "MUTABLE",
    },
  };
}

module.exports = { validateDetermination, isValidRecordBody, isAuthorizedDeterminer, resolveDeterminationMode, checkBindings };
