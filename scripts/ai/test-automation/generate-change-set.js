/**
 * Provider-backed GeneratedChangeSet content generation (Roadmap #23D).
 *
 * Consumes one already-validated AutomationPlan v1 and one
 * AutomationRepositoryContext (scripts/ai/test-automation/
 * automation-repository-context.js) and produces one GeneratedChangeSet v1
 * through a dependency-injected provider, mirroring
 * automation-plan-generator.js's own bounded retry/correction/snapshot
 * pattern (Roadmap #23C) as closely as possible - same maxAttempts
 * contract, same per-attempt outbound-prompt bound, same
 * boundCorrectionErrors() diagnostic-bounding shape, same
 * normalizeProviderError()-based retryable-error handling, same
 * never-echo-raw-response/prompt/context posture.
 *
 * INPUT SNAPSHOT: both `automationPlan` and `repositoryContext` are read
 * exactly once, via the SAME owned-snapshot primitives generated-change-
 * set.js itself already exports (snapshotOwnData/deepFreeze) - this file
 * deliberately reuses that module's copy rather than re-declaring a third
 * one, since both files are co-owned parts of the single #23D
 * GeneratedChangeSet feature (unlike the automation-plan-generator.js/
 * generated-change-set.js boundary, which is a genuine cross-roadmap-stage
 * boundary and does independently re-implement its own copy).
 *
 * WRITE SCOPE / DIGESTS ARE NEVER PROVIDER-DEFINED (read before changing
 * the provider response contract below): the provider's own JSON response
 * schema is deliberately narrower than GeneratedChangeSet v1's own change
 * shape - it may supply only {operation, path, content}, never
 * baseContentDigest. Every change's baseContentDigest is instead
 * mechanically derived here, in deriveChangesWithBaseDigests(), directly
 * from the already-validated, already-snapshotted repositoryContext (null
 * for CREATE; computeDigest(LABEL_FILE_CONTENT, existing.content) for a
 * MODIFY whose path has matching repository evidence, else null - which
 * buildGeneratedChangeSet() then correctly rejects as either a
 * MODIFY-target-does-not-exist or a baseContentDigest-mismatch, exactly
 * like any other malformed input). A provider that includes a
 * baseContentDigest field in its response is rejected outright by
 * validateProviderChangesShape() below (unknown field) - it is never
 * silently stripped or trusted.
 *
 * The real safety boundary for every change this module ever returns is
 * still buildGeneratedChangeSet() itself (generated-change-set.js) - this
 * file never re-implements path safety, protected-area checks, plan
 * binding, or existence/staleness checks; it only shapes a provider's raw
 * {operation,path,content} proposals into the exact input
 * buildGeneratedChangeSet() already independently validates.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId, collectUnknownKeyErrors } = require("../generation/primitives");
const { validateAutomationPlan } = require("../generation/automation-plan");
const { normalizeProviderError } = require("../providers/provider-error");
const { buildGenerateChangeSetSystemPrompt, buildGenerateChangeSetUserPrompt, buildGenerateChangeSetCorrectionPrompt } = require("./generate-change-set-prompt");
const {
  LIMITS: CHANGE_SET_LIMITS,
  LABEL_FILE_CONTENT,
  computeDigest,
  snapshotOwnData,
  deepFreeze,
  validateRepositoryContextSnapshot,
  buildGeneratedChangeSet,
} = require("./generated-change-set");

// #23D-local, generator-only bounds - deliberately not added to
// generated-change-set.js's own LIMITS (that module bounds the frozen v1
// contract itself; these bound this provider-orchestration stage only),
// mirroring automation-plan-generator.js's own LIMITS split.
const LIMITS = Object.freeze({
  MAX_CHANGES: CHANGE_SET_LIMITS.MAX_CHANGES,
  // Pre-parse bound on the raw provider response text, checked BEFORE any
  // JSON.parse. A structurally-valid response can never legitimately
  // exceed generated-change-set.js's own MAX_TOTAL_CONTENT_LENGTH
  // (1,000,000 chars of aggregate content, enforced downstream by
  // buildGeneratedChangeSet()) plus a small per-entry {operation,path}
  // JSON overhead for up to MAX_CHANGES entries - this is set with
  // generous headroom above that worst legitimate case, never a
  // streaming/network byte protection.
  MAX_CHANGESET_RESPONSE_CHARS: 1200000,
  MAX_CORRECTION_ERRORS: 20,
  MAX_CORRECTION_DIAGNOSTIC_CHARS: 8192,
  // A maximal legitimate projection (100 planned changes, each with a
  // 300-char path and a 4000-char purpose, plus up to 40,000 chars of
  // aggregate existing-file content reused from the bound repository
  // context's own MAX_AGGREGATE_EVIDENCE_LENGTH) is well under 600,000
  // characters - set with generous headroom, mirroring automation-plan-
  // generator.js's own MAX_OUTBOUND_PROMPT_CHARS defensive-cap posture.
  MAX_OUTBOUND_PROMPT_CHARS: 600000,
});

const PROVIDER_CHANGE_ALLOWED_KEYS = Object.freeze(["operation", "path", "content"]);

// Bounds and sanitizes a validator error list for inclusion in a
// correction prompt - identical shape/purpose to automation-plan-
// generator.js's own boundCorrectionErrors(), independently re-declared
// here rather than imported (that function is private to its own module).
function boundCorrectionErrors(errors) {
  const bounded = errors.slice(0, LIMITS.MAX_CORRECTION_ERRORS).map((e) => ({ path: e.path, code: e.code, message: e.message }));
  if (JSON.stringify(bounded).length <= LIMITS.MAX_CORRECTION_DIAGNOSTIC_CHARS) return bounded;
  return [{ path: "$", code: ERROR_CODES.INVALID_VALUE, message: `validation failed with ${errors.length} error(s); diagnostics omitted for size` }];
}

// Strict shape check for the provider's own raw response, BEFORE any of it
// is handed to buildGeneratedChangeSet(). Deliberately narrower than
// GeneratedChangeSet v1's own change shape: only {operation, path,
// content} is accepted from a provider - baseContentDigest is rejected
// here as an unknown field (see this module's own docstring for why the
// provider is never trusted with digests at all).
function validateProviderChangesShape(parsedChanges) {
  if (!Array.isArray(parsedChanges)) {
    return [err("$", ERROR_CODES.INVALID_TYPE, "provider response must be a JSON array")];
  }
  if (parsedChanges.length > LIMITS.MAX_CHANGES) {
    return [err("$", ERROR_CODES.INVALID_VALUE, `provider response exceeds the maximum of ${LIMITS.MAX_CHANGES} changes`)];
  }
  const errors = [];
  parsedChanges.forEach((entry, i) => {
    const p = `$[${i}]`;
    if (!isPlainObject(entry)) {
      errors.push(err(p, ERROR_CODES.INVALID_TYPE, `${p} must be an object`));
      return;
    }
    collectUnknownKeyErrors(entry, PROVIDER_CHANGE_ALLOWED_KEYS, p, errors);
    if (typeof entry.operation !== "string" || entry.operation.length === 0) {
      errors.push(err(`${p}.operation`, ERROR_CODES.INVALID_TYPE, `${p}.operation must be a non-empty string`));
    }
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      errors.push(err(`${p}.path`, ERROR_CODES.INVALID_TYPE, `${p}.path must be a non-empty string`));
    }
    if (typeof entry.content !== "string" || entry.content.length === 0) {
      errors.push(err(`${p}.content`, ERROR_CODES.INVALID_TYPE, `${p}.content must be a non-empty string`));
    }
  });
  return errors;
}

// Mechanically fills in each entry's baseContentDigest from the bound
// repository context - never from the provider (see this module's own
// docstring). A MODIFY entry whose path has no matching evidence gets
// `null`, which buildGeneratedChangeSet() then correctly rejects as
// "MODIFY target does not exist in the bound repository context" - never
// silently coerced or skipped here.
function deriveChangesWithBaseDigests(parsedChanges, contextSnapshot) {
  const evidenceByPath = new Map(contextSnapshot.repositoryEvidence.map((item) => [item.evidenceRef.location, item]));
  return parsedChanges.map((entry) => {
    const existing = evidenceByPath.get(entry.path);
    const baseContentDigest = entry.operation === "MODIFY" && existing ? computeDigest(LABEL_FILE_CONTENT, existing.content) : null;
    return { operation: entry.operation, path: entry.path, baseContentDigest, content: entry.content };
  });
}

// Builds the ONLY object ever sent to the provider - a deliberate positive
// allowlist, never `JSON.stringify(automationPlan)`/
// `JSON.stringify(repositoryContext)` wholesale (mirrors automation-plan-
// generator.js's own buildPositiveProjection()). Each planned change
// carries its own `existingContent` (the bound repository context's
// current content for that path, or `null` for CREATE / no matching
// evidence) rather than a separate cross-referenced evidence list, so the
// provider never has to correlate two arrays itself.
function buildPositiveProjection({ planSnapshot, contextSnapshot }) {
  const evidenceByPath = new Map(contextSnapshot.repositoryEvidence.map((item) => [item.evidenceRef.location, item]));
  return {
    projectId: planSnapshot.projectId,
    framework: planSnapshot.framework,
    plannedChanges: planSnapshot.plannedChanges.map((change) => {
      const existing = change.operation === "MODIFY" ? evidenceByPath.get(change.path) : undefined;
      return {
        path: change.path,
        operation: change.operation,
        purpose: change.purpose,
        existingContent: existing ? existing.content : null,
      };
    }),
  };
}

/**
 * Generates one GeneratedChangeSet v1 for one already-validated
 * AutomationPlan, bound to one already-validated
 * AutomationRepositoryContext, through a dependency-injected provider.
 *
 * `provider` must implement `provider.analyze({systemPrompt, userPrompt})
 * -> Promise<string>` (scripts/ai/providers/) - never hardcoded to Groq/
 * Gemini/mock; the caller supplies it.
 *
 * `expectedProjectId`, when supplied, must equal both the plan's and the
 * repository context's own projectId (in addition to those already having
 * to equal each other) - the same optional cross-check convention every
 * frozen v1 validator and generated-change-set.js's own build/validate
 * functions already accept.
 *
 * `maxAttempts` bounds the total number of provider calls. Only
 * `undefined` (defaulting to 2), `1`, and `2` are accepted - identical
 * strict `!==` policy to automation-plan-generator.js's own
 * generateAutomationPlan(). Any other value (including `NaN`, `Infinity`,
 * `1.5`, a numeric string, `null`, or a plain object/array) is rejected
 * with a non-empty bounded error before any provider call. Any
 * locally-detected invalid input (malformed plan, malformed repository
 * context, project/framework mismatch, an outbound prompt that exceeds
 * LIMITS.MAX_OUTBOUND_PROMPT_CHARS) also makes zero provider calls for
 * that attempt.
 *
 * Returns { ok: true, generatedChangeSet, providerAttempts } or
 * { ok: false, errors: [{path,code,message}, ...], providerAttempts } -
 * never the raw provider response, the prompt, the repository context, or
 * any caller object.
 */
async function generateChangeSet({ automationPlan, repositoryContext, provider, expectedProjectId, maxAttempts } = {}) {
  if (maxAttempts !== undefined && maxAttempts !== 1 && maxAttempts !== 2) {
    return { ok: false, errors: [err("$.maxAttempts", ERROR_CODES.INVALID_VALUE, "maxAttempts must be exactly 1 or 2 (or omitted for the default of 2)")], providerAttempts: 0 };
  }
  const effectiveMaxAttempts = maxAttempts === undefined ? 2 : maxAttempts;
  if (expectedProjectId !== undefined && !isValidId(expectedProjectId)) {
    return { ok: false, errors: [err("$.expectedProjectId", ERROR_CODES.INVALID_TYPE, "expectedProjectId must be a bounded string id")], providerAttempts: 0 };
  }
  if (!provider || typeof provider.analyze !== "function") {
    return { ok: false, errors: [err("$.provider", ERROR_CODES.INVALID_TYPE, "provider.analyze must be a function")], providerAttempts: 0 };
  }

  const planSnapshot = deepFreeze(snapshotOwnData(automationPlan));
  const contextSnapshot = deepFreeze(snapshotOwnData(repositoryContext));

  const planResult = validateAutomationPlan(planSnapshot, { expectedProjectId });
  const contextErrors = [];
  validateRepositoryContextSnapshot(contextSnapshot, "$.repositoryContext", contextErrors, { expectedProjectId });

  const localErrors = [...(planResult.ok ? [] : planResult.errors), ...contextErrors];
  if (localErrors.length > 0) {
    return { ok: false, errors: localErrors, providerAttempts: 0 };
  }

  if (planSnapshot.projectId !== contextSnapshot.projectId) {
    return {
      ok: false,
      errors: [err("$.repositoryContext.projectId", ERROR_CODES.PROJECT_MISMATCH, "repositoryContext.projectId does not match automationPlan.projectId")],
      providerAttempts: 0,
    };
  }
  if (planSnapshot.framework !== contextSnapshot.framework) {
    return {
      ok: false,
      errors: [err("$.repositoryContext.framework", ERROR_CODES.INVALID_VALUE, "repositoryContext.framework does not match automationPlan.framework")],
      providerAttempts: 0,
    };
  }

  const framework = planSnapshot.framework;
  const projection = deepFreeze(buildPositiveProjection({ planSnapshot, contextSnapshot }));
  const systemPrompt = buildGenerateChangeSetSystemPrompt({ framework });

  let providerAttempts = 0;
  let lastErrors = [];

  for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
    const userPrompt = attempt === 1 ? buildGenerateChangeSetUserPrompt(projection) : buildGenerateChangeSetCorrectionPrompt(projection, boundCorrectionErrors(lastErrors));

    if (userPrompt.length > LIMITS.MAX_OUTBOUND_PROMPT_CHARS) {
      return {
        ok: false,
        errors: [err("$.repositoryContext", ERROR_CODES.INVALID_VALUE, `provider prompt exceeds the maximum of ${LIMITS.MAX_OUTBOUND_PROMPT_CHARS} characters`)],
        providerAttempts,
      };
    }

    providerAttempts = attempt;

    let rawResponse;
    try {
      rawResponse = await provider.analyze({ systemPrompt, userPrompt });
    } catch (rawError) {
      const providerError = normalizeProviderError(rawError);
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider call failed")];
      if (attempt === effectiveMaxAttempts || !providerError.retryable) {
        return { ok: false, errors: lastErrors, providerAttempts };
      }
      continue;
    }

    if (typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider returned an empty or non-string response")];
      if (attempt === effectiveMaxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }
    if (rawResponse.length > LIMITS.MAX_CHANGESET_RESPONSE_CHARS) {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, `provider response exceeds the maximum of ${LIMITS.MAX_CHANGESET_RESPONSE_CHARS} characters`)];
      if (attempt === effectiveMaxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    let parsedChanges;
    try {
      parsedChanges = JSON.parse(rawResponse.trim());
    } catch {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider response was not valid JSON")];
      if (attempt === effectiveMaxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    const shapeErrors = validateProviderChangesShape(parsedChanges);
    if (shapeErrors.length > 0) {
      lastErrors = shapeErrors;
      if (attempt === effectiveMaxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    const changes = deriveChangesWithBaseDigests(parsedChanges, contextSnapshot);
    const buildResult = buildGeneratedChangeSet({ automationPlan: planSnapshot, repositoryContext: contextSnapshot, changes, expectedProjectId });

    if (buildResult.ok) {
      return { ok: true, generatedChangeSet: buildResult.generatedChangeSet, providerAttempts };
    }

    lastErrors = buildResult.errors;
    if (attempt === effectiveMaxAttempts) {
      return { ok: false, errors: lastErrors, providerAttempts };
    }
  }

  // Unreachable in practice (the loop always returns by its last
  // iteration), kept only as a defensive fail-closed fallback.
  return { ok: false, errors: lastErrors, providerAttempts };
}

module.exports = {
  generateChangeSet,
  LIMITS,
  buildPositiveProjection,
  validateProviderChangesShape,
  deriveChangesWithBaseDigests,
};
