#!/usr/bin/env node
/**
 * Targomo target bootstrap for the generic failure-context collector.
 *
 * Roadmap TI-1: thin, static, explicit - imports the target-owned
 * TARGOMO_PROJECT_PROFILE and the generic core's collect-context.js
 * runCli() seam, and calls the latter with the former. Contains no
 * business logic, no provider logic, no history logic, no framework
 * parsing, no test-result parsing, no policy decisions, no dynamic
 * require. Framework selection (QA_FRAMEWORK) remains entirely owned by
 * the generic core's own runCli() - this bootstrap supplies project
 * identity only.
 *
 * Roadmap FPI-2: also supplies the target-owned TARGOMO_REPOSITORY_ROOT
 * (see scripts/targets/targomo/repository-root.js) - the generic core no
 * longer discovers its own target repository implicitly, so this
 * bootstrap now supplies BOTH identity (profile) and location
 * (repositoryRoot) as explicit data.
 */

"use strict";

const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const { TARGOMO_REPOSITORY_ROOT } = require("./repository-root");
const core = require("../../ai/collect-context");

function run() {
  return core.runCli({ profile: TARGOMO_PROJECT_PROFILE, repositoryRoot: TARGOMO_REPOSITORY_ROOT });
}

if (require.main === module) {
  run();
}

module.exports = { run, TARGOMO_PROJECT_PROFILE, TARGOMO_REPOSITORY_ROOT, core };
