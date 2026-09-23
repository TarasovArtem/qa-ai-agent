"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { isPlainRecord, snapshotOwnData, deepFreeze, canonicalStringify, computeDigest, isValidDigest, DIGEST_PATTERN } = require("./test-design-review-canonical");

// Snapshotted records use Object.create(null) (deliberately - see this
// module's own docstring), so a raw assert.deepEqual against a plain
// object literal fails on [[Prototype]] alone even when every actual key
// and value matches. `normalize` recursively rebuilds a snapshot using
// ordinary {}/Array structures purely for test comparison - it is never
// used by, and has no bearing on, the production snapshot/digest code.
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) out[key] = normalize(value[key]);
    return out;
  }
  return value;
}

// --- isPlainRecord -----------------------------------------------------------

test("isPlainRecord accepts {} and Object.create(null), rejects arrays/null/class instances/Date/Map", () => {
  assert.equal(isPlainRecord({}), true);
  assert.equal(isPlainRecord(Object.create(null)), true);
  assert.equal(isPlainRecord([]), false);
  assert.equal(isPlainRecord(null), false);
  assert.equal(isPlainRecord(new Date()), false);
  assert.equal(isPlainRecord(new Map()), false);
  assert.equal(isPlainRecord(class {}), false);
  assert.equal(isPlainRecord(new (class Foo {})()), false);
});

// --- snapshotOwnData: basic shape -------------------------------------------

test("snapshotOwnData deep-copies a plain object/array tree", () => {
  const src = { a: 1, b: "x", c: [1, 2, { d: true }], e: null };
  const snap = snapshotOwnData(src);
  assert.deepEqual(normalize(snap), src);
  assert.notEqual(snap, src);
  assert.notEqual(snap.c, src.c);
  assert.notEqual(snap.c[2], src.c[2]);
});

test("snapshotOwnData never returns a live reference to nested caller objects", () => {
  const inner = { x: 1 };
  const src = { inner };
  const snap = snapshotOwnData(src);
  inner.x = 999;
  assert.equal(snap.inner.x, 1);
});

test("snapshotOwnData preserves primitives (including undefined/function/symbol values) unchanged", () => {
  const fn = () => {};
  const sym = Symbol("s");
  const snap = snapshotOwnData({ a: undefined, b: fn, c: sym, d: 5n });
  assert.equal(snap.a, undefined);
  assert.equal(snap.b, fn);
  assert.equal(snap.c, sym);
  assert.equal(snap.d, 5n);
});

// --- snapshotOwnData: __proto__ / prototype safety --------------------------

test("snapshotOwnData treats an own '__proto__' key as an ordinary data field, never as prototype mutation", () => {
  const src = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}');
  const snap = snapshotOwnData(src);
  assert.equal(Object.getPrototypeOf(snap), null);
  assert.ok(Object.prototype.hasOwnProperty.call(snap, "__proto__"));
  assert.deepEqual(normalize(snap.__proto__), { polluted: true });
  assert.equal(({}).polluted, undefined, "global Object.prototype must never be polluted");
});

test("snapshotOwnData does not let __proto__ escape into the array snapshot's own prototype", () => {
  const arr = [1, 2];
  arr.__proto__ = { evil: true }; // eslint-disable-line no-proto -- deliberate attack simulation
  // this sets an actual prototype (Array's [[Set]] semantics), not an own key,
  // so it is invisible to Object.keys and the array shape check below applies.
  const snap = snapshotOwnData(arr);
  assert.deepEqual(snap, [1, 2]);
});

// --- snapshotOwnData: caller-controlled array method / accessor hijacking --

test("snapshotOwnData never invokes a caller-overridden array method (.map/.slice), and safely rejects the array since assigning them adds extra own keys beyond its dense shape", () => {
  let calls = 0;
  const arr = [1, 2, 3];
  arr.map = () => { calls += 1; return []; };
  arr.slice = () => { calls += 1; return []; };
  const snap = snapshotOwnData(arr);
  assert.equal(calls, 0);
  assert.equal(snap, null, "own 'map'/'slice' keys make Object.keys(arr).length (5) diverge from arr.length (3) - correctly rejected as malformed, never silently dropped");
});

test("snapshotOwnData never invokes a caller-overridden Symbol.iterator, and rejects the array outright (own Symbol-keyed properties are never accepted)", () => {
  let calls = 0;
  const arr = [1, 2, 3];
  arr[Symbol.iterator] = function* () { calls += 1; yield 1; };
  const snap = snapshotOwnData(arr);
  assert.equal(calls, 0);
  assert.equal(snap, null);
});

test("snapshotOwnData rejects an array carrying an own Symbol-keyed property", () => {
  const arr = [1, 2];
  arr[Symbol("extra")] = "x";
  const snap = snapshotOwnData(arr);
  assert.equal(snap, null);
});

test("snapshotOwnData rejects a record carrying an own Symbol-keyed property", () => {
  const obj = { a: 1 };
  obj[Symbol("extra")] = "x";
  const snap = snapshotOwnData(obj);
  assert.equal(snap, null);
});

test("snapshotOwnData rejects a sparse array (hole makes own-key count mismatch length)", () => {
  const arr = [1, , 3]; // eslint-disable-line no-sparse-arrays
  const snap = snapshotOwnData(arr);
  assert.equal(snap, null);
});

test("snapshotOwnData rejects an array with an extra own non-index key", () => {
  const arr = [1, 2];
  arr.extra = "x";
  const snap = snapshotOwnData(arr);
  assert.equal(snap, null);
});

test("snapshotOwnData rejects deceptive numeric-like keys ('01', '-1', '1.0', '1e0', '4294967295') as a malformed array shape", () => {
  const arr = [1, 2];
  Object.defineProperty(arr, "01", { value: "x", enumerable: true, configurable: true });
  const snap = snapshotOwnData(arr);
  assert.equal(snap, null);
});

test("snapshotOwnData rejects a class instance / Date / Map masquerading as a record", () => {
  assert.equal(snapshotOwnData(new Date()), null);
  assert.equal(snapshotOwnData(new Map([["a", 1]])), null);
  assert.equal(snapshotOwnData(new (class Foo { constructor() { this.a = 1; } })()), null);
});

test("snapshotOwnData reads a getter exactly once, never re-invoking it (single-read / no TOCTOU)", () => {
  let reads = 0;
  const src = {
    get x() {
      reads += 1;
      return reads;
    },
  };
  const snap = snapshotOwnData(src);
  assert.equal(reads, 1);
  assert.equal(snap.x, 1);
  // reading the snapshot itself never re-invokes the original getter
  assert.equal(snap.x, 1);
  assert.equal(reads, 1);
});

test("snapshotOwnData reports null (not a thrown exception) when a getter throws during the single read", () => {
  const src = {
    get x() {
      throw new Error("boom");
    },
  };
  assert.doesNotThrow(() => snapshotOwnData(src));
  assert.equal(snapshotOwnData(src), null);
});

test("snapshotOwnData preserves a caller-supplied toJSON as an inert own function-valued property, never invoking it", () => {
  let toJsonCalls = 0;
  const src = {
    a: 1,
    toJSON() {
      toJsonCalls += 1;
      return { a: 999 };
    },
  };
  const snap = snapshotOwnData(src);
  assert.equal(toJsonCalls, 0);
  assert.ok(Object.prototype.hasOwnProperty.call(snap, "toJSON"));
  assert.equal(snap.toJSON, src.toJSON);
  assert.equal(snap.a, 1);
});

// --- snapshotOwnData: cycle detection (explicit, bounded) -------------------

test("snapshotOwnData rejects a direct object self-cycle without stack exhaustion", () => {
  const src = { a: 1 };
  src.self = src;
  assert.equal(snapshotOwnData(src), null);
});

test("snapshotOwnData rejects a direct array self-cycle", () => {
  const arr = [1, 2];
  arr.push(arr);
  assert.equal(snapshotOwnData(arr), null);
});

test("snapshotOwnData rejects a nested/indirect cycle (a -> b -> a)", () => {
  const a = { name: "a" };
  const b = { name: "b", ref: a };
  a.ref = b;
  assert.equal(snapshotOwnData(a), null);
});

test("snapshotOwnData accepts a DAG (same object referenced twice, not cyclically) since each branch is snapshotted independently", () => {
  const shared = { v: 1 };
  const src = { left: shared, right: shared };
  const snap = snapshotOwnData(src);
  assert.deepEqual(normalize(snap), { left: { v: 1 }, right: { v: 1 } });
  assert.notEqual(snap.left, snap.right);
});

// --- deepFreeze --------------------------------------------------------------

test("deepFreeze freezes every nested object/array in the tree", () => {
  const tree = deepFreeze({ a: [1, { b: 2 }] });
  assert.ok(Object.isFrozen(tree));
  assert.ok(Object.isFrozen(tree.a));
  assert.ok(Object.isFrozen(tree.a[1]));
});

// --- canonicalStringify: determinism / order-independence -------------------

test("canonicalStringify is independent of caller object-literal key order", () => {
  const a = canonicalStringify({ x: 1, y: 2, z: 3 });
  const b = canonicalStringify({ z: 3, x: 1, y: 2 });
  assert.equal(a, b);
});

test("canonicalStringify preserves array element order (arrays are not sorted)", () => {
  assert.notEqual(canonicalStringify([1, 2, 3]), canonicalStringify([3, 2, 1]));
});

test("canonicalStringify handles null/booleans/strings/nested structures", () => {
  assert.equal(canonicalStringify(null), "null");
  assert.equal(canonicalStringify(true), "true");
  assert.equal(canonicalStringify(false), "false");
  assert.equal(canonicalStringify("a\"b"), JSON.stringify("a\"b"));
  assert.equal(canonicalStringify({ a: [1, { b: null }] }), '{"a":[1,{"b":null}]}');
});

// --- canonicalStringify: fail-closed on unsupported types -------------------

test("canonicalStringify throws on undefined/function/symbol/bigint/NaN/Infinity", () => {
  assert.throws(() => canonicalStringify(undefined));
  assert.throws(() => canonicalStringify(() => {}));
  assert.throws(() => canonicalStringify(Symbol("s")));
  assert.throws(() => canonicalStringify(5n));
  assert.throws(() => canonicalStringify(NaN));
  assert.throws(() => canonicalStringify(Infinity));
  assert.throws(() => canonicalStringify(-Infinity));
});

test("canonicalStringify throws on a non-plain-record object (Date/Map/class instance)", () => {
  assert.throws(() => canonicalStringify(new Date()));
  assert.throws(() => canonicalStringify(new Map()));
});

test("canonicalStringify never invokes toJSON/valueOf/Symbol.toPrimitive on a snapshotted value", () => {
  let calls = 0;
  const withHooks = {
    a: 1,
    toJSON() { calls += 1; return {}; },
  };
  // deliberately calling canonicalStringify directly (not via computeDigest)
  // on a plain-record value that itself carries a function-valued toJSON key
  // - the function value itself is unsupported and must cause a throw, never
  // an invocation of that function.
  assert.throws(() => canonicalStringify(withHooks), /unsupported value type/);
  assert.equal(calls, 0);
});

// --- computeDigest / isValidDigest -------------------------------------------

test("computeDigest returns the documented sha256:<64 lowercase hex> format", () => {
  const digest = computeDigest("test-label:v1", { a: 1 });
  assert.match(digest, DIGEST_PATTERN);
  assert.equal(isValidDigest(digest), true);
});

test("computeDigest is deterministic and round-trips for the same label+value", () => {
  const value = { a: 1, b: [1, 2, 3], c: { d: null } };
  assert.equal(computeDigest("label", value), computeDigest("label", value));
});

test("computeDigest differs when the label differs, even for identical value content (domain separation)", () => {
  const value = { a: 1 };
  assert.notEqual(computeDigest("kind-a:v1", value), computeDigest("kind-b:v1", value));
});

test("computeDigest differs when any nested field's value changes", () => {
  const base = computeDigest("label", { a: 1, b: { c: [1, 2] } });
  const changed = computeDigest("label", { a: 1, b: { c: [1, 3] } });
  assert.notEqual(base, changed);
});

test("computeDigest throws (fails closed) rather than silently hashing unsupported content", () => {
  assert.throws(() => computeDigest("label", { a: undefined }));
});

test("isValidDigest rejects malformed/shortened/uppercase/non-string digest values", () => {
  assert.equal(isValidDigest("sha256:" + "a".repeat(63)), false);
  assert.equal(isValidDigest("sha256:" + "A".repeat(64)), false);
  assert.equal(isValidDigest("md5:" + "a".repeat(32)), false);
  assert.equal(isValidDigest(null), false);
  assert.equal(isValidDigest(undefined), false);
  assert.equal(isValidDigest(123), false);
});
