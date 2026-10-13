"use strict";

/**
 * Controlled-v1 package surface, Stage 3 (contract §9.1; OD-02;
 * docs/package-surface-v4.md):
 *
 *   - `exports` unchanged (exact five keys, exact targets), no wildcard;
 *   - `bin` is exactly { "qa-agent": "scripts/ai/cli/qa-agent.js" };
 *   - the tarball inventory is an exact closed list (89 files);
 *   - the #22/#23/generation trees ship ONLY the Stage 3 private runtime
 *     closure; approval-gate, review-record, application, execution and
 *     regeneration modules stay unshipped;
 *   - closure + minimality over `exports ∪ bin`, and removing any required
 *     Stage 3 file makes the closure proof fail;
 *   - package-specifier deep imports of every CLI and private module are
 *     denied;
 *   - the CLI parent process never loads an env-snapshotting provider/config
 *     module, a provider-calling generator, or a triage stage module.
 *
 * The DC-F02 approval-gate reachability proof lives in
 * test/security/controlled-v1/dc-f02-static-graph.test.js. Reads the real
 * `npm pack --dry-run` manifest; installs nothing (the installed-tarball
 * proofs live in controlled-v1-cli-external-proof.test.js and
 * controlled-v1-stage3-external-proof.test.js).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync, spawnSync } = require("node:child_process");

const inv = require("../helpers/package-inventory");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

const manifest = JSON.parse(execSync("npm pack --dry-run --json", { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0]
  .files.map((f) => f.path.split(path.sep).join("/"))
  .sort();
const manifestSet = new Set(manifest);

// --- package.json ------------------------------------------------------------------

test("Controlled-v1 package: exports are byte-for-byte the five approved entries (public programmatic API unchanged)", () => {
  assert.deepEqual(pkg.exports, inv.EXPECTED_EXPORTS);
  assert.deepEqual(Object.keys(pkg.exports), Object.keys(inv.EXPECTED_EXPORTS), "same order");
  assert.equal(Object.keys(pkg.exports).some((k) => k.includes("*")), false, "no wildcard export");
  assert.equal(pkg.main, "scripts/ai/index.js");
});

test("Controlled-v1 package: bin is exactly qa-agent -> scripts/ai/cli/qa-agent.js, and the bin target is not exported", () => {
  assert.deepEqual(pkg.bin, inv.EXPECTED_BIN);
  assert.equal(Object.values(pkg.exports).some((t) => t.includes("/cli/")), false);
  assert.equal(pkg.dependencies, undefined, "zero runtime dependencies");
  assert.equal(pkg.optionalDependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  assert.equal(pkg.bundleDependencies, undefined);
  assert.equal(pkg.overrides, undefined);
});

test("Controlled-v1 package: no publication automation or lifecycle hook was introduced", () => {
  for (const key of ["prepublish", "prepublishOnly", "prepack", "postpack", "publish", "postinstall", "preinstall", "install"]) {
    assert.equal(pkg.scripts[key], undefined, key);
  }
  assert.equal(pkg.publishConfig, undefined);
});

test("package.json: private trees stay excluded and only the approved Stage 3 and Stage 4A closure files are re-included", () => {
  for (const tree of ["!scripts/ai/generation", "!scripts/ai/generative-test-design", "!scripts/ai/test-automation"]) assert.ok(pkg.files.includes(tree), tree);
  const reincluded = pkg.files.filter((f) => !f.startsWith("!") && inv.PRIVATE_TREES.some((t) => f.startsWith(t)));
  assert.deepEqual([...reincluded].sort(), [...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE4_PRIVATE_RUNTIME.filter(f => inv.PRIVATE_TREES.some(t => f.startsWith(t)))].sort());
  assert.equal(pkg.files.some((f) => /[*?]/.test(f) && inv.PRIVATE_TREES.some((t) => f.replace(/^!/, "").startsWith(t))), false, "no glob re-include");
});

// --- tarball inventory -------------------------------------------------------------

test("Controlled-v1 tarball: the inventory is exactly the closed expected list", () => {
  assert.deepEqual(manifest, [...inv.EXPECTED_INVENTORY]);
  assert.equal(manifest.length, 89 + inv.STAGE4_PRIVATE_RUNTIME.length);
});

test("Controlled-v1 tarball: no test, fixture, env/secret-like, evaluation, governance or excluded private file ships", () => {
  assert.deepEqual(manifest.filter((f) => f.endsWith(".test.js")), []);
  assert.deepEqual(manifest.filter((f) => /__fixtures__|\/fixtures?\//.test(f)), []);
  assert.deepEqual(manifest.filter((f) => /(^|\/)\.env|\.pem$|\.key$|secret|credential|token/i.test(f)), []);
  assert.deepEqual(manifest.filter((f) => f.includes("/evaluation/")), []);
  for (const file of inv.EXCLUDED_PRIVATE) assert.equal(manifestSet.has(file), false, `${file} must not ship`);
  assert.deepEqual(
    manifest.filter((f) => inv.PRIVATE_TREES.some((t) => f.startsWith(t))),
    [...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE4_PRIVATE_RUNTIME.filter(f => inv.PRIVATE_TREES.some(t => f.startsWith(t)))].sort(),
    "the private trees contribute exactly the Stage 3 and Stage 4A closures"
  );
  assert.deepEqual(manifest.filter((f) => f.startsWith("test/") || f.startsWith("scripts/targets/") || f.startsWith("scripts/governance/") || f.startsWith("scripts/diagnostics/")), []);
});

test("Controlled-v1 tarball: every non-shipped file of the private trees is a test or an EXCLUDED_PRIVATE module (nothing unclassified)", () => {
  const repoPrivate = inv.listFiles(REPO_ROOT).filter((f) => inv.PRIVATE_TREES.some((t) => f.startsWith(t)) && !f.endsWith(".test.js"));
  assert.deepEqual(repoPrivate, [...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE4_PRIVATE_RUNTIME.filter(f => inv.PRIVATE_TREES.some(t => f.startsWith(t))), ...inv.EXCLUDED_PRIVATE].sort());
});

// --- closure / minimality over exports ∪ bin ----------------------------------------

function closureOver(available) {
  return inv.staticClosure({ baseDir: REPO_ROOT, available, entries: inv.supportedEntrypoints(pkg) });
}

test("§9.1 closure: every require of every reachable file resolves to a shipped file; no dynamic require", () => {
  const c = closureOver(manifestSet);
  assert.deepEqual(c.missing, []);
  assert.deepEqual(c.problems, []);
});

test("§9.1 minimality: every shipped implementation is reachable from exports/bin without exceptions", () => {
  const c = closureOver(manifestSet);
  const unreachable = manifest.filter((f) => f.endsWith(".js") && !c.reached.has(f));
  assert.deepEqual(unreachable, []);
  const reachedPrivate = [...c.reached].filter((f) => inv.PRIVATE_TREES.some((t) => f.startsWith(t))).sort();
  assert.deepEqual(reachedPrivate, [...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE4_PRIVATE_RUNTIME.filter(f => inv.PRIVATE_TREES.some(t => f.startsWith(t)))].sort());
  const bin = inv.staticClosure({ baseDir: REPO_ROOT, available: manifestSet, entries: [pkg.bin["qa-agent"]] });
  for (const file of inv.STAGE4_PRIVATE_RUNTIME) assert.ok(bin.reached.has(file), `${file} reachable from production bin`);
  for (const entry of ["scripts/ai/cli/review-record.js", "scripts/ai/cli/apply.js"]) {
    const stage4 = inv.staticClosure({ baseDir: REPO_ROOT, available: manifestSet, entries: [entry] });
    assert.deepEqual(stage4.missing, [], entry); assert.deepEqual(stage4.problems, [], entry);
    assert.ok(stage4.reached.has("scripts/ai/test-automation/change-set-application.js") === (entry.endsWith("apply.js")), entry);
  }
});

test("§9.1 negative proof: removing any required Stage 3 private runtime file (or new CLI module) makes the closure proof fail", () => {
  for (const removed of [...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE3_CLI_FILES, ...inv.STAGE4_PRIVATE_RUNTIME]) {
    const available = new Set(manifest.filter((f) => f !== removed));
    const c = closureOver(available);
    assert.ok(c.missing.length > 0, `removing ${removed} must be detected`);
  }
});

// --- deep-import denial (package specifier) ----------------------------------------

test("Controlled-v1 surface: every CLI module and every private (shipped or not) module is denied through the package specifier", () => {
  for (const file of [...inv.CLI_FILES, ...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE4_PRIVATE_RUNTIME, ...inv.EXCLUDED_PRIVATE]) {
    for (const spec of [`${pkg.name}/${file}`, `${pkg.name}/${file.replace(/\.js$/, "")}`]) {
      let code = null;
      try {
        require.resolve(spec);
      } catch (err) {
        code = err.code;
      }
      assert.equal(code, "ERR_PACKAGE_PATH_NOT_EXPORTED", spec);
    }
  }
});

test("Controlled-v1 surface: the root barrel still exports exactly the 19 approved names and no Stage 3 function", () => {
  const api = require(path.join(REPO_ROOT, "scripts", "ai", "index.js"));
  assert.equal(Object.keys(api).length, 19);
  const exported = new Set();
  for (const v of Object.values(api)) {
    if (typeof v === "function") exported.add(v);
    else if (v && typeof v === "object") for (const inner of Object.values(v)) if (typeof inner === "function") exported.add(inner);
  }
  for (const file of [...inv.STAGE3_PRIVATE_RUNTIME, ...inv.STAGE4_PRIVATE_RUNTIME, ...inv.STAGE3_CLI_FILES.filter((f) => !f.endsWith("generative-runner.js"))]) {
    for (const fn of Object.values(require(path.join(REPO_ROOT, ...file.split("/"))))) {
      if (typeof fn === "function") assert.equal(exported.has(fn), false, `${file} function exported`);
    }
  }
});

// --- parent-process module graph (contract §10.4.5) ----------------------------------

const CHILD_ONLY_MODULES = [
  "scripts/ai/config.js",
  "scripts/ai/providers/index.js",
  "scripts/ai/providers/mock-provider.js",
  "scripts/ai/providers/groq-provider.js",
  "scripts/ai/providers/gemini-provider.js",
  "scripts/ai/analyze-failure.js",
  "scripts/ai/collect-context.js",
  "scripts/ai/collect-history.js",
  "scripts/ai/aggregate-browser-context.js",
  "scripts/ai/index.js",
  "scripts/ai/cli/stage-runner.js",
  "scripts/ai/cli/generative-runner.js",
  // provider-calling generators: only the generative child calls them
  "scripts/ai/generative-test-design/test-case-model-generator.js",
  "scripts/ai/test-automation/automation-plan-generator.js",
  "scripts/ai/test-automation/generate-change-set.js",
];

test("§10.4.5: the CLI parent's static require graph never includes an env-snapshotting provider/config module, a provider-calling generator or a triage stage module", () => {
  const parent = inv.staticClosure({ baseDir: REPO_ROOT, available: manifestSet, entries: [inv.EXPECTED_BIN["qa-agent"]], includeResolve: false });
  for (const mod of CHILD_ONLY_MODULES) assert.equal(parent.reached.has(mod), false, mod);
  const triageChild = inv.staticClosure({ baseDir: REPO_ROOT, available: manifestSet, entries: ["scripts/ai/cli/stage-runner.js"], includeResolve: false });
  assert.ok(triageChild.reached.has("scripts/ai/config.js"), "provider configuration is loaded only inside the triage child");
  const generativeChild = inv.staticClosure({ baseDir: REPO_ROOT, available: manifestSet, entries: ["scripts/ai/cli/generative-runner.js"], includeResolve: false });
  assert.ok(generativeChild.reached.has("scripts/ai/config.js"), "provider configuration is loaded only inside the generative child");
  assert.equal(generativeChild.reached.has("scripts/ai/index.js"), false, "the generative child does not load the triage API");
});

test("§10.4.5: at runtime, info, a refused design and a design whose child fails load none of the child-only modules in the parent", () => {
  const helper = path.join(REPO_ROOT, "test", "helpers", "qa-agent-cli.js");
  const fixtures = path.join(REPO_ROOT, "test", "helpers", "stage3-fixtures.js");
  const script = `
    const path = require("path");
    const { runCli, spawnRecorder, hermeticEnv } = require(${JSON.stringify(helper)});
    const fx = require(${JSON.stringify(fixtures)});
    (async () => {
      const root = fx.makeStage3Root();
      const codes = [];
      codes.push((await runCli(["info", "--json", "--root", root], { env: hermeticEnv() })).code);
      codes.push((await runCli(["design", "--json", "--root", root], { env: hermeticEnv() })).code);
      const fake = spawnRecorder({ fake: true });
      codes.push((await runCli(["design", "--json", "--root", root], { env: fx.generativeEnv(), spawnImpl: fake.impl })).code);
      const loaded = Object.keys(require.cache).map((p) => path.relative(${JSON.stringify(REPO_ROOT)}, p).split(path.sep).join("/"));
      process.stdout.write(JSON.stringify({ codes, loaded, spawned: fake.calls.length }));
    })();
  `;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.codes, [0, 5, 6], "info ok; mock refused; a child without artifacts is a refused provider output");
  assert.equal(out.spawned, 1);
  for (const mod of CHILD_ONLY_MODULES) assert.equal(out.loaded.includes(mod), false, mod);
  assert.ok(out.loaded.includes("scripts/ai/cli/cli.js"));
});

test("Only execute stays reserved; baseline CLI modules remain free of approval/application authority", () => {
  const { COMMANDS } = require(path.join(REPO_ROOT, "scripts", "ai", "cli", "args.js"));
  assert.deepEqual(
    Object.entries(COMMANDS)
      .filter(([, s]) => s.kind === "reserved")
      .map(([n, s]) => `${n}:${s.ownerDecision}`)
      .sort(),
    ["execute:OD-06"]
  );
  for (const file of inv.CLI_FILES) {
    const scan = inv.scanModule(fs.readFileSync(path.join(REPO_ROOT, ...file.split("/")), "utf8"));
    assert.deepEqual(scan.problems, [], file);
    for (const spec of scan.relative) {
      assert.doesNotMatch(spec, /generated-change-set-review-record|change-set-application|controlled-execution|applied-change-set-record|automation-execution-record|regenerate-change-set|test-design-review/, `${file} requires ${spec}`);
    }
    const src = inv.stripComments(fs.readFileSync(path.join(REPO_ROOT, ...file.split("/")), "utf8"));
    assert.doesNotMatch(src, /validateApproved|applyApproved|verifyApprovedChangeBinding|executeAppliedChangeSet|buildGeneratedChangeSetReviewRecord|buildTestDesignReviewRecord/, file);
  }
});
