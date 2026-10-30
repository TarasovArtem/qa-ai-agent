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
