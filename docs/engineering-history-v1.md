# QA AI Agent — Engineering History v1

Status: FROZEN COMPLETED-TRACK EVIDENCE RECORD

This document preserves the detailed engineering evidence that previously lived only in the root `README.md` before DOC-REF-1. It is an archival technical-evidence record, not the source of current lifecycle state.

For governance compatibility, this versioned file is **incorporated by reference into the root README's completed-track evidence record**. The root README remains the stable evidence entry point/anchor surface; this file holds the detailed body so the landing page can stay concise without deleting evidence.

- Current execution sequence/status: [`../ROADMAP.md`](../ROADMAP.md)
- Current operational security boundaries: [`../SECURITY.md`](../SECURITY.md)
- Requirements-source provider contract: [`../PROVIDERS.md`](../PROVIDERS.md)
- Publishing/destination contract: [`../PUBLISHING.md`](../PUBLISHING.md)
- Source snapshot from which this record was extracted: root README at commit `7a4e4b9a7d9bab82d4258eee488075b70ba8aa75`

The purpose of this file is to keep completed-track technical evidence, architectural proof boundaries, historical maturity distinctions, contract evolution, and implementation lessons version-controlled after the root README was reduced to a landing page. Moving this material does not reopen or reclassify any lifecycle state.

## 1. Evidence maturity model

Historical claims in this project deliberately distinguish:

- **implemented** — code exists and is covered by repository verification;
- **production-integrated** — the capability runs in normal GitHub Actions/runtime paths;
- **live-proven** — a controlled real execution exercised the relevant path;
- **deterministically/offline proven** — architecture or contract behavior was proven by bounded tests/fixtures without claiming live-production proof;
- **architecturally independent / portable** — the producer/consumer boundary was proven without implying registry release/product maturity;
- **not claimed / deferred** — no stronger maturity claim is inferred from adjacent completed work.

These distinctions are important because a successful synthetic/offline proof is not silently promoted to a production claim, and architectural independence is not silently promoted to a formal product release.

## 2. Core reactive pipeline (#1–#21) — completed-track record

The reactive pipeline established the following architecture over the #1–#21 arc:

1. Cypress test evidence is collected without allowing the AI layer to decide CI pass/fail.
2. Failure context is normalized before analysis.
3. Browser correlation is deterministic and same-framework scoped.
4. Cross-framework correlation is kept separate from same-test/same-framework evidence.
5. History is a diagnostic signal rather than a current-run root-cause oracle.
6. Knowledge is curated, bounded and schema-validated, selected before model invocation.
7. Raw model text is parsed/validated and constrained by deterministic application policy.
8. One logical AI analysis is performed per failing workflow rather than per browser/framework leg.
9. Provider transport/auth/vendor envelopes are isolated behind provider adapters.
10. Provider failures do not silently trigger an automatic cross-provider fallback.
11. Evaluation/regression datasets protect AI-facing behavior from silent prompt/policy regressions.
12. Project identity, framework identity, source paths and attachments became explicit trust-boundary inputs rather than implicit repository assumptions.

### Provider abstraction history

The #1–#21 AI-provider abstraction was intentionally vendor-neutral. `MockProvider`, `GroqProvider`, and `GeminiProvider` prove that core reasoning does not depend on one vendor envelope. Groq is the provider historically wired to real CI; Gemini proved compatibility with a materially different API shape but was not silently treated as the production default or automatic fallback.

This AI-provider abstraction is **not the same concept** as the RTI-7 `RequirementsSourceProvider` contract documented in [`../PROVIDERS.md`](../PROVIDERS.md). Both concepts live under `scripts/ai/providers/`, but they have different purposes and authority boundaries.

### Project/framework portability history (#19)

Roadmap #19 separated two axes that must not be conflated:

- project portability — project identity, knowledge and history isolation;
- framework portability — normalized failure contract and adapter boundary.

#19.2 introduced a stable `ProjectProfile` identity foundation. #19.3 used that identity to gate project-specific Knowledge and History. #19.4 exercised the project boundary using a synthetic second project. #19.5 formalized framework identity and `NormalizedFailure`. #19.6 extracted Cypress-specific parsing behind `cypressAdapter`. #19.7 added historical-equivalence and filesystem-isolation proofs. #19.8 implemented an offline Playwright adapter against official-shape fixtures. #19.9 added framework orchestration and framework-scoped History. #19.10 performed the final offline portability review/documentation closure.

The original #19 proof was deliberately offline. Production Playwright integration came later under #21 rather than being retroactively claimed by #19.

### Production Playwright enablement (#21)

Roadmap #21 moved the offline-proven adapter model into real GitHub Actions CI. Cypress and Playwright remained independent suites. A Playwright result was never treated as proof that the same Cypress test passed or failed. One controlled Playwright failure was used to live-prove the full evidence path after prerequisite containment hardening. Residual hardening closed framework-identity and bounded-history issues before final documentation closure.

## 3. Generative Test Design & Test Automation (#22/#23)

The generative pipeline deliberately escalates authority in stages rather than collapsing "AI proposes" and "code executes" into one action.

Historical stage model:

```text
supplied evidence
  -> schema-validated requirement/test-design proposal
  -> human review bound to reviewed content
  -> automation candidate / plan
  -> generated change set
  -> second explicit human approval
  -> containment-aware filesystem application
  -> controlled execution
  -> execution evidence / bounded regeneration
```

Key completed-track invariants:

- generated artifacts are validated before downstream use;
- review records bind decisions to reviewed content via digest/integrity evidence;
- review-record integrity does not authenticate the human actor's real-world identity;
- approved change sets are applied through containment/topology defenses rather than arbitrary writes;
- controlled execution uses a closed classifier, `shell:false`, bounded environment/timeout/output and bounded regeneration;
- controlled execution is not an OS sandbox: generated code loaded by a framework runs with the host process authority;
- automatic GitHub Issue creation is not part of the triage authority model.

The precise current security statement remains in [`../SECURITY.md`](../SECURITY.md).

## 4. Full Project Independence / package boundary history

The Full Project Independence work asked whether the generic pipeline could operate outside this demonstration repository rather than merely support more than one project identity inside the same checkout.

Historical proofs included:

- target-owned configuration rather than producer-owned project literals;
- package/public-programmatic boundary;
- installation into a physically separate external repository;
- external consumer use through public exports rather than deep internal copies;
- real existing-repository onboarding proof;
- reproducible version-addressable acquisition without relying on a producer checkout, warm npm cache, SSH agent or GitHub token;
- version upgrade without rewriting target-owned integration source.

These proofs established **architectural independence**, not unrestricted release maturity. They did not by themselves mean npm-registry publication, formal semantic-version policy, mature CLI/product installer, or unrestricted autonomous operation. Those are separate productization/release concerns.

The second real-project integration used for portability proof remained an independently reviewed experiment rather than being silently reclassified as a permanent production deployment. The repository's own normal CI remained scoped to its primary real project.

## 5. RTI — Requirements & Test-Design Integration

RTI-1 through RTI-8 formed a separate deterministic integration arc:

`RTI-1 Requirement Artifact Contract -> RTI-2 File Ingestion -> RTI-3 Requirement Quality -> RTI-4 Test Design Generation -> RTI-5 Traceability/Coverage -> RTI-6 Generic Requirements Source Provider -> RTI-7 Concrete External Providers -> RTI-8 Publishing/Destinations`.

The integrated audit later identified and closed the `publishTestDesigns()` double-read trust-boundary defect (`RTIA-B01`) and a documentation inaccuracy (`RTIA-I01`). Current closure/status belongs to `ROADMAP.md`; the sections below preserve the technical contract evidence.

### RTI-1 — Requirement Artifact Contract

`RequirementArtifact` (`scripts/ai/requirement-artifact.js`) is the normalized, source-independent input model for requirement-driven QA capabilities. Its `source` object preserves provenance such as `{type, sourceId?, location?, system?, version?}` as data; `source.location` is provenance metadata, not filesystem authority. Core logic does not branch on vendor/source identity to decide semantics.

`assertValidRequirementArtifact` follows the repository fail-closed validator convention. The outer artifact, `source`, `acceptanceCriteria[]`, and `relationships[]` are protected against inherited/non-enumerable/accessor-backed values, prototype abuse and unknown keys. The stage intentionally did not implement ingestion, quality analysis, test generation or vendor adapters.

Historical merge anchor recorded in the prior README: `a08ab8f0714244631d5cb35281ad197a761455c8`.

### RTI-2 — File Requirements Ingestion

`loadRequirementsFromFile({ repositoryRoot, filePath })` (`scripts/ai/requirements-file.js`) is the explicit file-source adapter producing validated `RequirementArtifact[]` from target-owned JSON.

The stage proved filesystem authority, containment/path safety, parsing, normalization and failure semantics without making any AI/LLM call or inventing semantic content. Collection-level rules reject duplicate requirement ids and duplicate non-empty acceptance-criterion ids within one artifact. `relationships[].targetId` is shape-validated but not assumed to resolve within one file, because one file is not treated as a closed world.

### RTI-3 — Requirement Quality / Testability Analysis

`analyzeRequirementQuality(artifact)` and `analyzeRequirementsQuality(artifacts)` (`scripts/ai/requirement-quality.js`) answer whether an already-valid requirement is sufficiently specified to be trusted as test-design input. They do not generate tests or rewrite requirements.

Quality analysis is source-independent. RTI-1 validation runs before rule evaluation. The historical scope intentionally analyzed `content` and acceptance-criterion text rather than pretending labels, priority, provenance metadata or relationship metadata establish testability.

### RTI-4 — Test Design Generation

`generateTestDesign(artifact)` and `generateTestDesigns(artifacts)` (`scripts/ai/test-design.js`) deterministically convert RTI-3-ready requirements into generic `TestDesignArtifact[]`.

Historical generation model:

- one test-design artifact per acceptance criterion when criteria exist;
- exactly one design derived from requirement content when criteria are absent;
- deterministic id `${requirementId}::test::${ordinal}`;
- criterion provenance uses `criterionId` when present or positional `criterionIndex` fallback — never a fabricated criterion id;
- duplicate criterion ids fail generation closed;
- no invented steps/preconditions/test type/negative-path/boundary-value/equivalence-partition cases when the source requirement does not provide data supporting them;
- no Cypress/Playwright or test-management destination coupling in the generic artifact.

### RTI-5 — Requirement ↔ Test Traceability / Coverage

`buildRequirementTraceability(requirements, testDesigns)` and `analyzeRequirementsCoverage(requirements, testDesigns)` (`scripts/ai/requirement-traceability.js`) provide structural mapping/aggregation between requirements and test designs.

Coverage statuses are `FULLY_COVERED`, `PARTIALLY_COVERED`, and `UNCOVERED`. A test design that references a requirement with acceptance criteria but provides neither `criterionId` nor `criterionIndex` is surfaced as unmapped rather than being guessed into coverage.

The mapping fails closed and atomically on inconsistent references, unknown requirement/criterion ids, conflicting criterion reference forms, out-of-range indexes and duplicate ids. It intentionally evaluates structural traceability rather than semantic adequacy of the tests.

### RTI-6 — External Requirements Source Provider Contract

`loadRequirementsFromProvider(provider)` (`scripts/ai/requirements-source-provider.js`) defines the generic executable-provider boundary. A provider exposes identity plus `read()`; returned data is still untrusted and must pass RTI-1 validation.

Important historical contract distinctions:

- provider implementation is caller-supplied executable code;
- returned artifacts are untrusted data;
- `provider.id` and `artifact.source.type` are deliberately independent;
- core does not branch on vendor names and has no mandatory vendor registry/factory;
- normalized requirement identity is provider-owned and must be stable/collision-safe;
- empty query result is valid;
- duplicate ids or invalid output fail closed atomically;
- wrapped provider `.cause` is intentionally diagnostic and potentially sensitive, so routine logs should prefer bounded `code`/`message` rather than serializing the whole cause chain.

### RTI-7 — Concrete Requirements Source Providers

RTI-7 proved the generic RTI-6 boundary with materially different vendors.

**JiraRequirementsProvider** uses Jira Cloud REST API v3 and is exported from `qa-ai-agent/providers/jira`, not the root barrel. The corrected implementation uses `POST /rest/api/3/search/jql` rather than the removed legacy search endpoint. Normalized identity uses `<provider.id>:<issue key>` while the native key remains in `source.sourceId`. Acceptance criteria are extracted only from explicit configured fields; heuristic invention is forbidden. Transport/pagination/error handling is exercised offline. Live Jira proof was historically deferred when sandbox credentials were unavailable.

**AzureDevOpsRequirementsProvider** is exported from `qa-ai-agent/providers/azure-devops`. It proves the abstraction against WIQL plus batch work-item retrieval, numeric ids, HTML content and different rate-limit semantics. Azure DevOps Services only is in scope. The adapter fails closed at the vendor's 20,000-item WIQL opacity boundary rather than claiming completeness it cannot prove; full work items are fetched in bounded batches and reconciled against requested ids. Normalized identity follows the same opaque `<provider.id>:<native id>` convention. HTML normalization is resource-bounded. Live Azure proof was historically deferred when sandbox credentials were unavailable.

The two concrete providers deliberately did not force a premature shared transport abstraction when the evidence did not justify one. The current authoring contract and carried debt live in [`../PROVIDERS.md`](../PROVIDERS.md).

### RTI-8 — Test Case Publishing / Destinations

RTI-8 is the write-side counterpart to RTI-6/RTI-7. It introduced the generic `TestDesignDestination` concept for publishing canonical `TestDesignArtifact[]` to an external destination and proved it with Azure DevOps Test Case publishing plus cross-vendor flow evidence.

Because publishing crosses a side-effect boundary, validation, identity/provenance, failure semantics and no-partial/silent-success behavior are more important than vendor convenience. The durable `MUST`/`SHOULD`/`MAY` contract and carried debt live in [`../PUBLISHING.md`](../PUBLISHING.md).

## 6. Evaluation/regression history

Evaluation versions are additive historical subjects rather than one version replacing every prior subject:

- v1–v5 protect the reactive/failure-triage behavior and historical dimensions;
- v6 targets Test Design quality and is a different evaluation subject.

Therefore `eval:ai:v5` / `eval:regression:v5` remain the triage-oriented commands while `eval:ai:v6` / `eval:regression:v6` cover Test Design. See [`evaluation-execution-policy-v1.md`](evaluation-execution-policy-v1.md) for the execution policy.

## 7. Historical limitations preserved from the pre-refactor README

The detailed record explicitly carried these boundaries:

- controlled execution on Windows is not supported by the current `.cmd`/`shell:false` model and is tracked in `SECURITY.md`;
- automatic GitHub Issue creation is not implemented by failure triage;
- automatic cross-provider fallback is not implemented by design;
- review-record integrity does not authenticate reviewer identity;
- Gemini was not CI-wired; Groq was the real CI provider in the completed-track evidence record;
- architectural/package portability is not the same thing as formal registry/product release maturity;
- the repository's production CI does not imply a permanent second-project deployment;
- controlled execution is not an OS sandbox.

## 8. Repository governance/evidence history

The repository also had a normative evidence/branch-retention policy embedded in the old README. It has been preserved separately, without semantic change, as [`repository-evidence-retention-policy-v1.md`](repository-evidence-retention-policy-v1.md).

## 9. Historical source provenance

This record is intentionally versioned so completed-track evidence is not available only through Git history. For audit comparison, the source material was the root README at:

`7a4e4b9a7d9bab82d4258eee488075b70ba8aa75`

That source included additional narrative, diagrams, worked examples and stage-by-stage chronology. This file preserves the material architectural/contracts/evidence claims needed by canonical references after DOC-REF-1; `ROADMAP.md` remains authoritative for current status/sequence and can supersede stale historical status prose without rewriting this frozen record.
