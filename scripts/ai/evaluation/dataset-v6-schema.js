/**
 * Schema/validator for the Test Design Quality Evaluation Dataset v6
 * (scripts/ai/evaluation/dataset-v6.json) - Roadmap #22G.
 *
 * Dataset v6 is a NEW evaluation subject, not a continuation of the QA
 * Agent failure-triage lineage (dataset.json/dataset-v2..v5.json, which
 * remain completely untouched, frozen, and unrelated). v6 reuses only the
 * FRAMEWORK CONVENTIONS those datasets established: the same
 * `{valid, errors: string[]}` shape (plain strings, never the
 * `{path,code,message}` shape scripts/ai/generation/errors.js uses - that
 * vocabulary belongs to the frozen Generation Foundation, not this
 * directory), the same small-duplicated-primitives discipline, the same
 * pure/synchronous/offline guarantee.
 *
 * Each sample bundles a complete, self-contained #22 Test Design artifact
 * chain (RequirementModel v1 + TestCaseModel v1 + AutomationCandidate v1[]
 * + frameworkCapability + optional projectProfile) plus deterministic gold
 * labels describing what a correct Test Design output should look like for
 * that scenario. This schema deliberately does NOT re-validate the deep
 * internal shape of those artifacts against the frozen #22 generation
 * contracts (RequirementModel/TestCaseModel/AutomationCandidate validators)
 * - that would duplicate already-tested production validators. Instead,
 * evaluate-v6.js independently re-runs the REAL, unmodified
 * buildTestDesignReviewPackage()/validateGenerationChain() over every
 * sample's artifacts before scoring anything, and classifies a failure
 * there as `INVALID_EVALUATION_INPUT` - never a scored quality result (see
 * this repository's #22G "VALIDATION vs EVALUATION" principle). This
 * schema's own job is narrower: the EVALUATION-SPECIFIC shape (stable case
 * ids, gold-label structure, project binding, no unknown fields) - the
 * same division of labor v1-v5's own dataset schemas already use (they
 * validate dataset shape, not whether a human curator's classification
 * judgment was "correct").
 */

"use strict";

const { DECISIONS } = require("../generation/automation-candidate");
const { STATUSES: REVIEW_STATUSES, DECISIONS: REVIEW_DECISIONS } = require("../test-design/test-design-review-record");
const { DIMENSIONS } = require("./scoring-v6");

const SUPPORTED_VERSIONS = [6];

const SAMPLE_KIND_VALUES = ["positive", "negative"];
const REVIEW_TARGET_VALUES = ["RequirementModel", "TestCaseModel", "AutomationCandidate"];

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function collectArtifactsErrors(sample, errors, path) {
  const artifacts = sample.artifacts;
  if (!isPlainObject(artifacts)) {
    errors.push(`${path}.artifacts: must be an object`);
    return;
  }
  if (!isPlainObject(artifacts.requirementModel)) {
    errors.push(`${path}.artifacts.requirementModel: must be an object`);
  }
  if (!isPlainObject(artifacts.testCaseModel)) {
    errors.push(`${path}.artifacts.testCaseModel: must be an object`);
  }
  if (!Array.isArray(artifacts.automationCandidates)) {
    errors.push(`${path}.artifacts.automationCandidates: must be an array`);
  } else if (!artifacts.automationCandidates.every(isPlainObject)) {
    errors.push(`${path}.artifacts.automationCandidates: every entry must be an object`);
  }
  if (!isPlainObject(artifacts.frameworkCapability)) {
    errors.push(`${path}.artifacts.frameworkCapability: must be an object`);
  }
  if (artifacts.projectProfile !== null && !isPlainObject(artifacts.projectProfile)) {
    errors.push(`${path}.artifacts.projectProfile: must be an object or null`);
  }

  // Lightweight project-binding sanity check (Roadmap #22G Section 36) -
  // deep content validity is #22F's job at evaluate-v6.js runtime, but an
  // obviously cross-project fixture is rejected here, before evaluation
  // ever runs.
  const projectId = sample.projectId;
  if (isNonEmptyString(projectId)) {
    if (isPlainObject(artifacts.requirementModel) && artifacts.requirementModel.projectId !== projectId) {
      errors.push(`${path}.artifacts.requirementModel.projectId: must equal ${path}.projectId`);
    }
    if (isPlainObject(artifacts.testCaseModel) && artifacts.testCaseModel.projectId !== projectId) {
      errors.push(`${path}.artifacts.testCaseModel.projectId: must equal ${path}.projectId`);
    }
    if (isPlainObject(artifacts.frameworkCapability) && artifacts.frameworkCapability.projectId !== projectId) {
      errors.push(`${path}.artifacts.frameworkCapability.projectId: must equal ${path}.projectId`);
    }
    if (Array.isArray(artifacts.automationCandidates)) {
      artifacts.automationCandidates.forEach((c, i) => {
        if (isPlainObject(c) && c.projectId !== projectId) {
          errors.push(`${path}.artifacts.automationCandidates[${i}].projectId: must equal ${path}.projectId`);
        }
      });
    }
  }
}

function collectReviewDecisionsErrors(sample, errors, path) {
  if (sample.reviewDecisions === null) return;
  if (!Array.isArray(sample.reviewDecisions)) {
    errors.push(`${path}.reviewDecisions: must be an array or null`);
    return;
  }
  sample.reviewDecisions.forEach((entry, i) => {
    const entryPath = `${path}.reviewDecisions[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${entryPath}: must be an object`);
      return;
    }
    if (!REVIEW_TARGET_VALUES.includes(entry.target)) {
      errors.push(`${entryPath}.target: must be one of ${REVIEW_TARGET_VALUES.join(", ")}`);
    }
    if (entry.target === "AutomationCandidate" && !isNonEmptyString(entry.testCaseId)) {
      errors.push(`${entryPath}.testCaseId: required and must be a non-empty string when target is AutomationCandidate`);
    }
    if (entry.target !== "AutomationCandidate" && entry.testCaseId !== undefined) {
      errors.push(`${entryPath}.testCaseId: must not be present when target is not AutomationCandidate`);
    }
    if (!REVIEW_DECISIONS.includes(entry.decision)) {
      errors.push(`${entryPath}.decision: must be one of ${REVIEW_DECISIONS.join(", ")}`);
    }
    if (entry.comment !== undefined && typeof entry.comment !== "string") {
      errors.push(`${entryPath}.comment: must be a string when present`);
    }
    const allowedKeys = ["target", "testCaseId", "decision", "comment"];
    for (const key of Object.keys(entry)) {
      if (!allowedKeys.includes(key)) errors.push(`${entryPath}.${key}: unknown field`);
    }
  });
}

function collectGoldErrors(sample, errors, path) {
  const gold = sample.gold;
  if (!isPlainObject(gold)) {
    errors.push(`${path}.gold: must be an object`);
    return;
  }
  const goldPath = `${path}.gold`;

  if (!isStringArray(gold.expectedRequirementIds)) {
    errors.push(`${goldPath}.expectedRequirementIds: must be an array of strings`);
  }

  if (!Array.isArray(gold.requirementGrounding)) {
    errors.push(`${goldPath}.requirementGrounding: must be an array`);
  } else {
    gold.requirementGrounding.forEach((e, i) => {
      const p = `${goldPath}.requirementGrounding[${i}]`;
      if (!isPlainObject(e) || !isNonEmptyString(e.requirementId) || !isStringArray(e.expectedEvidenceRefIds)) {
        errors.push(`${p}: must be {requirementId: string, expectedEvidenceRefIds: string[]}`);
      }
    });
  }

  if (!Array.isArray(gold.traceability)) {
    errors.push(`${goldPath}.traceability: must be an array`);
  } else {
    gold.traceability.forEach((e, i) => {
      const p = `${goldPath}.traceability[${i}]`;
      if (!isPlainObject(e) || !isNonEmptyString(e.requirementId)) {
        errors.push(`${p}: must be {requirementId: string}`);
      }
    });
  }

  if (!Array.isArray(gold.decisions)) {
    errors.push(`${goldPath}.decisions: must be an array`);
  } else {
    gold.decisions.forEach((e, i) => {
      const p = `${goldPath}.decisions[${i}]`;
      if (!isPlainObject(e) || !isNonEmptyString(e.testCaseId)) {
        errors.push(`${p}: must be an object with a non-empty testCaseId`);
        return;
      }
      if (!DECISIONS.includes(e.decision)) {
        errors.push(`${p}.decision: must be one of ${DECISIONS.join(", ")}`);
      }
      if (!isStringArray(e.targetFrameworks)) {
        errors.push(`${p}.targetFrameworks: must be an array of strings`);
      }
    });
  }

  if (!Array.isArray(gold.candidateEvidence)) {
    errors.push(`${goldPath}.candidateEvidence: must be an array`);
  } else {
    gold.candidateEvidence.forEach((e, i) => {
      const p = `${goldPath}.candidateEvidence[${i}]`;
      if (!isPlainObject(e) || !isNonEmptyString(e.testCaseId) || !isStringArray(e.expectedEvidenceRefIds) || !isStringArray(e.expectedRationaleEvidenceRefIds)) {
        errors.push(`${p}: must be {testCaseId: string, expectedEvidenceRefIds: string[], expectedRationaleEvidenceRefIds: string[]}`);
      }
    });
  }

  if (gold.reviewOutcome !== null && !REVIEW_STATUSES.includes(gold.reviewOutcome)) {
    errors.push(`${goldPath}.reviewOutcome: must be null or one of ${REVIEW_STATUSES.join(", ")}`);
  }

  const allowedGoldKeys = ["expectedRequirementIds", "requirementGrounding", "traceability", "decisions", "candidateEvidence", "reviewOutcome"];
  for (const key of Object.keys(gold)) {
    if (!allowedGoldKeys.includes(key)) errors.push(`${goldPath}.${key}: unknown field`);
  }
}

function collectMetadataErrors(sample, errors, path) {
  const metadata = sample.metadata;
  if (!isPlainObject(metadata)) {
    errors.push(`${path}.metadata: must be an object`);
    return;
  }
  if (!isStringArray(metadata.expectedWeakDimensions)) {
    errors.push(`${path}.metadata.expectedWeakDimensions: must be an array of strings`);
  } else {
    metadata.expectedWeakDimensions.forEach((d, i) => {
      if (!DIMENSIONS.includes(d)) {
        errors.push(`${path}.metadata.expectedWeakDimensions[${i}]: unknown dimension "${d}"`);
      }
    });
  }
  const allowedKeys = ["expectedWeakDimensions"];
  for (const key of Object.keys(metadata)) {
    if (!allowedKeys.includes(key)) errors.push(`${path}.metadata.${key}: unknown field`);
  }
}

function collectSampleErrorsV6(sample, errors, path) {
  if (!isPlainObject(sample)) {
    errors.push(`${path}: must be an object`);
    return;
  }
  if (!isNonEmptyString(sample.id)) {
    errors.push(`${path}.id: must be a non-empty string`);
  }
  if (!isNonEmptyString(sample.scenario)) {
    errors.push(`${path}.scenario: must be a non-empty string`);
  }
  if (!isNonEmptyString(sample.description)) {
    errors.push(`${path}.description: must be a non-empty string`);
  }
  if (!isNonEmptyString(sample.projectId)) {
    errors.push(`${path}.projectId: must be a non-empty string`);
  }
  if (!SAMPLE_KIND_VALUES.includes(sample.kind)) {
    errors.push(`${path}.kind: must be one of ${SAMPLE_KIND_VALUES.join(", ")}`);
  }

  collectArtifactsErrors(sample, errors, path);
  collectReviewDecisionsErrors(sample, errors, path);
  collectGoldErrors(sample, errors, path);
  collectMetadataErrors(sample, errors, path);

  const allowedKeys = ["id", "scenario", "description", "projectId", "kind", "artifacts", "reviewDecisions", "gold", "metadata"];
  for (const key of Object.keys(sample)) {
    if (!allowedKeys.includes(key)) errors.push(`${path}.${key}: unknown field`);
  }
}

function validateSampleV6(sample) {
  const errors = [];
  collectSampleErrorsV6(sample, errors, "sample");
  return { valid: errors.length === 0, errors };
}

function validateDatasetV6(dataset) {
  const errors = [];

  if (!isPlainObject(dataset)) {
    return { valid: false, errors: ["dataset: must be an object"] };
  }

  if (!SUPPORTED_VERSIONS.includes(dataset.version)) {
    errors.push(`dataset.version: must be one of ${SUPPORTED_VERSIONS.join(", ")}`);
  }

  if (!Array.isArray(dataset.samples)) {
    errors.push("dataset.samples: must be an array");
    return { valid: errors.length === 0, errors };
  }

  const seenIds = new Set();
  dataset.samples.forEach((sample, index) => {
    const path = `dataset.samples[${index}]`;
    collectSampleErrorsV6(sample, errors, path);

    if (isPlainObject(sample) && isNonEmptyString(sample.id)) {
      if (seenIds.has(sample.id)) {
        errors.push(`${path}.id: duplicate sample id "${sample.id}"`);
      }
      seenIds.add(sample.id);
    }
  });

  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateDatasetV6,
  validateSampleV6,
  SAMPLE_KIND_VALUES,
  REVIEW_TARGET_VALUES,
  SUPPORTED_VERSIONS,
};
