"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cleanupScratch } = require("../../../test/helpers/qa-agent-cli");
const fx = require("../../../test/helpers/stage4-fixtures");
const { runReviewRecord } = require("./review-record");
const { runApply } = require("./apply");
const { openStage4Run, selectedRecord, rebuildSubject, verifyRecordBinding } = require("./stage4-run");
const { validateRecord, recordDigest } = require("./review-record-v2");
const { CliError } = require("./errors");
after(cleanupScratch);
for (const command of [runReviewRecord, runApply]) {
  for (const stream of ["stdin", "stdout", "stderr"]) test(`${command.name}: non-TTY ${stream} refuses before run access`, async () => {
    const f = fx.makeRun(); f.ctx[stream].isTTY = false; f.ctx.runId = "invalid-run";
    await assert.rejects(command(f.ctx), { code: "INTERACTIVE_TERMINAL_REQUIRED" });
    assert.equal(fs.existsSync(path.join(f.runDirReal, "review")), false);
  });
  for (const env of [{ CI: "true" }, { CI: "1" }, { GITHUB_ACTIONS: "true" }]) test(`${command.name}: CI policy ${JSON.stringify(env)}`, async () => { const f = fx.makeRun(); await assert.rejects(command({ ...f.ctx, env }), e => /CI_FORBIDDEN$/.test(e.code)); });
}
test("review challenge wrong case/space/trailing/pretyped lines never commit", async () => {
  for (const wrong of ["approve", "APPROVE wrong", "APPROVE  ", "APPROVE x trailing", "APPROVE 00000000"]) {
    const tty = fx.scriptedTerminal({ answer(text) { if (text.startsWith("@Q2:E ") || text.startsWith("@Q2:P ")) return ""; if (text.startsWith("@Q2:I ")) return wrong; } });
    const f = fx.makeRun({ terminal: tty }); tty.stdin.write("APPROVE 00000000\n");
    await assert.rejects(runReviewRecord(f.ctx), { code: "HUMAN_DECISION_NOT_CONFIRMED" }); assert.equal(fs.existsSync(path.join(f.runDirReal, "review")), false);
  }
});
test("EOF at paging and observed geometry violation/restoration abort without claims", async () => {
  const tty = fx.scriptedTerminal({ answer(text) { if (text.startsWith("@Q2:P ")) setImmediate(() => tty.stdin.end()); } });
  const f = fx.makeRun({ terminal: tty, content: "x".repeat(50000) }); await assert.rejects(runReviewRecord(f.ctx), { code: "HUMAN_DECISION_NOT_CONFIRMED" }); assert.equal(fs.existsSync(path.join(f.runDirReal, "review")), false);
  const resize = fx.scriptedTerminal({ answer(text) { if (text.startsWith("@Q2:E ")) { resize.stdout.columns = 99; resize.stdout.emit("resize"); resize.stdout.columns = 100; return ""; } } });
  const g = fx.makeRun({ terminal: resize }); await assert.rejects(runReviewRecord(g.ctx), { code: "INTERACTIVE_TERMINAL_REQUIRED" }); assert.equal(fs.existsSync(path.join(g.runDirReal, "review")), false);
});
test("SIGINT, SIGHUP and SIGTERM before the decision abort without creating a claim", async () => {
  for (const signal of ["SIGINT", "SIGHUP", "SIGTERM"]) {
    let tty;
    tty = fx.scriptedTerminal({ onWrite(text) { if (text.startsWith("@Q2:I ")) setImmediate(() => tty.processAdapter.emit(signal)); } });
    const f = fx.makeRun({ terminal: tty });
    await assert.rejects(runReviewRecord(f.ctx), { code: "HUMAN_DECISION_NOT_CONFIRMED" });
    assert.equal(fs.existsSync(path.join(f.runDirReal, "review")), false, signal);
    assert.equal(tty.processAdapter.completedSignal, signal);
  }
});
test("review session expiry after TAP-2 output aborts before challenge authority", async () => {
  let ticks = 0n, tty;
  tty = fx.scriptedTerminal({ answer(text, output) {
    if (text.startsWith("@Q2:P ") || text.startsWith("@Q2:E ")) return "";
    if (text.startsWith("@Q2:I ")) {
      ticks = 60n * 60n * 1_000_000_000n + 1n;
      const challenge = /type:  APPROVE ([0-9A-Z]{8})/.exec(output)[1];
      return `APPROVE ${challenge}`;
    }
  } });
  const f = fx.makeRun({ terminal: tty });
  await assert.rejects(runReviewRecord({ ...f.ctx, monotonic: () => ticks }), { code: "APPROVAL_SESSION_EXPIRED" });
  assert.equal(fs.existsSync(path.join(f.runDirReal, "review")), false);
});
test("approval is derived from durable claim, record and manifest; apply consumes it once", async () => {
  const f = fx.makeRun();
  const approved = await runReviewRecord(f.ctx);
  assert.equal(approved.state, "APPROVED");
  const tty = fx.scriptedTerminal();
  const apply = await runApply(fx.withTerminal(f, tty));
  assert.equal(apply.result, "APPLIED");
  assert.equal(fs.existsSync(path.join(f.root, "cypress/e2e/generated/login.cy.js")), true);
  await assert.rejects(runApply(f.ctx), { code: "PACKAGE_ALREADY_APPLIED" });
});
test("apply refuses a changed OS principal before reserving an attempt", async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx);
  const changed = { ...f.ctx, ...fx.withTerminal(f, fx.scriptedTerminal()), resolvePrincipal: () => ({ method: "os-local-account-v1", principal: "os-account-v1:other", uid: 1001, profileDigest: null, platform: "linux", assurance: "LOCAL_ACCOUNT_ATTRIBUTION" }) };
  await assert.rejects(runApply(changed), { code: "APPLY_PRINCIPAL_MISMATCH" });
  assert.equal(fs.existsSync(path.join(f.runDirReal, "apply")), false);
});
test("concurrent review reservations allow exactly one claim to commit", async () => {
  const f = fx.makeRun(), first = fx.scriptedTerminal(), second = fx.scriptedTerminal();
  const results = await Promise.allSettled([
    runReviewRecord(fx.withTerminal(f, first)),
    runReviewRecord(fx.withTerminal(f, second)),
  ]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.equal(results.find(x => x.status === "rejected").reason.code, "RUN_CHANGED_DURING_COMMAND");
  assert.equal(results.find(x => x.status === "rejected").reason.exitCode, 4);
  const run = openStage4Run(f.ctx);
  assert.equal(run.manifest.reviews.length, 1);
  assert.equal(run.state.state, "APPROVED");
});
test("review supersession during apply confirmation is detected before reservation", async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx);
  const rejectTty = fx.scriptedTerminal({ decision: "REJECT" });
  let supersession;
  let applyTty;
  applyTty = fx.scriptedTerminal({ answer(text) {
    if (text.startsWith("@Q2:S To apply this package")) {
      const challenge = /APPLY ([0-9A-Z]{8})/.exec(text)[1];
      supersession = runReviewRecord(fx.withTerminal(f, rejectTty)).then(() => applyTty.stdin.write(`APPLY ${challenge}\n`));
    }
  } });
  await assert.rejects(runApply(fx.withTerminal(f, applyTty)), { code: "APPROVAL_DECISION_REJECTED" });
  await supersession;
  assert.equal(openStage4Run(f.ctx).state.state, "REJECTED");
  assert.equal(fs.existsSync(path.join(f.runDirReal, "apply")), false);
});
test("concurrent apply confirmations create one attempt reservation and one mutation", async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx);
  const results = await Promise.allSettled([
    runApply(fx.withTerminal(f, fx.scriptedTerminal())),
    runApply(fx.withTerminal(f, fx.scriptedTerminal())),
  ]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.equal(results.filter(x => x.status === "rejected").length, 1);
  assert.equal(results.find(x => x.status === "rejected").reason.code, "APPROVAL_ALREADY_CONSUMED");
  assert.equal(results.find(x => x.status === "rejected").reason.exitCode, 5);
  const applyDir = path.join(f.runDirReal, "apply");
  assert.equal(fs.readdirSync(applyDir).filter(n => n.startsWith("attempt-")).length, 1);
  assert.equal(fs.readdirSync(applyDir).filter(n => n.startsWith("outcome-")).length, 1);
  assert.equal(openStage4Run(f.ctx).state.state, "APPLIED");
  assert.equal(fs.existsSync(path.join(f.root, "cypress/e2e/generated/login.cy.js")), true);
});
test("claim created after apply's manifest recheck fails the post-reservation fence before #23F", async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx);
  const makeStore = f.ctx.durableStore;
  f.ctx.durableStore = () => {
    const durable = makeStore(), create = durable.create;
    let injected = false;
    durable.create = async (...args) => {
      const result = await create(...args);
      if (!injected && String(args[0]).startsWith("apply/attempt-")) {
        injected = true;
        await create("review/claim-0002.json", Buffer.from("{}"));
      }
      return result;
    };
    return durable;
  };
  await assert.rejects(runApply(f.ctx), { code: "APPROVAL_NOT_FOUND" });
  assert.equal(fs.existsSync(path.join(f.root, "cypress/e2e/generated/login.cy.js")), false);
  const run = openStage4Run(f.ctx);
  assert.equal(run.state.state, "QUARANTINED");
  assert.equal(fs.readdirSync(path.join(f.runDirReal, "apply")).filter(n => n.startsWith("outcome-")).length, 1);
});
test("post-rename directory flush failure is orphaned and never rolled back", async () => {
  const f = fx.makeRun();
  const real = f.ctx.durableStore;
  f.ctx.durableStore = () => {
    const base = real();
    const replace = base.replace;
    base.replace = async (...args) => { await replace(...args); throw Object.assign(new CliError(1, "INTERNAL_ERROR", "directory flush uncertainty"), { sectionOutcome: "ORPHANED", renamed: true }); };
    return base;
  };
  await assert.rejects(runReviewRecord(f.ctx), e => e.code === "INTERNAL_ERROR" && e.sectionOutcome === "ORPHANED");
  assert.equal(fs.existsSync(path.join(f.runDirReal, "manifest.json")), true);
  const { derivePackageState } = require("./stage4-state");
  const { openStage4Run } = require("./stage4-run");
  const observed = openStage4Run(f.ctx);
  assert.equal(derivePackageState("0001", observed.authorityEvidence).state, "APPROVED");
  assert.match(f.tty.error, /replacement durability is unconfirmed/);
});
test("new REJECT supersedes an earlier APPROVE and blocks apply", async () => {
  const f = fx.makeRun();
  assert.equal((await runReviewRecord(f.ctx)).decision, "APPROVE");
  const rejectTty = fx.scriptedTerminal({ decision: "REJECT" });
  assert.equal((await runReviewRecord(fx.withTerminal(f, rejectTty))).decision, "REJECT");
  assert.equal(openStage4Run(f.ctx).state.state, "REJECTED");
  await assert.rejects(runApply(f.ctx), { code: "APPROVAL_DECISION_REJECTED" });
});
test("v2 closed schema, core consistency, expiry, future time and run binding reject hostile records", async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx);
  const run = openStage4Run(f.ctx), record = selectedRecord(run), rebuilt = rebuildSubject(f.ctx, run);
  for (const mutate of [
    r => { r.extra = true; }, r => { r.subject.extra = true; }, r => { r.binding.extra = true; },
    r => { r.reviewer.extra = true; }, r => { r.provenance.extra = true; }, r => { r.validity.extra = true; },
    r => { r.core.extra = true; }, r => { r.core.reviewedAt = "2026-10-12T12:01:00.000Z"; },
  ]) {
    const bad = structuredClone(record); mutate(bad);
    if (bad.core && !Object.hasOwn(bad.core, "extra")) { /* keep schema mutation test closed */ }
    assert.throws(() => validateRecord(bad, { reviewPackage: rebuilt.reviewPackage }), { code: "REVIEW_RECORD_INVALID" });
  }
  const expiredAt = Date.parse(record.validity.notAfter) + 1;
  await assert.rejects(runApply({ ...f.ctx, now: () => new Date(expiredAt) }), { code: "APPROVAL_EXPIRED" });
  const badDigest = structuredClone(record); badDigest.recordDigest = `sha256:${"0".repeat(64)}`;
  assert.throws(() => validateRecord(badDigest, { reviewPackage: rebuilt.reviewPackage }), { code: "REVIEW_RECORD_INVALID" });
  const inconsistentDecision = structuredClone(record); inconsistentDecision.decision = "REJECT"; inconsistentDecision.recordDigest = recordDigest(inconsistentDecision);
  assert.throws(() => validateRecord(inconsistentDecision, { reviewPackage: rebuilt.reviewPackage }), { code: "REVIEW_RECORD_INVALID" });
  assert.throws(() => validateRecord(record, { reviewPackage: rebuilt.reviewPackage, now: Date.parse(record.provenance.decidedAt) - 300001 }), { code: "REVIEW_RECORD_INVALID" });
  const crossRun = structuredClone(record); crossRun.subject.runId = "20261012T120001Z-0123456789abcdef"; crossRun.recordDigest = recordDigest(crossRun);
  assert.throws(() => verifyRecordBinding(crossRun, rebuilt, Date.parse(record.provenance.decidedAt)), { code: "REVIEW_RECORD_RUN_MISMATCH" });
});
