# QA AI Agent Documentation

This directory contains the version-controlled technical, security, governance, audit, contract, and completed-track evidence documentation for QA AI Agent.

The root [`README.md`](../README.md) is a concise project landing page **and the governance-compatible authoritative entry point/index for completed-track engineering evidence**. This file is a navigation layer; it does not replace the authority assigned by `ROADMAP.md` or the current governance-process record.

## Documentation authority

When documents overlap, use the document that owns the relevant contract/state. This index is descriptive, not a new competing authority model.

- [`ROADMAP.md`](../ROADMAP.md) — canonical current lifecycle/status/sequence and durable delivery-state record.
- [`README.md`](../README.md) — project landing page plus authoritative entry point/index for completed-track detailed engineering evidence.
- [`engineering-history-v1.md`](engineering-history-v1.md) — compact completed-track evidence index incorporated by the README evidence index; it routes to the frozen archive for detailed evidence.
- [`engineering-history-archive-v1.md`](engineering-history-archive-v1.md) — frozen, byte-identical pre-refactor detailed historical evidence archive (the detailed completed-track evidence body formerly embedded in the root README).
- [`SECURITY.md`](../SECURITY.md) — authoritative operational security boundaries, including the Mock/Groq/Gemini AI-provider boundary and known limitations.
- [`PROVIDERS.md`](../PROVIDERS.md) — RTI-7 **Requirements Source Provider** authoring contract; this is not the Mock/Groq/Gemini AI-provider contract.
- [`PUBLISHING.md`](../PUBLISHING.md) — RTI-8 Test Design Destination/publishing contract.
- [`repository-evidence-retention-policy-v1.md`](repository-evidence-retention-policy-v1.md) — normative repository evidence/branch-retention policy, relocated from the pre-DOC-REF-1 README without semantic change.
- other versioned files under `docs/` — scoped architecture decisions, audits, research, governance designs, assurance evidence, and historical records according to each document's own scope/status.

If a future GitHub Wiki is introduced, it **must not** be authoritative for architecture, security, governance, public contracts, lifecycle evidence/status, or release state. It may provide tutorial/onboarding material that links back to version-controlled repository sources.

---

## Start here

### Project, system, and completed-track evidence

- [`../README.md`](../README.md) — project summary, capabilities, maturity snapshot, architecture-at-a-glance, essential commands, limitations, and stable evidence-entry anchors.
- [`system-overview.md`](system-overview.md) — current technical orientation to the reactive failure-triage and generative test-design/test-automation paths.
- [`engineering-history-v1.md`](engineering-history-v1.md) — compact completed-track evidence index.
- [`engineering-history-archive-v1.md`](engineering-history-archive-v1.md) — frozen detailed historical evidence archive, preserved byte-for-byte from the pre-refactor root README.
- [`../ROADMAP.md`](../ROADMAP.md) — exact current lifecycle/status/sequence and delivery-state history.

### Security and trust model

- [`../SECURITY.md`](../SECURITY.md) — operational security model, Mock/Groq/Gemini AI-provider boundary, credentials/rollout boundaries, and known limitations.
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
- [`../PROVIDERS.md`](../PROVIDERS.md) — RTI-7 requirements-source provider contract (Jira/Azure DevOps adapters and future adapter obligations).
- [`../PUBLISHING.md`](../PUBLISHING.md) — RTI-8 publishing/destination contract.

### Governance and release

- [`governance-process-v3.md`](governance-process-v3.md) — current versioned governance-process documentation.
- [`repository-evidence-retention-policy-v1.md`](repository-evidence-retention-policy-v1.md) — normative evidence/branch-retention policy.
- [`governance-process-v2.md`](governance-process-v2.md) — previous governance-process version.
- [`governance-process-v1.md`](governance-process-v1.md) — initial governance-process version.
- [`gov-auto-1-design-reconciliation-v1.md`](gov-auto-1-design-reconciliation-v1.md) — GOV-AUTO-1 design/reconciliation record.
- [`controlled-v1-release-model-owner-decision-v1.md`](controlled-v1-release-model-owner-decision-v1.md) — controlled-v1 release-model owner decision.
- [`branch-inventory-v1.md`](branch-inventory-v1.md) — branch inventory evidence for its recorded scope/time.

### Evaluation and quality evidence

- [`evaluation-execution-policy-v1.md`](evaluation-execution-policy-v1.md) — evaluation execution policy; v1–v5 and v6 protect different subjects.
- [`../TEST_CASES.md`](../TEST_CASES.md) — repository test-case documentation.

---

## Documentation map by question

| Question | Read first |
|---|---|
| What is QA AI Agent? | [`../README.md`](../README.md) |
| How do the main runtime paths fit together? | [`system-overview.md`](system-overview.md) |
| Where is completed-track detailed engineering evidence? | [`../README.md#detailed-engineering-history`](../README.md#detailed-engineering-history) → [`engineering-history-v1.md`](engineering-history-v1.md) (compact index) → [`engineering-history-archive-v1.md`](engineering-history-archive-v1.md) (frozen detailed archive) |
| What is complete or currently in progress? | [`../ROADMAP.md`](../ROADMAP.md) |
| What authority does the AI have? | [`../SECURITY.md`](../SECURITY.md) |
| How do Mock/Groq/Gemini AI providers fit in? | [`../SECURITY.md`](../SECURITY.md) and [`system-overview.md#35-ai-provider-boundary`](system-overview.md#35-ai-provider-boundary) |
| How are RTI requirements-source providers integrated? | [`../PROVIDERS.md`](../PROVIDERS.md) |
| How are outputs published externally? | [`../PUBLISHING.md`](../PUBLISHING.md) |
| What threats were considered? | [`agentic-threat-model-v1.md`](agentic-threat-model-v1.md) |
| How is agentic security verified? | [`agentic-security-verification-strategy-v1.md`](agentic-security-verification-strategy-v1.md) |
| Where are trust/schema boundaries audited? | [`type-schema-boundary-audit-v1.md`](type-schema-boundary-audit-v1.md) |
| What is the package/public API boundary? | [`package-surface-v2.md`](package-surface-v2.md) |
| What contracts govern generated QA artifacts? | [`qa-generation-contracts-v1.md`](qa-generation-contracts-v1.md) |
| What governance process is used? | [`governance-process-v3.md`](governance-process-v3.md) |
| What policy governs branch/evidence retention? | [`repository-evidence-retention-policy-v1.md`](repository-evidence-retention-policy-v1.md) |
| What is the controlled-v1 release model? | [`controlled-v1-release-model-owner-decision-v1.md`](controlled-v1-release-model-owner-decision-v1.md) |

## Versioned-document policy

Several documents intentionally exist as `v1`, `v2`, or `v3`. Older versions are not automatically obsolete historical clutter: they may be required as lifecycle evidence for the state that was reviewed at that time.

Navigation should point readers to the latest applicable version while keeping prior versions available for evidence and auditability. Moving an authoritative record requires explicit preservation of its semantics and reference chain; versioned evidence must not disappear merely to simplify navigation.

## Root README role

The root README should remain useful to a first-time reader while also satisfying its established governance role as the stable entry point/index for completed-track detailed evidence. It should contain:

- what the project is and why it exists;
- major capabilities and a short maturity snapshot;
- one high-level architecture view;
- essential local-development commands;
- important limitations;
- stable evidence-entry headings/anchors required by canonical references;
- links to the versioned detailed evidence and owning contract documents.

Long implementation chronology and worked contract evidence should live in version-controlled owning documents — the compact index `engineering-history-v1.md` and the frozen detailed archive `engineering-history-archive-v1.md` — not be duplicated across the landing page.

## What may belong in a future Wiki

A Wiki can be useful for material that prioritizes discoverability and learning over version-bound normative evidence, for example:

- step-by-step demo walkthroughs;
- onboarding guides;
- FAQs;
- screenshots and videos;
- common troubleshooting;
- conceptual explanations for non-engineering readers.

The Wiki **must not** become authoritative for architecture, security, governance, public contracts, lifecycle evidence/status, or release state. It must link back to the applicable repository document whenever such a claim is involved.
