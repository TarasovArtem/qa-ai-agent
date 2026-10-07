# Controlled v1 Release Model — Product Owner Decision v1

Decision ID: `OD-CONTROLLED-V1-RELEASE-MODEL`

Status: **APPROVED / FINAL PRODUCT STRATEGY DECISION**

Decision date: **2026-10-07**

Decision owner: **Product Owner**

Corrective: `D-CONTROLLED-V1-PR220-C1 — APPROVED` (release-gate completeness, finding-disposition semantics, governance ordering and Release Contract provenance; the product strategy is unchanged)

Repository baseline at decision recording:

```text
repository: TarasovArtem/qa-ai-agent
main:       9148d71c1c586b61c771754ccb3986490e57e4c6
tree:       136e1fe990f09eab90ea8435189fb80c94c52466
```

This document records the Product Owner's final decision on the product delivery model. It settles the strategic question of whether the first releasable product must wait for MEM/RAG/LEARN and the full-autonomy program. It must not be reopened as an undecided product question unless the Product Owner explicitly revokes or replaces this decision.

## 1. Final decision

QA AI Agent is delivered in **two product stages**.

### Stage 1 — QA AI Agent v1.0 Controlled Agent Release

The first releasable product is a controlled QA agent with explicit human authorization at authority-escalation boundaries.

The target user-visible chain is:

```text
Requirement
→ Requirements ingestion
→ Requirements analysis
→ Test Design / Test Cases
→ Automation Plan
→ AI-generated Cypress/Playwright automation
→ Human approval
→ Safe application
→ Controlled execution
→ PASS / FAIL
→ Evidence / report
```

The first product-validation environment is the independent minimal external consumer project `qa-agent-demo`.

The Controlled Release must demonstrate the chain through a **supported external product surface**. Direct sibling-repository imports, private deep imports, or other demo-only bypasses do not satisfy the release contract.

### Stage 2 — Full Autonomy Program

After Controlled v1.0 is released and validated, development continues toward the target autonomous architecture, including MEM, RAG, LEARN and higher-authority operation.

The retained autonomy sequence is:

```text
MEM-1 .. MEM-6
→ RAG-1 .. RAG-12
→ MEM-7 .. MEM-9
→ LEARN-1 .. LEARN-9
→ Full Project Strict Audit
→ Full-Autonomy productization / release
```

The internal order of MEM/RAG/LEARN is not changed by this decision.

## 2. What is NOT a prerequisite for Controlled v1.0

The following capabilities are explicitly **not prerequisites** for the first Controlled Agent Release:

- MEM / persistent agent memory;
- RAG / retrieval-augmented knowledge layer;
- LEARN / continuous-learning or model-adaptation program;
- Full Project Strict Audit whose scope includes MEM/RAG/LEARN/autonomy-wide controls;
- autonomous repository merge/publish authority;
- unrestricted autonomous filesystem/repository mutation;
- cross-project autonomous operation;
- autonomous reduction/removal of the required human approval boundaries;
- optional model fine-tuning;
- Docker/Kubernetes as a mandatory user-facing product requirement.

Deferral from Controlled v1.0 does **not** cancel these capabilities. They remain part of the Full Autonomy Program.

## 3. Mandatory prerequisites for Controlled v1.0

This decision does not waive security, governance or release readiness. Controlled v1.0 may be released only after the release-specific prerequisite set is satisfied.

Mandatory prerequisites are:

1. **AISEC-7 — Adversarial Security Test Harness** completes its required lifecycle for the Controlled v1.0 verification scope. That scope is bound to the capabilities actually enabled in Controlled v1.0, the applicable SADR-11 release dossier (§3.1), the applicable ODR/FI/FV requirements, and the applicable open security findings and restricted/disabled capabilities. AISEC-7 verification is not a substitute for missing implementation: a blocked, unavailable or unimplemented target control cannot become PASS merely because a harness exists. AISEC-7 does not satisfy the Type & Schema Boundary Audit.
2. **Type & Schema Boundary Audit** completes as a distinct repository-wide gate. It is not absorbed by AISEC-7 and is not satisfied by documentation alone.
3. Open security findings applicable to capabilities enabled in Controlled v1.0 remain release blockers until their required canonical disposition is satisfied. For such a finding, release eligibility requires either (A) an implementation/corrective fix **plus** independent verification, or (B) only where the finding's canonical disposition permits it, a separately **demonstrated and independently verified** trusted/provenance-bound fail-closed supported-surface contract. A Product Owner statement alone does not demonstrate the technical contract. Applicability to the enabled scope matters; this does not convert every open finding into a global release blocker.
4. The human approval path used by Controlled v1.0 satisfies the canonical approval/presentation/security requirements, including all applicable return triggers and approval-authenticity requirements.
5. Generated-change application preserves the approved-bytes == applied-bytes invariant and all associated package/input binding requirements.
6. Controlled execution uses an explicitly supported, independently assessed execution environment. A Linux/isolated-runner-first v1.0 is acceptable; Windows generated-code execution is not implicitly supported merely because the controller can be launched from Windows.
7. The repository-private `#22/#23` generative implementation is exposed to external consumers only through a separately designed, versioned, reviewed and compatibility-tested **high-level supported product surface**. Private deep imports remain prohibited.
8. Controlled-v1 release productization is completed: version/install/upgrade policy, supported package/API or CLI surface, consumer guidance, rollback lifecycle, and the minimal reusable integration required by the approved Release Contract.
9. `qa-agent-demo` proves the external installed-consumer chain end-to-end under the supported surface and supported execution environment.
10. Release evidence, CI, independent review, exact identity, merge topology and post-merge certification remain governed by the repository's existing lifecycle rules.
11. The applicable AISEC-6 / SADR-11 capability-specific Controlled Release dossier (§3.1) is completed for every capability enabled in Controlled v1.0.

### 3.1 Capability-specific Controlled Release dossier (AISEC-6 / SADR-11)

Controlled v1.0 requires completion of the applicable capability-specific Controlled Release dossier defined by the AISEC-6 Security Architecture Decision Record (`docs/security-architecture-decision-record-v1.md` §15 and SADR-11) for every capability enabled in Controlled v1.0. Where applicable to the enabled scope, the dossier covers:

1. the exact enabled capability inventory;
2. the exact distribution and supported entrypoint inventory;
3. the API / CLI / UI / workflow / package / import / replay surfaces;
4. authenticated human/platform/invocation/project/repository binding;
5. provider/source/destination/account/credential grant evidence;
6. data audience, diagnostic, retention, persistence and sink dispositions;
7. cross-project isolation evidence for both the permitted case and the denied/foreign-project case;
8. verified disabled-path evidence for capabilities excluded from Controlled v1.0, including alternate supported entrypoints (§6);
9. applicable `ODR-01`..`ODR-09` dispositions;
10. applicable `FI-01`..`FI-11` implementation dependencies;
11. applicable `FV-01`..`FV-11` independent verification requirements;
12. exact finding/disposition applicability;
13. independent release dossier evidence;
14. a separate Product Owner release grant for the exact enabled scope.

Applicability is capability-specific: ODR/FI/FV items not applicable to the enabled Controlled v1.0 scope are not required to be globally complete for Controlled v1.0. The AISEC-6 decisions are target architecture; architecture definition is not remediation, implementation or verification. Recording this prerequisite does not activate any ODR disposition, FI implementation or FV verification work.

## 4. Release Contract boundary

Controlled v1.0 remains bound to the approved Release Contract capabilities:

```text
RC-01 External installation
RC-02 Requirements ingestion
RC-03 Requirements analysis
RC-04 Test-case / test-design generation
RC-05 Automation planning
RC-06 E2E automation generation
RC-07 Human approval
RC-08 Controlled execution
RC-09 Reporting / evidence
RC-10 Repeatability
RC-11 Security / governance readiness
RC-12 Versioned release / install / upgrade
```

A demo that stops at Test Design does not satisfy the intended Controlled v1.0 product-validation objective.

Release Contract provenance: RC-01..RC-12 are the Product Owner-approved working release baseline (Release Contract v1.0, approved by the Product Owner on 2026-10-01; governance provenance Issues #198 and #199). The complete normative acceptance text of the Release Contract is not currently a tracked canonical repository artifact. Before RC-01..RC-12 can be used as final release-certification evidence, the normative acceptance contract must be placed under governed, canonical, versioned evidence and independently reviewed. This does not reopen or invalidate RC-01..RC-12 and adds no acceptance criteria.

## 5. Product architecture principles

Controlled v1.0 and all later releases preserve the following product principles:

- **opt-in** — a target repository/team chooses whether to use QA AI Agent;
- **removable** — removing QA AI Agent must not require rebuilding the target repository architecture;
- **minimally invasive** — target repositories receive only the integration required for selected capabilities;
- **external core** — product core remains outside the target repository where practical;
- **declarative integration** — configuration/enablement is explicit and bounded;
- **team-controlled autonomy** — the target team controls enabled capabilities and authority level.

The intended integration shape is:

```text
qa-agent-demo / target repository
        ↓ minimal supported integration
QA AI Agent supported product surface
        ↓
private internal implementation
```

The following shape is not an accepted release architecture:

```text
target repository
        ↓
unsupported deep import into qa-ai-agent private internals
```

## 6. Security and finding preservation

This decision is a sequencing/product-boundary decision, **not risk acceptance**.

It does not close, re-rate or waive any `AT-*`, `PI-*`, `TB-*`, `XI-*`, RP, SVR or other security finding.

In particular:

- open findings applicable to a capability enabled in Controlled v1.0 remain release blockers until their required canonical disposition is satisfied (§3 prerequisite 3); applicability to the enabled scope matters;
- findings associated only with a capability excluded from or disabled in Controlled v1.0 may be deferred only under an explicit fail-closed deferral contract and return trigger, and only if the disablement/inaccessibility is independently evidenced across all relevant supported and alternate entrypoints — where they exist as supported or distributed surfaces: API, CLI, UI, workflow, package/export, import, replay, direct supported consumer path and any other documented supported surface. An owner decision or feature label alone is insufficient. Evidence is not required for surfaces that do not exist; it is required for every actual supported or distributed surface;
- `XI-01` and `XI-02` remain `OPEN / MEDIUM / UNCHANGED`, with the existing owner disposition `IMPLEMENTATION_REQUIRED_BEFORE_CONTROLLED_RELEASE_WHEN_AFFECTED_CAPABILITY_ENABLED`, which any successor finding retains: implementation **plus** independent verification is required before the affected capability is enabled for Controlled Release. Until then the affected capability/path must remain disabled, or be constrained by a separately demonstrated trusted/provenance-bound input contract that is independently verified where the applicable release-evidence boundary requires it. This decision is not XI remediation, closure, re-rating, waiver or risk acceptance;
- approval authenticity, trusted reviewer presentation, credential isolation, project binding and execution authority remain distinct security concerns even when other findings on the same path are closed.

## 7. Governance and WIP

`WIP = 1` remains mandatory.

The two-stage product model does not authorize parallel engineering streams and does not weaken exact-head review, independent review, Product Owner authorization, standard two-parent merge, or fresh post-merge push-event certification.

Review approval remains distinct from merge authorization. Merge remains distinct from canonical closure.

## 8. Canonical sequencing decision

The prior product-release implication that Controlled v1.0 must wait for the entire MEM/RAG/LEARN program and the autonomy-wide Full Project Strict Audit is superseded by this Product Owner decision.

The intended canonical product sequence is now:

```text
GOV-AUTO-1                         COMPLETE_ON_MAIN
→ AISEC-4                         COMPLETE_ON_MAIN (research/design)
→ AISEC-5                         COMPLETE_ON_MAIN (research/design)
→ AISEC-6                         COMPLETE_ON_MAIN (research/design)
→ AISEC-7                         required before Controlled v1.0
→ Type & Schema Boundary Audit    required before Controlled v1.0
→ Controlled-v1 release blockers / required remediations
→ Controlled-v1 package/API/CLI/productization boundary
→ qa-agent-demo external E2E validation
→ QA AI Agent v1.0 Controlled Agent Release
→ MEM-1 .. MEM-6
→ RAG-1 .. RAG-12
→ MEM-7 .. MEM-9
→ LEARN-1 .. LEARN-9
→ Full Project Strict Audit
→ Full Autonomy productization / release
```

The exact implementation decomposition of the Controlled-v1 release-readiness work remains governed by PM-P0/release issues and later authorized implementation slices. This decision fixes the **ordering and product boundary**, not every implementation detail. The "Controlled-v1 release blockers / required remediations" stage includes the applicable §3 prerequisite 3 finding dispositions and the applicable §3.1 dossier work; the governance ordering of the steps immediately following this decision is fixed in §9.

## 9. Canonical synchronization requirement

`ROADMAP.md` remains the repository's canonical sequence source. Therefore this decision requires a separately reviewed canonical ROADMAP synchronization that records the sequence above and removes present-tense wording that still implies MEM/RAG/LEARN are prerequisites for Controlled v1.0.

Until that synchronization is merged and post-merge certified, the repository contains an intentional temporary distinction:

- this document records the **final Product Owner decision**;
- the existing `ROADMAP.md` still records the previous canonical sequence and must not be represented as already synchronized.

No engineering stage may exploit that temporary mismatch to bypass either set of safety requirements. The next governance action after certified completion of this decision record is the ROADMAP synchronization lifecycle (Issue #221).

The Product Owner has fixed the governance ordering (`D-CONTROLLED-V1-PR220-C1 — APPROVED`) as:

```text
PR #220 certified completion
→ Issue #221 canonical ROADMAP synchronization (merged + post-merge certified + canonically closed)
→ AISEC-7 activation
→ Type & Schema Boundary Audit
→ applicable Controlled-v1 release blockers / remediation
→ Controlled-v1 productization
→ qa-agent-demo external E2E validation
→ Controlled Release (separate Product Owner release grant)
```

Under `WIP = 1` these steps are strictly serial. AISEC-7 must not be activated, and no AISEC-7 repository mutation may occur, in parallel with the Issue #221 lifecycle.

`OD-AISEC-7-START — PRE-AUTHORIZED` (Issue #222) remains in force and is not revoked. `D-CONTROLLED-V1-PR220-C1 — APPROVED` adds one activation prerequisite: the Issue #221 canonical ROADMAP synchronization must first be merged, post-merge certified and canonically closed. After that certified canonical closure, no additional Product Owner AISEC-7 start authorization is required, provided all other Issue #222 activation prerequisites still hold and AISEC-7 remains the canonical next security stage. Until then AISEC-7 is `PRE-AUTHORIZED / NOT ACTIVATED`. This document does not start Issue #221 or activate AISEC-7.

## 10. Reopening rule

The two-stage product strategy is **settled**.

Do not return to the question "must Controlled v1.0 wait for MEM/RAG/LEARN?" during routine planning, review or implementation. The answer is **NO**.

Reopening the decision requires an explicit new Product Owner decision that identifies this Decision ID and states that it is being revoked or superseded. A reviewer finding, implementation difficulty, schedule change or security issue may block a capability or release; it does not silently revert the product strategy to the old single-sequence model.

## 11. What this decision does not authorize

This document does not by itself:

- activate AISEC-7;
- start Issue #221;
- start the Type & Schema Boundary Audit;
- activate any ODR disposition, FI implementation or FV verification work;
- remediate, close, re-rate, waive or accept risk for any finding;
- start package/public-API implementation;
- change `package.json` exports/files;
- enable a private #22/#23 deep import;
- approve Controlled v1.0 for release;
- authorize a merge of this or any later PR;
- waive independent review;
- activate MEM/RAG/LEARN;
- grant autonomous merge/publish authority.

Those remain separate lifecycle actions under WIP=1 and the repository governance contract.
