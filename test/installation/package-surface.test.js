"use strict";

/**
 * Roadmap ACG-A1 (Architecture Conformance Gate finding A-1): the package's
 * PHYSICAL distribution surface must match its SUPPORTED public surface -
 * see docs/package-surface-v1.md (A1_DECISION: PRIVATE_GENERATIVE_SURFACE).
 *
 * Every assertion here inspects an ACTUAL artifact - `npm pack --dry-run
 * --json`'s own manifest, a real `npm pack` tarball installed into a fresh
 * external consumer, and a real Git-dependency install - never
 * package.json's `files` text or repository source paths. Deep-import
 * rejection (Node `exports` encapsulation) and physical absence (the file is
 * not in the installed package at all) are asserted as TWO separate proofs:
 * before A-1 only the first held.
 *
 * Offline and deterministic: the tarball and the Git source are local, and
 * no test needs credentials, a provider, or a live SUT.
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

const EXPECTED_ROOT_EXPORTS = [
  "aggregateBrowserContext",
  "analyzeFailure",
  "analyzeRequirementQuality",
  "analyzeRequirementsCoverage",
  "analyzeRequirementsQuality",
  "assertValidFrameworkRuntimeConfig",
  "assertValidProjectKnowledgeConfig",
  "assertValidProjectProfile",
  "assertValidRepositoryRoot",
  "assertValidRequirementArtifact",
  "assertValidTestDesignArtifact",
  "buildRequirementTraceability",
  "collectContext",
  "collectHistory",
  "generateTestDesign",
  "generateTestDesigns",
  "loadRequirementsFromFile",
  "loadRequirementsFromProvider",
  "publishTestDesigns",
];

const EXPECTED_EXPORT_MAP_KEYS = [".", "./destinations/azure-devops", "./package.json", "./providers/azure-devops", "./providers/jira"];

const PRIVATE_TREES = ["scripts/ai/generation/", "scripts/ai/test-design/", "scripts/ai/test-automation/"];

// Representative private files: the frozen #22 validators, the #22 evidence
// layer (including the ACG-A3 adapter), a #22 generator, and a #23 module.
const PRIVATE_DEEP_IMPORTS = [
  "qa-ai-agent/scripts/ai/generation/requirement-model.js",
  "qa-ai-agent/scripts/ai/test-design/evidence-ingestion.js",
  "qa-ai-agent/scripts/ai/test-design/requirement-model-generator.js",
  "qa-ai-agent/scripts/ai/test-automation/generate-change-set.js",
];

function npm(args, cwd) {
  return execSync(`npm ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function dryRunManifest() {
  const parsed = JSON.parse(npm("pack --dry-run --json", REPO_ROOT));
  return parsed[0].files.map((f) => f.path.split(path.sep).join("/")).sort();
}

const manifest = dryRunManifest();
const manifestSet = new Set(manifest);

// --- Manifest (npm pack --dry-run) ------------------------------------------

test("A-1 manifest: the supported entrypoints and every explicit subpath target are shipped", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  for (const target of Object.values(pkg.exports)) {
    assert.ok(manifestSet.has(target.replace(/^\.\//, "")), `${target} must be in the tarball`);
  }
  assert.ok(manifestSet.has("scripts/ai/index.js"));
});

test("A-1 manifest: the deterministic RTI module test-design.js ships (it is NOT the private test-design/ directory)", () => {
  assert.ok(manifestSet.has("scripts/ai/test-design.js"));
});

test("A-1 manifest: no file from the private #22/#23 trees is shipped", () => {
  for (const tree of PRIVATE_TREES) {
    assert.deepEqual(
      manifest.filter((f) => f.startsWith(tree)),
      [],
      `${tree} must not be in the tarball`
    );
  }
  assert.equal(manifestSet.has("scripts/ai/test-design/evidence-ingestion.js"), false, "the ACG-A3 adapter is private");
});

test("A-1 manifest: tests, fixtures, evaluation, targets, workflows and E2E suites remain excluded", () => {
  assert.deepEqual(manifest.filter((f) => f.endsWith(".test.js")), []);
  assert.deepEqual(manifest.filter((f) => f.includes("__fixtures__")), []);
  assert.deepEqual(manifest.filter((f) => f.includes("/evaluation/")), []);
  assert.deepEqual(manifest.filter((f) => f.startsWith("scripts/targets/") || f.startsWith(".github/") || f.startsWith("cypress/")), []);
});

test("A-1 manifest: package metadata files are present", () => {
  assert.ok(manifestSet.has("package.json"));
  assert.ok(manifestSet.has("README.md"));
  assert.ok(manifest.some((f) => /^LICENSE/i.test(f)));
});

test("A-1 manifest: runtime-discovered core knowledge units still ship", () => {
  assert.ok(manifest.some((f) => f.startsWith("scripts/ai/knowledge/units/") && f.endsWith(".json")));
});

// --- Static package closure -------------------------------------------------

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Node's own resolution order for a relative specifier: exact file, .js,
// .json, then directory index - so `./test-design` resolves to the file
// test-design.js even though a same-named directory exists (Gate finding D-2).
function resolveRelative(fromRel, spec) {
  const base = path.posix.join(path.posix.dirname(fromRel), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, `${base}/index.js`]) {
    const abs = path.join(REPO_ROOT, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return candidate;
  }
  return null;
}

test("A-1 closure: every local require of every shipped .js file resolves to a shipped file (no dynamic requires)", () => {
  const problems = [];
  for (const file of manifest.filter((f) => f.endsWith(".js"))) {
    const src = stripComments(fs.readFileSync(path.join(REPO_ROOT, file), "utf8"));
    for (const m of src.matchAll(/\brequire\s*\(\s*([^)]*?)\s*\)/g)) {
      const literal = m[1].match(/^(["'])(.*)\1$/);
      if (!literal) {
        problems.push(`${file}: non-literal require(${m[1]})`);
        continue;
      }
      if (!literal[2].startsWith(".")) continue;
      const resolved = resolveRelative(file, literal[2]);
      if (!resolved) problems.push(`${file}: ${literal[2]} does not resolve`);
      else if (!manifestSet.has(resolved)) problems.push(`${file}: requires ${resolved}, which is NOT shipped`);
    }
    if (/\bimport\s*\(/.test(src)) problems.push(`${file}: dynamic import()`);
  }
  assert.deepEqual(problems, []);
});

// --- Public surface snapshots -----------------------------------------------

test("A-1 surface: package.json `exports` keys are exactly the approved set (no wildcard, no generative subpath)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(pkg.exports).sort(), EXPECTED_EXPORT_MAP_KEYS);
});

test("A-1 surface: the root barrel exports exactly the approved 19 names (strict, not 'contains')", () => {
  assert.deepEqual(Object.keys(require(path.join(REPO_ROOT, "scripts", "ai", "index.js"))).sort(), EXPECTED_ROOT_EXPORTS);
});

// --- External consumer proofs (real tarball + real Git dependency) ---------

const RUNNER = `
"use strict";
const out = { types: {}, subpaths: {}, deep: {}, rti: {}, calls: {} };
const api = require("qa-ai-agent");
out.rootKeys = Object.keys(api).sort();
for (const k of out.rootKeys) out.types[k] = typeof api[k];
for (const s of ["qa-ai-agent/providers/jira", "qa-ai-agent/providers/azure-devops", "qa-ai-agent/destinations/azure-devops", "qa-ai-agent/package.json"]) {
  try { const m = require(s); out.subpaths[s] = { ok: true, keys: Object.keys(m).sort() }; }
  catch (e) { out.subpaths[s] = { ok: false, code: e.code, message: e.message }; }
}
for (const s of ${JSON.stringify(PRIVATE_DEEP_IMPORTS)}) {
  try { require(s); out.deep[s] = { loaded: true }; }
  catch (e) { out.deep[s] = { loaded: false, code: e.code }; }
}
const artifact = { id: "REQ-1", type: "requirement", title: "API response", content: "When a valid request is submitted, the API returns HTTP 200.", source: { type: "file" } };
function step(name, fn) { try { out.rti[name] = { ok: true, value: fn() }; } catch (e) { out.rti[name] = { ok: false, message: e && e.message }; } }
step("assertValidRequirementArtifact", () => { api.assertValidRequirementArtifact(artifact, "package-surface"); return true; });
step("analyzeRequirementsQuality", () => api.analyzeRequirementsQuality([artifact]).map((r) => r.status));
step("generateTestDesigns", () => api.generateTestDesigns([artifact]).length);
const designs = (() => { try { return api.generateTestDesigns([artifact]); } catch (e) { return []; } })();
step("buildRequirementTraceability", () => api.buildRequirementTraceability([artifact], designs).length);
step("analyzeRequirementsCoverage", () => api.analyzeRequirementsCoverage([artifact], designs).length);
for (const name of ["publishTestDesigns", "loadRequirementsFromProvider"]) {
  try { const r = api[name](); out.calls[name] = { threw: false, async: !!(r && typeof r.then === "function") }; if (r && typeof r.catch === "function") r.catch(() => {}); }
  catch (e) { out.calls[name] = { threw: true, code: e.code, message: String(e.message).slice(0, 200) }; }
}
process.stdout.write(JSON.stringify(out));
`;

function listFiles(dir) {
  const result = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else result.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  })(dir);
  return result.sort();
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "acg-a1-surface-"));
const consumers = {}; // { tarball: {dir, installed, result}, git: {...} }

function bootstrapConsumer(name, spec) {
  const dir = path.join(scratch, `consumer-${name}`);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: `consumer-${name}`, version: "1.0.0", private: true }));
  npm(`install --no-audit --no-fund "${spec}"`, dir);
  fs.writeFileSync(path.join(dir, "surface-runner.js"), RUNNER);
  const stdout = execSync("node surface-runner.js", { cwd: dir, encoding: "utf8" });
  return { dir, installed: path.join(dir, "node_modules", "qa-ai-agent"), result: JSON.parse(stdout) };
}

before(() => {
  const packDir = path.join(scratch, "pack");
  fs.mkdirSync(packDir);
  const packed = JSON.parse(npm(`pack --json --pack-destination "${packDir}"`, REPO_ROOT))[0];
  assert.deepEqual(packed.files.map((f) => f.path).sort(), manifest, "real tarball contents must equal the dry-run manifest");
  consumers.tarball = bootstrapConsumer("tarball", path.join(packDir, packed.filename));

  // Git dependency: a committed copy of exactly the inputs npm's packer reads
  // (package.json, LICENSE, README.md, scripts/ai). npm packs a git
  // dependency through the same `files` field, but that is asserted here, not
  // assumed.
  const gitSrc = path.join(scratch, "git-src");
  fs.mkdirSync(gitSrc);
  for (const f of ["package.json", "LICENSE", "README.md"]) fs.copyFileSync(path.join(REPO_ROOT, f), path.join(gitSrc, f));
  fs.cpSync(path.join(REPO_ROOT, "scripts", "ai"), path.join(gitSrc, "scripts", "ai"), { recursive: true });
  execSync("git init -q", { cwd: gitSrc });
  execSync("git add -A", { cwd: gitSrc });
  execSync("git -c user.name=surface-test -c user.email=surface-test@example.invalid -c commit.gpgsign=false commit -q -m surface", { cwd: gitSrc });
  consumers.git = bootstrapConsumer("git", `git+${pathToFileURL(gitSrc).href}`);
});

after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

for (const kind of ["tarball", "git"]) {
  const label = kind === "tarball" ? "tarball install" : "Git-dependency install";

  test(`A-1 ${label}: the root require exposes exactly the approved 19 exports`, () => {
    assert.deepEqual(consumers[kind].result.rootKeys, EXPECTED_ROOT_EXPORTS);
  });

  test(`A-1 ${label}: every explicit subpath and package.json resolve`, () => {
    const { subpaths } = consumers[kind].result;
    assert.deepEqual(Object.keys(subpaths).sort(), ["qa-ai-agent/destinations/azure-devops", "qa-ai-agent/package.json", "qa-ai-agent/providers/azure-devops", "qa-ai-agent/providers/jira"]);
    for (const [spec, r] of Object.entries(subpaths)) {
      assert.equal(r.ok, true, `${spec}: ${JSON.stringify(r)}`);
      assert.ok(r.keys.length > 0, `${spec} must export something`);
    }
  });

  test(`A-1 ${label}: private deep imports are blocked by exports (proof A: encapsulation)`, () => {
    for (const spec of PRIVATE_DEEP_IMPORTS) {
      assert.deepEqual(consumers[kind].result.deep[spec], { loaded: false, code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }, spec);
    }
  });

  test(`A-1 ${label}: private files are physically absent from the installed package (proof B: physical surface)`, () => {
    for (const spec of PRIVATE_DEEP_IMPORTS) {
      const rel = spec.replace("qa-ai-agent/", "");
      assert.equal(fs.existsSync(path.join(consumers[kind].installed, rel)), false, `${rel} must not be installed`);
    }
    for (const tree of PRIVATE_TREES) {
      assert.equal(fs.existsSync(path.join(consumers[kind].installed, tree)), false, `${tree} must not be installed`);
    }
    assert.equal(fs.existsSync(path.join(consumers[kind].installed, "scripts/ai/test-design.js")), true, "the RTI module must be installed");
  });

  test(`A-1 ${label}: the installed file set equals the npm pack manifest exactly`, () => {
    assert.deepEqual(listFiles(consumers[kind].installed), manifest);
  });

  test(`A-1 ${label}: the RTI chain and package-local dependencies work from the installed package`, () => {
    const { rti, types } = consumers[kind].result;
    for (const k of EXPECTED_ROOT_EXPORTS) assert.ok(["function", "object"].includes(types[k]), `${k} is ${types[k]}`);
    for (const name of ["assertValidRequirementArtifact", "analyzeRequirementsQuality", "generateTestDesigns", "buildRequirementTraceability", "analyzeRequirementsCoverage"]) {
      assert.equal(rti[name].ok, true, `${name}: ${JSON.stringify(rti[name])}`);
    }
    assert.deepEqual(rti.analyzeRequirementsQuality.value, ["READY"]);
    assert.equal(rti.generateTestDesigns.value, 1);
  });

  test(`A-1 ${label}: provider/publishing executors load their package-local dependencies (an argument error, never a missing module)`, () => {
    for (const [name, r] of Object.entries(consumers[kind].result.calls)) {
      assert.notEqual(r.code, "MODULE_NOT_FOUND", `${name}: ${JSON.stringify(r)}`);
      assert.doesNotMatch(String(r.message || ""), /Cannot find module/, name);
    }
  });
}

test("A-1 install parity: the Git-dependency install exposes the same surface as the tarball install", () => {
  assert.deepEqual(listFiles(consumers.git.installed), listFiles(consumers.tarball.installed));
  assert.deepEqual(consumers.git.result.rootKeys, consumers.tarball.result.rootKeys);
  assert.deepEqual(consumers.git.result.subpaths, consumers.tarball.result.subpaths);
});
