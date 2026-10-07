# Controlled v1 Release Model — Product Owner Decision v1

Decision ID: `OD-CONTROLLED-V1-RELEASE-MODEL`

Status: **APPROVED / FINAL PRODUCT STRATEGY DECISION**

Decision date: **2026-10-07**

Decision owner: **Product Owner**

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

1. **AISEC-7 — Adversarial Security Test Harness** completes its required lifecycle for the Controlled v1.0 security claims.
2. **Type & Schema Boundary Audit** completes as a distinct repository-wide gate. It is not absorbed by AISEC-7 and is not satisfied by documentation alone.
3. All confirmed release-blocking findings affecting capabilities enabled in Controlled v1.0 are fixed, independently verified, or constrained by an explicit fail-closed supported-surface contract accepted through the required Product Owner/security disposition.
4. The human approval path used by Controlled v1.0 satisfies the canonical approval/presentation/security requirements, including all applicable return triggers and approval-authenticity requirements.
5. Generated-change application preserves the approved-bytes == applied-bytes invariant and all associated package/input binding requirements.
6. Controlled execution uses an explicitly supported, independently assessed execution environment. A Linux/isolated-runner-first v1.0 is acceptable; Windows generated-code execution is not implicitly supported merely because the controller can be launched from Windows.
7. The repository-private `#22/#23` generative implementation is exposed to external consumers only through a separately designed, versioned, reviewed and compatibility-tested **high-level supported product surface**. Private deep imports remain prohibited.
8. Controlled-v1 release productization is completed: version/install/upgrade policy, supported package/API or CLI surface, consumer guidance, rollback lifecycle, and the minimal reusable integration required by the approved Release Contract.
9. `qa-agent-demo` proves the external installed-consumer chain end-to-end under the supported surface and supported execution environment.
10. Release evidence, CI, independent review, exact identity, merge topology and post-merge certification remain governed by the repository's existing lifecycle rules.

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

- open findings that affect a capability enabled in Controlled v1.0 remain release blockers until their required disposition is satisfied;
- findings associated only with a capability that remains disabled may be deferred only under an explicit fail-closed deferral contract and return trigger;
- `XI-01` / `XI-02` and any successor finding retain their existing requirement: implementation/verification is required before the affected capability is enabled for Controlled Release;
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

The exact implementation decomposition of the Controlled-v1 release-readiness work remains governed by PM-P0/release issues and later authorized implementation slices. This decision fixes the **ordering and product boundary**, not every implementation detail.

## 9. Canonical synchronization requirement

`ROADMAP.md` remains the repository's canonical sequence source. Therefore this decision requires a separately reviewed canonical ROADMAP synchronization that records the sequence above and removes present-tense wording that still implies MEM/RAG/LEARN are prerequisites for Controlled v1.0.

Until that synchronization is merged and post-merge certified, the repository contains an intentional temporary distinction:

- this document records the **final Product Owner decision**;
- the existing `ROADMAP.md` still records the previous canonical sequence and must not be represented as already synchronized.

No engineering stage may exploit that temporary mismatch to bypass either set of safety requirements. The next governance action is the ROADMAP synchronization lifecycle.

## 10. Reopening rule

The two-stage product strategy is **settled**.

Do not return to the question "must Controlled v1.0 wait for MEM/RAG/LEARN?" during routine planning, review or implementation. The answer is **NO**.

Reopening the decision requires an explicit new Product Owner decision that identifies this Decision ID and states that it is being revoked or superseded. A reviewer finding, implementation difficulty, schedule change or security issue may block a capability or release; it does not silently revert the product strategy to the old single-sequence model.

## 11. What this decision does not authorize

This document does not by itself:

- activate AISEC-7;
- start the Type & Schema Boundary Audit;
- start package/public-API implementation;
- change `package.json` exports/files;
- enable a private #22/#23 deep import;
- approve Controlled v1.0 for release;
- authorize a merge of this or any later PR;
- waive independent review;
- activate MEM/RAG/LEARN;
- grant autonomous merge/publish authority.

Those remain separate lifecycle actions under WIP=1 and the repository governance contract.
