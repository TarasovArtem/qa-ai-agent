"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fork } = require("node:child_process");
const { loadManifest } = require("./run-store");
const { readEvidence } = require("./stage4-run");
const { derivePackageState } = require("./stage4-state");
const childFile = path.resolve(__dirname, "../../../test/helpers/stage4-crash-child.js");
async function start(boundary, disposition) {
  const child = fork(childFile, [boundary, disposition || "commit"], { stdio: ["ignore", "pipe", "pipe", "ipc"], env: { PATH: process.env.PATH } });
  const messages = []; let stderr = "", stdout = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.on("data", chunk => { stderr += chunk; });
  let wake;
  child.on("message", message => { messages.push(message); if (wake) { wake(); wake = null; } });
  const ended = new Promise(resolve => child.once("close", (code, signal) => { resolve({ code, signal }); if (wake) { wake(); wake = null; } }));
  const next = async type => {
    const deadline = Date.now() + 15000;
    while (!messages.some(m => m.type === type)) {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`child exited before ${type}: ${stderr}`);
      if (Date.now() > deadline) { child.kill("SIGKILL"); throw new Error(`child timeout: ${boundary}: ${stderr}`); }
      await new Promise(resolve => { const timer = setTimeout(resolve, 50); wake = () => { clearTimeout(timer); resolve(); }; });
    }
    return messages.find(m => m.type === type);
  };
  const point = await next("boundary");
  return { child, point, next, ended, get output() { return stdout; }, get error() { return stderr; } };
}
function observed(point) {
  const manifest = loadManifest(point.runDirReal).manifest;
  return derivePackageState("0001", readEvidence({ runDirReal: point.runDirReal, manifest }));
}
function cleanup(point) {
  // Only the exact test-created absolute temp target is removed, after exit.
  assert.equal(path.dirname(path.resolve(point.root)), require("node:os").tmpdir());
  assert.ok(path.basename(point.root).startsWith("qa-agent-stage3-"));
  fs.rmSync(point.root, { recursive: true, force: true });
}
for (const [boundary, state, mutated] of [
  ["review-before-claim", "UNREVIEWED", false], ["review-claim-handle", "QUARANTINED", false],
  ["review-claim-durable", "QUARANTINED", false], ["review-record-durable", "QUARANTINED", false],
  ["review-temp-fsync", "QUARANTINED", false], ["review-renamed", "APPROVED", false], ["review-committed", "APPROVED", false],
  ["apply-before-attempt", "APPROVED", false], ["apply-attempt-handle", "QUARANTINED", false],
  ["apply-attempt-dir-fsync", "QUARANTINED", false], ["apply-attempt-durable", "QUARANTINED", false],
  ["apply-applied-durable", "QUARANTINED", true], ["apply-outcome-write", "APPLIED", true], ["apply-outcome-durable", "APPLIED", true],
]) test(`ARCH-S4A-07 real SIGKILL at ${boundary}: restart derives ${state}`, { skip: process.platform !== "linux", timeout: 20000 }, async () => {
  const c = await start(boundary);
  try {
    assert.ok(c.child.kill("SIGKILL")); assert.deepEqual(await c.ended, { code: null, signal: "SIGKILL" });
    assert.equal(observed(c.point).state, state);
    assert.equal(fs.existsSync(path.join(c.point.root, "cypress/e2e/generated/login.cy.js")), mutated);
    if (boundary.startsWith("apply-") && boundary !== "apply-before-attempt") assert.notEqual(observed(c.point).state, "APPROVED");
  } finally { if (c.child.exitCode === null && c.child.signalCode === null) c.child.kill("SIGKILL"); cleanup(c.point); }
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) for (const disposition of ["commit", "orphan"]) test(`ARCH-S4A-07 real deferred ${signal}: ${disposition.toUpperCase()} disposition before native termination`, { skip: process.platform !== "linux", timeout: 20000 }, async () => {
  const c = await start("review-claim-durable", disposition);
  try {
    c.child.kill(signal); assert.equal((await c.next("signal-observed")).signal, signal);
    assert.equal(c.child.exitCode, null); assert.equal(c.child.signalCode, null, "signal is deferred while inside claim CS");
    c.child.send("continue");
    assert.deepEqual(await c.ended, { code: null, signal }, "termination preserves native signal semantics");
    assert.equal(observed(c.point).state, disposition === "commit" ? "APPROVED" : "QUARANTINED");
    if (disposition === "commit") assert.match(c.output, /decision recorded: APPROVE/);
    else { assert.match(c.error, /INTERNAL_ERROR/); assert.match(c.error, /WARNING:/); assert.ok(c.error.replace(/\n@Q2:f      \+ /g, "").includes("claim-0001.json")); }
  } finally { if (c.child.exitCode === null && c.child.signalCode === null) c.child.kill("SIGKILL"); cleanup(c.point); }
});
