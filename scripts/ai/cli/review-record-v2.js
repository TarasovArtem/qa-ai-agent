"use strict";
const { computeDigest } = require("../test-automation/generated-change-set-review-canonical");
const { buildGeneratedChangeSetReviewRecord, recomputeReviewRecordDigest } = require("../test-automation/generated-change-set-review-record-builder");
const { isValidId } = require("../generation/primitives");
const { inputRefused } = require("./errors");
const { encodeValue } = require("./canonical-review-serialization");
const SESSION_MS = 60 * 60 * 1000, VALIDITY_MS = 24 * 60 * 60 * 1000, APPLY_CONFIRM_MS = 5 * 60 * 1000;
const HASH = /^sha256:[0-9a-f]{64}$/, RECORD_ID = /^[0-9a-f]{32}$/, ORDINAL = /^(?!0000)[0-9]{4}$/, RUN_ID = /^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$/;
function closed(v, keys) { return v !== null && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)); }
function timestamp(v) { return typeof v === "string" && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v; }
function validComment(v) { return v === null || typeof v === "string" && v.length >= 1 && v.length <= 500 && /^[\x20-\x7e]+$/.test(v) && v.trim() === v; }
function invalid() { return inputRefused("REVIEW_RECORD_INVALID", "the closed v2 review record or its evidence is invalid."); }
function recordDigest(r) { const { recordDigest: ignored, ...v } = r; return computeDigest("generated-change-set-review-record:v2", v); }
function expectedCore(p, r) {
  const result = buildGeneratedChangeSetReviewRecord({ reviewPackage: p, expectedProjectId: r.binding.projectId, reviewerId: r.reviewer.principal, reviewedAt: r.provenance.decidedAt,
    decisions: p.reviewTargets.map(t => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: r.decision, ...(r.decision === "REJECT" ? { reason: `Rejected in qa-agent review record session ${r.recordId}.` } : {}) })), ...(r.comment === null ? {} : { comment: r.comment }) });
  if (!result.ok) throw invalid(); return result.reviewRecord;
}
function validateRecord(input, { reviewPackage, now } = {}) {
  // Canonical encoding refuses accessors/exotic values before any checks,
  // then decode gives this validator a stable own-data snapshot.
  let r; try { r = JSON.parse(encodeValue(input)); } catch { throw invalid(); }
  if (!closed(r, ["kind", "schemaVersion", "recordId", "decision", "subject", "binding", "reviewer", "provenance", "validity", "comment", "core", "recordDigest"]) || r.kind !== "GeneratedChangeSetReviewRecord" || r.schemaVersion !== 2 || !RECORD_ID.test(r.recordId) || !["APPROVE", "REJECT"].includes(r.decision) || !validComment(r.comment)) throw invalid();
  const s = r.subject, b = r.binding, u = r.reviewer, p = r.provenance, v = r.validity, c = r.core;
  if (!closed(s, ["runId", "packageOrdinal", "packagePath", "packageArtifactSha256", "changeSetArtifactSha256", "packageDigest", "crsVersion", "crsDigest", "presentationVersion", "presentationDigest", "changeSetDigest", "automationPlanDigest", "repositoryContextDigest", "automationPlanId", "pathPolicy", "targetCount"]) || !RUN_ID.test(s.runId) || !ORDINAL.test(s.packageOrdinal) || s.packagePath !== `generate/review-package-${s.packageOrdinal}.json` || !isValidId(s.automationPlanId) || !Number.isInteger(s.targetCount) || s.targetCount < 1 || s.targetCount > 100) throw invalid();
  if (s.crsVersion !== 1 || s.presentationVersion !== "TAP-2" || s.pathPolicy !== "PPI-1") throw inputRefused("REVIEW_SERIALIZATION_UNSUPPORTED", "only CRS-1, TAP-2 and PPI-1 are eligible for Stage 4 authority.");
  for (const k of ["packageArtifactSha256", "changeSetArtifactSha256", "packageDigest", "crsDigest", "presentationDigest", "changeSetDigest", "automationPlanDigest", "repositoryContextDigest"]) if (typeof s[k] !== "string" || !HASH.test(s[k])) throw invalid();
  if (!closed(b, ["projectId", "projectionVersion", "projectionDigest", "product", "repositoryRoot"]) || !isValidId(b.projectId) || b.projectionVersion !== 1 || !HASH.test(b.projectionDigest) || !closed(b.product, ["name", "version"]) || b.product.name !== "qa-ai-agent" || typeof b.product.version !== "string" || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(b.product.version) || !closed(b.repositoryRoot, ["method", "digest"]) || b.repositoryRoot.method !== "root-identity-v1" || !HASH.test(b.repositoryRoot.digest)) throw invalid();
  if (!closed(u, ["method", "principal", "uid", "profileDigest", "platform", "assurance"]) || u.method !== "os-local-account-v1" || !isValidId(u.principal) || !u.principal.startsWith("os-account-v1:") || !["linux", "darwin", "freebsd", "openbsd", "sunos", "aix", "win32"].includes(u.platform) || u.assurance !== "LOCAL_ACCOUNT_ATTRIBUTION" || (u.platform === "win32" ? u.uid !== null || !HASH.test(u.profileDigest) : !Number.isSafeInteger(u.uid) || u.uid < 1 || u.profileDigest !== null)) throw invalid();
  if (!closed(p, ["method", "sessionId", "sessionStartedAt", "decidedAt"]) || p.method !== "interactive-tty-challenge-v1" || p.sessionId !== r.recordId || !timestamp(p.sessionStartedAt) || !timestamp(p.decidedAt) || Date.parse(p.decidedAt) < Date.parse(p.sessionStartedAt) || Date.parse(p.decidedAt) - Date.parse(p.sessionStartedAt) > SESSION_MS || now !== undefined && Date.parse(p.decidedAt) > now + APPLY_CONFIRM_MS) throw invalid();
  if (!closed(v, ["notAfter", "use"]) || v.use !== "SINGLE_APPLY_ATTEMPT" || !timestamp(v.notAfter) || Date.parse(v.notAfter) !== Date.parse(p.decidedAt) + VALIDITY_MS) throw invalid();
  if (!closed(c, ["schemaVersion", "kind", "projectId", "packageDigest", "reviewerId", "reviewedAt", "decisions", "status", "comment", "recordDigest"]) || c.schemaVersion !== 1 || c.kind !== r.kind || c.projectId !== b.projectId || c.packageDigest !== s.packageDigest || c.reviewerId !== u.principal || c.reviewedAt !== p.decidedAt || c.comment !== r.comment || c.status !== (r.decision === "APPROVE" ? "APPROVED" : "REJECTED") || !Array.isArray(c.decisions) || c.decisions.length !== s.targetCount || recomputeReviewRecordDigest(c) !== c.recordDigest) throw invalid();
  for (const d of c.decisions) if (!closed(d, ["operation", "path", "targetDigest", "decision", "reason"]) || !["CREATE", "MODIFY"].includes(d.operation) || typeof d.path !== "string" || !HASH.test(d.targetDigest) || d.decision !== r.decision || d.reason !== (r.decision === "REJECT" ? `Rejected in qa-agent review record session ${r.recordId}.` : null)) throw invalid();
  if (!HASH.test(r.recordDigest) || recordDigest(r) !== r.recordDigest) throw invalid();
  if (reviewPackage && encodeValue(expectedCore(reviewPackage, r)) !== encodeValue(c)) throw invalid();
  return r;
}
function buildRecord({ recordId, decision, subject, binding, reviewer, sessionStartedAt, decidedAt, comment = null, reviewPackage }) {
  const r = { kind: "GeneratedChangeSetReviewRecord", schemaVersion: 2, recordId, decision, subject, binding, reviewer,
    provenance: { method: "interactive-tty-challenge-v1", sessionId: recordId, sessionStartedAt, decidedAt }, validity: { notAfter: new Date(Date.parse(decidedAt) + VALIDITY_MS).toISOString(), use: "SINGLE_APPLY_ATTEMPT" }, comment };
  r.core = expectedCore(reviewPackage, r); r.recordDigest = recordDigest(r); return validateRecord(r, { reviewPackage });
}
module.exports = { SESSION_MS, VALIDITY_MS, APPLY_CONFIRM_MS, HASH, RECORD_ID, ORDINAL, closed, timestamp, validComment, recordDigest, expectedCore, validateRecord, buildRecord };
