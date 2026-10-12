"use strict";
const crypto = require("crypto");
const store = require("./run-store");
const { inputRefused, authorityRefused } = require("./errors");
const { checkInteractivePolicy, freshChallenge, TerminalSession } = require("./terminal-session");
const { openStage4Run, assertState, rebuildSubject } = require("./stage4-run");
const { buildRecord, validateRecord, recordDigest } = require("./review-record-v2");

function json(value) { return store.serialize(value); }
function orphanWarning(session, message) {
  return session.report("X", message, { warning: true });
}
async function runReviewRecord(ctx) {
  checkInteractivePolicy(ctx, "review");
  if (!ctx.runId || !/^\d{8}T\d{6}Z-[0-9a-f]{16}$/.test(ctx.runId) || !/^\d{4}$/.test(ctx.packageOrdinal) || ctx.packageOrdinal === "0000") throw inputRefused("RUN_BINDING_MISMATCH", "a valid --run and --package selection is required.");
  const session = new TerminalSession({ ...ctx, command: "review" });
  try {
    const run = openStage4Run(ctx); assertState(run.state, { review: true });
    if (["APPROVED", "REJECTED", "CONSUMED"].includes(run.state.state) && run.state.active && run.state.active.packageOrdinal !== ctx.packageOrdinal) throw authorityRefused("PACKAGE_QUARANTINED", "a later package decision would supersede the selected package; select the newest package.");
    if (run.state.state === "APPLIED") throw authorityRefused("PACKAGE_ALREADY_APPLIED", "an applied package cannot be reviewed again.");
    if (run.state.active && run.state.active.packageOrdinal === ctx.packageOrdinal && run.state.state === "CONSUMED") throw authorityRefused("APPROVAL_ALREADY_CONSUMED", "the package already has a consumed review decision.");
    const rebuilt = rebuildSubject(ctx, run);
    const startedAt = ctx.now ? ctx.now() : new Date();
    const principal = (ctx.resolvePrincipal || require("./stage4-principal").resolvePrincipal)({ platform: ctx.platform });
    await session.present(rebuilt.presentation);
    const challenge = freshChallenge(ctx.randomBytes || crypto.randomBytes);
    const decision = await session.decision(challenge, rebuilt.reviewPackage.reviewTargets.length, { realRoot: ctx.root.realRoot, rootDigest: rebuilt.binding.repositoryRoot.digest, principal: principal.principal });
    const comment = await session.comment(); session.checkTime();
    const decidedAt = (ctx.now ? ctx.now() : new Date()).toISOString();
    const recordId = (ctx.randomBytes || crypto.randomBytes)(16).toString("hex");
    const record = buildRecord({ recordId, decision, subject: rebuilt.subject, binding: rebuilt.binding, reviewer: principal, sessionStartedAt: startedAt.toISOString(), decidedAt, comment, reviewPackage: rebuilt.reviewPackage });
    // Re-open and rebuild after terminal interaction. The decision is not an
    // authority until the record and replacement manifest are durable.
    const fresh = openStage4Run(ctx); assertState(fresh.state, { review: true });
    const check = rebuildSubject(ctx, fresh);
    if (fresh.manifest.runId !== run.manifest.runId || fresh.manifestDigest !== run.manifestDigest || recordDigest(record) === "" || JSON.stringify(check.subject) !== JSON.stringify(rebuilt.subject) || JSON.stringify(check.binding) !== JSON.stringify(rebuilt.binding)) throw inputRefused("RUN_CHANGED_DURING_COMMAND", "the run or selected package changed during the review session.");
    validateRecord(record, { reviewPackage: check.reviewPackage, now: Date.parse(decidedAt) });
    const ledgerIndex = fresh.manifest.reviews.length + 1;
    if (ledgerIndex > 9999) throw inputRefused("RUN_STATE_INCONSISTENT", "the review ledger is full.");
    const durable = (ctx.durableStore || (() => require("./stage4-durability").createDurableStore({ root: ctx.root, runDirReal: fresh.runDirReal, protectedPaths: ctx.protectedPaths })))();
    session.enterCritical();
    try {
      await durable.ensureDirectory("review");
      const claim = { ledgerIndex, packageOrdinal: ctx.packageOrdinal, recordId };
      await durable.create(`review/claim-${String(ledgerIndex).padStart(4, "0")}.json`, json(claim));
      const recordBytes = Buffer.from(json(record));
      await durable.create(`review/record-${ctx.packageOrdinal}-${recordId}.json`, recordBytes);
      const recordSha256 = store.sha256(recordBytes);
      const next = { ...fresh.manifest, reviews: [...fresh.manifest.reviews, { ledgerIndex, packageOrdinal: ctx.packageOrdinal, recordPath: `review/record-${ctx.packageOrdinal}-${recordId}.json`, recordSha256, recordId, decision, decidedAt }] };
      store.validateManifestShape(next);
      try { await durable.replace(Buffer.from(json(next)), ledgerIndex, { expectedDigest: fresh.digest }); }
      catch (e) {
        const observed = openStage4Run(ctx); // visible authority is disk-derived only
        if (e.sectionOutcome === "ORPHANED") {
          e.stage4WarningWritten = true;
          await orphanWarning(session, "WARNING: manifest replacement durability is unconfirmed. No rollback or retry was attempted. Authority follows on-disk evidence; if the rename is absent, the orphan claim quarantines this run.");
          throw e;
        }
        if (e.sectionOutcome === "PRE_RENAME_FAILED") {
          e.stage4WarningWritten = true;
          await orphanWarning(session, "WARNING: review commit failed before manifest replacement; the claim is immutable and this run is quarantined. Start a new run.");
          if (e.causeCode === "RUN_CHANGED_DURING_COMMAND") throw inputRefused("RUN_CHANGED_DURING_COMMAND", "the manifest changed before replacement; no review authority was committed.");
          throw e;
        }
        throw e;
      }
      const committed = openStage4Run(ctx);
      if (!committed.manifest.reviews.some(x => x.recordId === recordId) || !["APPROVED", "REJECTED"].includes(committed.state.state)) throw inputRefused("RUN_STATE_INCONSISTENT", "the committed review is not authoritative in freshly derived run state.");
      await session.report("T", `review decision recorded: ${decision}; package ${ctx.packageOrdinal}; record ${recordId}`);
      return { runId: ctx.runId, packageOrdinal: ctx.packageOrdinal, decision, recordId, state: committed.state.state };
    } catch (e) {
      if ((e.created || e.sectionOutcome === "ORPHANED") && !e.stage4WarningWritten) {
        await orphanWarning(session, "WARNING: incomplete review evidence is quarantined; do not retry or reuse this claim. Start a new run.");
      }
      throw e;
    } finally { session.exitCritical(); }
  } finally { session.dispose(); if (session.interrupted) session.completeSignal(); }
}
module.exports = { runReviewRecord };
