# Triage Boundary Contract Decision v1

Status: DESIGN CORRECTIVE C1 / NOT IMPLEMENTED / NOT MERGED  
Authority: `OD-TRIAGE-BOUNDARY-DESIGN — APPROVED`; `OD-TRIAGE-BOUNDARY-DESIGN-C1 — APPROVED`  
Review class: `HEAVY`  
Required independent reviews after C1: Senior Architecture re-review + Security review  
Baseline main: `acf127024ea1fe76eb9945e8bbf26d32b54cb772`  
Baseline TREE: `651f40ff95f1f4a6d90739f5ae6f2a15b588c8ab`  
Previous rejected design HEAD: `9040725187c21c2d78d96370ce399562cd79b243`

## 1. Decision purpose

This document defines the remediation design for the single active WIP:

`TSB-F04 + TSB-F07 + XI-01 + XI-02`.

It is a design contract only. It does not close, waive, re-rate or risk-accept any finding and does not authorize implementation or merge.

The four findings remain separate governance identities even though they share one runtime triage data flow. A single internal contract authority may implement common validation primitives, but closure evidence must remain independently traceable to each finding.

This C1 corrects the Architecture review findings `ARCH-B01`, `ARCH-B02`, `ARCH-M01..M04`, `ARCH-m01..m05`, and clarifies `ARCH-I03` / `ARCH-I04`.

## 2. Canonical finding ownership

### TSB-F04 — provider triage output contract and binding

Canonical problem: provider analysis output is only partially shape-validated and is not strongly bound to the exact failed-test evidence being analyzed. Unknown keys are accepted, result cardinality/order/identity are not closed against the current failed-test set, and model-supplied test identity can reach downstream report/comment surfaces.

TSB-F04 owns:

- the closed provider-result structural contract;
- bounded provider-visible result fields;
- exact result cardinality;
- deterministic binding of each result to the current failed-test input;
- rejection of duplicate, missing, stale or mismatched result identity;
- authoritative failed-test identity sourced from the local validated failure snapshot, not from model text;
- fail-closed consumption before `ai-report.json` is persisted.

It does not own provider transport retry policy or `SEC-F06-I1`.

### TSB-F07 — persisted triage context contract, excluding History semantics

Canonical problem: persisted triage context is accepted with permissive shape and insufficient explicit field/cap validation before later triage consumption.

TSB-F07 owns the non-History persisted context boundary, including:

- exact top-level context fields;
- exact nested metadata/test-result/failure/relevant-file/correlation shapes;
- bounded arrays, strings, maps and total artifact size;
- rejection of unknown fields at governed persisted boundaries;
- deterministic snapshotting before subsequent use;
- fail-closed read/aggregate/analyze behavior for malformed non-History context.

TSB-F07 does **not** receive closure credit for the canonical XI-02 embedded-History replay gap. Embedded `context.history` handling belongs to XI-02.

### XI-01 — trusted current invocation to persisted-context binding

Canonical problem: ProjectProfile identity plus repository-root containment is insufficient if a stale context from another project/run is copied into the expected path and relabelled with the current project id.

XI-01 owns relationship validation between independently trusted current invocation state and the persisted context consumed by triage.

It must bind the persisted context to independently validated current-run evidence where such evidence exists. Values copied from the persisted context itself are never allowed to become their own trust anchor.

### XI-02 — History artifact, embedded-History replay, projection and consistency

Canonical problem: History is intentionally cross-run evidence, but both the separate `history.json` artifact and any embedded `context.history` material can become replay/substitution channels if they are not governed by one explicit authority.

XI-02 explicitly owns:

- the `history.json` persisted schema;
- available/unavailable History variants;
- project/framework eligibility of usable History;
- numeric consistency and bounded fields;
- projection of only approved aggregate History to provider-visible context;
- rejection or deterministic removal of embedded `context.history` as an independent History source;
- the invariant that prompt-visible History and report-visible History derive from the same validated authoritative projection;
- preservation of `no usable history` versus legitimate zero-count History.

This directly covers the canonical gap:

`ineligible separate history does not clear embedded context history`.

AISEC-7 `H06-C1` and `H06-C2` are mandatory XI-02 closure evidence.

## 3. Boundary ownership matrix

| Boundary | Producer / source | Consumer | Trust owner | Finding |
| --- | --- | --- | --- | --- |
| Provider analysis JSON | LLM/provider | `analyze-failure.js` | closed response schema + exact failed-test binding + authoritative local identity | TSB-F04 |
| `reports/ai/context.json` non-History fields | collector / browser aggregator | analyzer/report/prompt | closed persisted schema + bounds | TSB-F07 |
| Current invocation ↔ persisted context | validated ProjectProfile/root + validated current CI tuple when present | analyzer | independent identity equality / freshness | XI-01 |
| Separate `history.json`, embedded `context.history`, prompt/report History | history collector / persisted artifacts | analyzer/prompt/report | single validated History authority + projection | XI-02 |

Overlap is intentional at validation seams, not at finding identity.

The analyzer is the authoritative XI-01 fail-closed gate. The aggregator may validate inputs for correctness, but aggregator refusal is not sufficient security enforcement because raw context may still remain on disk and be consumed later.

## 4. Current data flow and trust classification

Current operational flow:

1. Target bootstrap supplies ProjectProfile and repository root.
2. `collect-context.js` validates them, collects adapter/runtime evidence and persists `reports/ai/context.json`.
3. `collect-history.js` validates profile/root, aggregates prior CI history and persists `reports/ai/history.json`.
4. Browser artifacts may be combined by `aggregate-browser-context.js`.
5. `analyze-failure.js` reads persisted context/history, enriches context, builds prompts and invokes a provider.
6. Provider text is bounded by TSB-F06 before parse and partially validated afterward.
7. Analysis is persisted to `ai-report.json`.

Trust classes:

- Provider output: untrusted/provider-controlled.
- ProjectProfile snapshot: trusted only after TSB-F05 central inspection.
- Repository root: trusted only after existing root validation.
- Persisted context/history: untrusted at each read boundary even though repository-local.
- Test failure content, relevant files and historical evidence: evidence, never authority.
- Environment/CI values: not trusted merely because they exist; they become trusted only after a dedicated current-invocation validator establishes presence, format and execution-context preconditions.

## 5. Selected architecture

### One internal triage-boundary authority — SELECTED

Introduce one non-public internal module, tentatively:

`scripts/ai/triage-boundary-contract.js`

It owns canonical validation/snapshot primitives for:

- persisted triage context;
- current invocation binding;
- separate/embedded History handling;
- provider-result binding.

The module should remain a leaf/internal authority where practical and must not be root-exported or added to package exports.

It must not depend on excluded package-only implementation modules (for example `normalized-failure.js`) unless installed-package evidence proves that dependency is shipped safely without changing package publication scope.

### Rejected alternatives

- duplicated ad-hoc validators in each caller;
- self-digest-only provenance;
- signing/encryption/key-management scope expansion.

Cryptographic authenticity is not required by these findings. If implementation proves otherwise, STOP for Product Owner design disposition.

## 6. Persisted context contract — TSB-F07

Implementation must define a closed `PersistedTriageContextV1` internal artifact contract.

### 6.1 Versioning and supported contract impact

`context.json` is a supported artifact/behavior contract even though it is not a root export.

Newly produced context should carry `schemaVersion: 1`, subject to HEAVY review approval.

Legacy/unversioned context must not be silently normalized. If a currently supported legitimate consumer requires legacy acceptance, implementation must STOP for Product Owner disposition rather than add a permissive fallback.

### 6.2 Total artifact byte bound

The implementation must define an explicit maximum byte size for `context.json` and enforce it before complete buffering/parsing at every governed read boundary.

The exact constant must be justified from current legitimate fixtures plus bounded producer maxima. It may not be left effectively unbounded.

### 6.3 Closed top-level shape

The governed persisted form includes only fields proven necessary by current producers/consumers, including:

- `schemaVersion`
- `generatedAt`
- `metadata`
- `testResults`
- `failedTests`
- `relevantFiles`
- `knownProjectConstraints`
- `warnings`
- `browserCorrelation` where legitimately present, including `null` where current producers use null
- `frameworkCorrelation` where legitimately present, including `null` where current producers use null

`context.history` is not accepted as an independent History source. Its disposition is governed by XI-02, not TSB-F07.

Ephemeral analyzer fields such as `relevantKnowledge` are not persisted unless independently justified.

### 6.4 Metadata

`metadata` must be closed and bounded with explicit nullable/optional semantics for current producer fields such as:

- project identity;
- framework;
- repository;
- commit;
- branch;
- run id;
- event;
- browser;
- CI-related provenance.

`projectId` reuses TSB-F05 ProjectProfile semantics.

### 6.5 `testResults` actual variants

The contract must model the real supported variants rather than a generic numeric summary:

- `{ found: false, ...governed-current-fields }`
- `{ found: true, totals, specs[] , ...governed-current-fields }`

Cypress per-spec statistics may be nullable where current producer evidence permits null.

Do not impose arithmetic consistency rules that current Cypress aggregation semantics do not guarantee.

### 6.6 `failedTests` real variants

The closed schema must be derived from actual supported Cypress and Playwright producer outputs, not from `normalized-failure.js` alone.

It must account for legitimate fields including:

- common identity/failure fields;
- Cypress `suite` / `status` where produced;
- optional Playwright per-failure `projectId` / `projectName` where produced.

The new contract module must not import an excluded implementation module merely to define this schema.

### 6.7 Legitimate long error messages

Current Cypress error messages may be legitimately long and are not currently producer-truncated.

C1 selects this compatibility rule:

- do not silently truncate at the consumer;
- define a bounded artifact/field maximum high enough for measured legitimate fixtures;
- reject artifacts that exceed the governed maximum;
- if measured current supported fixtures exceed the proposed maximum, adjust the design constant before implementation rather than breaking valid traffic.

Producer-side truncation is not selected because it would change evidence semantics.

### 6.8 Relevant files

Preserve existing producer limits:

- 20 KiB per relevant file content;
- 150 KiB aggregate relevant-file content.

Consumption must re-enforce those limits plus bounded path/count/entry shape.

### 6.9 Constraints

`knownProjectConstraints` must be a closed bounded string array.

For contexts containing one or more failures, XI-01 requires equality with the authoritative ProjectProfile snapshot.

For the legitimate zero-failure producer case, `knownProjectConstraints: []` is accepted and is not required to deep-equal a non-empty profile constraint list. This exception is valid only on the zero-failure path and must not be generalized to failure-bearing contexts.

### 6.10 Warnings and correlation

Warnings must be bounded dense strings.

Correlation objects use existing projection vocabularies and may be `null` where current supported producer behavior allows it. Unknown nested material is rejected.

## 7. XI-01 trusted invocation binding

### 7.1 Authoritative gate

The analyzer is the authoritative XI-01 enforcement point.

Do not change `aggregateBrowserContext.main({ repositoryRoot })` to require ProjectProfile under this design; that would change a root-exported signature and requires separate authority.

The analyzer must validate/bind the persisted context even if aggregation previously refused an input.

### 7.2 Trusted ProjectProfile/root checks

Always require before any report persistence or provider call:

1. `context.metadata.projectId === validatedProjectProfile.id`;
2. root containment of the context file under the validated repository root;
3. for failure-bearing context, `knownProjectConstraints` equals the validated ProjectProfile snapshot constraints.

These checks alone do **not** close H05-C2.

### 7.3 Validated current CI invocation tuple — selected H05-C2 control

For supported GitHub Actions triage flows, define an internal `TrustedInvocationV1` from independently supplied runtime state, not from `context.json`.

Required current-run fields:

- repository identity;
- commit SHA;
- run ID.

Optional/secondary fields may include workflow/event/branch only where current workflow semantics make them stable and independently available.

The validator must:

1. read these values from the current CI runtime source;
2. verify that the process is actually in the supported CI mode before granting them authority;
3. validate strict field formats and non-empty normalized values;
4. build a detached trusted snapshot;
5. compare persisted `metadata.repository`, `metadata.commit`, and `metadata.runId` against that trusted snapshot before provider invocation or report persistence.

The persisted context may never supply or override the expected tuple.

### 7.4 Freshness / replay policy

For the supported same-run triage path, exact equality to the trusted current repository/SHA/run ID is the freshness rule.

A context from another run — even from the same project — is not valid current triage input and fails closed.

This directly closes stale/foreign-run relabel case `H05-C2`.

### 7.5 Absence and local/direct invocation

Outside the supported CI path, absence of an independently trusted current repository/SHA/run tuple must not silently degrade to "trust the persisted metadata".

Rules:

- if a root-exported/direct caller performs persisted-context analysis and no trusted current tuple exists, XI-01 must fail closed unless a separately validated internal invocation object is supplied through an already authorized supported contract;
- this C1 does not authorize adding a new public parameter or export to obtain such a tuple;
- if implementation proves a supported direct/local flow requires successful persisted-context analysis without an independently trusted tuple, STOP — Product Owner versioned-contract decision required.

### 7.6 Framework binding and Playwright

The analyzer does **not** currently possess a trusted framework merely because `resolveFrameworkId(undefined)` defaults to `cypress`.

That defaulting selector must not be used as XI-01 authority.

Framework equality is enforced only where a non-defaulted trusted runtime framework identity is explicitly validated from the current supported invocation.

Until such an authority exists, project/run binding must not falsely reject legitimate Playwright triage by assuming Cypress.

### 7.7 H05-C2 closure evidence

AISEC-7 `H05-C2` is a mandatory XI-01 closure test and must flip from current-behavior FAIL to fail-closed PASS.

The test must prove that a stale/foreign context relabelled with the current project id and copied constraints is rejected because repository/SHA/run do not match the independently trusted current invocation tuple.

## 8. XI-02 History contract

### 8.1 Separate available History record

The currently produced available `history.json` fields are:

- `available: true`
- `projectId`
- `framework`
- `browser`
- `branch`
- `runsConsidered`
- `passes`
- `failures`
- `retryPasses`
- `generatedAt`

Close and bound this object.

Preserve numeric invariants:

- metrics are non-negative integers;
- `passes + failures === runsConsidered`;
- `retryPasses <= passes`.

Add explicit upper bounds to prevent absurd but arithmetically consistent values.

### 8.2 Unavailable History record

Define a closed bounded unavailable variant.

Reason text must be bounded. Consumer rejection of oversized/unusable reason text is allowed without changing `SEC-F06-I1`; this design does not authorize diagnostic-policy remediation.

### 8.3 Embedded `context.history` — explicit canonical rule

Persisted/analyzer input `context.history` is never an independent trusted History source.

The implementation must choose one deterministic closed-schema behavior:

- reject a persisted context carrying embedded `history`, or
- strip/ignore it before authoritative snapshot creation.

Selected design rule: **reject embedded `context.history` at the persisted-context/analyzer boundary** so stale History cannot survive as hidden state.

This rejection is attributed to XI-02 closure evidence, not TSB-F07.

### 8.4 Single authoritative provider-visible History source

Provider-visible History may come only from the separately read, XI-02-validated `history.json` projection.

No other embedded History value may reach the prompt.

The report-visible History field and prompt-visible History field must be constructed from the same detached validated projection object.

Required invariant:

`promptHistory === reportHistory` semantically, derived from one authoritative projection snapshot.

### 8.5 Eligibility

Usable History must satisfy the existing canonical project/framework eligibility rules, including only intentionally retained documented Cypress legacy compatibility.

History is intentionally cross-run, so it is not required to match current commit/run ID.

Wrong-project, wrong-framework, malformed or unbounded History becomes `no usable history`, never fabricated zero History.

### 8.6 Ordering / existing default read hazard

The current `buildFailureReport()` default History read must not consume History before authoritative context validation/binding.

History acquisition/projection must occur only after the validated context snapshot and XI-01 binding have succeeded.

### 8.7 H06 closure evidence

AISEC-7 tests are mandatory:

- `H06-C1`: ineligible separate History cannot be bypassed by embedded `context.history`;
- `H06-C2`: prompt-visible History and report-visible History are equal because both derive from the same validated projection.

Both currently reproduce the gap and must be flipped to closure PASS evidence.

## 9. TSB-F04 provider-result contract

The existing TSB-F06 raw text cap remains upstream. TSB-F04 governs the parsed structure and binding.

### 9.1 Envelope and result item

The response is a closed envelope containing exactly the governed `results` array.

Each result retains current semantic analysis fields:

- `test`
- `classification`
- `confidence`
- `summary`
- `rootCause`
- `evidence`
- `recommendedFix`
- `shouldCreateBug`
- `shouldRetry`

and an internal protocol field:

- `failureRef`

All nested objects/arrays/strings are closed and bounded.

### 9.2 Unique local failure references

Failure references are generated locally **before** the provider call from the authoritative failed-test snapshot.

They must remain unique even for two failures with identical title/spec/error content.

Selected design: reference identity includes a stable local position/index plus deterministic bounded fingerprint material, for example conceptually:

`f:<index>:<fingerprint>`

The exact serialization is an implementation detail, but index/unique local position is mandatory.

The provider only echoes the reference. It never creates authority.

### 9.3 Exact result-set binding

Require:

- exactly one result per expected `failureRef`;
- no unknown refs;
- no duplicate refs;
- no omitted refs;
- result count exactly equals failure count.

References bind set membership, cardinality and result-to-failure correlation. They do **not** prove semantic correctness of AI classification/root cause text.

### 9.4 Authoritative report identity

After reference matching, model-supplied identity is not authoritative.

The final `ai-report.json` and PR-comment identity must be reconstructed from the locally retained authoritative failed-test snapshot.

At minimum:

- authoritative test title comes from the local failed-test snapshot;
- authoritative spec/file identity comes from the local failed-test snapshot;
- model-supplied title/spec identity cannot rename the failure in the report;
- any `recommendedFix.file` or equivalent model-controlled path remains advisory model output and must not be represented as authoritative source identity.

If retaining model identity fields is useful for diagnostics, they must be either validated against authoritative identity or excluded from authoritative downstream rendering.

### 9.5 Is `failureRef` persisted?

Selected design: `failureRef` is an internal provider protocol/binding field and is **not required to become a supported persisted `ai-report.json` field**.

The analyzer consumes it to join each result to the authoritative local failure snapshot and may omit it from the final report.

If implementation needs to persist it as a stable output contract field, STOP for Product Owner versioned-contract disposition.

## 10. Snapshot and TOCTOU semantics

Validators return detached authoritative snapshots.

Do not:

`validate object -> later reread caller-controlled object`.

This applies to:

- persisted context;
- trusted invocation state;
- History projection;
- provider result binding.

Direct in-memory calls must not permit accessors/proxies/post-validation mutation to alter authoritative consumed state.

## 11. Fail-closed ordering

Required analyzer ordering:

1. validate ProjectProfile and repository root;
2. construct/validate trusted current invocation tuple where supported;
3. bounded-read and parse context;
4. validate/snapshot non-History persisted context;
5. enforce XI-01 binding/freshness;
6. reject embedded `context.history` under XI-02;
7. bounded-read/validate/project separate `history.json`;
8. compute permitted runtime enrichment;
9. construct prompt from authoritative snapshots;
10. invoke provider only if failures require provider analysis;
11. enforce existing TSB-F06 raw response bound;
12. parse provider JSON;
13. enforce TSB-F04 closed result contract + exact refs;
14. reconstruct authoritative result identities from local failed-test snapshots;
15. persist report/downstream side effects.

### Zero-failure path

The zero-failure path is not exempt from mandatory context validation and XI-01 binding.

No `ai-report.json` may be persisted from an unvalidated or unbound persisted context merely because the failure count is zero.

Provider invocation may be skipped for zero failures, but validation/binding must happen first.

### Aggregator

Aggregator validation is defense-in-depth and producer-quality enforcement. The analyzer remains the authoritative final fail-closed gate.

## 12. Supported contract and versioning impact

The previous statement `PUBLIC API IMPACT = NONE` was too broad.

C1 distinguishes:

### Export surface impact

`EXPORT SURFACE IMPACT = NONE`

No new root export or package export is proposed.

### Supported artifact / behavior contract impact

`SUPPORTED CONTRACT IMPACT = VERSIONED / IMPLEMENTATION AUTHORIZATION REQUIRED`

The future implementation changes accepted/produced internal artifacts and root-exported function behavior even if export names/signatures remain unchanged.

Contract surfaces requiring explicit implementation-time versioned treatment:

- persisted `context.json` -> `PersistedTriageContextV1`;
- persisted `history.json` -> closed History variants;
- provider triage result protocol -> `failureRef` + closed result schema;
- `ai-report.json` identity semantics -> authoritative local failed-test identity; no mandatory persisted `failureRef` under this design;
- `analyzeFailure.main` accepted persisted inputs become stricter;
- `aggregateBrowserContext.main` consumed artifact acceptance becomes stricter, without changing its root-export signature;
- `collectContext.main` produces versioned closed context;
- `collectHistory.main` produces closed History variants.

Before production implementation, Product Owner implementation authorization must explicitly cover these versioned supported-contract changes.

If implementation requires a root-export signature change, new export, or persisted `failureRef` output field:

`STOP — VERSIONED PUBLIC/OUTPUT CONTRACT AUTHORIZATION REQUIRED`.

## 13. Migration and compatibility

Supported current CI is expected to remain compatible because it produces fresh artifacts in the same run, but this is a hypothesis that implementation tests must prove.

Compatibility requirements include:

- Cypress context variant fidelity;
- Playwright optional project fields;
- nullable correlations;
- zero-failure constraints behavior;
- installed-package fixtures currently carrying unversioned hand-written contexts.

`test/installation/external-repository-proof.test.js` must be updated/proved as part of future implementation because it models installed-package behavior and hand-written context fixtures.

No permissive legacy fallback is authorized merely to keep old fixtures green.

If a real supported user workflow relies on long-lived unversioned artifacts, STOP for Product Owner disposition.

## 14. Public/package constraints

No package export or package `files` expansion is proposed.

The new internal module must only depend on modules present in the installed package when used by installed-package runtime paths.

Do not import excluded `normalized-failure.js` from the new contract authority unless package evidence proves it is shipped safely without changing package scope.

`SECURITY.md` is expected to require implementation-time synchronization of supported artifact/version/boundary descriptions. This C1 does not edit SECURITY.md.

## 15. TSB-F02 disposition

`TSB-F02 = OPEN / LOW / CONDITIONAL`.

Trigger remains false.

This design does not add a supported dependent consumer of TSB-F02 review gates.

If implementation would introduce one:

`STOP — TSB-F02 OWNER DISPOSITION REQUIRED`.

## 16. SEC-F06-I1 disposition

`SEC-F06-I1 = OPEN / PRESERVED / OUTSIDE SCOPE`.

This design does not redesign the invalid-JSON diagnostic path.

Bounded consumer-side handling of History reason/validation errors does not claim SEC-F06-I1 remediation.

If implementation requires changing SEC-F06-I1 semantics:

`STOP — PRODUCT OWNER SCOPE EXPANSION REQUIRED`.

## 17. Proposed future implementation surface

Production implementation remains NOT AUTHORIZED.

Expected production surface:

- NEW `scripts/ai/triage-boundary-contract.js`
- `scripts/ai/collect-context.js`
- `scripts/ai/collect-history.js`
- `scripts/ai/aggregate-browser-context.js`
- `scripts/ai/analyze-failure.js`
- `scripts/ai/qa-agent-prompt.js` only where refs/History projection need prompt wiring
- `scripts/ai/providers/mock-provider.js` to echo/produce the internal failure refs used by tests/evaluation

Expected test/security/doc surface:

- NEW `scripts/ai/triage-boundary-contract.test.js`
- `scripts/ai/collect-context.test.js`
- `scripts/ai/collect-history.test.js`
- `scripts/ai/aggregate-browser-context.test.js`
- `scripts/ai/analyze-failure.test.js`
- `scripts/ai/qa-agent-prompt.test.js`
- `test/security/aisec-7/triage-cross-project.test.js`
- `test/security/aisec-7/hostile-model-output.test.js`
- `test/security/aisec-7/lib/registry.js`
- `test/installation/external-repository-proof.test.js`
- `SECURITY.md`

Workflow changes are not expected.

If implementation proves workflow mutation is required to establish a trusted current invocation tuple, STOP for Product Owner scope/contract disposition before editing workflows.

## 18. Required test and adversarial matrix

### TSB-F07 context

- valid fresh Cypress context accepted;
- valid fresh Playwright context accepted;
- `{found:false}` and `{found:true, totals, specs[]}` variants accepted as appropriate;
- nullable Cypress stats accepted where current producers allow them;
- Cypress suite/status retained;
- optional Playwright projectId/projectName retained;
- null correlations accepted where legitimate;
- zero-failure `knownProjectConstraints: []` accepted;
- unknown keys rejected;
- malformed/sparse/oversized arrays rejected;
- total `context.json` byte cap enforced;
- relevant-file 20 KiB / 150 KiB limits re-enforced;
- legitimate long assertion-message fixture within chosen bound accepted;
- over-bound message/artifact rejected;
- snapshot mutation/accessor/proxy attacks cannot alter consumed state;
- no provider call after mandatory context rejection.

### XI-01 binding

- wrong projectId rejected;
- copied current projectId plus stale foreign repository/SHA/run rejected (`H05-C2`);
- changed failure-bearing constraints rejected against ProjectProfile snapshot;
- root containment enforced;
- persisted metadata cannot self-authorize expected repository/SHA/run;
- absent trusted CI tuple outside supported CI fails closed unless separately authorized internal trust input exists;
- Playwright triage is not rejected by implicit Cypress default;
- analyzer enforces binding even when raw context remains after aggregator refusal.

### XI-02 History

- valid separate History accepted/projected;
- malformed metrics rejected/downgraded;
- wrong project rejected;
- wrong framework rejected;
- documented Cypress legacy behavior tested if retained;
- unavailable distinct from legitimate zero History;
- embedded `context.history` rejected;
- `H06-C1` proves ineligible separate History cannot survive via embedded context History;
- `H06-C2` proves prompt/report History derive from the same validated projection;
- provider receives only approved aggregate metrics;
- no History read/projection before context validation/XI-01 binding.

### TSB-F04 provider output

- exact valid result set accepted;
- unknown fields rejected;
- missing/duplicate/unknown refs rejected;
- cardinality mismatch rejected;
- refs remain unique for identical failure content through local position identity;
- stale result set rejected when refs differ;
- authoritative title/spec in report comes from local snapshot even if model returns a wrong title/spec;
- model recommended-fix file remains advisory, not authoritative identity;
- oversized fields rejected;
- invalid result causes no report write/downstream side effect;
- `failureRef` omission from final report verified unless separately authorized.

### Zero-failure ordering

- malformed/unbound zero-failure context writes no report;
- valid bound zero-failure context may produce its legitimate no-failure report without provider invocation.

### Regression/package

- TSB-F01/F03/F05/F06 controls remain green;
- package/root export names unchanged;
- installed-package proof updated and passing;
- new internal module requires only shipped runtime dependencies;
- AISEC-7 registry current-behavior FAIL entries for H05-C2/H06-C1/H06-C2 are updated only when implementation actually closes them;
- current seven-job CI remains green.

## 19. Finding-to-control traceability

| Finding | Required closure evidence |
| --- | --- |
| TSB-F04 | closed provider schema; bounded fields; unique local refs; exact result-set binding; authoritative local test identity; fail-before-report tests |
| TSB-F07 | versioned closed non-History context schema; real Cypress/Playwright variants; byte/field/count bounds; authoritative snapshots; producer+consumer validation |
| XI-01 | ProjectProfile/root binding + validated current repository/SHA/run tuple; exact same-run freshness; `H05-C2` fail-closed evidence; analyzer as authoritative gate |
| XI-02 | closed separate History variants; embedded `context.history` rejection; project/framework eligibility; one authoritative projection for prompt/report; `H06-C1` and `H06-C2` closure evidence |

No row may be closed solely as a side effect of another row's control.

## 20. Preserved invariants and debt

Preserve:

- WIP = 1;
- TSB-F01/F03/F05/F06 controls;
- root/package export surface;
- deterministic fail-closed behavior;
- no caller-controlled trust elevation;
- no self-digest-only provenance;
- no implicit stale/replayed context trust;
- bounded persisted/model inputs;
- current finding severities;
- `TSB-F02` OPEN/CONDITIONAL with trigger false;
- `SEC-F06-I1` OPEN/PRESERVED/outside scope;
- unrelated findings/debt unchanged.

`failureRef` proves correlation/set membership, not model truth. AI classification/root-cause text can still be semantically wrong; that remains model-quality risk, not provenance authority.

## 21. STOP conditions for implementation authorization/planning

STOP if review or implementation discovery shows:

- a new root export/package export/signature change is required;
- persisted `failureRef` must become a new supported output field without separate authorization;
- supported direct/local persisted-context analysis cannot work safely without a new trusted invocation contract;
- workflow mutation is required to create trusted current-run identity;
- `SEC-F06-I1` must be remediated in this lifecycle;
- TSB-F02 trigger becomes true;
- cryptographic signing/key management is required;
- a supported legacy artifact workflow requires permissive fallback;
- findings need waiver/re-rating/risk acceptance instead of remediation;
- unrelated production scope is required.

## 22. C1 review disposition map

Architecture corrective coverage:

- `ARCH-B01` — addressed by §§2, 8, 18, 19: XI-02 owns embedded History, authoritative projection, prompt/report equality, H06-C1/C2.
- `ARCH-B02` — addressed by §7: validated current repository/SHA/run tuple, exact same-run freshness, H05-C2.
- `ARCH-M01` — addressed by §12: export surface unchanged but supported artifact/behavior contracts are versioned impacts requiring implementation authorization.
- `ARCH-M02` — addressed by §9.4: authoritative report identity comes from local failed-test snapshot.
- `ARCH-M03` — addressed by §6: real context variants, nulls, zero-failure constraints, long-message policy and total byte cap requirement.
- `ARCH-M04` — addressed by §7.6: default Cypress selector is not trusted framework authority.
- `ARCH-m01` — addressed by §7.1: analyzer is XI-01 gate; aggregator signature unchanged.
- `ARCH-m02` — addressed by §§3, 11: analyzer independently fails closed even if raw context remains.
- `ARCH-m03` — addressed by §11 zero-failure ordering.
- `ARCH-m04` — addressed by §9.2 unique refs using local position/index.
- `ARCH-m05` — addressed by §§14, 17, 18: mock provider, AISEC registry, SECURITY.md, installation proof and package-dependency constraint.
- `ARCH-I03` — addressed by §§5, 8.6: leaf authority and History read after context binding.
- `ARCH-I04` — addressed by §§9.3, 20: refs bind correlation/cardinality, not semantic correctness.

## 23. Lifecycle boundary

This corrected design is ready only for a **new independent exact-head HEAVY Architecture re-review** after exact-head CI succeeds.

Only after Architecture approval may the same exact HEAD proceed to independent HEAVY Security design review.

Implementation: `NOT AUTHORIZED`  
Merge: `NOT AUTHORIZED`  
Finding closure: `NOT AUTHORIZED`
