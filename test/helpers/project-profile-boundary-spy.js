"use strict";

/**
 * TSB-F05-D1-C1 consumer-migration test fixture.
 *
 * Loads a scripts/ai consumer module in a FRESH module graph in which
 * scripts/ai/project-profile.js's three boundary functions are wrapped by a
 * recording spy. Each successful inspection is still performed by the REAL
 * central boundary, but the spy then hands the consumer a DISTINCT
 * replacement snapshot (`replaceSnapshot(realSnapshot)`). A consumer that
 * honours D1-C1 §11 ("use only the authoritative snapshot") can therefore
 * only ever surface replacement values downstream; a consumer that reads its
 * caller's original object after the boundary surfaces the caller's values
 * instead - which is exactly the validate/assert-then-read-original pattern
 * D1-C1 forbids.
 *
 * Every call is recorded with the exact input identity, so a test can also
 * prove a caller-supplied raw profile crosses the boundary exactly once.
 *
 * TEST-ONLY, NEVER SHIPPED: lives under the repository's top-level test/
 * directory (outside package.json's `files` allowlist), and no production
 * module imports it. require.cache is restored before returning, so modules
 * loaded afterwards in the same test process see the real boundary.
 */

const path = require("node:path");

const AI_DIR = path.resolve(__dirname, "..", "..", "scripts", "ai") + path.sep;
const PROFILE_MODULE = path.join(AI_DIR, "project-profile.js");

function isAiModule(key) {
  return key.startsWith(AI_DIR);
}

function loadWithProjectProfileBoundarySpy(consumerPath, { replaceSnapshot } = {}) {
  const saved = new Map();
  for (const key of Object.keys(require.cache)) {
    if (isAiModule(key)) {
      saved.set(key, require.cache[key]);
      delete require.cache[key];
    }
  }

  try {
    const real = require(PROFILE_MODULE);
    const calls = [];
    const replace = (snapshot) => (replaceSnapshot ? replaceSnapshot(snapshot) : snapshot);
    require.cache[PROFILE_MODULE].exports = {
      inspectProjectProfile(input) {
        const result = real.inspectProjectProfile(input);
        calls.push({ fn: "inspectProjectProfile", input, valid: result.valid });
        return result.valid ? { valid: true, errors: [], snapshot: replace(result.snapshot) } : result;
      },
      validateProjectProfile(input) {
        const result = real.validateProjectProfile(input);
        calls.push({ fn: "validateProjectProfile", input, valid: result.valid });
        return result;
      },
      assertValidProjectProfile(input, callerLabel) {
        const snapshot = real.assertValidProjectProfile(input, callerLabel);
        calls.push({ fn: "assertValidProjectProfile", input, valid: true, callerLabel });
        return replace(snapshot);
      },
    };
    const consumer = require(consumerPath);
    return { consumer, calls };
  } finally {
    for (const key of Object.keys(require.cache)) {
      if (isAiModule(key)) delete require.cache[key];
    }
    for (const [key, entry] of saved) require.cache[key] = entry;
  }
}

// A fixed, valid, frozen ProjectProfile whose every value differs from any
// caller fixture - the recognisable "this came from the boundary" marker.
function boundarySnapshotReplacement() {
  return Object.freeze({
    id: "boundary-snapshot-id",
    displayName: "BOUNDARY_SNAPSHOT_DISPLAY",
    knownProjectConstraints: Object.freeze(["BOUNDARY_SNAPSHOT_CONSTRAINT"]),
  });
}

module.exports = { loadWithProjectProfileBoundarySpy, boundarySnapshotReplacement };
