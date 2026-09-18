"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const {
  MANIFEST,
  MANIFEST_RESULT,
  CLASSIFY_STATUS,
  validateManifest,
  classifyBranch,
  getCurrentBranch,
} = require("./branch-inventory");

// --- the real, built-in manifest must itself be valid ---

test("the built-in MANIFEST is VALID", () => {
  const result = validateManifest(MANIFEST);
  assert.deepEqual(result, { result: MANIFEST_RESULT.VALID, errors: [] });
});

// --- manifest validation: fail-closed matrix ---

function validManifestFixture() {
  return {
    schemaVersion: 1,
    defaultBranch: "main",
    namedBranches: { main: { kind: "long-lived", protected: true, purpose: "x" } },
    classes: { feature: { pattern: "^feature/", kind: "transient", protected: false, purpose: "x" } },
  };
}

test("valid canonical manifest -> VALID", () => {
  assert.equal(validateManifest(validManifestFixture()).result, MANIFEST_RESULT.VALID);
});

test("unsupported schema version -> INVALID", () => {
  const m = validManifestFixture();
  m.schemaVersion = 999;
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.match(result.errors[0], /unsupported or missing schemaVersion/);
});

test("missing schema version -> INVALID", () => {
  const m = validManifestFixture();
  delete m.schemaVersion;
  assert.equal(validateManifest(m).result, MANIFEST_RESULT.INVALID);
});

test("missing default branch field -> INVALID", () => {
  const m = validManifestFixture();
  delete m.defaultBranch;
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("defaultBranch must be a non-empty string")));
});

test("default branch not represented in namedBranches -> INVALID", () => {
  const m = validManifestFixture();
  m.defaultBranch = "trunk";
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("is not represented in namedBranches")));
});

test("invalid regex pattern -> INVALID", () => {
  const m = validManifestFixture();
  m.classes.feature.pattern = "^feature/(";
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("is not a valid regular expression")));
});

test("duplicate pattern across two classes -> INVALID", () => {
  const m = validManifestFixture();
  m.classes.docs = { pattern: "^feature/", kind: "transient", protected: false, purpose: "x" };
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("duplicates another class's pattern")));
});

test("class pattern matching a named branch -> INVALID", () => {
  const m = validManifestFixture();
  m.classes.mainlike = { pattern: "^main$", kind: "transient", protected: false, purpose: "x" };
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("must never reclassify a named branch")));
});

test("unknown enum/kind on a class -> INVALID", () => {
  const m = validManifestFixture();
  m.classes.feature.kind = "sort-of-transient";
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("is not a recognized kind")));
});

test("unknown enum/kind on a named branch -> INVALID", () => {
  const m = validManifestFixture();
  m.namedBranches.main.kind = "eternal";
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("is not a recognized kind")));
});

test("transient class declaring protected: true -> INVALID (contradictory attribute)", () => {
  const m = validManifestFixture();
  m.classes.feature.protected = true;
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("only namedBranches (long-lived branches) may be protected")));
});

test("malformed manifest shapes -> INVALID, never throws", () => {
  for (const bad of [null, undefined, "a string", 42, [], []]) {
    assert.doesNotThrow(() => validateManifest(bad));
    assert.equal(validateManifest(bad).result, MANIFEST_RESULT.INVALID);
  }
});

test("namedBranches not an object -> INVALID", () => {
  const m = validManifestFixture();
  m.namedBranches = "main";
  assert.equal(validateManifest(m).result, MANIFEST_RESULT.INVALID);
});

test("classes not an object -> INVALID", () => {
  const m = validManifestFixture();
  m.classes = "feature";
  assert.equal(validateManifest(m).result, MANIFEST_RESULT.INVALID);
});

test("namedBranches entry missing protected field -> INVALID", () => {
  const m = validManifestFixture();
  delete m.namedBranches.main.protected;
  const result = validateManifest(m);
  assert.equal(result.result, MANIFEST_RESULT.INVALID);
  assert.ok(result.errors.some((e) => e.includes("protected must be a boolean")));
});

// --- classification: known classes from the real, built-in manifest ---

test("main classifies as NAMED, long-lived, protected", () => {
  const result = classifyBranch("main", MANIFEST);
  assert.deepEqual(result, { status: CLASSIFY_STATUS.NAMED, class: "main", kind: "long-lived", protected: true });
});

test("feature/x classifies as CLASSIFIED feature, transient, unprotected", () => {
  const result = classifyBranch("feature/crw2-a2-strict-evaluation", MANIFEST);
  assert.equal(result.status, CLASSIFY_STATUS.CLASSIFIED);
  assert.equal(result.class, "feature");
  assert.equal(result.kind, "transient");
  assert.equal(result.protected, false);
});

test("docs/x classifies as CLASSIFIED docs", () => {
  assert.equal(classifyBranch("docs/crw2-a2-canonical-closure", MANIFEST).class, "docs");
});

test("dependabot/x classifies as CLASSIFIED automation", () => {
  const result = classifyBranch("dependabot/npm_and_yarn/npm-dependencies-014da33c86", MANIFEST);
  assert.equal(result.status, CLASSIFY_STATUS.CLASSIFIED);
  assert.equal(result.class, "dependabot");
  assert.equal(result.kind, "automation");
});

test("every real, currently-open branch class from the live inventory classifies correctly", () => {
  const cases = [
    ["feature/rti1-requirement-artifact-contract", "feature"],
    ["docs/roadmap-v3.3-canonical-sync", "docs"],
    ["chore/crw1b-node22-enforcement", "chore"],
    ["fix/rtia-c1-publishing-single-read", "fix"],
    ["corrective/rti7i-a-jira-provider-parity", "corrective"],
    ["refactor/rti8e1-shared-http-test-fixture", "refactor"],
    ["experiment/k2-irrelevant-knowledge-exclusion", "experiment"],
    ["evidence/cs4-test-discovery-probe", "evidence"],
    ["independence/fpi1-framework-runtime-config-contracts", "independence"],
    ["installation/id1-package-public-api", "installation"],
    ["proof/acq-upg-version-b", "proof"],
    ["spike/firefox-ci-execution", "spike"],
  ];
  for (const [branch, expectedClass] of cases) {
    const result = classifyBranch(branch, MANIFEST);
    assert.equal(result.status, CLASSIFY_STATUS.CLASSIFIED, `${branch} should classify`);
    assert.equal(result.class, expectedClass, `${branch} should classify as ${expectedClass}`);
  }
});

// --- classification: unknown / ambiguous / invalid input ---

test("unrecognized branch name -> UNKNOWN, not silently privileged", () => {
  const result = classifyBranch("release/2.0", MANIFEST);
  assert.deepEqual(result, { status: CLASSIFY_STATUS.UNKNOWN, class: null, kind: null, protected: null });
});

test("ambiguous match against a synthetic overlapping manifest -> AMBIGUOUS, fails closed", () => {
  const m = validManifestFixture();
  m.classes.featureAlias = { pattern: "^feature", kind: "transient", protected: false, purpose: "overlaps feature/ on purpose for this test" };
  const result = classifyBranch("feature/x", m);
  assert.equal(result.status, CLASSIFY_STATUS.AMBIGUOUS);
  assert.equal(result.class, null);
  assert.ok(result.matches.includes("feature"));
  assert.ok(result.matches.includes("featureAlias"));
});

test("invalid input: non-string, empty string, whitespace, refs/ form", () => {
  for (const bad of [null, undefined, 42, {}, [], "", "refs/heads/main", "feature/has space"]) {
    const result = classifyBranch(bad, MANIFEST);
    assert.equal(result.status, CLASSIFY_STATUS.INVALID_INPUT, `expected INVALID_INPUT for ${JSON.stringify(bad)}`);
  }
});

// --- adversarial classification: naive matching must not be fooled ---

test("adversarial branch names never accidentally classify into a privileged/wrong class", () => {
  const cases = [
    ["featurex/foo", CLASSIFY_STATUS.UNKNOWN, null], // no "/" right after "feature"
    ["docs-malicious/foo", CLASSIFY_STATUS.UNKNOWN, null],
    ["dependabot-evil/npm", CLASSIFY_STATUS.UNKNOWN, null],
    ["main-copy", CLASSIFY_STATUS.UNKNOWN, null], // not exactly "main"
    ["feature/main", CLASSIFY_STATUS.CLASSIFIED, "feature"], // real feature branch, correctly NOT "main"
    ["experiment/../../main", CLASSIFY_STATUS.CLASSIFIED, "experiment"], // still just a name under experiment/, never elevated
    ["release/main", CLASSIFY_STATUS.UNKNOWN, null], // no "release" class exists
    ["origin/main", CLASSIFY_STATUS.UNKNOWN, null], // remote-qualified form is NOT normalized - see input contract
    ["Main", CLASSIFY_STATUS.UNKNOWN, null], // case-sensitive: git branch names are case-sensitive
  ];
  for (const [branch, expectedStatus, expectedClass] of cases) {
    const result = classifyBranch(branch, MANIFEST);
    assert.equal(result.status, expectedStatus, `${branch} -> expected ${expectedStatus}, got ${result.status}`);
    assert.equal(result.class, expectedClass, `${branch} -> expected class ${expectedClass}, got ${result.class}`);
  }
});

// --- getCurrentBranch: repositoryRoot required, no cwd authority ---

test("getCurrentBranch requires an explicit repositoryRoot, never falls back to cwd", () => {
  for (const bad of [undefined, null, "", 42]) {
    const result = getCurrentBranch(bad);
    assert.equal(result.branch, null);
    assert.ok(result.error);
  }
});

test("getCurrentBranch against this real repository returns a real branch or detached, never throws", () => {
  const repositoryRoot = path.resolve(__dirname, "..", "..");
  assert.doesNotThrow(() => getCurrentBranch(repositoryRoot));
  const result = getCurrentBranch(repositoryRoot);
  assert.equal(typeof result.detached, "boolean");
  if (!result.detached && !result.error) {
    assert.equal(typeof result.branch, "string");
    assert.ok(result.branch.length > 0);
  }
});

test("getCurrentBranch against a non-git directory reports an error, not a fabricated branch", () => {
  const os = require("node:os");
  const result = getCurrentBranch(os.tmpdir());
  assert.equal(result.branch, null);
  assert.equal(result.detached, false);
  assert.ok(result.error);
});
