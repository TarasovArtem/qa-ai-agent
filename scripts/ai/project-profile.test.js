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

// TSB-F05-D1-C1 (intentional BREAKING public behavior correction): this test
// previously asserted `assertValidProjectProfile(profile) === profile` - the
// old weak contract that returned the caller-owned live object. D1-C1 §9.2/
// §9.4 replaces that with a detached, deep-frozen authoritative snapshot.
test("assertValidProjectProfile: returns a detached, frozen, equal-content snapshot - never the caller object (D1-C1 §9.4)", () => {
  const profile = {
    id: "synthetic-project",
    displayName: "Synthetic Application",
    knownProjectConstraints: ["Synthetic project constraint."],
  };
  const snapshot = assertValidProjectProfile(profile, "test caller");
  assert.notEqual(snapshot, profile);
  assert.notEqual(snapshot.knownProjectConstraints, profile.knownProjectConstraints);
  assert.deepEqual(snapshot, profile);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.knownProjectConstraints), true);
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

// =============================================================================
// TSB-F05-D1-C1 - strict snapshotting ProjectProfile contract
// (docs/tsb-f05-project-profile-contract-decision-v1.md §§4-10, §19)
// =============================================================================

const { inspectProjectProfile } = require("./project-profile");
const projectProfileModule = require("./project-profile");

function validProfile(overrides = {}) {
  return {
    id: "synthetic-project",
    displayName: "Synthetic Application",
    knownProjectConstraints: ["First synthetic constraint.", "Second synthetic constraint."],
    ...overrides,
  };
}

// A Proxy handler that counts every trap invocation and would throw (or
// behave inconsistently) if any trap were actually reached.
function countingHandler(behavior = "throw") {
  const counts = { total: 0 };
  const handler = {};
  for (const trap of ["get", "set", "has", "ownKeys", "getOwnPropertyDescriptor", "getPrototypeOf", "setPrototypeOf", "defineProperty", "deleteProperty", "isExtensible", "preventExtensions", "apply", "construct"]) {
    handler[trap] = (target, ...args) => {
      counts.total += 1;
      counts[trap] = (counts[trap] || 0) + 1;
      if (behavior === "throw") throw new Error(`TRAP_SECRET_${trap}`);
      if (behavior === "inconsistent") {
        if (trap === "ownKeys") return ["id", "displayName", "knownProjectConstraints", "injected"];
        if (trap === "get") return `MUTATED_${String(args[0])}`;
      }
      return Reflect[trap](target, ...args);
    };
  }
  return { handler, counts };
}

function assertBothReject(input, pattern) {
  const result = inspectProjectProfile(input);
  assert.equal(result.valid, false, "inspectProjectProfile must reject");
  assert.equal(result.snapshot, undefined);
  assert.ok(Array.isArray(result.errors) && result.errors.length > 0);
  const validated = validateProjectProfile(input);
  assert.equal(validated.valid, false, "validateProjectProfile must reject");
  assert.deepEqual(validated.errors, result.errors, "validate/inspect diagnostics must be identical");
  assert.throws(() => assertValidProjectProfile(input, "test caller"), (e) => {
    assert.match(e.message, /^PROJECT_PROFILE_INVALID: test caller /);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
  if (pattern) assert.ok(result.errors.some((m) => pattern.test(m)), `expected an error matching ${pattern}, got ${JSON.stringify(result.errors)}`);
  return result;
}

function assertBothAccept(input) {
  const result = inspectProjectProfile(input);
  assert.equal(result.valid, true, `expected acceptance, got ${JSON.stringify(result.errors)}`);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(validateProjectProfile(input), { valid: true, errors: [] });
  const asserted = assertValidProjectProfile(input, "test caller");
  assert.deepEqual(asserted, result.snapshot);
  return result.snapshot;
}

// --- module surface ------------------------------------------------------------

test("D1-C1: project-profile.js exposes exactly validate/assert/inspect (no second validator, no weak bridge)", () => {
  assert.deepEqual(Object.keys(projectProfileModule).sort(), ["assertValidProjectProfile", "inspectProjectProfile", "validateProjectProfile"]);
});

test("D1-C1: inspectProjectProfile/validateProjectProfile are NOT supported root package exports", () => {
  const root = require("./index");
  assert.equal(Object.prototype.hasOwnProperty.call(root, "inspectProjectProfile"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(root, "validateProjectProfile"), false);
  assert.equal(root.assertValidProjectProfile, assertValidProjectProfile);
});

// --- §19.1 happy path / canonical snapshot ---------------------------------------

test("D1-C1 happy: an exact ordinary profile is accepted with a detached deep-frozen snapshot", () => {
  const input = validProfile();
  const result = inspectProjectProfile(input);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(Object.keys(result).sort(), ["errors", "snapshot", "valid"]);
  const { snapshot } = result;
  assert.notEqual(snapshot, input);
  assert.notEqual(snapshot.knownProjectConstraints, input.knownProjectConstraints);
  assert.deepEqual(Reflect.ownKeys(snapshot), ["id", "displayName", "knownProjectConstraints"]);
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.equal(Object.getPrototypeOf(snapshot.knownProjectConstraints), Array.prototype);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.knownProjectConstraints), true);
  assert.deepEqual(snapshot, input);
});

test("D1-C1 happy: a null-prototype record is accepted and canonicalized into an ordinary snapshot", () => {
  const input = Object.assign(Object.create(null), validProfile());
  const snapshot = assertBothAccept(input);
  assert.equal(Object.getPrototypeOf(snapshot), Object.prototype);
  assert.deepEqual({ ...snapshot }, { ...input });
});

test("D1-C1 happy: frozen and sealed ordinary profiles are accepted", () => {
  assertBothAccept(Object.freeze({ ...validProfile(), knownProjectConstraints: Object.freeze(["c1"]) }));
  assertBothAccept(Object.seal({ ...validProfile(), knownProjectConstraints: Object.seal(["c1"]) }));
});

test("D1-C1 happy: a JSON round-trip profile is accepted", () => {
  assertBothAccept(JSON.parse(JSON.stringify(validProfile())));
});

test("D1-C1 happy: exact string content and constraint order are preserved (no trim/normalize/case-fold)", () => {
  const input = validProfile({
    id: "  Mixed-Case-ID  ",
    displayName: " Café Display ",
    knownProjectConstraints: ["  zeta  ", "Alpha", "zeta  ", "é"],
  });
  const snapshot = assertBothAccept(input);
  assert.equal(snapshot.id, "  Mixed-Case-ID  ");
  assert.equal(snapshot.displayName, " Café Display ");
  assert.deepEqual([...snapshot.knownProjectConstraints], ["  zeta  ", "Alpha", "zeta  ", "é"]);
});

test("D1-C1 happy: duplicate constraint strings remain allowed", () => {
  assertBothAccept(validProfile({ knownProjectConstraints: ["same", "same"] }));
});

// --- §19.2 top-level closed-schema negatives ---------------------------------------

test("D1-C1 top-level: an unknown enumerable own key is rejected", () => {
  assertBothReject(validProfile({ extra: "x" }), /unknown key/);
});

test("D1-C1 top-level: an unknown non-enumerable own key is rejected", () => {
  const input = validProfile();
  Object.defineProperty(input, "hidden", { value: "x", enumerable: false });
  assertBothReject(input, /unknown key/);
});

test("D1-C1 top-level: an own symbol key is rejected", () => {
  assertBothReject({ ...validProfile(), [Symbol("s")]: "x" }, /symbol/);
});

test("D1-C1 top-level: each missing required field is rejected", () => {
  for (const field of ["id", "displayName", "knownProjectConstraints"]) {
    const input = validProfile();
    delete input[field];
    assertBothReject(input, new RegExp(`${field} is required`));
  }
});

test("D1-C1 top-level: a class instance / custom-prototype object is rejected", () => {
  class Profile {
    constructor() {
      Object.assign(this, validProfile());
    }
  }
  assertBothReject(new Profile(), /plain object/);
  assertBothReject(Object.assign(Object.create({ inherited: true }), validProfile()), /plain object/);
});

test("D1-C1 top-level: arrays, functions, primitives and boxed/exotic values are rejected", () => {
  for (const input of [[], () => {}, "x", 1, true, Symbol("x"), new String("x"), new Date(0), new Map()]) {
    assert.equal(inspectProjectProfile(input).valid, false);
    assert.equal(validateProjectProfile(input).valid, false);
    assert.throws(() => assertValidProjectProfile(input, "test caller"), /PROJECT_PROFILE_INVALID/);
  }
});

test("D1-C1 top-level: an inherited required value is rejected (own data only)", () => {
  const input = Object.create({ id: "inherited-id" });
  input.displayName = "x";
  input.knownProjectConstraints = ["c"];
  assertBothReject(input);
  const nullProtoMissing = Object.assign(Object.create(null), { displayName: "x", knownProjectConstraints: ["c"] });
  assertBothReject(nullProtoMissing, /id is required/);
  Object.prototype.id = "POLLUTED_ID";
  try {
    assertBothReject({ displayName: "x", knownProjectConstraints: ["c"] }, /id is required/);
  } finally {
    delete Object.prototype.id;
  }
});

test("D1-C1 top-level: a non-enumerable required field is rejected", () => {
  const input = validProfile();
  Object.defineProperty(input, "displayName", { value: "x", enumerable: false });
  assertBothReject(input, /displayName must be an enumerable data property/);
});

test("D1-C1 top-level: getter, setter-only, and throwing-getter required fields are rejected without invoking the accessor", () => {
  const calls = { get: 0, set: 0 };
  const getterInput = validProfile();
  Object.defineProperty(getterInput, "id", { get() { calls.get += 1; return "x"; }, enumerable: true });
  assertBothReject(getterInput, /id must be an enumerable data property/);

  const setterOnly = validProfile();
  Object.defineProperty(setterOnly, "displayName", { set() { calls.set += 1; }, enumerable: true });
  assertBothReject(setterOnly, /displayName must be an enumerable data property/);

  const throwing = validProfile();
  Object.defineProperty(throwing, "knownProjectConstraints", { get() { calls.get += 1; throw new Error("GETTER_SECRET_STACK"); }, enumerable: true });
  const result = assertBothReject(throwing, /knownProjectConstraints must be an enumerable data property/);
  assert.ok(!result.errors.join(" ").includes("GETTER_SECRET_STACK"));

  assert.deepEqual(calls, { get: 0, set: 0 });
});

// --- §19.3 Proxy negatives -----------------------------------------------------------

test("D1-C1 Proxy: a top-level Proxy (passthrough, throwing, inconsistent traps) is rejected with zero trap invocations", () => {
  for (const behavior of ["passthrough", "throw", "inconsistent"]) {
    const { handler, counts } = countingHandler(behavior);
    const proxy = new Proxy(validProfile(), handler);
    const result = inspectProjectProfile(proxy);
    assert.equal(result.valid, false);
    assert.deepEqual(result.errors, ["profile must not be a Proxy"]);
    assert.equal(validateProjectProfile(proxy).valid, false);
    assert.throws(() => assertValidProjectProfile(proxy, "test caller"), /PROJECT_PROFILE_INVALID: test caller .*Proxy/);
    assert.equal(counts.total, 0, `${behavior}: trap counters must remain zero, got ${JSON.stringify(counts)}`);
  }
});

test("D1-C1 Proxy: a proxied knownProjectConstraints Array is rejected before Array inspection, with zero trap invocations", () => {
  for (const behavior of ["passthrough", "throw", "inconsistent"]) {
    const { handler, counts } = countingHandler(behavior);
    const input = validProfile({ knownProjectConstraints: new Proxy(["c1"], handler) });
    const result = assertBothReject(input, /knownProjectConstraints must not be a Proxy/);
    assert.ok(!result.errors.join(" ").includes("TRAP_SECRET"));
    assert.equal(counts.total, 0, `${behavior}: trap counters must remain zero, got ${JSON.stringify(counts)}`);
  }
});

test("D1-C1 Proxy: a revoked Proxy (top-level or constraints) is rejected deterministically without throwing", () => {
  const top = Proxy.revocable(validProfile(), {});
  top.revoke();
  assert.deepEqual(inspectProjectProfile(top.proxy), { valid: false, errors: ["profile must not be a Proxy"] });
  assert.equal(validateProjectProfile(top.proxy).valid, false);
  assert.throws(() => assertValidProjectProfile(top.proxy, "test caller"), /PROJECT_PROFILE_INVALID/);

  const inner = Proxy.revocable(["c1"], {});
  inner.revoke();
  assertBothReject(validProfile({ knownProjectConstraints: inner.proxy }), /knownProjectConstraints must not be a Proxy/);
});

// --- §19.4 Array contract negatives -------------------------------------------------

test("D1-C1 Array: empty and 33-entry arrays are rejected; 1 and 32 entries are accepted", () => {
  assertBothReject(validProfile({ knownProjectConstraints: [] }), /knownProjectConstraints must contain 1\.\.32 entries/);
  assertBothReject(validProfile({ knownProjectConstraints: Array.from({ length: 33 }, (_, i) => `c${i}`) }), /1\.\.32/);
  assertBothAccept(validProfile({ knownProjectConstraints: ["only"] }));
  assertBothAccept(validProfile({ knownProjectConstraints: Array.from({ length: 32 }, (_, i) => `c${i}`) }));
});

test("D1-C1 Array: a huge sparse length is rejected by the count bound before index iteration", () => {
  const huge = [];
  huge.length = 2 ** 32 - 1;
  const calls = { get: 0 };
  Object.defineProperty(huge, "0", { get() { calls.get += 1; return "x"; }, enumerable: true, configurable: true });
  const started = Date.now();
  const result = assertBothReject(validProfile({ knownProjectConstraints: huge }), /1\.\.32/);
  assert.ok(Date.now() - started < 1000, "count bound must short-circuit before iteration");
  assert.equal(calls.get, 0);
  assert.equal(result.errors.some((m) => m.includes("[0]")), false, "no element may be inspected after the count bound fails");
});

test("D1-C1 Array: holes, accessor, non-enumerable and inherited elements are rejected without invoking accessors", () => {
  // eslint-disable-next-line no-sparse-arrays
  assertBothReject(validProfile({ knownProjectConstraints: ["a", , "c"] }), /knownProjectConstraints\[1\] is missing/);

  const calls = { get: 0 };
  const accessor = ["a", "b"];
  Object.defineProperty(accessor, "1", { get() { calls.get += 1; return "x"; }, enumerable: true });
  assertBothReject(validProfile({ knownProjectConstraints: accessor }), /knownProjectConstraints\[1\] must be an enumerable data property/);
  assert.equal(calls.get, 0);

  const nonEnumerable = ["a", "b"];
  Object.defineProperty(nonEnumerable, "0", { value: "a", enumerable: false });
  assertBothReject(validProfile({ knownProjectConstraints: nonEnumerable }), /knownProjectConstraints\[0\] must be an enumerable data property/);

  const inherited = [];
  inherited.length = 1;
  Array.prototype[0] = "INHERITED_ELEMENT";
  try {
    assertBothReject(validProfile({ knownProjectConstraints: inherited }), /knownProjectConstraints\[0\] is missing/);
  } finally {
    delete Array.prototype[0];
  }
});

test("D1-C1 Array: extra own string and symbol properties are rejected", () => {
  const extra = ["a"];
  extra.note = "x";
  assertBothReject(validProfile({ knownProjectConstraints: extra }), /knownProjectConstraints has unknown key/);
  const sym = ["a"];
  sym[Symbol("s")] = "x";
  assertBothReject(validProfile({ knownProjectConstraints: sym }), /knownProjectConstraints must not have symbol keys/);
});

test("D1-C1 Array: subclass/custom-prototype/array-like/non-array values are rejected", () => {
  class SubArray extends Array {}
  assertBothReject(validProfile({ knownProjectConstraints: SubArray.from(["a"]) }), /knownProjectConstraints must be an Array with Array\.prototype/);
  const custom = ["a"];
  Object.setPrototypeOf(custom, Object.create(Array.prototype));
  assertBothReject(validProfile({ knownProjectConstraints: custom }), /Array\.prototype/);
  assertBothReject(validProfile({ knownProjectConstraints: { 0: "a", length: 1 } }), /knownProjectConstraints must be an Array/);
  assertBothReject(validProfile({ knownProjectConstraints: "a" }), /knownProjectConstraints must be an Array/);
  assertBothReject(validProfile({ knownProjectConstraints: null }), /knownProjectConstraints must be an Array/);
});

test("D1-C1 Array: caller-controlled Array methods are never invoked", () => {
  const input = ["a", "b"];
  const calls = { n: 0 };
  for (const name of ["map", "slice", "every", "forEach", "filter", "reduce", "concat", "join", Symbol.iterator]) {
    Object.defineProperty(input, name, { value: () => { calls.n += 1; throw new Error("ARRAY_METHOD_SECRET"); }, enumerable: false });
  }
  // Own method overrides are themselves extra own keys and are rejected -
  // without ever being invoked.
  const result = assertBothReject(validProfile({ knownProjectConstraints: input }));
  assert.ok(!result.errors.join(" ").includes("ARRAY_METHOD_SECRET"));
  assert.equal(calls.n, 0);
});

test("D1-C1 Array: per-entry 2048 and aggregate 8192 UTF-16 bounds", () => {
  assertBothAccept(validProfile({ knownProjectConstraints: ["x".repeat(2048)] }));
  assertBothReject(validProfile({ knownProjectConstraints: ["x".repeat(2049)] }), /knownProjectConstraints\[0\] exceeds 2048/);
  assertBothAccept(validProfile({ knownProjectConstraints: ["a", "b", "c", "d"].map((c) => c.repeat(2048)) }));
  assertBothReject(validProfile({ knownProjectConstraints: ["a", "b", "c", "d", "e"].map((c) => c.repeat(2048)) }), /aggregate .*8192/);
  assertBothReject(validProfile({ knownProjectConstraints: [...["a", "b", "c", "d"].map((c) => c.repeat(2048)), "e"] }), /8192/);
});

// --- §19.5 string/bound negatives ---------------------------------------------------

test("D1-C1 strings: blank values are rejected in every field", () => {
  for (const blank of ["", " ", "   ", " ", " "]) {
    assertBothReject(validProfile({ id: blank }), /id must contain a non-whitespace character/);
    assertBothReject(validProfile({ displayName: blank }), /displayName must contain a non-whitespace character/);
    assertBothReject(validProfile({ knownProjectConstraints: ["ok", blank] }), /knownProjectConstraints\[1\] must contain a non-whitespace character/);
  }
});

test("D1-C1 strings: non-string values are rejected in every field", () => {
  for (const bad of [1, null, undefined, {}, ["x"], true]) {
    assertBothReject(validProfile({ id: bad }), /id must be a string/);
    assertBothReject(validProfile({ displayName: bad }), /displayName must be a string/);
    assertBothReject(validProfile({ knownProjectConstraints: [bad] }), /knownProjectConstraints\[0\] must be a string/);
  }
});

test("D1-C1 strings: id 128/129 and displayName 256/257 boundaries", () => {
  assertBothAccept(validProfile({ id: "i".repeat(128) }));
  assertBothReject(validProfile({ id: "i".repeat(129) }), /id exceeds 128/);
  assertBothAccept(validProfile({ displayName: "d".repeat(256) }));
  assertBothReject(validProfile({ displayName: "d".repeat(257) }), /displayName exceeds 256/);
});

test("D1-C1 strings: an unbounded (P-05 100,000-unit) displayName is rejected", () => {
  assertBothReject(validProfile({ displayName: "d".repeat(100000) }), /displayName exceeds 256/);
});

test("D1-C1 strings: bounds are measured in UTF-16 code units (String.length), not code points", () => {
  const astral = "\u{1F600}"; // 2 UTF-16 code units, 1 code point
  assert.equal(astral.length, 2);
  assertBothAccept(validProfile({ id: astral.repeat(64) }));
  assertBothReject(validProfile({ id: astral.repeat(64) + "x" }), /id exceeds 128/);
  assertBothAccept(validProfile({ displayName: astral.repeat(128) }));
  assertBothReject(validProfile({ displayName: astral.repeat(128) + "x" }), /displayName exceeds 256/);
  assertBothAccept(validProfile({ knownProjectConstraints: [astral.repeat(1024)] }));
  assertBothReject(validProfile({ knownProjectConstraints: [astral.repeat(1024) + "x"] }), /2048/);
});

test("D1-C1 strings: every C0 control (U+0000..U+001F) and DEL (U+007F) is rejected in every field", () => {
  const controls = [...Array.from({ length: 0x20 }, (_, i) => String.fromCharCode(i)), "\u007f"];
  for (const c of controls) {
    assertBothReject(validProfile({ id: `a${c}b` }), /id must not contain control characters/);
    assertBothReject(validProfile({ displayName: `a${c}b` }), /displayName must not contain control characters/);
    assertBothReject(validProfile({ knownProjectConstraints: ["ok", `a${c}b`] }), /knownProjectConstraints\[1\] must not contain control characters/);
  }
});

test("D1-C1 strings: characters outside C0+DEL (e.g. U+0080, bidi controls) are NOT additionally rejected by D1-C1", () => {
  // Architecture INFO-1: wider Unicode/bidi/surrogate policy is preserved for
  // separate Security disposition - D1-C1 deliberately does not broaden C0+DEL.
  assertBothAccept(validProfile({ displayName: "a\u0080b‮C" }));
});

// --- §19.6 validate/assert parity and bounded diagnostics ------------------------------

test("D1-C1 parity: validate/assert/inspect agree on a mixed accepted/rejected fixture set", () => {
  const accepted = [validProfile(), Object.assign(Object.create(null), validProfile()), Object.freeze(validProfile())];
  const rejected = [{}, validProfile({ extra: 1 }), validProfile({ id: "x".repeat(129) }), new Proxy(validProfile(), {}), validProfile({ knownProjectConstraints: [] })];
  for (const input of accepted) assertBothAccept(input);
  for (const input of rejected) assertBothReject(input);
});

test("D1-C1 parity: validateProjectProfile exposes only {valid, errors}", () => {
  assert.deepEqual(Object.keys(validateProjectProfile(validProfile())).sort(), ["errors", "valid"]);
  assert.deepEqual(Object.keys(validateProjectProfile({})).sort(), ["errors", "valid"]);
});

test("D1-C1 parity: assert performs no second raw caller read - its result is fixed at inspection time", () => {
  const input = validProfile();
  const snapshot = assertValidProjectProfile(input, "test caller");
  input.id = "MUTATED";
  input.knownProjectConstraints.push("MUTATED");
  assert.equal(snapshot.id, "synthetic-project");
  assert.deepEqual([...snapshot.knownProjectConstraints], ["First synthetic constraint.", "Second synthetic constraint."]);
});

test("D1-C1 diagnostics: at most 8 unknown keys are represented, each displayed key at most 80 UTF-16 units", () => {
  const input = validProfile();
  for (let i = 0; i < 50; i += 1) input[`unknown_${String(i).padStart(2, "0")}_${"k".repeat(200)}`] = i;
  const { errors } = inspectProjectProfile(input);
  const detail = errors.join("; ");
  assert.equal((detail.match(/unknown_\d\d_/g) || []).length, 8);
  for (const rendered of detail.match(/"[^"]*"/g) || []) assert.ok(rendered.length <= 80, `rendered key too long: ${rendered.length}`);
  assert.match(detail, /42 more/);
  assert.ok(!detail.includes("k".repeat(100)));
});

test("D1-C1 diagnostics: total validation detail is at most 1024 UTF-16 units", () => {
  const input = validProfile({ id: "\u0000", displayName: "\u0000", knownProjectConstraints: Array.from({ length: 32 }, () => "\u0001") });
  for (let i = 0; i < 20; i += 1) input[`${"Z".repeat(500)}${i}`] = i;
  input[Symbol("x".repeat(5000))] = 1;
  const { errors } = inspectProjectProfile(input);
  assert.ok(errors.join("; ").length <= 1024, `detail length ${errors.join("; ").length}`);
  assert.match(errors.join("; "), /more error\(s\) omitted/);
  assert.throws(() => assertValidProjectProfile(input, "test caller"), (e) => {
    const detail = e.message.slice(e.message.indexOf("(") + 1, e.message.lastIndexOf(")"));
    assert.ok(detail.length <= 1024, `assert detail length ${detail.length}`);
    return true;
  });
});

test("D1-C1 diagnostics: hostile key names are rendered safely (printable ASCII only, quotes escaped)", () => {
  const hostile = 'evil"\n\u0000‮\u001b[31m' + "\ud800";
  const detail = inspectProjectProfile(validProfile({ [hostile]: 1 })).errors.join("; ");
  assert.ok(!/[\u0000-\u001f\u007f-￿]/.test(detail), `detail must be printable ASCII only: ${JSON.stringify(detail)}`);
  assert.ok(!detail.includes('evil"'), "an embedded quote must be escaped");
});

test("D1-C1 diagnostics: no caller values, serialized input, symbol descriptions, or stack traces appear", () => {
  const input = validProfile({ id: "SECRET_ID_VALUE\u0000", displayName: "SECRET_DISPLAY".repeat(30), knownProjectConstraints: ["SECRET_CONSTRAINT\u007f"], extra: "SECRET_EXTRA_VALUE" });
  input[Symbol("SECRET_SYMBOL_DESCRIPTION")] = 1;
  const detail = inspectProjectProfile(input).errors.join("; ");
  for (const secret of ["SECRET_ID_VALUE", "SECRET_DISPLAY", "SECRET_CONSTRAINT", "SECRET_EXTRA_VALUE", "SECRET_SYMBOL_DESCRIPTION", "[object Object]", "    at "]) {
    assert.ok(!detail.includes(secret), `diagnostic leaked ${secret}: ${detail}`);
  }
});

// --- §19.7 TOCTOU / detachment ----------------------------------------------------

test("D1-C1 TOCTOU: source top-level and Array mutation after success has no effect on the snapshot", () => {
  const input = validProfile();
  const { snapshot } = inspectProjectProfile(input);
  input.id = "changed";
  input.displayName = "changed";
  input.knownProjectConstraints[0] = "changed";
  input.knownProjectConstraints.push("added");
  input.knownProjectConstraints = ["replaced"];
  assert.deepEqual(snapshot, validProfile());
});

test("D1-C1 TOCTOU: attempted snapshot mutation has no effect on trusted state", () => {
  const snapshot = assertValidProjectProfile(validProfile(), "test caller");
  assert.throws(() => { snapshot.id = "x"; }, TypeError);
  assert.throws(() => { snapshot.knownProjectConstraints.push("x"); }, TypeError);
  assert.throws(() => { snapshot.knownProjectConstraints[0] = "x"; }, TypeError);
  assert.throws(() => { snapshot.extra = 1; }, TypeError);
  assert.deepEqual(snapshot, validProfile());
});

test("D1-C1 TOCTOU: re-inspecting an issued snapshot is accepted and yields an equal, distinct snapshot", () => {
  const first = assertValidProjectProfile(validProfile(), "test caller");
  const second = assertValidProjectProfile(first, "test caller");
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
});

test("D1-C1 assert: PROJECT_PROFILE_REQUIRED/INVALID prefixes and static callerLabel provenance are preserved", () => {
  assert.throws(() => assertValidProjectProfile(undefined, "x.main()"), (e) => e.message === "PROJECT_PROFILE_REQUIRED: x.main() requires an explicit ProjectProfile; none was supplied.");
  assert.throws(() => assertValidProjectProfile({}, "x.main()"), (e) => /^PROJECT_PROFILE_INVALID: x\.main\(\) received an invalid ProjectProfile \(.+\)\.$/.test(e.message));
});
