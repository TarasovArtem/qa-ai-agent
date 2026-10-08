# QA AI Agent Documentation

This directory contains the version-controlled technical, security, governance, audit, and contract documentation for QA AI Agent.

The root [`README.md`](../README.md) is intentionally a short project landing page. This file is the navigation layer for deeper documentation.

## Documentation authority

When documents overlap, use the document that owns the relevant contract rather than treating this index as normative.

- [`ROADMAP.md`](../ROADMAP.md) — canonical lifecycle/status and historical delivery record.
- [`SECURITY.md`](../SECURITY.md) — authoritative operational security boundaries and limitations.
- [`PROVIDERS.md`](../PROVIDERS.md) — provider-facing integration and behavior contracts.
- [`PUBLISHING.md`](../PUBLISHING.md) — publishing/destination integration contracts.
- versioned files under `docs/` — architecture decisions, audits, research, governance designs, and assurance evidence for the scope stated by each document.

If a future GitHub Wiki is introduced, it should be treated as a human-friendly tutorial/onboarding layer, not as the canonical source for architecture, security, governance, or lifecycle evidence.

---

## Start here

### Project and system overview

- [`../README.md`](../README.md) — project summary, capabilities, maturity snapshot, architecture-at-a-glance, and development commands.
- [`system-overview.md`](system-overview.md) — technical overview of the reactive failure-triage and generative test-design/test-automation paths.
- [`../ROADMAP.md`](../ROADMAP.md) — exact delivery history and current lifecycle state.

### Security and trust model

- [`../SECURITY.md`](../SECURITY.md) — operational security model and known boundaries.
- [`agentic-threat-model-v1.md`](agentic-threat-model-v1.md) — agentic threat model.
- [`agentic-security-verification-strategy-v1.md`](agentic-security-verification-strategy-v1.md) — security verification strategy.
- [`security-architecture-decision-record-v1.md`](security-architecture-decision-record-v1.md) — security architecture decisions.
- [`aisec-7-adversarial-security-test-harness-v1.md`](aisec-7-adversarial-security-test-harness-v1.md) — adversarial security test-harness design/evidence.
- [`prompt-indirect-injection-study-v1.md`](prompt-indirect-injection-study-v1.md) — prompt/indirect-injection research.
- [`data-exfiltration-cross-project-isolation-v1.md`](data-exfiltration-cross-project-isolation-v1.md) — data-exfiltration and cross-project isolation analysis.
- [`tool-privilege-credential-boundary-analysis-v1.md`](tool-privilege-credential-boundary-analysis-v1.md) — tool privilege and credential boundary analysis.
- [`type-schema-boundary-audit-v1.md`](type-schema-boundary-audit-v1.md) — repository-wide type/schema/trust-boundary audit.

### Architecture and contracts

- [`architecture-model-boundary-v2.md`](architecture-model-boundary-v2.md) — current versioned architecture/model-boundary documentation.
- [`architecture-model-boundary-v1.md`](architecture-model-boundary-v1.md) — earlier version retained for historical evidence.
- [`qa-generation-contracts-v1.md`](qa-generation-contracts-v1.md) — QA generation contract definitions.
- [`package-surface-v2.md`](package-surface-v2.md) — current versioned package/public-surface documentation.
- [`package-surface-v1.md`](package-surface-v1.md) — earlier package-surface record retained for historical evidence.
- [`../PROVIDERS.md`](../PROVIDERS.md) — provider integration contracts.
- [`../PUBLISHING.md`](../PUBLISHING.md) — publishing/destination contracts.

### Governance and release

- [`governance-process-v3.md`](governance-process-v3.md) — current versioned governance-process documentation.
- [`governance-process-v2.md`](governance-process-v2.md) — previous governance-process version.
- [`governance-process-v1.md`](governance-process-v1.md) — initial governance-process version.
- [`gov-auto-1-design-reconciliation-v1.md`](gov-auto-1-design-reconciliation-v1.md) — GOV-AUTO-1 design/reconciliation record.
- [`controlled-v1-release-model-owner-decision-v1.md`](controlled-v1-release-model-owner-decision-v1.md) — controlled-v1 release-model owner decision.
- [`branch-inventory-v1.md`](branch-inventory-v1.md) — branch inventory evidence for its recorded scope/time.

### Evaluation and quality evidence

- [`evaluation-execution-policy-v1.md`](evaluation-execution-policy-v1.md) — evaluation execution policy.
- [`../TEST_CASES.md`](../TEST_CASES.md) — repository test-case documentation.

---

## Documentation map by question

| Question | Read first |
|---|---|
| What is QA AI Agent? | [`../README.md`](../README.md) |
| How do the main runtime paths fit together? | [`system-overview.md`](system-overview.md) |
| What is complete or currently in progress? | [`../ROADMAP.md`](../ROADMAP.md) |
| What authority does the AI have? | [`../SECURITY.md`](../SECURITY.md) |
| What threats were considered? | [`agentic-threat-model-v1.md`](agentic-threat-model-v1.md) |
| How is agentic security verified? | [`agentic-security-verification-strategy-v1.md`](agentic-security-verification-strategy-v1.md) |
| Where are trust/schema boundaries audited? | [`type-schema-boundary-audit-v1.md`](type-schema-boundary-audit-v1.md) |
| What is the package/public API boundary? | [`package-surface-v2.md`](package-surface-v2.md) |
| What contracts govern generated QA artifacts? | [`qa-generation-contracts-v1.md`](qa-generation-contracts-v1.md) |
| How are providers integrated? | [`../PROVIDERS.md`](../PROVIDERS.md) |
| How are outputs published externally? | [`../PUBLISHING.md`](../PUBLISHING.md) |
| What governance process is used? | [`governance-process-v3.md`](governance-process-v3.md) |
| What is the controlled-v1 release model? | [`controlled-v1-release-model-owner-decision-v1.md`](controlled-v1-release-model-owner-decision-v1.md) |

## Versioned-document policy

Several documents intentionally exist as `v1`, `v2`, or `v3`. Older versions are not automatically obsolete historical clutter: they may be required as lifecycle evidence for the state that was reviewed at that time.

Therefore this documentation refactor does **not** rename, delete, merge, or move existing versioned records. New navigation should point readers to the latest applicable version while keeping prior versions available for evidence and auditability.

## What belongs in the root README

The root README should remain useful to a first-time reader and should contain only:

- what the project is;
- why it exists;
- major capabilities;
- a short maturity snapshot;
- one high-level architecture view;
- essential local-development commands;
- important limitations;
- links to deeper documentation.

Detailed implementation mechanics, roadmap chronology, trust-boundary proofs, audit findings, exact stage histories, and long contract descriptions should live in their owning documentation rather than expanding the landing page.

## What may belong in a future Wiki

A Wiki can be useful for material that prioritizes discoverability and learning over version-bound normative evidence, for example:

- step-by-step demo walkthroughs;
- onboarding guides;
- FAQs;
- screenshots and videos;
- common troubleshooting;
- conceptual explanations for non-engineering readers.

The Wiki should link back to repository documents whenever an authoritative contract or lifecycle claim is involved.
