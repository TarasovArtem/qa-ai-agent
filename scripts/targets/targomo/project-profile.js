/**
 * Targomo target profile - the concrete, target-owned ProjectProfile
 * instance for this repository's one real production project.
 *
 * Roadmap TI-1 (Targomo Independence, Explicit Target Profile Boundary):
 * relocated verbatim from scripts/ai/project-profile.js, where it
 * previously lived alongside (and was imported by default by) the
 * generic core. This file is the ONLY place `TARGOMO_PROJECT_PROFILE`
 * is defined; generic core modules under scripts/ai/ must never import
 * it - see scripts/targets/targomo/collect-context.js,
 * collect-history.js, and analyze-failure.js for the thin bootstraps
 * that supply it to core as explicit, validated data.
 *
 * Values, wording, order, and Object.freeze semantics are preserved
 * byte-identical to the pre-TI-1 constant - `id: "external-poi-sut"` in
 * particular must never be cosmetically renamed, since it is the stable
 * namespace key History/dataset/knowledge provenance already depends on.
 */

"use strict";

const { validateProjectProfile } = require("../../ai/project-profile");

// `id` is the canonical, stable, machine-readable project identity
// referenced elsewhere as "external-poi-sut" (context.metadata.projectId,
// ai-report.json's sourceContext.projectId, history.json's projectId) -
// this object is the only place that literal is defined; everything else
// receives it as injected data. `id` identifies the logical external POI
// SUT project itself, not any single point-in-time attribute of it - it
// is not a hostname, a vendor/brand name, or a test framework, and should
// not be renamed merely because `displayName`, `baseUrl`, the external
// vendor, or the test framework changes.
//
// `displayName` fills the exact clause the system prompt's persona
// sentence renders - kept byte-identical in wording so the production
// prompt's meaning is unchanged, only its origin (and, as of TI-1, its
// ownership) moved.
//
// `knownProjectConstraints` is preserved verbatim - same text, same
// order, no rewrite.
const TARGOMO_PROJECT_PROFILE = Object.freeze({
  id: "external-poi-sut",
  displayName: "a live, externally hosted third-party application (poi.targomo.com)",
  // Frozen (see below) - collect-context.js assigns this exact array
  // reference into context.knownProjectConstraints (no defensive copy),
  // so without freezing, a future consumer mutating "its own" context
  // data (e.g. context.knownProjectConstraints.push(...) - the same
  // in-place-mutation style buildFailureReport() already uses for
  // context.history/context.relevantKnowledge) would silently corrupt
  // this shared, singleton, process-lifetime constant for every
  // subsequent analysis, and - in the long-lived `node --test` process -
  // every later test.
  knownProjectConstraints: Object.freeze([
    "Firefox runs in this CI workflow (Roadmap #14C) in a different execution environment from Chrome/Edge: Chrome and Edge run inside a cypress/included Docker container, while Firefox runs directly on the bare GitHub Actions runner with Firefox installed explicitly. This split exists because Firefox previously hung during WebDriver session creation when run inside that same nested container - an infrastructure/sandboxing limitation of that specific setup, not evidence of a browser-specific product bug or test defect.",
    "The application under test (poi.targomo.com) is a live, externally hosted third-party service outside this repository's control - it has no staging/mocked environment, so failures can reflect real upstream instability, not just this repo's code.",
  ]),
});

// Self-check at module load: the target's own profile must itself satisfy
// the generic core contract it will be injected against - fail loudly and
// immediately if it doesn't, rather than letting a malformed target
// profile surface later as a confusing downstream core validation error.
const selfCheck = validateProjectProfile(TARGOMO_PROJECT_PROFILE);
if (!selfCheck.valid) {
  throw new Error(`TARGOMO_PROJECT_PROFILE fails the generic ProjectProfile contract: ${selfCheck.errors.join("; ")}`);
}

module.exports = { TARGOMO_PROJECT_PROFILE };
