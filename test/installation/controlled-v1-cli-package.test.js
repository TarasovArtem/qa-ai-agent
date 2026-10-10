"use strict";

/**
 * Controlled-v1 Stage 1-2 package surface (contract §9.1, mission §23-§24):
 *
 *   - `exports` unchanged (exact five keys, exact targets), no wildcard;
 *   - `bin` is exactly { "qa-agent": "scripts/ai/cli/qa-agent.js" };
 *   - the tarball inventory is an exact closed list;
 *   - no test, fixture, secret-like or #22/#23/generation file ships;
 *   - package-specifier deep imports of every CLI module are denied;
 *   - DC-F02 static import invariant (TSB-F02 trigger FALSE): no shipped
 *     non-test module imports either review-record gate module,
 *     change-set-application.js, or any #22/#23/generation module;
 *   - the CLI parent process never loads an env-snapshotting provider/config
 *     module or a triage stage module (those load only in stage children).
 *
 * Reads the real `npm pack --dry-run` manifest; installs nothing (the
 * installed-tarball proof lives in controlled-v1-cli-external-proof.test.js).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

const EXPECTED_EXPORTS = {
  ".": "./scripts/ai/index.js",
  "./providers/jira": "./scripts/ai/providers/jira-requirements-provider.js",
  "./providers/azure-devops": "./scripts/ai/providers/azure-devops-requirements-provider.js",
  "./destinations/azure-devops": "./scripts/ai/destinations/azure-devops-test-case-destination.js",
  "./package.json": "./package.json",
};

const EXPECTED_BIN = { "qa-agent": "scripts/ai/cli/qa-agent.js" };

const CLI_FILES = [
  "scripts/ai/cli/args.js",
  "scripts/ai/cli/child-env.js",
  "scripts/ai/cli/cli.js",
  "scripts/ai/cli/config-file.js",
  "scripts/ai/cli/env.js",
  "scripts/ai/cli/errors.js",
  "scripts/ai/cli/paths.js",
  "scripts/ai/cli/policy.js",
  "scripts/ai/cli/qa-agent.js",
  "scripts/ai/cli/requirements-check.js",
  "scripts/ai/cli/stage-process.js",
  "scripts/ai/cli/stage-runner.js",
  "scripts/ai/cli/strict-json.js",
  "scripts/ai/cli/triage.js",
];

// The certified 47-file baseline inventory plus exactly the 14 CLI modules.
const EXPECTED_INVENTORY = [
  "LICENSE",
  "README.md",
  "package.json",
  "scripts/ai/adapters/cypress-adapter.js",
  "scripts/ai/adapters/playwright-adapter.js",
  "scripts/ai/agent-policy.js",
  "scripts/ai/aggregate-browser-context.js",
  "scripts/ai/analyze-failure.js",
  "scripts/ai/bounded-response.js",
  ...CLI_FILES,
  "scripts/ai/collect-context.js",
  "scripts/ai/collect-history.js",
  "scripts/ai/config.js",
  "scripts/ai/context-utils.js",
  "scripts/ai/correlation-projection.js",
  "scripts/ai/destinations/azure-devops-test-case-destination.js",
  "scripts/ai/framework-runtime-config.js",
  "scripts/ai/index.js",
  "scripts/ai/knowledge/loader.js",
  "scripts/ai/knowledge/schema.js",
  "scripts/ai/knowledge/selector.js",
  "scripts/ai/knowledge/units/ci-job-isolation-runner-state.json",
  "scripts/ai/knowledge/units/cross-browser-differing-signature-caution.json",
  "scripts/ai/knowledge/units/framework-cypress-command-retry-ability-scope.json",
  "scripts/ai/knowledge/units/framework-cypress-retry-timeout-semantics.json",
  "scripts/ai/knowledge/units/project-firefox-execution-environment-split.json",
  "scripts/ai/knowledge/units/qa-timeout-error-multiple-causes.json",
  "scripts/ai/project-knowledge-config.js",
  "scripts/ai/project-profile.js",
  "scripts/ai/providers/azure-devops-requirements-provider.js",
  "scripts/ai/providers/gemini-provider.js",
  "scripts/ai/providers/groq-provider.js",
  "scripts/ai/providers/index.js",
  "scripts/ai/providers/jira-requirements-provider.js",
  "scripts/ai/providers/mock-provider.js",
  "scripts/ai/providers/provider-contract.js",
  "scripts/ai/providers/provider-error.js",
  "scripts/ai/qa-agent-prompt.js",
  "scripts/ai/repository-root.js",
  "scripts/ai/requirement-artifact.js",
  "scripts/ai/requirement-quality.js",
  "scripts/ai/requirement-traceability.js",
  "scripts/ai/requirements-file.js",
  "scripts/ai/requirements-source-provider.js",
  "scripts/ai/runtime-framework-selector.js",
  "scripts/ai/test-design-publishing.js",
  "scripts/ai/test-design.js",
  "scripts/ai/triage-boundary-contract.js",
].sort();

const GATE_MODULES = ["generated-change-set-review-record", "test-design-review-record", "change-set-application"];
const PRIVATE_TREES = ["scripts/ai/generation/", "scripts/ai/generative-test-design/", "scripts/ai/test-automation/"];

const manifest = JSON.parse(execSync("npm pack --dry-run --json", { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0]
  .files.map((f) => f.path.split(path.sep).join("/"))
  .sort();

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function relativeRequires(file, { includeResolve }) {
  const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
  const pattern = includeResolve ? /\brequire(?:\.resolve)?\s*\(\s*["']([^"']+)["']\s*\)/g : /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g;
  return [...src.matchAll(pattern)].map((m) => m[1]).filter((s) => s.startsWith("."));
}

function resolveRelative(fromRel, spec) {
  const base = path.posix.join(path.posix.dirname(fromRel), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, `${base}/index.js`]) {
    const abs = path.join(REPO_ROOT, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate;
  }
  return null;
}

function closure(entry, options) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith(".js")) continue;
    for (const spec of relativeRequires(file, options)) {
      const resolved = resolveRelative(file, spec);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

// --- package.json ------------------------------------------------------------------

test("Controlled-v1 package: exports are byte-for-byte the five approved entries (public programmatic API unchanged)", () => {
  assert.deepEqual(pkg.exports, EXPECTED_EXPORTS);
  assert.deepEqual(Object.keys(pkg.exports), Object.keys(EXPECTED_EXPORTS), "same order");
  assert.equal(Object.keys(pkg.exports).some((k) => k.includes("*")), false, "no wildcard export");
  assert.equal(pkg.main, "scripts/ai/index.js");
});

test("Controlled-v1 package: bin is exactly qa-agent -> scripts/ai/cli/qa-agent.js, and the bin target is not exported", () => {
  assert.deepEqual(pkg.bin, EXPECTED_BIN);
  assert.equal(Object.values(pkg.exports).some((t) => t.includes("/cli/")), false);
  assert.equal(pkg.dependencies, undefined, "zero runtime dependencies");
});

test("Controlled-v1 package: no publication automation or lifecycle hook was introduced", () => {
  for (const key of ["prepublish", "prepublishOnly", "prepack", "postpack", "publish", "postinstall", "preinstall", "install"]) {
    assert.equal(pkg.scripts[key], undefined, key);
  }
  assert.equal(pkg.publishConfig, undefined);
});

// --- tarball inventory -------------------------------------------------------------

test("Controlled-v1 tarball: the inventory is exactly the closed expected list (47 baseline files + 14 CLI modules)", () => {
  assert.deepEqual(manifest, EXPECTED_INVENTORY);
  assert.equal(manifest.length, 61);
});

test("Controlled-v1 tarball: no test, fixture, env/secret-like, #22/#23 or generation file ships", () => {
  assert.deepEqual(manifest.filter((f) => f.endsWith(".test.js")), []);
  assert.deepEqual(manifest.filter((f) => /__fixtures__|\/fixtures?\//.test(f)), []);
  assert.deepEqual(manifest.filter((f) => /(^|\/)\.env|\.pem$|\.key$|secret|credential|token/i.test(f)), []);
  for (const tree of PRIVATE_TREES) assert.deepEqual(manifest.filter((f) => f.startsWith(tree)), [], tree);
  assert.deepEqual(manifest.filter((f) => f.startsWith("test/") || f.startsWith("scripts/targets/") || f.startsWith("scripts/governance/")), []);
});

// --- deep-import denial (package specifier) ----------------------------------------

test("Controlled-v1 surface: every CLI module is denied through the package specifier (ERR_PACKAGE_PATH_NOT_EXPORTED)", () => {
  for (const file of CLI_FILES) {
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

// --- DC-F02 / TSB-F02 static import invariant ---------------------------------------

test("DC-F02 (TSB-F02 trigger FALSE): no shipped non-test module imports a review-record gate, change-set-application, or any #22/#23/generation module", () => {
  const violations = [];
  for (const file of manifest.filter((f) => f.endsWith(".js"))) {
    for (const spec of relativeRequires(file, { includeResolve: true })) {
      const target = path.posix.join(path.posix.dirname(file), spec);
      if (GATE_MODULES.some((g) => target.endsWith(`/${g}`) || target.endsWith(`/${g}.js`))) violations.push(`${file} -> ${spec} (gate)`);
      if (PRIVATE_TREES.some((t) => `${target}/`.startsWith(t) || target.startsWith(t))) violations.push(`${file} -> ${spec} (private tree)`);
    }
    const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
    for (const gate of ["validateApprovedGeneratedChangeSetReview", "validateApprovedTestDesignReview", "applyApprovedGeneratedChangeSet", "verifyApprovedChangeBinding"]) {
      if (src.includes(gate)) violations.push(`${file} references ${gate}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("DC-F02: the qa-agent bin closure (including the spawned stage entrypoint) reaches no gate or private module", () => {
  const reach = closure(EXPECTED_BIN["qa-agent"], { includeResolve: true });
  assert.ok(reach.has("scripts/ai/cli/stage-runner.js"), "the stage entrypoint is part of the bin closure");
  for (const file of reach) {
    assert.equal(manifest.includes(file), true, `${file} must ship`);
    assert.equal(PRIVATE_TREES.some((t) => file.startsWith(t)), false, file);
    assert.equal(GATE_MODULES.some((g) => file.includes(g)), false, file);
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
];

test("§10.4.5: the CLI parent's static require graph never includes an env-snapshotting provider/config module or a triage stage module", () => {
  const parent = closure(EXPECTED_BIN["qa-agent"], { includeResolve: false });
  for (const mod of CHILD_ONLY_MODULES) assert.equal(parent.has(mod), false, mod);
  const child = closure("scripts/ai/cli/stage-runner.js", { includeResolve: false });
  assert.ok(child.has("scripts/ai/config.js"), "provider configuration is loaded only inside the stage child");
});

test("§10.4.5: at runtime, loading the CLI and running a command loads none of the child-only modules", () => {
  const script = `
    const path = require("path");
    const { run } = require(${JSON.stringify(path.join(REPO_ROOT, "scripts", "ai", "cli", "cli.js"))});
    const sink = { write() {} };
    run({ argv: ["info", "--json", "--root", ${JSON.stringify(REPO_ROOT)}], env: {}, cwd: ${JSON.stringify(REPO_ROOT)}, stdout: sink, stderr: sink }).then(() => {
      const loaded = Object.keys(require.cache).map((p) => path.relative(${JSON.stringify(REPO_ROOT)}, p).split(path.sep).join("/"));
      process.stdout.write(JSON.stringify(loaded));
    });
  `;
  const r = spawnSync(process.execPath, ["-e", script], { encoding: "utf8", env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT } });
  assert.equal(r.status, 0, r.stderr);
  const loaded = JSON.parse(r.stdout);
  for (const mod of CHILD_ONLY_MODULES) assert.equal(loaded.includes(mod), false, mod);
  assert.ok(loaded.includes("scripts/ai/cli/cli.js"));
});

test("Reserved commands load no gate, #22/#23 or approval module and read no approval artifact (static)", () => {
  for (const file of CLI_FILES) {
    for (const spec of relativeRequires(file, { includeResolve: true })) {
      assert.doesNotMatch(spec, /test-automation|generative-test-design|generation|review-record|change-set/, `${file} requires ${spec}`);
    }
    const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
    assert.doesNotMatch(src, /\bimport\s*\(/, `${file}: no dynamic import`);
    assert.doesNotMatch(src, /validateApproved|applyApproved|verifyApprovedChangeBinding|executeAppliedChangeSet/, file);
  }
});
