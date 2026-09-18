# Governance Process v1

CRW2-B6, addressing conformance finding B-6.

## Why this exists

A conformance analysis flagged `B-6`: this repository's governance/process
knowledge is not durably versioned. Before this document, that was
concretely true in one specific, load-bearing way — not merely "some docs
could be better organized":

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
  `self-approv`, `self-merge`, `same session`, `same agent` returns zero
  matches. This rule has been followed in practice but has never had a
  durable home.

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
| `REVIEW_MERGE_GOVERNANCE` | Independent-review requirement, self-approval/self-merge/self-closure prohibition, merge method, post-merge certification, zero-open-new-defect policy | v1 | **this document**, §"Review, merge, and lifecycle process" | none (human/process rule, not automated) | CURRENT | — | Reviewed PR to this document |
| `LIFECYCLE_STATUS_AUTHORITY` | Current sequence, active gate, per-finding lifecycle state | continuously updated in place (not per-edit versioned) | [`ROADMAP.md`](../ROADMAP.md) §2/§6/§8 | none — ROADMAP.md itself is the authority | CURRENT | — | Reviewed PR per this project's own standing merge-gate process |
| `PACKAGE_GOVERNANCE` | What ships in the published npm package | implicit (tracked by `package.json` `files`) | `package.json` `files` field | `npm pack` | CURRENT | — | Reviewed PR changing `files` |

This catalog references existing content; it does not duplicate any of
the above documents' own substance. `BRANCH_GOVERNANCE`, `EVALUATION_EXECUTION`,
and `QA_GENERATION_CONTRACTS` are unchanged by `B-6` — this document adds
the missing index and the missing `REVIEW_MERGE_GOVERNANCE` entry, which
previously existed only as unrecorded practice.

## Authority hierarchy

When two sources appear to describe the same subject, this is the
precedence order, derived from how this project already behaves (not
invented ordering):

1. **Executable authority** — runtime code (`scripts/**`, `package.json`).
   What actually runs is what actually happens, regardless of what any
   document claims.
2. **Versioned normative contract** — a `docs/*-vN.md` file such as the
   three catalogued above (including this one). Durable, explicit,
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

This is the durable normative rule this project has followed but never
recorded. It states the rule; it does not restate every operational
checklist already living in `ROADMAP.md` §6 (linked, not duplicated).

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
  *same* subject (updating the `Supersedes` column above and this
  document's own version).
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
- Superseded artifacts, if any are created in the future, remain in the
  repository with an explicit "superseded by vN+1" statement in their own
  text — never silently deleted, and never left ambiguous about their own
  status.

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
self-modification:

- **Editorial clarification** (wording, formatting, broken link fix): no
  version bump.
- **Normative change** (a new knowledge domain added, an authority
  ranking changed, a rule in "Review, merge, and lifecycle process"
  amended): new version (`v2`), with the prior version explicitly marked
  superseded, not deleted.
- **Retirement/deprecation**: an entry may be marked retired if its
  subject no longer applies; it is never removed silently.
- **Emergency correction**: a factual error (e.g. a wrong file path) may
  be fixed without a version bump, but must still go through ordinary
  review.

A simple explicit integer version (`v1`, `v2`, ...) is used, matching this
repository's existing `docs/*-v1.md` convention — no SemVer machinery is
introduced.

## Relationship to future RAG / Memory

`B-6` is not `RAG` and not `MEM`. This catalog and its authority hierarchy
are the intended trusted-knowledge entry point for a future retrieval
(`RAG`) or persistent-memory (`MEM`) component that needs to identify
which governance/process knowledge is current, without heuristically
scraping documents. **No retrieval, embedding, vector store, memory
persistence, or learning is implemented here** — this document only
states the relationship for future stages to build against.

## Zero auto-mutation

No agent capability may automatically edit this document, or any artifact
it catalogs, to grant itself approval, merge, or closure authority. No
model-generated policy change becomes trusted merely by being generated
or merely by existing in the repository — presence in the repository is
not, by itself, proof of normative authority (see "Authority hierarchy").
Any future change to this document still goes through the same
independent-review process this document itself defines.

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
- **Security-reporting redesign** — `SECURITY.md`'s own reporting/trust
  boundaries are unchanged by this document.

## What this document does not do

- It does not close `B-1`, `A-2`, or `B-4` — all three are already
  `CLOSED_ON_MAIN`, referenced here only as catalog entries.
- It does not implement `GOV-VERIFY-1`.
- It does not implement `RAG`, `MEM`, or any retrieval/embedding/
  persistence mechanism.
- It does not create a machine-readable manifest, validator, or resolver.
  Discovery for this finding found no evidence any script needs
  deterministic programmatic resolution of "current" governance knowledge
  today; if that need arises later, a schema-versioned, fail-closed
  manifest would be a separate, `HEAVY`-classified change, not silently
  added here.
- It does not change `CONFORMANCE-INTEGRATION-CHECK` or the Architecture
  Conformance Gate — both remain exactly as `ROADMAP.md` already states.
- It does not grant any AI agent, script, or process automated merge or
  approval authority. Independent review remains a human/process
  separation-of-roles rule, not an automated check.
