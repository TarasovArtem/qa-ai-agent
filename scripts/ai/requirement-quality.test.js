"use strict";

/**
 * Roadmap RTI-3 (Requirement Quality / Testability Analysis): unit coverage
 * for scripts/ai/requirement-quality.js - the deterministic quality/
 * testability layer on top of RequirementArtifact[]. Covers every worked
 * example from the RTI-3 mission itself, the no-hallucination invariant,
 * source-artifact immutability, hostile-getter safety, and the collection
 * API's own duplicate-id defense.
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");

const { analyzeRequirementQuality, analyzeRequirementsQuality } = require("./requirement-quality");

function art(overrides = {}) {
  return {
    id: "REQ-X",
    type: "requirement",
    title: "Example requirement",
    source: { type: "file", location: "requirements.json" },
    ...overrides,
  };
}

function issueCodes(result) {
  return result.issues.map((i) => i.code).sort();
}

// --- worked examples from the mission (sections 85-92) --------------------

test("RTI-3 worked example: clear HTTP-status requirement with matching criterion is READY", () => {
  const r = analyzeRequirementQuality(
    art({
      content: "The API must return HTTP 200 when valid credentials are supplied.",
      acceptanceCriteria: [{ text: "Given valid credentials, the API returns HTTP 200." }],
    })
  );
  assert.equal(r.status, "READY");
  assert.deepEqual(r.issues, []);
});

test("RTI-3 worked example: vague performance claim with no threshold is AMBIGUOUS with MISSING_MEASURABLE_CRITERION, no invented number", () => {
  const r = analyzeRequirementQuality(art({ content: "The search results should load quickly." }));
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
  assert.equal(/\d/.test(JSON.stringify(r)), false, "must never invent a numeric threshold");
});

test("RTI-3 worked example: explicit TBD placeholder is MISSING_INFORMATION", () => {
  const r = analyzeRequirementQuality(art({ content: "The timeout must be TBD." }));
  assert.equal(r.status, "MISSING_INFORMATION");
  assert.deepEqual(issueCodes(r), ["PLACEHOLDER_TEXT"]);
});

test("RTI-3 worked example: precise percentile+duration performance requirement is READY, no missing-measurable finding", () => {
  const r = analyzeRequirementQuality(art({ content: "95% of search requests must complete within 2 seconds." }));
  assert.equal(r.status, "READY");
  assert.deepEqual(r.issues, []);
});

test("RTI-3 worked example: vague security claim is flagged without inventing a security control", () => {
  // "secure" lives in the never-suppressed subjective category (RTI-3
  // corrective - no generic number makes "secure" objectively verifiable
  // the way a duration number makes "fast" verifiable). With no
  // acceptanceCriteria at all, this correctly follows the same UNTESTABLE
  // path as any other isolated subjective claim (e.g. "delightful") - not
  // a special case, just the existing, approved status-derivation rule
  // applied uniformly.
  const r = analyzeRequirementQuality(art({ content: "The application must be secure." }));
  assert.equal(r.status, "UNTESTABLE");
  assert.deepEqual(issueCodes(r), ["UNVERIFIABLE_SUBJECTIVE_CLAIM"]);
  for (const invented of ["AES", "OAuth", "MFA", "OWASP"]) {
    assert.equal(JSON.stringify(r).includes(invented), false);
  }
});

test("RTI-3 worked example: precise boolean/HTTP-status requirement is READY", () => {
  const r = analyzeRequirementQuality(art({ content: "When the feature flag is disabled, the endpoint must return HTTP 404." }));
  assert.equal(r.status, "READY");
  assert.deepEqual(r.issues, []);
});

test("RTI-3 worked example: a precise acceptance criterion resolves vague content - no missing-measurable finding", () => {
  const r = analyzeRequirementQuality(
    art({ content: "Search should be fast.", acceptanceCriteria: [{ text: "95% of searches complete within 2 seconds." }] })
  );
  assert.equal(r.status, "READY");
  assert.deepEqual(r.issues, []);
});

test("RTI-3 worked example: multiple simultaneous issues (placeholder + vague + weak qualifier) produce multiple findings with deterministic precedence", () => {
  const r = analyzeRequirementQuality(art({ content: "The timeout must be TBD. Response should be fast and appropriate." }));
  assert.equal(r.status, "MISSING_INFORMATION");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION", "PLACEHOLDER_TEXT", "VAGUE_QUALIFIER"]);
});

// --- status semantics ------------------------------------------------------

test("RTI-3 status: an inherently subjective claim with no acceptanceCriteria and no measurable signal is UNTESTABLE", () => {
  const r = analyzeRequirementQuality(art({ content: "The product should delight users." }));
  assert.equal(r.status, "UNTESTABLE");
  assert.deepEqual(issueCodes(r), ["UNVERIFIABLE_SUBJECTIVE_CLAIM"]);
});

test("RTI-3 status: a subjective claim in content WITH acceptanceCriteria present is AMBIGUOUS, not UNTESTABLE (some testable surface remains)", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The UI must be intuitive.", acceptanceCriteria: [{ text: "Users can complete checkout in under 3 clicks." }] })
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["UNVERIFIABLE_SUBJECTIVE_CLAIM"]);
});

test("RTI-3 status: subjective claim is NEVER suppressed by an unrelated measurable signal elsewhere (no number makes 'delightful' verifiable)", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The product should be delightful and must respond within 2 seconds." })
  );
  assert.deepEqual(issueCodes(r), ["UNVERIFIABLE_SUBJECTIVE_CLAIM"]);
});

test("RTI-3 status: content clean, some (not all) acceptance criteria vague, is PARTIALLY_TESTABLE", () => {
  const r = analyzeRequirementQuality(
    art({
      content: "Users can log in with valid credentials and are redirected to the dashboard.",
      acceptanceCriteria: [
        { text: "Login succeeds for valid credentials and redirects to the dashboard." },
        { text: "Login should be fast." },
      ],
    })
  );
  assert.equal(r.status, "PARTIALLY_TESTABLE");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
  assert.equal(r.issues[0].field, "acceptanceCriteria");
});

test("RTI-3 status: warning-only issues (weak qualifier) never block READY", () => {
  const r = analyzeRequirementQuality(art({ content: "Return an appropriate HTTP status code for each error type." }));
  assert.equal(r.status, "READY");
  assert.deepEqual(issueCodes(r), ["VAGUE_QUALIFIER"]);
  assert.equal(r.issues[0].severity, "warning");
});

test("RTI-3 status: zero issues on an acceptanceCriteria-only artifact (no content) is READY", () => {
  const r = analyzeRequirementQuality(
    art({ acceptanceCriteria: [{ text: "Given valid credentials, login succeeds and returns HTTP 200." }] })
  );
  assert.equal(r.status, "READY");
});

test("RTI-3 status: a placeholder confined to a single acceptance criterion still yields MISSING_INFORMATION (placeholder outranks partial)", () => {
  const r = analyzeRequirementQuality(
    art({
      content: "Users can reset their password via email.",
      acceptanceCriteria: [{ text: "A reset link is sent within TBD minutes." }],
    })
  );
  assert.equal(r.status, "MISSING_INFORMATION");
});

// --- issue reference (field / criterionId / criterionIndex) ---------------

test("RTI-3 issue reference: a criterion with an explicit id is referenced by criterionId, not index", () => {
  const r = analyzeRequirementQuality(
    art({ content: "c", acceptanceCriteria: [{ id: "AC-1", text: "Response must be fast." }] })
  );
  assert.equal(r.issues[0].criterionId, "AC-1");
  assert.equal("criterionIndex" in r.issues[0], false);
});

test("RTI-3 issue reference: a criterion without an id is referenced by a positional criterionIndex", () => {
  const r = analyzeRequirementQuality(
    art({ content: "c", acceptanceCriteria: [{ text: "ok" }, { text: "Response must be fast." }] })
  );
  assert.equal(r.issues[0].criterionIndex, 1);
  assert.equal("criterionId" in r.issues[0], false);
});

test("RTI-3 issue reference: a content-field issue carries field='content' and no criterion reference", () => {
  const r = analyzeRequirementQuality(art({ content: "This should be fast." }));
  assert.equal(r.issues[0].field, "content");
  assert.equal(r.issues[0].criterionId, undefined);
  assert.equal(r.issues[0].criterionIndex, undefined);
});

// --- deduplication ----------------------------------------------------------

test("RTI-3 deduplication: the same vague term appearing twice in one field yields exactly one finding", () => {
  const r = analyzeRequirementQuality(art({ content: "This must be fast, really fast." }));
  assert.equal(r.issues.filter((i) => i.code === "MISSING_MEASURABLE_CRITERION").length, 1);
});

// --- no-hallucination / no-invention invariants ----------------------------

test("RTI-3 no-hallucination: no invented actor for an actor-free requirement", () => {
  const r = analyzeRequirementQuality(art({ content: "Password reset must be supported." }));
  const serialized = JSON.stringify(r).toLowerCase();
  for (const actor of ["registered user", "administrator", "guest"]) {
    assert.equal(serialized.includes(actor), false);
  }
});

test("RTI-3 no-hallucination: no invented error conditions for a requirement that doesn't state them", () => {
  const r = analyzeRequirementQuality(art({ content: "Password reset must be supported." }));
  const serialized = JSON.stringify(r).toLowerCase();
  for (const invented of ["invalid token", "expired link", "rate limit"]) {
    assert.equal(serialized.includes(invented), false);
  }
});

test("RTI-3 no-hallucination: result never contains a corrected/rewritten requirement field", () => {
  const r = analyzeRequirementQuality(art({ content: "fast" }));
  for (const forbiddenKey of ["correctedRequirement", "improvedRequirement", "rewrittenAcceptanceCriteria", "suggestedTestCases", "generatedScenarios"]) {
    assert.equal(forbiddenKey in r, false);
  }
});

// --- source artifact immutability ------------------------------------------

test("RTI-3 immutability: the input RequirementArtifact is never mutated by analysis", () => {
  const input = art({ content: "The search should be fast." });
  const before = JSON.parse(JSON.stringify(input));
  analyzeRequirementQuality(input);
  assert.deepEqual(input, before);
});

test("RTI-3 immutability: RTI-1 does not require freezing, but analysis never writes new properties onto the artifact", () => {
  const input = art({ content: "fast" });
  const keysBefore = Object.keys(input).sort();
  analyzeRequirementQuality(input);
  assert.deepEqual(Object.keys(input).sort(), keysBefore);
  assert.equal("status" in input, false);
  assert.equal("issues" in input, false);
  assert.equal("missingInformation" in input, false);
});

// --- result data model / freeze depth ---------------------------------------

test("RTI-3 result model: top-level result is frozen; issues array/entries are not deep-frozen (matches documented shallow-freeze depth)", () => {
  const r = analyzeRequirementQuality(art({ content: "fast" }));
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.issues), false);
  if (r.issues.length > 0) assert.equal(Object.isFrozen(r.issues[0]), false);
});

test("RTI-3 result model: result is a JSON-serializable, data-only object (round-trips cleanly)", () => {
  const r = analyzeRequirementQuality(art({ content: "The timeout must be TBD and fast." }));
  const roundTripped = JSON.parse(JSON.stringify(r));
  assert.deepEqual(roundTripped, JSON.parse(JSON.stringify(r)));
  assert.equal(roundTripped.artifactId, r.artifactId);
  assert.equal(roundTripped.status, r.status);
});

test("RTI-3 result model: artifactId equals the source artifact's own id exactly", () => {
  const r = analyzeRequirementQuality(art({ id: "REQ-777", content: "c" }));
  assert.equal(r.artifactId, "REQ-777");
});

test("RTI-3 result model: no arbitrary metadata bag is present on the result", () => {
  const r = analyzeRequirementQuality(art({ content: "c" }));
  assert.deepEqual(Object.keys(r).sort(), ["artifactId", "issues", "status"]);
});

// --- determinism -------------------------------------------------------------

test("RTI-3 determinism: identical input always yields deep-equal output", () => {
  const input = art({ content: "The timeout must be TBD. Response should be fast and appropriate." });
  const first = analyzeRequirementQuality(input);
  const second = analyzeRequirementQuality(input);
  assert.deepEqual(first, second);
});

// --- input safety / hostile getter -------------------------------------------

test("RTI-3 input safety: RTI-1 validation runs before any quality-rule property access - a hostile getter on content is never invoked", () => {
  let getterCalls = 0;
  const hostile = {
    id: "REQ-1",
    type: "requirement",
    title: "t",
    source: { type: "file", location: "x.json" },
    get content() {
      getterCalls++;
      return "fast";
    },
  };
  assert.throws(() => analyzeRequirementQuality(hostile), /REQUIREMENT_ARTIFACT_INVALID/);
  assert.equal(getterCalls, 0, "the hostile getter must never be invoked - RTI-1 rejects it via getOwnEnumerableDataProperty before any read");
});

test("RTI-3 input safety: undefined/null artifact fails closed via RTI-1's own REQUIREMENT_ARTIFACT_REQUIRED", () => {
  assert.throws(() => analyzeRequirementQuality(undefined), /REQUIREMENT_ARTIFACT_REQUIRED/);
  assert.throws(() => analyzeRequirementQuality(null), /REQUIREMENT_ARTIFACT_REQUIRED/);
});

test("RTI-3 input safety: a structurally invalid artifact fails closed via RTI-1's own REQUIREMENT_ARTIFACT_INVALID, never silently analyzed", () => {
  assert.throws(() => analyzeRequirementQuality({ id: "R1" }), /REQUIREMENT_ARTIFACT_INVALID/);
});

// --- RequirementArtifact type/source independence ---------------------------

test("RTI-3 type independence: analysis applies uniformly across artifact types", () => {
  for (const type of ["requirement", "user-story", "non-functional-requirement", "api-contract", "bug"]) {
    const r = analyzeRequirementQuality(art({ type, content: "The response should be fast." }));
    assert.equal(r.status, "AMBIGUOUS");
  }
});

test("RTI-3 source independence: artifact.source.type never influences the quality result", () => {
  const base = { id: "REQ-EQ", type: "requirement", title: "t", content: "The search results should load quickly." };
  const viaFile = analyzeRequirementQuality({ ...base, source: { type: "file", location: "a.json" } });
  const viaOther = analyzeRequirementQuality({ ...base, source: { type: "totally-different-source-kind", location: "b" } });
  assert.deepEqual(JSON.parse(JSON.stringify(viaFile)), JSON.parse(JSON.stringify(viaOther)));
});

// --- analyzeRequirementsQuality (collection API) -----------------------------

test("analyzeRequirementsQuality: preserves input order", () => {
  const artifacts = [art({ id: "A", content: "c1" }), art({ id: "B", content: "c2" }), art({ id: "C", content: "c3" })];
  const results = analyzeRequirementsQuality(artifacts);
  assert.deepEqual(results.map((r) => r.artifactId), ["A", "B", "C"]);
});

test("analyzeRequirementsQuality: rejects a non-array input", () => {
  assert.throws(() => analyzeRequirementsQuality({}), /REQUIREMENT_QUALITY_INPUT_INVALID/);
  assert.throws(() => analyzeRequirementsQuality("not-an-array"), /REQUIREMENT_QUALITY_INPUT_INVALID/);
});

test("analyzeRequirementsQuality: rejects undefined/null", () => {
  assert.throws(() => analyzeRequirementsQuality(undefined), /REQUIREMENT_QUALITY_INPUT_REQUIRED/);
  assert.throws(() => analyzeRequirementsQuality(null), /REQUIREMENT_QUALITY_INPUT_REQUIRED/);
});

test("analyzeRequirementsQuality: rejects an invalid item, referencing its index", () => {
  const artifacts = [art({ id: "A", content: "c1" }), { id: "bad-only" }];
  assert.throws(() => analyzeRequirementsQuality(artifacts), /REQUIREMENT_QUALITY_INPUT_INVALID.*artifacts\[1\]/s);
});

test("analyzeRequirementsQuality: rejects duplicate artifact ids defensively (result identity depends on artifactId)", () => {
  const artifacts = [art({ id: "DUP", content: "c1" }), art({ id: "DUP", content: "c2" })];
  assert.throws(() => analyzeRequirementsQuality(artifacts), /REQUIREMENT_QUALITY_COLLECTION_INVALID/);
});

test("analyzeRequirementsQuality: an empty array is accepted and returns an empty result array", () => {
  assert.deepEqual(analyzeRequirementsQuality([]), []);
});

test("analyzeRequirementsQuality: does not perform cross-artifact analysis - two artifacts with the exact same vague wording are analyzed independently, not deduplicated or cross-referenced", () => {
  const artifacts = [art({ id: "A", content: "This should be fast." }), art({ id: "B", content: "This should be fast." })];
  const results = analyzeRequirementsQuality(artifacts);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0].issues.map((i) => i.code), results[1].issues.map((i) => i.code));
});

// --- error model / bounded detail --------------------------------------------

test("RTI-3 error model: error messages are bounded and do not dump entire artifact content", () => {
  const artifacts = [{ id: "bad" }];
  try {
    analyzeRequirementsQuality(artifacts);
    assert.fail("expected throw");
  } catch (err) {
    assert.equal(err.message.length < 2000, true);
  }
});

// --- RTI-3 corrective: dimension-scoped measurable-signal suppression ------
//
// Independent review found the original suppression check artifact-wide AND
// topic-blind: ANY numeric-looking signal anywhere (a retry count, an HTTP
// status code) silently suppressed an unrelated vague PERFORMANCE claim,
// producing READY for a materially underspecified requirement. These tests
// are the reviewer's own exact reproductions, now permanent regressions.

test("RTI-3 corrective (defect repro #1): an unrelated retry count does NOT suppress a vague performance claim", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The page should load quickly.", acceptanceCriteria: [{ text: "Users may retry login up to 5 times." }] })
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 corrective (defect repro #2): an unrelated HTTP status code does NOT suppress a vague performance claim", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The API should respond quickly.", acceptanceCriteria: [{ text: "Return HTTP 200 on success." }] })
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 corrective: a bare, generic percentage ('95% of requests succeed') does NOT suppress a vague performance claim", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The page should load quickly.", acceptanceCriteria: [{ text: "95% of requests succeed." }] })
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 corrective: a bare, unrelated count ('maximum 10 retries') does NOT suppress a vague performance claim", () => {
  const r = analyzeRequirementQuality(art({ content: "The page should load quickly.", acceptanceCriteria: [{ text: "Maximum 10 retries." }] }));
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 corrective (positive control): a RELATED duration threshold still resolves a vague performance claim, cross-field", () => {
  const r = analyzeRequirementQuality(
    art({ content: "Search should be fast.", acceptanceCriteria: [{ text: "95% of searches complete within 2 seconds." }] })
  );
  assert.equal(r.status, "READY");
  assert.deepEqual(r.issues, []);
});

test("RTI-3 corrective (positive control): a duration threshold in the SAME target resolves a vague performance claim", () => {
  const r = analyzeRequirementQuality(art({ content: "Search should be fast and complete within 2 seconds." }));
  assert.equal(r.status, "READY");
  assert.deepEqual(r.issues, []);
});

test("RTI-3 corrective (positive control): 'responsive' is resolved by a related latency threshold", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The endpoint should be responsive.", acceptanceCriteria: [{ text: "Response time must be under 500 ms." }] })
  );
  assert.equal(r.status, "READY");
});

test("RTI-3 corrective (cross-dimension): an availability percentage does NOT resolve an unrelated performance claim", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The endpoint should respond quickly.", acceptanceCriteria: [{ text: "Service availability is 99.9%." }] })
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 corrective (cross-dimension): a duration threshold does NOT resolve an unrelated availability claim", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The service should be highly available.", acceptanceCriteria: [{ text: "Requests complete within 2 seconds." }] })
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 corrective (positive control): an uptime percentage resolves an availability claim", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The service should be highly available.", acceptanceCriteria: [{ text: "99.9% uptime measured monthly." }] })
  );
  assert.equal(r.status, "READY");
});

test("RTI-3 corrective (positive control): a failure-rate threshold resolves a reliability claim", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The payment service must be reliable.", acceptanceCriteria: [{ text: "Less than 1 failure per 10,000 transactions." }] })
  );
  assert.equal(r.status, "READY");
});

test("RTI-3 corrective: 'secure' is never suppressed by a generic unrelated number, related dimension or not", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The application must be secure.", acceptanceCriteria: [{ text: "Supports up to 256 concurrent sessions." }] })
  );
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["UNVERIFIABLE_SUBJECTIVE_CLAIM"]);
  for (const invented of ["AES", "OAuth", "MFA", "OWASP", "TLS"]) {
    assert.equal(JSON.stringify(r).includes(invented), false);
  }
});

test("RTI-3 corrective: duration unit matrix (representative singular/plural/abbreviated forms all recognized)", () => {
  // No bare "s" - see RTI-3 second corrective (red-team finding B): a bare
  // "s" unit matched the "s" inside ordinary technical identifiers ending
  // in "<digit>s" (version tags, cloud instance types, build tags),
  // trivially and unsafely resolving an unrelated performance claim. Only
  // explicit unit words are recognized.
  for (const unit of ["ms", "millisecond", "milliseconds", "sec", "secs", "second", "seconds", "min", "mins", "minute", "minutes", "hour", "hrs", "hours"]) {
    const r = analyzeRequirementQuality(art({ content: "Search should be fast.", acceptanceCriteria: [{ text: `Completes within 2 ${unit}.` }] }));
    assert.equal(r.status, "READY", `unit "${unit}" should be recognized as a duration signal`);
  }
});

test("RTI-3 second corrective: a bare 's' is NOT recognized as a duration unit (accepted conservative limitation)", () => {
  const r = analyzeRequirementQuality(art({ content: "Search should be fast.", acceptanceCriteria: [{ text: "Completes within 2 s." }] }));
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 corrective: comparison-bound duration phrasing is recognized", () => {
  for (const phrase of ["< 2 seconds", "<= 500 ms", "no more than 1 second", "within 3 seconds", "at most 2 seconds"]) {
    const r = analyzeRequirementQuality(art({ content: "Search should be fast.", acceptanceCriteria: [{ text: `Completes ${phrase}.` }] }));
    assert.equal(r.status, "READY", `phrase "${phrase}" should be recognized as a duration signal`);
  }
});

test("RTI-3 corrective: the fixed AMBIGUOUS result still never invents a threshold", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The page should load quickly.", acceptanceCriteria: [{ text: "Users may retry login up to 5 times." }] })
  );
  assert.equal(/(2 seconds|500\s?ms|1 second|95%|99%)/i.test(JSON.stringify(r)), false);
});

test("RTI-3 corrective: status derivation precedence remains unchanged (UNTESTABLE > MISSING_INFORMATION > AMBIGUOUS)", () => {
  const r = analyzeRequirementQuality(art({ content: "The timeout must be TBD. Response should be fast and appropriate." }));
  assert.equal(r.status, "MISSING_INFORMATION");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION", "PLACEHOLDER_TEXT", "VAGUE_QUALIFIER"]);
});

test("RTI-3 corrective: public API surface unchanged at 12 symbols (checked via the barrel)", () => {
  const api = require("./index");
  assert.equal(typeof api.analyzeRequirementQuality, "function");
  assert.equal(typeof api.analyzeRequirementsQuality, "function");
  assert.equal(Object.keys(api).length, 12);
});

// --- RTI-3 second corrective: scalability isolation + duration regex hardening ---
//
// A focused adversarial red-team review found two further false-negative
// classes surviving the first corrective. These are the reviewer's own
// exact reproductions, now permanent regressions.

// Defect A: "scalable" had shared availability/reliability's resolution
// evidence (uptime %, failure ratio), which says nothing about capacity or
// throughput under increasing load.

test("RTI-3 second corrective (defect A): an uptime percentage does NOT resolve a scalability claim", () => {
  const r = analyzeRequirementQuality(art({ content: "The system should be scalable.", acceptanceCriteria: [{ text: "99.9% uptime." }] }));
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 second corrective (defect A): a failure-rate ratio does NOT resolve a scalability claim", () => {
  const r = analyzeRequirementQuality(art({ content: "The system should be scalable.", acceptanceCriteria: [{ text: "1 failure per 10,000 requests." }] }));
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 second corrective (defect A): a duration threshold does NOT resolve a scalability claim", () => {
  const r = analyzeRequirementQuality(art({ content: "The system should be scalable.", acceptanceCriteria: [{ text: "Requests complete within 2 seconds." }] }));
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 second corrective (defect A): a capacity/concurrency count does NOT resolve a scalability claim (no capacity rule implemented)", () => {
  const r = analyzeRequirementQuality(art({ content: "The system should be scalable.", acceptanceCriteria: [{ text: "Supports 10,000 concurrent users." }] }));
  assert.equal(r.status, "AMBIGUOUS");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 second corrective (defect A): scalable is never suppressed regardless of unrelated evidence type", () => {
  for (const ac of ["HTTP 200.", "Retry up to 5 times.", "95% success rate."]) {
    const r = analyzeRequirementQuality(art({ content: "The system should be scalable.", acceptanceCriteria: [{ text: ac }] }));
    assert.equal(r.status, "AMBIGUOUS", `"${ac}" must not resolve scalability`);
  }
});

// Defect B: a bare "s" duration unit matched ordinary technical identifiers
// ending in "<digit>s".

test("RTI-3 second corrective (defect B): technical identifiers ending in '<digit>s' do NOT resolve a performance claim", () => {
  const identifiers = [
    "Use API version 2s.",
    "Instance type is g2s.large.",
    "Deployed on t2s.medium nodes.",
    "Config flag is v2s.",
    "Build tag 2s-release.",
    "Uses the r2s storage tier.",
    "Model number is X2s.",
    "The endpoint is named api-2s.",
  ];
  for (const identifier of identifiers) {
    const r = analyzeRequirementQuality(art({ content: "The API should respond quickly.", acceptanceCriteria: [{ text: identifier }] }));
    assert.equal(r.status, "AMBIGUOUS", `"${identifier}" must not resolve a performance claim`);
    assert.ok(r.issues.some((i) => i.code === "MISSING_MEASURABLE_CRITERION"));
  }
});

test("RTI-3 second corrective: explicit duration units still resolve performance claims (no regression)", () => {
  for (const evidence of ["500 ms", "2 sec", "2 seconds", "1 minute", "1 hour"]) {
    const r = analyzeRequirementQuality(art({ content: "The API should respond quickly.", acceptanceCriteria: [{ text: `Completes within ${evidence}.` }] }));
    assert.equal(r.status, "READY", `"${evidence}" should still resolve`);
  }
});

// Original defects (prior corrective) must remain closed.

test("RTI-3 second corrective: original defect reproductions remain closed", () => {
  const cases = [
    { content: "The page should load quickly.", ac: "Users may retry login up to 5 times." },
    { content: "The API should respond quickly.", ac: "Return HTTP 200 on success." },
    { content: "The API should respond quickly.", ac: "99.9% uptime." },
    { content: "The API should respond quickly.", ac: "95% success rate." },
  ];
  for (const { content, ac } of cases) {
    const r = analyzeRequirementQuality(art({ content, acceptanceCriteria: [{ text: ac }] }));
    assert.equal(r.status, "AMBIGUOUS", `"${content}" + "${ac}" must remain AMBIGUOUS`);
    assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
  }
});

// Availability/reliability overlap - accepted, unchanged - and their own
// rejection of unrelated latency evidence.

test("RTI-3 second corrective: availability/reliability overlap (uptime resolves both) remains preserved", () => {
  const available = analyzeRequirementQuality(art({ content: "The service should be highly available.", acceptanceCriteria: [{ text: "99.9% uptime." }] }));
  assert.equal(available.status, "READY");
  const reliable = analyzeRequirementQuality(art({ content: "The service should be reliable.", acceptanceCriteria: [{ text: "1 failure per 10,000 requests." }] }));
  assert.equal(reliable.status, "READY");
});

test("RTI-3 second corrective: availability still rejects unrelated latency evidence", () => {
  const r = analyzeRequirementQuality(art({ content: "The service should be highly available.", acceptanceCriteria: [{ text: "Responses complete within 2 seconds." }] }));
  assert.equal(r.status, "AMBIGUOUS");
});

test("RTI-3 second corrective: reliability still rejects unrelated latency evidence", () => {
  const r = analyzeRequirementQuality(art({ content: "The service should be reliable.", acceptanceCriteria: [{ text: "Responses complete within 500 ms." }] }));
  assert.equal(r.status, "AMBIGUOUS");
});

// Multi-dimension isolation - permanent coverage per reviewer request.

test("RTI-3 second corrective: multi-dimension artifact - only performance resolved remains NOT READY", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The service should respond quickly and be highly available.", acceptanceCriteria: [{ text: "95% complete within 2 seconds." }] })
  );
  assert.notEqual(r.status, "READY");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 second corrective: multi-dimension artifact - only availability resolved remains NOT READY", () => {
  const r = analyzeRequirementQuality(
    art({ content: "The service should respond quickly and be highly available.", acceptanceCriteria: [{ text: "Monthly uptime >= 99.9%." }] })
  );
  assert.notEqual(r.status, "READY");
  assert.deepEqual(issueCodes(r), ["MISSING_MEASURABLE_CRITERION"]);
});

test("RTI-3 second corrective: multi-dimension artifact - both dimensions resolved reaches READY", () => {
  const r = analyzeRequirementQuality(
    art({
      content: "The service should respond quickly and be highly available.",
      acceptanceCriteria: [{ text: "95% complete within 2 seconds." }, { text: "Monthly uptime >= 99.9%." }],
    })
  );
  assert.equal(r.status, "READY");
  assert.deepEqual(r.issues, []);
});

test("RTI-3 second corrective: no-hallucination on the fixed scalability and identifier cases", () => {
  const scalable = analyzeRequirementQuality(art({ content: "The system should be scalable.", acceptanceCriteria: [{ text: "99.9% uptime." }] }));
  assert.equal(/(\d{1,2}(,\d{3})*\s*(concurrent )?users|requests\/(minute|second)|instances)/i.test(JSON.stringify(scalable)), false);
  const identifier = analyzeRequirementQuality(art({ content: "The API should respond quickly.", acceptanceCriteria: [{ text: "Instance type is g2s.large." }] }));
  assert.equal(/(500\s?ms|2 seconds|1 second)/i.test(JSON.stringify(identifier)), false);
});
