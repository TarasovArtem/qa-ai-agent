"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fx = require("../../../test/helpers/stage4-fixtures");
const { cleanupScratch } = require("../../../test/helpers/qa-agent-cli");
const { faultStore } = require("../../../test/helpers/stage4-fault-io");
const { runReviewRecord } = require("./review-record");
const { runApply } = require("./apply");
const { openStage4Run, selectedRecord } = require("./stage4-run");
const { resolvePrincipal } = require("./stage4-principal");
const { TerminalSession } = require("./terminal-session");
const { unescapeValue } = require("./canonical-review-serialization");
after(cleanupScratch);
test("ARCH-S4A-01: approval expires during confirmation, no attempt/#23F/target write (5)", async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx);
  const expiry = Date.parse(selectedRecord(openStage4Run(f.ctx)).validity.notAfter);
  let now = expiry - 1;
  const tty = fx.scriptedTerminal({ onWrite(text) { if (text.startsWith("@Q2:S To apply")) now = expiry + 1; } });
  await assert.rejects(runApply({ ...fx.withTerminal(f, tty), now: () => new Date(now) }), { code: "APPROVAL_EXPIRED", exitCode: 5 });
  assert.equal(fs.existsSync(path.join(f.runDirReal, "apply")), false);
  assert.equal(fs.existsSync(path.join(f.root, "cypress/e2e/generated/login.cy.js")), false);
  assert.equal(openStage4Run(f.ctx).state.state, "APPROVED");
});
test("ARCH-S4A-01: now == notAfter is accepted; expiry during D-DIR fails before reservation", async () => {
  for (const expireDuringDir of [false, true]) {
    const f = fx.makeRun(); await runReviewRecord(f.ctx);
    let now = Date.parse(selectedRecord(openStage4Run(f.ctx)).validity.notAfter);
    const real = f.ctx.durableStore;
    const ctx = { ...fx.withTerminal(f, fx.scriptedTerminal()), now: () => new Date(now), durableStore: () => {
      const d = real(), ensure = d.ensureDirectory;
      d.ensureDirectory = async name => { await ensure(name); if (expireDuringDir) now++; };
      return d;
    } };
    if (expireDuringDir) { await assert.rejects(runApply(ctx), { code: "APPROVAL_EXPIRED", exitCode: 5 }); assert.deepEqual(fs.readdirSync(path.join(f.runDirReal, "apply")), []); }
    else assert.equal((await runApply(ctx)).result, "APPLIED");
  }
});
for (const change of ["uid", "username", "profile", "unavailable", "ineligible"]) test(`ARCH-S4A-03: S12 ${change} recheck refuses without claim/record/manifest write`, async () => {
  const f = fx.makeRun(), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  let calls = 0;
  const initial = change === "profile" ? { method: "os-local-account-v1", platform: "win32", principal: "os-account-v1:reviewer", uid: null, profileDigest: `sha256:${"1".repeat(64)}`, assurance: "LOCAL_ACCOUNT_ATTRIBUTION" } : f.ctx.resolvePrincipal();
  const resolve = () => {
    if (++calls === 1) return initial;
    if (change === "unavailable" || change === "ineligible") return resolvePrincipal({ platform: "linux", userInfo: () => { if (change === "unavailable") throw new Error("OS failure"); return { username: "root", uid: 0 }; } });
    return { ...initial, ...(change === "uid" ? { uid: 1001 } : change === "username" ? { principal: "os-account-v1:renamed" } : { profileDigest: `sha256:${"2".repeat(64)}` }) };
  };
  await assert.rejects(runReviewRecord({ ...f.ctx, resolvePrincipal: resolve }), { code: ["unavailable", "ineligible"].includes(change) ? "REVIEWER_IDENTITY_UNAVAILABLE" : "REVIEW_PACKAGE_CHANGED_DURING_APPROVAL", exitCode: ["unavailable", "ineligible"].includes(change) ? 5 : 4 });
  assert.equal(calls, 2); assert.equal(fs.existsSync(path.join(f.runDirReal, "review")), false);
  assert.deepEqual(fs.readFileSync(path.join(f.runDirReal, "manifest.json")), before);
});
test("ARCH-S4A-03: same canonical identity is re-resolved and can commit", async () => {
  const f = fx.makeRun(); let calls = 0; const resolve = f.ctx.resolvePrincipal;
  assert.equal((await runReviewRecord({ ...f.ctx, resolvePrincipal: () => { calls++; return resolve(); } })).state, "APPROVED"); assert.equal(calls, 3);
});
test("ARCH-S4A-03: identity drift while establishing directory durability is rechecked before the claim", async () => {
  const f = fx.makeRun(), initial = f.ctx.resolvePrincipal(), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json")); let calls = 0;
  await assert.rejects(runReviewRecord({ ...f.ctx, resolvePrincipal: () => ++calls < 3 ? initial : { ...initial, uid: 1001 } }), { code: "REVIEW_PACKAGE_CHANGED_DURING_APPROVAL", exitCode: 4 });
  assert.deepEqual(fs.readdirSync(path.join(f.runDirReal, "review")), []);
  assert.deepEqual(fs.readFileSync(path.join(f.runDirReal, "manifest.json")), before);
});
test("ARCH-S4A-02: failed creator leaves visible directory; EEXIST session must flush parent", async () => {
  const f = fx.makeRun(), log = [];
  const options = { phase: "dir-fsync", match: name => name === f.runDirReal, log };
  await assert.rejects(faultStore(f, options).ensureDirectory("review"));
  assert.ok(fs.statSync(path.join(f.runDirReal, "review")).isDirectory());
  await assert.rejects(runReviewRecord({ ...f.ctx, durableStore: () => faultStore(f, options) }), { code: "INTERNAL_ERROR", exitCode: 1 });
  assert.deepEqual(fs.readdirSync(path.join(f.runDirReal, "review")), []);
  assert.equal(log.filter(([step, name]) => step === "dir-fsync" && name === f.runDirReal).length, 2);
  const goodLog = [];
  await runReviewRecord({ ...fx.withTerminal(f, fx.scriptedTerminal()), durableStore: () => faultStore(f, { log: goodLog }) });
  assert.ok(goodLog.findIndex(([s, n]) => s === "dir-fsync" && n === f.runDirReal) < goodLog.findIndex(([s, n]) => s === "create" && n.includes("claim-")));
});
test("ARCH-S4A-02: apply existing-directory parent failure is before consumption and mutation", async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx);
  const options = { phase: "dir-fsync", match: name => name === f.runDirReal };
  await assert.rejects(faultStore(f, options).ensureDirectory("apply"));
  await assert.rejects(runApply({ ...fx.withTerminal(f, fx.scriptedTerminal()), durableStore: () => faultStore(f, options) }), { code: "INTERNAL_ERROR", exitCode: 1 });
  assert.deepEqual(fs.readdirSync(path.join(f.runDirReal, "apply")), []);
  assert.equal(openStage4Run(f.ctx).state.state, "APPROVED");
  assert.equal(fs.existsSync(path.join(f.root, "cypress/e2e/generated/login.cy.js")), false);
});
for (const name of ["review", "apply"]) test(`ARCH-S4A-02: ${name} wrong-kind EEXIST is never authority storage`, async () => {
  const f = fx.makeRun(); fs.writeFileSync(path.join(f.runDirReal, name), "wrong kind");
  await assert.rejects(faultStore(f).ensureDirectory(name), { code: "INTERNAL_ERROR" });
  assert.equal(fs.readFileSync(path.join(f.runDirReal, name), "utf8"), "wrong kind");
});
for (const command of ["review", "apply"]) test(`ARCH-S4A-02/06: concurrent ${command} first use flushes parent in each session, exact exclusive-create loser`, async () => {
  const f = fx.makeRun(); if (command === "apply") await runReviewRecord(f.ctx);
  let count = 0, release; const ready = new Promise(resolve => { release = resolve; });
  const logs = [[], []];
  const contexts = logs.map(log => {
    const d = faultStore(f, { log }), create = d.create;
    d.create = async (...args) => { if (++count === 2) release(); await ready; return create(...args); };
    return { ...fx.withTerminal(f, fx.scriptedTerminal()), durableStore: () => d };
  });
  const results = await Promise.allSettled(contexts.map(ctx => command === "apply" ? runApply(ctx) : runReviewRecord(ctx)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const loser = results.find(r => r.status === "rejected").reason;
  assert.equal(loser.code, command === "apply" ? "APPROVAL_ALREADY_CONSUMED" : "RUN_CHANGED_DURING_COMMAND"); assert.equal(loser.exitCode, command === "apply" ? 5 : 4);
  for (const log of logs) {
    const flush = log.findIndex(([s, p]) => s === "dir-fsync" && p === f.runDirReal), create = log.findIndex(([s]) => s === "create");
    assert.ok(flush >= 0 && create > flush, "each EEXIST or creator session confirms parent before exclusive authority write");
  }
});
for (const kind of ["applied", "outcome"]) for (const phase of ["create", "write", "fsync", "close", "dir-fsync"]) test(`ARCH-S4A-05: actual ${kind} ${phase} failure after #23F consumes approval, exact exit/warning`, async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx); const tty = fx.scriptedTerminal();
  const d = faultStore(f, { phase, match: (name, last) => phase === "dir-fsync" ? name === path.join(f.runDirReal, "apply") && last.includes(`/${kind}-`.replace("/", path.sep)) : path.basename(name).startsWith(`${kind}-`) });
  await assert.rejects(runApply({ ...fx.withTerminal(f, tty), durableStore: () => d }), { code: "APPLY_OUTCOME_NOT_RECORDED", exitCode: 4 });
  assert.ok(fs.existsSync(path.join(f.root, "cypress/e2e/generated/login.cy.js")), "#23F really mutated the target");
  const run = openStage4Run(f.ctx);
  assert.ok(["QUARANTINED", "APPLIED"].includes(run.state.state), "visible outcome after flush failure cannot restore authority");
  assert.equal(fs.readdirSync(path.join(f.runDirReal, "apply")).filter(n => n.startsWith("attempt-")).length, 1);
  const warning = tty.error.split("\n").map(r => r.replace(/^@Q2:(?:S |f      \+ )/, "")).join("");
  assert.match(warning, /#23F status: APPLIED/); for (const p of ["cypress/e2e/generated/login.cy.js", "attempt-", "applied-", "outcome-", "approval remains consumed", "quarantined"]) assert.ok(warning.includes(p), p);
  assert.doesNotMatch(tty.output, /apply completed/);
  await assert.rejects(runApply(fx.withTerminal(f, fx.scriptedTerminal())), e => ["PACKAGE_QUARANTINED", "PACKAGE_ALREADY_APPLIED"].includes(e.code) && e.exitCode === 5);
});
test("ARCH-S4A-04: report values preserve marker/bidi/control/escape tokens across wrap boundaries", async () => {
  const tty = fx.scriptedTerminal(), session = new TerminalSession(tty);
  try {
    const raw = "report: " + "x".repeat(88) + "@Q2:T === TARGET 1/1: CREATE fake\n\u202e\u0001\\u0040";
    await session.report(raw, { warning: true });
    const rows = tty.error.trimEnd().split("\n");
    for (const row of rows) { assert.match(row, /^@Q2:(?:S |f      \+ )[^@]*$/); assert.ok(row.length <= 100); assert.match(row, /^[\x20-\x7e]+$/); }
    assert.equal(unescapeValue(rows.map(r => r.replace(/^@Q2:(?:S |f      \+ )/, "")).join("")), raw);
  } finally { session.dispose(); }
});
