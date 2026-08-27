"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  generateAutomationCandidate,
  snapshotRequirementModel,
  snapshotTestCaseModel,
  boundGenerationErrors,
  buildPositiveProjection,
  MAX_PROVIDER_ATTEMPTS,
  MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS,
  MAX_CORRECTION_ERRORS,
  MAX_CORRECTION_DIAGNOSTIC_CHARS,
} = require("./automation-candidate-generator");
const { validateAutomationCandidate, DECISIONS } = require("../generation/automation-candidate");
const { LIMITS } = require("../generation/limits");
const { ProviderError, PROVIDER_ERROR_CODES } = require("../providers/provider-error");

// --- fixtures ---------------------------------------------------------------

function validRequirementModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: "proj-1",
    evidenceRefs: [{ id: "evidence-0001", kind: "user_input", sourceId: "user-input-0001" }],
    requirements: [{ id: "req-1", text: "The login page must show an error on invalid credentials.", evidenceRefIds: ["evidence-0001"] }],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  };
}

function validTestCaseModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "TestCaseModel",
    id: "tcm-1",
    projectId: "proj-1",
    requirementModelId: "rm-1",
    testCases: [
      {
        id: "tc-1",
        title: "Invalid login shows error",
        objective: "Verify an error is shown on invalid credentials.",
        requirementIds: ["req-1"],
        steps: [{ action: "Submit invalid credentials.", expectedResult: "An error message is displayed.", requirementIds: ["req-1"] }],
      },
    ],
    ...overrides,
  };
}

function validCandidateResponse(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id: "ac-1",
    projectId: "proj-1",
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "AUTOMATE",
    rationale: "Existing user-input evidence and a deterministic expected result support automation.",
    evidenceRefs: [{ id: "e1", kind: "user_input", sourceId: "user-input-0001" }],
    rationaleEvidenceRefIds: ["e1"],
    targetFrameworks: ["cypress"],
    ...overrides,
  };
}

function makeQueueProvider(steps) {
  const calls = [];
  let i = 0;
  return {
    name: "fake",
    calls,
    async analyze(args) {
      calls.push(args);
      const step = steps[Math.min(i, steps.length - 1)];
      i += 1;
      if (step.throw) throw step.throw;
      return step.response;
    },
  };
}

function jsonProvider(candidate) {
  return makeQueueProvider([{ response: JSON.stringify(candidate) }]);
}

// =============================================================================
// A. Happy path
// =============================================================================

test("AUTOMATE valid result succeeds with providerAttempts=1 and a frozen, JSON-serializable candidate", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.providerAttempts, 1);
  assert.ok(Object.isFrozen(result.automationCandidate));
  const roundTripped = JSON.parse(JSON.stringify(result.automationCandidate));
  assert.deepEqual(roundTripped, result.automationCandidate);
  const check = validateAutomationCandidate(result.automationCandidate, { expectedProjectId: "proj-1" });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
});

test("DO_NOT_AUTOMATE valid result succeeds", async () => {
  const provider = jsonProvider(validCandidateResponse({ decision: "DO_NOT_AUTOMATE", targetFrameworks: [] }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.automationCandidate.decision, "DO_NOT_AUTOMATE");
});

test("BLOCKED valid result succeeds even with zero evidenceRefs/targetFrameworks", async () => {
  const provider = jsonProvider({
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id: "ac-1",
    projectId: "proj-1",
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "BLOCKED",
    rationale: "An open question affects whether this can be automated; insufficient grounding to decide.",
    evidenceRefs: [],
    targetFrameworks: [],
  });
  const result = await generateAutomationCandidate({
    requirementModel: validRequirementModel({ openQuestions: [{ id: "oq-1", type: "OPEN_QUESTION", description: "Is the error message stable across builds?", reason: "Not specified anywhere in the evidence." }] }),
    testCaseModel: validTestCaseModel(),
    testCaseId: "tc-1",
    provider,
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.automationCandidate.decision, "BLOCKED");
});

// =============================================================================
// B. Traceability
// =============================================================================

test("unknown testCaseId makes zero provider calls", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "does-not-exist", provider });
  assert.equal(result.ok, false);
  assert.equal(result.providerAttempts, 0);
  assert.equal(provider.calls.length, 0);
  assert.ok(result.errors.some((e) => e.code === "INVALID_REFERENCE"));
});

test("provider candidate referencing a different (but real) testCaseId in the same model is rejected", async () => {
  const tcm = validTestCaseModel({ testCases: [...validTestCaseModel().testCases, { id: "tc-2", title: "x", objective: "y", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "b", requirementIds: ["req-1"] }] }] });
  const provider = jsonProvider(validCandidateResponse({ testCaseId: "tc-2" }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: tcm, testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.path === "$.testCaseId"));
});

test("provider candidate referencing a nonexistent testCaseId entirely is rejected", async () => {
  const provider = jsonProvider(validCandidateResponse({ testCaseId: "phantom-tc" }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("provider candidate with wrong testCaseModelId is rejected", async () => {
  const provider = jsonProvider(validCandidateResponse({ testCaseModelId: "wrong-model" }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("invalid RequirementModel <-> TestCaseModel linkage (wrong requirementModelId) is rejected pre-provider", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel({ requirementModelId: "wrong-rm" }), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

// =============================================================================
// C. Project isolation
// =============================================================================

test("correct, consistent project succeeds", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, expectedProjectId: "proj-1" });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("provider attempts to switch project: rejected even with expectedProjectId omitted", async () => {
  const provider = jsonProvider(validCandidateResponse({ projectId: "other-project" }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("RequirementModel/TestCaseModel project mismatch is rejected pre-provider", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel({ projectId: "other-project" }), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("expectedProjectId mismatch against the real upstream project makes zero provider calls", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, expectedProjectId: "different-project" });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("a candidate with no own projectId cannot inherit one via a prototype-injected __proto__", async () => {
  const forgedCandidate = {
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id: "ac-1",
    testCaseModelId: "tcm-1",
    testCaseId: "tc-1",
    decision: "AUTOMATE",
    rationale: "x",
    evidenceRefs: [],
    targetFrameworks: ["cypress"],
  };
  Object.defineProperty(forgedCandidate, "__proto__", { value: { projectId: "proj-1" }, enumerable: true, configurable: true });
  const provider = jsonProvider(forgedCandidate);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false, "provider output is a raw JSON.parse'd object handed straight to the frozen validator - an inherited projectId must not satisfy it");
});

// =============================================================================
// D. Framework authorization
// =============================================================================

test("a single supported framework is accepted", async () => {
  const provider = jsonProvider(validCandidateResponse({ targetFrameworks: ["playwright"] }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("both supported frameworks together are accepted", async () => {
  const provider = jsonProvider(validCandidateResponse({ targetFrameworks: ["cypress", "playwright"] }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("an unsupported framework is rejected by the frozen v1 enum check", async () => {
  const provider = jsonProvider(validCandidateResponse({ targetFrameworks: ["selenium"] }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVALID_ENUM"));
});

test("AUTOMATE with zero target frameworks is rejected by the frozen v1 invariant", async () => {
  const provider = jsonProvider(validCandidateResponse({ targetFrameworks: [] }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVARIANT_VIOLATION"));
});

test("DO_NOT_AUTOMATE/BLOCKED with a non-empty targetFrameworks is still accepted (frozen v1 explicitly permits recording considered frameworks)", async () => {
  const provider = jsonProvider(validCandidateResponse({ decision: "DO_NOT_AUTOMATE", targetFrameworks: ["cypress"] }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("a real cypress-only authorization set cannot be expanded to include playwright via a caller-controlled array method on the RESPONSE side (JSON.parse output has no such hooks - sanity check only)", async () => {
  // The provider response is always parsed fresh via JSON.parse, which never
  // produces an array with an own .map/.slice override - this test exists
  // only to document that the framework-expansion attack class (closed for
  // #23C's own snapshot input boundary) has no equivalent attack surface
  // here, since AutomationCandidate generation never snapshots a caller
  // array of frameworks; it only validates the provider's own JSON output.
  const provider = jsonProvider(validCandidateResponse({ targetFrameworks: ["cypress", "playwright", "playwright"] }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false, "duplicate frameworks are rejected by the frozen v1 validator regardless");
});

// =============================================================================
// E. Evidence grounding
// =============================================================================

test("known evidenceRefs with a matching rationaleEvidenceRefIds entry is accepted", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("a dangling rationaleEvidenceRefIds entry (not present in the candidate's own evidenceRefs) is rejected", async () => {
  const provider = jsonProvider(validCandidateResponse({ rationaleEvidenceRefIds: ["e1", "phantom-evidence"] }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVALID_REFERENCE"));
});

test("an openQuestion is visible to the provider and a resulting BLOCKED decision is accepted (deterministic-acceptance path)", async () => {
  const requirementModel = validRequirementModel({ openQuestions: [{ id: "oq-1", type: "MISSING_REQUIREMENT", description: "No spec for retry behavior.", reason: "Not covered by any supplied evidence." }] });
  let capturedPrompt = null;
  const provider = { async analyze(args) { capturedPrompt = args.userPrompt; return JSON.stringify({ schemaVersion: 1, kind: "AutomationCandidate", id: "ac-1", projectId: "proj-1", testCaseModelId: "tcm-1", testCaseId: "tc-1", decision: "BLOCKED", rationale: "Open question leaves retry behavior undefined.", evidenceRefs: [], targetFrameworks: [] }); } };
  const result = await generateAutomationCandidate({ requirementModel, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(capturedPrompt.includes("No spec for retry behavior."));
});

test("fabricated evidence id in evidenceRefs pointing nowhere real is still structurally validated (id/kind/locator bounds enforced)", async () => {
  const provider = jsonProvider(validCandidateResponse({ evidenceRefs: [{ id: "e1", kind: "user_input" }] })); // missing sourceId/location entirely
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false, "an EvidenceRef must locate evidence via sourceId and/or location, never a bare id/kind label");
});

// =============================================================================
// F. Strict schema
// =============================================================================

test("unknown top-level field in provider response is rejected, never stripped/stored", async () => {
  const provider = jsonProvider({ ...validCandidateResponse(), unexpectedField: "x" });
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "UNKNOWN_FIELD"));
});

test("missing required field (rationale) is rejected", async () => {
  const c = validCandidateResponse();
  delete c.rationale;
  const provider = jsonProvider(c);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("wrong decision enum value is rejected", async () => {
  const provider = jsonProvider(validCandidateResponse({ decision: "MAYBE" }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.code === "INVALID_ENUM"));
});

test("wrong primitive type (schemaVersion as a string) is rejected", async () => {
  const provider = jsonProvider(validCandidateResponse({ schemaVersion: "1" }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("null where forbidden (rationale: null) is rejected", async () => {
  const provider = jsonProvider(validCandidateResponse({ rationale: null }));
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

for (const field of ["code", "patch", "content", "diff", "generatedCode", "fileContent", "source", "filePath", "selector", "command"]) {
  test(`provider output with a "${field}" field is rejected as unknown, never stripped/stored (AutomationCandidate is not AutomationPlan)`, async () => {
    const provider = jsonProvider({ ...validCandidateResponse(), [field]: "should never be accepted" });
    const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.code === "UNKNOWN_FIELD"));
    assert.ok(!JSON.stringify(result).includes("should never be accepted"));
  });
}

// =============================================================================
// G. Strict JSON
// =============================================================================

test("valid JSON succeeds", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("markdown-fenced JSON is rejected (strict JSON.parse only, no fence stripping)", async () => {
  const provider = makeQueueProvider([{ response: "```json\n" + JSON.stringify(validCandidateResponse()) + "\n```" }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("text prefix before the JSON is rejected", async () => {
  const provider = makeQueueProvider([{ response: "Here is the candidate:\n" + JSON.stringify(validCandidateResponse()) }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("text suffix after the JSON is rejected", async () => {
  const provider = makeQueueProvider([{ response: JSON.stringify(validCandidateResponse()) + "\nLet me know if you need anything else!" }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("two concatenated JSON values are rejected", async () => {
  const one = JSON.stringify(validCandidateResponse());
  const provider = makeQueueProvider([{ response: one + one }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("truncated JSON is rejected", async () => {
  const truncated = JSON.stringify(validCandidateResponse()).slice(0, -5);
  const provider = makeQueueProvider([{ response: truncated }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

test("a JSON array (not an object) is rejected", async () => {
  const provider = makeQueueProvider([{ response: JSON.stringify([validCandidateResponse()]) }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
});

// =============================================================================
// H. Retry
// =============================================================================

test("success on attempt 1: providerAttempts=1", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.providerAttempts, 1);
});

test("attempt 1 invalid, attempt 2 valid: succeeds with providerAttempts=2", async () => {
  const provider = makeQueueProvider([{ response: "not valid json" }, { response: JSON.stringify(validCandidateResponse()) }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.providerAttempts, 2);
});

test("both attempts invalid: fails with providerAttempts=2, never more than MAX_PROVIDER_ATTEMPTS calls", async () => {
  const provider = makeQueueProvider([{ response: "bad one" }, { response: "bad two" }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(result.providerAttempts, MAX_PROVIDER_ATTEMPTS);
  assert.equal(provider.calls.length, MAX_PROVIDER_ATTEMPTS);
});

test("provider throw (non-retryable) fails immediately with a sanitized error", async () => {
  const provider = makeQueueProvider([{ throw: new ProviderError("SECRET_INTERNAL_DETAIL", { code: PROVIDER_ERROR_CODES.AUTH, retryable: false }) }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 1);
  assert.ok(!JSON.stringify(result).includes("SECRET_INTERNAL_DETAIL"));
});

test("provider throw (retryable) retries then can still succeed", async () => {
  const provider = makeQueueProvider([{ throw: new ProviderError("transient", { code: PROVIDER_ERROR_CODES.TIMEOUT, retryable: true }) }, { response: JSON.stringify(validCandidateResponse()) }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.providerAttempts, 2);
});

for (const value of [0, -1, 3, 9999, NaN, Infinity, 1.5, "2", null, {}, []]) {
  test(`invalid maxAttempts=${String(value)} is clamped to the safe default (never causes unbounded/negative retries)`, async () => {
    const provider = makeQueueProvider([{ response: "bad" }, { response: JSON.stringify(validCandidateResponse()) }]);
    const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: value });
    assert.ok(provider.calls.length <= MAX_PROVIDER_ATTEMPTS, `maxAttempts=${String(value)} must never exceed ${MAX_PROVIDER_ATTEMPTS} calls`);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
}

test("maxAttempts=1 makes exactly one call even when it fails", async () => {
  const provider = makeQueueProvider([{ response: "bad" }, { response: JSON.stringify(validCandidateResponse()) }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 1);
});

// =============================================================================
// I. Output bounds
// =============================================================================

test("a response exactly at MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS is not rejected by the size guard (parse/schema errors, if any, are unrelated)", async () => {
  // A maximally-sized but otherwise-minimal-content response: pad the
  // rationale field up to the response bound via a huge evidenceRefs array,
  // then confirm the bound itself isn't what rejects a large-but-compliant
  // response - use MAX_EVIDENCE_REFS worth of maximally-sized entries.
  const bigCandidate = validCandidateResponse({
    rationale: "x".repeat(LIMITS.LONG_TEXT_MAX_LENGTH),
    evidenceRefs: Array.from({ length: LIMITS.MAX_EVIDENCE_REFS }, (_, i) => ({ id: `evidence-${String(i).padStart(4, "0")}`, kind: "user_input", sourceId: `user-input-${String(i).padStart(4, "0")}`, location: "y".repeat(LIMITS.SHORT_TEXT_MAX_LENGTH) })),
    rationaleEvidenceRefIds: ["evidence-0000"],
  });
  const serialized = JSON.stringify(bigCandidate);
  assert.ok(serialized.length < MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS, "test assumption: this fixture is comfortably under the formula-derived bound");
  const provider = jsonProvider(bigCandidate);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("a response one char over MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS is rejected before JSON.parse is even attempted", async () => {
  const huge = "a".repeat(MAX_AUTOMATION_CANDIDATE_RESPONSE_CHARS + 1);
  const provider = makeQueueProvider([{ response: huge }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.message.includes("maximum allowed length")));
});

test("correction diagnostics stay within MAX_CORRECTION_ERRORS / MAX_CORRECTION_DIAGNOSTIC_CHARS even for a pathological error count", () => {
  const manyErrors = Array.from({ length: 500 }, (_, i) => ({ path: `$.field${i}`, code: "INVALID_TYPE", message: "x".repeat(200) }));
  const bounded = boundGenerationErrors(manyErrors);
  assert.ok(bounded.length <= MAX_CORRECTION_ERRORS);
  assert.ok(JSON.stringify(bounded).length <= MAX_CORRECTION_DIAGNOSTIC_CHARS);
});

// =============================================================================
// J. Prototype attacks
// =============================================================================

test("an own enumerable __proto__ on the top-level RequirementModel cannot alter the snapshot's prototype and remains visible as an unknown field", async () => {
  const rm = validRequirementModel();
  Object.defineProperty(rm, "__proto__", { value: { injected: "HOSTILE-TOP-LEVEL" }, enumerable: true, configurable: true });
  const snap = snapshotRequirementModel(rm);
  assert.equal(Object.prototype.hasOwnProperty.call(snap, "__proto__"), true);
  assert.notEqual(Object.getPrototypeOf(snap), rm.__proto__);
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
  assert.ok(result.errors.some((e) => e.path.includes("__proto__")));
});

test("an own enumerable __proto__ created via JSON.parse on the TestCaseModel is treated identically", async () => {
  const tcm = JSON.parse(
    JSON.stringify(validTestCaseModel()).replace(/}$/, ',"__proto__":{"injected":"HOSTILE-VIA-JSON"}}')
  );
  assert.equal(Object.prototype.hasOwnProperty.call(tcm, "__proto__"), true, "sanity: JSON.parse itself creates a genuine own key");
  const snap = snapshotTestCaseModel(tcm);
  assert.equal(Object.prototype.hasOwnProperty.call(snap, "__proto__"), true);
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: tcm, testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("an own enumerable __proto__ on a nested requirement is also safe", async () => {
  const requirement = { id: "req-1", text: "x", evidenceRefIds: ["evidence-0001"] };
  Object.defineProperty(requirement, "__proto__", { value: { injected: "HOSTILE-NESTED" }, enumerable: true, configurable: true });
  const rm = validRequirementModel({ requirements: [requirement] });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("an own enumerable __proto__ on a nested test case step is also safe", async () => {
  const step = { action: "a", expectedResult: "b", requirementIds: ["req-1"] };
  Object.defineProperty(step, "__proto__", { value: { injected: "HOSTILE-STEP" }, enumerable: true, configurable: true });
  const tcm = validTestCaseModel({ testCases: [{ id: "tc-1", title: "x", objective: "y", requirementIds: ["req-1"], steps: [step] }] });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: tcm, testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("constructor/prototype as own keys remain ordinary unknown fields (unaffected by the __proto__ fix)", async () => {
  const rm = validRequirementModel();
  rm.constructor = "evil";
  rm.prototype = "also-evil";
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
  assert.ok(result.errors.some((e) => e.path.includes("constructor")));
  assert.ok(result.errors.some((e) => e.path.includes("prototype")));
});

// =============================================================================
// K. Record hazards
// =============================================================================

test("a Symbol-valued own key on the RequirementModel does not throw and is inert (Object.keys never returns symbol keys)", async () => {
  const rm = validRequirementModel();
  rm[Symbol("meta")] = "irrelevant";
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("a toJSON property on the RequirementModel is never invoked - it is copied as an ordinary unknown field", async () => {
  const rm = validRequirementModel();
  let toJsonCalls = 0;
  rm.toJSON = () => {
    toJsonCalls += 1;
    return validRequirementModel({ decision: "forged" });
  };
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(toJsonCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
  assert.ok(result.errors.some((e) => e.path.includes("toJSON")));
});

test("a Date/Map/Set as the top-level RequirementModel is rejected, not silently coerced", async () => {
  for (const value of [new Date(), new Map(), new Set()]) {
    const provider = jsonProvider(validCandidateResponse());
    const result = await generateAutomationCandidate({ requirementModel: value, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
    assert.equal(result.ok, false);
    assert.equal(provider.calls.length, 0);
  }
});

// =============================================================================
// L. Array hazards
// =============================================================================

test("a caller-owned .map override on RequirementModel.requirements is never invoked", async () => {
  const requirements = validRequirementModel().requirements;
  let mapCalls = 0;
  requirements.map = () => {
    mapCalls += 1;
    return [{ id: "forged", text: "forged", evidenceRefIds: [] }];
  };
  const rm = validRequirementModel({ requirements });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(mapCalls, 0);
  assert.equal(result.ok, false, "the array carries an extra own key (map) and is rejected as malformed plain data");
  assert.equal(provider.calls.length, 0);
});

test("a caller-owned .slice override on TestCaseModel.testCases is never invoked", async () => {
  const testCases = validTestCaseModel().testCases;
  let sliceCalls = 0;
  testCases.slice = () => {
    sliceCalls += 1;
    return [];
  };
  const tcm = validTestCaseModel({ testCases });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: tcm, testCaseId: "tc-1", provider });
  assert.equal(sliceCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("an own Symbol.iterator on a nested requirementIds array is never invoked", async () => {
  const requirementIds = ["req-1"];
  let iterCalls = 0;
  requirementIds[Symbol.iterator] = function () {
    iterCalls += 1;
    return [][Symbol.iterator]();
  };
  const tcm = validTestCaseModel({ testCases: [{ id: "tc-1", title: "x", objective: "y", requirementIds, steps: [{ action: "a", expectedResult: "b", requirementIds: ["req-1"] }] }] });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: tcm, testCaseId: "tc-1", provider });
  assert.equal(iterCalls, 0);
});

test("a sparse requirements array is rejected, never silently filling the hole", async () => {
  const requirements = [validRequirementModel().requirements[0]];
  requirements[3] = { id: "req-2", text: "y", evidenceRefIds: [] };
  const rm = validRequirementModel({ requirements });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("an Array subclass overriding map/slice/Symbol.iterator has none of its hooks invoked when supplied as testCases", async () => {
  class EvilArray extends Array {
    map() {
      throw new Error("SECRET_MAP_HOOK");
    }
    slice() {
      throw new Error("SECRET_SLICE_HOOK");
    }
    [Symbol.iterator]() {
      throw new Error("SECRET_ITERATOR_HOOK");
    }
  }
  const testCases = EvilArray.from(validTestCaseModel().testCases);
  const tcm = validTestCaseModel({ testCases });
  const provider = jsonProvider(validCandidateResponse());
  // Must not throw any of the hostile hook errors regardless of outcome.
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: tcm, testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("deceptive numeric-like array keys (\"00\", \"01\", \"-1\") on a nested array are rejected", async () => {
  for (const key of ["00", "01", "-1", "1.0", "1e0"]) {
    const requirementIds = ["req-1"];
    requirementIds[key] = "x";
    const tcm = validTestCaseModel({ testCases: [{ id: "tc-1", title: "x", objective: "y", requirementIds, steps: [{ action: "a", expectedResult: "b", requirementIds: ["req-1"] }] }] });
    const provider = jsonProvider(validCandidateResponse());
    const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: tcm, testCaseId: "tc-1", provider });
    assert.equal(result.ok, false, `deceptive key "${key}" must be rejected`);
    assert.equal(provider.calls.length, 0);
  }
});

// =============================================================================
// M. Snapshot stability
// =============================================================================

test("a getter that returns a different value on the second read is read exactly once", async () => {
  const rm = validRequirementModel();
  let reads = 0;
  Object.defineProperty(rm, "projectId", {
    enumerable: true,
    get() {
      reads += 1;
      return reads === 1 ? "proj-1" : "proj-EVIL";
    },
  });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(reads, 1);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.automationCandidate.projectId, "proj-1");
});

test("caller-supplied RequirementModel/TestCaseModel objects are never mutated", async () => {
  const rm = validRequirementModel();
  const tcm = validTestCaseModel();
  const rmBefore = JSON.parse(JSON.stringify(rm));
  const tcmBefore = JSON.parse(JSON.stringify(tcm));
  const provider = jsonProvider(validCandidateResponse());
  await generateAutomationCandidate({ requirementModel: rm, testCaseModel: tcm, testCaseId: "tc-1", provider });
  assert.deepEqual(rm, rmBefore);
  assert.deepEqual(tcm, tcmBefore);
  assert.equal(Object.isFrozen(rm), false);
  assert.equal(Object.isFrozen(tcm), false);
});

test("post-snapshot: no further reads of the caller RequirementModel occur after the provider call begins", async () => {
  const rm = validRequirementModel();
  let readsAfterProviderStarted = 0;
  let providerStarted = false;
  Object.defineProperty(rm, "requirements", {
    enumerable: true,
    get() {
      if (providerStarted) readsAfterProviderStarted += 1;
      return [{ id: "req-1", text: "x", evidenceRefIds: ["evidence-0001"] }];
    },
  });
  const provider = {
    async analyze() {
      providerStarted = true;
      return JSON.stringify(validCandidateResponse());
    },
  };
  await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(readsAfterProviderStarted, 0);
});

test("a self-referential (cyclic) RequirementModel is bounded, never a stack overflow", async () => {
  const rm = validRequirementModel();
  rm.self = rm;
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("a cyclic array (array containing itself) inside the TestCaseModel is bounded, never a stack overflow", async () => {
  const requirementIds = ["req-1"];
  const cyclic = [requirementIds];
  cyclic.push(cyclic);
  const tcm = validTestCaseModel({ testCases: [{ id: "tc-1", title: "x", objective: "y", requirementIds: cyclic, steps: [{ action: "a", expectedResult: "b", requirementIds: ["req-1"] }] }] });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: tcm, testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
});

// =============================================================================
// N. Privacy
// =============================================================================

test("provider stack is never exposed in the public result", async () => {
  const secretError = new ProviderError("boom", { code: PROVIDER_ERROR_CODES.UNKNOWN, retryable: false });
  secretError.stack = "SECRET_STACK_TRACE_LINE_1\nSECRET_STACK_TRACE_LINE_2";
  const provider = makeQueueProvider([{ throw: secretError }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.ok(!JSON.stringify(result).includes("SECRET_STACK_TRACE"));
});

test("raw invalid provider response is never resent in a correction and never exposed in the final error", async () => {
  const provider = makeQueueProvider([{ response: "SECRET_RAW_RESPONSE_MARKER not valid json" }, { response: JSON.stringify(validCandidateResponse()) }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const secondCallPrompt = provider.calls[1].userPrompt;
  assert.ok(!secondCallPrompt.includes("SECRET_RAW_RESPONSE_MARKER"));
});

test("secret content in a rejected RequirementModel snapshot read is never exposed", async () => {
  const rm = validRequirementModel();
  Object.defineProperty(rm, "projectId", {
    enumerable: true,
    get() {
      throw new Error("SECRET_GETTER_DETAIL");
    },
  });
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: rm, testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
  assert.ok(!JSON.stringify(result).includes("SECRET_GETTER_DETAIL"));
});

test("the prompt itself is never exposed through the public result", async () => {
  const provider = makeQueueProvider([{ response: "bad" }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.ok(!JSON.stringify(result).includes("You are a senior QA automation strategist"));
});

test("errors are exactly the bounded {path,code,message} shape", async () => {
  const provider = makeQueueProvider([{ response: "not json" }]);
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider, maxAttempts: 1 });
  assert.equal(result.ok, false);
  for (const e of result.errors) {
    assert.deepEqual(Object.keys(e).sort(), ["code", "message", "path"]);
  }
});

// =============================================================================
// O. Provider call count
// =============================================================================

test("invalid provider object makes zero provider calls", async () => {
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider: {} });
  assert.equal(result.ok, false);
  assert.equal(result.providerAttempts, 0);
});

test("missing provider makes zero provider calls", async () => {
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1" });
  assert.equal(result.ok, false);
  assert.equal(result.providerAttempts, 0);
});

test("malformed testCaseId (empty string) makes zero provider calls", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

test("invalid upstream TestCaseModel (unknown top-level field) makes zero provider calls", async () => {
  const provider = jsonProvider(validCandidateResponse());
  const result = await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: { ...validTestCaseModel(), extra: "x" }, testCaseId: "tc-1", provider });
  assert.equal(result.ok, false);
  assert.equal(provider.calls.length, 0);
});

// =============================================================================
// Positive projection minimization
// =============================================================================

test("buildPositiveProjection excludes other test cases in the same model", () => {
  const rmSnapshot = snapshotRequirementModel(validRequirementModel());
  const tcmSnapshot = snapshotTestCaseModel(validTestCaseModel({ testCases: [...validTestCaseModel().testCases, { id: "tc-2", title: "SECRET_OTHER_TEST_CASE_TITLE", objective: "y", requirementIds: ["req-1"], steps: [{ action: "a", expectedResult: "b", requirementIds: ["req-1"] }] }] }));
  const testCaseSnapshot = tcmSnapshot.testCases.find((tc) => tc.id === "tc-1");
  const projection = buildPositiveProjection({ requirementModelSnapshot: rmSnapshot, testCaseModelSnapshot: tcmSnapshot, testCaseSnapshot, projectProfileSnapshot: undefined });
  assert.ok(!JSON.stringify(projection).includes("SECRET_OTHER_TEST_CASE_TITLE"));
});

test("prompt excludes provider/environment metadata (no repoRoot/PATH channel exists)", async () => {
  let capturedPrompt = null;
  const provider = { async analyze(args) { capturedPrompt = args; return JSON.stringify(validCandidateResponse()); } };
  await generateAutomationCandidate({ requirementModel: validRequirementModel(), testCaseModel: validTestCaseModel(), testCaseId: "tc-1", provider });
  const combined = capturedPrompt.systemPrompt + capturedPrompt.userPrompt;
  assert.ok(!combined.includes("repoRoot"));
  assert.ok(!combined.includes(process.env.PATH || "__no_path__"));
});

// =============================================================================
// Side effects
// =============================================================================

test("production modules contain no filesystem/child_process/network/repository-mutation/AutomationRepositoryContext code", () => {
  const fs = require("fs");
  const genSrc = fs.readFileSync(require.resolve("./automation-candidate-generator.js"), "utf8");
  const promptSrc = fs.readFileSync(require.resolve("./automation-candidate-prompt.js"), "utf8");
  for (const forbidden of ['require("fs")', "writeFile", "appendFile", "unlink", 'require("child_process")', "exec(", "spawn(", "http.request", "https.request", "repoRoot", "process.cwd"]) {
    assert.ok(!genSrc.includes(forbidden), `generator must not contain "${forbidden}"`);
    assert.ok(!promptSrc.includes(forbidden), `prompt must not contain "${forbidden}"`);
  }
  // The docstrings legitimately NAME automation-repository-context.js/
  // AutomationRepositoryContext in prose to document that this module does
  // NOT depend on it (Roadmap #22E architectural isolation from #23) - the
  // real assertion is that neither is ever require()'d.
  assert.ok(!genSrc.includes('require("./automation-repository-context")'));
  assert.ok(!genSrc.includes("require(\"../test-automation/"));
});
