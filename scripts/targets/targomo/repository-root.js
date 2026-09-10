/**
 * Targomo target repository root (Roadmap FPI-2, Full Project
 * Independence).
 *
 * Targomo is currently co-located inside this same qa-ai-agent repository
 * checkout - the target's own repository root is therefore this
 * checkout's root. Computed once here, from this file's own location,
 * so every Targomo bootstrap (collect-context.js, collect-history.js,
 * analyze-failure.js, aggregate-browser-context.js) supplies the
 * identical value rather than each independently recomputing "three
 * levels up from scripts/targets/targomo/".
 *
 * This is a TARGET-owned fact, never imported by generic core - the
 * generic core (scripts/ai/**) receives it only as an explicit
 * `repositoryRoot` argument passed in by these bootstraps, exactly the
 * same ownership direction TI-1 already established for
 * TARGOMO_PROJECT_PROFILE (see scripts/targets/targomo/project-profile.js).
 */

"use strict";

const path = require("path");

const TARGOMO_REPOSITORY_ROOT = path.resolve(__dirname, "..", "..", "..");

module.exports = { TARGOMO_REPOSITORY_ROOT };
