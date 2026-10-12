"use strict";
const crypto = require("crypto");
const store = require("./run-store");
const { CliError, inputRefused, authorityRefused } = require("./errors");
const { checkInteractivePolicy, freshChallenge, TerminalSession } = require("./terminal-session");
const { openStage4Run, readEvidence, assertState, rebuildSubject, selectedRecord, verifyRecordBinding } = require("./stage4-run");
const { principalKey, resolvePrincipal } = require("./stage4-principal");
const { APPLY_CONFIRM_MS } = require("./review-record-v2");
const { applyApprovedGeneratedChangeSet } = require("../test-automation/change-set-application");
const { validatePostReservationFence } = require("./stage4-state");

function resultName(r) {
  if (!r) return "NOT_ENTERED";
  if (r.status === "APPLIED") return "APPLIED";
  if (r.status === "APPLICATION_FAILED_ROLLED_BACK") return "ROLLED_BACK";
  if (r.status === "APPLICATION_FAILED_ROLLBACK_INCOMPLETE") return "ROLLBACK_INCOMPLETE";
  return "NOT_ENTERED";
}
function refusalForOutcome(applied, result) {
  if (result === "ROLLED_BACK") return inputRefused("APPLY_FAILED_ROLLED_BACK", "#23F failed after mutation and completed compensation; this approval remains consumed.");
  if (result === "ROLLBACK_INCOMPLETE") return inputRefused("APPLY_ROLLBACK_INCOMPLETE", "#23F compensation was incomplete; the run is quarantined.");
  if ((applied.errors || []).some(e => /^\$(?:\.reviewRecord|\.reviewPackage|\.generatedChangeSet)/.test(e.path || ""))) return inputRefused("APPLY_BINDING_MISMATCH", "the approved package, record or change set failed canonical #23F binding checks.");
  return inputRefused("APPLY_PRECONDITION_FAILED", "#23F refused the proposal before any target mutation; this approval remains consumed.");
}
async function runApply(ctx) {
  checkInteractivePolicy(ctx, "apply");
  if (!ctx.runId || !/^\d{8}T\d{6}Z-[0-9a-f]{16}$/.test(ctx.runId) || !/^\d{4}$/.test(ctx.packageOrdinal) || ctx.packageOrdinal === "0000") throw inputRefused("RUN_BINDING_MISMATCH", "a valid --run and --package selection is required.");
  const session = new TerminalSession({ ...ctx, command: "apply" });
  try {
    let run = openStage4Run(ctx); assertState(run.state); const manifestAtStart = run.digest;
    const record = selectedRecord(run), rebuilt = rebuildSubject(ctx, run);
    const principal = (ctx.resolvePrincipal || resolvePrincipal)({ platform: ctx.platform });
    const now = (ctx.now ? ctx.now() : new Date()).getTime();
    const checked = verifyRecordBinding(record, rebuilt, now);
    if (checked.decision !== "APPROVE" || checked.reviewer.platform !== principal.platform || principalKey(checked.reviewer) !== principalKey(principal)) throw authorityRefused("APPLY_PRINCIPAL_MISMATCH", "apply must run under the same OS account principal that approved this package.");
    if (checked.provenance.decidedAt > new Date(now).toISOString() || Date.parse(checked.validity.notAfter) < now) throw authorityRefused("APPROVAL_EXPIRED", "the approval is expired or has a future decision time.");
    const challenge = freshChallenge(ctx.randomBytes || crypto.randomBytes);
    await session.report("S", `Apply summary: project ${checked.binding.projectId}; package ${ctx.packageOrdinal}; ${checked.subject.targetCount} target(s).`);
    for (const [i, target] of rebuilt.reviewPackage.reviewTargets.entries()) await session.report("S", `${i + 1}. ${target.operation} ${target.path}`);
    await session.report("S", `record: ${checked.recordId}; reviewer: ${checked.reviewer.principal}; decidedAt: ${checked.provenance.decidedAt}; notAfter: ${checked.validity.notAfter}`);
    await session.confirmApply(challenge);
    if (session.elapsed() > APPLY_CONFIRM_MS) throw authorityRefused("APPLY_NOT_CONFIRMED", "the five-minute apply confirmation window elapsed.");
    run = openStage4Run(ctx); assertState(run.state);
    if (run.digest !== manifestAtStart) throw inputRefused("RUN_CHANGED_DURING_COMMAND", "the manifest changed during apply confirmation.");
    const active = selectedRecord(run), freshSubject = rebuildSubject(ctx, run), freshPrincipal = (ctx.resolvePrincipal || resolvePrincipal)({ platform: ctx.platform });
    const freshRecord = verifyRecordBinding(active, freshSubject, (ctx.now ? ctx.now() : new Date()).getTime());
    if (freshRecord.recordId !== checked.recordId || freshRecord.decision !== "APPROVE" || principalKey(freshRecord.reviewer) !== principalKey(freshPrincipal)) throw authorityRefused("APPROVAL_SUPERSEDED", "the active approval or OS principal changed during apply confirmation.");
    const attemptId = freshRecord.recordId, ordinal = ctx.packageOrdinal;
    const durable = (ctx.durableStore || (() => require("./stage4-durability").createDurableStore({ root: ctx.root, runDirReal: run.runDirReal, protectedPaths: ctx.protectedPaths })))();
    session.enterCritical();
    try {
      await durable.ensureDirectory("apply");
      const attemptName = `apply/attempt-${ordinal}-${attemptId}.json`;
      try { await durable.create(attemptName, Buffer.alloc(0)); }
      catch (error) {
        if (error.created) {
          const notEntered = { kind: "QaAgentApplyOutcome", schemaVersion: 1, packageOrdinal: ordinal, recordId: attemptId, result: "NOT_ENTERED", appliedRecordSha256: null, completedAt: (ctx.now ? ctx.now() : new Date()).toISOString() };
          try { await durable.create(`apply/outcome-${ordinal}-${attemptId}.json`, Buffer.from(store.serialize(notEntered))); }
          catch { await session.report("X", "WARNING: apply outcome durability is unconfirmed; the run is quarantined. Do not retry.", { warning: true }); throw inputRefused("APPLY_OUTCOME_NOT_RECORDED", "the attempt reservation outcome could not be durably recorded."); }
          throw inputRefused("APPLY_PRECONDITION_FAILED", "attempt reservation durability was not confirmed; #23F was not entered.");
        }
        throw error;
      }
      const ledgerLengthAtA14 = run.manifest.reviews.length;
      const currentManifest = store.loadManifest(run.runDirReal);
      let fence = { ok: false, code: "RUN_CHANGED_DURING_COMMAND" };
      if (currentManifest.digest === run.digest) {
        const freshEvidence = readEvidence({ ...run, manifest: currentManifest.manifest });
        fence = validatePostReservationFence(ordinal, freshEvidence, { ledgerLength: ledgerLengthAtA14, recordId: attemptId });
      }
      if (!fence.ok) {
        const outcome = { kind: "QaAgentApplyOutcome", schemaVersion: 1, packageOrdinal: ordinal, recordId: attemptId, result: "NOT_ENTERED", appliedRecordSha256: null, completedAt: (ctx.now ? ctx.now() : new Date()).toISOString() };
        try { await durable.create(`apply/outcome-${ordinal}-${attemptId}.json`, Buffer.from(store.serialize(outcome))); }
        catch { await session.report("X", "WARNING: apply outcome durability is unconfirmed; the run is quarantined. Do not retry.", { warning: true }); throw inputRefused("APPLY_OUTCOME_NOT_RECORDED", "the apply reservation result could not be durably recorded."); }
        throw fence.code === "APPROVAL_NOT_FOUND" ? authorityRefused("APPROVAL_NOT_FOUND", "a review claim or manifest replacement raced with apply reservation.") : inputRefused(fence.code, "the run evidence changed or became invalid after apply reservation.");
      }
      const appliedAt = (ctx.now ? ctx.now() : new Date()).toISOString();
      let applied;
      try {
        applied = applyApprovedGeneratedChangeSet({ expectedProjectId: freshSubject.binding.projectId, repositoryRoot: ctx.root.realRoot,
          automationPlan: freshSubject.automationPlan, repositoryContext: freshSubject.repositoryContext, generatedChangeSet: freshSubject.generatedChangeSet,
          reviewPackage: freshSubject.reviewPackage, reviewRecord: freshRecord.core, appliedAt });
      } catch (cause) { applied = null; }
      let appliedRecordSha256 = null;
      let result = !applied ? "UNKNOWN" : applied.appliedChangeSetRecord ? resultName(applied.appliedChangeSetRecord) : applied.ok ? "NOT_ENTERED" : "REFUSED_NO_WRITE";
      if (applied && applied.appliedChangeSetRecord) {
        const bytes = Buffer.from(store.serialize(applied.appliedChangeSetRecord));
        const appliedName = `apply/applied-${ordinal}-${attemptId}.json`;
        await durable.create(appliedName, bytes); appliedRecordSha256 = store.sha256(bytes);
      }
      const outcome = { kind: "QaAgentApplyOutcome", schemaVersion: 1, packageOrdinal: ordinal, recordId: attemptId, result, appliedRecordSha256, completedAt: (ctx.now ? ctx.now() : new Date()).toISOString() };
      try { await durable.create(`apply/outcome-${ordinal}-${attemptId}.json`, Buffer.from(store.serialize(outcome))); }
      catch { await session.report("X", "WARNING: apply outcome durability is unconfirmed; the run is quarantined. Do not retry.", { warning: true }); throw inputRefused("APPLY_OUTCOME_NOT_RECORDED", "the apply result could not be durably recorded."); }
      if (!applied) throw new CliError(1, "INTERNAL_ERROR", "the canonical apply routine threw; UNKNOWN outcome was durably recorded and the run is quarantined.");
      if (!applied.ok) {
        if (result === "ROLLBACK_INCOMPLETE") await session.report("X", `WARNING: rollback incomplete; affected targets: ${(applied.appliedChangeSetRecord.changes || []).map(c => c.path).join(", ")}; record apply/applied-${ordinal}-${attemptId}.json; the run is quarantined.`, { warning: true });
        throw refusalForOutcome(applied, result);
      }
      await session.report("T", `apply completed: ${result}; package ${ordinal}; record ${attemptId}`);
      return { runId: ctx.runId, packageOrdinal: ordinal, result, recordId: attemptId };
    } finally { session.exitCritical(); }
  } finally { session.dispose(); if (session.interrupted) session.completeSignal(); }
}
module.exports = { runApply };
