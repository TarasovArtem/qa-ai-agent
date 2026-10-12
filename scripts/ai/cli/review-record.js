"use strict";
const crypto = require("crypto");
const store = require("./run-store");
const { inputRefused, authorityRefused } = require("./errors");
const { checkInteractivePolicy, freshChallenge, TerminalSession } = require("./terminal-session");
const { openStage4Run, assertState, rebuildSubject } = require("./stage4-run");
const { buildRecord, validateRecord, recordDigest } = require("./review-record-v2");
const { resolvePrincipal, principalKey } = require("./stage4-principal");

function json(value) { return store.serialize(value); }
function orphanWarning(session, message) {
  return session.report(message, { warning: true });
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
    const principal = (ctx.resolvePrincipal || resolvePrincipal)({ platform: ctx.platform });
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
    const currentPrincipal = (ctx.resolvePrincipal || resolvePrincipal)({ platform: ctx.platform });
    if (principalKey(currentPrincipal) !== principalKey(principal)) throw inputRefused("REVIEW_PACKAGE_CHANGED_DURING_APPROVAL", "the reviewer OS principal changed during the review session.");
    const ledgerIndex = fresh.manifest.reviews.length + 1;
    if (ledgerIndex > 9999) throw inputRefused("RUN_STATE_INCONSISTENT", "the review ledger is full.");
    const claimName = `review/claim-${String(ledgerIndex).padStart(4, "0")}.json`;
    const claim = { ledgerIndex, packageOrdinal: ctx.packageOrdinal, recordId };
    const claimBytes = Buffer.from(json(claim));
    const recordBytes = Buffer.from(json(record)), recordSha256 = store.sha256(recordBytes);
    const next = { ...fresh.manifest, reviews: [...fresh.manifest.reviews, { ledgerIndex, packageOrdinal: ctx.packageOrdinal, recordPath: `review/record-${ctx.packageOrdinal}-${recordId}.json`, recordSha256, recordId, decision, decidedAt }] };
    store.validateManifestShape(next);
    const nextBytes = Buffer.from(json(next));
    const warning = text => orphanWarning(session, `${text} Claim: ${fresh.runDirReal}/${claimName}; the run is quarantined if the commit is absent or incomplete; start a new run. Authority follows on-disk evidence.`);
    const durable = (ctx.durableStore || (() => require("./stage4-durability").createDurableStore({ root: ctx.root, runDirReal: fresh.runDirReal, protectedPaths: ctx.protectedPaths })))();
    await durable.ensureDirectory("review");
    const commitPrincipal = (ctx.resolvePrincipal || resolvePrincipal)({ platform: ctx.platform });
    if (principalKey(commitPrincipal) !== principalKey(principal)) throw inputRefused("REVIEW_PACKAGE_CHANGED_DURING_APPROVAL", "the reviewer OS principal changed before claim creation.");
    session.checkTime();
    // Drain available signal/resize callbacks, then sample current geometry.
    // This detects observed violations; it cannot prove invisible history.
    await new Promise(resolve => setImmediate(resolve));
    let claimOwned = false;
    let commitWarning = null;
    session.enterCritical();
    try {
      try { await durable.create(claimName, claimBytes); claimOwned = true; }
      catch (e) {
        if (!e.created && e.causeCode === "EEXIST") throw inputRefused("RUN_CHANGED_DURING_COMMAND", "another review session acquired the ledger claim.");
        throw e;
      }
      await durable.create(`review/record-${ctx.packageOrdinal}-${recordId}.json`, recordBytes);
      try { await durable.replace(nextBytes, ledgerIndex, { expectedDigest: fresh.digest }); }
      catch (e) {
        if (e.sectionOutcome === "ORPHANED") {
          commitWarning = "WARNING: manifest replacement durability is unconfirmed. No rollback or retry was attempted.";
          throw e;
        }
        if (e.sectionOutcome === "PRE_RENAME_FAILED") {
          commitWarning = "WARNING: review commit failed before manifest replacement; the claim is immutable.";
          if (e.causeCode === "RUN_CHANGED_DURING_COMMAND") throw inputRefused("RUN_CHANGED_DURING_COMMAND", "the manifest changed before replacement; no review authority was committed.");
          throw e;
        }
        throw e;
      }
    } catch (e) {
      if (claimOwned || e.created || e.sectionOutcome === "ORPHANED") commitWarning ||= "WARNING: incomplete review evidence; do not retry or reuse this claim.";
      throw e;
    } finally {
      session.exitCritical();
      if (commitWarning) await warning(commitWarning);
    }
    const committed = openStage4Run(ctx); // authority is derived from disk after CS-EXIT
    if (!committed.manifest.reviews.some(x => x.recordId === recordId) || !["APPROVED", "REJECTED"].includes(committed.state.state)) {
      await warning("WARNING: incomplete review evidence; do not retry or reuse this claim.");
      throw inputRefused("RUN_STATE_INCONSISTENT", "the committed review is not authoritative in freshly derived run state.");
    }
    await session.report(`decision recorded: ${decision} (record ${recordId})`);
    return { runId: ctx.runId, packageOrdinal: ctx.packageOrdinal, decision, recordId, state: committed.state.state };
  } catch (e) {
    await session.report(`refused: ${e.code || "INTERNAL_ERROR"}; ${e.message}`, { warning: true });
    throw e;
  } finally { session.dispose(); if (session.interrupted) session.completeSignal(); }
}
module.exports = { runReviewRecord };
