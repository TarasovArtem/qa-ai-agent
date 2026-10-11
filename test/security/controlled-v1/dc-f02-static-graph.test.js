"use strict";

/**
 * DC-F02 static approval-gate reachability (contract §18; mission
 * "MANDATORY STATIC DC-F02 ENFORCEMENT"; TSB-F02 OPEN / LOW / CONDITIONAL,
 * required trigger result FALSE).
 *
 * A real static import/call graph, not a CLI-name string check:
 *
 *   - nodes are the actual SHIPPED files (`npm pack --dry-run`), edges every
 *     literal require(...) and require.resolve(...) (the CLI reaches its
 *     spawned child entrypoints through require.resolve), so the graph is
 *     the code a consumer can actually execute through `qa-agent`;
 *   - the gate definers are located by their function definitions, not
 *     assumed;
 *   - a Stage 3 entrypoint violates DC-F02 if its closure contains a gate
 *     definer, a module that imports one, the canonical #23F consumer
 *     (change-set-application.js - reachable only by the future `apply`,
 *     DC-F02-5), or any module referencing a gate symbol;
 *   - the analyzer is proven non-vacuous (it finds the real authorized path
 *     from change-set-application.js) and drift-sensitive (injected edges /
 *     symbol references through an in-memory overlay are reported).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const inv = require("../../helpers/package-inventory");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));

const GATE_SYMBOLS = Object.freeze(["validateApprovedGeneratedChangeSetReview", "validateApprovedTestDesignReview"]);
const CANONICAL_APPLY_CONSUMER = "scripts/ai/test-automation/change-set-application.js";

// Every authorized Stage 3 entrypoint: the bin (all commands), each command's
// orchestration module, and the spawned generative child.
const STAGE3_ENTRYPOINTS = Object.freeze({
  bin: inv.EXPECTED_BIN["qa-agent"],
  "design/plan/generate (parent)": "scripts/ai/cli/generative.js",
  "design/plan/generate (child)": "scripts/ai/cli/generative-runner.js",
  "review show": "scripts/ai/cli/review-show.js",
  "artifact validation": "scripts/ai/cli/run-artifacts.js",
});

const shipped = new Set(
  JSON.parse(execSync("npm pack --dry-run --json", { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }))[0].files.map((f) => f.path.split(path.sep).join("/"))
);
const repoProduction = new Set([
  "package.json",
  ...inv.listFiles(REPO_ROOT).filter((f) => f.startsWith("scripts/") && !f.endsWith(".test.js") && !f.includes("__fixtures__")),
]);

function source(rel, overlay) {
  if (overlay && Object.prototype.hasOwnProperty.call(overlay, rel)) return overlay[rel];
  return fs.readFileSync(path.join(REPO_ROOT, ...rel.split("/")), "utf8");
}

function locateGateDefiners(files) {
  const definers = {};
  for (const symbol of GATE_SYMBOLS) definers[symbol] = [];
  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const src = inv.stripComments(source(file));
    for (const symbol of GATE_SYMBOLS) if (new RegExp(`\\bfunction\\s+${symbol}\\s*\\(`).test(src)) definers[symbol].push(file);
  }
  return definers;
}

const DEFINERS = locateGateDefiners(repoProduction);
const GATE_MODULES = Object.freeze(Object.values(DEFINERS).flat());

/**
 * @returns {string[]} violations, each with the reaching path
 */
function gateReachability({ available, entry, overlay }) {
  const parent = new Map();
  const c = inv.staticClosure({ baseDir: REPO_ROOT, available, entries: [entry], readSource: (rel) => source(rel, overlay) });
  for (const [from, to] of c.edges) if (!parent.has(to) && to !== entry) parent.set(to, from);
  const chain = (file) => {
    const out = [file];
    let cur = file;
    while (parent.has(cur)) {
      cur = parent.get(cur);
      out.unshift(cur);
      if (out.length > 64) break;
    }
    return out.join(" -> ");
  };
  const violations = [];
  for (const missing of c.missing) violations.push(`unresolvable edge (closure not provable): ${missing}`);
  for (const file of c.reached) {
    if (GATE_MODULES.includes(file)) violations.push(`reaches gate module: ${chain(file)}`);
    if (file === CANONICAL_APPLY_CONSUMER) violations.push(`reaches the canonical #23F apply consumer: ${chain(file)}`);
    if (!file.endsWith(".js")) continue;
    const src = inv.stripComments(source(file, overlay));
    for (const symbol of GATE_SYMBOLS) if (new RegExp(`\\b${symbol}\\b`).test(src)) violations.push(`references ${symbol}: ${chain(file)}`);
  }
  return violations;
}

test("DC-F02 setup: each gate is defined exactly once, in its known module (the analyzer locates, not assumes, the gates)", () => {
  assert.deepEqual(DEFINERS, {
    validateApprovedGeneratedChangeSetReview: ["scripts/ai/test-automation/generated-change-set-review-record.js"],
    validateApprovedTestDesignReview: ["scripts/ai/generative-test-design/test-design-review-record.js"],
  });
});

for (const [label, entry] of Object.entries(STAGE3_ENTRYPOINTS)) {
  test(`DC-F02-1/3: Stage 3 entrypoint "${label}" (${entry}) reaches no approval gate, gate module or apply consumer in the SHIPPED graph`, () => {
    assert.ok(shipped.has(entry), `${entry} ships`);
    assert.deepEqual(gateReachability({ available: shipped, entry }), []);
  });

  test(`DC-F02-1/3: Stage 3 entrypoint "${label}" reaches no approval gate even over the full repository graph (unshipped files included)`, () => {
    assert.deepEqual(gateReachability({ available: repoProduction, entry }), []);
  });
}

test("DC-F02-4: no exported entrypoint reaches either gate, and neither gate module ships", () => {
  for (const target of Object.values(pkg.exports).filter((t) => t.endsWith(".js"))) {
    assert.deepEqual(gateReachability({ available: shipped, entry: target.replace(/^\.\//, "") }), [], target);
  }
  for (const gate of GATE_MODULES) assert.equal(shipped.has(gate), false, `${gate} must not ship`);
  assert.equal(shipped.has(CANONICAL_APPLY_CONSUMER), false, "the #23F apply consumer must not ship before OD-04");
});

test("DC-F02-5 / TSB-F02: the production importers of each gate module are exactly the pre-existing set (trigger FALSE)", () => {
  const importers = (target) =>
    [...repoProduction]
      .filter((f) => f.endsWith(".js") && !f.startsWith("scripts/ai/evaluation/"))
      .filter((f) => inv.scanModule(source(f)).relative.some((spec) => inv.resolveIn(repoProduction, f, spec) === target))
      .sort();
  assert.deepEqual(importers("scripts/ai/test-automation/generated-change-set-review-record.js"), [CANONICAL_APPLY_CONSUMER], "only #23F consumes the change-set gate");
  assert.deepEqual(importers("scripts/ai/generative-test-design/test-design-review-record.js"), [], "the test-design gate has no production consumer");
  assert.deepEqual(importers(CANONICAL_APPLY_CONSUMER), ["scripts/ai/test-automation/controlled-execution.js"], "pre-existing, unshipped, reserved (OD-06)");
  const applySource = inv.stripComments(source(CANONICAL_APPLY_CONSUMER));
  assert.match(applySource, /verifyApprovedChangeBinding\(/, "#23F still re-requires per-decision binding (DC-F02-5)");
  const trigger = gateReachability({ available: shipped, entry: inv.EXPECTED_BIN["qa-agent"] }).length > 0;
  assert.equal(trigger, false, "TSB-F02 TRIGGER = FALSE");
});

test("DC-F02-2: no command reports an approval verdict - no review verify / review status / approve command exists", () => {
  const { COMMANDS } = require(path.join(REPO_ROOT, "scripts", "ai", "cli", "args.js"));
  for (const name of Object.keys(COMMANDS)) assert.doesNotMatch(name, /verify|status|approve|verdict/, name);
  assert.equal(COMMANDS["review record"].kind, "reserved");
  assert.equal(COMMANDS.apply.kind, "reserved");
});

test("DC-F02 analyzer non-vacuity: it finds the real authorized path from the #23F consumer to the change-set gate", () => {
  const violations = gateReachability({ available: repoProduction, entry: CANONICAL_APPLY_CONSUMER });
  assert.ok(violations.some((v) => v.startsWith("reaches gate module:") && v.includes("generated-change-set-review-record.js")), JSON.stringify(violations));
  assert.ok(violations.some((v) => v.startsWith("references validateApprovedGeneratedChangeSetReview")));
});

test("DC-F02 drift: an injected gate import, a transitive apply import or a bare gate-symbol reference in a Stage 3 module fails the proof", () => {
  const drifts = [
    ["scripts/ai/cli/generative.js", '\nconst gate = require("../test-automation/generated-change-set-review-record");\n', /reaches gate module/],
    ["scripts/ai/cli/run-artifacts.js", '\nrequire("../test-automation/change-set-application");\n', /canonical #23F apply consumer|reaches gate module/],
    ["scripts/ai/cli/review-show.js", "\nconst x = validateApprovedTestDesignReview;\n", /references validateApprovedTestDesignReview/],
    ["scripts/ai/generative-test-design/test-case-model-generator.js", '\nrequire("./test-design-review-record");\n', /reaches gate module/],
    ["scripts/ai/test-automation/generated-change-set-review-package.js", '\nrequire("./generated-change-set-review-record");\n', /reaches gate module/],
  ];
  for (const [file, injected, expected] of drifts) {
    const overlay = { [file]: `${source(file)}${injected}` };
    const violations = gateReachability({ available: repoProduction, entry: inv.EXPECTED_BIN["qa-agent"], overlay });
    assert.ok(violations.some((v) => expected.test(v)), `${file}: ${JSON.stringify(violations)}`);
    const shippedViolations = gateReachability({ available: shipped, entry: inv.EXPECTED_BIN["qa-agent"], overlay });
    assert.ok(shippedViolations.length > 0, `${file}: drift must also fail the shipped-graph proof`);
  }
});
