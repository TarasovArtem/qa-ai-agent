"use strict";
// Repository verification only. Not packed, exported, in bin or reachable
// through a production option/environment/provider. Real #23F is used.
const fs = require("node:fs");
const path = require("node:path");
const { PassThrough, Writable } = require("node:stream");
const { EventEmitter } = require("node:events");
const fx = require("./stage3-fixtures");
const store = require("../../scripts/ai/cli/run-store");
const artifacts = require("../../scripts/ai/cli/run-artifacts");
const { assertValidRepositoryRoot } = require("../../scripts/ai/repository-root");
const { validateConfig } = require("../../scripts/ai/cli/config-file");
const { buildGeneratedChangeSet } = require("../../scripts/ai/test-automation/generated-change-set");
const { buildGeneratedChangeSetReviewPackage } = require("../../scripts/ai/test-automation/generated-change-set-review-package");
const { createDurableStore } = require("../../scripts/ai/cli/stage4-durability");
const { resolvePrincipal } = require("../../scripts/ai/cli/stage4-principal");
const pkg = require("../../package.json");
function scriptedTerminal({ decision = "APPROVE", comment = "", answer, onWrite } = {}) {
  const stdin = new PassThrough(); stdin.isTTY = true; let output = "", error = "", lines = [];
  const stdout = new Writable({ write(chunk, encoding, callback) {
    const text = chunk.toString(); output += text; lines.push(text); if (onWrite) onWrite(text);
    if (answer) { const line = answer(text, output); if (line !== undefined) setImmediate(() => stdin.write(line + "\n")); }
    else if (text.startsWith("@Q2:P ") || text.startsWith("@Q2:E ")) setImmediate(() => stdin.write("\n"));
    else if (text.startsWith("@Q2:I ")) { const m = /type:  APPROVE ([0-9A-Z]{8})/.exec(output); setImmediate(() => stdin.write(`${decision} ${m[1]}\n`)); }
    else if (text.startsWith("@Q2:M ")) setImmediate(() => stdin.write(comment + "\n"));
    else if (text.startsWith("@Q2:S To apply")) { const m = /APPLY ([0-9A-Z]{8})/.exec(text); setImmediate(() => stdin.write(`APPLY ${m[1]}\n`)); }
    callback();
  } }); stdout.isTTY = true; stdout.columns = 100; stdout.rows = 24;
  const stderr = new Writable({ write(chunk, encoding, callback) { error += chunk.toString(); callback(); } }); stderr.isTTY = true;
  const processAdapter = new EventEmitter(); processAdapter.pid = 1; processAdapter.kill = (pid, signal) => { processAdapter.completedSignal = signal; }; processAdapter.exit = status => { processAdapter.exitStatus = status; };
  return { stdin, stdout, stderr, processAdapter, get output() { return output; }, get error() { return error; }, get lines() { return lines; } };
}
function windowsFilesystemHarness(run) {
  const log = []; const io = { ...fs.promises, async open(name, flags, mode) {
    log.push(["open", name]);
    if (fs.existsSync(name) && fs.lstatSync(name).isDirectory()) return { async sync() { log.push(["fsync-dir", name]); }, async close() { log.push(["close-dir", name]); } };
    const h = await fs.promises.open(name, flags, mode);
    return { async write(...args) { log.push(["write", name]); return h.write(...args); }, async sync() { log.push(["fsync", name]); return h.sync(); }, async close() { log.push(["close", name]); return h.close(); } };
  }, async rename(a, b) { log.push(["rename", a, b]); return fs.promises.rename(a, b); } };
  // On Linux use real directory flushes, so CI exercises actual POSIX
  // primitives. Windows mocks below are test ordering evidence only.
  return { store: createDurableStore({ ...run, io: process.platform === "win32" ? io : fs.promises }), io, log };
}
function makeRun({ content = fx.GENERATED_CONTENT, purpose, terminal, platform = "linux" } = {}) {
  const raw = fx.makeStage3Root(fx.stage3Config({ capabilities: { design: true, plan: true, generate: true, reviewRecord: true, apply: true } }));
  fs.mkdirSync(path.join(raw, "cypress/e2e/generated"), { recursive: true });
  const root = assertValidRepositoryRoot(raw, "Stage 4 test"), config = validateConfig(JSON.parse(fs.readFileSync(path.join(raw, "qa-agent.config.json"))));
  const runId = "20261012T120000Z-0123456789abcdef", runDirRel = store.runDirectoryRel(config, runId), protectedPaths = ["qa-agent.config.json", "cypress", "playwright", ".git", ".github"];
  let manifest = store.newManifest({ runId, product: { name: pkg.name, version: pkg.version }, projection: store.computeProjection(config, store.requirementsDigest(root, config)), createdAt: "2026-10-12T12:00:00.000Z" });
  const context = artifacts.buildLiveRepositoryContext(root, config), plan = fx.automationPlan(purpose ? { plannedChanges: [{ path: fx.GENERATED_SPEC, operation: "CREATE", purpose }] } : {});
  const built = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [{ operation: "CREATE", path: fx.GENERATED_SPEC, content, baseContentDigest: null }], expectedProjectId: fx.PROJECT_ID }); if (!built.ok) throw new Error(JSON.stringify(built.errors));
  const p = buildGeneratedChangeSetReviewPackage({ automationPlan: plan, repositoryContext: context, generatedChangeSet: built.generatedChangeSet, expectedProjectId: fx.PROJECT_ID }).reviewPackage;
  const stageFiles = [
    ["design", [{ path: "design/requirement-model.json", kind: "RequirementModel", value: fx.requirementModel() }, { path: "design/test-case-model.json", kind: "TestCaseModel", value: fx.testCaseModel() }, ...[fx.candidate("tc-1", "AUTOMATE", "ac-1"), fx.candidate("tc-2", "DO_NOT_AUTOMATE", "ac-2")].map((value, i) => ({ path: `design/automation-candidate-${String(i + 1).padStart(4, "0")}.json`, kind: "AutomationCandidate", value }))]],
    ["plan", [{ path: "plan/automation-repository-context.json", kind: "AutomationRepositoryContext", value: context }, { path: "plan/automation-plan-0001.json", kind: "AutomationPlan", value: plan }]],
    ["generate", [{ path: "generate/generated-change-set-0001.json", kind: "GeneratedChangeSet", value: built.generatedChangeSet }, { path: "generate/review-package-0001.json", kind: "GeneratedChangeSetReviewPackage", value: p }]],
  ];
  let previousDigest = null;
  for (const [stage, files] of stageFiles) { manifest = store.commitStage(root, runDirRel, protectedPaths, { manifest, previousDigest, stage, files, provider: "groq", model: "test", now: new Date("2026-10-12T12:00:00.000Z") }); previousDigest = store.loadManifest(path.join(raw, runDirRel)).digest; }
  const tty = terminal || scriptedTerminal();
  const ctx = { root, config, protectedPaths, product: { name: pkg.name, version: pkg.version }, runId, packageOrdinal: "0001", platform, env: {}, stdin: tty.stdin, stdout: tty.stdout, stderr: tty.stderr, processAdapter: tty.processAdapter,
    resolvePrincipal: () => resolvePrincipal({ platform, userInfo: () => ({ uid: 1000, username: "reviewer" }) }), storageEligibility: () => {}, now: () => new Date("2026-10-12T12:00:00.000Z") };
  const runDirReal = path.join(raw, runDirRel); const durable = windowsFilesystemHarness({ root, runDirReal, protectedPaths });
  ctx.durableStore = () => durable.store;
  return { ctx, tty, root: raw, runDirReal, durable, reviewPackage: p, plan, context, generatedChangeSet: built.generatedChangeSet };
}
function withTerminal(fx, tty) { return { ...fx.ctx, stdin: tty.stdin, stdout: tty.stdout, stderr: tty.stderr, processAdapter: tty.processAdapter }; }
module.exports = { scriptedTerminal, makeRun, withTerminal, windowsFilesystemHarness };
