#!/usr/bin/env node
/**
 * Targomo target bootstrap for the generic QA failure analyzer.
 *
 * Roadmap TI-1: thin, static, explicit - imports the target-owned
 * TARGOMO_PROJECT_PROFILE and the generic core's analyze-failure.js
 * main(), and calls the latter with the former. Contains no business
 * logic of its own - provider selection, prompt construction, policy
 * enforcement, and report writing all remain entirely owned by the
 * generic core's own main().
 */

"use strict";

const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const core = require("../../ai/analyze-failure");

function run() {
  return core.main({ projectProfile: TARGOMO_PROJECT_PROFILE });
}

if (require.main === module) {
  run().catch((err) => {
    process.stderr.write(`[ai:analyze] Error: ${(err && err.message) || String(err)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run, TARGOMO_PROJECT_PROFILE, core };
