# GOV-AUTO-1 Design and GOV-VERIFY-1 Reconciliation v1

`GOV-AUTO-1` (Governance Pre-Review Framework) architecture decision record and
the canonical reconciliation with `GOV-VERIFY-1` (Reusable Merge-Gate
Verification Automation), recorded before any overlapping implementation.

Status: **CURRENT** (design; not an implementation and not an accepted
framework -- see [§28 Non-goals](#28-non-goals-and-status-boundaries)).

## 1. Purpose and status

`ROADMAP.md` §6 defines `GOV-AUTO-1` (a deterministic pre-review framework,
`HEAVY`, `NOT_STARTED`) and tracks `GOV-VERIFY-1` (a narrower merge-gate evidence
producer, `HEAVY`, non-blocking). Both `GOV-AUTO-1` sub-stages `1A` and `1F`
overlap `GOV-VERIFY-1`. The roadmap's implementation-ordering rule pauses
overlapping `GOV-VERIFY-1` work until this design records the canonical
reconciliation, and requires one canonical implementation owner per overlapping
capability. This document is that reconciliation record and the architecture
`GOV-AUTO-1` will be implemented against.

It is documentation only. It adds no script, module, manifest, schema file,
workflow, package script or test. It does not implement `GOV-AUTO-1` or
`GOV-VERIFY-1`, does not start `AISEC-4`, does not change any review, merge or
closure rule, and does not mark anything `COMPLETE_ON_MAIN`.

**Design state recorded by this document:** design `AUTHORED` (becomes
`DESIGN COMPLETE` only after independent review, merge and post-merge
certification); implementation `NOT_STARTED`; overlapping `GOV-VERIFY-1`
implementation `PAUSED` (see [§5](#5-relationship-model-decision));
`AISEC-4` `NOT_STARTED`.

**Placement.** Governance documents in this repository are flat
`docs/<subject>-vN.md` files (for example `docs/governance-process-v3.md`,
`docs/branch-inventory-v1.md`, `docs/tool-privilege-credential-boundary-analysis-v1.md`);
there is no `docs/governance/` directory and none is invented here. This
document follows the flat convention. Like the `AISEC-1..3` study documents it is
a design/research artifact and is **not** added to the
`docs/governance-process-v3.md` knowledge catalog: no existing catalog row,
authority tier or process rule changes, so no catalog change, and no new
version of that process document, is required (its "Change control" section
governs only those changes).

## 2. Authority and non-authority

Authority order is unchanged and is defined by `docs/governance-process-v3.md`
("Authority hierarchy"). This document is a tier-2-style design contract for one
narrow subject; it is subordinate to executable authority once an implementation
exists (a conflict between this document and merged code is a defect requiring
reviewed correction, never a silent divergence) and to `ROADMAP.md` for
lifecycle status.

Nothing in this design, and nothing a `GOV-AUTO-1` implementation later produces,
can: approve a change, accept a risk, waive a finding, change a review class
(classification is decided by `ROADMAP.md` §6 and human review; escalation stays
one-directional and uncertainty resolves to `HEAVY`), authorize a merge, certify
a merge, or make any stage `COMPLETE_ON_MAIN`. **Principle: machine checks facts;
humans review meaning.**

Sources read for this design (all on `main` at
`d53580f6e1cf08631f994d754c80ededda535a40`): `ROADMAP.md` §2, §6 (`GOV-VERIFY-1`,
`GOV-AUTO-1`), §7, §8; `docs/governance-process-v3.md`; `docs/branch-inventory-v1.md`
with `scripts/diagnostics/branch-inventory.js`; `scripts/diagnostics/audit-drift-check.js`;
`docs/tool-privilege-credential-boundary-analysis-v1.md` (evidence-model patterns).
The repository has no `scripts/governance/` directory, no `governance/` manifest
directory, no governance package script and no governance workflow today.

## 3. Repository precedent the design reuses

| Precedent | Where | Reused as |
|---|---|---|
| Schema-versioned frozen manifest with `SUPPORTED_SCHEMA_VERSIONS` and a pure `validateManifest()` | `scripts/diagnostics/branch-inventory.js` | Manifest loading: explicit schema version, unknown version rejected, validation separate from use |
| Pure classification function over validated data | `classifyBranch()` in the same module | Checks are pure functions of already-validated inputs; I/O lives in a thin outer layer |
| Three-way `PASS` / `VIOLATION` / `INFRA_ERROR` outcome; identity-aware baseline | `scripts/diagnostics/audit-drift-check.js` | Distinct outcomes for "the artifact is wrong" versus "the tool could not establish the fact" |
| Source class kept apart from conclusion strength; weakest-premise propagation | AISEC-3 study (`DIRECT_DOC`/`DOC_REUSABLE`/`REPO_OBSERVED` vs `DIRECTLY_SUPPORTED`/`DERIVED_INFERENCE`/`UNKNOWN`) | The evidence-model check in `1C` |
| Designation is not execution; frozen historical evidence is temporalized, not rewritten | `ROADMAP.md` §2, §8 | Report fields describe facts at an exact head, never lifecycle state |

## 4. Reconciliation scope: what overlaps

`GOV-VERIFY-1` (ROADMAP §6) targets: exact base/HEAD/TREE, diff scope against
forbidden paths, `npm pack` baseline/diff, a branch-protection snapshot and
exact-SHA CI lookup with explicit `pull_request` versus `push` validation, as
discrete evidence fields (`BASE_MATCH`, `HEAD_MATCH`, `TREE_MATCH`,
`FORBIDDEN_PATHS`, `PACK_DIFF`, `CI_EXACT_SHA`, `CI_EVENT`,
`BRANCH_PROTECTION_STATUS`), fail-closed, never a merge authority, with seven
required negative fixtures.

`GOV-AUTO-1` `1A` (Git identity, diff scope) and `1F` (CI evidence, reporting)
compute the same Git-identity, diff-scope and exact-SHA CI facts. Only three
`GOV-VERIFY-1` facts have no `GOV-AUTO-1` counterpart: `PACK_DIFF`,
`BRANCH_PROTECTION_STATUS` and merge-method/merge-tree conformance
(post-merge facts). Everything else overlaps.

## 5. Relationship model decision

**Decision D1: Model A -- Composition, with `GOV-AUTO-1` owning the shared fact
layer.** The four candidate models were evaluated against repository facts.

| Model | Description | Verdict | Evidence-based reason |
|---|---|---|---|
| A. Composition | Shared deterministic fact modules have one owner; the other framework consumes them through a public interface and adds only its own facts | **SELECTED** | Satisfies "one canonical implementation owner per overlapping capability"; keeps `GOV-VERIFY-1` alive with every constraint intact; does not make the active gate depend on a non-blocking tracked task |
| B. Orchestration | A parent runner invokes `GOV-VERIFY-1` as an independent sibling tool and merges its output | Rejected | Requires `GOV-VERIFY-1` to exist first, making a `NOT_STARTED` non-blocking task a prerequisite of the next active gate (contradicts ROADMAP §6 "non-blocking"); two tools would each compute Git identity unless one is a library, which collapses into A |
| C. Formal absorption | `GOV-VERIFY-1` is cancelled/merged into `GOV-AUTO-1` | Rejected | ROADMAP §6 states `GOV-VERIFY-1` is "not cancelled, obsolete or automatically absorbed"; its merge-time facts (`PACK_DIFF`, branch protection, post-merge `push` proof) are a different lifecycle moment (merge gate, not pre-review) and would bloat a pre-review framework |
| D. Separate scopes | Both keep independent implementations, scopes declared disjoint | Rejected | Scopes are not disjoint (§4); duplicate Git/CI implementations are exactly the "second independent source of truth" the roadmap forbids |

**Consequences of D1.**

1. `GOV-AUTO-1` `1A` is the single owner of Git identity and diff-scope facts;
   `1F` is the single owner of CI-run evidence. Both expose them as public
   fact interfaces ([§21](#21-public-versus-internal-api-boundary)).
2. `GOV-VERIFY-1` remains a tracked, `HEAVY`, non-blocking task. It later
   **composes** the `1A`/`1F` interfaces and implements only its own facts:
   `PACK_DIFF`, `BRANCH_PROTECTION_STATUS` and merge-gate conformance (merge
   method, parent identity, merge-tree equality, post-merge `push` proof).
3. `GOV-VERIFY-1` keeps every existing constraint: evidence producer only,
   fail-closed, discrete fields, no `SAFE_TO_MERGE` verdict, the seven negative
   fixtures. Those fixtures that concern shared facts (wrong-SHA CI,
   `pull_request` versus `push`, forbidden path hidden among docs,
   HEAD/TREE mismatch, stale cached CI) are satisfied once, at the owner
   (`1A`/`1F`), and re-asserted by `GOV-VERIFY-1`'s tests through composition;
   `PACK_DIFF` drift and the branch-protection API cases are `GOV-VERIFY-1`'s own.
4. **Migration/supersession status and pause trigger:** nothing exists to
   migrate and `GOV-VERIFY-1` is not superseded. The pause trigger is exactly
   the one `ROADMAP.md` §6 states: overlapping `GOV-VERIFY-1` implementation
   stays `PAUSED` until this reconciliation design has been (a) independently
   reviewed and approved, (b) merged and post-merge certified, and (c) recorded
   by the required `ROADMAP.md` sync. Once released, overlapping work may proceed
   only under the Model A ownership map: it must consume the `1A`/`1F` public
   interfaces and may not implement any fact this document assigns to them.
   Because its non-overlapping residue technically depends on those interfaces,
   the sequencing in [§19](#19-implementation-dependency-order-and-waves) (Wave 4)
   is a **technical dependency recommendation**, not an additional governance
   pause rule; this design does not strengthen the roadmap's pause. **ROADMAP
   sync required after design merge: YES.** It must capture the selected Model A
   relationship, the ownership split, the `GOV-VERIFY-1` pause/release trigger
   above, and the design-completion state as far as the lifecycle vocabulary
   supports it. This design does not edit `ROADMAP.md`.
5. **Compatibility requirement:** the shared discrete field names and value
   sets ([§7](#7-shared-evidence-contract)) are a superset-compatible
   contract: `GOV-VERIFY-1`'s field names appear unchanged and are never
   renamed or collapsed.

## 6. Capability ownership matrix

Exactly one canonical owner per deterministic fact; consumers may read it only
through the owner's public interface and must never recompute it.

| Capability | Canonical owner | Consumers | Notes |
|---|---|---|---|
| Git identity (branch, HEAD, TREE, parents, base, ancestry, clean worktree) | `1A` | `1E`, `1F`, `GOV-VERIFY-1` | Derived from Git at run time; never hand-configured for a new head |
| Diff scope (changed files, allowed/forbidden paths) | `1A` | `1B`, `1E`, `1F`, `GOV-VERIFY-1` | Owner emits the changed-file set; consumers do not run their own `git diff` |
| CI evidence (run ID, event, SHA, attempt, jobs, classification) | `1F` | `GOV-VERIFY-1`, reviewers | Exact-SHA and event-type rules live only here |
| Merge-gate facts: pack diff, branch protection, merge method/parents/merge-tree equality, post-merge `push` proof | `GOV-VERIFY-1` (composing `1A`/`1F`) | reviewers | Not part of `GOV-AUTO-1`; not needed for pre-review |
| Markdown integrity (tables, fences, headings, anchors, links) | `1B` | `1C`, `1D`, `1E` | Single parser; others consume parsed structure |
| Reference integrity (ID families, dangling, duplicate, malformed) | `1B` | `1C`, `1D` | ID-family configuration in the manifest |
| Evidence/provenance validation (class vs strength, one class per row, promotion wording, weakest premise) | `1C` | `1D`, `1E` | Semantic sufficiency stays human |
| Risk/source consistency and research-method consistency (totals, counts, method contradictions) | `1D` | `1E` | Prefers deriving counts from structured records |
| Delta review and dependency-aware invalidation | `1E` | `1F` (report) | Never lowers review class |
| Fingerprints | `1E` | `1F` (report) | One canonicalization ([§13](#13-fingerprint-model)) |
| Secret scanning and suppression application | `1A` | `1F` (report) | Operates on the owner's changed-file set; output masked |
| Manifest and configuration loading/validation, dependency-graph validation | Wave 0 shared contracts | all stages | Not a stage; the shared kernel ([§19](#19-implementation-dependency-order-and-waves)) |
| Result/verdict types, error model, readiness derivation, `pre-review.json` writer, `pre-review.md` renderer | Wave 0 kernel (types, derivation); `1F` (wiring, CLI, files) | all stages | One aggregator function; renderer derives Markdown from JSON |
| Reviewer-facing summary | `1F` | humans | Derived view only |

A fact with two owners is a defect in this design. A future stage that needs a
new shared fact must add it to this matrix through a reviewed design change
before implementation.

## 7. Shared evidence contract

**Decision D2: structured, versioned JSON is the canonical record; every derived
view is computed from it.**

Every check produces a **result record**; the aggregator never transforms or
hides one.

| Field | Type / values | Meaning |
|---|---|---|
| `checkId` | string, unique within a run | Stable identifier, e.g. `1A.HEAD_MATCH` |
| `ownerStage` | `1A`..`1F` or `KERNEL` | Canonical owner ([§6](#6-capability-ownership-matrix)) |
| `status` | `PASS`, `FAIL`, `CONFIGURATION_ERROR`, `HUMAN_REVIEW_REQUIRED`, `INCOMPLETE` | Outcome ([§22](#22-error-model-and-exit-codes)) |
| `subject` | object: `head`, `tree`, `base`, `range` | The exact identity the fact was established for; `range` is `{mode, from, to}` ([§18](#18-sub-stage-ownership-map)) |
| `observed` | JSON value or `null` | The observed fact (masked when sensitive) |
| `expected` | JSON value or `null` | The manifest-declared expectation |
| `reasonCode` | enumerated string | Machine-stable reason; free text is never the only signal |
| `detail` | string, bounded length, redacted | Human explanation |
| `evidenceRefs` | array of file/record locators | Where a reviewer looks |

Discrete fields inherited unchanged from `GOV-VERIFY-1`: `BASE_MATCH`,
`HEAD_MATCH`, `TREE_MATCH`, `FORBIDDEN_PATHS`, `CI_EXACT_SHA`, `CI_EVENT`
(and, owned by `GOV-VERIFY-1` later, `PACK_DIFF`, `BRANCH_PROTECTION_STATUS`).
Value set for each: `PASS`, `FAIL`, `UNKNOWN`, mapped one-way into the status
set above (`UNKNOWN` is reported as `INCOMPLETE`; it is never rendered as
`PASS`).

**Readiness state (D3, corrected in C1).** `READY_FOR_INDEPENDENT_REVIEW` is
realized as one enumerated field, `readiness.state`, with exactly three values,
derived only by the aggregator function from the result records. The roadmap's
`READY_FOR_INDEPENDENT_REVIEW: YES` corresponds exactly to `state = READY`; the
other two values are "not `YES`". There is **no boolean**, and no value that
means "ready, but see the flags".

| `readiness.state` | Derived when | Meaning |
|---|---|---|
| `NOT_READY` | the run's overall status ([§22](#22-error-model-and-exit-codes)) is `CONFIGURATION_ERROR`, `FAIL` or `INCOMPLETE` | A deterministic defect, an invalid configuration, or a fact the tool could not establish; the head is not yet eligible for independent review |
| `HUMAN_REVIEW_REQUIRED` | overall status is `HUMAN_REVIEW_REQUIRED` (no `CONFIGURATION_ERROR`, `FAIL` or `INCOMPLETE` record) | The deterministic checks found no defect, but at least one mandatory human determination is pending; this is **not** a green state |
| `READY` | every mandatory check is `PASS` (or `PASS` with an `exceptionApplied` record) and no record is `HUMAN_REVIEW_REQUIRED` | Deterministic checks are complete and no mandatory human determination is pending |

Precedence (highest first), identical to the overall status:
`CONFIGURATION_ERROR` = `FAIL` = `INCOMPLETE` (all `NOT_READY`) >
`HUMAN_REVIEW_REQUIRED` > `READY`. `READY` is reachable only when **every**
record is `PASS`; therefore `READY` with an unresolved mandatory
`HUMAN_REVIEW_REQUIRED` state is impossible by construction. Human-required
items do not stop independent review from starting; they are what independent
review must decide. The report never records their resolution: a human's
resolution lives in the independent review, and the report for that head stays
`HUMAN_REVIEW_REQUIRED` until a new head or new evidence removes the underlying
condition. No automated consumer may treat `HUMAN_REVIEW_REQUIRED` as satisfied,
so a consumer reading only `readiness.state` cannot miss a required human
determination. The detailed records remain the canonical evidence and the
aggregate can never contradict them; the side lists (`humanReviewRequired`,
counts) are convenience views, and correctness never depends on them.

The aggregator has no input except the records; the state is reproducible
byte-for-byte from `records[]` alone. It is not approval, risk acceptance,
security acceptance, merge authorization or lifecycle completion, and it never
lowers a review class. A missing CI evidence record is `INCOMPLETE` and
therefore `NOT_READY` ([§17](#17-ci-evidence-ownership-and-the-machinehuman-boundary)).

## 8. Dependency declaration schema

**Decision D4: every review domain must explicitly declare its dependencies;
a missing declaration is `CONFIGURATION_ERROR`.**

Justification: a missing declaration is a property of the manifest (a
deterministic fact about a machine-checked configuration file), not a semantic
ambiguity; the roadmap's "never assumed independent" is satisfied by refusing
to run, and `HUMAN_REVIEW_REQUIRED` is reserved for cases a human can actually
resolve while the tool continues (for example a `MEANING` dependency change).
An empty dependency set is legal only when written explicitly as `[]`;
absence of the key is not equivalent to `[]`.

Schema (per domain entry in the manifest):

| Field | Type | Required | Rules |
|---|---|---|---|
| `domainId` | string, `^[A-Z][A-Z0-9_]{1,63}$` | yes | Unique across the manifest |
| `enabled` | boolean | yes | A disabled domain cannot be depended upon |
| `ownerStage` | `1A`..`1F` | yes | Stage whose check covers the domain |
| `dependsOn` | array of `{domain, kind}` | yes, may be `[]` | `kind` in `DERIVED_VALUE`, `REFERENCE`, `MEANING`; no self entries |
| `derivedFrom` | array of source selectors | yes, may be `[]` | Concrete record sources the domain's values are computed from; every domain-typed selector must also appear in `dependsOn` |
| `protectedInputs` | array of region selectors | yes | The file regions fingerprinted for the domain ([§13](#13-fingerprint-model)); may be `[]` only if `reviewModes` excludes `PRESERVATION_CHECK_ONLY` |
| `reviewModes` | non-empty subset of `DEEP_REVIEW_REQUIRED`, `PRESERVATION_CHECK_ONLY` | yes | `PRESERVATION_CHECK_ONLY` eligibility is a necessary, never sufficient, condition ([§12](#12-preservation_check_only-eligibility)) |

Edge kinds: `DERIVED_VALUE` (a count, total or generated table computed from
upstream records), `REFERENCE` (the domain cites identifiers defined upstream),
`MEANING` (the domain's meaning, authority or validity depends on upstream
content in a way a machine cannot judge).

## 9. Dependency graph validation

**Decision D5: the graph must be a validated DAG; every violation fails
closed; cycles are rejected rather than accommodated.**

Validation runs once, on the loaded manifest, before any check executes.

| Condition | Result |
|---|---|
| Unknown dependency domain | `CONFIGURATION_ERROR` |
| Self-dependency | `CONFIGURATION_ERROR` |
| Duplicate `domainId`, or duplicate edge to the same domain | `CONFIGURATION_ERROR` |
| Missing `dependsOn`, `derivedFrom`, `protectedInputs` or `reviewModes` key | `CONFIGURATION_ERROR` |
| Dependency on a disabled domain (including disabling a depended-upon domain) | `CONFIGURATION_ERROR` |
| Cycle of length >= 2 | `CONFIGURATION_ERROR` |
| `derivedFrom` names a domain absent from `dependsOn` | `CONFIGURATION_ERROR` |
| Domain defined but referenced by no changed-file selector | Legal (reported as `NOT_TOUCHED`) |

Cycles are invalid, and no "justified cycle" mechanism exists. If two regions
are genuinely mutually dependent they are declared as **one** domain whose
`protectedInputs` cover both; the invalidation algorithm then treats them as a
unit. Rejected alternative: permitting a cycle with a justification field --
it invites suppression abuse ([§29](#29-framework-threat-analysis)) and makes
transitive invalidation non-terminating unless a fixpoint is added.

## 10. Transitive invalidation algorithm

**Decision D6.** Inputs: validated DAG, per-domain `changed` flag from the
domain change model ([§11](#11-domain-change-model)), and per-domain resolvable
flag. Output: an effective review level per domain.

```text
levels: PRESERVATION_CHECK_ONLY < DEEP_REVIEW_REQUIRED < HUMAN_REVIEW_REQUIRED
for domain D in topological order (dependencies first):
  # section 12 is a mandatory PRE-GATE evaluated before any level is assigned
  eligible(D) = section 12 own-side conditions 1-4 and 6-8 all hold
  own = if eligible(D)                       -> PRESERVATION_CHECK_ONLY
        elif change cannot be established
             (base unverified, region or
              base version missing)          -> HUMAN_REVIEW_REQUIRED
        else                                 -> DEEP_REVIEW_REQUIRED
        # 'else' covers: changed; preservation not permitted by reviewModes;
        # a covering 1B-1D check is not PASS; an unresolved FAIL/INCOMPLETE
        # or CONFIGURATION_ERROR record concerns D
  inherited = PRESERVATION_CHECK_ONLY
  for each edge (D dependsOn U with kind k):          # section 12 condition 5
        if effective(U) == PRESERVATION_CHECK_ONLY: continue
        if effective(U) == HUMAN_REVIEW_REQUIRED or k == MEANING:
              inherited = HUMAN_REVIEW_REQUIRED
        else: inherited = max(inherited, DEEP_REVIEW_REQUIRED)
  effective(D) = max(own, inherited)
```

No path assigns `PRESERVATION_CHECK_ONLY` unless the pre-gate holds; the
inherited loop can only raise a level, and condition 5 of section 12 is exactly
the requirement that `inherited` stay at `PRESERVATION_CHECK_ONLY`.
Because propagation uses the *effective* upstream level and runs in topological
order, invalidation is transitive: if A changes, B depends on A, and C depends
on B, both B and C become at least `DEEP_REVIEW_REQUIRED`. Worst-of joins cannot
lower a level.

`DEEP_REVIEW_REQUIRED` versus `HUMAN_REVIEW_REQUIRED`: `DEEP_REVIEW_REQUIRED`
means the affected content is machine-checkable (`DERIVED_VALUE`, `REFERENCE`),
so the deterministic `1B`-`1D` checks re-run in full and the reviewer reviews the
domain in full. `HUMAN_REVIEW_REQUIRED` means the machine cannot judge validity
(a `MEANING` dependency changed, an upstream is itself `HUMAN_REVIEW_REQUIRED`,
or the change cannot be established); the domain is flagged for a human
determination and is never presented as machine-cleared.

## 11. Domain change model

**Decision D7: change is evaluated per review domain, not per file.** A domain
is `changed` if **any** of the following holds (comparison is between the exact
base identity and the exact head identity):

1. the domain's own fingerprint differs ([§13](#13-fingerprint-model));
2. any `derivedFrom` or `protectedInputs` source changed (including a file
   rename or delete that moves a source);
3. any declared dependency's effective level is above `PRESERVATION_CHECK_ONLY`
   (transitive, [§10](#10-transitive-invalidation-algorithm));
4. the domain's own manifest declaration differs from the base version
   (selectors, dependencies, edge kinds, review modes, enablement);
5. the domain exists on one side only (added or removed);
6. a protected region cannot be located at the head (extractor failure) or the
   base version is unavailable (`HUMAN_REVIEW_REQUIRED`, never assumed
   unchanged);
7. the extractor/parser version used for the domain differs from the one
   recorded at the base comparison.

A file-level "not in the diff" signal is never sufficient by itself, because a
domain can change through an unmodified file's derived value.

## 12. `PRESERVATION_CHECK_ONLY` eligibility

`PRESERVATION_CHECK_ONLY` may be reported for a domain only if **all** of:

1. the domain is enabled and `reviewModes` includes it;
2. the manifest graph validated ([§9](#9-dependency-graph-validation));
3. the manifest declaration of the domain, and of every transitive dependency,
   is byte-identical between base and head;
4. the domain's own fingerprint is identical between base and head;
5. every transitive dependency is `PRESERVATION_CHECK_ONLY`;
6. the base identity is verified and equal to the manifest's expected parent/base
   (`1A`), and head/tree came from Git for the current run;
7. the deterministic `1B`-`1D` checks covering the domain still `PASS` at the head;
8. no unresolved `INCOMPLETE`, `CONFIGURATION_ERROR` or `FAIL` record concerns the
   domain.

Anything else is `DEEP_REVIEW_REQUIRED` or `HUMAN_REVIEW_REQUIRED` per §10.
Execution order is fixed: conditions 1-4 and 6-8 form the pre-gate `eligible(D)`
evaluated first inside the §10 algorithm; condition 5 is enforced by the §10
propagation loop. `PRESERVATION_CHECK_ONLY` reduces repeated reviewer effort
only; it never lowers the review class, never implies the content is correct,
and never replaces independent review.
## 13. Fingerprint model

**Decision D8: a fingerprint asserts sameness of a declared byte-canonical
region, never correctness, security approval or risk acceptance.**

- **Hash:** SHA-256, recorded with a `fingerprintVersion` prefix
  (`gov-fp-v1:`) so a canonicalization change cannot silently compare equal.
- **Canonicalization (v1):** decode as UTF-8 (invalid UTF-8 is `FAIL` for that
  domain, not replacement-character substitution); strip a leading BOM;
  normalize `CRLF` and lone `CR` to `LF`; do **not** strip trailing whitespace,
  collapse spaces, or reorder anything inside a region (whitespace can be
  semantic in tables and code fences). The repository stores LF in the index
  while working trees may hold CRLF, so fingerprints are computed from Git
  object content (`git show <sha>:<path>`), not the working file.
- **Region extraction:** a domain's `protectedInputs` are ordered as listed in
  the manifest; each region is framed as
  `<selectorLength>:<selector>\n<byteLength>:<bytes>\n` so concatenation cannot
  be ambiguous; the domain fingerprint hashes the ordered framed sequence.
- **Record-set domains** (rows keyed by ID) are extracted in ascending ID order
  only when the manifest declares the region `orderIndependent: true`; otherwise
  document order is significant.
- **Missing region** at either identity is an extraction failure
  (`HUMAN_REVIEW_REQUIRED`), never an empty-region fingerprint.
- Fingerprints are computed at run time from the exact base and head; a stored
  fingerprint is never trusted as input ([§14](#14-manifest-ownership-trust-anchor-and-authority)).

## 14. Manifest ownership, trust anchor and authority

**Decision D9 (corrected in C1): one committed, human-authored manifest per gate
layered on a repository-level base policy; the base commit is the trust anchor;
the head may propose changes but can never weaken its own review; nothing is
generated; everything is validated and fail-closed.**

**Two committed artifacts, no third source.**

| Artifact | Purpose | Read from |
|---|---|---|
| Base policy (for example `governance/base.json`) | Repository-level policy: schema versions, ID families, secret rules, mandatory domains, exception and suppression policy limits, authority rules, minimum review class, allowed and forbidden path domains | The **base commit** (`1A`-verified `base`), never the head |
| Gate manifest (for example `governance/manifests/<gate-id>.json`) | The gated stage: stage identity, domain definitions, dependency declarations, per-review scope, required CI jobs, exceptions, suppressions | Head is the *proposal*; the base version (when it exists) is the anchor |

Run-time facts (HEAD, TREE, changed files, fingerprints, CI data) are never
stored in either artifact as authority; a generated manifest is rejected.

**Trust model.** Both artifacts are repository input and therefore untrusted
until validated: schema-validated, size-bounded, path-checked, and rejected on
any unknown field or incompatible `schemaVersion` before any check runs. A
repository file is not authoritative merely by existing there
(`docs/governance-process-v3.md`, "Authority hierarchy").

**Protected fields** (taken from the base anchor; the head can only tighten):
stage identity; review-class minimum; allowed and forbidden path domains;
mandatory domain IDs together with their dependency declarations, edge kinds and
review modes; required CI job list; ID families; secret rules; exception and
suppression policy limits (categories, maximum expiry); authority rules. Fields
the head controls: additional (added) domains and dependencies, per-review
allowed files that are a **subset** of the base allowed path domains, and
proposed exceptions and suppressions (see below).

**Tighten versus loosen.** A head change is *tightening* if it can only make a
check stricter (adds a mandatory check, domain, dependency edge or forbidden
path; narrows scope; shortens expiry; adds a required CI job; raises review
class). It is *loosening* otherwise (widens scope beyond the base path domains;
removes or disables a domain or check; removes or relaxes a dependency edge,
lowers its kind, or drops a review-mode restriction; removes a required CI job;
extends an expiry; lowers the review class; adds an exception or suppression;
changes an authority rule).

**Effective review configuration.**
`effective = base protected values + head tightening + head non-protected
additions`. A head loosening proposal is **not applied**: the base value stays in
force for this review, the proposal is recorded, and the `GOVERNANCE_CONFIG`
domain is `HUMAN_REVIEW_REQUIRED` with a structural diff (base versus head of
every protected field). A head-proposed exception or suppression is never
honored as a `PASS`: the affected hit stays `HUMAN_REVIEW_REQUIRED` with the
proposal attached, so a head can never self-authorize a bypass. A protected
change is therefore reviewed under the *old* configuration by a human, and
becomes the anchor only after it is merged and becomes the new base.

**New gate or no base anchor (bootstrap).** If the base commit has no base
policy, or no gate manifest for this gate, there is no trust anchor. The
framework then (1) validates the head artifacts against the framework's built-in
minimum policy only, which is hard-coded, tighten-only and fail-closed (review
class `HEAVY`; no domain eligible for `PRESERVATION_CHECK_ONLY`; no exception or
suppression honored); (2) records `reasonCode NO_BASE_TRUST_ANCHOR` as a
`HUMAN_REVIEW_REQUIRED` record for `GOVERNANCE_CONFIG`; and (3) can therefore
reach at best `readiness.state = HUMAN_REVIEW_REQUIRED`, never `READY`. The
initial trust is established by the human reviewer and by merge, not by the
manifest.

**Overlay precedence** (base policy versus gate manifest; field by field; there
is no "both define X" ambiguity):

| Category | Rule | On conflict |
|---|---|---|
| `schemaVersion` | Must be in the framework's supported set for each artifact | `CONFIGURATION_ERROR` |
| ID families | Extend: the gate may add families | Redefining or removing a base family is a forbidden override: `CONFIGURATION_ERROR` |
| Secret rules | Union: the gate may add rules | Removing or relaxing a base rule: `CONFIGURATION_ERROR` |
| Domain definition | A domain exists only if the gate manifest defines it; base names `mandatoryDomains` that the gate must define | A missing mandatory domain: `CONFIGURATION_ERROR`; for a domain defined at both levels: `dependsOn` and `protectedInputs` are the union, `reviewModes` the intersection, `enabled` and `ownerStage` are the base values (differing `ownerStage`: `CONFIGURATION_ERROR`) |
| Allowed scope | Intersection: the gate may narrow | Widening beyond the base path domains is loosening (not applied; `FAIL` for any changed file outside the base domains) |
| Forbidden paths | Union | none |
| Required CI jobs | Union | Removal is loosening (not applied) |
| Review class | Maximum (`HEAVY` over `LIGHT`) | Lowering is loosening (not applied) |
| Exceptions and suppressions | Gate manifest only, limited by base policy limits | A head-added item is a proposal (`HUMAN_REVIEW_REQUIRED`); a base-anchored item follows [§15](#15-governed-exception-model) |

**Manifest changes.** Any change to a protected field, exception or suppression
makes `GOVERNANCE_CONFIG` `HUMAN_REVIEW_REQUIRED`. Limitation stated openly: a
change to the framework's own code is evaluated by that same code in CI, so the
framework cannot certify its own change; independent review (`1G`) stays the
authority.

## 15. Governed exception model

A manifest **exception** waives a specific deterministic check outcome for a
specific subject. It exists only in the gate manifest, never in a flag or
environment variable, and is subject to the trust anchor in
[§14](#14-manifest-ownership-trust-anchor-and-authority): only exceptions
present in the **base** manifest are honored as `PASS`; a head-added exception is
a proposal and leaves the result `HUMAN_REVIEW_REQUIRED`.

| Field | Rule |
|---|---|
| `exceptionId` | Unique, pattern `^EX-[A-Z0-9-]{3,40}$` |
| `scope` | Exactly one `checkId` and one exact subject (file path, region or domain); no wildcards |
| `reason` | Non-empty, bounded text; contains no secret material |
| `owner` and `reviewRef` | Named accountable owner and a reference to the reviewing PR/issue; the reference is data and is not machine-verified as approval |
| `expiresAtHead` or `expiresOn` | Mandatory; exceptions without expiry are `CONFIGURATION_ERROR`; expiry is checked against the run date (injected clock) and bounded by the base policy maximum |

An excepted result is reported as `PASS` **with** an `exceptionApplied` record
(never silently `PASS`). A `HUMAN_REVIEW_REQUIRED` result may not be excepted
into a pass. An exception cannot waive `1A` identity checks,
`CONFIGURATION_ERROR`, any wrong-head protection
([§25](#25-wrong-head-and-stale-evidence-protection)), or any CI evidence
classification. **A CI rerun justification record ([§17](#17-ci-evidence-ownership-and-the-machinehuman-boundary))
is not a manifest exception**: they are separate concepts with separate
schemas and trust models. Exceptions cover governed configuration exceptions;
a CI rerun justification is a human determination about observed CI evidence
and may never live in a file of the reviewed head.

## 16. Secret-suppression model

Secret scanning (`1A`) fails or requires human review on any hit unless an
explicit suppression covers it. A suppression follows the exception trust anchor
of [§14](#14-manifest-ownership-trust-anchor-and-authority) and
[§15](#15-governed-exception-model) (only base-anchored suppressions yield
`PASS`; a head-added suppression is a proposal and leaves the hit
`HUMAN_REVIEW_REQUIRED`), plus these rules:

- **Explicit and narrow:** one rule ID, one exact file path (and optionally one
  line range), one fingerprint; never a directory glob, never global, never
  "ignore high-entropy strings".
- **Only non-secret material:** a suppression may cover only a classified
  `TEST_FIXTURE` or `DOCUMENTED_PLACEHOLDER` whose value the reviewer has
  confirmed is non-secret and public. A value that is an actual secret is never
  suppressed; it must be removed and rotated.
- **Non-secret-bearing record:** the suppression stores `ruleId`, path, line
  range, the fixture classification, a reason, a review reference and a
  fingerprint -- never the value and never a prefix longer than 4 characters.
- **Fingerprint is a change-detection identifier, not a secrecy control.** It is
  the full SHA-256 (not truncated) of `ruleId`, path and the matched text, used
  only to detect that the suppressed text changed; it is acceptable to store
  because the suppressed values are, by rule, non-secret. A digest of a
  low-entropy secret is never treated as protecting that secret, and a
  truncated or unkeyed hash of an *unsuppressed* hit is never written to a
  report or log. If correlation of unsuppressed secret-like hits across runs is
  ever required, only a keyed digest (HMAC) with a key held outside the
  repository, or an opaque rule-and-location identifier, may be used.
- **Reviewed and traceable:** the suppression is part of the
  `GOVERNANCE_CONFIG` protected domain, with mandatory expiry as in
  [§15](#15-governed-exception-model).
- **Fail-closed:** a suppression that matches nothing, matches more than one
  hit, or whose fingerprint no longer matches becomes `FAIL` (a stale suppression
  is not silently ignored). An unknown secret-like value with no suppression
  never passes.
- **Output:** every finding prints rule ID, path, line and a masked form only.

## 17. CI evidence ownership and the machine/human boundary

**Decision D10 (corrected in C1): `1F` is the single owner of CI evidence;
`PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN` requires a human determination that
automation cannot produce and that lives outside the reviewed head.**

**Collected fields.** The `1F` collector records, for the exact head: workflow,
run ID, event (`pull_request` versus `push` validated against what the caller is
proving), head SHA (must equal the current `1A` head, else `FAIL`), attempt
number, required jobs (the base-anchored required-job list) and per-job
conclusions, whether the SHA equals the run's SHA and not a cached or borrowed
value, and any rerun history (which attempts, which jobs) with failure
signatures.

**Collection timing (F-4, decision: external post-run collector).** CI evidence
is collected by a separate `1F` invocation that runs **after** the workflow run
has completed, never by a job inside the run being observed. Two phases, one
canonical model:

1. *Phase 1 -- deterministic pre-review* (`1A`-`1E`, may run locally or as a CI
   job): it cannot observe its own run, so it emits `ci` as
   `{ "state": "NOT_COLLECTED" }`, which yields an `INCOMPLETE` record
   (`reasonCode CI_NOT_COLLECTED`). Phase 1 therefore always reports
   `readiness.state = NOT_READY` and never claims final readiness.
2. *Phase 2 -- post-run collection and finalization*: reads the completed run for
   the exact head, produces the CI evidence record, re-derives the Git identity
   fresh, verifies that every phase-1 record's `subject` equals it, and
   re-aggregates the same records plus the CI record into the finalized report.
   The governance job's own conclusion is observable in phase 2 because the run
   has finished.

A `ci` value that is absent or `null` is a schema violation
(`CONFIGURATION_ERROR`); it is never ignored. Reports are artifacts and are not
committed to the reviewed head (committing one would change the head).

**Partial or degraded CI evidence.** Each of the following is `INCOMPLETE`
(readiness `NOT_READY`): the run is still in progress or queued; a required job
is missing from the run; the API response is incomplete, truncated or of an
unexpected shape; the attempt number or attempt history is unknown; several
candidate runs cannot be disambiguated. A required job concluded
`failure`, `cancelled` or `timed_out` with no later same-SHA success record is
`FAIL`.

| Classification | Producer | Rule |
|---|---|---|
| `CLEAN_FIRST_PASS` | Machine | Attempt 1 of an event-matching run on the exact head, every required job concluded `success`, no rerun |
| `PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN` | Human-determined; machine only verifies the record's bindings | Requires a valid **CI rerun determination record** (below) covering every failed attempt and job in the rerun history, plus machine-verified same-SHA proof and a final attempt with every required job `success`; absent or invalid record: `HUMAN_REVIEW_REQUIRED` |
| `FAIL` | Machine | Wrong SHA, wrong event, a required job failed/cancelled/timed out with no later same-SHA success, or conflicting evidence |
| `INCOMPLETE` | Machine | CI not collected, in progress, API unreachable or partial, missing required job, ambiguous runs, missing attempt history |
| `HUMAN_REVIEW_REQUIRED` | Machine flags | Any rerun whose failure is not covered by a valid determination record, any unexplained failure, or an unrecognized state |

**CI rerun determination record (resolves OQ-GA-5).** A record of a human
review decision about observed CI evidence. It is external evidence, **not** a
manifest exception (a different concept, schema and trust model from
[§15](#15-governed-exception-model)), and it must never be stored inside the
reviewed HEAD or in any file whose modification would change the SHA it
justifies. Fields:

| Field | Rule |
|---|---|
| `repository` | Exact `owner/name` |
| `headSha` | Full 40-hex SHA of the reviewed head |
| `runId` | The CI run |
| `attempts` | The failed attempt number(s) and the final attempt number |
| `failedJobs` | Exact job identifiers that failed |
| `failureSignature` | The signature the machine collected for those failures (normalized) |
| `reviewer` | Identity/reference of the human who made the determination |
| `decisionRef` | A reference and timestamp of the decision |
| `category` and `justification` | Enumerated category and bounded, non-secret text |

Trust rules (invariants; the storage channel is left to implementation but must
satisfy all of them, otherwise the record is not accepted and the result stays
`HUMAN_REVIEW_REQUIRED`):

1. The record originates from a channel the author of the reviewed change
   cannot write to by pushing to the reviewed branch (for example review
   metadata of the change, or a separate recorded human review artifact).
2. `reviewer` is a human identity distinct from every author and committer of the
   commits under review, wherever those identities are machine-comparable;
   otherwise the record is not accepted.
3. Every binding field must equal the actual run data (repository, `headSha`,
   `runId`, attempts, failed jobs, and a matching `failureSignature`); any
   mismatch or a record for another SHA or run is rejected. A new commit
   invalidates the record.
4. The record is validated against a runtime schema (a repository input rule of
   [§20](#20-runtime-validation-at-every-input)).

The machine verifies bindings and distinctness and never evaluates whether the
failure was harmless, whether the rerun was justified, or whether it can be
waived. An unexplained or unknown failure without a valid record is
`HUMAN_REVIEW_REQUIRED`, never an automatic pass. No numeric automatic-retry
policy exists; the framework never reruns anything; rerun-until-green is never
scored as a pass. `GOV-VERIFY-1` consumes this classification and does not
implement a second CI lookup.

## 18. Sub-stage ownership map

| Stage | Responsibility | Inputs | Outputs | Depends on | Owner of | Public interface | Non-goals |
|---|---|---|---|---|---|---|---|
| `1A` Repository preflight | Git identity, diff scope, secret scan, suppression application | Validated manifest; Git objects; `repositoryRoot` | Identity record (branch, HEAD, TREE, parents, base), changed-file set, scope verdicts, secret findings (masked) | Wave 0 | Git identity, diff scope, secret scan | `getGitIdentity()`, `getChangedFiles({from, to, mode})`, `checkScope()`, `scanSecrets()`; `mode` is an explicit input (`PR_REVIEW`: base..head; `POST_MERGE`: first parent..merge commit) recorded in every record's `subject.range`, never hard-coded to base..head | No merge-gate facts (`PACK_DIFF`, branch protection); no network; no mutation |
| `1B` Markdown and reference integrity | Parser-aware tables, fences, headings, anchors, links; ID-family references | Changed-file set from `1A`; file bytes at head; manifest ID families | Parsed document structure, integrity records | Wave 0, `1A` | Markdown and reference integrity | `parseMarkdown()`, `checkReferences()` | No semantic wording judgment; no auto-fix |
| `1C` Evidence and provenance | Class vs strength separation, one class per row, promotion-wording flags, weakest-premise check | `1B` structure; manifest evidence-model config | Evidence records, `HUMAN_REVIEW_REQUIRED` flags | `1B` | Evidence/provenance validation | `checkEvidenceModel()` | Never decides whether an inference is substantively justified |
| `1D` Risk / source / method consistency | Totals, counts, taxonomy, research-method contradiction checks | `1B` structure; `1C` records | Consistency records | `1B`, `1C` | Risk/source and method consistency | `checkConsistency()` | Never decides whether a risk is acceptable; nuanced method cases are `HUMAN_REVIEW_REQUIRED` |
| `1E` Delta review and fingerprints | Domain change model, fingerprints, transitive invalidation, `PRESERVATION_CHECK_ONLY` eligibility | Graph (Wave 0); `1A` identity and changed files; `1B`-`1D` records; base and head Git content | Per-domain effective review level, fingerprints, reasons | Wave 0, `1A`-`1D` | Delta review, fingerprints | `computeDeltaReview()` | Never lowers review class; never states correctness |
| `1F` CI evidence and reporting | CI evidence collection/classification; report assembly; CLI; workflow wiring (later) | `1A` identity; GitHub run metadata; all stage records | CI evidence record; `pre-review.json`; derived `pre-review.md` | Wave 0, `1A`-`1E` | CI evidence, reviewer-facing summary | `collectCiEvidence()` (post-run; §17), `buildReport()` | Never computes readiness by any means except the kernel aggregator; never reruns CI; never observes its own run; not a required-check change |
| `1G` Independent framework validation | Independent Senior Software Developer and Security review, adversarial validation of `1A`-`1F` | The implemented framework, tests, fixtures | Review record | `1A`-`1F` merged | Nothing executable | none | Not code; not self-certification; not the Type & Schema Boundary Audit |

## 19. Implementation dependency order and waves

Dependencies force the order: the kernel first; `1B` needs `1A`'s changed-file
set; `1C`/`1D` need `1B`'s parsed structure; `1E` needs the graph, `1A` identity
and the domain checks it lists; `1F` aggregates everything; `1G` follows. The
hypothesis wave plan is **confirmed with one refinement**: Wave 0 also contains
the readiness/aggregation function and safe-process/path primitives (they are
consumed by every later stage), and `1F` in Wave 4 owns CLI/file wiring only.

| Wave | Content | Why here |
|---|---|---|
| 0 | Shared contracts: result/verdict types, error model and exit codes, manifest schema loader and validator, dependency-graph validator, path/process safety primitives, redaction, readiness aggregator (pure) | Every stage depends on them; contains no repository-specific check |
| 1 | `1A` + `1B` | Independent of each other except that `1B` consumes `1A`'s changed-file set through the interface; can be built in parallel against a fake interface |
| 2 | `1C` + `1D` | Both consume `1B` structure; `1D` consumes `1C` records |
| 3 | `1E` | Needs Wave 0 graph, `1A` identity, `1B`-`1D` domains |
| 4 | `1F` | CI evidence, report writer/renderer, CLI; after this the `1A`/`1F` interfaces are stable; `GOV-VERIFY-1`'s residue technically depends on them (a dependency, not a pause rule; see §5) |
| 5 | `1G` | Independent validation of the whole framework; no code |

Each wave is a separate `HEAVY` change with its own independent review, merge
and post-merge certification. Waves are recommendations to be confirmed by the
implementation missions; the ownership matrix, not the wave plan, is binding.

## 20. Runtime validation at every input

Static types are not relied on. Every value crossing a boundary is validated at
runtime and rejected (`CONFIGURATION_ERROR` or `INCOMPLETE`, per the source)
before use. This is a design requirement for `GOV-AUTO-1`; it does **not**
satisfy or claim to satisfy the future whole-project Type & Schema Boundary
Audit.

| Input | Validation |
|---|---|
| Manifest and base | JSON parse with size cap; exact schema; unknown field rejected; `schemaVersion` supported; string patterns; array/depth/length bounds; path and selector validation |
| CLI/config arguments | Allow-listed flags; values validated; no environment-variable overrides of safety settings |
| CI metadata (GitHub API) | Schema check of every field used; SHA is 40-hex; run/attempt numeric; unexpected shape is `INCOMPLETE`, never coerced |
| Git-derived data | SHAs 40-hex; parent count 1 or 2 as expected; refs matched exactly; empty output treated as a failure to establish, not as "no changes" |
| External command output | Exit status checked; stdout size-capped; parsed with strict formats; stderr never trusted as data |
| Evidence files | Read as bounded UTF-8; invalid encoding fails the domain; parsed by the `1B` parser only |
| Exceptions and suppressions | Same as manifest; base-anchored only for `PASS`; expiry evaluated with an injected clock |
| CI rerun determination record | Runtime schema; every binding field checked against actual run data; reviewer distinctness checked |

## 21. Public versus internal API boundary

Only the interfaces named in [§18](#18-sub-stage-ownership-map) and the kernel
(types, `validateManifest()`, `validateGraph()`, `aggregate()`) are public.
Consumers -- including `GOV-VERIFY-1` -- import only these. Stage-internal
helpers (parsers' token handling, regexes, extractors, git command builders) are
private; no consumer reaches into them, and no consumer recomputes an owner's
fact. Public results are frozen plain data (no live handles). Adding a public
interface requires a reviewed change to the ownership matrix. These modules are
not part of the npm package's supported public surface: `package.json` `exports`
and `files` are unchanged by this design and any implementation must be checked
against `docs/package-surface-v2.md` before changing them.

## 22. Error model and exit codes

**Decision D11.**

| Status | Meaning | Typical cause |
|---|---|---|
| `PASS` | The deterministic invariant held | Check satisfied |
| `FAIL` | The artifact or evidence violates an invariant | Forbidden path changed, wrong-SHA CI, broken table |
| `CONFIGURATION_ERROR` | The tool's configuration is invalid; no check outcome is trustworthy | Bad manifest, cycle, missing dependency declaration, unsupported schema |
| `HUMAN_REVIEW_REQUIRED` | The machine cannot decide; a human must | `MEANING` dependency change, promotion wording on inference, unexplained CI failure, protected-config change |
| `INCOMPLETE` | The tool could not establish the fact | API unreachable, base unavailable, timeout, truncated output |

Aggregation precedence for the overall run status (highest first):
`CONFIGURATION_ERROR` > `FAIL` > `INCOMPLETE` > `HUMAN_REVIEW_REQUIRED` >
`PASS`. Precedence controls only the summary; every underlying record remains
in the report. The overall status maps to `readiness.state` as in [§7](#7-shared-evidence-contract) (`PASS` to `READY`; `HUMAN_REVIEW_REQUIRED` to `HUMAN_REVIEW_REQUIRED`; the other three to `NOT_READY`). A fact that cannot be established is `INCOMPLETE`, never `PASS`,
and never silently `FAIL` for the wrong reason (`FAIL` means the artifact is
wrong; `INCOMPLETE` means the tool could not tell).

Optional CLI exit codes (a future implementation may adopt them as an option;
the report, not the exit code, is authoritative): `0` `PASS`; `1` `FAIL`; `2`
`CONFIGURATION_ERROR`; `3` `HUMAN_REVIEW_REQUIRED`; `4` `INCOMPLETE`; any
uncaught error exits non-zero and never `0`. An exit code of `0` means only
"the overall status is `PASS`".

## 23. Minimum `pre-review.json` schema and versioning

**Decision D12: JSON is canonical; `pre-review.md` is a derived view rendered
only from the JSON; the schema is versioned and an unknown incompatible version
fails.**

| Field | Type | Rule |
|---|---|---|
| `schemaVersion` | integer | Required; consumers reject any value they do not list as supported (`FAIL` for a verifier, never a best-effort read) |
| `tool` | object: `name`, `version` | Required |
| `generatedFor` | object: `head`, `tree`, `base`, `parents[]`, `branch` | Full 40-hex identity; must equal the `1A` identity |
| `manifest` | object: `gatePath`, `basePolicyPath`, `schemaVersions`, `headSha256`, `baseAnchor` (`PRESENT`/`ABSENT`), `protectedProposals[]` | Identity of the artifacts actually used and the loosening proposals that were **not** applied ([§14](#14-manifest-ownership-trust-anchor-and-authority)) |
| `reviewClass` | string | Effective class (base minimum or higher); the framework never assigns or lowers it |
| `changedFiles` | array of strings | From `1A`, with the `range` used |
| `records` | array of result records ([§7](#7-shared-evidence-contract)) | Canonical evidence |
| `domains` | array of `{domainId, effectiveLevel, reasons[], fingerprint}` | From `1E` |
| `ci` | object, never `null` | `{state: NOT_COLLECTED}` or the `1F` record with classification and any accepted determination-record reference |
| `humanReviewRequired` | array of record IDs | Convenience list; never empty when any record is `HUMAN_REVIEW_REQUIRED`; correctness never depends on it |
| `counts` | object: status -> integer | Derived from `records` |
| `overallStatus` | status | Derived ([§22](#22-error-model-and-exit-codes)) |
| `readiness` | object: `state` (`READY`, `NOT_READY`, `HUMAN_REVIEW_REQUIRED`), `dominantStatus`, `reasons[]` | Derived only ([§7](#7-shared-evidence-contract)); `state` alone is sufficient for a consumer |
| `notAuthorization` | literal `true` | Records that the report is not approval or merge authorization |

Determinism: keys emitted in a fixed order, arrays sorted by a documented key,
no timestamps inside the fingerprinted body (a separate `generatedAt` field is
allowed and excluded from any hash). The Markdown view contains no fact absent
from the JSON. A verifier that finds JSON and Markdown disagreeing treats the
JSON as canonical and fails the check.

## 24. Filesystem and process safety, determinism, offline testability

- `repositoryRoot` is the sole path authority. Every path is resolved and checked
  to remain under it; `..` traversal, absolute paths, symlink escape and paths
  outside the manifest's allowed scope are rejected before any read.
- Git and external commands are spawned with argument arrays and no shell;
  nothing derived from a manifest, branch name, file name or CI field is
  interpolated into a command string; each command has a timeout and an output
  cap.
- The framework is **read-only by default**: it writes only its own report
  files, to a location the manifest names and that resolves under
  `repositoryRoot`, and never mutates Git state, branches, PRs, settings or CI.
- Determinism: same head/base/manifest/inputs produce the same JSON body; the
  clock and any randomness are injected; no locale-dependent sorting.
- Offline testability: every check is a pure function of validated inputs; Git
  and GitHub access sit behind narrow adapters that tests replace with fixtures;
  the whole suite (including adversarial fixtures) runs with no network and no
  credentials. A live-CI adapter is exercised separately and is never required
  for the deterministic suite.

## 25. Wrong-head and stale-evidence protection

All evidence is bound to the exact triple (`head`, `tree`, `base`) established
by `1A` at run start.

1. Every result record carries `subject`; the aggregator rejects a record whose
   `subject` differs from the run identity (`FAIL`).
2. HEAD and TREE are derived from Git at run time; a manifest may declare an
   `expectedParent`/`base` but never a HEAD or TREE for a new review head.
3. CI evidence must carry a head SHA equal to the run's head, an event that
   matches the claim being proved (`pull_request` for pre-merge review,
   `push` for post-merge certification), and an attempt; a cached, borrowed or
   older-SHA result is `FAIL`; a truncated or ambiguous response is `INCOMPLETE`.
4. An existing `pre-review.json` is never trusted as input; it is regenerated.
   A report whose `generatedFor` differs from the head under review is stale.
5. Any commit after report generation invalidates that report; the aggregator
   compares `generatedFor` with a fresh `1A` identity when the report is consumed.

## 26. Interaction with review class and the human-review contract

- `GOV-AUTO-1` never changes a review class. `reviewClass` is copied from the
  manifest, which itself must match `ROADMAP.md` §6 rules and human
  classification; uncertainty and any executable, governance or security scope
  resolve to `HEAVY`; delta results cannot lower the class.
- **What reviewers receive:** the exact identity, the changed-file set, every
  record with reason code and evidence reference, the per-domain effective
  review level (with the reason a domain is not `PRESERVATION_CHECK_ONLY`), the
  `HUMAN_REVIEW_REQUIRED` list, the structural diff of manifest/exception/
  suppression changes, and the CI classification with the record needed for a
  human justification decision.
- **What the report never is:** approval, risk acceptance, waiver of a finding,
  security acceptance, merge authorization, or lifecycle completion. It is
  explicitly labeled so (`notAuthorization`), and no field is worded as a
  verdict such as `SAFE_TO_MERGE`.
- Independent review, Senior Software Developer review, Security review where
  required, ZERO-OPEN-NEW-DEFECT, exact-head merge authorization,
  `STANDARD_TWO_PARENT` merge, post-merge certification and canonical closure are
  unchanged.

## 27. Design decisions D1-D14

| ID | Decision | Rationale | Rejected alternatives | Consequences |
|---|---|---|---|---|
| D1 | Model A: composition; `GOV-AUTO-1` owns shared Git identity, diff-scope and CI evidence; `GOV-VERIFY-1` composes them and owns `PACK_DIFF`, `BRANCH_PROTECTION_STATUS`, merge-gate conformance | Single owner per fact; roadmap keeps `GOV-VERIFY-1` alive and non-blocking | B (creates a prerequisite on a non-blocking task), C (contradicts roadmap; different lifecycle moment), D (scopes not disjoint) | `GOV-VERIFY-1` overlapping work stays paused until `1A`/`1F` interfaces merge |
| D2 | JSON result records are the canonical evidence; discrete fields preserved | Roadmap requires discrete evidence never replaced | A single verdict field; Markdown-primary reports | Renderers cannot introduce facts |
| D3 | `readiness.state` is a derived three-value enum (`READY`, `NOT_READY`, `HUMAN_REVIEW_REQUIRED`); `READY` only when every record is `PASS` | Roadmap: aggregate convenience, not a verdict; a green value must not coexist with mandatory human judgment | Two-value YES/NO plus side flags (a consumer can ignore flags); stored readiness | `READY` with unresolved human-required state is impossible; correctness never depends on side lists |
| D4 | Every domain declares dependencies including `[]`; missing declaration is `CONFIGURATION_ERROR` | Missing declaration is a deterministic configuration fault; `HUMAN_REVIEW_REQUIRED` reserved for undecidable cases | Defaulting to `[]`; `HUMAN_REVIEW_REQUIRED` for missing keys (lets a run continue on an untrustworthy graph) | Manifest authors must be explicit |
| D5 | Validated DAG; unknown/self/duplicate/missing/disabled/cycle all `CONFIGURATION_ERROR`; cycles rejected, merged into one domain | Fail closed; keeps invalidation terminating | Justified cycles with fixpoint | Mutually dependent regions are one domain |
| D6 | Topological transitive invalidation with worst-of join; `MEANING` edges yield `HUMAN_REVIEW_REQUIRED`, others `DEEP_REVIEW_REQUIRED` | A machine can re-derive counts and references but not judge meaning | Direct-dependency-only invalidation; all-changes-to-human | No silent preservation downstream of a change |
| D7 | Change is per domain using seven conditions, not per file | A domain can change through an unmodified file's derived value | File-diff-only change detection | Manifest declaration changes also count |
| D8 | SHA-256 over Git-object content, LF-normalized, versioned, framed; fingerprint means unchanged only | Cross-platform stability without semantic normalization | Working-tree bytes; whitespace collapsing; unversioned hashes | Fingerprint version bump forces re-review |
| D9 | Committed, human-authored base policy plus per-gate manifest; the base commit is the trust anchor; the head may only tighten, loosening and head-added exceptions are proposals; bootstrap yields at best `HUMAN_REVIEW_REQUIRED`; field-by-field overlay precedence | A repository file is not authoritative merely by existing there; a head must not weaken its own review | One global manifest; generated manifest; head-authoritative config; overlay that can remove checks | A protected change is reviewed under the old configuration by a human and becomes the anchor only after merge |
| D10 | `1F` owns CI evidence, collected by an external post-run collector; "justified" rerun needs an external, SHA/run-bound human determination record that is not a manifest exception; unexplained failure is `HUMAN_REVIEW_REQUIRED` | Roadmap machine/human boundary; a record inside the reviewed head changes the head and lets the author self-justify; no rerun-until-green | Justification as manifest exception; in-run CI observation; automatic flake classification; retry policy | Record channel must satisfy the section 17 invariants; absent or invalid record stays `HUMAN_REVIEW_REQUIRED` |
| D11 | Five statuses with fixed aggregation precedence; exit codes optional and non-authoritative | Distinguish "artifact wrong" from "tool could not tell" (precedent: `audit-drift-check.js`) | Boolean pass/fail; exit-code-only contract | `INCOMPLETE` never becomes `PASS` |
| D12 | JSON canonical, Markdown derived, `schemaVersion` mandatory, unknown version fails | Precedent: `branch-inventory.js` schema versioning | Best-effort reading of newer schemas | Schema changes are reviewed versions |
| D13 | Evidence bound to (`head`,`tree`,`base`) from Git; existing reports and cached CI never trusted | Stale/borrowed CI is a recorded failure mode in this repository's history | Trusting a committed report | Reports are regenerated per head |
| D14 | Public interface limited to ownership-matrix APIs plus kernel; waves 0-5; Type & Schema Audit and `AISEC-4` remain separate | Prevents a second source of truth; keeps scope | Exposing internals; folding the audit into `1G` | Interface additions need a reviewed matrix change |

## 28. Non-goals and status boundaries

This design does not: implement any script, module, manifest, schema file,
workflow, package script or test; implement `GOV-VERIFY-1`; add or change a
required check or branch protection; change `ROADMAP.md`; reopen `AISEC-3`;
start `AISEC-4` (still `NOT_STARTED`); satisfy, certify or canonicalize the
separately required whole-project **Type & Schema Boundary Audit** (tooling may
later help that audit; tooling is not certification); or grant any agent
approval, merge or closure authority. It records no lifecycle transition:
`GOV-AUTO-1` remains `NOT_STARTED` on `ROADMAP.md` until a separate, reviewed
roadmap sync says otherwise, and can never become `COMPLETE_ON_MAIN` from a
design document alone. `GOV-AUTO-1` and its implementation still require the
normal completion lifecycle in `ROADMAP.md` §6: implementation, deterministic
suite, adversarial fixtures, independent Senior Software Developer review and
independent Security review, correctives, exact-head merge authorization,
`STANDARD_TWO_PARENT` merge, post-merge certification and canonical closure.

## 29. Framework threat analysis

| ID | Threat | Mitigation | Test requirement |
|---|---|---|---|
| GT-01 | Malicious manifest weakens checks (widens scope, disables domains, drops dependencies) | Manifest untrusted and validated; overlay cannot remove base checks; `GOVERNANCE_CONFIG` always `HUMAN_REVIEW_REQUIRED` with structural diff against base | Fixture: manifest disabling a base check is `CONFIGURATION_ERROR`; manifest scope widening is flagged |
| GT-02 | Path traversal or symlink escape via manifest paths or changed-file names | `repositoryRoot` resolution, realpath check, reject `..`/absolute/symlink escape | Fixtures for `..`, absolute path, symlink to outside |
| GT-03 | Command injection via branch, file or CI field | Argument arrays, no shell, allow-listed refs/SHAs, no string interpolation | Fixture: branch and file names containing shell metacharacters produce no execution |
| GT-04 | CI or evidence spoofing (green run on a different SHA, `pull_request` proof used as `push`) | Exact-SHA and event matching, attempt and job checks, ambiguity is `INCOMPLETE` | Wrong-SHA, wrong-event, duplicate-run, cached-result fixtures |
| GT-05 | Secret exfiltration through reports or logs | Masking everywhere, no value or long prefix printed, report/suppression schemas contain no value field; no truncated or unkeyed hash of an unsuppressed hit is emitted; a fingerprint is never a secrecy control | Fixture: report and logs for a planted secret contain only the masked form |
| GT-06 | Suppression or exception abuse (broad, permanent, or stale suppressions) | Narrow exact scope, mandatory expiry, stale/unused suppression is `FAIL`, human-reviewed config domain | Fixtures: glob suppression, no-expiry, expired, unmatched suppression |
| GT-07 | Fingerprint misuse (treating equal as correct or approved) | Fingerprint only feeds eligibility, never a verdict; eligibility requires the eight conditions; no text in output claims correctness | Fixture: unchanged fingerprint with changed upstream is not `PRESERVATION_CHECK_ONLY` |
| GT-08 | Dependency omission or cycle abuse to hide a change | Mandatory explicit declarations, DAG enforcement, dependency-declaration diff is protected | Fixtures: missing key, `[]` versus absent, cycle, self-loop, disabled dependency |
| GT-09 | Report tampering (committed or altered `pre-review.json`) | Reports regenerated, never trusted as input; JSON canonical; Markdown checked against JSON | Fixture: stale report with an old head is rejected |
| GT-10 | Stale or wrong-head evidence reused | Triple binding; subject equality enforced in the aggregator; base verified | Fixture: record with a different head fails aggregation |
| GT-11 | The framework passes a change to itself (self-certification) | Framework/config changes always human-reviewed; `1G` independent; report says `notAuthorization` | Review requirement, not a code test |
| GT-12 | Resource exhaustion (huge files, output, deep manifests) | Size, depth and time caps on every input and command | Fixtures: oversized manifest/file/command output fail closed |
| GT-13 | Self-justification: the author supplies the human determination for their own CI rerun | External SHA/run-bound record from a channel the author cannot write by pushing; reviewer distinct from author/committers; not a manifest exception; never inside the reviewed head | Fixtures: record inside the head, record by the author, record for another SHA/run, manifest-exception-as-justification are all rejected |
| GT-14 | Self-modifying manifest authority: the head rewrites its own scope, dependencies or exceptions | Base commit is the trust anchor; head can only tighten; loosening not applied and `GOVERNANCE_CONFIG` is `HUMAN_REVIEW_REQUIRED`; bootstrap yields at best `HUMAN_REVIEW_REQUIRED` | Fixtures: head widens scope, drops an edge, adds an exception or suppression, new gate without a base anchor |
| GT-15 | CI timing circularity or a silently missing CI record | External post-run collector; `ci` is never `null`; `NOT_COLLECTED`, in-progress or partial evidence is `INCOMPLETE` and `NOT_READY` | Fixtures: phase-1-only report, in-progress run, missing required job, `ci: null` schema violation |
| GT-16 | Readiness green-signal ambiguity: a consumer reads only readiness and misses required human judgment | Three-value `readiness.state`; `READY` only when every record is `PASS` | Fixture: any `HUMAN_REVIEW_REQUIRED` record yields a non-`READY` state |

Injection through Markdown content (prompt-style text in evidence files) is not
executed or interpreted: the framework only parses structure and never follows
instructions found in reviewed content.

## 30. Design validation matrix (adversarial)

Each case must be answered by this design without ambiguity.

| ID | Case | Design answer |
|---|---|---|
| GD-RV-01 | Two owners for the same fact | Impossible by [§6](#6-capability-ownership-matrix); a fact with two owners is a design defect |
| GD-RV-02 | `GOV-VERIFY-1` computes its own HEAD | Prohibited; it consumes `1A`'s interface |
| GD-RV-03 | Overlapping `GOV-VERIFY-1` work starts before `1A`/`1F` exist | Prohibited; stays `PAUSED` ([§5](#5-relationship-model-decision)) |
| GD-RV-04 | `GOV-VERIFY-1` "cancelled by absorption" | Rejected (Model C) |
| GD-RV-05 | Readiness `READY` while a record is `FAIL` | Impossible; derivation rule ([§7](#7-shared-evidence-contract)) |
| GD-RV-06 | Readiness hides `HUMAN_REVIEW_REQUIRED` | Impossible: `readiness.state` is itself `HUMAN_REVIEW_REQUIRED` |
| GD-RV-07 | Domain omits `dependsOn` | `CONFIGURATION_ERROR` |
| GD-RV-08 | Domain writes `dependsOn: []` | Legal; explicit independence |
| GD-RV-09 | Dependency on unknown domain | `CONFIGURATION_ERROR` |
| GD-RV-10 | Domain depends on itself | `CONFIGURATION_ERROR` |
| GD-RV-11 | A -> B -> A cycle | `CONFIGURATION_ERROR`; merge into one domain instead |
| GD-RV-12 | Duplicate domain ID or edge | `CONFIGURATION_ERROR` |
| GD-RV-13 | Dependency on a disabled domain | `CONFIGURATION_ERROR` |
| GD-RV-14 | A changes, C depends on B depends on A | B and C both at least `DEEP_REVIEW_REQUIRED` |
| GD-RV-15 | A `MEANING` dependency changes | Dependent is `HUMAN_REVIEW_REQUIRED` |
| GD-RV-16 | Own fingerprint unchanged, upstream changed | Not `PRESERVATION_CHECK_ONLY` |
| GD-RV-17 | File not in diff but its derived count changes | Domain is `changed` (§11 condition 2/3) |
| GD-RV-18 | Manifest declaration of a domain edited in the PR | Domain changed; `GOVERNANCE_CONFIG` is `HUMAN_REVIEW_REQUIRED` |
| GD-RV-19 | Base version unavailable for a domain | `HUMAN_REVIEW_REQUIRED`, not "unchanged" |
| GD-RV-20 | CRLF versus LF only difference | Same fingerprint (canonicalization) |
| GD-RV-21 | Whitespace change inside a table | Different fingerprint (whitespace preserved) |
| GD-RV-22 | Fingerprint equal | Means unchanged only; never correct or approved |
| GD-RV-23 | Suppression with a glob or no expiry | `CONFIGURATION_ERROR` |
| GD-RV-24 | Suppression that no longer matches | `FAIL` |
| GD-RV-25 | Rerun after an unexplained CI failure | `HUMAN_REVIEW_REQUIRED` until a valid external, SHA/run-bound human determination record exists (never a manifest exception, never in the reviewed head) |
| GD-RV-26 | CI green on another SHA / `pull_request` used as `push` | `FAIL` |
| GD-RV-27 | Manifest declares a HEAD/TREE for the review head | Rejected; derived from Git at run time |
| GD-RV-28 | Unknown `schemaVersion` in manifest or report | Fail |
| GD-RV-29 | Tool cannot reach the CI API | `INCOMPLETE`, readiness `NOT_READY` |
| GD-RV-30 | Framework asked to lower review class from `HEAVY` | Not possible; class copied, never derived |
| GD-RV-31 | Design claims Type & Schema Audit or `AISEC-4` progress | Prohibited ([§28](#28-non-goals-and-status-boundaries)); both remain separate/`NOT_STARTED` |

## 31. Open questions

Classification: `BLOCKING_DESIGN` questions must be resolved before any
implementation; there are none.

| ID | Question | Class | Note |
|---|---|---|---|
| OQ-GA-1 | Exact ID-family list and regexes for the first manifest | `NON_BLOCKING_IMPLEMENTATION` | Configured in manifest per stage `1B`; families named in the roadmap are the starting set |
| OQ-GA-2 | Concrete secret rule set and masking length | `NON_BLOCKING_IMPLEMENTATION` | Constrained by [§16](#16-secret-suppression-model); tuned in `1A` |
| OQ-GA-3 | Whether `governance/` or `scripts/governance/` hosts manifests versus code | `NON_BLOCKING_IMPLEMENTATION` | Roadmap already permits both; final layout fixed in Wave 0 review |
| OQ-GA-4 | Whether a dedicated "Governance Pre-Review" workflow is added and whether it later becomes a required check | `NON_BLOCKING_IMPLEMENTATION` | Branch-protection change needs separate authorization |
| OQ-GA-5 | Where the CI rerun justification lives and what binds it | `RESOLVED` in C1 | External, SHA/run-bound, human-authored, distinct from author; not a manifest exception ([§17](#17-ci-evidence-ownership-and-the-machinehuman-boundary)) |
| OQ-GA-9 | Concrete storage channel for the determination record | `NON_BLOCKING_IMPLEMENTATION` | Must satisfy the four §17 trust invariants; a channel that cannot is not accepted |
| OQ-GA-6 | Extractor strategy for Markdown domain regions (heading-based versus marker-based) | `NON_BLOCKING_IMPLEMENTATION` | Must yield the region selectors of [§13](#13-fingerprint-model) |
| OQ-GA-7 | Reuse of the framework for the Type & Schema Boundary Audit | `FUTURE_ENHANCEMENT` | Tooling may help; certification stays separate |
| OQ-GA-8 | Non-Markdown artifact domains (JSON, code) | `FUTURE_ENHANCEMENT` | Design is region-selector based and format-agnostic |

`BLOCKING_DESIGN` count: **0**.

## 32. Status summary

```text
GOV-AUTO-1 design:                       AUTHORED (C1 applied; pending independent re-review)
GOV-AUTO-1 implementation:               NOT_STARTED
GOV-AUTO-1 COMPLETE_ON_MAIN:             NO
Relationship model:                      A -- composition (GOV-AUTO-1 owns shared facts)
GOV-VERIFY-1:                            tracked; overlapping implementation PAUSED (see section 5)
AISEC-4:                                 NOT_STARTED
Type & Schema Boundary Audit:            separate; not satisfied by this design
BLOCKING_DESIGN open questions:          0
Merge authorization:                     NO
Next step:                               independent GOV-AUTO-1 design C1 re-review (HEAVY)
```

## 33. Corrective C1 traceability

| Review finding | Resolution | Where |
|---|---|---|
| F-1 (HIGH) CI justification self-approval path | External, SHA/run-bound human determination record; not a manifest exception; never in the reviewed head; OQ-GA-5 resolved | [§15](#15-governed-exception-model), [§17](#17-ci-evidence-ownership-and-the-machinehuman-boundary), D10 |
| F-2 (MEDIUM) readiness may be green with pending human judgment | Three-value `readiness.state`; `READY` only when every record is `PASS` | [§7](#7-shared-evidence-contract), D3 |
| F-3 (MEDIUM) manifest authority undefined | Base commit is the trust anchor; head can only tighten; bootstrap and overlay precedence defined | [§14](#14-manifest-ownership-trust-anchor-and-authority), D9 |
| F-4 (MEDIUM) CI timing circular, missing CI undefined | External post-run collector; absent/partial CI is `INCOMPLETE`; `ci: null` is a schema violation | [§17](#17-ci-evidence-ownership-and-the-machinehuman-boundary) |
| F-5 (LOW) algorithm vs preservation preconditions | Section 12 is an explicit pre-gate inside the section 10 algorithm | [§10](#10-transitive-invalidation-algorithm), [§12](#12-preservation_check_only-eligibility) |
| F-6 (LOW) pause trigger stricter than ROADMAP | Trigger aligned with ROADMAP wording; Wave 4 is a technical dependency only; ROADMAP sync handoff defined | [§5](#5-relationship-model-decision) |
| I-1 post-merge diff range | Explicit range mode carried as input and in `subject` | [§18](#18-sub-stage-ownership-map) |
| I-2 masked fingerprint entropy | Fingerprint is not a secrecy control; only non-secret fixtures are suppressed | [§16](#16-secret-suppression-model) |
| I-3 `Status: CURRENT` | Unchanged; follows AISEC study precedent | header |
