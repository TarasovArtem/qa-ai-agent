/**
 * AISEC-7 per-file execution ledger (SEC-02).
 *
 * Harness-internal only. Each AISEC-7 test file creates exactly one ledger
 * for itself. The ledger is module-local state, so files never share it, and
 * it works the same with node:test process isolation.
 *
 * It records three different things and never confuses them:
 *   - a test COMPLETED      : its body returned without throwing;
 *   - a case CONFIRMED      : registry confirmCase() accepted the observed
 *                             outcome (an attempt or a started test is not
 *                             a confirmation);
 *   - a target row EVALUATED: targetOutcome() derived its blocked class
 *                             (never counted as current-behavior evidence).
 *
 * A file-level `after` hook publishes the ledger as a structured diagnostic
 * for the outer verifier, then FAILS the file unless every test, case,
 * control and own-test target row the execution manifest requires for this
 * file was reached, and no test-selection option was configured. This
 * catches name/skip/only filtering inside a still-running file, a case that
 * returns before confirmCase(), and options-based skips. It cannot catch a
 * file that never runs or a process that exits before its hooks; the outer
 * verifier covers those.
 */

"use strict";

const nodeTest = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const fx = require("./fixtures");
const registry = require("./registry");
const manifest = require("./evidence-manifest");

const INTEGRITY = "AISEC-7 evidence integrity (SEC-02)";
const LEDGER_DIAGNOSTIC = "AISEC7_LEDGER ";

function createEvidenceLedger(filename) {
  const file = path.basename(filename);
  const expected = manifest.expectedTests(file);
  const cases = manifest.requiredConfirmations(file);
  const controls = manifest.requiredControls(file);
  const targets = manifest.ownTestTargets(file);

  const registered = new Set();
  const completed = new Set();
  const confirmed = new Set();
  const controlled = new Set();
  const evaluated = new Set();

  // Wraps the body of one mandatory test. The file itself calls node:test
  // with the result, because node:test attributes a result to the file that
  // called test(). Only (name, fn) is accepted: an options object in the fn
  // position (skip/todo/only/timeout) throws at registration.
  function track(name, fn, ...rest) {
    assert.equal(typeof name, "string", `${INTEGRITY}: ${file}: test name must be a string`);
    assert.ok(typeof fn === "function" && rest.length === 0, `${INTEGRITY}: ${file}: "${name}" passes test options; mandatory evidence takes none`);
    const key = manifest.testKey(name);
    assert.ok(expected.includes(key), `${INTEGRITY}: ${file}: "${name}" is not in the reviewed execution manifest`);
    assert.ok(!registered.has(key), `${INTEGRITY}: ${file}: "${key}" is registered twice`);
    registered.add(key);
    return async (t) => {
      await fn(t);
      completed.add(key);
    };
  }

  // Records a case only after the registry accepted its observed outcome.
  function confirmCase(id, controlHeld) {
    assert.ok(cases.includes(id), `${INTEGRITY}: ${id} is not a current-behavior case of ${file}`);
    const outcome = registry.confirmCase(id, controlHeld);
    confirmed.add(id);
    return outcome;
  }

  function confirmControl(id) {
    assert.ok(controls.includes(id), `${INTEGRITY}: ${id} is not a declared control of ${file}`);
    controlled.add(id);
  }

  function targetOutcome(id) {
    assert.ok(targets.includes(id), `${INTEGRITY}: ${id} is not an own-test target row of ${file}`);
    const outcome = registry.targetOutcome(id);
    evaluated.add(id);
    return outcome;
  }

  nodeTest.after((t) => {
    // This hook is registered before the file's own cleanup hook, and a failing
    // hook stops later ones, so temp roots are released before judging the run.
    fx.cleanupRoots();
    const filters = manifest.selectionFilters({ execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS });
    const sorted = (set) => [...set].sort();
    t.diagnostic(LEDGER_DIAGNOSTIC + JSON.stringify({ file, filters, tests: sorted(completed), confirmed: sorted(confirmed), controls: sorted(controlled), targets: sorted(evaluated) }));
    const gaps = {
      "test-selection options": filters,
      "tests not completed": expected.filter((k) => !completed.has(k)),
      "cases not confirmed": cases.filter((id) => !confirmed.has(id)),
      "controls not confirmed": controls.filter((id) => !controlled.has(id)),
      "target rows not evaluated": targets.filter((id) => !evaluated.has(id)),
    };
    const problems = Object.entries(gaps).filter(([, list]) => list.length > 0).map(([label, list]) => `${label}: ${list.join(", ")}`);
    assert.deepEqual(problems, [], `${INTEGRITY}: ${file}: mandatory evidence did not execute in this run - ${problems.join("; ")}`);
  });

  return { file, track, confirmCase, confirmControl, targetOutcome };
}

module.exports = { createEvidenceLedger, INTEGRITY, LEDGER_DIAGNOSTIC };
