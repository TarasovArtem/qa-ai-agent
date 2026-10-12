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
  // #23F live target failures are INVARIANT_VIOLATION at changes[i],
  // which is also under generatedChangeSet. Only specific structured
  // binding fields/categories demonstrate a mismatch; never parse messages.
  const bindingFields = {
    // #23D validator: plan/context digests, reviewed changeset digest,
    // and full canonical changeset equality. #23E/#23F: package/record
    // relationship, canonical package equality and per-target decisions.
    INVALID_REFERENCE: new Set(["$.generatedChangeSet.automationPlanDigest", "$.generatedChangeSet.repositoryContextDigest", "$.generatedChangeSet.changeSetDigest", "$.generatedChangeSet", "$.reviewRecord.packageDigest", "$.reviewRecord.decisions", "$.reviewPackage", "$.reviewPackage.reviewTargets"]),
    INVALID_VALUE: new Set(["$.repositoryContext.framework", "$.generatedChangeSet.changeSetDigest", "$.reviewPackage.packageDigest", "$.reviewRecord.recordDigest"]),
    MISSING_FIELD: new Set(["$.generatedChangeSet.changes"]),
    PROJECT_MISMATCH: new Set(["$.repositoryContext.projectId", "$.generatedChangeSet.projectId", "$.reviewPackage.projectId", "$.reviewRecord.projectId"]),
  };
  const bindingFailure = (applied.errors || []).some(e => bindingFields[e.code]?.has(e.path) ||
    e.code === "INVALID_REFERENCE" && /^\$\.generatedChangeSet\.changes\[\d+\]\.path$/.test(e.path || "") ||
    e.code === "INVALID_VALUE" && /^\$\.generatedChangeSet\.changes\[\d+\]\.(?:operation|baseContentDigest)$/.test(e.path || "") ||
    e.code === "INVALID_REFERENCE" && /^\$\.reviewPackage\.reviewTargets\[\d+\](?:\.(?:operation|path|baseContentDigest|proposedContent))?$/.test(e.path || "") ||
    e.code === "INVALID_VALUE" && /^\$\.reviewPackage\.reviewTargets\[\d+\]\.targetDigest$/.test(e.path || ""));
  if (bindingFailure) return inputRefused("APPLY_BINDING_MISMATCH", "the approved package, record or change set failed canonical #23F binding checks.");
  return inputRefused("APPLY_PRECONDITION_FAILED", "#23F refused the proposal before any target mutation; this approval remains consumed.");
}
async function runApply(ctx) {
  checkInteractivePolicy(ctx, "apply");
  if (!ctx.runId || !/^\d{8}T\d{6}Z-[0-9a-f]{16}$/.test(ctx.runId) || !/^\d{4}$/.test(ctx.packageOrdinal) || ctx.packageOrdinal === "0000") throw inputRefused("RUN_BINDING_MISMATCH", "a valid --run and --package selection is required.");
  const session = new TerminalSession({ ...ctx, command: "apply" });
  try {
    let run = openStage4Run(ctx); assertState(run.state); const manifestAtStart = run.digest;
    const record = selectedRecord(run), rebuilt = rebuildSubject(ctx, run);
    const checkedRecordSha256 = run.state.active.recordSha256, checkedLedgerIndex = run.state.active.ledgerIndex;
    const principal = (ctx.resolvePrincipal || resolvePrincipal)({ platform: ctx.platform });
    const now = (ctx.now ? ctx.now() : new Date()).getTime();
    const checked = verifyRecordBinding(record, rebuilt, now);
    if (checked.decision !== "APPROVE" || checked.reviewer.platform !== principal.platform || principalKey(checked.reviewer) !== principalKey(principal)) throw authorityRefused("APPLY_PRINCIPAL_MISMATCH", "apply must run under the same OS account principal that approved this package.");
    if (Date.parse(checked.validity.notAfter) < now) throw authorityRefused("APPROVAL_EXPIRED", "the approval is expired.");
    const challenge = freshChallenge(ctx.randomBytes || crypto.randomBytes);
    await session.applyHeader(rebuilt.presentation);
    await session.report(`Apply summary: project ${checked.binding.projectId}; package ${ctx.packageOrdinal}; ${checked.subject.targetCount} target(s).`);
    for (const [i, target] of rebuilt.reviewPackage.reviewTargets.entries()) await session.report(`${i + 1}. ${target.operation} ${target.path}`);
    await session.report(`record: ${checked.recordId}; reviewer: ${checked.reviewer.principal}; decidedAt: ${checked.provenance.decidedAt}; notAfter: ${checked.validity.notAfter}`);
    await session.confirmApply(challenge);
    if (session.elapsed() > APPLY_CONFIRM_MS) throw authorityRefused("APPLY_NOT_CONFIRMED", "the five-minute apply confirmation window elapsed.");
    run = openStage4Run(ctx); assertState(run.state);
    if (run.digest !== manifestAtStart) throw inputRefused("RUN_CHANGED_DURING_COMMAND", "the manifest changed during apply confirmation.");
    const active = selectedRecord(run), freshSubject = rebuildSubject(ctx, run), freshPrincipal = (ctx.resolvePrincipal || resolvePrincipal)({ platform: ctx.platform });
    const reservationNow = (ctx.now ? ctx.now() : new Date()).getTime();
    const freshRecord = verifyRecordBinding(active, freshSubject, reservationNow);
    if (freshRecord.recordId !== checked.recordId || freshRecord.decision !== "APPROVE" || run.state.active.recordSha256 !== checkedRecordSha256 || run.state.active.ledgerIndex !== checkedLedgerIndex) throw authorityRefused("APPROVAL_NOT_FOUND", "the active approval changed during apply confirmation.");
    if (principalKey(freshRecord.reviewer) !== principalKey(freshPrincipal)) throw authorityRefused("APPLY_PRINCIPAL_MISMATCH", "the OS principal changed during apply confirmation.");
    if (reservationNow > Date.parse(freshRecord.validity.notAfter)) throw authorityRefused("APPROVAL_EXPIRED", "the approval expired during apply confirmation.");
    const attemptId = freshRecord.recordId, ordinal = ctx.packageOrdinal;
    const persistenceWarning = status => session.report(`WARNING: apply audit/outcome durability is unconfirmed; #23F status: ${status}; affected targets: ${freshSubject.reviewPackage.reviewTargets.map(t => t.path).join(", ")}; attempt ${run.runDirReal}/apply/attempt-${ordinal}-${attemptId}.json; applied ${run.runDirReal}/apply/applied-${ordinal}-${attemptId}.json; outcome ${run.runDirReal}/apply/outcome-${ordinal}-${attemptId}.json; approval remains consumed; the run is quarantined. Do not retry; start a new run.`, { warning: true });
    const durable = (ctx.durableStore || (() => require("./stage4-durability").createDurableStore({ root: ctx.root, runDirReal: run.runDirReal, protectedPaths: ctx.protectedPaths })))();
    session.enterCritical();
    try {
      await durable.ensureDirectory("apply");
      const reservingPrincipal = (ctx.resolvePrincipal || resolvePrincipal)({ platform: ctx.platform });
      if (principalKey(reservingPrincipal) !== principalKey(freshRecord.reviewer)) throw authorityRefused("APPLY_PRINCIPAL_MISMATCH", "the OS principal changed before reservation.");
      if ((ctx.now ? ctx.now() : new Date()).getTime() > Date.parse(freshRecord.validity.notAfter)) throw authorityRefused("APPROVAL_EXPIRED", "the approval expired before reservation.");
      const attemptName = `apply/attempt-${ordinal}-${attemptId}.json`;
      try { await durable.create(attemptName, Buffer.alloc(0)); }
      catch (error) {
        if (!error.created && error.causeCode === "EEXIST") throw authorityRefused("APPROVAL_ALREADY_CONSUMED", "another apply session reserved this approval.");
        if (error.created) {
          const notEntered = { kind: "QaAgentApplyOutcome", schemaVersion: 1, packageOrdinal: ordinal, recordId: attemptId, result: "NOT_ENTERED", appliedRecordSha256: null, completedAt: (ctx.now ? ctx.now() : new Date()).toISOString() };
          try { await durable.create(`apply/outcome-${ordinal}-${attemptId}.json`, Buffer.from(store.serialize(notEntered))); }
          catch { await persistenceWarning("NOT_ENTERED"); throw inputRefused("APPLY_OUTCOME_NOT_RECORDED", "the attempt reservation outcome could not be durably recorded."); }
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
        catch { await persistenceWarning("NOT_ENTERED"); throw inputRefused("APPLY_OUTCOME_NOT_RECORDED", "the apply reservation result could not be durably recorded."); }
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
      // All required post-#23F evidence, including every D-CREATE flush,
      // shares one failure boundary. Never publish normal success on failure.
      try {
        if (applied && applied.appliedChangeSetRecord) {
          const bytes = Buffer.from(store.serialize(applied.appliedChangeSetRecord));
          await durable.create(`apply/applied-${ordinal}-${attemptId}.json`, bytes);
          appliedRecordSha256 = store.sha256(bytes);
        }
        const outcome = { kind: "QaAgentApplyOutcome", schemaVersion: 1, packageOrdinal: ordinal, recordId: attemptId, result, appliedRecordSha256, completedAt: (ctx.now ? ctx.now() : new Date()).toISOString() };
        await durable.create(`apply/outcome-${ordinal}-${attemptId}.json`, Buffer.from(store.serialize(outcome)));
      } catch {
        await persistenceWarning(applied && applied.appliedChangeSetRecord ? applied.appliedChangeSetRecord.status : result);
        if (!applied) throw new CliError(1, "INTERNAL_ERROR", "the canonical apply routine threw and UNKNOWN outcome could not be durably recorded; the run is quarantined.");
        throw inputRefused("APPLY_OUTCOME_NOT_RECORDED", "the apply audit/outcome could not be durably recorded; approval remains consumed.");
      }
      if (!applied) throw new CliError(1, "INTERNAL_ERROR", "the canonical apply routine threw; UNKNOWN outcome was durably recorded and the run is quarantined.");
      if (!applied.ok) {
        if (result === "ROLLBACK_INCOMPLETE") await session.report(`WARNING: rollback incomplete; affected targets: ${(applied.appliedChangeSetRecord.changes || []).map(c => c.path).join(", ")}; outcome apply/outcome-${ordinal}-${attemptId}.json; the run is quarantined.`, { warning: true });
        throw refusalForOutcome(applied, result);
      }
      await session.report(`apply completed: ${result}; package ${ordinal}; record ${attemptId}`);
      return { runId: ctx.runId, packageOrdinal: ordinal, result, recordId: attemptId };
    } finally { session.exitCritical(); }
  } catch (e) {
    await session.report(`refused: ${e.code || "INTERNAL_ERROR"}; ${e.message}`, { warning: true });
    throw e;
  } finally { session.dispose(); if (session.interrupted) session.completeSignal(); }
}
module.exports = { runApply };
