/**
 * Project B target bootstrap for the generic flaky-test history collector
 * (Roadmap FPI-4A, Second-Project Onboarding Proof).
 *
 * Thin, target-owned, explicit - imports the target-owned
 * PROJECT_B_PROJECT_PROFILE and PROJECT_B_FRAMEWORK_RUNTIME_CONFIG and
 * calls the generic core's collect-history.js main() with them, mirroring
 * scripts/targets/targomo/collect-history.js's own shape.
 *
 * API note (pre-existing, unchanged by this roadmap stage -
 * collect-history.js has zero diff): unlike collect-context.js's main(),
 * collect-history.js's main() has no `adapter` injection parameter at
 * all - it always internally resolves the active framework via
 * `selectRuntimeAdapter(process.env.QA_FRAMEWORK)`. For Project B's
 * configured historyWorkflowFile to actually be selected (which requires
 * the resolved adapter.id to equal
 * PROJECT_B_FRAMEWORK_RUNTIME_CONFIG.framework, "playwright"), the CALLER
 * must set QA_FRAMEWORK=playwright for the duration of this call - see
 * the FPI-4A portability proof test's own env-scoping helper. This
 * bootstrap does not (and must not) mutate process.env itself; that would
 * be a global side effect outside its own narrow responsibility.
 *
 * `repositoryRoot` is an explicit run() parameter, not a fixed
 * module-level constant - see collect-context.js's own comment in this
 * directory for why.
 */

"use strict";

const core = require("../../ai/collect-history");
const { PROJECT_B_PROJECT_PROFILE } = require("./project-profile");
const { PROJECT_B_FRAMEWORK_RUNTIME_CONFIG } = require("./framework-runtime-config");

function run({ repositoryRoot } = {}) {
  return core.main({
    profile: PROJECT_B_PROJECT_PROFILE,
    repositoryRoot,
    frameworkRuntimeConfig: PROJECT_B_FRAMEWORK_RUNTIME_CONFIG,
  });
}

module.exports = { run, PROJECT_B_PROJECT_PROFILE, PROJECT_B_FRAMEWORK_RUNTIME_CONFIG, core };
