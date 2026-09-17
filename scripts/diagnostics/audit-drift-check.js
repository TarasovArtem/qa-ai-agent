#!/usr/bin/env node
/**
 * Supply-chain audit drift check (CRW1-D / B-3).
 *
 * Wraps `npm audit --json` with explicit three-way semantics npm audit's
 * own exit code does not provide: a genuine new high/critical-severity
 * *advisory identity* beyond this file's documented, reachability-analyzed
 * accepted baseline (VIOLATION), a scanner/report that cannot be reliably
 * interpreted (INFRA_ERROR), or an expected/accepted result (PASS). A
 * scanner failure must never be silently treated as PASS.
 *
 * CRW1-D-C1 (CRW1D-R01): the accepted baseline is identity-aware
 * (package + GHSA advisory ID), not an aggregate count. A count-only
 * authority is a real false-negative: if an accepted advisory disappears
 * while a *different* new advisory appears on the same package, the total
 * count can stay unchanged while genuinely new risk has been introduced.
 * Identity-based set difference catches this; aggregate counting cannot.
 *
 * Schema notes (npm 9.8.1, `auditReportVersion: 2`, independently captured
 * and inspected on this repository's own live `npm audit --json` output —
 * not assumed from documentation):
 *
 *   - `vulnerabilities` is an object keyed by package name.
 *   - Each entry's `via` array is heterogeneous: a STRING entry is a
 *     pointer to another top-level `vulnerabilities` entry ("this package
 *     is affected because it depends on that other vulnerable package"),
 *     not an independent advisory. An OBJECT entry is a real advisory,
 *     with its own `severity` (which can legitimately differ from the
 *     parent package's own rolled-up `severity` field), `url`
 *     (`https://github.com/advisories/GHSA-...`), and `source` (npm's own
 *     numeric advisory id, used as a fallback identity when no GHSA URL is
 *     present).
 *   - Example observed live: `mocha`'s entry has `via: ["diff",
 *     "serialize-javascript"]` (pure string pointers, package-level
 *     severity "moderate") while `diff` and `serialize-javascript` each
 *     have their own top-level entries with real object-shaped `via`
 *     advisories (severities "low" and "high" respectively) - `mocha`'s
 *     own "moderate" is a rollup marker, not an independent advisory, and
 *     is correctly never treated as one by this script.
 *
 * Currently accepted baseline (each independently reachability-analyzed,
 * not merely assumed safe by association with the other):
 *
 *   js-yaml               / GHSA-2883-xcg3-v3hh (high)
 *   serialize-javascript  / GHSA-5c6j-r48x-rmvq  (high)
 *
 * Both trace to mocha@11.8.0, a transitive devDependency of mochawesome
 * (Cypress JSON -> HTML report generation only). This repository's own
 * unit-test runner is Node's built-in `node --test` (see package.json's
 * `test:unit` script) - mocha's CLI (`bin/mocha`) is never invoked, no
 * `.mocharc.yml`/`.mocharc.yaml` exists anywhere in this repository, and
 * mochawesome never requires mocha's CLI config module (confirmed:
 * `require("js-yaml")` appears exactly once in mocha's own source, at
 * lib/cli/config.js, the file that parses a `--config` YAML file for
 * mocha's CLI - the only call site for js-yaml, and, via mocha's own
 * vulnerable reporter-formatting path, for serialize-javascript too). This
 * mirrors CS3's own prior reachability analysis for the diff/
 * serialize-javascript pair (git history: `stabilization/
 * cs3-supply-chain-hardening`, PR #115) - js-yaml is a new advisory,
 * disclosed after CS3, and is analyzed fresh here on the same basis, not
 * merely assumed safe by association.
 *
 * `serialize-javascript` also carries a second, moderate-severity advisory
 * (GHSA-qj8w-gfj5-8c6v) - out of this script's high/critical gating scope
 * by design (see "Severity filter" below), not silently dropped: it is
 * still visible in `npm audit`'s own plain output and in this script's
 * diagnostic `observed` list if inspected directly.
 *
 * A transitive mocha major-version bump (12.x) would clear all three
 * advisories, but is deliberately out of scope here for the same reason
 * CS3 declined it: it is a transitive major-version migration of a package
 * outside this task's own allowlist, feeding the mochawesome JSON report
 * format scripts/ai consumes downstream. This script's job is to make the
 * next *unreviewed* drift visible and CI-enforced, not to force that
 * migration.
 */

"use strict";

const GATED_SEVERITIES = new Set(["high", "critical"]);

// Each accepted entry required its own independent review + reachability
// rationale (see the file-level comment above) - do not add an entry here
// without one.
const ACCEPTED_HIGH_CRITICAL = Object.freeze([
  Object.freeze({ packageName: "js-yaml", advisoryId: "GHSA-2883-xcg3-v3hh" }),
  Object.freeze({ packageName: "serialize-javascript", advisoryId: "GHSA-5c6j-r48x-rmvq" }),
]);

const RESULT = Object.freeze({
  PASS: "PASS",
  VIOLATION: "VIOLATION",
  INFRA_ERROR: "INFRA_ERROR",
});

// Case-normalized so a future npm/GitHub casing variance in either the
// accepted baseline (typed by hand) or the observed report (regex-extracted
// from a URL) can never cause a false PASS/VIOLATION mismatch purely from
// letter case - GHSA ids are conventionally lowercase, but this comparison
// does not depend on that convention holding forever.
function advisoryKey(advisory) {
  return `${advisory.packageName}::${advisory.advisoryId}`.toLowerCase();
}

const ACCEPTED_HIGH_CRITICAL_KEYS = new Set(ACCEPTED_HIGH_CRITICAL.map(advisoryKey));

const GHSA_PATTERN = /GHSA-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}-[0-9a-zA-Z]{4}/;

function extractGhsaId(url) {
  if (typeof url !== "string") return null;
  const match = url.match(GHSA_PATTERN);
  return match ? match[0] : null;
}

/**
 * Walks every top-level vulnerability entry's `via` array and extracts
 * the real, independently-identified advisories (object-shaped `via`
 * entries only - string entries are cross-references, not advisories; see
 * the file-level schema notes). Deduplicates by (packageName, advisoryId)
 * set identity, not by raw array length, since the same advisory can be
 * reachable through more than one dependency path.
 *
 * Returns `null` if the report's top-level shape doesn't match the
 * expected `auditReportVersion: 2` structure at all (caller must treat
 * this as INFRA_ERROR - never silently proceed on an unrecognized shape).
 */
function normalizeAdvisories(report) {
  if (!report || typeof report !== "object") return null;
  if (report.auditReportVersion !== 2) return null;
  const vulnerabilities = report.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") return null;

  const gated = new Map();
  const allObserved = new Map();
  const unresolvable = [];

  for (const entry of Object.values(vulnerabilities)) {
    if (!entry || !Array.isArray(entry.via)) {
      // A top-level entry with no usable `via` array at all is itself a
      // schema surprise - if its own rolled-up severity is high/critical,
      // it cannot be safely ignored (see "unknown identity" semantics).
      if (entry && GATED_SEVERITIES.has(entry.severity)) {
        unresolvable.push({ packageName: entry.name || null, reason: "missing via array" });
      }
      continue;
    }

    for (const via of entry.via) {
      if (typeof via === "string") continue; // cross-reference to another top-level entry, not an independent advisory

      if (!via || typeof via !== "object") {
        unresolvable.push({ packageName: entry.name || null, reason: "via entry neither string nor object" });
        continue;
      }

      const packageName = via.name || via.dependency || entry.name || null;
      const advisoryId = extractGhsaId(via.url) || (typeof via.source === "number" ? `npm-source:${via.source}` : null);

      if (!packageName || !advisoryId) {
        unresolvable.push({ packageName, reason: "advisory object missing derivable identity", severity: via.severity || null });
        continue;
      }

      const advisory = { packageName, advisoryId, severity: via.severity || null };
      allObserved.set(advisoryKey(advisory), advisory);

      if (GATED_SEVERITIES.has(via.severity)) {
        gated.set(advisoryKey(advisory), advisory);
      }
    }
  }

  return { gated, allObserved, unresolvable };
}

function evaluateAuditReport(rawJson) {
  let report;
  try {
    report = JSON.parse(rawJson);
  } catch {
    return { result: RESULT.INFRA_ERROR, reason: "npm audit output was not valid JSON" };
  }

  const normalized = normalizeAdvisories(report);
  if (!normalized) {
    return {
      result: RESULT.INFRA_ERROR,
      reason: "npm audit output did not match the expected auditReportVersion 2 vulnerabilities structure",
    };
  }

  if (normalized.unresolvable.length > 0) {
    return {
      result: RESULT.INFRA_ERROR,
      reason: `${normalized.unresolvable.length} high/critical-relevant finding(s) could not be reliably identified`,
      unresolvable: normalized.unresolvable,
    };
  }

  const newFindings = [];
  for (const [key, advisory] of normalized.gated) {
    if (!ACCEPTED_HIGH_CRITICAL_KEYS.has(key)) {
      newFindings.push(advisory);
    }
  }

  const staleAccepted = ACCEPTED_HIGH_CRITICAL.filter(
    (accepted) => !normalized.gated.has(advisoryKey(accepted)),
  );

  if (newFindings.length > 0) {
    return {
      result: RESULT.VIOLATION,
      reason: `${newFindings.length} new/unaccepted high or critical advisory(ies): ${newFindings
        .map((a) => `${a.packageName} / ${a.advisoryId}`)
        .join(", ")}`,
      newFindings,
      observedGatedCount: normalized.gated.size,
      staleAccepted,
    };
  }

  return {
    result: RESULT.PASS,
    observedGatedCount: normalized.gated.size,
    acceptedCount: ACCEPTED_HIGH_CRITICAL.length,
    staleAccepted,
  };
}

function main() {
  const { execFileSync } = require("node:child_process");
  let stdout;
  try {
    // `shell: true` is required for `npm` command-name resolution on
    // Windows (`npm` -> `npm.cmd`); POSIX PATH resolution is unaffected.
    // The command name and arguments are both fully static - no
    // user-controlled input reaches the shell.
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
    if (evaluation.unresolvable) {
      process.stderr.write(`${JSON.stringify(evaluation.unresolvable, null, 2)}\n`);
    }
    process.exit(2);
  }
  if (evaluation.result === RESULT.VIOLATION) {
    process.stderr.write(`audit-drift-check: VIOLATION - ${evaluation.reason}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `audit-drift-check: PASS - ${evaluation.observedGatedCount}/${evaluation.acceptedCount} accepted high/critical advisories observed\n`,
  );
  if (evaluation.staleAccepted && evaluation.staleAccepted.length > 0) {
    process.stdout.write(
      `audit-drift-check: note - ${evaluation.staleAccepted.length} accepted advisory(ies) no longer observed (improvement, not a violation): ${evaluation.staleAccepted
        .map((a) => `${a.packageName} / ${a.advisoryId}`)
        .join(", ")}\n`,
    );
  }
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = {
  evaluateAuditReport,
  normalizeAdvisories,
  extractGhsaId,
  advisoryKey,
  ACCEPTED_HIGH_CRITICAL,
  RESULT,
};
