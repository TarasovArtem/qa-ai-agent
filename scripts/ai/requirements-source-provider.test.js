"use strict";

/**
 * Roadmap RTI-6 (External Requirements Source Provider Contract): unit
 * coverage for scripts/ai/requirements-source-provider.js - the generic,
 * explicit boundary through which arbitrary caller-supplied providers
 * normalize external data into RTI-1 RequirementArtifact[]. Covers the
 * full provider-shape matrix (async/sync/class/getter/hostile), the
 * trusted-provider/untrusted-returned-data trust-boundary split, the
 * secret-safe error-wrapping invariant, duplicate/atomicity policy, and
 * copy/freeze/order/determinism semantics - using only fake, in-process
 * providers (no real vendor system, no network, no credentials).
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { loadRequirementsFromProvider } = require("./requirements-source-provider");

function artifact(overrides = {}) {
  return {
    id: "REQ-1",
    type: "requirement",
    title: "Example requirement",
    content: "c",
    source: { type: "file", location: "x" },
    ...overrides,
  };
}

function fakeProvider(overrides = {}) {
  return {
    id: "fake-provider",
    async read() {
      return [artifact()];
    },
    ...overrides,
  };
}

// --- valid providers (§71-75) -----------------------------------------

test("RTI-6 (§71): a valid async provider succeeds", async () => {
  const result = await loadRequirementsFromProvider(fakeProvider());
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "REQ-1");
});

test("RTI-6 (§72): a valid sync-return provider succeeds through uniform await", async () => {
  const provider = { id: "fake-sync", read: () => [artifact({ id: "REQ-SYNC" })] };
  const result = await loadRequirementsFromProvider(provider);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "REQ-SYNC");
});

test("RTI-6 (§73/§74): a class provider with a getter-backed id and this-binding-dependent read() succeeds", async () => {
  class FakeProvider {
    constructor() {
      this._id = "class-provider";
      this._artifacts = [artifact({ id: "REQ-CLASS" })];
    }
    get id() {
      return this._id;
    }
    async read() {
      // Relies on `this` - proves method invocation (not destructuring) is used.
      return this._artifacts;
    }
  }
  const result = await loadRequirementsFromProvider(new FakeProvider());
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "REQ-CLASS");
});

test("RTI-6 (§75): an empty provider result is valid, returns a frozen empty array", async () => {
  const provider = fakeProvider({ read: async () => [] });
  const result = await loadRequirementsFromProvider(provider);
  assert.deepEqual(result, []);
  assert.ok(Object.isFrozen(result));
});

// --- provider missing / shape matrix (§76-78) ---------------------------

test("RTI-6 (§76): undefined/null provider rejects with PROVIDER_REQUIRED", async () => {
  await assert.rejects(() => loadRequirementsFromProvider(undefined), /REQUIREMENTS_SOURCE_PROVIDER_REQUIRED/);
  await assert.rejects(() => loadRequirementsFromProvider(null), /REQUIREMENTS_SOURCE_PROVIDER_REQUIRED/);
});

test("RTI-6 (§77): malformed provider shapes all reject with PROVIDER_INVALID", async () => {
  const malformed = [{}, { id: "" }, { id: 123 }, { id: "x" }, { id: "x", read: 123 }, "not an object", 42];
  for (const bad of malformed) {
    await assert.rejects(() => loadRequirementsFromProvider(bad), /REQUIREMENTS_SOURCE_PROVIDER_INVALID/, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

test("RTI-6 (§78): provider id bound/control-character checks reject correctly", async () => {
  const tooLong = { id: "x".repeat(201), read: async () => [] };
  await assert.rejects(() => loadRequirementsFromProvider(tooLong), /REQUIREMENTS_SOURCE_PROVIDER_INVALID/);
  for (const bad of ["\n", "\r", "\t", "id\x00withNul", "valid\x1Fid"]) {
    const provider = { id: bad, read: async () => [] };
    await assert.rejects(() => loadRequirementsFromProvider(provider), /REQUIREMENTS_SOURCE_PROVIDER_INVALID/, `expected rejection for control-char id ${JSON.stringify(bad)}`);
  }
});

// --- provider read failure / secret-safety (§79-80, §107) --------------

test("RTI-6 (§79): a synchronously-throwing provider.read() wraps with READ_FAILED, cause preserved, outer message excludes secret", async () => {
  const secretError = new Error("request failed https://host?token=SECRET123&password=hunter2");
  const provider = fakeProvider({ read: () => { throw secretError; } });
  try {
    await loadRequirementsFromProvider(provider);
    assert.fail("expected rejection");
  } catch (err) {
    assert.match(err.message, /REQUIREMENTS_SOURCE_READ_FAILED/);
    assert.equal(err.message.includes("SECRET123"), false);
    assert.equal(err.message.includes("hunter2"), false);
    assert.equal(err.cause, secretError);
  }
});

test("RTI-6 (§80): an async provider whose promise rejects wraps with READ_FAILED, cause preserved, outer message excludes secret", async () => {
  const secretError = new Error("Authorization: Bearer token=XYZ_SECRET");
  const provider = fakeProvider({ read: async () => { throw secretError; } });
  try {
    await loadRequirementsFromProvider(provider);
    assert.fail("expected rejection");
  } catch (err) {
    assert.match(err.message, /REQUIREMENTS_SOURCE_READ_FAILED/);
    assert.equal(err.message.includes("XYZ_SECRET"), false);
    assert.equal(err.cause, secretError);
  }
});

// --- invalid output type matrix (§81) -----------------------------------

test("RTI-6 (§81): non-array read() output rejects with OUTPUT_INVALID", async () => {
  const invalidOutputs = [null, undefined, {}, "requirements", new Set([artifact()]), 42];
  for (const bad of invalidOutputs) {
    const provider = fakeProvider({ read: async () => bad });
    await assert.rejects(() => loadRequirementsFromProvider(provider), /REQUIREMENTS_SOURCE_OUTPUT_INVALID/, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

// --- invalid artifact matrix, atomicity (§19, §82-83) -------------------

test("RTI-6 (§19/§82): one invalid RequirementArtifact among valid ones rejects the WHOLE load, no partial output", async () => {
  const provider = fakeProvider({
    read: async () => [artifact({ id: "REQ-1" }), artifact({ id: "REQ-2" }), { id: "REQ-3" }, artifact({ id: "REQ-4" })],
  });
  await assert.rejects(() => loadRequirementsFromProvider(provider), /REQUIREMENTS_SOURCE_OUTPUT_INVALID/);
});

test("RTI-6 (§83): a hostile getter-backed returned artifact is rejected via RTI-1's own protections, no unsafe getter invocation", async () => {
  let getterCalls = 0;
  const hostile = { type: "requirement", title: "t", content: "c", source: { type: "file", location: "x" } };
  Object.defineProperty(hostile, "id", {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error("must never be invoked unsafely");
    },
  });
  const provider = fakeProvider({ read: async () => [hostile] });
  await assert.rejects(() => loadRequirementsFromProvider(provider), /REQUIREMENTS_SOURCE_OUTPUT_INVALID/);
  assert.equal(getterCalls, 0);
});

// --- duplicate matrix (§22-23, §84-85) -----------------------------------

test("RTI-6 (§22/§84): duplicate requirement ids in provider output reject with COLLECTION_INVALID", async () => {
  const provider = fakeProvider({ read: async () => [artifact({ id: "REQ-1" }), artifact({ id: "REQ-1" })] });
  await assert.rejects(() => loadRequirementsFromProvider(provider), /REQUIREMENTS_SOURCE_COLLECTION_INVALID/);
});

test("RTI-6 (§23/§85): duplicate criterion ids within one artifact reject with COLLECTION_INVALID", async () => {
  const provider = fakeProvider({
    read: async () => [artifact({ acceptanceCriteria: [{ id: "AC-1", text: "a" }, { id: "AC-1", text: "b" }] })],
  });
  await assert.rejects(() => loadRequirementsFromProvider(provider), /REQUIREMENTS_SOURCE_COLLECTION_INVALID/);
});

// --- ordering / determinism (§45, §50, §86) ------------------------------

test("RTI-6 (§45/§86): provider-returned artifact order is preserved exactly, no generic sort", async () => {
  const provider = fakeProvider({ read: async () => [artifact({ id: "REQ-3" }), artifact({ id: "REQ-1" }), artifact({ id: "REQ-2" })] });
  const result = await loadRequirementsFromProvider(provider);
  assert.deepEqual(result.map((a) => a.id), ["REQ-3", "REQ-1", "REQ-2"]);
});

test("RTI-6 (§50): repeated loads of deterministic provider output are deep-equal", async () => {
  const provider = fakeProvider();
  const a = await loadRequirementsFromProvider(provider);
  const b = await loadRequirementsFromProvider(provider);
  assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

// --- freeze / references / late-mutation (§46-49, §87-91) ---------------

test("RTI-6 (§87): returned collection is frozen and a fresh array distinct from the provider's own array", async () => {
  const original = [artifact()];
  const provider = fakeProvider({ read: async () => original });
  const result = await loadRequirementsFromProvider(provider);
  assert.ok(Object.isFrozen(result));
  assert.notEqual(result, original);
});

test("RTI-6 (§88): returned artifact objects are the SAME references the provider returned (shallow snapshot)", async () => {
  const original = [artifact()];
  const provider = fakeProvider({ read: async () => original });
  const result = await loadRequirementsFromProvider(provider);
  assert.equal(result[0], original[0]);
});

test("RTI-6 (§89): the generic runner never mutates input/returned artifacts", async () => {
  const original = [artifact()];
  const before = JSON.stringify(original);
  const provider = fakeProvider({ read: async () => original });
  await loadRequirementsFromProvider(provider);
  assert.equal(JSON.stringify(original), before);
});

test("RTI-6 (§90): later mutating the provider's OWN original array (membership) does not change the already-returned collection", async () => {
  const original = [artifact({ id: "REQ-A" })];
  const provider = fakeProvider({ read: async () => original });
  const result = await loadRequirementsFromProvider(provider);
  original.push(artifact({ id: "REQ-B" }));
  assert.equal(result.length, 1);
  assert.deepEqual(result.map((a) => a.id), ["REQ-A"]);
});

// --- provider.id / source.type independence, provenance (§92-93) --------

test("RTI-6 (§92): provider.id and artifact.source.type are independent - no equality required, any combination succeeds", async () => {
  const provider = { id: "company-jira-prod", read: async () => [artifact({ source: { type: "jira", location: "x" } })] };
  const result = await loadRequirementsFromProvider(provider);
  assert.equal(result[0].source.type, "jira");

  const provider2 = { id: "internal-aggregator", read: async () => [artifact({ source: { type: "legacy-alm", location: "x" } })] };
  const result2 = await loadRequirementsFromProvider(provider2);
  assert.equal(result2[0].source.type, "legacy-alm");
});

test("RTI-6 (§93): source provenance fields are preserved exactly as the provider set them", async () => {
  const source = { type: "jira", sourceId: "PROJ-123", location: "https://jira.example.com/PROJ-123", system: "company-jira-prod", version: "7" };
  const provider = fakeProvider({ read: async () => [artifact({ id: "jira:company-jira-prod:PROJ-123", source })] });
  const result = await loadRequirementsFromProvider(provider);
  assert.deepEqual(result[0].source, source);
});

// --- downstream composition, no quality dependency (§94, §96) -----------

test("RTI-6 (§94): fake-provider -> analyzeRequirementsQuality -> generateTestDesigns -> buildRequirementTraceability -> analyzeRequirementsCoverage works end to end", async () => {
  const { analyzeRequirementsQuality } = require("./requirement-quality");
  const { generateTestDesigns } = require("./test-design");
  const { buildRequirementTraceability, analyzeRequirementsCoverage } = require("./requirement-traceability");

  const provider = {
    id: "fake-pipeline-provider",
    async read() {
      return [artifact({ id: "REQ-PIPE", content: "Valid credentials return HTTP 200." })];
    },
  };
  const requirements = await loadRequirementsFromProvider(provider);
  const quality = analyzeRequirementsQuality(requirements);
  assert.equal(quality[0].status, "READY");
  const designs = generateTestDesigns(requirements);
  const links = buildRequirementTraceability(requirements, designs);
  const [coverage] = analyzeRequirementsCoverage(requirements, designs);
  assert.equal(links.length, 1);
  assert.equal(coverage.status, "FULLY_COVERED");
});

test("RTI-6 (§96): a provider-supplied requirement RTI-3 would classify AMBIGUOUS still ingests successfully - RTI-6 only ingests, never reinterprets quality", async () => {
  const { analyzeRequirementQuality } = require("./requirement-quality");
  const provider = fakeProvider({ read: async () => [artifact({ id: "REQ-VAGUE", content: "The API should respond quickly." })] });
  const result = await loadRequirementsFromProvider(provider);
  assert.equal(result.length, 1);
  assert.equal(analyzeRequirementQuality(result[0]).status, "AMBIGUOUS");
});
