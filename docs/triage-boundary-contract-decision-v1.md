# Triage Boundary Contract Decision v1

Status: DESIGN / NOT IMPLEMENTED / NOT MERGED  
Authority: `OD-TRIAGE-BOUNDARY-DESIGN — APPROVED`  
Review class: `HEAVY`  
Required independent reviews: Senior Architecture + Security  
Baseline main: `acf127024ea1fe76eb9945e8bbf26d32b54cb772`  
Baseline TREE: `651f40ff95f1f4a6d90739f5ae6f2a15b588c8ab`

## 1. Decision purpose

This document defines the remediation design for the single active WIP:

`TSB-F04 + TSB-F07 + XI-01 + XI-02`.

It is a design contract only. It does not close, waive, re-rate or risk-accept any finding and does not authorize implementation or merge.

The four findings remain separate governance identities even though they share one runtime triage data flow. A single internal contract authority may implement common validation primitives, but closure evidence must remain traceable independently to each finding.

## 2. Canonical finding ownership

### TSB-F04 — provider triage output contract and binding

Canonical problem: provider analysis output is only partially shape-validated and is not strongly bound to the exact failed-test evidence being analyzed. Unknown keys are accepted, result cardinality/order/identity are not closed against the current failed-test set, and a stale, replayed or mismatched result can pass when its loose shape is otherwise acceptable.

TSB-F04 owns:

- the closed provider-result structural contract;
- bounded provider-visible result fields;
- exact result cardinality;
- deterministic binding of each result to the current failed-test input;
- rejection of duplicate, missing, reordered-without-binding, stale or mismatched result identity;
- fail-closed consumption before `ai-report.json` is persisted.

It does not own provider transport retry policy or the separate diagnostic-policy finding `SEC-F06-I1`.

### TSB-F07 — persisted triage context contract, excluding history

Canonical problem: persisted triage context is accepted with permissive shape and insufficient explicit field/cap validation before later triage consumption.

TSB-F07 owns the non-history persisted context boundary, including:

- exact top-level context fields;
- exact nested metadata/test-result/failure/relevant-file/correlation shapes;
- bounded arrays, strings, maps and aggregate sizes;
- rejection of unknown fields at governed persisted boundaries;
- deterministic snapshotting before subsequent use;
- fail-closed read/aggregate/analyze behavior for malformed non-history context.

Embedded/history semantics are excluded from TSB-F07 and remain XI-02.

### XI-01 — current invocation/profile to persisted-context identity binding

Canonical problem: validated current invocation identity and repository root are not, by themselves, sufficient if a structurally plausible persisted context from another project/run can be substituted at the expected path.

XI-01 owns relationship validation between trusted current invocation state and the persisted context consumed by triage. The validator must derive expected identity from trusted, already-validated inputs, not caller-provided trust labels.

At minimum the current invocation must bind persisted context to:

- `ProjectProfile.id` via `context.metadata.projectId`;
- the validated repository-root containment under which the artifact is read;
- project-derived `knownProjectConstraints`, which must equal the authoritative ProjectProfile snapshot;
- framework identity when a trusted runtime-framework identity is available;
- the current run/evidence tuple where the workflow supplies a trusted expected value.

A digest or echoed token is not authenticity. A self-digest must never be the sole provenance control.

### XI-02 — history artifact schema, projection and replay boundary

Canonical problem: history is intentionally cross-run evidence, but its persisted artifact still needs an explicit bounded schema, current-project/framework eligibility and a safe projection before model use. Historical samples must not become an unbounded or cross-project replay channel.

XI-02 owns:

- the `history.json` persisted schema;
- available/unavailable history variants;
- project/framework binding of usable history;
- numeric consistency invariants;
- bounded string/identifier fields;
- projection of only approved aggregate metrics to provider-visible context;
- rejection/downgrade of malformed, wrong-project or wrong-framework history;
- preservation of the semantic distinction between `no usable history` and legitimate zero-count history.

History is allowed to describe prior runs. XI-02 therefore does not require every historical sample to match the current `runId` or commit. Instead the history artifact itself must be produced/consumed under the current validated project/framework boundary and must expose only the bounded aggregate historical evidence intentionally allowed by the contract.

## 3. Boundary ownership matrix

| Boundary | Producer / source | Consumer | Trust owner | Finding |
| --- | --- | --- | --- | --- |
| Provider analysis JSON | LLM/provider | `analyze-failure.js` | closed response schema + exact failed-test binding | TSB-F04 |
| `reports/ai/context.json` non-history fields | collector / browser aggregator | prompt/report/analyzer | closed persisted schema + bounds | TSB-F07 |
| Current invocation ↔ persisted context | validated ProjectProfile/root/runtime framework vs disk artifact | analyzer/aggregator | trusted identity equality and containment | XI-01 |
| `reports/ai/history.json` and provider history projection | history collector / copied artifact | analyzer/prompt | bounded schema + project/framework eligibility + projection | XI-02 |

Overlap is intentional at validation seams, not at finding identity. One validation step may provide evidence for more than one finding only when its assertions are separately traceable.

## 4. Current data flow and trust classification

Current operational flow is:

1. Target bootstrap supplies a ProjectProfile and repository root.
2. `collect-context.js` validates them, collects adapter/runtime evidence and persists `reports/ai/context.json`.
3. `collect-history.js` validates profile/root, aggregates prior CI history and persists `reports/ai/history.json`.
4. Per-browser CI artifacts may be combined by `aggregate-browser-context.js`, which selects a primary failure and persists merged context/history beneath the target repository.
5. `analyze-failure.js` reads persisted context/history, enriches runtime context, constructs prompts and invokes a provider.
6. Provider text is bounded before parse and partially validated after parse.
7. Validated analysis is written into the triage report.

Trust classes:

- Provider output: untrusted / provider-controlled.
- ProjectProfile snapshot: trusted only after the TSB-F05 central inspector.
- Repository root: trusted only after the existing root boundary.
- CI/runtime-framework descriptors: trusted only through their existing validated selectors/configuration boundaries.
- Persisted context/history: repository-local artifacts, but untrusted at read boundaries because files can be stale, substituted, hand-modified or produced by regressed code.
- Test failure content, relevant file content and historical evidence: data/evidence, never authority.

## 5. Alternatives considered

### A. Keep validators local in each caller — REJECTED

Adding unrelated local checks independently to `collect-context.js`, `aggregate-browser-context.js`, `analyze-failure.js` and `collect-history.js` would duplicate contracts and allow producer/consumer drift. It would also make finding-to-control traceability harder.

### B. One internal triage-boundary contract authority — SELECTED

Introduce one non-public internal contract module, tentatively:

`scripts/ai/triage-boundary-contract.js`

It owns canonical validation/snapshot primitives for persisted triage context, history, invocation binding and provider result binding. Existing producers/consumers call this authority at their boundaries.

This is an internal implementation detail. It must not be root-exported or added to package exports.

### C. Signed/encrypted triage artifacts — REJECTED FOR THIS LIFECYCLE

The canonical findings require schema, bounds, provenance/binding and fail-closed consumption. They do not establish a cryptographic authenticity requirement. Adding signing/key management would broaden product/security contracts and authority. Self-digests also do not prove provenance and are explicitly insufficient as a sole control.

## 6. Persisted context contract

Implementation must define a closed `PersistedTriageContextV1` internal contract.

### 6.1 Versioning

Newly written context artifacts should carry an explicit integer `schemaVersion: 1` unless HEAVY review identifies a concrete compatibility blocker. The version is an internal artifact-format discriminator, not a package/public API.

Legacy persisted context without the version is not silently upgraded at read time. The supported CI flow creates fresh context before analysis, so malformed/legacy persisted artifacts may fail closed rather than receive permissive compatibility treatment.

If implementation discovers a required supported legacy consumer that cannot tolerate this rule, STOP for Product Owner disposition before changing the contract.

### 6.2 Closed top-level shape

The persisted form may contain only governed fields required by the current collector/aggregator, including:

- `schemaVersion`
- `generatedAt`
- `metadata`
- `testResults`
- `failedTests`
- `relevantFiles`
- `knownProjectConstraints`
- `warnings`
- optional governed `browserCorrelation`
- optional governed `frameworkCorrelation`

Ephemeral analyzer enrichments such as `relevantKnowledge` are not part of the persisted-context contract unless separately justified by implementation evidence.

### 6.3 Metadata

`metadata` must be a closed object with bounded scalar fields matching current producers, including project/framework/repository/commit/branch/run/event/browser/CI provenance. Nullable/absent semantics must be explicit per field; object/array substitution is rejected.

`projectId` must satisfy the same ProjectProfile identifier semantics already established by TSB-F05. Framework identity must reuse the repository's canonical framework classifier/selector semantics rather than inventing a weaker copy.

### 6.4 Failures and test results

`testResults` must be a closed numeric summary with finite, non-negative integer constraints and internal consistency where the current producer contract makes such a relation meaningful.

`failedTests` must be a dense bounded array of closed normalized-failure snapshots. Fields that are strings must have explicit per-field limits. Nested arbitrary provider/reporter objects are not admitted merely because they are JSON-serializable.

The implementation must derive limits from existing normalized-failure/runtime expectations and measured legitimate fixtures. It must not introduce a materially looser unbounded catch-all.

### 6.5 Relevant files

The contract preserves the existing collector limits:

- per-file content maximum: 20 KiB;
- aggregate relevant-file content maximum: 150 KiB.

The validator additionally closes each entry shape and bounds entry count/path lengths. A persisted artifact that violates the producer limits is rejected rather than trusted because it exists under `reports/ai`.

### 6.6 Constraints and warnings

`knownProjectConstraints` must satisfy the ProjectProfile constraints contract and, for XI-01, equal the authoritative current ProjectProfile snapshot before provider use.

`warnings` must be a bounded dense string array with per-string and aggregate limits. Validation diagnostics must remain bounded and must not dump attacker-controlled values.

### 6.7 Correlation objects

Persisted browser/framework correlation objects must be accepted only through their existing explicit projection vocabulary. Unknown nested evidence fields are rejected. Existing correlation semantics are preserved; this lifecycle does not redesign classification policy.

## 7. XI-01 invocation binding contract

A dedicated internal check such as:

`assertContextBoundToInvocation(contextSnapshot, trustedInvocation)`

must consume only trusted values derived from already validated state.

`trustedInvocation` is not a free-form caller assertion. It is built from:

- the TSB-F05 ProjectProfile snapshot;
- the validated repository root;
- selected runtime framework identity when applicable;
- CI/runtime values whose existing boundary has already established them.

Mandatory equality checks before provider invocation include:

1. `context.metadata.projectId === projectProfile.id`;
2. persisted `knownProjectConstraints` deep-equal the ProjectProfile snapshot constraints;
3. the context file path resolves inside the validated repository root using existing safe path helpers;
4. framework identity is compatible with the trusted selected runtime framework where that selector is available;
5. any run/evidence identity asserted as trusted by the workflow must match the persisted tuple before that tuple is used as provenance.

A failure is a configuration/evidence-boundary failure. It must happen before provider invocation and before report persistence.

Repository name/commit/run identifiers copied from the context are not automatically trusted just because they exist. They become binding assertions only where the current invocation has an independent trusted expected value to compare with.

## 8. XI-02 history contract

### 8.1 Available record

The currently produced available history fields are:

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

The contract must close this object and reject unknown/unbounded nested material.

Numeric invariants already enforced at the analyzer boundary are preserved:

- all four metrics are non-negative integers;
- `passes + failures === runsConsidered`;
- `retryPasses <= passes`.

Explicit caps must also prevent absurd integer magnitudes even when arithmetic remains internally consistent.

### 8.2 Unavailable record

The producer's unavailable marker must receive its own closed bounded variant. Its reason text must be bounded and must not become a generic channel for raw exception/request content.

### 8.3 Eligibility and projection

Existing project/framework eligibility semantics remain the starting invariant. Usable history must match current project identity and framework under the existing canonical rules, including only the specifically documented Cypress legacy compatibility if it is still intentionally supported at implementation time.

Provider-visible history remains a projection of the four aggregate metrics. Bookkeeping/provenance fields are not passed through wholesale.

A malformed or ineligible history artifact becomes `no usable history` before prompt construction; it must never be converted into fabricated zero-history evidence.

## 9. TSB-F04 provider-result contract

The provider response remains bounded before parsing by the existing `MAX_TRIAGE_RESPONSE_CHARS` control from TSB-F06. TSB-F04 adds a closed post-parse contract.

### 9.1 Envelope

The response must be a closed object containing exactly the governed `results` array, subject to an explicit maximum equal to the bounded current failed-test cardinality.

### 9.2 Result item

A result item retains the current semantic fields:

- `test`
- `classification`
- `confidence`
- `summary`
- `rootCause`
- `evidence`
- `recommendedFix`
- `shouldCreateBug`
- `shouldRetry`

The implementation must close the item and nested objects, bound every string/array, preserve existing classification enum and confidence range, and reject symbol/accessor/proxy surprises for direct in-memory test/programmatic calls where applicable.

### 9.3 Exact failed-test binding

Each provider result must carry a deterministic locally generated failure reference that is derived before the provider call from the exact bounded current `failedTests` snapshot. The provider only echoes that reference; it does not create authority.

The selected contract is:

- local code builds one failure reference per current failed test;
- the prompt supplies the reference with that failed test;
- the response must contain exactly one result for every expected reference;
- no unknown reference, duplicate reference or omission is allowed;
- result count must exactly equal expected failure count;
- local code compares references against the authoritative pre-call snapshot before report creation.

The reference may use a deterministic canonical identifier/fingerprint for compactness, but the implementation must also retain the authoritative expected reference set locally. The identifier is a correlation/binding token, not cryptographic proof of provenance. A self-digest alone cannot establish trust.

This prevents shape-valid results for a different test set from being silently accepted.

### 9.4 Stale/replay boundary

A provider result from an older call is acceptable only if it exactly matches the current authoritative failure-reference set and current closed schema; otherwise it fails. No persisted prior provider output is granted authority merely because its JSON is syntactically valid.

## 10. Snapshot and TOCTOU semantics

Validators must return detached authoritative snapshots rather than validate one object and later reread caller-controlled mutable state. The ProjectProfile TSB-F05 design is the precedent for this boundary discipline.

For disk JSON this primarily protects subsequent in-memory mutation/programmatic calls; for direct callers it additionally prevents accessor/proxy/TOCTOU behavior from turning validation into a check-then-use gap.

Implementation should prefer a single inspection pass per governed object where practical. Revalidation may be used only at explicit serialization/deserialization boundaries, not as a substitute for retaining the validated snapshot.

## 11. Fail-closed ordering

For `analyze-failure` the required order is:

1. validate ProjectProfile/root and construct trusted invocation state;
2. read bounded file bytes / parse JSON under existing path controls;
3. validate/snapshot persisted context;
4. enforce XI-01 binding;
5. validate/project history under XI-02;
6. compute permitted runtime enrichment;
7. construct bounded prompt from authoritative snapshots;
8. invoke provider;
9. enforce TSB-F06 raw response bound;
10. parse provider JSON;
11. validate closed TSB-F04 response and exact failure binding;
12. only then construct/persist report or perform downstream side effects.

No provider call may happen after a mandatory context/binding failure.

Aggregation must validate each consumed persisted artifact before selecting/copying it and must validate the merged persisted snapshot before writing it.

## 12. Migration and compatibility

This remediation intentionally tightens internal artifact acceptance. Compatibility policy is fail-closed rather than silently normalizing arbitrary old files.

Supported current CI remains compatible because context/history are freshly produced by the same code path before analysis. Tests and target wrappers must be updated to produce the new exact internal artifact version/shape.

If repository evidence during implementation proves that a currently supported workflow intentionally analyzes long-lived pre-contract context artifacts, that is a design-impacting discovery and requires STOP/PO disposition rather than an undocumented permissive fallback.

Provider prompt/output compatibility will change because results gain the locally generated failure reference and closed limits. This is an internal provider protocol, not a package-root API. Mock/provider tests must be migrated in the same implementation PR.

## 13. Public and package surface

Decision:

`PUBLIC API IMPACT = NONE`

`PACKAGE IMPACT = NONE`

The new contract module and validation helpers remain internal. No new root export, package export key, package version or published public contract is required.

If implementation discovers that a root/public export is necessary, STOP — the present authorization does not cover a new public contract decision.

## 14. TSB-F02 disposition

`TSB-F02 = OPEN / LOW / CONDITIONAL`.

This design does not add a new supported dependent consumer of the conditional review-gate functions covered by TSB-F02 and therefore does not trigger it.

If implementation design changes would create such a consumer, STOP before implementation authorization because the TSB-F02 condition would become true.

## 15. SEC-F06-I1 disposition

`SEC-F06-I1 = OPEN / PRESERVED / OUTSIDE SCOPE`.

This design may require bounded validation error codes/messages, but it does not redesign or claim to remediate the separate SEC-F06-I1 diagnostic finding. Existing fixed provider-error sanitization remains unchanged.

If implementation cannot satisfy the four authorized findings without changing the semantic area owned by SEC-F06-I1, STOP for Product Owner disposition.

## 16. Proposed implementation surface

Production implementation is NOT authorized. If later authorized, the expected narrow production surface is:

- NEW `scripts/ai/triage-boundary-contract.js`
- `scripts/ai/collect-context.js`
- `scripts/ai/collect-history.js`
- `scripts/ai/aggregate-browser-context.js`
- `scripts/ai/analyze-failure.js`
- `scripts/ai/qa-agent-prompt.js` only as needed to carry/render the new failure reference and authoritative projected context

Expected test surface:

- NEW `scripts/ai/triage-boundary-contract.test.js`
- `scripts/ai/collect-context.test.js`
- `scripts/ai/collect-history.test.js`
- `scripts/ai/aggregate-browser-context.test.js`
- `scripts/ai/analyze-failure.test.js`
- `scripts/ai/qa-agent-prompt.test.js`
- `test/security/aisec-7/triage-cross-project.test.js`
- `test/security/aisec-7/hostile-model-output.test.js`
- installation/package-boundary tests only if needed to prove no export/package drift

Target wrappers may require test fixture adjustments but must not receive weaker duplicate validators.

No workflow file is expected to change.

## 17. Required test and adversarial matrix

A future implementation must prove at minimum:

### Context / TSB-F07

- valid fresh collector artifact accepted;
- unknown top-level/nested keys rejected;
- missing mandatory fields rejected;
- wrong primitive/container types rejected;
- sparse/oversized arrays rejected;
- per-string and aggregate limits enforced;
- relevant-file 20 KiB/150 KiB producer limits re-enforced on consumption;
- malformed correlations rejected;
- direct mutation/accessor/proxy cases cannot alter authoritative snapshot after validation;
- no provider call occurs after context rejection.

### Binding / XI-01

- wrong `projectId` rejected;
- correct shape but another ProjectProfile rejected;
- changed `knownProjectConstraints` rejected against trusted profile snapshot;
- cross-project context copied into the current repository rejected;
- framework mismatch rejected when a trusted selected framework exists;
- caller-supplied untrusted labels cannot elevate trust;
- repository path remains under validated root.

### History / XI-02

- valid available history accepted/projected;
- malformed metric types rejected/downgraded to unavailable;
- arithmetic inconsistency rejected;
- wrong project rejected;
- wrong framework rejected;
- documented legacy Cypress rule tested explicitly if retained;
- unknown nested fields/oversized identifiers/reasons rejected;
- unavailable marker remains distinct from zero-count usable history;
- provider sees only approved aggregate metrics;
- cross-project history replay test remains fail-closed.

### Provider output / TSB-F04

- exact valid result set accepted;
- unknown envelope/item/nested fields rejected;
- missing/duplicate/unknown failure reference rejected;
- result count mismatch rejected;
- valid result for another failed test rejected;
- reordered results either reject or resolve strictly by unique expected reference, never by unchecked title alone;
- stale prior-run result set rejected when current failure set differs;
- oversized strings/arrays rejected after parse;
- existing classification/confidence invariants preserved;
- `recommendedFix` closed schema enforced;
- arbitrary-wait warning behavior preserved;
- malformed response causes no report write or downstream side effect.

### Regression / package

- TSB-F01/F03/F05/F06 controls remain passing;
- root export names/package export keys unchanged;
- installed-package proof remains passing;
- current 7-job CI remains green.

## 18. Finding-to-control traceability

| Finding | Required control evidence |
| --- | --- |
| TSB-F04 | closed provider envelope/item schemas; bounded fields; exact failure-reference set/cardinality binding; fail-before-report tests |
| TSB-F07 | closed versioned persisted-context schema; bounds/caps; authoritative snapshots; producer+consumer validation tests |
| XI-01 | trusted Profile/root/framework-derived expected identity; project/constraint/path/framework equality checks; cross-project substitution tests |
| XI-02 | closed history variants; project/framework eligibility; bounded metrics/metadata; provider projection; replay/mismatch tests |

A future closure package must report each row separately even if the same implementation primitive contributes evidence to multiple rows.

## 19. Preserved invariants and debt

This design must preserve:

- WIP = 1;
- TSB-F01/F03/F05/F06 existing controls;
- current package/public API surface;
- deterministic fail-closed behavior;
- no caller-controlled trust elevation;
- no self-digest-only provenance assumption;
- no implicit trust in stale/replayed evidence;
- no uncontrolled unbounded input;
- current finding severities;
- `TSB-F02` OPEN/CONDITIONAL with trigger false;
- `SEC-F06-I1` OPEN/PRESERVED/outside scope;
- `ARCH-F06-I1..I4` and other unrelated debt/findings unchanged.

This design does not authorize Controlled-v1 productization, qa-agent-demo, MEM/RAG/LEARN, Controlled Release or Full Autonomy.

## 20. STOP conditions for implementation planning

STOP and return to the Product Owner if independent review or implementation discovery shows any of the following:

- a public/package API change is required;
- the four findings cannot remain independently traceable;
- SEC-F06-I1 semantics must be changed to satisfy this lifecycle;
- the proposed architecture triggers TSB-F02;
- cryptographic signing/key management is actually required;
- a supported legacy artifact workflow requires permissive fallback not described here;
- a new unrelated finding must be remediated in the same code change;
- findings must be re-rated/waived/accepted rather than remediated;
- implementation would require workflow/release/productization activation outside later explicit authority.

## 21. Lifecycle boundary

This document is ready only for independent exact-head HEAVY Architecture and Security review once its design PR has exact-head CI success.

Implementation: `NOT AUTHORIZED`  
Merge: `NOT AUTHORIZED`  
Finding closure: `NOT AUTHORIZED`
