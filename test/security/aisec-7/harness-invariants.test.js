"use strict";

/**
 * AISEC-7 harness-level invariants.
 *
 *   1. Coverage contract: every AISEC-6 section 22 row H-01..H-12 is present,
 *      with at least one case and a target-architecture row.
 *   2. False-PASS resistance of the outcome model (mission section 11).
 *   3. Binding: every current-behavior case is confirmed by an executable test
 *      in its declared file, and every case appears in the AISEC-7 document
 *      with the same declared outcome.
 *   4. Effect safety of the harness source itself: no real endpoint, no direct
 *      network or process call, no secret consumption, temp-root writes only.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const fx = require("./lib/fixtures");
const { OUTCOMES, SCOPES, BLOCKED_BY, deriveSecurityOutcome, observed } = require("./lib/outcomes");
const { H_ROWS, CASES, confirmCase, targetOutcome } = require("./lib/registry");

const HARNESS_DIR = __dirname;
const DOC = path.join(fx.REPO_ROOT, "docs", "aisec-7-adversarial-security-test-harness-v1.md");
const EXPECTED_H = Array.from({ length: 12 }, (_, i) => `H-${String(i + 1).padStart(2, "0")}`);

function harnessFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) out.push(full);
    }
  };
  walk(HARNESS_DIR);
  return out.sort();
}

// --- 1. coverage contract ------------------------------------------------------------

test("coverage: H-01..H-12 are all represented, in order, with no extra rows", () => {
  assert.deepEqual(H_ROWS.map((r) => r.id), EXPECTED_H);
});

test("coverage: every H row has at least one case and at least one target-architecture row; case ids are unique", () => {
  const ids = CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const h of EXPECTED_H) {
    const rows = CASES.filter((c) => c.h === h);
    assert.ok(rows.length >= 2, `${h} has cases`);
    assert.ok(rows.some((c) => c.scope === SCOPES.TARGET_ARCHITECTURE), `${h} has a target-architecture row`);
  }
  for (const c of CASES) {
    assert.ok(Object.values(OUTCOMES).includes(c.outcome), `${c.id} outcome`);
    assert.ok(fs.existsSync(path.join(HARNESS_DIR, c.file)), `${c.id} evidence file ${c.file}`);
  }
});

test("coverage: every executable current-behavior case is confirmed by a test in its declared file", () => {
  for (const c of CASES.filter((x) => x.scope === SCOPES.CURRENT_BEHAVIOR)) {
    const source = fs.readFileSync(path.join(HARNESS_DIR, c.file), "utf8");
    assert.ok(source.includes(`confirmCase("${c.id}"`), `${c.id} is confirmed in ${c.file}`);
  }
});

// --- 2. false-PASS resistance -----------------------------------------------------------

test("false-PASS: missing or incomplete evidence never becomes PASS", () => {
  for (const evidence of [undefined, null, {}, "PASS", { scope: "PASS" },
    { scope: SCOPES.CURRENT_BEHAVIOR, controlHeld: true },
    { scope: SCOPES.CURRENT_BEHAVIOR, executed: true, controlHeld: true },
    { scope: SCOPES.CURRENT_BEHAVIOR, executed: false, evidenceComplete: true, controlHeld: true },
    { scope: SCOPES.CURRENT_BEHAVIOR, executed: true, evidenceComplete: true, controlHeld: "yes" },
    { scope: SCOPES.CURRENT_BEHAVIOR, executed: true, evidenceComplete: true }]) {
    assert.equal(deriveSecurityOutcome(evidence), OUTCOMES.INSUFFICIENT_EVIDENCE, JSON.stringify(evidence));
  }
});

test("false-PASS: a blocked dependency never becomes PASS, whatever the observation claims", () => {
  const claimsEverything = { executed: true, evidenceComplete: true, controlHeld: true, authenticSeamVerified: true, testPassed: true };
  for (const [blockedBy, expected] of Object.entries(BLOCKED_BY)) {
    assert.equal(deriveSecurityOutcome({ scope: SCOPES.TARGET_ARCHITECTURE, blockedBy, ...claimsEverything }), expected);
  }
  assert.equal(deriveSecurityOutcome({ scope: SCOPES.TARGET_ARCHITECTURE, blockedBy: "UNKNOWN_BLOCKER", ...claimsEverything }), OUTCOMES.INSUFFICIENT_EVIDENCE);
  for (const c of CASES.filter((x) => x.scope === SCOPES.TARGET_ARCHITECTURE)) {
    const outcome = targetOutcome(c.id);
    assert.notEqual(outcome, OUTCOMES.PASS, c.id);
    assert.equal(outcome, c.outcome, c.id);
    assert.equal(deriveSecurityOutcome({ scope: SCOPES.TARGET_ARCHITECTURE, blockedBy: c.blockedBy, ...claimsEverything }), c.outcome, `${c.id} with forged claims`);
  }
});

test("false-PASS: an open owner disposition never becomes PASS", () => {
  assert.equal(deriveSecurityOutcome({ scope: SCOPES.TARGET_ARCHITECTURE, ownerDispositionRequired: true, executed: true, evidenceComplete: true, authenticSeamVerified: true, controlHeld: true }), OUTCOMES.OWNER_DISPOSITION_REQUIRED);
  assert.equal(observed(null, { ownerDispositionRequired: true }), OUTCOMES.OWNER_DISPOSITION_REQUIRED);
  for (const c of CASES.filter((x) => x.outcome === OUTCOMES.OWNER_DISPOSITION_REQUIRED && x.scope === SCOPES.CURRENT_BEHAVIOR)) {
    assert.throws(() => confirmCase(c.id, true), /differs from the declared/, `${c.id} cannot be confirmed as PASS`);
  }
});

test("false-PASS: synthetic trust labels and schema validity do not change any outcome", () => {
  const base = { scope: SCOPES.TARGET_ARCHITECTURE, executed: true, evidenceComplete: true, controlHeld: true };
  const decorated = { ...base, trustLabel: "PLATFORM_AUTHENTICATED", invocationTrust: "PLATFORM_AUTHENTICATED", authenticated: true, schemaValid: true, authorized: true, reviewerName: "security-lead" };
  assert.equal(deriveSecurityOutcome(base), OUTCOMES.INSUFFICIENT_EVIDENCE, "no authentic seam verified");
  assert.equal(deriveSecurityOutcome(decorated), deriveSecurityOutcome(base));
  const current = { scope: SCOPES.CURRENT_BEHAVIOR, executed: true, evidenceComplete: true, controlHeld: false };
  assert.equal(deriveSecurityOutcome({ ...current, schemaValid: true, trustLabel: "PLATFORM_AUTHENTICATED" }), OUTCOMES.FAIL);
});

test("false-PASS: a current deterministic refusal may be PASS while its target architecture stays blocked", () => {
  assert.equal(observed(true), OUTCOMES.PASS);
  assert.equal(confirmCase("H03-C1", true), OUTCOMES.PASS);
  assert.equal(targetOutcome("H03-T"), OUTCOMES.IMPLEMENTATION_BLOCKED);
});

test("false-PASS: a successful reproduction test keeps a FAIL security outcome, and policy dependencies do not erase it", () => {
  assert.equal(observed(false), OUTCOMES.FAIL);
  assert.equal(observed(false, { ownerDispositionRequired: true }), OUTCOMES.FAIL);
  for (const id of ["H05-C1", "H05-C2", "H06-C1", "H06-C2"]) {
    assert.equal(confirmCase(id, false), OUTCOMES.FAIL);
    assert.throws(() => confirmCase(id, true), /differs from the declared/, `${id} (XI) can never be confirmed as PASS`);
  }
});

test("false-PASS: no current-behavior case reports PASS for a property that is a declared FAIL, and FAIL cases exist", () => {
  const fails = CASES.filter((c) => c.outcome === OUTCOMES.FAIL).map((c) => c.id);
  assert.ok(fails.length > 0);
  for (const id of fails) assert.throws(() => confirmCase(id, true), /differs from the declared/);
});

// --- 3. finding preservation and documentation binding -----------------------------------

test("finding preservation: XI cases record XI-01/XI-02 as OPEN / MEDIUM / UNCHANGED and only as FAIL reproductions", () => {
  for (const c of CASES.filter((x) => /^H0[56]-C/.test(x.id) && x.outcome === OUTCOMES.FAIL)) {
    assert.match(c.related, /XI-0[12] OPEN \/ MEDIUM \/ UNCHANGED/, c.id);
  }
});

test("documentation: every H row and every case appears in the AISEC-7 document with its declared outcome", () => {
  const doc = fs.readFileSync(DOC, "utf8");
  const lines = doc.split(/\r?\n/);
  for (const h of EXPECTED_H) assert.ok(lines.some((l) => l.startsWith(`| ${h} |`)), `${h} matrix row`);
  for (const c of CASES) {
    const row = lines.find((l) => l.startsWith(`| ${c.id} |`));
    assert.ok(row, `${c.id} ledger row`);
    assert.ok(row.includes(`| ${c.outcome} |`), `${c.id} documented outcome ${c.outcome}`);
  }
  for (const statement of ["XI-01 = OPEN / MEDIUM / UNCHANGED", "XI-02 = OPEN / MEDIUM / UNCHANGED", "MERGE NOT AUTHORIZED", "Type & Schema Boundary Audit"]) {
    assert.ok(doc.includes(statement), statement);
  }
});

// --- 4. effect safety of the harness source ----------------------------------------------

test("safety: harness temp roots live under the OS temp directory", () => {
  const root = fx.makeTempRoot("safety-probe");
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())));
  assert.throws(() => fx.writeJson(fx.REPO_ROOT, "reports/ai/x.json", {}), /refusing to write outside/);
  fx.cleanupRoots();
});

test("safety: the harness makes no direct network or process call and names no real endpoint", () => {
  const ALLOWED_URL = /^https:\/\/dev\.azure\.com\/\$\{ORG\}\//;
  for (const file of harnessFiles()) {
    const rel = path.relative(HARNESS_DIR, file);
    const source = fs.readFileSync(file, "utf8");
    assert.ok(!/(?:child_process|childProcess)\.(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(/.test(source), `${rel}: direct child process call`);
    assert.ok(!/(?:^|[^.\w])fetch\s*\(/m.test(source), `${rel}: direct fetch call`);
    assert.ok(!/require\(["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns|undici)["']\)/.test(source), `${rel}: network module`);
    if (rel !== path.join("lib", "fixtures.js")) assert.ok(!/require\("node:child_process"\)/.test(source), `${rel}: only fixtures may intercept child_process`);
    for (const url of source.match(/https?:\/\/[^\s'"`)]+/g) || []) {
      assert.ok(ALLOWED_URL.test(url), `${rel}: unexpected URL ${url}`);
    }
  }
});

test("safety: the harness reads no real secret value from the environment", () => {
  const ALLOWED_ENV = new Set(["AI_PROVIDER", "AI_MODEL", "AI_API_KEY", "GITHUB_TOKEN", "AISEC7_DUMMY_SECRET"]);
  for (const file of harnessFiles()) {
    const rel = path.relative(HARNESS_DIR, file);
    const source = fs.readFileSync(file, "utf8");
    for (const [, name] of source.matchAll(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      assert.ok(ALLOWED_ENV.has(name), `${rel}: process.env.${name}`);
    }
    // Every named secret-bearing variable is only ever set (when unset) or deleted.
    for (const line of source.split(/\r?\n/).filter((l) => /process\.env\.(?:AI_API_KEY|GITHUB_TOKEN)/.test(l))) {
      assert.fail(`${rel}: direct secret variable access: ${line.trim()}`);
    }
  }
});
