#!/usr/bin/env node
/**
 * Targomo target bootstrap for the generic centralized browser-input
 * aggregator (Roadmap FPI-2).
 *
 * Thin, static, explicit - imports the target-owned
 * TARGOMO_REPOSITORY_ROOT (see scripts/targets/targomo/repository-root.js)
 * and the generic core's aggregate-browser-context.js main(), and calls
 * the latter with the former. Contains no business logic of its own -
 * browser-input reading, primary-failure selection, and correlation
 * computation all remain entirely owned by the generic core's own
 * main().
 *
 * This bootstrap exists because the generic aggregate-browser-context.js
 * now requires an explicit `repositoryRoot` (it no longer discovers its
 * own target repository implicitly) - the workflow's own invocation
 * (previously `node scripts/ai/aggregate-browser-context.js`) is updated
 * to call this bootstrap instead, exactly mirroring the existing
 * ai:collect/ai:history/ai:analyze bootstrap pattern established by
 * Roadmap TI-1.
 */

"use strict";

const { TARGOMO_REPOSITORY_ROOT } = require("./repository-root");
const core = require("../../ai/aggregate-browser-context");

function run() {
  return core.main({ repositoryRoot: TARGOMO_REPOSITORY_ROOT });
}

if (require.main === module) {
  run();
}

module.exports = { run, TARGOMO_REPOSITORY_ROOT, core };
