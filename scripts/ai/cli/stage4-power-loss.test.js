"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fx = require("../../../test/helpers/stage4-fixtures");
const { FlushModel } = require("../../../test/helpers/stage4-flush-model");
const { cleanupScratch, scratch } = require("../../../test/helpers/qa-agent-cli");
const { runReviewRecord } = require("./review-record");
const { runApply } = require("./apply");
const { createDurableStore } = require("./stage4-durability");
const { readEvidence } = require("./stage4-run");
const { derivePackageState } = require("./stage4-state");
after(cleanupScratch);
function restart(recovery) {
  const root = scratch("qa-agent-power-loss-");
  for (const p of recovery.dirs) if (p) fs.mkdirSync(path.join(root, p), { recursive: true });
  for (const [p, bytes] of recovery.files) fs.writeFileSync(path.join(root, p), bytes);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json")));
  return derivePackageState("0001", readEvidence({ runDirReal: root, manifest }));
}
test("ARCH-S4A-07: flush-aware exhaustive S13/A14-A16 cuts drop/reorder only unflushed operations", async () => {
  const f = fx.makeRun(), initial = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  const approved = await runReviewRecord(f.ctx), reviewManifest = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  await runApply(fx.withTerminal(f, fx.scriptedTerminal()));
  const model = new FlushModel(f.runDirReal); model.seedDisk(f.runDirReal, new Set(["review", "apply"]));
  const manifest = model.get(path.join(f.runDirReal, "manifest.json")); manifest.data = initial; manifest.durableData = initial;
  const d = createDurableStore({ runDirReal: f.runDirReal, io: model.io, authorize: () => {} });
  let attempted = false, committed = false, claimDurable = false, boundaries = 0;
  async function verifySince(start, phase) {
    for (const snapshot of model.snapshots.slice(start)) for (const recovery of FlushModel.recoveries(snapshot)) {
      const state = restart(recovery); boundaries++;
      if (attempted) assert.notEqual(state.state, "APPROVED", `${phase}/${snapshot.label}: durable consumption cannot disappear`);
      else if (committed) assert.ok(["APPROVED", "QUARANTINED", "INCONSISTENT"].includes(state.state), snapshot.label);
      else if (claimDurable) assert.ok(["QUARANTINED", "INCONSISTENT", "APPROVED"].includes(state.state), `${snapshot.label}: durable claim cannot disappear`);
      else assert.ok(["UNREVIEWED", "QUARANTINED", "INCONSISTENT", "APPROVED"].includes(state.state), snapshot.label);
      if (state.state === "APPROVED") assert.equal(state.active.recordId, approved.recordId, "only the exact completed decision can be recovered");
    }
  }
  let start = 0;
  await d.ensureDirectory("review");
  await verifySince(start, "S13-D-DIR");
  for (const name of fs.readdirSync(path.join(f.runDirReal, "review")).sort()) {
    start = model.snapshots.length;
    await d.create(`review/${name}`, fs.readFileSync(path.join(f.runDirReal, "review", name)));
    await verifySince(start, name);
    if (name.startsWith("claim-")) {
      claimDurable = true;
      for (const r of FlushModel.recoveries(model.snapshots.at(-1))) assert.equal(restart(r).state, "QUARANTINED");
    }
  }
  start = model.snapshots.length;
  await d.replace(reviewManifest, 1);
  await verifySince(start, "S13"); committed = true;
  // Every successful D-REPLACE cut recovers the new manifest and durable
  // claim/record. Rename-before-parent-flush cuts include old and new states.
  assert.equal(restart(FlushModel.recoveries(model.snapshots.at(-1))[0]).state, "APPROVED");
  start = model.snapshots.length; await d.ensureDirectory("apply");
  const attemptName = `apply/attempt-0001-${approved.recordId}.json`;
  await d.create(attemptName, Buffer.alloc(0)); await verifySince(start, "A14-before-#23F");
  for (const r of FlushModel.recoveries(model.snapshots.at(-1))) assert.equal(restart(r).state, "QUARANTINED", "D-CREATE success is the prerequisite for #23F entry");
  attempted = true; start = model.snapshots.length; model.capture("A15:#23F-entry");
  await d.create(`apply/applied-0001-${approved.recordId}.json`, fs.readFileSync(path.join(f.runDirReal, `apply/applied-0001-${approved.recordId}.json`)));
  await d.create(`apply/outcome-0001-${approved.recordId}.json`, fs.readFileSync(path.join(f.runDirReal, `apply/outcome-0001-${approved.recordId}.json`)));
  await verifySince(start, "A15-A16");
  assert.equal(restart(FlushModel.recoveries(model.snapshots.at(-1))[0]).state, "APPLIED");
  assert.ok(boundaries > 50, `evaluated ${boundaries} recovery variants`);
  for (const step of ["mkdir", "open", "write", "file-fsync", "close", "rename", "directory-fsync"]) assert.ok(model.log.some(([s]) => s === step), step);
});
test("ARCH-S4A-02/07 non-vacuity: visible but unflushed apply directory loses consumption under the old EEXIST behavior", async () => {
  const f = fx.makeRun(); const approved = await runReviewRecord(f.ctx);
  for (const establishParent of [false, true]) {
    const model = new FlushModel(f.runDirReal); model.seedDisk(f.runDirReal);
    // Creator's mkdir is visible, but its parent flush failed before session 2.
    await model.io.mkdir(path.join(f.runDirReal, "apply"));
    const d = createDurableStore({ runDirReal: f.runDirReal, io: model.io, authorize: () => {} });
    if (establishParent) await d.ensureDirectory("apply");
    await d.create(`apply/attempt-0001-${approved.recordId}.json`, Buffer.alloc(0));
    const states = FlushModel.recoveries(model.snapshots.at(-1)).map(r => restart(r).state);
    if (establishParent) assert.deepEqual([...new Set(states)], ["QUARANTINED"]);
    else assert.ok(states.includes("APPROVED"), "model detects lost attempt after child fsync when parent entry was never confirmed");
  }
});
