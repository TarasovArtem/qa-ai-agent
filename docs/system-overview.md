# QA AI Agent — System Overview

This document provides a technical orientation to the current QA AI Agent architecture without duplicating the full security, governance, roadmap, and completed-track evidence records.

For normative boundaries and exact lifecycle state, use the owning documents linked throughout this page. For completed-track detailed engineering evidence formerly embedded in the root README, use [`engineering-history-v1.md`](engineering-history-v1.md) via the stable evidence index in [`../README.md`](../README.md).

## 1. System purpose

QA AI Agent combines AI-assisted reasoning with deterministic validation, policy, and explicit human authority gates across two distinct runtime paths:

1. **Reactive failure intelligence** — analyzes CI failures and produces human-facing conclusions without making CI pass/fail decisions.
2. **Generative Test Design & Test Automation** — proposes structured test artifacts and automation, then requires stronger validation and approval before higher-authority actions such as filesystem mutation or test execution.

The main design rule is:

> AI-generated output is data to validate, not authority to trust.

## 2. High-level architecture

```text
                              QA AI Agent
                                   |
                +------------------+------------------+
                |                                     |
                v                                     v
       Reactive failure path                Generative QA path
                |                                     |
       Cypress / Playwright                    requirements/evidence
                |                                     |
       evidence normalization                   structured design
                |                                     |
 deterministic browser/framework               validation + review
          correlation                                |
                |                              automation proposal
       project/framework history                       |
                |                              validation + approval
         knowledge selection                          |
                |                               controlled mutation
       one logical AI analysis                        |
                |                               controlled execution
       semantic validation                            |
                |                              execution evidence
       deterministic policy
                |
        human-facing output
```

The two paths do not have equivalent authority. The generative path can reach filesystem mutation and process execution, so it requires stronger gates than the reactive path.

## 3. Reactive failure-intelligence path

### 3.1 Evidence collection

Cypress and Playwright execute independently in CI. Framework-specific adapters normalize their reports into generic evidence structures used downstream.

Framework outcomes themselves remain authoritative. AI analysis does not convert a failing test run into a passing one or override the test runner's result.

### 3.2 Correlation

Two correlation concepts are deliberately separated:

- **browser correlation** — compares browsers within the same framework where comparable evidence exists;
- **framework correlation** — records workflow-level outcomes across independent frameworks.

Cross-framework status is not treated as proof that equivalent tests passed or failed because Cypress and Playwright may execute different suites and coverage.

### 3.3 History

Historical evidence is scoped to the relevant project/framework context and is used as a diagnostic signal rather than as proof of the current run's root cause.

### 3.4 Knowledge

The knowledge layer is curated, schema-validated, bounded, and selected before the model call. Knowledge can guide hypotheses but must not replace current-run evidence or deterministic policy.

### 3.5 AI provider boundary

Core reasoning consumes an AI-provider abstraction rather than depending directly on one vendor. AI-provider adapters own vendor-specific authentication/transport/envelope handling, while core logic owns prompt construction, validation, policy, and reporting.

AI-provider implementations include:

- **Mock** — deterministic/offline testing;
- **Groq** — real provider wired to the repository's CI path;
- **Gemini** — independent provider implementation proving the abstraction across a different API shape; not CI-wired.

Provider selection is explicit and there is **no automatic cross-provider fallback**.

The authoritative operational AI-provider/credential/rollout boundary is [`../SECURITY.md`](../SECURITY.md). Do **not** confuse this with [`../PROVIDERS.md`](../PROVIDERS.md), which is the separate RTI-7 **Requirements Source Provider** authoring contract for adapters such as Jira and Azure DevOps.

### 3.6 Validation and policy

Raw model output is never accepted as-is. It passes parsing/semantic validation and deterministic application policy before a human-facing report is produced.

The policy layer constrains safety-relevant recommendations independently of the model's wording.

## 4. Generative Test Design path

The generative path starts from supplied evidence about desired behavior rather than from a CI failure.

Its responsibility is to turn that evidence into structured, reviewable QA artifacts such as requirements and test cases while preserving traceability and schema constraints.

Typical flow:

```text
source evidence
     |
     v
structured requirement/test-design proposal
     |
     v
runtime/schema validation
     |
     v
review package
     |
     v
human decision bound to reviewed content
```

The review record protects content integrity: downstream stages can verify that the content being consumed is the content that was reviewed. That mechanism does not by itself authenticate the real-world identity of the reviewer.

See [`qa-generation-contracts-v1.md`](qa-generation-contracts-v1.md) and [`../SECURITY.md`](../SECURITY.md).

## 5. Generative Test Automation path

Approved test design can feed automation planning and generated code/change-set creation.

The authority escalation is intentionally staged:

```text
approved test design
      |
      v
automation candidate / plan
      |
      v
generated change set
      |
      v
validation
      |
      v
explicit approval
      |
      v
safe filesystem application
      |
      v
controlled execution
      |
      v
execution evidence / bounded regeneration
```

The important boundary is not simply whether code was generated. It is whether generated material has been validated, reviewed, authorized for mutation, and authorized for execution under the applicable controls.

Controlled execution limits how the orchestrator launches tests, but it is not an operating-system sandbox. Generated code loaded by the chosen test framework ultimately executes with the authority available to that host process. Controlled execution on Windows is currently unsupported under the documented `shell:false`/`.cmd` limitation. The precise security statement is maintained in [`../SECURITY.md`](../SECURITY.md).

## 6. Public/package boundary

The repository exposes a deliberate programmatic package surface while keeping significant internal implementation areas private.

The package boundary supports external-consumer integration without requiring consumers to copy the producer repository's internal source tree.

See:

- [`package-surface-v2.md`](package-surface-v2.md)
- [`../PROVIDERS.md`](../PROVIDERS.md) — RTI-7 requirements-source provider subpaths/contract
- [`../PUBLISHING.md`](../PUBLISHING.md) — RTI-8 destination/publishing contract

Package portability and architectural independence should not be confused with a formal unrestricted public release. Release state is governed separately by the roadmap and controlled-release decisions. The external-consumer/second-project proofs establish capability, not a second permanent production deployment.

## 7. Trust boundaries

Important trust boundaries include, at minimum:

- LLM/AI-provider responses;
- generated QA artifacts and change sets;
- review/approval records;
- project profiles and configuration;
- environment variables and credentials;
- source/attachment paths;
- external requirements-source provider and publishing-destination payloads;
- tool/process execution;
- package/public API contracts.

The repository-wide audit of type/schema and runtime validation boundaries is documented in [`type-schema-boundary-audit-v1.md`](type-schema-boundary-audit-v1.md).

## 8. Security assurance documentation

Security is documented in multiple layers because the questions are different:

- [`../SECURITY.md`](../SECURITY.md) — operational security boundary, AI-provider/credential rules, and known limitations;
- [`agentic-threat-model-v1.md`](agentic-threat-model-v1.md) — threat inventory and risk reasoning;
- [`agentic-security-verification-strategy-v1.md`](agentic-security-verification-strategy-v1.md) — verification strategy;
- [`security-architecture-decision-record-v1.md`](security-architecture-decision-record-v1.md) — architecture security decisions;
- [`prompt-indirect-injection-study-v1.md`](prompt-indirect-injection-study-v1.md) — indirect/prompt-injection research;
- [`data-exfiltration-cross-project-isolation-v1.md`](data-exfiltration-cross-project-isolation-v1.md) — data isolation/exfiltration analysis;
- [`tool-privilege-credential-boundary-analysis-v1.md`](tool-privilege-credential-boundary-analysis-v1.md) — privilege/credential boundaries;
- [`aisec-7-adversarial-security-test-harness-v1.md`](aisec-7-adversarial-security-test-harness-v1.md) — adversarial verification harness.

## 9. Governance model

Engineering work is separated into lifecycle phases rather than treating implementation, review, merge, certification, and closure as the same event.

The governance documentation includes:

- [`governance-process-v3.md`](governance-process-v3.md) — current versioned governance-process record;
- [`repository-evidence-retention-policy-v1.md`](repository-evidence-retention-policy-v1.md) — normative repository evidence/branch-retention policy preserved from the pre-refactor README;
- [`gov-auto-1-design-reconciliation-v1.md`](gov-auto-1-design-reconciliation-v1.md) — governance automation design/reconciliation;
- [`controlled-v1-release-model-owner-decision-v1.md`](controlled-v1-release-model-owner-decision-v1.md) — controlled-release decision record;
- [`../ROADMAP.md`](../ROADMAP.md) — canonical current lifecycle/status/sequence.

This overview intentionally does not reproduce exact PR/HEAD/TREE/CI identities because those are lifecycle evidence and become stale quickly. They belong in the roadmap, PRs, issues, and versioned governance/evidence records.

## 10. Evaluation and regression protection

The project contains offline evaluation/regression infrastructure intended to detect behavior regressions in AI-facing logic without relying on live-provider calls for every verification run.

Evaluation execution policy is documented in [`evaluation-execution-policy-v1.md`](evaluation-execution-policy-v1.md).

The versioned subjects are additive rather than simple replacements:

- **v1–v5** — reactive/failure-triage evaluation history; v5 is the current triage-oriented command set;
- **v6** — Test Design evaluation, a different subject.

The root README labels both command sets explicitly rather than describing v6 as a universal replacement for v1–v5.

## 11. Documentation ownership / evidence routing

This overview does not redefine the repository's established authority tiers. It describes where readers should go while preserving the root README's governance role as the stable evidence entry point.

| Document | Responsibility |
|---|---|
| `README.md` | project landing page, quick start, stable completed-track evidence index/anchors |
| `docs/README.md` | non-normative documentation navigation |
| `docs/system-overview.md` | technical orientation only |
| `docs/engineering-history-v1.md` | preserved completed-track detailed engineering evidence referenced through README |
| `ROADMAP.md` | canonical current lifecycle/status/sequence and delivery-state record |
| `SECURITY.md` | operational security and AI-provider/credential authority/boundaries |
| `PROVIDERS.md` | RTI-7 Requirements Source Provider authoring contract |
| `PUBLISHING.md` | RTI-8 destination/publishing contract |
| `docs/repository-evidence-retention-policy-v1.md` | normative evidence/branch-retention policy |
| other versioned `docs/*.md` | scoped architecture, governance, research, audit, assurance and historical records according to each document |

This split keeps first-time navigation lightweight without deleting or silently weakening version-controlled evidence or governance policy.
