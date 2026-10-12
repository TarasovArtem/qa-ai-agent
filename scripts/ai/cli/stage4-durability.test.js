"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { constants } = require("node:fs");
const { createDurableStore } = require("./stage4-durability");
function fake(fail) {
  const files = new Map([["/run/manifest.json", Buffer.from("old")]]), log = [];
  const record = (step, name) => { log.push([step, name]); if (`${step}:${name}` === fail) throw new Error("injected"); };
  const io = { async open(name, flags) { name = name.replace(/\\/g, "/"); record("open", name); if (flags & constants.O_EXCL) { if (files.has(name)) { const e = new Error("exists"); e.code = "EEXIST"; throw e; } files.set(name, Buffer.alloc(0)); }
    return { async write(b, offset, length) { record("write", name); const n = Math.min(length, 3); files.set(name, Buffer.concat([files.get(name), b.subarray(offset, offset + n)])); return { bytesWritten: n }; }, async sync() { record("fsync", name); }, async close() { record("close", name); } }; },
    async rename(a, b) { a = a.replace(/\\/g, "/"); b = b.replace(/\\/g, "/"); record("rename", a); files.set(b, files.get(a)); files.delete(a); } };
  const store = createDurableStore({ runDirReal: "/run", io, authorize: () => {} }); return { store, files, log };
}
test("D-CREATE loops writes then fsync, close, directory fsync; never truncates", async () => {
  const { store, files, log } = fake(); await store.create("claim.json", Buffer.from("abcdefg")); assert.equal(files.get("/run/claim.json").toString(), "abcdefg");
  assert.deepEqual(log.map(x => x[0]), ["open", "write", "write", "write", "fsync", "close", "open", "fsync", "close"]);
  await assert.rejects(store.create("claim.json", Buffer.from("new")), e => !e.created && e.causeCode === "EEXIST");
});
test("D-REPLACE pre-rename faults preserve old manifest; post-rename fsync cannot rollback", async () => {
  const temp = "/run/manifest.next-0001.json";
  for (const phase of ["open", "write", "fsync", "close", "rename"]) {
    const { store, files } = fake(`${phase}:${temp}`);
    await assert.rejects(store.replace(Buffer.from("new"), 1), e => e.sectionOutcome === "PRE_RENAME_FAILED" && !e.renamed);
    assert.equal(files.get("/run/manifest.json").toString(), "old", phase);
  }
  const { store, files, log } = fake("fsync:/run");
  await assert.rejects(store.replace(Buffer.from("new"), 1), e => e.sectionOutcome === "ORPHANED" && e.renamed);
  assert.equal(files.get("/run/manifest.json").toString(), "new"); assert.equal(log.filter(x => x[0] === "rename").length, 1);
  assert.equal(files.has(temp), false);
});
module.exports = { fake };
