/**
 * Provider-backed AutomationPlan generation (Roadmap #23C).
 *
 * Consumes one already-validated-shape AutomationCandidate v1 and one
 * AutomationRepositoryContext (scripts/ai/test-automation/
 * automation-repository-context.js) and produces one AutomationPlan v1
 * through a dependency-injected provider. This module generates a PLAN
 * ONLY - it never produces test source code, a patch, a diff, file
 * content, or a GeneratedChangeSet, never mutates the repository, and
 * never runs a browser. AutomationPlan v1 (scripts/ai/generation/
 * automation-plan.js) remains frozen and unmodified.
 *
 * INPUT SNAPSHOT: both `automationCandidate` and `repositoryContext` are
 * read exactly once, at the very start, via a single JSON round-trip
 * (snapshotPlainData() below) into fresh, #23-owned plain data. Every
 * later step - validation, project/framework binding, positive
 * projection, prompting - operates only on that snapshot, never on the
 * caller's original objects again. This closes the class of bug where a
 * caller-supplied getter could legitimately answer a validation check
 * differently than a later semantic read (a project id that validates
 * correctly, then answers differently when the generator "reads it again"
 * to build the prompt).
 *
 * PROVIDER PROJECTION: the provider never receives repositoryContext (or
 * automationCandidate) serialized wholesale. buildPositiveProjection()
 * below is the single place that decides what crosses into the prompt -
 * see its own comment. In particular, package.json script COMMAND bodies
 * are never sent (only script NAMES) - AutomationRepositoryContext
 * guarantees only targeted path/script-name minimization
 * (scripts/ai/test-automation/automation-repository-context.js), not that
 * a selected script's command text is free of secret-shaped values.
 *
 * VALIDATION: every parsed provider response is validated by the frozen
 * v1 validateAutomationPlan() (scripts/ai/generation/automation-plan.js),
 * unmodified, plus a small set of #23-local candidate/framework/path
 * binding checks that mirror (without reusing - see the comment on
 * validatePlanBinding() below) scripts/ai/generation/
 * cross-model-validation.js's own decision-authorization and
 * framework-compatibility rules, which do not apply directly here because
 * this module never has a full RequirementModel/TestCaseModel chain to
 * pass through that validator. Nothing is ever repaired, filled in, or
 * silently stripped from a provider response - every failure is reported
 * or the whole attempt is rejected.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId, isBoundedText, collectUnknownKeyErrors, collectDuplicateIdErrors, validateProjectId } = require("../generation/primitives");
const { validateAutomationCandidate } = require("../generation/automation-candidate");
const { validateAutomationPlan } = require("../generation/automation-plan");
const { normalizeProviderError } = require("../providers/provider-error");
const { buildAutomationPlanSystemPrompt, buildAutomationPlanUserPrompt, buildAutomationPlanCorrectionPrompt } = require("./automation-plan-prompt");

// #23-owned bounds - deliberately local to this module, never added to
// scripts/ai/generation/limits.js (that file bounds the frozen v1
// contracts, not this provider-orchestration stage).
const LIMITS = Object.freeze({
  // AutomationPlan v1's own frozen limits (MAX_PLANNED_CHANGES: 100,
  // SHORT_TEXT_MAX_LENGTH: 300 per path, LONG_TEXT_MAX_LENGTH: 4000 per
  // purpose, MAX_VALIDATION_STEPS: 50, LONG_TEXT_MAX_LENGTH: 4000 per
  // validation-step description) bound a maximally-large VALID plan's raw
  // JSON text at roughly 640,000 characters
  // (100 * (300 + 4000 + ~40 overhead) + 50 * (4000 + ~30 overhead)). This
  // is a pre-parse bound on the raw provider response text, checked BEFORE
  // any JSON.parse is attempted - set with headroom above that
  // schema-derived worst case (never JSON syntax/whitespace variance,
  // never a streaming/network byte protection) so no structurally-valid
  // frozen-schema plan can ever be falsely rejected by this bound alone.
  MAX_AUTOMATION_PLAN_RESPONSE_CHARS: 1000000,
  // Correction-prompt diagnostic bounds (Roadmap #23C, closing the same
  // "retry amplification" class an earlier #22 design draft was found to
  // have): a second attempt's prompt only ever receives a small, sanitized
  // {path,code,message} array - never the raw invalid response, and never
  // an unbounded validator error list.
  MAX_CORRECTION_ERRORS: 20,
  MAX_CORRECTION_DIAGNOSTIC_CHARS: 8192,
  // Defensive bounds for the #23-owned AutomationRepositoryContext-shape
  // validator below - generous headroom above #23B's own bounds
  // (MAX_SCRIPT_COUNT: 60; 20 relevant files + 1 auto config = 21 total
  // repositoryEvidence entries), since this module trusts but still
  // validates a context object that may not genuinely have come from
  // #23B's own builder.
  MAX_AVAILABLE_TEST_SCRIPTS: 60,
  MAX_REPOSITORY_EVIDENCE_ITEMS: 25,
});

const SUPPORTED_FRAMEWORKS = Object.freeze(["cypress", "playwright"]);
// Mirrors scripts/ai/test-automation/automation-repository-context.js's
// own FRAMEWORK_SOURCE_PREFIX convention, independently re-declared here
// (not imported - that module's constant is private) for the same reason
// automation-repository-context.js itself re-declares SUPPORTED_FRAMEWORKS
// rather than cross-importing scripts/ai/generation/primitives.js's:
// a two-entry literal is not worth a cross-module dependency. AutomationPlan
// v1 itself defines no framework-path scoping rule at all (verified by
// direct read of validatePlannedChange() - it checks only path safety/
// canonicality, never framework membership) - this #23-local addition is
// what actually prevents a provider from proposing a playwright/** path
// while generating a cypress plan (or the reverse), which the frozen v1
// validator alone would silently accept.
const FRAMEWORK_PATH_PREFIX = Object.freeze({ cypress: "cypress/", playwright: "playwright/" });

const CONTEXT_TOP_LEVEL_ALLOWED_KEYS = Object.freeze(["projectId", "framework", "guidance", "packageScripts", "repositoryEvidence"]);
const GUIDANCE_ALLOWED_KEYS = Object.freeze(["displayName", "knownProjectConstraints"]);
const PACKAGE_SCRIPT_ALLOWED_KEYS = Object.freeze(["name", "command"]);
const EVIDENCE_ITEM_ALLOWED_KEYS = Object.freeze(["evidenceRef", "role", "content"]);
const EVIDENCE_REF_ALLOWED_KEYS = Object.freeze(["id", "kind", "location"]);
const EVIDENCE_ROLES = Object.freeze(["framework_config", "relevant_file"]);

// Single JSON round-trip: every own-enumerable property (including one
// backed by a getter) is read exactly once during JSON.stringify's
// serialization pass, and the parsed result is a fully independent plain
// object/array/primitive tree with no live reference back to the
// caller's original value. Functions/symbols/undefined are silently
// dropped by JSON.stringify itself (never survive into the snapshot);
// a value that cannot be serialized at all (a circular reference, a
// BigInt) yields `null`, which the caller's own isPlainObject-based
// validation then rejects like any other malformed input - this function
// itself never throws.
function snapshotPlainData(value) {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== "string") return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

// Bounds and sanitizes a validator error list for inclusion in a
// correction prompt: at most MAX_CORRECTION_ERRORS entries, projected to
// only {path,code,message} (already the frozen error shape - this is a
// defensive re-projection, not a trust boundary crossing, since every
// upstream error already comes from a frozen/local validator that never
// echoes raw content). If even the truncated set's own serialized size
// exceeds MAX_CORRECTION_DIAGNOSTIC_CHARS (a pathological many-long-
// message case), falls back to a single small static summary instead -
// never a partially-truncated raw JSON string.
function boundCorrectionErrors(errors) {
  const bounded = errors.slice(0, LIMITS.MAX_CORRECTION_ERRORS).map((e) => ({ path: e.path, code: e.code, message: e.message }));
  if (JSON.stringify(bounded).length <= LIMITS.MAX_CORRECTION_DIAGNOSTIC_CHARS) return bounded;
  return [{ path: "$", code: ERROR_CODES.INVALID_VALUE, message: `validation failed with ${errors.length} error(s); diagnostics omitted for size` }];
}

// #23-owned validator for the AutomationRepositoryContext snapshot shape.
// This is NOT a frozen F0 contract (scripts/ai/test-automation/
// automation-repository-context.js is #23-owned and unversioned) - #23C
// must not assume an arbitrary object handed to it genuinely came from
// that module's own builder, so this independently re-validates the
// shape it depends on: bounded, positively-keyed, deterministic. It does
// not re-scan the filesystem or re-derive path safety - that is #23B's
// own job and already done by the time this module ever sees a context.
function validateRepositoryContextSnapshot(context, { expectedProjectId } = {}) {
  const errors = [];
  if (!isPlainObject(context)) {
    return [err("$.repositoryContext", ERROR_CODES.INVALID_TYPE, "repositoryContext must be a plain object")];
  }

  collectUnknownKeyErrors(context, CONTEXT_TOP_LEVEL_ALLOWED_KEYS, "$.repositoryContext", errors);
  validateProjectId(context.projectId, "$.repositoryContext.projectId", errors, { expectedProjectId });

  if (!SUPPORTED_FRAMEWORKS.includes(context.framework)) {
    errors.push(err("$.repositoryContext.framework", ERROR_CODES.INVALID_ENUM, `$.repositoryContext.framework must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
  }

  if (!isPlainObject(context.guidance)) {
    errors.push(err("$.repositoryContext.guidance", ERROR_CODES.INVALID_TYPE, "$.repositoryContext.guidance must be an object"));
  } else {
    collectUnknownKeyErrors(context.guidance, GUIDANCE_ALLOWED_KEYS, "$.repositoryContext.guidance", errors);
    if (typeof context.guidance.displayName !== "string" || context.guidance.displayName.trim().length === 0) {
      errors.push(err("$.repositoryContext.guidance.displayName", ERROR_CODES.INVALID_TYPE, "$.repositoryContext.guidance.displayName must be a non-empty string"));
    }
    if (!Array.isArray(context.guidance.knownProjectConstraints)) {
      errors.push(err("$.repositoryContext.guidance.knownProjectConstraints", ERROR_CODES.INVALID_TYPE, "$.repositoryContext.guidance.knownProjectConstraints must be an array"));
    }
  }

  if (!Array.isArray(context.packageScripts)) {
    errors.push(err("$.repositoryContext.packageScripts", ERROR_CODES.INVALID_TYPE, "$.repositoryContext.packageScripts must be an array"));
  } else if (context.packageScripts.length > LIMITS.MAX_AVAILABLE_TEST_SCRIPTS) {
    errors.push(err("$.repositoryContext.packageScripts", ERROR_CODES.INVALID_VALUE, `$.repositoryContext.packageScripts exceeds the maximum of ${LIMITS.MAX_AVAILABLE_TEST_SCRIPTS}`));
  } else {
    context.packageScripts.forEach((s, i) => {
      const p = `$.repositoryContext.packageScripts[${i}]`;
      if (!isPlainObject(s)) {
        errors.push(err(p, ERROR_CODES.INVALID_TYPE, `${p} must be an object`));
        return;
      }
      collectUnknownKeyErrors(s, PACKAGE_SCRIPT_ALLOWED_KEYS, p, errors);
      if (typeof s.name !== "string" || s.name.length === 0) {
        errors.push(err(`${p}.name`, ERROR_CODES.INVALID_TYPE, `${p}.name must be a non-empty string`));
      }
      if (typeof s.command !== "string" || s.command.length === 0) {
        errors.push(err(`${p}.command`, ERROR_CODES.INVALID_TYPE, `${p}.command must be a non-empty string`));
      }
    });
  }

  if (!Array.isArray(context.repositoryEvidence) || context.repositoryEvidence.length === 0) {
    errors.push(err("$.repositoryContext.repositoryEvidence", ERROR_CODES.MISSING_FIELD, "$.repositoryContext.repositoryEvidence must be a non-empty array"));
  } else if (context.repositoryEvidence.length > LIMITS.MAX_REPOSITORY_EVIDENCE_ITEMS) {
    errors.push(err("$.repositoryContext.repositoryEvidence", ERROR_CODES.INVALID_VALUE, `$.repositoryContext.repositoryEvidence exceeds the maximum of ${LIMITS.MAX_REPOSITORY_EVIDENCE_ITEMS}`));
  } else {
    context.repositoryEvidence.forEach((item, i) => {
      const p = `$.repositoryContext.repositoryEvidence[${i}]`;
      if (!isPlainObject(item)) {
        errors.push(err(p, ERROR_CODES.INVALID_TYPE, `${p} must be an object`));
        return;
      }
      collectUnknownKeyErrors(item, EVIDENCE_ITEM_ALLOWED_KEYS, p, errors);
      if (!EVIDENCE_ROLES.includes(item.role)) {
        errors.push(err(`${p}.role`, ERROR_CODES.INVALID_ENUM, `${p}.role must be one of ${EVIDENCE_ROLES.join(", ")}`));
      }
      if (typeof item.content !== "string" || item.content.length === 0) {
        errors.push(err(`${p}.content`, ERROR_CODES.INVALID_TYPE, `${p}.content must be a non-empty string`));
      }
      if (!isPlainObject(item.evidenceRef)) {
        errors.push(err(`${p}.evidenceRef`, ERROR_CODES.INVALID_TYPE, `${p}.evidenceRef must be an object`));
      } else {
        collectUnknownKeyErrors(item.evidenceRef, EVIDENCE_REF_ALLOWED_KEYS, `${p}.evidenceRef`, errors);
        if (!isValidId(item.evidenceRef.id)) {
          errors.push(err(`${p}.evidenceRef.id`, ERROR_CODES.INVALID_TYPE, `${p}.evidenceRef.id must be a bounded string id`));
        }
        if (item.evidenceRef.kind !== "repository") {
          errors.push(err(`${p}.evidenceRef.kind`, ERROR_CODES.INVALID_ENUM, `${p}.evidenceRef.kind must be "repository"`));
        }
        if (typeof item.evidenceRef.location !== "string" || item.evidenceRef.location.length === 0) {
          errors.push(err(`${p}.evidenceRef.location`, ERROR_CODES.INVALID_TYPE, `${p}.evidenceRef.location must be a non-empty string`));
        }
      }
    });
    collectDuplicateIdErrors(
      context.repositoryEvidence.map((item) => (isPlainObject(item) && isPlainObject(item.evidenceRef) ? { id: item.evidenceRef.id } : { id: undefined })),
      "id",
      "$.repositoryContext.repositoryEvidence",
      errors
    );
  }

  return errors;
}

// #23-local candidate/plan binding checks. Deliberately NOT a call into
// scripts/ai/generation/cross-model-validation.js's validateGenerationChain()
// - that validator requires a full RequirementModel + TestCaseModel +
// automationCandidates[] + automationPlans[] chain, which this module
// never has (only one already-validated AutomationCandidate and one
// generated plan). This narrowly re-implements exactly the two rules from
// that validator's own F6 check that do apply here (a plan may only
// reference an AUTOMATE candidate; a plan's framework must be one the
// candidate actually authorizes), plus the #23-local path/framework-scope
// rule described on FRAMEWORK_PATH_PREFIX above. `candidateSnapshot
// .decision === "AUTOMATE"` is already independently guaranteed by the
// caller (generateAutomationPlan() never reaches this function otherwise),
// so this only needs to check identity/framework/path binding, not
// decision again.
function validatePlanBinding(plan, candidateSnapshot, framework) {
  const errors = [];
  if (!isPlainObject(plan)) return errors; // already reported by validateAutomationPlan's own top-level check

  if (plan.automationCandidateId !== candidateSnapshot.id) {
    errors.push(err("$.automationCandidateId", ERROR_CODES.INVALID_REFERENCE, "automationCandidateId does not match the authorized AutomationCandidate"));
  }
  if (plan.framework !== framework) {
    errors.push(err("$.framework", ERROR_CODES.INVALID_VALUE, "framework does not match the authorized generation framework"));
  }

  if (Array.isArray(plan.plannedChanges)) {
    plan.plannedChanges.forEach((change, i) => {
      if (isPlainObject(change) && typeof change.path === "string" && !change.path.startsWith(FRAMEWORK_PATH_PREFIX[framework])) {
        errors.push(err(`$.plannedChanges[${i}].path`, ERROR_CODES.INVALID_PATH, `$.plannedChanges[${i}].path must be inside the ${framework} framework's directory tree`));
      }
    });
  }

  return errors;
}

// Builds the ONLY object ever sent to the provider. A deliberate positive
// allowlist - never `JSON.stringify(repositoryContext)` /
// `JSON.stringify(automationCandidate)` wholesale (see this module's own
// docstring). Package script COMMAND bodies are never included - only
// names (Roadmap #23C, Phase 15: AutomationRepositoryContext guarantees
// only targeted minimization, not that a selected script's command text
// is free of secret-shaped values).
function buildPositiveProjection({ candidateSnapshot, contextSnapshot, framework }) {
  return {
    projectId: contextSnapshot.projectId,
    framework,
    candidate: {
      id: candidateSnapshot.id,
      decision: candidateSnapshot.decision,
      rationale: candidateSnapshot.rationale,
      targetFrameworks: candidateSnapshot.targetFrameworks,
    },
    guidance: {
      displayName: contextSnapshot.guidance.displayName,
      knownProjectConstraints: contextSnapshot.guidance.knownProjectConstraints,
    },
    availableTestScripts: contextSnapshot.packageScripts.map((s) => s.name),
    repositoryEvidence: contextSnapshot.repositoryEvidence.map((item) => ({
      evidenceRef: { id: item.evidenceRef.id, kind: item.evidenceRef.kind, location: item.evidenceRef.location },
      role: item.role,
      content: item.content,
    })),
  };
}

/**
 * Generates one AutomationPlan v1 for one already-approved
 * AutomationCandidate, grounded in one AutomationRepositoryContext,
 * through a dependency-injected provider.
 *
 * `provider` must implement `provider.analyze({systemPrompt, userPrompt})
 * -> Promise<string>` (scripts/ai/providers/) - never hardcoded to Groq/
 * Gemini/mock; the caller supplies it.
 *
 * `expectedProjectId`, when supplied, must equal both the candidate's and
 * the repository context's own projectId (in addition to those already
 * having to equal each other) - the same optional cross-check convention
 * every frozen v1 validator already accepts.
 *
 * `maxAttempts` bounds the total number of provider calls (default and
 * maximum 2: one initial attempt, at most one bounded correction attempt
 * informed by the first attempt's own validation errors). Any locally-
 * detected invalid input (malformed candidate, non-AUTOMATE decision,
 * project/framework mismatch, malformed repository context) makes zero
 * provider calls.
 *
 * Returns { ok: true, automationPlan, providerAttempts } or { ok: false,
 * errors: [{path,code,message}, ...], providerAttempts } - never the raw
 * provider response, the prompt, the repository context, or any caller
 * object.
 */
async function generateAutomationPlan({ automationCandidate, repositoryContext, provider, expectedProjectId, maxAttempts = 2 } = {}) {
  if (typeof maxAttempts !== "number" || maxAttempts < 1 || maxAttempts > 2) {
    return { ok: false, errors: [err("$.maxAttempts", ERROR_CODES.INVALID_VALUE, "maxAttempts must be 1 or 2")], providerAttempts: 0 };
  }
  if (expectedProjectId !== undefined && !isValidId(expectedProjectId)) {
    return { ok: false, errors: [err("$.expectedProjectId", ERROR_CODES.INVALID_TYPE, "expectedProjectId must be a bounded string id")], providerAttempts: 0 };
  }
  if (!provider || typeof provider.analyze !== "function") {
    return { ok: false, errors: [err("$.provider", ERROR_CODES.INVALID_TYPE, "provider.analyze must be a function")], providerAttempts: 0 };
  }

  // Phase 6/7: snapshot caller-controlled inputs exactly once, before any
  // validation or semantic read. Everything below reads only these two
  // frozen local values - never automationCandidate/repositoryContext
  // again.
  const candidateSnapshot = deepFreeze(snapshotPlainData(automationCandidate));
  const contextSnapshot = deepFreeze(snapshotPlainData(repositoryContext));

  const candidateResult = validateAutomationCandidate(candidateSnapshot, { expectedProjectId });
  const contextErrors = validateRepositoryContextSnapshot(contextSnapshot, { expectedProjectId });

  const localErrors = [...(candidateResult.ok ? [] : candidateResult.errors), ...contextErrors];
  if (localErrors.length > 0) {
    return { ok: false, errors: localErrors, providerAttempts: 0 };
  }

  // Critical F0 rule (Roadmap #22/23-F0-C1): only an AUTOMATE candidate
  // may authorize AutomationPlan generation at all - checked before any
  // provider call, matching cross-model-validation.js's own F6 rule.
  if (candidateSnapshot.decision !== "AUTOMATE") {
    return {
      ok: false,
      errors: [err("$.automationCandidate.decision", ERROR_CODES.INVARIANT_VIOLATION, "only an AUTOMATE candidate may authorize AutomationPlan generation")],
      providerAttempts: 0,
    };
  }

  if (candidateSnapshot.projectId !== contextSnapshot.projectId) {
    return {
      ok: false,
      errors: [err("$.repositoryContext.projectId", ERROR_CODES.PROJECT_MISMATCH, "repositoryContext.projectId does not match automationCandidate.projectId")],
      providerAttempts: 0,
    };
  }

  const framework = contextSnapshot.framework;
  if (!candidateSnapshot.targetFrameworks.includes(framework)) {
    return {
      ok: false,
      errors: [err("$.repositoryContext.framework", ERROR_CODES.INVARIANT_VIOLATION, "repositoryContext.framework is not among the candidate's authorized target frameworks")],
      providerAttempts: 0,
    };
  }

  const projection = deepFreeze(buildPositiveProjection({ candidateSnapshot, contextSnapshot, framework }));
  const systemPrompt = buildAutomationPlanSystemPrompt({ framework });

  let providerAttempts = 0;
  let lastErrors = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    providerAttempts = attempt;
    const userPrompt = attempt === 1 ? buildAutomationPlanUserPrompt(projection) : buildAutomationPlanCorrectionPrompt(projection, boundCorrectionErrors(lastErrors));

    let rawResponse;
    try {
      rawResponse = await provider.analyze({ systemPrompt, userPrompt });
    } catch (rawError) {
      const providerError = normalizeProviderError(rawError);
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider call failed")];
      if (attempt === maxAttempts || !providerError.retryable) {
        return { ok: false, errors: lastErrors, providerAttempts };
      }
      continue;
    }

    if (typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider returned an empty or non-string response")];
      if (attempt === maxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }
    if (rawResponse.length > LIMITS.MAX_AUTOMATION_PLAN_RESPONSE_CHARS) {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, `provider response exceeds the maximum of ${LIMITS.MAX_AUTOMATION_PLAN_RESPONSE_CHARS} characters`)];
      if (attempt === maxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    let parsedPlan;
    try {
      parsedPlan = JSON.parse(rawResponse.trim());
    } catch {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider response was not valid JSON")];
      if (attempt === maxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    const planResult = validateAutomationPlan(parsedPlan, { expectedProjectId: contextSnapshot.projectId });
    const bindingErrors = validatePlanBinding(parsedPlan, candidateSnapshot, framework);
    const allErrors = [...(planResult.ok ? [] : planResult.errors), ...bindingErrors];

    if (allErrors.length === 0) {
      return { ok: true, automationPlan: deepFreeze(parsedPlan), providerAttempts };
    }

    lastErrors = allErrors;
    if (attempt === maxAttempts) {
      return { ok: false, errors: lastErrors, providerAttempts };
    }
  }

  // Unreachable in practice (the loop always returns by its last
  // iteration), kept only as a defensive fail-closed fallback.
  return { ok: false, errors: lastErrors, providerAttempts };
}

module.exports = {
  generateAutomationPlan,
  LIMITS,
  buildPositiveProjection,
  snapshotPlainData,
};
