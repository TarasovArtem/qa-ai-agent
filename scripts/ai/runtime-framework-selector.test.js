"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  DEFAULT_FRAMEWORK,
  ADAPTERS,
  RuntimeFrameworkError,
  resolveFrameworkId,
  selectRuntimeAdapter,
} = require("./runtime-framework-selector");
const cypressAdapter = require("./adapters/cypress-adapter");
const playwrightAdapter = require("./adapters/playwright-adapter");

const ROOT = path.resolve(__dirname, "..", "..");

test("DEFAULT_FRAMEWORK is exactly 'cypress'", () => {
  assert.equal(DEFAULT_FRAMEWORK, "cypress");
});

test("ADAPTERS is a closed, static map of exactly cypress and playwright", () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ["cypress", "playwright"]);
  assert.equal(ADAPTERS.cypress, cypressAdapter);
  assert.equal(ADAPTERS.playwright, playwrightAdapter);
  assert.ok(Object.isFrozen(ADAPTERS));
});

// --- SEL_1: selector absent -----------------------------------------------

test("SEL_1 resolveFrameworkId/selectRuntimeAdapter: absent selector resolves to Cypress", () => {
  assert.equal(resolveFrameworkId(undefined), "cypress");
  assert.equal(resolveFrameworkId(null), "cypress");
  assert.equal(selectRuntimeAdapter(undefined), cypressAdapter);
});

// --- SEL_2/SEL_3: empty/whitespace selector -------------------------------

test("SEL_2 empty selector resolves to Cypress", () => {
  assert.equal(resolveFrameworkId(""), "cypress");
  assert.equal(selectRuntimeAdapter("").id, "cypress");
});

test("SEL_3 whitespace-only selector resolves to Cypress", () => {
  assert.equal(resolveFrameworkId("   "), "cypress");
  assert.equal(resolveFrameworkId("\t\n"), "cypress");
  assert.equal(selectRuntimeAdapter("   ").id, "cypress");
});

// --- SEL_4: explicit Cypress -----------------------------------------------

test("SEL_4 explicit Cypress selects the Cypress adapter, case/whitespace normalized", () => {
  assert.equal(resolveFrameworkId("cypress"), "cypress");
  assert.equal(resolveFrameworkId("CYPRESS"), "cypress");
  assert.equal(resolveFrameworkId(" Cypress "), "cypress");
  assert.equal(selectRuntimeAdapter("cypress"), cypressAdapter);
  assert.equal(selectRuntimeAdapter("CYPRESS"), cypressAdapter);
});

// --- SEL_5: explicit Playwright ---------------------------------------------

test("SEL_5 explicit Playwright selects the Playwright adapter, case/whitespace normalized", () => {
  assert.equal(resolveFrameworkId("playwright"), "playwright");
  assert.equal(resolveFrameworkId("PLAYWRIGHT"), "playwright");
  assert.equal(resolveFrameworkId(" Playwright "), "playwright");
  assert.equal(selectRuntimeAdapter("playwright"), playwrightAdapter);
  assert.equal(selectRuntimeAdapter("PLAYWRIGHT"), playwrightAdapter);
});

// --- SEL_6/7/8: unknown fails closed, no fallback ---------------------------

test("SEL_6 unknown explicit framework fails closed with a RuntimeFrameworkError", () => {
  assert.throws(() => resolveFrameworkId("jest"), RuntimeFrameworkError);
  assert.throws(() => resolveFrameworkId("selenium"), RuntimeFrameworkError);
  assert.throws(() => resolveFrameworkId("unknown"), RuntimeFrameworkError);
  assert.throws(() => selectRuntimeAdapter("jest"), RuntimeFrameworkError);
});

test("SEL_7 unknown framework never silently falls back to Cypress", () => {
  let adapter;
  try {
    adapter = selectRuntimeAdapter("jest");
    assert.fail("expected selectRuntimeAdapter to throw for an unknown framework");
  } catch (err) {
    assert.ok(err instanceof RuntimeFrameworkError);
  }
  assert.equal(adapter, undefined);
});

test("SEL_8 unknown framework never silently falls back to Playwright", () => {
  assert.throws(() => selectRuntimeAdapter("selenium"), (err) => {
    return err instanceof RuntimeFrameworkError && err.message !== playwrightAdapter.id;
  });
});

test("unknown framework error message names the allowed values and stays deterministic/bounded", () => {
  try {
    resolveFrameworkId("jest");
    assert.fail("expected a throw");
  } catch (err) {
    assert.equal(err.message, "Unsupported QA_FRAMEWORK value. Allowed values: cypress, playwright.");
    assert.ok(!err.message.includes("jest"));
  }
});

// --- SEL_9: installed @playwright/test package does not auto-select --------

test("SEL_9 an installed @playwright/test package does not auto-select Playwright", () => {
  // @playwright/test IS genuinely installed in this repository's own
  // node_modules (Roadmap #21B) at the moment this test runs - proving the
  // default is still Cypress despite that is the actual regression guard,
  // not merely a theoretical claim.
  assert.doesNotThrow(() => require.resolve("@playwright/test"));
  assert.equal(selectRuntimeAdapter(undefined), cypressAdapter);
  assert.equal(resolveFrameworkId(undefined), "cypress");
});

// --- SEL_10: Playwright fixture/report file presence does not auto-select --

test("SEL_10 a real, existing Playwright report file does not auto-select Playwright", (t) => {
  const tmpDir = fs.mkdtempSync(path.join(ROOT, "reports", "ai", "runtime-selector-sel10-"));
  t.after(() => fs.rmSync(tmpDir, { recursive: true, force: true }));
  const reportFile = path.join(tmpDir, "report.json");
  fs.writeFileSync(reportFile, JSON.stringify({ config: {}, suites: [], errors: [], stats: {} }));

  // The mere existence of a Playwright-shaped report file on disk plays no
  // role at all in selectRuntimeAdapter()/resolveFrameworkId() - neither
  // function ever touches the filesystem - so the default stays Cypress
  // regardless of what report files happen to exist.
  assert.equal(selectRuntimeAdapter(undefined), cypressAdapter);
  assert.ok(fs.existsSync(reportFile), "sanity: the Playwright report file genuinely exists on disk");
});

// --- SEL_11: framework identity comes from adapter.id, never raw text ------

test("SEL_11 metadata/framework identity comes from the selected adapter's own id, never the raw selector text", () => {
  // Mixed-case/whitespace input proves this: if identity were sourced from
  // the raw selector text rather than adapter.id, this would surface as
  // "PLAYWRIGHT " or " PLAYWRIGHT " rather than the canonical "playwright".
  const adapter = selectRuntimeAdapter(" PLAYWRIGHT ");
  assert.equal(adapter.id, "playwright");
  assert.notEqual(adapter.id, " PLAYWRIGHT ");
  assert.notEqual(adapter.id, "PLAYWRIGHT");

  const cyAdapter = selectRuntimeAdapter("CYPRESS");
  assert.equal(cyAdapter.id, "cypress");
});

// --- SEL_12: programmatic DI is authoritative over QA_FRAMEWORK ------------
//
// The full end-to-end proof (main({adapter}) + real reports/ai/context.json)
// lives in collect-context.test.js instead of here - that file is already
// the sole owner of real-path main() invocations (see its own module
// comment), and adding a second file that also writes/reads that exact
// shared path here would reintroduce the cross-file race it was
// specifically designed to avoid. This file instead proves the narrower,
// selector-local half of the same invariant: selectRuntimeAdapter() is
// never consulted by main() at all, so nothing here can override an
// explicitly injected adapter - main()'s own `adapter = cypressAdapter`
// default parameter (collect-context.js) is untouched by this module.

test("SEL_12 selectRuntimeAdapter() is never invoked by main() - the CLI bootstrap is the only caller, so DI stays authoritative", () => {
  const collectContextSource = fs.readFileSync(path.join(__dirname, "collect-context.js"), "utf8");
  const mainFnSource = collectContextSource.slice(
    collectContextSource.indexOf("function main("),
    collectContextSource.indexOf("// Roadmap #21E:")
  );
  assert.ok(!mainFnSource.includes("selectRuntimeAdapter"), "main() itself must never call selectRuntimeAdapter()");
  assert.ok(!mainFnSource.includes("QA_FRAMEWORK"), "main() itself must never read QA_FRAMEWORK");
  assert.ok(mainFnSource.includes("adapter = cypressAdapter"), "main()'s own DI default parameter must remain untouched");
});

// --- SEL_13: valid Playwright selection with no report preserves safe behavior --

test("SEL_13 explicit Playwright selection with no production report preserves existing safe adapter behavior - no fallback, no throw", () => {
  const adapter = selectRuntimeAdapter("playwright");
  assert.equal(adapter, playwrightAdapter);

  const missingReportFile = path.join(os.tmpdir(), "runtime-selector-sel13-does-not-exist", "report.json");
  const result = adapter.collect({ reportFile: missingReportFile });

  assert.deepEqual(result.testResults, { found: false });
  assert.deepEqual(result.failedTests, []);
  assert.ok(result.warnings.some((w) => w.includes("No Playwright JSON report found")));
});

// --- SEL_14: one adapter per invocation -------------------------------------

test("SEL_14 selectRuntimeAdapter resolves exactly one adapter object per call, never both", () => {
  const adapter = selectRuntimeAdapter("cypress");
  assert.equal(typeof adapter, "object");
  assert.notEqual(adapter, undefined);
  assert.ok(!Array.isArray(adapter));
  // The resolved adapter is exactly one of the two known adapters, never a
  // combined/aggregate object.
  assert.ok(adapter === cypressAdapter || adapter === playwrightAdapter);
});

// --- SEL_15: unknown selector error never leaks a marker --------------------

test("SEL_15 an unsupported selector value never appears in the thrown error, even a marker crafted to be conspicuous", () => {
  const MARKER = "UNTRUSTED_SELECTOR_MARKER_21E";
  try {
    resolveFrameworkId(MARKER);
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(!err.message.includes(MARKER), "the raw untrusted selector value must never appear in the error message");
    assert.ok(!err.stack.includes(MARKER), "the raw untrusted selector value must never appear in the stack trace");
  }
});

// --- D21E-2: non-string/non-absent selectors fail closed, never coerced ---
//
// Before this hardening, resolveFrameworkId() called `String(rawValue).trim()`
// unconditionally - so `[]` silently became `""` (the Cypress default, as
// if no selector had been given at all) and `["playwright"]` silently
// became `"playwright"` (a real adapter selection driven purely by
// Array.prototype's own toString(), never a string the caller actually
// supplied). Every non-string, non-absent input below must now fail
// closed with RuntimeFrameworkError, with no adapter selected and no
// object content echoed into the error.

test("D21E-2 an empty array selector fails closed - never silently the Cypress default", () => {
  assert.throws(() => resolveFrameworkId([]), RuntimeFrameworkError);
  assert.throws(() => selectRuntimeAdapter([]), RuntimeFrameworkError);
});

test("D21E-2 an array containing a supported framework name still fails closed - never an accidental selection", () => {
  assert.throws(() => resolveFrameworkId(["playwright"]), RuntimeFrameworkError);
  assert.throws(() => selectRuntimeAdapter(["playwright"]), RuntimeFrameworkError);
});

test("D21E-2 a plain object selector fails closed", () => {
  assert.throws(() => resolveFrameworkId({}), RuntimeFrameworkError);
});

test("D21E-2 an object with a crafted toString() fails closed without ever invoking it to pick an adapter", () => {
  const crafted = { toString: () => "playwright" };
  assert.throws(() => resolveFrameworkId(crafted), RuntimeFrameworkError);
  assert.throws(() => selectRuntimeAdapter(crafted), RuntimeFrameworkError);
});

test("D21E-2 numeric selectors fail closed", () => {
  assert.throws(() => resolveFrameworkId(42), RuntimeFrameworkError);
  assert.throws(() => resolveFrameworkId(0), RuntimeFrameworkError);
});

test("D21E-2 boolean selectors fail closed", () => {
  assert.throws(() => resolveFrameworkId(true), RuntimeFrameworkError);
  assert.throws(() => resolveFrameworkId(false), RuntimeFrameworkError);
});

test("D21E-2 a Symbol selector fails closed", () => {
  assert.throws(() => resolveFrameworkId(Symbol("playwright")), RuntimeFrameworkError);
});

test("D21E-2 a function selector fails closed", () => {
  assert.throws(() => resolveFrameworkId(function () {}), RuntimeFrameworkError);
});

test("D21E-2 a thenable/Promise-like selector fails closed, never awaited or treated as a string", () => {
  const thenable = { then: () => {} };
  assert.throws(() => resolveFrameworkId(thenable), RuntimeFrameworkError);
});

test("D21E-2 the rejected value's own content is never echoed into the error message", () => {
  const crafted = { toString: () => "SENSITIVE_MARKER_D21E2" };
  try {
    resolveFrameworkId(crafted);
    assert.fail("expected a throw");
  } catch (err) {
    assert.ok(err instanceof RuntimeFrameworkError);
    assert.ok(!err.message.includes("SENSITIVE_MARKER_D21E2"));
    assert.ok(err.message.includes("string"));
  }
});

test("D21E-2 null remains the documented absent case and still resolves to the Cypress default (unchanged)", () => {
  assert.equal(resolveFrameworkId(null), "cypress");
  assert.equal(selectRuntimeAdapter(null), cypressAdapter);
});

test("D21E-2 existing string-selector regression is entirely unchanged", () => {
  assert.equal(resolveFrameworkId(undefined), "cypress");
  assert.equal(resolveFrameworkId(""), "cypress");
  assert.equal(resolveFrameworkId("   "), "cypress");
  assert.equal(resolveFrameworkId("cypress"), "cypress");
  assert.equal(resolveFrameworkId("CYPRESS"), "cypress");
  assert.equal(resolveFrameworkId(" playwright "), "playwright");
  assert.throws(() => resolveFrameworkId("jest"), RuntimeFrameworkError);
});

// --- CLI process-level proof (Phase 10/24): real non-zero exit -------------

test("CLI: `node collect-context.js` with an unsupported QA_FRAMEWORK exits non-zero, bounded error, marker absent from stderr", () => {
  // Deliberately does not inspect reports/ai/context.json here (even to
  // assert it is untouched) - collect-context.test.js is this repository's
  // sole owner of real-path main() invocations against that exact shared
  // path (see its own module comment), and test files may run
  // concurrently, so reading that path from a second file risks a false
  // flake from an unrelated, legitimately-concurrent write. The error
  // being thrown before main() is ever called (see collect-context.js's
  // CLI bootstrap block, and the source-level proof in SEL_12 above) is
  // sufficient proof that this invocation itself never wrote anything.
  const MARKER = "UNTRUSTED_SELECTOR_MARKER_21E";

  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "ai", "collect-context.js")], {
    cwd: ROOT,
    env: { ...process.env, QA_FRAMEWORK: MARKER },
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0, "an unsupported QA_FRAMEWORK must exit non-zero");
  assert.ok(result.stderr.includes("Unsupported QA_FRAMEWORK value"), "stderr must name the configuration error");
  assert.ok(result.stderr.includes("cypress") && result.stderr.includes("playwright"), "stderr must list the allowed values");
  assert.ok(!result.stderr.includes(MARKER), "the raw untrusted selector value must never appear in stderr");
});
