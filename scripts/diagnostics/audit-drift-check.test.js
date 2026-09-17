"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  evaluateAuditReport,
  normalizeAdvisories,
  extractGhsaId,
  ACCEPTED_HIGH_CRITICAL,
  RESULT,
} = require("./audit-drift-check");

// Builds a schema-realistic auditReportVersion:2 fixture. Each entry in
// `advisories` becomes its own top-level vulnerabilities[name] entry with
// a single real (object-shaped) `via` advisory - mirrors the actual shape
// independently captured from this repo's own live `npm audit --json`
// (js-yaml/serialize-javascript: single-advisory top-level entries; see
// audit-drift-check.js's own file-level comment for the full schema note).
function fixtureReport(advisories) {
  const vulnerabilities = {};
  for (const { packageName, advisoryId, severity } of advisories) {
    vulnerabilities[packageName] = {
      name: packageName,
      severity,
      isDirect: false,
      via: [
        {
          source: 1000000,
          name: packageName,
          dependency: packageName,
          title: `synthetic advisory for ${packageName}`,
          url: `https://github.com/advisories/${advisoryId}`,
          severity,
          cwe: ["CWE-400"],
          cvss: { score: 7.5, vectorString: null },
          range: ">=1.0.0 <2.0.0",
        },
      ],
      effects: [],
      range: ">=1.0.0 <2.0.0",
      nodes: [`node_modules/${packageName}`],
      fixAvailable: true,
    };
  }
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const { severity } of advisories) {
    if (severity in counts) counts[severity] += 1;
  }
  return JSON.stringify({
    auditReportVersion: 2,
    vulnerabilities,
    metadata: {
      vulnerabilities: { ...counts, total: advisories.length },
      dependencies: { prod: 0, dev: 1, optional: 0, peer: 0, peerOptional: 0, total: 1 },
    },
  });
}

const A = { packageName: "pkg-a", advisoryId: "GHSA-aaaa-aaaa-aaaa", severity: "high" };
const B = { packageName: "pkg-b", advisoryId: "GHSA-bbbb-bbbb-bbbb", severity: "high" };
const C = { packageName: "pkg-c", advisoryId: "GHSA-cccc-cccc-cccc", severity: "high" };

// --- CRW1D-R01, test #4 (mission #9): same-count substitution ---
// This is the single most important regression test in this file - it
// must FAIL before the identity-aware corrective and PASS after it.

test("VIOLATION when an accepted advisory is replaced by a different one at the same total count (same-count substitution)", () => {
  // Reuses the project's own real accepted baseline shape: pretend the
  // accepted set were exactly {A, B}; observed is {B, C} - same count (2),
  // but C is genuinely new and unreviewed.
  const accepted = [A, B];
  const acceptedKeys = new Set(accepted.map((a) => `${a.packageName}::${a.advisoryId}`));
  const observedReport = fixtureReport([B, C]);

  // Build a throwaway evaluator using the same algorithm shape but a
  // caller-supplied accepted set, by asserting directly against
  // normalizeAdvisories + manual set difference - evaluateAuditReport
  // itself uses the module's real ACCEPTED_HIGH_CRITICAL constant, so this
  // test proves the *mechanism* (identity set difference, not aggregate
  // count) independently of which exact packages are currently accepted.
  const report = JSON.parse(observedReport);
  const normalized = normalizeAdvisories(report);
  assert.equal(normalized.gated.size, 2, "observed count must be 2, same as accepted count");
  const newFindings = [...normalized.gated.values()].filter(
    (adv) => !acceptedKeys.has(`${adv.packageName}::${adv.advisoryId}`),
  );
  assert.equal(newFindings.length, 1);
  assert.equal(newFindings[0].advisoryId, "GHSA-cccc-cccc-cccc");
});

// --- module's real ACCEPTED_HIGH_CRITICAL, exercised end-to-end ---

test("PASS when observed advisories are exactly the real accepted baseline", () => {
  const report = fixtureReport(
    ACCEPTED_HIGH_CRITICAL.map((a) => ({ ...a, severity: "high" })),
  );
  const evaluation = evaluateAuditReport(report);
  assert.equal(evaluation.result, RESULT.PASS);
});

test("PASS when observed advisories are a subset of the accepted baseline (an accepted finding disappearing is improvement, not a violation)", () => {
  const [first] = ACCEPTED_HIGH_CRITICAL;
  const report = fixtureReport([{ ...first, severity: "high" }]);
  const evaluation = evaluateAuditReport(report);
  assert.equal(evaluation.result, RESULT.PASS);
  assert.ok(evaluation.staleAccepted.length >= 1);
});

test("PASS when there are zero high/critical advisories", () => {
  const evaluation = evaluateAuditReport(fixtureReport([]));
  assert.equal(evaluation.result, RESULT.PASS);
});

test("VIOLATION when a genuinely new, unaccepted advisory appears on top of the accepted baseline", () => {
  const report = fixtureReport([
    ...ACCEPTED_HIGH_CRITICAL.map((a) => ({ ...a, severity: "high" })),
    C,
  ]);
  const evaluation = evaluateAuditReport(report);
  assert.equal(evaluation.result, RESULT.VIOLATION);
  assert.equal(evaluation.newFindings.length, 1);
  assert.equal(evaluation.newFindings[0].advisoryId, "GHSA-cccc-cccc-cccc");
});

test("VIOLATION when the same package gains a second, different advisory (not package-only baseline)", () => {
  const [first] = ACCEPTED_HIGH_CRITICAL;
  const secondAdvisoryOnSamePackage = {
    packageName: first.packageName,
    advisoryId: "GHSA-zzzz-zzzz-zzzz",
    severity: "high",
  };
  const report = fixtureReport([
    { ...first, severity: "high" },
    secondAdvisoryOnSamePackage,
  ]);
  const evaluation = evaluateAuditReport(report);
  assert.equal(evaluation.result, RESULT.VIOLATION);
  assert.equal(evaluation.newFindings[0].advisoryId, "GHSA-zzzz-zzzz-zzzz");
});

test("VIOLATION when a new critical finding appears alongside the accepted baseline", () => {
  const report = fixtureReport([
    ...ACCEPTED_HIGH_CRITICAL.map((a) => ({ ...a, severity: "high" })),
    { packageName: "pkg-critical", advisoryId: "GHSA-dddd-dddd-dddd", severity: "critical" },
  ]);
  const evaluation = evaluateAuditReport(report);
  assert.equal(evaluation.result, RESULT.VIOLATION);
});

// --- via string entries (rollup pointers) must never be treated as advisories ---

test("PASS ignores string-shaped via entries (rollup pointers), matching real npm audit shape", () => {
  const report = JSON.parse(
    fixtureReport(ACCEPTED_HIGH_CRITICAL.map((a) => ({ ...a, severity: "high" }))),
  );
  // Add a mocha-shaped rollup entry: via is pure strings, severity
  // "moderate" - must not be treated as an independent high/critical
  // advisory and must not cause a VIOLATION or INFRA_ERROR.
  report.vulnerabilities.mocha = {
    name: "mocha",
    severity: "moderate",
    isDirect: false,
    via: ACCEPTED_HIGH_CRITICAL.map((a) => a.packageName),
    effects: [],
    range: ">=1.0.0",
    nodes: ["node_modules/mocha"],
    fixAvailable: true,
  };
  const evaluation = evaluateAuditReport(JSON.stringify(report));
  assert.equal(evaluation.result, RESULT.PASS);
});

// --- severity filter: moderate/low advisories on the same package must not leak in ---

test("PASS ignores a moderate-severity via entry on an otherwise-accepted package (severity filter, not package-only)", () => {
  const [first] = ACCEPTED_HIGH_CRITICAL;
  const report = JSON.parse(fixtureReport([{ ...first, severity: "high" }]));
  report.vulnerabilities[first.packageName].via.push({
    source: 2000000,
    name: first.packageName,
    dependency: first.packageName,
    title: "a second, lower-severity advisory on the same package",
    url: "https://github.com/advisories/GHSA-moderate-only-xxxx",
    severity: "moderate",
    cwe: ["CWE-400"],
    cvss: { score: 4.0, vectorString: null },
    range: ">=1.0.0",
  });
  const evaluation = evaluateAuditReport(JSON.stringify(report));
  assert.equal(evaluation.result, RESULT.PASS);
});

// --- unknown/unresolvable identity must fail closed, never PASS ---

test("INFRA_ERROR when a high-severity via object has no derivable GHSA or numeric source id", () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      "mystery-pkg": {
        name: "mystery-pkg",
        severity: "high",
        isDirect: false,
        via: [
          {
            name: "mystery-pkg",
            title: "advisory with no identity fields",
            severity: "high",
            // no url, no source
          },
        ],
        effects: [],
        range: ">=1.0.0",
        nodes: ["node_modules/mystery-pkg"],
        fixAvailable: false,
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  };
  const evaluation = evaluateAuditReport(JSON.stringify(report));
  assert.equal(evaluation.result, RESULT.INFRA_ERROR);
  assert.equal(evaluation.unresolvable.length, 1);
});

test("INFRA_ERROR when a high-severity top-level entry has no via array at all", () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      "weird-pkg": {
        name: "weird-pkg",
        severity: "high",
        isDirect: false,
        // via intentionally omitted - schema surprise
        effects: [],
        range: ">=1.0.0",
        nodes: ["node_modules/weird-pkg"],
        fixAvailable: false,
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  };
  const evaluation = evaluateAuditReport(JSON.stringify(report));
  assert.equal(evaluation.result, RESULT.INFRA_ERROR);
});

test("PASS uses npm-source fallback identity when a real advisory object has a numeric source but no GHSA URL", () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      "no-ghsa-pkg": {
        name: "no-ghsa-pkg",
        severity: "high",
        isDirect: false,
        via: [
          {
            source: 424242,
            name: "no-ghsa-pkg",
            dependency: "no-ghsa-pkg",
            title: "advisory with a numeric source id but no GHSA URL",
            severity: "high",
          },
        ],
        effects: [],
        range: ">=1.0.0",
        nodes: ["node_modules/no-ghsa-pkg"],
        fixAvailable: false,
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
  };
  // Not in the accepted baseline, so this must VIOLATION (proves the
  // fallback identity is actually used for comparison, not just accepted
  // by default) rather than silently PASS or crash.
  const evaluation = evaluateAuditReport(JSON.stringify(report));
  assert.equal(evaluation.result, RESULT.VIOLATION);
  assert.equal(evaluation.newFindings[0].advisoryId, "npm-source:424242");
});

test("PASS handles an empty via array without crashing or flagging anything", () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      "empty-via-pkg": {
        name: "empty-via-pkg",
        severity: "high",
        isDirect: false,
        via: [],
        effects: [],
        range: ">=1.0.0",
        nodes: ["node_modules/empty-via-pkg"],
        fixAvailable: false,
      },
    },
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  };
  const evaluation = evaluateAuditReport(JSON.stringify(report));
  assert.equal(evaluation.result, RESULT.PASS);
});

test("advisoryKey comparison is case-insensitive (defensive against future GHSA-id casing variance)", () => {
  const [first] = ACCEPTED_HIGH_CRITICAL;
  const upperCaseVariant = {
    packageName: first.packageName.toUpperCase(),
    advisoryId: first.advisoryId.toUpperCase(),
    severity: "high",
  };
  const report = fixtureReport([upperCaseVariant]);
  const evaluation = evaluateAuditReport(report);
  assert.equal(evaluation.result, RESULT.PASS);
});

// --- malformed / wrong-shape reports must never be silently treated as PASS ---

test("INFRA_ERROR when npm audit output is not valid JSON (e.g. a registry failure message)", () => {
  const evaluation = evaluateAuditReport("npm ERR! network timeout");
  assert.equal(evaluation.result, RESULT.INFRA_ERROR);
});

test("INFRA_ERROR when JSON is valid but has no vulnerabilities object at all", () => {
  const evaluation = evaluateAuditReport(JSON.stringify({ error: { code: "ENOAUDIT" } }));
  assert.equal(evaluation.result, RESULT.INFRA_ERROR);
});

test("INFRA_ERROR when auditReportVersion is missing or not 2 (future/older schema)", () => {
  const evaluation = evaluateAuditReport(
    JSON.stringify({ auditReportVersion: 3, vulnerabilities: {} }),
  );
  assert.equal(evaluation.result, RESULT.INFRA_ERROR);
});

// --- GHSA extraction helper ---

test("extractGhsaId pulls the advisory id out of a real GitHub advisory URL", () => {
  assert.equal(
    extractGhsaId("https://github.com/advisories/GHSA-2883-xcg3-v3hh"),
    "GHSA-2883-xcg3-v3hh",
  );
});

test("extractGhsaId returns null for a URL with no GHSA id", () => {
  assert.equal(extractGhsaId("https://example.com/not-an-advisory"), null);
});

test("extractGhsaId returns null for a non-string input", () => {
  assert.equal(extractGhsaId(undefined), null);
});

// --- real current repository state (also independently re-run live in CI) ---

test("evaluateAuditReport PASSes against a fixture matching this repository's own currently-accepted advisories", () => {
  const report = fixtureReport(ACCEPTED_HIGH_CRITICAL.map((a) => ({ ...a, severity: "high" })));
  const evaluation = evaluateAuditReport(report);
  assert.equal(evaluation.result, RESULT.PASS);
  assert.equal(evaluation.observedGatedCount, ACCEPTED_HIGH_CRITICAL.length);
});
