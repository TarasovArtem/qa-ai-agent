/**
 * Project B target bootstrap for the generic failure-context collector
 * (Roadmap FPI-4A, Second-Project Onboarding Proof).
 *
 * Thin, target-owned, explicit - imports the target-owned
 * PROJECT_B_PROJECT_PROFILE and PROJECT_B_FRAMEWORK_RUNTIME_CONFIG and
 * calls the generic core's collect-context.js main() with them. Contains
 * no business logic of its own, exactly mirroring
 * scripts/targets/targomo/collect-context.js's own shape.
 *
 * Two deliberate differences from Targomo's bootstrap, both explained in
 * the FPI-4A final report:
 *
 * 1. This calls core.main() directly (with an explicitly selected
 *    playwrightAdapter) rather than core.runCli() - runCli() only ever
 *    reads QA_FRAMEWORK and forwards {adapter, profile, repositoryRoot} to
 *    main(), with no channel for adapterOptions (and therefore no channel
 *    for frameworkRuntimeConfig) at all. This is a pre-existing generic
 *    core API shape (unchanged by this roadmap stage - collect-context.js
 *    has zero diff), not something FPI-4A introduces.
 *
 * 2. `repositoryRoot` is an explicit run() parameter, not a fixed
 *    module-level constant like Targomo's TARGOMO_REPOSITORY_ROOT. Project
 *    B is a reusable architecture-proof harness, not a single real
 *    deployment - its repositoryRoot is always a physically separate,
 *    caller-supplied synthetic repository (see
 *    scripts/targets/project-b/project-b-portability.test.js), never this
 *    checkout's own location. This file therefore has no
 *    `require.main === module` CLI entrypoint either: Project B is never
 *    run standalone, only exercised by the FPI-4A proof.
 */

"use strict";

const playwrightAdapter = require("../../ai/adapters/playwright-adapter");
const core = require("../../ai/collect-context");
const { PROJECT_B_PROJECT_PROFILE } = require("./project-profile");
const { PROJECT_B_FRAMEWORK_RUNTIME_CONFIG } = require("./framework-runtime-config");

function run({ repositoryRoot } = {}) {
  return core.main({
    adapter: playwrightAdapter,
    adapterOptions: { frameworkRuntimeConfig: PROJECT_B_FRAMEWORK_RUNTIME_CONFIG },
    profile: PROJECT_B_PROJECT_PROFILE,
    repositoryRoot,
  });
}

module.exports = { run, PROJECT_B_PROJECT_PROFILE, PROJECT_B_FRAMEWORK_RUNTIME_CONFIG, core };
