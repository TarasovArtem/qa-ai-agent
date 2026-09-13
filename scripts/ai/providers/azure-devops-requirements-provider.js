"use strict";

/**
 * Azure DevOps Services Requirements Provider (Roadmap RTI-7F) - the second
 * concrete, network-capable implementation of RTI-6's
 * RequirementsSourceProvider contract, and RTI-7's proof that the generic
 * `{id, read()}` abstraction generalizes to a materially different vendor
 * shape than Jira (RTI-7B). Reads work items from Azure DevOps Services'
 * Work Item Tracking REST API (v7.1) via WIQL + batched work-item fetch, and
 * normalizes them into validated RTI-1 RequirementArtifact[].
 *
 * SCOPE: Azure DevOps SERVICES ONLY (https://dev.azure.com/<org>/<project>).
 * Azure DevOps Server/TFS (arbitrary on-prem collection URLs) is explicitly
 * out of scope for this adapter - a deliberate RTI-7E design decision, not
 * an oversight. No `baseUrl` is accepted; the network authority is
 * constructed internally from validated `organization`/`project` strings,
 * which is a materially narrower (safer) surface than Jira's own
 * caller-supplied-origin model, appropriate because Azure DevOps Services
 * has exactly one documented host.
 *
 * THIS FILE OWNS EVERYTHING AZURE-DEVOPS-SPECIFIC AND NOTHING GENERIC:
 * transport (native `fetch`), authentication, the WIQL-then-batch retrieval
 * model, Azure's own rate-limit semantics, native payload validation, and
 * native-schema-to-RequirementArtifact normalization. It implements RTI-6's
 * contract exactly:
 *
 *   interface RequirementsSourceProvider {
 *     readonly id: string;
 *     read(): Promise<RequirementArtifact[]> | RequirementArtifact[];
 *   }
 *
 * No change to RTI-6's generic contract or `loadRequirementsFromProvider`
 * was made or is needed:
 *
 *   const { loadRequirementsFromProvider } = require("qa-ai-agent");
 *   const { AzureDevOpsRequirementsProvider } = require("qa-ai-agent/providers/azure-devops");
 *   const requirements = await loadRequirementsFromProvider(
 *     new AzureDevOpsRequirementsProvider({ id, organization, project, wiql, auth })
 *   );
 *
 * CONFIG IS ADAPTER-OWNED, DATA-ONLY (matching Jira/RTI-6's established
 * convention - no shared/universal provider config):
 *
 *   {
 *     id: string,               // required - becomes provider.id
 *     organization: string,     // required - Azure DevOps Services org name;
 *                                //   validated, percent-encoded into the URL
 *     project: string,          // required - project name/id; may contain
 *                                //   display-name characters (spaces etc.);
 *                                //   validated, percent-encoded into the URL
 *     wiql: string,              // required - caller-owned WIQL query; never
 *                                //   exposed through RTI-6, never logged.
 *                                //   FLAT queries only - see WIQL section.
 *     auth: { type: "pat", token: string } | { type: "bearer", token: string },
 *                                // required, discriminated union. This
 *                                //   module never acquires or refreshes a
 *                                //   token - see AUTH section.
 *     fieldMap: {                // optional
 *       acceptanceCriteria?: string | null,  // override the default AC field
 *                                             // reference name, or `null` to
 *                                             // disable AC extraction entirely
 *     },
 *     typeMap: {                 // optional - merged OVER the built-in
 *       [nativeWorkItemType: string]: RTI1ArtifactType,  // default map, never
 *     },                                                  // replaces it
 *     maxItems?: number,        // default 1000 - mandatory safety bound
 *     timeoutMs?: number,       // default 10000 - bounded per-request timeout
 *   }
 *
 * Unknown top-level config keys are REJECTED at construction (a deliberate
 * strengthening over Jira's own carried-forward LOW/INFO item - cheap now,
 * per RTI-7E's own cheap-now/expensive-later table).
 *
 * TRUST MODEL: config is Boundary-A trusted, caller-supplied (same framing
 * as Jira/RTI-6). Azure's own JSON responses (WIQL result, batch result) are
 * untrusted DATA and are explicitly, narrowly, structurally validated before
 * any field is read for normalization - this module does not call
 * assertValidRequirementArtifact itself; RTI-6's generic runner
 * (loadRequirementsFromProvider) already owns that as the final authority.
 *
 * NETWORK / SECURITY POLICY:
 *   - the network authority (`https://dev.azure.com/<org>/<project>`) is
 *     CONSTRUCTED internally from validated `organization`/`project` -
 *     never accepted as an arbitrary URL, unlike Jira's `baseUrl`.
 *   - every request sets `redirect: "manual"`; ANY 3xx/opaqueredirect
 *     response is a hard read failure - redirects are never followed.
 *   - no TLS bypass of any kind.
 *   - every request is bounded via AbortSignal.timeout(timeoutMs).
 *   - retries are bounded (3 total attempts: 1 initial + 2 retries), and
 *     apply ONLY to 429 and transient 5xx/network-level failures - never to
 *     401/403/400/404/422 or any malformed-payload failure.
 *
 * AZURE RATE-LIMIT SEMANTICS - DELIBERATELY NOT COPIED FROM JIRA: Azure
 * DevOps's documented throttling model (see
 * https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits)
 * differs materially from Jira's. A `429` is a genuine failure and is
 * retried after honoring `Retry-After` (bounded), same spirit as Jira. But
 * Azure ALSO documents a distinct, earlier-warning signal: a SUCCESSFUL
 * `200` response can itself carry a `Retry-After` header, meaning "this
 * request succeeded, but slow down before your NEXT request." That response
 * must be accepted and processed normally - NOT retried - and the delay is
 * honored only before the next OUTBOUND request this read() call makes (if
 * any). A per-read-call rate-limit state object (never a module-level
 * global) tracks this across the WIQL call and every subsequent batch call.
 * `X-RateLimit-*` headers are deliberately ignored in this MVP (informational
 * only, not required for correctness, and the header set/semantics may
 * evolve) - `Retry-After` is the only actionable signal implemented here.
 *
 * MAXITEMS / SNAPSHOT COMPLETENESS - A DIFFERENT VENDOR FAILURE MODE THAN
 * JIRA'S: Azure's WIQL endpoint has NO pagination and NO completeness
 * signal in its response schema at all. Worse: Microsoft's own documented
 * object limits state that WIQL query results are HARD-CAPPED at 20,000
 * items and SILENTLY TRUNCATED with no error shown when exceeded (see
 * https://learn.microsoft.com/en-us/azure/devops/organizations/settings/work/object-limits).
 * This module therefore never uses `$top` as a `maxItems` mechanism (doing
 * so would hide whether more results existed, exactly the silent-truncation
 * failure this codebase's providers must never produce). Instead: the full
 * WIQL result is fetched, then validated locally BEFORE any batch call: (1)
 * if the result count is >= 20,000, the read fails closed with an explicit
 * error naming this vendor limitation - completeness cannot be verified
 * beyond Azure's own opaque cap, so an exactly-20,000-item legitimate
 * snapshot is deliberately treated as suspect rather than risk silently
 * accepting a truncated one; (2) if the result count exceeds the configured
 * `maxItems`, the read fails closed with no batch retrieval attempted at
 * all (cheap early gate). Duplicate work-item ids within one WIQL result are
 * themselves treated as an inconsistent vendor response and fail closed
 * before any batch call - a flat query over unique work items should never
 * naturally produce duplicate row ids.
 *
 * TWO-STAGE RETRIEVAL, BATCHED, SEQUENTIAL, ATOMIC: WIQL returns only work
 * item ID references (never field data); the full work items are fetched
 * via Azure's `workitemsbatch` endpoint (vendor maximum 200 ids per
 * request), sequentially (never parallel - simpler atomic failure, stable
 * operational behavior, lower rate-limit pressure, easier deterministic
 * testing), with `errorPolicy: "Fail"` explicitly set as the vendor's own
 * fail-closed mode. This module does NOT trust `errorPolicy` alone:
 * independently, after every batch response, the returned id Set is
 * reconciled against the requested id Set - any missing id, any extra
 * (unrequested) id, or any duplicate returned id fails the WHOLE read
 * closed, never a partial result. `$expand: "Relations"` is requested on
 * the SAME batch call - Azure's batch endpoint supports returning relations
 * directly, so no N+1 per-work-item fetch is ever performed.
 *
 * DETERMINISTIC OUTPUT ORDER - PROVIDER-OWNED, NOT VENDOR-RESPONSE-DEPENDENT:
 * after all batches are collected, this module sorts the normalized
 * artifacts by native numeric work-item id ascending BEFORE returning -
 * batch-response order is not a documented Azure guarantee, so this module
 * never assumes it. Mirrors Jira's own provider-owned deterministic sort.
 *
 * REQUIREMENT IDENTITY - PROVIDER-OWNED, NEVER GENERATED FROM CONTENT:
 *
 *   RequirementArtifact.id = "<provider.id>:<workItem.id>"   e.g. "azure-prod:12345"
 *   source.sourceId        = String(workItem.id)             e.g. "12345" (native identity, exact)
 *   source.type            = "azure-devops"
 *   source.system          = "<organization>/<project>"      (non-secret, stable, diagnostic)
 *   source.version         = String(workItem.rev)             (vendor's own monotonic revision counter -
 *                                                                deliberately preferred over any timestamp
 *                                                                field, which Azure does not guarantee as
 *                                                                a single canonical "last updated" value
 *                                                                the way Jira's fields.updated does)
 *   source.location         = "https://dev.azure.com/<org>/<project>/_workitems/edit/<id>/"
 *                              (organization/project percent-encoded; provenance only, never
 *                              network/retrieval authority)
 *
 * The normalized id is OPAQUE - never parsed anywhere in this codebase,
 * exactly like Jira's. `provider.id` itself may contain ":". Work-item ids
 * are independently confirmed unique per ORGANIZATION (Azure DevOps
 * Services) - not merely per-project - but this module still uses the
 * provider-qualified identity convention uniformly across every RTI-7
 * adapter, because (a) it is already a fixed cross-adapter convention, (b)
 * different Azure DevOps organizations can still reuse numeric ids, and (c)
 * multiple provider instances may be composed by a caller.
 *
 * ARTIFACT TYPE MAPPING - NARROW, CONSERVATIVE, CALLER-EXTENSIBLE: Azure's
 * process-template variability (Agile/Scrum/CMMI/Basic/custom-inherited
 * processes can all name the "same" semantic work item type differently)
 * makes a single hardcoded mapping table materially riskier than Jira's own
 * already-acknowledged localized-type limitation. This module ships a
 * small, conservative built-in default map (see ARTIFACT_TYPE_MAP) that
 * callers may extend/override via `config.typeMap` (merged OVER the
 * built-in map, never replacing RTI-1's own fixed vocabulary - every
 * caller-supplied target value is itself validated against RTI-1's allowed
 * artifact types at construction, failing closed on an invalid target).
 * Any native type not present in the merged map -> "other".
 *
 * CONTENT - DETERMINISTIC HTML-TO-PLAIN-TEXT ONLY, NEVER RAW HTML, NEVER
 * AI-REWRITTEN: `title` comes verbatim from `System.Title`. `content` comes
 * from `System.Description` (Azure's rich-text HTML field), converted via a
 * narrow, deterministic, adapter-local, ZERO-DEPENDENCY tokenizer (see
 * htmlToPlainText below) - never raw HTML, never a summarized/rewritten
 * version. If the description is absent or extracts to no text at all,
 * `content` is OMITTED entirely (genuinely absent, matching this codebase's
 * established convention - same as Jira's own precedent) rather than set to
 * an invalid empty string; `title` alone is never treated as sufficient
 * body content.
 *
 * HTML RESOURCE SAFETY IS FIXED FROM DAY ONE (unlike Jira, where the
 * equivalent ADF-depth bound was only added reactively via Corrective C1
 * after an independent review discovered the gap): this module bounds BOTH
 * the raw HTML input length (MAX_HTML_INPUT_LENGTH) and the open-tag
 * nesting depth (MAX_HTML_NESTING_DEPTH) BEFORE any implementation existed
 * to regress. The tokenizer itself is a single-pass, iterative state
 * machine (an explicit array-based open-tag stack, never a recursive
 * descent parser) - there is no call-stack-depth risk by construction, and
 * the nesting-depth bound exists to reject pathological/hostile markup
 * cleanly (a bounded Error) rather than let the tokenizer's own state (the
 * open-tag stack) grow unbounded.
 *
 * ACCEPTANCE CRITERIA - DEFAULT STANDARD FIELD, WITH EXPLICIT OVERRIDE:
 * unlike Jira (which has no standard AC field and requires fully-explicit
 * `fieldMap.acceptanceCriteria` configuration), Azure DevOps DOES define a
 * standard reference field (`Microsoft.VSTS.Common.AcceptanceCriteria`,
 * HTML type, confirmed present on Bug/Epic/Feature/Product Backlog Item
 * (Scrum) - not confirmed universal across every process template/type).
 * This module therefore defaults to that field when present, while still
 * allowing `fieldMap.acceptanceCriteria` to override it to a different
 * field name, or explicitly disable AC extraction via `fieldMap.acceptanceCriteria: null`.
 * The field's absence on a given work item type is "no acceptance
 * criteria," never an error - same lenient-absence policy as Jira. One
 * native field value normalizes into exactly ONE `acceptanceCriteria` entry
 * with `text` only - no fabricated `id` (RTI-4/RTI-5's `criterionIndex`
 * snapshot-scoped fallback covers this downstream, as designed).
 *
 * PRIORITY / LABELS - SOURCE-PROVIDED VALUES ONLY: `priority` is
 * `Microsoft.VSTS.Common.Priority` when present as a safe scalar, converted
 * to its plain string representation, never severity-translated. `labels`
 * is parsed from `System.Tags` (Azure's documented semicolon-delimited tag
 * string): split on ";", trimmed, empty segments dropped, deduplicated,
 * first-seen order preserved (Azure does not guarantee tag order either, so
 * first-seen order is as stable a choice as any other).
 *
 * RELATIONSHIPS - NARROW, CONSERVATIVE, VERIFIED REFERENCE NAMES ONLY: only
 * two Azure system link types are mapped in this MVP:
 * `System.LinkTypes.Hierarchy-Reverse` -> "parent" (RTI-1 has no "child"
 * relationship type, so the forward/Child direction is deliberately NOT
 * mapped - mapping only the reverse direction avoids inventing a type RTI-1
 * does not support), and `System.LinkTypes.Related` -> "related". Every
 * other native link type (Hierarchy-Forward/Child, both Dependency
 * directions, Duplicate variants, custom/remote link types) is OMITTED,
 * never guessed, never force-mapped - a deliberate, documented MVP
 * limitation, not an oversight. `targetId` is normalized using this SAME
 * provider's identity convention ("<provider.id>:<target native id>"),
 * extracted from the relation's own `url` (Azure's WorkItemRelation exposes
 * `url`/`rel`/`attributes`, not a bare target id) - the url's trailing path
 * segment is parsed and validated as a positive safe integer; a
 * structurally invalid relation url is a native-payload validation failure
 * and fails the whole read closed. A target outside the current WIQL
 * snapshot is permitted (RTI-1 permits a structural reference without
 * requiring collection-level resolution) - this module never fetches the
 * related work item merely to resolve it.
 *
 * METADATA - SELECTIVE, BOUNDED, NEVER A RAW PAYLOAD DUMP: at most
 * `{ workItemType, state }`, included only when both are safely present.
 * The raw WIQL response, WorkItem object, fields map, relations array, or
 * any HTTP request/response object is NEVER persisted into metadata,
 * content, or any thrown error message.
 *
 * ERROR / SECRET SAFETY - SAME DISCIPLINE AS JIRA'S RTI-6 C1-EXTENDED
 * MODEL: every error this module throws is bounded and safe - never
 * includes the caller's PAT/Bearer token, the constructed Authorization
 * header, a raw response body, or the configured `wiql` (which may itself
 * carry sensitive internal project/field detail). Whatever this module
 * throws becomes RTI-6's `.cause` (an intentionally unsanitized diagnostic
 * channel) - this module must not put secrets into it in the first place.
 *
 * TESTABILITY: this module never accepts an executable transport/fetch
 * callback in its public config, matching RTI-6/RTI-7A/Jira's own explicit
 * rejection of that pattern. Its own test suite instead replaces the
 * process-global `fetch` for the duration of each test (saved/restored),
 * exercising the real URL construction, header construction, method, the
 * WIQL-then-batch control flow, and JSON-parsing code paths without
 * requiring a live TLS-terminating server - the same deliberately-chosen
 * approach as Jira's, independently re-derived here per RTI-7E's own
 * "no premature shared test-helper extraction" instruction.
 */

const MAX_STRING_LENGTH = 200;
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_ITEMS = 1000;
// The vendor's own documented hard WIQL result cap (see module docstring
// MAXITEMS section) - accepting a configured maxItems above this value
// would be meaningless, since Azure itself cannot return more.
const MAX_MAX_ITEMS = 20000;
const WIQL_RESULT_HARD_CAP = 20000;
const AZURE_BATCH_SIZE = 200;
const API_VERSION = "7.1";
const MAX_RETRY_ATTEMPTS = 3; // TOTAL attempts (1 initial + 2 retries)
const RETRY_BASE_DELAY_MS = 100;
const MAX_RETRY_DELAY_MS = 2000;
// Azure's own documented rate-limit delays run "a few milliseconds ... up
// to 30 seconds" under normal throttling; this bound exists to reject an
// absurd/hostile Retry-After value (hours, Infinity, NaN, negative), not to
// defeat real throttling. Deliberately set below the documented normal
// ceiling (30s): this adapter performs bounded, one-shot snapshot
// ingestion (not a long-lived service that can afford extended backoff),
// so a very large legitimate delay is capped more aggressively here than a
// long-running integration might choose - a documented, adapter-specific
// trade-off (see RTI-7F implementation report "cheap-now/expensive-later"),
// not a claim about Azure's own contract.
const MAX_RATE_LIMIT_WAIT_MS = 5000;
const FIELD_MAP_ALLOWED_KEYS = Object.freeze(["acceptanceCriteria"]);
const CONFIG_ALLOWED_KEYS = Object.freeze([
  "id",
  "organization",
  "project",
  "wiql",
  "auth",
  "fieldMap",
  "typeMap",
  "maxItems",
  "timeoutMs",
]);
const DEFAULT_AC_FIELD = "Microsoft.VSTS.Common.AcceptanceCriteria";
const PRIORITY_FIELD = "Microsoft.VSTS.Common.Priority";
// CORRECTIVE-BY-DESIGN (fixed from day one, see module docstring "HTML
// RESOURCE SAFETY"): bounds on the raw HTML input this module will
// tokenize. 200,000 characters comfortably exceeds any human-authored work
// item description (Azure's own "Long text field" object limit is
// documented at 1,000,000 characters - this bound is deliberately far
// below that vendor ceiling, to bound THIS module's own tokenization cost,
// not to reject legitimate Azure content).
const MAX_HTML_INPUT_LENGTH = 200000;
// Bounds the tokenizer's own open-tag stack depth. 64 comfortably exceeds
// any realistic human-authored nested list/table/blockquote structure,
// mirroring the same justified value Jira's ADF depth bound uses.
const MAX_HTML_NESTING_DEPTH = 64;

const ARTIFACT_TYPE_MAP = Object.freeze({
  "user story": "user-story",
  "product backlog item": "user-story",
  bug: "bug",
  requirement: "requirement",
});

// RTI-1's fixed vocabulary (scripts/ai/requirement-artifact.js) - this
// module never invents a new one; a caller-supplied typeMap target value
// not in this list fails closed at construction.
const RTI1_ARTIFACT_TYPES = Object.freeze([
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

// Only Azure system link types with an unambiguous RTI-1 semantic match -
// see module docstring RELATIONSHIPS section for why the forward/Child and
// both Dependency directions are deliberately NOT included here.
const RELATIONSHIP_TYPE_MAP = Object.freeze({
  "system.linktypes.hierarchy-reverse": "parent",
  "system.linktypes.related": "related",
});

const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "table", "tr"]);
const LIST_ITEM_TAGS = new Set(["li"]);
const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "area", "base", "col", "embed", "source", "track", "wbr"]);
const DISCARD_TAGS = new Set(["script", "style"]);

// --- Shared primitives (deliberately duplicated, not imported - matching
// this repository's own established "small duplicated primitives over
// premature shared abstraction" convention, same as Jira's) -------------

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

function isSafeWorkItemId(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

// --- Config validation (Boundary A - trusted, caller-supplied) ----------

function assertValidAzureDevOpsProviderConfig(config) {
  if (!isPlainDataObject(config)) {
    throw new Error("AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: AzureDevOpsRequirementsProvider requires a plain config object.");
  }
  const unknown = Object.keys(config).filter((key) => !CONFIG_ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: unrecognized config key(s): ${unknown.join(", ")}.`);
  }
  if (!isSafeBoundedString(config.id, MAX_STRING_LENGTH)) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "id" must be a non-empty, bounded, control-character-free string.');
  }
  const organization = validateOrganization(config.organization);
  const project = validateProject(config.project);
  if (!isNonEmptyString(config.wiql)) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "wiql" must be a non-empty string.');
  }
  const auth = validateAuth(config.auth);
  const fieldMap = validateFieldMap(config.fieldMap);
  const typeMap = validateTypeMap(config.typeMap);

  let maxItems = DEFAULT_MAX_ITEMS;
  if (config.maxItems !== undefined) {
    if (!isPositiveInteger(config.maxItems) || config.maxItems > MAX_MAX_ITEMS) {
      throw new Error(`AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "maxItems" must be a positive integer no greater than ${MAX_MAX_ITEMS} when supplied.`);
    }
    maxItems = config.maxItems;
  }

  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (config.timeoutMs !== undefined) {
    if (!isPositiveInteger(config.timeoutMs) || !Number.isFinite(config.timeoutMs)) {
      throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "timeoutMs" must be a positive, finite integer when supplied.');
    }
    timeoutMs = config.timeoutMs;
  }

  return Object.freeze({
    id: config.id,
    organization,
    project,
    wiql: config.wiql,
    auth,
    fieldMap,
    typeMap,
    maxItems,
    timeoutMs,
  });
}

// Deliberately minimal, not a strict slug regex (no verified official
// syntax was found during RTI-7E/7F research) - only the specific unsafe
// characters the mission's own design explicitly forbids. Always also
// percent-encoded before URL interpolation, defense-in-depth.
function validateOrganization(organization) {
  if (!isSafeBoundedString(organization, MAX_STRING_LENGTH)) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "organization" must be a non-empty, bounded, control-character-free string.');
  }
  if (/[/?#@]/.test(organization) || organization.includes("://")) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "organization" must not contain "/", "?", "#", "@", or a URL scheme.');
  }
  return organization;
}

// Project display names may contain spaces and other non-slug characters -
// deliberately NOT restricted to a slug format (percent-encoding handles
// safety at URL-construction time regardless of input character set).
function validateProject(project) {
  if (!isSafeBoundedString(project, MAX_STRING_LENGTH)) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "project" must be a non-empty, bounded, control-character-free string.');
  }
  return project;
}

function validateAuth(auth) {
  if (!isPlainDataObject(auth)) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "auth" must be a plain object.');
  }
  if (auth.type !== "pat" && auth.type !== "bearer") {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "auth.type" must be "pat" or "bearer".');
  }
  if (typeof auth.token !== "string" || auth.token.length === 0) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "auth.token" must be a non-empty string.');
  }
  const unknown = Object.keys(auth).filter((key) => key !== "type" && key !== "token");
  if (unknown.length > 0) {
    throw new Error(`AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "auth" has unrecognized key(s): ${unknown.join(", ")}.`);
  }
  return Object.freeze({ type: auth.type, token: auth.token });
}

function validateFieldMap(fieldMap) {
  if (fieldMap === undefined) return Object.freeze({});
  if (!isPlainDataObject(fieldMap)) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "fieldMap" must be a plain object when supplied.');
  }
  const unknown = Object.keys(fieldMap).filter((key) => !FIELD_MAP_ALLOWED_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new Error(`AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "fieldMap" has unrecognized key(s): ${unknown.join(", ")}.`);
  }
  if (fieldMap.acceptanceCriteria !== undefined && fieldMap.acceptanceCriteria !== null && !isNonEmptyString(fieldMap.acceptanceCriteria)) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "fieldMap.acceptanceCriteria" must be a non-empty string or null when supplied.');
  }
  return Object.freeze({ ...fieldMap });
}

function validateTypeMap(typeMap) {
  if (typeMap === undefined) return Object.freeze({});
  if (!isPlainDataObject(typeMap)) {
    throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "typeMap" must be a plain object when supplied.');
  }
  for (const [nativeType, target] of Object.entries(typeMap)) {
    if (!isSafeBoundedString(nativeType, MAX_STRING_LENGTH)) {
      throw new Error('AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "typeMap" keys must be non-empty, bounded, control-character-free strings.');
    }
    if (!RTI1_ARTIFACT_TYPES.includes(target)) {
      throw new Error(`AZURE_DEVOPS_PROVIDER_CONFIG_INVALID: "typeMap.${nativeType}" must be one of ${RTI1_ARTIFACT_TYPES.join(", ")}.`);
    }
  }
  return Object.freeze({ ...typeMap });
}

// --- Transport (native fetch, bounded timeout, bounded retry, Azure rate limits) --

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(headerValue) {
  if (typeof headerValue !== "string") return undefined;
  if (!/^\d+$/.test(headerValue.trim())) return undefined; // seconds form only
  const seconds = Number(headerValue.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RATE_LIMIT_WAIT_MS);
}

function backoffDelayMs(attempt) {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
}

function buildAuthHeader(auth) {
  if (auth.type === "pat") {
    return `Basic ${Buffer.from(`:${auth.token}`, "utf8").toString("base64")}`;
  }
  return `Bearer ${auth.token}`;
}

// `rateLimitState` is a per-read()-call mutable object ({ nextRequestNotBefore: 0 }),
// never module-level global state - see module docstring "AZURE RATE-LIMIT
// SEMANTICS". Honors a proactive 200+Retry-After hint from a PREVIOUS
// response before sending THIS request; a 429 on THIS request is retried
// (within the attempt budget) after honoring ITS OWN Retry-After.
async function azureFetch(url, body, config, rateLimitState) {
  const headers = {
    Authorization: buildAuthHeader(config.auth),
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    const now = Date.now();
    if (rateLimitState.nextRequestNotBefore > now) {
      await delay(rateLimitState.nextRequestNotBefore - now);
    }

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
        throw new Error(`Azure DevOps request failed after ${attempt} attempt(s): a network-level error occurred (${err.name || "Error"}).`);
      }
      await delay(backoffDelayMs(attempt));
      continue;
    }

    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
      throw new Error("Azure DevOps request received a redirect response; redirects are not followed.");
    }

    if (response.status === 429) {
      if (attempt === MAX_RETRY_ATTEMPTS) {
        throw new Error(`Azure DevOps request failed after ${attempt} attempt(s) with HTTP status 429.`);
      }
      const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
      await delay(retryAfterMs !== undefined ? retryAfterMs : backoffDelayMs(attempt));
      continue;
    }

    if (response.status >= 500 && response.status < 600) {
      if (attempt === MAX_RETRY_ATTEMPTS) {
        throw new Error(`Azure DevOps request failed after ${attempt} attempt(s) with HTTP status ${response.status}.`);
      }
      await delay(backoffDelayMs(attempt));
      continue;
    }

    if (!response.ok) {
      throw new Error(`Azure DevOps request failed with HTTP status ${response.status}.`);
    }

    // Successful response - if it carries a proactive throttle hint, honor
    // the delay before the NEXT outbound request only. Do NOT retry this
    // (already-successful) response.
    const proactiveDelayMs = parseRetryAfterMs(response.headers.get("retry-after"));
    if (proactiveDelayMs !== undefined) {
      rateLimitState.nextRequestNotBefore = Date.now() + proactiveDelayMs;
    }

    return response;
  }
  /* istanbul ignore next - loop always returns or throws above */
  throw new Error("Azure DevOps request failed: retry loop exited unexpectedly.");
}

// --- WIQL (query for work item ID references only) ----------------------

function buildInstanceBase(config) {
  return `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}`;
}

function buildWiqlUrl(config) {
  return `${buildInstanceBase(config)}/_apis/wit/wiql?api-version=${API_VERSION}`;
}

function buildWiqlBody(wiql) {
  return JSON.stringify({ query: wiql });
}

function validateWiqlResponseShape(payload) {
  if (!isPlainDataObject(payload)) {
    throw new Error("Azure DevOps WIQL response was not a JSON object.");
  }
  if (payload.queryType !== "flat" || payload.queryResultType !== "workItem") {
    throw new Error(`Azure DevOps WIQL query resolved to an unsupported query type (queryType=${JSON.stringify(payload.queryType)}); only flat work item queries are supported.`);
  }
  if (!Array.isArray(payload.workItems)) {
    throw new Error('Azure DevOps WIQL response "workItems" was not an array.');
  }
  const seen = new Set();
  payload.workItems.forEach((ref, index) => {
    if (!isPlainDataObject(ref) || !isSafeWorkItemId(ref.id)) {
      throw new Error(`Azure DevOps WIQL response workItems[${index}].id was missing or invalid.`);
    }
    if (seen.has(ref.id)) {
      throw new Error("Azure DevOps WIQL response contained a duplicate work item id; refusing to treat an inconsistent vendor response as a valid snapshot.");
    }
    seen.add(ref.id);
  });
}

async function fetchWiqlIds(config, rateLimitState) {
  const url = buildWiqlUrl(config);
  const body = buildWiqlBody(config.wiql);
  const response = await azureFetch(url, body, config, rateLimitState);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Azure DevOps WIQL response body was not valid JSON.");
  }
  validateWiqlResponseShape(payload);

  const ids = payload.workItems.map((ref) => ref.id);

  // Fail-closed guard against Azure's own documented, silent 20,000-item
  // WIQL result cap - see module docstring MAXITEMS section. This
  // deliberately rejects even a genuine exactly-20,000-item snapshot,
  // since completeness cannot be distinguished from silent truncation.
  if (ids.length >= WIQL_RESULT_HARD_CAP) {
    throw new Error(`Azure DevOps WIQL query returned ${ids.length} work items, at or beyond Azure's own undocumented-in-response 20,000-item result cap; completeness cannot be verified, refusing to risk a silently truncated snapshot.`);
  }
  if (ids.length > config.maxItems) {
    throw new Error(`Azure DevOps WIQL result set (${ids.length} items) exceeds the configured maxItems bound (${config.maxItems}).`);
  }

  return ids;
}

// --- Work Items Batch (full field + relation retrieval) ------------------

function buildBatchUrl(config) {
  return `${buildInstanceBase(config)}/_apis/wit/workitemsbatch?api-version=${API_VERSION}`;
}

function buildRequestedFields(config) {
  const fields = ["System.Title", "System.WorkItemType", "System.Description", "System.Tags", "System.State", PRIORITY_FIELD];
  const acField = config.fieldMap.acceptanceCriteria === undefined ? DEFAULT_AC_FIELD : config.fieldMap.acceptanceCriteria;
  if (acField) fields.push(acField);
  return [...new Set(fields)];
}

function buildBatchBody(ids, fields) {
  return JSON.stringify({ ids, fields, $expand: "Relations", errorPolicy: "Fail" });
}

function partitionIntoBatches(ids, size) {
  const batches = [];
  for (let i = 0; i < ids.length; i += size) {
    batches.push(ids.slice(i, i + size));
  }
  return batches;
}

function validateBatchResponseShape(payload) {
  if (!isPlainDataObject(payload)) {
    throw new Error("Azure DevOps batch response was not a JSON object.");
  }
  if (!Array.isArray(payload.value)) {
    throw new Error('Azure DevOps batch response "value" was not an array.');
  }
  if (typeof payload.count === "number" && payload.count !== payload.value.length) {
    throw new Error('Azure DevOps batch response "count" did not match the length of "value".');
  }
  payload.value.forEach((item, index) => validateWorkItemShape(item, index));
}

function validateWorkItemShape(item, index) {
  if (!isPlainDataObject(item)) {
    throw new Error(`Azure DevOps batch response value[${index}] was not a JSON object.`);
  }
  if (!isSafeWorkItemId(item.id)) {
    throw new Error(`Azure DevOps batch response value[${index}].id was missing or invalid.`);
  }
  if (!isPositiveInteger(item.rev)) {
    throw new Error(`Azure DevOps batch response value[${index}].rev was missing or invalid.`);
  }
  if (!isPlainDataObject(item.fields)) {
    throw new Error(`Azure DevOps batch response value[${index}].fields was missing or invalid.`);
  }
  if (item.relations !== undefined && !Array.isArray(item.relations)) {
    throw new Error(`Azure DevOps batch response value[${index}].relations was present but not an array.`);
  }
}

async function fetchAllWorkItems(config, ids, rateLimitState) {
  if (ids.length === 0) return [];

  const fields = buildRequestedFields(config);
  const url = buildBatchUrl(config);
  const batches = partitionIntoBatches(ids, AZURE_BATCH_SIZE);
  const collected = [];

  for (const batchIds of batches) {
    const body = buildBatchBody(batchIds, fields);
    const response = await azureFetch(url, body, config, rateLimitState);

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error("Azure DevOps batch response body was not valid JSON.");
    }
    validateBatchResponseShape(payload);

    // Independent defense-in-depth reconciliation - do not trust
    // errorPolicy:"Fail" alone (see module docstring). Any missing,
    // extra, or duplicate id fails the whole read closed.
    const requestedSet = new Set(batchIds);
    const returnedSet = new Set();
    for (const item of payload.value) {
      if (returnedSet.has(item.id)) {
        throw new Error("Azure DevOps batch response contained a duplicate work item id.");
      }
      returnedSet.add(item.id);
      if (!requestedSet.has(item.id)) {
        throw new Error("Azure DevOps batch response contained a work item id that was not requested.");
      }
    }
    if (returnedSet.size !== requestedSet.size) {
      throw new Error("Azure DevOps batch response did not return all requested work item ids.");
    }

    collected.push(...payload.value);
  }

  return collected;
}

// --- HTML (Azure rich-text field) -> deterministic plain text -----------
//
// A single-pass, ITERATIVE state machine (explicit array-based open-tag
// stack - never a recursive-descent parser, so there is no call-stack
// depth risk by construction; MAX_HTML_NESTING_DEPTH instead bounds the
// stack's own size, rejecting pathological markup cleanly). See module
// docstring "HTML RESOURCE SAFETY IS FIXED FROM DAY ONE".
//
// Boundary model: BLOCK_TAGS (p/div/h1-6/blockquote/pre/ul/ol/table/tr)
// open OR close -> a "block" boundary (renders as a blank line). LI closes
// -> a "soft" boundary (renders as a single newline). `br` (void) -> an
// immediate "soft" boundary. Consecutive boundaries collapse to the
// strongest one seen. Leading/trailing boundaries are dropped.
const NAMED_ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
});

function decodeEntitiesOnce(text) {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);?/g, (match, body) => {
    if (body[0] === "#") {
      const isHex = body[1] === "x" || body[1] === "X";
      const codePoint = isHex ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return match;
      }
    }
    const lower = body.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, lower) && match.endsWith(";")) {
      return NAMED_ENTITIES[lower];
    }
    return match; // unrecognized/malformed entity - left as literal text, never dropped
  });
}

function parseTagName(tagContent) {
  const match = /^\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tagContent);
  return match ? match[1].toLowerCase() : null;
}

function htmlToPlainText(html, fieldLabel) {
  if (html === null || html === undefined) return "";
  if (typeof html !== "string") {
    throw new Error(`Azure DevOps field "${fieldLabel}" was not a string.`);
  }
  if (html.length > MAX_HTML_INPUT_LENGTH) {
    throw new Error(`Azure DevOps field "${fieldLabel}" exceeds the maximum supported input length (${MAX_HTML_INPUT_LENGTH}).`);
  }

  const segments = []; // array of { text } or { boundary: "soft" | "block" }
  const stack = [];
  let discardTag = null; // tag name we are currently discarding content for (script/style)
  let i = 0;
  const n = html.length;

  function pushBoundary(kind) {
    segments.push({ boundary: kind });
  }

  while (i < n) {
    const ch = html[i];

    if (ch === "<") {
      const next = html[i + 1];
      const looksLikeTag = next === "/" || next === "!" || (next && /[a-zA-Z]/.test(next));
      if (!looksLikeTag) {
        // A literal "<" in prose (e.g. "5 < 10") - not ambiguous, emit as text.
        if (discardTag === null) segments.push({ text: "<" });
        i += 1;
        continue;
      }

      const closeIdx = html.indexOf(">", i + 1);
      if (closeIdx === -1) {
        throw new Error(`Azure DevOps field "${fieldLabel}" contains a truncated/malformed tag (no closing ">" found).`);
      }

      const raw = html.slice(i + 1, closeIdx);

      if (raw.startsWith("!--")) {
        const commentEnd = html.indexOf("-->", i + 4);
        if (commentEnd === -1) {
          throw new Error(`Azure DevOps field "${fieldLabel}" contains an unterminated HTML comment.`);
        }
        i = commentEnd + 3;
        continue;
      }
      if (raw.startsWith("!")) {
        // DOCTYPE or other declaration - skip, no text extracted.
        i = closeIdx + 1;
        continue;
      }

      const isClosing = raw.startsWith("/");
      const isSelfClosing = raw.endsWith("/");
      const tagName = parseTagName(raw);

      if (tagName === null) {
        // "<" followed by something that isn't a valid tag-name start
        // (e.g. "<3 friends>") - unambiguous enough to treat as literal text.
        if (discardTag === null) segments.push({ text: html.slice(i, closeIdx + 1) });
        i = closeIdx + 1;
        continue;
      }

      if (discardTag !== null) {
        if (isClosing && tagName === discardTag) {
          discardTag = null;
        }
        i = closeIdx + 1;
        continue;
      }

      if (DISCARD_TAGS.has(tagName) && !isClosing && !isSelfClosing) {
        discardTag = tagName;
        i = closeIdx + 1;
        continue;
      }

      if (VOID_TAGS.has(tagName)) {
        if (tagName === "br") pushBoundary("soft");
        i = closeIdx + 1;
        continue;
      }

      if (!isSelfClosing) {
        if (isClosing) {
          if (stack.length > 0 && stack[stack.length - 1] === tagName) stack.pop();
          if (BLOCK_TAGS.has(tagName)) pushBoundary("block");
          else if (LIST_ITEM_TAGS.has(tagName)) pushBoundary("soft");
        } else {
          if (stack.length >= MAX_HTML_NESTING_DEPTH) {
            throw new Error(`Azure DevOps field "${fieldLabel}" exceeds the maximum supported tag nesting depth (${MAX_HTML_NESTING_DEPTH}).`);
          }
          stack.push(tagName);
          if (BLOCK_TAGS.has(tagName)) pushBoundary("block");
        }
      }

      i = closeIdx + 1;
      continue;
    }

    // Plain text run until the next "<" (or end of input).
    const nextTag = html.indexOf("<", i);
    const end = nextTag === -1 ? n : nextTag;
    const raw = html.slice(i, end);
    if (discardTag === null && raw.length > 0) {
      segments.push({ text: decodeEntitiesOnce(raw) });
    }
    i = end;
  }

  if (discardTag !== null) {
    throw new Error(`Azure DevOps field "${fieldLabel}" contains an unterminated <${discardTag}> element.`);
  }

  // Concatenate text segments in source order, inserting an explicit break
  // at each resolved boundary ("block" beats "soft" when several boundary
  // markers are adjacent). Segment text is NOT individually trimmed here -
  // inline HTML whitespace (e.g. the trailing space in
  // "<strong>Bold </strong>and normal.") is genuine content spacing and
  // must survive being split across a tag boundary, unlike Jira's ADF text
  // nodes which never require this because ADF has no comparable inline
  // tag-splitting. Final whitespace normalization below cleans up any
  // resulting redundant spacing around the explicit breaks.
  const parts = [];
  let pendingBoundary = null;
  for (const seg of segments) {
    if (seg.boundary) {
      if (pendingBoundary !== "block") pendingBoundary = seg.boundary;
      continue;
    }
    if (pendingBoundary) {
      parts.push(pendingBoundary === "block" ? "\n\n" : "\n");
      pendingBoundary = null;
    }
    parts.push(seg.text.replace(/\s+/g, (m) => (m.includes("\n") ? "\n" : " ")));
  }

  return parts
    .join("")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

// --- Relation target extraction ------------------------------------------

function extractWorkItemIdFromRelationUrl(url) {
  if (typeof url !== "string" || url.length === 0) return undefined;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  if (!/^\d+$/.test(last || "")) return undefined;
  const id = Number(last);
  return isSafeWorkItemId(id) ? id : undefined;
}

function mapRelationship(relation, config, index) {
  if (!isPlainDataObject(relation) || !isNonEmptyString(relation.rel)) {
    throw new Error(`Azure DevOps work item relation[${index}] had a missing or invalid "rel".`);
  }
  const relKey = relation.rel.toLowerCase();
  const relationshipType = RELATIONSHIP_TYPE_MAP[relKey];
  if (!relationshipType) {
    return null; // well-formed but unmapped relation type - omitted, never guessed
  }
  const targetId = extractWorkItemIdFromRelationUrl(relation.url);
  if (targetId === undefined) {
    throw new Error(`Azure DevOps work item relation[${index}] had a missing or invalid target "url".`);
  }
  return { type: relationshipType, targetId: `${config.id}:${targetId}` };
}

// --- Type mapping ----------------------------------------------------------

function mapArtifactType(nativeType, typeMap) {
  const normalized = typeof nativeType === "string" ? nativeType.trim().toLowerCase() : "";
  if (Object.prototype.hasOwnProperty.call(typeMap, nativeType)) {
    return typeMap[nativeType];
  }
  return ARTIFACT_TYPE_MAP[normalized] || "other";
}

// --- Normalization: native WorkItem -> RequirementArtifact ---------------

function normalizeWorkItem(config, workItem, instanceSystem) {
  const fields = workItem.fields;
  const artifact = {
    id: `${config.id}:${workItem.id}`,
    type: mapArtifactType(fields["System.WorkItemType"], config.typeMap),
    title: isNonEmptyString(fields["System.Title"]) ? fields["System.Title"] : undefined,
    source: {
      type: "azure-devops",
      sourceId: String(workItem.id),
      system: instanceSystem,
      location: `https://dev.azure.com/${encodeURIComponent(config.organization)}/${encodeURIComponent(config.project)}/_workitems/edit/${workItem.id}/`,
      version: String(workItem.rev),
    },
  };
  if (!isNonEmptyString(artifact.title)) delete artifact.title;

  const content = htmlToPlainText(fields["System.Description"], "System.Description");
  if (content.length > 0) {
    artifact.content = content;
  }

  const acFieldName = config.fieldMap.acceptanceCriteria === undefined ? DEFAULT_AC_FIELD : config.fieldMap.acceptanceCriteria;
  if (acFieldName) {
    const text = htmlToPlainText(fields[acFieldName], acFieldName);
    if (text.length > 0) {
      artifact.acceptanceCriteria = [{ text }];
    }
  }

  const priorityRaw = fields[PRIORITY_FIELD];
  if (typeof priorityRaw === "string" || typeof priorityRaw === "number") {
    const priorityText = String(priorityRaw).trim();
    if (priorityText.length > 0) artifact.priority = priorityText;
  }

  if (typeof fields["System.Tags"] === "string") {
    const labels = [...new Set(fields["System.Tags"].split(";").map((t) => t.trim()).filter((t) => t.length > 0))];
    if (labels.length > 0) artifact.labels = labels;
  }

  if (Array.isArray(workItem.relations) && workItem.relations.length > 0) {
    const relationships = [];
    workItem.relations.forEach((relation, index) => {
      const mapped = mapRelationship(relation, config, index);
      if (mapped) relationships.push(mapped);
    });
    if (relationships.length > 0) artifact.relationships = relationships;
  }

  const metadata = {};
  if (isNonEmptyString(fields["System.WorkItemType"])) metadata.workItemType = fields["System.WorkItemType"];
  if (isNonEmptyString(fields["System.State"])) metadata.state = fields["System.State"];
  if (Object.keys(metadata).length > 0) artifact.metadata = metadata;

  return artifact;
}

/**
 * Azure DevOps Services RequirementsSourceProvider (Roadmap RTI-7F). See
 * this module's own docstring for the full contract, identity/provenance
 * model, WIQL-then-batch retrieval policy, rate-limit/retry/timeout policy,
 * and error/secret-safety discipline.
 */
class AzureDevOpsRequirementsProvider {
  #config;
  #instanceSystem;

  constructor(config) {
    this.#config = assertValidAzureDevOpsProviderConfig(config);
    this.#instanceSystem = `${this.#config.organization}/${this.#config.project}`;
  }

  get id() {
    return this.#config.id;
  }

  async read() {
    const rateLimitState = { nextRequestNotBefore: 0 };
    const ids = await fetchWiqlIds(this.#config, rateLimitState);
    const workItems = await fetchAllWorkItems(this.#config, ids, rateLimitState);
    workItems.sort((a, b) => a.id - b.id);
    return workItems.map((workItem) => normalizeWorkItem(this.#config, workItem, this.#instanceSystem));
  }
}

module.exports = {
  AzureDevOpsRequirementsProvider,
};
