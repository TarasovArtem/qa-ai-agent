"use strict";

/**
 * Jira Cloud Requirements Provider (Roadmap RTI-7B, corrective C1) - the
 * first concrete, network-capable implementation of RTI-6's
 * RequirementsSourceProvider contract, and RTI-7's reference adapter. Reads
 * issues from the Jira Cloud REST API v3 ENHANCED JQL search endpoint
 * (`POST /rest/api/3/search/jql`) and normalizes them into validated RTI-1
 * RequirementArtifact[].
 *
 * CORRECTIVE C1 NOTE: the original implementation used the legacy
 * `GET /rest/api/3/search` endpoint with `startAt`/`total`-based
 * pagination. Independent review (RTI-7C) found that endpoint has been
 * REMOVED by Atlassian (returns an error directing migration, confirmed
 * independently against current Atlassian documentation) - it is
 * non-functional against any currently-supported Jira Cloud site. This
 * corrective migrates entirely to the current enhanced search endpoint and
 * its `nextPageToken`-based pagination model; no legacy `startAt`/`total`
 * assumption remains anywhere in this file. The corrective also closes two
 * adversarially-discovered robustness gaps: a pagination anomaly (an empty
 * page returned while a next-page token was still present) could
 * previously be silently treated as "complete," and unbounded ADF
 * recursion could previously overflow the call stack on a deeply-nested
 * remote document. Both are now fail-closed by construction (see PAGINATION
 * and ADF sections below).
 *
 * CORRECTIVE RTI-7I-A NOTE (Jira/Azure provider parity hardening): the
 * cross-adapter architecture review (RTI-7G) that followed the Azure
 * DevOps adapter's own hardening (RTI-7F-C1) found two narrow gaps unique
 * to this file, both closed here: (1) unknown top-level config keys were
 * previously accepted silently - this module now rejects them at
 * construction, matching Azure's own already-hardened behavior; (2)
 * `mapArtifactType`'s native-issue-type lookup used a plain
 * `ARTIFACT_TYPE_MAP[normalized]` bracket access with no own-property
 * guard - the exact pattern RTI-7F-C1 independently discovered could leak
 * `Object.prototype` when untrusted vendor data was literally the string
 * `"__proto__"`. This file's `mapRelationship` was independently audited
 * and found already safe (it compares the native link-type name against
 * literal string constants via `===`, never indexes a plain object with
 * it) - no change was needed there.
 *
 * THIS FILE OWNS EVERYTHING JIRA-SPECIFIC AND NOTHING GENERIC: transport
 * (native `fetch`), authentication, pagination, retry/timeout, native
 * payload validation, and native-schema-to-RequirementArtifact
 * normalization. It implements RTI-6's contract exactly:
 *
 *   interface RequirementsSourceProvider {
 *     readonly id: string;
 *     read(): Promise<RequirementArtifact[]> | RequirementArtifact[];
 *   }
 *
 * No change to RTI-6's generic contract or `loadRequirementsFromProvider`
 * was made or is needed - this module is consumed exactly the way any
 * other RequirementsSourceProvider is:
 *
 *   const { loadRequirementsFromProvider } = require("qa-ai-agent");
 *   const { JiraRequirementsProvider } = require("qa-ai-agent/providers/jira");
 *   const requirements = await loadRequirementsFromProvider(
 *     new JiraRequirementsProvider({ id, baseUrl, email, apiToken, jql, maxItems })
 *   );
 *
 * CONFIG IS ADAPTER-OWNED, DATA-ONLY (no shared/universal provider config -
 * RTI-6 explicitly rejected that):
 *
 *   {
 *     id: string,               // required - becomes provider.id
 *     baseUrl: string,          // required - "https://<site>.atlassian.net" (or an
 *                                //   on-prem/Data-Center-compatible HTTPS origin);
 *                                //   explicit caller-supplied authority, never
 *                                //   discovered
 *     email: string,            // required - Jira Cloud Basic-auth identity
 *     apiToken: string,         // required - Jira Cloud Basic-auth secret;
 *                                //   caller/environment-owned, never read from
 *                                //   process.env by this module itself
 *     jql: string,              // required - caller-owned query; never exposed
 *                                //   through RTI-6, never logged
 *     fieldMap: {                // optional
 *       acceptanceCriteria?: string,  // a Jira field id/key (e.g. "customfield_12345"
 *                                     // or "description") whose value normalizes into
 *                                     // acceptanceCriteria; if omitted, no
 *                                     // acceptanceCriteria are ever populated - never
 *                                     // heuristically parsed from description text
 *     },
 *     maxItems?: number,        // default 1000 - mandatory safety bound (see below)
 *     timeoutMs?: number,       // default 10000 - bounded per-request timeout
 *   }
 *
 * TRUST MODEL: this provider's construction/config is Boundary-A trusted,
 * caller-supplied configuration (exactly like a target's own ProjectProfile
 * construction elsewhere in this repository, and exactly like RTI-6's own
 * "provider implementation is trusted executable code" framing) - it is not
 * validated as untrusted data. `baseUrl` is explicit trusted authority, never
 * discovered from environment/cwd/package/source.location. The Jira REST
 * API's own JSON RESPONSE, however, is untrusted data and is explicitly,
 * narrowly, structurally validated before any field is read for
 * normalization (see validateSearchResponseShape/validateIssueShape below) -
 * this is separate from, and prior to, RTI-1's own assertValidRequirementArtifact,
 * which validates this module's *normalized output*, never Jira's raw payload.
 * This module does not call assertValidRequirementArtifact itself - RTI-6's
 * generic runner (loadRequirementsFromProvider) already owns that as the
 * final authority; duplicating it here would be exactly the kind of
 * duplicated-validation-authority RTI-7A's own planning rejected.
 *
 * NETWORK / SECURITY POLICY:
 *   - `baseUrl` MUST be `https:`, an absolute URL, with no embedded
 *     credentials and no query string/fragment - validated once at
 *     construction, fails closed (JIRA_PROVIDER_CONFIG_INVALID) otherwise.
 *   - every request sets `redirect: "manual"`; ANY 3xx/opaqueredirect
 *     response is treated as a hard read failure - redirects are never
 *     followed (a redirect to an unintended host could otherwise receive
 *     the Authorization header).
 *   - no TLS bypass of any kind - Node's default certificate validation is
 *     always enforced; an enterprise custom CA is the caller/environment's
 *     own concern (NODE_EXTRA_CA_CERTS), never a per-adapter flag.
 *   - every request is bounded via AbortSignal.timeout(timeoutMs) - no
 *     infinite wait, ever.
 *   - retries are bounded (3 total attempts: 1 initial + 2 retries), and
 *     apply ONLY to 429 (honoring a numeric-seconds Retry-After header,
 *     capped) and transient 5xx/network-level failures - never to
 *     401/403/400/404/422 or any malformed-payload failure. Backoff is
 *     deterministic (no jitter) and capped.
 *
 * MAXITEMS IS A MANDATORY SAFETY BOUND, NOT A SOFT SUGGESTION: the enhanced
 * search endpoint does not report an authoritative up-front `total` the
 * way the legacy endpoint did, so this module enforces `maxItems`
 * CUMULATIVELY - before appending any page's issues to the running
 * collection, if doing so would exceed `maxItems`, the WHOLE read fails
 * closed. This module never silently returns a truncated first-`maxItems`
 * slice, which could otherwise let a caller mistake a partial snapshot for
 * a complete one.
 *
 * PAGINATION IS SEQUENTIAL, TOKEN-BASED, AND ATOMIC: pages are fetched one
 * at a time (never in parallel - avoids rate-limit pressure and any
 * result-ordering ambiguity), driven entirely by the opaque
 * `nextPageToken` the enhanced search endpoint itself returns - this
 * module never parses, decodes, or derives meaning from a token, only
 * compares it for equality against every token already seen in this same
 * `read()` call. If any single page fails after exhausting retries, the
 * WHOLE `read()` call rejects - no partial RequirementArtifact[] is ever
 * returned. Two independent fail-closed guards prevent an inconsistent or
 * malformed remote pagination state from ever being silently accepted as
 * "complete": (1) a page that returns zero issues while STILL reporting a
 * `nextPageToken` is treated as an anomalous/inconsistent response and
 * rejects the whole read, rather than being treated as a valid terminal
 * page (a genuinely terminal page has EITHER a non-empty `nextPageToken`
 * absent/null, OR - as an edge case - zero issues with no further token);
 * (2) a token progress guard rejects the whole read the moment any
 * previously-seen token reappears (a direct repeat, or a longer cycle
 * spanning more than one page), rather than looping.
 *
 * DETERMINISTIC OUTPUT ORDER - PROVIDER-OWNED, NOT JQL-DEPENDENT: after all
 * pages are collected, this module sorts the normalized artifacts by
 * native Jira issue key (project-prefix lexical, then numeric suffix
 * ascending - so "PROJ-2" sorts before "PROJ-10") BEFORE returning. This is
 * a deliberate implementation choice (RTI-7A's own recommended option):
 * provider output order is always canonical Jira-key order, regardless of
 * whatever order the remote JQL result happens to return, and regardless
 * of whether the caller's own JQL includes an ORDER BY clause. This
 * matters because RTI-4's already-shipped positional `::test::<ordinal>`
 * test-design ids depend on stable RequirementArtifact[] array order
 * across repeated reads of an unchanged remote data set - this module
 * guarantees that without parsing or rewriting caller JQL.
 *
 * REQUIREMENT IDENTITY - PROVIDER-OWNED, NEVER GENERATED FROM CONTENT:
 *
 *   RequirementArtifact.id = "<provider.id>:<issue.key>"   e.g. "company-jira-prod:PROJ-123"
 *   source.sourceId        = issue.key                     e.g. "PROJ-123" (native identity, exact)
 *   source.type            = "jira"
 *   source.system          = the validated baseUrl's hostname, e.g. "company.atlassian.net"
 *   source.version         = fields.updated, passthrough, uninterpreted, omitted if absent
 *   source.location         = "<baseUrl>/browse/<issue.key>" (issue.key
 *                              percent-encoded via encodeURIComponent before
 *                              concatenation - CORRECTIVE C1: an untrusted
 *                              remote issue key containing "/", "?", or
 *                              other URL-structural characters can no
 *                              longer alter this URL's path/query
 *                              structure) - provenance only, never treated
 *                              as network/filesystem authority
 *
 * NORMALIZED ID IS OPAQUE - NEVER PARSE IT: "<provider.id>:<issue.key>" is
 * an opaque identity string, not a structured/parseable format. `provider.id`
 * itself may legitimately contain a ":" character (RTI-6 only requires it
 * be a safe bounded string); splitting a normalized id on ":" to recover
 * either half is NOT a supported operation and no code anywhere in this
 * codebase does it. Consumers that need the native Jira key should read
 * `source.sourceId` instead - that field is exact, unencoded, native
 * provenance, never a derived/composed string.
 *
 * The provider-qualified id form is used even though a bare Jira issue key
 * is already globally unique within ONE Jira site, so that the identity
 * CONVENTION stays uniform and safely composable the moment a caller
 * combines two different Jira sites' output (two different Jira Cloud
 * sites could both have an unrelated "PROJ" project with colliding bare
 * keys; the provider-qualified form cannot collide as long as `provider.id`
 * values themselves are distinct - already a documented `provider.id`
 * obligation from RTI-6). Changing `provider.id` therefore intentionally
 * changes the normalized artifact id prefix - this is expected, not a bug:
 * `provider.id` is part of composition identity by design. Two provider
 * instances configured with different `id`s reading the SAME native Jira
 * key produce two distinct, collision-safe normalized ids
 * (e.g. "jira-prod:PROJ-123" vs "jira-staging:PROJ-123").
 *
 * ARTIFACT TYPE MAPPING - NARROW, CONSERVATIVE: only issue types with a
 * confident RTI-1 semantic match are mapped (Story -> user-story, Bug ->
 * bug, Risk -> risk, Requirement -> requirement); every other native Jira
 * issue type (Task, Epic, Sub-task, and any custom/localized type name)
 * maps to "other" - no large speculative mapping table, no claim of
 * universal Jira type semantics (a site's own custom issue types are
 * unbounded and cannot be safely guessed).
 *
 * CONTENT - DETERMINISTIC ADF-TO-PLAIN-TEXT ONLY, NEVER RAW ADF/HTML, NEVER
 * AI-REWRITTEN: `title` comes verbatim from `fields.summary`. `content`
 * comes from `fields.description` (Atlassian Document Format, Jira Cloud's
 * structured rich-text JSON), converted via a narrow, deterministic,
 * adapter-local text extraction (see adfDocumentToPlainText below) - never
 * raw ADF JSON, never HTML, never a summarized/rewritten version. Each
 * top-level document block (paragraph, heading, list, ...) is joined with
 * a blank line; inline text runs within one block are concatenated with no
 * inserted separator (ADF text nodes already carry their own literal
 * spacing); a `hardBreak` leaf node contributes an explicit newline (so an
 * explicit in-paragraph line break is preserved as a line boundary, never
 * silently concatenated into the surrounding text); a bulletList/
 * orderedList's own listItems are joined with a single newline; unknown
 * container nodes are recursed into unchanged (a harmless future ADF
 * wrapper node does not break this module - no block-type name needs to be
 * specifically recognized for this to work); unknown leaf nodes with no
 * text are ignored; blank blocks are dropped; a document whose top level is
 * not itself ADF-doc-shaped (nor a plain string) is treated as a
 * native-payload validation failure - fails closed rather than silently
 * producing empty content that could misrepresent the source requirement.
 *
 * ADF RECURSION IS DEPTH-BOUNDED - CORRECTIVE C1: the text-extraction walk
 * tracks its own recursion depth and fails closed (a clean, bounded
 * `Error`, never a raw `RangeError`) once a document nests beyond
 * `MAX_ADF_DEPTH` (64) levels. Independent review empirically demonstrated
 * that a syntactically valid (JSON.parse-able) but deeply-nested remote
 * description - well beyond anything a human-authored Jira document would
 * ever produce - previously overflowed the JavaScript call stack, an
 * ungraceful failure mode inconsistent with every other failure path in
 * this module. 64 levels comfortably exceeds any realistic
 * paragraph/list/heading/panel nesting a real Jira editor produces, while
 * remaining far short of where stack exhaustion becomes a risk. If the
 * description is absent or
 * extracts to no text at all, `content` is OMITTED from the artifact
 * entirely (genuinely absent, matching this codebase's own established
 * convention - see e.g. RTI-4's own deliberately-excluded-fields
 * precedent) rather than set to an invalid empty string; `title` alone is
 * never treated as sufficient body content - an issue with neither a real
 * description nor a populated `acceptanceCriteria` genuinely has no
 * requirement body, and correctly fails RTI-1's own "at least one of
 * content or acceptanceCriteria" validation for exactly that reason.
 *
 * ACCEPTANCE CRITERIA - ONLY FROM EXPLICIT fieldMap.acceptanceCriteria,
 * NEVER HEURISTIC: if `fieldMap.acceptanceCriteria` is not configured, no
 * `acceptanceCriteria` are ever populated (content-only artifact) - this
 * module never scans description text for something that looks like a
 * criteria list. When configured, the referenced Jira field's value may be
 * a plain string or an ADF document; either normalizes into exactly ONE
 * `acceptanceCriteria` entry with `text` only (no `id` - Jira exposes no
 * durable individual-criterion identity for a single free-text/rich-text
 * field, and this module never fabricates one; RTI-4/RTI-5's existing
 * `criterionIndex` snapshot-scoped fallback covers this downstream, as
 * designed). A field value that is present but neither a string nor an
 * ADF document (a number, an array, an unexpected object shape) fails
 * closed. A field that is absent from the response, or present as
 * null/undefined, is treated as "no acceptance criteria" (not an error) -
 * Jira's own API is inconsistent about omitting vs. nulling empty custom
 * fields depending on field type, and this module is deliberately lenient
 * on that specific distinction while remaining strict on any other
 * unexpected shape.
 *
 * PRIORITY / LABELS - SOURCE-PROVIDED VALUES ONLY, NEVER REINTERPRETED:
 * `priority` is `fields.priority.name` verbatim, when present. `labels` is
 * `fields.labels` (deduplicated defensively, since RTI-1 requires
 * uniqueness), when present and non-empty. Neither is derived from text.
 *
 * RELATIONSHIPS - NARROW, DIRECTION-AWARE, CONSERVATIVE: only Jira's
 * default link types with an unambiguous RTI-1 semantic match are mapped
 * (Blocks -> blocks/blocked-by depending on link direction, Duplicate ->
 * duplicate, Relates -> related); every other native link type (including
 * any custom link type a site may define) is OMITTED, never guessed, never
 * force-mapped to a fallback category. `targetId` is normalized using this
 * SAME provider's identity convention ("<provider.id>:<target issue key>"),
 * never the bare target key, to preserve within-provider traceability
 * consistency - even though the target issue may not itself be part of the
 * current JQL snapshot (RTI-1 permits a structural relationship reference
 * without requiring collection-level resolution; this module never fetches
 * the related issue merely to resolve it). A structurally malformed
 * issuelinks entry (missing/wrong-typed `type.name`, or neither/both of
 * inwardIssue/outwardIssue present with a valid key) is a native-payload
 * validation failure and fails the whole read closed - distinct from an
 * UNMAPPABLE but well-formed link type, which is silently omitted.
 *
 * METADATA - SELECTIVE, BOUNDED, NEVER A RAW PAYLOAD DUMP: at most
 * `{ issueType, status }` (native Jira issue-type/status display names),
 * included only when both are safely present as non-empty strings, omitted
 * entirely otherwise. The raw Jira issue/fields object, response body, or
 * request object is NEVER persisted into metadata, content, or any thrown
 * error message.
 *
 * ERROR / SECRET SAFETY - EXTENDS RTI-6's CORRECTIVE C1 ONE LAYER DEEPER:
 * every error this module throws is bounded and safe - never includes the
 * caller's own `apiToken`, the constructed Authorization header, a raw
 * response body, or the configured `jql` (JQL may itself carry sensitive
 * internal project/field detail the caller never intended to have surfaced
 * in a diagnostic channel). CORRECTIVE C1: the enhanced search endpoint is
 * called via POST with `jql` in the JSON request body rather than a URL
 * query parameter - this also means JQL no longer appears in the request
 * URL at all, further reducing incidental exposure (proxy logs, server
 * access logs) beyond what was already guaranteed by JQL's exclusion from
 * this module's own error messages. Because whatever this module throws becomes
 * RTI-6's `.cause` (an intentionally unsanitized diagnostic channel, per
 * C1), this module must not put secrets into it in the first place - C1's
 * discipline, applied transitively to this adapter's own error
 * construction, not merely to its callers' logging behavior.
 *
 * TESTABILITY: this module never accepts an executable transport/fetch
 * callback in its public config (config remains data-only, matching RTI-6's
 * and RTI-7A's own explicit rejection of that pattern). Its own test suite
 * instead replaces the process-global `fetch` for the duration of each
 * test (saved/restored), which still exercises the real URL construction,
 * header construction, method, pagination loop, and JSON-parsing code
 * paths without requiring a live TLS-terminating server - the documented,
 * deliberately chosen "smallest architecture-consistent approach" (RTI-7B's
 * own planning options C/D), since a real self-signed-certificate HTTPS
 * test server would be considerably more brittle for no additional
 * coverage this approach doesn't already provide.
 */

const MAX_STRING_LENGTH = 200;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_ITEMS = 1000;
const MAX_MAX_ITEMS = 10000;
const PAGE_SIZE = 50;
const MAX_RETRY_ATTEMPTS = 3; // TOTAL attempts (1 initial + 2 retries) - not "3 retries after initial"
const RETRY_BASE_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 2000;
// CORRECTIVE C1: the legacy GET /rest/api/3/search endpoint has been
// removed by Atlassian - this module now uses only the current enhanced
// JQL search endpoint, called via POST with the query in the request body.
const JIRA_SEARCH_PATH = "/rest/api/3/search/jql";
const FIELD_MAP_ALLOWED_KEYS = Object.freeze(["acceptanceCriteria"]);
// CORRECTIVE (RTI-7I-A, Jira parity hardening): unknown top-level config
// keys are now rejected at construction, matching the strengthening Azure
// (RTI-7B/RTI-7F) already carries - a cross-adapter inconsistency
// identified by RTI-7G's cross-adapter architecture review.
const CONFIG_ALLOWED_KEYS = Object.freeze(["id", "baseUrl", "email", "apiToken", "jql", "fieldMap", "maxItems", "timeoutMs"]);
// CORRECTIVE C1: bounds ADF text-extraction recursion - see module
// docstring "ADF RECURSION IS DEPTH-BOUNDED" for the rationale/value.
const MAX_ADF_DEPTH = 64;

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

function isPositiveInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

// --- Config validation (Boundary A - trusted, caller-supplied) ----------

function assertValidJiraProviderConfig(config) {
  if (!isPlainDataObject(config)) {
    throw new Error("JIRA_PROVIDER_CONFIG_INVALID: JiraRequirementsProvider requires a plain config object.");
  }
  // CORRECTIVE (RTI-7I-A): Object.keys() enumerates only own enumerable
  // properties - inherited/prototype properties (e.g. a hostile or
  // coincidental "constructor"/"toString" own key aside) never cause a
  // false rejection here.
  const unknownTopLevel = Object.keys(config).filter((key) => !CONFIG_ALLOWED_KEYS.includes(key));
  if (unknownTopLevel.length > 0) {
    throw new Error(`JIRA_PROVIDER_CONFIG_INVALID: unrecognized config key(s): ${unknownTopLevel.join(", ")}.`);
  }
  if (!isSafeBoundedString(config.id, MAX_STRING_LENGTH)) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "id" must be a non-empty, bounded, control-character-free string.');
  }
  const baseUrl = validateBaseUrl(config.baseUrl);
  if (!isSafeBoundedString(config.email, MAX_STRING_LENGTH) || !config.email.includes("@")) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "email" must be a non-empty, bounded string containing "@".');
  }
  if (typeof config.apiToken !== "string" || config.apiToken.length === 0) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "apiToken" must be a non-empty string.');
  }
  if (!isNonEmptyString(config.jql)) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "jql" must be a non-empty string.');
  }
  const fieldMap = validateFieldMap(config.fieldMap);

  let maxItems = DEFAULT_MAX_ITEMS;
  if (config.maxItems !== undefined) {
    if (!isPositiveInteger(config.maxItems) || config.maxItems > MAX_MAX_ITEMS) {
      throw new Error(`JIRA_PROVIDER_CONFIG_INVALID: "maxItems" must be a positive integer no greater than ${MAX_MAX_ITEMS} when supplied.`);
    }
    maxItems = config.maxItems;
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (config.timeoutMs !== undefined) {
    if (!isPositiveInteger(config.timeoutMs) || !Number.isFinite(config.timeoutMs)) {
      throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "timeoutMs" must be a positive, finite integer when supplied.');
    }
    timeoutMs = config.timeoutMs;
  }

  return Object.freeze({
    id: config.id,
    baseUrl,
    email: config.email,
    apiToken: config.apiToken,
    jql: config.jql,
    fieldMap,
    maxItems,
    timeoutMs,
  });
}

function validateBaseUrl(baseUrl) {
  if (typeof baseUrl !== "string" || baseUrl.length === 0) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "baseUrl" must be a non-empty string.');
  }
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "baseUrl" must be a valid absolute URL.');
  }
  if (parsed.protocol !== "https:") {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "baseUrl" must use the https: scheme.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "baseUrl" must not embed credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "baseUrl" must not include a query string or fragment.');
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
}

function validateFieldMap(fieldMap) {
  if (fieldMap === undefined) return Object.freeze({});
  if (!isPlainDataObject(fieldMap)) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "fieldMap" must be a plain object when supplied.');
  }
  const unknown = Object.keys(fieldMap).filter((key) => !FIELD_MAP_ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`JIRA_PROVIDER_CONFIG_INVALID: "fieldMap" has unrecognized key(s): ${unknown.join(", ")}.`);
  }
  if (fieldMap.acceptanceCriteria !== undefined && !isNonEmptyString(fieldMap.acceptanceCriteria)) {
    throw new Error('JIRA_PROVIDER_CONFIG_INVALID: "fieldMap.acceptanceCriteria" must be a non-empty string when supplied.');
  }
  return Object.freeze({ ...fieldMap });
}

// --- Transport (native fetch, bounded timeout, bounded retry) -----------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterSeconds(headerValue) {
  if (typeof headerValue !== "string") return undefined;
  if (!/^\d+$/.test(headerValue.trim())) return undefined; // seconds form only - HTTP-date form is not supported
  return Number(headerValue.trim());
}

function backoffDelayMs(attempt) {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

function buildAuthHeader(email, apiToken) {
  return `Basic ${Buffer.from(`${email}:${apiToken}`, "utf8").toString("base64")}`;
}

// CORRECTIVE C1: POST, not GET - the enhanced search endpoint accepts JQL
// (and the rest of the query) in a JSON request body rather than a URL
// query string. This is a deliberate choice, not merely "whichever the
// endpoint allows": it keeps JQL (which may carry sensitive internal
// project/field detail) out of the request URL entirely, reducing
// incidental exposure in proxy/server access logs beyond what was already
// guaranteed by JQL's exclusion from this module's own error messages.
async function jiraFetch(url, body, config) {
  const headers = {
    Authorization: buildAuthHeader(config.email, config.apiToken),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (err) {
      if (attempt === MAX_RETRY_ATTEMPTS) {
        throw new Error(`Jira request failed after ${attempt} attempt(s): a network-level error occurred (${err.name || "Error"}).`);
      }
      await delay(backoffDelayMs(attempt));
      continue;
    }

    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new Error("Jira request received a redirect response; redirects are not followed.");
    }

    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
      if (attempt === MAX_RETRY_ATTEMPTS) {
        throw new Error(`Jira request failed after ${attempt} attempt(s) with HTTP status ${response.status}.`);
      }
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get("retry-after"));
      const delayMs = retryAfterSeconds !== undefined ? Math.min(retryAfterSeconds * 1000, MAX_RETRY_DELAY_MS) : backoffDelayMs(attempt);
      await delay(delayMs);
      continue;
    }

    if (!response.ok) {
      throw new Error(`Jira request failed with HTTP status ${response.status}.`);
    }

    return response;
  }
  /* istanbul ignore next - loop always returns or throws above */
  throw new Error("Jira request failed: retry loop exited unexpectedly.");
}

// --- Native payload validation (Jira's JSON response is untrusted DATA) -

// CORRECTIVE C1: validates the CURRENT enhanced-search response shape -
// `issues[]` plus an opaque, optional `nextPageToken`. No `startAt`/
// `maxResults`/`total` requirement remains (the legacy endpoint's fields,
// not present in the enhanced-search response at all).
function validateSearchResponseShape(payload) {
  if (!isPlainDataObject(payload)) {
    throw new Error("Jira search response was not a JSON object.");
  }
  if (!Array.isArray(payload.issues)) {
    throw new Error('Jira search response "issues" was not an array.');
  }
  // nextPageToken is opaque vendor data - never parsed/decoded, only
  // compared for equality (see fetchAllIssues' token-progress guard).
  // Absent or null means "no further page"; present must be a non-empty
  // string. An empty string is deliberately treated as INVALID, not as an
  // alternate "terminal" signal - fail-closed on ambiguity rather than
  // silently guessing what an empty-string token would mean.
  if (payload.nextPageToken !== undefined && payload.nextPageToken !== null && !isNonEmptyString(payload.nextPageToken)) {
    throw new Error('Jira search response "nextPageToken" was present but not a valid non-empty string.');
  }
  payload.issues.forEach((issue, index) => validateIssueShape(issue, index));
}

function validateIssueShape(issue, index) {
  if (!isPlainDataObject(issue)) {
    throw new Error(`Jira search response issues[${index}] was not a JSON object.`);
  }
  // CORRECTIVE C1: issue.key now uses the same bounded/control-character-free
  // discipline this module already applies to its own config fields, since
  // this value flows unmodified into the normalized id, source.sourceId,
  // and (percent-encoded) source.location.
  if (!isSafeBoundedString(issue.key, MAX_STRING_LENGTH)) {
    throw new Error(`Jira search response issues[${index}].key was missing or invalid.`);
  }
  if (!isPlainDataObject(issue.fields)) {
    throw new Error(`Jira search response issues[${index}].fields was missing or invalid.`);
  }
}

// --- Pagination (CORRECTIVE C1: token-based, enhanced-search endpoint) ---

function buildSearchRequestBody(jql, nextPageToken, fields) {
  const body = { jql, maxResults: PAGE_SIZE, fields };
  if (nextPageToken !== undefined) {
    body.nextPageToken = nextPageToken;
  }
  return JSON.stringify(body);
}

function buildRequestedFields(fieldMap) {
  const fields = ["summary", "description", "issuetype", "priority", "labels", "issuelinks", "updated", "status"];
  if (fieldMap.acceptanceCriteria) fields.push(fieldMap.acceptanceCriteria);
  return [...new Set(fields)];
}

// CORRECTIVE C1: replaces the legacy startAt/total pagination loop
// entirely. Driven by the enhanced-search endpoint's own opaque
// `nextPageToken`; see module docstring "PAGINATION IS SEQUENTIAL,
// TOKEN-BASED, AND ATOMIC" for the two fail-closed guards this loop
// enforces (empty-page-with-token anomaly, and token progress/cycle).
async function fetchAllIssues(config) {
  const fields = buildRequestedFields(config.fieldMap);
  const url = `${config.baseUrl}${JIRA_SEARCH_PATH}`;
  const collected = [];
  const seenTokens = new Set();
  let nextPageToken; // undefined on the first request

  for (;;) {
    const body = buildSearchRequestBody(config.jql, nextPageToken, fields);
    const response = await jiraFetch(url, body, config);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Jira response body was not valid JSON.");
    }
    validateSearchResponseShape(payload);

    // maxItems is enforced CUMULATIVELY, before appending - the enhanced
    // endpoint reports no authoritative up-front total to fail-fast
    // against, so completeness/boundedness both derive from this one
    // check. Never truncates: exceeding the bound rejects the whole read.
    if (collected.length + payload.issues.length > config.maxItems) {
      throw new Error(`Jira result set exceeds the configured maxItems bound (${config.maxItems}).`);
    }
    collected.push(...payload.issues);

    const returnedToken = isNonEmptyString(payload.nextPageToken) ? payload.nextPageToken : undefined;

    // Fail-closed guard #1 (the original RTI-7C snapshot-completeness
    // finding): an empty page that STILL reports a next-page token is an
    // inconsistent/anomalous remote response, never a valid "we're done."
    if (payload.issues.length === 0 && returnedToken !== undefined) {
      throw new Error("Jira pagination returned an empty page while still reporting a next page token; refusing to treat an inconsistent remote response as a complete snapshot.");
    }

    if (returnedToken === undefined) {
      break; // genuinely terminal page
    }

    // Fail-closed guard #2: token progress/cycle guard. Tracks every token
    // seen in this call (not merely the immediately previous one), so a
    // cycle spanning more than one page (A -> B -> A) is caught exactly
    // the same as an immediate repeat (A -> A).
    if (seenTokens.has(returnedToken)) {
      throw new Error("Jira pagination returned a previously-seen page token; aborting to avoid an infinite loop.");
    }
    seenTokens.add(returnedToken);
    nextPageToken = returnedToken;
  }

  return collected;
}

// --- ADF (Atlassian Document Format) -> deterministic plain text --------
//
// Two joining rules only: (1) a bulletList/orderedList's own listItems are
// joined with a single newline, for readability; (2) every other node's
// children (inline text runs within a paragraph/heading, or a single
// nested block) are joined with NO separator - ADF text nodes already
// carry their own literal spacing (e.g. a bold run "Bold " followed by a
// plain run "and normal." is meant to read as "Bold and normal.", not
// "Bold  and normal." with an extra space inserted between them).
// Top-level document blocks (each entry in `doc.content`) are joined with
// a blank line by adfDocumentToPlainText() below - that is the only place
// paragraph/heading-level separation happens; this function does not need
// to enumerate specific block-type names to get that right, and gracefully
// recurses through any node type it does not specifically recognize (a
// future harmless ADF wrapper node does not break this module - it simply
// contributes its own extracted text unchanged).

// CORRECTIVE C1: `depth` is threaded through every recursive call and
// checked on entry - a document nesting beyond MAX_ADF_DEPTH fails closed
// with a clean, bounded Error instead of overflowing the call stack (see
// module docstring "ADF RECURSION IS DEPTH-BOUNDED"). `hardBreak` is now a
// recognized leaf that contributes an explicit "\n", so an in-paragraph
// line break is preserved as a line boundary rather than silently
// concatenating the text before and after it.
function extractAdfNodeText(node, depth) {
  if (depth > MAX_ADF_DEPTH) {
    throw new Error(`Jira ADF document exceeds the maximum supported nesting depth (${MAX_ADF_DEPTH}).`);
  }
  if (!isPlainDataObject(node)) return "";
  if (node.type === "hardBreak") return "\n";
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  const childTexts = node.content.map((child) => extractAdfNodeText(child, depth + 1)).filter((text) => text.length > 0);
  const separator = node.type === "bulletList" || node.type === "orderedList" ? "\n" : "";
  return childTexts.join(separator);
}

function adfDocumentToPlainText(doc, fieldLabel) {
  if (doc === null || doc === undefined) return "";
  if (typeof doc === "string") return doc.trim();
  if (!isPlainDataObject(doc) || doc.type !== "doc" || !Array.isArray(doc.content)) {
    throw new Error(`Jira field "${fieldLabel}" was not a recognized ADF document or plain string.`);
  }
  const blocks = doc.content.map((block) => extractAdfNodeText(block, 1)).map((text) => text.trim()).filter((text) => text.length > 0);
  return blocks.join("\n\n").trim();
}

// --- Type / relationship mapping (narrow, conservative) ------------------

const ARTIFACT_TYPE_MAP = Object.freeze({
  story: "user-story",
  bug: "bug",
  risk: "risk",
  requirement: "requirement",
});

function mapArtifactType(issueTypeName) {
  const normalized = typeof issueTypeName === "string" ? issueTypeName.trim().toLowerCase() : "";
  // CORRECTIVE (RTI-7I-A): own-property guard - `issueTypeName`/`normalized`
  // is untrusted vendor data. A plain `ARTIFACT_TYPE_MAP[normalized]`
  // bracket access would resolve an inherited accessor (e.g. returning
  // Object.prototype, a truthy object, not undefined) if a malformed/
  // hostile Jira response supplied the literal string "__proto__" as the
  // issue type name, silently producing an invalid artifact.type instead
  // of the documented "other" fallback - the exact defect class RTI-7F-C1
  // independently discovered and fixed in the Azure adapter.
  return Object.prototype.hasOwnProperty.call(ARTIFACT_TYPE_MAP, normalized) ? ARTIFACT_TYPE_MAP[normalized] : "other";
}

// Jira's default link-type/direction combinations with an unambiguous RTI-1
// semantic match - anything else is omitted, never guessed.
function mapRelationship(link, index) {
  if (!isPlainDataObject(link) || !isPlainDataObject(link.type) || !isNonEmptyString(link.type.name)) {
    throw new Error(`Jira issue link[${index}] had a missing or invalid "type.name".`);
  }
  const hasInward = link.inwardIssue !== undefined;
  const hasOutward = link.outwardIssue !== undefined;
  if (hasInward === hasOutward) {
    throw new Error(`Jira issue link[${index}] must have exactly one of inwardIssue/outwardIssue.`);
  }
  const targetIssue = hasInward ? link.inwardIssue : link.outwardIssue;
  // CORRECTIVE C1: same bounded/control-character-free discipline as
  // validateIssueShape's own issue.key check - this value flows into the
  // normalized relationship targetId.
  if (!isPlainDataObject(targetIssue) || !isSafeBoundedString(targetIssue.key, MAX_STRING_LENGTH)) {
    throw new Error(`Jira issue link[${index}] target issue had a missing or invalid "key".`);
  }

  const linkTypeName = link.type.name.trim().toLowerCase();
  let relationshipType;
  if (linkTypeName === "blocks") {
    relationshipType = hasOutward ? "blocks" : "blocked-by";
  } else if (linkTypeName === "duplicate") {
    relationshipType = "duplicate";
  } else if (linkTypeName === "relates") {
    relationshipType = "related";
  } else {
    return null; // well-formed but unmapped link type - omitted, never guessed
  }
  return { type: relationshipType, nativeTargetKey: targetIssue.key };
}

// --- Normalization: native Jira issue -> RequirementArtifact -------------

function normalizeIssue(config, issue, instanceHost) {
  const artifact = {
    id: `${config.id}:${issue.key}`,
    type: mapArtifactType(issue.fields.issuetype && issue.fields.issuetype.name),
    title: issue.fields.summary,
    source: {
      type: "jira",
      sourceId: issue.key,
      system: instanceHost,
      // CORRECTIVE C1: percent-encoded - an untrusted remote issue key
      // containing "/", "?", or other URL-structural characters can no
      // longer alter this URL's intended path/query structure.
      location: `${config.baseUrl}/browse/${encodeURIComponent(issue.key)}`,
    },
  };

  // Genuinely absent, not present-but-empty: a Jira issue with no
  // description (or one whose ADF body extracts to no text at all) gets
  // no `content` field, rather than an invalid empty string - RTI-1
  // requires content to be non-empty WHEN SUPPLIED, and requires at least
  // one of content/acceptanceCriteria to exist at all. Title alone is
  // never sufficient - an issue with neither a real description nor a
  // configured/populated acceptanceCriteria field genuinely has no
  // requirement body, and correctly fails RTI-1 validation for exactly
  // that reason, not because this adapter manufactured an invalid
  // placeholder value.
  const content = adfDocumentToPlainText(issue.fields.description, "description");
  if (content.length > 0) {
    artifact.content = content;
  }

  if (isNonEmptyString(issue.fields.updated)) {
    artifact.source.version = issue.fields.updated;
  }

  if (config.fieldMap.acceptanceCriteria) {
    const rawValue = issue.fields[config.fieldMap.acceptanceCriteria];
    const text = adfDocumentToPlainText(rawValue, config.fieldMap.acceptanceCriteria);
    if (text.length > 0) {
      artifact.acceptanceCriteria = [{ text }];
    }
  }

  if (issue.fields.priority && isNonEmptyString(issue.fields.priority.name)) {
    artifact.priority = issue.fields.priority.name;
  }

  if (Array.isArray(issue.fields.labels) && issue.fields.labels.length > 0) {
    const labels = [...new Set(issue.fields.labels)];
    if (labels.length > 0) artifact.labels = labels;
  }

  if (Array.isArray(issue.fields.issuelinks) && issue.fields.issuelinks.length > 0) {
    const relationships = [];
    issue.fields.issuelinks.forEach((link, index) => {
      const mapped = mapRelationship(link, index);
      if (mapped) {
        relationships.push({ type: mapped.type, targetId: `${config.id}:${mapped.nativeTargetKey}` });
      }
    });
    if (relationships.length > 0) artifact.relationships = relationships;
  }

  const metadata = {};
  if (issue.fields.issuetype && isNonEmptyString(issue.fields.issuetype.name)) metadata.issueType = issue.fields.issuetype.name;
  if (issue.fields.status && isNonEmptyString(issue.fields.status.name)) metadata.status = issue.fields.status.name;
  if (Object.keys(metadata).length > 0) artifact.metadata = metadata;

  return artifact;
}

function compareJiraKeys(a, b) {
  const matchA = /^(.*?)-(\d+)$/.exec(a);
  const matchB = /^(.*?)-(\d+)$/.exec(b);
  if (!matchA || !matchB) return a < b ? -1 : a > b ? 1 : 0;
  if (matchA[1] !== matchB[1]) return matchA[1] < matchB[1] ? -1 : 1;
  return Number(matchA[2]) - Number(matchB[2]);
}

/**
 * Jira Cloud RequirementsSourceProvider (Roadmap RTI-7B). See this module's
 * own docstring for the full contract, identity/provenance model,
 * pagination/retry/timeout policy, and error/secret-safety discipline.
 */
class JiraRequirementsProvider {
  #config;
  #instanceHost;

  constructor(config) {
    this.#config = assertValidJiraProviderConfig(config);
    this.#instanceHost = new URL(this.#config.baseUrl).host;
  }

  get id() {
    return this.#config.id;
  }

  async read() {
    const issues = await fetchAllIssues(this.#config);
    issues.sort((a, b) => compareJiraKeys(a.key, b.key));
    return issues.map((issue) => normalizeIssue(this.#config, issue, this.#instanceHost));
  }
}

module.exports = {
  JiraRequirementsProvider,
};
