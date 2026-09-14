"use strict";

/**
 * Azure DevOps Test Case Destination (Roadmap RTI-8F) - the first concrete
 * `TestDesignDestination` (RTI-8B), implementing the already-approved
 * generic contract exactly. Publishes canonical `TestDesignArtifact[]`
 * (RTI-4) as Azure DevOps Test Case work items via the documented Work
 * Item Create REST API, independently verified against current Microsoft
 * Learn documentation during RTI-8E's own design phase.
 *
 * SOURCE/DESTINATION INDEPENDENCE: this is a wholly separate class from
 * `AzureDevOpsRequirementsProvider` (RTI-7F) - separate file, separate
 * package subpath (`destinations/` vs `providers/`), separate config
 * shape, no shared base class, no shared production transport helper
 * (RTI-8E/RTI-7G explicitly did not authorize extracting one - write
 * semantics, retry policy, and error taxonomy all differ materially from
 * the read side; see this module's own "NO RETRY" section below for why).
 *
 * NETWORK AUTHORITY - AZURE DEVOPS SERVICES ONLY: the request authority
 * (`https://dev.azure.com`) is constructed internally from validated
 * `organization`/`project` only - there is no caller-supplied `baseUrl`,
 * no endpoint discovery, and no Azure DevOps Server/TFS support (an
 * explicit, unchanged non-goal). This keeps the SSRF/network-authority
 * surface fixed and minimal.
 *
 * AUTH - CALLER-OWNED, NO ACQUISITION: `{type: "pat", token}` (`Basic
 * base64(":"+token)`) or `{type: "bearer", token}` (`Bearer <token>`,
 * compatible with a caller-acquired Microsoft Entra ID access token).
 * This module never reads `process.env`, never acquires/refreshes a
 * token, and never persists credentials anywhere outside the frozen
 * internal config built once at construction.
 *
 * CREATE_ONLY, SEQUENTIAL, NO RETRY: every `TestDesignArtifact` maps to
 * exactly one `POST` creating a new Test Case work item - never a search,
 * PATCH, upsert, or delete. Items are processed strictly one at a time, in
 * input order. `publish()` NEVER automatically retries a create request,
 * for any HTTP status or transport failure, even when Azure's own
 * `Retry-After` hint is present: creating a Test Case is not idempotent,
 * and replaying a request whose response was merely lost (not necessarily
 * failed) risks a duplicate remote work item. This is a deliberate,
 * documented limitation - a caller who retries a whole `publish()` call
 * assumes that duplication risk themselves.
 *
 * NO TCM STEPS, NO FABRICATED TEST PROCEDURE: `TestDesignArtifact` has no
 * grounded action/step model (`title`/`objective`/`expectedResults[]`
 * only) - `Microsoft.VSTS.TCM.Steps` (Azure's proprietary XML step field)
 * is deliberately never populated, because doing so would require
 * inventing an "action" description that does not exist in the canonical
 * input, violating the same no-fabrication invariant RTI-3/RTI-4 already
 * enforce upstream. `System.Title` + `System.Description` (independently
 * verified: `System.Title` is the only field Azure's own documented
 * sample requires) is a complete, non-fabricating v1 Test Case.
 *
 * CROSS-VENDOR PROVENANCE - `requirementId` IS OPAQUE: `artifact.
 * requirementId`/`source.requirementId`/`criterionId`/`criterionIndex`
 * are never parsed, never assumed numeric, never assumed Azure-native, and
 * never used to construct an Azure work-item relation. A Jira-sourced
 * `requirementId` (e.g. `"jira-prod:PROJ-123"`) must remain safely opaque
 * here so a future Jira-source -> Azure-destination pipeline (Roadmap
 * RTI-8J) stays possible without this destination ever having assumed
 * otherwise.
 *
 * GLOBAL SHORT-CIRCUIT, PER-ITEM BEST EFFORT: an ordinary per-item HTTP
 * failure (400/409, or an unexpected status) is reported as a `FAILED`
 * item and processing continues to the next artifact - the fault is
 * plausibly item-specific. A condition that is highly likely to recur
 * identically for every remaining item (401/403/404-target/429/a blocked
 * redirect/an ambiguous 5xx-or-transport failure) stops all further
 * network writes; every not-yet-attempted remaining item is reported
 * `FAILED` with `AZURE_TEST_CASE_NOT_ATTEMPTED` - explicitly distinct from
 * an item whose own create request genuinely failed, so a caller can never
 * mistake "never tried" for "tried and failed."
 *
 * AMBIGUOUS OUTCOME, NEVER A FALSE "NOTHING HAPPENED" CLAIM: a timeout, a
 * connection failure after the request was sent, a 5xx, or a malformed-
 * but-2xx response are all conditions where a remote Test Case MAY already
 * exist - every one of these error messages says so explicitly, and none
 * of them is retried and none implies rollback (this module has no way to
 * undo a side effect that may have already occurred).
 *
 * SECRET / CONTENT SAFETY: no error, log, or returned result field ever
 * contains the caller's PAT/Bearer token, the constructed `Authorization`
 * header, a raw Azure request/response body, or the canonical artifact's
 * own `title`/`objective`/`expectedResults` text - diagnostics are limited
 * to `testDesignId`, HTTP status, and a fixed, bounded message per error
 * code.
 *
 * INPUT IMMUTABILITY: `publish()` never mutates `request`, `request.
 * testDesigns`, or any artifact/`source`/`expectedResults` it reads (and
 * per RTI-8B-C1, the generic runner has already handed this destination
 * fresh, deeply frozen canonical copies before this module ever sees
 * them - mutation would fail even if attempted).
 */

const MAX_STRING_LENGTH = 200; // id, organization, project, auth.token error-message context
const MAX_TOKEN_LENGTH = 4096; // mirrors the existing Azure source provider's own bound
const MAX_AZURE_TITLE_LENGTH = 255; // independently verified Azure System.Title hard limit (TF401324 beyond this)
const MAX_LOCATION_LENGTH = 2000;
const DEFAULT_TIMEOUT_MS = 15000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 120000;
const API_VERSION = "7.1";
const AZURE_HOST = "dev.azure.com";

const CONFIG_ALLOWED_KEYS = Object.freeze(["id", "organization", "project", "auth", "timeoutMs"]);
const AUTH_ALLOWED_KEYS = Object.freeze(["type", "token"]);

const NOT_ATTEMPTED_MESSAGE = "Not attempted: an earlier create request in this batch encountered a condition affecting the whole batch.";

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

function isPositiveSafeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && Number.isSafeInteger(value) && value > 0;
}

// --- Config validation -------------------------------------------------

function validateId(id) {
  if (!isSafeBoundedString(id, MAX_STRING_LENGTH)) {
    throw new Error('AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "id" must be a non-empty, bounded, control-character-free string.');
  }
  return id;
}

// Mirrors the existing Azure requirements provider's own organization
// rules (bounded safe string, no path/scheme-injection characters) -
// reused as semantic precedent, not as shared code (write semantics and
// module ownership differ; see module docstring).
function validateOrganization(organization) {
  if (!isSafeBoundedString(organization, MAX_STRING_LENGTH)) {
    throw new Error('AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "organization" must be a non-empty, bounded, control-character-free string.');
  }
  if (/[/\\?#@]/.test(organization) || organization === "." || organization.includes("..") || organization.includes("://")) {
    throw new Error('AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "organization" must not contain "/", "\\", "?", "#", "@", ".", "..", or a URL scheme.');
  }
  return organization;
}

// Project display names may legitimately contain spaces/Unicode -
// deliberately not slug-restricted; percent-encoding at URL-construction
// time handles safety regardless of character set (same rationale as the
// existing Azure source provider's own project validation).
function validateProject(project) {
  if (!isSafeBoundedString(project, MAX_STRING_LENGTH)) {
    throw new Error('AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "project" must be a non-empty, bounded, control-character-free string.');
  }
  return project;
}

function validateAuth(auth) {
  if (!isPlainDataObject(auth)) {
    throw new Error('AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "auth" must be a plain object.');
  }
  if (auth.type !== "pat" && auth.type !== "bearer") {
    throw new Error('AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "auth.type" must be "pat" or "bearer".');
  }
  if (!isSafeBoundedString(auth.token, MAX_TOKEN_LENGTH)) {
    throw new Error('AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "auth.token" must be a non-empty, bounded, control-character-free string.');
  }
  const unknown = Object.keys(auth).filter((key) => !AUTH_ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "auth" has unrecognized key(s): ${unknown.join(", ")}.`);
  }
  return Object.freeze({ type: auth.type, token: auth.token });
}

function validateTimeoutMs(timeoutMs) {
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isInteger(timeoutMs) || timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: "timeoutMs" must be an integer between ${MIN_TIMEOUT_MS} and ${MAX_TIMEOUT_MS} when supplied.`);
  }
  return timeoutMs;
}

// Builds a fresh, frozen, data-only internal config - the caller's own
// config/auth object is never retained as runtime authority and is never
// mutated (every field is copied by value into a new object).
function assertValidDestinationConfig(config) {
  if (config === undefined || config === null) {
    throw new Error("AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: an explicit config object is required.");
  }
  if (!isPlainDataObject(config)) {
    throw new Error("AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: config must be a plain object.");
  }
  const unknown = Object.keys(config).filter((key) => !CONFIG_ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID: unrecognized config key(s): ${unknown.join(", ")}.`);
  }
  const id = validateId(config.id);
  const organization = validateOrganization(config.organization);
  const project = validateProject(config.project);
  const auth = validateAuth(config.auth);
  const timeoutMs = validateTimeoutMs(config.timeoutMs);
  return Object.freeze({ id, organization, project, auth, timeoutMs });
}

// --- HTML description mapping (no fabricated test procedure) -----------

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function buildDescriptionHtml(objective, expectedResults) {
  const items = expectedResults.map((result) => `<li>${escapeHtml(result)}</li>`).join("");
  return `<p><strong>Objective</strong></p><p>${escapeHtml(objective)}</p><p><strong>Expected results</strong></p><ol>${items}</ol>`;
}

function buildPatchOperations(artifact) {
  return [
    { op: "add", path: "/fields/System.Title", value: artifact.title },
    { op: "add", path: "/fields/System.Description", value: buildDescriptionHtml(artifact.objective, artifact.expectedResults) },
  ];
}

// --- Transport -----------------------------------------------------------

function buildCreateUrl(config) {
  const typeSegment = encodeURIComponent("Test Case");
  return `https://${AZURE_HOST}/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}/_apis/wit/workitems/$${typeSegment}?api-version=${API_VERSION}`;
}

function buildAuthHeader(auth) {
  if (auth.type === "pat") {
    return `Basic ${Buffer.from(`:${auth.token}`, "utf8").toString("base64")}`;
  }
  return `Bearer ${auth.token}`;
}

// Only a validated `https://dev.azure.com/...` link is ever surfaced -
// the vendor-returned URL is treated as display metadata only, never as
// new network authority, and is never trusted purely because the response
// otherwise looked successful.
function extractSafeLocation(parsedBody) {
  try {
    const href = parsedBody && parsedBody._links && parsedBody._links.html && parsedBody._links.html.href;
    if (typeof href !== "string" || href.length === 0 || href.length > MAX_LOCATION_LENGTH) return undefined;
    const url = new URL(href);
    if (url.protocol !== "https:" || url.hostname !== AZURE_HOST) return undefined;
    return href;
  } catch {
    return undefined;
  }
}

function failedItem(code, message, globalStop) {
  return { result: { status: "FAILED", error: { code, message } }, globalStop };
}

/**
 * Attempts one Test Case create for a single canonical TestDesignArtifact.
 * Never throws for an ordinary HTTP/transport failure - returns a
 * structured `{result, globalStop}` pair instead, so the caller (publish())
 * can implement best-effort per-item processing without a try/catch per
 * status class.
 */
async function attemptCreate(artifact, config) {
  if (artifact.title.length > MAX_AZURE_TITLE_LENGTH) {
    return failedItem(
      "AZURE_TEST_CASE_CREATE_REJECTED",
      `TestDesignArtifact title exceeds Azure's ${MAX_AZURE_TITLE_LENGTH}-character System.Title limit.`,
      false
    );
  }

  const url = buildCreateUrl(config);
  const body = JSON.stringify(buildPatchOperations(artifact));
  const headers = {
    Authorization: buildAuthHeader(config.auth),
    "Content-Type": "application/json-patch+json",
    Accept: "application/json",
  };

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    // Timeout, connection reset, DNS failure, or any other transport-level
    // rejection - the request may or may not have reached Azure, and if it
    // did, Azure may have already created the work item. No retry.
    return failedItem(
      "AZURE_TEST_CASE_OUTCOME_UNKNOWN",
      "Azure Test Case creation outcome is unknown (transport failure); remote creation may have occurred.",
      true
    );
  }

  const status = response.status;

  if (status === 200 || status === 201) {
    let parsed;
    try {
      parsed = await response.json();
    } catch {
      return failedItem(
        "AZURE_TEST_CASE_RESPONSE_INVALID",
        "Azure returned an invalid Test Case creation response; remote creation may have occurred.",
        false
      );
    }
    if (!isPlainDataObject(parsed) || !isPositiveSafeInteger(parsed.id)) {
      return failedItem(
        "AZURE_TEST_CASE_RESPONSE_INVALID",
        "Azure returned an invalid Test Case creation response; remote creation may have occurred.",
        false
      );
    }
    const result = { status: "CREATED", remoteId: String(parsed.id) };
    const location = extractSafeLocation(parsed);
    if (location !== undefined) result.location = location;
    return { result, globalStop: false };
  }

  if (status === 400 || status === 409) {
    return failedItem("AZURE_TEST_CASE_CREATE_REJECTED", `Azure rejected the Test Case creation request (HTTP ${status}).`, false);
  }
  if (status === 401) {
    return failedItem("AZURE_TEST_CASE_AUTH_FAILED", "Azure DevOps authentication failed (HTTP 401).", true);
  }
  if (status === 403) {
    return failedItem("AZURE_TEST_CASE_PERMISSION_DENIED", "Azure DevOps denied permission for this operation (HTTP 403).", true);
  }
  if (status === 404) {
    return failedItem("AZURE_TEST_CASE_TARGET_NOT_FOUND", "Azure DevOps organization/project/work-item-type target was not found (HTTP 404).", true);
  }
  if (status === 429) {
    return failedItem("AZURE_TEST_CASE_RATE_LIMITED", "Azure DevOps rate-limited this request (HTTP 429); no automatic retry.", true);
  }
  if (status >= 300 && status < 400) {
    return failedItem("AZURE_TEST_CASE_REDIRECT_BLOCKED", `Azure DevOps returned a redirect (HTTP ${status}), which was not followed.`, true);
  }
  if (status >= 500) {
    return failedItem("AZURE_TEST_CASE_OUTCOME_UNKNOWN", "Azure DevOps returned a server error; remote creation may have occurred.", true);
  }
  return failedItem("AZURE_TEST_CASE_CREATE_REJECTED", `Azure DevOps returned an unexpected response (HTTP ${status}).`, false);
}

/**
 * Azure DevOps Test Case destination - see module docstring for the full
 * contract: CREATE_ONLY, sequential, no automatic retry, global
 * short-circuit on a batch-wide-fatal condition, ambiguous outcomes never
 * claim rollback, no TCM Steps, opaque cross-vendor provenance.
 */
class AzureDevOpsTestCaseDestination {
  // A true private class field (not merely underscore-prefixed) - never an
  // own enumerable property, so it is invisible to Object.keys(),
  // JSON.stringify(), Object.assign(), for...in, and structuredClone() on
  // the instance. This matters concretely: the internal config carries the
  // caller's own auth token, and an underscore-only "private by
  // convention" field would still serialize that token if anything ever
  // ran console.log(destination) or JSON.stringify(destination) on the
  // instance (e.g. in a caller's own logging/error-reporting code).
  #config;

  /**
   * @param {{id: string, organization: string, project: string,
   *   auth: {type: "pat"|"bearer", token: string}, timeoutMs?: number}} config
   * @throws {Error} AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID
   */
  constructor(config) {
    const normalized = assertValidDestinationConfig(config);
    this.id = normalized.id;
    this.#config = normalized;
  }

  /**
   * @param {{testDesigns: object[]}} request a TestDesignPublishRequest
   * @returns {Promise<object>} a TestDesignPublishResult
   */
  async publish(request) {
    const testDesigns = request.testDesigns;
    const items = [];
    let shortCircuited = false;

    for (const artifact of testDesigns) {
      let outcome;
      if (shortCircuited) {
        outcome = { status: "FAILED", error: { code: "AZURE_TEST_CASE_NOT_ATTEMPTED", message: NOT_ATTEMPTED_MESSAGE } };
      } else {
        const attempt = await attemptCreate(artifact, this.#config);
        outcome = attempt.result;
        if (attempt.globalStop) shortCircuited = true;
      }
      items.push({ testDesignId: artifact.id, ...outcome });
    }

    return {
      destinationId: this.id,
      allSucceeded: items.every((item) => item.status === "CREATED"),
      items,
    };
  }
}

module.exports = {
  AzureDevOpsTestCaseDestination,
};
