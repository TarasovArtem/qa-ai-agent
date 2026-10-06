# AISEC-5 — Agentic Security Verification Strategy v1

Status: CURRENT research/design proposal; implementation of the strategy document only.
Authorization: `OD-AISEC-5-RESEARCH — APPROVED`. Management issue: #214.
Review class: HEAVY. Research date: 2026-10-06.

This document defines verification obligations, not security controls or a
security certification. Independent Senior and Security review, owner
disposition, merge authorization and canonical closure remain separate lifecycle
steps. A requirement below is not evidence that its property already holds.

## 1. Scope and non-goals

Translate AISEC-1 through AISEC-4 claims into reproducible evidence requirements
for implementers, reviewers, governance automation and future release gates.
Cover supported triage/RTI APIs, repository-only CI/reporting, private #22/#23
libraries and the proposed future memory/retrieval/learning boundaries separately.
The exact artifact scope is this new file only.

No security control, test harness, production code, workflow, public API,
provider, publishing behavior, finding disposition or roadmap state changes.
AISEC-6/7, MEM/RAG/LEARN and the Type & Schema Boundary Audit are not activated.
This strategy does not approve Controlled Release or increased autonomy.

## 2. Exact repository baseline

| Property | Authorized value |
|---|---|
| Repository | `TarasovArtem/qa-ai-agent` |
| Branch | `research/aisec-5-agentic-security-verification-strategy` |
| Baseline main / starting branch HEAD / required commit parent | `92f2fe360d657e0677001188f0bc5cc6d30ce0a3` |
| Baseline TREE | `90c001183c850af8944caff11622aac7f764314e` |
| Authorized new file | `docs/agentic-security-verification-strategy-v1.md` |
| Management issue | #214, OPEN at preflight; research/design phase authorized |
| Preflight | Fetch, remote main/branch equality, checked-out HEAD/TREE equality and clean working tree confirmed |

The implementation HEAD/TREE will be recorded in the delivery report, not
invented inside the document that determines that commit's tree. Source
observations below refer to this baseline. Historical predecessor baseline and
settings observations retain their dates and scopes; they are not fresh deployed
platform evidence. The [ROADMAP](../ROADMAP.md) records AISEC-4 research/design
closure and the immutable XI disposition; issue #214 authorizes this phase.

## 3. Methodology and evidence-strength vocabulary

Read predecessor research as claims to investigate, then inspect relevant
source branches, test assertions, workflow declarations and normative guards.
Use function/configuration anchors in [section 30](#30-inspected-evidence-references)
to bind observations; targeted inspection is not an audit of every source line.
Split compound claims where their premises have different evidence strengths.

| Basis | Meaning / allowed interpretation |
|---|---|
| REPOSITORY_OBSERVED | Inspected tracked code/config at the baseline establishes a branch or declaration; not a live exploit, permission or platform observation |
| PREDECESSOR_RESEARCH | A named predecessor records the claim and its original limits; retain its qualification until independently established here |
| DEMONSTRATED_BY_EXISTING_TEST | An inspected existing test actually exercised the named assertion and passed in the recorded local run; applies only to those fixtures, seam and runtime |
| SUPPORTED_INFERENCE | Consequence follows from named premises and actor/preconditions; no demonstrated endpoint or sensitive disclosure |
| UNKNOWN | Required property, deployment fact or independent reproduction is unavailable; never a successful result |
| FUTURE_CONTROL | Acceptance property or unimplemented capability requiring separate authorization; never credited as current mitigation |

These are evidence bases, not verification outcomes or runtime enums. A known
source gap can support FAIL for a precisely specified control obligation without
demonstrating an exploit. A conclusion cannot outrank its weakest necessary
premise. A fake-response test does not establish vendor membership enforcement.

Local evidence run: existing `qa-agent-prompt.test.js`,
`requirements-source-provider.test.js` and `providers/provider-contract.test.js`
passed together with Node's test runner on Windows, Node v24.21.0, on
2026-10-06. Command: `node --test --test-reporter=dot` with the three exact
paths under `scripts/ai/`. This local run is not the repository's declared
Node 22 CI runtime or fresh exact-head CI evidence. The inspected prompt assertions concern
field projection/framing; loader assertions establish whole-load rejection,
duplicate handling and preservation of the original `.cause` separately from the
bounded outer message. Provider-contract tests concern interface/response shape.
No bespoke hostile probe, real network security test, vendor call or real-secret
inspection was performed. Other test files cited below were inspected selectively
as future reuse candidates, not credited as locally demonstrated in this mission.

## 4. Verification principles

Specify an atomic property, consumption boundary, actor, precondition and denied
side effect before selecting a method. Assert outcomes and attempted effects,
including request/write/spawn counts; a guard's name, a prompt sentence or a green
suite without the necessary assertion is insufficient. Keep a benign positive
case so a test that refuses every operation cannot falsely prove the boundary.

Separate structural integrity, authenticated identity, authorized use, semantic
content and confidentiality. Prove a narrow current control without certifying
its stronger missing neighbor. Treat the model as potentially fully persuaded:
deterministic authority gates must hold even for hostile schema-valid output.
Label every expected-current behavior separately from future acceptance.

Record observation and expectation independently. An expected denied operation
can produce PASS for a rejection property; denial is not automatically FAIL.
A successful operation with missing authorization evidence is not PASS for an
authorization claim. No count of successful cases cancels a contradictory case.

## 5. Verification taxonomy

| Type | Purpose / suitable claims | Unsuitable claims | Required evidence | Common false positive | Fail-closed behavior |
|---|---|---|---|---|---|
| VTYPE-STATIC | Inspect executable branch, config declaration, contract and call reachability | Successful runtime isolation, vendor permission, semantic model obedience | Exact file/blob, function, data-flow trace, limits and alternatives searched | Reading a comment as enforcement | INSUFFICIENT_EVIDENCE if executable branch cannot be traced; FAIL if it contradicts the required property |
| VTYPE-UNIT | Deterministic projection, schema, policy, digest and classifier assertions | Complete end-to-end provenance, deployment permissions | Exact test/assertions, fixtures, runner/version, completion and outputs | Testing only valid shape or only rejection | Missing assertion/execution means INSUFFICIENT_EVIDENCE; violation means FAIL |
| VTYPE-INTEGRATION | Verify a multi-component consumption-to-effect boundary | Vendor authorization with only fake transport | Entry/consumer identities, dependencies, effect intercepts, positive/negative fixtures | Testing a helper while production entry bypasses it | Uncovered reachable alternate seam means INSUFFICIENT_EVIDENCE |
| VTYPE-SYNTHETIC | Safe fake transports, canary movement and response-dependent diagnostics | Real secret disclosure or live remote exploitation | Dummy data origin, intercepted envelope, reached sink and absence of real endpoints | Canary in `.cause` called remote exfiltration | Mark unobserved downstream transitions INSUFFICIENT_EVIDENCE |
| VTYPE-ADVERSARIAL | Hostile inputs, replay, cross-project mismatch and worst-case model output in isolation | Universal immunity or permission to attack a service | Threat/preconditions, safe containment, attack corpus, effect traces, semantic assertions | Searching for one forbidden phrase instead of measuring authority | Corpus alone cannot PASS untested boundary variants; violations FAIL |
| VTYPE-CI | Corroborate exact automated execution required by governance | Human security approval, release permission or absent security assertions | Workflow/run/attempt/event/head/base/jobs, completed conclusions, test reports | Workflow success mistaken for all security obligations passed | Partial/skipped/stale evidence means INSUFFICIENT_EVIDENCE |
| VTYPE-IDENTITY | Establish exact content, repository, topology and evidence correspondence | Authenticating a reviewer from a name or digest | Trusted lookup and content/topology verification, source chain, collection time | Matching copied labels called authentication | Wrong/ambiguous identity means INSUFFICIENT_EVIDENCE for certification |
| VTYPE-MANUAL | Independent architecture/security judgment, residual paths, model semantics and human factors | Replacing deterministic tests or owner risk authority | Exact subject, reviewer identity/independence, reviewed scope, findings and limitations | Author role-switch called fresh independence | Unestablished required independence means INSUFFICIENT_EVIDENCE |
| VTYPE-OWNER | Explicit policy/risk/scope/lifecycle decision by the authorized owner | Proving technical remediation or changing evidence outcomes | Decision identity, owner authority, exact scope/conditions, referenced evidence | Technical approval treated as merge/risk acceptance | OWNER_DISPOSITION_REQUIRED until the decision exists |

Multiple types may support one requirement; they are complementary. In the
register, short labels STATIC, UNIT, INTEGRATION, SYNTHETIC, ADVERSARIAL, CI,
IDENTITY, MANUAL and OWNER denote these exact VTYPE names.

## 6. Result semantics

| Outcome | Meaning | Progression |
|---|---|---|
| PASS | The defined property is demonstrated with sufficient evidence bound to required identity and scope | Technical result only; applicable owner/lifecycle gates still apply |
| FAIL | Evidence contradicts the specified invariant/control/property | Do not certify the property; record counterexample and required corrective/disposition |
| INSUFFICIENT_EVIDENCE | Proof is missing, stale, ambiguous, partial, malformed or not independently reproducible | Stop certification; obtain valid evidence, never default to PASS |
| OWNER_DISPOSITION_REQUIRED | Technical observations are known, but policy, risk, scope or lifecycle progression needs an authorized owner decision | Keep technical results visible and wait for the scoped decision |

NOT_APPLICABLE is intentionally not adopted as a fifth security outcome here.
An excluded capability must have owner-scoped applicability and verified disabled
paths, not an unexplained exemption. Existing governance NOT_APPLICABLE records
retain their own contract and do not automatically discharge an SVR requirement.

Record technical outcome and owner dependency as separate fields. FAIL or
INSUFFICIENT_EVIDENCE cannot be overwritten by OWNER_DISPOSITION_REQUIRED.
Aggregate conservatively: any applicable FAIL prevents all-pass certification;
otherwise any insufficient obligation prevents it; even all technical PASS
requires outstanding owner decisions before progression. UNKNOWN and
SUPPORTED_INFERENCE never collapse into demonstrated PASS.

## 7. Evidence identity and invalidation

Every execution/review record binds repository, branch, base SHA, HEAD SHA,
TREE SHA, and relevant ordered parents/topology. Record PR number when present;
workflow path/name/definition revision; run ID, attempt and event; run head/base;
actual checkout/executed SHA/TREE when different from the PR head; expected job
names and all conclusions; test selection, assertions, runner/platform; artifact
name/content digest, producer run and collection method; reviewer identity,
role, independence and exact scope. A PR-associated run head is not alone proof
of the actual checked-out content: establish that mapping where execution uses
a merge ref. Never label a missing field as verified by copying the expectation.

Evidence also carries creation/collection times, immutable content reference,
trusted collection seam, expiry/drift dependencies, and authority decision IDs.
Repository/host equality does not establish logical project authorization.
Resolve relevant project/source/destination/invocation joins independently.

| Change or defect | Invalidation / allowed refresh |
|---|---|
| New HEAD, corrective commit, changed TREE or required base | Exact-head tests/reviews lose current certification; refresh CI and required independent exact-head reviews under existing governance |
| Changed test fixture, assertion, runner, dependency or workflow | Re-run affected proof and dependent requirements; re-establish execution/workflow identity |
| Wrong event/base/head or similarly named workflow | Cannot substitute; collect the required exact run |
| PR CI available but required post-merge push CI absent | PR evidence remains PR evidence; post-merge certification is INSUFFICIENT_EVIDENCE |
| New run attempt or rerun | Record attempt and prior failure lineage; apply existing governance rerun qualification, never select a green attempt silently |
| Doc/reference bytes or security policy changed | Revalidate the reviewed version and impacted acceptance contract; retain prior version as historical |
| Copied digest/label without collection trust chain | Integrity assertion only; provenance/authorization proof absent |
| Mutable external settings, tokens, audiences or deployed host changed | Refresh affected deployment proof; historical settings cannot certify current state |
| Contradictory evidence | Preserve both sources, resolve authority/version/identity; no successful aggregate while unresolved |

Targeted refresh can be enough for a separately identified mutable external
fact when the authorized owner/reviewer confirms the dependency analysis and
unchanged exact subject. Content-independent evidence reuse requires explicit
governance permission, rationale and continued scope/provenance validity. It
cannot carry an old security review onto a corrective HEAD. Complete
re-verification is required when identity/trust roots, authority-bearing code,
workflow provenance, scope or dependency closure cannot be established. This
strategy creates no exception to merge/review/post-merge policy.

## 8. Fail-closed rules

| Condition | Required result / rationale |
|---|---|
| Missing evidence | INSUFFICIENT_EVIDENCE: no observation supports the claim |
| Malformed evidence | INSUFFICIENT_EVIDENCE: cannot trust the record; if testing an evidence validator that accepts it, that rejection property FAILS |
| Ambiguous identity | INSUFFICIENT_EVIDENCE: cannot bind the observed behavior to this subject |
| Stale evidence | INSUFFICIENT_EVIDENCE: historical result does not certify current state |
| Wrong HEAD/TREE | INSUFFICIENT_EVIDENCE for certification; FAIL if a tested gate accepts the mismatching subject |
| Wrong project/repository at consumption | FAIL when an unauthorized operation crosses a defined deny boundary; absent authentic scope yields INSUFFICIENT_EVIDENCE rather than inferred authorization |
| Untrusted provenance | INSUFFICIENT_EVIDENCE for claimed authenticity; accepting it as authority contradicts a defined invariant and FAILS |
| Partial execution | INSUFFICIENT_EVIDENCE: remaining assertions were not exercised |
| Skipped security-critical assertion | INSUFFICIENT_EVIDENCE even if suite/workflow conclusion is success |
| Unexpected adapter/provider behavior | FAIL for a demonstrated contract violation; INSUFFICIENT_EVIDENCE for unobserved downstream consequences |
| Unknown authorization | OWNER_DISPOSITION_REQUIRED when an identifiable owner must decide policy; INSUFFICIENT_EVIDENCE if actor/authority cannot be established; no side effect authorized by either |
| Incomplete boundary coverage | INSUFFICIENT_EVIDENCE: helper success cannot certify alternate consumers |
| Contradictory sources | INSUFFICIENT_EVIDENCE while unresolved; keep any already demonstrated violation as FAIL |

These outcomes govern verification, not an invented runtime error API. A later
implementation must define its own refusal behavior in its authorized contract.

## 9. AISEC-1 verification mapping

AISEC-1 owns AT-01 through AT-16 and SEC-I1 through SEC-I10. Research refinement
is not finding closure or re-rating. The following maps every scenario to
register requirements with concrete positive/negative evidence in section 18.

| Source | Obligations | Required negative focus / closure prerequisite |
|---|---|---|
| AT-01 | SVR-001, SVR-003, SVR-016 | Hostile requirements cannot increase authority; framing alone insufficient |
| AT-02 | SVR-002, SVR-003, SVR-010 | Allowed repository text remains data; test selection and semantic consequences separately |
| AT-03 | SVR-004, SVR-015, SVR-028 | Re-enter generated/output/persisted data without trust promotion |
| AT-04 | SVR-018 | Authorized cross-vendor mapping versus wrong valid destination |
| AT-05 | SVR-008, SVR-026, SVR-028 | Matching labels on wrong root/context cannot establish authorization |
| AT-06 | SVR-003, SVR-017, SVR-020 | Hostile schema-valid response; trusted adapter code is not isolated |
| AT-07 | SVR-005, SVR-006, SVR-007 | Forged/replayed approval and split presentation; authentic human decision independently required |
| AT-08 | SVR-019 | Unknown write outcome, reinvocation and durable duplicates |
| AT-09 | SVR-031, SVR-032 | Package/dependency/runner provenance; monitoring is not proof of absence of malicious code |
| AT-10 | SVR-029, SVR-036 | Future stored hostile content cannot acquire instruction authority |
| AT-11 | SVR-029, SVR-036 | Future foreign-scope retrieval denied before relevance |
| AT-12 | SVR-002, SVR-020, SVR-024 | Exact prompt fields versus richer artifacts and audiences |
| AT-13 | SVR-021, SVR-022, SVR-023 | Header/diagnostic/log channels tested separately |
| AT-14 | SVR-030, SVR-033, SVR-034 | Candidate cannot supply its own oracle or independent approval |
| AT-15 | SVR-001, SVR-010, SVR-034 | Generated governance prose cannot change authority or policy |
| AT-16 | SVR-006, SVR-008, SVR-018, SVR-020 | Legitimate credential/tool must not serve unauthorized data/target |

| Invariant | Requirement IDs | Current limit |
|---|---|---|
| SEC-I1 | SVR-001, SVR-003, SVR-004 | Framing/structural checks are not general semantic immunity |
| SEC-I2 | SVR-001, SVR-006, SVR-012 | Proposal-to-action and caller authenticity are separate |
| SEC-I3 | SVR-020, SVR-021, SVR-022 | Header-only keys do not sanitize arbitrary source/error text |
| SEC-I4 | SVR-008, SVR-018, SVR-025 | Target labels are not authenticated permission |
| SEC-I5 | SVR-004, SVR-007 | Reframing and validation do not validate all semantics |
| SEC-I6 | SVR-028, SVR-029 | Future retrieval-time trust needs separate implementation |
| SEC-I7 | SVR-026, SVR-029 | XI scope joins and future retrieval isolation remain unimplemented |
| SEC-I8 | SVR-007, SVR-009, SVR-033 | Content integrity, replay lifetime and authenticated decision differ |
| SEC-I9 | SVR-019 | Current no-write-retry does not provide durable idempotency |
| SEC-I10 | SVR-030, SVR-034 | Author-run validation cannot serve as independent approval |

## 10. AISEC-2 injection verification mapping

Design direct requirement attacks, indirect errors/knowledge/repository text,
cross-source conflicting instructions, encoded/nested text and malicious output
as distinct fixtures. Observe system/data precedence and actual effect attempts,
not just the presence of a DATA-boundary sentence. Synthetic malicious model
output can deterministically exercise post-response authority gates without
proving that a real model resists persuasion. Later separately authorized model
evaluations must record provider/model/version/config, corpus, repetitions and
human rubric; success supports only that sample, never universal resistance.

Semantic assertions inspect permitted fields, provenance, classification/policy,
approved operations and effect counts. Exact strings are appropriate for a
closed deterministic error code or enum, not arbitrary model narrative.
Refusal, bounded failure and schema-valid but hostile free text require separate
oracles. Retain poisoned persisted-context cases even where ordinary collector
inputs do not produce them. PI ratings/statuses remain in their owner artifact.

| PI records | Requirement IDs | Specific evidence target |
|---|---|---|
| PI-01 | SVR-001, SVR-003, SVR-016 | Requirement instructions cannot grant tool authority |
| PI-02 | SVR-002, SVR-021 | Dummy credentials excluded from defined payload channels |
| PI-03 | SVR-002, SVR-003 | Allowed repository text with conflicting instruction |
| PI-04 | SVR-015, SVR-022, SVR-023 | Raw execution record versus redacted C7 prompt copy |
| PI-05 | SVR-003, SVR-017 | Invalid and hostile-valid provider outputs |
| PI-06 | SVR-004 | Every generated-content re-entry independently framed and gated |
| PI-07 | SVR-007, SVR-010, SVR-011 | Multi-hop malicious file content still subject to exact review/scope |
| PI-08 | SVR-005, SVR-006 | Persuasive rationale distinguished from trusted review facts |
| PI-09 | SVR-001, SVR-034 | Claimed governance approval in prose grants nothing |
| PI-10 | SVR-010 | Protected path and normalization variants |
| PI-11 | SVR-012, SVR-014 | Runner selection versus loaded-code authority |
| PI-12 | SVR-018, SVR-019 | Destination mapping and durable effects |
| PI-13 | SVR-003, SVR-004, SVR-021 | Encoded/quoted/nested attacks and redaction limits |
| PI-14 | SVR-026, SVR-027, SVR-029 | Current copied reports distinguished from future retrieval |
| PI-15 | SVR-029, SVR-036 | Future promotion/persistence cannot grant trust |

## 11. AISEC-3 tool, privilege and credential mapping

E3/E4/E5 establish targeted current source observations: the generic loader
preserves `.cause`; Azure serializes rejected `queryType`; Azure publishing
distinguishes global-stop failures from item-local invalid successful responses;
comment upsert matches a marker on the first page without an author gate.
E6/E7 show apply-time canonical package reconstruction, digest/path checks,
targeted runner mapping and filtered environment. These do not establish a human
principal, authorized checkout or post-launch sandbox.

| TB record | Requirement IDs | Positive / hostile / provenance obligation |
|---|---|---|
| TB-01 | SVR-006, SVR-007 | Valid content plus independently authenticated human versus forged name/digest |
| TB-02 | SVR-008 | Approved authorized root versus identical foreign checkout |
| TB-03 | SVR-009 | Permitted operation lifetime versus restore-and-reapply replay |
| TB-04 | SVR-008, SVR-026 | Authenticated project join versus caller-consistent labels |
| TB-05 | SVR-018 | Approved mapping versus wrong org/project with valid dummy token |
| TB-06 | SVR-018, SVR-021 | Authorized content class versus hostile/sensitive-looking text; escaping not declassification |
| TB-07 | SVR-023, SVR-025 | Bounded permitted comment versus malicious Markdown/mentions/canaries |
| TB-08 | SVR-025 | Intended bot target versus foreign-author marker and beyond-page target |
| TB-09 | SVR-008 | Host-authorized root versus another valid caller directory |
| TB-10 | SVR-010 | Supported OS path forms versus ADS/short-name/trailing-name aliases |
| TB-11 | SVR-011 | Stable topology versus swap/rollback races; limits explicitly recorded |
| TB-12 | SVR-014 | Approved launch is not evidence of permitted loaded-code effects |
| TB-13 | SVR-012 | Targeted argv versus flags/glob/regex steering; zero spawn on unsafe target |
| TB-14 | SVR-013, SVR-014 | Env exclusion versus ambient file credentials and sibling reads |
| TB-15 | SVR-016, SVR-020 | Trusted initial host/project versus env/site substitution and redirects |
| TB-16 | SVR-003, SVR-020, SVR-032 | Minimal interface versus executable adapter authority |
| TB-17 | SVR-024, SVR-032 | Tracked CI permissions versus actual runner/checkout/artifact authority |
| TB-18 | SVR-005, SVR-006, SVR-014 | Persuasion, fabricated approval and execution traced as a compound path |
| TB-19 | SVR-019 | No automatic write retry versus manual/concurrent duplicate creation |
| TB-20 | SVR-032, SVR-033 | Same-repo workflow provenance/secret reach with predecessor inference and settings-date qualification |

All TB statuses/ratings are unchanged. Product/source/destination instances are
trusted executable dependencies, not capability sandboxes. Governance's
`trusted-context.js` validates context shape; its trust label does not authenticate
the caller. No live authenticated adapter is established by this research or
by an operator-supplied label. `PLATFORM_AUTHENTICATED` may be credited only with
independent proof of the actual authenticated collection seam and its chain.

## 12. AISEC-4 exfiltration and isolation mapping

Map every DE/XB surface and VR4 handoff rather than treating egress as one sink.
Capture exact prompt/provider payloads separately from full context/report,
generated content, logs, comments, screenshots, CI artifacts and process output.
Host, repository, project, provider account/org and publishing destination are
different identities. Retention/audiences and actual disclosure remain UNKNOWN
without appropriately authorized evidence.

| AISEC-4 inventory | SVR obligations |
|---|---|
| DE-01/02/03; XB-14 | SVR-002, SVR-020, SVR-021: payload, executable provider trust, account authorization and transport |
| DE-04/05/06; XB-06/07 | SVR-016, SVR-017, SVR-022: source scope, IDs, lossy RTI projection and diagnostics |
| DE-07; XB-15 | SVR-018, SVR-019: mapping, creates, ambiguity and replay |
| DE-08; XB-04 | SVR-020, SVR-027, SVR-032: env-selected API host and history scope |
| DE-09/10/11/12/13; XB-05 | SVR-023, SVR-024, SVR-026, SVR-028: logs, richer reports, same-run import, media and retention |
| DE-14; XB-16 | SVR-025: report origin, PR audience and marker semantics |
| DE-15; XB-08/09/10 | SVR-005 through SVR-011: canonical content versus root/actor/replay/write authority |
| DE-16/17; XB-11/12/13 | SVR-012 through SVR-015, SVR-022: launch, env, host authority and raw-output re-entry |
| DE-18/19/20 | SVR-014, SVR-030 through SVR-034: SUT/tool/dependency traffic, eval and governance evidence |
| XB-01/02/03 | SVR-026, SVR-027, SVR-028: profile/root/context/history joins |

| DXI invariant | SVR obligations |
|---|---|
| DXI-01 | SVR-018, SVR-020, SVR-026 |
| DXI-02 | SVR-006, SVR-007, SVR-008, SVR-015 |
| DXI-03 | SVR-018, SVR-019 |
| DXI-04 | SVR-008, SVR-016, SVR-018, SVR-028 |
| DXI-05 | SVR-002 |
| DXI-06 | SVR-021 |
| DXI-07 | SVR-015, SVR-022 |
| DXI-08 | SVR-024, SVR-026, SVR-027, SVR-028 |
| DXI-09 | SVR-006, SVR-008, SVR-034 |
| DXI-10 | SVR-014 |
| DXI-11 | SVR-016, SVR-020 |
| DXI-12 | SVR-023, SVR-024, SVR-025 |
| DXI-13 | SVR-015 |
| DXI-14 | SVR-028 |
| DXI-15 | SVR-029 |
| DXI-16 | SVR-029, SVR-030, SVR-036 |

| VR4 future input | Strategy requirements / limits |
|---|---|
| VR4-01 | SVR-008, SVR-026: consumption identity, not merely input shape |
| VR4-02 | SVR-008, SVR-012: equivalent foreign root and missing-root refusal |
| VR4-03 | SVR-005, SVR-006, SVR-007: presentation/content/authenticity separately |
| VR4-04 | SVR-007, SVR-008: independently relabelled chain |
| VR4-05 | SVR-015: chain/category/attempt/origin/freshness |
| VR4-06 | SVR-016, SVR-017, SVR-020: source/provider mapping before projection |
| VR4-07 | SVR-018: authorized cross-vendor mapping remains possible |
| VR4-08 | SVR-024, SVR-025, SVR-026, SVR-027, SVR-032: copied/env/artifact identity |
| VR4-09 | SVR-002, SVR-004, SVR-027: all C1–C7 fields and embedded-history fallback |
| VR4-10 | SVR-021, SVR-022, SVR-023: dummy canaries at each transition |
| VR4-11 | SVR-026, SVR-027, SVR-028: stale/foreign imports |
| VR4-12 | SVR-022 through SVR-025: records versus logs/artifacts/comments |
| VR4-13 | SVR-013, SVR-014, SVR-024, SVR-032: actual synthetic demo environment |
| VR4-14 | SVR-014: future isolated-host resource confinement, never real exfiltration |
| VR4-15 | SVR-008, SVR-011, SVR-012: moved root/revision/topology |
| VR4-16 | SVR-028: sequential/concurrent scope/client/config state |
| VR4-17 | SVR-016, SVR-020: fake redirects; live vendor semantics remain separate |
| VR4-18 | SVR-019: ambiguity and reinvocation, not universal batch-stop assurance |
| VR4-19 | SVR-029, SVR-030, SVR-036: future retrieval/promotion and evaluation separation |
| VR4-20 | SVR-025: fake comment scope/author/pagination; platform rendering/update rights UNKNOWN |

## 13. XI-01 future acceptance evidence

**Preserved current state:** XI-01 = OPEN / MEDIUM; confirmed reachability YES;
impact SUPPORTED_INFERENCE; current remote exploit NOT_DEMONSTRATED.
Owner disposition:
`IMPLEMENTATION_REQUIRED_BEFORE_CONTROLLED_RELEASE_WHEN_AFFECTED_CAPABILITY_ENABLED`.

E1 `main` validates profile/root and parses persisted context, but does not join
context project/repository/run to invocation scope before analysis. Profile
guidance and context-derived provenance can disagree. This is
REPOSITORY_OBSERVED reachability, not evidence of unauthorized remote disclosure.

**FUTURE VERIFICATION REQUIREMENTS (SVR-026):** demonstrate authenticated
provenance/project binding at the actual consumption boundary. Copied/untrusted
persisted A context must not silently inherit B identity or provider authority.
Use positive same-project/run fixtures and negative copied, stale, relabelled,
same-label/different-root and inconsistent profile/knowledge fixtures. Capture
provider-call attempts and payload before any real network access; assert
unauthorized input produces no unintended model request/comment or persisted
trusted report. If an explicit import/mapping is allowed, require its separately
authorized contract and authenticated evidence. Do not prescribe a registry,
signature format or implementation mechanism here.

Future acceptance needs exact entry-point tests, alternate-path analysis,
exact-head CI, independent Security review and authorized implementation
lifecycle evidence. Until implementation and independent verification, the
affected capability/path must remain disabled OR be constrained by a separately
demonstrated trusted/provenance-bound input contract. A copied label or a normal
fresh-CI success cannot establish that alternative contract.

## 14. XI-02 future acceptance evidence

**Preserved current state:** XI-02 = OPEN / MEDIUM; confirmed reachability YES;
impact SUPPORTED_INFERENCE; current remote exploit NOT_DEMONSTRATED.
The same immutable disposition applies:
`IMPLEMENTATION_REQUIRED_BEFORE_CONTROLLED_RELEASE_WHEN_AFFECTED_CAPABILITY_ENABLED`.

E1 `readHistory` rejects ineligible separate history and projects four counters;
`if (history) context.history = history` leaves embedded history intact when the
separate value is null. E2's prompt reads `context.history || null`. This
REPOSITORY_OBSERVED path does not prove remote sensitive disclosure.

**FUTURE VERIFICATION REQUIREMENTS (SVR-027):** embedded history must not bypass
the authoritative eligibility/selection decision at prompt consumption. Exercise
absent, unavailable, malformed, wrong-project, wrong-framework and invalid-counter
separate history with a nested dummy canary embedded in context; verify the
ineligible value cannot reach a model-visible payload or falsely trusted report.
Also test valid same-project history, four-counter minimization, benign no-history
and explicit authorized-import behavior if such a contract is later adopted.
Distinguish unknown/unavailable history from fabricated zero counts. Test the
actual analyzer-to-prompt path, not `readHistory` alone, and compare prompt and
returned-report observations independently.

Independent review must cover all fallback/alternate consumers after separately
authorized remediation. Exact tests/CI and authorized merge/post-merge evidence
are prerequisites to any future closure. Until that lifecycle completes, use the
same disabled-path or separately demonstrated trusted/provenance-bound contract
restriction. No waiver, risk acceptance, re-rating, remediation or XI closure is
made by AISEC-5.

## 15. Safe synthetic and adversarial probe policy

Future authorized probes may use fake transports/responses, inert canaries,
synthetic project IDs, dummy tokens, temporary fixture roots or isolated repository
copies, controlled subprocess stubs and sandboxed filesystem paths. Default
network behavior is interception/refusal; record any explicitly allowed loopback
service and assert that no real endpoint receives a payload. A dummy header is
not permission to contact a real credentialed service. Stub effect boundaries
unless an explicitly isolated host and its resource limits were authorized.

Prohibit real secrets/PATs/API tokens, customer data, unauthorized cross-project
access, destructive provider calls, real exfiltration and production mutation.
External publication of synthetic attack content requires separate authorization.
Do not exercise a hostile generated program on the operator's ordinary host.

Record fixture/canary IDs and digests, allowed roots/hosts, interception points,
positive/negative expectations, actual sink/effect counts, runtime, cleanup and
limits. Use cleanup on success and failure; close local servers, restore test
stubs/env, terminate only owned processes and remove only verified fixture roots.
Never delete a path derived from attack content. Keep sanitized evidence of
cleanup and remaining unknowns; do not retain attack payloads in production
reports, logs, memory or remote comments. All temporary untracked mission files
must be removed before reporting.

## 16. Diagnostics, logging and persistence verification

| Transition | Required separate proof | Current basis / limitation |
|---|---|---|
| Provider input → transport | Exact request projection and header/body separation | E3/E4 source; allowed free text may contain canaries |
| Provider response → validation diagnostic | Identify response-derived text in the diagnostic | E3 Azure rejected `queryType`; source-confirmed, no new live probe |
| Diagnostic → wrapped error / `.cause` | Capture outer message and original cause independently | E3 source + locally passing loader tests preserve cause; bounded message is a separate property |
| Error → caller-visible error | Exercise the receiving API and exact error field | Does not establish that the caller logs, persists or publishes it |
| Caller error → log/persistence/UI | Instrument each sink and approved content/audience | Caller-controlled handling; UNKNOWN without that caller's evidence |
| Raw process output → execution record → C7 prompt copy | Compare original record, sanitization and actual prompt | E7 and AISEC-4 distinguish raw returned output from redacted prompt copy |
| Local record → CI artifact / GitHub comment | Capture final uploaded/posted bytes and destination identity | E5/E8 declarations and formatters do not provide general DLP |
| Published bytes → viewer/rendering/retention | Separately authorized platform/audience evidence | Not demonstrated by constructing a Markdown string |

SVR-022/023/024/025 test these exact transitions. A dummy canary in
`.cause.message` proves that transition only. It does not prove remote
exfiltration, actual sensitive disclosure or caller logging. Credential exclusion
does not prove response-independent diagnostics. Avoid assertions that every
error is sanitized: file JSON parsing, response validation and generic cause
propagation have different contracts.

## 17. Provider, publishing, process and filesystem expectations

Source/config verification must separate the selected initial network authority,
redirect handling, returned record identity and logical project authorization.
E3/E4 source observations credit Azure/Jira manual redirect refusal and configured
source scope; Azure host pinning does not authenticate item project membership.
Jira's caller-selected HTTPS site requires trusted authorization. AI providers'
fixed initial hosts and history's env-selected API base are not a demonstrated
end-to-end redirect denial; fake-runtime behavior and live vendor/account facts
need different evidence. Do not treat returned IDs as tenant authentication.

E4 publishing uses CREATE_ONLY and no automatic write retry. Transport/global-stop
failures stop subsequent items, while invalid 200/201 creation responses are
item-local and may allow continuation even though a remote create may have
occurred. SVR-019 must exercise both branches, per-item request counts and manual
reinvocation. Durable idempotency/reconciliation is FUTURE_CONTROL, not credited
as current. A future approved cross-vendor mapping must remain possible; simple
equality of source and destination names is not the authorization requirement.

E6/E7 current library boundaries check canonical package/content, project labels,
paths/topology and launch targets. Independently verify lexical versus resolved
containment, symlinks/hardlinks, base/after bytes, rollback and OS path variants.
No finite race test proves race freedom. Runner argv/env/timeout assertions must
not imply confinement of Node-loaded code, credential files, outbound network
or descendant lifetime. Inspect actual host permissions separately before any
authorized demonstration. Repository mutation in #23F means bounded local file
writes; no Git/GitHub authority is granted to the model by that contract.

## 18. Verification-record model and requirement register

There are **36 AISEC-5-local SVR requirements**, SVR-001 through SVR-036.
Predecessor IDs retain their original namespaces and meanings. Each requirement
is the join of its row in register A, its row in register B, and the common
record fields below. No field is optional by omission.

| Required record field | Common value / recording obligation |
|---|---|
| Verification ID / source claim | ID and named threats/invariants below; preserve source version/blob and original disposition |
| Boundary / required property / cases | Register A; fixture preconditions and precise effect oracle must be recorded |
| Types / evidence / implementability | Register B; include actual assertion identifiers and negative trace, never a suite label alone |
| Identity binding | Section 7 complete subject/run/artifact identity; logical project/source/destination/actor/host join where relevant |
| Expected result | PASS only for sufficient positive AND required negative evidence for the defined property; otherwise section 6 result, not presumed PASS |
| Failure semantics | Counterexample to the property = FAIL; missing/stale/partial proof = INSUFFICIENT_EVIDENCE; unresolved policy = separate OWNER_DISPOSITION_REQUIRED; section 8 applies to every row |
| Owner dependency | Register B names implementation/evidence owner; PO retains policy/risk/activation authority; author cannot self-close |
| Release relevance | Every current enabled boundary is applicable to its scoped release claim; unimplemented capability requires verified exclusion, not implicit PASS; section 21 governs XI/guard restrictions |
| Automation suitability | A = deterministic automation candidate; H = automation plus human/owner judgment; F = future-capability tests only; register B assigns one |
| Notes / limitations | Register B current scope and sections 9–17; evidence bases remain separate from outcomes |

### Register A — properties and cases

| ID | Source claim / boundary | Required property | Positive case | Negative / adversarial case |
|---|---|---|---|---|
| SVR-001 | AT-01/15, PI-01/09, SEC-I1/2; input → authority | Data/prose cannot grant tools or governance authority | Benign requirement yields bounded proposal | Direct instruction, cross-source conflict or forged approval prose cannot increase effect authority |
| SVR-002 | AT-12, PI-02/03, DXI-05; C1–C7 → prompt | Exact task-authorized field selection | Required fields arrive with known provenance | Nested extras, raw response and excessive/foreign fields measured; forwarding gaps not called deep projection |
| SVR-003 | AT-06, PI-05/13; model → validator/effect | Hostile output remains within deterministic contract | Valid benign response completes expected stage | Invalid schema, fabricated refs, policy override and hostile-valid narrative cannot bypass defined gates |
| SVR-004 | AT-03, PI-06, SEC-I5; stage re-entry | Generated data gains no instruction authority | Valid generated chain retains refs/framing | Upstream injected narrative, encoded instructions and conflicting sources remain data at each consumer |
| SVR-005 | AT-07, PI-08, TB-18; review presentation | Display corresponds to exact canonical reviewed artifact | Canonical package presented without substituted text | Detached/reconstructed or time-split presentation cannot count as approval evidence |
| SVR-006 | AT-07, TB-01, DXI-09; approval → authority | Authentic actor and human decision independently established | Authorized principal makes exact bounded decision | Fabricated reviewer string and recomputed unkeyed digest cannot prove human authority |
| SVR-007 | SEC-I8, TB-01, PI-07; reviewed content → apply | Changed authoritative content/package loses approval | Identical canonical package/content accepted | Changed target, before/after bytes, plan or decisions refused before write |
| SVR-008 | AT-05/16, TB-02/04/09; artifacts → root | Explicit authenticated invocation/project/checkout join | Authorized root/project operation permitted | Different valid root, identical checkout or consistent forged labels cannot inherit authorization |
| SVR-009 | TB-03, SEC-I8; approval reuse | Approved lifetime/replay contract enforced | Operation used within approved lifetime | Restore-and-reapply, expired/copied approval handled according to future authorized policy |
| SVR-010 | PI-10, TB-10; path → read/write | Defined path scope and protected entries cannot be aliased around | Allowed canonical framework target | Traversal, symlink path, ADS/short/trailing/case variants tested per supported OS |
| SVR-011 | TB-11; apply/rollback → filesystem | Promised topology/content checks hold before effects | Stable root and valid base digest apply | Ancestor swap, hardlink, stale base and partial rollback recorded with zero unauthorized compensation |
| SVR-012 | PI-11, TB-13; applied chain → launch | Exact target/argv and fresh applied bytes constrain launch | All recognized authorized specs selected | Unsafe recognized target refuses whole launch; regex/glob/flag steering and stale bytes give zero spawn |
| SVR-013 | TB-14, AISEC-3 VR-09; env → child | Main execution path passes only named allowlist | Required dummy permitted variables present | Dummy secret variables excluded; allowed value sensitivity assessed separately |
| SVR-014 | TB-12/14, DXI-10; child → host | Approved deployment confinement/authority actually established | Isolated synthetic host permits declared resources | Synthetic sibling reads/network/descendants tested only in authorized isolation; launcher alone cannot certify confinement |
| SVR-015 | PI-04, DXI-13; execute → regenerate | Chain/freshness/category/attempt and fresh review retained | Eligible fresh chain yields proposal only | Foreign/stale chain, infra failure, CREATE origin or extra attempt refused; old review cannot apply new content |
| SVR-016 | AT-01, TB-15, VR4-06/17; source → RTI | Trusted source selector and required redirect refusal | Approved synthetic file/site/org/query | Wrong authorized mapping, alternate initial host/redirect, out-of-scope returned records distinguished from syntax validity |
| SVR-017 | AT-06, PI-05; provider return → artifacts | Complete normalized identity/collection contract | Valid complete unique artifacts/batch IDs | Duplicates, extra/missing batch IDs, malformed artifacts and hostile getters reject required whole operation |
| SVR-018 | AT-04/16, TB-05/06, DXI-03; design → publish | Explicit authorized source/destination mapping | Approved synthetic cross-vendor transfer | Wrong valid project/org cannot be authorized by token validity or matching labels |
| SVR-019 | AT-08, TB-19; create → outcome/reinvoke | No blind write retry; ambiguity preserved and handled under approved policy | Known creation correlates destination/remote ID | Timeout/5xx/invalid-2xx, partial batch and manual/concurrent replay measured separately |
| SVR-020 | AT-12/16, TB-15/16; prompt/history → provider | Authorized data/account/host envelope | Approved dummy payload reaches intercepted target | Env/API/account substitution, redirects and shared instance scope tested; real vendor rights remain separate |
| SVR-021 | SEC-I3, DXI-06/07; secret-class data → sinks | Required secret exclusion/redaction at named transition | Benign required content retained | Dummy header, source literal, stack, encoded/unlabelled canary; each sink's permitted content explicitly decided |
| SVR-022 | AT-13, AISEC-4 C2; response → error/cause | Diagnostic propagation accurately classified at exact sink | Fixed outer message and expected cause observed separately | Azure queryType/file parse canaries and custom error causes; no claim of remote disclosure without sink evidence |
| SVR-023 | AT-13, DE-09/13; error/output → log | Approved log projection before emission | Permitted synthetic summary logged | Warning title, raw caught error, stdout and pre-cleanup forensics canaries; later deletion cannot retract log |
| SVR-024 | AT-12, DXI-12; report/media → artifact | Approved audience/retention/import origin evidenced | Intended same-run artifact imported | Rich source/media, stale/foreign artifact, wrong run and absent retention/access evidence prevent certification |
| SVR-025 | TB-07/08, VR4-20; report → comment | Authorized origin/target and permitted rendered content | Intended report/PR/bot comment | Foreign marker/author, >100 comments, mismatched report source and hostile Markdown; fake API is not platform-rights proof |
| SVR-026 | XI-01, XB-01/02; context → analyzer | Future provenance/project binding at consumption | Fresh authenticated same-project context works | Copied/relabelled/stale A context under B invocation cannot silently reach provider/trusted report |
| SVR-027 | XI-02, XB-03; history → prompt | Future eligibility/selection governs embedded history too | Valid same-project projected counters work | Missing/ineligible separate history with embedded nested canary cannot bypass selection |
| SVR-028 | DXI-08/14, VR4-11/16; state reuse → invocation | Explicit import/state scope and freshness | Sequential/concurrent authorized A/B tasks remain distinct | Cached import-time config, reused clients/copied files and identical labels cannot silently borrow trust |
| SVR-029 | AT-10/11, PI-14/15, DXI-15/16; future retrieval | Authenticated hard scope before relevance; no default promotion | Future authorized same-scope retrieval | Poisoned/cross-project cache, retrieval or learning promotion refused; current knowledge is not MEM |
| SVR-030 | AT-14, SEC-I10; candidate → evaluator | Oracle/data provenance independent of candidate | Frozen independent baseline and assertions | Candidate-provided expected values, omitted cases or forged result cannot self-certify |
| SVR-031 | AT-09, SECURITY 28; package → consumer | Supported/distributed authority matches approved contract | Authorized public exports/files | Private #23 export/physical inclusion triggers guard; declarations alone not actual distribution proof |
| SVR-032 | TB-17/20; workflow → runner/token | Actual execution/config/platform authority separately bound | Required jobs execute scoped known revision | Wrong workflow/ref, same-repo editable YAML, fork/platform differences and ambient checkout credentials remain explicit |
| SVR-033 | SVI-02, release identity; run → evidence | Exact event/head/base/tree/attempt/topology and all required jobs | Fresh required run plus subject correspondence | Stale green CI, wrong event/base, partial jobs/assertions or copied digest rejected as proof |
| SVR-034 | SEC-I10, governance; author → review | Required fresh independence and authority established | Independent reviewer examines exact scope | Author session/agent, role-switch or old-head approval cannot certify candidate |
| SVR-035 | XI disposition, Controlled Release; evidence → enablement | Capability-specific blockers and restrictions resolved before enablement | Verified disabled path or separately demonstrated authorized input contract | Strategy-only assertion, partial bypass, unproven contract or enabled unresolved affected path cannot authorize release |
| SVR-036 | Future autonomy; human gate → expanded operation | Evidence scales with scope and authority | Later authorized bounded automation matches exact approved authority | Added tools, publishing, multi-project state or reduced confirmation cannot inherit narrow prior assurance |

### Register B — methods, evidence and current implementability

All rows are proposed obligations. PARTIAL means some existing assertions can be
reused, not that the whole obligation passed. SOURCE means current source can be
observed but complete tests/evidence were not established here. FUTURE means
control/host/policy design is needed; writing a fixture now cannot make it pass.
H rows need independent judgment even when deterministic subchecks are automated.

| ID | Types | Required evidence / anchors | Owner dependency | Automation / current implementability and limitations |
|---|---|---|---|---|
| SVR-001 | STATIC, UNIT, ADVERSARIAL, MANUAL | E2/E6 validators, operation/request trace, injection corpus | Pipeline/security; PO tool scope | H / PARTIAL: framing exists; semantic immunity not established |
| SVR-002 | STATIC, UNIT, SYNTHETIC | E2 all seven call payloads, exact named-field assertions | Prompt/data owner | A / PARTIAL: local C1 tests; forwarded containers not universal deep allowlist |
| SVR-003 | UNIT, INTEGRATION, ADVERSARIAL | E2/E6/E12 response assertions and zero-effect trace | Pipeline/provider owner | H / PARTIAL: shape contract demonstrated locally; hostile semantic output remains separate |
| SVR-004 | SYNTHETIC, ADVERSARIAL, MANUAL | E2 stage-by-stage input/output and authority trace | Generation/injection owner | H / SOURCE: current framing; future semantic corpus needed |
| SVR-005 | IDENTITY, INTEGRATION, ADVERSARIAL, MANUAL | E6 exact display/record/apply object and hostile split evidence | Review host; SECURITY 28 / PO activation | H / FUTURE: no supported renderer; canonical apply check does not satisfy display guard |
| SVR-006 | IDENTITY, INTEGRATION, MANUAL, OWNER | E6 authentic actor/decision chain independent of record's digest | Trusted review host / PO | H / FUTURE: reviewer string and unkeyed seal are not authentication |
| SVR-007 | UNIT, INTEGRATION, ADVERSARIAL | E6 canonical reconstruction, altered-content refusal and zero writes | Apply/review owner | A / PARTIAL: tests inspected, not run here; current content checks narrower than actor/root proof |
| SVR-008 | IDENTITY, SYNTHETIC, ADVERSARIAL, OWNER | E1/E6/E7 authorized scope-to-root chain and foreign-root trace | Trusted host / PO identity policy | H / FUTURE: consistent labels/digests do not authenticate root |
| SVR-009 | INTEGRATION, ADVERSARIAL, OWNER | E6 restore/replay trace and approved lifetime semantics | Approval host / PO replay policy | H / FUTURE: content-state checks alone not single-use authority |
| SVR-010 | UNIT, ADVERSARIAL, IDENTITY | E6 platform/version matrix, resolved targets and zero effects | Path owner / supported-platform owner | A / PARTIAL: alias/race variants need actual platform evidence |
| SVR-011 | INTEGRATION, ADVERSARIAL, MANUAL | E6 topology/base/rollback trace and race limits | Apply/host owner | H / PARTIAL: finite tests cannot establish complete race elimination |
| SVR-012 | UNIT, INTEGRATION, ADVERSARIAL | E7 exact binary/argv/cwd, applied-byte checks and spawn counts | Execution owner | A / PARTIAL: existing targeted tests inspected; no sandbox conclusion |
| SVR-013 | UNIT, SYNTHETIC | E7 actual child env-name/value classification using dummy values | Execution/data owner | A / PARTIAL: allowlist present; allowed values/credential files independent |
| SVR-014 | INTEGRATION, ADVERSARIAL, MANUAL, OWNER | E7 isolated deployment's permissions/network/descendant traces | Host/security / PO isolation decision | H / FUTURE: current launcher not OS sandbox |
| SVR-015 | UNIT, INTEGRATION, ADVERSARIAL | E7 exact chain, attempts, freshness and re-review refusal | Regeneration/review owner | A / PARTIAL: chain guards and prompt-copy redaction only |
| SVR-016 | STATIC, SYNTHETIC, IDENTITY, OWNER | E3 request selector/redirect traces and authorized mapping | Source host / PO source policy | H / PARTIAL: syntax/host guards not vendor project membership |
| SVR-017 | UNIT, INTEGRATION, SYNTHETIC | E3 returned IDs/whole-load traces and provider batch assertions | Provider/RTI owner | A / PARTIAL: local loader tests; Azure batch test candidates not run here |
| SVR-018 | IDENTITY, SYNTHETIC, ADVERSARIAL, OWNER | E4 authorized cross-vendor mapping and intercepted POST | Publishing host / PO mapping | H / FUTURE: no current source-to-destination authorization join |
| SVR-019 | UNIT, SYNTHETIC, INTEGRATION, OWNER | E4 item/global-stop traces, request counts, reconciliation policy | Publishing / PO ambiguity/replay policy | H / PARTIAL: no retry observed; invalid-2xx continuation and durable ledger separate |
| SVR-020 | STATIC, SYNTHETIC, IDENTITY, OWNER | E3/E4/E8 actual envelope/account mapping and runtime redirect traces | Provider/config host / PO data policy | H / PARTIAL: initial host/config observed; account/retention rights UNKNOWN |
| SVR-021 | UNIT, SYNTHETIC, ADVERSARIAL, MANUAL | E2/E3/E7/E8 sink-by-sink canary matrix, match limits | Data/security owner | H / PARTIAL: intentional key exclusion and patterns do not prove universal DLP |
| SVR-022 | UNIT, SYNTHETIC, INTEGRATION | E3 error-field transition trace and inspected local cause assertions | Provider/caller owner | A / PARTIAL: cause preservation demonstrated; downstream publication UNKNOWN |
| SVR-023 | SYNTHETIC, INTEGRATION, OWNER | E8 log emission trace plus approved content policy | Logging/CI / PO audiences | H / SOURCE: forensics/log channels differ from prompt sanitization |
| SVR-024 | IDENTITY, INTEGRATION, MANUAL, OWNER | E8 artifact bytes, producer run, access/retention and import evidence | Artifact/CI/data owner | H / SOURCE: workflow declarations not effective audience proof |
| SVR-025 | UNIT, SYNTHETIC, IDENTITY, MANUAL | E5 fake API calls/author/pages/rendered envelope and target scope | Comment host / PO audience | H / PARTIAL: no current author/pagination gate; platform rights UNKNOWN |
| SVR-026 | INTEGRATION, SYNTHETIC, ADVERSARIAL, IDENTITY | E1/E2 future actual consumption-boundary tests per section 13 | Triage/host; immutable XI disposition | A / FUTURE: source reachability YES, impact inference, no remediation |
| SVR-027 | INTEGRATION, SYNTHETIC, ADVERSARIAL | E1/E2 future history/prompt cases per section 14 | Triage/history; immutable XI disposition | A / FUTURE: current embedded fallback remains; helper-only tests insufficient |
| SVR-028 | INTEGRATION, SYNTHETIC, IDENTITY, OWNER | E1/E3 state/import origin, interleaving and freshness traces | Invocation host / PO import policy | H / FUTURE: no tenant service or authenticated shared-state contract credited |
| SVR-029 | ADVERSARIAL, IDENTITY, MANUAL, OWNER | E9 future namespace/retrieval/promotion records | Future MEM/RAG/LEARN / PO | F / FUTURE: current curated knowledge not persistence/learning implementation |
| SVR-030 | UNIT, IDENTITY, MANUAL | E9 independent frozen oracle/test selection and tampering trace | Evaluation/governance owner | H / PARTIAL: offline baseline precedent, not security acceptance |
| SVR-031 | STATIC, INTEGRATION, IDENTITY, MANUAL | E9 actual distribution manifest/deep-import assertions and guard check | Package/review host / PO activation | H / PARTIAL: declarations observed; no pack/installation probe run here |
| SVR-032 | STATIC, CI, IDENTITY, MANUAL, OWNER | E8 config plus authorized fresh effective settings/runner evidence | CI/admin / PO deployment | H / SOURCE: TB20-WF-INFERENCE retained; old settings not refreshed |
| SVR-033 | CI, IDENTITY | E10 exact PR/push runs, attempts, executed content, required jobs/assertions | PM/evidence collector | A / PARTIAL: existing governance collection seam does not authenticate itself |
| SVR-034 | MANUAL, IDENTITY, OWNER | E10 reviewer participation/identity, exact review report and owner scope | Independent Senior/Security / PM/PO | H / FUTURE for this artifact: author-run checks are not approval |
| SVR-035 | INTEGRATION, IDENTITY, MANUAL, OWNER | E11 enablement inventory, disabled-path/contract proof and release dossier | Release/PM/security / PO | H / FUTURE: no release approval or XI closure |
| SVR-036 | INTEGRATION, ADVERSARIAL, MANUAL, OWNER | E9/E11 future authority delta, host boundaries, expanded corpus | Future architecture/host / PO | F / FUTURE: no higher-autonomy activation |

## 19. Coverage and traceability matrix

| Domain | What must be verified / how | Required evidence | Currently testable | Future / release consequence |
|---|---|---|---|---|
| AISEC-1 threat model | All 16 AT and 10 SEC-I mappings via section 9 / register | Named boundary cases and effect traces | Narrow deterministic contracts | Missing applicable proof prevents scoped assurance, not automatic threat closure |
| AISEC-2 injection | All 15 PI; hostile-valid output and semantic influence separately | Corpus, output/effect assertions, model identity/rubric if used | Fake-output gates and prompt selection | Semantic guarantee not credited; future adversarial harness separately authorized |
| AISEC-3 tool/privilege/credential | All 20 TB; actor/root/use authority versus hidden key | Approval/launch/request traces and authentic provenance | Digest, path, argv/env, shape checks | Reviewer/root/host-policy gaps remain capability-dependent |
| AISEC-4 exfiltration/isolation | 20 DE, 16 XB, 16 DXI, all 20 VR4 | Transition-specific payload/sink and scope evidence | Fake transport and local source observations | Vendor/account/audience/retention facts and canonical joins missing |
| XI-01 | SVR-026 actual consumption join | Positive same-project and copied/foreign/stale negative cases | Source path identifiable; future test seam design | Immutable enablement restriction; no remediation credited |
| XI-02 | SVR-027 embedded fallback | Separate-file negative matrix plus captured prompt/report | Source path identifiable; `readHistory` alone inadequate | Immutable enablement restriction; no remediation credited |
| Release evidence identity | SVR-033 exact HEAD/TREE/run/topology | Complete required jobs/assertions and post-merge push | Read-only metadata and existing validators | Missing/stale proof blocks certification |
| Review independence | SVR-034 participation and subject | Fresh independent Senior/Security exact-head reports | Author can collect identity, cannot self-approve | Required review remains outstanding |
| Controlled Release | SVR-035 scoped enabled/disabled inventory | Restrictions, trusted input contract, exact CI/review/owner dossier | Disabled-path/config checks with real boundary evidence | Strategy alone grants no approval; XI affected enabled path restricted |
| Higher autonomy | SVR-036 expanded tool/state/publish scope | New authority model, adversarial/deployment proof | Current lower-authority seams only | Future activation requires separate decision and stronger evidence |

## 20. Finding closure, remediation and re-rating prerequisites

| Representation | Evidence and authority required before use |
|---|---|
| REMEDIATED | Authorized implementation of the scoped property, positive/negative boundary tests, exact-head execution and independent technical/security verification; strategy or test plan insufficient |
| CLOSED / CLOSED_ON_MAIN | Applicable finding-specific lifecycle/owner authority, reviewed exact implementation, authorized merge/topology, fresh required post-merge push certification and canonical truth synchronization; do not bypass the normative process |
| RE-RATED | Explicit owner-authorized rating decision with evidence for changed likelihood/impact/authority premises; implementation or speculative mitigation cannot silently change rating |
| ACCEPTED / WAIVED | Explicit authorized owner risk/policy decision identifying scope, conditions, residual risk and lifecycle limits; technical reviewers cannot grant it |

Preserve original records until their actual authorized transition. Existing
tests, model output, fake labels, green CI or this document do not close AT/PI/TB/XI.
Independent review must examine alternate reachable bypasses, not just the happy
path. These prerequisites instantiate existing governance authority; they do not
introduce a new merge policy or waive zero-findings review requirements.

## 21. Controlled Release verification gate

Future release evaluation must enumerate enabled capabilities and actual entry
points, consumers, hosts, projects/accounts and data audiences. Join each to
applicable SVR obligations and open findings/guards. Verify disabled paths across
API, CLI, UI, workflow, package and direct supported entrypoints, rather than
trusting a feature label or a no-failures test. Evidence for a restriction is
restricted-scope evidence, not a closed finding or general safety claim.

XI-01/XI-02 remain implementation-required blockers when their affected capability
is enabled, subject to the approved alternative of a separately demonstrated
trusted/provenance-bound input contract. Until implementation and independent
verification, the affected path must remain disabled or meet that alternative
contract. Do not expand or weaken the immutable disposition. Document the exact
contract boundary, authentic producer/consumer, allowable imports, alternate
entrypoints and how continued compliance is verified; owner wording alone does
not demonstrate enforcement. Neither alternative grants risk acceptance.

Before affected enablement, require credential-use/transport and publishing
mapping evidence, exfiltration/isolation scope, adversarial coverage, diagnosis/
artifact audience policy, authenticated identity, independent reviews, authorized
lifecycle decisions and exact post-merge CI under existing governance. Keep
AT-07/SECURITY 28 presentation/authenticity restrictions, root/project binding,
host authority, pending publication/comment/OS questions and other applicable
findings visible. No new deferral or universal release-blocker count is invented.

All technical PASS is necessary evidence for its scope, not authority to release.
UNKNOWN/INSUFFICIENT_EVIDENCE cannot certify an enabled boundary. PO retains
release/policy authority. Controlled Release is NOT APPROVED by AISEC-5.

## 22. Higher-autonomy verification escalation

| Expansion | Additional future proof |
|---|---|
| More tools / automatic repository mutation | Enumerated principals/capabilities, per-operation authorization, protected scope, replay/freshness, host-effect auditing |
| Automatic publishing | Source/destination authorization, content/audience policy, ambiguity/reconciliation/idempotency decisions |
| Cross-project operation / shared workers | Authenticated scope join, client/config/cache isolation, concurrency and intentional transfer contracts |
| Persistent memory / retrieval | Namespace authorization before relevance, write/retrieval provenance and supersession, poisoning/replay/deletion/retention tests |
| Learning / self-directed workflows | No unreviewed trust promotion, independent eval/approval evidence, bounded workflow/side-effect authority |
| Reduced human confirmation | Equivalent independently demonstrated authorization and trusted policy enforcement; prior human-gated assurance cannot transfer automatically |

Scale scenario diversity, negative coverage and deployed-boundary evidence with
authority and persistence. Reopen the evidence scope when capabilities change;
do not assert that existing prompt/argv controls support full autonomy. No
MEM/RAG/LEARN or autonomous behavior is implemented or started here.

## 23. AISEC-6 architecture handoff

| Input / decision | Classification | Related requirements |
|---|---|---|
| Atomic evidence vocabulary, identity fields, results and predecessor mapping | RESEARCH_COMPLETE_INPUT | SVR-001 through SVR-036; proposed strategy input, not accepted architecture |
| Canonical principal/project/repository/root/provider identity join | OPEN_DESIGN_QUESTION | SVR-006/008/016/018/020/026/028; OQ4-01/02/03/04/09 |
| Approval authenticity, presentation, lifetime and replay contract | OPEN_DESIGN_QUESTION | SVR-005/006/009; OQ3-6/7/8 and SECURITY 28 remain |
| Permitted data audiences, diagnostics, retention and intentional transfer | OWNER_DECISION_REQUIRED | SVR-018/021/022/023/024/025; OQ4-07/11 |
| Host isolation and real deployed tool/process authority | OWNER_DECISION_REQUIRED | SVR-014/032/036; OQ4-06, OQ3-9 |
| Semantic model evaluation rubric versus deterministic scope enforcement | OPEN_DESIGN_QUESTION | SVR-003/004/005; AISEC-2 open semantic/display questions |
| Authenticated host adapters, renderer, replay/import enforcement | FUTURE_IMPLEMENTATION_DEPENDENCY | SVR-005/006/008/009/026/027/028; implementation separately authorized |

The architecture must resolve policy choices; test outcomes cannot invent them.
This is a handoff queue only. No AISEC-6 artifact or activation is created.

## 24. AISEC-7 adversarial harness handoff

| Candidate / required harness property | Classification | SVR candidates |
|---|---|---|
| Threat/case/oracle inventory and safe fake-transport policy | RESEARCH_COMPLETE_INPUT | Section 18 register, sections 13–16; no harness built |
| Malicious requirements/repository/error/knowledge and hostile-valid responses | FUTURE_IMPLEMENTATION_DEPENDENCY | SVR-001/002/003/004/021/022 |
| Split review, changed content, cross-root replay, path/topology and CLI steering | FUTURE_IMPLEMENTATION_DEPENDENCY | SVR-005 through SVR-012 |
| Copied context and embedded-history null/ineligible matrix | FUTURE_IMPLEMENTATION_DEPENDENCY | SVR-026/027/028; no remediation authorized |
| Wrong destination/redirect, invalid-2xx, ambiguity and marker/pagination | FUTURE_IMPLEMENTATION_DEPENDENCY | SVR-016/017/018/019/020/025 |
| Independent oracles, effect interception, cleanup and exact fixture/run identity | OPEN_DESIGN_QUESTION | SVR-030/033; reuse existing tests only where assertions match |
| Deployed confinement or platform-rights experiment | OWNER_DECISION_REQUIRED | SVR-014/024/025/032; isolated scope first, no real secrets/exfiltration |

Synthetic tests must exercise public consumers where the finding concerns a
supported API, not only private helpers. Record positive controls, alternate
paths, refusal/effect assertions, mutation of each identity field and unresolved
platform limits. No AISEC-7 code/artifact or activation is authorized here.

## 25. Type & Schema Boundary Audit separation

The Type & Schema Boundary Audit is a **DISTINCT FUTURE GATE / NOT SATISFIED**.
Selected schema/hostile-getter assertions are relevant local proof for SVR-003/017;
they are not repository-wide type/schema certification. AISEC-5 does not absorb
the full audit, replace it, close its requirements or declare it complete. Any
future audit evidence must bind its own authorized scope and exact identity.

## 26. Gaps, unknowns and open questions

| Question / missing proof | Basis | Required resolution |
|---|---|---|
| Canonical authenticated project/principal/root/source/destination join | REPOSITORY_OBSERVED separate labels/validators; missing end-to-end proof | Authorized architecture/host decision, then boundary verification |
| Reviewer authentication, human decision and supported display | PREDECESSOR_RESEARCH + SECURITY 28 / E6 | Separate guard work; current apply content recomputation cannot resolve actor/display |
| Approved lifetime/import/replay/retention/audience policy | UNKNOWN policy; existing content/state checks narrower | PO/data owner decisions and actual enforcement evidence |
| Effective vendor token rights, TeamProject/JQL/WIQL semantics, provider retention | UNKNOWN external facts | Separately authorized verification; no real token/value probe here |
| Effective GitHub settings and workflow-definition trust today | PREDECESSOR_RESEARCH dated observation / TB20-WF-INFERENCE | Authorized fresh metadata/provenance verification before deployment claim |
| Full supported-OS path aliases, races and descendant isolation | SOURCE/PREDECESSOR_RESEARCH limits; no broad empirical proof | Isolated platform evidence, retained future audit/owner scope |
| Semantic injection resistance across actual models and human persuasion | SUPPORTED_INFERENCE residual risk, not demonstrated universal property | Approved corpus/rubric plus independent review, deterministic effect boundaries |
| XI remediation and alternate trusted contract | FUTURE_CONTROL; immutable disposition already known | Separate authorized implementation or separately demonstrated constrained-input evidence |
| Durable publishing reconciliation and comment platform update/render semantics | SOURCE behavior versus UNKNOWN platform endpoint | Owner policy and safe authorized evidence; no silent predecessor disposition change |
| Multi-tenant caches/memory/retrieval/learning | FUTURE_CONTROL | Later phase authorization; no current tenant system credited |

These questions do not require inventing a design to deliver a strategy. Where a
policy is unresolved, the requirement records OWNER_DISPOSITION_REQUIRED alongside
the known technical limitation. No contradictory predecessor rating is reconciled
by changing it: later qualified observations refine mechanisms while original
findings/owners and historical evidence remain intact.

## 27. Explicit invariants preserved

| ID | Meta-invariant |
|---|---|
| SVI-01 | No evidence ambiguity may produce PASS |
| SVI-02 | No stale exact-head evidence silently certifies a new HEAD |
| SVI-03 | No supported inference is represented as demonstrated evidence |
| SVI-04 | No finding closes or re-rates merely because a strategy exists |
| SVI-05 | Technical verification cannot substitute for PO policy/risk authority |
| SVI-06 | Credential non-disclosure does not imply diagnostic content independence |
| SVI-07 | Caller-visible information alone does not prove remote exfiltration |
| SVI-08 | Repository/host identity alone does not prove logical project authorization |
| SVI-09 | Synthetic probes require no real secrets, destructive calls or real exfiltration |
| SVI-10 | Type & Schema Boundary Audit remains separate |

Exactly ten AISEC-5 meta-invariants are defined. AT/PI/TB statuses and ratings
remain unchanged. XI-01 and XI-02 remain OPEN / MEDIUM, reachability YES,
impact SUPPORTED_INFERENCE, current remote exploit NOT_DEMONSTRATED, with the
immutable implementation-before-enabled-Controlled-Release disposition. No XI
remediation, closure, re-rating, waiver or risk acceptance is authorized or made.

## 28. Mandatory final conclusions

AISEC-5 delivers a strategy with nine verification types, four distinct result
semantics, identity/invalidation rules, 36 local requirements,
complete predecessor scenario traceability, ten meta-invariants, release-evidence
expectations and explicit future handoffs. It does not prove the product secure,
all diagnostics sanitized, all integrations authenticated, cross-project
isolation complete, Controlled Release approved or higher autonomy approved.

The current evidence supports narrow source/test observations and identifies
missing proof. XI remediation remains absent; existing finding dispositions and
the separate Type & Schema gate are preserved. Local document validation is not
Senior/Security approval. Required next lifecycle: PM independently verifies
branch/diff, creates the governed PR, waits for fresh automatic exact-head CI,
then opens independent Senior HEAVY review and independent Security HEAVY review
under the existing lifecycle. Any new HEAD invalidates exact-head approvals.

## 29. Document validation and delivery boundary

Check headings, tables, anchors, local links, code fences, namespace uniqueness,
traceability coverage and stated counts. Run the existing repository Markdown/
reference machinery read-only with a Git-object content reader for tracked
dependencies and the new document's exact candidate bytes before commit; verify
the committed version afterward. Run `git diff --check`, enforce single-new-file
scope, sole authorized parent and one normal commit. Re-fetch and require both
remote refs at baseline immediately before normal fast-forward push. Record
pushed HEAD/TREE, parent, delta and clean working tree in the final report.

No PR creation, issue modification, merge, closure or downstream activation is
part of delivery. Existing local tests above are optional narrow research
evidence; broad runtime/E2E/live-provider execution is unnecessary for this
document-only change. No temporary probe artifacts are retained.

## 30. Inspected evidence references

Evidence keys are scoped inspection pointers. Source claims are
REPOSITORY_OBSERVED only for the named inspected functions/configuration; larger
historical inventories retain PREDECESSOR_RESEARCH qualification. Tests not listed
as locally executed in section 3 are candidates/inspected assertions only.

| Key | Inspected repository evidence / anchors | Scope |
|---|---|---|
| P1 | [AISEC-1 threat model](agentic-threat-model-v1.md), threat catalog / SEC-I / handoffs | AT-01..16 and SEC-I1..10 research claims; no rating changes |
| P2 | [AISEC-2 injection study](prompt-indirect-injection-study-v1.md), call inventory / PI catalog / enforcement limits | PI-01..15, framing versus semantics, future fixtures |
| P3 | [AISEC-3 privilege analysis](tool-privilege-credential-boundary-analysis-v1.md), inventory / TB catalog / verification / dated platform evidence | TB-01..20, VR-01..13, historical settings and TB20-WF-INFERENCE |
| P4 | [AISEC-4 exfiltration/isolation](data-exfiltration-cross-project-isolation-v1.md), DE/XB/DXI/VR4 / XI / diagnostics / handoff | Qualified current/future research claims; ROADMAP later owner disposition governs XI |
| E1 | [analyze-failure.js](../scripts/ai/analyze-failure.js), `readHistory`, `computeRelevantKnowledge`, `buildFailureReport`, `main` | History counter/label gates, embedded fallback, profile/root versus context mismatch |
| E2 | [qa-agent-prompt.js](../scripts/ai/qa-agent-prompt.js), metadata/failure projection and `buildUserPrompt`; [prompt tests](../scripts/ai/qa-agent-prompt.test.js); [test-design prompt](../scripts/ai/generative-test-design/test-design-prompt.js), [test-case prompt](../scripts/ai/generative-test-design/test-case-model-prompt.js), [candidate prompt](../scripts/ai/generative-test-design/automation-candidate-prompt.js), [plan prompt](../scripts/ai/test-automation/automation-plan-prompt.js), [change-set prompt](../scripts/ai/test-automation/generate-change-set-prompt.js) targeted DATA/projection searches | C1 exact inspected payload; private builder framing/projection pointers, seven call roles inherited from P2/P4 |
| E3 | [requirements-source-provider.js](../scripts/ai/requirements-source-provider.js), `loadRequirementsFromProvider`; [loader tests](../scripts/ai/requirements-source-provider.test.js); [Azure source](../scripts/ai/providers/azure-devops-requirements-provider.js), `validateWiqlResponseShape`; [Azure tests](../scripts/ai/providers/azure-devops-requirements-provider.test.js); [Jira source](../scripts/ai/providers/jira-requirements-provider.js), config/redirect anchors | Cause preservation, response queryType diagnostic, selected host/config and test candidates |
| E4 | [Azure destination](../scripts/ai/destinations/azure-devops-test-case-destination.js), create response / `globalStop` / `publish`; [publishing](../scripts/ai/test-design-publishing.js) contract/test searches; [publishing tests](../scripts/ai/test-design-publishing.test.js); [Groq](../scripts/ai/providers/groq-provider.js), [Gemini](../scripts/ai/providers/gemini-provider.js), [history collector](../scripts/ai/collect-history.js), fetch/auth/host searches | Publishing observed branch semantics; targeted transport pointers; effective platform behavior not measured |
| E5 | [pr-comment-client.js](../scripts/ai/pr-comment-client.js), `findMarkedComment` / `upsertPrComment` | First-page marker matching, no author verification, fake-client seam |
| E6 | [change-set-application.js](../scripts/ai/test-automation/change-set-application.js), canonical rebuild/path/topology/digest/rollback anchors; [application tests](../scripts/ai/test-automation/change-set-application.test.js) targeted assertion search; [SECURITY](../SECURITY.md) section 28 presentation restriction | Current apply content binding and retained presentation/authentication guard, no supported renderer credited |
| E7 | [controlled-execution.js](../scripts/ai/test-automation/controlled-execution.js), env/target/argv/spawn/revalidation/timeout anchors; [execution tests](../scripts/ai/test-automation/controlled-execution.test.js); [regeneration tests](../scripts/ai/test-automation/regenerate-change-set.test.js) targeted assertions; [regeneration source](../scripts/ai/test-automation/regenerate-change-set.js) via P4 scoped research | Current launch observations; chain/redaction predecessor claim and future executable evidence candidates |
| E8 | [cypress workflow](../.github/workflows/cypress.yml), events/jobs/permissions/history/secret/artifact declarations | Tracked CI configuration, not fresh effective platform settings or host permissions |
| E9 | [package.json](../package.json) exports/files; [package-surface contract](package-surface-v2.md), [package tests](../test/installation/package-surface.test.js), [knowledge selector](../scripts/ai/knowledge/selector.js), [evaluation policy](evaluation-execution-policy-v1.md) via P1/P4 predecessor context | Observed private package exclusions; broader installed/knowledge/eval assertions remain predecessor basis, not newly run experiments |
| E10 | [governance process v3](governance-process-v3.md), authority/review/merge rules; [trusted context](../scripts/governance/stages/1a/trusted-context.js), shape/trust rules; [CI evidence](../scripts/governance/stages/1f/ci-evidence.js), exact collection and rerun contract; [Markdown checker](../scripts/governance/stages/1b/check.js) | Human lifecycle authority, asserted versus authenticated context, structural/evidence-validation limits |
| E11 | [ROADMAP](../ROADMAP.md), AISEC-4 closure/XI disposition/current sequence; [SECURITY](../SECURITY.md), presentation/host limitations; [Issue #214](https://github.com/TarasovArtem/qa-ai-agent/issues/214) | Baseline lifecycle and mission authority; no release or downstream authorization |
| E12 | [provider-contract.js](../scripts/ai/providers/provider-contract.js), `validateProvider` / `validateProviderResponse`; [contract tests](../scripts/ai/providers/provider-contract.test.js) | Interface/response shape, locally executed assertions; no behavioral sandbox |
