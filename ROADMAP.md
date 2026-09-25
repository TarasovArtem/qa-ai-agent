# QA AI Agent — Canonical Roadmap

This is the canonical, versioned source of truth for this project's current
status, active execution gate, and forward sequence. **[README.md](README.md)**
carries a concise current-status summary and full engineering history for each
completed track; this document carries the current execution sequence, the
conformance remediation program, and the durable record of the phase-order
decision described below. When the two disagree, this file is authoritative
for *sequence and current gate*; README.md remains authoritative for
*detailed technical evidence* of what each completed track actually proved.

## 1. Authority and scope

- **ROADMAP.md** (this file) — canonical current execution sequence, active
  gate, conformance remediation program, and the owner phase-order decision
  record.
- **[README.md](README.md)** — project purpose, capabilities, maturity
  evidence, and the detailed roadmap-by-roadmap engineering history behind
  every completed track.
- **[SECURITY.md](SECURITY.md)** — data-governance and authority/trust model
  for the #1-23 reactive-triage/generative pipelines.
- **[PROVIDERS.md](PROVIDERS.md)** — RTI-7 Requirements Source Provider
  authoring contract and carried debt.
- **[PUBLISHING.md](PUBLISHING.md)** — RTI-8 Test Design Destination
  authoring contract and carried debt.

## 2. Status vocabulary

| Term | Meaning |
|---|---|
| `COMPLETE_ON_MAIN` | Implemented, independently reviewed, merged to `main`, post-merge certified. |
| `PROVEN` | An architectural/technical claim independently, adversarially verified with evidence (not merely implemented). |
| `PASS WITH DEFERRED DEBT` | An audit gate passed with zero BLOCKER/HIGH/unresolved-MEDIUM findings, while explicitly carrying visible, classified LOW/INFO debt forward rather than silently closing it. |
| `NOT_STARTED` | No implementation work has begun. |
| `DEFERRED` | Explicitly scoped out for now, not cancelled; carried forward to a named future gate. |
| `READY` | Technically unblocked, but intentionally not yet begun by governance sequencing. |

## 3. Certified current baseline

```text
main: ca9bfa051206ea4e2f96741f276c660dcc6444ac
```

This is the exact commit the RTI Integrated Audit's targeted re-verification
(`RTIA-B01`/`RTIA-I01` closure) certified. See [§15](#15-final-target-state)
and README's own RTI section for the full evidence chain.

## 4. Completed major tracks

| Track | Status | Evidence |
|---|---|---|
| Core #1-#23 (reactive triage + generative test design/automation pipelines) | `COMPLETE_ON_MAIN` | See README's roadmap-by-roadmap history. |
| Core Stabilization / Targomo Independence / Full Project Independence | `COMPLETE_ON_MAIN`, `PROVEN` | See README's "Full Project Independence — Terminal Audit and Final Re-Audit". |
| `ID-1` — Package Boundary / Public Programmatic API | `COMPLETE_ON_MAIN` | PR #129. |
| `ID-2` — External-Repository Installation Proof | `COMPLETE_ON_MAIN`, `PROVEN` | PR #130. |
| `ACQ-UPG` — Reproducible versioned acquisition + upgrade transition | `PROVEN` | `proof/acq-v1`/`proof/acq-v2`, independently re-reviewed under full auth isolation. |
| `RTI-1` .. `RTI-8` — Requirements & Test-Design Integration | `COMPLETE_ON_MAIN` | See [§5](#5-rti-closure). |
| `RTI Integrated Audit` | `PASS WITH DEFERRED DEBT` | See [§5](#5-rti-closure). |

`ID-3` (formal release/productization planning) remains **planning-complete,
implementation not started** — see [§12](#12-productization). This is
unchanged by RTI closure or conformance remediation; architectural
independence and formal release maturity are deliberately different axes and
are never conflated in this project's own documentation.

## 5. RTI closure

```text
RTI-1: COMPLETE_ON_MAIN
RTI-2: COMPLETE_ON_MAIN
RTI-3: COMPLETE_ON_MAIN
RTI-4: COMPLETE_ON_MAIN
RTI-5: COMPLETE_ON_MAIN
RTI-6: COMPLETE_ON_MAIN
RTI-7: COMPLETE_ON_MAIN
RTI-8: COMPLETE_ON_MAIN

RTI Integrated Audit: PASS WITH DEFERRED DEBT
  RTIA-B01 (BLOCKER — publishTestDesigns() double-read of request.testDesigns
            allowed a validated collection to diverge from the published one):
            CLOSED (fix + regression tests + independent review + merge +
            targeted re-verification, all on `main`)
  RTIA-I01 (INFO — a carried-debt row inaccurately described an already-hardened
            code path as still open): CLOSED (documentation corrected)

RTI Release Readiness: NOT READY (architectural/audit correctness is proven;
  formal package release maturity - npm publication, version policy, CLI
  surface - is separate, unstarted `ID-3` work; see §12)
```

Full technical evidence for RTI-1 through RTI-8 (contracts, cross-vendor
proof, package surface) lives in README's own "Roadmap RTI" section and in
[PROVIDERS.md](PROVIDERS.md)/[PUBLISHING.md](PUBLISHING.md). This file does
not duplicate that evidence — only the closure state and what it unblocks.

## 6. Conformance remediation program

A conformance analysis (dated 2026-09-16) reviewed this repository's actual
state against its previously pinned roadmap and found the pinned roadmap had
drifted materially behind real progress, was missing several tracks, and
contained an unresolved phase-ordering inconsistency requiring an explicit
owner decision (see [§7](#7-owner-phase-order-decision)). That analysis
proposed a three-wave remediation grouping:

```text
Original analysis — Wave 1:  C-1, C-2, C-4, A-4, B-3, B-5, B-2
Original analysis — Wave 2:  C-3, A-2, A-1, B-4, B-6, B-1
Original analysis — Wave 3:  A-3, D-1, D-2, D-3
```

This original grouping is preserved here as historical record. **The project
subsequently adopted a revised remediation sequence** (below) — this
adaptation is a project decision made *after* the analysis, not something
the analysis itself prescribed. In particular, `C-3` (originally grouped in
Wave 2) is addressed early, as part of `CRW1-A`, specifically *because*
closing `C-3` requires exactly the owner decision this file now records —
see [§7](#7-owner-phase-order-decision) for why, and for the explicit
distinction between what the analysis found and what the project decided.

### Adopted program

```text
Conformance Remediation Wave 1 (CRW1)
  CRW1-A — Roadmap & Documentation Truth Sync           [C-1, C-2, C-3, C-4, A-4]
  CRW1-B — Node 22 Enforcement                          [B-5]
  CRW1-C — PR / Issue / Governance Metadata             [B-2]
  CRW1-D — Supply-Chain Monitoring                      [B-3]

Conformance Remediation Wave 2 (CRW2)
  A-2 — Strict evaluation/regression blocking semantics
  B-1 — Versioned branch inventory
  B-4 — Fail-closed test-infrastructure verification/corrective
  B-6 — Versioned governance/process knowledge

Architecture Conformance Gate
  A-1 — Decide the exact public/installable product surface for #22/#23
  A-3 — Define the relationship between RequirementModel/TestCaseModel
        (the #22/#23 generative pipeline's own models) and
        RequirementArtifact/TestDesignArtifact (RTI's deterministic artifacts)
  D-2 — Resolve or explicitly document the test-design.js / test-design/
        namespace collision

Future domain-expansion prerequisites (not gates in the current critical path)
  D-1 — Evaluation architecture scalability (close before evaluation expansion
        requires it)
  D-3 — Controlled SUT (close before API/PERF phases that require controlled
        negative/load testing)
```

The adopted program above is executed against per-finding closure evidence —
**not necessarily one slice at a time**; see "Parallel execution model"
immediately below for the current authorized execution mode. Each slice's
own [closure evidence](#crw1-a-closure-evidence) block in
[§8](#8-current-critical-path) is this file's authoritative record of what
has actually closed. As of the current canonical state, `CRW1-A`, `CRW1-B`,
and `CRW1-C` are `COMPLETE_ON_MAIN`: `C-1`, `C-2`, `C-4`, and `A-4` are
`CLOSED_ON_MAIN`; `C-3` is `RECORDED_ON_MAIN` per its existing owner-decision
disposition (see [§7](#7-owner-phase-order-decision)); `B-5` (closed by
`CRW1-B`) and `B-2` (closed by `CRW1-C`) are `CLOSED_ON_MAIN`. `B-3`
(`CRW1-D`) is now also `CLOSED_ON_MAIN` — the first of the five
parallel-authorized findings to close (see [closure
evidence](#crw1-d-closure-evidence) in §8). `A-2` (`CRW2-A2`) is now also
`CLOSED_ON_MAIN` — the second of the five to close (see [closure
evidence](#crw2-a2-closure-evidence) in §8). `B-1` (`CRW2-B1`) is now also
`CLOSED_ON_MAIN` — the third of the five to close (see [closure
evidence](#crw2-b1-closure-evidence) in §8). `B-4` (`CRW2-B4`) is now also
`CLOSED_ON_MAIN` — the fourth of the five to close (see [closure
evidence](#crw2-b4-closure-evidence) in §8). `B-6` (`CRW2-B6`) is now also
`CLOSED_ON_MAIN` — the fifth and final of the five parallel-authorized
findings to close (see [closure evidence](#crw2-b6-closure-evidence) in
§8). All five original parallel-authorized findings are now
`CLOSED_ON_MAIN`, and `CONFORMANCE-INTEGRATION-CHECK` passed (see
[integration evidence](#conformance-integration-check-evidence) in
§8) — which made the Architecture Conformance Gate `READY` (eligibility,
not activation). Gate **execution** has since **started and completed**:
the Architecture Conformance Gate is now **`COMPLETE_ON_MAIN`** (see
"Gate-level status" in [§8](#8-current-critical-path)). Its first owned
finding, `A-3`, is `CLOSED_ON_MAIN` (`ACG-A3`, PR #171 — see [closure
evidence](#acg-a3-closure-evidence) in §8), and its second, `A-1`, is now
also `CLOSED_ON_MAIN` (`ACG-A1`, PR #173 — see [closure
evidence](#acg-a1-closure-evidence) in §8), and its third, `D-2`, is now
also `CLOSED_ON_MAIN` (`ACG-D2`, PR #175 — see [closure
evidence](#acg-d2-closure-evidence) in §8); with all three Gate-owned
findings closed, an independent Gate-level closure certification approved
Gate closure, and the Architecture Conformance Gate is now
`COMPLETE_ON_MAIN` (see [Gate closure
evidence](#architecture-conformance-gate-closure-evidence) in §8). `D-1`
and `D-3` remain explicitly **DEFERRED**. This
paragraph is updated as each finding's own closure evidence lands — it is
not itself a slice-status line subject to the ACTIVE-lifecycle exemption
defined in [§8](#8-current-critical-path).

### Parallel execution model

```text
Execution mode:             PARALLEL AUTHORIZED (owner decision — see §7's
                             "Parallelized Conformance Execution")
Architecture Gate barrier:  waited for all five findings CLOSED_ON_MAIN
                             AND a passing CONFORMANCE-INTEGRATION-CHECK —
                             both held, making the Gate READY; Gate
                             execution started (ACG-A3), so
                             Gate state then: ACTIVE / IN_EXECUTION —
                             the Gate has since completed; see
                             [Architecture Conformance Gate closure
                             evidence](#architecture-conformance-gate-closure-evidence)
                             for the current state
```

```text
                               +-- CRW1-D / B-3 --(CLOSED_ON_MAIN)--+
                               +-- CRW2-A2 / A-2 -(CLOSED_ON_MAIN)--+
ROADMAP-V3.3-SYNC certified ---+-- CRW2-B1 / B-1 -(CLOSED_ON_MAIN)--+--> CONFORMANCE-INTEGRATION-CHECK
                               +-- CRW2-B4 / B-4 -(CLOSED_ON_MAIN)--+                (PASS)
                               +-- CRW2-B6 / B-6 -(CLOSED_ON_MAIN)--+                v
                                                              Architecture Conformance Gate
                                                                (COMPLETE_ON_MAIN)
                                                              [A-3 CLOSED_ON_MAIN; A-1 CLOSED_ON_MAIN; D-2 CLOSED_ON_MAIN]
```

`CRW1-D` (`B-3`) is the first of the five originally-authorized parallel
tracks to close — see [closure evidence](#crw1-d-closure-evidence) in §8.
`CRW2-A2` (`A-2`) is the second to close — see [closure
evidence](#crw2-a2-closure-evidence) in §8. `CRW2-B1` (`B-1`) is the third
to close — see [closure evidence](#crw2-b1-closure-evidence) in §8.
`CRW2-B4` (`B-4`) is the fourth to close — see [closure
evidence](#crw2-b4-closure-evidence) in §8. `CRW2-B6` (`B-6`) is the fifth
and final to close — see [closure evidence](#crw2-b6-closure-evidence) in
§8. All
five remain shown in this diagram (marked `CLOSED_ON_MAIN`) to show the
full original parallel set rather than silently shrinking it. `CRW2` is a
**grouping label, not one implementation unit**. `CRW2-A2` (`A-2`),
`CRW2-B1` (`B-1`), `CRW2-B4` (`B-4`), and `CRW2-B6` (`B-6`) are four
independently implemented findings, each with its own branch, PR, primary
finding ownership, review, merge, and post-merge certification. No
artificial order ever existed among the five original tracks (`CRW1-D`,
`CRW2-A2`, `CRW2-B1`, `CRW2-B4`, `CRW2-B6`) — they were independently
authorized in parallel and merely happened to close in this observed
order; no dependency or semantic overlap was discovered between any two
of them across `CRW1-D`'s, `CRW2-A2`'s, `CRW2-B1`'s, `CRW2-B4`'s, or
`CRW2-B6`'s own implementation.

**Mandatory parallel-safety controls** (project policy as of this update):

1. Every parallel-track PR declares its primary finding, known dependencies,
   shared semantic surfaces, and potential overlaps (template below).
2. Every PR has exactly **one** primary finding owner. A PR may touch
   another finding's semantic surface but may not claim closure of a second
   finding unless governance explicitly re-scopes it — this prevents double
   closure, ambiguous ownership, and competing closure records.
3. Two PRs touching the same semantic contract (e.g. the `package.json`
   contract, evaluation exit semantics, branch-inventory format, workflow
   required contexts, the governance status model itself) are **not**
   independent — their relationship must be explicitly declared as
   `DEPENDENT`, `ORDERED`, or `COORDINATED`, not left implicit.
4. **Git mergeability is not proof of semantic independence.** A PR may
   merge cleanly while invalidating another track's assumptions. Before
   merging a parallel `HEAVY` PR whose exact-head review predates the
   current tip of `main`: identify what merged in between; if it touches
   the PR's declared semantic surfaces, a *targeted* semantic re-review is
   mandatory; if it does not, an identity refresh plus exact-head CI is
   sufficient. Do not automatically rerun a full review when no relevant
   overlap exists, and do not skip re-review when one does.
5. No automatic rebase purely for ceremony — rebase only when required for
   mergeability or actual semantic compatibility. Never merge a HEAD
   different from the one that was actually reviewed and authorized.

Required PR-body fields for every parallel-track PR:

```text
Primary finding:          <finding>
Known dependencies:       <none/list>
Shared semantic surfaces: <paths/contracts>
Potential overlap:        <other track / none>
```

**`CONFORMANCE-INTEGRATION-CHECK`** — a lightweight synchronization barrier
immediately before the Architecture Conformance Gate. It is **not** a new
implementation phase and **not** another full audit; it is a final
combined-state readiness check confirming the five independently correct
conformance changes are also correct *together* on current `main`.

Inputs required: `B-3`, `A-2`, `B-1`, `B-4`, `B-6` all `CLOSED_ON_MAIN`.
Checks: main CI green; all five findings still closed (none reopened by
another PR); no cross-PR semantic contradiction; no incompatible
policy/runtime assumption; package/public API changed only where explicitly
intended; roadmap statuses coherent; branch/workflow/evaluation/governance
contracts agree; no unresolved integration defect. Output: `PASS` or `FAIL`.
Only `PASS` sets `Architecture Conformance Gate: READY` — Gate readiness is
**never** reduced to "all five PRs merged"; both the five closures and a
passing integration check are required. No additional implementation PR is
needed solely for this check unless it finds a defect.

**Current result: `PASS`.** The check ran read-only against evaluated
`main` `c5f7c21cb5ce25cae3649c93796a7ad6c6c3e37a` and found zero actual
defects — see [integration evidence](#conformance-integration-check-evidence)
below for the durable summary. The Architecture Conformance Gate became
`READY` as a result (eligibility, not activation); Gate **execution** has
since started and the Gate is now `ACTIVE` (see §8).

**Concurrency guidance:** recommended maximum active `HEAVY` implementation
PRs at once is 3–5 (the five current conformance tracks are an acceptable
practical upper bound); `LIGHT` research/documentation work may exist
additionally — avoid opening an uncontrolled number of `HEAVY` tracks. For
CI: `HEAVY` tracks run full required CI; `LIGHT` tracks require the same
branch-protection-required CI but should not be rerun purely for ceremony
when an existing exact-SHA run already proves the required state — in
particular, do not multiply live-site browser suites with redundant manual
reruns.

**Current parallel track status** (`READY` means authorized/unblocked —
**not** `ACTIVE`; a track becomes `ACTIVE` only once its own implementation
actually begins, per the existing lifecycle definition in
[§8](#8-current-critical-path)):

| Track | Finding | State | Review class | Primary dependency |
|---|---|---|---|---|
| `CRW1-D` | `B-3` | `COMPLETE_ON_MAIN` | `HEAVY` | none — closed, PR #157 |
| `CRW2-A2` | `A-2` | `COMPLETE_ON_MAIN` | `HEAVY` | none — closed, PR #162 |
| `CRW2-B1` | `B-1` | `COMPLETE_ON_MAIN` | `HEAVY` | none — closed, PR #164 |
| `CRW2-B4` | `B-4` | `COMPLETE_ON_MAIN` | `HEAVY` | none — closed, PR #166 |
| `CRW2-B6` | `B-6` | `COMPLETE_ON_MAIN` | `LIGHT` | none — closed, PR #168 |

This table tracks durable transitions only (`READY` → `COMPLETE_ON_MAIN`, or
Gate readiness) — it does not require a `ROADMAP.md` commit for every
implementation-started/review-requested/CI-rerun/PR-merged event;
intermediate lifecycle detail belongs in each PR's own metadata, not here.

### Review classification (LIGHT / HEAVY)

Every PR is classified when opened, as exactly one of two classes — there is
no third class, and uncertainty resolves to `HEAVY`:

- **`LIGHT`** — the diff is provably non-executable: no runtime behavior
  change, no security-enforcement change, no package/public-API change, no
  executable CI/workflow change, and no mixed executable change. Typical
  `LIGHT` surfaces: `*.md`, `ROADMAP.md`, `README.md`, `CLAUDE.md`,
  `CONTRIBUTING.md`, PR/issue templates, non-executable governance metadata.
  `LIGHT` does **not** mean "content doesn't matter" — it means the
  technical/executable surface is provably untouched; focused semantic
  review of the authority model, security policy, project identity,
  lifecycle rules, merge/review policy, product-surface descriptions, and
  canonical roadmap decisions remains mandatory even on a `LIGHT` PR,
  because a docs-only PR can still carry a serious governance defect — as
  `ROADMAPV33-R01` itself demonstrated.
- **`HEAVY`** — anything touching or materially affecting `scripts/**`,
  `.github/workflows/**`, `package.json`/`package-lock.json`,
  runtime/production logic, security contracts/enforcement,
  provider/destination logic, evaluation behavior, test execution, CI
  semantics, or public API/package behavior. A mixed docs+executable diff
  is always `HEAVY`.

**Escalation is one-directional**: `LIGHT` may escalate to `HEAVY` during
implementation or review; `HEAVY` may never be downgraded to `LIGHT` during
review.

`LIGHT` review requires one independent pass covering: exact base/HEAD/TREE;
diff scope; proof no technical/executable surface changed; CI green on exact
HEAD; focused semantic truth/coherence review; no obvious status
contradiction; no actual defect left open. It does **not** require a
40–100-question terminal checklist, a full package/runtime re-audit when the
diff already proves those surfaces untouched, or repeated re-verification of
unrelated technical areas. `LIGHT` reduces ceremony — it never authorizes a
known defect; any real `BLOCKER`/`HIGH`/`MEDIUM`/`LOW`/`INFO` finding must
still be fixed before approval.

`HEAVY` review is unchanged from this project's existing full governance
model: exact identity, full adversarial review, risk-specific terminal
questions, zero-open-new-defect, explicit merge authorization, post-merge
certification.

Every PR body must declare its class:

```text
Review class: LIGHT / HEAVY
Reason:       <short evidence-based reason>
```

### Pre-PR full-file self-sweep (mandatory)

Before opening any PR touching `ROADMAP.md` or `README.md`, the implementer
must sweep the **entire** file (not only the changed hunks) for status- and
scope-bearing language — at minimum: `remains open`/`remain open`, `OPEN`,
`CLOSED_ON_MAIN`, `COMPLETE_ON_MAIN`, `RECORDED_ON_MAIN`, `READY`, `ACTIVE`,
`NOT_STARTED`, `DEFERRED`, `current`/`currently`, `only`, `every other`,
`pending`, `next`, plus every relevant finding/track name — and inspect
every meaningful hit for contradiction with current canonical truth. This
rule exists because `ROADMAPV33-R01` (a pre-existing, newly-discovered
defect) would have been caught before review, not during it, had this sweep
already been standard practice. A clean sweep is a cheap defect **filter**,
not proof of semantic correctness — it does not replace focused semantic
review.

### GOV-VERIFY-1 (tracked, non-blocking)

`GOV-VERIFY-1` — Reusable Merge-Gate Verification Automation — is recorded
here as a tracked future task, classification `HEAVY`, **non-blocking**: it
does not block `CRW1-D`, `CRW2`, or the Architecture Conformance Gate unless
separately decided later. Purpose: produce reusable evidence for exact
base/HEAD/TREE SHAs, diff scope against forbidden paths, `npm pack`
baseline/diff, a branch-protection snapshot, and exact-SHA CI lookup (with
explicit `pull_request` vs. `push` event-type validation) — likely as
`scripts/governance/verify-merge-gate.sh` and/or a workflow wrapper.

`GOV-VERIFY-1` must be an **evidence producer, never a merge authority**: it
must never emit a single `SAFE_TO_MERGE=true`-style verdict; its output
should be discrete evidence fields (e.g. `BASE_MATCH`, `HEAD_MATCH`,
`TREE_MATCH`, `FORBIDDEN_PATHS`, `PACK_DIFF`, `CI_EXACT_SHA`, `CI_EVENT`,
`BRANCH_PROTECTION_STATUS`), with human/governance review remaining the
actual decision authority. It must be **fail-closed**: incomplete evidence
(branch-protection API unreachable, an ambiguous or multiple-event CI run, a
HEAD/TREE mismatch, an incomplete pack comparison, a stale cached result)
must report `UNKNOWN`/`FAIL`, never a silent `PASS`. When actually
implemented, its `HEAVY` review must include negative-fixture tests for at
least: green CI on the wrong SHA; a `pull_request` run mistaken for
post-merge `push` proof and vice versa; a forbidden technical path hidden
among docs; `npm pack` file-count/surface drift; an unavailable or partial
branch-protection/GitHub-API read; a HEAD/TREE mismatch; and a stale cached
CI result.

**Sequencing note:** the canonical reconciliation of `GOV-VERIFY-1` with
`GOV-AUTO-1` is now recorded by [`docs/gov-auto-1-design-reconciliation-v1.md`](docs/gov-auto-1-design-reconciliation-v1.md)
(design/reconciliation merged and post-merge certified; see [GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence)),
which selects Model A -- Composition (see [`GOV-AUTO-1`](#gov-auto-1--governance-pre-review-framework-next-active-gate) below).
Implementation of any `GOV-VERIFY-1` capability that overlaps `GOV-AUTO-1`
was governance-paused until the ROADMAP synchronization that records that
decision had itself been reviewed under the required review lifecycle gate (review independence LIMITED -- same-session role separation), merged and post-merge certified; that condition is now satisfied (PR #186; see [GOV-AUTO-1 ROADMAP synchronization closure evidence](#gov-auto-1-roadmap-synchronization-closure-evidence)),
so the design-reconciliation governance pause is satisfied. That is **not**
permission to duplicate anything: shared
Git-identity, diff-scope and CI-evidence facts must come from the `GOV-AUTO-1`
`1A`/`1F` interfaces, and until those interfaces exist the overlapping portion
of `GOV-VERIFY-1` waits on that technical dependency rather than reimplementing
them. `GOV-VERIFY-1` remains tracked, is not cancelled and is not absorbed; this
entry's constraints and tracked status are otherwise unchanged.

### GOV-AUTO-1 — Governance Pre-Review Framework (next active gate)

```text
GOV-AUTO-1:      NOT_STARTED  (implementation; roadmap-designated next active gate)
Design:          design/reconciliation MERGED + POST-MERGE CERTIFIED
                 (docs/gov-auto-1-design-reconciliation-v1.md; PR #185; see §8 evidence)
Roadmap sync:    CERTIFIED_ON_MAIN (PR #186; see §8 closure evidence)
Wave 0:          NOT_STARTED  (next governed implementation step)
Classification:  HEAVY
Position:        after AISEC-3 (COMPLETE_ON_MAIN), before AISEC-4 (see §7, §8)
Principle:       Machine checks facts. Humans review meaning.
```

`GOV-AUTO-1` is a deterministic governance pre-review framework: it validates
machine-checkable repository, artifact, provenance, scope, structural and
CI-evidence invariants **before** independent human review, so that avoidable
corrective and re-review cycles are reduced **without weakening** any human
semantic, architectural, security, authorization, merge or lifecycle gate. This entry defines the stage. Its design/reconciliation is now a merged,
post-merge-certified contract ([`docs/gov-auto-1-design-reconciliation-v1.md`](docs/gov-auto-1-design-reconciliation-v1.md); see
[GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence)); the executable framework remains unimplemented
(implementation `NOT_STARTED`), and implementation proceeds under that design,
beginning with Wave 0, which is now the next governed implementation step: the
ROADMAP synchronization recording the design has been reviewed under the required review lifecycle gate (review independence LIMITED -- same-session role separation), merged and post-merge certified (PR #186; see [GOV-AUTO-1 ROADMAP synchronization closure evidence](#gov-auto-1-roadmap-synchronization-closure-evidence)) and the
live ROADMAP has been re-read. Wave 0 remains `NOT_STARTED`.

**Why now (facts only).** `AISEC-3` required ten correctives (C1..C10), each
followed by an independent re-review (see [AISEC-3 closure
evidence](#aisec-3-closure-evidence)). Several late findings were of a
deterministic or partly deterministic kind: a malformed Markdown table row,
evidence-row cardinality and one-class-per-row violations, inference-dependent
statements worded as documented fact, research-method wording that contradicted
itself across sections, stale terminology, and register/count consistency. This
does not mean automation would have prevented every corrective, and it does not
mean semantic or security review can be automated. The aim is to reduce
deterministic review noise, preserve or improve review quality, and keep human
attention for semantic and security judgment.

**Authority boundary (explicit).** Automation may verify deterministic facts:
Git identity, changed files, schema validity, reference and table integrity,
evidence counts, known provenance constraints, secret patterns, CI run identity
and protected-section fingerprints. Automation must **not** decide whether a
threat model is semantically correct, a risk is acceptable, an architecture is
safe, a mitigation is sufficient, an inference is substantively justified, a
finding may be waived, a PR receives merge authorization, or a stage becomes
`COMPLETE_ON_MAIN`. An ambiguous case is `HUMAN_REVIEW_REQUIRED`, never an
automated pass.

**Existing governance stays authoritative.** `GOV-AUTO-1` supports and never
replaces exact-head review, independent review, Senior Software Developer
review, Security review where required, ZERO-OPEN-NEW-DEFECT, exact-head merge
authorization, STANDARD_TWO_PARENT merge, post-merge certification and
canonical closure. Readiness is framework attestation only: `readiness.state` (`READY`,
`HUMAN_REVIEW_REQUIRED`, `NOT_READY`) describes only what the framework itself can
attest. `READY` (the former `READY_FOR_INDEPENDENT_REVIEW: YES`) means only that
the framework can attest that its deterministic pre-review requirements are
satisfied; it is never merge authorization, approval, risk acceptance, security
acceptance or `COMPLETE_ON_MAIN`. `NOT_READY` means only that the framework
cannot attest readiness because evidence is failing, invalid, incomplete,
unsupported, stale or unavailable; it does **not** universally bar independent
human review. Human review eligibility and merge authority are governed
separately by the lifecycle and governance rules; for example the bootstrap states
`FIRST_INTRODUCTION` and `CAPABILITY_LAG` may be `NOT_READY` yet proceed through
explicitly authorized `HEAVY` human review and human merge authorization. See
[`docs/gov-auto-1-design-reconciliation-v1.md`](docs/gov-auto-1-design-reconciliation-v1.md) for the full contract. The framework cannot approve itself:
governance tooling may provide evidence about its own deterministic checks, but
its implementation and every later change still require independent human
review and normal merge authorization.

**Required capability areas.**

1. *Git identity / preflight:* branch, HEAD, TREE, parent, base/main, clean
   worktree and expected ancestry; HEAD/TREE are derived from Git at execution
   time rather than hand-configured for a new review head.
2. *Diff scope:* explicit allowed-file and allowed-domain scopes; anything
   outside the authorized scope is a deterministic failure where appropriate.
3. *Markdown structure:* tables, code fences, headings, anchors and internal
   links, with parser-aware handling (inline code spans, escaped pipes, fences)
   -- not a naive `split('|')`.
4. *Reference integrity:* configurable identifier families (for example
   `TB-xx`, `GH-xx`, `RO-xx`, `VR-xx`, `OQx-x`, `AT-xx`, `PI-xx`): dangling
   references, duplicate definitions and malformed IDs.
5. *Evidence model:* source evidence class kept separate from conclusion
   evidence strength (for example source classes `DIRECT_DOC`, `DOC_REUSABLE`,
   `REPO_OBSERVED` versus conclusion strengths `DIRECTLY_SUPPORTED`,
   `DERIVED_INFERENCE`, `UNKNOWN`); one class per evidence row. **Provenance
   propagation invariant:** a conclusion is never represented with a stronger
   evidence status than its weakest required premise unless independent stronger
   evidence exists; promotion wording (documented, confirmed, settled, proven,
   established, resolved) attached to derived or unknown premises is flagged
   for human review.
6. *Risk / source consistency:* risk-register totals, source-taxonomy totals,
   scenario counts and evidence counts validated or derived from canonical
   structured data where feasible, avoiding duplicated derivable values.
7. *Research-method consistency:* machine-readable distinctions between
   static/source-grounded analysis, official-documentation review, read-only and
   point-in-time observations, research experiments, write-side experiments,
   destructive testing and delivery/process actions. Obvious contradictions are
   caught; nuanced cases are `HUMAN_REVIEW_REQUIRED`.
8. *Delta review and protected fingerprints:* `DEEP_REVIEW_REQUIRED` versus
   `PRESERVATION_CHECK_ONLY` per domain. Delta analysis may reduce repeated
   reviewer work but never automatically lowers the governing review class
   (§6's escalation rule stays one-directional). A matching fingerprint means
   only that a logical section is unchanged -- never that it is correct,
   security-approved or risk-accepted -- and it does not prove that the
   section's *inputs* are unchanged. **Dependency-aware preservation:** the
   framework models a dependency graph between review domains (for example a
   risk summary depends on the threat rows it counts; a generated count,
   reference map, generated table or summary section depends on its upstream
   records). `PRESERVATION_CHECK_ONLY` is valid for a domain only when (1) its
   own protected content is unchanged **and** (2) no declared upstream
   dependency changed in a way that may alter its meaning, derived values,
   references, authority or validity. A dependency change invalidates
   preservation-only status and makes the dependent domain
   `DEEP_REVIEW_REQUIRED` or `HUMAN_REVIEW_REQUIRED` as appropriate, and the
   invalidation propagates transitively (if A changes, B depends on A and C
   depends on B, then both B and C are invalidated). A fingerprint alone can
   never authorize preservation-only status. Missing, ambiguous or unresolved
   dependency relationships are never assumed independent: they are
   `HUMAN_REVIEW_REQUIRED` (or fail-closed).
9. *Secret scanning:* known credential prefixes, private-key material,
   token-like strings and provider credentials; output is masked and never
   prints a complete value. **False-positive suppression:** a secret-scan hit
   fails or requires human review unless an explicit, approved suppression
   covers it. A suppression must be explicit, narrowly scoped (a specific file,
   pattern or known test fixture -- never global, and never "ignore all
   high-entropy strings"), reviewed, traceable, reasoned and free of secret
   material (it records a rule identifier, a masked fingerprint, a fixture
   classification, a reason and a review reference, never the value). A
   suppression is itself subject to review, never weakens fail-closed
   behavior, and an unknown secret-like value never passes silently.
10. *CI evidence:* run ID, event, SHA, attempt, required jobs and conclusions,
    classified as `CLEAN_FIRST_PASS`, `PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN`,
    `FAIL`, `INCOMPLETE` or `HUMAN_REVIEW_REQUIRED`. "Justified" in
    `PASS_AFTER_JUSTIFIED_SAME_HEAD_RERUN` is a human governance/reliability
    determination: automation may collect the failure signature, same-SHA proof,
    changed files, rerun history and job results, but must not independently
    classify an unexplained failure as a benign flake or a justified rerun. An
    unknown or unexplained failure is `HUMAN_REVIEW_REQUIRED`, never an
    automatic pass. This entry introduces no numeric automatic-retry policy;
    rerun-until-green remains prohibited and is never scored as a pass.

**Manifest, output and fail-closed behavior.** A machine-readable governance
manifest carries stage/gate ID, review class, expected parent/base, allowed
tracked files, protected domains, expected invariants, review-domain mappings
and explicit exceptions. The framework emits machine-readable and
human-readable reports (conceptually `pre-review.json` / `pre-review.md`) with
exact Git identity, changed files, check results, invariant counts, review
domains, human-review-required flags and the derived `readiness.state` (`READY`, `HUMAN_REVIEW_REQUIRED` or `NOT_READY`; it supersedes the earlier boolean `READY_FOR_INDEPENDENT_REVIEW` wording). The readiness state is a derived readiness summary only: it must be reproducible from explicit underlying evidence fields and must never
replace, hide, flatten or overwrite them; the discrete evidence fields remain
the canonical record and the aggregate is a computed view. It is not merge authorization, approval, security acceptance or lifecycle completion; it never turns an unresolved human judgment into a green state, and `NOT_READY` is not a review-access control. The
framework is fail-closed: an invalid manifest, malformed schema, unexpected file
or unresolved mandatory reference fails; ambiguous CI evidence or an
unrecognized critical state fails or becomes `HUMAN_REVIEW_REQUIRED`; nothing
passes silently.

**Repository safety.** A future implementation must respect `repositoryRoot`
and must not allow arbitrary path escape, unsafe shell command construction,
unvalidated process arguments, secret disclosure or uncontrolled external
mutation.

**Sub-stages (compact; not separate roadmap gates).** `1A` deterministic
repository preflight; `1B` Markdown and reference integrity; `1C` evidence and
provenance validation; `1D` risk / source consistency; `1E` delta review and
protected fingerprints; `1F` CI evidence and machine-readable reporting; `1G`
independent framework validation.

**Relationship to `GOV-VERIFY-1` (decided).** `GOV-VERIFY-1` (above) tracks a
narrower evidence producer for exact base/HEAD/TREE, diff scope and exact-SHA CI
lookup; `GOV-AUTO-1` sub-stages `1A` and `1F` overlap that scope. The
design/reconciliation ([`docs/gov-auto-1-design-reconciliation-v1.md`](docs/gov-auto-1-design-reconciliation-v1.md), merged and
post-merge certified; see [GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence)) selects
**Model A -- Composition**: `GOV-AUTO-1` owns the shared fact layer and
`GOV-VERIFY-1` later composes it. **Ownership:** `1A` is the canonical owner of
shared Git identity, diff-scope and trusted base/policy context facts, as the
design defines them; `1F` is the canonical owner of shared CI-run evidence;
`GOV-VERIFY-1` owns only its non-overlapping merge-gate residue --
`PACK_DIFF`, `BRANCH_PROTECTION_STATUS`, merge-method / merge-parent / merge-tree
conformance, post-merge push proof and the other merge-specific facts the design
assigns to it -- and consumes the `1A`/`1F` public interfaces rather than
recomputing their facts. **Invariant:** one canonical implementation owner per
overlapping capability; no work may create a second independent source of truth
for those facts. `GOV-VERIFY-1` remains tracked, and every one of its
constraints (evidence producer, never a merge authority; fail-closed; discrete
evidence fields; no `SAFE_TO_MERGE` verdict; the listed negative fixtures)
remains authoritative; it is not cancelled, obsolete or absorbed. **Pause and
release:** the governance pause on overlapping `GOV-VERIFY-1` implementation was
conditioned on the ROADMAP synchronization recording this decision being itself reviewed under the required review lifecycle gate (review independence LIMITED -- same-session role separation), merged and post-merge certified; that condition is now
satisfied (PR #186; see [GOV-AUTO-1 ROADMAP synchronization closure evidence](#gov-auto-1-roadmap-synchronization-closure-evidence)), so the design-reconciliation
governance pause is satisfied, but that is not permission to duplicate anything: shared facts must come from `1A`/`1F`, where those interfaces do not
yet exist the overlap is a technical dependency on them, and non-overlapping
merge-specific residue stays `GOV-VERIFY-1`-owned. **Verdict-model
compatibility:** `GOV-VERIFY-1`'s discrete evidence fields (for example
`BASE_MATCH`, `HEAD_MATCH`, `TREE_MATCH`, `CI_EXACT_SHA`) stay the canonical
evidence record; the derived readiness state is not a merge-style verdict and
not a replacement for them.

**Type & Schema Boundary Audit stays distinct.** A separately required future
governance gate -- a whole-project, non-sampling Type & Schema Boundary Audit --
is **not** part of `GOV-AUTO-1` and is **not** satisfied, certified or
canonicalized by it. `GOV-AUTO-1` tooling may later help that audit, but tooling
is not certification.

**Implementation surface and CI.** A future implementation may add
`scripts/governance/**`, `governance/**` manifests, tests and adversarial
fixtures, package scripts and a dedicated "Governance Pre-Review" workflow or
job. Doing so is an executable change (`HEAVY`). A dedicated workflow does not
automatically become a branch-protection-required check; changing branch
protection requires separate authorization.

**Completion lifecycle.** governance design -> implementation ->
deterministic test suite -> adversarial fixtures -> independent Senior Software
Developer review **and** independent Security review (neither substitutes for
the other; the framework processes paths, Git and CI metadata, configuration,
evidence files, process arguments and possibly secret-like data) -> correctives
if needed -> exact-head merge authorization -> STANDARD_TWO_PARENT merge ->
post-merge certification -> canonical closure. No implementation may
self-certify.

**What this entry does not do.** It implements nothing, starts no `AISEC-4`
work, does not reopen `AISEC-3`, and changes no existing review, merge or
closure rule. The `MEM`, `RAG` and `LEARN` sequence is not otherwise reordered;
because `GOV-AUTO-1` precedes `AISEC-4` in the mainline critical path, it is a
mainline prerequisite for the later governed implementation stages (security,
memory, retrieval, learning and autonomy) that follow it there, without
invalidating the already-defined early-start research lanes (§7; for example
`AISEC-6`, `MEM-1`, `MEM-2`), which remain governed as recorded.

## 7. Owner phase-order decision

```text
Trigger:            Conformance finding C-3
Old roadmap order:   API / Performance / Database / Governance work assumed
                      mandatory ahead of Distribution/Installation.
Observed reality:     Distribution/Installation (ID-1/ID-2/ACQ-UPG) and the
                      full RTI-1..RTI-8 arc were completed first, and Agentic
                      Trust/Security (AISEC) and Memory (MEM) foundation work
                      was subsequently planned ahead of further test-domain
                      expansion (API/PERF/DB).
Decision:            Adopt the revised sequence below rather than retroactively
                      pretend the original assumed order remained active.
Decision owner:       Project owner.
```

**Adopted sequence:**

```text
RTI closure
  → Conformance Remediation Wave 1
  → Conformance Remediation Wave 2
  → Architecture Conformance Gate
  → AISEC-1 .. AISEC-7
  → MEM-1 .. MEM-9
  → Full Project Strict Audit
  → Productization
```

**Rationale** (as adopted by the owner):

1. Agentic trust/security boundaries should be defined before agentic
   authority grows further.
2. Memory trust/provenance/persistence boundaries should be defined before
   persistent context is introduced — persistent memory must not precede its
   own security architecture.
3. These foundations (authority, trust, provenance, persistence) are
   intended to be reusable by later test-domain capabilities rather than
   independently rebuilt for each future domain.
4. The conformance analysis itself exposed roadmap drift and unresolved
   product/domain boundaries (`A-1`, `A-3`, `D-2`); those should be made
   explicit before building a threat model over the project, not discovered
   mid-way through one.
5. Future API/Performance/Database capabilities remain planned
   domain-expansion work and must satisfy their own prerequisites
   (`D-1`, `D-3`) when activated — they are not being evaluated against
   AISEC/MEM's own entry criteria.

**Disposition of API / Performance / Database / Governance:**

```text
Classification: DEFERRED DOMAIN EXPANSION — NOT A PREREQUISITE FOR AISEC ENTRY
```

They are **not cancelled**. They are **not automatically reinserted** ahead
of AISEC/MEM either. They remain planned future capabilities, gated by their
own prerequisites (`D-1` for evaluation-scale expansion, `D-3` for controlled
SUT / negative and load testing) when the project actually takes them up.
Near-term governance conformance cleanup (`B-1`, `B-2`, `B-6`) is distinct
from — and must not be conflated with — any future enterprise-scale
multi-role governance architecture track, if and when one is defined.

**Provenance — what must never be claimed:**

- ❌ "The conformance audit decided to prioritize AISEC." — false; the audit
  identified the inconsistency (`C-3`) and required an owner decision.
- ❌ "The audit approved postponing API/PERF/DB." — false; the owner decided
  this, after the audit.
- ❌ "The conformance report created the Architecture Conformance Gate." —
  false; the project adapted the remediation program into this structure.
- ✅ "The audit identified the inconsistency. The owner subsequently chose
  the revised sequence. The project adapted the remediation program into
  CRW1 / CRW2 / the Architecture Conformance Gate."

### Subsequent owner decision — Trusted Retrieval and Continuous Learning

```text
Original adopted future sequence:
  AISEC
    → MEM-1 .. MEM-9
    → Full Project Strict Audit
    → Productization

Subsequent architecture refinement:
  AISEC
    → MEM-1 .. MEM-6
    → RAG-1 .. RAG-12
    → MEM-7 .. MEM-9
    → LEARN-1 .. LEARN-9
    → Full Project Strict Audit
    → Productization

Reason:  memory trust architecture must precede persistent retrieval
         authority; RAG must be validated (relevance, isolation,
         trust/freshness filtering) before the final memory proof
         (`MEM-7..MEM-9`) can be meaningfully exercised, since that
         proof validates integrated retrieval/memory behavior;
         continuous learning depends on verified outcomes and a
         frozen evaluation baseline, both of which presuppose RAG and
         Memory already exist; fine-tuning remains an optional
         experiment, never a prerequisite for RAG or Memory
         completion.
Decision owner: Project owner.
```

**Provenance — what must never be claimed about this specific
decision:**

- ❌ "The conformance audit required RAG." — false; the conformance
  audit (dated 2026-09-16, see [§6](#6-conformance-remediation-program))
  never mentions RAG, retrieval, or continuous learning.
- ❌ "The RTI Integrated Audit approved continuous learning." — false;
  the RTI Integrated Audit's scope (see [§5](#5-rti-closure)) is the
  #1-23 reactive-triage/generative pipelines, not memory or learning
  architecture.
- ❌ "AISEC requires fine-tuning." — false; fine-tuning is optional
  (`LEARN-6`, see [§10](#10-mem--agentic-memory-foundation)) and is
  not an AISEC entry or exit criterion.
- ✅ The repository roadmap originally planned `AISEC → MEM-1..9 →
  Full Project Strict Audit → Productization` (the "Original adopted
  future sequence" above, itself first recorded by this same §7 at
  `CRW1-A` closure). Subsequent project design work introduced
  trusted retrieval/RAG and feedback-driven continuous learning as
  additional, separately governed architecture layers. The project
  owner decided to formally integrate those layers into the canonical
  sequence, at the position shown above. This roadmap update
  (`ROADMAP-V3.3-SYNC`) records that decision; it does not implement
  any part of it.

This decision does **not** change the current execution gate: as of
this update, `RAG`/`LEARN` are both `NOT_STARTED` (see
[§10](#10-mem--agentic-memory-foundation)).

### Subsequent owner decision — Parallelized Conformance Execution

```text
Previous model:   CRW1-D → CRW2 → Architecture Conformance Gate
                  (strictly serial)

New model:        After ROADMAP-V3.3-SYNC's own certification, the following
                  five implementation tracks may start independently and
                  concurrently:

                    CRW1-D  / B-3
                    CRW2-A2 / A-2
                    CRW2-B1 / B-1
                    CRW2-B4 / B-4
                    CRW2-B6 / B-6

                  Each uses its own branch, PR, primary finding ownership,
                  review classification, review, merge, and post-merge
                  certification. See §6's "Parallel execution model" for the
                  full mandatory safety controls this requires.

Decision owner:   Project owner.
```

The Architecture Conformance Gate remains a **hard integration barrier**: it
may not start until all five tracks above are `CLOSED_ON_MAIN` **and** a
`CONFORMANCE-INTEGRATION-CHECK` (§6) passes. Parallelizing *implementation*
does not parallelize *correctness responsibility*, and it does not waive
semantic-integration validation — Git mergeability alone is never treated as
proof that two parallel tracks are actually compatible (§6).

**Provenance — what must never be claimed about this decision:**

- ❌ "Parallel execution means CRW1-D and CRW2 are done once their PRs
  merge." — false; the Architecture Conformance Gate additionally requires a
  passing `CONFORMANCE-INTEGRATION-CHECK` (§6).
- ❌ "Parallel authorization removes the review requirement for any of the
  five tracks." — false; each track still requires its own review, at
  `LIGHT` or `HEAVY` classification per §6's review model — `HEAVY` rigor is
  explicitly unweakened by this decision.
- ✅ The owner decided implementation of independent findings may proceed
  concurrently, subject to explicit dependency declarations and a mandatory
  pre-Gate integration check — this reduces unnecessary serialization, not
  verification.

### Subsequent owner decision — Early AISEC/MEM Research Parallelism

```text
Authorized early research-only stages:

  AISEC-1  Agentic Threat Model Research
  AISEC-2  Prompt / Indirect Injection Study
  AISEC-6  Security Architecture Decision Record

  MEM-1    Agentic Memory Use-Case Research
  MEM-2    Memory Taxonomy & Trust Model

These may begin while CRW1-D / CRW2-A2 / CRW2-B1 / CRW2-B4 / CRW2-B6 are
still being implemented.
Decision owner: Project owner.
```

This is a **conscious narrowing, not a cancellation**, of the principle
recorded earlier in this section ("Agentic trust/security boundaries should
be defined before agentic authority grows further"). Mainline
execution/integration still follows the Architecture Conformance Gate
barrier in full; only selected research/analysis work may begin early, and
only under these conditions:

- Early research exists off-`main` — a long-lived draft PR, research branch,
  or research document — and may collect evidence, compare options, identify
  threats, draft ADR options, and define *provisional* taxonomy/trust
  models. It may **not** be treated as accepted architecture.
- Every early AISEC/MEM research PR/document must include an explicit
  **Assumptions** section stating at minimum, as of the `main` state it was
  written against: `A-1` `CLOSED_ON_MAIN` (decided as
  `PRIVATE_GENERATIVE_SURFACE` — see
  [`docs/package-surface-v2.md`](docs/package-surface-v2.md) and
  [`ACG-A1` closure evidence](#acg-a1-closure-evidence)), `A-3`
  `CLOSED_ON_MAIN` (decided as `SEPARATE_BOUNDED_CONTEXTS` — see
  [`docs/architecture-model-boundary-v2.md`](docs/architecture-model-boundary-v2.md)
  and [`ACG-A3` closure evidence](#acg-a3-closure-evidence)), `D-2`
  `CLOSED_ON_MAIN` (decided as `RENAME_PRIVATE_GENERATIVE_DIRECTORY` — see
  [`ACG-D2` closure evidence](#acg-d2-closure-evidence)), Architecture
  Conformance Gate `COMPLETE_ON_MAIN` (see [Gate closure
  evidence](#architecture-conformance-gate-closure-evidence)) — plus its own
  provisional conclusions, and an explicit statement that those
  conclusions "must be revalidated after Architecture Gate: YES". (This
  bullet originally required `A-1`, `A-3` and `D-2` to be stated as
  unresolved and the Architecture Conformance Gate to be stated as not
  closed, each accurate until that finding or the Gate itself closed on
  `main`; research written earlier may retain that historical assumption
  state until its mandatory post-Gate revalidation.)
- Before Architecture Gate closure, early research may **not** finalize the
  public product surface, public API contract, runtime authority contract,
  persistence schema, final threat-model scope, an accepted security ADR, or
  a final memory-persistence contract. It may propose options; it may not
  silently convert options into canonical decisions.
- `AISEC-1`/`AISEC-2`/`AISEC-6`/`MEM-1`/`MEM-2` may **start** early. They may
  **not merge into `main`** before all five conformance findings are closed,
  `CONFORMANCE-INTEGRATION-CHECK` passes, and the Architecture Conformance
  Gate itself closes/certifies. Only after Gate decisions are known is early
  research revalidated (reopen/re-read assumptions → invalidate outdated
  ones → remove obsolete options → update conclusions → targeted review)
  and merge-authorized — a draft research PR is never merge-authorized
  merely because it was written earlier.
- No other AISEC/MEM stage, and no `RAG`/`LEARN` stage, receives early-start
  permission: `AISEC-3`/`4`/`5`/`7`, all of `MEM-3..MEM-9`, all of
  `RAG-1..RAG-12`, and all of `LEARN-1..LEARN-9` remain blocked until the
  Architecture Conformance Gate closes, exactly as recorded in
  [§8](#8-current-critical-path) and [§10](#10-mem--agentic-memory-foundation).
  The research exception does **not** move `RAG`/`LEARN` earlier in the
  canonical sequence.

### Subsequent owner decision — Governance Pre-Review Framework Before AISEC-4

```text
Previous order:   AISEC-3 (COMPLETE_ON_MAIN)  →  AISEC-4 .. AISEC-7

New order:        AISEC-3 (COMPLETE_ON_MAIN)  →  GOV-AUTO-1  →  AISEC-4 .. AISEC-7
                  GOV-AUTO-1 is defined in §6; its implementation is NOT_STARTED and it is the
                  roadmap-designated next active gate (design/reconciliation
                  merged + certified; see §8).

Decision owner:   Project owner.
```

This entry records ordering only. `AISEC-3` remains `COMPLETE_ON_MAIN` and is
not reopened; `AISEC-4` remains `NOT_STARTED` with its own scope unchanged; the
`MEM`/`RAG`/`LEARN` order is unchanged. `GOV-AUTO-1` is placed before
`AISEC-4` because a deterministic pre-review framework supports every later
security, memory and autonomy gate. Since this decision was recorded, the
`GOV-AUTO-1` design/reconciliation has been merged and post-merge certified (see
[GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence)); `GOV-AUTO-1` implementation remains `NOT_STARTED`, `AISEC-4`
remains `NOT_STARTED`, and the decision itself and the `MEM`/`RAG`/`LEARN` order
are unchanged.

**Provenance — what must never be claimed about this decision:**

- ❌ "`GOV-AUTO-1` is an `AISEC-3` corrective or reopens `AISEC-3`." -- false;
  `AISEC-3` stays `COMPLETE_ON_MAIN`.
- ❌ "`GOV-AUTO-1` replaces human review, security review, merge authorization or
  canonical closure." -- false; it only produces deterministic pre-review
  evidence (§6).
- ✅ The owner decided a deterministic pre-review framework is sequenced before
  `AISEC-4`; this reduces deterministic review noise, not verification.

## 8. Current critical path

```text
CRW1-A (COMPLETE_ON_MAIN)  →  CRW1-B (COMPLETE_ON_MAIN)  →  CRW1-C (COMPLETE_ON_MAIN)
  →  {  CRW1-D / B-3 (COMPLETE_ON_MAIN / CLOSED_ON_MAIN),
         CRW2-A2 / A-2 (COMPLETE_ON_MAIN / CLOSED_ON_MAIN),
         CRW2-B1 / B-1 (COMPLETE_ON_MAIN / CLOSED_ON_MAIN),
         CRW2-B4 / B-4 (COMPLETE_ON_MAIN / CLOSED_ON_MAIN),
         CRW2-B6 / B-6 (COMPLETE_ON_MAIN / CLOSED_ON_MAIN)  }  (PARALLEL ORIGINAL SET)
  →  CONFORMANCE-INTEGRATION-CHECK (PASS)
  →  Architecture Conformance Gate (COMPLETE_ON_MAIN)
       [A-3 CLOSED_ON_MAIN; A-1 CLOSED_ON_MAIN; D-2 CLOSED_ON_MAIN]
  →  AISEC-1 (COMPLETE_ON_MAIN)  →  AISEC-2 (COMPLETE_ON_MAIN)  →  AISEC-3 (COMPLETE_ON_MAIN)  →  GOV-AUTO-1 (design/reconciliation MERGED + CERTIFIED; implementation NOT_STARTED; NEXT ACTIVE GATE -- roadmap sync CERTIFIED_ON_MAIN; Wave 0 is the next governed step, NOT_STARTED)  →  AISEC-4 .. AISEC-7
  →  MEM-1 .. MEM-6
  →  RAG-1 .. RAG-12
  →  MEM-7 .. MEM-9
  →  LEARN-1 .. LEARN-9
  →  Full Project Strict Audit
  →  Productization
```

This is the canonical future sequence following the [subsequent owner
decision](#7-owner-phase-order-decision) recorded in §7. `CRW1-D`,
`CRW2-A2`, `CRW2-B1`, `CRW2-B4`, and `CRW2-B6` were the original five
parallel-authorized tracks in `{ }` — none a serial predecessor to the
other — and all
five remain shown inside that same group, now annotated `COMPLETE_ON_MAIN`
/ `CLOSED_ON_MAIN`: they merely happened to close first, second, third,
fourth, and fifth,
per their own closure evidence ([`CRW1-D`](#crw1-d-closure-evidence),
[`CRW2-A2`](#crw2-a2-closure-evidence),
[`CRW2-B1`](#crw2-b1-closure-evidence),
[`CRW2-B4`](#crw2-b4-closure-evidence),
[`CRW2-B6`](#crw2-b6-closure-evidence)) below; none of those closures
**unlocked or gated** any other — each track's authorization came
from the owner's parallelization decision itself (§7), not from any other
track finishing. This
representation matches §6's own diagram, which has shown all five inside
the same parallel group throughout. This replaces the previously
strictly-serial `CRW1-D → CRW2`
framing — and must not be misread as reconstructing it: there is still no
serial arrow among any of the five.
`CONFORMANCE-INTEGRATION-CHECK` was a mandatory synchronization barrier, not
an optional formality: the Architecture Conformance Gate never becomes
`READY` merely because all five findings closed — it required `B-3`,
`A-2`, `B-1`, `B-4`, and `B-6` all `CLOSED_ON_MAIN` (all five now are —
five satisfied conditions, the full original-five predicate) **plus** a
passing
integration check. Both conditions held: the integration check ran
read-only against `main` at that time and returned `PASS` (see
[integration evidence](#conformance-integration-check-evidence) in §8
above), so the Gate became `READY`. `READY` was eligibility, not
activation; Gate **execution** has since **started** and the Gate is now
`ACTIVE` (`ACG-A3` / `A-3` `CLOSED_ON_MAIN` — see [closure
evidence](#acg-a3-closure-evidence) below). Nothing from `AISEC` onward is
active, except the narrow,
explicitly-provisional early-research exception also recorded in §7 (early
`AISEC-1`/`AISEC-2`/`AISEC-6`/`MEM-1`/`MEM-2` research, off-`main`, not
merge-authorized before the Gate). Neither Gate readiness nor the start of
Gate execution changes this —
mainline `AISEC`/`MEM`/`RAG`/`LEARN` remain gated on the Gate's own
closure, not merely its readiness or the start of its execution. See
[§10](#10-mem--agentic-memory-foundation)
for the `MEM`/`RAG`/`LEARN` stage detail and why `RAG` sits between
`MEM-6` and `MEM-7`.

**Slice lifecycle status semantics.** This project's governance already
defines a slice's lifecycle as: implementation → independent exact-head
review → merge → post-merge truth proof. A slice is **ACTIVE** from the
start of implementation until its post-merge truth proof completes. This
definition is stated once, here, and governs the status line below — so that
line does not need to be rewritten merely because a PR opens, is reviewed,
or merges.

**Gate-level status.** The same definition applies to the Architecture
Conformance Gate as a whole: it became **`ACTIVE`** when its first owned
implementation slice (`ACG-A3`) began, and remains `ACTIVE` until every
finding it owns (`A-1`, `A-3`, `D-2`) is closed and certified. `IN_EXECUTION`
is used alongside `ACTIVE` for the Gate only as a plain descriptor that
Gate execution has started; it is not a separate lifecycle status. All
three owned findings are now closed and certified, and an independent
Gate-level closure certification approved closure; per this same
definition the Gate has exited `ACTIVE` — see [Gate closure
evidence](#architecture-conformance-gate-closure-evidence) below.

**`CRW1-A` — `COMPLETE_ON_MAIN`.** Its post-merge truth proof passed (see
[closure evidence](#crw1-a-closure-evidence) below); per the lifecycle
definition above, this slice exited `ACTIVE` when that proof completed.

**`CRW1-B` — `COMPLETE_ON_MAIN`.** Its post-merge truth proof passed (see
[closure evidence](#crw1-b-closure-evidence) below); per the lifecycle
definition above, this slice exited `ACTIVE` when that proof completed.
`CRW1-B` closed `B-5` — Node 22 is now a fail-closed repository runtime
contract (`.nvmrc`, `.npmrc` `engine-strict=true`, and the full CI Node
inventory), independently verified.

**`CRW1-C` — `COMPLETE_ON_MAIN`.** Its post-merge truth proof passed (see
[closure evidence](#crw1-c-closure-evidence) below); per the lifecycle
definition above, this slice exited `ACTIVE` when that proof completed.
`CRW1-C` closed `B-2` — repository governance metadata is now in place: a
durable PR template, bug-report and feature-request issue forms, and
issue-template configuration (`.github/pull_request_template.md`,
`.github/ISSUE_TEMPLATE/`), including a security-reporting boundary that
accurately reflects the absence of a private vulnerability-reporting
channel. `CODEOWNERS` remains intentionally omitted — this is a
solo-maintainer repository (one collaborator with admin access; branch
protection's `require_code_owner_reviews` and
`required_approving_review_count` are both unset), matching README's own
already-documented solo-maintainer governance profile (`SG1`); revisit if
multiple maintainers, distinct ownership domains, or code-owner review
enforcement are ever introduced.

**`CRW1-D` — `COMPLETE_ON_MAIN`.** Its post-merge truth proof passed (see
[closure evidence](#crw1-d-closure-evidence) below); per the lifecycle
definition above, this slice exited `ACTIVE` when that proof completed.
`CRW1-D` closed `B-3` — ongoing supply-chain monitoring (Dependabot,
dependency-review, and an identity-aware scheduled/PR/push audit-drift
check) is now versioned and operational on `main`; this records the
already-certified implementation closure, not a re-assertion of the
technical review itself. `CRW1-D` was the first of the five
parallel-authorized tracks (§6) to close.

**`CRW2-A2` — `COMPLETE_ON_MAIN`.** Its post-merge truth proof passed (see
[closure evidence](#crw2-a2-closure-evidence) below); per the lifecycle
definition above, this slice exited `ACTIVE` when that proof completed.
`CRW2-A2` closed `A-2` — the evaluation/regression merge-blocking policy is
now formally specified
([`docs/evaluation-execution-policy-v1.md`](docs/evaluation-execution-policy-v1.md))
and enforced by a single runtime authority
(`scripts/ai/evaluation/execution-policy.js`): `v1`-`v5` are `INFORMATIONAL`,
`v6` is `STRICT` — this records the already-certified implementation
closure, not a re-assertion of the technical review itself. `CRW2-A2` was
the second of the five parallel-authorized tracks (§6) to close.

**`CRW2-B1` — `COMPLETE_ON_MAIN`.** Its post-merge truth proof passed (see
[closure evidence](#crw2-b1-closure-evidence) below); per the lifecycle
definition above, this slice exited `ACTIVE` when that proof completed.
`CRW2-B1` closed `B-1` — a versioned, durable, machine-readable branch
inventory/classification authority now exists
([`docs/branch-inventory-v1.md`](docs/branch-inventory-v1.md),
[`scripts/diagnostics/branch-inventory.js`](scripts/diagnostics/branch-inventory.js)):
one named long-lived branch (`main`) plus thirteen evidenced transient/
automation classes, fail-closed manifest validation, and fail-closed branch
classification (an unrecognized branch is `UNKNOWN`, a malformed manifest
is `INVALID_MANIFEST` — neither ever silently resolves to a privileged
classification) — this records the already-certified implementation
closure, not a re-assertion of the technical review itself. `CRW2-B1` was
the third of the five parallel-authorized tracks (§6) to close.

**`CRW2-B4` — `COMPLETE_ON_MAIN`.** Its post-merge truth proof passed (see
[closure evidence](#crw2-b4-closure-evidence) below); per the lifecycle
definition above, this slice exited `ACTIVE` when that proof completed.
`CRW2-B4` closed `B-4` — the external installation proof's shared `npm
pack`/`npm install` fixture now builds inside one explicit, first-run
bootstrap test instead of a `before()` hook: a required-fixture failure
still fails closed (non-zero exit, no dependent `PASS`, no dependent
`SKIP`) but now surfaces its root cause exactly once instead of duplicating
the identical raw error across all fourteen dependent tests — this records
the already-certified implementation closure, not a re-assertion of the
technical review itself. `CRW2-B4` was the fourth of the five
parallel-authorized tracks (§6) to close.

**`CRW2-B6` — `COMPLETE_ON_MAIN`.** Its post-merge truth proof passed (see
[closure evidence](#crw2-b6-closure-evidence) below); per the lifecycle
definition above, this slice exited `ACTIVE` when that proof completed.
`CRW2-B6` closed `B-6` — a durable, versioned governance/process
knowledge catalog (`docs/governance-process-v1.md` at B-6 closure — since
superseded by `v2`, then `v3`; current authority:
[`docs/governance-process-v3.md`](docs/governance-process-v3.md)) now exists: it
indexes the existing versioned contracts by subject/version/authority,
states an explicit subject-scoped authority hierarchy, and records — for
the first time durably — the independent-review requirement and the
self-approval/self-merge/self-closure prohibition, an atomic
version-transition model with deterministic pre-/post-merge authority
and no "newest wins" heuristic, and a fail-closed conflict-handling rule
— this records the already-certified implementation closure, not a
re-assertion of the technical review itself. `CRW2-B6` was the fifth and
final of the five parallel-authorized tracks (§6) to close.

**All five original parallel-authorized tracks are now `COMPLETE_ON_MAIN`
/ `CLOSED_ON_MAIN`** — none remains `READY` or `ACTIVE`. `CONFORMANCE-
INTEGRATION-CHECK` (§6) has now **passed** — all five of its required
inputs (`B-3`, `A-2`, `B-1`, `B-4`, `B-6`) are `CLOSED_ON_MAIN` and the
check itself found zero actual defects on the combined current-`main`
state; see [integration evidence](#conformance-integration-check-evidence)
above for what it checked and its durable result. The Architecture
Conformance Gate therefore became **`READY`** (eligibility, not
activation) — and Gate **execution** has since **started**.

**Architecture Conformance Gate — `COMPLETE_ON_MAIN`.** Its first
owned finding, `A-3`, is `CLOSED_ON_MAIN` via `ACG-A3` (PR #171; see
[ACG-A3 closure evidence](#acg-a3-closure-evidence) below) — the first
Gate-owned finding to close — its second, `A-1`, is `CLOSED_ON_MAIN`
via `ACG-A1` (PR #173; see [ACG-A1 closure
evidence](#acg-a1-closure-evidence) below), and its third, `D-2`, is now
also `CLOSED_ON_MAIN` via `ACG-D2` (PR #175; see [ACG-D2 closure
evidence](#acg-d2-closure-evidence) below): the repository no longer
contains `scripts/ai/test-design/` — it was renamed to
`scripts/ai/generative-test-design/`, removing the namespace collision
with the deterministic `scripts/ai/test-design.js`. All three Gate-owned
findings are now `CLOSED_ON_MAIN`. Gate closure was a distinct
certification step, addressed by a separate mission -- an independent
Gate-level closure certification (review-only, no repository diff)
approved closure, and this canonical sync records the result: the
Architecture Conformance Gate is `COMPLETE_ON_MAIN` (see [Gate closure
evidence](#architecture-conformance-gate-closure-evidence) below).
`AISEC-1` has since closed too (see [AISEC-1 closure
evidence](#aisec-1-closure-evidence) below), and so have `AISEC-2` (see
[AISEC-2 closure evidence](#aisec-2-closure-evidence) below) and `AISEC-3`
(see [AISEC-3 closure evidence](#aisec-3-closure-evidence) below); per
[§15](#15-final-target-state), `GOV-AUTO-1` (inserted before `AISEC-4`; see
[§6](#gov-auto-1--governance-pre-review-framework-next-active-gate) and [§7](#7-owner-phase-order-decision)) is now the
roadmap-designated next active gate, with `AISEC-4` following it -- an
authorization-level designation only. Its design/reconciliation has since been
merged and post-merge certified (see [GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence)) while its
implementation remains `NOT_STARTED`; the ROADMAP synchronization recording that
design has itself been reviewed under the required review lifecycle gate (review independence LIMITED -- same-session role separation), merged and post-merge certified (PR #186; see [GOV-AUTO-1 ROADMAP synchronization closure evidence](#gov-auto-1-roadmap-synchronization-closure-evidence)), so Wave 0 is now the next governed
implementation step and remains `NOT_STARTED`. `D-1` and
`D-3` remain `DEFERRED`. Nothing from `AISEC`/`MEM`/`RAG`/`LEARN`
execution is started or activated by this state.

Historical lower-level critical paths (`CS6`, `CS7`, "RTI implementation",
"RTI Integrated Audit READY") describe *past* states of this project and
remain accurate as history in README's own roadmap-by-roadmap record — they
are not the current critical path and must not be read as such.

### CRW1-A closure evidence

```text
PR:            #150
merge SHA:      f7b2647e388c3bc2ea90e1ba9f75d4fcc91234e9
approved HEAD:  85b79fa6744b6e7edf6a8ccc8800dd6529a15811
approved TREE:  99301251da8ffdf65040aeba89dc3abbf1b1a8e5
post-merge CI:  run 35103324158 — PASS (attempt 1: one known transient
                Firefox live-network poiTiles timeout, unrelated to this
                docs-only change — see README's #19.7F-B4B precedent;
                attempt 2: 7/7 success)

CRW1A-R01: CLOSED_ON_MAIN   CRW1A-R02: CLOSED_ON_MAIN
C-1: CLOSED_ON_MAIN   C-2: CLOSED_ON_MAIN   C-3: RECORDED_ON_MAIN
C-4: CLOSED_ON_MAIN   A-4: CLOSED_ON_MAIN
```

### CRW1-B closure evidence

```text
PR:            #152
merge SHA:      7039f9cb4e11332838eca4a03c5f87aaca089fd7
approved HEAD:  74e29e804cc3bc5baac13143183f9afe0622c652
approved TREE:  82b8f398b63d5ead920589f5e49538dba9bc940a
post-merge CI:  run 35144019276 — PASS (7/7, attempt 1, exact merge SHA)

Node contract:  package.json engines 22.x + .npmrc engine-strict=true +
                .nvmrc 22; unsupported Node24 fails closed (EBADENGINE);
                supported Node22 CI passes (unit 3951/3951/0/0, Linux)
Cypress:        container Node 22.21.0; installed/executed Cypress both
                15.21.1, no mismatch

CRW1B-R01: CLOSED_ON_MAIN
B-5: CLOSED_ON_MAIN
```

### CRW1-C closure evidence

```text
PR:            #154
merge SHA:      735d24bebe93ef8ac67219df0c759d46745109b8
approved HEAD:  70d6d13462c69cc086aa991fb4ce3b67294649f3
approved TREE:  334edcd5e51ed336efc92d2a720dd8528a1d6ff2
post-merge CI:  run 35219569594 — PASS (7/7, attempt 1, exact merge SHA)

Governance metadata: PR template (durable, no volatile CI/review/merge
                state); bug-report + feature-request issue forms
                (structurally valid, no fabricated labels/assignees);
                issue-template config (`blank_issues_enabled: true`, no
                fabricated contact links); security-reporting boundary
                explicit (public form prohibits suspected-vulnerability/
                sensitive-security disclosure, no private channel
                fabricated, SECURITY.md accurately described as
                architecture, not a reporting process)
CODEOWNERS:     INTENTIONALLY_OMITTED — solo-maintainer repository, no
                distinct ownership partition, no code-owner review
                enforcement; revisit if that changes

CRW1C-R01: CLOSED_ON_MAIN   CRW1C-R02: CLOSED_ON_MAIN
B-2: CLOSED_ON_MAIN
```

### CRW1-D closure evidence

```text
PR:             #157
merge SHA:      a0874ad2c2350e9ada3a7e81d81604a5c0683c13
approved HEAD:  048f1a6cd5614bf3576ade1c268e840d75dbd2dc
approved TREE:  012011f5aeb202032243163090bf7cb55888e797
post-merge CI:  run 35262739969 — PASS (7/7, attempt 1, exact merge SHA)
post-merge Supply-Chain Audit: run 35262739875 — PASS (audit-drift-check,
                attempt 1, exact merge SHA, event push)

Supply-chain monitoring: versioned and operational on `main` — Dependabot
                (`npm` + `github-actions` ecosystems, weekly), a
                dependency-review gate on manifest-changing PRs
                (`actions/dependency-review-action`, fails on `high`
                severity), and a scheduled/PR/push audit-drift check
                (`scripts/diagnostics/audit-drift-check.js`) with an
                identity-aware (package + GHSA advisory id, not aggregate
                count) accepted-advisory baseline and fail-closed
                PASS/VIOLATION/INFRA_ERROR semantics. This does not claim
                all supply-chain risk is eliminated: two high-severity
                advisories (`js-yaml`/`GHSA-2883-xcg3-v3hh`,
                `serialize-javascript`/`GHSA-5c6j-r48x-rmvq`) remain
                explicitly reviewed, reachability-analyzed accepted debt as
                of this closure — 0 new/unaccepted high or critical
                advisories at certification time.

CRW1D-R01: CLOSED_ON_MAIN   CRW1D-R02: CLOSED_ON_MAIN
CRW1D-R03: CLOSED           CRW1D-R04: CLOSED
B-3: CLOSED_ON_MAIN
```

### CRW2-A2 closure evidence

```text
PR:             #162
merge SHA:      d6c344c1e9ce9190c65a22867ae3da1e60f14926
approved HEAD:  c1148fb8d0fe1dbc27caf34d7d2664bf2d05181f
approved TREE:  7df6bd749a38e6851eb877c31e0c17475fa3fbe2
merge method:   standard two-parent (parent1 3fcfcecd8b407483a8786bcd49086a409aaae12e,
                parent2 c1148fb8d0fe1dbc27caf34d7d2664bf2d05181f)
post-merge CI:  run 35321066886 — PASS (7/7, attempt 1, exact merge SHA, event push)
post-merge QA Agent evaluation: PASS — all six versions confirmed live on
                main (v1-v5 Execution policy: INFORMATIONAL / Blocking
                decision: NON-BLOCKING; v6 Execution policy: STRICT), no
                continue-on-error/masking on any regression step.

Formal evaluation execution-policy decision: versioned and operational on
                `main` — a durable decision record
                (`docs/evaluation-execution-policy-v1.md`) plus a single
                runtime authority (`scripts/ai/evaluation/execution-policy.js`,
                `VERSION_POLICY` + `resolvePolicyForVersion()` +
                `resolveExitCode()`) fail-closed on any unrecognized
                version/status/policy. `v1`-`v5`: `INFORMATIONAL` (report
                `REGRESSED` truthfully, never block). `v6`: `STRICT` (only
                an exact match to its reviewed baseline exits 0). This does
                not change any version's actual CI-facing behavior — it
                formalizes and centralizes six previously scattered, implicit
                exit-code decisions. 253/253 evaluation tests pass. No
                public-API/package change (`npm pack --dry-run`: 80 files,
                shasum `6edcaeae3fae5bc280d90359a623c978c4c11d44`, unchanged).

CRW2A2-R01: CLOSED_ON_MAIN   CRW2A2-R02: CLOSED_ON_MAIN
CRW2A2-R03: CLOSED_ON_MAIN   CRW2A2-R04: CLOSED
CRW2A2-R05: CLOSED           CRW2A2-R06: CLOSED
A-2: CLOSED_ON_MAIN
```

### CRW2-B1 closure evidence

```text
PR:             #164
merge SHA:      dc11f24f3659f5f7a483abf69911f1f4db7aa930
approved HEAD:  8ed870c144400b5d1a709bbea8bdcd46a7dc8313
approved TREE:  922617a143794f9c69dde599656525dee551ce32
merge method:   standard two-parent (parent1 d5c902e4f5ffb966a8b258ac06b27f0df47d10c8,
                parent2 8ed870c144400b5d1a709bbea8bdcd46a7dc8313)
post-merge CI:  run 35345973684 — PASS (7/7, attempt 1, exact merge SHA, event push)

Versioned branch inventory: versioned and operational on `main` — a durable
                decision record (`docs/branch-inventory-v1.md`) plus a
                single, schema-versioned, fail-closed runtime authority
                (`scripts/diagnostics/branch-inventory.js`: `MANIFEST`
                schemaVersion 1, `validateManifest()`,
                `classifyBranch()`, `getCurrentBranch()`). HYBRID model: one
                named long-lived branch (`main`, protected) plus thirteen
                evidenced transient/automation classes (`feature`, `docs`,
                `chore`, `fix`, `corrective`, `refactor`, `experiment`,
                `evidence`, `independence`, `installation`, `proof`,
                `spike`, `dependabot`). Fail-closed both directions: an
                invalid/malformed manifest (including own-property-hardened
                prototype-inheritance resistance) never produces an
                authoritative classification (`INVALID_MANIFEST`); an
                unrecognized branch never becomes privileged (`UNKNOWN`).
                48/48 focused tests pass, 4043/4051 full relevant suite (8
                pre-existing skips, 0 failures). No public-API/package
                change (`npm pack --dry-run`: 80 files, shasum
                `6edcaeae3fae5bc280d90359a623c978c4c11d44`, unchanged). Live
                branch protection was not mutated by this work.

CRW2B1-R01: CLOSED_ON_MAIN   CRW2B1-R02: CLOSED_ON_MAIN
CRW2B1-R03: CLOSED_ON_MAIN   CRW2B1-R04: CLOSED
CRW2B1-R05: CLOSED           CRW2B1-R06: CLOSED_ON_MAIN
CRW2B1-R07: CLOSED           CRW2B1-R08: CLOSED
B-1: CLOSED_ON_MAIN
```

### CRW2-B4 closure evidence

```text
PR:             #166
merge SHA:      a58338b1289fbe8040d5b4c139e63be4410ecbf4
approved HEAD:  7c6a00b831069d1a9f04c659c20303fd0e36d19c
approved TREE:  8bae84d2c025be99755534806f61534797fb1244
merge method:   standard two-parent (parent1 5853f1127d81c0a3bbf4d206d237fd95c62b6414,
                parent2 7c6a00b831069d1a9f04c659c20303fd0e36d19c)
post-merge CI:  run 35372235589 — PASS (7/7, attempt 1, exact merge SHA, event push)

Fail-closed test-infrastructure verification: the external installation
                proof's shared fixture (a real `npm pack` + `npm install`
                into a temp external repo, ~14 dependent tests) built
                inside a `before()` hook whose thrown error node:test
                re-reports, verbatim, against every dependent test
                independently — reproduced with a real `node --test`
                child process: exit code already reliably non-zero
                (fail-closed, no false green, no silent skip), but the
                identical raw root-cause stack was duplicated across all
                14 dependent failures, reading as "14 independent
                defects" instead of "1 shared infrastructure failure"
                (misleading test evidence, not a false-pass defect).
                Fixed: the fixture now builds inside one explicit,
                first-run "ID-2 bootstrap" test; every dependent test is
                registered through a local `test()` wrapper that checks a
                module-level `bootstrapError` first — on a bootstrap
                failure each dependent still fails closed (never `PASS`,
                never `SKIP`) but carries a short `TEST_INFRA_SETUP_FAILED`
                pointer instead of re-deriving the full raw error; the real
                root cause now surfaces exactly once, in the bootstrap
                test's own failure. A dedicated real-runner proof suite
                (`test/installation/external-repository-proof-fail-closed.test.js`)
                independently confirms, via genuine `node --test
                --test-reporter=tap` child processes (not self-referential
                unit tests): the pre-fix cascade reproduces from the base
                commit; the post-fix pattern still exits non-zero on a
                required setup failure; every dependent failure carries
                the short marker; no dependent test can `PASS` or `SKIP`
                on a bootstrap failure (proven per-dependent, not by an
                ambiguous absence check); and a succeeding bootstrap still
                lets every dependent run and pass normally. Every child
                `node --test` spawn explicitly strips `NODE_TEST_*` from
                its environment (otherwise Node silently treats the child
                as an already-coordinated recursive worker and skips it
                entirely — exit 0, no output, misleadingly "successful").
                6/6 proof-suite tests pass, 15/15 external installation
                proof tests pass, 4050/4058 full relevant suite (8
                pre-existing, unrelated skips, 0 failures). No
                public-API/package change (`npm pack --dry-run`: 80 files,
                shasum `6edcaeae3fae5bc280d90359a623c978c4c11d44`,
                unchanged).

CRW2B4-R01: CLOSED   CRW2B4-R02: CLOSED
CRW2B4-R03: CLOSED   CRW2B4-R04: CLOSED
B-4: CLOSED_ON_MAIN
```

### CRW2-B6 closure evidence

```text
PR:             #168
merge SHA:      c2e11fa31a3378355cef7498814f89ee789f427a
approved HEAD:  2ad7cbd9b0c4a74ec071fcb306b4721a44c96740
approved TREE:  9ffb26e65e05b118c9a52f57e9b1a6a837cf5d38
merge method:   standard two-parent (parent1 2505cd21272b899cef5658d7a1e2035e4acc0cbe,
                parent2 2ad7cbd9b0c4a74ec071fcb306b4721a44c96740)
post-merge CI:  run 35429454890 — PASS (7/7, attempt 1, exact merge SHA, event push)

Versioned governance/process knowledge: a durable catalog
                (`docs/governance-process-v1.md` at B-6 closure — since
                superseded by v2, then v3; current authority:
                `docs/governance-process-v3.md`) now indexes this
                repository's existing versioned contracts
                (`docs/branch-inventory-v1.md`, `docs/evaluation-
                execution-policy-v1.md`, `docs/qa-generation-contracts-
                v1.md`) by subject/version/normative-source/executable-
                authority, and states an explicit, subject-scoped
                authority hierarchy (executable authority > versioned
                normative contract > canonical lifecycle/status
                authority > descriptive project documentation >
                historical evidence). Records, for the first time
                durably: the independent-review requirement and the
                self-approval/self-merge/self-closure prohibition
                (separation by role and turn, not by tool/human
                identity); that granting merge authorization and
                executing the merge are separate steps in separate
                turns/missions; the standard-two-parent-merge, exact-
                head, post-merge-certification-on-exact-SHA, zero-open-
                new-defect, and metadata-truth-synchronization rules
                this project already practiced but had never recorded;
                and a fail-closed conflict-handling rule (never a
                "newest wins" heuristic). Defines an atomic
                version-transition model (Case A: successor + predecessor
                supersession marker + catalog update all land in one
                reviewed PR, with the predecessor remaining canonically
                `CURRENT` on `main` until that exact PR merges; Case B:
                narrow catalog-repair exception only) with deterministic
                pre-/post-merge authority and no intermediate ambiguous
                state, plus explicit change-control categories
                (editorial, catalog synchronization, normative change,
                retirement, emergency correction). States the future
                `RAG`/`MEM` discovery-entry-point relationship without
                implementing any retrieval, embedding, persistence, or
                resolver. Docs-only: no runtime/executable/workflow/
                package change. No public-API/package change (`npm pack
                --dry-run`: 80 files, shasum
                `6edcaeae3fae5bc280d90359a623c978c4c11d44`, unchanged).

CRW2B6-R01: CLOSED   CRW2B6-R02: CLOSED   CRW2B6-R03: CLOSED
CRW2B6-R04: CLOSED   CRW2B6-R05: CLOSED   CRW2B6-R06: CLOSED
CRW2B6-R07: CLOSED   CRW2B6-R08: CLOSED   CRW2B6-R09: CLOSED
B-6: CLOSED_ON_MAIN
```

### CONFORMANCE-INTEGRATION-CHECK evidence

```text
evaluated main:       c5f7c21cb5ce25cae3649c93796a7ad6c6c3e37a
evaluated TREE:       ffe895e883f2eed33438302be3338bb81b2c8258
current-main CI:      35434036530 — PASS (event push, exact evaluated SHA)

required inputs:
B-3: CLOSED_ON_MAIN
A-2: CLOSED_ON_MAIN
B-1: CLOSED_ON_MAIN
B-4: CLOSED_ON_MAIN
B-6: CLOSED_ON_MAIN

all five closures:                               PRESERVED
cross-PR consistency:                            PASS
policy/runtime compatibility:                     PASS
package/public API:                               PASS
roadmap coherence:                                PASS
branch/workflow/evaluation/governance contracts:  AGREE
unresolved integration defect:                    ABSENT
zero-open-new-defect:                             PASS
repository mutation during check:                 NONE

CONFORMANCE-INTEGRATION-CHECK: PASS
```

This check was performed read-only — it created no branch, commit, or PR,
and found no BLOCKER/HIGH/MEDIUM/LOW/INFO integration finding. Its `PASS`
result satisfies the second half of the Architecture Conformance Gate
barrier (§6); combined with all five findings above being
`CLOSED_ON_MAIN`, the Architecture Conformance Gate became `READY`. As of
this check, Gate **execution** had not started and its own findings
(`A-1`, `A-3`, `D-2`) were all open — Gate execution subsequently began
(see [ACG-A3 closure evidence](#acg-a3-closure-evidence) below for the
current state). Nothing downstream (`AISEC`/`MEM`/`RAG`/`LEARN`) is
activated by this evidence.

### ACG-A3 closure evidence

Point-in-time evidence as of ACG-A3 certification; later changes are
annotated inline and recorded in [ACG-A1 closure
evidence](#acg-a1-closure-evidence).

```text
ACG-A3:          COMPLETE_ON_MAIN
A-3:             CLOSED_ON_MAIN

implementation PR: #171
reviewed HEAD:   44b9577933b9e620111b42a9d39ca493e6c499ff
reviewed TREE:   9579978e0d0076f71e82192e555c47cce747fd46
merge SHA:       75ebd422fa62bc00330f7f76c5b0bae42395b2b7
merge method:    standard two-parent (parent1 3376de650844b841393cbfa516ae0f5313d192f1,
                 parent2 44b9577933b9e620111b42a9d39ca493e6c499ff;
                 merge TREE == reviewed TREE)
post-merge CI:   run 35453122605 — PASS (7/7, attempt 1, exact merge SHA, event push)

architecture decision:   SEPARATE_BOUNDED_CONTEXTS
normative contract at ACG-A3 certification:
                         docs/architecture-model-boundary-v1.md (v1, CURRENT at
                         that certification; ACG-D2 proposes v2 as its Case-A
                         successor, same decision)
allowed adapter:         RequirementArtifact[] -> #22 evidence
                         (`ingestRequirementArtifactsAsEvidence`, internal)
artifact evidence profile: 4000 per projected artifact / 20000 aggregate;
                         direct-text #22B contract preserved
EvidenceRef ownership:   `buildCanonicalEvidenceBundle` (single builder)
governance process:      docs/governance-process-v2.md CURRENT at ACG-A3
                         certification (v1 SUPERSEDED;
                         ARCHITECTURE_MODEL_BOUNDARY registered); v2 has
                         since been superseded by v3 via ACG-A1
public API / package:    PRESERVED at ACG-A3 certification (19 root
                         exports; 80 files; shasum
                         `3cf3ceda0f5e51f172177e71b99143b2b825aedf`); the
                         package surface was later narrowed to 45 files by
                         ACG-A1

ACG-A3-R01: CLOSED   ACG-A3-R02: CLOSED   ACG-A3-R03: CLOSED
zero-open-new-defect: PASS

A-1: UNCHANGED / OPEN   D-2: UNCHANGED / OPEN   (as of ACG-A3 certification)
A-3: CLOSED_ON_MAIN
```

`RequirementArtifact`/`RequirementModel` and `TestDesignArtifact`/
`TestCaseModel` are separate bounded contexts and are not implicitly
interchangeable; the one explicit, opt-in, one-directional seam is
`RequirementArtifact[]` → `#22` evidence. `docs/architecture-model-boundary-v1.md`
was the normative contract at `ACG-A3` certification; `ACG-D2` carries that
unchanged decision forward in `docs/architecture-model-boundary-v2.md`. This
evidence block is a proof summary, not a duplicate of either. `A-3` is the first Gate-owned finding to close; as of this
certification the Architecture Conformance Gate was `ACTIVE` /
`IN_EXECUTION` and **not** closed (`A-1`, `D-2` open — both have since
closed; see [ACG-A1 closure evidence](#acg-a1-closure-evidence) and
[ACG-D2 closure evidence](#acg-d2-closure-evidence) for the current state).
Nothing downstream is activated by this evidence.

### ACG-A1 closure evidence

```text
ACG-A1:          COMPLETE_ON_MAIN
A-1:             CLOSED_ON_MAIN

implementation PR: #173
reviewed HEAD:   53821768bad21a4a4a90006e7f18b4dab223051b
reviewed TREE:   3917802c17b19755ae1c1c4e76835e68e86c5da2
merge SHA:       6490ebd50549320e651fe5f61a03d9df6ad7076b
merge method:    standard two-parent (parent1 4e3b8e5cac6426907ed1c65e28f2bb2ef2ccfded,
                 parent2 53821768bad21a4a4a90006e7f18b4dab223051b;
                 merge TREE == reviewed TREE)
post-merge CI:   run 35523396947 — PASS (7/7, attempt 1, exact merge SHA, event push)
post-merge supply-chain:
                 run 35523396982 — PASS (attempt 1, exact merge SHA, event push)
dependency review:
                 run 35513315088 attempt 3 — PASS (pull_request-only
                 control; Dependency Graph enabled)

architecture decision:   PRIVATE_GENERATIVE_SURFACE
normative contract at ACG-A1 certification:
                         docs/package-surface-v1.md (v1, CURRENT at that
                         certification; ACG-D2 proposes v2 as its Case-A
                         successor, same decision)
package:                 1.0.0; 45 files; 19 root exports; 5 exports keys;
                         shasum `cbbea05237a25d35df5cd026b9e58441bbcc1060`
private #22/#23:         NOT_SHIPPED
repository-only CI helpers: NOT_SHIPPED
governance process:      docs/governance-process-v3.md CURRENT
                         (v1, v2 SUPERSEDED; PACKAGE_GOVERNANCE versioned)

ACG-A1-R01: CLOSED   ACG-A1-R02: CLOSED   CRW1-D-R05: CLOSED
ACG-A1-M01: CLOSED   ACG-A1-M02: CLOSED
zero-open-new-defect: PASS

A-1: CLOSED_ON_MAIN   A-3: CLOSED_ON_MAIN   D-2: OPEN
```

The #22/#23 generative implementation is repository-private: it is not a
supported package API and is physically excluded from the npm package,
while the supported public surface remains exactly the 19 root exports and
the explicit `package.json` `exports` subpaths.
`docs/package-surface-v1.md` was the normative contract at `ACG-A1`
certification; `ACG-D2` carries the same `PRIVATE_GENERATIVE_SURFACE` decision
forward in `docs/package-surface-v2.md`. This evidence block is a proof summary,
not a duplicate of either. `R01` removed three unreachable
repository-only CI helpers from the package, `R02` made the installed-artifact
async executor proof non-vacuous, and `CRW1-D-R05` restored the Dependency
Graph so the `B-3` Dependency Review control is operational again (`B-3`
remains `CLOSED_ON_MAIN`). `A-1` is the second Gate-owned finding to close;
`D-2` was open at this certification — the repository still intentionally
contained both `scripts/ai/test-design.js` and `scripts/ai/test-design/`,
and excluding the directory from the package did not resolve that
collision. `D-2` has since closed via `ACG-D2`; see [ACG-D2 closure
evidence](#acg-d2-closure-evidence) for the current state. The Architecture
Conformance Gate was `ACTIVE` / `IN_EXECUTION` and not closed at this
certification; it has since closed -- see [Gate closure
evidence](#architecture-conformance-gate-closure-evidence) for the current
state. Nothing downstream is activated by this evidence.

### ACG-D2 closure evidence

```text
ACG-D2:          COMPLETE_ON_MAIN
D-2:             CLOSED_ON_MAIN

implementation PR: #175
reviewed HEAD:   03597c1a0aa7e54506d3c1ebef91bc038126d07c
reviewed TREE:   9ccc87e22e369c706f787c988d6bf9c13a75c17a
merge SHA:       b4602291320f5ddb7583eb5ca1dc4ff3a5031f83
merge method:    standard two-parent (parent1 7201f8b1b6b32befe945d95daea06e1c65abae57,
                 parent2 03597c1a0aa7e54506d3c1ebef91bc038126d07c;
                 merge TREE == reviewed TREE)
post-merge CI:   run 35827154067 — PASS (7/7, attempt 1, exact merge SHA, event push)
post-merge supply-chain:
                 run 35827154066 — PASS (attempt 1, exact merge SHA, event push;
                 triggered by this workflow's own package.json push path filter)
dependency review:
                 run 35618721002 attempt 1 — PASS (pull_request-only
                 control, exact pre-merge HEAD)

decision:                RENAME_PRIVATE_GENERATIVE_DIRECTORY
old private path:        scripts/ai/test-design/
new private path:        scripts/ai/generative-test-design/
deterministic RTI:       scripts/ai/test-design.js (path/identity unchanged)
ACG-A3 adapter:          scripts/ai/generative-test-design/evidence-ingestion.js
                         (`ingestRequirementArtifactsAsEvidence`; `A-3`
                         decision `SEPARATE_BOUNDED_CONTEXTS` unaffected)
package:                 1.0.0; 45 files; 19 root exports; 5 exports keys;
                         manifest path set unchanged by the rename
tarball shasum:          NON-CANONICAL / checkout-EOL-dependent (not part of
                         `PACKAGE_GOVERNANCE`) — clean-checkout examples:
                         LF `6054bb15550edd98629921494306c916b326d79e`,
                         CRLF `b0c71f4c37851606a845bdbef2d0746e373e7d5e`
package-surface:         docs/package-surface-v2.md CURRENT
                         (v1 SUPERSEDED; A1_DECISION unchanged)
architecture boundary:   docs/architecture-model-boundary-v2.md CURRENT
                         (v1 SUPERSEDED; A-3 decision unchanged)
governance process:      docs/governance-process-v3.md CURRENT
                         (PACKAGE_GOVERNANCE -> v2, ARCHITECTURE_MODEL_BOUNDARY -> v2;
                         no governance-v4)

ACG-D2-F1: CLOSED   ACG-D2-F2: CLOSED   ACG-D2-F3: CLOSED   ACG-D2-F4: CLOSED
ACG-D2-M01: CLOSED  ACG-D2-M02: CLOSED
zero-open-new-defect: PASS

A-1: CLOSED_ON_MAIN   A-3: CLOSED_ON_MAIN   D-2: CLOSED_ON_MAIN
```

The repository-level namespace collision between the deterministic RTI
module `scripts/ai/test-design.js` and the private `#22` generative
directory is resolved: the directory was renamed to
`scripts/ai/generative-test-design/`, and `require("./test-design")`
resolves unambiguously to the file. No public export, root API count,
exports-map key, or package file-membership changed; the tarball shasum
changed only because `package.json`'s `files` exclusion and, transiently
during review, `README.md`'s bytes changed — it is illustrative evidence,
not part of the governed surface. `docs/package-surface-v1.md` and
`docs/architecture-model-boundary-v1.md` are both `SUPERSEDED` by their
`v2` successors under governance-process-v3's Case A; both underlying
architectural decisions (`PRIVATE_GENERATIVE_SURFACE`, and
`SEPARATE_BOUNDED_CONTEXTS`) are unchanged — only the executable path of
the private directory moved. `D-2` is the third and final Gate-owned
finding to close; all three (`A-1`, `A-3`, `D-2`) are now
`CLOSED_ON_MAIN`. The Architecture Conformance Gate was `ACTIVE` /
`IN_EXECUTION` and not closed at this certification -- Gate closure was a
separate certification step; it has since closed -- see [Gate closure
evidence](#architecture-conformance-gate-closure-evidence) for the current
state. Nothing downstream is activated by this evidence.

### Architecture Conformance Gate closure evidence

```text
ARCHITECTURE CONFORMANCE GATE:   COMPLETE_ON_MAIN

closure certification:  APPROVED (independent Gate-level review; a
                         review-only pass against exact main
                         a5ca7ae5b1f4aee9803ed535cf5b3d180d2e25ff --
                         no repository diff)
closure authorization:  YES

Gate-owned findings:
  A-1: CLOSED_ON_MAIN  (`ACG-A1`, PR #173; see closure evidence above)
  A-3: CLOSED_ON_MAIN  (`ACG-A3`, PR #171; see closure evidence above)
  D-2: CLOSED_ON_MAIN  (`ACG-D2`, PR #175; see closure evidence above)
additional Gate-owned findings:  0
blocking architecture debt:      0

governance coherence (re-verified at Gate closure, not re-decided):
  package-surface:              v2 CURRENT (v1 SUPERSEDED)
  architecture-model-boundary:  v2 CURRENT (v1 SUPERSEDED)
  governance-process:           v3 CURRENT
  public API:                   19 root exports / 5 exports keys -- unchanged
  package:                      45 files -- unchanged
  namespace (`D-2`):             scripts/ai/test-design.js FILE;
                                 scripts/ai/test-design/ ABSENT;
                                 scripts/ai/generative-test-design/ DIRECTORY

zero-open-new-defect:  PASS

AISEC execution:   NOT_STARTED
MEM/RAG/LEARN:     NOT_STARTED
```

Per the roadmap's own [§15](#15-final-target-state) sequencing, `AISEC-1`
became the next active gate at that point. `AISEC-1` has since closed too
(see [AISEC-1 closure evidence](#aisec-1-closure-evidence) below), and
`AISEC-2` had since become the roadmap-designated next active gate;
`AISEC-2` has since closed too (see [AISEC-2 closure
evidence](#aisec-2-closure-evidence) below); `AISEC-3` had since become the
roadmap-designated next active gate and has since closed too (see [AISEC-3
closure evidence](#aisec-3-closure-evidence) below); `AISEC-4` was then designated
the next active gate, and a later owner decision inserted `GOV-AUTO-1` before it
(see [§6](#gov-auto-1--governance-pre-review-framework-next-active-gate) and [§7](#7-owner-phase-order-decision)), so `GOV-AUTO-1` became the roadmap-designated next active gate at that point --
a roadmap-level designation only (its design/reconciliation has since been
merged and post-merge certified, and its implementation remains `NOT_STARTED`;
see [GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence) below).
This closure sync performs the canonical `ROADMAP.md` state transition
for a Gate-level review already independently certified as `APPROVED` (a
review-only pass, no repository diff); it does not itself re-perform that
review, and it does not start any `AISEC`/`MEM`/`RAG`/`LEARN`
implementation. `A-1`, `A-3` and `D-2` are unchanged by this evidence.
Nothing downstream is activated by this evidence.

### AISEC-1 closure evidence

```text
AISEC-1:          COMPLETE_ON_MAIN
Artifact:         docs/agentic-threat-model-v1.md

research PR:       #178
original HEAD:     664d85607bc310ffe92ad1bd0b18f3384b6a8d08
                   (independent review: NOT APPROVED -- MEDIUM-1)
corrective C1:     0678e20ddb74077c91a6b9382159169a273f0915
                   (independent review: NOT APPROVED -- MEDIUM-2)
corrective C2:     6cf8ae57bb38ee06edc650059cd1b9ce6d1444c8
                   (independent review: APPROVED)
merge SHA:         fcb7fb54220a186c9bba0f883a8ba993624d9fb4
merge method:      standard two-parent (parent1 1c43b0b176af7d1ab2a1452be2e5e5328992d45f,
                   parent2 6cf8ae57bb38ee06edc650059cd1b9ce6d1444c8;
                   merge TREE == reviewed TREE)
post-merge CI:     run 35866042990 -- PASS (7/7, attempt 1, exact merge SHA, event push)

MEDIUM-1:          CLOSED_ON_MAIN (RTI/#22 prompt data-boundary control was
                   under-credited; corrected -- 5/5 prompt modules verified)
MEDIUM-2:          CLOSED_ON_MAIN (AT-01 risk recalibration used the wrong
                   dimension; corrected to match the AT-06 precedent)
zero-open-new-defect: PASS

AT-01 (indirect prompt injection):  MEDIUM (Likelihood Low-Med, Impact High,
                   Authority Impact Medium) -- prompt-level DATA-boundary
                   control credited; deterministic enforcement not claimed
AT-07 (approval provenance not authenticated): CRITICAL -- open system risk,
                   owned by AISEC-3/AISEC-6, not remediated by this research
AT-16 (confused deputy): MEDIUM -- open system risk, owned by AISEC-3
SEC-I1..SEC-I10:   10 security invariants defined

AISEC-2:           NOT_STARTED
AISEC-3..AISEC-7:  NOT_STARTED
MEM/RAG/LEARN:     NOT_STARTED
```

`AISEC-1` is the first stage of the Agentic Trust & Security Foundation to
close: a repository-grounded agentic threat model now exists on `main`,
independently reviewed through two corrective rounds and post-merge
certified. This is a **research and architecture-input artifact, not a
security-control implementation** -- `AISEC-1` `COMPLETE_ON_MAIN` means the
threat-model research lifecycle completed, not that any identified threat
is remediated. `AT-07` remains the highest-priority open system risk,
unchanged by this closure, owned by `AISEC-3` and `AISEC-6`. `AISEC-2`
had since become the roadmap-designated next active gate; `AISEC-2` has
since closed too (see [AISEC-2 closure evidence](#aisec-2-closure-evidence)
below). `AISEC-3` had since become the roadmap-designated next active gate
and has since closed too (see [AISEC-3 closure
evidence](#aisec-3-closure-evidence) below). `AISEC-4` was then designated the next active gate, and a later owner
decision inserted `GOV-AUTO-1` before it (see [§6](#gov-auto-1--governance-pre-review-framework-next-active-gate) and
[§7](#7-owner-phase-order-decision)), so per [§15](#15-final-target-state)
`GOV-AUTO-1` was then the roadmap-designated next active gate -- a sequencing
designation only; at that time neither `GOV-AUTO-1` nor `AISEC-4` execution had
begun (the `GOV-AUTO-1` design/reconciliation has since been merged and
post-merge certified while its implementation remains `NOT_STARTED`, and
`AISEC-4` remains `NOT_STARTED`; see [GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence) below). No runtime, public API, or package surface change accompanies this
evidence.

### AISEC-2 closure evidence

```text
AISEC-2:          COMPLETE_ON_MAIN
Artifact:         docs/prompt-indirect-injection-study-v1.md

research PR:       #180
original HEAD:     54807ba53ef4e69967c8fcb7d4cc45a0379841ee
                   (independent HEAVY review: NOT APPROVED -- LOW-1, LOW-2)
corrective C1:     f19948a337fda6ee9acea36c862b7618112150b7
                   (independent HEAVY re-review: APPROVED)
merge SHA:         37472b98f84b0edefdc55834534a0ce11f79dac3
merge method:      standard two-parent (parent1 cfb5be348f72493e1fc17146e4c7932c779654a9,
                   parent2 f19948a337fda6ee9acea36c862b7618112150b7;
                   merge TREE == reviewed TREE)
post-merge CI:     run 35881918606 -- PASS (7/7, attempt 1, exact merge SHA, event push)

LOW-1:             CLOSED_ON_MAIN (builder-count wording contradicted the
                   verified 5-to-6 population model; corrected)
LOW-2:             CLOSED_ON_MAIN (Sec.17 pointed to OQ-4 instead of OQ-1;
                   corrected)
zero-open-new-defect: PASS

model-call inventory: 7 (C1..C7) -- independently confirmed complete
prompt DATA boundaries: 6/6 builders -- independently verified
scenario catalog:  PI-01..PI-15 (15 scenarios)
behavioral fixtures: 5 (F-01..F-05) specified -- concepts and assertions
                   only, no harness implemented (AISEC-7's)

system security risks (NOT remediated by this research):
  CRITICAL: 0
  HIGH:     1  (PI-06, confirms AT-03 -- generated content re-entry)
  MEDIUM:   8
  LOW:      4
  DESIGN-TIME: 2  (PI-14/PI-15, MEM/RAG -- not implemented)

AISEC-3:           NOT_STARTED
AISEC-4..AISEC-7:  NOT_STARTED
MEM/RAG/LEARN:     NOT_STARTED
```

`AISEC-2` is the second stage of the Agentic Trust & Security Foundation to
close: a repository-grounded deep study of direct and indirect prompt
injection now exists on `main`, independently HEAVY-reviewed, corrected
once, and post-merge certified. This is a **research artifact refining**
`docs/agentic-threat-model-v1.md`, **not a security-control
implementation** -- `AISEC-2` `COMPLETE_ON_MAIN` means the study's own
lifecycle completed, not that any identified injection risk is remediated.
PI-06 (confirming AT-03, generated-content re-entry) remains this study's
highest-rated current system risk, unchanged by this closure. AT-07 and
AT-16 remain open system risks, unaffected by this closure, still owned by
`AISEC-3`/`AISEC-6`. `AISEC-3` had since become the roadmap-designated next
active gate and has since closed too (see [AISEC-3 closure
evidence](#aisec-3-closure-evidence) below). `AISEC-4` was then designated the next active gate, and a later owner
decision inserted `GOV-AUTO-1` before it (see [§6](#gov-auto-1--governance-pre-review-framework-next-active-gate) and
[§7](#7-owner-phase-order-decision)), so per [§15](#15-final-target-state)
`GOV-AUTO-1` was then the roadmap-designated next active gate -- a sequencing
designation only; at that time neither `GOV-AUTO-1` nor `AISEC-4` execution had
begun (the `GOV-AUTO-1` design/reconciliation has since been merged and
post-merge certified while its implementation remains `NOT_STARTED`, and
`AISEC-4` remains `NOT_STARTED`; see [GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence) below). No runtime, public API, or package surface change accompanies this
evidence.

### AISEC-3 closure evidence

```text
AISEC-3:          COMPLETE_ON_MAIN
Artifact:         docs/tool-privilege-credential-boundary-analysis-v1.md

research PR:       #182
original HEAD:     11bd8ce17dcd2c27cd7c506d4949eef55edbcd42
                   (independent HEAVY review: NOT APPROVED -- F-1 MEDIUM, F-2..F-5 LOW)
correctives:       C1..C10 (ten); independent HEAVY re-reviews NOT APPROVED for
                   C1..C9, then APPROVED for C10
approved HEAD:     1bd20a516ee513962d2354ac3743a4addc15123c
                   (independent HEAVY re-review: APPROVED; Senior Software
                   Developer review PASS; Security review PASS)
merge SHA:         4e008e5369681c1ebb0613a36a624b2b30b3082e
merge method:      standard two-parent (parent1 d50883256ee3b15cce9e82a733e9373a84fce8ae,
                   parent2 1bd20a516ee513962d2354ac3743a4addc15123c;
                   merge TREE == reviewed TREE 0feeff3eedb87eb319559c7e4b38be7237bbe39c)
post-merge CI:     run 36015058441 (event push, exact merge SHA) --
                   PASS_AFTER_JUSTIFIED_SAME-SHA_RERUN
                   attempt 1 FAILED: Cypress - firefox (known live-external-service
                   flake: poi_data_requests.cy.js / poiTiles timeout) and
                   Cypress - chrome (exit 1 after all 10/10 specs reported passing;
                   cause not established, not reproduced -- an unexplained CI
                   reliability observation, not attributed to the Markdown-only merge)
                   attempt 2: single failed-job-only rerun on the same merge SHA -- 7/7
                   (no rerun-until-green)

zero-open-new-defect: PASS (B0/H0/M0/L0 at the approved HEAD)

tool/component inventory: S1..S14; threat scenarios: TB-01..TB-20 (20);
open questions OQ3-1..OQ3-9; verification requirements VR-01..VR-13

system security risks (NOT remediated by this research):
  CRITICAL: 1  (TB-01, refines AT-07 -- forged approval accepted by #23F/#23G)
  HIGH:     2  (TB-12, TB-18)
  MEDIUM:   14
  LOW:      2  (+1 LOW-MED)

AISEC-4..AISEC-7:  NOT_STARTED
MEM/RAG/LEARN:     NOT_STARTED
```

`AISEC-3` is the third stage of the Agentic Trust & Security Foundation to
close: a repository-grounded analysis of the tools, privileges and credentials
of the agentic pipeline now exists on `main`, independently HEAVY-reviewed
through ten correctives and post-merge certified. This is a **research
artifact refining** `docs/agentic-threat-model-v1.md` and
`docs/prompt-indirect-injection-study-v1.md`, **not a security-control
implementation** -- `AISEC-3` `COMPLETE_ON_MAIN` means the study's own
lifecycle completed, not that any identified tool, privilege or credential
risk is remediated. TB-01 (refining AT-07) remains the highest-rated current
system risk, unchanged by this closure. The study's TB-20 High Authority
Impact rests on a documented derived inference (TB20-WF-INFERENCE) with a
stated Medium fallback; live GitHub repository settings it records are
point-in-time observations, not repository invariants. At closure time
`AISEC-4` was designated the next active gate; a later owner decision inserted
`GOV-AUTO-1` before it (see [§6](#gov-auto-1--governance-pre-review-framework-next-active-gate) and
[§7](#7-owner-phase-order-decision)), so per [§15](#15-final-target-state)
`GOV-AUTO-1` was then the roadmap-designated next active gate -- a sequencing
designation only; at that time neither `GOV-AUTO-1` nor `AISEC-4` execution had
begun (the `GOV-AUTO-1` design/reconciliation has since been merged and
post-merge certified while its implementation remains `NOT_STARTED`, and
`AISEC-4` remains `NOT_STARTED`; see [GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence) below). No runtime, public API, or package surface change accompanies this
evidence.

### GOV-AUTO-1 design/reconciliation evidence

```text
GOV-AUTO-1 DESIGN/RECONCILIATION: MERGED + POST-MERGE CERTIFIED
GOV-AUTO-1 IMPLEMENTATION:        NOT_STARTED
                                  (overall stage NOT COMPLETE_ON_MAIN)
Artifact:         docs/gov-auto-1-design-reconciliation-v1.md

design PR:         #185
approved HEAD:     3c6f99970ac92c1f98a1383237a3ed23a2ea697c
approved TREE:     f9ea9ee0d5636ecee59dfce516fcbc38ec2ed1a1
merge SHA:         4b8d9cccc325ffd2b0ce49868bf4ca7b606356af
merge method:      standard two-parent (merge TREE == approved TREE)
                   parent1 d53580f6e1cf08631f994d754c80ededda535a40
                   parent2 3c6f99970ac92c1f98a1383237a3ed23a2ea697c
pre-merge CI:      run 36102469572 (event pull_request, exact approved HEAD) --
                   attempt 1, 7/7, CLEAN_FIRST_PASS
post-merge CI:     run 36105646213 (event push, exact merge SHA) --
                   attempt 1, 7/7, CLEAN_FIRST_PASS

C7 independent re-review:  APPROVED
                   Senior Software Developer PASS; Security PASS; Governance PASS
review-chain independence: LIMITED throughout -- same-session role separation
                           (the HEAVY review chain, C7 approval included)
findings at approval:      B0 / H0 / M0 / L0; INFO 3 (non-blocking); L-11 CLOSED
zero-open-blocking-design-defect: PASS

selected relationship:     Model A -- Composition
1A owner:                  shared Git identity, diff scope, trusted base/policy context
1F owner:                  shared CI-run evidence
GOV-VERIFY-1:              tracked; not cancelled; not absorbed; owns merge-specific
                           residue only (PACK_DIFF, BRANCH_PROTECTION_STATUS,
                           merge conformance, post-merge push proof)

implementation waves (recorded; none started):
                   Wave 0  shared contracts, readiness aggregator, path/process safety
                   Wave 1  1A + 1B
                   Wave 2  1C + 1D
                   Wave 3  1E
                   Wave 4  1F
                   Wave 5  1G (independent framework validation)

AISEC-4:                       NOT_STARTED
Type & Schema Boundary Audit:  distinct future gate (not satisfied by this design)
```

`GOV-AUTO-1` design/reconciliation is the first sub-phase of the stage to close:
a repository-grounded architecture and the canonical `GOV-VERIFY-1`
reconciliation now exist on `main`, `HEAVY`-reviewed through seven correctives (C1..C7) and post-merge certified. This is a **design artifact, not an
implementation** -- the stage's own implementation lifecycle (implementation,
deterministic tests, adversarial fixtures, independent Senior Software Developer
and Security review, exact-head authorization, standard two-parent merge,
post-merge certification, canonical closure) has not begun, so `GOV-AUTO-1` is
**not** `COMPLETE_ON_MAIN`. The design defines readiness as framework attestation
only (`READY`, `HUMAN_REVIEW_REQUIRED`, `NOT_READY`): `NOT_READY` does not bar
independent human review and `READY` never authorizes a merge. The
`GOV-VERIFY-1` governance pause on overlapping implementation was to be released only when the
ROADMAP synchronization that records this evidence was itself reviewed under the required review lifecycle gate (review independence LIMITED -- same-session role separation), merged and post-merge certified -- a condition since satisfied (see
[GOV-AUTO-1 ROADMAP synchronization closure evidence](#gov-auto-1-roadmap-synchronization-closure-evidence)) -- and even then shared
Git-identity, diff-scope and CI-evidence facts must come from the `1A`/`1F`
interfaces. Review-chain independence was LIMITED throughout -- the `HEAVY` review chain, including the C7 approval, used same-session role separation -- and is recorded as such; the three INFO findings were non-blocking.
The future whole-project Type & Schema Boundary Audit remains a separate gate,
and `AISEC-4` remains `NOT_STARTED`. No runtime, public API or package surface
change accompanies this evidence.

### GOV-AUTO-1 ROADMAP synchronization closure evidence

```text
GOV-AUTO-1 ROADMAP SYNC:           CERTIFIED_ON_MAIN
GOV-AUTO-1 IMPLEMENTATION:         NOT_STARTED
WAVE 0:                            NOT_STARTED  (now the next governed step)

sync PR:           #186   (merged 2026-09-25T09:07:57Z)
authorized HEAD:   b01e3c19f80053f35218988a05d0f28ed0397234
authorized TREE:   d65e78d711c96e63752982225a044d23f6e2b646
merge SHA:         27d5d165c3dff6cc773ae71e9f47fd32d8a14288
merge method:      standard two-parent (merge TREE == authorized TREE)
                   parent1 4b8d9cccc325ffd2b0ce49868bf4ca7b606356af
                   parent2 b01e3c19f80053f35218988a05d0f28ed0397234
pre-merge CI:      run 36110787947 (event pull_request, exact authorized HEAD) --
                   attempt 1, 7/7, CLEAN_FIRST_PASS
post-merge CI:     run 36116727398 (event push, exact merge SHA) --
                   attempt 1, 7/7, CLEAN_FIRST_PASS

final review:      APPROVED (class LIGHT); LOW-1 CLOSED by corrective C1
findings at approval: B0 / H0 / M0 / L0 / INFO0
review independence:  LIMITED -- same-session role separation
merge authorization:  ratified by the project owner (this applies to merge
                      authorization, not to review independence)

GOV-VERIFY-1 design-reconciliation governance pause:  SATISFIED
                   duplicate shared implementation: still NOT allowed
                   shared facts come from the 1A / 1F interfaces; where they do
                   not yet exist the overlap is a technical dependency;
                   merge-specific residue stays GOV-VERIFY-1-owned
AISEC-4:                       NOT_STARTED
Type & Schema Boundary Audit:  distinct future gate
```

The two conditions the roadmap waited on -- the synchronization recording the
`GOV-AUTO-1` design being reviewed under the required review lifecycle gate (review independence LIMITED -- same-session role separation), merged and post-merge certified,
and the live `ROADMAP.md` being re-read -- are now satisfied by `PR #186` and its
post-merge push run. This is a factual closure-evidence update only: it changes no
architecture, ownership, readiness semantics or stage order, does not start
`Wave 0` or any `GOV-AUTO-1` or `GOV-VERIFY-1` implementation, does not mark
`GOV-AUTO-1` `COMPLETE_ON_MAIN`, and does not activate `AISEC-4`. The release of
the design-reconciliation pause is not permission to reimplement facts owned by
`1A`/`1F`.

## 9. AISEC — Agentic Trust / AI Security Foundation

```text
AISEC technical entry: APPROVED
  (the RTI Integrated Audit found no BLOCKER/HIGH/unresolved-MEDIUM
  finding that would block AISEC; RTI is no longer a technical blocker)

AISEC execution: AISEC-1 COMPLETE_ON_MAIN (research); AISEC-2 COMPLETE_ON_MAIN (research); AISEC-3 COMPLETE_ON_MAIN (research); AISEC-4..AISEC-7 NOT_STARTED
  (was intentionally delayed by governance sequencing until Conformance
  Remediation and the Architecture Conformance Gate ran first, per §7's
  owner decision -- both have since completed. `AISEC-1` -- Agentic Threat
  Model Research -- is now closed on `main`; see [AISEC-1 closure
  evidence](#aisec-1-closure-evidence) in §8. `AISEC-2` -- Prompt /
  Indirect Injection Study -- is now also closed on `main`; see [AISEC-2
  closure evidence](#aisec-2-closure-evidence) in §8. `AISEC-3` -- Tool /
  Privilege / Credential Boundary Analysis -- is now also closed on `main`;
  see [AISEC-3 closure evidence](#aisec-3-closure-evidence) in §8. Per §15,
  `GOV-AUTO-1` (inserted before `AISEC-4` by a later owner decision, §7) is now the roadmap-designated next active gate, followed by `AISEC-4`; its design/reconciliation is merged and post-merge certified (see §8) but neither `GOV-AUTO-1` implementation nor `AISEC-4` execution has yet begun)
```

This distinction is load-bearing: **RTI does not block AISEC. Governance
sequencing does, on purpose.** A future reader must not conclude "AISEC was
blocked by RTI after `ca9bfa0`" — it was not; the project chose to run
conformance remediation first.

```text
AISEC-1  Agentic Threat Model Research                    COMPLETE_ON_MAIN
AISEC-2  Prompt / Indirect Injection Study                COMPLETE_ON_MAIN
AISEC-3  Tool / Privilege / Credential Boundary Analysis   COMPLETE_ON_MAIN
AISEC-4  Data Exfiltration & Cross-Project Isolation       NOT_STARTED
AISEC-5  Agentic Security Verification Strategy            NOT_STARTED
AISEC-6  Security Architecture Decision Record             NOT_STARTED
AISEC-7  Adversarial Security Test Harness                 NOT_STARTED
```

`AISEC-1` closed via `docs/agentic-threat-model-v1.md`; see [AISEC-1
closure evidence](#aisec-1-closure-evidence) in §8. `AISEC-2` closed via
`docs/prompt-indirect-injection-study-v1.md`; see [AISEC-2 closure
evidence](#aisec-2-closure-evidence) in §8. `AISEC-3` closed via
`docs/tool-privilege-credential-boundary-analysis-v1.md`; see [AISEC-3
closure evidence](#aisec-3-closure-evidence) in §8. `AISEC-4` through
`AISEC-7` remain `NOT_STARTED`.

`GOV-AUTO-1` ([§6](#gov-auto-1--governance-pre-review-framework-next-active-gate)) is not an AISEC stage: by owner decision (§7) it is
sequenced after `AISEC-3` and before `AISEC-4`, and `AISEC-4`'s own scope is
unchanged.

**Research lane (early-start exception).** Per the [subsequent owner
decision — Early AISEC/MEM Research
Parallelism](#7-owner-phase-order-decision) recorded in §7, `AISEC-1`,
`AISEC-2`, and `AISEC-6` only may begin as `DRAFT`/`PROVISIONAL`/`OFF-MAIN`
research while the parallel conformance tracks (§6/§8) are still being
implemented. They may not merge into `main` before the Architecture
Conformance Gate closes, and any conclusions reached remain provisional and
subject to mandatory post-Gate revalidation — see §7 for the full
assumptions/freeze-boundary/merge-barrier rules. `AISEC-3`, `AISEC-4`,
`AISEC-5`, and `AISEC-7` receive **no** early-start permission; they remain
blocked until the Gate closes, same as `AISEC` execution generally. This
research lane is separate from, and must not be confused with, the mainline
critical path in [§8](#8-current-critical-path).

## 10. MEM — Agentic Memory Foundation

```text
MEM:   NOT_STARTED
RAG:   NOT_STARTED
LEARN: NOT_STARTED
```

This section covers three related, but **not synonymous**, future
architecture layers: persistent agentic memory (`MEM`), trusted
project-scoped retrieval (`RAG`, [§10.1](#101-rag--trusted-retrieval--knowledge-grounding)),
and feedback-driven continuous learning (`LEARN`, [§10.2](#102-learn--feedback--continuous-learning)).
None of the three exists in this codebase today. Nothing in this
section — including every stage list below — is implemented, proven,
or scheduled to begin ahead of `CRW1-D` (see [§8](#8-current-critical-path)).

### Concept separation

These five terms are related but distinct. Conflating them is itself a
governance risk this section exists to prevent:

- **RAG** — what external or project knowledge is *retrieved into
  runtime context* for a given task. Read-time, request-scoped.
- **Memory** — what information *may persist across runs*, and under
  what trust/provenance rules. Write-time and persistence-scoped;
  governs what RAG is even allowed to index or retrieve from.
- **Feedback** — evidence about whether a specific agent decision or
  output was correct or useful. An observation about one outcome, not
  itself a promotion into memory or training data.
- **Training Dataset** — a separately governed collection of verified,
  eligible examples that *may* become eligible for model adaptation.
  Distinct from both memory and raw feedback.
- **Fine-Tuning** — optional modification of model behavior using an
  approved training dataset. Never a substitute for RAG freshness or
  for memory's provenance model; never required for RAG or Memory to
  be considered complete.

**Required invariant:** `RAG data != Memory authority != Training
data`. The following pipeline is explicitly **prohibited** and must
never be implemented implicitly:

```text
AI output  →  automatically trusted memory  →  automatically training data
```

The required conceptual flow is instead:

```text
AI / runtime output
  → candidate record
  → provenance
  → deterministic/policy validation
  → verification / outcome
  → trust classification
  → eligible memory and/or dataset path
```

No content is autonomously promoted from "AI produced it" to "trusted"
at any point in this flow.

### Security / trust invariants

These govern `MEM`, `RAG`, and `LEARN` alike:

1. Untrusted external content never becomes trusted memory
   automatically.
2. Untrusted external content never becomes training data
   automatically.
3. RAG retrieval never bypasses project scope.
4. Similarity score never overrides authorization/trust hard filters.
5. Memory poisoning is a security concern, not merely a
   relevance-quality concern.
6. Training-data poisoning is controlled independently from memory
   poisoning.
7. Human or deterministic verification is required for any record
   entering a high-trust learning path.
8. Fine-tuning never becomes a substitute for RAG freshness.
9. RAG never becomes a substitute for authorization.
10. Cross-project retrieval is prohibited by default.
11. Evaluation data and training data must remain distinguishable at
    all times.
12. Model-adaptation rollout must be reversible.

### MEM-1 .. MEM-9 — memory stage list

```text
MEM-1  Agentic Memory Use-Case Research
MEM-2  Memory Taxonomy & Trust Model
MEM-3  Memory Persistence Architecture
MEM-4  Memory Poisoning Threat Analysis
MEM-5  Provenance / Integrity / Expiration
MEM-6  Cross-Project Memory Isolation
MEM-7  Retrieval / Relevance / Contamination Tests
MEM-8  Minimal Memory Proof
MEM-9  Independent Memory Security Review
```

All: `NOT_STARTED`.

**Sequencing** (per the [subsequent owner decision](#7-owner-phase-order-decision)):
`MEM-1..MEM-6` (the foundation stage — use-case research through
cross-project isolation) establish memory's trust model *before* any
retrieval system is allowed to read from it. `RAG-1..RAG-12`
([§10.1](#101-rag--trusted-retrieval--knowledge-grounding)) then
implements the controlled retrieval layer over that trustworthy,
project-scoped knowledge. `MEM-7..MEM-9` (the integrated verification
stage) run *after* `RAG` exists, because retrieval/relevance/
contamination tests, the minimal memory proof, and the independent
memory security review all validate integrated retrieval/memory
behavior that cannot be meaningfully exercised before a retrieval
layer exists to exercise it. This ordering is an intentional
architectural decision, not accidental renumbering — the `MEM-1..MEM-9`
numbering itself is unchanged from its original definition.

Persistent autonomous agentic memory does not exist in this codebase today,
and must not be implemented before AISEC's own security architecture exists —
`AISEC → MEM`, never the reverse.

**Research lane (early-start exception).** Per the [subsequent owner
decision — Early AISEC/MEM Research
Parallelism](#7-owner-phase-order-decision) recorded in §7, `MEM-1` and
`MEM-2` only may begin as `DRAFT`/`PROVISIONAL`/`OFF-MAIN` research while
the parallel conformance tracks (§6/§8) are still being implemented. They
may not merge into `main` before the Architecture Conformance Gate closes,
and any provisional taxonomy/trust-model conclusions remain subject to
mandatory post-Gate revalidation. `MEM-3` through `MEM-9` receive **no**
early-start permission and remain blocked until the Gate closes, same as
`MEM` generally — the research exception does not move persistence,
poisoning-analysis, or verification work earlier.

### 10.1 RAG — Trusted Retrieval & Knowledge Grounding

```text
RAG: NOT_STARTED
```

**Purpose:** provide project-scoped, provenance-aware, trust-filtered
retrieval of relevant QA/project knowledge without modifying
base-model weights.

```text
RAG-1   Knowledge Source Inventory
RAG-2   Canonical Document / Chunk Contract
RAG-3   Metadata & Provenance Model
RAG-4   Embedding Provider Abstraction
RAG-5   Vector Store Abstraction
RAG-6   Project-Scoped Retrieval
RAG-7   Hybrid Search
RAG-8   Reranking
RAG-9   Trust / Freshness / Conflict Filters
RAG-10  Retrieval Evaluation
RAG-11  Poisoning / Cross-Project Isolation Tests
RAG-12  Minimal Production Proof
```

All: `NOT_STARTED`. Do not claim implemented, proof-complete, or
production-ready; do not claim a vector database or embedding provider
has been selected — this roadmap update is planning only.

Key outcomes each stage is expected to establish, once actually
undertaken:

- **RAG-1** identifies supported knowledge-source classes (repository
  documents, requirements, test artifacts, CI/test execution history,
  verified historical QA knowledge, approved governance/security
  knowledge) and explicitly classifies each as trusted, conditionally
  trusted, untrusted, or forbidden-to-index.
- **RAG-2**/**RAG-3** define a normalized retrievable unit (id,
  content, source type, `projectId`, source reference, version, chunk
  identity, parent-document identity, timestamps) with enough
  provenance metadata (provenance, trust, verification, version,
  `createdAt`/`updatedAt`/`expiresAt`, supersession, framework, tags,
  integrity metadata) for deterministic filtering — no
  embedding-provider-specific domain semantics.
- **RAG-4**/**RAG-5** put the embedding implementation and the vector
  store behind generic provider/adapter contracts (no provider-name
  branching in generic core, no credentials in config files,
  caller/env-owned credentials) so a specific vendor is never committed
  to at roadmap level.
- **RAG-6** requires the current `ProjectProfile.id` to scope every
  retrieval — no implicit cross-project retrieval.
- **RAG-7**/**RAG-8** combine lexical and vector retrieval (hard
  filters → lexical → vector → merge → rerank), preferring
  deterministic/inspectable reranking first; any later LLM reranking
  must not silently override trust boundaries. Fixed scoring
  coefficients are not mandated at roadmap level — implementation must
  be evidence-driven.
- **RAG-9** filters candidates by project scope, trust tier,
  verification status, version, expiry, supersession, framework
  compatibility, and source quality, and must detect (not silently
  resolve by picking stale content) conflicting knowledge.
- **RAG-10** defines measurable retrieval-quality evaluation (e.g.
  Recall@K, Precision@K, MRR/ranking quality, relevance, irrelevant-
  retrieval rate, stale-retrieval rate, cross-project contamination
  rate — exact metrics may be refined during implementation).
- **RAG-11** requires adversarial tests (malicious repository text,
  malicious requirement content, poisoned historical memory,
  prompt-injection-bearing chunks, cross-project retrieval,
  credential/context leakage, stale superseded knowledge) that must
  fail closed.
- **RAG-12** is a small controlled proof — verified project knowledge
  indexed, scoped retrieval, trust filtering, grounded runtime context
  — with no autonomous trust escalation, no cross-project
  contamination, and no automatic training-data promotion.

**Trusted knowledge flow:**

```text
source
  → normalization
  → provenance
  → trust classification
  → chunk/document contract
  → index
  → hard project/trust filters
  → retrieval
  → reranking
  → conflict/staleness checks
  → grounded runtime context
```

The model must receive retrieved knowledge as context/evidence, not as
hidden authority.

**Retrieval evaluation principle:** retrieval quality must be measured
separately from generation quality. A successful generation cannot
hide irrelevant retrieval, stale retrieval, cross-project retrieval, or
poisoned retrieval — this separation is load-bearing, not optional.

### 10.2 LEARN — Feedback & Continuous Learning

```text
LEARN:       NOT_STARTED
Fine-tuning: OPTIONAL
```

**Objective:** allow QA Agent performance to improve over time using
verified outcomes, without treating raw AI output as truth.

```text
LEARN-1  Feedback Event Contract
LEARN-2  Outcome / Reward Model
LEARN-3  Training Dataset Builder
LEARN-4  Quality / Deduplication / Contamination Filters
LEARN-5  Baseline Evaluation Set
LEARN-6  Fine-Tuning Experiment (OPTIONAL EXPERIMENT)
LEARN-7  Champion vs Challenger Evaluation
LEARN-8  Regression / Safety Gate
LEARN-9  Controlled Rollout
```

All: `NOT_STARTED`. Do not claim any model is currently trained,
adapted, or "continuously learning" today unless independent
repository evidence proves it — no such evidence currently exists.

Key outcomes each stage is expected to establish, once actually
undertaken:

- **LEARN-1** defines structured feedback events (accepted, rejected,
  corrected, partially accepted, confirmed root cause, successful fix,
  false positive, false negative, human override).
- **LEARN-2** defines how actual task outcome is represented (e.g.
  test case accepted, automation generated successfully, root cause
  confirmed, fix resolved failure, recommendation rejected, regression
  introduced, human correction required) — not necessarily reduced to
  one opaque scalar unless later justified.
- **LEARN-3** builds a training dataset only from eligible, verified
  records, kept auditable and reproducible, and explicitly separate
  from runtime memory and evaluation data.
- **LEARN-4** requires deduplication, near-duplicate detection, label
  quality, provenance, PII/secrets exclusion, customer-data-boundary
  enforcement, cross-project isolation, AI-self-output-contamination
  detection, and stale/version filtering.
- **LEARN-5** creates frozen evaluation sets (quality, safety,
  regression, project isolation, hallucination resistance, QA-domain
  behavior) *before* any model adaptation; training examples must not
  silently leak into evaluation sets.
- **LEARN-6** — `OPTIONAL EXPERIMENT`. Fine-tuning is not required for
  RAG or Memory completion, and only begins once a verified dataset, an
  evaluation baseline, a training-eligibility policy, and passing
  security/privacy gates all exist. Its purpose is behavioral
  adaptation, not project memory.
- **LEARN-7** compares the current production/baseline model against
  an adapted challenger, preferring blinded/frozen evaluation, with no
  automatic promotion.
- **LEARN-8** requires the challenger to demonstrate no critical
  safety regression, no project-isolation regression, no grounding
  regression, and no QA-quality regression beyond an accepted
  threshold — failure means do not deploy.
- **LEARN-9** is a bounded deployment of an adapted model only after
  passing evaluation, with rollback, version identity, observability,
  evaluation provenance, and controlled scope. No autonomous continuous
  weight updates in production.

**Feedback flow:**

```text
runtime task
  → model/agent output
  → deterministic or human outcome
  → feedback event
  → validation
  → trusted feedback record
  → optional memory candidate
  → optional training-dataset eligibility
```

Memory eligibility and training eligibility are separate decisions —
one record reaching a "trusted feedback record" does not automatically
grant either.

**Evaluation principle:** no adapted model is deployable solely
because training completed. The required chain is: dataset eligibility
→ frozen baseline evaluation → adaptation experiment → challenger
evaluation → regression/safety gate → controlled rollout. No automatic
production promotion at any point in that chain.

**Terminology:** prefer "model adaptation", "optional fine-tuning
experiment", and "controlled model rollout" over vague terms like
"self-learning" or "AI learns by itself" unless such a term is
explicitly defined elsewhere first.

**Data governance:** any future training eligibility must exclude or
explicitly govern secrets, credentials, PII, private customer data,
restricted project data, and unverified external content. This file
does not invent specific retention periods; detailed policies belong
to the future `AISEC`/`MEM`/`LEARN` design stages themselves.

## 11. Full Project Strict Audit

```text
NOT_STARTED
```

Comes after AISEC, MEM, RAG, and LEARN foundations are all established —
not to be confused with the RTI Integrated Audit (a narrower,
RTI-subsystem-scoped audit, already `PASS WITH DEFERRED DEBT`). The
Full Project Strict Audit is a distinct, broader, later gate. Its
scope, once active, explicitly includes (in addition to whatever else
is in scope at that time):

- RAG trust boundaries
- retrieval isolation (project scoping, cross-project contamination)
- memory provenance
- feedback integrity
- training dataset governance
- evaluation contamination (training/evaluation separation)
- optional fine-tuning safety
- rollout/rollback controls for any adapted model

Recording this scope now does not start the audit; it remains
`NOT_STARTED`.

## 12. Productization

```text
NOT_STARTED / DEFERRED
```

`ID-3` planning is complete; implementation (formal version policy,
production release tags, npm-registry-publication decision, consumer install
guidance, rollback/version lifecycle, a CLI/convenience surface, reusable CI
integration) has not begun. Proven **architectural independence** and proven
**installability** (`ID-2`, `ACQ-UPG`) are explicitly not the same claim as
**formal release maturity** — see README's own "Package Maturity vs.
Architectural Independence" section for the full distinction.

## 13. Future domain expansion

```text
API:                    planned future capability, deferred
Performance / Load:      planned future capability, deferred
Database / Integration:  planned future capability, deferred
```

Not prerequisites for AISEC execution under the [owner decision](#7-owner-phase-order-decision)
recorded above. Relevant future prerequisites when these domains are
activated:

- **`D-1`** — evaluation architecture scalability, required before
  evaluation expansion would otherwise multiply version-specific code.
- **`D-3`** — controlled SUT, required before serious API/PERF negative/load
  testing against controlled targets.

## 14. Conformance architecture findings

`CRW1-A` **recorded** the Architecture Conformance Gate; it did not resolve
any of the following. Current state: `A-1` `CLOSED_ON_MAIN`, `A-2`
`CLOSED_ON_MAIN`, `A-3` `CLOSED_ON_MAIN`, `D-2` `CLOSED_ON_MAIN`. `A-2` (a
Conformance Remediation Wave 2 finding), `A-3` (the first Gate-owned
finding to close, via `ACG-A3`) and `A-1` (the second, via `ACG-A1`) are
retained here for historical continuity — see below:

- **`A-1` — `CLOSED_ON_MAIN`** — the exact public/installable product
  surface for #22/#23 is now explicitly decided as
  `PRIVATE_GENERATIVE_SURFACE`: the #22/#23 generative implementation is
  repository-private, is not a supported package API, and is physically
  excluded from the npm package (`scripts/ai/generation/`,
  `scripts/ai/test-design/`, `scripts/ai/test-automation/`, plus three
  unreachable repository-only CI helpers). The supported public surface
  remains exactly the existing 19 root exports and the explicit
  `package.json` `exports` subpaths. Normative contract:
  [`docs/package-surface-v2.md`](docs/package-surface-v2.md); `ACG-A1`
  (PR #173) is merged and post-merge certified — see
  [§8](#8-current-critical-path)'s [closure
  evidence](#acg-a1-closure-evidence) for the authoritative record.
- **`A-2` — `CLOSED_ON_MAIN`** — evaluation/regression merge-blocking policy
  is formally specified by
  [`docs/evaluation-execution-policy-v1.md`](docs/evaluation-execution-policy-v1.md)
  and enforced by a single runtime authority
  (`scripts/ai/evaluation/execution-policy.js`): `v1`-`v5` are `INFORMATIONAL`
  (report `REGRESSED` truthfully, never block — a deliberate, evidenced
  decision, not an unaddressed default), `v6` is `STRICT` (only an exact
  match to its reviewed baseline exits 0). `CRW2-A2` (PR #162) is merged and
  post-merge certified — see [§8](#8-current-critical-path)'s
  [closure evidence](#crw2-a2-closure-evidence) for the authoritative
  record. This bullet is retained here only because this section
  historically enumerated `A-2` alongside the then-still-open
  architecture-level decisions (`A-1`, `A-3`, `D-2`) below — it is not
  itself an open architecture gate.
- **`A-3` — `CLOSED_ON_MAIN`** — the relationship between the #22/#23
  generative pipeline's own `RequirementModel`/`TestCaseModel` and RTI's
  deterministic `RequirementArtifact`/`TestDesignArtifact` is now
  explicitly decided as `SEPARATE_BOUNDED_CONTEXTS`, with one explicit,
  opt-in, one-directional seam: `RequirementArtifact[]` → `#22` evidence.
  `RequirementArtifact`/`RequirementModel` and `TestDesignArtifact`/
  `TestCaseModel` are not implicitly interchangeable. Normative contract:
  [`docs/architecture-model-boundary-v2.md`](docs/architecture-model-boundary-v2.md);
  `ACG-A3` (PR #171) is merged and post-merge certified — see [§8](#8-current-critical-path)'s
  [closure evidence](#acg-a3-closure-evidence) for the authoritative
  record. Any earlier "one generic core" language elsewhere describes
  RTI's own internal core only, not a claim that the two model families
  are unified.
- **`D-2` — `CLOSED_ON_MAIN`** — the `scripts/ai/test-design.js` vs.
  `scripts/ai/test-design/` naming collision between the RTI and #22/#23
  pipelines is resolved by renaming the private generative directory to
  `scripts/ai/generative-test-design/`, which no longer shares a base name
  with the deterministic `scripts/ai/test-design.js`. Normative contract:
  [`docs/package-surface-v2.md`](docs/package-surface-v2.md); `ACG-D2`
  (PR #175) is merged and post-merge certified — see
  [§8](#8-current-critical-path)'s [closure
  evidence](#acg-d2-closure-evidence) for the authoritative record.

## 15. Final target state

`CRW1` → `CRW2` → the Architecture Conformance Gate have all now closed
(see [Gate closure evidence](#architecture-conformance-gate-closure-evidence)
in §8); `AISEC-1` has since closed too (see [AISEC-1 closure
evidence](#aisec-1-closure-evidence) in §8), and so have `AISEC-2` (see
[AISEC-2 closure evidence](#aisec-2-closure-evidence) in §8) and `AISEC-3`
(see [AISEC-3 closure evidence](#aisec-3-closure-evidence) in §8); `GOV-AUTO-1`
is now the next active gate (inserted before `AISEC-4`; see [§7](#7-owner-phase-order-decision)) -- a roadmap-level designation, not a claim that `GOV-AUTO-1` implementation or
`AISEC-4` execution has begun (both remain `NOT_STARTED`; the `GOV-AUTO-1`
design/reconciliation is merged and post-merge certified -- see [GOV-AUTO-1 design/reconciliation evidence](#gov-auto-1-designreconciliation-evidence) --
and `GOV-AUTO-1` implementation still precedes `AISEC-4`, with Wave 0 now the next
governed implementation step -- the ROADMAP synchronization recording that design
has been reviewed under the required review lifecycle gate (review independence LIMITED -- same-session role separation), merged and post-merge certified (see [GOV-AUTO-1 ROADMAP synchronization closure evidence](#gov-auto-1-roadmap-synchronization-closure-evidence)) --
though Wave 0 remains `NOT_STARTED`; see
[§6](#gov-auto-1--governance-pre-review-framework-next-active-gate) and
[§9](#9-aisec--agentic-trust--ai-security-foundation)).
This file will be updated at each transition;
`README.md`'s own roadmap section will continue to carry the detailed
technical evidence for whatever completes.

**Target architecture, including the layers recorded by this update**
(conceptual — not a claim that any of these layers are implemented;
see [§9](#9-aisec--agentic-trust--ai-security-foundation) and
[§10](#10-mem--agentic-memory-foundation) for current status of each):

```text
QA AI Agent Core
 |
 |- RTI Layer
 |   -> Requirements Sources
 |   -> Quality
 |   -> Test Design
 |   -> Traceability
 |   -> Destinations
 |
 |- Agentic Trust & Security
 |   -> threat model
 |   -> identity / authorization
 |   -> policy
 |   -> adversarial evaluation
 |
 |- Memory Layer
 |   -> scoped, provenance-aware persistent memory
 |
 |- Retrieval / RAG Layer
 |   -> source normalization
 |   -> indexing
 |   -> project-scoped retrieval
 |   -> trust/freshness filters
 |   -> reranking
 |
 |- Feedback / Learning Layer
 |   -> verified outcomes
 |   -> feedback records
 |   -> dataset eligibility
 |   -> evaluation
 |   -> optional model adaptation
 |
 |- Functional UI Domain
 |- API / Performance / Data / Security Testing domains
 |- Governance Profiles
 `- UI Control Plane + CLI/API/Library
```

This target state adds **trusted, project-grounded retrieval**,
**provenance-aware memory**, a **verified feedback loop**, and
**optional, controlled model adaptation** to the previously recorded
target — with runtime knowledge (RAG) architecturally separated from
weight adaptation (fine-tuning) throughout, per [§10](#10-mem--agentic-memory-foundation)'s
concept separation. It does not change any historical completion claim
recorded elsewhere in this file.

## 16. Historical roadmap provenance

This is the first version of this file. Prior to its creation, roadmap and
status information lived entirely in `README.md`'s own "Roadmap RTI" section
and roadmap-closure-state block, which remain the authoritative historical
record for every RTI-1 through RTI-8 stage, corrective, review, and merge —
see README.md directly for that full history. This file does not replace or
duplicate that history; it establishes the current-and-forward canonical
sequence going forward.
