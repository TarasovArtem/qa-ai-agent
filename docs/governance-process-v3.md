# Governance Process v3

CRW2-B6, addressing conformance finding B-6.

Status: **CURRENT**
Supersedes: [`governance-process-v2.md`](governance-process-v2.md)

## Why v3 exists

Architecture Conformance Gate finding `A-1` introduced the first versioned
normative contract for the **existing** `PACKAGE_GOVERNANCE` knowledge domain:
[`docs/package-surface-v1.md`](package-surface-v1.md) (decision
`A1_DECISION: PRIVATE_GENERATIVE_SURFACE`), which defines the supported
public surface (`exports`) separately from the physical distribution surface
(`files`). Until now that domain's catalog row recorded its version as
*implicit* and its normative source as the `package.json` `files` field
itself.

This is **not** catalog synchronization under this document's own "Change
control" rule. Catalog synchronization requires (condition 1) that the change
follow Case A or Case B, and (condition 5) that the prior version of the
referenced contract be explicitly marked superseded. Here there is no
predecessor artifact: the prior "version" is an unversioned field of
`package.json`, which stays the domain's executable authority and cannot be
marked `SUPERSEDED`. Case A and Case B cannot apply, so the change is a
**normative change** requiring a new version of this document — performed
atomically, in the same reviewed PR that introduces the new contract, per
Case A applied to this document itself (see "Change control" below). It was
deliberately not deferred: the catalog would otherwise point at a normative
source that disagrees with the package's real contract.

Version history: `v1` established the catalog and the review/merge rules;
`v2` added the `ARCHITECTURE_MODEL_BOUNDARY` domain (finding `A-3`); `v3`
gives `PACKAGE_GOVERNANCE` its first versioned normative source (finding
`A-1`).

**No other normative rule changes in this transition.** The authority
hierarchy, the independent-review/self-approval/self-merge/self-closure
prohibition, merge method, post-merge certification, zero-open-new-defect
policy, metadata-truth synchronization, current/historical/supersession
semantics, conflict handling, and every catalog entry other than
`PACKAGE_GOVERNANCE` and this document's own `REVIEW_MERGE_GOVERNANCE`
pointer are carried forward from `v2` unchanged.

## Why this exists

A conformance analysis flagged `B-6`: this repository's governance/process
knowledge is not durably versioned. Before this document existed (as
`v1`), that was concretely true in one specific, load-bearing way — not
merely "some docs could be better organized":

- Three narrow, subject-specific versioned contracts already exist
  ([`docs/branch-inventory-v1.md`](branch-inventory-v1.md),
  [`docs/evaluation-execution-policy-v1.md`](evaluation-execution-policy-v1.md),
  [`docs/qa-generation-contracts-v1.md`](qa-generation-contracts-v1.md)),
  but **no catalog anywhere lists what they are**, what each covers, or how
  a reader finds them. A new contributor or agent must discover them by
  chance directory listing.
- [`ROADMAP.md`](../ROADMAP.md) §1 already states one explicit authority
  split (ROADMAP.md is authoritative for sequence/gate; README.md for
  technical evidence) — but nothing extends that split to the versioned
  `docs/*.md` contracts, `SECURITY.md`, `PROVIDERS.md`, or `PUBLISHING.md`.
- Most materially: this project's entire review/merge lifecycle depends on
  the concept of an **independent** review — `COMPLETE_ON_MAIN` is defined
  (ROADMAP.md §2) as "implemented, **independently reviewed**, merged,
  post-merge certified" — but **no repository artifact anywhere defines
  what makes a review independent**, or states the rule that an
  implementer must never grant itself source approval, merge its own PR,
  self-close its own finding, or mark a stage `COMPLETE_ON_MAIN`/
  `CLOSED_ON_MAIN`. A full-repository search (`ROADMAP.md`, `README.md`,
  `SECURITY.md`, `PROVIDERS.md`, `PUBLISHING.md`, `docs/**`) for
  `self-approv`, `self-merge`, `same session`, `same agent` returned zero
  matches at the time `v1` was written. This rule has been followed in
  practice but had never had a durable home.

**This document does not implement anything executable.** It is a
docs-only catalog and normative-rule record. It creates no runtime
authority, no manifest, no validator — see "What this document does not
do" below for the explicit boundary.

## Governance/process knowledge catalog

| Knowledge ID | Subject | Current version | Normative source | Executable authority | Status | Supersedes | Owner/change gate |
|---|---|---|---|---|---|---|---|
| `BRANCH_GOVERNANCE` | Branch classes, protection expectations | v1 | [`docs/branch-inventory-v1.md`](branch-inventory-v1.md) | [`scripts/diagnostics/branch-inventory.js`](../scripts/diagnostics/branch-inventory.js) | CURRENT | — | Reviewed PR updating both doc and `MANIFEST` together |
| `EVALUATION_EXECUTION` | Evaluation/regression merge-blocking policy (v1-v6) | v1 | [`docs/evaluation-execution-policy-v1.md`](evaluation-execution-policy-v1.md) | [`scripts/ai/evaluation/execution-policy.js`](../scripts/ai/evaluation/execution-policy.js) | CURRENT | — | Reviewed PR satisfying that document's own four-point promotion criteria |
| `QA_GENERATION_CONTRACTS` | `RequirementModel`→`TestCaseModel`→`AutomationCandidate`→`AutomationPlan` data contracts | v1 | [`docs/qa-generation-contracts-v1.md`](qa-generation-contracts-v1.md) | `scripts/ai/generation/*` | CURRENT | — | Reviewed PR updating doc and validators together |
| `ARCHITECTURE_MODEL_BOUNDARY` | Relationship between deterministic RTI artifacts (`RequirementArtifact`, `TestDesignArtifact`) and `#22`/`#23` generative models (`RequirementModel`, `TestCaseModel`); allowed cross-context adapter boundary | v1 | [`docs/architecture-model-boundary-v1.md`](architecture-model-boundary-v1.md) | RequirementArtifact validator: [`scripts/ai/requirement-artifact.js`](../scripts/ai/requirement-artifact.js); `#22` generative validators: `scripts/ai/generation/*`; allowed evidence adapter: [`scripts/ai/test-design/evidence-ingestion.js`](../scripts/ai/test-design/evidence-ingestion.js) | CURRENT | — | Reviewed PR changing the normative boundary contract and any executable adapter/validators affected by that contract together |
| `REVIEW_MERGE_GOVERNANCE` | Independent-review requirement, self-approval/self-merge/self-closure prohibition, merge method, post-merge certification, zero-open-new-defect policy | v3 | **this document**, §"Review, merge, and lifecycle process" | none (human/process rule, not automated) | CURRENT | v2 | Reviewed PR to this document |
| `LIFECYCLE_STATUS_AUTHORITY` | Current sequence, active gate, per-finding lifecycle state | continuously updated in place (not per-edit versioned) | [`ROADMAP.md`](../ROADMAP.md) §2/§6/§8 | none — ROADMAP.md itself is the authority | CURRENT | — | Reviewed PR per this project's own standing merge-gate process |
| `PACKAGE_GOVERNANCE` | What ships in the published npm package, and which modules are the supported public surface (`exports` vs. `files`; private generative surface) | v1 | [`docs/package-surface-v1.md`](package-surface-v1.md) | [`package.json`](../package.json) `exports`/`files` (declaration); `npm pack` (actual artifact); enforced by [`test/installation/package-surface.test.js`](../test/installation/package-surface.test.js) | CURRENT | — (previously implicit and unversioned: the `package.json` `files` field alone) | Reviewed PR changing the contract and `package.json` `exports`/`files` together |

This catalog references existing content; it does not duplicate any of
the above documents' own substance. `BRANCH_GOVERNANCE`, `EVALUATION_EXECUTION`,
`QA_GENERATION_CONTRACTS`, `ARCHITECTURE_MODEL_BOUNDARY`, and
`LIFECYCLE_STATUS_AUTHORITY` are unchanged by this `v3` transition — only
`REVIEW_MERGE_GOVERNANCE` (now pointing at `v3`, superseding `v2`) and
`PACKAGE_GOVERNANCE` (now versioned, pointing at
`docs/package-surface-v1.md`) changed.

## Authority hierarchy

When two sources appear to describe the same subject, this is the
precedence order, derived from how this project already behaves (not
invented ordering):

1. **Executable authority** — runtime code (`scripts/**`, `package.json`)
   is the authority for what the system actually does at runtime. This is
   a descriptive ranking, not a license to leave a conflict unresolved:
   if runtime behavior conflicts with an applicable normative contract
   (tier 2 below) or this document's own rules, that conflict is itself a
   defect requiring reviewed correction — either the code or the
   contract, whichever is wrong — never a silent, permanent divergence.
   This mirrors `BRANCH_GOVERNANCE`'s and `EVALUATION_EXECUTION`'s own
   existing convention of updating doc and code together on any change.
2. **Versioned normative contract** — a `docs/*-vN.md` file such as the
   ones catalogued above (including this one). Durable, explicit,
   reviewed-on-change policy for one narrow subject.
3. **Canonical lifecycle/status authority** — `ROADMAP.md`, for current
   sequence, active gate, and per-finding lifecycle state, per its own
   §1 self-declaration.
4. **Descriptive project documentation** — `README.md`, `SECURITY.md`,
   `PROVIDERS.md`, `PUBLISHING.md`. Authoritative for the specific things
   they each already claim to own (README.md: detailed technical evidence
   of completed tracks, per ROADMAP.md §1; SECURITY.md: security/privacy/
   trust-boundary controls "as verified directly against the current
   source"), otherwise descriptive.
5. **Historical evidence** — closed PR bodies, merge-commit messages,
   superseded ROADMAP.md sections explicitly labeled historical (e.g.
   ROADMAP.md §7's "Subsequent owner decision" blocks). Valuable
   provenance, never re-read as current policy.

## Review, merge, and lifecycle process

Some of this section's rules already had a durable, if terse, name in
`ROADMAP.md` §6 before this document existed — `zero-open-new-defect`,
`explicit merge authorization`, and `post-merge certification` are each
already named there as part of the existing `HEAVY` review model. What
had **not** existed anywhere, before `v1` of this document, is: a
comprehensive governance/process knowledge catalog; an explicit
cross-document authority hierarchy; an explicit definition of what makes
a review "independent" (the self-approval/self-merge/self-closure
prohibition below); metadata-truth synchronization as a stated durable
rule (previously only operational habit); and a current/historical/
supersession model. This section records both — the already-named rules
precisely, and the previously-undocumented rules for the first time —
without restating every operational checklist already living in
`ROADMAP.md` §6 (linked, not duplicated).

- **Independent review is mandatory before any finding may be marked
  `COMPLETE_ON_MAIN`/`CLOSED_ON_MAIN`.** "Independent" means: the actor or
  session that performed the implementation for a given slice must never
  also grant that slice's own source approval, merge that slice's own PR,
  self-close that slice's own finding, or mark that slice
  `COMPLETE_ON_MAIN`/`CLOSED_ON_MAIN`. This holds **even when the same
  underlying tool, model, or human performs both the implementation and
  the review role across separate, discrete turns/sessions** — separation
  is by role and by turn, never by tool/human identity alone. A review
  performed by the same in-progress turn/session that just finished
  implementing is not independent, regardless of who or what performed
  the implementation.
- **Granting merge authorization is a separate step from executing the
  merge, and the two must not happen in the same turn/mission.** An
  independent review may reach `MERGE AUTHORIZATION: YES` — that review
  turn/mission must still not itself execute the merge. Merge execution
  happens in a distinct, subsequent turn/mission, after authorization,
  followed by post-merge certification. The full lifecycle is:
  implementation → independent review (may authorize, does not merge) →
  merge (separate mission) → post-merge certification → canonical
  closure. This holds regardless of which actor/tool performs the merge
  mission — the constraint is temporal/role separation from the review
  step, not a distinct-identity requirement.
- **Review classification is LIGHT or HEAVY**, decided by the actual diff,
  never by finding severity or subject label alone — see `ROADMAP.md` §6
  "Review classification (LIGHT / HEAVY)" for the exact criteria.
  Escalation is one-directional: LIGHT may escalate to HEAVY; HEAVY may
  never downgrade to LIGHT.
- **Merge method is a standard two-parent merge** for every governed
  finding — no squash, no rebase, no force-push, no history rewrite, and
  never merging a HEAD different from the one actually reviewed and
  authorized. Exact HEAD is re-verified immediately before merge.
- **Post-merge certification runs on the exact merge SHA**, via a fresh
  `push`-event CI run — a pre-merge `pull_request`-event run is never
  substituted as post-merge proof.
- **Zero-open-new-defect**: any actual new defect (`BLOCKER`/`HIGH`/
  `MEDIUM`/`LOW`/`INFO`) discovered during review blocks approval,
  regardless of severity. A style preference is never counted as a
  defect.
- **Metadata truth must be kept synchronized with reality**: a PR's own
  body must not claim a stale state (e.g. "review pending" after review
  approved it, or "not yet merged" after it merged) — see this project's
  own recurring `*-META`/`*-META2` corrective pattern (e.g.
  `CRW2B4-R03`/`CRW2B4-R04`, `CRW2B4-CLOSE-R01`/`CRW2B4-CLOSE-R02`) for
  precedent. This never changes git history — PR body text only.
- **Parallel-track semantic-overlap revalidation is mandatory** before
  merging a parallel `HEAVY` PR whose exact-head review predates the
  current tip of `main` — see `ROADMAP.md` §6 "Mandatory parallel-safety
  controls" for the exact rule; not duplicated here.

## Current vs. historical, and supersession

- A cataloged knowledge artifact is **CURRENT** for its subject unless a
  reviewed PR explicitly marks it superseded by a newer version of the
  *same* subject (updating the `Supersedes` column and the `Current
  version` column together, in the same reviewed PR that introduces the
  new version — see "Change control" below for whether that update
  requires bumping this document itself).
- `ROADMAP.md`'s "current state" prose (§6's opening paragraph, §8) is
  continuously updated in place, not versioned per-edit — it is the
  canonical lifecycle authority by definition (§1), not a versioned
  contract like the `docs/*-vN.md` files.
- Historical decision records — `ROADMAP.md` §7's "Subsequent owner
  decision" blocks, per-finding "closure evidence" blocks, and closed PR
  bodies/merge-commit messages — are historical evidence of what was true
  or decided at a point in time. They are never re-read as current policy
  unless a section explicitly says a historical record still governs
  going forward (e.g. §7's adopted sequence, which is current until
  explicitly revised).
- **Marking an artifact superseded is a non-semantic lifecycle
  annotation, not a new version of that artifact.** The superseded
  artifact receives only a terminal status header (`Status: SUPERSEDED`,
  `Superseded by: <path>`), added as part of the same reviewed PR that
  introduces its successor — its own historical policy body is never
  otherwise edited, and it is never silently deleted. This is what
  closes the apparent paradox of "editing v1 to say superseded": the
  edit is a terminal status marker, not a substantive change, and by
  itself never triggers a version bump of the document being marked (see
  "Change control" below for the full rule). Each of this document's own
  transitions (`v1` → `v2`, `v2` → `v3`) applied exactly this rule to
  the predecessor — see the terminal markers in
  [`governance-process-v1.md`](governance-process-v1.md) and
  [`governance-process-v2.md`](governance-process-v2.md).

## Conflict handling (fail-closed)

If two sources both claim to be the current, authoritative answer for the
same normative subject, that is a **governance conflict**, not a
resolvable ambiguity. This project's rule: such a conflict must be
resolved by an explicit, reviewed correction that states which source is
authoritative and why (per the "Authority hierarchy" above) — never by a
"take the newest" heuristic (newest file timestamp, newest git commit,
lexicographically highest version string, or first source checked). No
machine-readable resolver exists for this catalog today; the rule above
is applied by whoever reviews the conflicting change, and this document
states it explicitly so that judgment is not ad hoc.

## Change control

This document, and the knowledge it catalogs, changes only through
ordinary repository review (a reviewed PR) — never through automated
self-modification. There are five kinds of change:

- **Editorial clarification** (wording, formatting, a broken-link fix
  that does not change which source or version is pointed to): no
  version bump.
- **Catalog synchronization** — an update to an *existing* catalog
  entry's `Current version`, `Normative source`, or `Supersedes` column,
  driven by a version transition of the *referenced* contract (e.g.
  `branch-inventory-v1.md` → `branch-inventory-v2.md`): does **not**
  require a new version of this document, **provided all** of the
  following hold —
  1. the transition follows one of the two governed models immediately
     below (Case A — atomic version transition, or Case B — catalog
     repair);
  2. the "Authority hierarchy" above is unchanged;
  3. the knowledge domain's subject/meaning is unchanged;
  4. no rule in "Review, merge, and lifecycle process" changes;
  5. the transition's exact merged HEAD leaves exactly one version of the
     referenced contract marked `CURRENT`, with the prior version
     explicitly marked superseded.

  If any of these five do not hold, the change is a **normative change**
  (below), not catalog synchronization.

  **Case A — atomic version transition (the normal path).** The
  successor artifact does not yet exist on `main`. One reviewed PR
  contains, as one exact HEAD: the successor artifact (e.g.
  `branch-inventory-v2.md`); the terminal supersession marker added to
  the predecessor (`branch-inventory-v1.md`'s `Status: SUPERSEDED` /
  `Superseded by:` header); the catalog pointer update in this document;
  and any executable counterpart change that domain's own contract
  requires. **Before that PR merges, `main`'s canonical `CURRENT`
  version for that domain remains the predecessor** — a successor
  artifact existing only on an open PR branch is never authoritative,
  no matter how complete the PR looks. Independent review evaluates the
  entire transition as one exact HEAD, exactly as any other governed PR.
  Only once that exact HEAD is merged and post-merge certified does the
  successor become the sole `CURRENT` version and the predecessor become
  canonically `SUPERSEDED` — there is no intermediate state on `main`
  where the catalog points to a stale or nonexistent version. **This
  document's own `v2` → `v3` transition follows this exact Case A model
  applied to itself** (see the worked example below) — it was performed
  atomically, in the same reviewed PR that introduced the
  `docs/package-surface-v1.md` contract triggering it (as `v1` → `v2` was
  for `ARCHITECTURE_MODEL_BOUNDARY`), never as a postponed Case B repair.

  **Case B — catalog repair / late synchronization (the exception).** A
  successor version already exists on `main` from a previously accepted,
  separate transition, but this document's catalog was never updated in
  that transition (a pre-existing gap, not the normal path). A later
  corrective PR may synchronize the catalog alone: it must identify the
  already-merged, already-reviewed successor, mark the predecessor
  superseded if not already marked, and leave exactly one `CURRENT`
  version — never inferred by "newest file" or timestamp. Case B exists
  only to repair a gap; Case A is the path every future transition
  should follow so that gap is never created in the first place.

- **Normative change** (a new knowledge domain added, the authority
  hierarchy reordered, a rule in "Review, merge, and lifecycle process"
  amended, or a catalog-pointer update that fails any catalog-
  synchronization condition above): new version of *this*
  document (`v2` after `v1`, `v3` after `v2`, ...), with the prior version explicitly marked superseded per the
  rule above — never deleted, never left ambiguous. Introducing a
  successor artifact for *another* cataloged domain (Case A above) is
  not, by itself, a normative change to this document — the referenced
  domain's own version changes; this document's own rules do not. Two
  transitions of this document are examples: `v1` → `v2` (a new
  knowledge domain, `ARCHITECTURE_MODEL_BOUNDARY`, was added) and `v2` →
  `v3` (an existing domain, `PACKAGE_GOVERNANCE`, gained its first
  versioned normative source; not catalog synchronization, because no
  predecessor artifact exists to mark superseded, so Case A/Case B cannot
  apply and synchronization condition 1 fails).
- **Retirement/deprecation**: an entry may be marked retired if its
  subject no longer applies; it is never removed silently.
- **Emergency correction**: allowed, without a version bump, **only**
  when the change does not alter normative meaning or authority — e.g. a
  typo in a file path, a broken Markdown link, or an incorrect SHA/
  example value that is purely illustrative evidence, not the thing being
  governed. It must **never** be used, without a version bump, for: an
  authority-ranking change; a change to a review/merge/conflict rule; a
  change to what counts as `CURRENT` for a subject; a change to a
  knowledge domain's meaning; or a catalog authority-pointer change that
  does not meet every "catalog synchronization" condition above.

A simple explicit integer version (`v1`, `v2`, ...) is used, matching this
repository's existing `docs/*-v1.md` convention — no SemVer machinery is
introduced. **A version transition's review class (`LIGHT` or `HEAVY`) is
decided by its own actual cumulative diff**, per "Review classification"
above — a docs-only successor keeps a transition `LIGHT`; a successor
that also requires an executable counterpart change makes it `HEAVY`.
Catalog synchronization does not, by itself, force either class.

### Worked example — a referenced contract's own version bump (Case A)

**Base `main`:** `BRANCH_GOVERNANCE`'s `Current version` is `v1`;
`branch-inventory-v1.md` is `CURRENT`.

**Transition PR** (one exact HEAD, reviewed as a whole) adds:
`docs/branch-inventory-v2.md`; any required `MANIFEST`/code change in
`scripts/diagnostics/branch-inventory.js`; a terminal
`Status: SUPERSEDED` / `Superseded by: branch-inventory-v2.md` header on
`branch-inventory-v1.md` (its historical body otherwise untouched); and
this document's `BRANCH_GOVERNANCE` row updated to
`Current version: v2`, `Normative source: branch-inventory-v2.md`,
`Supersedes: v1`.

**Before merge:** `main` still has `branch-inventory-v1.md` as the sole
`CURRENT` `BRANCH_GOVERNANCE` source — the open PR branch's proposed
`v2` is not yet authoritative.

**After independent review, exact-head merge, and post-merge
certification:** `branch-inventory-v2.md` is the sole `CURRENT` version;
`branch-inventory-v1.md` is canonically `SUPERSEDED`; the catalog points
to `v2`. This document does **not** itself bump versions for this
example — this was a Case A catalog synchronization (all five conditions
held; this document's own rules did not change). No "newest wins"
heuristic was used at any point — the transition PR's own exact reviewed
content, not a file timestamp or filename comparison, determined the
outcome.

### Worked example — this document's own normative change

**Base `main`:** `governance-process-v2.md` is `CURRENT` for
`REVIEW_MERGE_GOVERNANCE`.

**Transition PR** (one exact HEAD) adds `docs/governance-process-v3.md`
— its own text declaring `Supersedes: governance-process-v2.md`, and
carrying `v3`'s own copy of the full knowledge catalog (including its
own `REVIEW_MERGE_GOVERNANCE` row, now pointing at itself); adds the
terminal `Status: SUPERSEDED` / `Superseded by: governance-process-v3.md`
header to `governance-process-v2.md` (its historical `v2` policy body
not otherwise edited, never mutated into a "v2.1"); and updates any
other in-repository reference that pointed at `v2`. The earlier
`v1` → `v2` transition followed the same pattern.

**Before merge:** `main` still has `governance-process-v2.md` as
`CURRENT` — the open PR's `v3` is not yet authoritative, exactly as in
Case A.

**After merge and certification:** `governance-process-v3.md` is the
sole `CURRENT` governance-process contract; `v2` (and `v1`) are
`SUPERSEDED` and purely historical — a future reader consults `v3`'s own
catalog table going forward. Unlike the `BRANCH_GOVERNANCE` example, this
transition **does** require the version bump: the catalog pointer for an
existing domain moved to a first versioned source with no predecessor
artifact, so this is a **normative change**, not catalog synchronization,
per "Change control" above. **This is exactly the transition this document
itself is: `v3`, produced by this same worked example applied to itself,
giving `PACKAGE_GOVERNANCE` its first versioned normative source.**

### Fail-closed transition rule

A version-transition PR (Case A) must never be approved if, at its
proposed merged HEAD, any of the following would hold: the successor
artifact is missing; the predecessor lacks its supersession marker; the
catalog still points to the predecessor; the catalog points to a
nonexistent successor; two versions of the same domain are both marked
`CURRENT`; no version is marked `CURRENT`; or the authority hierarchy
changed without a `governance-process` version bump. This is a human/
process review rule — not an automated validator — applied by whoever
reviews the transition, per "Conflict handling" above. No temporal
heuristic ever substitutes for it: a newer commit, a newer filename, a
higher-version-looking filename, or an open PR's own existence never by
itself makes a version authoritative — only a merged, reviewed
transition does.

## Relationship to future RAG / Memory

`B-6` is not `RAG` and not `MEM`. This catalog and its authority
hierarchy give a future retrieval (`RAG`) or persistent-memory (`MEM`)
component a canonical governance-discovery entry point, so that future
work does not need to discover which sources are authoritative through
repository-wide heuristic search (comparing file timestamps, guessing
from filenames, or scanning every `*.md` file to infer what's current).
**This document does not itself provide machine-readable resolution**:
it is Markdown, meant to be read here directly by a human or an LLM, not
parsed by a resolver. A future retrieval/persistence component would
still need to define its own ingestion/loader contract for this file —
that ingestion contract is not implemented here. **No retrieval,
embedding, vector store, memory persistence, or learning is implemented
in this document** — it only states the relationship for future stages
to build against.

## Zero auto-mutation

No agent capability may automatically edit this document, or any artifact
it catalogs, to grant itself approval, merge, or closure authority. No
model-generated policy change becomes trusted merely by being generated
or merely by existing in the repository — presence in the repository is
not, by itself, proof of normative authority (see "Authority hierarchy").
Any future change to this document still goes through the same
independent-review process this document itself defines. Each
version of this document (`v1`, `v2`, `v3`) was introduced through exactly
that same independent-review process — no self-modification occurred.

## Explicit out-of-scope

- **Future enterprise multi-role governance architecture** — an RBAC
  system, an approval service, a policy engine, an organization
  hierarchy, or a workflow-orchestration engine. `ROADMAP.md` already
  distinguishes near-term governance conformance cleanup (`B-1`, `B-2`,
  `B-6`) from any such future track, and this document does not build one.
- **`GOV-VERIFY-1`** (Reusable Merge-Gate Verification Automation) —
  tracked separately in `ROADMAP.md` §6 as `HEAVY`, non-blocking, future
  work. This document states its planned boundary only (an evidence
  producer, never a merge authority) and implements none of it.
- **`B-1`'s branch classification and `A-2`'s execution policy** — both
  referenced by catalog entry above, neither reopened nor duplicated.
- **`A-3`'s own architecture-boundary contract substance** — referenced
  by catalog entry above (`ARCHITECTURE_MODEL_BOUNDARY`), never
  duplicated here. Model-relationship rules live in
  `docs/architecture-model-boundary-v1.md`, not in this document.
- **`A-1`'s own package-surface contract substance** — referenced by
  catalog entry above (`PACKAGE_GOVERNANCE`), never duplicated here. The
  public-vs-physical package rules live in `docs/package-surface-v1.md`,
  not in this document.
- **Security-reporting redesign** — `SECURITY.md`'s own reporting/trust
  boundaries are unchanged by this document.

## What this document does not do

- It does not close `B-1`, `A-2`, or `B-4` — all three are already
  `CLOSED_ON_MAIN`, referenced here only as catalog entries.
- It does not close Architecture Conformance Gate finding `A-1` on
  canonical `ROADMAP.md` — that remains a separate, later closure-sync
  mission, after independent review, merge, and post-merge certification
  of the implementation this catalog entry now indexes.
- It does not implement `GOV-VERIFY-1`.
- It does not implement `RAG`, `MEM`, or any retrieval/embedding/
  persistence mechanism.
- It does not create a machine-readable manifest, validator, or resolver.
  No evidence exists that any script needs deterministic programmatic
  resolution of "current" governance knowledge today; if that need
  arises later, a schema-versioned, fail-closed manifest would be a
  separate, `HEAVY`-classified change, not silently added here.
- It does not change `CONFORMANCE-INTEGRATION-CHECK` or the Architecture
  Conformance Gate — both remain exactly as `ROADMAP.md` already states.
- It does not grant any AI agent, script, or process automated merge or
  approval authority. Independent review remains a human/process
  separation-of-roles rule, not an automated check.
