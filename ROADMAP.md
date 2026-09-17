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
`CRW1-B`) and `B-2` (closed by `CRW1-C`) are `CLOSED_ON_MAIN`. Five findings —
`B-3` (`CRW1-D`) and `A-2`/`B-1`/`B-4`/`B-6` (`CRW2`) — are `READY`,
authorized to begin in parallel per the model below, and all remain **open**.
The Architecture Conformance Gate has not started; its own findings (`A-1`,
`A-3`, `D-2`) remain **open**. `D-1` and `D-3` remain explicitly
**DEFERRED**. This paragraph is updated as each finding's own closure
evidence lands — it is not itself a slice-status line subject to the
ACTIVE-lifecycle exemption defined in [§8](#8-current-critical-path).

### Parallel execution model

```text
Execution mode:             PARALLEL AUTHORIZED (owner decision — see §7's
                             "Parallelized Conformance Execution")
Architecture Gate barrier:  waits for all five findings CLOSED_ON_MAIN
                             AND a passing CONFORMANCE-INTEGRATION-CHECK
```

```text
                               +-- CRW1-D / B-3 ------+
                               +-- CRW2-A2 / A-2 -----+
ROADMAP-V3.3-SYNC certified ---+-- CRW2-B1 / B-1 -----+--> CONFORMANCE-INTEGRATION-CHECK
                               +-- CRW2-B4 / B-4 -----+                |
                               +-- CRW2-B6 / B-6 -----+                v
                                                          Architecture Conformance Gate
```

`CRW2` is a **grouping label, not one implementation unit**. `CRW2-A2`
(`A-2`), `CRW2-B1` (`B-1`), `CRW2-B4` (`B-4`), and `CRW2-B6` (`B-6`) are four
independently implemented findings, each with its own branch, PR, primary
finding ownership, review, merge, and post-merge certification. No artificial
order exists among the five tracks (`CRW1-D`, `CRW2-A2`, `CRW2-B1`,
`CRW2-B4`, `CRW2-B6`) unless an actual dependency or semantic overlap is
discovered between two of them.

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
| `CRW1-D` | `B-3` | `READY` | TBD (actual diff decides) | none declared |
| `CRW2-A2` | `A-2` | `READY` | TBD (actual diff decides) | none declared |
| `CRW2-B1` | `B-1` | `READY` | TBD (actual diff decides) | none declared |
| `CRW2-B4` | `B-4` | `READY` | TBD (actual diff decides) | none declared |
| `CRW2-B6` | `B-6` | `READY` | TBD (actual diff decides) | none declared |

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
  **Assumptions** section stating at minimum: `A-1` unresolved, `A-3`
  unresolved, `D-2` unresolved, Architecture Conformance Gate not closed —
  plus its own provisional conclusions, and an explicit statement that those
  conclusions "must be revalidated after Architecture Gate: YES".
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

## 8. Current critical path

```text
CRW1-A (COMPLETE_ON_MAIN)  →  CRW1-B (COMPLETE_ON_MAIN)  →  CRW1-C (COMPLETE_ON_MAIN)
  →  {  CRW1-D / B-3,  CRW2-A2 / A-2,  CRW2-B1 / B-1,  CRW2-B4 / B-4,  CRW2-B6 / B-6  }  (PARALLEL)
  →  CONFORMANCE-INTEGRATION-CHECK
  →  Architecture Conformance Gate
  →  AISEC-1 .. AISEC-7
  →  MEM-1 .. MEM-6
  →  RAG-1 .. RAG-12
  →  MEM-7 .. MEM-9
  →  LEARN-1 .. LEARN-9
  →  Full Project Strict Audit
  →  Productization
```

This is the canonical future sequence following the [subsequent owner
decision](#7-owner-phase-order-decision) recorded in §7. The five tracks in
`{ }` are authorized to execute **in parallel** (see §6's "Parallel execution
model" for the mandatory safety controls) — this replaces the previously
strictly-serial `CRW1-D → CRW2` framing. `CONFORMANCE-INTEGRATION-CHECK` is a
mandatory synchronization barrier, not an optional formality: the
Architecture Conformance Gate does not become `READY` merely because all
five PRs merged. Nothing from `AISEC` onward is active, except the narrow,
explicitly-provisional early-research exception also recorded in §7 (early
`AISEC-1`/`AISEC-2`/`AISEC-6`/`MEM-1`/`MEM-2` research, off-`main`, not
merge-authorized before the Gate). See [§10](#10-mem--agentic-memory-foundation)
for the `MEM`/`RAG`/`LEARN` stage detail and why `RAG` sits between
`MEM-6` and `MEM-7`.

**Slice lifecycle status semantics.** This project's governance already
defines a slice's lifecycle as: implementation → independent exact-head
review → merge → post-merge truth proof. A slice is **ACTIVE** from the
start of implementation until its post-merge truth proof completes. This
definition is stated once, here, and governs the status line below — so that
line does not need to be rewritten merely because a PR opens, is reviewed,
or merges.

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

**Current parallel tracks — all `READY`, none `ACTIVE`** (technically
unblocked by `CRW1-C`'s closure; per the [subsequent owner
decision](#7-owner-phase-order-decision) recorded in §7, all five may begin
implementation independently and concurrently — see the `READY` definition
in [§2](#2-status-vocabulary) and §6's "Current parallel track status" table
for the live per-track state):

```text
CRW1-D   (B-3 — Supply-Chain Monitoring)                            READY
CRW2-A2  (A-2 — Strict evaluation/regression blocking semantics)    READY
CRW2-B1  (B-1 — Versioned branch inventory)                         READY
CRW2-B4  (B-4 — Fail-closed test-infrastructure verification)       READY
CRW2-B6  (B-6 — Versioned governance/process knowledge)             READY
```

All five findings (`B-3`, `A-2`, `B-1`, `B-4`, `B-6`) remain **open** — a
track is `READY` (authorized/unblocked) only, and becomes `ACTIVE` only once
its own implementation actually begins, per the slice-lifecycle definition
above; `READY` is not itself a claim that any implementation has started.
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

## 9. AISEC — Agentic Trust / AI Security Foundation

```text
AISEC technical entry: APPROVED
  (the RTI Integrated Audit found no BLOCKER/HIGH/unresolved-MEDIUM
  finding that would block AISEC; RTI is no longer a technical blocker)

AISEC execution: NOT_STARTED
  (intentionally delayed by governance sequencing — Conformance Remediation
  and the Architecture Conformance Gate run first, per §7's owner decision)
```

This distinction is load-bearing: **RTI does not block AISEC. Governance
sequencing does, on purpose.** A future reader must not conclude "AISEC was
blocked by RTI after `ca9bfa0`" — it was not; the project chose to run
conformance remediation first.

```text
AISEC-1  Agentic Threat Model Research
AISEC-2  Prompt / Indirect Injection Study
AISEC-3  Tool / Privilege / Credential Boundary Analysis
AISEC-4  Data Exfiltration & Cross-Project Isolation
AISEC-5  Agentic Security Verification Strategy
AISEC-6  Security Architecture Decision Record
AISEC-7  Adversarial Security Test Harness
```

All: `NOT_STARTED`.

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

## 14. Open conformance architecture gates (not decided here)

`CRW1-A` **records** the Architecture Conformance Gate; it does not resolve
any of the following. Each remains explicitly open:

- **`A-1`** — the exact public/installable product surface for #22/#23 is
  not yet decided. The current package public surface remains exactly what
  `package.json`'s `exports`/`files` actually expose today (19 root exports;
  see README) — this file does not imply #22/#23 are, or are not, part of
  that surface.
- **`A-2`** — whether all evaluation/regression dimensions strictly block
  merges is not yet formally decided/enforced; do not read any current
  wording elsewhere as already guaranteeing this.
- **`A-3`** — the relationship between the #22/#23 generative pipeline's own
  `RequirementModel`/`TestCaseModel` and RTI's deterministic
  `RequirementArtifact`/`TestDesignArtifact` is not yet decided (unify,
  adapt, or explicitly keep as separate bounded contexts). Any existing
  "one generic core" language elsewhere should be read as describing RTI's
  own internal core only, not as a resolved claim about #22/#23's
  relationship to it.
- **`D-2`** — the `scripts/ai/test-design.js` vs. `scripts/ai/test-design/`
  naming collision between the RTI and #22/#23 pipelines is not yet resolved
  or explicitly documented as intentional.

## 15. Final target state

Once `CRW1` → `CRW2` → the Architecture Conformance Gate all close, `AISEC-1`
becomes the next active gate. This file will be updated at each transition;
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
