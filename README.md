# QA AI Agent

![Cypress E2E Tests](https://github.com/TarasovArtem/qa-ai-agent/actions/workflows/cypress.yml/badge.svg?branch=main)

QA AI Agent is an AI-assisted QA engineering system for **failure intelligence, requirements/test-design analysis, test automation generation, controlled execution, and governance-aware delivery**.

The project combines two main runtime paths:

- **Reactive CI failure triage** — Cypress and Playwright evidence is normalized, correlated deterministically, analyzed once by an AI provider, constrained by deterministic policy, and reported for human action.
- **Generative Test Design & Test Automation** — evidence is turned into schema-validated requirements/test cases and automation proposals, with explicit human approval before generated code can be applied or executed.

The core safety principle is simple:

> **AI proposes. Deterministic code validates. Humans authorize authority escalation.**

This README is intentionally short. Detailed architecture, security, governance, audit, and contract documentation lives in [`docs/`](docs/README.md).

---

## Why this project exists

QA automation increasingly needs more than test execution. Teams also need help understanding failures, analyzing requirements, designing coverage, generating automation, and deciding what an AI agent is actually allowed to do.

QA AI Agent explores that problem with explicit boundaries:

- AI output is treated as untrusted input and validated before use.
- CI pass/fail remains authoritative outside the LLM.
- Generated artifacts cross explicit review and approval gates before higher-authority actions.
- Security and governance controls are designed as first-class parts of the system rather than post-processing.
- Provider, framework, and target-project boundaries are kept explicit to support portability.

## Key capabilities

### Failure intelligence

- Cypress and Playwright CI evidence collection
- deterministic same-framework browser correlation
- separate cross-framework workflow correlation
- project/framework-scoped failure history
- evidence-grounded AI analysis
- deterministic policy constraining action-oriented model output
- one logical AI analysis per failing workflow rather than one call per browser

### Requirements and test design

- structured requirement and test-case generation
- runtime schema validation of generated artifacts
- requirement quality and coverage analysis
- traceability support
- human review records bound to reviewed content

### Test automation

- automation candidate and plan generation
- generated change-set validation
- explicit approval before filesystem mutation
- containment-aware application of approved changes
- controlled test execution
- bounded regeneration after execution failure

### Platform and integration

- provider-neutral AI abstraction
- Mock, Groq, and Gemini provider implementations
- Cypress and Playwright framework adapters
- package/public API boundary for external consumers
- Jira and Azure DevOps provider/destination subpaths
- project-owned configuration and knowledge boundaries

### Safety and governance

- deterministic validation and policy layers around AI output
- authority escalation gates
- threat modeling and adversarial security verification
- cross-project isolation analysis
- tool/credential boundary analysis
- repository-wide type/schema boundary audit
- governance pre-review framework workstream

## Current maturity

| Area | Current state |
|---|---|
| Cypress + Playwright failure triage | Implemented and CI-integrated |
| AI Test Design | Implemented |
| AI Test Automation | Implemented with approval and controlled-execution boundaries |
| Multi-provider abstraction | Implemented; provider rollout remains explicitly controlled |
| Multi-project/package boundary | Proven through external-consumer work |
| Security architecture | Threat model, verification strategy, isolation and privilege analyses exist |
| Governance automation | Active development workstream |
| Formal product release | Governed separately; see the canonical roadmap and release-model documents |

For exact lifecycle state, merged milestones, open work, and evidence, use [`ROADMAP.md`](ROADMAP.md). The roadmap — not this summary table — is the canonical status source.

## Architecture at a glance

```text
                              QA AI Agent
                                   |
                +------------------+------------------+
                |                                     |
                v                                     v
       CI Failure Triage                    Test Design + Automation
            reactive                              generative
                |                                     |
       Cypress / Playwright                    supplied evidence
                |                                     |
       normalized evidence                    structured design
                |                                     |
   deterministic correlation                    human review
                |                                     |
      one AI analysis                         automation proposal
                |                                     |
    deterministic policy                        human approval
                |                                     |
        human-facing report              safe apply + controlled run
```

The two paths have different authority levels. Failure triage is analysis/reporting oriented; the generative path can eventually reach filesystem mutation and process execution, so it passes through stronger validation and approval gates.

See [`docs/system-overview.md`](docs/system-overview.md) for the technical overview and [`SECURITY.md`](SECURITY.md) for the authoritative security boundaries.

## Development quick start

### Requirements

- Node.js **22.x**
- npm
- supported browsers required by the Cypress/Playwright commands you choose to run

### Install dependencies

```bash
npm ci
```

### Run unit tests

```bash
npm run test:unit
```

### Run Cypress

```bash
npm run chrome
npm run edge
npm run firefox
```

### Run Playwright

```bash
npm run test:e2e:playwright
```

### Run the current offline AI evaluation

```bash
npm run eval:ai:v6
npm run eval:regression:v6
```

Provider credentials and live-provider behavior are intentionally not implied by these local commands. See [`PROVIDERS.md`](PROVIDERS.md) and [`SECURITY.md`](SECURITY.md) before configuring live-provider execution.

## Documentation

Start with the **[Documentation Home](docs/README.md)**.

| Topic | Source |
|---|---|
| System overview | [`docs/system-overview.md`](docs/system-overview.md) |
| Canonical project lifecycle / roadmap | [`ROADMAP.md`](ROADMAP.md) |
| Security model and operational boundaries | [`SECURITY.md`](SECURITY.md) |
| AI/provider contracts | [`PROVIDERS.md`](PROVIDERS.md) |
| Publishing / destination integration | [`PUBLISHING.md`](PUBLISHING.md) |
| Governance process | [`docs/governance-process-v3.md`](docs/governance-process-v3.md) |
| Governance automation design | [`docs/gov-auto-1-design-reconciliation-v1.md`](docs/gov-auto-1-design-reconciliation-v1.md) |
| Agentic threat model | [`docs/agentic-threat-model-v1.md`](docs/agentic-threat-model-v1.md) |
| Security verification strategy | [`docs/agentic-security-verification-strategy-v1.md`](docs/agentic-security-verification-strategy-v1.md) |
| Type & schema boundary audit | [`docs/type-schema-boundary-audit-v1.md`](docs/type-schema-boundary-audit-v1.md) |
| Package surface | [`docs/package-surface-v2.md`](docs/package-surface-v2.md) |
| QA generation contracts | [`docs/qa-generation-contracts-v1.md`](docs/qa-generation-contracts-v1.md) |

## Documentation policy

Repository documentation is the source of truth for versioned technical, security, architecture, and governance material.

A GitHub Wiki may be added later for tutorials, demos, FAQs, onboarding, or other human-friendly guidance, but it should not become the canonical source for security contracts, governance decisions, architecture boundaries, or lifecycle evidence.

## Important limitations

- AI analysis does **not** decide whether CI passes.
- Automatic GitHub issue creation is not part of the current failure-triage authority model.
- Review-record integrity is not the same thing as reviewer identity authentication.
- Controlled execution is **not** an operating-system sandbox.
- Provider availability, credentials, and rollout are deployment/governance concerns, not assumptions of the core abstraction.
- Architectural/package portability does not by itself mean a public registry release or unrestricted autonomous operation.

See [`SECURITY.md`](SECURITY.md) and [`ROADMAP.md`](ROADMAP.md) for exact boundaries and status.

## Repository documentation model

```text
README.md
   |
   +-- project landing page / quick start
   |
   +-- docs/README.md
   |      |
   |      +-- architecture & contracts
   |      +-- security & assurance
   |      +-- governance & release
   |      +-- audits & evidence
   |
   +-- SECURITY.md     authoritative security boundary
   +-- ROADMAP.md      authoritative lifecycle/status record
   +-- PROVIDERS.md    provider integration contract
   +-- PUBLISHING.md   publishing/destination contract
```

## License

MIT — see [`LICENSE`](LICENSE).
