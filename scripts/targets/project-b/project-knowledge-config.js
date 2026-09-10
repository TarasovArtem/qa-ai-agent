/**
 * Project B target-owned ProjectKnowledgeConfig producer (Roadmap FPI-4A).
 *
 * Mirrors framework-runtime-config.js's own rationale in this directory:
 * FPI-3b wired a real CONSUMER for ProjectKnowledgeConfig
 * (analyze-failure.js's computeRelevantKnowledge()), but no production-
 * shaped code ever constructed one - every prior example lived only
 * inside test bodies. This is the first real target-owned producer.
 *
 * `projectKnowledgeUnitsDir` deliberately differs from every path already
 * used elsewhere in this repository's history (Targomo supplies no
 * ProjectKnowledgeConfig at all; earlier FPI-3b test fixtures used
 * "project-ai-knowledge"/"review-project-intelligence") - see the FPI-4A
 * mission's explicit instruction to use a genuinely new, target-owned
 * path.
 */

"use strict";

const { assertValidProjectKnowledgeConfig } = require("../../ai/project-knowledge-config");
const { PROJECT_B_PROJECT_PROFILE } = require("./project-profile");

const PROJECT_B_PROJECT_KNOWLEDGE_CONFIG = Object.freeze({
  projectId: PROJECT_B_PROJECT_PROFILE.id,
  projectKnowledgeUnitsDir: "project-b-intelligence",
});

// Self-check at module load, matching project-profile.js's own
// established convention.
assertValidProjectKnowledgeConfig(
  PROJECT_B_PROJECT_KNOWLEDGE_CONFIG,
  "scripts/targets/project-b/project-knowledge-config.js self-check"
);

module.exports = { PROJECT_B_PROJECT_KNOWLEDGE_CONFIG };
