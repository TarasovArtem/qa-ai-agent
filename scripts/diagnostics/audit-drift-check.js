#!/usr/bin/env node
/**
 * Supply-chain audit drift check (CRW1-D / B-3).
 *
 * Wraps `npm audit --json` with explicit three-way semantics npm audit's
 * own exit code does not provide: a genuine new high/critical-severity
 * finding beyond this file's documented, reachability-analyzed baseline
 * (VIOLATION), a scanner/registry execution failure that produced no
 * usable report (INFRA_ERROR), or an expected/accepted result (PASS). A
 * scanner failure must never be silently treated as PASS.
 *
 * Currently accepted baseline (moderate/low findings are not gated here -
 * see the workflow this script backs for the proportionality rationale):
 *
 *   high:     2  (js-yaml GHSA-2883-xcg3-v3hh; serialize-javascript
 *                 GHSA-5c6j-r48x-rmvq / GHSA-qj8w-gfj5-8c6v)
 *   critical: 0
 *
 * All three advisories trace to mocha@11.8.0, a transitive devDependency
 * of mochawesome (Cypress JSON -> HTML report generation only). This
 * repository's own unit-test runner is Node's built-in `node --test` (see
 * package.json's `test:unit` script) - mocha's CLI (`bin/mocha`) is never
 * invoked, no `.mocharc.yml`/`.mocharc.yaml` exists anywhere in this
 * repository, and mochawesome never requires mocha's CLI config loader
 * (confirmed: `require("js-yaml")` appears exactly once in mocha's own
 * source, at lib/cli/config.js, the file that parses a `--config` YAML
 * file for mocha's CLI - the only call site for both the js-yaml and, via
 * mocha's own vulnerable `diff`/`serialize-javascript` reporter-formatting
 * path, the other two advisories). This mirrors CS3's own prior
 * reachability analysis for the diff/serialize-javascript pair (see git
 * history: `stabilization/cs3-supply-chain-hardening`, PR #115) - js-yaml
 * is a new advisory, disclosed after CS3, and is analyzed fresh here on
 * the same basis, not merely assumed safe by association.
 *
 * A transitive mocha major-version bump (12.x) would clear all three, but
 * is deliberately out of scope here for the same reason CS3 declined it:
 * it is a transitive major-version migration of a package outside this
 * task's own allowlist, feeding the mochawesome JSON report format
 * scripts/ai consumes downstream. This script's job is to make the next
 * *unreviewed* drift visible and CI-enforced, not to force that migration.
 */

"use strict";

const ACCEPTED_HIGH_CRITICAL_BASELINE = 2;

const RESULT = Object.freeze({
  PASS: "PASS",
  VIOLATION: "VIOLATION",
  INFRA_ERROR: "INFRA_ERROR",
});

function evaluateAuditReport(rawJson) {
  let report;
  try {
    report = JSON.parse(rawJson);
  } catch {
    return {
      result: RESULT.INFRA_ERROR,
      reason: "npm audit output was not valid JSON",
    };
  }

  const vulnerabilities = report && report.metadata && report.metadata.vulnerabilities;
  if (
    !vulnerabilities ||
    typeof vulnerabilities.high !== "number" ||
    typeof vulnerabilities.critical !== "number"
  ) {
    return {
      result: RESULT.INFRA_ERROR,
      reason: "npm audit output did not contain a usable vulnerabilities summary",
    };
  }

  const highCriticalCount = vulnerabilities.high + vulnerabilities.critical;
  if (highCriticalCount > ACCEPTED_HIGH_CRITICAL_BASELINE) {
    return {
      result: RESULT.VIOLATION,
      reason: `${highCriticalCount} high/critical finding(s) exceeds the accepted baseline of ${ACCEPTED_HIGH_CRITICAL_BASELINE}`,
      highCriticalCount,
    };
  }

  return { result: RESULT.PASS, highCriticalCount };
}

function main() {
  const { execFileSync } = require("node:child_process");
  let stdout;
  try {
    // `shell: true` is required for `npm` command-name resolution on
    // Windows (`npm` -> `npm.cmd`); POSIX PATH resolution is unaffected.
    stdout = execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      shell: true,
    });
  } catch (err) {
    // npm audit exits non-zero both when it finds vulnerabilities AND on
    // some registry/network failures, but still prints a usable JSON
    // report to stdout in the vulnerabilities case - treat stdout as
    // authoritative and only fall back to INFRA_ERROR when there is no
    // usable stdout at all.
    stdout = err.stdout ? err.stdout.toString("utf8") : "";
    if (!stdout) {
      process.stderr.write(
        `audit-drift-check: INFRA_ERROR - npm audit produced no output (${err.message})\n`,
      );
      process.exit(2);
    }
  }

  const evaluation = evaluateAuditReport(stdout);
  if (evaluation.result === RESULT.INFRA_ERROR) {
    process.stderr.write(`audit-drift-check: INFRA_ERROR - ${evaluation.reason}\n`);
    process.exit(2);
  }
  if (evaluation.result === RESULT.VIOLATION) {
    process.stderr.write(`audit-drift-check: VIOLATION - ${evaluation.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `audit-drift-check: PASS - ${evaluation.highCriticalCount}/${ACCEPTED_HIGH_CRITICAL_BASELINE} accepted high/critical findings\n`,
  );
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { evaluateAuditReport, ACCEPTED_HIGH_CRITICAL_BASELINE, RESULT };
