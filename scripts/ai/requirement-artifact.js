/**
 * RequirementArtifact - normalized, source-independent test-design input
 * contract (Roadmap RTI-1, Requirement Artifact Contract).
 *
 * A RequirementArtifact answers exactly one question: "WHAT behavior or
 * product expectation should be tested?" It deliberately does NOT answer
 * "what project/domain constraints influence interpretation?" (that is
 * ProjectKnowledgeConfig's job - see scripts/ai/project-knowledge-config.js,
 * untouched by this module) or "what framework/report layout does this
 * project use?" (FrameworkRuntimeConfig's job) or "where do target
 * artifacts live on disk?" (repositoryRoot's job). A future Test Design
 * input is expected to combine RequirementArtifact[] + ProjectKnowledge +
 * risk context - this module owns none of the other two.
 *
 * SOURCE INDEPENDENCE (the central architectural rule of this contract):
 * this module and everything that will eventually consume
 * RequirementArtifact must never branch on `source.type`/`source.system`
 * (e.g. `if (source.system === "<some external system>") ...`). Source-specific
 * interpretation belongs entirely to future adapters (RTI-2+, RTI-6/RTI-7 -
 * not implemented here); this module only defines the target normalized
 * shape every adapter must produce and a single, source-agnostic
 * validator. `source` is retained on the artifact for traceability,
 * reporting, and audit only - never for behavioral branching anywhere in
 * this module.
 *
 * DATA-ONLY, JSON-SERIALIZABLE: matching every existing FPI-1/FPI-2
 * contract in this directory, a RequirementArtifact is plain, JSON-like
 * data - no methods, no callbacks, no provider functions, no filesystem
 * handles. `source.location` is explicitly PROVENANCE METADATA ONLY - it
 * must never be treated as filesystem authority by any consumer; a future
 * FileRequirementSource adapter (not implemented here) would resolve it
 * against an explicitly-authorized root exactly the way
 * scripts/ai/context-utils.js's existing primitives already do for other
 * repository-relative paths, never by reading `location` directly.
 *
 * NO CREDENTIALS: this contract has no field for tokens/credentials of any
 * kind (e.g. an external issue tracker's own API token) - those remain
 * environment-owned, matching every existing provider/adapter convention
 * in this repository. `metadata` (below) must never be used to smuggle a
 * credential into a normalized artifact.
 *
 * SCHEMA VALIDITY IS NOT SEMANTIC QUALITY: this validator only checks
 * structure. "The app should be fast." is a structurally valid
 * RequirementArtifact even though it is not measurably testable -
 * determining AMBIGUOUS/NOT_MEASURABLE/etc. is a future RTI-3 concern
 * (requirement quality/testability analysis), never conflated with
 * structural validity here.
 *
 * HARDENING TIER (RTI-1 corrective; originally two-tier, now uniform):
 * every structural object in this contract - the outer artifact, its
 * `source` sub-object, and each `acceptanceCriteria[]`/`relationships[]`
 * entry - receives the identical full FPI-1-corrective hardening already
 * established by scripts/ai/framework-runtime-config.js and
 * scripts/ai/project-knowledge-config.js: isPlainDataObject() (rejects
 * custom prototypes/class instances, not just non-objects) and
 * getOwnEnumerableDataProperty() for every field read (never an
 * inherited, non-enumerable, or accessor-backed value; an accessor's
 * getter is never invoked during validation - Object.getOwnPropertyDescriptor()
 * cannot trigger one). The original design deliberately applied a
 * lighter, scripts/ai/knowledge/schema.js-precedented tier
 * (isPlainObject() + direct field access) to array-element entries only,
 * reasoning they were "read-once structural leaves." Independent
 * architecture review empirically disproved that reasoning: a throwing
 * accessor on a relationships[] entry escaped
 * validateRequirementArtifact() as an uncaught exception (breaking this
 * module's own "never throws" contract), and inherited/non-enumerable/
 * class-instance entries were all silently accepted where the outer
 * object correctly rejects the identical shapes. The corrective closed
 * that gap by reusing the exact same primitives everywhere, rather than
 * introducing a second, separately-maintained hardening implementation -
 * see requirement-artifact.test.js's own "RTI1-R-*" test block for the
 * permanent regression coverage.
 *
 * IMMUTABILITY CONVENTION: this module never mutates its input and always
 * returns the exact same object reference on success (see
 * assertValidRequirementArtifact() below) - matching every other
 * assertValidXxx() in this directory. Freezing a constructed artifact is
 * the CALLER's convention (see e.g. scripts/ai/project-profile.js's own
 * Object.freeze() usage on concrete instances), not enforced here; no
 * future Test Design stage may mutate an artifact after validation -
 * derived analysis (e.g. a future RTI-3 testability verdict) must be
 * modeled as a SEPARATE object, never written onto the original.
 *
 * DELIBERATELY DEFERRED (not this module's job, see the RTI roadmap in
 * README.md): a collection-level validator (duplicate-id detection,
 * relationship-target resolution across a whole set) and a containing
 * `RequirementSet` aggregate are both deferred to RTI-2, once a real
 * ingestion adapter exists to prove the actual shape needed - building
 * either speculatively now, with no real caller, would repeat the exact
 * premature-abstraction mistake this repository's own established
 * convention (see e.g. knowledge/schema.js's own docstring) explicitly
 * warns against. A single artifact's own `relationships[].targetId`
 * values are therefore validated only for shape (a safe, non-empty,
 * bounded string) here, never resolved or existence-checked - that is
 * exactly the future collection-level job.
 *
 * Pure, synchronous, offline: no filesystem access, no environment
 * variables, no network, and (matching this repository's existing
 * zero-runtime-dependency posture) no schema-validation library - plain
 * JavaScript checks, a flat errors array, and a { valid, errors } return
 * shape identical to every other validator in this directory.
 */

"use strict";

const MAX_STRING_LENGTH = 200;
const MAX_CONTENT_LENGTH = 20000;
const MAX_UNKNOWN_KEY_DISPLAY_LENGTH = 80;
const MAX_REPORTED_UNKNOWN_KEYS = 8;
const MAX_VALIDATION_DETAIL_LENGTH = 1024;
const MAX_ARRAY_LENGTH = 200;

// Roadmap RTI-1: intentionally minimal, matching the candidate vocabulary
// evaluated during design - see this module's own docstring. Extensible
// only by adding a new literal here (a deliberate, reviewed change), never
// by accepting an arbitrary caller-supplied string - an unrecognized type
// must fail closed, not silently pass through as free text.
const ARTIFACT_TYPES = Object.freeze([
  "requirement",
  "user-story",
  "acceptance-criteria",
  "business-rule",
  "non-functional-requirement",
  "api-contract",
  "bug",
  "risk",
  "existing-test",
  "other",
]);

// Roadmap RTI-1: source-agnostic relationship vocabulary - never a
// any external issue tracker's own specific link-type name. See this module's own
// docstring for why targetId is validated only for shape, never resolved,
// here.
const RELATIONSHIP_TYPES = Object.freeze([
  "parent",
  "dependency",
  "duplicate",
  "blocks",
  "blocked-by",
  "implements",
  "refines",
  "contradicts",
  "related",
]);

const ARTIFACT_ALLOWED_KEYS = Object.freeze([
  "id",
  "type",
  "title",
  "content",
  "acceptanceCriteria",
  "priority",
  "labels",
  "relationships",
  "source",
  "contentHash",
  "metadata",
]);

const SOURCE_ALLOWED_KEYS = Object.freeze(["type", "sourceId", "location", "system", "version"]);

const ACCEPTANCE_CRITERION_ALLOWED_KEYS = Object.freeze(["id", "text"]);

const RELATIONSHIP_ALLOWED_KEYS = Object.freeze(["type", "targetId"]);

// --- Shared primitives (deliberately duplicated, not imported, matching
// this repository's existing "small duplicated primitives over premature
// shared abstraction" convention - see e.g.
// scripts/ai/project-knowledge-config.js's own identical copies) ---------

function isPlainDataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoundedString(value, maxLength) {
  return isNonEmptyString(value) && value.length <= maxLength;
}

function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isSafeBoundedString(value, maxLength) {
  return isBoundedString(value, maxLength) && !hasControlChar(value);
}

function isUniqueSafeStringArray(value, maxLength, maxItems) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) return false;
  if (!value.every((v) => isSafeBoundedString(v, maxLength))) return false;
  return new Set(value).size === value.length;
}

// Roadmap FPI-1-style hardening (matching
// scripts/ai/framework-runtime-config.js's/project-knowledge-config.js's
// own getOwnEnumerableDataProperty() exactly): Object.getOwnPropertyDescriptor()
// never invokes a getter, so this is always safe to call, even on a
// hostile accessor. Only a `valid` result's `.value` (the descriptor's own
// captured value) may ever be read.
function getOwnEnumerableDataProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) {
    return { present: false, valid: false, value: undefined };
  }
  const isDataDescriptor = Object.prototype.hasOwnProperty.call(descriptor, "value");
  if (!descriptor.enumerable || !isDataDescriptor) {
    return { present: true, valid: false, value: undefined };
  }
  return { present: true, valid: true, value: descriptor.value };
}

function safeKeyDisplay(key) {
  let display = "";
  const limit = Math.min(key.length, MAX_UNKNOWN_KEY_DISPLAY_LENGTH);
  for (let i = 0; i < limit; i++) {
    const code = key.charCodeAt(i);
    display += code < 32 || code === 127 ? "?" : key[i];
  }
  if (key.length > MAX_UNKNOWN_KEY_DISPLAY_LENGTH) display += "...";
  return display;
}

function pushUnknownKeyErrors(object, allowedKeys, errors, describe) {
  const unknown = Object.keys(object).filter((key) => !allowedKeys.includes(key));
  const shown = unknown.slice(0, MAX_REPORTED_UNKNOWN_KEYS);
  for (const key of shown) {
    errors.push(describe(safeKeyDisplay(key)));
  }
  const omitted = unknown.length - shown.length;
  if (omitted > 0) {
    errors.push(`${omitted} additional unknown key(s) omitted`);
  }
}

function boundedDetail(errors) {
  const joined = errors.join("; ");
  if (joined.length <= MAX_VALIDATION_DETAIL_LENGTH) return joined;
  return `${joined.slice(0, MAX_VALIDATION_DETAIL_LENGTH)}...`;
}

// Bounded-depth, JSON-safety check for the open `metadata` bag: rejects
// functions/symbols (never executable values) and caps recursion so a
// pathological caller-supplied object cannot force unbounded work -
// deliberately not a full schema (see this module's own docstring on
// "avoid speculative complexity"), just a data-only/JSON-safe gate.
const MAX_METADATA_DEPTH = 5;

function isJsonSafeValue(value, depth) {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t === "function" || t === "symbol" || t === "undefined" || t === "bigint") return false;
  if (depth >= MAX_METADATA_DEPTH) return false;
  if (Array.isArray(value)) {
    return value.length <= MAX_ARRAY_LENGTH && value.every((v) => isJsonSafeValue(v, depth + 1));
  }
  if (isPlainDataObject(value)) {
    return Object.keys(value).every((k) => isJsonSafeValue(value[k], depth + 1));
  }
  return false;
}

// --- Nested-shape validators ---------------------------------------------

function validateSource(source, errors, path) {
  if (!isPlainDataObject(source)) {
    errors.push(`${path}.source: must be a plain object`);
    return;
  }
  pushUnknownKeyErrors(source, SOURCE_ALLOWED_KEYS, errors, (key) => `${path}.source.${key}: unknown key is not permitted`);

  const typeField = getOwnEnumerableDataProperty(source, "type");
  if (!typeField.valid || !isSafeBoundedString(typeField.value, MAX_STRING_LENGTH)) {
    errors.push(`${path}.source.type: must be a non-empty, bounded own enumerable data string property`);
  }

  for (const optionalField of ["sourceId", "location", "system", "version"]) {
    const field = getOwnEnumerableDataProperty(source, optionalField);
    if (field.present) {
      if (!field.valid) {
        errors.push(`${path}.source.${optionalField}: must be an own enumerable data property when supplied`);
      } else if (field.value !== undefined && !isSafeBoundedString(field.value, MAX_STRING_LENGTH)) {
        errors.push(`${path}.source.${optionalField}: must be a non-empty, bounded string when supplied`);
      }
    }
  }
}

// Roadmap RTI-1 corrective (RTI1-R-1/R-5/R-6, independent-review finding):
// entry objects now receive the exact same hardening tier as the outer
// artifact and `source` - isPlainDataObject() (rejects custom prototypes/
// class instances, matching the outer object's own rejection exactly) and
// getOwnEnumerableDataProperty() for every field read (an inherited,
// non-enumerable, or accessor-backed value is never trusted, and an
// accessor's getter is NEVER invoked - Object.getOwnPropertyDescriptor()
// cannot trigger one). The original lighter isPlainObject()/direct-
// property-access tier was empirically proven insufficient by independent
// review: a throwing accessor on a relationships[] entry escaped
// validateRequirementArtifact() as an uncaught exception, breaking this
// module's own "never throws" contract, and inherited/non-enumerable/
// class-instance entries were all silently accepted. See
// requirement-artifact.test.js's own "RTI1-R-*" test block for the
// permanent regression coverage this closes.
function validateAcceptanceCriteria(list, errors, path) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_ARRAY_LENGTH) {
    errors.push(`${path}.acceptanceCriteria: must be a non-empty array (max ${MAX_ARRAY_LENGTH} entries) when supplied`);
    return;
  }
  list.forEach((entry, index) => {
    const entryPath = `${path}.acceptanceCriteria[${index}]`;
    if (!isPlainDataObject(entry)) {
      errors.push(`${entryPath}: must be a plain object`);
      return;
    }
    pushUnknownKeyErrors(entry, ACCEPTANCE_CRITERION_ALLOWED_KEYS, errors, (key) => `${entryPath}.${key}: unknown key is not permitted`);

    const textField = getOwnEnumerableDataProperty(entry, "text");
    if (!textField.valid || !isSafeBoundedString(textField.value, MAX_CONTENT_LENGTH)) {
      errors.push(`${entryPath}.text: must be a non-empty, bounded own enumerable data string property`);
    }

    const idField = getOwnEnumerableDataProperty(entry, "id");
    if (idField.present) {
      if (!idField.valid) {
        errors.push(`${entryPath}.id: must be an own enumerable data property when supplied`);
      } else if (idField.value !== undefined && !isSafeBoundedString(idField.value, MAX_STRING_LENGTH)) {
        errors.push(`${entryPath}.id: must be a non-empty, bounded string when supplied`);
      }
    }
  });
}

function validateRelationships(list, errors, path) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_ARRAY_LENGTH) {
    errors.push(`${path}.relationships: must be a non-empty array (max ${MAX_ARRAY_LENGTH} entries) when supplied`);
    return;
  }
  list.forEach((entry, index) => {
    const entryPath = `${path}.relationships[${index}]`;
    if (!isPlainDataObject(entry)) {
      errors.push(`${entryPath}: must be a plain object`);
      return;
    }
    pushUnknownKeyErrors(entry, RELATIONSHIP_ALLOWED_KEYS, errors, (key) => `${entryPath}.${key}: unknown key is not permitted`);

    const typeField = getOwnEnumerableDataProperty(entry, "type");
    if (!typeField.valid || !RELATIONSHIP_TYPES.includes(typeField.value)) {
      errors.push(`${entryPath}.type: must be one of ${RELATIONSHIP_TYPES.join(", ")}`);
    }

    // targetId is validated only for shape (safe, non-empty, bounded string)
    // - never resolved/existence-checked here; see this module's own
    // docstring on why relationship-target resolution is a deferred,
    // future collection-level (RTI-2+) concern.
    const targetIdField = getOwnEnumerableDataProperty(entry, "targetId");
    if (!targetIdField.valid || !isSafeBoundedString(targetIdField.value, MAX_STRING_LENGTH)) {
      errors.push(`${entryPath}.targetId: must be a non-empty, bounded own enumerable data string property`);
    }
  });
}

// --- Top-level validator --------------------------------------------------

function validateRequirementArtifact(artifact) {
  const errors = [];
  const path = "artifact";

  if (!isPlainDataObject(artifact)) {
    return { valid: false, errors: [`${path} must be a plain, JSON-like object`] };
  }

  pushUnknownKeyErrors(artifact, ARTIFACT_ALLOWED_KEYS, errors, (key) => `unknown key "${key}" is not permitted`);

  const idField = getOwnEnumerableDataProperty(artifact, "id");
  if (!idField.valid || !isSafeBoundedString(idField.value, MAX_STRING_LENGTH)) {
    errors.push(`${path}.id: must be a non-empty, bounded own enumerable data string property`);
  }

  const typeField = getOwnEnumerableDataProperty(artifact, "type");
  if (!typeField.valid || !ARTIFACT_TYPES.includes(typeField.value)) {
    errors.push(`${path}.type: must be one of ${ARTIFACT_TYPES.join(", ")}`);
  }

  const titleField = getOwnEnumerableDataProperty(artifact, "title");
  if (!titleField.valid || !isSafeBoundedString(titleField.value, MAX_STRING_LENGTH)) {
    errors.push(`${path}.title: must be a non-empty, bounded own enumerable data string property`);
  }

  // At least one meaningful body is required: content, or a non-empty
  // acceptanceCriteria array. Deliberately not a fixed-per-type rule (see
  // this module's own docstring) - a simple, deterministic invariant, not
  // a semantic-quality judgment (RTI-3's job, not this module's).
  const contentField = getOwnEnumerableDataProperty(artifact, "content");
  let hasValidContent = false;
  if (contentField.present) {
    if (!contentField.valid) {
      errors.push(`${path}.content: must be an own enumerable data property when supplied`);
    } else if (contentField.value !== undefined) {
      hasValidContent = isSafeBoundedString(contentField.value, MAX_CONTENT_LENGTH);
      if (!hasValidContent) {
        errors.push(`${path}.content: must be a non-empty, bounded string when supplied`);
      }
    }
  }

  const acField = getOwnEnumerableDataProperty(artifact, "acceptanceCriteria");
  let hasValidAcceptanceCriteria = false;
  if (acField.present) {
    if (!acField.valid) {
      errors.push(`${path}.acceptanceCriteria: must be an own enumerable data property when supplied`);
    } else if (acField.value !== undefined) {
      const acErrorsBefore = errors.length;
      validateAcceptanceCriteria(acField.value, errors, path);
      hasValidAcceptanceCriteria = errors.length === acErrorsBefore;
    }
  }

  if (!hasValidContent && !hasValidAcceptanceCriteria) {
    errors.push(`${path}: at least one of content (non-empty string) or acceptanceCriteria (non-empty array) is required`);
  }

  const priorityField = getOwnEnumerableDataProperty(artifact, "priority");
  if (priorityField.present) {
    if (!priorityField.valid) {
      errors.push(`${path}.priority: must be an own enumerable data property when supplied`);
    } else if (priorityField.value !== undefined && !isSafeBoundedString(priorityField.value, MAX_STRING_LENGTH)) {
      errors.push(`${path}.priority: must be a non-empty, bounded string when supplied`);
    }
  }

  const labelsField = getOwnEnumerableDataProperty(artifact, "labels");
  if (labelsField.present) {
    if (!labelsField.valid) {
      errors.push(`${path}.labels: must be an own enumerable data property when supplied`);
    } else if (labelsField.value !== undefined && !isUniqueSafeStringArray(labelsField.value, MAX_STRING_LENGTH, MAX_ARRAY_LENGTH)) {
      errors.push(`${path}.labels: must be a non-empty array of unique, non-empty, bounded strings when supplied`);
    }
  }

  const relationshipsField = getOwnEnumerableDataProperty(artifact, "relationships");
  if (relationshipsField.present) {
    if (!relationshipsField.valid) {
      errors.push(`${path}.relationships: must be an own enumerable data property when supplied`);
    } else if (relationshipsField.value !== undefined) {
      validateRelationships(relationshipsField.value, errors, path);
    }
  }

  // source is REQUIRED - see this module's own docstring: traceability
  // back to origin is a non-negotiable part of this contract, not optional
  // metadata.
  const sourceField = getOwnEnumerableDataProperty(artifact, "source");
  if (!sourceField.valid) {
    errors.push(`${path}.source: must be present as an own enumerable data property`);
  } else {
    validateSource(sourceField.value, errors, path);
  }

  const contentHashField = getOwnEnumerableDataProperty(artifact, "contentHash");
  if (contentHashField.present) {
    if (!contentHashField.valid) {
      errors.push(`${path}.contentHash: must be an own enumerable data property when supplied`);
    } else if (contentHashField.value !== undefined && !isSafeBoundedString(contentHashField.value, MAX_STRING_LENGTH)) {
      errors.push(`${path}.contentHash: must be a non-empty, bounded string when supplied`);
    }
  }

  const metadataField = getOwnEnumerableDataProperty(artifact, "metadata");
  if (metadataField.present) {
    if (!metadataField.valid) {
      errors.push(`${path}.metadata: must be an own enumerable data property when supplied`);
    } else if (metadataField.value !== undefined) {
      if (!isPlainDataObject(metadataField.value)) {
        errors.push(`${path}.metadata: must be a plain, JSON-like object when supplied`);
      } else if (!isJsonSafeValue(metadataField.value, 0)) {
        errors.push(`${path}.metadata: must be JSON-safe data only (no functions, no circular/overly-deep structure)`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// Shared fail-closed helper, matching every other assertValidXxx() in this
// directory exactly (scripts/ai/project-profile.js,
// scripts/ai/framework-runtime-config.js,
// scripts/ai/project-knowledge-config.js, scripts/ai/repository-root.js).
function assertValidRequirementArtifact(artifact, callerLabel) {
  if (artifact === undefined || artifact === null) {
    throw new Error(`REQUIREMENT_ARTIFACT_REQUIRED: ${callerLabel} requires an explicit RequirementArtifact; none was supplied.`);
  }
  const { valid, errors } = validateRequirementArtifact(artifact);
  if (!valid) {
    throw new Error(`REQUIREMENT_ARTIFACT_INVALID: ${callerLabel} received an invalid RequirementArtifact (${boundedDetail(errors)}).`);
  }
  return artifact;
}

module.exports = {
  validateRequirementArtifact,
  assertValidRequirementArtifact,
  ARTIFACT_TYPES,
  RELATIONSHIP_TYPES,
};
