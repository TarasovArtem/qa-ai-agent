"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fx = require("../../../test/helpers/stage4-fixtures");
const { cleanupScratch } = require("../../../test/helpers/qa-agent-cli");
const { runReviewRecord } = require("./review-record");
const { runApply } = require("./apply");
const { openStage4Run, selectedRecord } = require("./stage4-run");
const { TerminalSession } = require("./terminal-session");
after(cleanupScratch);

function afterDirectory(f, hook) {
  const d = f.ctx.durableStore(), ensure = d.ensureDirectory;
  d.ensureDirectory = async name => { await ensure(name); await hook(); };
  return { ...f.ctx, durableStore: () => d };
}
function noReviewAuthority(f, before) {
  assert.deepEqual(fs.readdirSync(path.join(f.runDirReal, "review")), []);
  assert.deepEqual(fs.readFileSync(path.join(f.runDirReal, "manifest.json")), before);
  assert.equal(openStage4Run(f.ctx).state.state, "UNREVIEWED");
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) test(`ARCH-S4A-C1-09: ${signal} after D-DIR refuses before claim`, async () => {
  const f = fx.makeRun(), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  // Queued delivery exercises the explicit pre-claim callback drain.
  await assert.rejects(runReviewRecord(afterDirectory(f, () => { setImmediate(() => f.tty.processAdapter.emit(signal)); })), { code: "HUMAN_DECISION_NOT_CONFIRMED", exitCode: 5 });
  noReviewAuthority(f, before);
  assert.equal(f.tty.processAdapter.completedSignal, signal);
});
for (const [field, value] of [["columns", 99], ["rows", 23], ["rows", undefined], ["rows", 24.5]]) test(`ARCH-S4A-C1-09: pre-claim ${field}=${value} refuses without evidence`, async () => {
  const f = fx.makeRun(), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  await assert.rejects(runReviewRecord(afterDirectory(f, () => { f.tty.stdout[field] = value; })), { code: "INTERACTIVE_TERMINAL_REQUIRED", exitCode: 5 });
  noReviewAuthority(f, before);
});
test("ARCH-S4A-C1-09: queued observed resize remains latched after restoration", async () => {
  const f = fx.makeRun(), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  await assert.rejects(runReviewRecord(afterDirectory(f, () => { setImmediate(() => {
    f.tty.stdout.columns = 99; f.tty.stdout.emit("resize"); f.tty.stdout.columns = 100;
  }); })), { code: "INTERACTIVE_TERMINAL_REQUIRED", exitCode: 5 });
  noReviewAuthority(f, before);
});
test("ARCH-S4A-C1-09: expiry during D-DIR is still before claim", async () => {
  const f = fx.makeRun(), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json")); let ticks = 0n;
  await assert.rejects(runReviewRecord({ ...afterDirectory(f, () => { ticks = 3600000000001n; }), monotonic: () => ticks }), { code: "APPROVAL_SESSION_EXPIRED", exitCode: 5 });
  noReviewAuthority(f, before);
});
test("ARCH-S4A-C1-09: EOF during D-DIR is still before claim", async () => {
  const f = fx.makeRun(), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  await assert.rejects(runReviewRecord(afterDirectory(f, () => { f.tty.stdin.end(); })), { code: "HUMAN_DECISION_NOT_CONFIRMED", exitCode: 5 });
  noReviewAuthority(f, before);
});
test("ARCH-S4A-C1-09: claim section contains only bounded local persistence", async () => {
  const f = fx.makeRun(), d = f.ctx.durableStore(); let session, critical = false;
  const originals = new Map();
  for (const name of ["enterCritical", "exitCritical", "checkTime", "checkGeometry", "readLine", "emit", "report"]) {
    const original = TerminalSession.prototype[name]; originals.set(name, original);
    TerminalSession.prototype[name] = function (...args) {
      session = this;
      if (name === "enterCritical") { const result = original.apply(this, args); critical = true; return result; }
      if (name === "exitCritical") { const result = original.apply(this, args); critical = false; return result; }
      assert.equal(critical, false, `${name} must be outside CS`);
      return original.apply(this, args);
    };
  }
  const ensure = d.ensureDirectory; d.ensureDirectory = async (...args) => { assert.equal(critical, false); return ensure(...args); };
  const steps = [];
  for (const name of ["create", "replace"]) {
    const original = d[name]; d[name] = async (...args) => {
      assert.equal(critical, true); assert.equal(session.phase, "CRITICAL");
      steps.push(name === "create" ? args[0].split("/")[1].split("-")[0] : name);
      return original(...args);
    };
  }
  const resolve = f.ctx.resolvePrincipal, now = f.ctx.now;
  try {
    const result = await runReviewRecord({ ...f.ctx, durableStore: () => d,
      resolvePrincipal: () => { assert.equal(critical, false); return resolve(); },
      now: () => { assert.equal(critical, false); return now(); } });
    assert.equal(result.state, "APPROVED"); assert.deepEqual(steps, ["claim", "record", "replace"]);
    assert.equal(critical, false);
  } finally { for (const [name, original] of originals) TerminalSession.prototype[name] = original; }
});
for (const fail of [false, true]) test(`ARCH-S4A-C1-09: withheld ${fail ? "warning" : "success"} callback sees CS already exited`, async () => {
  const f = fx.makeRun(); let release, session, reportReached;
  const reached = new Promise(resolve => { reportReached = resolve; });
  const originalReport = TerminalSession.prototype.report;
  TerminalSession.prototype.report = function (...args) { session = this; return originalReport.apply(this, args); };
  const stream = fail ? f.tty.stderr : f.tty.stdout, write = stream.write;
  stream.write = function (text, callback) {
    if (String(text).startsWith(fail ? "@Q2:S WARNING:" : "@Q2:S decision recorded:")) { release = callback; reportReached(); return false; }
    return write.call(this, text, callback);
  };
  if (fail) { const d = f.ctx.durableStore(); d.replace = async () => { throw Object.assign(new Error("replacement failed"), { code: "INTERNAL_ERROR", sectionOutcome: "PRE_RENAME_FAILED" }); }; f.ctx.durableStore = () => d; }
  let settled = false;
  const result = runReviewRecord(f.ctx).then(value => ({ value }), error => ({ error })).finally(() => { settled = true; });
  try {
    await reached;
    assert.equal(settled, false, "report callback is intentionally still withheld");
    assert.equal(session.phase, "FINISHED");
    assert.equal(openStage4Run(f.ctx).state.state, fail ? "QUARANTINED" : "APPROVED");
    release(); release = null;
    const outcome = await result;
    if (fail) assert.equal(outcome.error.code, "INTERNAL_ERROR"); else assert.equal(outcome.value.state, "APPROVED");
  } finally { if (release) release(); TerminalSession.prototype.report = originalReport; stream.write = write; }
});

// Wrap the actual #23F entry only to observe its inputs/result or inject a
// binding mismatch. Every result below comes from the real canonical routine.
function observedApply(observe) {
  const canonical = require("../test-automation/change-set-application"), original = canonical.applyApprovedGeneratedChangeSet;
  const modulePath = require.resolve("./apply"), previous = require.cache[modulePath];
  canonical.applyApprovedGeneratedChangeSet = input => observe(input, original);
  try { delete require.cache[modulePath]; return require("./apply").runApply; }
  finally { canonical.applyApprovedGeneratedChangeSet = original; require.cache[modulePath] = previous; }
}
for (const race of ["CREATE_EXISTS", "CREATE_DIRECTORY", "CREATE_PARENT_MISSING", "BINDING_DIGEST", "BINDING_CONTENT"]) test(`ARCH-S4A-C1-10: real #23F ${race}, consumed zero-write refusal and persisted outcome`, async () => {
  const f = fx.makeRun();
  await runReviewRecord(f.ctx);
  const record = selectedRecord(openStage4Run(f.ctx)), target = path.join(f.root, "cypress/e2e/generated/login.cy.js");
  const d = f.ctx.durableStore(), create = d.create; let reserved = false, entered = false;
  d.create = async (name, ...args) => {
    const result = await create(name, ...args);
    if (name.startsWith("apply/attempt-")) {
      reserved = true;
      if (race === "CREATE_EXISTS") fs.writeFileSync(target, "other actor's bytes");
      if (race === "CREATE_DIRECTORY") fs.mkdirSync(target);
      if (race === "CREATE_PARENT_MISSING") fs.rmdirSync(path.dirname(target));
    }
    return result;
  };
  let result;
  const apply = observedApply((input, real) => {
    entered = true; assert.equal(reserved, true);
    assert.equal(fs.statSync(path.join(f.runDirReal, `apply/attempt-0001-${record.recordId}.json`)).size, 0);
    if (race === "BINDING_DIGEST") input.generatedChangeSet = { ...input.generatedChangeSet, changeSetDigest: `sha256:${"0".repeat(64)}` };
    if (race === "BINDING_CONTENT") {
      const { buildGeneratedChangeSet } = require("../test-automation/generated-change-set");
      const built = buildGeneratedChangeSet({ automationPlan: input.automationPlan, repositoryContext: input.repositoryContext, changes: input.generatedChangeSet.changes.map(c => ({ ...c, content: "describe('different', () => {});" })), expectedProjectId: input.expectedProjectId });
      assert.equal(built.ok, true); input.generatedChangeSet = built.generatedChangeSet;
    }
    result = real(input); return result;
  });
  await assert.rejects(apply({ ...fx.withTerminal(f, fx.scriptedTerminal()), durableStore: () => d }), { code: race.startsWith("BINDING") ? "APPLY_BINDING_MISMATCH" : "APPLY_PRECONDITION_FAILED", exitCode: 4 });
  assert.equal(entered, true); assert.equal(result.ok, false); assert.equal(result.appliedChangeSetRecord, null);
  assert.equal(result.errors[0].code, race === "BINDING_DIGEST" ? "INVALID_VALUE" : race === "BINDING_CONTENT" ? "INVALID_REFERENCE" : "INVARIANT_VIOLATION");
  if (race === "CREATE_EXISTS") assert.equal(fs.readFileSync(target, "utf8"), "other actor's bytes");
  else if (race === "CREATE_DIRECTORY") assert.deepEqual(fs.readdirSync(target), []);
  else assert.equal(fs.existsSync(target), false);
  const outcomePath = path.join(f.runDirReal, `apply/outcome-0001-${record.recordId}.json`);
  assert.deepEqual(JSON.parse(fs.readFileSync(outcomePath)), { kind: "QaAgentApplyOutcome", schemaVersion: 1, packageOrdinal: "0001", recordId: record.recordId, result: "REFUSED_NO_WRITE", appliedRecordSha256: null, completedAt: f.ctx.now().toISOString() });
  assert.deepEqual(fs.readdirSync(path.join(f.runDirReal, "apply")).sort(), [`attempt-0001-${record.recordId}.json`, `outcome-0001-${record.recordId}.json`]);
  assert.equal(openStage4Run(f.ctx).state.state, "CONSUMED");
  await assert.rejects(runApply(fx.withTerminal(f, fx.scriptedTerminal())), { code: "APPROVAL_ALREADY_CONSUMED", exitCode: 5 });
});

for (const skew of [60000, 300000, 300001]) test(`ARCH-S4A-C1-11: decidedAt positive skew ${skew}ms uses canonical tolerance`, async () => {
  const f = fx.makeRun(), now = f.ctx.now().getTime();
  await runReviewRecord({ ...f.ctx, now: () => new Date(now + skew) });
  const apply = runApply(fx.withTerminal(f, fx.scriptedTerminal()));
  if (skew <= 300000) assert.equal((await apply).result, "APPLIED");
  else {
    await assert.rejects(apply, { code: "REVIEW_RECORD_INVALID", exitCode: 4 });
    assert.equal(fs.existsSync(path.join(f.runDirReal, "apply")), false);
    assert.equal(fs.existsSync(path.join(f.root, "cypress/e2e/generated/login.cy.js")), false);
    assert.equal(openStage4Run(f.ctx).state.state, "APPROVED");
  }
});
test("ARCH-S4A-C1-11 / ARCH-S4A-01: genuine expiry immediately before reservation never enters #23F", async () => {
  const f = fx.makeRun(); await runReviewRecord(f.ctx); let entered = false;
  let now = Date.parse(selectedRecord(openStage4Run(f.ctx)).validity.notAfter);
  const apply = observedApply((input, real) => { entered = true; return real(input); });
  const ctx = afterDirectory(f, () => { now++; });
  await assert.rejects(apply({ ...ctx, ...fx.withTerminal(f, fx.scriptedTerminal()), durableStore: ctx.durableStore, now: () => new Date(now) }), { code: "APPROVAL_EXPIRED", exitCode: 5 });
  assert.equal(entered, false);
  assert.deepEqual(fs.readdirSync(path.join(f.runDirReal, "apply")), []);
  assert.equal(fs.existsSync(path.join(f.root, "cypress/e2e/generated/login.cy.js")), false);
  assert.equal(openStage4Run(f.ctx).state.state, "APPROVED");
});
