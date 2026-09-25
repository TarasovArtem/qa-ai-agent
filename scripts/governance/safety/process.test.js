"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const g = require("../index");

const NODE = process.execPath;
const base = (extra) => ({ file: NODE, allowedExecutables: [NODE], ...extra });
const rejects = (request) => assert.throws(() => g.runProcess(request), (e) => e instanceof g.GovernanceSafetyError && e.reasonCode === "PROCESS_INVALID_REQUEST");

test("the argument array is passed through exactly, with no shell interpretation", async () => {
  const hostile = ['a; echo INJECTED && $(id) | cat > x', "`whoami`", '"quoted" & "more"', "$HOME %PATH% ^& > < *", "line1\nline2"];
  const r = await g.runProcess(base({ args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...hostile] }));
  assert.equal(r.outcome, "EXITED");
  assert.equal(r.reasonCode, "OK");
  assert.deepEqual(JSON.parse(r.stdout), hostile);
});

test("there is no shell option: shell metacharacters in the file field cannot become a command", () => {
  rejects({ file: "node && echo pwned", args: [], allowedExecutables: [NODE] });
  rejects({ file: NODE, args: [], allowedExecutables: [NODE], shell: true });
});

test("non-zero exit, exit code and signal are captured as data", async () => {
  const r = await g.runProcess(base({ args: ["-e", "process.stderr.write('boom'); process.exit(3)"] }));
  assert.equal(r.outcome, "EXITED");
  assert.equal(r.exitCode, 3);
  assert.equal(r.reasonCode, "PROCESS_FAILURE");
  assert.equal(r.stderr, "boom");
  assert.equal(Object.isFrozen(r), true);
});

test("a run that exceeds its timeout is killed and classified", async () => {
  const started = Date.now();
  const r = await g.runProcess(base({ args: ["-e", "setInterval(() => {}, 1000)"], timeoutMs: 300 }));
  assert.equal(r.outcome, "TIMEOUT");
  assert.equal(r.reasonCode, "PROCESS_TIMEOUT");
  assert.ok(Date.now() - started < 10000);
});

test("stdout and stderr are bounded and an overflow is reported", async () => {
  const out = await g.runProcess(base({ args: ["-e", "process.stdout.write('x'.repeat(5000000))"], maxStdoutBytes: 1000 }));
  assert.equal(out.outcome, "OUTPUT_LIMIT");
  assert.equal(out.reasonCode, "PROCESS_OUTPUT_LIMIT");
  assert.equal(out.stdoutTruncated, true);
  assert.ok(out.stdout.length <= 1000);
  const err = await g.runProcess(base({ args: ["-e", "process.stderr.write('y'.repeat(5000000))"], maxStderrBytes: 500 }));
  assert.equal(err.outcome, "OUTPUT_LIMIT");
  assert.equal(err.stderrTruncated, true);
  assert.ok(err.stderr.length <= 500);
});

test("the executable must be an exact allowlist member and the request is validated", () => {
  rejects({ file: NODE, allowedExecutables: [] });
  rejects({ file: NODE, allowedExecutables: ["other"] });
  rejects({ file: NODE });
  rejects(base({ args: "not-an-array" }));
  rejects(base({ args: [1] }));
  rejects(base({ args: ["a\0b"] }));
  rejects(base({ args: Array(300).fill("a") }));
  rejects(base({ timeoutMs: 0 }));
  rejects(base({ timeoutMs: 1.5 }));
  rejects(base({ timeoutMs: 10000000 }));
  rejects(base({ maxStdoutBytes: -1 }));
  rejects(base({ cwd: "relative/dir" }));
  rejects(base({ envAllowlist: ["BAD NAME"] }));
  rejects(base({ unknownField: true }));
  rejects(null);
  rejects("node");
});

test("the child environment contains only allow-listed variables; secrets are not inherited", async () => {
  process.env.GOV_WAVE0_TEST_SECRET = "not-a-real-secret";
  try {
    const script = "process.stdout.write(JSON.stringify({s: process.env.GOV_WAVE0_TEST_SECRET === undefined, l: process.env.LC_ALL}))";
    const r = await g.runProcess(base({ args: ["-e", script] }));
    assert.deepEqual(JSON.parse(r.stdout), { s: true, l: "C" });
    const allowed = await g.runProcess(base({ args: ["-e", "process.stdout.write(String(process.env.GOV_WAVE0_TEST_SECRET))"], envAllowlist: ["PATH", "SystemRoot", "GOV_WAVE0_TEST_SECRET"] }));
    assert.equal(allowed.stdout, "not-a-real-secret");
  } finally {
    delete process.env.GOV_WAVE0_TEST_SECRET;
  }
});

test("safety policy is not controlled by environment variables", async () => {
  process.env.GOV_ALLOW_SHELL = "1";
  process.env.NODE_OPTIONS = "";
  try {
    rejects({ file: "echo hi", args: [], allowedExecutables: [NODE] });
  } finally {
    delete process.env.GOV_ALLOW_SHELL;
  }
});

test("a missing executable is a SPAWN_ERROR result, not a thrown error or a pass", async () => {
  const missing = NODE + "-does-not-exist";
  const r = await g.runProcess({ file: missing, args: [], allowedExecutables: [missing] });
  assert.equal(r.outcome, "SPAWN_ERROR");
  assert.equal(r.reasonCode, "PROCESS_SPAWN_ERROR");
});

test("failure descriptions are redacted and bounded", async () => {
  const token = "gh" + "p_" + "A".repeat(36);
  const r = await g.runProcess(base({ args: ["-e", `process.stderr.write('auth failed with ${token} and password=hunter2'); process.exit(1)`] }));
  const text = g.describeProcessResult(r);
  assert.equal(text.includes(token), false);
  assert.equal(text.includes("hunter2"), false);
  assert.match(text, /REDACTED/);
  assert.ok(text.length < 400);
});
