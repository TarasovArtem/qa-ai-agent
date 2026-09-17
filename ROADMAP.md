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

Only `CRW1-A`'s five findings (`C-1`, `C-2`, `C-3`, `C-4`, `A-4`) are
addressed by the current documentation-truth-sync work. Every other finding
listed above (`A-1`, `A-2`, `A-3`, `B-1` through `B-6`, `D-1` through `D-3`)
remains **open**, explicitly carried here, not implemented, and not
implied-complete by this update.

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

## 8. Current critical path

```text
CRW1-A (COMPLETE_ON_MAIN)  →  CRW1-B (COMPLETE_ON_MAIN)  →  CRW1-C  →  CRW1-D
  →  CRW2
  →  Architecture Conformance Gate
  →  AISEC-1 .. AISEC-7
  →  MEM-1 .. MEM-9
  →  Full Project Strict Audit
  →  Productization
```

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

**Current slice: `CRW1-C` — `ACTIVE`** (per the definition above: true
during implementation, during independent review, immediately after merge,
and until post-merge truth proof completes). `CRW1-C` closes `B-2` —
repository governance metadata: a durable PR template, bug-report and
feature-request issue forms, and issue-template configuration
(`.github/pull_request_template.md`, `.github/ISSUE_TEMPLATE/`).
`CODEOWNERS` is intentionally omitted — this is a solo-maintainer
repository (one collaborator with admin access; branch protection's
`require_code_owner_reviews` and `required_approving_review_count` are
both unset), matching README's own already-documented solo-maintainer
governance profile (`SG1`); revisit if multiple maintainers, distinct
ownership domains, or code-owner review enforcement are ever introduced.
`B-2` itself remains open until `CRW1-C`'s post-merge truth proof lands.
Historical lower-level
critical paths (`CS6`, `CS7`, "RTI implementation", "RTI Integrated Audit
READY") describe *past* states of this project and remain accurate as
history in README's own roadmap-by-roadmap record — they are not the
current critical path and must not be read as such.

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

## 10. MEM — Agentic Memory Foundation

```text
MEM: NOT_STARTED
```

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

Persistent autonomous agentic memory does not exist in this codebase today,
and must not be implemented before AISEC's own security architecture exists —
`AISEC → MEM`, never the reverse.

## 11. Full Project Strict Audit

```text
NOT_STARTED
```

Comes after AISEC and MEM foundations are established — not to be confused
with the RTI Integrated Audit (a narrower, RTI-subsystem-scoped audit,
already `PASS WITH DEFERRED DEBT`). The Full Project Strict Audit is a
distinct, broader, later gate.

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

## 16. Historical roadmap provenance

This is the first version of this file. Prior to its creation, roadmap and
status information lived entirely in `README.md`'s own "Roadmap RTI" section
and roadmap-closure-state block, which remain the authoritative historical
record for every RTI-1 through RTI-8 stage, corrective, review, and merge —
see README.md directly for that full history. This file does not replace or
duplicate that history; it establishes the current-and-forward canonical
sequence going forward.
