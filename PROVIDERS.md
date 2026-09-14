# Provider Authoring Contract

This document is the durable architectural record of Roadmap **RTI-7 — External
Requirements Source Providers**. It exists because RTI-7 built and
independently hardened two materially different real adapters — Jira and
Azure DevOps — against the generic `RequirementsSourceProvider` contract
defined by RTI-6 (`scripts/ai/requirements-source-provider.js`), and the
cross-adapter architecture review (RTI-7G) that followed concluded the
lessons those two adapters teach are worth writing down permanently, even
where the *code* that embodies them must stay vendor-specific.

If you are about to write a third (or later) `RequirementsSourceProvider`
adapter, this is the contract to build against. If you are reviewing one,
this is the checklist to review it against.

## RTI-7 achievement summary

RTI-7 set out to answer one question: does RTI-6's generic contract

```ts
interface RequirementsSourceProvider {
  readonly id: string;
  read(): Promise<RequirementArtifact[]> | RequirementArtifact[];
}
```

hold up against a *real*, materially heterogeneous external system, or does
it quietly assume something Jira-shaped?

Two real, independently reviewed, adversarially hardened, merged adapters
now answer that question:

| | Jira (`RTI-7B`) | Azure DevOps (`RTI-7F`) |
|---|---|---|
| Query language | JQL | WIQL |
| Retrieval model | single-endpoint, token-paginated search | two-stage: query for IDs, then batch-fetch |
| Continuation | opaque `nextPageToken`, cycle-guarded | fixed-size batch partitioning, id-set reconciliation |
| Rich text | Atlassian Document Format (JSON tree) | HTML (tag-based string) |
| Native identity | string issue key (`PROJ-123`) | positive integer work-item id |
| Network authority | caller-supplied HTTPS `baseUrl` | internally constructed from `organization`/`project` |
| Auth | Basic (email + API token) | PAT (Basic) or caller-supplied Bearer token |
| Rate-limit model | uniform 429/5xx retry | 429 retry **and** a distinct "successful response, slow down next time" signal |

Neither adapter required any change to RTI-6's `{id, read()}` contract, and
neither leaked the other's vendor mechanics into the generic core. **This is
the central, empirically-proven conclusion of RTI-7G: RTI-6 is already at
the correct abstraction level. The adapters should remain deliberately
vendor-specific.**

## Current provider status

- **Jira Requirements Provider: `COMPLETE_ON_MAIN`** (`scripts/ai/providers/jira-requirements-provider.js`, `qa-ai-agent/providers/jira`). Enhanced `POST /rest/api/3/search/jql` search, opaque-token pagination with cycle and snapshot-completeness guards, cumulative fail-closed `maxItems`, provider-qualified identity, deterministic ADF→plain-text normalization with a bounded traversal depth, explicit `fieldMap`-only acceptance-criteria extraction, conservative type/relationship mapping, caller-owned email+API-token auth, bounded retry/timeout, secret-safe errors, strict top-level config validation, and own-property-safe vendor-keyed lookups. Live Jira proof: **deferred** (no sandbox credentials; does not block completeness).
- **Azure DevOps Requirements Provider: `COMPLETE_ON_MAIN`** (`scripts/ai/providers/azure-devops-requirements-provider.js`, `qa-ai-agent/providers/azure-devops`). Azure DevOps **Services only** (Server/TFS explicitly out of scope). WIQL flat-query-only retrieval, a two-stage query-then-batch model (200-id batches, independent id-set reconciliation), a fail-closed guard against Azure's own undocumented-in-response 20,000-item WIQL result cap, numeric provider-qualified identity, a zero-dependency bounded HTML→plain-text tokenizer (quote-aware, depth- and length-bounded from its first implementation), a default-with-override acceptance-criteria field, a built-in-plus-caller-extensible type map, narrow verified-reference-name relationship mapping, a caller-owned PAT/Bearer auth union, Azure's own documented rate-limit semantics (a `429` retried, and a distinct successful-response-with-`Retry-After` signal honored without being retried), bounded retry/timeout, secret-safe errors, and own-property-safe vendor-keyed lookups. Live Azure proof: **deferred** (no sandbox credentials; does not block completeness).

Both adapters' concrete public constructors, config shapes, and worked
examples live in the main [README.md](README.md#roadmap-rti--requirements--test-design-integration)
under `RTI-7B` and `RTI-7F` respectively — this document does not duplicate
those examples, only the durable principles behind them.

## The provider authoring contract

Normative keywords (`MUST`, `SHOULD`, `MAY`) below follow their conventional
meaning: `MUST` items are non-negotiable invariants both real adapters
already satisfy; `SHOULD` items are strongly recommended and satisfied by
both current adapters, but a future adapter could in principle justify an
exception; `MAY` items are legitimate, vendor-justified choices that must
never be generalized into a cross-provider requirement.

### MUST

A `RequirementsSourceProvider` implementation **MUST**:

1. Expose a stable `id` getter and a `read()` method, implementing RTI-6's
   `{id, read()}` contract exactly — no additional required members, no
   optional generic hooks.
2. Own all vendor-specific configuration at construction time. `read()`
   itself takes no arguments; nothing about *how* to reach the vendor is
   decided at call time.
3. Keep configuration **data-only** — no executable callbacks, no
   fetch/transport injection, no plugin functions accepted as config values.
4. Use an **explicit** network authority, established at construction —
   either a caller-supplied, validated origin (Jira's `baseUrl`) or an
   internally constructed one built only from validated, non-URL config
   fields (Azure's `organization`/`project`). Never discovered from `cwd`,
   environment variables, or any ambient source.
5. Consume **caller-owned credentials only**. The provider receives a
   token/credential value and uses it; it never discovers, requests,
   prompts for, or stores one itself.
6. Perform **no environment or config autodiscovery** of any kind — no
   reading `process.env`, no scanning the working directory, no
   target/vendor-name-based branching to select behavior.
7. **Fail closed** on any malformed, incomplete, or structurally
   inconsistent vendor response. Untrusted vendor data is validated before
   any field is read for normalization, exactly as any other trust
   boundary in this codebase.
8. Return an **atomic, all-or-nothing snapshot**. `read()` either resolves
   with a complete, internally consistent `RequirementArtifact[]`, or it
   rejects — never a partial result. A later page, batch, or continuation
   step failing must reject the *entire* read, discarding whatever was
   already collected. (Empirically proven twice: a Jira mid-pagination
   failure and an Azure mid-batch failure both reject the whole call with
   nothing already-collected ever returned.)
9. Return a **deterministic output order** for unchanged source data and
   unchanged provider configuration. The comparator is vendor-specific
   (Jira sorts by native issue key; Azure sorts by numeric work-item id);
   the *requirement* that some stable, provider-owned comparator exists at
   all is generic. This matters concretely because RTI-4's positional
   `::test::<ordinal>` test-design ids depend on stable snapshot order.
10. Use the **provider-qualified identity convention** for
    `RequirementArtifact.id`: `"<provider.id>:<native source id>"` (e.g.
    `"jira-prod:PROJ-123"`, `"azure-prod:12345"`). Treat this string as
    **opaque** — never parsed, split, or decoded by any code, including the
    provider's own. `provider.id` itself may legitimately contain `:`, so a
    naive split is not merely discouraged, it is incorrect.
11. Preserve the **exact native source identity** separately, in
    `source.sourceId` — unencoded, uninterpreted, exactly as the vendor
    returned it (a Jira issue key stays a string; an Azure work-item id
    becomes its plain string representation, never re-encoded).
12. Preserve a **source-native version/revision** in `source.version` when
    the vendor exposes one meaningful for this purpose — prefer the
    vendor's own monotonic revision concept (Azure's `rev`) over an
    ambiguous timestamp where both exist; omit `source.version` entirely
    rather than fabricate one.
13. **Never persist raw vendor payload** anywhere in a `RequirementArtifact`
    — not in `content`, not in `metadata`, not in any thrown error message.
    Only selectively normalized, canonical fields are ever attached.
14. **Bound every outbound network request's timeout.**
15. **Bound retry behavior** — a fixed, small total-attempt count; never an
    unbounded or indefinite retry loop.
16. **Bound resource consumption in any complex vendor-data parser** —
    rich-text normalization, in particular, must bound both input size and
    traversal/nesting depth, fixed at design time, not discovered reactively
    after a crash (see [Rich-text safety](#rich-text-safety) below).
17. **Never place secrets or sensitive caller-owned data in a thrown
    error** — no API tokens, no constructed `Authorization` header value, no
    raw HTTP response bodies, and no raw vendor query text (JQL/WIQL/etc.,
    which may itself encode sensitive internal project detail). This is not
    optional hygiene: whatever a provider throws becomes RTI-6's `.cause`,
    an intentionally *unsanitized* diagnostic channel by design (see
    [Error and secret safety](#error-and-secret-safety) below) — the
    provider is the only remaining safety boundary before that value
    becomes caller-visible.
18. **Map unknown native semantic values conservatively.** An unrecognized
    native type maps to `"other"`; an unrecognized native relationship type
    is omitted entirely. Never guess, never force-map to the "closest"
    category.
19. **Keep all vendor-specific transport, query, pagination, batching,
    authentication, and rich-text logic inside the adapter itself** — RTI-6
    and the rest of the generic RTI core (RTI-1/3/4/5) must never grow
    vendor-name branches, vendor-specific config fields, or vendor-specific
    validation.

### SHOULD

A `RequirementsSourceProvider` implementation **SHOULD**:

1. Ship fully deterministic, **offline** tests — no live network dependency
   and no required-CI dependency on any vendor's own availability.
2. Test through a **real local transport** (a real HTTP server plus a
   narrow, test-only `fetch`-origin-rewrite) rather than mocking the
   provider's own internal functions, so the real URL/header/body
   construction and JSON-parsing paths are actually exercised.
3. Treat a live vendor integration proof as **optional and non-blocking** —
   never request sandbox credentials to unblock a merge, and never imply a
   live proof was performed when it was only offline-verified. Classify
   honestly as `PERFORMED` or `DEFERRED`.
4. **Reject unknown top-level configuration keys** at construction, rather
   than silently ignoring typos or unsupported options. (This was a real,
   confirmed cross-adapter inconsistency Azure carried from its own first
   implementation and Jira only gained in a later parity-hardening pass —
   see the [debt table](#carry-forward-debt) for the concrete incident.)
5. **Audit every vendor-string-keyed lookup into a built-in plain object**
   for own-property safety (see
   [Own-property safety](#own-property-safety) below) — this is not a
   theoretical concern; it was independently discovered as a real defect in
   one adapter and then found (and fixed) as a latent, previously-unaudited
   instance of the identical pattern in the other.
6. **Freeze its resolved configuration** after construction (`Object.freeze`
   or equivalent) so a provider instance's behavior cannot be mutated after
   the fact by a caller holding a reference to the config object.
7. **Document unsupported vendor deployment or auth modes honestly** as an
   explicit scope decision, not a silent gap (e.g. Azure DevOps Server/TFS,
   Entra token acquisition).
8. Be exposed via a **package subpath**, never expanding the root package
   export surface (see [Package and registry model](#package-and-registry-model)).

### MAY

A `RequirementsSourceProvider` implementation **MAY**:

1. Expose vendor-specific `fieldMap`/`typeMap`-style configuration options
   where the vendor's own semantics genuinely justify caller override.
2. Default to a vendor-standard field for a given semantic concept (e.g.
   Azure's standard `Microsoft.VSTS.Common.AcceptanceCriteria` field) where
   the vendor actually defines one — this is *not* required to match
   another adapter's stricter, fully-explicit-only policy (Jira has no
   standard AC field and requires explicit configuration; both policies are
   correct for their respective vendors).
3. Use provider-specific timeout/retry numeric constants, justified by that
   vendor's own documented behavior — there is no requirement that every
   adapter share identical numeric defaults.
4. Use a provider-specific canonical ordering comparator.
5. Support more than one caller-owned authentication form when the vendor's
   own ecosystem genuinely offers more than one (Azure's PAT-or-Bearer
   union, justified by Microsoft's own current Entra-ID-recommended,
   PAT-still-supported guidance).

None of the `MAY` items above are ever to be generalized into a shared,
cross-provider abstraction merely because two adapters happen to both need
*some* form of the underlying concept — see
[Shared production code decisions](#shared-production-code-decisions).

## Atomicity and determinism

**Atomicity**: `read()` is atomic at the level of the whole snapshot. It
returns a complete, internally consistent `RequirementArtifact[]` or it
throws — there is no third outcome. A later-page/later-batch/continuation
failure, a missing expected item, or an inconsistent continuation-token
state must all reject the *entire* call, never a partial success. Both real
adapters enforce this independently, with different concrete mechanics
(Jira: page-failure and token-cycle/empty-page guards; Azure: batch-failure
and id-set-reconciliation guards) — the invariant itself is the generic,
`MUST`-level contract; the mechanics that enforce it are vendor-specific.

**Determinism**: for unchanged source data and unchanged provider
configuration, `read()`'s output order must be deterministic across
repeated calls. The specific comparator is legitimately vendor-specific
(Jira: project-prefix-then-numeric key order; Azure: numeric work-item-id
order) — what is generic is that *some* stable, provider-owned ordering
exists at all, independent of whatever order the vendor's own API happened
to return results in for a given call. This matters concretely because
RTI-4's positional `::test::<ordinal>` identifiers are derived from stable
`RequirementArtifact[]` array order.

## Identity and provenance

- `RequirementArtifact.id` is **provider-qualified and opaque**:
  `"<provider.id>:<native source id>"`. Never parsed, never split on `:`,
  by any code anywhere — `provider.id` itself may contain `:`.
- `source.sourceId` preserves the **exact native identity**, separately
  from the normalized id — this is the field to read when the native
  vendor identity is actually needed, never a parse of the normalized id.
- `provider.id` itself should be stable, caller-defined, collision-safe
  across the caller's own composed providers, non-secret, and bounded —
  changing it is an intentional identity-prefix change, by design (two
  provider instances configured with different `id`s reading the same
  native source produce two distinct, collision-safe normalized ids).
- `source.version` preserves a source-native revision/version concept when
  one meaningfully exists, preferring the vendor's own monotonic revision
  field over an ambiguous timestamp.

## Credentials and network authority

- Credentials are **always caller-owned**. A provider consumes whatever
  credential value it is given; it never discovers one from the
  environment, never performs a login/OAuth flow, never refreshes an
  expiring token, and never persists one anywhere beyond its own frozen
  config.
- The **network authority is always explicit**, established once at
  construction — but the concrete *shape* of that explicitness is
  legitimately vendor-specific: an accepted, validated caller-supplied
  origin is correct where the vendor genuinely has many possible hosts
  (Jira Cloud sites); an internally constructed, non-configurable origin is
  correct — and materially *safer* — where the vendor has exactly one
  documented host (Azure DevOps Services). Do not force one shape onto a
  vendor for which the other is the better fit.

## Error and secret safety

Every error a provider throws can become externally observable: RTI-6
wraps provider failures with an intentionally **unsanitized** `.cause`
channel (a deliberate RTI-6 design decision, not an oversight — see
`scripts/ai/requirements-source-provider.js`'s own documentation). This
means the provider itself is the only safety boundary standing between a
raw vendor failure and a caller-visible error. Provider-thrown errors
**must never** contain API tokens, constructed `Authorization` header
values, raw HTTP response bodies, or raw vendor query text (JQL/WIQL/etc.)
that may itself carry sensitive internal detail.

Safe diagnostic content: HTTP status code, an operation category label, a
bounded non-secret native identifier, a batch/page ordinal. Both adapters'
own adversarial test suites assert this property directly by constructing
requests with realistic-looking secret values and confirming they never
appear in any thrown message.

## Raw payload policy

Never attach a raw vendor object — a raw issue, a raw work item, a raw
response body, a raw `fields` map, a raw links/relations array — to any
part of a `RequirementArtifact`, including `metadata`. Only individually,
deliberately selected and normalized fields are ever surfaced. Both
adapters keep `metadata` to a small, explicitly enumerated field set.

## Rich-text safety

Jira's ADF (a JSON tree) and Azure's HTML (a tagged string) are
structurally incomparable — there is no shared parser and none should ever
be built. What *is* shared is a safety contract every rich-text
normalization step must satisfy:

- **Deterministic** — the same input always produces the same plain-text
  output.
- **Bounded** — both the raw input size and the traversal/structural
  nesting depth must be explicitly bounded, fixed at design time.
- **Non-executable** — output is plain text only; no markup, no script
  content, nothing that could be interpreted as executable by a downstream
  consumer.
- **Fail-closed on unsafe structure** — a pathologically nested or
  oversized input must be rejected cleanly (a bounded, descriptive error),
  never allowed to exhaust the call stack or consume unbounded memory.

The concrete lesson behind the "fixed at design time" wording: Jira's own
depth bound was added *reactively*, after independent review empirically
demonstrated an unbounded-recursion crash on a real, pathologically nested
ADF document. Azure's equivalent bound was fixed from its very first
implementation, directly informed by that discovered lesson — this is a
case where the *lesson* transferred across adapters even though the *code*
correctly did not.

## Conservative mapping

- **Type mapping**: a known native type maps to its RTI-1 semantic
  equivalent only when the match is genuinely unambiguous; every other
  native type — known-but-unmapped or entirely unrecognized — maps to
  `"other"`. Never guess.
- **Relationship mapping**: only relationship/link types with a proven,
  unambiguous RTI-1 semantic match are mapped; everything else is omitted
  entirely, never force-mapped to a fallback category. A target outside the
  current read's own snapshot is a legitimate structural reference — never
  trigger an extra fetch merely to resolve it.
- **Acceptance criteria**: never heuristically extracted from free-text
  description content, and criterion ids are never fabricated when the
  vendor exposes no durable per-criterion identity (RTI-4/RTI-5's
  `criterionIndex` snapshot-scoped fallback exists precisely to cover this
  case downstream).

### Own-property safety

A concrete, twice-encountered security lesson: any **vendor-controlled
string** used to index a built-in plain JavaScript object for a
lookup/mapping table **must** use own-property-safe access, e.g.:

```js
Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback
```

A plain `map[key]` bracket access on an untrusted key resolves *inherited*
properties — most dangerously, a vendor value of literally the string
`"__proto__"` resolves `Object.prototype` itself (a truthy, non-string
object) rather than `undefined`, silently defeating the intended
fallback. This was independently discovered as a real defect in the Azure
adapter's own type-mapping lookup during its exact-head review, fixed in a
narrow corrective, and — because the review process explicitly asked
"does the *other* adapter have the same class of gap?" — the identical,
previously-unaudited pattern was then found and fixed in Jira's own
type-mapping lookup too. Both adapters' relationship-mapping lookups were
independently audited and found *already* safe (they compare native
values against literal string constants via `===`, never index a plain
object with untrusted data) — proving that not every lookup needs this
guard, only ones that are genuinely bracket-indexed by untrusted data.

## Snapshot size

Snapshots must be bounded, and a provider must never silently truncate one
— either the whole read succeeds with a complete result, or it fails
closed. The concrete mechanics for enforcing this are vendor-specific:
Jira accumulates a running cumulative count across pages and fails closed
the moment it would exceed the configured bound; Azure checks a single
WIQL result count up front, with an additional fail-closed guard against
Azure's own documented (but not response-signaled) 20,000-item hard cap.
Neither adapter shares an interface for this — the *invariant*
("never silently truncate") is the generic contract; the *check* is
provider-owned.

## Retry, throttling, and transport

No generic retry algorithm is documented here, and none should be built.
Only the shared principles are generic:

- Retry attempts are bounded (a small, fixed total-attempt count).
- Retry waits are bounded (a fixed maximum delay, even when honoring a
  vendor-supplied hint).
- A **permanent** client/auth failure (4xx other than 429) is never
  retried.
- A vendor's own documented throttling semantics must be respected exactly
  as documented, not approximated by a generic policy.

The concrete reason a shared retry helper is explicitly rejected (see
[Shared production code decisions](#shared-production-code-decisions)):
Azure's rate-limit model is not merely "the same as Jira's with different
constants." Azure documents a **successful** `200` response that can
itself carry a `Retry-After` header — meaning "this request succeeded, do
not retry it, but slow down before your next one." Jira has no equivalent
concept. Representing both behaviors behind one shared helper would require
provider-specific callback/hook injection points (a pre-request delay
check, a post-success state-capture hook, a decision about which transient
statuses warrant which treatment) — at which point the "shared" code stops
reducing complexity and starts relocating it into a harder-to-audit
indirection layer.

## Shared production code decisions

These are RTI-7G's own architecture-review conclusions, empirically
grounded in a direct line-by-line comparison of the two real adapters —
not speculative policy.

| Candidate | Decision | Rationale |
|---|---|---|
| Shared retry/throttle helper | **Reject** | Azure's rate-limit state (proactive pre-request delay, post-success `Retry-After` capture, split 429/5xx handling) has no Jira equivalent; a shared helper would need provider-specific callback hooks, which relocates complexity rather than reducing it. |
| Shared "one bounded HTTP request" primitive | **Defer** | The genuinely identical clauses (manual redirect, `AbortSignal.timeout`, JSON parsing) are a small fraction of either provider's own transport function; extracting just that slice adds a cross-cutting dependency for a thin complexity reduction. |
| Shared secret-safe error helper | **Reject** | No literal duplication exists once vendor-name strings are excluded from comparison; there is nothing concrete to extract. |
| Shared safe-string/type validation primitives (`isPlainDataObject`, `isNonEmptyString`, `hasControlChar`, `isSafeBoundedString`, `isPositiveInteger`) | **Defer to third provider** | These ~25 lines are byte-identical between the two adapters today — the strongest production candidate found — but the codebase has an explicit, pre-existing, twice-restated policy favoring small duplicated primitives over premature shared abstraction, and two data points from adapters built in close proximity is weaker evidence than three independently-evolved ones. |
| Shared provider-qualified-id / provenance builder | **Reject as code; approve as convention** | The `"<provider.id>:<native id>"` convention is validated twice and documented above, but a helper function would only save one line per call site while implying a public parseability API both adapters explicitly disclaim. |
| Shared rich-text safety implementation | **Reject** | ADF and HTML are structurally incomparable; only the *safety contract* (bounded, deterministic, fail-closed) is shared, and it is documented, not coded. |
| Shared test HTTP fixture (`startMockServer`/`closeServer`/`proxyFetchTo`/`withServer`) | **Extract before a third provider** | 44 lines, byte-identical, test-only (zero production/public-API exposure), and this review process independently discovered a genuine cross-test-interference risk class (`global.fetch` mutation, mock-timer scoping) while hardening one adapter's own test suite — a single shared, well-audited fixture would meaningfully de-risk a third provider's test suite rather than adding a third independent, potentially-subtly-divergent copy. Not extracted yet; no third provider exists to justify doing it now. |
| Provider registry / central vendor dispatch | **Reject** | Explicit package subpaths (`qa-ai-agent/providers/jira`, `qa-ai-agent/providers/azure-devops`) already scale cleanly; a registry would add indirection with no corresponding capability gain — no runtime plugin loading or dynamic provider discovery requirement has ever been identified. |
| Multi-provider loader (`loadRequirementsFromProviders([...])`) | **Not introduced** | RTI-6 deliberately loads exactly one provider at a time; combining multiple sources' output is a materially different problem (id-collision policy across sources, merge/precedence semantics) that was never in RTI-7's scope and would need its own dedicated design. |

**Reconsideration trigger**: the "defer" items above are not permanent
rejections. A genuine third, independently-built adapter is the
appropriate point to revisit the primitives-sharing and test-fixture
decisions — three independently-evolved data points are meaningfully
stronger evidence of stable commonality than two built in close
succession. A third provider should **not** be built merely to generate
that evidence; it should be built when a real vendor need exists, at which
point revisiting these two specific decisions is worthwhile.

## Package and registry model

Public provider access is exclusively via package subpath:

```js
const { JiraRequirementsProvider } = require("qa-ai-agent/providers/jira");
const { AzureDevOpsRequirementsProvider } = require("qa-ai-agent/providers/azure-devops");
```

The root package export (`require("qa-ai-agent")`) stays generic — 17
exports covering RTI-1 through RTI-6's public surface **as of RTI-7's own
completion** (now 19, after RTI-8B added `assertValidTestDesignArtifact`/
`publishTestDesigns` — see [PUBLISHING.md](PUBLISHING.md#package-and-registry-model)
for the current count and the write-side subpath model), with **no** vendor
adapter ever added to it. Deep imports to either adapter's internal file
path are blocked by the package's own `exports` map. This model is proven
scalable across two structurally different adapters with zero redesign
between them, and is expected to scale the same way to any future adapter
(GitHub Issues, Xray, TestRail, or otherwise) without needing a registry,
a factory, or vendor-name-based dispatch anywhere in the generic core.

## Testing and CI policy

- Fully offline, deterministic adapter tests are **required** in CI.
- A live vendor SaaS integration proof is **optional and non-blocking** —
  required CI must never depend on a third party's availability or on
  sandbox credentials being present. When performed, it must be reported
  honestly; when not, it is reported as `DEFERRED`, never implied.
- Both real adapters demonstrate the same offline test architecture: a
  real local HTTP server plus a narrow, test-only `global.fetch`
  origin-rewrite, restored per test with an `after`-hook safety net — no
  executable transport seam exists in either adapter's public config.

## Non-goals

The following were deliberately never introduced during RTI-7 and remain
open questions for a future, separately-scoped design if a real need
arises — none of the below should be inferred as "planned" or "implicitly
approved" by RTI-7's own completion:

- A provider registry or any central vendor-name dispatch.
- A multi-provider loader / multi-source aggregation API.
- A shared retry/throttle engine.
- A shared rich-text parser.
- A shared generic pagination/continuation abstraction.
- Credential acquisition, refresh, or storage inside any provider.
- A required live-SaaS dependency in CI.
- Azure DevOps Server/TFS (on-premises) support.
- RTI-8 (test case publishing/destinations) — a distinct roadmap phase,
  since implemented; see [PUBLISHING.md](PUBLISHING.md).

## Carry-forward debt

| Item | Scope | Classification | Target gate | Rationale |
|---|---|---|---|---|
| Shared safe-string/type primitives | Cross-adapter | Defer | Third provider | Byte-identical today, but only two data points; matches the codebase's existing anti-premature-abstraction convention. |
| Shared test HTTP fixture | Cross-adapter (test-only) | Extract before third provider | Before RTI-7H (if ever started) | Byte-identical, test-only, zero production risk; a genuine cross-test-interference risk class was discovered during this work. |
| Whole-`read()` wall-clock timeout | Both adapters | Defer to full audit | Full Project Strict Audit | Neither adapter has one; current per-request timeout plus bounded batch/page counts already bound worst-case duration; no evidence of need yet. |
| Response byte-size limits | Both adapters | Defer to full audit | Full Project Strict Audit | Both rely on a trusted host, item-count bounds, and narrow field selection; no evidence of need yet. |
| Azure relation-target URL host validation | Azure-local | Defer safe | — | Accepts any host in a relation's `url`, but the value is only ever used as an opaque identity component, never as a fetch target — negligible practical impact. |
| Azure DevOps Server/TFS support | Azure-local | Explicit non-goal | — | Deliberate MVP scope decision, not a gap. |
| Azure Entra token acquisition | Azure-local | Explicit non-goal | — | Caller-owned by design; the adapter accepts a Bearer token without caring how it was obtained. |
| Azure `<script>` raw-text edge (literal `</script>` inside script content) | Azure-local | Documented limitation | — | Matches real browser HTML raw-text-element termination semantics; not a defect. |
| Live Jira proof | Jira-local | Defer safe | — | No sandbox credentials; never required to block completion. |
| Live Azure proof | Azure-local | Defer safe | — | Same. |
| `criterionIndex` positional/snapshot-scoped identity | RTI-4/RTI-5 (not provider-local) | Carried, re-affirmed | — | Pre-existing, unrelated to RTI-7; both providers' `acceptanceCriteria` entries rely on this fallback as designed. |
| No exported `assertValidTestDesignArtifact` | RTI-4 (not provider-local) | Carried, re-affirmed | — | Pre-existing, unrelated to RTI-7. |
| Playwright relevant-files hardcoding gap | Unrelated cross-project area | Carried, unrelated to RTI-7 | Full Project Strict Audit | Pre-existing tracked debt from outside this roadmap phase; not touched or affected by RTI-7. |

## RTI-7 formal closure

**RTI-7 — External Requirements Source Providers is complete.** The phase
validated the RTI-6 `RequirementsSourceProvider` abstraction against two
materially heterogeneous real external systems — Jira and Azure DevOps —
each carried through design, implementation, independent exact-head
review, corrective hardening where findings required it, independent
corrective re-review, merge, and post-merge exact-tree/CI certification,
with a final cross-adapter architecture review (RTI-7G) and a targeted
parity-hardening pass (RTI-7I-A) closing the one live inconsistency that
review surfaced. No RTI-6 redesign was required at any point. No further
provider implementation is required before Roadmap RTI-8.
