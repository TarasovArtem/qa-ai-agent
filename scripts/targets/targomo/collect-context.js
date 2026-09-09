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
 */

"use strict";

const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const core = require("../../ai/collect-context");

function run() {
  return core.runCli({ profile: TARGOMO_PROJECT_PROFILE });
}

if (require.main === module) {
  run();
}

module.exports = { run, TARGOMO_PROJECT_PROFILE, core };
