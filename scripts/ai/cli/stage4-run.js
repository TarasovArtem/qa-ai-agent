"use strict";
const fs = require("fs");
const path = require("path");
const artifacts = require("./run-artifacts");
const store = require("./run-store");
const { inputRefused, authorityRefused, usageError } = require("./errors");
const { validateRecord } = require("./review-record-v2");
const { derivePackageState } = require("./stage4-state");
const { assertPathIdentity } = require("./path-identity");
const codec = require("./canonical-review-serialization");
const { repositoryRootBinding, assertStorageEligibility } = require("./stage4-principal");
function inventory(dir) {
  return fs.readdirSync(dir).map(name => {
    const full = path.join(dir, name), st = fs.lstatSync(full);
    let kind = st.isSymbolicLink() ? "symlink" : st.isDirectory() ? "directory" : st.isFile() ? "file" : "other";
    if (kind === "directory" && fs.realpathSync.native(full) !== full) kind = "redirect";
    return { name, kind };
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
function readEntries(dir, entries, manifest) {
  return entries.map(entry => {
    if (entry.kind !== "file") return entry;
    // Attempt bytes are audit-only; existence consumes, even if empty or
    // unreadable. No parsing can revive or discard a reservation.
    if (entry.name.startsWith("attempt-")) return entry;
    let bytes, value;
    try { bytes = store.readBoundedFile(path.join(dir, entry.name), { containerReal: dir, maxBytes: store.MAX_ARTIFACT_BYTES, label: "Stage 4 evidence" }); }
    catch { return { ...entry, readable: false }; }
    try { value = store.decodeJson(bytes, "Stage 4 evidence"); } catch { value = null; }
    const result = { ...entry, value, sha256: store.sha256(bytes) };
    if (entry.name.startsWith("record-")) {
      try {
        result.value = validateRecord(value);
        const s = result.value.subject; const e = manifest.reviews.find(e => e.recordPath === `review/${entry.name}`);
        result.recordValid = !!e && s.runId === manifest.runId && s.packageOrdinal === e.packageOrdinal && result.value.recordId === e.recordId && result.value.decision === e.decision && result.value.provenance.decidedAt === e.decidedAt;
      } catch { result.recordValid = false; }
    }
    return result;
  });
}
function readEvidence(run) {
  try {
    const runRootInventory = inventory(run.runDirReal);
    const dir = name => runRootInventory.some(e => e.name === name && e.kind === "directory") ? readEntries(path.join(run.runDirReal, name), inventory(path.join(run.runDirReal, name)), run.manifest) : [];
    return { runRootInventory, stages: run.manifest.stages.map(s => s.stage), ledger: run.manifest.reviews, reviewEntries: dir("review"), applyEntries: dir("apply") };
  } catch { return { runRootInventory: null }; }
}
function assertState(s, { review = false } = {}) {
  if (s.state === "INCONSISTENT") throw inputRefused("RUN_STATE_INCONSISTENT", "the run has inconsistent or unreadable authority evidence.");
  if (s.state === "QUARANTINED") throw authorityRefused("PACKAGE_QUARANTINED", "the run or package is quarantined; a new run is required.");
  if (s.state === "APPLIED") throw authorityRefused("PACKAGE_ALREADY_APPLIED", "this package was already applied.");
  if (!review && s.state !== "APPROVED") throw authorityRefused(s.state === "CONSUMED" ? "APPROVAL_ALREADY_CONSUMED" : s.state === "REJECTED" ? "APPROVAL_DECISION_REJECTED" : "APPROVAL_NOT_FOUND", "no active, unused whole-package approval is available.");
}
function openStage4Run(ctx) {
  const run = artifacts.openRun(ctx, null);
  if (run.manifest.schemaVersion !== 2) throw inputRefused("RUN_BINDING_MISMATCH", "Stage 4 requires a v2 run created by this implementation; no v1 migration exists.");
  if (run.manifest.stages.length !== 3) throw inputRefused("RUN_STAGE_ORDER", "Stage 4 requires a completed generate stage.");
  let current = ctx.root.realRoot;
  for (const segment of run.runDirRel.split("/")) {
    current = path.join(current, segment); const st = fs.lstatSync(current);
    if (!st.isDirectory() || st.isSymbolicLink()) throw inputRefused("RUN_STATE_INCONSISTENT", "redirected run directories are refused.");
  }
  (ctx.storageEligibility || assertStorageEligibility)(run.runDirReal, ctx.platform);
  run.authorityEvidence = readEvidence(run); run.state = derivePackageState(ctx.packageOrdinal, run.authorityEvidence);
  run.manifestDigest = run.digest;
  return run;
}
function rebuildSubject(ctx, run, { live = true } = {}) {
  const design = artifacts.loadDesignStage(run, ctx.config), plan = artifacts.loadPlanStage(run, design, ctx.config), generated = artifacts.loadGenerateStage(run, design, plan, ctx.config);
  const index = Number(ctx.packageOrdinal) - 1;
  if (index < 0 || index >= generated.reviewPackages.length) throw usageError("USAGE_INVALID_PACKAGE", "--package is outside this run's package count.");
  const p = generated.reviewPackages[index]; assertPathIdentity(p.reviewTargets.map(t => t.path), p.framework);
  if (live && !artifacts.sameContext(plan.repositoryContext, artifacts.buildLiveRepositoryContext(ctx.root, ctx.config))) throw inputRefused("REVIEW_CONTEXT_STALE", "the live repository context differs from the plan-stage context.");
  const presentation = codec.renderPresentation(p, { runId: ctx.runId, ordinal: ctx.packageOrdinal, count: generated.reviewPackages.length });
  const entries = run.manifest.stages[2].artifacts;
  const packagePath = `generate/review-package-${ctx.packageOrdinal}.json`, changeSetPath = `generate/generated-change-set-${ctx.packageOrdinal}.json`;
  const pa = entries.find(e => e.path === packagePath), ca = entries.find(e => e.path === changeSetPath);
  if (!pa || !ca) throw inputRefused("RUN_MANIFEST_INVALID", "selected package artifacts are absent from the manifest.");
  const subject = { runId: ctx.runId, packageOrdinal: ctx.packageOrdinal, packagePath, packageArtifactSha256: pa.sha256, changeSetArtifactSha256: ca.sha256,
    packageDigest: p.packageDigest, crsVersion: 1, crsDigest: presentation.crsDigest, presentationVersion: "TAP-2", presentationDigest: presentation.presentationDigest,
    changeSetDigest: p.changeSetDigest, automationPlanDigest: p.automationPlanDigest, repositoryContextDigest: p.repositoryContextDigest, automationPlanId: p.automationPlanId, pathPolicy: "PPI-1", targetCount: p.reviewTargets.length };
  const binding = { projectId: ctx.config.projectProfile.id, projectionVersion: run.manifest.projection.projectionVersion, projectionDigest: run.manifest.projection.digest, product: ctx.product, repositoryRoot: repositoryRootBinding(ctx.root.realRoot, ctx.platform) };
  return { subject, binding, presentation, reviewPackage: p, automationPlan: plan.automationPlans[index], repositoryContext: plan.repositoryContext, generatedChangeSet: generated.generatedChangeSets[index] };
}
function selectedRecord(run) {
  const selected = run.state.active;
  const record = run.authorityEvidence.reviewEntries.find(e => `review/${e.name}` === selected.recordPath);
  if (!record || !record.recordValid) throw inputRefused("REVIEW_RECORD_INVALID", "the active record is invalid.");
  return record.value;
}
function verifyRecordBinding(record, rebuilt, now) {
  const r = validateRecord(record, { reviewPackage: rebuilt.reviewPackage, now });
  if (r.subject.runId !== rebuilt.subject.runId) throw inputRefused("REVIEW_RECORD_RUN_MISMATCH", "the review record belongs to another run.");
  if (r.binding.projectId !== rebuilt.binding.projectId) throw inputRefused("REVIEW_RECORD_PROJECT_MISMATCH", "the review record belongs to another project.");
  if (codec.encodeValue(r.binding.repositoryRoot) !== codec.encodeValue(rebuilt.binding.repositoryRoot)) throw inputRefused("REPOSITORY_BINDING_MISMATCH", "the repository was moved, copied or restored since this decision.");
  if (codec.encodeValue(r.subject) !== codec.encodeValue(rebuilt.subject) || codec.encodeValue(r.binding) !== codec.encodeValue(rebuilt.binding)) throw inputRefused("REVIEW_PACKAGE_DIGEST_MISMATCH", "the review package or its project/product binding changed.");
  return r;
}
module.exports = { inventory, readEvidence, assertState, openStage4Run, rebuildSubject, selectedRecord, verifyRecordBinding };
