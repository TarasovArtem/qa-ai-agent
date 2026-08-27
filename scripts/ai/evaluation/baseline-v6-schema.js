/**
 * Schema/validator for the Test Design Quality Evaluation Baseline v6
 * (scripts/ai/evaluation/baseline-v6.json) - Roadmap #22G.
 *
 * Mirrors baseline-v5-schema.js's shape/conventions exactly (the
 * `{version, datasetVersion, samples: {id: {...}}}` object-keyed-by-id
 * structure, `{valid, errors: string[]}` plain-string error shape, "small
 * duplicated primitives" discipline) applied to v6's own, unrelated subject
 * matter (Test Design quality, not QA-failure-triage). `version` is always
 * `1` here - the baseline FILE FORMAT version, never confused with
 * `datasetVersion` (always `6` for this file) - same distinction v1-v5's
 * baseline schemas already draw.
 *
 * Deliberately does NOT check sample-set parity against the current
 * dataset (that stays regression-v6.js's job, same separation of concerns
 * v1-v5 use) - this file only checks that baseline-v6.json is internally
 * well-formed.
 *
 * Roadmap #22G-C1 (closes G-1): every sample entry now also carries its
 * own committed `qualityGatePassed` boolean, alongside the seven
 * dimension statuses - the gate's aggregate outcome is exact-baseline-
 * tracked exactly like every individual dimension, closing the gap where
 * a broken/no-op qualityGatePassed computation had zero automated
 * protection at either the unit or regression layer.
 */

"use strict";

const { DIMENSIONS, QUALITY_TERNARY_VALUES } = require("./scoring-v6");

const SUPPORTED_VERSIONS = [1];
const SUPPORTED_DATASET_VERSION = 6;

const SAMPLE_ALLOWED_KEYS = [...DIMENSIONS, "qualityGatePassed"];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoolean(value) {
  return typeof value === "boolean";
}

function collectSampleStatusErrors(sampleStatus, errors, path) {
  if (!isPlainObject(sampleStatus)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  for (const dimension of DIMENSIONS) {
    if (!QUALITY_TERNARY_VALUES.includes(sampleStatus[dimension])) {
      errors.push(`${path}.${dimension}: must be one of ${QUALITY_TERNARY_VALUES.join(", ")}`);
    }
  }
  if (!isBoolean(sampleStatus.qualityGatePassed)) {
    errors.push(`${path}.qualityGatePassed: must be a boolean`);
  }
  for (const key of Object.keys(sampleStatus)) {
    if (!SAMPLE_ALLOWED_KEYS.includes(key)) errors.push(`${path}.${key}: unknown field`);
  }
}

function validateBaselineV6(baseline) {
  const errors = [];

  if (!isPlainObject(baseline)) {
    return { valid: false, errors: ["baseline: must be an object"] };
  }

  if (!SUPPORTED_VERSIONS.includes(baseline.version)) {
    errors.push(`baseline.version: must be one of ${SUPPORTED_VERSIONS.join(", ")}`);
  }
  if (baseline.datasetVersion !== SUPPORTED_DATASET_VERSION) {
    errors.push(`baseline.datasetVersion: must be ${SUPPORTED_DATASET_VERSION}`);
  }
  if (!isPlainObject(baseline.samples)) {
    errors.push("baseline.samples: must be an object");
    return { valid: errors.length === 0, errors };
  }

  for (const id of Object.keys(baseline.samples)) {
    if (!isNonEmptyString(id)) {
      errors.push(`baseline.samples: key "${id}" must be a non-empty string`);
      continue;
    }
    collectSampleStatusErrors(baseline.samples[id], errors, `baseline.samples["${id}"]`);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = { validateBaselineV6, SUPPORTED_VERSIONS, SUPPORTED_DATASET_VERSION };
