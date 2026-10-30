"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertPathIdentity, asciiFold } = require("./path-identity");
const { crossPlanPathCodes } = require("./run-artifacts");
const { LIMITS } = require("../generation/limits");
const { hostilePathSets } = require("../../../test/helpers/ppi1-path-vectors");
test("PPI-1 refuses every contract hostile identity without repairing it", () => {
  for (const paths of hostilePathSets) assert.throws(() => assertPathIdentity(paths, "cypress"), { code: "PATH_IDENTITY_REFUSED" }, JSON.stringify(paths));
  assertPathIdentity(["cypress/e2e/a.cy.js", "cypress/e2e/b.cy.js", "cypress/-a"], "cypress");
});

// --- OD-265-A1: run-wide target identity across AutomationPlans --------------------
// Each inner array is the plannedChanges paths of one plan, in plan order.
// The "Axx" labels in these test names are the implementation's derived
// labels, not the canonical A01-A22 of the OD-265 Option A decision package
// section 6; the canonical traceability matrix is recorded on PR #266 (C1).

const T = "playwright/tests";
const DUP = ["DUPLICATE_ID"], PREFIX = ["INVARIANT_VIOLATION"], BOTH = ["INVARIANT_VIOLATION", "DUPLICATE_ID"];

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

test("OD-265-A1 A01/A02: exact and ASCII case-fold duplicates across plans are DUPLICATE_ID", () => {
  assert.deepEqual(crossPlanPathCodes([[`${T}/tasks.spec.js`], [`${T}/tasks.spec.js`]]), DUP);
  for (const other of [`${T}/Tasks.spec.js`, `${T}/TASKS.SPEC.JS`, `playwright/Tests/tasks.spec.js`, `Playwright/tests/tasks.spec.js`]) {
    assert.deepEqual(crossPlanPathCodes([[`${T}/tasks.spec.js`], [other]]), DUP, other);
  }
  // Within one plan too (PPI-1 already refuses this per plan; the rule agrees).
  assert.deepEqual(crossPlanPathCodes([[`${T}/a.spec.js`, `${T}/A.spec.js`]]), DUP);
});

test("OD-265-A1 A03-A05: operation does not matter - CREATE/CREATE, CREATE/MODIFY, MODIFY/CREATE and MODIFY/MODIFY all collide", () => {
  // The rule receives paths only, so the operation cannot exempt a pair; the
  // operation-level combinations are exercised end to end in generative.test.js.
  const plans = (a, b) => [[{ path: `${T}/shared.spec.js`, operation: a }], [{ path: `${T}/shared.spec.js`, operation: b }]].map((p) => p.map((c) => c.path));
  for (const [a, b] of [["CREATE", "CREATE"], ["CREATE", "MODIFY"], ["MODIFY", "CREATE"], ["MODIFY", "MODIFY"]]) assert.deepEqual(crossPlanPathCodes(plans(a, b)), DUP, `${a}/${b}`);
});

test("OD-265-A1 A06/A07: segment-boundary file/directory prefixes collide in both directions, also deep and case-folded", () => {
  for (const [first, second] of [
    [`${T}/foo`, `${T}/foo/a.spec.js`],
    [`${T}/foo/a.spec.js`, `${T}/foo`],
    [`${T}/foo`, `${T}/foo/deep/er/a.spec.js`],
    [`${T}/foo/deep/er/a.spec.js`, `${T}/foo`],
    ["playwright/Tests", `${T}/a.spec.js`],
    ["playwright/A/b", "playwright/a/B/c"],
    // The decision package's own example: a file-shaped name as the ancestor.
    [`${T}/a.spec.js`, `${T}/a.spec.js/child`],
    [`${T}/a.spec.js/child`, `${T}/a.spec.js`],
  ]) {
    assert.deepEqual(crossPlanPathCodes([[first], [second]]), PREFIX, `${first} | ${second}`);
    assert.deepEqual(crossPlanPathCodes([[first, second]]), PREFIX, `same plan: ${first} | ${second}`);
  }
});

test("OD-265-A1 A08: an entry that is both a duplicate and a prefix reports INVARIANT_VIOLATION then DUPLICATE_ID", () => {
  for (const lists of [
    [[`${T}/x`], [`${T}/x/a.spec.js`], [`${T}/x`]],
    [[`${T}/x/a.spec.js`], [`${T}/x`], [`${T}/X`]],
    [[`${T}/x`, `${T}/x/a.spec.js`], [`${T}/x/a.spec.js`]],
  ]) assert.deepEqual(crossPlanPathCodes(lists), BOTH, JSON.stringify(lists));
});

test("OD-265-A1 A09: distinct files sharing a parent, and string (non-segment) prefixes, do not collide", () => {
  assert.deepEqual(crossPlanPathCodes([[`${T}/a.spec.js`], [`${T}/b.spec.js`], [`${T}/nested/c.spec.js`], [`${T}/nested/d.spec.js`]]), []);
  assert.deepEqual(crossPlanPathCodes([[`${T}/tasks.spec.js`], [`${T}/tasks.spec.js.snap`], [`${T}/tasks`], [`${T}/tasks-x/a.js`], [`${T}/task/a.js`]]), []);
  assert.deepEqual(crossPlanPathCodes([]), []);
  assert.deepEqual(crossPlanPathCodes([[`${T}/a.spec.js`]]), []);
});

test("OD-265-A1 A10: the code list is identical under every reordering of plans and entries", () => {
  const sets = [
    [[`${T}/x`], [`${T}/x/a.spec.js`], [`${T}/X`], [`${T}/y.spec.js`]],
    [[`${T}/tasks.spec.js`], [`${T}/b.spec.js`], [`${T}/Tasks.spec.js`], [`${T}/c.spec.js`]],
    [[`${T}/d`], [`${T}/d/e/f.js`], [`${T}/g.js`], [`${T}/h.js`]],
  ];
  for (const lists of sets) {
    const expected = crossPlanPathCodes(lists);
    assert.ok(expected.length > 0);
    for (const order of permutations(lists)) assert.deepEqual(crossPlanPathCodes(order), expected, JSON.stringify(order));
    assert.deepEqual(crossPlanPathCodes([lists.flat().reverse()]), expected);
  }
});

test("OD-265-A1 A10: the identity key is exactly the PPI-1 key (asciiFold parity over every ASCII code point)", () => {
  const alphabet = Array.from({ length: 128 }, (_, c) => String.fromCharCode(c)).filter((ch) => /[A-Za-z0-9._-]/.test(ch));
  assert.equal(alphabet.length, 65);
  for (const a of alphabet) for (const b of alphabet) {
    assert.deepEqual(crossPlanPathCodes([[`${T}/k${a}.js`], [`${T}/k${b}.js`]]), asciiFold(a) === asciiFold(b) ? DUP : [], `${a}|${b}`);
  }
  // Non-ASCII is outside the domain: never folded together, never registered.
  assert.deepEqual(crossPlanPathCodes([[`${T}/É.js`], [`${T}/é.js`]]), ["INVALID_PATH"]);
});

test("OD-265-A1 A21: adversarial entries never throw, are never registered and never repaired", () => {
  const hostile = [null, undefined, 7, {}, [], `${T}/a b.js`, `./${T}/a.js`, `${T}/./a.js`, `${T}//a.js`, `/${T}/a.js`, `${T}/../a.js`, `${T}\\a.js`, `${T}/a.js/`, "x".repeat(301), `${T}/\u202egnp.js`];
  for (const h of hostile) {
    assert.deepEqual(crossPlanPathCodes([[h]]), ["INVALID_PATH"], String(h));
    // An alias form is never silently distinct from - nor merged with - its canonical twin.
    assert.deepEqual(crossPlanPathCodes([[`${T}/a.js`], [h]]), ["INVALID_PATH"], String(h));
  }
  // Prototype-shaped segment names are ordinary keys.
  assert.deepEqual(crossPlanPathCodes([[`${T}/__proto__/a.js`], [`${T}/constructor`], [`${T}/toString.js`], [`${T}/hasOwnProperty/x.js`]]), []);
  assert.deepEqual(crossPlanPathCodes([[`${T}/__proto__`], [`${T}/__proto__/a.js`]]), PREFIX);
  assert.deepEqual(crossPlanPathCodes([[`${T}/constructor`], [`${T}/Constructor`]]), DUP);
  assert.equal({}.file, undefined, "no prototype pollution");
});

test("OD-265-A1 A21: maximum-size input (200 plans x 100 changes x 300 characters) completes and stays exact", () => {
  // The defined bounds: one plan per AUTOMATE candidate (at most one per test
  // case), MAX_PLANNED_CHANGES per plan, and a path is short text.
  assert.deepEqual([LIMITS.MAX_TEST_CASES, LIMITS.MAX_PLANNED_CHANGES, LIMITS.SHORT_TEXT_MAX_LENGTH], [200, 100, 300]);
  const seg = "s".repeat(90);
  const at = (i, j) => { const head = `${T}/${seg}/${seg}/${String(i).padStart(3, "0")}-${String(j).padStart(3, "0")}-`; return head + "z".repeat(300 - head.length); };
  const lists = Array.from({ length: 200 }, (_, i) => Array.from({ length: 100 }, (_, j) => at(i, j)));
  assert.equal(lists[0][0].length, 300);
  const started = Date.now();
  assert.deepEqual(crossPlanPathCodes(lists), []);
  lists[199][99] = lists[0][0].toUpperCase().replace("PLAYWRIGHT", "playwright");
  assert.deepEqual(crossPlanPathCodes(lists), DUP);
  // Coarse guard against a super-linear regression only (~0.2 s observed for
  // both passes); not a performance benchmark.
  assert.ok(Date.now() - started < 5000);
});

test("OD-265-A1 A19/A20: TPR Run A and Run B target topologies are refused with DUPLICATE_ID only", () => {
  const runA = ["tasks", "tasks-add-and-counter", "tasks", "task-counter-completion"].map((n) => [`${T}/${n}.spec.js`]);
  const runB = ["tasks", "tasks", "empty-task-validation", "empty-task-validation", "task-completion-counter", "tasks"].map((n) => [`${T}/${n}.spec.js`]);
  assert.deepEqual(crossPlanPathCodes(runA), DUP);
  assert.deepEqual(crossPlanPathCodes(runB), DUP);
  // Removing every duplicate leaves the remaining topology accepted (no repair is done by the rule).
  assert.deepEqual(crossPlanPathCodes([runA[0], runA[1], runA[3]]), []);
});

// --- OD-265-B1: the generator's advisory predicates vs the authoritative A1 rule ----------
// U*/C* in titles are trace labels of the OD-265-D1-C1 §9 matrix. The A1 rule
// (crossPlanPathCodes, assertPathIdentity) is the oracle; it is not modified.

const fs = require("node:fs");
const path = require("node:path");
const { findPlanPathConflicts, generateAutomationPlan } = require("../test-automation/automation-plan-generator");

const ORDER = ["INVARIANT_VIOLATION", "DUPLICATE_ID"];
const advisoryCodes = (lists) => {
  const found = new Set(findPlanPathConflicts(lists).map((f) => f.code));
  return ORDER.filter((code) => found.has(code));
};

test("OD-265-B1 U13/U15/U18: exhaustive differential parity - the advisory code set equals crossPlanPathCodes, and every conflicting pair is reported once at its later entry (dual condition: INVARIANT_VIOLATION then DUPLICATE_ID)", () => {
  const segs = ["a", "A", "b"];
  const keys = [...segs.map((s) => `${T}/${s}`), ...segs.flatMap((s) => segs.map((u) => `${T}/${s}/${u}`))];
  assert.equal(keys.length, 12);
  let sequences = [[]], checked = 0, dual = 0;
  for (let length = 1; length <= 4; length++) {
    sequences = sequences.flatMap((seq) => keys.map((k) => [...seq, k]));
    for (const seq of sequences) {
      for (let split = 0; split <= seq.length; split++) {
        const lists = [seq.slice(0, split), seq.slice(split)];
        assert.deepEqual(advisoryCodes(lists), crossPlanPathCodes(lists), JSON.stringify(lists));
        const findings = findPlanPathConflicts(lists);
        const located = findings.map((f) => `${f.list === 0 ? f.index : split + f.index}:${f.code}`);
        const expected = [];
        seq.forEach((p, j) => {
          const fj = asciiFold(p);
          const earlier = seq.slice(0, j).map(asciiFold);
          if (earlier.some((fi) => fj.startsWith(`${fi}/`) || fi.startsWith(`${fj}/`))) expected.push(`${j}:INVARIANT_VIOLATION`);
          if (earlier.includes(fj)) expected.push(`${j}:DUPLICATE_ID`);
        });
        assert.deepEqual(located, expected, JSON.stringify(lists));
        if (expected.some((e, i) => e.endsWith("INVARIANT_VIOLATION") && expected[i + 1] === `${e.split(":")[0]}:DUPLICATE_ID`)) dual += 1;
        checked += 1;
      }
    }
  }
  assert.ok(checked > 100000, String(checked));
  assert.ok(dual > 0, "dual-condition entries were exercised");
});

test("OD-265-B1 differential parity on the A1 fixtures: TPR Run A/B, MODIFY/MODIFY-shaped repeats, prototype-shaped segments, reorderings and the 200 x 100 x 300 maximum", () => {
  const runA = ["tasks", "tasks-add-and-counter", "tasks", "task-counter-completion"].map((n) => [`${T}/${n}.spec.js`]);
  const runB = ["tasks", "tasks", "empty-task-validation", "empty-task-validation", "task-completion-counter", "tasks"].map((n) => [`${T}/${n}.spec.js`]);
  const fixtures = [
    runA,
    runB,
    [[`${T}/x`], [`${T}/x/a.spec.js`], [`${T}/X`], [`${T}/y.spec.js`]],
    [[`${T}/__proto__/a.js`], [`${T}/constructor`], [`${T}/toString.js`], [`${T}/hasOwnProperty/x.js`]],
    [[`${T}/__proto__`], [`${T}/__proto__/a.js`]],
    [[`${T}/constructor`], [`${T}/Constructor`]],
    [[`${T}/a.spec.js`], [`${T}/a.spec.js.snap`], [`${T}/b.spec.js`]],
  ];
  for (const lists of fixtures) {
    for (const order of permutations(lists)) assert.deepEqual(advisoryCodes(order), crossPlanPathCodes(order), JSON.stringify(order));
  }
  // Run A: plan 3 alone repeats plan 1. Run B: plans 2, 4 and 6 repeat earlier ones.
  assert.deepEqual(findPlanPathConflicts(runA), [{ list: 2, index: 0, code: "DUPLICATE_ID" }]);
  assert.deepEqual(findPlanPathConflicts(runB).map((f) => f.list), [1, 3, 5]);
  const seg = "s".repeat(90);
  const at = (i, j) => { const head = `${T}/${seg}/${seg}/${String(i).padStart(3, "0")}-${String(j).padStart(3, "0")}-`; return head + "z".repeat(300 - head.length); };
  const lists = Array.from({ length: 200 }, (_, i) => Array.from({ length: 100 }, (_, j) => at(i, j)));
  const started = Date.now();
  assert.deepEqual(findPlanPathConflicts(lists), []);
  lists[199][99] = lists[0][0].toUpperCase().replace("PLAYWRIGHT", "playwright");
  assert.deepEqual(findPlanPathConflicts(lists), [{ list: 199, index: 99, code: "DUPLICATE_ID" }]);
  assert.deepEqual(advisoryCodes(lists), crossPlanPathCodes(lists));
  assert.ok(Date.now() - started < 5000, "coarse super-linear regression guard only");
  assert.equal({}.file, undefined, "no prototype pollution");
});

function b1Candidate() {
  return { schemaVersion: 1, kind: "AutomationCandidate", id: "cand-1", projectId: "proj-1", testCaseModelId: "tcm-1", testCaseId: "tc-1", decision: "AUTOMATE", rationale: "Covered by cypress.", evidenceRefs: [], targetFrameworks: ["cypress"] };
}

function b1Context() {
  return {
    projectId: "proj-1",
    framework: "cypress",
    guidance: { displayName: "Test Project", knownProjectConstraints: [] },
    packageScripts: [{ name: "test:e2e", command: "cypress run" }],
    repositoryEvidence: [{ evidenceRef: { id: "repo-evidence-0001", kind: "repository", location: "cypress.config.js" }, role: "framework_config", content: "module.exports = {};" }],
  };
}

test("OD-265-B1 PPI-1 parity: the generator accepts a single reserved path exactly when the canonical assertPathIdentity accepts it", async () => {
  const vectors = [
    ...hostilePathSets.flat(),
    "cypress/a", "cypress/-a", "cypress/e2e/a.cy.js", "cypress/E2E/A.CY.JS", "cypress/e2e/__proto__/x.cy.js", "cypress/e2e/constructor",
    "cypress/e2e/con.cy.js", "cypress/e2e/con1.cy.js", "cypress/e2e/a..b.cy.js", "cypress/e2e/node_modules.x/a", "cypress/e2e/.envrc",
    "cypress/.env", "cypress/e2e/x.env", `cypress/${"a".repeat(100)}`, `cypress/${"a".repeat(101)}`, `cypress/${"a".repeat(90)}/${"b".repeat(90)}/${"c".repeat(90)}/${"d".repeat(19)}`,
    `cypress/${"a".repeat(90)}/${"b".repeat(90)}/${"c".repeat(90)}/${"d".repeat(20)}`, "cypress/e2e/Package.Json", "cypress/e2e/secrets", "cypress/e2e/Credentials/a",
    "playwright/tests/a.spec.js", "cypress", "cypress/", "", 7, null,
  ];
  const plan = { schemaVersion: 1, kind: "AutomationPlan", id: "plan-1", projectId: "proj-1", automationCandidateId: "cand-1", framework: "cypress", plannedChanges: [{ path: "cypress/zz-own/own.cy.js", operation: "CREATE", purpose: "x" }] };
  let accepted = 0, refused = 0;
  for (const p of vectors) {
    let canonical = true;
    try {
      assertPathIdentity([p], "cypress");
    } catch (error) {
      assert.equal(error.code, "PATH_IDENTITY_REFUSED");
      canonical = false;
    }
    const scope = { candidateId: "cand-1", testCase: { id: "tc-1", title: "T", objective: "O" }, requirements: [{ id: "req-1", text: "R" }] };
    const r = await generateAutomationPlan({ automationCandidate: b1Candidate(), repositoryContext: b1Context(), provider: { analyze: async () => JSON.stringify(plan) }, coordination: { planScope: scope, reservedPaths: [p] } });
    assert.equal(r.providerAttempts > 0, canonical, JSON.stringify(p));
    if (canonical) accepted += 1;
    else refused += 1;
  }
  assert.ok(accepted >= 10 && refused >= 80, `${accepted}/${refused}`);
});

test("OD-265-B1 C7: no production module under test-automation, generation, generative-test-design or providers requires a cli/ module", () => {
  const root = path.join(__dirname, "..");
  let scanned = 0;
  for (const dir of ["test-automation", "generation", "generative-test-design", "providers"]) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (!name.endsWith(".js") || name.endsWith(".test.js")) continue;
      const source = fs.readFileSync(path.join(root, dir, name), "utf8");
      assert.equal(/require\(\s*["'`][^"'`]*\/cli\//.test(source), false, `${dir}/${name}`);
      scanned += 1;
    }
  }
  assert.ok(scanned > 20);
});

test("OD-265-B1 C9: findPlanPathConflicts and buildPlanScopes are internal - no package exports entry or root barrel exposes them", () => {
  const repo = path.join(__dirname, "..", "..", "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  const targets = Object.values(pkg.exports).filter((t) => t.endsWith(".js"));
  assert.ok(targets.length >= 4);
  for (const target of targets) {
    const mod = require(path.join(repo, target));
    for (const name of ["findPlanPathConflicts", "buildPlanScopes", "crossPlanPathCodes", "generateAutomationPlan"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(mod, name), false, `${target} exposes ${name}`);
    }
  }
});
