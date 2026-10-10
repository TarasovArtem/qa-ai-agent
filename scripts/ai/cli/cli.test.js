"use strict";

/**
 * Controlled-v1 CLI contract: parser/help/version, reserved fixed refusals,
 * info / config validate, the normative validation order (ARCH-PROD-C1-m01),
 * provider/offline/capability policy and the deterministic requirements
 * check. Triage stage execution and child isolation are covered by
 * triage.test.js / child-env.test.js.
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { cleanupScratch, baseConfig, makeRoot, hermeticEnv, runCli, spawnRecorder, scratch, REPO_ROOT } = require("../../../test/helpers/qa-agent-cli");
const pkg = require("../../../package.json");

after(cleanupScratch);

const REQUIREMENTS = {
  schemaVersion: 1,
  requirements: [
    { id: "REQ-1", type: "requirement", title: "Login", content: "When valid credentials are submitted, the user is signed in.", acceptanceCriteria: [{ id: "AC-1", text: "Given valid credentials, the dashboard is shown." }] },
    { id: "REQ-2", type: "requirement", title: "Speed", content: "The page should be fast TBD." },
  ],
};

function withRequirements(root, value = REQUIREMENTS) {
  fs.mkdirSync(path.join(root, "qa"), { recursive: true });
  fs.writeFileSync(path.join(root, "qa", "requirements.json"), typeof value === "string" ? value : JSON.stringify(value));
  return root;
}

function oneJsonObject(result) {
  const lines = result.stdout.split("\n").filter(Boolean);
  assert.equal(lines.length, 1, `stdout must be exactly one JSON line, got: ${result.stdout}`);
  return JSON.parse(lines[0]);
}

// --- usage ------------------------------------------------------------------------

test("CLI usage: no command is a usage error (exit 2) and nothing is printed to stdout", async () => {
  const r = await runCli([]);
  assert.equal(r.code, 2);
  assert.equal(r.stdout, "");
  assert.match(r.stderr, /USAGE_COMMAND_REQUIRED/);
});

test("CLI usage: an unknown command fails with the stable USAGE_UNKNOWN_COMMAND code; --json emits exactly one object", async () => {
  const r = await runCli(["frobnicate", "--json"]);
  assert.equal(r.code, 2);
  const out = oneJsonObject(r);
  assert.deepEqual(Object.keys(out).sort(), ["artifacts", "command", "errors", "exitCode", "ok", "runId", "schemaVersion"]);
  assert.equal(out.ok, false);
  assert.equal(out.exitCode, 2);
  assert.equal(out.errors[0].code, "USAGE_UNKNOWN_COMMAND");
});

test("CLI usage: human-control commands do not exist (commit/push/pr/merge/publish/release/regenerate/init/review verify|status)", async () => {
  for (const argv of [["commit"], ["push"], ["pr"], ["merge"], ["publish"], ["release"], ["regenerate"], ["init"], ["approve"], ["review", "verify"], ["review", "status"]]) {
    const r = await runCli([...argv, "--json"]);
    assert.equal(r.code, 2, argv.join(" "));
    assert.equal(r.json.errors[0].code, "USAGE_UNKNOWN_COMMAND", argv.join(" "));
  }
});

test("CLI usage: option errors are stable usage errors", async () => {
  const cases = [
    [["info", "--bogus"], "USAGE_UNKNOWN_OPTION"],
    [["info", "--provider", "groq"], "USAGE_UNKNOWN_OPTION"],
    [["info", "--root"], "USAGE_MISSING_VALUE"],
    [["info", "--root", "a", "--root", "b"], "USAGE_DUPLICATE_OPTION"],
    [["info", "extra"], "USAGE_UNEXPECTED_ARGUMENT"],
    [["info", "--history"], "USAGE_OPTION_NOT_APPLICABLE"],
    [["info", "--json=yes"], "USAGE_UNEXPECTED_VALUE"],
    [["triage"], "USAGE_SUBCOMMAND_REQUIRED"],
    [["triage", "bogus"], "USAGE_UNKNOWN_COMMAND"],
    [["--version", "info"], "USAGE_CONFLICT"],
    [["-v"], "USAGE_UNKNOWN_OPTION"],
  ];
  for (const [argv, code] of cases) {
    const r = await runCli([...argv, "--json"].filter((a, i, all) => !(a === "--json" && all.indexOf("--json") !== i)));
    assert.equal(r.code, 2, `${argv.join(" ")}: ${r.stderr}`);
    assert.ok(r.stderr.includes(code), `${argv.join(" ")} -> expected ${code}, got ${r.stderr}`);
  }
});

test("CLI --version prints exactly the package version", async () => {
  const r = await runCli(["--version"]);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, `${pkg.version}\n`);
  assert.equal(r.stderr, "");
});

test("CLI --help lists supported commands, marks reserved ones, and offers no --provider flag", async () => {
  const r = await runCli(["--help"]);
  assert.equal(r.code, 0);
  for (const cmd of ["info", "config validate", "requirements check", "triage collect", "triage history", "triage aggregate", "triage analyze", "triage run"]) {
    assert.ok(r.stdout.includes(cmd), cmd);
  }
  assert.match(r.stdout, /Reserved/);
  assert.doesNotMatch(r.stdout, /--provider/);
  const sub = await runCli(["triage", "run", "--help"]);
  assert.equal(sub.code, 0);
  assert.match(sub.stdout, /--history/);
});

// --- reserved commands ------------------------------------------------------------

const RESERVED = [["design"], ["plan"], ["generate"], ["review", "show"], ["review", "record"], ["apply"], ["execute"]];

test("CLI reserved: every reserved command is a fixed refusal (exit 5, CAPABILITY_NOT_ENABLED_IN_RELEASE), machine-readable with --json", async () => {
  for (const argv of RESERVED) {
    const r = await runCli([...argv, "--json"]);
    assert.equal(r.code, 5, argv.join(" "));
    const out = oneJsonObject(r);
    assert.equal(out.command, argv.join(" "));
    assert.equal(out.ok, false);
    assert.equal(out.errors[0].code, "CAPABILITY_NOT_ENABLED_IN_RELEASE");
  }
});

test("CLI reserved: refusals read no input - a nonexistent root, a bogus config and arbitrary arguments change nothing", async () => {
  const missingRoot = path.join(scratch(), "does-not-exist");
  for (const argv of RESERVED) {
    const r = await runCli([...argv, "--run", "x", "--root", missingRoot, "--config", "../../etc/passwd", "--whatever"]);
    assert.equal(r.code, 5, argv.join(" "));
    assert.equal(fs.existsSync(missingRoot), false);
  }
});

test("CLI reserved: a config that requests apply/execute cannot make the command run", async () => {
  const root = makeRoot(baseConfig({ capabilities: { apply: true, execute: true, reviewRecord: true, design: true } }));
  for (const argv of RESERVED) {
    const r = await runCli([...argv, "--root", root]);
    assert.equal(r.code, 5, argv.join(" "));
  }
  assert.deepEqual(fs.readdirSync(root), ["qa-agent.config.json"], "no side effect");
});

test("CLI reserved: --help describes a reserved command without running it", async () => {
  const r = await runCli(["apply", "--help"]);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /OD-04/);
});

// --- root / config steps (2-5) ----------------------------------------------------

test("CLI root: a nonexistent or non-directory --root is a configuration error (exit 3)", async () => {
  const file = path.join(scratch(), "f.txt");
  fs.writeFileSync(file, "x");
  for (const rootArg of [path.join(scratch(), "missing"), file]) {
    const r = await runCli(["config", "validate", "--root", rootArg, "--json"]);
    assert.equal(r.code, 3);
    assert.equal(r.json.errors[0].code, "ROOT_INVALID");
  }
});

test("CLI root: the root defaults to cwd and is never discovered upward", async () => {
  const parent = makeRoot();
  const child = path.join(parent, "nested");
  fs.mkdirSync(child);
  const r = await runCli(["config", "validate", "--json"], { cwd: child });
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "CONFIG_NOT_FOUND", "a parent directory's config must never be used");
  const ok = await runCli(["config", "validate", "--json"], { cwd: parent });
  assert.equal(ok.code, 0);
});

test("CLI config validate: valid config exits 0; a requested-but-release-disabled capability is reported, not rejected", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true, apply: true } }));
  const r = await runCli(["config", "validate", "--root", root, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.capabilities.apply, { requested: true, available: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE" });
  assert.deepEqual(r.json.capabilities.triage, { requested: true, available: true });
  assert.ok(r.json.warnings.some((w) => w.code === "CAPABILITY_NOT_ENABLED_IN_RELEASE"));
});

test("CLI config validate: missing / malformed / oversized config exit 3 with stable codes and zero side effects", async () => {
  const missing = makeRoot(null);
  assert.equal((await runCli(["config", "validate", "--root", missing, "--json"])).json.errors[0].code, "CONFIG_NOT_FOUND");
  const malformed = makeRoot('{"schemaVersion":1,');
  assert.equal((await runCli(["config", "validate", "--root", malformed, "--json"])).json.errors[0].code, "CONFIG_PARSE_ERROR");
  const dup = makeRoot('{"schemaVersion":1,"schemaVersion":1}');
  assert.equal((await runCli(["config", "validate", "--root", dup, "--json"])).json.errors[0].code, "CONFIG_DUPLICATE_KEY");
  const big = makeRoot(JSON.stringify(baseConfig()) + " ".repeat(70 * 1024));
  const r = await runCli(["config", "validate", "--root", big, "--json"]);
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "CONFIG_TOO_LARGE");
  for (const root of [missing, malformed, dup, big]) assert.equal(fs.existsSync(path.join(root, "reports")), false);
});

test("CLI config validate: --config must stay inside the root", async () => {
  const root = makeRoot();
  const r = await runCli(["config", "validate", "--root", root, "--config", "../outside.json", "--json"]);
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "CONFIG_OUTSIDE_ROOT");
});

function canSymlink() {
  const dir = scratch();
  try {
    fs.symlinkSync(dir, path.join(dir, "probe"), "dir");
    return true;
  } catch {
    return false;
  }
}
const SYMLINKS = canSymlink();

test("CLI path containment: output.dir through a symlink escaping the root is refused (exit 3) before any write", async (t) => {
  if (!SYMLINKS) return t.skip("symlinks unavailable");
  const outside = scratch();
  const root = makeRoot(baseConfig({ output: { dir: "linked/out" }, requirements: { source: "file", path: "qa/requirements.json" } }));
  withRequirements(root);
  fs.symlinkSync(outside, path.join(root, "linked"), "dir");
  const r = await runCli(["requirements", "check", "--root", root, "--json"]);
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "CONFIG_PATH_OUTSIDE_ROOT");
  assert.deepEqual(fs.readdirSync(outside), []);
});

test("CLI path containment: output.dir canonically resolving into .git is refused", async (t) => {
  if (!SYMLINKS) return t.skip("symlinks unavailable");
  const root = makeRoot(baseConfig({ output: { dir: "out" } }));
  fs.mkdirSync(path.join(root, ".git"));
  fs.symlinkSync(path.join(root, ".git"), path.join(root, "out"), "dir");
  const r = await runCli(["config", "validate", "--root", root, "--json"]);
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "CONFIG_PATH_INVALID");
});

test("CLI path containment: requirements.path through an escaping symlinked directory is refused (exit 3)", async (t) => {
  if (!SYMLINKS) return t.skip("symlinks unavailable");
  const outside = scratch();
  fs.writeFileSync(path.join(outside, "requirements.json"), JSON.stringify(REQUIREMENTS));
  const root = makeRoot(baseConfig({ requirements: { source: "file", path: "ext/requirements.json" } }));
  fs.symlinkSync(outside, path.join(root, "ext"), "dir");
  const r = await runCli(["requirements", "check", "--root", root, "--json"]);
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "CONFIG_PATH_OUTSIDE_ROOT");
});

// --- info ------------------------------------------------------------------------

test("CLI info --json: version, contracts, capabilities, provider, invocation and platform decision status - no network", async () => {
  const root = makeRoot(baseConfig({ capabilities: { triage: true, execute: true } }));
  const r = await runCli(["info", "--root", root, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  const out = oneJsonObject(r);
  assert.deepEqual(out.product, { name: pkg.name, version: pkg.version });
  assert.equal(out.contracts.config, 1);
  assert.equal(out.contracts.cliOutput, 1);
  assert.equal(out.config.status, "VALID");
  assert.deepEqual(out.capabilities.triage, { requested: true, available: true });
  assert.deepEqual(out.capabilities.execute, { requested: true, available: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE" });
  assert.deepEqual(out.capabilities.design, { requested: false, available: false, reason: "CAPABILITY_NOT_ENABLED_IN_RELEASE" });
  assert.equal(out.provider.effective, "mock");
  assert.equal(out.provider.generativeCapable, false);
  assert.equal(out.invocation.mode, "local-v1-orchestrated");
  assert.equal(out.platform.executeDecision, "PENDING_OD_06");
});

test("CLI info: works without a config (reports MISSING) but refuses an invalid one (exit 3)", async () => {
  const empty = makeRoot(null);
  const r = await runCli(["info", "--root", empty, "--json"]);
  assert.equal(r.code, 0);
  assert.equal(r.json.config.status, "MISSING");
  const bad = makeRoot('{"schemaVersion":2}');
  assert.equal((await runCli(["info", "--root", bad])).code, 3);
});

test("CLI info: credential presence is a boolean only; the key value never reaches stdout or stderr", async () => {
  const root = makeRoot(baseConfig({ providers: { allow: ["mock", "groq"] } }));
  const env = hermeticEnv({ AI_PROVIDER: "groq", AI_MODEL: "m", AI_API_KEY: "SENTINEL_AI_SECRET", GITHUB_TOKEN: "SENTINEL_GITHUB_SECRET" });
  for (const argv of [["info", "--root", root, "--json"], ["info", "--root", root], ["config", "validate", "--root", root, "--json"]]) {
    const r = await runCli(argv, { env });
    assert.equal(r.code, 0);
    assert.doesNotMatch(r.stdout + r.stderr, /SENTINEL_/);
  }
  assert.equal((await runCli(["info", "--root", root, "--json"], { env })).json.provider.credentialPresent, true);
});

test("CLI info --offline reports (does not enforce) an offline/provider contradiction; GitHub mode is detected, never set", async () => {
  const root = makeRoot();
  const r = await runCli(["info", "--offline", "--root", root, "--json"], { env: hermeticEnv({ AI_PROVIDER: "groq", GITHUB_ACTIONS: "true" }) });
  assert.equal(r.code, 0);
  assert.equal(r.json.provider.offlineContradiction, true);
  assert.equal(r.json.provider.effective, null);
  assert.equal(r.json.invocation.mode, "github-actions-v1");
});

// --- normative validation order (ARCH-PROD-C1-m01) ----------------------------------

const TRIAGE_ON = baseConfig({ capabilities: { triage: true } });

async function triageAnalyze(config, envOverrides, extraArgs = []) {
  const root = makeRoot(config);
  const spy = spawnRecorder({ fake: true });
  const r = await runCli(["triage", "analyze", "--root", root, "--json", ...extraArgs], { env: hermeticEnv({ QA_AI_INVOCATION_MODE: "local-v1", QA_AI_INVOCATION_ID: "a".repeat(32), ...envOverrides }), spawnImpl: spy.impl });
  return { r, spawned: spy.calls.length, root };
}

test("order: unknown AI_PROVIDER -> exit 3 PROVIDER_CONFIGURATION_INVALID, no child spawned", async () => {
  const { r, spawned } = await triageAnalyze(TRIAGE_ON, { AI_PROVIDER: "openai" });
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "PROVIDER_CONFIGURATION_INVALID");
  assert.equal(spawned, 0);
});

test("order: provider not in providers.allow -> exit 5 PROVIDER_NOT_ALLOWED before credentials are checked", async () => {
  const { r, spawned } = await triageAnalyze(TRIAGE_ON, { AI_PROVIDER: "groq" });
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "PROVIDER_NOT_ALLOWED");
  assert.equal(spawned, 0);
});

test("order: config can forbid mock too", async () => {
  const { r } = await triageAnalyze(baseConfig({ capabilities: { triage: true }, providers: { allow: ["groq"] } }), {});
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "PROVIDER_NOT_ALLOWED");
});

test("order: allowed network provider without AI_API_KEY/AI_MODEL -> exit 3, no network, no spawn", async () => {
  for (const env of [{ AI_PROVIDER: "groq", AI_MODEL: "m" }, { AI_PROVIDER: "gemini", AI_API_KEY: "k" }]) {
    const { r, spawned } = await triageAnalyze(baseConfig({ capabilities: { triage: true }, providers: { allow: ["mock", "groq", "gemini"] } }), env);
    assert.equal(r.code, 3);
    assert.equal(r.json.errors[0].code, "PROVIDER_CONFIGURATION_INVALID");
    assert.equal(spawned, 0);
  }
});

test("order: --offline with a network AI_PROVIDER -> exit 5 OFFLINE_PROVIDER_CONTRADICTION (never silently replaced with mock)", async () => {
  const { r, spawned } = await triageAnalyze(TRIAGE_ON, { AI_PROVIDER: "groq", AI_API_KEY: "k", AI_MODEL: "m" }, ["--offline"]);
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "OFFLINE_PROVIDER_CONTRADICTION");
  assert.equal(spawned, 0);
});

test("order: step 6 (offline contradiction, 5) precedes step 7 (unknown provider, 3)", async () => {
  const { r } = await triageAnalyze(TRIAGE_ON, { AI_PROVIDER: "openai" }, ["--offline"]);
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "OFFLINE_PROVIDER_CONTRADICTION");
});

test("order: step 4 (config invalid, 3) precedes step 6 (offline contradiction, 5)", async () => {
  const { r } = await triageAnalyze('{"schemaVersion":1', { AI_PROVIDER: "groq" }, ["--offline"]);
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "CONFIG_PARSE_ERROR");
});

test("order: step 7 (unknown provider, 3) precedes step 11 (capability not requested, 5)", async () => {
  const { r } = await triageAnalyze(baseConfig(), { AI_PROVIDER: "openai" });
  assert.equal(r.code, 3);
  assert.equal(r.json.errors[0].code, "PROVIDER_CONFIGURATION_INVALID");
});

test("order: triage capability not requested -> exit 5 CAPABILITY_NOT_REQUESTED, no spawn", async () => {
  const { r, spawned } = await triageAnalyze(baseConfig(), {});
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "CAPABILITY_NOT_REQUESTED");
  assert.equal(spawned, 0);
});

test("order: QA_FRAMEWORK contradicting the config framework -> exit 3 FRAMEWORK_AUTHORITY_CONTRADICTION; an equal value is accepted", async () => {
  const bad = await triageAnalyze(TRIAGE_ON, { QA_FRAMEWORK: "cypress" });
  assert.equal(bad.r.code, 3);
  assert.equal(bad.r.json.errors[0].code, "FRAMEWORK_AUTHORITY_CONTRADICTION");
  const same = await triageAnalyze(TRIAGE_ON, { QA_FRAMEWORK: "Playwright" });
  assert.equal(same.r.code, 0, same.r.stderr);
});

test("order: --offline refuses the network History stage before any spawn", async () => {
  const root = makeRoot(TRIAGE_ON);
  const spy = spawnRecorder({ fake: true });
  for (const argv of [["triage", "history"], ["triage", "run", "--history"]]) {
    const r = await runCli([...argv, "--offline", "--root", root, "--json"], { env: hermeticEnv(), spawnImpl: spy.impl });
    assert.equal(r.code, 5, argv.join(" "));
    assert.equal(r.json.errors[0].code, "OFFLINE_NETWORK_STAGE_REFUSED");
  }
  assert.equal(spy.calls.length, 0);
});

test("order: step 12 invocation trust - contradictory or missing identity is refused before spawn", async () => {
  const root = makeRoot(TRIAGE_ON);
  const spy = spawnRecorder({ fake: true });
  const cases = [
    [["triage", "collect"], { GITHUB_ACTIONS: "true", QA_AI_INVOCATION_MODE: "local-v1" }, "INVOCATION_MODE_CONFLICT"],
    [["triage", "run"], { QA_AI_INVOCATION_MODE: "local-v1", QA_AI_INVOCATION_ID: "b".repeat(32) }, "INVOCATION_MODE_CONFLICT"],
    [["triage", "collect"], {}, "INVOCATION_IDENTITY_REQUIRED"],
    [["triage", "analyze"], { QA_AI_INVOCATION_MODE: "local-v1" }, "INVOCATION_IDENTITY_REQUIRED"],
    [["triage", "aggregate"], { QA_AI_INVOCATION_ID: "c".repeat(32) }, "INVOCATION_IDENTITY_REQUIRED"],
  ];
  for (const [argv, env, code] of cases) {
    const r = await runCli([...argv, "--root", root, "--json"], { env: hermeticEnv(env), spawnImpl: spy.impl });
    assert.equal(r.code, 5, `${argv.join(" ")} ${JSON.stringify(env)}: ${r.stderr}`);
    assert.equal(r.json.errors[0].code, code);
  }
  assert.equal(spy.calls.length, 0);
});

// --- requirements check -------------------------------------------------------------

test("requirements check: deterministic report under output.dir, designs only for READY requirements, no provider, exit 0", async () => {
  const root = withRequirements(makeRoot(baseConfig({ requirements: { source: "file", path: "qa/requirements.json" } })));
  const spy = spawnRecorder({ fake: true });
  const r = await runCli(["requirements", "check", "--offline", "--root", root, "--json"], { env: hermeticEnv(), spawnImpl: spy.impl });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(spy.calls.length, 0, "no child process");
  assert.deepEqual(r.json.artifacts, ["reports/qa-agent/requirements/requirements-check.json"]);
  assert.equal(r.json.summary.requirements, 2);
  assert.equal(r.json.summary.ready, 1);
  assert.equal(r.json.summary.testDesigns, 1);
  const report = JSON.parse(fs.readFileSync(path.join(root, "reports", "qa-agent", "requirements", "requirements-check.json"), "utf8"));
  assert.equal(report.kind, "RequirementsCheckReport");
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.testDesigns[0].requirementId, "REQ-1");
  assert.deepEqual(report.coverage.map((c) => c.status).sort(), ["FULLY_COVERED", "UNCOVERED"]);
  assert.deepEqual(fs.readdirSync(root).sort(), ["qa", "qa-agent.config.json", "reports"], "only output.dir is written");
});

test("requirements check: same input yields the same report apart from generatedAt (deterministic)", async () => {
  const root = withRequirements(makeRoot(baseConfig({ requirements: { source: "file", path: "qa/requirements.json" } })));
  const file = path.join(root, "reports", "qa-agent", "requirements", "requirements-check.json");
  await runCli(["requirements", "check", "--root", root]);
  const a = JSON.parse(fs.readFileSync(file, "utf8"));
  await runCli(["requirements", "check", "--root", root]);
  const b = JSON.parse(fs.readFileSync(file, "utf8"));
  delete a.generatedAt;
  delete b.generatedAt;
  assert.deepEqual(a, b);
});

test("requirements check: missing requirements config -> 3; invalid requirements file -> 4; no report written", async () => {
  const unconfigured = makeRoot();
  const r1 = await runCli(["requirements", "check", "--root", unconfigured, "--json"]);
  assert.equal(r1.code, 3);
  assert.equal(r1.json.errors[0].code, "REQUIREMENTS_NOT_CONFIGURED");

  const invalid = withRequirements(makeRoot(baseConfig({ requirements: { source: "file", path: "qa/requirements.json" } })), '{"schemaVersion":1,"requirements":[{"id":"X"}]}');
  const r2 = await runCli(["requirements", "check", "--root", invalid, "--json"]);
  assert.equal(r2.code, 4);
  assert.equal(r2.json.errors[0].code, "REQUIREMENTS_INPUT_REFUSED");
  assert.equal(fs.existsSync(path.join(invalid, "reports")), false);

  const missing = makeRoot(baseConfig({ requirements: { source: "file", path: "qa/none.json" } }));
  assert.equal((await runCli(["requirements", "check", "--root", missing])).code, 4);
});

test("requirements check: --offline with a network AI_PROVIDER is refused (5) even though no provider is used", async () => {
  const root = withRequirements(makeRoot(baseConfig({ requirements: { source: "file", path: "qa/requirements.json" } })));
  const r = await runCli(["requirements", "check", "--offline", "--root", root, "--json"], { env: hermeticEnv({ AI_PROVIDER: "gemini" }) });
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "OFFLINE_PROVIDER_CONTRADICTION");
  assert.equal(fs.existsSync(path.join(root, "reports")), false);
});

test("requirements check: an output leaf symlinked outside the root is refused (5) and the outside file is untouched", async (t) => {
  if (!SYMLINKS) return t.skip("symlinks unavailable");
  const root = withRequirements(makeRoot(baseConfig({ requirements: { source: "file", path: "qa/requirements.json" } })));
  const outside = scratch();
  const victim = path.join(outside, "victim.json");
  fs.writeFileSync(victim, "ORIGINAL");
  fs.mkdirSync(path.join(root, "reports", "qa-agent", "requirements"), { recursive: true });
  fs.symlinkSync(victim, path.join(root, "reports", "qa-agent", "requirements", "requirements-check.json"), "file");
  const r = await runCli(["requirements", "check", "--root", root, "--json"]);
  assert.equal(r.code, 5);
  assert.equal(r.json.errors[0].code, "WRITE_TARGET_REFUSED");
  assert.equal(fs.readFileSync(victim, "utf8"), "ORIGINAL");
});

// C1-02 (ARCH-IMPL-m02 / SEC-IMPL-m02): the effective write directory
// <output.dir>/requirements must be authorized against the same protected
// prefixes as output.dir itself. A directory symlink is used where the host
// allows it; otherwise (Windows without the symlink privilege) a junction,
// which needs no privilege - the redirect class under test is the same.
function linkDir(target, link) {
  try {
    fs.symlinkSync(target, link, "dir");
    return "symlink";
  } catch (err) {
    if (process.platform !== "win32") throw err;
  }
  fs.symlinkSync(target, link, "junction");
  return "junction";
}

function git(cwd, args) {
  return require("node:child_process").execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitAvailable() {
  try {
    git(scratch(), ["--version"]);
    return true;
  } catch {
    return false;
  }
}

function listTree(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    out.push(full);
    if (entry.isDirectory()) out.push(...listTree(full));
  }
  return out.sort();
}

const REQUIREMENTS_CONFIG = baseConfig({ output: { dir: "out" }, requirements: { source: "file", path: "qa/requirements.json" } });

test("C1-02 case A: <output.dir>/requirements redirected into .git is refused (5) and nothing is written into .git", async () => {
  const root = withRequirements(makeRoot(REQUIREMENTS_CONFIG));
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  fs.mkdirSync(path.join(root, "out"));
  linkDir(path.join(root, ".git"), path.join(root, "out", "requirements"));
  const before = listTree(path.join(root, ".git"));
  const r = await runCli(["requirements", "check", "--root", root, "--json"]);
  assert.equal(r.code, 5, r.stderr);
  assert.equal(r.json.errors[0].code, "WRITE_TARGET_REFUSED");
  assert.deepEqual(r.json.artifacts, []);
  assert.equal(fs.existsSync(path.join(root, ".git", "requirements-check.json")), false);
  assert.deepEqual(listTree(path.join(root, ".git")), before, "no protected file created");
});

test("C1-02 case B: <output.dir>/requirements redirected into .git/refs/heads is refused (5); refs unchanged and the repository still works", async (t) => {
  if (!gitAvailable()) return t.skip("platform-specific: git executable unavailable, a real repository cannot be created");
  const root = withRequirements(makeRoot(REQUIREMENTS_CONFIG));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", "seed"]);
  const heads = path.join(root, ".git", "refs", "heads");
  const refsBefore = git(root, ["for-each-ref"]);
  const headsBefore = fs.readdirSync(heads).sort();
  fs.mkdirSync(path.join(root, "out"));
  linkDir(heads, path.join(root, "out", "requirements"));
  const r = await runCli(["requirements", "check", "--root", root, "--json"]);
  assert.equal(r.code, 5, r.stderr);
  assert.equal(r.json.errors[0].code, "WRITE_TARGET_REFUSED");
  assert.equal(fs.existsSync(path.join(heads, "requirements-check.json")), false);
  assert.deepEqual(fs.readdirSync(heads).sort(), headsBefore);
  assert.equal(git(root, ["for-each-ref"]), refsBefore, "refs unchanged");
  assert.match(git(root, ["rev-parse", "--verify", "HEAD"]).trim(), /^[0-9a-f]{40}$/, "repository operational");
});

test("C1-02: <output.dir>/requirements redirected into node_modules, a framework source root or the config location is refused (5)", async () => {
  const cases = [
    ["node_modules/pkg", baseConfig({ output: { dir: "out" }, requirements: { source: "file", path: "qa/requirements.json" } })],
    ["playwright", REQUIREMENTS_CONFIG],
    ["cfg", REQUIREMENTS_CONFIG, ["--config", "cfg/qa-agent.config.json"]],
  ];
  for (const [target, config, extra = []] of cases) {
    const root = withRequirements(makeRoot(config));
    fs.mkdirSync(path.join(root, ...target.split("/")), { recursive: true });
    if (extra.length > 0) fs.renameSync(path.join(root, "qa-agent.config.json"), path.join(root, "cfg", "qa-agent.config.json"));
    fs.mkdirSync(path.join(root, "out"));
    linkDir(path.join(root, ...target.split("/")), path.join(root, "out", "requirements"));
    const r = await runCli(["requirements", "check", "--root", root, ...extra, "--json"]);
    assert.equal(r.code, 5, `${target}: ${r.stderr}`);
    assert.equal(r.json.errors[0].code, "WRITE_TARGET_REFUSED", target);
    assert.equal(fs.existsSync(path.join(root, ...target.split("/"), "requirements-check.json")), false, target);
  }
});

test("C1-02: a safe in-root redirect of <output.dir>/requirements still writes the report", async () => {
  const root = withRequirements(makeRoot(REQUIREMENTS_CONFIG));
  fs.mkdirSync(path.join(root, "out"));
  fs.mkdirSync(path.join(root, "elsewhere"));
  linkDir(path.join(root, "elsewhere"), path.join(root, "out", "requirements"));
  const r = await runCli(["requirements", "check", "--root", root, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.artifacts, ["out/requirements/requirements-check.json"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "elsewhere", "requirements-check.json"), "utf8")).kind, "RequirementsCheckReport");
});

test("C1-02: the normal safe output path (directories created fresh) still writes the report", async () => {
  const root = withRequirements(makeRoot(REQUIREMENTS_CONFIG));
  const r = await runCli(["requirements", "check", "--root", root, "--json"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.json.artifacts, ["out/requirements/requirements-check.json"]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "out", "requirements", "requirements-check.json"), "utf8")).kind, "RequirementsCheckReport");
});

// --- output discipline ------------------------------------------------------------

test("output: errors never print stack traces; --json stdout is exactly one object for every command outcome", async () => {
  const root = makeRoot();
  for (const argv of [["info"], ["config", "validate"], ["requirements", "check"], ["apply"], ["bogus"], ["triage", "run"]]) {
    const r = await runCli([...argv, "--root", root, "--json"]);
    oneJsonObject(r);
    assert.doesNotMatch(r.stderr, /\n\s+at /, `${argv.join(" ")} printed a stack trace`);
  }
});

test("binary: scripts/ai/cli/qa-agent.js is a Node executable with a shebang and is the package bin", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ai", "cli", "qa-agent.js"), "utf8");
  // The committed blob is LF; a Windows autocrlf checkout may show CRLF.
  assert.match(src, /^#!\/usr\/bin\/env node\r?\n/);
  assert.deepEqual(pkg.bin, { "qa-agent": "scripts/ai/cli/qa-agent.js" });
  assert.doesNotMatch(src, /process\.stdin|readline/, "non-interactive: never reads stdin");
});
