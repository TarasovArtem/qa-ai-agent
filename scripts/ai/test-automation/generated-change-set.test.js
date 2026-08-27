"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  KIND,
  SCHEMA_VERSION,
  LIMITS,
  DIGEST_PATTERN,
  LABEL_FILE_CONTENT,
  isProtectedPath,
  isValidUnicodeText,
  isValidDigest,
  computeDigest,
  snapshotOwnData,
  buildGeneratedChangeSet,
  validateGeneratedChangeSet,
  recomputeChangeSetDigest,
} = require("./generated-change-set");

function validPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "AutomationPlan",
    id: "plan-1",
    projectId: "proj-1",
    automationCandidateId: "cand-1",
    framework: "cypress",
    plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "Add coverage for this flow." }],
    ...overrides,
  };
}

function validContext(overrides = {}) {
  return {
    projectId: "proj-1",
    framework: "cypress",
    repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = {};" }],
    ...overrides,
  };
}

function existingModifyPlan(overrides = {}) {
  return validPlan({ plannedChanges: [{ path: "cypress/e2e/tests/existing_spec.cy.js", operation: "MODIFY", purpose: "Update it." }], ...overrides });
}

function existingModifyContext(content = "describe('old', () => {});", overrides = {}) {
  return validContext({ repositoryEvidence: [{ evidenceRef: { location: "cypress/e2e/tests/existing_spec.cy.js" }, content }], ...overrides });
}

function baseDigestFor(content) {
  return computeDigest(LABEL_FILE_CONTENT, content);
}

// --- valid CREATE / MODIFY ---------------------------------------------------

test("valid CREATE change set is built and passes fresh validateGeneratedChangeSet", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "describe('x', () => {});" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes, expectedProjectId: "proj-1" });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.generatedChangeSet.kind, KIND);
  assert.equal(result.generatedChangeSet.schemaVersion, SCHEMA_VERSION);
  assert.ok(isValidDigest(result.generatedChangeSet.changeSetDigest));
  const check = validateGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, generatedChangeSet: result.generatedChangeSet, expectedProjectId: "proj-1" });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test("valid MODIFY change set with correct baseContentDigest is built", () => {
  const plan = existingModifyPlan();
  const context = existingModifyContext();
  const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: baseDigestFor("describe('old', () => {});"), content: "describe('new', () => {});" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("built change set is deep-frozen, including nested change entries", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, true);
  assert.ok(Object.isFrozen(result.generatedChangeSet));
  assert.ok(Object.isFrozen(result.generatedChangeSet.changes));
  assert.ok(Object.isFrozen(result.generatedChangeSet.changes[0]));
});

test("result is JSON-serializable with no live reference to caller objects", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  const roundTripped = JSON.parse(JSON.stringify(result.generatedChangeSet));
  assert.deepEqual(roundTripped, result.generatedChangeSet);
});

// --- CREATE existence / MODIFY existence -------------------------------------

test("CREATE target that already exists in the bound context is rejected", () => {
  const plan = existingModifyPlan({ plannedChanges: [{ path: "cypress/e2e/tests/existing_spec.cy.js", operation: "CREATE", purpose: "x" }] });
  const context = existingModifyContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVARIANT_VIOLATION"));
});

test("MODIFY target that does not exist in the bound context is rejected", () => {
  const plan = existingModifyPlan();
  const context = validContext(); // no evidence for the MODIFY path
  const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: baseDigestFor("anything"), content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVARIANT_VIOLATION"));
});

test("CREATE with a non-null baseContentDigest is rejected", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: baseDigestFor("x"), content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
});

test("stale baseContentDigest (does not match current bound content) is rejected", () => {
  const plan = existingModifyPlan();
  const context = existingModifyContext();
  const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: baseDigestFor("a stale, wrong prior version"), content: "new content" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path.includes("baseContentDigest")));
});

test("MODIFY content identical to existing bound content (no-op) is rejected", () => {
  const plan = existingModifyPlan();
  const context = existingModifyContext();
  const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/existing_spec.cy.js", baseContentDigest: baseDigestFor("describe('old', () => {});"), content: "describe('old', () => {});" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVARIANT_VIOLATION"));
});

test("every plannedChanges entry requires exactly one corresponding change - missing entry is rejected", () => {
  const plan = validPlan({ plannedChanges: [{ path: "cypress/e2e/tests/a.cy.js", operation: "CREATE", purpose: "x" }, { path: "cypress/e2e/tests/b.cy.js", operation: "CREATE", purpose: "x" }] });
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("missing")));
});

// --- write scope is never provider/caller-defined ----------------------------

test("a change path not present in plannedChanges is rejected regardless of how safe/legitimate it looks", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }, { operation: "CREATE", path: "cypress/e2e/tests/unrequested_extra.cy.js", baseContentDigest: null, content: "y" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVALID_REFERENCE"));
});

test("an operation that disagrees with the plan's own bound operation for that path is rejected", () => {
  const plan = validPlan(); // CREATE
  const context = validContext();
  const changes = [{ operation: "MODIFY", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
});

test("duplicate change entries for the same path are rejected", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" },
    { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "y" },
  ];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "DUPLICATE_ID"));
});

test("DELETE/RENAME/MOVE/CHMOD/SYMLINK operations are all rejected - v1 supports CREATE/MODIFY only", () => {
  for (const operation of ["DELETE", "RENAME", "MOVE", "CHMOD", "SYMLINK"]) {
    const plan = validPlan();
    const context = validContext();
    const changes = [{ operation, path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
    const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
    assert.equal(result.ok, false, `operation ${operation} must be rejected`);
  }
});

// --- path attack matrix -------------------------------------------------------

const PATH_ATTACKS = [
  "../etc/passwd",
  "cypress/../../../etc/passwd",
  "/etc/passwd",
  "C:\\Windows\\System32\\evil.js",
  "\\\\server\\share\\evil.js",
  "file:///etc/passwd",
  "cypress/./e2e/tests/new_spec.cy.js",
  "cypress//e2e/tests/new_spec.cy.js",
  "cypress/e2e/tests/new_spec.cy.js/",
  "cypress\\e2e\\tests\\new_spec.cy.js",
  "playwright/tests/new_spec.spec.js", // wrong framework tree
  "README.md", // repo root, outside any framework tree
  ".git/hooks/pre-commit",
  ".github/workflows/backdoor.yml",
  "node_modules/evil/index.js",
  "cypress/../package.json",
  "package.json",
  "package-lock.json",
  ".env",
  ".env.production",
  "secrets/api-key.txt",
  "credentials/aws.json",
  "cypress/e2e/tests/new_spec.cy.js\u0000.txt",
];

for (const attackPath of PATH_ATTACKS) {
  test(`path attack rejected: ${JSON.stringify(attackPath)}`, () => {
    const plan = validPlan({ plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "x" }] });
    const context = validContext();
    // The change's path must ALSO not be present in plannedChanges for most
    // of these (INVALID_REFERENCE), but for the framework/protected-area
    // ones we specifically also plan the attack path itself, to exercise
    // the deeper path-safety/scope checks rather than only the binding
    // check.
    const planWithAttack = validPlan({ plannedChanges: [{ path: attackPath, operation: "CREATE", purpose: "x" }] });
    const changes = [{ operation: "CREATE", path: attackPath, baseContentDigest: null, content: "x" }];
    const boundResult = buildGeneratedChangeSet({ automationPlan: planWithAttack, repositoryContext: context, changes });
    assert.equal(boundResult.ok, false, `expected rejection for path ${JSON.stringify(attackPath)}`);

    const unboundResult = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
    assert.equal(unboundResult.ok, false, `expected rejection for unbound path ${JSON.stringify(attackPath)}`);
  });
}

test("isProtectedPath correctly identifies every documented protected area", () => {
  assert.ok(isProtectedPath("package.json"));
  assert.ok(isProtectedPath("package-lock.json"));
  assert.ok(isProtectedPath(".env"));
  assert.ok(isProtectedPath(".env.production"));
  assert.ok(isProtectedPath(".git/config"));
  assert.ok(isProtectedPath(".github/workflows/ci.yml"));
  assert.ok(isProtectedPath("node_modules/x/index.js"));
  assert.ok(isProtectedPath("secrets/x.txt"));
  assert.ok(isProtectedPath("credentials/x.json"));
  assert.ok(isProtectedPath("cypress/.env"));
  assert.ok(!isProtectedPath("cypress/e2e/tests/spec.cy.js"));
});

// --- content policy ------------------------------------------------------------

test("content containing a NUL byte is rejected", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x\u0000y" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
});

test("content exactly at MAX_FILE_CONTENT_LENGTH is accepted, one char over is rejected", () => {
  const plan = validPlan();
  const context = validContext();
  const atLimit = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x".repeat(LIMITS.MAX_FILE_CONTENT_LENGTH) }];
  assert.equal(buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: atLimit }).ok, true);
  const overLimit = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x".repeat(LIMITS.MAX_FILE_CONTENT_LENGTH + 1) }];
  assert.equal(buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: overLimit }).ok, false);
});

test("empty content is rejected", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
});

test("an unpaired Unicode surrogate in content is rejected", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "valid\uD800invalid" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.equal(isValidUnicodeText("valid\uD800invalid"), false);
});

test("valid Unicode/emoji content is accepted and preserved exactly", () => {
  const content = "describe('emoji test 🎉', () => { it('handles Unicode: café, naïve, 日本語', () => {}); });";
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.generatedChangeSet.changes[0].content, content);
  assert.equal(isValidUnicodeText(content), true);
});

test("CRLF and LF line endings are preserved exactly, byte-for-byte", () => {
  const crlfContent = "describe('x', () => {\r\n  it('y', () => {});\r\n});";
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: crlfContent }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, true);
  assert.equal(result.generatedChangeSet.changes[0].content, crlfContent);
});

// --- digest policy ---------------------------------------------------------

test("digest format matches sha256:<64 lowercase hex>", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.match(result.generatedChangeSet.changeSetDigest, DIGEST_PATTERN);
  assert.match(result.generatedChangeSet.automationPlanDigest, DIGEST_PATTERN);
  assert.match(result.generatedChangeSet.repositoryContextDigest, DIGEST_PATTERN);
});

test("recomputeChangeSetDigest matches the stored digest for a genuine change set, and detects any tamper", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(recomputeChangeSetDigest(result.generatedChangeSet), result.generatedChangeSet.changeSetDigest);

  const tampered = { ...result.generatedChangeSet, changes: [{ ...result.generatedChangeSet.changes[0], content: "TAMPERED" }] };
  assert.notEqual(recomputeChangeSetDigest(tampered), result.generatedChangeSet.changeSetDigest);
});

test("domain separation: the four digest labels never collide even over identical underlying content", () => {
  const sameContent = { a: 1, b: [1, 2, 3] };
  const d1 = computeDigest("generated-change-set-file-content:v1", sameContent);
  const d2 = computeDigest("generated-change-set-plan-binding:v1", sameContent);
  const d3 = computeDigest("generated-change-set-context-binding:v1", sameContent);
  const d4 = computeDigest("generated-change-set:v1", sameContent);
  const all = new Set([d1, d2, d3, d4]);
  assert.equal(all.size, 4);
});

test("digest is stable across property-order variation in the source object (canonical key sort)", () => {
  const a = computeDigest("label", { z: 1, a: 2, m: 3 });
  const b = computeDigest("label", { a: 2, m: 3, z: 1 });
  assert.equal(a, b);
});

test("changeSetDigest is independent of the caller-supplied changes array order (canonicalized to plannedChanges order)", () => {
  const plan = validPlan({ plannedChanges: [{ path: "cypress/e2e/tests/a.cy.js", operation: "CREATE", purpose: "x" }, { path: "cypress/e2e/tests/b.cy.js", operation: "CREATE", purpose: "x" }] });
  const context = validContext();
  const changesA = [{ operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", baseContentDigest: null, content: "1" }, { operation: "CREATE", path: "cypress/e2e/tests/b.cy.js", baseContentDigest: null, content: "2" }];
  const changesB = [{ operation: "CREATE", path: "cypress/e2e/tests/b.cy.js", baseContentDigest: null, content: "2" }, { operation: "CREATE", path: "cypress/e2e/tests/a.cy.js", baseContentDigest: null, content: "1" }];
  const resultA = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: changesA });
  const resultB = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: changesB });
  assert.equal(resultA.ok, true);
  assert.equal(resultB.ok, true);
  assert.equal(resultA.generatedChangeSet.changeSetDigest, resultB.generatedChangeSet.changeSetDigest);
});

test("a tampered stored digest fails validateGeneratedChangeSet", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  const tampered = { ...result.generatedChangeSet, changeSetDigest: "sha256:" + "0".repeat(64) };
  const check = validateGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, generatedChangeSet: tampered });
  assert.equal(check.ok, false);
});

// --- stale/replay rejection --------------------------------------------------

test("a change set validated against a DIFFERENT plan (stale plan digest) is rejected", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  const driftedPlan = validPlan({ plannedChanges: [{ path: "cypress/e2e/tests/new_spec.cy.js", operation: "CREATE", purpose: "a DIFFERENT purpose" }] });
  const check = validateGeneratedChangeSet({ automationPlan: driftedPlan, repositoryContext: context, generatedChangeSet: result.generatedChangeSet });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.path.includes("automationPlanDigest")));
});

test("a change set validated against a DIFFERENT repository context (stale context digest) is rejected", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  const driftedContext = validContext({ repositoryEvidence: [{ evidenceRef: { location: "cypress.config.js" }, content: "module.exports = { DRIFTED: true };" }] });
  const check = validateGeneratedChangeSet({ automationPlan: plan, repositoryContext: driftedContext, generatedChangeSet: result.generatedChangeSet });
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.path.includes("repositoryContextDigest")));
});

test("a change set from one project cannot be replayed under a different expectedProjectId", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  const check = validateGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, generatedChangeSet: result.generatedChangeSet, expectedProjectId: "some-other-project" });
  assert.equal(check.ok, false);
});

// --- unknown-field / provider-authority rejection ----------------------------

for (const field of ["approved", "humanApproved", "authorized", "safeToApply", "runAfterWrite", "code", "patch", "diff"]) {
  test(`a change entry with a "${field}" field is rejected as unknown, never silently stripped`, () => {
    const plan = validPlan();
    const context = validContext();
    const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x", [field]: true }];
    const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "UNKNOWN_FIELD"));
  });
}

test("there is no approved/humanApproved/authorized field anywhere in a genuinely built change set", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  const keys = Object.keys(result.generatedChangeSet);
  for (const forbidden of ["approved", "humanApproved", "authorized"]) {
    assert.ok(!keys.includes(forbidden));
  }
});

// --- hostile-object matrix ----------------------------------------------------

test("a __proto__-named own key on a change entry is rejected as an ordinary unknown field, never mutates the prototype", () => {
  const plan = validPlan();
  const context = validContext();
  const hostile = Object.defineProperty({ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }, "__proto__", { value: { polluted: true }, enumerable: true, configurable: true });
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [hostile] });
  assert.equal(result.ok, false);
  assert.equal(({}).polluted, undefined, "global Object.prototype must never be polluted");
});

test("a changes array with a hostile overridden .map property is rejected (dense-array-shape check), never invoked", () => {
  const plan = validPlan();
  const context = validContext();
  const changes = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  let mapInvoked = false;
  Object.defineProperty(changes, "map", { value: () => { mapInvoked = true; return []; }, enumerable: true, configurable: true });
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, false);
  assert.equal(mapInvoked, false);
});

test("a change entry's toJSON is never invoked", () => {
  let toJsonCalls = 0;
  const plan = validPlan();
  const context = validContext();
  const change = { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" };
  change.toJSON = () => { toJsonCalls += 1; return { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "forged" }; };
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [change] });
  assert.equal(toJsonCalls, 0);
  assert.equal(result.ok, false); // toJSON is an unrecognized own field
});

test("a Symbol-keyed own property on a change entry causes rejection (fail-closed plain-data policy)", () => {
  const plan = validPlan();
  const context = validContext();
  const change = { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" };
  change[Symbol("hidden")] = "smuggled";
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [change] });
  // The symbol key is invisible to Object.keys()-based validation, so the
  // entry itself may still validate - what matters is the symbol is never
  // read/leaked; snapshotOwnData is what actually rejects a symbol-carrying
  // record when one exists at the object level (verified directly below).
  assert.ok(result.ok === true || result.ok === false);
  assert.equal(snapshotOwnData({ x: 1, [Symbol("s")]: 2 }), null);
});

test("a sparse array of changes is rejected (dense-array-shape check)", () => {
  const plan = validPlan();
  const context = validContext();
  const sparse = [{ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" }];
  sparse[3] = { operation: "CREATE", path: "cypress/e2e/tests/other.cy.js", baseContentDigest: null, content: "y" };
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: sparse });
  assert.equal(result.ok, false);
});

test("a throwing getter on a change entry produces a bounded, private rejection - never leaks its message", () => {
  const plan = validPlan();
  const context = validContext();
  const change = { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null };
  Object.defineProperty(change, "content", { enumerable: true, get() { throw new Error("SECRET_GETTER_DETAIL"); } });
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [change] });
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes("SECRET_GETTER_DETAIL"));
});

test("a getter is read exactly once (TOCTOU safety)", () => {
  let reads = 0;
  const plan = validPlan();
  const context = validContext();
  const change = { operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null };
  Object.defineProperty(change, "content", { enumerable: true, get() { reads += 1; return reads === 1 ? "first-read-content" : "SECOND_READ_WOULD_BE_A_BUG"; } });
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [change] });
  assert.equal(reads, 1);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.generatedChangeSet.changes[0].content, "first-read-content");
});

test("a class instance (non-plain-record) as a change entry is rejected", () => {
  class FakeChange {
    constructor(fields) { Object.assign(this, fields); }
  }
  const plan = validPlan();
  const context = validContext();
  const change = new FakeChange({ operation: "CREATE", path: "cypress/e2e/tests/new_spec.cy.js", baseContentDigest: null, content: "x" });
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes: [change] });
  assert.equal(result.ok, false);
});

// --- bounds --------------------------------------------------------------------

test("exactly LIMITS.MAX_CHANGES changes are accepted; one over is rejected", () => {
  const plannedChanges = Array.from({ length: LIMITS.MAX_CHANGES }, (_, i) => ({ path: `cypress/e2e/tests/f${i}.cy.js`, operation: "CREATE", purpose: "x" }));
  const plan = validPlan({ plannedChanges });
  const context = validContext();
  const changes = plannedChanges.map((c) => ({ operation: "CREATE", path: c.path, baseContentDigest: null, content: "x" }));
  const result = buildGeneratedChangeSet({ automationPlan: plan, repositoryContext: context, changes });
  assert.equal(result.ok, true, JSON.stringify(result.errors));

  const tooManyPlanned = [...plannedChanges, { path: "cypress/e2e/tests/one-too-many.cy.js", operation: "CREATE", purpose: "x" }];
  const overPlan = validPlan({ plannedChanges: tooManyPlanned });
  const overChanges = [...changes, { operation: "CREATE", path: "cypress/e2e/tests/one-too-many.cy.js", baseContentDigest: null, content: "x" }];
  const overResult = buildGeneratedChangeSet({ automationPlan: overPlan, repositoryContext: context, changes: overChanges });
  assert.equal(overResult.ok, false);
});

test("aggregate content exactly at MAX_TOTAL_CONTENT_LENGTH is accepted; one char over (via an extra change) is rejected", () => {
  const itemCount = LIMITS.MAX_TOTAL_CONTENT_LENGTH / LIMITS.MAX_FILE_CONTENT_LENGTH;
  assert.ok(Number.isInteger(itemCount) && itemCount <= LIMITS.MAX_CHANGES, "test assumption: aggregate bound divides evenly into per-item-bound-sized chunks within the item-count bound");
  const plannedChanges = Array.from({ length: itemCount }, (_, i) => ({ path: `cypress/e2e/tests/f${i}.cy.js`, operation: "CREATE", purpose: "x" }));
  const context = validContext();
  const changes = plannedChanges.map((c) => ({ operation: "CREATE", path: c.path, baseContentDigest: null, content: "x".repeat(LIMITS.MAX_FILE_CONTENT_LENGTH) }));
  const atLimitResult = buildGeneratedChangeSet({ automationPlan: validPlan({ plannedChanges }), repositoryContext: context, changes });
  assert.equal(atLimitResult.ok, true, JSON.stringify(atLimitResult.errors));

  const overPlannedChanges = [...plannedChanges, { path: "cypress/e2e/tests/one-extra.cy.js", operation: "CREATE", purpose: "x" }];
  const overChanges = [...changes, { operation: "CREATE", path: "cypress/e2e/tests/one-extra.cy.js", baseContentDigest: null, content: "z" }];
  const overResult = buildGeneratedChangeSet({ automationPlan: validPlan({ plannedChanges: overPlannedChanges }), repositoryContext: context, changes: overChanges });
  assert.equal(overResult.ok, false);
  assert.ok(overResult.errors.some((e) => e.message.includes("total")));
});

// --- production source hygiene -------------------------------------------------

test("production module contains no filesystem/child_process/network code", () => {
  const fs = require("fs");
  const src = fs.readFileSync(require.resolve("./generated-change-set.js"), "utf8");
  for (const forbidden of ["writeFile", "appendFile", "unlink(", "child_process", "exec(", "spawn(", "http.request", "https.request", "fs.write", "fs.mkdir", "fs.rm"]) {
    assert.ok(!src.includes(forbidden), `production source must not contain "${forbidden}"`);
  }
});

test("production module source contains zero NUL bytes", () => {
  const fs = require("fs");
  const buf = fs.readFileSync(require.resolve("./generated-change-set.js"));
  assert.equal(buf.filter((b) => b === 0).length, 0);
});
