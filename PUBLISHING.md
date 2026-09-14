# Test Design Publishing / Destination Authoring Contract

This document is the durable architectural record of Roadmap **RTI-8 — Test
Case Publishing / Destinations**, the write-side counterpart to
[PROVIDERS.md](PROVIDERS.md) (RTI-7's read-side record). It exists because
RTI-8 built a generic, vendor-neutral publishing boundary (RTI-8B) and then
proved it against one real, independently hardened concrete destination —
Azure DevOps Test Case work items (RTI-8F) — and against a real cross-vendor
flow that ingests from a *different* vendor (Jira) entirely (RTI-8J).

If you are about to write a `TestDesignDestination` adapter, this is the
contract to build against. If you are reviewing one, this is the checklist to
review it against.

## RTI-8 achievement summary

RTI-8 set out to answer two questions: does a generic `TestDesignDestination`
contract exist that can carry a canonical `TestDesignArtifact[]` (RTI-4) to
an arbitrary external test-management system without leaking vendor
semantics into the generic core — and, if a concrete destination is built for
one vendor, can requirements sourced from an *entirely different* vendor
still reach it with zero bridging code?

```ts
interface TestDesignDestination {
  readonly id: string;
  publish(request: TestDesignPublishRequest):
    Promise<TestDesignPublishResult> | TestDesignPublishResult;
}
```

One real, independently reviewed, adversarially hardened, merged destination
now answers the first question — **Azure DevOps Test Case** (`RTI-8F`) — and
a real, independently reviewed, offline-deterministic integrated proof (using
the already-`COMPLETE_ON_MAIN` `JiraRequirementsProvider` as the source)
answers the second — **`RTI-8J`, VENDOR INDEPENDENCE: PROVEN**.

## Current destination status

- **Generic Publishing Core: `COMPLETE_ON_MAIN`** (`scripts/ai/test-design-publishing.js`,
  `publishTestDesigns(destination, request)`). Pre-side-effect validation
  (destination shape, request shape, `MAX_PUBLISH_BATCH_SIZE=500`,
  per-artifact `assertValidTestDesignArtifact`, duplicate-id rejection),
  fresh deeply-frozen canonical copies handed to the destination (closing a
  real input-immutability finding from independent review — see
  [Carry-forward debt](#carry-forward-debt)), untrusted-result validation,
  input-order result reprojection, and a frozen canonical
  `TestDesignPublishResult`.
- **Azure DevOps Test Case Destination: `COMPLETE_ON_MAIN`**
  (`scripts/ai/destinations/azure-devops-test-case-destination.js`,
  `qa-ai-agent/destinations/azure-devops`). `CREATE_ONLY`, sequential,
  never-retried `POST` to Azure's documented Work Item Create REST API
  (`https://dev.azure.com/{organization}/{project}/_apis/wit/workitems/$Test%20Case?api-version=7.1`),
  mapping only `TestDesignArtifact.title → System.Title` and
  `objective`/`expectedResults → System.Description` (HTML-escaped), caller-owned
  PAT/Bearer auth, a fixed Azure DevOps Services network authority (no
  caller-supplied `baseUrl`, no Server/TFS support), global short-circuit on
  conditions likely to recur (401/403/404-target/429/redirect/ambiguous
  5xx-or-transport failure) vs. per-item continuation on conditions that are
  plausibly item-specific (400/409), a true private `#config` field so no
  introspection vector (`JSON.stringify`, `Object.keys`, spread, `util.inspect`
  with hidden properties, ...) can ever observe the configured credential,
  and cross-vendor-safe treatment of `requirementId` (never parsed, never
  assumed Azure-native, never used to construct a work-item relation). Live
  Azure proof: **deferred** (no sandbox credentials; does not block
  completeness — matches the identical, already-established policy for the
  RTI-7 read-side adapters).
- **Cross-Vendor Integrated Proof (`RTI-8J`): `COMPLETE` — `VENDOR INDEPENDENCE: PROVEN`.**
  A real `JiraRequirementsProvider` instance ingested a realistic native Jira
  payload; the resulting `RequirementArtifact[]` passed through the real,
  unmodified quality evaluator, the real test-design generator, and the real
  generic publisher; and a real `AzureDevOpsTestCaseDestination` instance
  received the result — with a distinct `destination.id` from `provider.id`,
  distinct caller-owned credentials for each side, and the Jira-origin
  `requirementId` (`"jira-prod:PROJ-999"`-shaped) confirmed absent from every
  outbound Azure request body. See
  [Cross-vendor proof](#cross-vendor-proof) below for the full evidence
  summary.

Both the generic contract and the concrete destination's public constructor,
config shape, and worked examples live in the main
[README.md](README.md#roadmap-rti--requirements--test-design-integration)
under `RTI-8B` and `RTI-8F` respectively — this document does not duplicate
those examples, only the durable principles behind them.

## The destination authoring contract

Normative keywords (`MUST`, `SHOULD`, `MAY`) follow the identical convention
established in [PROVIDERS.md](PROVIDERS.md).

### MUST

A `TestDesignDestination` implementation **MUST**:

1. Expose a stable `id` getter and a `publish(request)` method, implementing
   the interface above exactly — no additional required members.
2. Own all vendor-specific configuration at construction time. `publish()`
   itself takes only the generic `TestDesignPublishRequest`; nothing about
   *how* to reach the vendor is decided at call time.
3. Keep configuration **data-only** — no executable callbacks, no
   fetch/transport injection.
4. Use an **explicit** network authority, established at construction —
   either a caller-supplied, validated origin, or (as Azure DevOps does) an
   internally constructed one built only from validated, non-URL config
   fields. Never discovered from `cwd`, environment variables, or any
   ambient source.
5. Consume **caller-owned credentials only** — never discover, request,
   prompt for, or acquire/refresh one itself.
6. Store credentials in a way that cannot leak through ordinary
   introspection of the destination instance (`JSON.stringify`,
   `Object.keys`/`values`/`entries`, object spread, `Object.assign`,
   `util.inspect` with hidden properties shown). A true private class field
   (`#config`) is the pattern both this contract and the Azure destination
   use — an underscore-prefixed convention (`this._config`) is **not**
   sufficient, since it remains a fully enumerable own property.
7. Treat every field of its own network **response as untrusted data** —
   validate shape and every value before it becomes part of a returned
   `PublishedTestDesignItem` (a positive-safe-integer check before
   normalizing a remote numeric id to `String(...)`, for example).
8. **Never automatically retry** a create/write request for any HTTP status
   or transport failure unless the destination has independently proven the
   underlying remote operation is idempotent. See [No write retry](#create_only-and-no-write-retry)
   below for why this is a hard requirement, not a style preference.
9. Process a `TestDesignPublishRequest`'s `testDesigns[]` **sequentially, in
   input order** — never `Promise.all`/concurrent writes — so a global
   short-circuit decision can be made deterministically before any later
   item is attempted.
10. Return exactly one `PublishedTestDesignItem` per input `TestDesignArtifact.id`,
    using the generic `CREATED`/`FAILED` status vocabulary only — no
    destination-specific status value.
11. **Never fabricate content** the canonical `TestDesignArtifact` does not
    provide — no invented action/step text, no guessed field values. See
    [No fabricated test steps](#no-fabricated-test-steps) below.
12. Treat `requirementId`, `source.requirementId`, `criterionId`, and
    `criterionIndex` as **fully opaque** — never parsed, never assumed to
    belong to this destination's own vendor, never used to construct a
    relation, link, or lookup key. This is what keeps a destination
    cross-vendor-safe (see [Cross-vendor proof](#cross-vendor-proof)).
13. **Never place secrets in a thrown error, log, or returned result field**
    — no tokens, no constructed `Authorization` header value, no raw HTTP
    response bodies. Diagnostics are limited to a fixed, bounded message per
    error code plus safe context (HTTP status, `testDesignId`).
14. **Bound every outbound network request's timeout.**
15. **Keep all vendor-specific transport, mapping, and authentication logic
    inside the destination itself** — the generic publishing core
    (`scripts/ai/test-design-publishing.js`) must never grow vendor-name
    branches, vendor-specific config fields, or vendor-specific validation.

### SHOULD

A `TestDesignDestination` implementation **SHOULD**:

1. Ship fully deterministic, **offline** tests — a real local HTTP server
   plus a narrow, test-only `fetch`-origin-rewrite, exactly mirroring the
   read-side adapters' own test architecture (see
   [Testing and CI policy](#testing-and-ci-policy)).
2. Distinguish, in its own error taxonomy, at least: local
   config/validation failure, an ordinary item-local write failure that
   should not stop the batch, a condition likely to recur for every
   remaining item (global short-circuit), an ambiguous outcome where the
   remote write may or may not have happened, and "not attempted" (skipped
   after a global short-circuit) — Azure's nine-code taxonomy
   (`AZURE_TEST_CASE_DESTINATION_CONFIG_INVALID`, `CREATE_REJECTED`,
   `AUTH_FAILED`, `PERMISSION_DENIED`, `TARGET_NOT_FOUND`, `RATE_LIMITED`,
   `REDIRECT_BLOCKED`, `RESPONSE_INVALID`, `OUTCOME_UNKNOWN`,
   `NOT_ATTEMPTED`) is a worked reference, not a mandated vocabulary.
3. Reject unknown top-level and nested config keys at construction, rather
   than silently ignoring typos or unsupported options.
4. Be exposed via a **package subpath**, never expanding the root package
   export surface (see [Package and registry model](#package-and-registry-model)).
5. Treat a live vendor integration proof as **optional and non-blocking** —
   classify honestly as `PERFORMED` or `DEFERRED`, exactly as the read-side
   contract requires.

### MAY

A `TestDesignDestination` implementation **MAY**:

1. Support more than one caller-owned authentication form when the vendor's
   own ecosystem genuinely offers more than one (Azure's PAT-or-Bearer
   union).
2. Use destination-specific timeout numeric defaults, justified by that
   vendor's own documented behavior.
3. Treat a response validation failure or an unexpected HTTP status as
   either item-local (continue) or global (short-circuit) according to its
   own vendor's actual retry-safety characteristics — this classification is
   legitimately vendor-specific; only the *distinction itself*
   (item-local vs. global vs. ambiguous vs. not-attempted) is generic.

## `publishTestDesigns()` — the supported generic composition boundary

```js
const { publishTestDesigns } = require("qa-ai-agent");

const result = await publishTestDesigns(destination, { testDesigns });
```

`publishTestDesigns(destination, request)` is the **one supported way** to
invoke any `TestDesignDestination` in a caller's own code. It supplies every
generic guarantee this contract depends on:

- Pre-side-effect validation of the destination's shape, the request's
  shape, the `500`-item batch-size bound, and every individual
  `TestDesignArtifact` (via RTI-4's own `assertValidTestDesignArtifact`) —
  all completing, with **zero** calls to `destination.publish()`, before
  that call happens at all.
- Duplicate-`TestDesignArtifact.id` rejection — proven, in the RTI-8J
  cross-vendor proof, to reject a duplicate-id request with **zero** calls
  to the destination's `publish()` method.
- Fresh, deeply-frozen canonical copies of every `TestDesignArtifact` handed
  to the destination — the caller's own original objects are never exposed
  to, or mutable by, destination code (closes the RTI-8C-found
  input-immutability finding; see [Carry-forward debt](#carry-forward-debt)).
- Untrusted-result validation of whatever `destination.publish()` returns
  (plain-object shape, allowed keys, `destinationId` equality, exactly one
  result item per input id, a strict `CREATED`/`FAILED` status vocabulary
  with status-specific required/forbidden fields).
- Input-order result reprojection — the destination's own result-item order
  is never trusted; `publishTestDesigns()` re-projects `items[]` into the
  request's own `testDesigns[]` input order.
- A frozen canonical `TestDesignPublishResult` returned to the caller.

### Direct `destination.publish()` — trust model

A concrete destination's own `publish()` method (e.g.
`AzureDevOpsTestCaseDestination.prototype.publish`) is an **implementation**
of the generic contract, not itself a re-statement of `publishTestDesigns()`'s
validation/immutability/reprojection guarantees. Calling a destination's
`publish()` directly, bypassing `publishTestDesigns()`, skips every guarantee
listed above — pre-side-effect batch/duplicate validation, canonical
deep-freeze, and result reprojection all live in the generic layer, not in
any individual destination.

This was confirmed by RTI-8G's own independent review: a directly-supplied,
malformed artifact (missing `id`/`requirementId`/`source`, but with valid
`title`/`objective`/`expectedResults`) still triggers a real network write
when `publish()` is called directly, producing a `CREATED` result with no
`testDesignId` correlation back to any caller artifact — classified LOW/INFO,
not a regression from RTI-8A's already-approved architecture (which always
assigned canonical validation to the generic runner, never to individual
destinations), and fully mitigated by using the documented, recommended path:

> **Use `publishTestDesigns()` as the public generic publishing boundary.**
> Concrete destination `publish()` implementations assume canonically valid
> `TestDesignArtifact` input and are primarily intended to be invoked through
> the generic publisher.

## `CREATE_ONLY` and no write retry

Every current concrete destination is `CREATE_ONLY`: it maps each
`TestDesignArtifact` to exactly one create request and has **no** search,
update, upsert, deduplicate, or delete capability. Concretely for Azure:

- `publish()` never automatically retries a create request, for **any** HTTP
  status or transport failure, even when a `Retry-After` hint is present.
  Creating a Test Case is **not idempotent** — replaying a request whose
  response was merely lost (not necessarily failed) risks a duplicate remote
  work item.
- **Repeated execution of the same whole pipeline may create duplicate
  remote Test Cases.** This is expected current behavior, not a defect — a
  caller who re-runs a `publishTestDesigns()` call (or the whole
  ingest-quality-generate-publish pipeline) assumes that duplication risk
  themselves. No idempotency key or dedupe mechanism exists today.
- Publication results are **returned in memory only**. No durable generic
  publication mapping (requirement → remote Test Case) is persisted by this
  codebase; a caller wanting restart-safe reconciliation must build and own
  that themselves.

## Ambiguous outcomes and partial side effects

- **`AZURE_TEST_CASE_OUTCOME_UNKNOWN`** (and the equivalent concept any
  future destination's taxonomy should carry): a timeout, a connection
  failure after the request was sent, a 5xx response, or a malformed-but-2xx
  response are all conditions where the remote write **may already have
  succeeded** — every such error message says so explicitly (`"...may have
  occurred..."`), and none of these conditions is retried and none implies
  rollback. This codebase has no way to undo a side effect that may have
  already occurred.
- **`AZURE_TEST_CASE_NOT_ATTEMPTED`**: assigned to every item skipped after
  a *global* short-circuit (a condition highly likely to recur identically
  for every remaining item: 401/403/404-target/429/blocked-redirect/ambiguous
  5xx-or-transport). This is deliberately distinct, at the canonical result
  level, from an item whose own create request genuinely failed — a caller
  can never mistake "never tried" for "tried and failed."
- **Publishing is best-effort per item.** `TestDesignPublishResult.allSucceeded
  === false` never implies any kind of rollback occurred, and this codebase
  makes no transactional/atomic claim about a `publish()` call once the
  first request has been sent — see `publishTestDesigns()`'s own docstring
  for the exact "pre-side-effect validation is the one hard guarantee"
  wording this contract is built on.

## No fabricated test steps

The current canonical `TestDesignArtifact` shape (`id`, `requirementId`,
`title`, `objective`, `expectedResults`, `source`) has **no grounded
action/step model**. Azure's proprietary `Microsoft.VSTS.TCM.Steps` field
(structured `ActionStep`/`ValidateStep` XML, each needing a populated
"action" description) is **deliberately never populated in v1** — doing so
would require inventing an action description that does not exist in the
canonical input, violating the same no-fabrication invariant RTI-3/RTI-4
already enforce upstream (never invent a missing timeout, HTTP status,
actor, or procedural UI/API step). `System.Title` + `System.Description`
(objective + expected results, HTML-escaped) is a complete, non-fabricating
v1 Test Case — independently verified against Azure's own documented sample,
which requires only `System.Title`. No custom Azure field is populated
either, for the identical reason: none has a grounded source in the
canonical artifact today.

## Cross-vendor proof

**Vendor independence has been demonstrated across the RTI pipeline using
Jira as a requirements source and Azure DevOps Test Case work items as the
publishing destination.** This is a specific, evidenced claim about one
real cross-vendor pair — it does **not** claim every possible vendor
combination is supported, or that a universal adapter model exists; it
proves the *architecture* imposes no vendor-pairing coupling, which is the
property a future third or fourth adapter (in either direction) depends on.

Evidence (Roadmap `RTI-8J`, full report on the `RTI-8J` mission branch
history):

- A real `JiraRequirementsProvider` ingested a realistic native Jira issue
  payload (including HTML/ADF-significant content) via a real local HTTP
  mock transport; the resulting `RequirementArtifact[]` passed through the
  real, unmodified `analyzeRequirementsQuality`, `generateTestDesigns`, and
  `publishTestDesigns` — no manually fabricated intermediate object
  substituted for any real stage.
- A real `AzureDevOpsTestCaseDestination`, constructed with a distinct
  `destination.id` from `provider.id` and a distinct credential marker,
  received the resulting `TestDesignArtifact[]` and produced real Azure
  work-item create requests.
- The Jira-origin `requirementId` (`"jira-prod:PROJ-999"`-shaped) was
  confirmed **absent** from every outbound Azure request body; no Azure
  relation/`System.LinkTypes.*`/work-item-relation was constructed from it.
  Planted HTML-significant content (`< > & " ' <script>`) from the real Jira
  payload survived, correctly escaped, into the final Azure
  `System.Description` field.
- Jira and Azure credentials, each with a distinct marker, were confirmed to
  appear **only** in their own transport's `Authorization` header, never
  crossing over, and never appearing in any `RequirementArtifact`, quality
  result, `TestDesignArtifact`, publish result, or error.
- A static audit of the generic core
  (`test-design-publishing.js`, `test-design.js`, `requirement-quality.js`,
  `requirement-traceability.js`, `requirements-source-provider.js`) found
  **zero** occurrences of the literal strings "jira"/"azure" — no
  vendor-name branch, no bridge, no mapper, no registry exists anywhere in
  the generic core.
- A fresh `npm pack` + `npm install` into a new external consumer,
  using only `qa-ai-agent`, `qa-ai-agent/providers/jira`, and
  `qa-ai-agent/destinations/azure-devops` (no deep imports), reproduced the
  identical cross-vendor flow successfully.
- **Is `AzureDevOpsTestCaseDestination` coupled to `JiraRequirementsProvider`?
  No** — it never imports Jira code, never reads `source.type`, and never
  parses `requirementId`.

**Known limitation, honestly carried, not a vendor-independence failure**:
the current `JiraRequirementsProvider` maps its configured
acceptance-criteria custom field into exactly **one** `acceptanceCriteria`
entry per Jira issue — a single Jira issue cannot today produce more than
one criterion entry through this provider. This is a Jira-adapter-local
characteristic, unrelated to whether the destination side is vendor-coupled.

## Package and registry model

Public destination access is exclusively via package subpath:

```js
const { AzureDevOpsTestCaseDestination } = require("qa-ai-agent/destinations/azure-devops");
```

The root package export (`require("qa-ai-agent")`) stays generic — **19**
exports as of `RTI-8B` (the 18th and 19th being
`assertValidTestDesignArtifact` and `publishTestDesigns`), with **no**
vendor destination ever added to it. Deep imports to a destination's
internal file path are blocked by the package's own `exports` map. This
mirrors the identical, already-proven read-side model (see PROVIDERS.md's
[Package and registry model](PROVIDERS.md#package-and-registry-model)) with
zero redesign needed to add the write side.

## Security / trust boundary summary

| Concept | Trust level |
|---|---|
| Vendor source payload (Jira issue, Azure work item, ...) | Untrusted |
| `RequirementArtifact` (after RTI-1 validation) | Validated canonical data |
| `TestDesignArtifact` (after `assertValidTestDesignArtifact`) | Validated canonical data |
| Destination network response (`TestDesignPublishResult` before validation) | Untrusted |
| Credentials (both source and destination side) | Caller-owned, never acquired/stored by this codebase |
| `repositoryRoot` (file-source ingestion) | Explicit caller-supplied authority |
| Network authority (any provider or destination) | Adapter-defined at construction, never discovered ambiently |

This is deliberately concise — it exists to give the future Agentic
Trust / AI Security (`AISEC-1..7`) research track a precise, current
statement of what this codebase already treats as untrusted, and what it
does not yet do: **no persistent, autonomous agentic memory exists in this
codebase today** — the `MEM-1..9` track is future research/architecture
work, not a shipped capability.

## Testing and CI policy

Identical policy to the read side (see PROVIDERS.md's
[Testing and CI policy](PROVIDERS.md#testing-and-ci-policy)): fully offline,
deterministic destination tests are required in CI; a live vendor SaaS write
proof is optional and non-blocking, classified honestly as `PERFORMED` or
`DEFERRED` (currently `DEFERRED` for Azure); tests exercise a real local HTTP
server plus a narrow, test-only `global.fetch` origin-rewrite (the shared
`test/helpers/http-test-server.js` fixture, extracted in `RTI-8E1` once a
third network-tested adapter crossed the threshold `RTI-8A` itself set for
that extraction) — never a mock of the destination's own internal functions.

## Non-goals

The following were deliberately never introduced during RTI-8 and remain
open questions for a future, separately-scoped design if a real need
arises:

- A destination registry or any central vendor-name dispatch.
- An `UPDATED`/`SKIPPED`/upsert result status, or any update/delete
  capability.
- An automatic write-retry mechanism (would require a destination
  independently proving idempotency first).
- A durable, persisted requirement → remote-artifact publication mapping.
- An idempotency-key mechanism.
- A shared production transport helper between source providers and
  destinations (write semantics, retry policy, and error taxonomy differ
  materially from the read side — explicitly not authorized by RTI-8E/RTI-7G).
- Azure custom-field mapping beyond `System.Title`/`System.Description`.
- Populating `Microsoft.VSTS.TCM.Steps` (see [No fabricated test steps](#no-fabricated-test-steps)).
- Parallel/concurrent destination writes.
- A `TraceabilityLink` field inside the publish request — current
  `TestDesignArtifact` identity (`id`, `requirementId`,
  `source.requirementId`) is treated as sufficient to correlate
  requirement → test-design → publication-result; this may be revisited if
  a real durable-traceability need is identified.

## Carry-forward debt

| Item | Scope | Classification | Target gate | Rationale |
|---|---|---|---|---|
| `request.testDesigns` read via ordinary (not own-enumerable-data-property-hardened) property access at the generic publisher's request-shape boundary | Generic core | Defer to full audit | Full Project Strict Audit / RTI Integrated Audit | Pre-existing, low-severity, consistent with RTI-1/RTI-6's own established boundary-hardening pattern not yet applied everywhere. |
| `rawResult.allSucceeded` read via ordinary property access before Boundary-B hardening fully applies | Generic core | Defer to full audit | RTI Integrated Audit | Same class as above. |
| Array-index accessor hardening on untrusted `items[]`/`expectedResults[]` (a hostile numeric-index getter is not fully guarded by `Array.prototype.forEach`/spread) | Generic core (shared with RTI-1's `labels`, RTI-6's provider-array handling) | Defer to full audit | RTI Integrated Audit | Repo-wide, pre-existing pattern, not RTI-8-specific. |
| `FAILED` result item with a known `remoteId` (a destination could theoretically report both) has no dedicated canonical representation | Generic core | Defer | RTI Integrated Audit | No current destination produces this shape; theoretical only. |
| Whole-`publish()` wall-clock timeout | Generic core / Azure destination | Defer to full audit | Full Project Strict Audit | Per-request timeout plus sequential bounded processing already bounds worst-case duration per item; no evidence of need yet. |
| Write response byte-size limit | Azure destination | Defer to full audit | Full Project Strict Audit | Relies on a trusted host and narrow field selection; no evidence of need yet. |
| `criterionIndex` positional/snapshot-scoped identity | RTI-4/RTI-5 (not RTI-8-local) | Carried, re-affirmed | — | Pre-existing, unrelated to RTI-8; publication never converts it into a durable Azure identity. |
| Publication persistence (no durable requirement→remote mapping) | Generic core | Explicit non-goal for now | — | See [CREATE_ONLY and no write retry](#create_only-and-no-write-retry) above. |
| Idempotency key / dedupe mechanism | Generic core / destinations | Explicit non-goal for now | — | Same. |
| Live Jira proof (ingestion side of RTI-8J) | Jira-local | Defer safe | — | Already an established, non-blocking policy carried from RTI-7. |
| Live Azure destination proof | Azure-local | Defer safe | — | Same. |
| `Microsoft.VSTS.TCM.Steps` not populated | Azure-local | Explicit non-goal for v1 | — | See [No fabricated test steps](#no-fabricated-test-steps). |
| Azure custom-field mapping | Azure-local | Explicit non-goal for now | — | No grounded source field exists in the canonical artifact today. |
| Parallel destination writes | Generic core / destinations | Explicit non-goal | — | Sequential processing is required for deterministic global short-circuit. |
| Unknown-outcome reconciliation (no mechanism to later confirm whether an `OUTCOME_UNKNOWN` item actually succeeded remotely) | Generic core / destinations | Defer | RTI Integrated Audit | Would require a durable, destination-specific "does X already exist" query — out of scope for `CREATE_ONLY` v1. |
| `withServer` test fixture non-reentrancy (nesting a second `withServer` call inside a first one's callback silently misroutes requests to the outer server) | Test infrastructure only, not shipped | Carried, re-affirmed | — | Pre-existing (present identically before `RTI-8E1`'s extraction), empirically reproduced, worked around by using strictly sequential (never nested) `withServer` calls; no production/test-behavior risk found in any current test suite. |
| Azure `location` metadata — hostname checked, port not checked | Azure destination | Documented, accepted | — | `location` is confirmed pure display metadata, never re-fetched or used as a network authority anywhere in this codebase; classified LOW/INFO. |
| Direct `destination.publish()` trust-model gap | Azure destination (and this contract, generically) | **Closed by this document** | — | See [Direct `destination.publish()` — trust model](#direct-destinationpublish--trust-model) above; the recommended-path wording now exists in both this file and README.md. |

## RTI-8 formal closure

**RTI-8 — Test Case Publishing / Destinations implementation is complete.**
The phase built the generic `TestDesignDestination` contract (`RTI-8A`
design, `RTI-8B` implementation, one independently-found and closed
input-immutability corrective), validated it against one real, materially
concrete external system (Azure DevOps Test Case work items, `RTI-8F`, zero
BLOCKER/MEDIUM findings on independent review), and — the step no prior RTI
phase needed, because RTI-7 only ever proved the read side — proved the
contract is genuinely cross-vendor: a Jira-sourced pipeline reaches an
Azure-shaped destination with zero bridging code anywhere (`RTI-8J`,
`VENDOR INDEPENDENCE: PROVEN`). This documentation closure (`RTI-8K`) is
**prepared, pending independent review and merge** — RTI-8 is not formally
declared closed on `main` until this document's own independent review
passes.
