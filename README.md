# QA AI Agent

![Cypress E2E Tests](https://github.com/TarasovArtem/qa-ai-agent/actions/workflows/cypress.yml/badge.svg?branch=main)

QA AI Agent is an AI-assisted QA engineering system for **failure intelligence, requirements/test-design analysis, test automation generation, controlled execution, and governance-aware delivery**.

The project combines two main runtime paths:

- **Reactive CI failure triage** — Cypress and Playwright evidence is normalized, correlated deterministically, analyzed once by an AI provider, constrained by deterministic policy, and reported for human action.
- **Generative Test Design & Test Automation** — evidence is turned into schema-validated requirements/test cases and automation proposals, with explicit human approval before generated code can be applied or executed.

The core safety principle is simple:

> **AI proposes. Deterministic code validates. Humans authorize authority escalation.**

This README is intentionally short as a landing page. For governance compatibility it also remains the authoritative **entry point/index** for completed-track detailed engineering evidence. [`docs/engineering-history-v1.md`](docs/engineering-history-v1.md) is the compact evidence index, and the complete pre-refactor evidence body is preserved byte-for-byte in [`docs/engineering-history-archive-v1.md`](docs/engineering-history-archive-v1.md). Both are **incorporated by reference into this README evidence record** rather than duplicated inline.

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

- provider-neutral AI abstraction with Mock, Groq, and Gemini implementations
- Cypress and Playwright framework adapters
- package/public API boundary for external consumers
- Jira and Azure DevOps **requirements-source provider** subpaths
- Azure DevOps **test-design destination** subpath
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
| Multi-provider abstraction | Implemented; Groq is the real CI-wired provider, Gemini is not CI-wired, and no automatic cross-provider fallback exists |
| Multi-project/package boundary | Proven through external-consumer work; normal repository CI still represents one real production project and the second-project integration proof is not a permanent production deployment |
| Security architecture | Threat model, verification strategy, isolation and privilege analyses exist |
| Governance automation | Active development workstream |
| Formal product release | Governed separately; see the canonical roadmap and release-model documents |

For exact lifecycle state, merged milestones, open work, and current evidence, use [`ROADMAP.md`](ROADMAP.md). The roadmap — not this summary table — is the canonical status/sequence source.

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

See [`docs/system-overview.md`](docs/system-overview.md) for technical orientation and [`SECURITY.md`](SECURITY.md) for authoritative operational security boundaries.

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

### Run offline AI evaluation

Reactive/failure-triage evaluation remains the v5 subject:

```bash
npm run eval:ai:v5
npm run eval:regression:v5
```

Test Design evaluation is the separate v6 subject:

```bash
npm run eval:ai:v6
npm run eval:regression:v6
```

See [`docs/evaluation-execution-policy-v1.md`](docs/evaluation-execution-policy-v1.md) for the distinction.

Live AI-provider configuration is governed by [`SECURITY.md`](SECURITY.md). [`PROVIDERS.md`](PROVIDERS.md) documents the separate RTI-7 **Requirements Source Provider** authoring contract, not the Mock/Groq/Gemini AI-provider abstraction.

## Documentation

Start with the **[Documentation Home](docs/README.md)**.

| Topic | Source |
|---|---|
| System overview | [`docs/system-overview.md`](docs/system-overview.md) |
| Completed-track evidence index | [`docs/engineering-history-v1.md`](docs/engineering-history-v1.md) |
| Frozen pre-refactor historical evidence archive | [`docs/engineering-history-archive-v1.md`](docs/engineering-history-archive-v1.md) |
| Canonical project lifecycle / roadmap | [`ROADMAP.md`](ROADMAP.md) |
| Security model, AI-provider boundary and operational limitations | [`SECURITY.md`](SECURITY.md) |
| RTI-7 requirements-source provider contract | [`PROVIDERS.md`](PROVIDERS.md) |
| RTI-8 publishing / destination integration | [`PUBLISHING.md`](PUBLISHING.md) |
| Governance process | [`docs/governance-process-v3.md`](docs/governance-process-v3.md) |
| Repository evidence/branch-retention policy | [`docs/repository-evidence-retention-policy-v1.md`](docs/repository-evidence-retention-policy-v1.md) |
| Governance automation design | [`docs/gov-auto-1-design-reconciliation-v1.md`](docs/gov-auto-1-design-reconciliation-v1.md) |
| Agentic threat model | [`docs/agentic-threat-model-v1.md`](docs/agentic-threat-model-v1.md) |
| Security verification strategy | [`docs/agentic-security-verification-strategy-v1.md`](docs/agentic-security-verification-strategy-v1.md) |
| Type & schema boundary audit | [`docs/type-schema-boundary-audit-v1.md`](docs/type-schema-boundary-audit-v1.md) |
| Package surface | [`docs/package-surface-v2.md`](docs/package-surface-v2.md) |
| QA generation contracts | [`docs/qa-generation-contracts-v1.md`](docs/qa-generation-contracts-v1.md) |

## Documentation authority and Wiki policy

The root README remains the governance-compatible entry point for project purpose and completed-track evidence navigation. Detailed evidence is preserved in version-controlled repository documents rather than kept only in Git history.

A GitHub Wiki may be added later for tutorials, demos, FAQs, onboarding, or other human-friendly guidance, but it **must not** become authoritative for:

- architecture;
- security;
- governance;
- public contracts;
- lifecycle evidence/status;
- release state.

## Important limitations

- AI analysis does **not** decide whether CI passes.
- Automatic GitHub issue creation is not part of the current failure-triage authority model.
- Review-record integrity is not the same thing as reviewer identity authentication.
- Controlled execution is **not** an operating-system sandbox.
- Controlled execution on Windows is currently unsupported under the present `shell:false`/`.cmd` execution model; see `SECURITY.md`.
- There is **no automatic cross-provider fallback**.
- Groq is the real CI-wired AI provider; Gemini is implemented but not CI-wired.
- Production CI represents one real project; second-project portability proofs do not imply a second permanent production deployment.
- Architectural/package portability does not by itself mean a public registry release or unrestricted autonomous operation.

See [`SECURITY.md`](SECURITY.md), [`ROADMAP.md`](ROADMAP.md), [`docs/engineering-history-v1.md`](docs/engineering-history-v1.md), and [`docs/engineering-history-archive-v1.md`](docs/engineering-history-archive-v1.md) for exact boundaries/evidence ownership.

## Detailed engineering history

The detailed completed-track evidence formerly embedded in this README is preserved byte-for-byte in [`docs/engineering-history-archive-v1.md`](docs/engineering-history-archive-v1.md). [`docs/engineering-history-v1.md`](docs/engineering-history-v1.md) is the compact navigation/index layer. Both are incorporated by reference into this README evidence record. This heading is retained as the stable README evidence entry point required by canonical governance references.

## Roadmap RTI — Requirements & Test-Design Integration

RTI-1 through RTI-8K exact historical chronology, PR/merge identities, review/corrective outcomes and closure-state evidence are preserved in [`docs/engineering-history-archive-v1.md#roadmap-rti--requirements--test-design-integration`](docs/engineering-history-archive-v1.md#roadmap-rti--requirements--test-design-integration). Current closure state is owned by [`ROADMAP.md`](ROADMAP.md); durable RTI-7 and RTI-8 contracts remain in [`PROVIDERS.md`](PROVIDERS.md) and [`PUBLISHING.md`](PUBLISHING.md).

The compact compatibility examples below preserve the README locations explicitly referenced by `PROVIDERS.md` and `PUBLISHING.md`; exhaustive behavior, security rules, defaults, and carried debt remain in those owning contract documents.

### RTI-7B — Jira Reference Requirements Provider

```js
const { loadRequirementsFromProvider } = require("qa-ai-agent");
const { JiraRequirementsProvider } = require("qa-ai-agent/providers/jira");

const provider = new JiraRequirementsProvider({
  id: "company-jira-prod",
  baseUrl: "https://company.atlassian.net",
  email: "bot@company.com",
  apiToken: process.env.JIRA_API_TOKEN,
  jql: "project = PROJ AND type = Story ORDER BY key ASC",
  fieldMap: { acceptanceCriteria: "customfield_12345" }, // optional
  maxItems: 1000,   // optional; default 1000
  timeoutMs: 10000, // optional; default 10000
});

const requirements = await loadRequirementsFromProvider(provider);
```

The current adapter uses Jira Cloud REST API v3 `POST /rest/api/3/search/jql`. See [`PROVIDERS.md`](PROVIDERS.md) for the normative RTI-7 contract and complete safety/identity rules.

### RTI-7F — Azure DevOps Requirements Provider

```js
const { loadRequirementsFromProvider } = require("qa-ai-agent");
const { AzureDevOpsRequirementsProvider } = require("qa-ai-agent/providers/azure-devops");

const provider = new AzureDevOpsRequirementsProvider({
  id: "azure-prod",
  organization: "contoso",
  project: "MyProject",
  wiql: "SELECT [System.Id] FROM WorkItems WHERE [System.WorkItemType] = 'Bug'",
  auth: { type: "pat", token: process.env.AZURE_DEVOPS_PAT },
  fieldMap: { acceptanceCriteria: "Custom.AC" }, // optional
  typeMap: { Feature: "requirement" },           // optional
  maxItems: 1000,   // optional; default 1000
  timeoutMs: 10000, // optional; default 10000
});

const requirements = await loadRequirementsFromProvider(provider);
```

Azure DevOps Services is the supported deployment scope for this adapter; see [`PROVIDERS.md`](PROVIDERS.md) for the authoritative contract and vendor-specific limits.

### RTI-8B — Generic Publishing Core

```js
const qa = require("qa-ai-agent");

// readyRequirements must contain only requirements that passed the RTI-3 quality gate as READY.
const testDesigns = qa.generateTestDesigns(readyRequirements);
const result = await qa.publishTestDesigns(destination, { testDesigns });
// result.destinationId, result.allSucceeded, result.items[]
```

`publishTestDesigns` is the vendor-neutral publishing boundary. See [`PUBLISHING.md`](PUBLISHING.md) for validation, atomicity/failure semantics, side-effect rules, and the destination contract.

### RTI-8F — Azure DevOps Test Case Destination

```js
const { AzureDevOpsTestCaseDestination } = require("qa-ai-agent/destinations/azure-devops");

const destination = new AzureDevOpsTestCaseDestination({
  id: "azure-tests-prod",
  organization: "contoso",
  project: "MyProject",
  auth: { type: "pat", token: process.env.AZURE_DEVOPS_PAT },
  // timeoutMs is optional; default 15000; bounds [1000, 120000]
});
```

The destination is Azure DevOps Test Case publishing under the RTI-8 contract. Source and destination vendor identities are independent; a Jira source does not imply a Jira destination.

## AI Test Design & Test Automation (#22/#23)

The complete historical #22/#23 stage-by-stage record — including #22B–#22F and #23B–#23G — is preserved in [`docs/engineering-history-archive-v1.md#ai-test-design--test-automation-2223`](docs/engineering-history-archive-v1.md#ai-test-design--test-automation-2223). Current security authority remains in [`SECURITY.md`](SECURITY.md).

## Full Project Independence — Terminal Audit and Final Re-Audit

The complete architectural-independence terminal definition, acquisition/upgrade evidence, proof tags, verdict and maturity boundaries are preserved in [`docs/engineering-history-archive-v1.md#roadmap-fpi-2--terminal-audit--full-project-independence`](docs/engineering-history-archive-v1.md#roadmap-fpi-2--terminal-audit--full-project-independence). Formal release/productization state remains separate and is owned by [`ROADMAP.md`](ROADMAP.md).

## Package Maturity vs. Architectural Independence

The complete historical section referenced by `ROADMAP.md` is preserved at [`docs/engineering-history-archive-v1.md#package-maturity-vs-architectural-independence`](docs/engineering-history-archive-v1.md#package-maturity-vs-architectural-independence). It remains explicit that evidence tags are not release tags, architectural independence is not npm/CLI/reusable-CI product maturity, the external-project integration proof was not a permanent deployment, and ID-3 remains a separate productization/release concern.

## Solo-maintainer governance profile (SG1)

The SG1 record referenced by `ROADMAP.md` is preserved verbatim in [`docs/engineering-history-archive-v1.md`](docs/engineering-history-archive-v1.md), including the historical required-check configuration, strict up-to-date mode, no admin bypass, no required reviewer count, and the deliberate treatment of `Cypress - firefox` / `QA AI triage`.

## #19.7F-B4B precedent

The #19.7F-B4B precedent referenced by `ROADMAP.md`, including the organic workflow-run evidence, is preserved verbatim in [`docs/engineering-history-archive-v1.md`](docs/engineering-history-archive-v1.md).

## Roadmap-by-roadmap historical record

The exact pre-refactor roadmap-by-roadmap history — including CS6/CS7 and the completed-track implementation/review/corrective/merge evidence — is preserved in [`docs/engineering-history-archive-v1.md`](docs/engineering-history-archive-v1.md).

## Roadmap closure state

The exact pre-refactor closure-state block referenced by `ROADMAP.md` is preserved at [`docs/engineering-history-archive-v1.md#roadmap-closure-state`](docs/engineering-history-archive-v1.md#roadmap-closure-state).

## Repository Evidence and Branch Retention Policy

The normative policy formerly embedded here is preserved without semantic change in [`docs/repository-evidence-retention-policy-v1.md`](docs/repository-evidence-retention-policy-v1.md). That policy does not itself authorize deletion, closure, merge, or any other repository mutation.

## Repository documentation model

```text
README.md                            landing page + authoritative evidence index
   |
   +-- docs/README.md                documentation navigation
   +-- docs/system-overview.md       technical orientation
   +-- docs/engineering-history-v1.md
   |                                 compact completed-track evidence index
   +-- docs/engineering-history-archive-v1.md
   |                                 byte-identical pre-refactor evidence archive
   +-- docs/repository-evidence-retention-policy-v1.md
   |                                 normative retention policy
   +-- SECURITY.md                   operational security / AI-provider boundary
   +-- ROADMAP.md                    current lifecycle/status/sequence
   +-- PROVIDERS.md                  RTI-7 requirements-source provider contract
   +-- PUBLISHING.md                 RTI-8 publishing/destination contract
```

## License

MIT — see [`LICENSE`](LICENSE).
