/**
 * Project B target profile (Roadmap FPI-4A, Second-Project Onboarding
 * Proof).
 *
 * Project B is a synthetic, offline, deterministic SECOND target - it
 * exists only to prove that the generic QA-agent architecture (FPI-1/
 * FPI-2/FPI-3) actually generalizes to a target materially different from
 * scripts/targets/targomo/, not to represent a real deployed system.
 * There is no live external system under test behind this profile.
 *
 * This file follows the exact same pattern as
 * scripts/targets/targomo/project-profile.js: a target-owned, frozen
 * ProjectProfile constant, self-checked against the generic core contract
 * (scripts/ai/project-profile.js) at module load time. Generic core must
 * never import this file - see scripts/ai/architecture-boundary.test.js's
 * own generic-core-independence audit, extended by this roadmap stage to
 * also cover scripts/targets/project-b/.
 */

"use strict";

const { validateProjectProfile } = require("../../ai/project-profile");

// `id` is the single, stable, machine-readable identity every other
// Project B config (FrameworkRuntimeConfig.projectId,
// ProjectKnowledgeConfig.projectId) is built from - see
// framework-runtime-config.js/project-knowledge-config.js in this same
// directory, both of which import PROJECT_B_PROJECT_PROFILE.id rather
// than re-declaring the literal, so projectId consistency holds by
// construction, not by convention.
const PROJECT_B_PROJECT_PROFILE = Object.freeze({
  id: "project-b-synthetic-target",
  displayName: "Project B - a synthetic, offline second target used only to prove second-project onboarding",
  knownProjectConstraints: Object.freeze([
    "Project B is a synthetic, offline, deterministic second target (Roadmap FPI-4A) - it has no live external system under test and exists only to prove the generic QA-agent architecture generalizes to a materially different second target.",
  ]),
});

// Self-check at module load, mirroring
// scripts/targets/targomo/project-profile.js's own established pattern:
// fail loudly and immediately if this target's own profile doesn't
// satisfy the generic core contract, rather than letting a malformed
// target profile surface later as a confusing downstream core error.
const selfCheck = validateProjectProfile(PROJECT_B_PROJECT_PROFILE);
if (!selfCheck.valid) {
  throw new Error(`PROJECT_B_PROJECT_PROFILE fails the generic ProjectProfile contract: ${selfCheck.errors.join("; ")}`);
}

module.exports = { PROJECT_B_PROJECT_PROFILE };
