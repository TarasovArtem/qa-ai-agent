"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const nodePath = require("node:path");
const g = require("../index");

const NODE = process.execPath;
const POLICY_ERROR = (e) => e instanceof g.GovernanceSafetyError && e.reasonCode === "PROCESS_INVALID_REQUEST";

/** Temp repository root (with a `work` subdirectory and a sibling `repo-evil`). */
async function withRepo(body) {
  const base = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gov-wave0-proc-"));
  const root = nodePath.join(base, "repo");
  fs.mkdirSync(nodePath.join(root, "work"), { recursive: true });
  fs.mkdirSync(nodePath.join(base, "repo-evil"));
  const runner = g.createProcessRunner({ repositoryRoot: root, allowedExecutables: [NODE] });
  const run = (extra) => runner.run({ file: NODE, ...extra });
  try {
    return await body({ base, root, runner, run });
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const rejectsRequest = (runner, request) => assert.throws(() => runner.run(request), POLICY_ERROR);
const rejectsPolicy = (policy) => assert.throws(() => g.createProcessRunner(policy), POLICY_ERROR);

test("the argument array is passed through exactly, with no shell interpretation", () =>
  withRepo(async ({ run }) => {
    const hostile = ['a; echo INJECTED && $(id) | cat > x', "`whoami`", '"quoted" & "more"', "$HOME %PATH% ^& > < *", "line1\nline2"];
    const r = await run({ args: ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", ...hostile] });
    assert.equal(r.outcome, "EXITED");
    assert.equal(r.reasonCode, "OK");
    assert.deepEqual(JSON.parse(r.stdout), hostile);
  }));

test("there is no shell option: shell metacharacters in the file field cannot become a command", () =>
  withRepo(async ({ runner }) => {
    rejectsRequest(runner, { file: "node && echo pwned", args: [] });
    rejectsRequest(runner, { file: NODE, args: [], shell: true });
  }));

test("non-zero exit, exit code and signal are captured as data", () =>
  withRepo(async ({ run }) => {
    const r = await run({ args: ["-e", "process.stderr.write('boom'); process.exit(3)"] });
    assert.equal(r.outcome, "EXITED");
    assert.equal(r.exitCode, 3);
    assert.equal(r.reasonCode, "PROCESS_FAILURE");
    assert.equal(r.stderr, "boom");
    assert.equal(Object.isFrozen(r), true);
  }));

test("a run that exceeds its timeout is killed and classified", () =>
  withRepo(async ({ run }) => {
    const started = Date.now();
    const r = await run({ args: ["-e", "setInterval(() => {}, 1000)"], timeoutMs: 300 });
    assert.equal(r.outcome, "TIMEOUT");
    assert.equal(r.reasonCode, "PROCESS_TIMEOUT");
    assert.ok(Date.now() - started < 10000);
  }));

test("stdout and stderr are bounded and an overflow is reported", () =>
  withRepo(async ({ run }) => {
    const out = await run({ args: ["-e", "process.stdout.write('x'.repeat(5000000))"], maxStdoutBytes: 1000 });
    assert.equal(out.outcome, "OUTPUT_LIMIT");
    assert.equal(out.reasonCode, "PROCESS_OUTPUT_LIMIT");
    assert.equal(out.stdoutTruncated, true);
    assert.ok(out.stdout.length <= 1000);
    const err = await run({ args: ["-e", "process.stderr.write('y'.repeat(5000000))"], maxStderrBytes: 500 });
    assert.equal(err.outcome, "OUTPUT_LIMIT");
    assert.equal(err.stderrTruncated, true);
    assert.ok(err.stderr.length <= 500);
  }));

test("the request is validated (types, bounds, unknown fields)", () =>
  withRepo(async ({ runner }) => {
    const base = { file: NODE };
    rejectsRequest(runner, {});
    rejectsRequest(runner, { ...base, args: "not-an-array" });
    rejectsRequest(runner, { ...base, args: [1] });
    rejectsRequest(runner, { ...base, args: ["a\0b"] });
    rejectsRequest(runner, { ...base, args: Array(300).fill("a") });
    rejectsRequest(runner, { ...base, timeoutMs: 0 });
    rejectsRequest(runner, { ...base, timeoutMs: 1.5 });
    rejectsRequest(runner, { ...base, timeoutMs: 10000000 });
    rejectsRequest(runner, { ...base, maxStdoutBytes: -1 });
    rejectsRequest(runner, { ...base, envAllowlist: ["BAD NAME"] });
    rejectsRequest(runner, { ...base, unknownField: true });
    rejectsRequest(runner, null);
    rejectsRequest(runner, "node");
  }));

test("the child environment contains only allow-listed variables; secrets are not inherited", () =>
  withRepo(async ({ run }) => {
    process.env.GOV_WAVE0_TEST_SECRET = "not-a-real-secret";
    try {
      const script = "process.stdout.write(JSON.stringify({s: process.env.GOV_WAVE0_TEST_SECRET === undefined, l: process.env.LC_ALL}))";
      const r = await run({ args: ["-e", script] });
      assert.deepEqual(JSON.parse(r.stdout), { s: true, l: "C" });
      const allowed = await run({ args: ["-e", "process.stdout.write(String(process.env.GOV_WAVE0_TEST_SECRET))"], envAllowlist: ["PATH", "SystemRoot", "GOV_WAVE0_TEST_SECRET"] });
      assert.equal(allowed.stdout, "not-a-real-secret");
    } finally {
      delete process.env.GOV_WAVE0_TEST_SECRET;
    }
  }));

test("safety policy is not controlled by environment variables", () =>
  withRepo(async ({ runner }) => {
    process.env.GOV_ALLOW_SHELL = "1";
    process.env.NODE_OPTIONS = "";
    try {
      rejectsRequest(runner, { file: "echo hi", args: [] });
    } finally {
      delete process.env.GOV_ALLOW_SHELL;
    }
  }));

test("an allow-listed but missing executable is a SPAWN_ERROR result, not a thrown error or a pass", async () => {
  const base = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gov-wave0-proc-"));
  try {
    const missing = nodePath.join(base, "no-such-tool");
    const runner = g.createProcessRunner({ repositoryRoot: base, allowedExecutables: [missing] });
    const r = await runner.run({ file: missing, args: [] });
    assert.equal(r.outcome, "SPAWN_ERROR");
    assert.equal(r.reasonCode, "PROCESS_SPAWN_ERROR");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("failure descriptions are redacted and bounded", () =>
  withRepo(async ({ run }) => {
    const token = "gh" + "p_" + "A".repeat(36);
    const r = await run({ args: ["-e", `process.stderr.write('auth failed with ${token} and password=hunter2'); process.exit(1)`] });
    const text = g.describeProcessResult(r);
    assert.equal(text.includes(token), false);
    assert.equal(text.includes("hunter2"), false);
    assert.match(text, /REDACTED/);
    assert.ok(text.length < 400);
  }));

// ------------------------------------------------------- Corrective C1: SEC-L3

test("SEC-L3: an allow-listed absolute executable runs, and it is the canonical path that runs", () =>
  withRepo(async ({ run }) => {
    const r = await run({ args: ["-e", "process.stdout.write(process.execPath)"] });
    assert.equal(r.reasonCode, "OK");
    assert.equal(r.stdout.toLowerCase(), fs.realpathSync.native(NODE).toLowerCase());
  }));

test("SEC-L3: a bare or relative executable name is rejected, never resolved through PATH", () =>
  withRepo(async ({ runner }) => {
    const bare = nodePath.basename(NODE);
    rejectsRequest(runner, { file: bare });
    rejectsRequest(runner, { file: "node" });
    rejectsRequest(runner, { file: `./${bare}` });
    rejectsRequest(runner, { file: `..${nodePath.sep}${bare}` });
    rejectsRequest(runner, { file: "" });
  }));

test("SEC-L3: the same basename at a different path is rejected", () =>
  withRepo(async ({ base, root, runner }) => {
    const planted = nodePath.join(root, "work", nodePath.basename(NODE));
    fs.writeFileSync(planted, "not really node");
    rejectsRequest(runner, { file: planted });
    const other = nodePath.join(base, "repo-evil", nodePath.basename(NODE));
    fs.writeFileSync(other, "not really node");
    rejectsRequest(runner, { file: other });
  }));

test("SEC-L3: a hostile PATH cannot redirect which executable runs", () =>
  withRepo(async ({ base, root, runner }) => {
    const hostile = nodePath.join(base, "hostile-bin");
    fs.mkdirSync(hostile);
    for (const name of ["node", "node.exe", "node.cmd"]) fs.writeFileSync(nodePath.join(hostile, name), "echo pwned");
    const savedPath = process.env.PATH;
    process.env.PATH = `${hostile}${nodePath.delimiter}${savedPath}`;
    try {
      rejectsRequest(runner, { file: "node" });
      const r = await runner.run({ file: NODE, args: ["-e", "process.stdout.write(process.execPath)"], envAllowlist: ["PATH", "SystemRoot"] });
      assert.equal(r.stdout.toLowerCase(), fs.realpathSync.native(NODE).toLowerCase());
    } finally {
      process.env.PATH = savedPath;
    }
  }));

test("SEC-L3: the cwd cannot change the executable identity (a planted binary in the cwd is not used)", () =>
  withRepo(async ({ root, run }) => {
    for (const name of ["node", "node.exe", "node.cmd", "node.bat"]) fs.writeFileSync(nodePath.join(root, "work", name), "echo pwned");
    const r = await run({ cwd: "work", args: ["-e", "process.stdout.write(process.execPath)"] });
    assert.equal(r.reasonCode, "OK");
    assert.equal(r.stdout.toLowerCase(), fs.realpathSync.native(NODE).toLowerCase());
  }));

test("SEC-L3: a symlink alias of an allow-listed executable is accepted by canonical identity, and the target runs", (t) =>
  withRepo(async ({ base, runner }) => {
    const alias = nodePath.join(base, "alias-to-node");
    try {
      fs.symlinkSync(NODE, alias, "file");
    } catch {
      t.skip("symlinks are not permitted in this environment");
      return;
    }
    const r = await runner.run({ file: alias, args: ["-e", "process.stdout.write(process.execPath)"] });
    assert.equal(r.stdout.toLowerCase(), fs.realpathSync.native(NODE).toLowerCase());
  }));

test("SEC-L3: the request cannot supply or extend the allowlist (no self-authorization)", () =>
  withRepo(async ({ root, base, runner }) => {
    const evil = nodePath.join(base, "repo-evil", "tool");
    fs.writeFileSync(evil, "x");
    rejectsRequest(runner, { file: evil, allowedExecutables: [evil] });
    rejectsRequest(runner, { file: NODE, allowedExecutables: [NODE] });
    rejectsRequest(runner, { file: NODE, repositoryRoot: root });
  }));

test("SEC-L3: the trusted policy itself is validated", () => {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), "gov-wave0-proc-"));
  try {
    rejectsPolicy(null);
    rejectsPolicy({ repositoryRoot: root });
    rejectsPolicy({ repositoryRoot: root, allowedExecutables: [] });
    rejectsPolicy({ repositoryRoot: root, allowedExecutables: ["node"] });
    rejectsPolicy({ repositoryRoot: root, allowedExecutables: ["./node"] });
    rejectsPolicy({ repositoryRoot: root, allowedExecutables: [NODE, 5] });
    rejectsPolicy({ repositoryRoot: "relative/root", allowedExecutables: [NODE] });
    rejectsPolicy({ repositoryRoot: nodePath.join(root, "does-not-exist"), allowedExecutables: [NODE] });
    rejectsPolicy({ repositoryRoot: root, allowedExecutables: [NODE], shell: true });
    const runner = g.createProcessRunner({ repositoryRoot: root, allowedExecutables: [NODE] });
    assert.equal(Object.isFrozen(runner), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("SEC-L3: mutating the policy object after creation does not change the runner's authority", () =>
  withRepo(async ({ base, root }) => {
    const other = nodePath.join(base, "repo-evil", "tool");
    fs.writeFileSync(other, "x");
    const allowed = [NODE];
    const runner = g.createProcessRunner({ repositoryRoot: root, allowedExecutables: allowed });
    allowed.push(other);
    rejectsRequest(runner, { file: other });
  }));

// ------------------------------------------------------- Corrective C1: SEC-L4

test("SEC-L4: cwd inside the root is allowed, and omitted cwd is the root itself", () =>
  withRepo(async ({ root, run }) => {
    const inside = await run({ cwd: "work", args: ["-e", "process.stdout.write(process.cwd())"] });
    assert.equal(inside.stdout.toLowerCase(), fs.realpathSync.native(nodePath.join(root, "work")).toLowerCase());
    const atRoot = await run({ args: ["-e", "process.stdout.write(process.cwd())"] });
    assert.equal(atRoot.stdout.toLowerCase(), fs.realpathSync.native(root).toLowerCase());
  }));

test("SEC-L4: cwd outside the root, sibling-prefix, traversal and absolute paths are rejected", () =>
  withRepo(async ({ base, runner }) => {
    const unsafe = (cwd) => assert.throws(() => runner.run({ file: NODE, cwd }), (e) => e instanceof g.GovernanceSafetyError && ["UNSAFE_PATH", "PROCESS_INVALID_REQUEST"].includes(e.reasonCode));
    unsafe("..");
    unsafe("../repo-evil");
    unsafe("work/../../repo-evil");
    unsafe("work/../..");
    unsafe(base);
    unsafe(nodePath.join(base, "repo-evil"));
    unsafe(".");
    unsafe("");
    unsafe("work\\..\\..");
    rejectsRequest(runner, { file: NODE, cwd: 5 });
  }));

test("SEC-L4: a nonexistent cwd or a file used as cwd is rejected", () =>
  withRepo(async ({ root, runner }) => {
    fs.writeFileSync(nodePath.join(root, "afile"), "x");
    rejectsRequest(runner, { file: NODE, cwd: "missing-dir" });
    rejectsRequest(runner, { file: NODE, cwd: "afile" });
  }));

test("SEC-L4: a cwd that escapes the root through a symlink is rejected", (t) =>
  withRepo(async ({ base, root, runner }) => {
    try {
      fs.symlinkSync(nodePath.join(base, "repo-evil"), nodePath.join(root, "escape"), "junction");
    } catch {
      t.skip("symlinks are not permitted in this environment");
      return;
    }
    assert.throws(() => runner.run({ file: NODE, cwd: "escape" }), (e) => e instanceof g.GovernanceSafetyError && e.reasonCode === "UNSAFE_PATH");
    assert.throws(() => runner.run({ file: NODE, cwd: "escape/deeper" }), (e) => e instanceof g.GovernanceSafetyError && e.reasonCode === "UNSAFE_PATH");
  }));

// ------------------------------------------------------- Corrective C1: SEC-L5

test("SEC-L5: untrusted field names, files and cwd values are never echoed into error messages", () =>
  withRepo(async ({ runner }) => {
    const gh = "gh" + "p_" + "S".repeat(36);
    const keys = [
      "K".repeat(5000),
      "line1\nline2: injected",
      "tab\there",
      "\u001b[31mred\u001b[0m",
      gh,
      "password",
      "bidi‮evil",
      "nel\u0085next",
      "ls sep",
      "\u0000nul",
    ];
    for (const key of keys) {
      let error;
      try {
        runner.run({ file: NODE, [key]: true });
      } catch (e) {
        error = e;
      }
      assert.ok(error instanceof g.GovernanceSafetyError, JSON.stringify(key.slice(0, 20)));
      assert.equal(error.reasonCode, "PROCESS_INVALID_REQUEST");
      assert.ok(error.message.length < 100, `message length ${error.message.length}`);
      assert.match(error.message, /^[\x20-\x7e]*$/, "printable ASCII only");
      assert.equal(error.message.includes(key.slice(0, 8)), false, "the field name is not echoed");
      assert.equal(error.message.includes("ghp_"), false);
    }
    for (const bad of [{ file: "x\ny SECRET" }, { file: NODE, cwd: "..\nSECRET" }, { file: NODE, envAllowlist: ["BAD\nNAME"] }]) {
      assert.throws(() => runner.run(bad), (e) => !e.message.includes("SECRET") && !e.message.includes("\n") && e.message.length < 120);
    }
  }));

test("SEC-L5: the same invalid input always produces the same message", () =>
  withRepo(async ({ runner }) => {
    const message = (key) => {
      try {
        runner.run({ file: NODE, [key]: 1 });
      } catch (e) {
        return e.message;
      }
      return null;
    };
    assert.equal(message("a\nb"), message("completely different"));
  }));

// ------------------------------------------------------- Corrective C1: timeout / grandchild

test("a timed-out child whose grandchild inherited stdout/stderr still settles in bounded time", { timeout: 30000 }, () =>
  withRepo(async ({ run }) => {
    // The grandchild keeps the pipes open for 10 s and then exits on its own so no
    // process is left behind. `runProcess` must not wait for it.
    const grandchild = "setTimeout(() => process.exit(0), 10000)";
    const parent =
      `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'inherit' });` +
      "setInterval(() => {}, 1000);";
    const started = Date.now();
    const r = await run({ args: ["-e", parent], timeoutMs: 500 });
    const elapsed = Date.now() - started;
    assert.equal(r.outcome, "TIMEOUT");
    assert.equal(r.reasonCode, "PROCESS_TIMEOUT");
    assert.ok(elapsed < 5000, `settled after ${elapsed} ms`);
  }));
