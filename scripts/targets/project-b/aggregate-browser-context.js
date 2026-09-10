/**
 * Project B target bootstrap for the generic centralized browser-input
 * aggregator (Roadmap FPI-4A, Second-Project Onboarding Proof).
 *
 * Thin, target-owned, explicit - calls the generic core's
 * aggregate-browser-context.js main() with a caller-supplied
 * repositoryRoot, mirroring
 * scripts/targets/targomo/aggregate-browser-context.js's own shape.
 * aggregate-browser-context.js's main() accepts only `repositoryRoot`
 * (confirmed by reading scripts/ai/aggregate-browser-context.js before
 * implementing this file) - it has no FrameworkRuntimeConfig or
 * ProjectKnowledgeConfig consumption of its own, so none is invented
 * here.
 *
 * `repositoryRoot` is an explicit run() parameter, not a fixed
 * module-level constant - see collect-context.js's own comment in this
 * directory for why.
 */

"use strict";

const core = require("../../ai/aggregate-browser-context");

function run({ repositoryRoot } = {}) {
  return core.main({ repositoryRoot });
}

module.exports = { run, core };
