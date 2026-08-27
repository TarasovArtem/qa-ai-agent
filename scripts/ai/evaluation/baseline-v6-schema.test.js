"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateBaselineV6 } = require("./baseline-v6-schema");

function validSampleStatus() {
  return {
    requirementGrounding: "pass",
    requirementCoverage: "pass",
    traceability: "pass",
    automationDecision: "pass",
    frameworkQuality: "pass",
    evidenceQuality: "pass",
    reviewAlignment: "not_applicable",
    qualityGatePassed: true,
  };
}

test("the real committed baseline-v6.json is valid", () => {
  const baseline = require("./baseline-v6.json");
  const result = validateBaselineV6(baseline);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test("valid minimal baseline is accepted", () => {
  const result = validateBaselineV6({ version: 1, datasetVersion: 6, samples: { "TD-V6-001": validSampleStatus() } });
  assert.equal(result.valid, true);
});

test("wrong version (file-format version, not dataset version) is rejected", () => {
  const result = validateBaselineV6({ version: 2, datasetVersion: 6, samples: {} });
  assert.equal(result.valid, false);
});

test("wrong datasetVersion is rejected", () => {
  const result = validateBaselineV6({ version: 1, datasetVersion: 5, samples: {} });
  assert.equal(result.valid, false);
});

test("invalid ternary status value is rejected", () => {
  const status = validSampleStatus();
  status.traceability = "excellent";
  const result = validateBaselineV6({ version: 1, datasetVersion: 6, samples: { "TD-V6-001": status } });
  assert.equal(result.valid, false);
});

test("missing dimension is rejected", () => {
  const status = validSampleStatus();
  delete status.reviewAlignment;
  const result = validateBaselineV6({ version: 1, datasetVersion: 6, samples: { "TD-V6-001": status } });
  assert.equal(result.valid, false);
});

test("unknown dimension field is rejected", () => {
  const status = validSampleStatus();
  status.superQuality = "pass";
  const result = validateBaselineV6({ version: 1, datasetVersion: 6, samples: { "TD-V6-001": status } });
  assert.equal(result.valid, false);
});

test("null is rejected", () => {
  assert.equal(validateBaselineV6(null).valid, false);
});

test("non-object samples is rejected", () => {
  assert.equal(validateBaselineV6({ version: 1, datasetVersion: 6, samples: [] }).valid, false);
});

// --- qualityGatePassed baseline tracking (Roadmap #22G-C1, closes G-1) ------

test("missing qualityGatePassed is rejected", () => {
  const status = validSampleStatus();
  delete status.qualityGatePassed;
  const result = validateBaselineV6({ version: 1, datasetVersion: 6, samples: { "TD-V6-001": status } });
  assert.equal(result.valid, false);
});

test("non-boolean qualityGatePassed is rejected", () => {
  const status = validSampleStatus();
  status.qualityGatePassed = "true";
  const result = validateBaselineV6({ version: 1, datasetVersion: 6, samples: { "TD-V6-001": status } });
  assert.equal(result.valid, false);
});

test("qualityGatePassed: false is accepted (a negative sentinel's own committed gate outcome)", () => {
  const status = { ...validSampleStatus(), qualityGatePassed: false };
  const result = validateBaselineV6({ version: 1, datasetVersion: 6, samples: { "TD-V6-005": status } });
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});
