"use strict";
const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fx = require("../../../test/helpers/stage4-fixtures");
const { cleanupScratch } = require("../../../test/helpers/qa-agent-cli");
const store = require("./run-store");
const { runReviewRecord } = require("./review-record");
const { runApply } = require("./apply");
const { openStage4Run, selectedRecord, rebuildSubject } = require("./stage4-run");
const { buildRecord } = require("./review-record-v2");
const { TerminalSession } = require("./terminal-session");
const gcs = require("../test-automation/generated-change-set");
const pkg = require("../test-automation/generated-change-set-review-package");
const core = require("../test-automation/generated-change-set-review-record-builder");
after(cleanupScratch);

// Observe/inject only at the #23F boundary, after the real reservation.
// No canned #23F results: its canonical validators and filesystem checks run.
function observedApply(observe) {
  const canonical = require("../test-automation/change-set-application"), original = canonical.applyApprovedGeneratedChangeSet;
  const modulePath = require.resolve("./apply"), previous = require.cache[modulePath];
  canonical.applyApprovedGeneratedChangeSet = input => observe(input, original);
  try { delete require.cache[modulePath]; return require("./apply").runApply; }
  finally { canonical.applyApprovedGeneratedChangeSet = original; require.cache[modulePath] = previous; }
}
const badDigest = `sha256:${"0".repeat(64)}`;
function redigestRecord(input) { input.reviewRecord.recordDigest = core.recomputeReviewRecordDigest(input.reviewRecord); }
function redigestPackage(input) {
  input.reviewPackage.packageDigest = pkg.recomputeReviewPackageDigest(input.reviewPackage);
  input.reviewRecord.packageDigest = input.reviewPackage.packageDigest; redigestRecord(input);
}
const bindingCases = [
  ["plan digest", "INVALID_REFERENCE", "$.generatedChangeSet.automationPlanDigest", i => { i.generatedChangeSet.automationPlanDigest = badDigest; }],
  ["context digest", "INVALID_REFERENCE", "$.generatedChangeSet.repositoryContextDigest", i => { i.generatedChangeSet.repositoryContextDigest = badDigest; }],
  ["changeset digest", "INVALID_VALUE", "$.generatedChangeSet.changeSetDigest", i => { i.generatedChangeSet.changeSetDigest = badDigest; }],
  ["canonical changeset", "INVALID_REFERENCE", "$.generatedChangeSet", i => { i.generatedChangeSet.automationPlanId = "different-plan"; i.generatedChangeSet.changeSetDigest = gcs.recomputeChangeSetDigest(i.generatedChangeSet); }],
  ["missing planned change", "MISSING_FIELD", "$.generatedChangeSet.changes", i => { i.generatedChangeSet.changes = []; i.generatedChangeSet.changeSetDigest = gcs.recomputeChangeSetDigest(i.generatedChangeSet); }],
  ["changeset/plan path", "INVALID_REFERENCE", "$.generatedChangeSet.changes[0].path", i => { i.generatedChangeSet.changes[0].path = "cypress/e2e/different.cy.js"; i.generatedChangeSet.changeSetDigest = gcs.recomputeChangeSetDigest(i.generatedChangeSet); }],
  ["changeset/plan operation", "INVALID_VALUE", "$.generatedChangeSet.changes[0].operation", i => { i.generatedChangeSet.changes[0].operation = "MODIFY"; i.generatedChangeSet.changeSetDigest = gcs.recomputeChangeSetDigest(i.generatedChangeSet); }],
  ["changeset base content", "INVALID_VALUE", "$.generatedChangeSet.changes[0].baseContentDigest", i => { i.generatedChangeSet.changes[0].baseContentDigest = badDigest; i.generatedChangeSet.changeSetDigest = gcs.recomputeChangeSetDigest(i.generatedChangeSet); }],
  ["context/plan framework", "INVALID_VALUE", "$.repositoryContext.framework", i => { i.repositoryContext.framework = "playwright"; i.generatedChangeSet.repositoryContextDigest = gcs.computeDigest(gcs.LABEL_CONTEXT_BINDING, i.repositoryContext); i.generatedChangeSet.changeSetDigest = gcs.recomputeChangeSetDigest(i.generatedChangeSet); }],
  ["reviewed changeset relationship", "INVALID_REFERENCE", "$.generatedChangeSet.changeSetDigest", i => { i.reviewPackage.changeSetDigest = badDigest; redigestPackage(i); }],
  ["changeset project", "PROJECT_MISMATCH", "$.generatedChangeSet.projectId", i => { i.generatedChangeSet.projectId = "another-project"; }],
  ["context project", "PROJECT_MISMATCH", "$.repositoryContext.projectId", i => { i.repositoryContext.projectId = "another-project"; }],
  ["package project", "PROJECT_MISMATCH", "$.reviewPackage.projectId", i => { i.reviewPackage.projectId = "another-project"; redigestPackage(i); }],
  ["record project", "PROJECT_MISMATCH", "$.reviewRecord.projectId", i => { i.reviewRecord.projectId = "another-project"; redigestRecord(i); }],
  ["package digest", "INVALID_VALUE", "$.reviewPackage.packageDigest", i => { i.reviewPackage.packageDigest = badDigest; }],
  ["record digest", "INVALID_VALUE", "$.reviewRecord.recordDigest", i => { i.reviewRecord.recordDigest = badDigest; }],
  ["record/package relationship", "INVALID_REFERENCE", "$.reviewRecord.packageDigest", i => { i.reviewRecord.packageDigest = badDigest; redigestRecord(i); }],
  ["canonical package", "INVALID_REFERENCE", "$.reviewPackage", i => { i.reviewPackage.automationPlanId = "different-plan"; redigestPackage(i); }],
  ["target count", "INVALID_REFERENCE", "$.reviewPackage.reviewTargets", i => { i.reviewPackage.reviewTargets = []; redigestPackage(i); }],
  ["missing target", "INVALID_REFERENCE", "$.reviewPackage.reviewTargets[0]", i => { i.reviewPackage.reviewTargets[0] = null; redigestPackage(i); }],
  ...["operation", "path", "baseContentDigest", "proposedContent"].map(field => [`target ${field}`, "INVALID_REFERENCE", `$.reviewPackage.reviewTargets[0].${field}`, i => { i.reviewPackage.reviewTargets[0][field] = field === "baseContentDigest" ? badDigest : "different"; redigestPackage(i); }]),
  ...["targetDigest", "proposedContentDigest"].map(field => [`target ${field}`, "INVALID_VALUE", "$.reviewPackage.reviewTargets[0].targetDigest", i => { i.reviewPackage.reviewTargets[0][field] = badDigest; redigestPackage(i); }]),
  ["target/decision relationship", "INVALID_REFERENCE", "$.reviewRecord.decisions", i => { i.reviewRecord.decisions[0].targetDigest = badDigest; redigestRecord(i); }],
];
async function consumedNoWrite(f, apply, expected, expectedError, onReservation, targetPath = f.generatedChangeSet.changes[0].path) {
  await runReviewRecord(f.ctx);
  const record = selectedRecord(openStage4Run(f.ctx)), manifestBefore = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  const target = path.join(f.root, targetPath), d = f.ctx.durableStore(), create = d.create;
  let reserved = false, entered = false, actual, targetBefore;
  d.create = async (name, ...args) => {
    const result = await create(name, ...args);
    if (name.startsWith("apply/attempt-")) { reserved = true; if (onReservation) onReservation(target); targetBefore = fs.existsSync(target) ? fs.readFileSync(target) : null; }
    return result;
  };
  const observed = observedApply((input, real) => {
    entered = true; assert.equal(reserved, true);
    assert.equal(fs.statSync(path.join(f.runDirReal, `apply/attempt-0001-${record.recordId}.json`)).size, 0);
    actual = apply(input, real); return actual;
  });
  await assert.rejects(observed({ ...fx.withTerminal(f, fx.scriptedTerminal()), durableStore: () => d }), { code: expected, exitCode: 4 });
  assert.equal(entered, true); assert.equal(actual.ok, false); assert.equal(actual.appliedChangeSetRecord, null);
  assert.ok(actual.errors.some(e => e.code === expectedError[0] && e.path === expectedError[1]), JSON.stringify(actual.errors));
  assert.deepEqual(fs.existsSync(target) ? fs.readFileSync(target) : null, targetBefore, "#23F writes zero target bytes");
  assert.deepEqual(fs.readFileSync(path.join(f.runDirReal, "manifest.json")), manifestBefore);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.runDirReal, `apply/outcome-0001-${record.recordId}.json`))), {
    kind: "QaAgentApplyOutcome", schemaVersion: 1, packageOrdinal: "0001", recordId: record.recordId,
    result: "REFUSED_NO_WRITE", appliedRecordSha256: null, completedAt: f.ctx.now().toISOString(),
  });
  assert.deepEqual(fs.readdirSync(path.join(f.runDirReal, "apply")).sort(), [`attempt-0001-${record.recordId}.json`, `outcome-0001-${record.recordId}.json`]);
  assert.equal(openStage4Run(f.ctx).state.state, "CONSUMED");
  await assert.rejects(runApply(fx.withTerminal(f, fx.scriptedTerminal())), { code: "APPROVAL_ALREADY_CONSUMED", exitCode: 5 });
}
for (const [label, code, errorPath, mutate] of bindingCases) test(`C3-10: ${label} is a consumed binding refusal with outcome`, async () => {
  await consumedNoWrite(fx.makeRun(), (input, real) => { const probe = structuredClone(input); mutate(probe); return real(probe); }, "APPLY_BINDING_MISMATCH", [code, errorPath]);
});
function modifyProposal(f) {
  const targetPath = "cypress/e2e/existing.cy.js", oldContent = fs.readFileSync(path.join(f.root, targetPath), "utf8");
  const repositoryContext = structuredClone(f.context);
  repositoryContext.repositoryEvidence.push({ evidenceRef: { id: "repo-evidence-modify", kind: "repository_file", location: targetPath }, role: "relevant_file", content: oldContent });
  const automationPlan = { ...f.plan, plannedChanges: [{ path: targetPath, operation: "MODIFY", purpose: "Update the existing test." }] };
  const built = gcs.buildGeneratedChangeSet({ automationPlan, repositoryContext, expectedProjectId: f.ctx.config.projectProfile.id, changes: [{ operation: "MODIFY", path: targetPath, content: "describe('new', () => {});", baseContentDigest: gcs.computeDigest(gcs.LABEL_FILE_CONTENT, oldContent) }] });
  assert.equal(built.ok, true, JSON.stringify(built.errors));
  const p = pkg.buildGeneratedChangeSetReviewPackage({ automationPlan, repositoryContext, generatedChangeSet: built.generatedChangeSet, expectedProjectId: f.ctx.config.projectProfile.id });
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  return { targetPath, input: { automationPlan, repositoryContext, generatedChangeSet: built.generatedChangeSet, reviewPackage: p.reviewPackage } };
}
function withModify(input, proposal) {
  const reviewPackage = proposal.input.reviewPackage;
  const r = core.buildGeneratedChangeSetReviewRecord({ reviewPackage, expectedProjectId: input.expectedProjectId, reviewerId: input.reviewRecord.reviewerId, reviewedAt: input.reviewRecord.reviewedAt,
    decisions: reviewPackage.reviewTargets.map(t => ({ operation: t.operation, path: t.path, targetDigest: t.targetDigest, decision: "APPROVE" })) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return { ...input, ...proposal.input, reviewRecord: r.reviewRecord };
}
for (const [operation, race] of [["CREATE", "appeared"], ["MODIFY", "disappeared"], ["MODIFY", "changed"]]) test(`C3-10: live ${operation} target ${race} remains a consumed precondition refusal`, async () => {
  const f = fx.makeRun(), proposal = operation === "MODIFY" ? modifyProposal(f) : null;
  await consumedNoWrite(f, (input, real) => real(proposal ? withModify(input, proposal) : input), "APPLY_PRECONDITION_FAILED", ["INVARIANT_VIOLATION", "$.generatedChangeSet.changes[0]"], target => {
    if (race === "disappeared") fs.unlinkSync(target); else fs.writeFileSync(target, "other actor's bytes");
  }, proposal ? proposal.targetPath : undefined);
});
for (const operation of ["UPDATE", "DELETE"]) test(`C3-10: unsupported V1 ${operation} stays fail-closed`, async () => {
  const f = fx.makeRun(), proposal = modifyProposal(f);
  await consumedNoWrite(f, (input, real) => {
    const probe = structuredClone(withModify(input, proposal)); probe.generatedChangeSet.changes[0].operation = operation;
    probe.generatedChangeSet.changeSetDigest = gcs.recomputeChangeSetDigest(probe.generatedChangeSet); return real(probe);
  }, "APPLY_BINDING_MISMATCH", ["INVALID_VALUE", "$.generatedChangeSet.changes[0].operation"], undefined, proposal.targetPath);
});

function ledgerEntry(ledgerIndex, recordId, decision, decidedAt) {
  return { ledgerIndex, packageOrdinal: "0001", recordPath: `review/record-0001-${recordId}.json`, recordSha256: badDigest, recordId, decision, decidedAt };
}
function nextLength(manifest, entry) { return Buffer.byteLength(store.serialize({ ...manifest, reviews: [...manifest.reviews, entry] }), "utf8"); }
// Build real, reader-valid history; no fabricated state/reader responses.
function capacityRun({ count = 0, nextSize, decision = "APPROVE", id = "f".repeat(32), time = "2026-10-12T12:00:00.000Z" }) {
  const f = fx.makeRun(), manifestPath = path.join(f.runDirReal, "manifest.json"), manifest = store.loadManifest(f.runDirReal).manifest;
  const subject = rebuildSubject(f.ctx, openStage4Run(f.ctx));
  const proposed = ledgerEntry(count + 1, id, decision, time);
  manifest.reviews = Array.from({ length: count }, (_, i) => ledgerEntry(i + 1, (i + 1).toString(16).padStart(32, "0"), i % 2 ? "APPROVE" : "REJECT", new Date(Date.parse(time) - count + i).toISOString()));
  // A legal semver suffix controls exact bytes independently of ledger count.
  // Include multi-byte UTF-8 in the product name only in pure writer tests below.
  manifest.product.version += "-";
  const padding = nextSize - nextLength(manifest, proposed); assert.ok(padding >= 1);
  manifest.product.version += "v".repeat(padding); f.ctx.product = { ...manifest.product };
  if (count) fs.mkdirSync(path.join(f.runDirReal, "review"));
  for (const entry of manifest.reviews) {
    const record = buildRecord({ recordId: entry.recordId, decision: entry.decision, subject: subject.subject, binding: { ...subject.binding, product: f.ctx.product }, reviewer: f.ctx.resolvePrincipal(), sessionStartedAt: entry.decidedAt, decidedAt: entry.decidedAt, reviewPackage: subject.reviewPackage });
    const bytes = Buffer.from(store.serialize(record), "utf8"); entry.recordSha256 = store.sha256(bytes);
    fs.writeFileSync(path.join(f.runDirReal, entry.recordPath), bytes);
    fs.writeFileSync(path.join(f.runDirReal, `review/claim-${String(entry.ledgerIndex).padStart(4, "0")}.json`), store.serialize({ ledgerIndex: entry.ledgerIndex, packageOrdinal: entry.packageOrdinal, recordId: entry.recordId }));
  }
  store.validateManifestShape(manifest);
  fs.writeFileSync(manifestPath, store.serialize(manifest), "utf8");
  assert.equal(nextLength(manifest, proposed), nextSize);
  assert.ok(fs.statSync(manifestPath).size <= store.MAX_MANIFEST_BYTES);
  f.ctx.now = () => new Date(time); f.ctx.randomBytes = n => n === 16 ? Buffer.from(id, "hex") : Buffer.alloc(n, 1);
  f.tty = fx.scriptedTerminal({ decision }); f.ctx = fx.withTerminal(f, f.tty);
  return f;
}
async function capacityRefusal(f, nextSize) {
  const manifestPath = path.join(f.runDirReal, "manifest.json"), before = fs.readFileSync(manifestPath), state = openStage4Run(f.ctx).state.state;
  const reviewDir = path.join(f.runDirReal, "review"), entries = fs.existsSync(reviewDir) ? fs.readdirSync(reviewDir).sort() : [];
  const d = f.ctx.durableStore(); const calls = [];
  for (const name of ["ensureDirectory", "create", "replace"]) { const original = d[name]; d[name] = async (...args) => { calls.push(name); return original(...args); }; }
  const enterCritical = TerminalSession.prototype.enterCritical; let criticalEntries = 0;
  TerminalSession.prototype.enterCritical = function (...args) { criticalEntries++; return enterCritical.apply(this, args); };
  try { await assert.rejects(runReviewRecord({ ...f.ctx, durableStore: () => d }), { code: "RUN_STATE_INCONSISTENT", exitCode: 4 }); }
  finally { TerminalSession.prototype.enterCritical = enterCritical; }
  assert.equal(criticalEntries, 0, "capacity refuses before CS-ENTER");
  assert.deepEqual(calls, [], "capacity refuses before any persistence/CS-ENTER");
  assert.deepEqual(fs.readFileSync(manifestPath), before);
  assert.deepEqual(fs.existsSync(reviewDir) ? fs.readdirSync(reviewDir).sort() : [], entries);
  assert.deepEqual(fs.readdirSync(f.runDirReal).filter(n => n.startsWith("manifest.next-")), []);
  assert.equal(openStage4Run(f.ctx).state.state, state);
  assert.doesNotMatch(f.tty.error, /quarantin/i);
  assert.ok(nextSize > store.MAX_MANIFEST_BYTES);
}
for (const [decision, delta, id, time] of [["APPROVE", 0, "e".repeat(32), "2026-10-12T12:00:00.000Z"], ["REJECT", -1, "d".repeat(32), "2026-10-12T12:00:01.999Z"]]) test(`C3-12: maximum valid ${decision} next manifest ${delta} bytes from limit is readable`, async () => {
  const f = capacityRun({ nextSize: store.MAX_MANIFEST_BYTES + delta, decision, id, time });
  const result = await runReviewRecord(f.ctx); assert.equal(result.state, decision === "APPROVE" ? "APPROVED" : "REJECTED");
  assert.equal(fs.statSync(path.join(f.runDirReal, "manifest.json")).size, store.MAX_MANIFEST_BYTES + delta);
  assert.equal(store.loadManifest(f.runDirReal).manifest.reviews.length, 1);
  assert.equal(openStage4Run(f.ctx).state.state, result.state);
});
test("C3-12: first invalid byte refuses before claim and preserves readable run", async () => {
  await capacityRefusal(capacityRun({ nextSize: store.MAX_MANIFEST_BYTES + 1 }), store.MAX_MANIFEST_BYTES + 1);
});
test("C3-12: real large ledger growth crosses the reader limit safely", async () => {
  // Choose the actual serialized ledger capacity, not a hardcoded count gate.
  const f = fx.makeRun(), manifest = store.loadManifest(f.runDirReal).manifest;
  while (Buffer.byteLength(store.serialize(manifest), "utf8") < store.MAX_MANIFEST_BYTES - 500) {
    const i = manifest.reviews.length + 1; manifest.reviews.push(ledgerEntry(i, i.toString(16).padStart(32, "0"), "APPROVE", f.ctx.now().toISOString()));
  }
  const count = manifest.reviews.length;
  assert.ok(count > 2000 && count < 9999);
  const large = capacityRun({ count, nextSize: 1048721 });
  assert.equal(fs.statSync(path.join(large.runDirReal, "manifest.json")).size, 1048343);
  await capacityRefusal(large, 1048721);
});
test("C3-12: varying IDs, timestamps and ledger index widths use serialized bytes", async () => {
  // Both histories have room by ledger count; the actual byte total decides.
  for (const [count, decision, id, time, delta] of [[9, "REJECT", "a".repeat(32), "2026-10-12T12:00:02.123Z", 1], [10, "APPROVE", "b".repeat(32), "2026-10-12T12:00:03.456Z", 0]]) {
    const f = capacityRun({ count, decision, id, time, nextSize: store.MAX_MANIFEST_BYTES + delta });
    if (delta) await capacityRefusal(f, store.MAX_MANIFEST_BYTES + delta);
    else { await runReviewRecord(f.ctx); assert.equal(fs.statSync(path.join(f.runDirReal, "manifest.json")).size, store.MAX_MANIFEST_BYTES); assert.equal(store.loadManifest(f.runDirReal).manifest.reviews.length, count + 1); }
  }
});
test("C3-12: canonical serialization counts UTF-8 persisted bytes, including newline", () => {
  const f = fx.makeRun(), manifest = store.loadManifest(f.runDirReal).manifest;
  manifest.product.name = "";
  const available = store.MAX_MANIFEST_BYTES - Buffer.byteLength(store.serialize(manifest), "utf8");
  manifest.product.name = "é".repeat(Math.floor(available / 2)) + "x".repeat(available % 2);
  const bytes = store.serializeManifest(manifest);
  assert.equal(bytes.length, store.MAX_MANIFEST_BYTES); assert.equal(bytes.at(-1), 10);
  assert.ok(store.serialize(manifest).length < bytes.length);
  manifest.product.name += "x";
  assert.throws(() => store.serializeManifest(manifest), { code: "RUN_STATE_INCONSISTENT", exitCode: 4 });
});
test("C3-12: alternate D-REPLACE caller cannot create an oversized temp manifest", async () => {
  const f = fx.makeRun(), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  await assert.rejects(f.ctx.durableStore().replace(Buffer.alloc(store.MAX_MANIFEST_BYTES + 1), 1), { code: "RUN_STATE_INCONSISTENT", exitCode: 4 });
  await assert.rejects(f.ctx.durableStore().create("manifest.next-0001.json", Buffer.alloc(store.MAX_MANIFEST_BYTES + 1)), { code: "RUN_STATE_INCONSISTENT", exitCode: 4 });
  assert.deepEqual(fs.readFileSync(path.join(f.runDirReal, "manifest.json")), before);
  assert.deepEqual(fs.readdirSync(f.runDirReal).filter(n => n.startsWith("manifest.next-")), []);
  assert.equal(openStage4Run(f.ctx).state.state, "UNREVIEWED");
});
test("C3-12: stage manifest writer shares the reader size bound", () => {
  const f = fx.makeRun(), loaded = store.loadManifest(f.runDirReal), before = fs.readFileSync(path.join(f.runDirReal, "manifest.json"));
  const manifest = { ...loaded.manifest, product: { ...loaded.manifest.product, version: "v".repeat(store.MAX_MANIFEST_BYTES) }, stages: loaded.manifest.stages.slice(0, 2) };
  assert.throws(() => store.commitStage(f.ctx.root, path.relative(f.root, f.runDirReal).split(path.sep).join("/"), f.ctx.protectedPaths, {
    manifest, previousDigest: loaded.digest, stage: "generate", files: [{ path: "generate/generated-change-set-0001.json", kind: "GeneratedChangeSet", value: f.generatedChangeSet }], provider: "groq", model: "test", now: f.ctx.now(),
  }), { code: "RUN_STATE_INCONSISTENT", exitCode: 4 });
  assert.deepEqual(fs.readFileSync(path.join(f.runDirReal, "manifest.json")), before);
  assert.equal(openStage4Run(f.ctx).state.state, "UNREVIEWED");
});
