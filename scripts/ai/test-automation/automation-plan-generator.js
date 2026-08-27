/**
 * Provider-backed AutomationPlan generation (Roadmap #23C).
 *
 * Consumes one already-validated-shape AutomationCandidate v1 and one
 * AutomationRepositoryContext (scripts/ai/test-automation/
 * automation-repository-context.js) and produces one AutomationPlan v1
 * through a dependency-injected provider. This module generates a PLAN
 * ONLY - it never produces test source code, a patch, a diff, file
 * content, or a GeneratedChangeSet, never mutates the repository, and
 * never runs a browser. AutomationPlan v1 (scripts/ai/generation/
 * automation-plan.js) remains frozen and unmodified.
 *
 * INPUT SNAPSHOT (Roadmap #23C-C1): both `automationCandidate` and
 * `repositoryContext` are read exactly once, at the very start, via
 * snapshotOwnData() below into fresh, #23-owned plain data. Every later
 * step - validation, project/framework binding, positive projection,
 * prompting - operates only on that snapshot, never on the caller's
 * original objects again.
 *
 * The original #23C implementation built this snapshot via
 * `JSON.parse(JSON.stringify(value))`. Roadmap #23C-R found that this gave
 * a caller-supplied `toJSON()` full authority to substitute the entire
 * semantic content validation and generation act upon (a candidate whose
 * actual own `decision` property is "BLOCKED" but whose `toJSON()` returns
 * "AUTOMATE" was validated and acted upon as AUTOMATE), and that the same
 * round-trip silently dropped unknown own keys whose value happened to be
 * `undefined`/a function/a symbol before strict unknown-field validation
 * ever saw them. snapshotOwnData() instead walks the caller's own
 * enumerable string-keyed properties directly - it never invokes a
 * caller-supplied `toJSON` (a `toJSON` own property is captured as an
 * ordinary, unrecognized own key, then rejected by strict allowlist
 * validation like any other), never coerces NaN/Infinity/Date through a
 * serialization step, and never drops a key merely because its value
 * isn't JSON-representable. A non-plain-record object (Date/Map/Set/class
 * instance) is treated as `null` wherever a record is expected, matching
 * automation-repository-context.js's own `isPlainRecord()` convention.
 *
 * Roadmap #23C-C1-R independently found that the #23C-C1 replacement
 * snapshot still had two further CRITICAL authorization-bypass vectors,
 * both now closed in #23C-C2: (1) copying a source key via plain
 * `out[key] = value` let a caller-supplied own `"__proto__"` key change
 * the snapshot's actual prototype instead of becoming a visible own
 * field (defineOwnSnapshotProperty() below now uses
 * Object.defineProperty, which always creates an own data property); and
 * (2) copying an array via `value.map(...)` invoked a caller-overridden
 * own `.map` property instead of the true built-in (snapshotArray()
 * below now uses only `.length` and manual bracket-index reads, with a
 * fail-closed dense-array + no-symbol-keys policy, never any
 * source-resolved method or iteration protocol).
 *
 * CONTEXT BOUND PARITY (Roadmap #23C-C1): the original implementation's
 * local AutomationRepositoryContext-shape validator used generous,
 * separately-maintained bounds (25 evidence items, 60 arbitrary script
 * names, no per-item/aggregate evidence content bound at all) that
 * Roadmap #23C-R found were materially wider than automation-
 * repository-context.js's real producible output (~21 evidence items, a
 * small per-framework script-name allowlist, 8000/40000-char content
 * bounds) - a forged 25-item/5MB-each context was shown to produce a
 * 131,077,801-character provider prompt with zero local rejection. Every
 * bound below is now either imported directly from that module's own
 * exported LIMITS/isPlanningRelevantScriptName (so the two modules can
 * never silently drift apart) or reuses scripts/ai/generation/
 * primitives.js's frozen validateEvidenceRef, rather than a separately
 * duplicated constant.
 *
 * PROVIDER PROJECTION: the provider never receives repositoryContext (or
 * automationCandidate) serialized wholesale. buildPositiveProjection()
 * below is the single place that decides what crosses into the prompt -
 * see its own comment. In particular, package.json script COMMAND bodies
 * are never sent (only script NAMES) - AutomationRepositoryContext
 * guarantees only targeted path/script-name minimization
 * (scripts/ai/test-automation/automation-repository-context.js), not that
 * a selected script's command text is free of secret-shaped values.
 *
 * VALIDATION: every parsed provider response is validated by the frozen
 * v1 validateAutomationPlan() (scripts/ai/generation/automation-plan.js),
 * unmodified, plus a small set of #23-local candidate/framework/path
 * binding checks that mirror (without reusing - see the comment on
 * validatePlanBinding() below) scripts/ai/generation/
 * cross-model-validation.js's own decision-authorization and
 * framework-compatibility rules, which do not apply directly here because
 * this module never has a full RequirementModel/TestCaseModel chain to
 * pass through that validator. Nothing is ever repaired, filled in, or
 * silently stripped from a provider response - every failure is reported
 * or the whole attempt is rejected.
 */

"use strict";

const { ERROR_CODES, err } = require("../generation/errors");
const { isPlainObject, isValidId, isBoundedText, collectUnknownKeyErrors, collectDuplicateIdErrors, validateProjectId, validateEvidenceRef } = require("../generation/primitives");
const { validateAutomationCandidate } = require("../generation/automation-candidate");
const { validateAutomationPlan } = require("../generation/automation-plan");
const { normalizeProviderError } = require("../providers/provider-error");
const { buildAutomationPlanSystemPrompt, buildAutomationPlanUserPrompt, buildAutomationPlanCorrectionPrompt } = require("./automation-plan-prompt");
// Roadmap #23C-C1: exact-parity reuse of #23B's own real output contract -
// never a separately-maintained "generous headroom" duplicate. Both
// LIMITS and isPlanningRelevantScriptName are that module's own public
// exports (read-only reuse; this file never modifies
// automation-repository-context.js).
const { LIMITS: REPO_CONTEXT_LIMITS, isPlanningRelevantScriptName, EVIDENCE_KIND_REPOSITORY } = require("./automation-repository-context");

// #23-owned bounds - deliberately local to this module, never added to
// scripts/ai/generation/limits.js (that file bounds the frozen v1
// contracts, not this provider-orchestration stage).
const LIMITS = Object.freeze({
  // AutomationPlan v1's own frozen limits (MAX_PLANNED_CHANGES: 100,
  // SHORT_TEXT_MAX_LENGTH: 300 per path, LONG_TEXT_MAX_LENGTH: 4000 per
  // purpose, MAX_VALIDATION_STEPS: 50, LONG_TEXT_MAX_LENGTH: 4000 per
  // validation-step description) bound a maximally-large VALID plan's raw
  // JSON text at roughly 640,000 characters
  // (100 * (300 + 4000 + ~40 overhead) + 50 * (4000 + ~30 overhead)). This
  // is a pre-parse bound on the raw provider response text, checked BEFORE
  // any JSON.parse is attempted - set with headroom above that
  // schema-derived worst case (never JSON syntax/whitespace variance,
  // never a streaming/network byte protection) so no structurally-valid
  // frozen-schema plan can ever be falsely rejected by this bound alone.
  MAX_AUTOMATION_PLAN_RESPONSE_CHARS: 1000000,
  // Correction-prompt diagnostic bounds (Roadmap #23C, closing the same
  // "retry amplification" class an earlier #22 design draft was found to
  // have): a second attempt's prompt only ever receives a small, sanitized
  // {path,code,message} array - never the raw invalid response, and never
  // an unbounded validator error list.
  MAX_CORRECTION_ERRORS: 20,
  MAX_CORRECTION_DIAGNOSTIC_CHARS: 8192,
  // Roadmap #23C-C1: derived directly from automation-repository-context.
  // js's own LIMITS.MAX_RELEVANT_FILES rather than a separately-maintained
  // constant - +1 accounts for the single, always-present framework-config
  // evidence entry that module's own buildAutomationRepositoryContext()
  // unconditionally prepends (see its evidenceTargets construction; never
  // more than one, never zero for a successfully-built context).
  MAX_REPOSITORY_EVIDENCE_ITEMS: REPO_CONTEXT_LIMITS.MAX_RELEVANT_FILES + 1,
  MAX_EVIDENCE_CONTENT_LENGTH: REPO_CONTEXT_LIMITS.MAX_FILE_CONTENT_LENGTH,
  MAX_AGGREGATE_EVIDENCE_LENGTH: REPO_CONTEXT_LIMITS.MAX_AGGREGATE_EVIDENCE_LENGTH,
  // Roadmap #23C-C1: package script name/command SHAPE bounds, reused from
  // #23B's own contract (Phase 16: a RepositoryContext may legitimately
  // carry a command body since #23B itself preserves one - #23C's own
  // trust boundary is that it is never provider-visible, enforced by
  // buildPositiveProjection() below, not by refusing to validate its
  // shape).
  MAX_SCRIPT_NAME_LENGTH: REPO_CONTEXT_LIMITS.MAX_SCRIPT_NAME_LENGTH,
  MAX_SCRIPT_COMMAND_LENGTH: REPO_CONTEXT_LIMITS.MAX_SCRIPT_COMMAND_LENGTH,
  // Roadmap #23C-C1: a final, #23C-owned defensive outbound-prompt
  // character cap. Every other projected field is already individually
  // bounded by the checks above, except context.guidance.
  // knownProjectConstraints, which has no upper bound anywhere upstream -
  // not even in scripts/ai/project-profile.js's own ProjectProfile
  // validator this ultimately traces back to (isNonEmptyStringArray()
  // there bounds neither array length nor per-entry length). This is a
  // last-resort net for that one remaining unbounded field (and any other
  // future unbounded field), generous enough that no legitimate
  // #23B-produced context could ever approach it, checked on every
  // attempt's ACTUAL outbound prompt (including the correction prompt,
  // which adds a bounded diagnostics block on top of the same projection)
  // before any provider call for that attempt.
  MAX_OUTBOUND_PROMPT_CHARS: 100000,
});

const SUPPORTED_FRAMEWORKS = Object.freeze(["cypress", "playwright"]);
// Mirrors scripts/ai/test-automation/automation-repository-context.js's
// own FRAMEWORK_SOURCE_PREFIX convention, independently re-declared here
// (not imported - that module's constant is private) for the same reason
// automation-repository-context.js itself re-declares SUPPORTED_FRAMEWORKS
// rather than cross-importing scripts/ai/generation/primitives.js's:
// a two-entry literal is not worth a cross-module dependency. AutomationPlan
// v1 itself defines no framework-path scoping rule at all (verified by
// direct read of validatePlannedChange() - it checks only path safety/
// canonicality, never framework membership) - this #23-local addition is
// what actually prevents a provider from proposing a playwright/** path
// while generating a cypress plan (or the reverse), which the frozen v1
// validator alone would silently accept.
const FRAMEWORK_PATH_PREFIX = Object.freeze({ cypress: "cypress/", playwright: "playwright/" });

const CONTEXT_TOP_LEVEL_ALLOWED_KEYS = Object.freeze(["projectId", "framework", "guidance", "packageScripts", "repositoryEvidence"]);
const GUIDANCE_ALLOWED_KEYS = Object.freeze(["displayName", "knownProjectConstraints"]);
const PACKAGE_SCRIPT_ALLOWED_KEYS = Object.freeze(["name", "command"]);
const EVIDENCE_ITEM_ALLOWED_KEYS = Object.freeze(["evidenceRef", "role", "content"]);
const EVIDENCE_ROLES = Object.freeze(["framework_config", "relevant_file"]);

// Roadmap #23C-C1: the #23-local "plain record" boundary - identical in
// principle to automation-repository-context.js's own isPlainRecord() (not
// imported - that module's is private): only a genuine object literal
// ({...}) or an Object.create(null) record is accepted; a Date, Map, Set,
// or class instance (any object whose prototype isn't Object.prototype or
// null) is rejected wherever a record is expected, regardless of what
// own fields it happens to carry.
function isPlainRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

// Roadmap #23C-C2: defines `key` on `out` as an ordinary OWN DATA property
// via [[DefineOwnProperty]] semantics - never a plain `out[key] = value`
// assignment (which uses [[Set]] semantics instead). This distinction is
// the entire fix for the #23C-C1-R CRITICAL "__proto__" finding: for a
// plain `{}` destination, `out["__proto__"] = value` does not create an
// own "__proto__" property at all - because `out` itself has no own
// "__proto__" property yet, the assignment walks up to the inherited
// `Object.prototype.__proto__` ACCESSOR and invokes its setter, which
// changes `out`'s actual [[Prototype]] instead (exactly the mechanism
// `JSON.parse('{"__proto__":1}')` avoids internally, since JSON.parse's
// own object-building algorithm already uses CreateDataProperty -
// [[DefineOwnProperty]] - for this exact reason). `Object.defineProperty`
// unconditionally creates/redefines an own property, so a `"__proto__"`
// (or `"constructor"`/`"prototype"`, which behave normally under a plain
// assignment too but are copied the same way here for uniformity) source
// key becomes an ordinary, visible, strictly-rejectable own field on the
// snapshot - never a prototype mutation.
function defineOwnSnapshotProperty(out, key, value) {
  Object.defineProperty(out, key, { value, enumerable: true, writable: true, configurable: true });
}

// Roadmap #23C-C2: a caller-independent array snapshot. The original
// implementation copied arrays via `value.map(...)`, which resolves and
// invokes whatever `.map` property actually exists on `value` at call
// time - Roadmap #23C-C1-R found that an array whose own `.map` property
// is overridden by the caller (an ordinary, easily-constructed own-
// property override, no Proxy needed) could return entirely fabricated
// contents (e.g. `targetFrameworks`'s real indexed data `["cypress"]"`,
// but an overridden `.map` returning `["cypress","playwright"]`),
// completely bypassing framework authorization. This never resolves or
// invokes ANY property/method on `source` other than `.length` (a
// non-configurable-as-accessor, spec-exotic property on a genuine Array -
// safe to read directly) and manual bracket-index reads (`source[key]`,
// each read exactly once) - no `.map`/`.slice`/`.filter`/`.reduce`/
// `.flat`/`.flatMap`/`.concat`, no `Symbol.iterator` (no `for...of`, no
// spread, no `Array.from`), so an Array subclass overriding any of those
// methods/traps has nothing to hook.
//
// Fail-closed dense-array + plain-data policy (never silently normalized):
// - any own Symbol-keyed property on `source` rejects the whole array
//   (a legitimate AutomationCandidate/AutomationRepositoryContext array
//   is plain JSON-like data and never legitimately carries one);
// - the array must be dense: for a `.length` of N, `Object.keys(source)`
//   must be EXACTLY the N strings "0".."N-1" (Object.keys() always lists
//   an ordinary object's own integer-index keys in ascending numeric
//   order first, per the ECMAScript [[OwnPropertyKeys]] ordering, so a
//   length/key-count mismatch or any out-of-place key - a sparse hole, or
//   an extra own key like "map"/"slice"/"toJSON"/"metadata"/"__proto__" -
//   is caught before any element is ever read);
// - a sparse array, or any extra own enumerable key beyond the dense
//   index set, rejects the whole array rather than silently skipping or
//   coercing it.
// Returns `null` (the same "malformed input" sentinel `isPlainRecord`
// failures already use) on any of the above - the caller's existing
// `Array.isArray(...)` checks downstream then correctly reject it like
// any other malformed value.
function snapshotArray(source, ancestors) {
  if (Object.getOwnPropertySymbols(source).length > 0) return null;

  const length = source.length; // single read; a genuine Array's .length is a spec-exotic data property, never redefinable as an accessor
  if (typeof length !== "number" || !Number.isInteger(length) || length < 0) return null;

  const ownKeys = Object.keys(source); // own enumerable STRING keys only - never invokes anything
  if (ownKeys.length !== length) return null; // catches both sparse holes and any extra own key in one bound check
  for (let i = 0; i < length; i++) {
    if (ownKeys[i] !== String(i)) return null; // catches a hole/extra-key combination that happened to keep the total count equal
  }

  const out = new Array(length);
  for (let i = 0; i < length; i++) {
    const key = String(i);
    const captured = source[key]; // direct indexed read, exactly once - never a source-resolved method
    defineOwnSnapshotProperty(out, key, snapshotOwnDataRecursive(captured, ancestors));
  }
  return out;
}

// The recursive walk behind snapshotOwnData() below. `ancestors` tracks
// the current recursion chain (added on entry, removed on exit) so a
// genuine circular reference is replaced with `null` (never a live
// back-reference) while two independent, non-cyclic references to the
// same shared object (a DAG, not a cycle) are still each snapshotted
// correctly on their own - the same distinction JSON.stringify itself
// draws between "circular" (throws) and "shared, acyclic" (serializes
// fine, once per occurrence).
function snapshotOwnDataRecursive(value, ancestors) {
  if (value === null || typeof value !== "object") return value; // primitives (including bigint), functions, symbols, undefined pass through unchanged - never invoked, never coerced, never a source of a thrown exception here
  if (ancestors.has(value)) return null;
  if (Array.isArray(value)) {
    ancestors.add(value);
    const out = snapshotArray(value, ancestors);
    ancestors.delete(value);
    return out;
  }
  if (!isPlainRecord(value)) return null; // Date/Map/Set/class instance
  if (Object.getOwnPropertySymbols(value).length > 0) return null; // fail-closed plain-data policy - see snapshotArray()'s own comment
  ancestors.add(value);
  const out = {};
  // Object.keys(): own enumerable STRING-keyed properties only, exactly
  // matching every frozen v1 validator's own "own properties, never the
  // prototype chain" convention. A property named `toJSON` is just
  // another own key here - never invoked, never given any special
  // meaning - so it reaches strict allowlist validation downstream as an
  // ordinary, unrecognized field. A key whose VALUE is `undefined`, a
  // function, or a symbol still appears in this list (Object.keys() does
  // not filter by value type, unlike JSON.stringify's own serialization
  // pass) - the key is copied into `out` via a direct property read
  // (`value[key]`, at most once), so it remains visible to strict
  // unknown-field validation even though its value will never itself be
  // usable as semantic content. A key literally named "__proto__" (or
  // "constructor"/"prototype") is copied via defineOwnSnapshotProperty()
  // - see its own comment - never a plain `out[key] = ...` assignment, so
  // it always becomes an ordinary, visible own field, never a prototype
  // mutation.
  for (const key of Object.keys(value)) {
    defineOwnSnapshotProperty(out, key, snapshotOwnDataRecursive(value[key], ancestors));
  }
  ancestors.delete(value);
  return out;
}

// Roadmap #23C-C1: the owned-snapshot trust boundary (replaces the
// original JSON.stringify/JSON.parse round-trip - see this module's own
// docstring for why). Reads every own enumerable property in `value`'s
// object graph at most once, directly (never via a caller-supplied
// `toJSON`), into a fresh, #23-owned plain-data tree with no live
// reference back to the caller's original structure. Never throws: a
// hostile getter (or any other own-property access) that throws anywhere
// in the graph is caught here and the whole snapshot becomes `null` for
// this call - exactly like a non-plain-record top-level value, downstream
// `isPlainObject`/`isPlainRecord` checks then reject it as a bounded,
// structural error, never a raw exception.
function snapshotOwnData(value) {
  try {
    return snapshotOwnDataRecursive(value, new Set());
  } catch {
    return null;
  }
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }
  return value;
}

// Bounds and sanitizes a validator error list for inclusion in a
// correction prompt: at most MAX_CORRECTION_ERRORS entries, projected to
// only {path,code,message} (already the frozen error shape - this is a
// defensive re-projection, not a trust boundary crossing, since every
// upstream error already comes from a frozen/local validator that never
// echoes raw content). If even the truncated set's own serialized size
// exceeds MAX_CORRECTION_DIAGNOSTIC_CHARS (a pathological many-long-
// message case), falls back to a single small static summary instead -
// never a partially-truncated raw JSON string.
function boundCorrectionErrors(errors) {
  const bounded = errors.slice(0, LIMITS.MAX_CORRECTION_ERRORS).map((e) => ({ path: e.path, code: e.code, message: e.message }));
  if (JSON.stringify(bounded).length <= LIMITS.MAX_CORRECTION_DIAGNOSTIC_CHARS) return bounded;
  return [{ path: "$", code: ERROR_CODES.INVALID_VALUE, message: `validation failed with ${errors.length} error(s); diagnostics omitted for size` }];
}

// #23-owned validator for the AutomationRepositoryContext snapshot shape.
// This is NOT a frozen F0 contract (scripts/ai/test-automation/
// automation-repository-context.js is #23-owned and unversioned) - #23C
// must not assume an arbitrary object handed to it genuinely came from
// that module's own builder, so this independently re-validates the
// shape it depends on: bounded, positively-keyed, deterministic, and
// (Roadmap #23C-C1) at parity with or stricter than that module's own
// real producible output - never a separately-maintained wider bound. It
// does not re-scan the filesystem or re-derive path safety - that is
// #23B's own job and already done by the time this module ever sees a
// context.
function validateRepositoryContextSnapshot(context, { expectedProjectId } = {}) {
  const errors = [];
  if (!isPlainObject(context)) {
    return [err("$.repositoryContext", ERROR_CODES.INVALID_TYPE, "repositoryContext must be a plain object")];
  }

  collectUnknownKeyErrors(context, CONTEXT_TOP_LEVEL_ALLOWED_KEYS, "$.repositoryContext", errors);
  validateProjectId(context.projectId, "$.repositoryContext.projectId", errors, { expectedProjectId });

  const frameworkValid = SUPPORTED_FRAMEWORKS.includes(context.framework);
  if (!frameworkValid) {
    errors.push(err("$.repositoryContext.framework", ERROR_CODES.INVALID_ENUM, `$.repositoryContext.framework must be one of ${SUPPORTED_FRAMEWORKS.join(", ")}`));
  }

  if (!isPlainObject(context.guidance)) {
    errors.push(err("$.repositoryContext.guidance", ERROR_CODES.INVALID_TYPE, "$.repositoryContext.guidance must be an object"));
  } else {
    collectUnknownKeyErrors(context.guidance, GUIDANCE_ALLOWED_KEYS, "$.repositoryContext.guidance", errors);
    if (typeof context.guidance.displayName !== "string" || context.guidance.displayName.trim().length === 0) {
      errors.push(err("$.repositoryContext.guidance.displayName", ERROR_CODES.INVALID_TYPE, "$.repositoryContext.guidance.displayName must be a non-empty string"));
    }
    if (!Array.isArray(context.guidance.knownProjectConstraints)) {
      errors.push(err("$.repositoryContext.guidance.knownProjectConstraints", ERROR_CODES.INVALID_TYPE, "$.repositoryContext.guidance.knownProjectConstraints must be an array"));
    }
  }

  if (!Array.isArray(context.packageScripts)) {
    errors.push(err("$.repositoryContext.packageScripts", ERROR_CODES.INVALID_TYPE, "$.repositoryContext.packageScripts must be an array"));
  } else if (context.packageScripts.length > REPO_CONTEXT_LIMITS.MAX_SCRIPT_COUNT) {
    errors.push(err("$.repositoryContext.packageScripts", ERROR_CODES.INVALID_VALUE, `$.repositoryContext.packageScripts exceeds the maximum of ${REPO_CONTEXT_LIMITS.MAX_SCRIPT_COUNT}`));
  } else {
    context.packageScripts.forEach((s, i) => {
      const p = `$.repositoryContext.packageScripts[${i}]`;
      if (!isPlainObject(s)) {
        errors.push(err(p, ERROR_CODES.INVALID_TYPE, `${p} must be an object`));
        return;
      }
      collectUnknownKeyErrors(s, PACKAGE_SCRIPT_ALLOWED_KEYS, p, errors);
      if (typeof s.name !== "string" || s.name.length === 0 || s.name.length > LIMITS.MAX_SCRIPT_NAME_LENGTH) {
        errors.push(err(`${p}.name`, ERROR_CODES.INVALID_TYPE, `${p}.name must be a non-empty, bounded string`));
      } else if (frameworkValid && !isPlanningRelevantScriptName(s.name, context.framework)) {
        // Roadmap #23C-C1: #23B never SELECTS a script name outside its
        // own per-framework planning-relevant allowlist (currently 5
        // names for cypress, 1 for playwright) - a forged context
        // claiming a name #23B's real builder could never have produced
        // is rejected here, by direct reuse of #23B's own exported
        // allowlist check, never a separately-maintained duplicate list.
        errors.push(err(`${p}.name`, ERROR_CODES.INVALID_VALUE, `${p}.name is not one of #23B's planning-relevant script names for this framework`));
      }
      if (typeof s.command !== "string" || s.command.length === 0 || s.command.length > LIMITS.MAX_SCRIPT_COMMAND_LENGTH) {
        errors.push(err(`${p}.command`, ERROR_CODES.INVALID_TYPE, `${p}.command must be a non-empty, bounded string`));
      }
    });
    collectDuplicateIdErrors(
      context.packageScripts.map((s) => (isPlainObject(s) && typeof s.name === "string" ? { id: s.name } : { id: undefined })),
      "id",
      "$.repositoryContext.packageScripts",
      errors
    );
  }

  if (!Array.isArray(context.repositoryEvidence) || context.repositoryEvidence.length === 0) {
    errors.push(err("$.repositoryContext.repositoryEvidence", ERROR_CODES.MISSING_FIELD, "$.repositoryContext.repositoryEvidence must be a non-empty array"));
  } else if (context.repositoryEvidence.length > LIMITS.MAX_REPOSITORY_EVIDENCE_ITEMS) {
    errors.push(err("$.repositoryContext.repositoryEvidence", ERROR_CODES.INVALID_VALUE, `$.repositoryContext.repositoryEvidence exceeds the maximum of ${LIMITS.MAX_REPOSITORY_EVIDENCE_ITEMS}`));
  } else {
    // Roadmap #23C-C1: aggregate content length, accumulated only from
    // items whose own per-item bound already passed - mirrors
    // automation-repository-context.js's own "per-item bound first,
    // aggregate bound second" structure. `.length` on a JS string is an
    // O(1) property read (strings carry their own length), never a
    // re-scan/re-serialization of the content, so this adds no additional
    // materialization cost regardless of how large a rejected item's
    // content string is.
    let aggregateLength = 0;
    context.repositoryEvidence.forEach((item, i) => {
      const p = `$.repositoryContext.repositoryEvidence[${i}]`;
      if (!isPlainObject(item)) {
        errors.push(err(p, ERROR_CODES.INVALID_TYPE, `${p} must be an object`));
        return;
      }
      collectUnknownKeyErrors(item, EVIDENCE_ITEM_ALLOWED_KEYS, p, errors);
      if (!EVIDENCE_ROLES.includes(item.role)) {
        errors.push(err(`${p}.role`, ERROR_CODES.INVALID_ENUM, `${p}.role must be one of ${EVIDENCE_ROLES.join(", ")}`));
      }
      if (!isBoundedText(item.content, LIMITS.MAX_EVIDENCE_CONTENT_LENGTH)) {
        errors.push(err(`${p}.content`, ERROR_CODES.INVALID_VALUE, `${p}.content must be a non-empty string of at most ${LIMITS.MAX_EVIDENCE_CONTENT_LENGTH} characters`));
      } else {
        aggregateLength += item.content.length;
      }
      if (!isPlainObject(item.evidenceRef)) {
        errors.push(err(`${p}.evidenceRef`, ERROR_CODES.INVALID_TYPE, `${p}.evidenceRef must be an object`));
      } else {
        // Roadmap #23C-C1: reuse the frozen F0 EvidenceRef validator
        // directly (scripts/ai/generation/primitives.js) rather than a
        // separately-maintained local shape check - this restores the
        // exact id-bound and location-bound (LIMITS.SHORT_TEXT_MAX_LENGTH)
        // semantics without a second copy that could silently drift out
        // of parity. validateEvidenceRef's own allowed-keys list also
        // permits an optional `sourceId` that #23B's real repository
        // evidence never produces; a bounded, unused, valid-id-shaped
        // sourceId on a forged context is harmless here, since
        // buildPositiveProjection() below never reads it. `kind` is
        // additionally restricted to exactly "repository" - the frozen
        // validator alone would accept any of its own 5-value enum.
        validateEvidenceRef(item.evidenceRef, `${p}.evidenceRef`, errors);
        if (item.evidenceRef.kind !== EVIDENCE_KIND_REPOSITORY) {
          errors.push(err(`${p}.evidenceRef.kind`, ERROR_CODES.INVALID_ENUM, `${p}.evidenceRef.kind must be "repository"`));
        }
      }
    });
    if (aggregateLength > LIMITS.MAX_AGGREGATE_EVIDENCE_LENGTH) {
      errors.push(err("$.repositoryContext.repositoryEvidence", ERROR_CODES.INVALID_VALUE, `repositoryEvidence aggregate content exceeds the maximum of ${LIMITS.MAX_AGGREGATE_EVIDENCE_LENGTH} characters`));
    }
    collectDuplicateIdErrors(
      context.repositoryEvidence.map((item) => (isPlainObject(item) && isPlainObject(item.evidenceRef) ? { id: item.evidenceRef.id } : { id: undefined })),
      "id",
      "$.repositoryContext.repositoryEvidence",
      errors
    );
  }

  return errors;
}

// #23-local candidate/plan binding checks. Deliberately NOT a call into
// scripts/ai/generation/cross-model-validation.js's validateGenerationChain()
// - that validator requires a full RequirementModel + TestCaseModel +
// automationCandidates[] + automationPlans[] chain, which this module
// never has (only one already-validated AutomationCandidate and one
// generated plan). This narrowly re-implements exactly the two rules from
// that validator's own F6 check that do apply here (a plan may only
// reference an AUTOMATE candidate; a plan's framework must be one the
// candidate actually authorizes), plus the #23-local path/framework-scope
// rule described on FRAMEWORK_PATH_PREFIX above. `candidateSnapshot
// .decision === "AUTOMATE"` is already independently guaranteed by the
// caller (generateAutomationPlan() never reaches this function otherwise),
// so this only needs to check identity/framework/path binding, not
// decision again.
function validatePlanBinding(plan, candidateSnapshot, framework) {
  const errors = [];
  if (!isPlainObject(plan)) return errors; // already reported by validateAutomationPlan's own top-level check

  if (plan.automationCandidateId !== candidateSnapshot.id) {
    errors.push(err("$.automationCandidateId", ERROR_CODES.INVALID_REFERENCE, "automationCandidateId does not match the authorized AutomationCandidate"));
  }
  if (plan.framework !== framework) {
    errors.push(err("$.framework", ERROR_CODES.INVALID_VALUE, "framework does not match the authorized generation framework"));
  }

  if (Array.isArray(plan.plannedChanges)) {
    plan.plannedChanges.forEach((change, i) => {
      if (isPlainObject(change) && typeof change.path === "string" && !change.path.startsWith(FRAMEWORK_PATH_PREFIX[framework])) {
        errors.push(err(`$.plannedChanges[${i}].path`, ERROR_CODES.INVALID_PATH, `$.plannedChanges[${i}].path must be inside the ${framework} framework's directory tree`));
      }
    });
  }

  return errors;
}

// Builds the ONLY object ever sent to the provider. A deliberate positive
// allowlist - never `JSON.stringify(repositoryContext)` /
// `JSON.stringify(automationCandidate)` wholesale (see this module's own
// docstring). Package script COMMAND bodies are never included - only
// names (Roadmap #23C, Phase 15: AutomationRepositoryContext guarantees
// only targeted minimization, not that a selected script's command text
// is free of secret-shaped values).
function buildPositiveProjection({ candidateSnapshot, contextSnapshot, framework }) {
  return {
    projectId: contextSnapshot.projectId,
    framework,
    candidate: {
      id: candidateSnapshot.id,
      decision: candidateSnapshot.decision,
      rationale: candidateSnapshot.rationale,
      targetFrameworks: candidateSnapshot.targetFrameworks,
    },
    guidance: {
      displayName: contextSnapshot.guidance.displayName,
      knownProjectConstraints: contextSnapshot.guidance.knownProjectConstraints,
    },
    availableTestScripts: contextSnapshot.packageScripts.map((s) => s.name),
    repositoryEvidence: contextSnapshot.repositoryEvidence.map((item) => ({
      evidenceRef: { id: item.evidenceRef.id, kind: item.evidenceRef.kind, location: item.evidenceRef.location },
      role: item.role,
      content: item.content,
    })),
  };
}

/**
 * Generates one AutomationPlan v1 for one already-approved
 * AutomationCandidate, grounded in one AutomationRepositoryContext,
 * through a dependency-injected provider.
 *
 * `provider` must implement `provider.analyze({systemPrompt, userPrompt})
 * -> Promise<string>` (scripts/ai/providers/) - never hardcoded to Groq/
 * Gemini/mock; the caller supplies it.
 *
 * `expectedProjectId`, when supplied, must equal both the candidate's and
 * the repository context's own projectId (in addition to those already
 * having to equal each other) - the same optional cross-check convention
 * every frozen v1 validator already accepts.
 *
 * `maxAttempts` bounds the total number of provider calls. Only
 * `undefined` (defaulting to 2), `1`, and `2` are accepted (Roadmap
 * #23C-C1: strict `!==` identity checks, never a numeric range comparison
 * - a numeric range check using `<`/`>` silently accepts `NaN`, since
 * every comparison against `NaN` is false). Any other value (including
 * `NaN`, `Infinity`, `1.5`, a numeric string, `null`, or a plain
 * object/array) is rejected with a non-empty bounded error before any
 * provider call. Any locally-detected invalid input (malformed candidate,
 * non-AUTOMATE decision, project/framework mismatch, malformed repository
 * context, an outbound prompt that exceeds LIMITS.MAX_OUTBOUND_PROMPT_CHARS)
 * also makes zero provider calls for that attempt.
 *
 * Returns { ok: true, automationPlan, providerAttempts } or { ok: false,
 * errors: [{path,code,message}, ...], providerAttempts } - never the raw
 * provider response, the prompt, the repository context, or any caller
 * object.
 */
async function generateAutomationPlan({ automationCandidate, repositoryContext, provider, expectedProjectId, maxAttempts } = {}) {
  if (maxAttempts !== undefined && maxAttempts !== 1 && maxAttempts !== 2) {
    return { ok: false, errors: [err("$.maxAttempts", ERROR_CODES.INVALID_VALUE, "maxAttempts must be exactly 1 or 2 (or omitted for the default of 2)")], providerAttempts: 0 };
  }
  const effectiveMaxAttempts = maxAttempts === undefined ? 2 : maxAttempts;
  if (expectedProjectId !== undefined && !isValidId(expectedProjectId)) {
    return { ok: false, errors: [err("$.expectedProjectId", ERROR_CODES.INVALID_TYPE, "expectedProjectId must be a bounded string id")], providerAttempts: 0 };
  }
  if (!provider || typeof provider.analyze !== "function") {
    return { ok: false, errors: [err("$.provider", ERROR_CODES.INVALID_TYPE, "provider.analyze must be a function")], providerAttempts: 0 };
  }

  // Phase 6/7 (Roadmap #23C-C1): snapshot caller-controlled inputs exactly
  // once, before any validation or semantic read, via the owned-data
  // boundary above - never JSON.stringify/JSON.parse. Everything below
  // reads only these two frozen local values - never automationCandidate/
  // repositoryContext again.
  const candidateSnapshot = deepFreeze(snapshotOwnData(automationCandidate));
  const contextSnapshot = deepFreeze(snapshotOwnData(repositoryContext));

  const candidateResult = validateAutomationCandidate(candidateSnapshot, { expectedProjectId });
  const contextErrors = validateRepositoryContextSnapshot(contextSnapshot, { expectedProjectId });

  const localErrors = [...(candidateResult.ok ? [] : candidateResult.errors), ...contextErrors];
  if (localErrors.length > 0) {
    return { ok: false, errors: localErrors, providerAttempts: 0 };
  }

  // Critical F0 rule (Roadmap #22/23-F0-C1): only an AUTOMATE candidate
  // may authorize AutomationPlan generation at all - checked before any
  // provider call, matching cross-model-validation.js's own F6 rule.
  if (candidateSnapshot.decision !== "AUTOMATE") {
    return {
      ok: false,
      errors: [err("$.automationCandidate.decision", ERROR_CODES.INVARIANT_VIOLATION, "only an AUTOMATE candidate may authorize AutomationPlan generation")],
      providerAttempts: 0,
    };
  }

  if (candidateSnapshot.projectId !== contextSnapshot.projectId) {
    return {
      ok: false,
      errors: [err("$.repositoryContext.projectId", ERROR_CODES.PROJECT_MISMATCH, "repositoryContext.projectId does not match automationCandidate.projectId")],
      providerAttempts: 0,
    };
  }

  const framework = contextSnapshot.framework;
  if (!candidateSnapshot.targetFrameworks.includes(framework)) {
    return {
      ok: false,
      errors: [err("$.repositoryContext.framework", ERROR_CODES.INVARIANT_VIOLATION, "repositoryContext.framework is not among the candidate's authorized target frameworks")],
      providerAttempts: 0,
    };
  }

  const projection = deepFreeze(buildPositiveProjection({ candidateSnapshot, contextSnapshot, framework }));
  const systemPrompt = buildAutomationPlanSystemPrompt({ framework });

  let providerAttempts = 0;
  let lastErrors = [];

  for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt++) {
    const userPrompt = attempt === 1 ? buildAutomationPlanUserPrompt(projection) : buildAutomationPlanCorrectionPrompt(projection, boundCorrectionErrors(lastErrors));

    // Roadmap #23C-C1: a final, defensive outbound-prompt bound, checked
    // per attempt (the correction prompt on attempt 2 embeds the same
    // projection plus a bounded diagnostics block, so it must be checked
    // independently rather than assumed safe merely because attempt 1
    // passed) - see LIMITS.MAX_OUTBOUND_PROMPT_CHARS's own comment. No
    // provider call is made for an attempt whose own prompt exceeds this.
    if (userPrompt.length > LIMITS.MAX_OUTBOUND_PROMPT_CHARS) {
      return {
        ok: false,
        errors: [err("$.repositoryContext", ERROR_CODES.INVALID_VALUE, `provider prompt exceeds the maximum of ${LIMITS.MAX_OUTBOUND_PROMPT_CHARS} characters`)],
        providerAttempts,
      };
    }

    providerAttempts = attempt;

    let rawResponse;
    try {
      rawResponse = await provider.analyze({ systemPrompt, userPrompt });
    } catch (rawError) {
      const providerError = normalizeProviderError(rawError);
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider call failed")];
      if (attempt === effectiveMaxAttempts || !providerError.retryable) {
        return { ok: false, errors: lastErrors, providerAttempts };
      }
      continue;
    }

    if (typeof rawResponse !== "string" || rawResponse.trim().length === 0) {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider returned an empty or non-string response")];
      if (attempt === effectiveMaxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }
    if (rawResponse.length > LIMITS.MAX_AUTOMATION_PLAN_RESPONSE_CHARS) {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, `provider response exceeds the maximum of ${LIMITS.MAX_AUTOMATION_PLAN_RESPONSE_CHARS} characters`)];
      if (attempt === effectiveMaxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    let parsedPlan;
    try {
      parsedPlan = JSON.parse(rawResponse.trim());
    } catch {
      lastErrors = [err("$.provider", ERROR_CODES.INVALID_VALUE, "provider response was not valid JSON")];
      if (attempt === effectiveMaxAttempts) return { ok: false, errors: lastErrors, providerAttempts };
      continue;
    }

    const planResult = validateAutomationPlan(parsedPlan, { expectedProjectId: contextSnapshot.projectId });
    const bindingErrors = validatePlanBinding(parsedPlan, candidateSnapshot, framework);
    const allErrors = [...(planResult.ok ? [] : planResult.errors), ...bindingErrors];

    if (allErrors.length === 0) {
      return { ok: true, automationPlan: deepFreeze(parsedPlan), providerAttempts };
    }

    lastErrors = allErrors;
    if (attempt === effectiveMaxAttempts) {
      return { ok: false, errors: lastErrors, providerAttempts };
    }
  }

  // Unreachable in practice (the loop always returns by its last
  // iteration), kept only as a defensive fail-closed fallback.
  return { ok: false, errors: lastErrors, providerAttempts };
}

module.exports = {
  generateAutomationPlan,
  LIMITS,
  buildPositiveProjection,
  snapshotOwnData,
};
