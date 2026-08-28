"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { isPlainRecord, snapshotOwnData, deepFreeze, canonicalStringify, computeDigest, isValidDigest, DIGEST_PATTERN } = require("./generated-change-set-review-canonical");

// snapshotOwnData() produces Object.create(null)-based records - deep-equal
// against an ordinary object literal fails on prototype alone under
// assert.deepEqual's strict-mode semantics, even when every own property
// matches. normalize() rebuilds an ordinary-prototype tree for comparison
// purposes only, mirroring test-design-review-canonical.test.js's own
// identical helper.
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

test("isPlainRecord accepts {} and Object.create(null), rejects arrays/null/class instances/Date/Map", () => {
  assert.equal(isPlainRecord({}), true);
  assert.equal(isPlainRecord(Object.create(null)), true);
  assert.equal(isPlainRecord([]), false);
  assert.equal(isPlainRecord(null), false);
  assert.equal(isPlainRecord(new Date()), false);
  assert.equal(isPlainRecord(new Map()), false);
  class Foo {}
  assert.equal(isPlainRecord(new Foo()), false);
});

test("snapshotOwnData deep-copies a plain object/array tree", () => {
  const input = { a: 1, b: [1, 2, { c: "x" }] };
  const result = snapshotOwnData(input);
  assert.deepEqual(normalize(result), input);
});

test("snapshotOwnData never returns a live reference to nested caller objects", () => {
  const nested = { x: 1 };
  const input = { nested };
  const result = snapshotOwnData(input);
  nested.x = 999;
  assert.equal(result.nested.x, 1);
});

test("snapshotOwnData preserves primitives (including undefined/function/symbol values) unchanged", () => {
  const fn = function () {};
  const sym = Symbol("s");
  const result = snapshotOwnData({ a: undefined, b: fn, c: sym, d: 5, e: "x", f: true, g: null });
  assert.equal(result.a, undefined);
  assert.equal(result.b, fn);
  assert.equal(result.c, sym);
  assert.equal(result.d, 5);
});

test("snapshotOwnData treats an own '__proto__' key as an ordinary data field, never as prototype mutation", () => {
  const hostile = JSON.parse('{"__proto__": {"polluted": true}, "a": 1}');
  const result = snapshotOwnData(hostile);
  assert.equal(result.a, 1);
  assert.equal(Object.getPrototypeOf(result), null);
  assert.ok(Object.prototype.hasOwnProperty.call(result, "__proto__"));
  assert.deepEqual(normalize(result.__proto__), { polluted: true });
  assert.equal(({}).polluted, undefined, "global Object.prototype must never be polluted");
});

test("snapshotOwnData never invokes a caller-overridden array method, and safely rejects the array (extra own key beyond dense shape)", () => {
  const arr = [1, 2, 3];
  let invoked = false;
  Object.defineProperty(arr, "map", { value: () => { invoked = true; return []; }, enumerable: true, configurable: true });
  const result = snapshotOwnData({ items: arr });
  assert.equal(invoked, false);
  assert.equal(result.items, null);
});

test("snapshotOwnData rejects an array carrying an own Symbol-keyed property", () => {
  const arr = [1, 2];
  arr[Symbol("s")] = "hidden";
  assert.equal(snapshotOwnData(arr), null);
});

test("snapshotOwnData rejects a record carrying an own Symbol-keyed property", () => {
  const obj = { a: 1 };
  obj[Symbol("s")] = "hidden";
  assert.equal(snapshotOwnData(obj), null);
});

test("snapshotOwnData rejects a sparse array (hole makes own-key count mismatch length)", () => {
  const sparse = [1];
  sparse[3] = 2;
  assert.equal(snapshotOwnData(sparse), null);
});

test("snapshotOwnData rejects an array with an extra own non-index key", () => {
  const arr = [1, 2];
  arr.extra = "x";
  assert.equal(snapshotOwnData(arr), null);
});

test("snapshotOwnData rejects a class instance / Date / Map masquerading as a record", () => {
  class Foo { constructor() { this.a = 1; } }
  assert.equal(snapshotOwnData(new Foo()), null);
  assert.equal(snapshotOwnData(new Date()), null);
  assert.equal(snapshotOwnData(new Map()), null);
});

test("snapshotOwnData reads a getter exactly once, never re-invoking it (single-read / no TOCTOU)", () => {
  let reads = 0;
  const obj = {};
  Object.defineProperty(obj, "x", { enumerable: true, get() { reads += 1; return reads === 1 ? "first" : "second"; } });
  const result = snapshotOwnData(obj);
  assert.equal(reads, 1);
  assert.equal(result.x, "first");
});

test("snapshotOwnData reports null (not a thrown exception) when a getter throws during the single read", () => {
  const obj = {};
  Object.defineProperty(obj, "x", { enumerable: true, get() { throw new Error("SECRET_CANONICAL_MARKER"); } });
  assert.equal(snapshotOwnData(obj), null);
});

test("snapshotOwnData preserves a caller-supplied toJSON as an inert own function-valued property, never invoking it", () => {
  let called = false;
  const obj = { a: 1, toJSON: () => { called = true; return { a: "forged" }; } };
  const result = snapshotOwnData(obj);
  assert.equal(called, false);
  assert.equal(typeof result.toJSON, "function");
  assert.equal(result.a, 1);
});

test("snapshotOwnData rejects a direct object self-cycle without stack exhaustion", () => {
  const a = {};
  a.self = a;
  assert.equal(snapshotOwnData(a), null);
});

test("snapshotOwnData rejects a direct array self-cycle", () => {
  const arr = [];
  arr.push(arr);
  assert.equal(snapshotOwnData(arr), null);
});

test("snapshotOwnData rejects a nested/indirect cycle (a -> b -> a)", () => {
  const a = {};
  const b = { a };
  a.b = b;
  assert.equal(snapshotOwnData(a), null);
});

test("snapshotOwnData accepts a DAG (same object referenced twice, not cyclically)", () => {
  const shared = { v: 1 };
  const input = { left: shared, right: shared };
  const result = snapshotOwnData(input);
  assert.deepEqual(normalize(result), { left: { v: 1 }, right: { v: 1 } });
  assert.notEqual(result.left, result.right);
});

test("deepFreeze freezes every nested object/array in the tree", () => {
  const value = deepFreeze({ a: [1, { b: 2 }] });
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.a));
  assert.ok(Object.isFrozen(value.a[1]));
});

test("canonicalStringify is independent of caller object-literal key order", () => {
  assert.equal(canonicalStringify({ z: 1, a: 2 }), canonicalStringify({ a: 2, z: 1 }));
});

test("canonicalStringify preserves array element order", () => {
  assert.notEqual(canonicalStringify([1, 2, 3]), canonicalStringify([3, 2, 1]));
});

test("canonicalStringify handles null/booleans/strings/nested structures", () => {
  assert.equal(canonicalStringify(null), "null");
  assert.equal(canonicalStringify(true), "true");
  assert.equal(canonicalStringify(false), "false");
  assert.equal(canonicalStringify("x"), '"x"');
  assert.equal(canonicalStringify({ a: [1, "b", null] }), '{"a":[1,"b",null]}');
});

test("canonicalStringify throws on undefined/function/symbol/bigint/NaN/Infinity", () => {
  assert.throws(() => canonicalStringify(undefined));
  assert.throws(() => canonicalStringify(function () {}));
  assert.throws(() => canonicalStringify(Symbol("s")));
  assert.throws(() => canonicalStringify(10n));
  assert.throws(() => canonicalStringify(NaN));
  assert.throws(() => canonicalStringify(Infinity));
});

test("canonicalStringify throws on a non-plain-record object (Date/Map/class instance)", () => {
  assert.throws(() => canonicalStringify(new Date()));
  assert.throws(() => canonicalStringify(new Map()));
});

test("canonicalStringify never invokes toJSON/valueOf/Symbol.toPrimitive on a snapshotted value (throws closed instead, since a function value is itself unsupported digest input)", () => {
  let called = false;
  const value = { a: 1 };
  Object.defineProperty(value, "toJSON", { value: () => { called = true; return {}; }, enumerable: true });
  assert.throws(() => canonicalStringify(value));
  assert.equal(called, false);
});

test("computeDigest returns the documented sha256:<64 lowercase hex> format", () => {
  const digest = computeDigest("test-label:v1", { a: 1 });
  assert.match(digest, DIGEST_PATTERN);
});

test("computeDigest is deterministic and round-trips for the same label+value", () => {
  assert.equal(computeDigest("label", { a: 1 }), computeDigest("label", { a: 1 }));
});

test("computeDigest differs when the label differs, even for identical value content (domain separation)", () => {
  assert.notEqual(computeDigest("label-a", { a: 1 }), computeDigest("label-b", { a: 1 }));
});

test("computeDigest differs when any nested field's value changes", () => {
  assert.notEqual(computeDigest("label", { a: 1 }), computeDigest("label", { a: 2 }));
});

test("computeDigest throws (fails closed) rather than silently hashing unsupported content", () => {
  assert.throws(() => computeDigest("label", { a: undefined && (() => {}) || function () {} }));
});

test("isValidDigest rejects malformed/shortened/uppercase/non-string digest values", () => {
  assert.equal(isValidDigest("sha256:" + "a".repeat(64)), true);
  assert.equal(isValidDigest("sha256:" + "A".repeat(64)), false);
  assert.equal(isValidDigest("sha256:" + "a".repeat(63)), false);
  assert.equal(isValidDigest("not-a-digest"), false);
  assert.equal(isValidDigest(12345), false);
});
