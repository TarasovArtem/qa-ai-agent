/**
 * Shared v1 primitives for the QA generation contracts (Roadmap #22/23-F0):
 * bounded identifiers, bounded text, project-identity checking, and the
 * three cross-cutting record shapes every contract can carry - evidence/
 * source references (grounding), assumptions, and open questions.
 *
 * Pure, synchronous, dependency-free (no filesystem, network, environment,
 * time, or randomness) - the same "plain JavaScript checks, no schema
 * library" convention already used by scripts/ai/project-profile.js and
 * scripts/ai/knowledge/schema.js, extended here with the bounded
 * { path, code, message } error shape (scripts/ai/generation/errors.js)
 * because the generation contracts are cross-referenced against each other
 * (scripts/ai/generation/cross-model-validation.js), which needs
 * machine-branchable error codes in a way a flat string-array does not.
 */

"use strict";

const { LIMITS } = require("./limits");
const { ERROR_CODES, err } = require("./errors");

// Every v1 contract's required, frozen schemaVersion value. A v1 validator
// must never accept 2, a string "1", or a missing value as equivalent -
// see validateSchemaVersion() below.
const SCHEMA_VERSION = 1;

// Closed v1 vocabulary of automation frameworks this repository actually
// has production support for (scripts/ai/adapters/, Roadmap #21) - not an
// open string. Adding a framework here without real adapter/CI support
// would let a generation artifact claim automation coverage the repository
// cannot actually execute.
const SUPPORTED_FRAMEWORKS = Object.freeze(["playwright", "cypress"]);

// Closed v1 vocabulary of what an evidence/source reference may point at.
// These are POINTERS (an id/kind/optional sourceId/location), never a
// container for the evidence's own raw content - see G3 in the design
// mission and validateEvidenceRef() below.
const EVIDENCE_REF_KINDS = Object.freeze(["user_input", "document", "repository", "project_profile", "knowledge"]);

// Closed v1 vocabulary for an unresolved-gap record (scripts/ai/generation/
// requirement-model.js and any other contract that carries openQuestions).
// These three are deliberately NOT interchangeable with an assumption -
// see requirement-model.js's module comment.
const OPEN_QUESTION_TYPES = Object.freeze(["OPEN_QUESTION", "AMBIGUITY", "MISSING_REQUIREMENT"]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Rejects NUL and every other C0 control character plus DEL - deliberately
// over-cautious rather than trying to allowlist every legitimate Unicode
// codepoint. Applied to machine identifiers/enums/paths, which have no
// legitimate reason to contain any control character at all.
const ID_DISALLOWED_CONTROL_PATTERN = /[\x00-\x1F\x7F]/;
// Human-readable free text (requirement text, rationale, question text,
// step text) may legitimately contain normal tab/newline/carriage-return -
// this pattern allows those three but still rejects NUL and every other
// control character.
const TEXT_DISALLOWED_CONTROL_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/;

function hasIdControlChars(value) {
  return ID_DISALLOWED_CONTROL_PATTERN.test(value);
}

function hasTextControlChars(value) {
  return TEXT_DISALLOWED_CONTROL_PATTERN.test(value);
}

// A bounded machine identifier: a string, non-empty, trim-stable (the
// trimmed form must equal the original - no leading/trailing whitespace),
// free of control characters, and no longer than LIMITS.ID_MAX_LENGTH.
// Never coerces (no String(value)) - a number/array/object id is rejected
// outright, matching A1's "not arrays/objects/numbers" requirement.
function isValidId(value) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > LIMITS.ID_MAX_LENGTH) return false;
  if (value.trim() !== value) return false;
  if (hasIdControlChars(value)) return false;
  return true;
}

// Bounded free text: non-empty after trimming, within maxLength (measured
// on the raw, untrimmed string so a producer cannot pad past the limit with
// leading/trailing whitespace alone), free of disallowed control chars.
function isBoundedText(value, maxLength) {
  if (typeof value !== "string") return false;
  if (value.trim().length === 0) return false;
  if (value.length > maxLength) return false;
  if (hasTextControlChars(value)) return false;
  return true;
}

// Pushes a bounded INVALID_TYPE error when `value` isn't a valid id;
// returns whether it was valid, so a caller can skip a dependent check
// (e.g. reference-resolution) without also emitting a second, redundant
// error for the same malformed value.
function collectIdError(value, path, errors) {
  if (!isValidId(value)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be a non-empty, trimmed, bounded string id`));
    return false;
  }
  return true;
}

// Rejects any own-enumerable key on `obj` that isn't in `allowedKeys` - the
// mission-wide "exact keys, reject unknown fields" invariant (A6),
// preventing silent contract drift and provider/producer-added fields from
// crossing a v1 boundary unnoticed. Own-property enumeration only (never
// touches the prototype chain), matching qa-agent-prompt.js's
// pickPromptMetadata()/projectPromptFailure() convention.
function collectUnknownKeyErrors(obj, allowedKeys, path, errors) {
  if (!isPlainObject(obj)) return;
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors.push(err(`${path}.${key}`, ERROR_CODES.UNKNOWN_FIELD, `${path}: unknown field "${key}"`));
    }
  }
}

// Reports a DUPLICATE_ID error for every id value (identified by `idField`)
// that appears more than once in `items`. Ignores an item whose id itself
// isn't a string - that is reported separately by the item's own shape
// validation, never doubly reported here.
function collectDuplicateIdErrors(items, idField, path, errors) {
  if (!Array.isArray(items)) return;
  const seen = new Set();
  const reported = new Set();
  for (const item of items) {
    const id = item && typeof item === "object" ? item[idField] : undefined;
    if (typeof id !== "string") continue;
    if (seen.has(id) && !reported.has(id)) {
      errors.push(err(path, ERROR_CODES.DUPLICATE_ID, `${path}: duplicate id "${id}"`));
      reported.add(id);
    }
    seen.add(id);
  }
}

// Exactly `SCHEMA_VERSION` (the number 1) - never a string "1", never 2,
// never coerced via parseInt/truthiness/loose equality, never silently
// defaulted when missing.
function validateSchemaVersion(value, path, errors) {
  if (value === undefined) {
    errors.push(err(path, ERROR_CODES.MISSING_FIELD, `${path} is required`));
    return;
  }
  if (value !== SCHEMA_VERSION) {
    errors.push(err(path, ERROR_CODES.INVALID_VERSION, `${path} must be exactly schemaVersion ${SCHEMA_VERSION}`));
  }
}

function validateKind(value, expectedKind, path, errors) {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(err(path, ERROR_CODES.MISSING_FIELD, `${path} is required`));
    return;
  }
  if (value !== expectedKind) {
    errors.push(err(path, ERROR_CODES.INVALID_VALUE, `${path} must be "${expectedKind}"`));
  }
}

// `expectedProjectId`, when supplied, enforces cross-project isolation
// (A2): the artifact's own projectId must match it EXACTLY - never
// normalized/trimmed/lower-cased into equality, so a genuinely different
// project id can never be silently accepted as "close enough".
function validateProjectId(value, path, errors, { expectedProjectId } = {}) {
  if (!collectIdError(value, path, errors)) return;
  if (expectedProjectId !== undefined && value !== expectedProjectId) {
    errors.push(err(path, ERROR_CODES.PROJECT_MISMATCH, `${path} does not match the expected project id`));
  }
}

// --- Evidence / source references (grounding pointers, never raw content) -

const EVIDENCE_REF_ALLOWED_KEYS = Object.freeze(["id", "kind", "sourceId", "location"]);

function validateEvidenceRef(ref, path, errors) {
  if (!isPlainObject(ref)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(ref, EVIDENCE_REF_ALLOWED_KEYS, path, errors);
  collectIdError(ref.id, `${path}.id`, errors);

  if (!EVIDENCE_REF_KINDS.includes(ref.kind)) {
    errors.push(err(`${path}.kind`, ERROR_CODES.INVALID_ENUM, `${path}.kind must be one of ${EVIDENCE_REF_KINDS.join(", ")}`));
  }

  const sourceIdPresent = ref.sourceId !== undefined;
  const sourceIdValid = sourceIdPresent && isValidId(ref.sourceId);
  if (sourceIdPresent && !sourceIdValid) {
    errors.push(err(`${path}.sourceId`, ERROR_CODES.INVALID_TYPE, `${path}.sourceId must be a bounded string id`));
  }

  const locationPresent = ref.location !== undefined;
  const locationValid = locationPresent && isBoundedText(ref.location, LIMITS.SHORT_TEXT_MAX_LENGTH);
  if (locationPresent && !locationValid) {
    errors.push(err(`${path}.location`, ERROR_CODES.INVALID_TYPE, `${path}.location must be a bounded, non-empty string`));
  }

  // Roadmap #22/23-F0-C1: an EvidenceRef must actually locate evidence, not
  // merely name it - at least one of sourceId/location must be present AND
  // individually valid. A present-but-invalid locator (empty string, wrong
  // type - already flagged above) never counts toward this: a caller
  // cannot satisfy grounding by supplying a malformed placeholder. Without
  // this, {id, kind} alone would be a nominal, non-locating label that
  // still passes as "evidence" - the exact gap that made a grounded
  // RequirementModel requirement's provenance structurally vacuous.
  if (!sourceIdValid && !locationValid) {
    errors.push(
      err(path, ERROR_CODES.INVARIANT_VIOLATION, `${path} must identify evidence via a valid sourceId and/or location - neither was present and valid`)
    );
  }
}

// --- Assumptions (A4) - structurally distinct from grounded requirements --
//
// Roadmap #22/23-F0-C1: a prior `relatedIds` field (bounded id-shaped
// strings) was removed before v1 freeze. It was never resolved against any
// registry by any validator or cross-model check, and its intended
// referent (a requirement id? an evidence-ref id? some other assumption?)
// was an untyped union nothing in this codebase disambiguated - exactly
// the "same string could ambiguously refer to multiple entity types" gap
// a v1 contract must not freeze. A real relationship/trace contract is a
// v2 concern; `relatedIds` is now simply an unknown field, rejected like
// any other (see collectUnknownKeyErrors above).

const ASSUMPTION_ALLOWED_KEYS = Object.freeze(["id", "text", "rationale"]);

function validateAssumption(assumption, path, errors) {
  if (!isPlainObject(assumption)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(assumption, ASSUMPTION_ALLOWED_KEYS, path, errors);
  collectIdError(assumption.id, `${path}.id`, errors);

  if (!isBoundedText(assumption.text, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.text`, ERROR_CODES.INVALID_TYPE, `${path}.text must be a bounded, non-empty string`));
  }
  if (!isBoundedText(assumption.rationale, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.rationale`, ERROR_CODES.INVALID_TYPE, `${path}.rationale must be a bounded, non-empty string`));
  }
}

// --- Open questions (A5) - never silently convertible into an assumption -

const OPEN_QUESTION_ALLOWED_KEYS = Object.freeze(["id", "type", "description", "reason"]);

function validateOpenQuestion(question, path, errors) {
  if (!isPlainObject(question)) {
    errors.push(err(path, ERROR_CODES.INVALID_TYPE, `${path} must be an object`));
    return;
  }
  collectUnknownKeyErrors(question, OPEN_QUESTION_ALLOWED_KEYS, path, errors);
  collectIdError(question.id, `${path}.id`, errors);

  if (!OPEN_QUESTION_TYPES.includes(question.type)) {
    errors.push(err(`${path}.type`, ERROR_CODES.INVALID_ENUM, `${path}.type must be one of ${OPEN_QUESTION_TYPES.join(", ")}`));
  }
  if (!isBoundedText(question.description, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.description`, ERROR_CODES.INVALID_TYPE, `${path}.description must be a bounded, non-empty string`));
  }
  if (!isBoundedText(question.reason, LIMITS.LONG_TEXT_MAX_LENGTH)) {
    errors.push(err(`${path}.reason`, ERROR_CODES.INVALID_TYPE, `${path}.reason must be a bounded, non-empty string`));
  }
}

module.exports = {
  SCHEMA_VERSION,
  SUPPORTED_FRAMEWORKS,
  EVIDENCE_REF_KINDS,
  OPEN_QUESTION_TYPES,
  isPlainObject,
  isValidId,
  isBoundedText,
  hasIdControlChars,
  hasTextControlChars,
  collectIdError,
  collectUnknownKeyErrors,
  collectDuplicateIdErrors,
  validateSchemaVersion,
  validateKind,
  validateProjectId,
  validateEvidenceRef,
  validateAssumption,
  validateOpenQuestion,
};
