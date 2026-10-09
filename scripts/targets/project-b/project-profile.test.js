"use strict";

// TSB-F05-D1-C1: the second, independent target's own ProjectProfile fits the
// strict v1 contract (docs/tsb-f05-project-profile-contract-decision-v1.md
// §5.4, §19.1) - a target-compatibility proof, not a second schema.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { PROJECT_B_PROJECT_PROFILE } = require("./project-profile");
const { inspectProjectProfile, validateProjectProfile, assertValidProjectProfile } = require("../../ai/project-profile");

test("D1-C1: PROJECT_B_PROJECT_PROFILE is accepted by the central strict boundary with headroom under every bound", () => {
  const result = inspectProjectProfile(PROJECT_B_PROJECT_PROFILE);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(validateProjectProfile(PROJECT_B_PROJECT_PROFILE), { valid: true, errors: [] });
  const { id, displayName, knownProjectConstraints } = PROJECT_B_PROJECT_PROFILE;
  assert.ok(id.length <= 128);
  assert.ok(displayName.length <= 256);
  assert.ok(knownProjectConstraints.length >= 1 && knownProjectConstraints.length <= 32);
  assert.ok(knownProjectConstraints.every((c) => c.length <= 2048));
  assert.ok(knownProjectConstraints.reduce((n, c) => n + c.length, 0) <= 8192);
});

test("D1-C1: assertValidProjectProfile(PROJECT_B_PROJECT_PROFILE) returns a detached, frozen, equal-content snapshot", () => {
  const snapshot = assertValidProjectProfile(PROJECT_B_PROJECT_PROFILE, "project-b test");
  assert.notEqual(snapshot, PROJECT_B_PROJECT_PROFILE);
  assert.notEqual(snapshot.knownProjectConstraints, PROJECT_B_PROJECT_PROFILE.knownProjectConstraints);
  assert.deepEqual(snapshot, PROJECT_B_PROJECT_PROFILE);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.knownProjectConstraints), true);
});

test("D1-C1: the Project B profile carries exactly the three v1 semantic fields", () => {
  assert.deepEqual(Reflect.ownKeys(PROJECT_B_PROJECT_PROFILE).sort(), ["displayName", "id", "knownProjectConstraints"]);
});
