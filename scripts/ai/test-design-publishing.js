"use strict";

/**
 * Generic Test-Design Publishing Core (Roadmap RTI-8B) - the vendor-neutral
 * boundary through which caller-supplied TestDesignArtifact[] (RTI-4) are
 * handed to an explicitly caller-supplied TestDesignDestination for
 * publication to an external test-management/tracking system, without
 * leaking vendor semantics into this generic layer. Architecture approved
 * by RTI-8A; this module implements exactly that approved contract - it
 * does not redesign it.
 *
 * CONCEPTUAL PIPELINE:
 *
 *   TestDesignArtifact[]   (RTI-4 output, or any caller-constructed
 *           |               structurally-valid equivalent)
 *           v
 *   TestDesignPublishRequest   (this module - shape/batch-size/duplicate
 *           |                    validation, ALL before any side effect)
 *           v
 *   TestDesignDestination.publish()   (caller-constructed, trusted
 *           |                          executable code - the ONE real
 *           |                          side-effecting call this module
 *           |                          ever makes)
 *           v
 *   TestDesignPublishResult   (untrusted DATA returned by the destination -
 *                               validated, re-projected into input order,
 *                               frozen, and returned to the caller)
 *
 * DESTINATION CONTRACT (documentation + tests are the contract, exactly
 * mirroring RTI-6's own convention):
 *
 *   interface TestDesignDestination {
 *     readonly id: string;
 *     publish(request: TestDesignPublishRequest):
 *       Promise<TestDesignPublishResult> | TestDesignPublishResult;
 *   }
 *
 * TWO DISTINCT TRUST BOUNDARIES (identical framing to RTI-6's own):
 *
 *   Boundary A - the destination IMPLEMENTATION is TRUSTED, caller-supplied
 *     executable code. `destination.id`/`destination.publish` are read via
 *     ORDINARY property access (a legitimate class-instance destination's
 *     `id` may be a prototype getter, and invoking it is expected/safe for
 *     trusted code about to have `.publish()` called on it anyway).
 *
 *   Boundary B - `destination.publish()`'s RETURN VALUE is UNTRUSTED DATA.
 *     Every field is validated: plain-object shape, allowed keys only,
 *     `destinationId` equality, exactly one result item per input
 *     `TestDesignArtifact.id` (no unknown id, no duplicate, no missing),
 *     and a strict `CREATED`/`FAILED` status vocabulary with status-specific
 *     required/forbidden fields. The destination's own result item ORDER is
 *     never trusted - this module re-projects `items[]` into the request's
 *     own `testDesigns[]` input order before returning.
 *
 * CREATE_ONLY (RTI-8A decision, not re-litigated here): the only two
 * possible item statuses are `CREATED` and `FAILED`. No `UPDATED`,
 * `SKIPPED`, or upsert semantics exist in this contract - `criterionIndex`
 * (RTI-4/RTI-5) is snapshot-scoped, non-durable identity, so there is no
 * stable way today to recognize "the same logical test as last time,"
 * which any update/upsert model would require.
 *
 * PRE-SIDE-EFFECT VALIDATION IS THE ONE HARD GUARANTEE THIS MODULE MAKES:
 * destination shape, request shape, batch-size bound, every
 * `TestDesignArtifact` (via RTI-4's own `assertValidTestDesignArtifact`),
 * and duplicate-id rejection ALL complete - with zero calls to
 * `destination.publish()` - before that call happens at all. Once
 * `destination.publish()` is actually invoked, this module makes NO further
 * atomicity promise: an external SaaS write is not generally transactional,
 * and this module has no way to undo a side effect that already occurred.
 *
 * BEST-EFFORT PARTIAL FAILURE, NEVER FALSE TRANSACTIONALITY: a structurally
 * valid result with some `CREATED` and some `FAILED` items is a NORMAL
 * return value, not a thrown error - `publishTestDesigns` only throws for
 * (a) pre-side-effect validation failure (nothing was attempted), (b) the
 * destination's `publish()` itself throwing/rejecting entirely (wrapped,
 * original value preserved verbatim in `.cause`), or (c) the destination's
 * returned result being structurally invalid (Boundary B) - and in that
 * last case, the thrown error explicitly does NOT claim rollback or
 * atomicity, because external side effects may already have occurred by
 * the time an invalid result is detected.
 *
 * NO RETRY, NO REGISTRY, NO NETWORK, NO CREDENTIALS: `destination.publish()`
 * is invoked exactly once per `publishTestDesigns()` call - retrying a
 * non-idempotent write risks duplicate remote creation, and RTI-7G's own
 * rejection of a generic retry helper is extended here to writes. There is
 * no destination registry, no vendor-name dispatch, no factory - callers
 * explicitly construct/import whatever concrete destination they want. This
 * module performs zero network I/O, filesystem I/O, or credential handling
 * of its own; all of that, if any, lives entirely inside the caller-supplied
 * destination's own `publish()` implementation.
 *
 * NO TRACEABILITY, NO PUBLICATION RECORD, NO IDEMPOTENCY KEY IN V1: all
 * deliberately deferred per RTI-8A, pending concrete evidence of need - see
 * PROVIDERS.md-equivalent RTI-8 debt table once it exists. `publish()`'s
 * result is ephemeral, caller-visible output; this module owns no
 * persistence.
 *
 * NOT RESPONSIBLE FOR (entirely destination-owned): vendor request-payload
 * construction, vendor auth, vendor rate-limiting/retry/idempotency
 * semantics, remote reconciliation, logging.
 */

const { assertValidTestDesignArtifact } = require("./test-design");

const MAX_VALIDATION_DETAIL_LENGTH = 1024;
const MAX_REPORTED_ERRORS = 20;
const MAX_STRING_LENGTH = 200; // destination.id, remoteId, error.code
const MAX_ID_LENGTH = 256; // testDesignId - mirrors TestDesignArtifact.id's own bound (test-design.js)
const MAX_ERROR_MESSAGE_LENGTH = 2000;
const MAX_LOCATION_LENGTH = 2000;

// A defense-in-depth ceiling against accidental mass publication - not a
// vendor API limit (destinations own their own vendor-specific batching).
// 500 is deliberately below RTI-7's read-side default maxItems (1000):
// writes carry materially higher cost/risk than reads, so a more
// conservative generic ceiling is warranted, while still comfortably
// exceeding a realistic single-call generated-suite size (RTI-1's own
// acceptanceCriteria array cap is 200 per requirement).
const MAX_PUBLISH_BATCH_SIZE = 500;

const PUBLISH_REQUEST_ALLOWED_KEYS = Object.freeze(["testDesigns"]);
const RESULT_ALLOWED_KEYS = Object.freeze(["destinationId", "allSucceeded", "items"]);
const ITEM_ALLOWED_KEYS = Object.freeze(["testDesignId", "status", "remoteId", "location", "error"]);
const ERROR_ALLOWED_KEYS = Object.freeze(["code", "message"]);
const VALID_STATUSES = Object.freeze(["CREATED", "FAILED"]);

// --- Shared primitives (deliberately duplicated, not imported - matching
// this repository's own established "small duplicated primitives over
// premature shared abstraction" convention) ------------------------------

function isPlainDataObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasControlChar(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function isSafeBoundedString(value, maxLength) {
  return isNonEmptyString(value) && value.length <= maxLength && !hasControlChar(value);
}

function boundedDetail(errors) {
  const shown = errors.slice(0, MAX_REPORTED_ERRORS);
  const omitted = errors.length - shown.length;
  const joined = shown.join("; ") + (omitted > 0 ? `; ${omitted} additional error(s) omitted` : "");
  return joined.length <= MAX_VALIDATION_DETAIL_LENGTH ? joined : `${joined.slice(0, MAX_VALIDATION_DETAIL_LENGTH)}...`;
}

// Object.getOwnPropertyDescriptor() never invokes a getter - matching
// requirement-artifact.js's/test-design.js's own getOwnEnumerableDataProperty()
// exactly. Used throughout Boundary B (the destination's returned result) so
// a hostile accessor on untrusted result data is never invoked.
function getOwnEnumerableDataProperty(object, key) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return { present: false, valid: false, value: undefined };
  const isDataDescriptor = Object.prototype.hasOwnProperty.call(descriptor, "value");
  if (!descriptor.enumerable || !isDataDescriptor) return { present: true, valid: false, value: undefined };
  return { present: true, valid: true, value: descriptor.value };
}

// Boundary A - destination SHAPE validation only (trusted executable code,
// exactly mirroring requirements-source-provider.js's own
// assertValidProviderShape): ordinary property access, deliberately NOT
// own-enumerable-data-property-only hardening, because a legitimate
// class-instance destination's `id` may be a prototype getter and invoking
// it is expected, safe behavior for trusted code we are about to call
// `.publish()` on anyway.
function assertValidDestinationShape(destination, callerLabel) {
  if (destination === undefined || destination === null) {
    throw new Error(`TEST_DESIGN_DESTINATION_REQUIRED: ${callerLabel} requires an explicit TestDesignDestination; none was supplied.`);
  }
  const destinationType = typeof destination;
  if (destinationType !== "object" && destinationType !== "function") {
    throw new Error(`TEST_DESIGN_DESTINATION_INVALID: ${callerLabel} received a destination that is not an object or function.`);
  }
  if (!isSafeBoundedString(destination.id, MAX_STRING_LENGTH)) {
    throw new Error(`TEST_DESIGN_DESTINATION_INVALID: ${callerLabel} received a destination with an invalid "id" (must be a non-empty, bounded, control-character-free string).`);
  }
  if (typeof destination.publish !== "function") {
    throw new Error(`TEST_DESIGN_DESTINATION_INVALID: ${callerLabel} received a destination whose "publish" is not a function (destination id "${destination.id}").`);
  }
}

// Request wrapper/array-level checks are ordinary (the wrapper itself is
// caller-constructed, not hostile external data); every individual
// TestDesignArtifact entry gets the full own-enumerable-data-property
// hardening via assertValidTestDesignArtifact - the same split RTI-4/RTI-5
// already use between their own outer-collection and inner-entry checks.
function assertValidPublishRequest(request, callerLabel) {
  if (request === undefined || request === null) {
    throw new Error(`TEST_DESIGN_PUBLISH_REQUEST_REQUIRED: ${callerLabel} requires an explicit TestDesignPublishRequest; none was supplied.`);
  }
  if (!isPlainDataObject(request)) {
    throw new Error(`TEST_DESIGN_PUBLISH_REQUEST_INVALID: ${callerLabel} received a request that is not a plain object.`);
  }
  const unknownKeys = Object.keys(request).filter((key) => !PUBLISH_REQUEST_ALLOWED_KEYS.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`TEST_DESIGN_PUBLISH_REQUEST_INVALID: ${callerLabel} received a request with unrecognized key(s): ${unknownKeys.join(", ")}.`);
  }

  const testDesigns = request.testDesigns;
  if (!Array.isArray(testDesigns) || testDesigns.length === 0) {
    throw new Error(`TEST_DESIGN_PUBLISH_REQUEST_INVALID: ${callerLabel} requires request.testDesigns to be a non-empty array.`);
  }
  if (testDesigns.length > MAX_PUBLISH_BATCH_SIZE) {
    throw new Error(
      `TEST_DESIGN_PUBLISH_REQUEST_INVALID: ${callerLabel} received ${testDesigns.length} testDesigns, exceeding the maximum publish batch size of ${MAX_PUBLISH_BATCH_SIZE}.`
    );
  }

  const shapeErrors = [];
  testDesigns.forEach((artifact, index) => {
    try {
      assertValidTestDesignArtifact(artifact, callerLabel);
    } catch (err) {
      shapeErrors.push(`testDesigns[${index}]: ${err.message}`);
    }
  });
  if (shapeErrors.length > 0) {
    throw new Error(`TEST_DESIGN_PUBLISH_REQUEST_INVALID: ${callerLabel} received invalid TestDesignArtifact record(s) (${boundedDetail(shapeErrors)}).`);
  }

  const collectionErrors = [];
  const seenIds = new Map();
  testDesigns.forEach((artifact, index) => {
    if (seenIds.has(artifact.id)) {
      collectionErrors.push(`testDesigns[${index}].id "${artifact.id}" duplicates testDesigns[${seenIds.get(artifact.id)}].id`);
    } else {
      seenIds.set(artifact.id, index);
    }
  });
  if (collectionErrors.length > 0) {
    throw new Error(`TEST_DESIGN_PUBLISH_REQUEST_INVALID: ${callerLabel} received a request with duplicate testDesign id(s) (${boundedDetail(collectionErrors)}).`);
  }
}

// Boundary B - the destination's returned result is UNTRUSTED DATA.
// Validates structure/correspondence/status-specific field rules, then
// re-projects `items[]` into `testDesigns` input order (never trusting the
// destination's own returned order) and returns a frozen canonical result.
function validatePublishResult(rawResult, destination, testDesigns) {
  const errors = [];

  if (!isPlainDataObject(rawResult)) {
    return { valid: false, errors: ["result must be a plain object"] };
  }

  const unknownTopKeys = Object.keys(rawResult).filter((key) => !RESULT_ALLOWED_KEYS.includes(key));
  if (unknownTopKeys.length > 0) {
    errors.push(`result has unrecognized key(s): ${unknownTopKeys.join(", ")}`);
  }

  const destinationIdField = getOwnEnumerableDataProperty(rawResult, "destinationId");
  if (!destinationIdField.valid || destinationIdField.value !== destination.id) {
    errors.push(`result.destinationId must equal destination.id ("${destination.id}")`);
  }

  const allSucceededField = getOwnEnumerableDataProperty(rawResult, "allSucceeded");
  if (!allSucceededField.valid || typeof allSucceededField.value !== "boolean") {
    errors.push("result.allSucceeded must be a boolean");
  }

  const itemsField = getOwnEnumerableDataProperty(rawResult, "items");
  if (!itemsField.valid || !Array.isArray(itemsField.value)) {
    errors.push("result.items must be an array");
    return { valid: false, errors };
  }
  const rawItems = itemsField.value;
  if (rawItems.length !== testDesigns.length) {
    errors.push(`result.items must contain exactly one entry per input testDesign (expected ${testDesigns.length}, got ${rawItems.length})`);
  }

  const knownIds = new Set(testDesigns.map((td) => td.id));
  const seenIds = new Set();
  const byId = new Map();

  rawItems.forEach((item, index) => {
    const itemPath = `result.items[${index}]`;
    if (!isPlainDataObject(item)) {
      errors.push(`${itemPath}: must be a plain object`);
      return;
    }
    const unknownItemKeys = Object.keys(item).filter((key) => !ITEM_ALLOWED_KEYS.includes(key));
    if (unknownItemKeys.length > 0) {
      errors.push(`${itemPath}: unrecognized key(s): ${unknownItemKeys.join(", ")}`);
    }

    const testDesignIdField = getOwnEnumerableDataProperty(item, "testDesignId");
    const testDesignId = testDesignIdField.value;
    let idIsUsable = false;
    if (!testDesignIdField.valid || !isSafeBoundedString(testDesignId, MAX_ID_LENGTH)) {
      errors.push(`${itemPath}.testDesignId: must be a non-empty, bounded string`);
    } else if (!knownIds.has(testDesignId)) {
      errors.push(`${itemPath}.testDesignId "${testDesignId}" does not match any input testDesign id`);
    } else if (seenIds.has(testDesignId)) {
      errors.push(`${itemPath}.testDesignId "${testDesignId}" duplicates another result item`);
    } else {
      seenIds.add(testDesignId);
      idIsUsable = true;
    }

    const statusField = getOwnEnumerableDataProperty(item, "status");
    if (!statusField.valid || !VALID_STATUSES.includes(statusField.value)) {
      errors.push(`${itemPath}.status: must be exactly "CREATED" or "FAILED"`);
      return;
    }
    const status = statusField.value;

    const remoteIdField = getOwnEnumerableDataProperty(item, "remoteId");
    const locationField = getOwnEnumerableDataProperty(item, "location");
    const errorField = getOwnEnumerableDataProperty(item, "error");
    let capturedError; // only ever populated from own-enumerable-data-property reads, never re-read from the raw item later

    if (status === "CREATED") {
      if (!remoteIdField.valid || !isSafeBoundedString(remoteIdField.value, MAX_STRING_LENGTH)) {
        errors.push(`${itemPath}.remoteId: required non-empty, bounded string when status is CREATED`);
      }
      if (errorField.present) {
        errors.push(`${itemPath}.error: must be absent when status is CREATED`);
      }
      if (locationField.present && (!locationField.valid || !isSafeBoundedString(locationField.value, MAX_LOCATION_LENGTH))) {
        errors.push(`${itemPath}.location: must be a non-empty, bounded string when supplied`);
      }
    } else {
      if (remoteIdField.present) {
        errors.push(`${itemPath}.remoteId: must be absent when status is FAILED`);
      }
      if (locationField.present) {
        errors.push(`${itemPath}.location: must be absent when status is FAILED`);
      }
      if (!errorField.valid || !isPlainDataObject(errorField.value)) {
        errors.push(`${itemPath}.error: required plain object when status is FAILED`);
      } else {
        const errorValue = errorField.value;
        const unknownErrorKeys = Object.keys(errorValue).filter((key) => !ERROR_ALLOWED_KEYS.includes(key));
        if (unknownErrorKeys.length > 0) {
          errors.push(`${itemPath}.error: unrecognized key(s): ${unknownErrorKeys.join(", ")}`);
        }
        const codeField = getOwnEnumerableDataProperty(errorValue, "code");
        if (!codeField.valid || !isSafeBoundedString(codeField.value, MAX_STRING_LENGTH)) {
          errors.push(`${itemPath}.error.code: must be a non-empty, bounded string`);
        }
        const messageField = getOwnEnumerableDataProperty(errorValue, "message");
        if (!messageField.valid || !isSafeBoundedString(messageField.value, MAX_ERROR_MESSAGE_LENGTH)) {
          errors.push(`${itemPath}.error.message: must be a non-empty, bounded string`);
        }
        if (codeField.valid && messageField.valid) {
          capturedError = { code: codeField.value, message: messageField.value };
        }
      }
    }

    if (idIsUsable) {
      byId.set(testDesignId, {
        testDesignId,
        status,
        remoteId: remoteIdField.present ? remoteIdField.value : undefined,
        location: locationField.present ? locationField.value : undefined,
        error: capturedError,
      });
    }
  });

  const missingIds = [];
  testDesigns.forEach((td) => {
    if (!seenIds.has(td.id)) missingIds.push(td.id);
  });
  if (missingIds.length > 0) {
    const shown = missingIds.slice(0, 10);
    errors.push(`result is missing item(s) for testDesign id(s): ${shown.join(", ")}${missingIds.length > shown.length ? "; ..." : ""}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  const derivedAllSucceeded = testDesigns.every((td) => byId.get(td.id).status === "CREATED");
  if (allSucceededField.value !== derivedAllSucceeded) {
    return {
      valid: false,
      errors: [`result.allSucceeded (${rawResult.allSucceeded}) is inconsistent with item statuses (expected ${derivedAllSucceeded})`],
    };
  }

  const items = testDesigns.map((td) => {
    const item = byId.get(td.id);
    const frozenItem = { testDesignId: item.testDesignId, status: item.status };
    if (item.status === "CREATED") {
      frozenItem.remoteId = item.remoteId;
      if (item.location !== undefined) frozenItem.location = item.location;
    } else {
      frozenItem.error = Object.freeze({ code: item.error.code, message: item.error.message });
    }
    return Object.freeze(frozenItem);
  });

  return {
    valid: true,
    errors: [],
    normalized: Object.freeze({
      destinationId: destination.id,
      allSucceeded: derivedAllSucceeded,
      items: Object.freeze(items),
    }),
  };
}

/**
 * Publishes TestDesignArtifact[] to an explicitly caller-supplied
 * TestDesignDestination. See this module's own docstring for the full
 * destination contract, trust model, pre-side-effect validation guarantee,
 * and best-effort partial-failure semantics.
 *
 * @param {{id: string, publish: function}} destination a TestDesignDestination
 * @param {{testDesigns: object[]}} request a TestDesignPublishRequest
 * @returns {Promise<object>} a fresh, frozen TestDesignPublishResult -
 *   `{ destinationId, allSucceeded, items }`, `items` in `request.testDesigns`
 *   input order regardless of the order the destination returned
 * @throws {Error} TEST_DESIGN_DESTINATION_REQUIRED / TEST_DESIGN_DESTINATION_INVALID
 *   (destination shape) / TEST_DESIGN_PUBLISH_REQUEST_REQUIRED /
 *   TEST_DESIGN_PUBLISH_REQUEST_INVALID (request shape, batch-size bound,
 *   invalid TestDesignArtifact, or duplicate id - thrown with ZERO calls to
 *   destination.publish()) / TEST_DESIGN_PUBLISH_FAILED (destination.publish()
 *   itself threw/rejected; original value preserved unsanitized in `.cause`) /
 *   TEST_DESIGN_PUBLISH_RESULT_INVALID (destination's returned result is
 *   structurally invalid - external side effects may already have occurred
 *   and are NOT automatically reversed by this error)
 */
async function publishTestDesigns(destination, request) {
  assertValidDestinationShape(destination, "publishTestDesigns");
  assertValidPublishRequest(request, "publishTestDesigns");

  const testDesigns = request.testDesigns;
  const safeRequest = Object.freeze({ testDesigns: Object.freeze([...testDesigns]) });

  let rawResult;
  try {
    rawResult = await destination.publish(safeRequest);
  } catch (err) {
    throw new Error(`TEST_DESIGN_PUBLISH_FAILED: publishTestDesigns destination "${destination.id}" failed to publish test design(s).`, { cause: err });
  }

  const { valid, errors, normalized } = validatePublishResult(rawResult, destination, testDesigns);
  if (!valid) {
    throw new Error(
      `TEST_DESIGN_PUBLISH_RESULT_INVALID: publishTestDesigns destination "${destination.id}" returned an invalid publish result (${boundedDetail(
        errors
      )}). Note: any external side effects the destination already performed are not automatically reversed by this error.`
    );
  }

  return normalized;
}

module.exports = {
  publishTestDesigns,
};
