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
 *   - fail closed (ARCH-S3-m01): a non-literal / computed / indirect
 *     require, createRequire, dynamic import() or an unterminated lexical
 *     construct makes the graph unprovable and is a violation; process
 *     launch is confined to the known launchers; no reachable string literal
 *     may name an excluded private module; source is lexed string-, template-
 *     and regex-aware so `//` or `/*` inside a literal never hides code.
 *     Residual (documented, not modelled): a process target or module name
 *     assembled entirely from non-literal runtime data inside an allowed
 *     launcher;
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

// Process launch is part of the graph model: a module may start another
// process only if it is one of these known launchers, whose spawned targets
// are themselves require.resolve() edges (stage-process.js) or a fixed
// external tool (collect-context.js: read-only `git`).
const PROCESS_LAUNCHER_SPECIFIERS = Object.freeze(["child_process", "node:child_process", "worker_threads", "node:worker_threads", "cluster", "node:cluster"]);
const ALLOWED_PROCESS_LAUNCHERS = Object.freeze(["scripts/ai/cli/stage-process.js", "scripts/ai/collect-context.js"]);

// No string literal in a reachable module may name an excluded private
// (approval / review-record / apply / execute / regeneration) module - this
// catches a path built for spawn/fork/readFile/require from literal pieces.
const FORBIDDEN_MODULE_STEMS = Object.freeze(inv.EXCLUDED_PRIVATE.map((f) => path.posix.basename(f, ".js")));

// Stage 3 command entrypoints remain gate-free. The aggregate bin now also
// contains separately release-gated Stage 4 routes, proved below.
const STAGE3_ENTRYPOINTS = Object.freeze({
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
  // Fail closed: a non-literal / computed / indirect require, a dynamic
  // import or an unterminated lexical construct means the graph is not
  // provably complete.
  for (const problem of c.problems) violations.push(`unprovable graph (closure not provable): ${problem}`);
  for (const file of c.reached) {
    if (GATE_MODULES.includes(file)) violations.push(`reaches gate module: ${chain(file)}`);
    if (file === CANONICAL_APPLY_CONSUMER) violations.push(`reaches the canonical #23F apply consumer: ${chain(file)}`);
    if (!file.endsWith(".js")) continue;
    const src = source(file, overlay);
    const code = inv.stripComments(src);
    for (const symbol of GATE_SYMBOLS) if (new RegExp(`\\b${symbol}\\b`).test(code)) violations.push(`references ${symbol}: ${chain(file)}`);
    const scan = inv.scanModule(src);
    if (scan.bare.some((spec) => PROCESS_LAUNCHER_SPECIFIERS.includes(spec)) && !ALLOWED_PROCESS_LAUNCHERS.includes(file)) {
      violations.push(`launches processes outside the known launchers: ${chain(file)}`);
    }
    for (const text of scan.strings) {
      const stem = FORBIDDEN_MODULE_STEMS.find((s) => text.includes(s));
      if (stem) violations.push(`names excluded private module ${stem} in a string literal: ${chain(file)}`);
    }
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

test("DC-F02-4: no exported entrypoint reaches either gate; Stage 4 gate access is private and unexported", () => {
  for (const target of Object.values(pkg.exports).filter((t) => t.endsWith(".js"))) {
    assert.deepEqual(gateReachability({ available: shipped, entry: target.replace(/^\.\//, "") }), [], target);
  }
  assert.equal(shipped.has("scripts/ai/test-automation/generated-change-set-review-record.js"), true, "change-set gate ships in the private Stage 4A closure");
  assert.equal(shipped.has("scripts/ai/generative-test-design/test-design-review-record.js"), false, "test-design gate remains unshipped");
  assert.equal(shipped.has(CANONICAL_APPLY_CONSUMER), true, "Stage 4A ships the canonical #23F apply consumer privately");
});

test("Stage 4A graph: review cannot reach the gate; apply reaches it only through #23F", () => {
  const review = inv.staticClosure({ baseDir: REPO_ROOT, available: shipped, entries: ["scripts/ai/cli/review-record.js"] });
  assert.deepEqual(review.missing, []); assert.deepEqual(review.problems, []);
  assert.equal(review.reached.has(CANONICAL_APPLY_CONSUMER), false);
  for (const gate of GATE_MODULES) assert.equal(review.reached.has(gate), false, gate);
  const apply = inv.staticClosure({ baseDir: REPO_ROOT, available: shipped, entries: ["scripts/ai/cli/apply.js"] });
  assert.deepEqual(apply.missing, []); assert.deepEqual(apply.problems, []);
  assert.equal(apply.reached.has(CANONICAL_APPLY_CONSUMER), true);
  const importers = apply.edges.filter(([, to]) => GATE_MODULES.includes(to)).map(([from]) => from);
  assert.deepEqual(importers, [CANONICAL_APPLY_CONSUMER]);
});

test("DC-F02-5 / TSB-F02: the production importers of each gate module are exactly the pre-existing set (trigger FALSE)", () => {
  const importers = (target) =>
    [...repoProduction]
      .filter((f) => f.endsWith(".js") && !f.startsWith("scripts/ai/evaluation/"))
      .filter((f) => inv.scanModule(source(f)).relative.some((spec) => inv.resolveIn(repoProduction, f, spec) === target))
      .sort();
  assert.deepEqual(importers("scripts/ai/test-automation/generated-change-set-review-record.js"), [CANONICAL_APPLY_CONSUMER], "only #23F consumes the change-set gate");
  assert.deepEqual(importers("scripts/ai/generative-test-design/test-design-review-record.js"), [], "the test-design gate has no production consumer");
  assert.deepEqual(importers(CANONICAL_APPLY_CONSUMER), ["scripts/ai/cli/apply.js", "scripts/ai/test-automation/controlled-execution.js"], "Stage 4A private apply plus pre-existing reserved OD-06 consumer");
  const applySource = inv.stripComments(source(CANONICAL_APPLY_CONSUMER));
  assert.match(applySource, /verifyApprovedChangeBinding\(/, "#23F still re-requires per-decision binding (DC-F02-5)");
  const bin = inv.staticClosure({ baseDir: REPO_ROOT, available: shipped, entries: [inv.EXPECTED_BIN["qa-agent"]] });
  assert.deepEqual(bin.missing, []); assert.deepEqual(bin.problems, []);
  const gateEdges = bin.edges.filter(([, to]) => GATE_MODULES.includes(to));
  assert.deepEqual(gateEdges, [[CANONICAL_APPLY_CONSUMER, "scripts/ai/test-automation/generated-change-set-review-record.js"]]);
  // Canonical §18 trigger: a consumer OTHER than #23F, or bypass of its
  // independent per-decision checks. Static reachability is not activation.
  const trigger = gateEdges.some(([from]) => from !== CANONICAL_APPLY_CONSUMER) || !/verifyApprovedChangeBinding\(/.test(applySource);
  assert.equal(trigger, false, "TSB-F02 TRIGGER = FALSE");
});

test("Stage 4B bin routing: config opt-in refuses before loading any authority implementation", () => {
  const { spawnSync } = require("node:child_process");
  const probe = `
    const Module = require('node:module'), load = Module._load;
    Module._load = function(spec, ...args) {
      if (/^(?:\\.\\/)?(?:apply|review-record)$/.test(spec)) throw new Error('authority loaded before release gate');
      return load.call(this, spec, ...args);
    };
    const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stage4b-config-gate-'));
    fs.writeFileSync(path.join(root, 'qa-agent.config.json'), JSON.stringify({schemaVersion:1,projectProfile:{id:'gate-probe',displayName:'Gate probe',knownProjectConstraints:['Synthetic gate probe.']},framework:'cypress'}));
    const { run } = require('./scripts/ai/cli/cli');
    (async () => {
      const results=[];
      for (const argv of [['review','record'],['apply']]) {
        let output='', error='';
        const code = await run({ argv:[...argv,'--run','20261012T120000Z-0123456789abcdef','--package','0001'], cwd: root, env: { QA_AGENT_ENABLE_APPLY:'true', AI_PROVIDER:'mock', CI:'false' }, stdout:{write:t=>output+=t}, stderr:{write:t=>error+=t} });
        results.push({code,output,error});
      }
      fs.rmSync(root,{recursive:true,force:true}); process.stdout.write(JSON.stringify(results));
    })().catch(e=>{process.stderr.write(e.message);process.exitCode=1});`;
  const r = spawnSync(process.execPath, ["-e", probe], { cwd: REPO_ROOT, encoding: "utf8", timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
  for (const result of JSON.parse(r.stdout)) { assert.equal(result.code, 5, result.error); assert.equal(result.output, ""); assert.match(result.error, /CAPABILITY_NOT_REQUESTED/); }
  const release = require("../../../scripts/ai/cli/policy").RELEASE_CAPABILITIES;
  for (const key of ["reviewRecord", "apply"]) { assert.equal(release[key].enabled, true); assert.ok(Object.isFrozen(release[key])); }
  assert.equal(release.execute.enabled, false);
  assert.ok(Object.isFrozen(release));
});

test("C1 bin graph non-vacuity: a direct gate edge is distinct from the permitted #23F edge", () => {
  const entry = "scripts/ai/cli/cli.js";
  const overlay = { [entry]: source(entry) + '\nrequire("../test-automation/generated-change-set-review-record");\n' };
  const c = inv.staticClosure({ baseDir: REPO_ROOT, available: shipped, entries: [inv.EXPECTED_BIN["qa-agent"]], readSource: rel => source(rel, overlay) });
  assert.ok(c.edges.some(([from, to]) => from !== CANONICAL_APPLY_CONSUMER && GATE_MODULES.includes(to)), "an injected bypass triggers F02");
});

test("DC-F02-2: no gate-verdict command exists; review/apply route only to existing Stage 4 implementations", () => {
  const { COMMANDS } = require(path.join(REPO_ROOT, "scripts", "ai", "cli", "args.js"));
  for (const name of Object.keys(COMMANDS)) assert.doesNotMatch(name, /verify|status|approve|verdict/, name);
  assert.equal(COMMANDS["review record"].kind, "stage4");
  assert.equal(COMMANDS.apply.kind, "stage4");
  assert.equal(COMMANDS.execute.kind, "reserved");
  for (const file of ["scripts/ai/cli/args.js", "scripts/ai/cli/policy.js", "scripts/ai/cli/cli.js"]) {
    const code = inv.stripComments(source(file));
    assert.doesNotMatch(code, /\b(?:validateApprovedGeneratedChangeSetReview|validateApprovedTestDesignReview|executeAppliedChangeSet|writeFileSync|writeFile|appendFile|appendFileSync)\b/, file);
  }
  const apply = inv.staticClosure({ baseDir: REPO_ROOT, available: shipped, entries: ["scripts/ai/cli/apply.js"] });
  assert.equal(apply.reached.has("scripts/ai/test-automation/controlled-execution.js"), false);
});

test("DC-F02 analyzer non-vacuity: it finds the real authorized path from #23F to the change-set gate", () => {
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

// ARCH-S3-m01: forms the first analyzer missed. Each is injected into a
// Stage 3 module through the in-memory overlay and must fail BOTH the full
// repository proof and the shipped-graph proof.
test("DC-F02 drift (ARCH-S3-m01): non-literal, computed, path-built, spawned and string-masked loads of a forbidden module fail the proof", () => {
  const drifts = [
    ["template-literal require", "scripts/ai/cli/generative.js", "\nconst g = require(`../test-automation/generated-change-set-review-record`);\n", /unprovable graph.*non-literal require/],
    ["computed require", "scripts/ai/cli/review-show.js", '\nconst name = "review-record"; const g = require("../test-automation/generated-change-set-" + name);\n', /unprovable graph|names excluded private module/],
    [
      "path-computed require + computed symbol",
      "scripts/ai/cli/run-artifacts.js",
      '\nconst g = require(path.join(__dirname, "..", "test-automation", "change-set-application.js")); g["apply" + "ChangeSet"];\n',
      /unprovable graph.*non-literal require/,
    ],
    ["indirect require", "scripts/ai/cli/generative.js", '\nconst load = require; load("../test-automation/change-set-application");\n', /unprovable graph.*indirect use of require/],
    ["createRequire", "scripts/ai/cli/generative.js", '\nconst m = require("node:module").createRequire(__filename);\n', /unprovable graph.*createRequire/],
    ["dynamic import", "scripts/ai/cli/review-show.js", '\nimport("../test-automation/controlled-execution.js");\n', /unprovable graph.*dynamic import/],
    [
      "spawn by path",
      "scripts/ai/cli/generative.js",
      '\nrequire("node:child_process").spawn(process.execPath, [require("node:path").join(__dirname, "../test-automation/change-set-application.js")]);\n',
      /launches processes outside the known launchers/,
    ],
    [
      "fork by computed path",
      "scripts/ai/cli/run-store.js",
      '\nconst cp = require("child_process"); cp.fork(path.join(__dirname, "..", "test-automation", "regenerate" + "-change-set.js"));\n',
      /launches processes outside the known launchers/,
    ],
    // A literal require of an unshipped module is "reaches ..." in the
    // repository graph and an unresolvable edge in the shipped graph.
    [
      "// inside a string, then a real require",
      "scripts/ai/cli/review-show.js",
      '\nconst url = "a//b"; const apply = require("../test-automation/change-set-application");\n',
      /canonical #23F apply consumer|unresolvable edge.*change-set-application/,
    ],
    [
      "/* inside a string, then a real require",
      "scripts/ai/cli/review-show.js",
      '\nconst glob = "src/*"; const r = require("../test-automation/generated-change-set-review-record"); const end = "*/";\n',
      /reaches gate module|unresolvable edge.*generated-change-set-review-record/,
    ],
    [
      "regex containing a quote, then a real require",
      "scripts/ai/cli/review-show.js",
      "\nconst q = /[\"']/; const g = require(\"../generative-test-design/test-design-review-record\");\n",
      /reaches gate module|unresolvable edge.*test-design-review-record/,
    ],
  ];
  for (const [label, file, injected, expected] of drifts) {
    const overlay = { [file]: `${source(file)}${injected}` };
    for (const available of [repoProduction, shipped]) {
      const violations = gateReachability({ available, entry: inv.EXPECTED_BIN["qa-agent"], overlay });
      assert.ok(
        violations.some((v) => expected.test(v)),
        `${label} (${available === shipped ? "shipped" : "repository"} graph): ${JSON.stringify(violations)}`
      );
    }
  }
});

test("DC-F02 lexer (ARCH-S3-m01): string, template and regex contents never become comments, and comments never hide code", () => {
  const src = [
    'const a = "x//y"; require("./one");',
    "const b = '/* not a comment */'; require('./two');",
    "const c = `t//${'u'}/*v`; require(\"./three\");",
    'const d = /"\\/\\//; require("./four");',
    '// require("./commented-out")',
    '/* require("./also-commented-out") */ require("./five");',
  ].join("\n");
  const scan = inv.scanModule(src);
  assert.deepEqual(scan.relative, ["./one", "./two", "./three", "./four", "./five"]);
  assert.deepEqual(scan.problems, []);
  assert.deepEqual(inv.scanModule('const s = "unterminated;\nrequire("./x");').problems.includes("unterminated string literal"), true, "an unterminated literal fails closed");
});

test("DC-F02 current graph (ARCH-S3-m01): every Stage 3 entrypoint closure is lexically clean, launches processes only through the known launchers and names no excluded module", () => {
  for (const entry of Object.values(STAGE3_ENTRYPOINTS)) {
    const c = inv.staticClosure({ baseDir: REPO_ROOT, available: shipped, entries: [entry] });
    assert.deepEqual(c.problems, [], entry);
    const launchers = [...c.reached].filter((f) => f.endsWith(".js") && inv.scanModule(source(f)).bare.some((s) => PROCESS_LAUNCHER_SPECIFIERS.includes(s)));
    for (const launcher of launchers) assert.ok(ALLOWED_PROCESS_LAUNCHERS.includes(launcher), `${entry}: ${launcher}`);
  }
  const binLaunchers = [...inv.staticClosure({ baseDir: REPO_ROOT, available: shipped, entries: [inv.EXPECTED_BIN["qa-agent"]] }).reached].filter(
    (f) => f.endsWith(".js") && inv.scanModule(source(f)).bare.some((s) => PROCESS_LAUNCHER_SPECIFIERS.includes(s))
  );
  assert.deepEqual(binLaunchers.sort(), [...ALLOWED_PROCESS_LAUNCHERS].sort(), "the launcher allowlist is exact, not stale");
});
