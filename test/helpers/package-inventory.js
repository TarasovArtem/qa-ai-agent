"use strict";

/**
 * Test-only source of truth for the Controlled-v1 Stage 3 package surface
 * (docs/package-surface-v4.md): the exact closed tarball inventory, the
 * Stage 3 private runtime closure, the private files that must stay
 * unshipped, and a static require-graph analyzer that works over ANY
 * directory (the checkout, an installed package, a deliberately broken
 * copy) so the same closure proof can be shown to pass and to fail.
 */

const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_EXPORTS = Object.freeze({
  ".": "./scripts/ai/index.js",
  "./providers/jira": "./scripts/ai/providers/jira-requirements-provider.js",
  "./providers/azure-devops": "./scripts/ai/providers/azure-devops-requirements-provider.js",
  "./destinations/azure-devops": "./scripts/ai/destinations/azure-devops-test-case-destination.js",
  "./package.json": "./package.json",
});

const EXPECTED_BIN = Object.freeze({ "qa-agent": "scripts/ai/cli/qa-agent.js" });

const STAGE12_CLI_FILES = Object.freeze([
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
]);

// New Stage 3 CLI orchestration modules (not exported; reachable from bin).
const STAGE3_CLI_FILES = Object.freeze([
  "scripts/ai/cli/generative-runner.js",
  "scripts/ai/cli/generative.js",
  "scripts/ai/cli/review-show.js",
  "scripts/ai/cli/run-artifacts.js",
  "scripts/ai/cli/run-store.js",
]);

const CLI_FILES = Object.freeze([...STAGE12_CLI_FILES, ...STAGE3_CLI_FILES].sort());

// OD-02: the minimal private runtime closure of design/plan/generate/review
// show - INTERNAL / SHIPPED PRIVATE RUNTIME DEPENDENCY, never exported.
const STAGE3_PRIVATE_RUNTIME = Object.freeze([
  "scripts/ai/generation/automation-candidate.js",
  "scripts/ai/generation/automation-plan.js",
  "scripts/ai/generation/cross-model-validation.js",
  "scripts/ai/generation/errors.js",
  "scripts/ai/generation/limits.js",
  "scripts/ai/generation/primitives.js",
  "scripts/ai/generation/requirement-model.js",
  "scripts/ai/generation/test-case-model.js",
  "scripts/ai/generative-test-design/automation-candidate-generator.js",
  "scripts/ai/generative-test-design/automation-candidate-prompt.js",
  "scripts/ai/generative-test-design/evidence-ingestion.js",
  "scripts/ai/generative-test-design/requirement-model-generator.js",
  "scripts/ai/generative-test-design/test-case-model-generator.js",
  "scripts/ai/generative-test-design/test-case-model-prompt.js",
  "scripts/ai/generative-test-design/test-design-prompt.js",
  "scripts/ai/test-automation/automation-plan-generator.js",
  "scripts/ai/test-automation/automation-plan-prompt.js",
  "scripts/ai/test-automation/automation-repository-context.js",
  "scripts/ai/test-automation/generate-change-set-prompt.js",
  "scripts/ai/test-automation/generate-change-set.js",
  "scripts/ai/test-automation/generated-change-set-review-canonical.js",
  "scripts/ai/test-automation/generated-change-set-review-package.js",
  "scripts/ai/test-automation/generated-change-set.js",
]);

// Private modules that remain REPOSITORY-ONLY (approval gates, review
// records, application, execution, regeneration).
const EXCLUDED_PRIVATE = Object.freeze([
  "scripts/ai/generative-test-design/test-design-review-canonical.js",
  "scripts/ai/generative-test-design/test-design-review-package.js",
  "scripts/ai/generative-test-design/test-design-review-record.js",
  "scripts/ai/test-automation/applied-change-set-record.js",
  "scripts/ai/test-automation/automation-execution-record.js",
  "scripts/ai/test-automation/change-set-application.js",
  "scripts/ai/test-automation/controlled-execution.js",
  "scripts/ai/test-automation/generated-change-set-review-record.js",
  "scripts/ai/test-automation/regenerate-change-set.js",
]);

const PRIVATE_TREES = Object.freeze(["scripts/ai/generation/", "scripts/ai/generative-test-design/", "scripts/ai/test-automation/"]);

// The certified 47-file baseline, the 19 CLI modules and the 23 Stage 3
// private runtime files.
const EXPECTED_INVENTORY = Object.freeze(
  [
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
    ...STAGE3_PRIVATE_RUNTIME,
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
  ].sort()
);

// --- static require graph ---------------------------------------------------------

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Literal relative specifiers of require(...) and, optionally,
// require.resolve(...) (the CLI locates its spawned child entrypoints that
// way), plus any non-literal require / dynamic import as a problem.
function scanModule(source, { includeResolve = true } = {}) {
  const src = stripComments(source);
  const relative = [];
  const problems = [];
  const pattern = includeResolve ? /\brequire(?:\.resolve)?\s*\(\s*([^)]*?)\s*\)/g : /\brequire\s*\(\s*([^)]*?)\s*\)/g;
  for (const m of src.matchAll(pattern)) {
    const literal = m[1].match(/^(["'])(.*)\1$/);
    if (!literal) {
      problems.push(`non-literal require(${m[1]})`);
      continue;
    }
    if (literal[2].startsWith(".")) relative.push(literal[2]);
  }
  if (/\bimport\s*\(/.test(src)) problems.push("dynamic import()");
  return { relative, problems };
}

// Node's resolution order for a relative specifier over a set of available
// files: exact file, .js, .json, directory index.
function resolveIn(available, fromRel, spec) {
  const base = path.posix.join(path.posix.dirname(fromRel), spec);
  for (const candidate of [base, `${base}.js`, `${base}.json`, `${base}/index.js`]) if (available.has(candidate)) return candidate;
  return null;
}

/**
 * Static closure of `entries` inside `baseDir`, restricted to the `available`
 * file set (repository-relative POSIX paths). Returns every reached file,
 * every edge, and every edge whose target is NOT available ("missing").
 * `readSource(rel)` defaults to reading baseDir/rel; tests may overlay it.
 */
function staticClosure({ baseDir, available, entries, includeResolve = true, readSource }) {
  const read = readSource || ((rel) => fs.readFileSync(path.join(baseDir, ...rel.split("/")), "utf8"));
  const reached = new Set();
  const edges = [];
  const missing = [];
  const problems = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift();
    if (reached.has(file)) continue;
    if (!available.has(file)) {
      missing.push(file);
      continue;
    }
    reached.add(file);
    if (!file.endsWith(".js")) continue;
    const scan = scanModule(read(file), { includeResolve });
    for (const p of scan.problems) problems.push(`${file}: ${p}`);
    for (const spec of scan.relative) {
      const resolved = resolveIn(available, file, spec);
      if (!resolved) {
        missing.push(`${file} -> ${spec}`);
        continue;
      }
      edges.push([file, resolved]);
      queue.push(resolved);
    }
  }
  return { reached, edges, missing, problems };
}

function listFiles(dir) {
  const out = [];
  (function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  })(dir);
  return out.sort();
}

function supportedEntrypoints(pkg) {
  return [...Object.values(pkg.exports), ...Object.values(pkg.bin || {})].map((t) => t.replace(/^\.\//, "")).filter((t) => t.endsWith(".js"));
}

module.exports = {
  EXPECTED_EXPORTS,
  EXPECTED_BIN,
  STAGE12_CLI_FILES,
  STAGE3_CLI_FILES,
  CLI_FILES,
  STAGE3_PRIVATE_RUNTIME,
  EXCLUDED_PRIVATE,
  PRIVATE_TREES,
  EXPECTED_INVENTORY,
  stripComments,
  scanModule,
  resolveIn,
  staticClosure,
  listFiles,
  supportedEntrypoints,
};
