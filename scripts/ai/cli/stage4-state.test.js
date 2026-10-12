"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { derivePackageState } = require("./stage4-state");
const id = "a".repeat(32), hash = `sha256:${"b".repeat(64)}`;
function evidence() { return { stages: ["design", "plan", "generate"], ledger: [], runRootInventory: [{ name: "manifest.json", kind: "file" }, ...["design", "plan", "generate"].map(name => ({ name, kind: "directory" }))], reviewEntries: [], applyEntries: [] }; }
function reviewed(decision = "APPROVE") {
  const e = evidence(); e.runRootInventory.push({ name: "review", kind: "directory" });
  e.ledger = [{ ledgerIndex: 1, packageOrdinal: "0001", recordId: id, decision, recordPath: `review/record-0001-${id}.json`, recordSha256: hash, decidedAt: "2026-10-12T00:00:00.000Z" }];
  e.reviewEntries = [{ name: "claim-0001.json", kind: "file", value: { ledgerIndex: 1, packageOrdinal: "0001", recordId: id } }, { name: `record-0001-${id}.json`, kind: "file", sha256: hash, recordValid: true }]; return e;
}
test("derivePackageState table covers all rules, order independence and no clock", () => {
  const vectors = [[evidence(), "UNREVIEWED"], [reviewed(), "APPROVED"], [reviewed("REJECT"), "REJECTED"]];
  for (const result of [null, "MALFORMED", "UNKNOWN", "ROLLBACK_INCOMPLETE", "APPLIED", "NOT_ENTERED", "REFUSED_NO_WRITE", "ROLLED_BACK"]) {
    const e = reviewed(); e.runRootInventory.push({ name: "apply", kind: "directory" }); e.applyEntries.push({ name: `attempt-0001-${id}.json`, kind: "file", value: null });
    if (result) e.applyEntries.push({ name: `outcome-0001-${id}.json`, kind: "file", value: result === "MALFORMED" ? null : { kind: "QaAgentApplyOutcome", schemaVersion: 1, packageOrdinal: "0001", recordId: id, result, appliedRecordSha256: ["APPLIED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"].includes(result) ? hash : null, completedAt: "2026-10-12T00:00:00.000Z" } });
    if (["APPLIED", "ROLLED_BACK", "ROLLBACK_INCOMPLETE"].includes(result)) e.applyEntries.push({ name: `applied-0001-${id}.json`, kind: "file", value: null, sha256: hash });
    vectors.push([e, result === "APPLIED" ? "APPLIED" : ["NOT_ENTERED", "REFUSED_NO_WRITE", "ROLLED_BACK"].includes(result) ? "CONSUMED" : "QUARANTINED"]);
  }
  for (const [e, expected] of vectors) {
    assert.equal(derivePackageState("0001", e).state, expected);
    assert.deepEqual(derivePackageState("0001", { ...e, runRootInventory: [...e.runRootInventory].reverse(), reviewEntries: [...e.reviewEntries].reverse(), applyEntries: [...e.applyEntries].reverse() }), derivePackageState("0001", e));
  }
});
test("root grammar rejects unknown, duplicate, malformed, wrong-kind, stale/future temp", () => {
  for (const bad of [{ name: "extra", kind: "directory" }, { name: "design", kind: "directory" }, { name: "manifest.next-0000.json", kind: "file" }, { name: "manifest.next-0002.json", kind: "file" }, { name: "manifest.next-10000.json", kind: "file" }, { name: "manifest.next-0001.json\n", kind: "file" }, { name: "manifest.next-0001.json", kind: "symlink" }]) { const e = evidence(); e.runRootInventory.push(bad); assert.equal(derivePackageState("0001", e).state, "INCONSISTENT", bad.name); }
  const e = reviewed(); e.runRootInventory.push({ name: "manifest.next-0001.json", kind: "file" }); assert.equal(derivePackageState("0001", e).state, "INCONSISTENT");
  for (const stage of ["design", "plan", "generate"]) { const e = evidence(); e.runRootInventory = e.runRootInventory.filter(x => x.name !== stage); assert.equal(derivePackageState("0001", e).state, "INCONSISTENT"); }
});
test("empty/partial orphan claims and expected temp quarantine every package, even approved", () => {
  for (const value of [null, {}, { ledgerIndex: 2 }]) { const e = reviewed(); e.reviewEntries.push({ name: "claim-0002.json", kind: "file", value }); for (const n of ["0001", "0002"]) assert.equal(derivePackageState(n, e).state, "QUARANTINED"); }
  const e = reviewed(); e.runRootInventory.push({ name: "manifest.next-0002.json", kind: "file" }); assert.equal(derivePackageState("0001", e).state, "QUARANTINED");
  // Post-rename failed flush: new ledger visible is authoritative only
  // through derivation; simulated loss of rename exposes the orphan claim.
  assert.equal(derivePackageState("0001", reviewed()).state, "APPROVED");
  const lost = reviewed(); lost.ledger = []; assert.equal(derivePackageState("0001", lost).state, "QUARANTINED");
});
module.exports = { evidence, reviewed, id, hash };
