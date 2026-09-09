#!/usr/bin/env node
/**
 * Targomo target bootstrap for the generic flaky-test history collector.
 *
 * Roadmap TI-1: thin, static, explicit - imports the target-owned
 * TARGOMO_PROJECT_PROFILE and the generic core's collect-history.js
 * main(), and calls the latter with the former. Contains no business
 * logic of its own. Framework selection (QA_FRAMEWORK) and every other
 * History-collection concern remain entirely owned by the generic core's
 * own main() - this bootstrap supplies project identity only.
 */

"use strict";

const { TARGOMO_PROJECT_PROFILE } = require("./project-profile");
const core = require("../../ai/collect-history");

function run() {
  return core.main({ profile: TARGOMO_PROJECT_PROFILE });
}

if (require.main === module) {
  run().catch((err) => {
    process.stderr.write(`[ai:history] ${(err && err.message) || String(err)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { run, TARGOMO_PROJECT_PROFILE, core };
