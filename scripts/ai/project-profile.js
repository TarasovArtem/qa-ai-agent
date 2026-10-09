/**
 * ProjectProfile - stable, data-only project identity and project-specific
 * context (Roadmap #19.2).
 *
 * A ProjectProfile owns exactly two things: a stable machine-readable
 * project identity (`id`, `displayName`) and stable project-specific
 * background facts (`knownProjectConstraints`). It owns nothing else -
 * no framework identity, no current-run evidence, no classification, no
 * policy, no knowledge selection, no history reasoning, no provider
 * configuration/secrets, no browser-correlation semantics, no artifact
 * parsing, no callbacks, no dynamic code. See scripts/ai/agent-policy.js,
 * scripts/ai/providers/, scripts/ai/knowledge/, and
 * scripts/ai/aggregate-browser-context.js for those - none of them are
 * touched by this module.
 *
 * GUIDANCE, NEVER EVIDENCE: a knownProjectConstraints entry is a stable
 * background fact about the project (e.g. "the SUT is an external live
 * service this repo doesn't control"), not proof that this fact caused
 * any specific current-run failure - the same authority boundary already
 * enforced for this same content by qa-agent-prompt.js's rule 9.
 *
 * Roadmap TI-1 (Targomo Independence): this module is the GENERIC CORE
 * contract only - a shape/validator, never a concrete project instance.
 * It must never import or define a concrete target's profile (e.g.
 * Targomo's `TARGOMO_PROJECT_PROFILE`, previously exported from here).
 * A concrete profile is now target-owned - see
 * scripts/targets/targomo/project-profile.js for the real production
 * instance - and is always supplied as data to the functions that accept
 * a profile parameter (collect-context.js's main(), collect-history.js's
 * main(), qa-agent-prompt.js's buildSystemPrompt(),
 * analyze-failure.js's main()), never imported by them.
 *
 * TSB-F05-D1-C1 (docs/tsb-f05-project-profile-contract-decision-v1.md):
 * this module is the ONE central ProjectProfile v1 trust boundary.
 * inspectProjectProfile() rejects Proxy inputs before any trap-capable
 * reflection, accepts only a closed plain-data record of exactly
 * `id`/`displayName`/`knownProjectConstraints` read through own enumerable
 * data descriptors (never invoking a getter/setter), enforces the approved
 * UTF-16 bounds and C0+DEL rejection, and returns a newly allocated,
 * frozen snapshot built only from the captured primitive strings. Every
 * consumer - public or repository-private - must use that snapshot (or a
 * projection derived from it) and never read the caller's object again.
 * validateProjectProfile() and assertValidProjectProfile() both derive
 * from it; only assertValidProjectProfile() is a supported root export
 * (see docs/package-surface-v3.md).
 */

"use strict";

const { types: utilTypes } = require("node:util");

// Intrinsics captured once at module load, so inspection never consults a
// method reachable through the caller's object or array.
const { isProxy } = utilTypes;
const { getOwnPropertyDescriptor, getPrototypeOf, hasOwn, freeze } = Object;
const { ownKeys } = Reflect;
const { isArray } = Array;
const OBJECT_PROTOTYPE = Object.prototype;
const ARRAY_PROTOTYPE = Array.prototype;

// D1-C1 §5.3 - every bound is in JavaScript UTF-16 code units (String.length).
const MAX_ID_LENGTH = 128;
const MAX_DISPLAY_NAME_LENGTH = 256;
const MIN_CONSTRAINTS = 1;
const MAX_CONSTRAINTS = 32;
const MAX_CONSTRAINT_LENGTH = 2048;
const MAX_AGGREGATE_CONSTRAINTS_LENGTH = 8192;

// D1-C1 §10 - diagnostic bounds.
const MAX_REPORTED_UNKNOWN_KEYS = 8;
const MAX_RENDERED_KEY_LENGTH = 80;
const MAX_DETAIL_LENGTH = 1024;
const OMISSION_RESERVE = 40;

const REQUIRED_FIELDS = Object.freeze(["id", "displayName", "knownProjectConstraints"]);
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;
const CANONICAL_INDEX = /^(?:0|[1-9][0-9]*)$/;

// Renders a caller-controlled property name as bounded printable ASCII:
// anything outside U+0020..U+007E (and `"`/`\`) becomes a \uXXXX escape,
// and the quoted result never exceeds MAX_RENDERED_KEY_LENGTH units.
function renderKey(key) {
  const budget = MAX_RENDERED_KEY_LENGTH - 2; // the surrounding quotes
  const pieces = [];
  let length = 0;
  for (let i = 0; i < key.length; i += 1) {
    const code = key.charCodeAt(i);
    const piece = code >= 0x20 && code <= 0x7e && code !== 0x22 && code !== 0x5c ? key[i] : `\\u${code.toString(16).padStart(4, "0")}`;
    if (length + piece.length > budget) {
      // Drop whole pieces (never half an escape) to make room for "...".
      while (length > budget - 3) length -= pieces.pop().length;
      return `"${pieces.join("")}..."`;
    }
    pieces.push(piece);
    length += piece.length;
  }
  return `"${pieces.join("")}"`;
}

function unknownKeysError(label, keys) {
  const shown = keys.slice(0, MAX_REPORTED_UNKNOWN_KEYS).map(renderKey).join(", ");
  const more = keys.length > MAX_REPORTED_UNKNOWN_KEYS ? ` (+${keys.length - MAX_REPORTED_UNKNOWN_KEYS} more)` : "";
  return `${label} has unknown key(s): ${shown}${more}`;
}

// Bounds the joined ("; ") validation detail to MAX_DETAIL_LENGTH units,
// replacing whatever does not fit with a fixed omission indicator.
function boundErrors(errors) {
  const bounded = [];
  let length = 0;
  for (let i = 0; i < errors.length; i += 1) {
    const added = (bounded.length > 0 ? 2 : 0) + errors[i].length;
    if (length + added > MAX_DETAIL_LENGTH - OMISSION_RESERVE) {
      bounded.push(`${errors.length - i} more error(s) omitted`);
      return bounded;
    }
    bounded.push(errors[i]);
    length += added;
  }
  return bounded;
}

// Validates one captured primitive against D1-C1 §5.2. Length is checked
// before any scan so an oversized value is never trimmed or regex-tested.
function checkString(value, label, maxLength, errors) {
  if (typeof value !== "string") {
    errors.push(`${label} must be a string`);
    return false;
  }
  if (value.length > maxLength) {
    errors.push(`${label} exceeds ${maxLength} UTF-16 code units`);
    return false;
  }
  if (value.trim().length === 0) {
    errors.push(`${label} must contain a non-whitespace character`);
    return false;
  }
  if (CONTROL_CHARACTER.test(value)) {
    errors.push(`${label} must not contain control characters`);
    return false;
  }
  return true;
}

// Reads one own property through its descriptor only - never a getter,
// never an inherited value. Returns { present, value } or pushes an error.
function captureDataProperty(target, key, label, errors) {
  const descriptor = getOwnPropertyDescriptor(target, key);
  if (descriptor === undefined) {
    errors.push(`${label} is required`);
    return { present: false };
  }
  if (!hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
    errors.push(`${label} must be an enumerable data property`);
    return { present: false };
  }
  return { present: true, value: descriptor.value };
}

// D1-C1 §6. Returns a NEW array of the captured strings, or null on error.
function inspectConstraints(value, errors) {
  const label = "knownProjectConstraints";
  if (typeof value !== "object" || value === null) {
    errors.push(`${label} must be an Array`);
    return null;
  }
  if (isProxy(value)) {
    errors.push(`${label} must not be a Proxy`);
    return null;
  }
  if (!isArray(value)) {
    errors.push(`${label} must be an Array`);
    return null;
  }
  if (getPrototypeOf(value) !== ARRAY_PROTOTYPE) {
    errors.push(`${label} must be an Array with Array.prototype (subclasses/custom prototypes are not allowed)`);
    return null;
  }
  const length = getOwnPropertyDescriptor(value, "length").value;
  if (length < MIN_CONSTRAINTS || length > MAX_CONSTRAINTS) {
    errors.push(`${label} must contain ${MIN_CONSTRAINTS}..${MAX_CONSTRAINTS} entries`);
    return null;
  }

  let valid = true;
  const unknownKeys = [];
  let hasSymbolKey = false;
  for (const key of ownKeys(value)) {
    if (typeof key === "symbol") hasSymbolKey = true;
    else if (key !== "length" && !(CANONICAL_INDEX.test(key) && Number(key) < length)) unknownKeys.push(key);
  }
  if (hasSymbolKey) {
    errors.push(`${label} must not have symbol keys`);
    valid = false;
  }
  if (unknownKeys.length > 0) {
    errors.push(unknownKeysError(label, unknownKeys));
    valid = false;
  }

  const captured = [];
  let aggregate = 0;
  for (let i = 0; i < length; i += 1) {
    const elementLabel = `${label}[${i}]`;
    const descriptor = getOwnPropertyDescriptor(value, String(i));
    if (descriptor === undefined) {
      errors.push(`${elementLabel} is missing (holes are not allowed)`);
      valid = false;
      continue;
    }
    if (!hasOwn(descriptor, "value") || descriptor.enumerable !== true) {
      errors.push(`${elementLabel} must be an enumerable data property`);
      valid = false;
      continue;
    }
    const element = descriptor.value;
    if (typeof element === "string") aggregate += element.length;
    if (!checkString(element, elementLabel, MAX_CONSTRAINT_LENGTH, errors)) {
      valid = false;
      continue;
    }
    captured[i] = element;
  }
  if (aggregate > MAX_AGGREGATE_CONSTRAINTS_LENGTH) {
    errors.push(`${label} aggregate length exceeds ${MAX_AGGREGATE_CONSTRAINTS_LENGTH} UTF-16 code units`);
    valid = false;
  }
  return valid ? captured : null;
}

function inspectUnchecked(input) {
  if (input === null || typeof input !== "object") {
    return ["profile must be an object"];
  }
  // D1-C1 §4.2: Proxy rejection precedes every trap-capable operation.
  if (isProxy(input)) {
    return ["profile must not be a Proxy"];
  }
  if (isArray(input)) {
    return ["profile must be a plain object"];
  }
  const prototype = getPrototypeOf(input);
  if (prototype !== OBJECT_PROTOTYPE && prototype !== null) {
    return ["profile must be a plain object (prototype must be Object.prototype or null)"];
  }

  const errors = [];
  const unknownKeys = [];
  let hasSymbolKey = false;
  for (const key of ownKeys(input)) {
    if (typeof key === "symbol") hasSymbolKey = true;
    else if (!REQUIRED_FIELDS.includes(key)) unknownKeys.push(key);
  }
  if (hasSymbolKey) errors.push("profile must not have symbol keys");
  if (unknownKeys.length > 0) errors.push(unknownKeysError("profile", unknownKeys));

  const id = captureDataProperty(input, "id", "id", errors);
  const displayName = captureDataProperty(input, "displayName", "displayName", errors);
  const constraints = captureDataProperty(input, "knownProjectConstraints", "knownProjectConstraints", errors);

  if (id.present) checkString(id.value, "id", MAX_ID_LENGTH, errors);
  if (displayName.present) checkString(displayName.value, "displayName", MAX_DISPLAY_NAME_LENGTH, errors);
  const capturedConstraints = constraints.present ? inspectConstraints(constraints.value, errors) : null;

  if (errors.length > 0) return errors;

  // D1-C1 §7 steps 11-12 / §8: a new canonical object and array built only
  // from captured primitives, then frozen - never the caller's containers.
  const knownProjectConstraints = [];
  for (let i = 0; i < capturedConstraints.length; i += 1) knownProjectConstraints[i] = capturedConstraints[i];
  return freeze({ id: id.value, displayName: displayName.value, knownProjectConstraints: freeze(knownProjectConstraints) });
}

// Repository-internal central inspection primitive (D1-C1 §7) - NOT a
// supported root package export. Never throws for any input: an
// unexpected exception during inspection becomes a fixed, bounded
// diagnostic, never the raw message/stack.
function inspectProjectProfile(input) {
  let outcome;
  try {
    outcome = inspectUnchecked(input);
  } catch {
    outcome = ["profile could not be inspected"];
  }
  if (isArray(outcome)) return { valid: false, errors: boundErrors(outcome) };
  return { valid: true, errors: [], snapshot: outcome };
}

// Repository/module validator (not a root export, D1-C1 §9.1): the same
// central inspection, exposing only { valid, errors } - never a second
// schema and never the snapshot.
function validateProjectProfile(profile) {
  const { valid, errors } = inspectProjectProfile(profile);
  return { valid, errors };
}

// Roadmap TI-1: shared fail-closed helper for every generic core entry
// point that requires an injected ProjectProfile (collect-context.js,
// collect-history.js, qa-agent-prompt.js, analyze-failure.js). A small,
// duplicated-primitive-style helper here (matching this file's own
// existing convention over introducing a shared validation library) -
// throws a plain Error with a stable, deterministic, bounded message
// prefix, never a fabricated/partial profile and never uncontrolled
// serialization of the invalid input. `callerLabel` is a short,
// caller-supplied string (e.g. "collect-context.main()") identifying
// where the check failed, for operator-readable errors only - never
// parsed programmatically. Every current label is a static, internal
// provenance literal; it is not a validated external input.
//
// TSB-F05-D1-C1 §9.2/§9.4 (intentional BREAKING behavior correction): on
// success this returns the central inspection's detached, frozen
// authoritative snapshot - no longer the caller's own object - derived
// from that single inspection, never a second read of the caller input.
function assertValidProjectProfile(profile, callerLabel) {
  if (profile === undefined || profile === null) {
    throw new Error(`PROJECT_PROFILE_REQUIRED: ${callerLabel} requires an explicit ProjectProfile; none was supplied.`);
  }
  const result = inspectProjectProfile(profile);
  if (!result.valid) {
    throw new Error(`PROJECT_PROFILE_INVALID: ${callerLabel} received an invalid ProjectProfile (${result.errors.join("; ")}).`);
  }
  return result.snapshot;
}

module.exports = { validateProjectProfile, assertValidProjectProfile, inspectProjectProfile };
