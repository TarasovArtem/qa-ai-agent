/**
 * ProjectProfile - stable, data-only project identity and project-specific
 * context (Roadmap #19.2).
 *
 * A ProjectProfile owns exactly two things: a stable machine-readable
 * project identity (`id`, `displayName`) and stable project-specific
 * background facts (`knownProjectConstraints`). It owns nothing else -
 * no framework identity, no current-run evidence, no classification, no
 * policy, no knowledge selection, no history reasoning, no provider
 * configuration/secrets, no browser-correlation semantics, no artifact
 * parsing, no callbacks, no dynamic code. See scripts/ai/agent-policy.js,
 * scripts/ai/providers/, scripts/ai/knowledge/, and
 * scripts/ai/aggregate-browser-context.js for those - none of them are
 * touched by this module.
 *
 * GUIDANCE, NEVER EVIDENCE: a knownProjectConstraints entry is a stable
 * background fact about the project (e.g. "the SUT is an external live
 * service this repo doesn't control"), not proof that this fact caused
 * any specific current-run failure - the same authority boundary already
 * enforced for this same content by qa-agent-prompt.js's rule 9.
 *
 * Roadmap TI-1 (Targomo Independence): this module is the GENERIC CORE
 * contract only - a shape/validator, never a concrete project instance.
 * It must never import or define a concrete target's profile (e.g.
 * Targomo's `TARGOMO_PROJECT_PROFILE`, previously exported from here).
 * A concrete profile is now target-owned - see
 * scripts/targets/targomo/project-profile.js for the real production
 * instance - and is always supplied as data to the functions that accept
 * a profile parameter (collect-context.js's main(), collect-history.js's
 * main(), qa-agent-prompt.js's buildSystemPrompt(),
 * analyze-failure.js's main()), never imported by them.
 */

"use strict";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

// Lightweight, dependency-free shape check - deliberately not a shared
// schema library, matching the "small duplicated primitives" convention
// already used by scripts/ai/knowledge/schema.js and
// scripts/ai/evaluation/*-schema.js rather than introducing a new one.
function validateProjectProfile(profile) {
  const errors = [];

  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    return { valid: false, errors: ["profile must be an object"] };
  }
  if (!isNonEmptyString(profile.id)) {
    errors.push("id must be a non-empty string");
  }
  if (!isNonEmptyString(profile.displayName)) {
    errors.push("displayName must be a non-empty string");
  }
  if (!isNonEmptyStringArray(profile.knownProjectConstraints)) {
    errors.push("knownProjectConstraints must be a non-empty array of non-empty strings");
  }

  return { valid: errors.length === 0, errors };
}

// Roadmap TI-1: shared fail-closed helper for every generic core entry
// point that requires an injected ProjectProfile (collect-context.js,
// collect-history.js, qa-agent-prompt.js, analyze-failure.js). A small,
// duplicated-primitive-style helper here (matching this file's own
// existing convention over introducing a shared validation library) -
// throws a plain Error with a stable, deterministic, bounded message
// prefix, never a fabricated/partial profile and never uncontrolled
// serialization of the invalid input. `callerLabel` is a short,
// caller-supplied string (e.g. "collect-context.main()") identifying
// where the check failed, for operator-readable errors only - never
// parsed programmatically.
function assertValidProjectProfile(profile, callerLabel) {
  if (profile === undefined || profile === null) {
    throw new Error(`PROJECT_PROFILE_REQUIRED: ${callerLabel} requires an explicit ProjectProfile; none was supplied.`);
  }
  const { valid, errors } = validateProjectProfile(profile);
  if (!valid) {
    throw new Error(`PROJECT_PROFILE_INVALID: ${callerLabel} received an invalid ProjectProfile (${errors.join("; ")}).`);
  }
  return profile;
}

module.exports = { validateProjectProfile, assertValidProjectProfile };
