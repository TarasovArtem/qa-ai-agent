# Triage Boundary Contract Decision v1

Status: APPROVED DESIGN CONTRACT (C2) / MERGED (design PR #237, merge `00074717072e3471ff3e35b63ef3ee68ded2057f`)  
Implementation: COMPLETED ON MAIN / POST-MERGE CERTIFIED (implementation PR #238, merge `8aa7c5191e662942f1d73539c740904d385c646d`)  
Canonical finding closure: PENDING PR #239 lifecycle completion  
Lifecycle note: the sections below are the approved C2 design contract and are preserved as written; they state design requirements, not implementation claims. Historical baseline and rejected-head evidence below is retained unchanged.  
Authority: `OD-TRIAGE-BOUNDARY-DESIGN — APPROVED`; `OD-TRIAGE-BOUNDARY-DESIGN-C1 — APPROVED`; `OD-TRIAGE-BOUNDARY-DESIGN-C2 — APPROVED`  
Review class: `HEAVY`  
Baseline main: `acf127024ea1fe76eb9945e8bbf26d32b54cb772`  
Baseline TREE: `651f40ff95f1f4a6d90739f5ae6f2a15b588c8ab`  
Previous rejected HEADs: `9040725187c21c2d78d96370ce399562cd79b243`, `5c80ed103b29c595a54a00a92e9cee09ac464c58`  
Previous C1 TREE: `846be8323241150a5de3d3c13567489ba7c6745d`

## 1. Purpose and lifecycle boundary

Single active WIP:

`TSB-F04 + TSB-F07 + XI-01 + XI-02`.

This document defines design only. It does not authorize implementation, merge, finding closure, waiver, re-rating or risk acceptance.

C1 already resolved `ARCH-B01`, `ARCH-M01..M04`, `ARCH-m01..m05`, `ARCH-I03`, `ARCH-I04`, plus the GitHub Actions side of `ARCH-B02`. C2 resolves the remaining `ARCH-C1-B01` local/direct decision and the two minor findings `ARCH-C1-m01` and `ARCH-C1-m02`.

Product Owner decision: **FULL PROJECT INDEPENDENCE / LOCAL EXECUTION remains supported**. It is versioned, not withdrawn or converted to expected failure.

## 2. Finding ownership

### TSB-F04

Owns the closed provider-result schema, bounded fields, exact result cardinality, exact result-to-failed-test binding, rejection of stale/duplicate/missing/unknown results, and authoritative test identity reconstructed from the local validated failure snapshot before report persistence.

It does not own provider transport or `SEC-F06-I1`.

### TSB-F07

Owns the closed bounded non-History persisted `context.json` contract, real Cypress/Playwright variants, snapshots, total artifact bound and fail-closed read/consume behavior.

It does not receive closure credit for embedded History; that is XI-02.

### XI-01

Owns binding of persisted context to independently trusted **current invocation** state. Values copied from persisted context never become their own trust anchor.

C2 defines two explicit modes:

- `github-actions-v1`
- `local-v1`

There is no implicit fallback between modes.

### XI-02

Owns closed `history.json` variants, project/framework eligibility, bounded metrics, rejection of embedded `context.history`, one authoritative History projection for prompt/report, and `H06-C1`/`H06-C2` closure evidence.

## 3. Selected architecture

Use one non-public internal authority, tentatively:

`scripts/ai/triage-boundary-contract.js`

It owns validation/snapshot helpers for context, invocation binding, History and provider-result binding.

It remains internal: no new root export, package export or package `files` expansion.

It must not depend on excluded runtime modules such as `normalized-failure.js` unless package evidence proves they are shipped without changing package scope.

Rejected: duplicated validators, self-digest-only provenance, disabling local execution, fake CI variables for local execution, cryptographic signing/key management.

## 4. Persisted context contract — TSB-F07

Future implementation defines `PersistedTriageContextV1`.

Required properties:

- `schemaVersion: 1`;
- explicit total byte cap enforced before complete buffering/parsing;
- closed top-level/nested shapes;
- real `{found:false}` and `{found:true, totals, specs[]}` test-result variants;
- nullable Cypress stats where currently legitimate;
- Cypress suite/status;
- optional Playwright `projectId`/`projectName`;
- null correlation values where current producers use them;
- bounded `knownProjectConstraints`, warnings and relevant files;
- existing relevant-file limits preserved: 20 KiB per file, 150 KiB aggregate;
- no silent consumer truncation of legitimate long errors; choose a measured bounded maximum and reject over-bound artifacts;
- detached authoritative snapshots after validation.

`metadata` includes governed project/framework/repository/commit/branch/run/event/browser fields plus XI-01 fields:

- `runAttempt`: required in `github-actions-v1`, `null` in `local-v1`;
- `localInvocationId`: required in `local-v1`, `null` in `github-actions-v1`.

Persisted invocation fields are evidence only. The analyzer obtains expected values independently from current runtime state.

For failure-bearing context, persisted constraints equal the validated ProjectProfile snapshot. The legitimate zero-failure producer case may keep `knownProjectConstraints: []`.

Embedded `context.history` is not accepted; XI-02 owns its rejection.

## 5. XI-01 common gate

The analyzer is the authoritative XI-01 enforcement point.

Do not change the root-exported `aggregateBrowserContext.main({repositoryRoot})` signature. Aggregator checks are defense-in-depth only; analyzer revalidates raw persisted context even if aggregation refused input.

Before any provider call or report persistence, all modes require:

1. validated ProjectProfile;
2. validated repository root and context-file containment;
3. `context.metadata.projectId === validatedProjectProfile.id`;
4. for failure-bearing context, exact constraints equality;
5. selection and validation of exactly one trusted invocation mode;
6. exact persisted-context binding to that trusted invocation.

Zero-failure context is not exempt from these checks.

## 6. `github-actions-v1` — CI trust model

### 6.1 Mode predicate

The supported CI predicate is exactly:

`GITHUB_ACTIONS === "true"`.

If true, all mandatory tuple fields must exist and validate. Missing/partial/invalid state fails closed and must not fall back to local mode.

If false, GitHub variables such as `GITHUB_REPOSITORY` do not grant XI-01 CI authority by themselves.

### 6.2 Trusted tuple

Build detached `TrustedInvocationV1` from current process runtime values:

- `GITHUB_REPOSITORY`;
- `GITHUB_SHA`;
- `GITHUB_RUN_ID`;
- `GITHUB_RUN_ATTEMPT`.

Validate strict formats and non-empty normalized values before trusting them.

Persisted metadata must exactly match repository, SHA, run ID and run attempt.

### 6.3 Freshness

Freshness is exact equality of:

`repository + SHA + run ID + run attempt`.

Context from another repository, commit, run or another attempt of the same run fails closed.

This resolves `ARCH-C1-m01`: `GITHUB_RUN_ATTEMPT` is mandatory when GitHub Actions mode is active.

This resolves `ARCH-C1-m02`: CI-mode selection is the explicit `GITHUB_ACTIONS === "true"` predicate; contradictory or incomplete CI state fails closed.

## 7. `local-v1` — direct/local trust model

### 7.1 Versioned runtime contract

No new JavaScript function parameter or export is introduced.

Use a narrow environment/orchestration contract:

- `QA_AI_INVOCATION_MODE=local-v1`
- `QA_AI_INVOCATION_ID=<fresh random id>`

`local-v1` is selected only when:

- `GITHUB_ACTIONS !== "true"`;
- `QA_AI_INVOCATION_MODE === "local-v1"`;
- `QA_AI_INVOCATION_ID` passes the closed validation contract.

Unknown/missing mode, missing/invalid id, or contradictory `GITHUB_ACTIONS=true` + `local-v1` fails closed.

### 7.2 Trusted local invocation id

The invoking/orchestrating process generates **one fresh id before context production** and preserves it unchanged across the stages of that same local invocation.

Minimum requirement: at least 128 bits of cryptographically random entropy in a closed bounded encoding. Timestamps, paths, self-digests and predictable counters are insufficient as the sole id.

The trusted expected value is the current runtime `QA_AI_INVOCATION_ID`, not the copy stored in `context.json`.

`collect-context.js` persists the id into `context.metadata.localInvocationId`.

`analyze-failure.js` independently validates the current runtime id and requires exact equality with the persisted id before provider invocation or report persistence.

The analyzer must not generate a replacement id after context has already been produced.

### 7.3 Local freshness and H05-C2

For `local-v1`, freshness is:

`validated ProjectProfile + validated repository-root containment + exact localInvocationId equality`.

Repository/commit/run-id equality is not mandatory for local mode because the certified external installation proof uses a temporary external repository that is not required to be a Git checkout and currently has `runId: null`.

A stale context from a prior local invocation therefore fails because its invocation id differs, even if someone changes `projectId` and copies current constraints.

The persisted id cannot self-authorize: copying/editing `context.json` does not change the independently supplied current runtime id.

### 7.4 FULL PROJECT INDEPENDENCE

The existing installed-package local pipeline remains a positive success proof.

Future implementation updates `test/installation/external-repository-proof.test.js` to establish one fresh `local-v1` id in the child-process environment before `collectContext` and `analyzeFailure` run.

The proof must continue to show all four generic stages succeed outside the source checkout from the real installed package.

It must **not** set `GITHUB_ACTIONS=true` merely to satisfy XI-01.

Its existing `GITHUB_REPOSITORY` value may remain for History/API behavior but is non-authoritative for XI-01 while `GITHUB_ACTIONS !== "true"`.

This is a versioned invocation requirement, not withdrawal of local execution.

### 7.5 Local closure tests

H05-C2 closure evidence must include both modes.

Local tests must prove:

- valid fresh `local-v1` pipeline succeeds;
- stale prior-invocation context is rejected under a new current invocation id;
- missing/malformed local id fails closed;
- `GITHUB_REPOSITORY` alone cannot create CI authority;
- fake CI environment is unnecessary;
- zero-failure local context is still bound before report persistence.

## 8. Framework binding

`resolveFrameworkId(undefined) -> cypress` is not trusted XI-01 framework evidence.

Framework equality is enforced only where a non-defaulted trusted runtime/configuration value is independently validated.

Legitimate Playwright triage must not be rejected by an implicit Cypress default.

## 9. XI-02 History contract

The separate available History record remains closed/bounded around current fields such as projectId, framework, browser, branch, runsConsidered, passes, failures, retryPasses and generatedAt.

Preserve:

- non-negative integer metrics;
- `passes + failures === runsConsidered`;
- `retryPasses <= passes`;
- explicit upper bounds.

Unavailable History is a distinct closed variant with bounded reason text.

Persisted/analyzer input `context.history` is rejected at the persisted-context/analyzer boundary. This closure credit belongs to XI-02, not TSB-F07.

Provider-visible and report-visible History come only from the same detached validated projection of separate `history.json`.

History remains intentionally cross-run; it is not required to equal the current run/invocation id. Wrong-project, wrong-framework, malformed or unbounded History becomes `no usable history`, never fabricated zero History.

History must not be read/projected before context validation and XI-01 binding.

Mandatory closure evidence:

- `H06-C1`: ineligible separate History cannot survive through embedded context History;
- `H06-C2`: prompt/report History derive from the same validated projection.

## 10. TSB-F04 provider-result contract

TSB-F06 raw text bounds remain upstream.

Parsed provider output uses a closed envelope and closed bounded result objects containing current semantic fields plus internal `failureRef`.

Failure refs are generated locally before the provider call from authoritative failed-test snapshots and remain unique even for identical failures by including stable local position/index plus deterministic fingerprint material.

Require exactly one result per expected ref, no unknown refs, no duplicates, no omissions and exact cardinality.

Refs prove set membership/correlation, not truth of AI reasoning.

Final report/comment test identity comes from the local authoritative failed-test snapshot, not model title/spec text. `recommendedFix.file` remains advisory model output.

`failureRef` is internal and need not become a persisted `ai-report.json` field. If implementation requires persisting it as a supported output field, STOP for Product Owner disposition.

## 11. Snapshot / TOCTOU and fail-closed order

Validators return detached authoritative snapshots. Never validate an object and then reread caller-controlled/proxy/accessor-backed state as authority.

Required analyzer order:

1. validate ProjectProfile/root;
2. select/validate exactly one invocation mode and trusted snapshot;
3. bounded-read/parse context;
4. validate/snapshot non-History context;
5. enforce XI-01 binding/freshness;
6. reject embedded History;
7. bounded-read/validate/project separate History;
8. compute permitted enrichment;
9. build prompt;
10. call provider only when failures require it;
11. apply existing TSB-F06 bound;
12. parse;
13. apply TSB-F04 closed result contract/ref binding;
14. reconstruct authoritative identities;
15. persist report/downstream effects.

Malformed/unbound zero-failure context writes no report.

## 12. Versioned contract impact

`EXPORT SURFACE IMPACT = NONE`.

No new root export, package export or exported-function parameter is proposed.

`SUPPORTED CONTRACT IMPACT = VERSIONED / IMPLEMENTATION AUTHORIZATION REQUIRED`.

Future implementation affects:

- `context.json` -> `PersistedTriageContextV1`;
- `history.json` closed variants;
- provider result protocol;
- authoritative `ai-report.json` identity semantics;
- stricter persisted-input behavior of exported triage functions;
- invocation environment contract:
  - GitHub Actions: `GITHUB_ACTIONS=true` + repository/SHA/run/run-attempt;
  - local/direct: `QA_AI_INVOCATION_MODE=local-v1` + fresh `QA_AI_INVOCATION_ID`.

Before production implementation, separate Product Owner implementation authorization must explicitly cover these versioned supported-contract changes.

If implementation requires a new root/package export, exported-function signature parameter, package `files` expansion, or persisted `failureRef`, STOP for separate Product Owner contract decision.

## 13. Compatibility

GitHub Actions compatibility must be proved for current pull-request/external CI semantics with same-run/same-attempt equality. Repository evidence indicates no workflow mutation is needed; if implementation proves otherwise, STOP before editing workflows.

Local/direct compatibility is preserved through the new invocation environment contract. The external installation proof stays a successful local proof and is updated rather than converted to CI or expected failure.

No permissive legacy artifact fallback is authorized merely to keep fixtures green. A real supported long-lived legacy-artifact workflow requires Product Owner disposition.

## 14. Public/package constraints

No export or package `files` expansion is proposed.

The internal contract module may only depend on runtime files that are actually shipped for installed-package paths.

`SECURITY.md` is expected to require implementation-time synchronization of artifact/version/invocation-boundary descriptions. C2 itself does not modify it.

## 15. Preserved scope

`TSB-F02 = OPEN / LOW / CONDITIONAL`; trigger remains false.

If implementation introduces a supported dependent consumer of TSB-F02 gates: `STOP — TSB-F02 OWNER DISPOSITION REQUIRED`.

`SEC-F06-I1 = OPEN / PRESERVED / OUTSIDE SCOPE`.

No remediation or implicit absorption is authorized.

Preserve TSB-F01/F03/F05/F06 controls, finding severities, WIP=1, package/root export surface, FULL PROJECT INDEPENDENCE, deterministic fail-closed behavior and unrelated debt.

## 16. Proposed future implementation surface — NOT AUTHORIZED

Expected production surface:

- NEW `scripts/ai/triage-boundary-contract.js`
- `scripts/ai/collect-context.js`
- `scripts/ai/collect-history.js`
- `scripts/ai/aggregate-browser-context.js`
- `scripts/ai/analyze-failure.js`
- `scripts/ai/qa-agent-prompt.js` only where needed
- `scripts/ai/providers/mock-provider.js`

Expected test/security/doc surface:

- NEW `scripts/ai/triage-boundary-contract.test.js`
- existing collect-context/history/aggregate/analyze/prompt tests
- `test/security/aisec-7/triage-cross-project.test.js`
- `test/security/aisec-7/hostile-model-output.test.js`
- `test/security/aisec-7/lib/registry.js`
- `test/installation/external-repository-proof.test.js`
- `SECURITY.md`

Workflow changes are not expected. The external installation proof test change is expected and does not weaken its local-execution claim.

## 17. Required adversarial matrix

At minimum prove:

- valid Cypress/Playwright contexts and real shape variants;
- unknown/malformed/sparse/oversized context rejection;
- total context cap and relevant-file limits;
- snapshot/proxy/accessor mutation resistance;
- GitHub Actions exact repository/SHA/run/run-attempt binding;
- cross-attempt rejection;
- explicit CI predicate and no fallback to local;
- successful `local-v1` installed-package execution;
- stale local invocation-id rejection;
- missing/malformed local contract rejection;
- wrong project/constraints rejection;
- Playwright not forced to Cypress;
- embedded History rejection plus H06-C1/H06-C2;
- exact provider result refs/cardinality and authoritative local test identity;
- no report/provider side effect after mandatory failure;
- zero-failure binding;
- unchanged package/root exports and exported-function signatures;
- TSB-F01/F03/F05/F06 regressions green;
- current seven-job CI green.

## 18. Finding-to-control traceability

| Finding | Required closure evidence |
| --- | --- |
| TSB-F04 | closed provider schema; bounded fields; unique local refs; exact result-set binding; authoritative local test identity; fail-before-report tests |
| TSB-F07 | versioned closed non-History context schema; real Cypress/Playwright variants; byte/field/count bounds; snapshots; producer+consumer validation |
| XI-01 | ProjectProfile/root binding; explicit mode; GitHub repository/SHA/run/run-attempt freshness; local invocation-id freshness; mode-specific H05-C2 evidence; analyzer gate |
| XI-02 | closed separate History; embedded-History rejection; eligibility; one prompt/report projection; H06-C1/H06-C2 |

No finding closes merely as a side effect of another control.

## 19. Corrective disposition

Preserved as resolved from C1 review:

- `ARCH-B01`
- `ARCH-M01..M04`
- `ARCH-m01..m05`
- `ARCH-I03/I04`
- CI side of `ARCH-B02`

C2 dispositions:

- `ARCH-C1-B01` — addressed by explicit supported `local-v1` runtime contract, fresh invocation id, positive external installation proof, and mode-specific H05-C2 evidence;
- `ARCH-C1-m01` — addressed by mandatory `GITHUB_RUN_ATTEMPT` and cross-attempt rejection;
- `ARCH-C1-m02` — addressed by exact predicate `GITHUB_ACTIONS === "true"` and fail-closed partial/contradictory state.

Preserved INFO:

- pull-request SHA equality remains compatible;
- embedded History rejection remains compatible;
- package/export constraints remain unchanged.

## 20. STOP conditions

STOP before implementation/expansion if review or implementation discovery shows:

- local execution requires a new root/package export or exported-function signature change;
- the selected local invocation runtime contract cannot establish safe freshness without material orchestration redesign;
- cryptographic signing/key management is required;
- workflow mutation is required for trusted CI identity;
- persisted `failureRef` must become a supported output field;
- TSB-F02 trigger becomes true;
- SEC-F06-I1 must be changed;
- a supported legacy workflow needs permissive fallback;
- unrelated finding remediation is required;
- waiver/re-rating/risk acceptance is needed instead of remediation.

## 21. Lifecycle boundary

C2 ends at:

`DESIGN C2 COMMIT -> EXACT-HEAD CI -> READY FOR INDEPENDENT HEAVY ARCHITECTURE RE-REVIEW`.

Only after Architecture approval may the same exact HEAD proceed to separate HEAVY Security design review.

Implementation: `NOT AUTHORIZED`  
Merge: `NOT AUTHORIZED`  
Finding closure: `NOT AUTHORIZED`
