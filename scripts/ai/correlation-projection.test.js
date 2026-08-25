"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  ALLOWED_FRAMEWORKS,
  ALLOWED_OUTCOMES,
  projectFrameworkOutcome,
  projectFrameworkCorrelation,
  projectBrowserCorrelation,
} = require("./correlation-projection");

// --- vocabulary --------------------------------------------------------

test("ALLOWED_FRAMEWORKS/ALLOWED_OUTCOMES are the exact closed sets the real producer emits", () => {
  assert.deepEqual([...ALLOWED_FRAMEWORKS].sort(), ["cypress", "playwright"]);
  assert.deepEqual([...ALLOWED_OUTCOMES].sort(), ["failure", "success"]);
});

// --- projectFrameworkOutcome --------------------------------------------

test("projectFrameworkOutcome: a legitimate entry is projected unchanged", () => {
  assert.deepEqual(projectFrameworkOutcome({ framework: "cypress", outcome: "failure" }), { framework: "cypress", outcome: "failure" });
  assert.deepEqual(projectFrameworkOutcome({ framework: "playwright", outcome: "success" }), { framework: "playwright", outcome: "success" });
});

test("projectFrameworkOutcome: extra properties on an otherwise-valid entry are dropped, not forwarded", () => {
  const result = projectFrameworkOutcome({ framework: "cypress", outcome: "failure", privateMarker: "PRIVATE_OUTCOME_MARKER" });
  assert.deepEqual(result, { framework: "cypress", outcome: "failure" });
  assert.ok(!("privateMarker" in result));
});

test("projectFrameworkOutcome: an unrecognized framework value is rejected entirely (null), never passed through", () => {
  assert.equal(projectFrameworkOutcome({ framework: "PRIVATE_MARKER", outcome: "failure" }), null);
});

test("projectFrameworkOutcome: an unrecognized outcome value is rejected entirely (null)", () => {
  assert.equal(projectFrameworkOutcome({ framework: "cypress", outcome: "PRIVATE_OUTCOME" }), null);
});

test("projectFrameworkOutcome: non-string/malformed framework or outcome values are rejected", () => {
  assert.equal(projectFrameworkOutcome({ framework: null, outcome: "failure" }), null);
  assert.equal(projectFrameworkOutcome({ framework: 42, outcome: "failure" }), null);
  assert.equal(projectFrameworkOutcome({ framework: ["cypress"], outcome: "failure" }), null);
  assert.equal(projectFrameworkOutcome({ framework: "cypress", outcome: null }), null);
  assert.equal(projectFrameworkOutcome({ framework: "cypress", outcome: {} }), null);
});

test("projectFrameworkOutcome: non-object input (null/array/string) is rejected", () => {
  assert.equal(projectFrameworkOutcome(null), null);
  assert.equal(projectFrameworkOutcome(undefined), null);
  assert.equal(projectFrameworkOutcome([]), null);
  assert.equal(projectFrameworkOutcome("cypress"), null);
});

// --- projectFrameworkCorrelation ----------------------------------------

test("projectFrameworkCorrelation: a legitimate object is projected unchanged", () => {
  const raw = { primaryFramework: "cypress", outcomes: [{ framework: "cypress", outcome: "failure" }, { framework: "playwright", outcome: "success" }] };
  assert.deepEqual(projectFrameworkCorrelation(raw), raw);
});

test("projectFrameworkCorrelation: a top-level extra property (privateMarker) is dropped", () => {
  const raw = { primaryFramework: "cypress", outcomes: [], privateMarker: "PRIVATE_FRAMEWORK_MARKER" };
  const result = projectFrameworkCorrelation(raw);
  assert.deepEqual(Object.keys(result).sort(), ["outcomes", "primaryFramework"]);
  assert.ok(!("privateMarker" in result));
});

test("projectFrameworkCorrelation: a top-level nested object property is dropped", () => {
  const raw = { primaryFramework: "cypress", outcomes: [], nested: { secret: "PRIVATE_NESTED_MARKER" } };
  const result = projectFrameworkCorrelation(raw);
  assert.ok(!("nested" in result));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_NESTED_MARKER"));
});

test("projectFrameworkCorrelation: an outcome entry with an extra property has only that entry's extra property stripped, sibling entries unaffected", () => {
  const raw = {
    primaryFramework: "cypress",
    outcomes: [
      { framework: "cypress", outcome: "failure", extraOutcomeMarker: "PRIVATE_OUTCOME_MARKER" },
      { framework: "playwright", outcome: "success" },
    ],
  };
  const result = projectFrameworkCorrelation(raw);
  assert.deepEqual(result, {
    primaryFramework: "cypress",
    outcomes: [
      { framework: "cypress", outcome: "failure" },
      { framework: "playwright", outcome: "success" },
    ],
  });
});

test("projectFrameworkCorrelation: an invalid primaryFramework value is rejected to null, never passed through as an arbitrary string", () => {
  assert.deepEqual(projectFrameworkCorrelation({ primaryFramework: "PRIVATE_MARKER", outcomes: [] }), { primaryFramework: null, outcomes: [] });
});

test("projectFrameworkCorrelation: primaryFramework: null (the shouldRun:false/no-primary case) is preserved as null", () => {
  assert.deepEqual(projectFrameworkCorrelation({ primaryFramework: null, outcomes: [] }), { primaryFramework: null, outcomes: [] });
});

test("projectFrameworkCorrelation: an outcome entry with an invalid framework/outcome is dropped from the array entirely, not partially forwarded", () => {
  const raw = {
    primaryFramework: "cypress",
    outcomes: [{ framework: "PRIVATE_MARKER", outcome: "failure" }, { framework: "cypress", outcome: "failure" }],
  };
  assert.deepEqual(projectFrameworkCorrelation(raw), { primaryFramework: "cypress", outcomes: [{ framework: "cypress", outcome: "failure" }] });
});

test("projectFrameworkCorrelation: non-array outcomes is treated as empty, never thrown or passed through raw", () => {
  assert.deepEqual(projectFrameworkCorrelation({ primaryFramework: "cypress", outcomes: "not-an-array" }), { primaryFramework: "cypress", outcomes: [] });
  assert.deepEqual(projectFrameworkCorrelation({ primaryFramework: "cypress", outcomes: null }), { primaryFramework: "cypress", outcomes: [] });
});

test("projectFrameworkCorrelation: null/undefined/non-object input projects to null (matches the pre-existing 'absent' contract)", () => {
  assert.equal(projectFrameworkCorrelation(null), null);
  assert.equal(projectFrameworkCorrelation(undefined), null);
  assert.equal(projectFrameworkCorrelation("PRIVATE_MARKER"), null);
  assert.equal(projectFrameworkCorrelation([]), null);
});

// --- projectBrowserCorrelation -------------------------------------------

test("projectBrowserCorrelation: a legitimate object is projected unchanged", () => {
  const raw = {
    browsers: ["chrome", "edge"],
    failedBrowsers: ["chrome"],
    passedBrowsers: ["edge"],
    primaryBrowser: "chrome",
    additionalFailedBrowsers: [],
    failureScope: "single-browser",
    sameFailureSignature: null,
  };
  assert.deepEqual(projectBrowserCorrelation(raw), raw);
});

test("projectBrowserCorrelation: sameFailureSignature true/false are preserved as genuine booleans, never conflated with null", () => {
  assert.equal(projectBrowserCorrelation({ sameFailureSignature: true }).sameFailureSignature, true);
  assert.equal(projectBrowserCorrelation({ sameFailureSignature: false }).sameFailureSignature, false);
  assert.equal(projectBrowserCorrelation({ sameFailureSignature: null }).sameFailureSignature, null);
  assert.equal(projectBrowserCorrelation({}).sameFailureSignature, null);
});

test("projectBrowserCorrelation: an extra top-level property is dropped", () => {
  const raw = { browsers: ["chrome"], privateMarker: "PRIVATE_BROWSERCORRELATION_MARKER" };
  const result = projectBrowserCorrelation(raw);
  assert.ok(!("privateMarker" in result));
  assert.ok(!JSON.stringify(result).includes("PRIVATE_BROWSERCORRELATION_MARKER"));
});

test("projectBrowserCorrelation: a non-string entry inside a browser-name array is filtered out, never forwarded as-is", () => {
  const result = projectBrowserCorrelation({ browsers: ["chrome", 42, { nested: "PRIVATE_ARRAY_MARKER" }, "edge"] });
  assert.deepEqual(result.browsers, ["chrome", "edge"]);
});

test("projectBrowserCorrelation: an invalid failureScope value is rejected to null", () => {
  assert.equal(projectBrowserCorrelation({ failureScope: "PRIVATE_SCOPE_MARKER" }).failureScope, null);
});

test("projectBrowserCorrelation: non-array browser-name fields default to an empty array, never thrown or passed through raw", () => {
  const result = projectBrowserCorrelation({ browsers: "not-an-array", failedBrowsers: null, passedBrowsers: 42 });
  assert.deepEqual(result.browsers, []);
  assert.deepEqual(result.failedBrowsers, []);
  assert.deepEqual(result.passedBrowsers, []);
});

test("projectBrowserCorrelation: non-string primaryBrowser is rejected to null", () => {
  assert.equal(projectBrowserCorrelation({ primaryBrowser: 42 }).primaryBrowser, null);
  assert.equal(projectBrowserCorrelation({ primaryBrowser: null }).primaryBrowser, null);
});

test("projectBrowserCorrelation: null/undefined/non-object input projects to null (matches the pre-existing 'absent' contract)", () => {
  assert.equal(projectBrowserCorrelation(null), null);
  assert.equal(projectBrowserCorrelation(undefined), null);
  assert.equal(projectBrowserCorrelation("PRIVATE_MARKER"), null);
  assert.equal(projectBrowserCorrelation([]), null);
});

test("projectBrowserCorrelation: exactly the seven established fields are ever present, nothing more", () => {
  const result = projectBrowserCorrelation({
    browsers: [],
    failedBrowsers: [],
    passedBrowsers: [],
    primaryBrowser: null,
    additionalFailedBrowsers: [],
    failureScope: null,
    sameFailureSignature: null,
    somethingElse: "should not survive",
  });
  assert.deepEqual(
    Object.keys(result).sort(),
    ["additionalFailedBrowsers", "browsers", "failedBrowsers", "failureScope", "passedBrowsers", "primaryBrowser", "sameFailureSignature"]
  );
});
