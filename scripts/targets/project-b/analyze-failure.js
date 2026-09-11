/**
 * Project B target bootstrap for the generic QA failure analyzer
 * (Roadmap FPI-4A, Second-Project Onboarding Proof).
 *
 * Thin, target-owned, explicit - imports the target-owned
 * PROJECT_B_PROJECT_PROFILE and PROJECT_B_PROJECT_KNOWLEDGE_CONFIG and
 * calls the generic core's analyze-failure.js main() with them, mirroring
 * scripts/targets/targomo/analyze-failure.js's own shape.
 *
 * `repositoryRoot` is an explicit run() parameter, not a fixed
 * module-level constant - see collect-context.js's own comment in this
 * directory for why.
 */

"use strict";

const core = require("../../ai/analyze-failure");
const { PROJECT_B_PROJECT_PROFILE } = require("./project-profile");
const { PROJECT_B_PROJECT_KNOWLEDGE_CONFIG } = require("./project-knowledge-config");

function run({ repositoryRoot } = {}) {
  return core.main({
    projectProfile: PROJECT_B_PROJECT_PROFILE,
    repositoryRoot,
    projectKnowledgeConfig: PROJECT_B_PROJECT_KNOWLEDGE_CONFIG,
  });
}

module.exports = { run, PROJECT_B_PROJECT_PROFILE, PROJECT_B_PROJECT_KNOWLEDGE_CONFIG, core };
