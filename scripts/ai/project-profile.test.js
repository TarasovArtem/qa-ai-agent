"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateProjectProfile, assertValidProjectProfile } = require("./project-profile");

// Roadmap TI-1: this generic core module owns no concrete project
// instance - every test below uses a synthetic profile, never a real
// target's. The real Targomo profile's own shape/immutability/content is
// proven by scripts/targets/targomo/project-profile.test.js instead.

test("validateProjectProfile: accepts a well-formed synthetic profile", () => {
  const { valid, errors } = validateProjectProfile({
    id: "synthetic-project",
    displayName: "Synthetic Application",
    knownProjectConstraints: ["Synthetic project constraint."],
  });
  assert.equal(valid, true);
  assert.deepEqual(errors, []);
});

test("validateProjectProfile: rejects a missing id", () => {
  const { valid, errors } = validateProjectProfile({
    displayName: "Synthetic Application",
    knownProjectConstraints: ["Synthetic project constraint."],
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("id")));
});

test("validateProjectProfile: rejects an empty-string displayName", () => {
  const { valid, errors } = validateProjectProfile({
    id: "synthetic-project",
    displayName: "   ",
    knownProjectConstraints: ["Synthetic project constraint."],
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("displayName")));
});

test("validateProjectProfile: rejects an empty knownProjectConstraints array", () => {
  const { valid, errors } = validateProjectProfile({
    id: "synthetic-project",
    displayName: "Synthetic Application",
    knownProjectConstraints: [],
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("knownProjectConstraints")));
});

test("validateProjectProfile: rejects a non-string entry inside knownProjectConstraints", () => {
  const { valid, errors } = validateProjectProfile({
    id: "synthetic-project",
    displayName: "Synthetic Application",
    knownProjectConstraints: ["fine", 42],
  });
  assert.equal(valid, false);
  assert.ok(errors.some((e) => e.includes("knownProjectConstraints")));
});

test("validateProjectProfile: rejects null/non-object input without throwing", () => {
  assert.equal(validateProjectProfile(null).valid, false);
  assert.equal(validateProjectProfile(undefined).valid, false);
  assert.equal(validateProjectProfile("external-poi-sut").valid, false);
  assert.equal(validateProjectProfile([]).valid, false);
});

// --- assertValidProjectProfile (Roadmap TI-1) ---------------------------

test("assertValidProjectProfile: returns the profile unchanged when valid", () => {
  const profile = {
    id: "synthetic-project",
    displayName: "Synthetic Application",
    knownProjectConstraints: ["Synthetic project constraint."],
  };
  assert.equal(assertValidProjectProfile(profile, "test caller"), profile);
});

test("assertValidProjectProfile: throws PROJECT_PROFILE_REQUIRED for undefined", () => {
  assert.throws(() => assertValidProjectProfile(undefined, "test caller"), /PROJECT_PROFILE_REQUIRED: test caller/);
});

test("assertValidProjectProfile: throws PROJECT_PROFILE_REQUIRED for null", () => {
  assert.throws(() => assertValidProjectProfile(null, "test caller"), /PROJECT_PROFILE_REQUIRED: test caller/);
});

test("assertValidProjectProfile: throws PROJECT_PROFILE_INVALID for a malformed non-null profile, naming the caller and the reason", () => {
  assert.throws(
    () => assertValidProjectProfile({ id: "", displayName: "x", knownProjectConstraints: ["y"] }, "test caller"),
    /PROJECT_PROFILE_INVALID: test caller.*id/
  );
});

test("assertValidProjectProfile: throws PROJECT_PROFILE_INVALID for an empty object", () => {
  assert.throws(() => assertValidProjectProfile({}, "test caller"), /PROJECT_PROFILE_INVALID: test caller/);
});
