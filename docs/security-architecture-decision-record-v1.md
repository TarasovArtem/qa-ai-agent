# AISEC-6 — Candidate Security Architecture Decision Record v1

## 1. Title, status and authority

Status: **ARCHITECTURE_DECISION_PROPOSED** — research/design candidate only.
Authorization: `OD-AISEC-6-RESEARCH — APPROVED`; management issue #217.
Repository: `TarasovArtem/qa-ai-agent`. Review class: HEAVY. WIP: AISEC-6 only.
Research date: 2026-10-06. Approval of this research mission authorizes creation
and delivery of this artifact; it does not approve its architecture proposals.

The record defines required properties and decision dependencies. It establishes
no authentication, authorization, sandbox, credential isolation, cross-project
isolation, publication safety, security certification or release readiness.

## 2. Scope and non-goals

Cover supported triage/RTI APIs, repository-only CI/reporting, private #22/#23
libraries, governance evidence seams and future authority escalation. Exactly one
new tracked file is authorized: this document. Repository inspection is read-only.
No runtime controls, remediation, adapters, tests, workflows, package/API changes,
roadmap synchronization, PR, issue update, merge or downstream activation.

All target requirements below are proposals unless explicitly attributed to an
existing approved decision. Unresolved policy is represented as owner decision
packages, not selected by the author. Capability restriction is not risk acceptance.

## 3. Exact repository baseline

| Field | Recorded value |
|---|---|
| Authorized main / starting branch HEAD / sole required parent | `5aa5a7abdfe3617256402289bf3196242023af07` |
| Authorized main / starting branch TREE | `71ddefa2c69e043fd4db4bc54f3df4d62bb6a3e8` |
| Branch | `research/aisec-6-security-architecture-decision-record` |
| Origin | `https://github.com/TarasovArtem/qa-ai-agent.git` |
| Preflight | Fetch completed; both remote refs equal authorized HEAD/TREE; checkout HEAD/TREE equal; working tree CLEAN |
| Candidate scope | One document, one normal commit; final SHA/TREE recorded in delivery report |

CURRENT_REPOSITORY_FACT: ROADMAP's AISEC-5 closure entry records research/design
completion, unchanged XI disposition, and AISEC-6 as NEXT / NOT ACTIVATED by that
sync. The present mission separately authorizes off-main AISEC-6 research. It
does not rewrite canonical roadmap lifecycle state (E01).

## 4. Inputs, methodology and evidence vocabulary

Read the complete [AISEC-1](agentic-threat-model-v1.md),
[AISEC-2](prompt-indirect-injection-study-v1.md),
[AISEC-3](tool-privilege-credential-boundary-analysis-v1.md),
[AISEC-4](data-exfiltration-cross-project-isolation-v1.md) and
[AISEC-5](agentic-security-verification-strategy-v1.md) artifacts. Source claims
below use inspected executable/configuration anchors E01–E12 in section 28.
Inspection is targeted, not a repository-wide security or Type & Schema audit.
No real network security probes or secret-value inspection were performed.

| Classification | Meaning |
|---|---|
| CURRENT_REPOSITORY_FACT | Named inspected code/config establishes this narrow fact at this baseline; static evidence, not deployed behavior |
| PREDECESSOR_FINDING | Inherited claim, rating or dated observation with its original limits; not newly demonstrated |
| APPROVED_EXISTING_DECISION | Normative existing owner/governance disposition, named with its source; not a new AISEC-6 approval |
| ARCHITECTURE_DECISION_PROPOSED | Candidate required property; not current enforcement or accepted policy |
| OWNER_DISPOSITION_REQUIRED | Product/data/deployment/risk policy cannot be decided by technical evidence |
| FUTURE_IMPLEMENTATION_DEPENDENCY | Separately authorized code/host/integration work needed |
| FUTURE_VERIFICATION_DEPENDENCY | Future evidence obligation; neither a performed test nor PASS |
| UNKNOWN | Repository evidence does not establish the fact or policy |

Classification and evidence strength are independent. Evidence bases retain
AISEC-5's REPOSITORY_OBSERVED, PREDECESSOR_RESEARCH,
DEMONSTRATED_BY_EXISTING_TEST, SUPPORTED_INFERENCE, UNKNOWN and FUTURE_CONTROL
meanings. No product test was run here; inspected tests are reuse candidates,
and AISEC-5's recorded local test results remain predecessor evidence. Atomic
claims cannot outrank their weakest necessary premise. A source-observed gap
does not demonstrate successful exploitation or actual sensitive disclosure.

Adopt AISEC-5's proposed four verification outcomes as architecture inputs:
PASS, FAIL, INSUFFICIENT_EVIDENCE and OWNER_DISPOSITION_REQUIRED. Keep observed
result, expected result and policy dependency separate. Missing/stale/partial
proof never becomes PASS; a policy dependency does not erase a technical FAIL.
These and the refusal states in section 14 are conceptual semantics, not new APIs.

| AISEC-5 handoff queue | AISEC-6 disposition |
|---|---|
| RESEARCH_COMPLETE_INPUT: atomic vocabulary, exact identity, results, predecessor mapping, SVR-001..SVR-036 | Consumed in sections 4, 7, 19, 22 and 25; each SVR mapped, none declared satisfied |
| OPEN_DESIGN_QUESTION: canonical identity join | SADR-01 candidate join; ODR-01 owns registry/principal policy; FI-01/FV-01 |
| OPEN_DESIGN_QUESTION: approval authenticity, display, lifetime/replay | SADR-02/03; ODR-02 owns eligibility/lifetime; FI-02/03, FV-02/03 |
| OPEN_DESIGN_QUESTION: semantics versus scope | SADR-07 requires deterministic authority independent of semantic grading; ODR-08 owns quality acceptance |
| OWNER_DISPOSITION_REQUIRED: audiences, diagnostics, retention, intentional transfer | ODR-03/04/05 and SADR-04/06/09; unresolved |
| OWNER_DISPOSITION_REQUIRED: host isolation and actual deployed authority | ODR-06/07; SADR-08/11; deployment facts U01/U04/U05 |
| FUTURE_IMPLEMENTATION_DEPENDENCY: host adapters, renderer, replay/import and authority enforcement | FI-01 through FI-12; no adapter implemented |

## 5. Current versus target architecture matrix

All current cells are CURRENT_REPOSITORY_FACT unless marked predecessor/unknown.
Strength refers to the particular fact, never complete boundary certification.

| Boundary / capability | Current repository fact | Evidence strength | Target architecture property | Current gap | Decision owner | Implementation | Verification | Controlled Release relevance |
|---|---|---|---|---|---|---|---|---|
| Principal/project/root | Explicit profile and valid real root required independently (E02) | Source observed | Authenticated, authorized join, SADR-01 | Matching labels do not establish ownership | PO / trusted host, ODR-01 | FI-01 | FV-01 | Required for applicable enabled effects |
| Review actor | Caller reviewer string, unkeyed digest, derived status (E03) | Source observed | Authentic human decision with scoped role | No actor proof | PO / review host, ODR-02 | FI-02 | FV-02 | AT-07 and existing guard retained |
| Review presentation | Canonical package rebuilt at apply; no supported renderer credited (E03/E01) | Source plus normative restriction | Exact canonical display/record/apply correspondence | Apply recomputation is not display proof | Review host | FI-03 | FV-03 | Existing presentation restriction mandatory |
| Approval replay | Content/project checks; root absent in review record, no nonce/expiry contract (E03) | Source observed | Exact subject, operation and consumable authorization | Same-byte checkout/restored-base reuse | Review/host, ODR-02/05 | FI-02/06 | FV-02/06 | Enabled write/execute scope |
| Persisted triage context | Analyzer validates profile/root, reads context, no join before provider (E02) | Source observed | Authenticated import/consumption scope | XI-01 | Triage/host | FI-05 | FV-05 | Immutable XI restriction |
| Embedded history | Null separate history leaves embedded field; prompt forwards it (E02) | Source observed | Nested eligibility and bounded projection at consumption | XI-02 | History/prompt owner | FI-05 | FV-05 | Immutable XI restriction |
| Provider input/account | Prompt projection; fixed initial Groq/Gemini hosts; import-time key (E06/E07) | Source observed; account U | Authorized content/account/host envelope | No authenticated project/account join; redirect U | Provider host, ODR-03/07 | FI-04/09 | FV-04/09 | Enabled provider transfer |
| RTI acquisition | Source-specific config/redirect refusal, normalized validation (E04) | Source observed | Authorized selectors/member scope before lossy projection | Descriptive provenance is not source permission | Source host, ODR-01/04 | FI-09 | FV-09 | Enabled acquisition |
| Publishing | CREATE_ONLY sequential no retry; invalid-2xx can continue (E05) | Source observed | Authorized mapping/audience; unknown-outcome reconciliation | No source/destination join or durable ledger | Publisher, ODR-04/09 | FI-09 | FV-09 | Enabled remote write |
| Error/cause/log | Azure rejected queryType echoed; generic loader preserves cause (E04); selected safe triage summaries (E02) | Source observed | Sink-specific disclosure contracts | Bounded outer error does not sanitize cause | Data/caller, ODR-03/05 | FI-04 | FV-04 | Caller visibility distinct from publication |
| Filesystem apply | Canonical package, scope, topology/base bytes, rollback checks (E03/E08) | Source observed | Least authority in authenticated root with explicit race limits | Root authorization/races/OS aliases | Apply/host, ODR-06/07 | FI-07 | FV-07 | Before supported mutation |
| Execute/process tree | Closed target/argv, env names, shell:false; direct child kill (E08) | Source observed | Authorized execution with demonstrated resource/descendant limits | No post-launch sandbox | Host/PO, ODR-06 | FI-08 | FV-08 | Actual environment proof required |
| CI/comments/artifacts | Declared job permissions/key mapping; marker first page, no author gate (E10) | Source observed; effective platform U | Exact producer/subject, authorized audience and target | Declaration not effective scope; retention/audience U | CI/admin/data, ODR-03/05/07 | FI-04/10 | FV-04/10 | Sensitive use and deployment |
| Governance evidence | Shape-valid trust labels, Git-object readers, subject checks (E11) | Source observed | Authentic collection and independent review | Label does not authenticate adapter | PM / review host | FI-10 | FV-10 | Evidence necessary, no release authority |
| Package boundary | Exports/files exclude private #22/#23 (E12) | Config observed, no new distribution probe | Guard preserved across actual distribution | Manifest not installed-package proof | Package/release owner | FI-11 | FV-11 | Enabled surface inventory |
| Persistent/shared state | Current curated selector; process config cached; future MEM/RAG/LEARN remain separate (E07/E12/E01) | Source/config plus predecessor inventory | Namespace/scope before reuse/relevance | No future tenant guarantees credited | PO/future host | FI-06/12 | FV-06/12 | No activation here |

## 6. Trust and authority model

ARCHITECTURE_DECISION_PROPOSED (SADR-01/07/10): a trusted host establishes
principal and invocation scope outside content/model influence. Deterministic
consumers constrain each operation using that scope and current policy. A model
may propose hostile schema-valid data. It cannot mint principal, policy,
capability, approval, credential selection, project mapping or release authority.

The trust taxonomy separates origin from authority: SYSTEM_INSTRUCTION and
TRUSTED_POLICY are controlled by the authorized host/governance seam; USER_INTENT
requires authenticated principal scope; PROJECT_CONFIGURATION is trusted only
for its host-authorized fields; UNTRUSTED_REQUIREMENT,
UNTRUSTED_REPOSITORY_CONTENT, EXTERNAL_API_DATA, GENERATED_CONTENT,
HUMAN_REVIEW_DATA and FUTURE_PERSISTED_DATA remain content; SECRET is a
confidentiality class, never instruction authority. AISEC-1/2 conceptual names
map to these categories without introducing runtime enums. A trust label supplied
with content is itself ASSERTED data until independently verified.

| Actor / authority | Proposed responsibility and limit |
|---|---|
| Human principal | Request operations within host-established project permissions; no authority merely from a name |
| Agent / model | Produce proposals and analysis; no policy/approval/effect self-certification |
| Deterministic validator | Check exact structure, identity, scope and policy; validity is not actor authentication |
| Review host / renderer | Establish eligible reviewer interaction and exact displayed subject; cannot grant unrelated owner authority |
| Independent Senior / Security reviewer | Approve technical evidence within separately established role and exact subject; implementation participant cannot act as independent approval |
| Product Owner / authorized policy owner | Authorize implementation, architecture/policy disposition, risk and release within existing governance; technical approval alone insufficient |
| Merge authority | Separate explicit governance authorization and executor eligibility, per E11; review may authorize only when the existing contract explicitly says so |
| Runtime host / credential custodian | Consume valid operation-specific authorization immediately before effect; merge/review approval alone is not runtime authority |
| Platform/service principal | Exercise only verified platform credential scopes, not the human's entire authority |

APPROVED_EXISTING_DECISION: governance-process-v3 preserves independent review,
self-approval/self-merge/self-closure prohibition and standard two-parent merge
(E11). SECURITY section 28 preserves supported-review presentation restrictions
(E01). ROADMAP preserves XI enablement disposition (E01). These existing decisions
are carried, not amended. No other proposal in this artifact is owner-approved.

## 7. Identity and provenance architecture

SADR-01 candidate: distinct identities are never conflated even if names match.

| Identity | Required proposed provenance / binding |
|---|---|
| Human principal | Authenticated subject plus issuer, role and eligible project permissions; no raw secret in evidence |
| Agent | Agent instance/role, authorized version/config and delegating human/host; distinct from model/provider |
| Platform/GitHub principal | Verified platform account/bot/app/job identity and credential scope, repository and event |
| Process/runtime | OS/service identity, runtime version, executable/dependency identity and deployed authority envelope |
| Invocation/session | Host-issued invocation ID, authenticated caller, times, policy version and scoped capabilities; not caller-generated nonce alone |
| Logical project | Owner-governed namespace and permission mapping; independent from repository string |
| Repository | Trusted platform identity (including stable platform ID if available), owner/name, branch, base/HEAD/TREE and ordered parents |
| Workspace/root | Host-authorized checkout/workspace identity, canonical root/topology and revision; private absolute path may remain host-local |
| Provider | Approved executable adapter/version, transport host and credential class; selected outside model data |
| Provider project/org | Verified account/tenant/project scope where applicable; UNKNOWN is not authorized by host pinning |
| Destination/publisher | Authorized endpoint, account/org/project, operation and audience, independently mapped from origin |

Candidate binding: principal → authorized logical project → permitted repository
→ registered checkout/root/revision → authorized provider account → authorized
destination/audience. This is a set of explicit, versioned authorization edges,
not transitive trust: permission to read A does not imply permission to send A to
B. Multi-source and cross-vendor mappings remain possible only through ODR-04.
The trusted host verifies every required edge before projection/effect, maintains
an immutable invocation snapshot, and rechecks mutable dependencies at use.

| Identity assurance state | Meaning and consumer rule |
|---|---|
| ASSERTED | Caller/content states a name, object, enum, label or digest; no origin proof |
| STRUCTURALLY_VALID | Required syntax/shape validated; still no authentic source or authority |
| INTEGRITY_BOUND | Exact specified bytes/fields bound to a verified digest/reference; unkeyed digest does not prove actor |
| AUTHENTICATED | Independent trusted collection/interaction seam establishes source/actor and its chain to this subject |
| AUTHORIZED | Authenticated actor is permitted this exact operation, project, resource, destination, audience and time under current policy |

These are independent predicates, not an automatic promotion ladder. Authenticity
must originate at a separately verified host/platform/human interaction seam;
trust is consumed at source acquisition, import, provider transfer, approval,
apply, spawn and publication. E11's `PLATFORM_AUTHENTICATED` enum is only shape
checked by `validateTrustedContext`; the module does not perform authentication.
No live authenticated host adapter or registry is invented here (FI-01/FI-10).

Evidence retains AISEC-5 exact repository/branch/base/HEAD/TREE/ordered parents,
PR when present, workflow path/name/definition revision, event/run/attempt,
run head/base and actual checkout/executed SHA/TREE, all required job conclusions,
test/assertion selection/runtime, artifact digest/producer/collection seam/time,
reviewer role/independence, expiry/drift dependencies and owner decision IDs.
Missing fields are missing proof, not expectations copied into observations.
Logical project/host/source/provider/destination joins supplement Git identity.

## 8. Approval authenticity and authority architecture

SADR-02/03 propose an approval envelope bound to: authentic principal and role;
decision type; repository/project/checkout; exact base/HEAD/TREE/ordered parents
where Git-backed; canonical artifact/package and displayed-representation digest;
plan/path/operation/before-and-after bytes; provider/destination/audience and
execution scope when relevant; policy version; issuance/expiry; invocation and
operation ID; revocation/consumption state; and independent collection evidence.
This is a property list, not a new schema or selected signing protocol.

ODR-02 decides role eligibility and lifetime. Candidate safe behavior is no
execution-bearing approval accepted without an explicit bounded validity and
consumption contract. One operation cannot consume the same authorization twice;
allowed repeated executions require separately enumerated grants. The host must
atomically reserve/consume authorization around effects and preserve unknown
outcomes; retries cannot regain authority by dropping the prior attempt.
External distributed completion/ledger design remains FI-02/FI-09.

The renderer must derive display from the exact canonical package, label
system-computed facts, model-generated text and human decisions distinctly, and
prevent proposal text from impersonating UI authority. Bind what was displayed
to what was recorded and consumed; reconstructed or split presentation is not
approval evidence. An authentic reviewer signing a substituted view is still
insufficient. Authoritative input or display change invalidates approval before
effect; new HEAD needs fresh exact-head review/CI under existing governance.

Revoke or refresh on content/root/revision/policy/role/credential-scope change,
expiry, contradiction, unavailable issuer proof or changed required isolation.
Approval authentication and current authorization must be checked again at
apply and execution; an applied digest alone cannot manufacture execute authority.
Review approval != Product Owner authorization != merge authorization != runtime
execution authority. Self-produced verification or author role-switch cannot
establish independent review (SADR-10).

CURRENT_REPOSITORY_FACT: E03 uses unkeyed digests and caller reviewer/time fields;
canonical apply reconstruction checks specified content. E08 execution consumes
the applied chain without accepting a review record. None of these proves the
above actor/display/lifetime/execution authorization properties.

## 9. Data audiences and confidentiality architecture

SADR-04 proposes explicit authorization for each transition. A reviewed artifact
may still contain source data; review does not declassify it. Credential secrecy
does not decide credential-use authority. ODR-03/05 decide permitted content,
audiences, diagnostics, persistence and retention. Safe default pending policy:
withhold undecided transfers/persistence/publication and expose only fixed bounded
diagnostic summaries; this is a recommendation, not adopted owner policy.

| Data class | Internal/caller transition | Separate outward transitions requiring policy/evidence |
|---|---|---|
| Requirements | Source read/normalization/RTI processing with authorized scope | Provider input, generated artifact quotation, remote publishing, persistence |
| Evidence / repository files | Contained task-selected reads; sensitive literals possible | Prompt transfer, review display, CI artifact, comment, logs |
| Knowledge/context | Guidance selection with provenance; guidance never current-run proof | Shared reuse, persisted context, provider prompt; future retrieval separately gated |
| Prompts / model-provider input | Constructed task projection; no credential config fields intentionally projected | Provider account transfer, vendor retention/training/residency, prompt logging |
| Model/provider response | Untrusted parse/validation and bounded proposal | Caller output, error echo, downstream prompt, artifacts, comment or publication |
| Generated artifacts / reviewed code | Proposal, reviewer display, authorized apply | Execution, caller export, persistence and publication are separately authorized |
| Errors | Bounded outer diagnostic may differ from content-dependent inner value | Caller-visible text, log emission, UI rendering, persistence and remote disclosure |
| `.cause` | Original provider error preserved by generic loader (E04) | No automatic permission to log/serialize/render/publish the cause |
| Diagnostics / stdout/stderr | Raw bounded returned execution record; C7 redacts a COPY (E08) | Logging, persistence, provider re-entry, media/artifact upload separately governed |
| Logs | Emission changes audience and can be irreversible | Reader access, retention/export; later file deletion cannot retract earlier emission |
| History/cache | Origin, eligibility, counters and freshness independently verified | Nested reuse/import, persistence/retention, shared client/cache namespaces |
| Persisted context | Storage grants no authenticity or new authority | Replay/import/use under new invocation and audience; XI restrictions apply |
| CI artifacts/media | Producer/run/content identity distinct from selected prompt | Upload, access, download/import, retention and screenshots/video content |
| GitHub comments | Workflow target selection distinct from report origin | Rendered Markdown/mentions, PR readers, durable remote disclosure, author/marker selection |
| Publishing destinations | Authorized cross-vendor mapping and exact payload | Durable remote create, destination readership, retention, later export |

Treat internal processing, caller-visible disclosure, logging, persistence,
retention, publication, provider transfer and other remote disclosure as distinct
edges. Capture final bytes and actual recipients at each sink; field selection,
HTML escaping, truncation and redaction solve different problems. No universal
DLP guarantee is credited. ODR-03 includes allowed stack/path/image/source data;
ODR-05 includes raw cause/output and retention. U02/U03 preserve external facts.

## 10. Cross-project isolation architecture

SADR-05/06 require authenticated project scope at actual consumption, not only
at container creation. Repository equality does not authorize the logical project.
Root containment does not establish origin; identical bytes in another checkout
do not inherit authorization. Provider project and destination are separately
authorized. Every nested history/evidence item keeps independent origin/trust
and eligibility; a trusted outer container cannot launder foreign data.

XI-01 architecture consequence: context imports must join authenticated producer,
project/repository/root/revision/run and current invocation before a provider
request or trusted output. Profile guidance must not authenticate copied context.
XI-02 consequence: the final prompt consumer must apply authoritative nested
history eligibility/projection even when separate history is missing/ineligible.
Unavailable history remains unavailable, never fabricated zero counters. No
remediation is performed and no affected-path safety is asserted here.

SADR-06 covers imported evidence, persisted context, embedded history, cache/history
reuse and replay. Revalidate source, freshness, revocation and permitted audience
on each consumption. Separate process/client configuration per authenticated
scope; exercise sequential/concurrent interleavings before shared workers.
Cross-project reads and writes default to no granted capability; ODR-04 must
authorize intentional transfer with origin/destination/content and review evidence.
Do not infer transfer authority from identical vendor names or valid tokens.

## 11. Tool, process and host authority architecture

Each target is REQUIRED_FUTURE_ARCHITECTURE under SADR-07/08/09; this phrase
denotes proposed properties, not an additional decision status.

| Area | CURRENT_REPOSITORY_FACT / evidence | Required future property |
|---|---|---|
| Subprocess | #23G fixed local framework mapping, argv, shell:false (E08); governance has a separate bounded process primitive (E11) | Per-operation authorized binary/dependency/argv/env/cwd/resource envelope; no model-selected executable authority |
| Filesystem access | Explicit real root and selected scope; apply checks topology/base bytes (E02/E03) | Authenticated checkout mapping, least read/write paths, supported-platform normalization and stated race bounds |
| Generated-change application | CREATE/MODIFY and canonical review checks, rollback (E03/E08) | Authentic exact approval, current write permission and safe compensation, no authority from proposed content |
| Repository mutation | #23F local writes; private modules expose no Git/GitHub action path identified (E08/E12 searches) | Local write, commit, push, branch, PR and merge are separately authorized effects |
| GitHub mutation | Workflow comment upsert, marker-only first-page target (E10) | Authenticated report origin, intended author/target and permitted rendered content; no comment-derived authority |
| Provider/network calls | Fixed AI initial hosts; history env API; Jira configured HTTPS; Azure fixed host (E04/E06) | Authorized initial/final host, account/project, redirect/credential envelope and data audience |
| Publishing | Caller destination and credential, sequential CREATE_ONLY (E05) | Explicit mapping and durable outcome/replay contract; token validity does not authorize destination |
| Environment variables | Closed names on main #23G path (E08); import-time AI config (E07) | Authorized values/paths as well as names; per-invocation provider/credential selection |
| Credentials/tokens | Header/config channels separate from prompts; scopes external UNKNOWN (E04/E06/E10) | Custodian-scoped minimum use, no model credential selector, accountable issue/revoke/use lifecycle without secret evidence |
| Generated-code execution | Launched Node/framework code executes with host OS process authority; no sandbox (E08/E01) | ODR-06 deployment envelope enforced before launch; approved code cannot exceed it |
| Process-tree containment | #23G timeout calls direct child kill; separate governance POSIX group handling not inherited (E08/E11) | Demonstrated descendant termination/resource bounds on supported platform; unavailable isolation disables capability |
| Host/sandbox | No OS tenant sandbox established by inspected #23G source (E08); deployed external controls U01 | Owner-selected confinement or constrained host model with independently demonstrated actual permissions/network/credentials |

Minimum candidate capability grant records action, actor, project/repository/root,
paths/resources, executable/adapter identity, destination, credential class,
audience, time/use limits and policy evidence. Deterministic checks immediately
precede each effect; no approval bypass for rollback, retry, regeneration or
re-import. Report incomplete rollback as unresolved partial effects; quarantine
further authority until reconciliation, without deleting unauthorized resources.
Host isolation and actual deployed authority remain ODR-06/07, never chosen here.

## 12. Deterministic enforcement versus semantic evaluation

| Property | Required class | Consequence |
|---|---|---|
| Authorization | MUST_BE_DETERMINISTIC | Verify current scoped grant at effect; human policy input does not make enforcement model-dependent |
| Scope containment | MUST_BE_DETERMINISTIC | Canonical path/resource containment and supported-platform refusal |
| Project/repository/root binding | MUST_BE_DETERMINISTIC | Verify authentic join; equal strings alone insufficient |
| Approval validity | MUST_BE_DETERMINISTIC | Authentic issuer, exact subject, role, freshness/revocation/consumption checks |
| Credential access/use | MUST_BE_DETERMINISTIC | Custodian permits only explicit host/operation; secrets never selected by model |
| Filesystem write authority | MUST_BE_DETERMINISTIC | Exact approved write scope/current target/topology before effects |
| Tool invocation | MUST_BE_DETERMINISTIC | Capability and argument validation independent of hostile-valid output |
| Publishing destination | MUST_BE_DETERMINISTIC | Enforce owner-authorized source/target mapping and audience |
| Provider destination | MUST_BE_DETERMINISTIC | Enforce host/account/project and permitted payload |
| Prompt/instruction interpretation | MAY_REQUIRE_SEMANTIC_EVALUATION | Model/corpus/rubric observations assess semantics; framing cannot grant authority |
| Semantic quality | MAY_REQUIRE_SEMANTIC_EVALUATION; REQUIRES_HUMAN_REVIEW for consequential proposals | Independent rubric/reviewer assesses intended behavior and malicious in-scope code |
| Review presentation / architecture judgment | REQUIRES_HUMAN_REVIEW, with deterministic binding | Evaluate meaning and residual risk; display digest alone cannot prove understanding |
| Risk acceptance / permitted audience / autonomy scope | REQUIRES_OWNER_POLICY | ODR packages; technical PASS cannot decide acceptable risk or release |

SADR-07 resolves AISEC-2 OQ-2 as a candidate division: do not rely on semantic
filtering to enforce authority. Semantic evaluation is complementary; absence
of deterministic semantic understanding cannot create effect permission.
ODR-08 still owns quality thresholds, review scope and acceptance posture.
AISEC-2 OQ-4 projection style need not be normalized here: candidate FI-04 requires
auditable field selection at the actual consumer regardless of where projection
is built. Neither prose nor schema-valid narrative can authorize an action.

## 13. Adapter, import and replay architecture

SADR-06/10: future authenticated host/platform adapters need independent source
and issuer verification, current source permission, exact content identity,
freshness, project/repository/root binding, replay limits, revocation and consumer
verification. Trusted executable adapter code and authenticated returned data
are distinct. Verify actual collector/deployment authority; a returned trust enum
or copied digest is not source authentication.

The approval renderer and package transport must preserve canonical content and
display/decision correspondence (SADR-03). Import/historical reuse must retain
source version, producer run, collection times, integrity/authenticity proof and
policy/audience constraints. Persisted review records retain issuer, decision
type, exact subject and consumption/revocation evidence; retrieval rechecks all
applicable dependencies. An old technical PASS may remain historical but cannot
certify a new HEAD or authorize a new project. Unsupported platform/missing
required verification disables the adapter's authoritative use; non-authoritative
evidence may be retained only under ODR-03/05. No adapters are implemented.

## 14. Fail-closed architecture

Conceptual required behavior only. DENY means zero requested privileged effects;
DISABLE_CAPABILITY means no supported entrypoint may exercise the unavailable
authority. INSUFFICIENT_EVIDENCE means no certification, independently of runtime
refusal. Multiple states may apply; none grants permission. Optional evidence
may be unavailable while an independently authorized bounded operation continues.

| Case | Required state / effect rule |
|---|---|
| Unknown principal | REQUIRE_REAUTHENTICATION + DENY |
| Unknown project | DENY; REQUIRE_OWNER_DISPOSITION if namespace policy missing |
| Unknown repository | DENY; INSUFFICIENT_EVIDENCE for subject claims |
| Unknown root/checkout | DENY; no cwd/default-root fallback |
| Unknown provider/destination/account | DENY; no fallback transfer to another account/vendor |
| Missing authentication | REQUIRE_REAUTHENTICATION + DENY |
| Missing authorization | DENY; owner policy question remains separate |
| Provenance mismatch | DENY + INSUFFICIENT_EVIDENCE; quarantine authoritative reuse |
| Wrong project | DENY before read/transfer/write/spawn where that operation needs scope |
| Wrong repository/root | DENY, including same labels/bytes in foreign checkout |
| Stale approval | REQUIRE_REVIEW_REFRESH + DENY effect |
| Replayed/consumed approval | DENY; reconcile previous operation outcome, no blind retry |
| Changed content/HEAD/TREE/display | REQUIRE_REVIEW_REFRESH + DENY; invalidate dependent evidence |
| Partial validation | DENY authority-bearing use + INSUFFICIENT_EVIDENCE |
| Missing required evidence | INSUFFICIENT_EVIDENCE; DISABLE_CAPABILITY when enablement needs it |
| Contradictory trust evidence | DENY authority; preserve technical FAIL and unresolved evidence |
| Unsupported platform | DISABLE_CAPABILITY; no shell fallback to overcome known Windows limit |
| Required isolation unavailable | DISABLE_CAPABILITY; no ordinary host execution as fallback |
| Unknown policy disposition | REQUIRE_OWNER_DISPOSITION + DENY undecided effect |
| Ineligible/unknown history | Omit authoritative history after independent nested validation; do not fabricate counters |
| Unknown remote-create outcome | Suspend duplicate/retry authority; record uncertain effect and require scoped reconciliation |
| Incomplete rollback | Freeze further mutation/execute authority pending trusted reconciliation; retain partial-effect evidence |

Core rule (SADR-01/07/11): **uncertainty must never create authority**.
These proposed states do not claim current runtime enums or universal fail-closed
implementation. XI fallback and unauthenticated approvals remain current gaps.

## 15. Controlled Release boundary

SADR-11 candidate release dossier enumerates exact enabled entrypoints, hosts,
logical projects/repositories/roots, providers/destinations, credentials, audience
transitions and findings. Each boundary needs: required architecture property;
separately implemented control or precisely permitted restriction;
independently verified exact-scope evidence; and owner release authorization.
An ADR supplies only the first, as a proposal. Release is NOT APPROVED.

| Prerequisite | Evidence/authority needed before applicable enablement |
|---|---|
| Identity/provenance and project/repository binding | Authenticated join at acquisition/import/consumption/effect; FV-01/05/06 |
| Approval authenticity/presentation | Authentic eligible human, exact canonical displayed subject, fresh decision/operation scope; existing SECURITY guard, FV-02/03 |
| Provider/destination and credential handling | Verified account/host/use grants, permitted data and explicit mapping; FV-04/09 |
| Data audiences | ODR-03/05 disposition plus final-byte/access/retention evidence at each enabled sink |
| Cross-project isolation | Positive same-scope and denied foreign/copied/nested/replayed cases; XI restriction preserved |
| Tool/execution authority | Explicit actual host permission/resource/network/descendant envelope, FV-07/08/10; no sandbox inferred from launcher |
| Open findings | Capability-specific applicability and existing dispositions; proposals are not remediation, acceptance or waiver |
| Disabled capability evidence | Check all supported API/CLI/UI/workflow/package/import/replay entrypoints and alternate paths; feature label insufficient |
| Verification evidence | AISEC-5 exact identity/results, required assertions/jobs and independent reviews; FV-10/11 |
| Human/owner authority | Fresh independent HEAVY Senior/Security review, PO disposition, separate merge/release authority under governance |

XI-01/XI-02 must remain disabled or constrained by a separately demonstrated
trusted/provenance-bound input contract until future implementation plus
independent verification. Normal fresh CI, matching strings, this artifact or
owner wording alone does not demonstrate that contract. No new blocker count,
deferral, safe-release claim or finding disposition is invented.

## 16. Higher-autonomy escalation

SADR-12 proposes monotonic evidence and containment with added authority.

| Expansion | Additional prerequisite beyond existing narrow assurance |
|---|---|
| Autonomous tool selection | Enumerated capability broker, deterministic per-operation grants/argv/destination checks, bounded plan and independent effect evidence |
| Automatic repository mutation | Authentic checkout/subject, consumption ledger, conflict/race limits, rollback authority, separate Git/PR/merge grants |
| Automatic publishing | Explicit mappings/audiences, replay/idempotency/reconciliation policy, durable exact effect evidence |
| Persistent memory | Scoped write authority, provenance, retention/deletion/revocation and retrieval-time revalidation; stored data gains no trust |
| Retrieval/RAG | Authenticated namespace hard filters before similarity, independently governed source ingestion and cache partition |
| Cross-project operation | Explicit intentional transfer seam, distinct clients/accounts/roots, concurrency/interleaving and namespace evidence |
| Generated-code execution | Verified actual host confinement and dependency/process-tree/network limits before approved code launch |
| Reduced human confirmation | Separately owner-authorized policy/capability replacing each removed gate, independently verified equivalent bounded authority; old human-gated proof cannot transfer |
| Long-lived state | Lease/revocation/key rotation, drift rechecks, durable consumption/history provenance, restart/crash recovery evidence |

MEM/RAG/LEARN and full autonomy are NOT STARTED by this mission. ODR-01..09
must be revisited for each authority delta; prior release assurance is scoped,
not inherited automatically by a more autonomous deployment.

## 17. Decision register

Twelve material candidate records follow. Each field is explicit. FI/FV and ODR
references expand into the concrete dependencies/packages in sections 23–25.
All twelve records have status ARCHITECTURE_DECISION_PROPOSED; no new decision is
APPROVED_EXISTING_DECISION. Existing decisions carried in section 6 retain only
their original normative scope.

### SADR-01 — Canonical identity joins without trust promotion

| Field | Record |
|---|---|
| ID / title | SADR-01 / Canonical identity joins without trust promotion |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Valid labels/root/digests can describe the wrong project or actor |
| Current repository facts | E02 validates profile/root independently; E11 validates trusted-context shape, not authenticity |
| Predecessor inputs | AISEC-3 OQ3-1/7; AISEC-4 OQ4-01/02/05/09; AISEC-5 identity handoff |
| Decision / required property | Authenticate distinct identities and authorize every edge of section 7's invocation join at consumption |
| Trust boundary | Caller/asserted labels → trusted host → source/model/effect consumer |
| Authority owner | PO defines namespace/delegation; host enforces permitted edges |
| Positive permitted case | Authentic principal operates in registered authorized checkout with approved provider/destination |
| Denied / fail-closed case | Consistent caller labels on foreign root cannot authorize a request/write/spawn |
| Identity/provenance | Issuer/actor/invocation, logical project, repo/base/HEAD/TREE/parents, checkout, provider/account and target evidence |
| Data/confidentiality | Join stays outside model semantics; absolute paths and credential values need not be published |
| Implementation dependency | FI-01; separately authorized host registry/interaction and consumers |
| Verification dependency | FV-01; mutate each identity edge including identical foreign checkout |
| Related AT/PI/TB/XI/SVR | AT-05/07/16; PI-12/14; TB-01/02/04/09; XI-01; SVR-006/008/016/018/020/026/028 |
| Controlled Release relevance | Required for enabled authoritative consumption/effects, no current join credited |
| Higher-autonomy relevance | Mandatory before shared workers/automatic effects; stronger leases and concurrency proof |
| Alternatives considered | Caller labels plus digest; repository equality alone; trusted host-authorized mapping |
| Trade-offs | Host join adds lifecycle/registry burden; avoids false authentication from cheap validation |
| Residual risk / limitations | Compromised issuer/host or stale mapping; authentication protocol and deployed host UNKNOWN |
| Owner decision dependency | ODR-01/04/07; namespace owner, intentional mappings and deployed principals unresolved |

Resolves the handoff as a candidate join model; constrains TB-04/09 mechanisms,
but leaves their findings open and the authentication mechanism unimplemented.

### SADR-02 — Authentic operation-specific approvals

| Field | Record |
|---|---|
| ID / title | SADR-02 / Authentic operation-specific approvals |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Fabricated reviewer strings and valid unkeyed seals can appear to authorize effects |
| Current repository facts | E03 record has caller reviewer/time fields and plain SHA-256; no human authentication; execution does not revalidate review record (E08) |
| Predecessor inputs | AISEC-1 AT-07/SEC-I8; AISEC-3 OQ3-7/8; AISEC-5 authenticity/lifetime handoff |
| Decision / required property | Section 8 authentic exact approval with separate decision type, validity, revocation and atomic operation consumption; reauthorize execute |
| Trust boundary | Review interaction → approval transport → apply/execute/merge consumer |
| Authority owner | Eligible review principal for exact decision; PO/governance and runtime host retain separate grants |
| Positive permitted case | Authentic eligible reviewer approves exact subject; independently permitted runtime operation consumes its bounded grant |
| Denied / fail-closed case | Forged actor, expired/revoked/consumed record or changed root/content gives zero requested effects |
| Identity/provenance | Actor/role/issuer, canonical content and display digest, project/repository/checkout/HEAD/TREE, operation and current policy |
| Data/confidentiality | Review may expose full code/source; approve audience separately; never retain secret credentials in approval evidence |
| Implementation dependency | FI-02, FI-01 and FI-08; authentic approval seam/ledger/use consumers |
| Verification dependency | FV-02; authentic positive versus forged seal, replay, expiry, restored base and crash ambiguity |
| Related AT/PI/TB/XI/SVR | AT-07/14/16; PI-08/09; TB-01/02/03/18; XI-01 input authority adjacent; SVR-006/007/008/009/034 |
| Controlled Release relevance | Existing authenticity guard and enabled apply/execute requirements remain unsatisfied |
| Higher-autonomy relevance | Removal of human confirmation requires separately approved equivalent grant, never unrestricted old approval |
| Alternatives considered | Unkeyed seals alone; platform-backed approvals; signed host envelopes with revocation/consumption |
| Trade-offs | Authentic transport/ledger improves actor and replay proof; distributed unknown outcomes complicate consumption |
| Residual risk / limitations | Genuine reviewer can approve malicious code; signing alone does not prove intended displayed subject or eligible role |
| Owner decision dependency | ODR-02/05/07; roles, validity/renewal, storage and custodian policy |

Constrains approval forgery/replay; no TB-01/03 remediation or lifetime policy
acceptance is claimed. A mechanism choice remains future implementation design.

### SADR-03 — Canonical reviewer presentation

| Field | Record |
|---|---|
| ID / title | SADR-03 / Canonical reviewer presentation |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Authentic approval of a detached/substituted view does not approve the applied bytes or claims |
| Current repository facts | E03 rebuilds canonical package at apply; E01's supported-presentation guard remains open; no renderer implemented here |
| Predecessor inputs | AISEC-2 OQ-1/PI-08; AISEC-3 OQ3-6; AISEC-4 N21 qualification; SVR-005 |
| Decision / required property | Renderer derives one canonical subject; label system/model/human content, bind display/record/apply identities and prevent split presentation |
| Trust boundary | Proposal data → reviewer-visible representation → authentic decision |
| Authority owner | Trusted review host, eligible reviewer; PO owns activation |
| Positive permitted case | Reviewer sees canonical before/after content and exact scope with provenance labels; record binds same representation |
| Denied / fail-closed case | Detached reconstruction or changed display/package requires review refresh before effect |
| Identity/provenance | Package, representation, actor/role, exact subject and display-version collection proof |
| Data/confidentiality | Full display has separate audience policy; model rationale remains untrusted content |
| Implementation dependency | FI-03; renderer/package transport plus FI-02 interaction |
| Verification dependency | FV-03; altered purpose/before state/bytes, time-split display, hostile UI-like rationale |
| Related AT/PI/TB/XI/SVR | AT-07/14; PI-08/09; TB-01/18; XI findings not remediated; SVR-005/006/007 |
| Controlled Release relevance | Preserve APPROVED_EXISTING_DECISION SECURITY section 28 restriction before supported reviewer enablement |
| Higher-autonomy relevance | Automated review cannot silently inherit human display proof or manufacture independent approval |
| Alternatives considered | Caller-provided view; canonical server renderer; deterministic local rendering with independently proven transport |
| Trade-offs | Canonical presentation limits flexibility and needs display integrity; avoids misleading detached summaries |
| Residual risk / limitations | Reviewer persuasion/understanding remain human factors; digest proves correspondence, not comprehension |
| Owner decision dependency | ODR-02/03/08; eligible reviewer, display audience and review rubric |

Carries N21's narrower apply-time content fact and leaves the separate display
guard and AT-07 open. Renderer existence cannot be inferred from package builders.

### SADR-04 — Explicit audience transitions

| Field | Record |
|---|---|
| ID / title | SADR-04 / Explicit audience transitions |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Prompt minimization or safe outer errors can hide richer raw records and downstream disclosure |
| Current repository facts | E02 selectively projects fields but forwards some containers; E04 preserves cause and echoes rejected queryType; E08 redacts prompt copy only |
| Predecessor inputs | AISEC-4 DE-01..20/DXI-05..12/OQ4-07; AISEC-5 diagnostics/audience handoff |
| Decision / required property | Authorize each section 9 edge/content/audience; classify actual final bytes and sanitize at each permitted sink |
| Trust boundary | Internal data → caller/error/log/storage/provider/artifact/comment/publication audiences |
| Authority owner | PO/data owner decides audiences; each producer/consumer enforces its sink contract |
| Positive permitted case | Approved task data retained in permitted prompt and bounded caller summary; required evidence not silently destroyed |
| Denied / fail-closed case | Undecided cause/log/media/provider exposure withheld, no permission inferred from a prior review |
| Identity/provenance | Origin project/content class, consumer/audience/destination, policy version, final payload digest and producer |
| Data/confidentiality | Separate all eight transition types; credential exclusion, escaping, truncation and retention are different properties |
| Implementation dependency | FI-04; sink projection/policy gates, no universal scanner invented |
| Verification dependency | FV-04; separate canary traces at cause, caller, prompt, log, raw record, upload and comment |
| Related AT/PI/TB/XI/SVR | AT-12/13/16; PI-02/04/06/13; TB-06/07/14; XI-02; SVR-002/020/021/022/023/024/025/027 |
| Controlled Release relevance | Sensitive enabled sinks require owner policy plus observed enforcement/audience evidence |
| Higher-autonomy relevance | Longer retention and automatic remote effects add more audience edges |
| Alternatives considered | Global exfiltration flag; prompt-only redaction; explicit sink-specific contracts |
| Trade-offs | Separate policies/tests cost more but avoid equating caller diagnostics with remote disclosure |
| Residual risk / limitations | Unknown formats, external vendor retention and human disclosure; universal semantic DLP not proved |
| Owner decision dependency | ODR-03/05; permitted fields/audiences, diagnostics/storage and retention unresolved |

Constrains confidentiality claims while carrying all DE observations with their
limits. It does not select data policy or declare existing diagnostics sanitized.

### SADR-05 — Context and nested history consumption boundaries

| Field | Record |
|---|---|
| ID / title | SADR-05 / Context and nested history consumption boundaries |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Copied context and surviving embedded history can reach provider under a different invocation |
| Current repository facts | E02 main lacks context/profile join; `if (history)` preserves embedded history on null; prompt reads that field |
| Predecessor inputs | XI-01/02 and immutable ROADMAP disposition; AISEC-5 sections 13/14 |
| Decision / required property | Authentic scope at actual analyzer consumer and independent nested eligibility/projection; trusted outer does not trust nested history |
| Trust boundary | Persisted context/history import → analyzer/prompt/provider and trusted report |
| Authority owner | Triage/history host implements; PO retains immutable enabled-capability disposition |
| Positive permitted case | Fresh same-scope provenance-bound context; eligible four-counter history; benign no-history remains unavailable |
| Denied / fail-closed case | Copied/relabelled/foreign context or null/ineligible separate history cannot grant nested prompt authority |
| Identity/provenance | Invocation/project/repository/root/revision/run/producer per item and container |
| Data/confidentiality | Unprojected nested extras may be sensitive; prompt and returned report are measured independently |
| Implementation dependency | FI-05 after FI-01; separately authorized future triage/history remediation |
| Verification dependency | FV-05; actual public main-to-prompt path including all null/ineligible alternatives |
| Related AT/PI/TB/XI/SVR | AT-05/12/16; PI-14; TB-04/09; XI-01/XI-02; SVR-026/027/028/035 |
| Controlled Release relevance | Both XI restrictions immutable; disabled path or separately demonstrated trusted/provenance-bound input contract required |
| Higher-autonomy relevance | Shared/imported/persisted inputs require stronger producer and nested provenance |
| Alternatives considered | Trust fresh CI normally; clear field only; authentic consumer join plus nested selection |
| Trade-offs | Rejects formerly accepted copied data; explicit authorized imports can preserve valid reuse |
| Residual risk / limitations | Authentication/import mechanism absent; no remediation or trusted alternative contract demonstrated here |
| Owner decision dependency | ODR-01/03/05; cannot weaken XI disposition or select a waiver |

Carries OPEN / MEDIUM unchanged for both XI findings. Architecture requirements
do not close, re-rate, remediate or certify either affected path.

### SADR-06 — Scoped state, import and replay

| Field | Record |
|---|---|
| ID / title | SADR-06 / Scoped state, import and replay |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Historical approval/evidence/client state can borrow trust across projects or invocations |
| Current repository facts | E07 caches config at module import; E02/03 accept caller labels and portable records; no durable replay authorization credited |
| Predecessor inputs | TB-02/03/04; AISEC-4 state inventory/OQ4-11; AISEC-5 SVR-028/029 |
| Decision / required property | Partition clients/cache/state by authentic scope; reauthorize imports/reuse, freshness/revocation and nested origins on every consumption |
| Trust boundary | Storage/cache/historical producer → current invocation; project A → B |
| Authority owner | Invocation/import host; PO/data owner owns intentional reuse and retention |
| Positive permitted case | Approved same-scope historical data imported with source, age and content identity; explicit cross-project transfer separately authorized |
| Denied / fail-closed case | Same bytes/labels, stale config or trusted container cannot transfer authority to foreign nested data |
| Identity/provenance | Origin and receiving invocation, namespace/version, producer run, content/digest, account and expiry/drift chain |
| Data/confidentiality | Reuse is a new audience/use decision; evidence retention not automatic learning promotion |
| Implementation dependency | FI-06, FI-01/02; host partition/import/consumption and restart recovery |
| Verification dependency | FV-06; sequential/concurrent A/B, copied/expired data, restart/revocation and same-byte roots |
| Related AT/PI/TB/XI/SVR | AT-03/05/10/11; PI-04/06/14/15; TB-02/03/04; XI-01/02; SVR-008/009/015/028/029 |
| Controlled Release relevance | Applies to enabled reuse; absent future memory is not a passed tenant-isolation test |
| Higher-autonomy relevance | Hard namespace before relevance; durable leases/consumption for long-lived state |
| Alternatives considered | Labels as namespace; shared cache plus final prompt filter; explicit scope-bound state |
| Trade-offs | Reduced cache sharing and added invalidation cost; privacy can use opaque checkout IDs rather than published absolute roots |
| Residual risk / limitations | Concurrent/crash ledger behavior and global namespace ownership unresolved; no shared service implementation claimed |
| Owner decision dependency | ODR-01/04/05; reuse age, import authority and intentional transfer |

Resolves the architecture side of historical reuse while leaving policy and
future tenant implementation open. Reuse never upgrades generated data to policy.

### SADR-07 — Deterministic authority independent of model semantics

| Field | Record |
|---|---|
| ID / title | SADR-07 / Deterministic authority independent of model semantics |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Hostile schema-valid output may persuade models/reviewers while satisfying structural validators |
| Current repository facts | E07 policy forces non-PRODUCT_BUG flags false; E08 applies deterministic protected-path/plan checks; free text is not proved semantically safe |
| Predecessor inputs | AISEC-2 OQ-2/4 and enforcement-depth table; AISEC-5 semantic handoff |
| Decision / required property | Section 12 authority classes deterministic; proposal text/prompts never grant capabilities; semantic grading and human review complementary |
| Trust boundary | Untrusted instructions/model proposals → deterministic action consumer |
| Authority owner | Host enforces owner-authorized capabilities; independent reviewer judges meaning; PO accepts policy/risk |
| Positive permitted case | Benign valid proposal under explicit grant succeeds; projection style may vary if actual payload contract is auditable |
| Denied / fail-closed case | Injected approval/policy/tool claims in valid narrative cannot increase effects |
| Identity/provenance | Exact input/output, model/version for semantic sample, current grant/policy and effect trace |
| Data/confidentiality | Schema-valid prose may quote secrets; audience gate remains independent |
| Implementation dependency | FI-07 plus FI-01/04; per-effect capability and projection consumers |
| Verification dependency | FV-07/FV-12; hostile-valid output with positive controls and independent semantic rubric |
| Related AT/PI/TB/XI/SVR | AT-01/02/03/06/15/16; PI-01/03/05/06/07/09/10/13; TB-06/12/16; XI-02; SVR-001/002/003/004/010/011/012 |
| Controlled Release relevance | No prompt-obedience or generic schema PASS can discharge authority obligations |
| Higher-autonomy relevance | Capability broker stays deterministic even with autonomous tool choice |
| Alternatives considered | Prompt-only guard; model safety score grants tools; deterministic envelope plus semantic review |
| Trade-offs | Cannot deterministically prove arbitrary code intent; narrow scope still needs host isolation/review |
| Residual risk / limitations | Malicious in-scope content and human persuasion remain; corpus results not universal immunity |
| Owner decision dependency | ODR-08/01/06; quality acceptance, tool scope and execution envelope |

Constrains inherited injection paths; carries their original ratings. Semantic
evaluation cannot replace deterministic scope or independently authenticate intent.

### SADR-08 — Explicit execution and host authority envelope

| Field | Record |
|---|---|
| ID / title | SADR-08 / Explicit execution and host authority envelope |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Safe launch syntax still runs arbitrary approved code with host files/network/credentials |
| Current repository facts | E08 closed argv/env/classifier, shell:false and direct-child kill; E01 disclaims sandbox and Windows support |
| Predecessor inputs | TB-10/11/12/13/14/17; AISEC-4 OQ4-06; AISEC-5 host handoff |
| Decision / required property | Before launch verify owner-approved actual filesystem/network/credential/resource/descendant envelope; unsupported required isolation disables capability |
| Trust boundary | Reviewed applied code → process/runtime/dependency → host and network resources |
| Authority owner | PO selects host model; deployment/security custodian establishes limits; runtime consumes execution grant |
| Positive permitted case | Approved synthetic execution accesses only declared resources in demonstrated eligible environment |
| Denied / fail-closed case | Missing host proof, unsupported Windows launch or unavailable isolation gives no fallback spawn |
| Identity/provenance | OS/runtime/host image, dependency/binary, checkout/after bytes, grant, env values, resource policy and execution identity |
| Data/confidentiality | Env names exclude typical keys but allowed values and ambient credential files need separate evidence |
| Implementation dependency | FI-08; platform-specific host and descendant controls under ODR-06; no sandbox selected |
| Verification dependency | FV-08; isolated synthetic sibling/network/descendant tests and safe launcher stubs |
| Related AT/PI/TB/XI/SVR | AT-09/16; PI-11; TB-10/11/12/13/14/17; XI status unaffected; SVR-010/011/012/013/014/015/032 |
| Controlled Release relevance | Exact enabled demonstration/deployment proof, not cwd or shell:false, required |
| Higher-autonomy relevance | More tools/generated code require stronger confinement and effect budgets |
| Alternatives considered | Operator ambient host; disposable constrained host; OS/container/VM capability isolation |
| Trade-offs | Compatibility/operational cost versus containment; no option can be credited without its actual enforcement proof |
| Residual risk / limitations | Dependencies, OS aliases/races and remote effects; timeout cannot undo already completed effects |
| Owner decision dependency | ODR-06/07; supported hosts, real deployed permissions and credential availability |

Leaves the deliberate current not-a-sandbox boundary and its findings unchanged.
Selecting or accepting host-ambient execution is owner policy, not this decision.

### SADR-09 — Authorized sources, providers and publishing outcomes

| Field | Record |
|---|---|
| ID / title | SADR-09 / Authorized sources, providers and publishing outcomes |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Valid credentials/hosts can access wrong projects; uncertain creates/reinvocation can duplicate effects |
| Current repository facts | E04 source config/manual redirects; E06 AI initial endpoints/history env base; E05 no retry with item-local invalid-2xx continuation |
| Predecessor inputs | AT-04/08/16, TB-05/15/19; AISEC-4 OQ4-03/04/10; AISEC-5 SVR-016..020 |
| Decision / required property | Authorize source/account/host and explicit cross-vendor destination mapping before transfer; preserve uncertain outcomes and require approved reconciliation/replay contract |
| Trust boundary | Source selector/credential → RTI; prompt → provider; design → remote create |
| Authority owner | Source/provider/publisher host and credential custodian; PO owns allowed mappings/outcome policy |
| Positive permitted case | Owner-authorized Jira-to-Azure mapping with permitted content and correlated known creation |
| Denied / fail-closed case | Wrong valid org/project/account, unauthorized redirect or uncertain duplicate retry cannot gain request authority |
| Identity/provenance | Authentic principal/source/project, adapter/account/host, destination/audience, operation/request/payload and returned remote identity |
| Data/confidentiality | Credential use separate from secrecy; target readership and vendor retention require ODR-03/05 |
| Implementation dependency | FI-09; trusted transport/mapping, scope evidence and outcome ledger/consumer policy |
| Verification dependency | FV-09; fake redirects, out-of-scope IDs, positive cross-vendor POST, timeout/5xx/invalid-2xx and replay |
| Related AT/PI/TB/XI/SVR | AT-04/06/08/16; PI-05/12; TB-05/06/15/16/19; XI-01 provider boundary adjacent; SVR-016/017/018/019/020 |
| Controlled Release relevance | Enabled acquisition/provider/publishing scope requires independent mapping/use/audience proof |
| Higher-autonomy relevance | Automatic publication requires durable replay/concurrency/outcome budgets |
| Alternatives considered | Source/destination name equality; trust valid token; explicit mapping with known/unknown outcome accounting |
| Trade-offs | Explicit mappings preserve vendor independence; ledgers add operational recovery burden |
| Residual risk / limitations | Vendor rights/membership/retention and effective redirect behavior U02/U03/U06; no live calls used |
| Owner decision dependency | ODR-01/03/04/07/09; source/project, data, credential and ambiguity policy |

Constrains deputy/misrouting/replay claims while preserving no-write-retry as the
current narrower fact. No universal batch-stop claim or vendor authorization proof.

### SADR-10 — Authentic independent security evidence

| Field | Record |
|---|---|
| ID / title | SADR-10 / Authentic independent security evidence |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Copied metadata/green CI/self-produced oracle can impersonate exact-scope independent approval |
| Current repository facts | E11 shape-valid contexts/Git-object readers/revalidation; governance independent-review rule; E10 tracked CI declarations, not live settings |
| Predecessor inputs | AT-14/SEC-I10; AISEC-5 atomic evidence, result and identity handoff |
| Decision / required property | Authenticate evidence collection; preserve exact subject/run/attempt/assertions and independent oracle/reviewer; no self-certification |
| Trust boundary | Candidate, CI/adapters/historical records → verification aggregation → human/owner lifecycle |
| Authority owner | Trusted evidence collector; independent Senior/Security; PM/PO for progression |
| Positive permitted case | Fresh exact-scope CI with actual checkout mapping and all required assertions plus eligible independent review |
| Denied / fail-closed case | Old HEAD, partial/skipped jobs, copied label/digest or author role-switch yields insufficient certification |
| Identity/provenance | Complete section 7 evidence fields, authentic collection seam and reviewer participation/independence |
| Data/confidentiality | Evidence reports/logs need separate audience/retention; secret values not needed to prove scope |
| Implementation dependency | FI-10; authenticated platform adapters and trusted report storage/transport |
| Verification dependency | FV-10; wrong event/head/base/attempt/checkout, missing assertions, forged trust and oracle tampering |
| Related AT/PI/TB/XI/SVR | AT-09/14/15; PI-09; TB-16/17/20; XI-01/02 evidence restrictions; SVR-030/032/033/034/035 |
| Controlled Release relevance | Technical results plus owner authority remain distinct even when all scoped results PASS |
| Higher-autonomy relevance | Expanded authority needs new independent oracle/corpus/deployment proof |
| Alternatives considered | Green workflow only; trust-label metadata; authenticated exact-scope evidence with independent review |
| Trade-offs | Collection and refresh burden; prevents stale convenience evidence certifying new subjects |
| Residual risk / limitations | Collector compromise, missing external settings and CI workflow inference; author checks are never independent approval |
| Owner decision dependency | ODR-03/05/07/08; storage, platform authority and semantic acceptance |

Carries AISEC-5 result semantics and E11 existing governance. It neither certifies
this candidate nor turns historical TB20-WF-INFERENCE into current platform fact.

### SADR-11 — Capability-specific Controlled Release prerequisites

| Field | Record |
|---|---|
| ID / title | SADR-11 / Capability-specific Controlled Release prerequisites |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Architecture prose or omitted capabilities may be mistaken for implemented verified release safety |
| Current repository facts | E01 preserves XI OPEN/MEDIUM disposition and review guards; E12 private package exclusions are declared |
| Predecessor inputs | AISEC-4 release relevance; AISEC-5 SVR-031/035 and XI acceptance restrictions |
| Decision / required property | Section 15 dossier separates required property, actual implemented control, verified evidence and owner release grant per enabled boundary |
| Trust boundary | Candidate architecture/evidence → capability enablement/release authorization |
| Authority owner | PO/release authority; PM and independent reviewers verify applicability/evidence |
| Positive permitted case | Verified disabled capability or separately demonstrated trusted/provenance-bound contract within immutable XI restriction |
| Denied / fail-closed case | Enabled affected XI path with no permitted restriction/proof cannot be certified; no approval from ADR existence |
| Identity/provenance | Exact distribution/entrypoints/host/accounts, HEAD/TREE/CI/reviews, finding dispositions and owner scope |
| Data/confidentiality | Release includes enabled audiences/retention, not only prompt safety |
| Implementation dependency | FI-11 and applicable FI-01..10; no release tooling implemented |
| Verification dependency | FV-11; actual package/entrypoint enablement inventory, alternate bypass and independent dossier |
| Related AT/PI/TB/XI/SVR | AT-07/16; PI-08/11/12/14; TB-01/02/04/05/12/14; XI-01/XI-02; SVR-031/034/035 |
| Controlled Release relevance | Defines candidate prerequisites only; Controlled Release NOT APPROVED |
| Higher-autonomy relevance | Prior restricted release cannot authorize broader scope |
| Alternatives considered | Global secure/not-secure flag; roadmap-complete implies readiness; capability/evidence/owner-specific gate |
| Trade-offs | More inventory work; avoids certifying disabled/future paths as passed controls |
| Residual risk / limitations | Unsupported alternate entrypoints or external deploy drift; disabled-path proof not supplied here |
| Owner decision dependency | ODR-01..09 for applicable enabled scope; immutable XI disposition not reopened |

Carries existing restrictions and leaves all finding statuses intact. This record
does not implement disabled paths, demonstrate an alternate contract or release.

### SADR-12 — Monotonic autonomy and separate future gates

| Field | Record |
|---|---|
| ID / title | SADR-12 / Monotonic autonomy and separate future gates |
| Status/classification | ARCHITECTURE_DECISION_PROPOSED |
| Problem / threat | Persistent/shared/automatic authority can inherit evidence from a narrower human-gated product |
| Current repository facts | E01 retains AISEC-7/future sequence and distinct Type & Schema gate; E12 current knowledge selector is not future persistent memory |
| Predecessor inputs | AT-10/11; AISEC-2 future constraints; AISEC-4 DXI-14..16; AISEC-5 SVR-029/036 |
| Decision / required property | Section 16 escalation requires fresh authorization/evidence/containment; Type & Schema audit and AISEC-7 remain separately authorized gates |
| Trust boundary | Current bounded assurance → future tools, memory/retrieval/learning and reduced confirmation |
| Authority owner | PO and future phase owners; independent verification/strict audit retain separate scope |
| Positive permitted case | Later separately authorized bounded expansion has authentic namespace/capability/evidence appropriate to its added authority |
| Denied / fail-closed case | Narrow CI/review evidence cannot authorize full autonomy, memory promotion or cross-project retrieval |
| Identity/provenance | New capability delta, scope/host/policy version, namespace/write/retrieval/source and independent evidence |
| Data/confidentiality | Long-lived state needs retention/deletion/export and retrieval audience policy; no trust promotion by storage |
| Implementation dependency | FI-12; future phases only after their authorization; no MEM/RAG/LEARN code |
| Verification dependency | FV-12; future poisoned retrieval, interleaving, revocation and removed-gate equivalence corpus |
| Related AT/PI/TB/XI/SVR | AT-03/10/11/14; PI-06/14/15; TB-04/12/16; XI-01/02 carried; SVR-029/030/036 |
| Controlled Release relevance | Current release excludes unauthorized future expansions; distinct audit not satisfied |
| Higher-autonomy relevance | Central escalation contract, no activation or readiness claim |
| Alternatives considered | Reuse narrow approval for added tools; final prompt tenant filter; stronger namespace/capability/evidence before expansion |
| Trade-offs | Delays expansion pending actual proof; prevents persistent compromise becoming accepted context |
| Residual risk / limitations | Future subsystems and deployment facts UNKNOWN; selected assertions cannot certify whole-project boundaries |
| Owner decision dependency | ODR-01..09 revisited for each expansion; independent future start/release authority |

Carries design-time risks, no predecessor renumbering or phase start. It does not
absorb the future audit's repository-wide inventory.

## 18. Architecture invariants

Sixteen stable candidate invariants. These are ARCHITECTURE_DECISION_PROPOSED
properties, not assertions of current complete enforcement.

| ID | Invariant | Decision |
|---|---|---|
| SAI-01 | Asserted or structurally valid identity is not authenticated identity | SADR-01 |
| SAI-02 | Authenticated identity is not automatically authorized identity | SADR-01/02 |
| SAI-03 | Repository identity is not logical-project authorization | SADR-01/05 |
| SAI-04 | Trusted outer data does not automatically trust nested data | SADR-05/06 |
| SAI-05 | Approval binds exact subject/display and is invalidated by subject change | SADR-02/03 |
| SAI-06 | Review approval cannot manufacture owner, merge or runtime authority | SADR-02/10 |
| SAI-07 | Prompt framing and semantic model scores are not authorization boundaries | SADR-07 |
| SAI-08 | Uncertainty cannot create authority | SADR-01/11 |
| SAI-09 | Missing required provenance fails closed at consumption/effect | SADR-01/05/06 |
| SAI-10 | Tool and credential-use authority is explicit and least-privileged | SADR-07/08/09 |
| SAI-11 | Every data audience transition is separately authorized | SADR-04 |
| SAI-12 | Provider/publishing destination and account require explicit authorization | SADR-01/09 |
| SAI-13 | Open findings stay open until separately authorized implementation and independent verification/lifecycle disposition | SADR-11 |
| SAI-14 | Higher autonomy requires stronger evidence and containment | SADR-12 |
| SAI-15 | Type & Schema Boundary Audit remains a separate unsatisfied future gate | SADR-12 |
| SAI-16 | Unknown remote outcomes, partial rollback and replay cannot silently renew effect authority | SADR-02/08/09 |

## 19. AISEC-1 through AISEC-5 traceability

Each row explains treatment, not merely an ID list. Every AT/PI/TB rating and
disposition remains exactly in its owning predecessor artifact. Historical
internal shorthand or differing threat prose/register language is not reconciled
by re-rating here; the owning register and later normative dispositions retain
their scope. No predecessor is silently closed or re-rated.

### AISEC-1 threat claims

| Predecessor ID | Candidate treatment / unresolved claim |
|---|---|
| AT-01 | SADR-07 constrains hostile requirements at deterministic effect consumers; semantic resistance remains FV-12 |
| AT-02 | SADR-04/07 require selected repository data and sink policy; allowed path does not prove safe content |
| AT-03 | SADR-06/07 forbid re-entry trust promotion; generated semantic contamination remains |
| AT-04 | SADR-01/09 require explicit source/destination permission, not equal vendor names; ODR-04 pending |
| AT-05 | SADR-01/05/06 join authentic scope across copied input/root/state; no isolation implemented |
| AT-06 | SADR-07/09 treat hostile-valid responses as untrusted; adapter behavior and vendor rights remain separate |
| AT-07 | SADR-02/03 constrain authentic actor and exact display; existing guards and CRITICAL register rating preserved |
| AT-08 | SADR-09 preserves no blind retry and demands outcome policy; no durable idempotency credited |
| AT-09 | SADR-08/10 require dependency/runtime evidence; monitoring cannot prove absence of malicious dependency logic |
| AT-10 | SADR-06/12 forbid stored-content trust promotion; future memory not started |
| AT-11 | SADR-01/12 require authenticated namespace before retrieval relevance; future design-time risk carried |
| AT-12 | SADR-04 governs prompts separately from richer records/artifacts/comments; ODR-03 pending |
| AT-13 | SADR-04 distinguishes fixed summaries, raw causes/output and sink exposure; no general sanitization claim |
| AT-14 | SADR-10 independent oracle/review and exact evidence; this author cannot self-approve |
| AT-15 | SADR-07/10 deny policy/governance authority from prose; no new git/model capability |
| AT-16 | SADR-01/02/08/09 bind legitimate authority to authentic intended operation rather than hidden credential alone |

SEC-I1/2/5 constrain SADR-07; SEC-I3 maps SADR-04/09; SEC-I4 maps
SADR-01/09; SEC-I6/7 map SADR-06/12; SEC-I8 maps SADR-02/03;
SEC-I9 maps SADR-09; SEC-I10 maps SADR-10. All ten remain predecessor
invariants, not renumbered AISEC-6 runtime controls.

### AISEC-2 injection claims

| Predecessor ID | Candidate treatment / unresolved claim |
|---|---|
| PI-01 | SADR-07 grants no authority from direct requirement instruction; retain actual-effect tests |
| PI-02 | SADR-04/09 distinguish absent intentional credential channel from sensitive free text |
| PI-03 | SADR-04/07 keep repository content as data despite allowed paths |
| PI-04 | SADR-04/06/08 separate raw output, redacted prompt copy and fresh regeneration approval |
| PI-05 | SADR-07/09 reject invalid responses and constrain hostile-valid output without claiming semantic safety |
| PI-06 | SADR-06/07 require independent distrust at each generated-content consumer |
| PI-07 | SADR-02/07/08 retain exact review/path/host boundaries throughout multi-hop proposals |
| PI-08 | SADR-03 labels generated rationale and binds presentation; persuasion still requires human judgment |
| PI-09 | SADR-02/07/10 separate review data/prose from governance/owner/runtime authority; predecessor structural finding retained |
| PI-10 | SADR-07/08 retain protected-scope requirements and OS alias evidence, no expanded denylist implemented |
| PI-11 | SADR-08 separates launch syntax/classifier from loaded code authority and unsupported platform |
| PI-12 | SADR-09 explicit destination mapping; original AT-04 relationship unchanged |
| PI-13 | SADR-04/07 encoded/nested content retains no authority; finite redaction/corpus limits preserved |
| PI-14 | SADR-05 covers current XI copied paths; SADR-12 keeps future memory separate |
| PI-15 | SADR-06/12 prevent future persistence promotion; no learning phase started |

AISEC-2 OQ-1 maps SADR-03; OQ-2 maps SADR-07 plus ODR-08;
OQ-3 maps FV-08 classifier cases; OQ-4 maps auditable consumer projection
FI-04 without a cosmetic code change; OQ-5 remains FI-12 future research.

### AISEC-3 privilege claims

| Predecessor ID | Candidate treatment / unresolved claim |
|---|---|
| TB-01 | SADR-02 requires authentic actor/decision beyond unkeyed seal; CRITICAL unchanged |
| TB-02 | SADR-01/02 bind authorization to checkout, not same-byte root; replay gap open |
| TB-03 | SADR-02/06 explicit consumption/lifetime, restored-base replay; ODR-02 pending |
| TB-04 | SADR-01/05 logical scope independent of matching caller labels |
| TB-05 | SADR-09 retains explicit authorized mapping; host pinning not project permission |
| TB-06 | SADR-04/09 audience/content review separate from escaping and trusted publisher |
| TB-07 | SADR-04/10 comment content/reader policy; rendering/mentions not automatically safe |
| TB-08 | SADR-09/10 intended comment author/target/page handling; platform update rights UNKNOWN |
| TB-09 | SADR-01 authentic root selection at host; no runtime enforcement invented |
| TB-10 | SADR-08 requires supported-OS alias evidence; static patterns are not empirical alias proof |
| TB-11 | SADR-08 preserves finite topology/race limits and rollback authority; no race freedom claim |
| TB-12 | SADR-08 requires explicit host envelope; current approved code can retain host authority |
| TB-13 | SADR-07/08 exact argv/target refusal, not sandbox; classifier verification FV-08 |
| TB-14 | SADR-04/08 distinguish env-name filtering from file credentials/allowed values |
| TB-15 | SADR-09 authentic initial/final host/account use; effective scopes and redirects UNKNOWN |
| TB-16 | SADR-08/09/10 executable adapter authority and provenance, not interface-as-sandbox |
| TB-17 | SADR-08/10 actual CI host/credential/artifact proof beyond declarations |
| TB-18 | SADR-02/03/08 split persuasion/authenticity/execution compound, no double-counted closure |
| TB-19 | SADR-09 outcome/replay policy; no retry alone does not prevent manual duplicates |
| TB-20 | SADR-10 retains TB20-WF-INFERENCE and 2026-09-24 settings qualification; no fresh live confirmation claimed |

OQ3-1/7/8 map SADR-01/02; OQ3-2 maps FV-07/08; OQ3-3 maps FV-09/10;
OQ3-4/5/9 map ODR-07 and U02/U04/U05; OQ3-6 maps SADR-03.

### AISEC-4 and AISEC-5 consumption

| Input domain | Candidate treatment |
|---|---|
| DE-01..08 / XB-06/07/14/15 | SADR-01/04/09 source/provider/publisher mappings and transport; FI/FV-04/09 |
| DE-09..14 / XB-04/05/16 | SADR-04/05/10 log/artifact/comment/import audience and identity; ODR-03/05/07 |
| DE-15..17 / XB-08..13 | SADR-02/03/08 reviewed content, root/execution/output boundaries; no sandbox credit |
| DE-18..20 | SADR-08/10 dependencies/SUT/governance executable authority; deployed external facts remain unknown |
| XB-01..03 / XI-01/02 | SADR-01/05 actual invocation and nested consumption; unchanged immutable restrictions |
| DXI-01..04/09/11/14 | SADR-01/06/09 identity, source/destination authority and state partition |
| DXI-05..08/12 | SADR-04/05 explicit selection, redaction, persisted trust and separate audiences |
| DXI-10/13 | SADR-08 no isolation overclaim; regeneration chain/fresh review retained |
| DXI-15/16 | SADR-12 future namespace/retrieval/promotion only |
| VR4-01..05/08/11/15/16 | FV-01/02/03/05/06/07/08 actual consumer, copied/replay/root/chain cases |
| VR4-06/07/17/18/20 | FV-09/10 source/destination/redirect/unknown-outcome/comment cases; external rights separate |
| VR4-09/10/12 | FV-04/05 exact payload and sink canaries, not universal confidentiality |
| VR4-13/14/19 | FV-08/12 isolated host and future memory; no ordinary-host hostile execution |
| OQ4-01/02/03/04/05/09 | SADR-01/02/09 plus ODR-01/04/07, host proof outside model |
| OQ4-06/07/08/10/11/12 | ODR-03/05/06/07/09; SADR-11; U01..08; future verification ownership |
| AISEC-5 SVI-01..10 | SADR-10/11/12 retain atomic outcomes, exact evidence, independence, unknown limits, safe probes and audit separation |
| AISEC-5 SVR-001..036 | Complete individual handoff mapping in section 22, expanded FI/FV-01..12; none asserted PASS |

## 20. XI-01 and XI-02 preservation

| Finding | Current immutable state | Reachability / impact | Owner disposition |
|---|---|---|---|
| XI-01 | OPEN / MEDIUM / UNCHANGED | Source reachability YES; impact SUPPORTED_INFERENCE; remote exploit NOT_DEMONSTRATED | IMPLEMENTATION_REQUIRED_BEFORE_CONTROLLED_RELEASE_WHEN_AFFECTED_CAPABILITY_ENABLED |
| XI-02 | OPEN / MEDIUM / UNCHANGED | Source reachability YES; impact SUPPORTED_INFERENCE; remote exploit NOT_DEMONSTRATED | IMPLEMENTATION_REQUIRED_BEFORE_CONTROLLED_RELEASE_WHEN_AFFECTED_CAPABILITY_ENABLED |

APPROVED_EXISTING_DECISION source: ROADMAP AISEC-4/5 closure evidence (E01),
carried by AISEC-5 sections 13/14/21. Until future implementation plus independent
verification, the affected capability/path must remain **disabled OR constrained
by a separately demonstrated trusted/provenance-bound input contract**.

SADR-05/FI-05/FV-05 specify future properties/cases only. No remediation, closure,
re-rating, waiver, risk acceptance, disposition change or affected-capability
Controlled Release safety claim. All AT/PI/TB status/disposition changes: NONE.

## 21. Type & Schema Boundary Audit separation

**DISTINCT FUTURE GATE / NOT SATISFIED.** Future audit should validate identity
claims versus authority, hostile data/getter/snapshot consumption, complete
boundary/alternate-consumer coverage and evidence of runtime schema enforcement
within its own authorized whole-project scope. This targeted architecture
research does not execute, replace, absorb, inventory repository-wide, close or
certify that audit. An ADR's existence demonstrates no runtime schema control.
AISEC-7 tests will also be scoped evidence, not a substitute for that gate.

## 22. AISEC-7 handoff

No AISEC-7 files, harness or activation. Candidates are verification inputs for a
later authorized mission. READY_AS_VERIFICATION_INPUT means cases/oracles can be
specified from current contracts, not that the target architecture passes today.
IMPLEMENTATION_BLOCKED means the target enforcing seam is absent;
OWNER_DECISION_BLOCKED means policy must supply its oracle; ARCHITECTURE_BLOCKED
means a concrete protocol/host design must first be selected. For each row use
FV common identity/evidence in section 25, dummy tokens/canaries, intercepted
effects, temporary synthetic roots and no real endpoint. Actual hostile code
execution requires a separately authorized isolated host; ordinary operator host
is prohibited as a test strategy.

| Candidate / SADR / invariant | Attack or failure | Required positive control | Required negative case | Effect to intercept | Required evidence / identity | Safe synthetic strategy | Future dependency / classification |
|---|---|---|---|---|---|---|---|
| H-01; SADR-01; SAI-01/02/03 | Forged identity join | Authenticated authorized fixture join | Every edge wrong/missing; same bytes in foreign checkout | Read/provider/write/spawn | FV-01 authenticated producer/consumer scope, exact subject and zero effects | Fake issuer/capabilities, synthetic A/B roots | FI-01; IMPLEMENTATION_BLOCKED |
| H-02; SADR-02; SAI-05/06 | Forged/expired/replayed approval | Eligible authentic actor and exact one operation | Recomputed seal/name, expired/revoked/consumed/changed root | Apply/spawn/merge request | FV-02 actor/role/subject/use-state trace, no effect | Fake host interactions/clock/ledger, stubs | FI-02; OWNER_DECISION_BLOCKED (ODR-02 lifetime/roles), then implementation |
| H-03; SADR-03; SAI-05/06 | Split/substituted presentation | Same canonical view/record/apply | Alter before/purpose/bytes/display between review and use | Approval acceptance/write | FV-03 package/view digests and authentic display chain | Renderer stub, inert persuasive text | FI-03; IMPLEMENTATION_BLOCKED |
| H-04; SADR-04; SAI-11 | Cause/raw-output/sink disclosure | Approved summary and required benign content | Canaries in source/stack/queryType/cause/media/quoted response | Prompt/log/upload/comment/persist | FV-04 origin and final sink bytes, classify caller-only separately | Fake providers/transport/sinks, no raw secret | FI-04; OWNER_DECISION_BLOCKED (ODR-03/05); diagnostic propagation subcase ready |
| H-05; SADR-05; SAI-04/09 | XI-01 copied context | Authentic same-project fresh context | A context under B, stale/relabelled/same-label foreign root | Public main provider/trusted report/comment | FV-05 exact public entry and intercepted payload/count | Fixture roots, fake provider at actual consumer | FI-01/05; IMPLEMENTATION_BLOCKED; current-gap characterization ready |
| H-06; SADR-05; SAI-04 | XI-02 embedded-history fallback | Eligible four counters; benign no-history | Absent/unavailable/malformed/wrong-project/framework/invalid counters plus nested history canary | Actual prompt and report output independently | FV-05 producer/invocation, prompt/report mismatch trace | Synthetic context/history, fake provider | FI-05; IMPLEMENTATION_BLOCKED; helper-only test insufficient |
| H-07; SADR-06; SAI-04/09 | Shared/import-time state trust | Authorized sequential/concurrent A/B state | Shared provider/config/cache/imported stale evidence, restart/revocation | Provider/import/write | FV-06 origin/invocation/account, interleaving and freshness | Stub clients/store/clock, A/B namespaces | FI-06; ARCHITECTURE_BLOCKED for concrete import/replay protocol; ODR-05 first |
| H-08; SADR-07; SAI-07/10 | Hostile-valid model output | Valid benign proposal accepted within current scope | Injected approval prose, invented refs, protected/out-of-prefix plan | Request/write/tool/spawn | FV-07 exact assertions and effect counts; model corpus identity only if semantic evaluation authorized | Scripted fake provider and effect stubs | READY_AS_VERIFICATION_INPUT for current deterministic gates; FI-07 for expanded target |
| H-09; SADR-08; SAI-10/16 | Launch/host/descendant abuse | Safe classified target, exact argv/env; later isolated permitted resource | Unsafe recognized target, stale bytes, sibling read/network/descendant | Spawn and resource access | FV-08 platform/binary/root/after bytes, actual host policy | Stubs for launcher; hostile resource cases only isolated synthetic host | Launcher READY_AS_VERIFICATION_INPUT; host OWNER_DECISION_BLOCKED (ODR-06), FI-08 |
| H-10; SADR-09; SAI-12/16 | Wrong source/target/redirect/duplicate | Authorized cross-vendor mapping; known correlated create | Wrong valid target, fake redirect, timeout/5xx/invalid-2xx and reinvocation | Read/POST/publish retry | FV-09 host/account/mapping/operation, per-item outcome/request counts | Fake fetch with dummy headers, controlled outcome sequences | Current branches READY_AS_VERIFICATION_INPUT; target mapping/outcome OWNER_DECISION_BLOCKED (ODR-04/09), FI-09 |
| H-11; SADR-10; SAI-06/09 | Fake trust/CI/self-certification/comment identity | Required exact jobs/assertions and independent reviewer; intended comment | Caller trust enum, wrong event/HEAD/TREE/checkout/attempt, omitted job, author marker | Evidence acceptance/comment update/release request | FV-10 exact run/actor/oracle/report provenance, page/author calls | Fake platform/client and immutable fixtures | Current structure/comment characterization READY_AS_VERIFICATION_INPUT; authentic adapter FI-10 IMPLEMENTATION_BLOCKED |
| H-12; SADR-11/12; SAI-13/14/15 | Enablement bypass/autonomy inheritance | Verified excluded capability or permitted trusted contract | Alternate enabled XI/private entrypoint, unsupported host, new tools/memory claim | Release/authority request, future retrieval | FV-11/12 exact enabled surface and lifecycle/policy/evidence | Static manifest/entrypoint probes; future isolated stores only after authorization | OWNER_DECISION_BLOCKED for release/expansion; FI-11/12; no gate activation |

Every SVR keeps AISEC-5's property/positive/negative semantics. The following
individual mapping is an explicit disposition of all 36 requirements:

| SVR | Candidate / decision | Treatment and dependency |
|---|---|---|
| SVR-001 | H-08 / SADR-07 | Prose cannot grant tools; current effect gates ready, future grant FI-07 |
| SVR-002 | H-04/H-08 / SADR-04/07 | Exact consumer payload, nested extras; ODR-03 oracle, FV-04 |
| SVR-003 | H-08 / SADR-07 | Invalid and hostile-valid outputs distinct, effect counts; FV-07 |
| SVR-004 | H-07/H-08 / SADR-06/07 | Stage re-entry distrust, semantic corpus separate; FI-06/FV-12 |
| SVR-005 | H-03 / SADR-03 | Actual display correspondence needs renderer, FI-03 |
| SVR-006 | H-01/H-02 / SADR-01/02 | Actor/human proof absent, FI-01/02; no seal-as-authentication |
| SVR-007 | H-03/H-08 / SADR-02/03 | Current canonical content refusal cases ready; authenticity separate |
| SVR-008 | H-01/H-07 / SADR-01/06 | Foreign identical root must be denied by authentic join, FI-01 |
| SVR-009 | H-02/H-07 / SADR-02/06 | ODR-02 lifetime/consumption; FI-02/06 |
| SVR-010 | H-08/H-09 / SADR-07/08 | Per-platform alias/protected-path cases, FV-07/08; no race-freedom inference |
| SVR-011 | H-09 / SADR-08 | Topology/base/rollback races; safe synthetic fixtures, FI-08/FV-08 |
| SVR-012 | H-09 / SADR-08 | Exact target/argv, unsafe whole-launch refusal; current launcher cases ready |
| SVR-013 | H-09 / SADR-08 | Dummy env names/value classification; ambient files separate, ODR-06 |
| SVR-014 | H-09 / SADR-08 | Actual isolated host resource limits, ODR-06/FI-08 |
| SVR-015 | H-07/H-09 / SADR-06/08 | Exact regeneration chain/category/attempt/CREATE/freshness and new review |
| SVR-016 | H-10 / SADR-09 | Authorized source selectors/redirect refusal, ODR-01/04 |
| SVR-017 | H-10 / SADR-09 | Complete normalized/batch IDs and hostile data, current fake-return cases ready |
| SVR-018 | H-10 / SADR-09 | Explicit cross-vendor mapping, ODR-04/FI-09 |
| SVR-019 | H-10 / SADR-09 | Per-item known/unknown outcomes, invalid-2xx continuation; ODR-09 |
| SVR-020 | H-01/H-10 / SADR-01/09 | Provider/account/host envelope, ODR-03/07 and FI-09 |
| SVR-021 | H-04 / SADR-04 | Sink-specific canary policy, ODR-03; no universal DLP claim |
| SVR-022 | H-04 / SADR-04 | Response → error → cause → caller traces; downstream disclosure separate |
| SVR-023 | H-04 / SADR-04 | Pre-emission log contract, ODR-03/05; later deletion not retraction |
| SVR-024 | H-04/H-11 / SADR-04/10 | Artifact bytes/access/retention/producer origin, ODR-05/07 |
| SVR-025 | H-10/H-11 / SADR-09/10 | Report/PR/author/page/rendered content; platform rights U06 |
| SVR-026 | H-05 / SADR-05 | XI-01 public consumer join; FI-05; immutable restriction |
| SVR-027 | H-06 / SADR-05 | XI-02 full null/ineligible matrix; FI-05; immutable restriction |
| SVR-028 | H-07 / SADR-06 | Import/state interleaving/freshness; ODR-05/FI-06 |
| SVR-029 | H-12 / SADR-12 | Future namespace before relevance/promotion; FI-12, no MEM activation |
| SVR-030 | H-11/H-12 / SADR-10/12 | Candidate-independent oracle/dataset, FV-10/12 |
| SVR-031 | H-12 / SADR-11 | Actual exports/distribution and guard triggers, FV-11 |
| SVR-032 | H-09/H-11 / SADR-08/10 | Workflow definition/actual host/token evidence; ODR-07/U04/U05 |
| SVR-033 | H-11 / SADR-10 | Exact event/subject/attempt/checkout/jobs/assertions, FV-10 |
| SVR-034 | H-11 / SADR-10 | Fresh eligible independent review; author cannot self-certify |
| SVR-035 | H-12 / SADR-11 | Applicable finding/restriction proof before enablement, FV-11 |
| SVR-036 | H-12 / SADR-12 | Expanded authority requires new evidence/authorization, FV-12 |

## 23. Owner decision packages

Nine dedicated packages; all **OWNER_DISPOSITION_REQUIRED**. Every option is
unapproved. Safe defaults are technical recommendations for unresolved scope,
not newly adopted policy or a waiver. The minimum immutable security constraints
in sections 20/21 and existing governance remain binding for every option.

### ODR-01 — Principal, project and registry ownership

Question: who establishes logical project membership, principal delegation and
the repository/checkout/source/provider join? Technical source inspection sees
independent labels/root validators (E02/E11), not business ownership or eligible
roles. Security constraint: ASSERTED/STRUCTURALLY_VALID must never be promoted to
AUTHENTICATED/AUTHORIZED by naming, equality or hashing.

Option A: owner-governed host registry maps authenticated principals/projects to
repositories/checkout/source/accounts. Option B: separately governed per-invocation
host attestations from authorized operators, with independently verified identity
and resource mapping. A adds registry maintenance and better shared-worker control;
B adds operator review burden and limits automation. Security impact: both need
authentic source and consumer verification; neither permits raw label trust.
Product/release impact: applicable effect paths wait for mapping proof.
Operational impact: establish registry/attestation ownership and refresh/revocation.
Autonomy impact: shared/multi-project operation requires auditable concurrent scope.
Recommended safe default: no undecided identity edge grants a capability.
Before disposition, unproven project/root/source/account joins cannot authorize
Controlled Release enablement or broader autonomy (SADR-01, FI/FV-01).

### ODR-02 — Reviewer eligibility and approval lifetime

Question: who may approve each decision type, with what validity period,
renewal/repetition and revocation policy? Current records accept caller strings
and digests (E03); source cannot decide organizational role, separation or acceptable
age. Constraints: exact subject and authentic interaction, existing independence,
distinct technical/owner/merge/runtime authority, no replay-created permission.

Option A: short bounded one-operation approvals with renewal after subject or
authority change. Option B: explicitly enumerated multi-operation grants with
fixed validity/use budget and live revocation/consumption checks. A reduces replay
scope but increases confirmations; B supports repeated execution with more ledger
complexity and exposure. Security impact: expired/revoked/consumed or altered
subject denies effects under both. Product/release impact: applicable review/
execution entrypoints need eligible actors and proven contract. Operational impact:
role administration, clocks/revocation and unknown-outcome recovery. Autonomy
impact: B enables bounded repetition only, not unlimited execution.
Recommended safe default: no execution-bearing grant without explicit lifetime
and one-operation use until broader semantics are owner-disposed. Before disposition,
no caller review record is credited as authentic approval (SADR-02/03, FI/FV-02/03).

### ODR-03 — Permitted content and audiences

Question: which requirements/source/stack/path/image/knowledge/generated content
may enter which provider account, caller, reviewer, log, artifact, comment or
publishing audience? E02/E04/E08/E10 establish selections and some raw channels,
not consumer confidentiality policy. Technical tests cannot decide business data
ownership, permissible disclosure or acceptable personal-data exposure.

Option A: per-class/per-sink explicit allow policy with confidential content
withheld pending classification. Option B: owner-selected narrowly scoped
non-sensitive projects/accounts/audiences with declared exclusions and intake
contract. A is granular but costly; B is simpler for a pilot but cannot cover
private/sensitive consumers by implication. Security constraint: approval,
truncation/escaping and public source checkout do not declassify data. Security
impact: both need final-byte/sink evidence and real recipient scope. Product/release
impact: enabled outward sinks need policy and proof. Operational impact: data
classification, per-provider/vendor evidence and sink owners. Autonomy impact:
automatic posting/transfer adds explicit edges. Recommended safe default: withhold
undecided outward data, use bounded fixed summaries. Before disposition, no
unclassified sensitive transfer/publication is represented as authorized
(SADR-04/09, FI/FV-04/09).

### ODR-04 — Intentional source and cross-project transfer

Question: which source-to-project and project-to-provider/destination mappings
are legitimate, including Jira-to-Azure and multiple requirements sources?
E04/E05 allow caller-selected source/destination and opaque IDs; matching vendor
or project names cannot decide business intent. Constraints: authentic origin,
explicit target/audience, least credential use and audit trail; no default foreign
reads/writes or root substitution.

Option A: registered source/target mappings approved before invocation. Option B:
authenticated owner/operator approves each exact transfer's subject/content/
target under delegated policy. A reduces repeated friction but requires drift
control; B improves per-transfer specificity with operational burden. Security
impact: wrong valid target denied even when token is accepted. Product/release
impact: cross-vendor behavior remains possible; enabled publishing waits for
approved mapping proof. Operational impact: mapping lifecycle, revocation and
account/source membership evidence. Autonomy impact: automated publication needs
pre-established scoped mappings or equivalent owner grants. Recommended safe
default: no cross-project transfer without explicit mapping. Before disposition,
token validity/name equality cannot authorize transfer (SADR-01/06/09, FI/FV-09).

### ODR-05 — Diagnostics, retention and import/reuse policy

Question: which raw errors/causes/output/media/context/review records may be
caller-visible, logged or persisted; for how long; and under what freshness,
deletion/export and historical-import rules? E04 preserves cause; E08 returns raw
output with redacted C7 copy; E10 declares seven-day forensics artifact retention,
not a universal retention policy. Technical traces cannot decide acceptable
audiences, forensic value or lifetime.

Option A: fixed bounded diagnostics with minimal ephemeral records and explicit
approved imports. Option B: restricted detailed forensic store with scoped
readers, owner-defined retention, access audit and revalidation at reuse.
A limits exposure but loses forensic depth; B retains useful debugging evidence
with greater storage/privacy burden. Security constraint: storage/history does
not authenticate content; sanitize before emission, not after deletion. Security
impact: each sink's policy and bytes differ; cause to caller is not remote
disclosure proof. Product/release impact: enabled diagnostic/artifact/import paths
need disposition and enforcement evidence. Operational impact: store access,
cleanup, revocation, lineage and retention monitoring. Autonomy impact: persistent
memory/cache reuse requires namespace/freshness/deletion design. Recommended safe
default: no new raw persistence/publication or authoritative reuse of unknown
origin/age; fixed summaries only. Before disposition, no implied retention or
reuse permission (SADR-04/06/10, FI/FV-04/06/10).

### ODR-06 — Host isolation and supported execution platforms

Question: what filesystem/network/credential/descendant authority is acceptable
for controlled demonstrations, supported generated-code execution and future
autonomy, and which platforms are supported? E08/E01 establish host-process
authority, no sandbox, direct-child timeout and Windows limitation; no current
deployment envelope is established. Technical tests cannot accept business blast
radius or choose compatible operational cost.

Option A: disposable isolated host with bounded mounts/egress, no ambient real
credentials and demonstrated process-tree/resource controls. Option B: explicitly
limited owner-governed trusted-code demonstration on a dedicated constrained
host, with actual permitted resources documented and independently verified;
this does not become sandbox certification. A improves hostile-code containment
with compatibility/cost burden; B limits product scope and retains more trust
in approved code. Constraints: no ordinary ambient-host hostile probe, no Windows
shell workaround by this artifact, no confinement inferred from cwd/shell:false.
Security impact: neither option safe without real envelope proof. Product/release
impact: generated-code enablement waits for host disposition/evidence; disabled
scope remains possible. Operational impact: image/tool/permissions/network and
descendant lifecycle ownership. Autonomy impact: reduced confirmation/shared
execution requires stronger containment. Recommended safe default: disable
generated-code execution where required environment evidence is unavailable.
Before disposition, no chosen sandbox or accepted host-ambient risk (SADR-08,
FI/FV-08).

### ODR-07 — Deployed principals, credentials and CI configuration

Question: who operates each host/platform/provider adapter; what effective
credential rights/checkout persistence/settings are intended and under change
control? E06/E10 show credential/config declarations; E11 shape labels are not
authentication. AISEC-3 live settings are dated 2026-09-24 predecessor evidence.
Technical repository inspection cannot decide intended deployed rights or prove
current external scopes/settings.

Option A: dedicated narrowly scoped per-capability service identities and explicit
change-controlled CI/credential registry. Option B: owner-governed operator
identities for a constrained pilot with separately evidenced actual rights,
restricted projects and documented credential custody. A aids automation and
revocation but adds provisioning; B reduces setup but increases human dependency
and authority variability. Constraints: secrets absent from prompts does not
limit credential use; editable workflow requests are not external permission
ceilings; live setting drift invalidates affected proof. Security impact: verify
actual scopes without recording values. Product/release impact: enabled CI/tool/
provider use needs exact deployment evidence. Operational impact: custody,
rotation, permission reviews, checkout credential intent and fresh settings
collection. Autonomy impact: shared/long-lived operation needs isolated scopes
and revocation. Recommended safe default: no unverified authority expansion or
external scope claim. Before disposition, no live authenticated adapter/least-use
ceiling is invented (SADR-01/08/09/10, FI/FV-01/08/09/10).

### ODR-08 — Semantic quality, review rubric and acceptance posture

Question: which semantic/model/human review thresholds are acceptable for
generated designs/code and reduced human confirmation? E07/E08 implement narrow
policy/scope checks; AISEC-2 reports unfiltered in-scope narratives/code.
Technical source tests cannot decide intended product quality or accept malicious
in-scope residual risk. Constraint: model score/prompt framing must never grant
authority; independent human/owner judgment remains distinct.

Option A: consequential code/transfer proposals require independent human
semantic review and bounded corpus evaluation. Option B: later narrowly scoped
automatic semantic acceptance under owner-defined rubric and separately proved
deterministic capability/confinement limits. A adds latency and reviewer load;
B enables automation with greater residual semantic risk and stronger evidence
requirements. Security impact: neither establishes universal injection immunity.
Product/release impact: applicable quality/review criteria must be explicit;
architecture correctness alone is not release permission. Operational impact:
independent corpus/oracle maintenance, model/version drift and reviewer training.
Autonomy impact: removing a gate is a new scoped authorization/evidence task.
Recommended safe default: retain consequential human review; no semantic score
increases authority. Before disposition, no threshold or accepted permanent
scope-only safety posture is claimed (SADR-03/07/10/12, FV-12).

### ODR-09 — Remote-create ambiguity and duplicate-effect policy

Question: how should known/unknown publication outcomes, invalid successful
responses, manual/concurrent replay and partial batches be reconciled? E05 never
retries writes; transport/global-stop failures halt later items, invalid-2xx
responses are item-local and can continue; no durable idempotency ledger is
credited. Tests can observe calls, not decide acceptable duplicate business
objects or recovery ownership.

Option A: suspend further affected publication on any unknown create outcome
pending trusted reconciliation. Option B: explicitly allow independent later
items under per-item operation identity/outcome ledger while quarantining the
uncertain item's retry authority. A favors cautious recovery at throughput cost;
B allows progress but needs stronger accounting and independent-item semantics.
Security constraint: no blind retry or deletion/compensation authority from an
unknown response; preserve what may already have happened. Security impact:
known/unknown outcomes stay distinguishable. Product/release impact: enabled
automatic publication needs policy and reconciliation proof. Operational impact:
operator/vendor reconciliation, crash recovery and manual retry control.
Autonomy impact: long-lived/automatic publishing needs durable consumption and
concurrency control. Recommended safe default: suspend undecided duplicate/retry
authority until reconciliation. Before disposition, no idempotency/batch-stop
guarantee or approved continuation policy is claimed (SADR-09, FI/FV-09).

## 24. Future implementation dependencies

Twelve work groups, all FUTURE_IMPLEMENTATION_DEPENDENCY; they are design
handoffs, not implementation authorizations, work started or remediation. Concrete
protocol/API choices need their own authorized design and owner prerequisites.

| ID | Work group / acceptance property | Owner / prerequisites |
|---|---|---|
| FI-01 | Authentic human/platform/invocation identity adapter and logical-project/repository/checkout/source/account join; explicit current consumer grants | Trusted host; ODR-01/04/07, SADR-01 |
| FI-02 | Authentic eligible decision interaction, exact approval envelope, lease/revocation/atomic operation consumption and execution reauthorization | Review/runtime host; ODR-02/05/07, FI-01 |
| FI-03 | Canonical reviewer renderer, provenance labels, display/record/apply binding and package transport integrity | Review host; existing SECURITY guard, FI-02, ODR-03/08 |
| FI-04 | Auditable task/sink projection and owner-approved audience/diagnostic/persistence/retention controls; protect final bytes at each consumer | Data/prompt/log/artifact/comment owners; ODR-03/05 |
| FI-05 | Separately authorized XI-01 consumption identity and XI-02 nested-history eligibility work, preserving unavailable semantics and actual public consumer coverage | Triage/history owner; FI-01, immutable XI disposition |
| FI-06 | Invocation/project namespace partition, client/cache/config isolation and authenticated import/historical reuse/expiry/revocation/restart contract | Invocation/store host; ODR-01/04/05, FI-01/02 |
| FI-07 | Deterministic capability enforcement at each effect, supported-OS path/snapshot/rollback rules, no authority from semantic grades | Tool/apply owner; FI-01/02, ODR-06/08 |
| FI-08 | Owner-selected deployed execution envelope, platform support, resource/network/credential/descendant controls and current-grant checks | Host/runtime/security; ODR-06/07, FI-01/02 |
| FI-09 | Authorized source/provider/destination mapping and transport/account envelope; unknown-create reconciliation/replay policy/ledger; intended comment target contract where applicable | Integration/custodian/publisher; ODR-01/03/04/07/09 |
| FI-10 | Authenticated platform/evidence collector, exact run/checkout/attempt/assertion/reviewer chain and integrity-bound persisted report transport | PM/platform/review host; ODR-05/07, existing governance |
| FI-11 | Capability-specific release/disabled-path/distribution inventory and dossier assembly under existing lifecycle | Release/package owners; all applicable ODR/FI; no release grant |
| FI-12 | Later separately authorized memory/retrieval/learning/autonomy designs with namespace-before-relevance, provenance/promotion/deletion and new authority evidence | Future phase owners; all applicable ODR; Type & Schema audit separate |

Dependencies form an order: owner policy and trusted identity precede authentic
approval/import/effect grants; display and sink controls precede their supported
enablement; host envelope precedes generated-code launch; release dossier follows
implemented or precisely restricted capabilities plus verification. Implementers
must retain AT/PI/TB/XI owners and dispositions and obtain separate authorization.

## 25. Future verification dependencies

Twelve work groups, all FUTURE_VERIFICATION_DEPENDENCY. Common evidence for every
row: exact repository/branch/base/HEAD/TREE/ordered parents; artifact/fixture/canary
and assertion identities/digests; actual runtime/platform and executed content;
authentic origin/consumer project/root/provider/destination where relevant;
positive and negative outcomes separately; intercepted effect attempts and final
bytes; all required jobs/attempts/limitations; independent review and owner policy
IDs. Preserve AISEC-5 four outcomes; unknown target behavior is not PASS.

| ID | Required independent evidence / cases | Linked decisions and SVR obligations |
|---|---|---|
| FV-01 | Authentic permitted join versus asserted/shape-valid/forged/foreign edge; same-byte foreign checkout, missing actor and wrong provider/account; verify zero unauthorized effects at actual consumers | SADR-01; SVR-006/008/016/018/020/026/028 |
| FV-02 | Authentic eligible actor, exact subject and operation versus forged seal/name, wrong decision type, expired/revoked/consumed/replayed/restored-base approval, changed root/HEAD/TREE and crash/unknown outcome; execute authority checked independently | SADR-02; SVR-006/007/008/009/034 |
| FV-03 | Canonical display/package/record/apply equality with positive view; altered bytes/purpose/before state, time-split/substituted representation and persuasive system-like text refused; authenticate display chain | SADR-03; SVR-005/006/007 |
| FV-04 | Exact C1–C7 authorized payloads and each error/cause/caller/log/raw record/prompt copy/upload/comment/persistence transition; dummy canaries in source/stack/queryType/nested/encoded/media/quoted output; final sink policy/access/retention independently established | SADR-04; SVR-002/020/021/022/023/024/025 |
| FV-05 | XI actual public analyzer path: fresh same-scope context and eligible counters/no-history positive; copied/relabelled/stale/foreign root negative; all absent/unavailable/malformed/project/framework/counter separate-history cases with embedded canary; compare request and report separately | SADR-05; SVR-026/027/028/035 |
| FV-06 | Sequential/concurrent/interleaved A/B clients/config/cache/records; stale/copied imports, same labels/bytes, changed policy/revocation, restart and age limits; no namespace trust from storage or outer object | SADR-06; SVR-008/009/015/028/029 |
| FV-07 | Benign valid and invalid/hostile-valid model outputs; fabricated refs, protected/out-of-prefix paths, scope/operation/semantic-grade steering; per-platform aliases/hostile getters/snapshot/rollback boundaries without repository-wide audit claim | SADR-07; SVR-001/002/003/004/010/011/012/017 |
| FV-08 | Safe exact targeted argv/env/cwd/after-byte chain and regeneration positive; unsafe recognized target zero spawn, stale chain/category/attempt/CREATE rejection; isolated actual host file/network/credential/descendant/resource negative controls and supported-OS alias/race limitations | SADR-08; SVR-010/011/012/013/014/015/032 |
| FV-09 | Approved source/cross-vendor mapping versus wrong valid site/org/project/account; fake redirects and exact body/header envelope; complete batch/IDs; transport/5xx/invalid-2xx/partial batch/manual/concurrent replay call counts and durable known/unknown outcomes; intended comment target separate | SADR-09; SVR-016/017/018/019/020/025 |
| FV-10 | Authenticate collector, exact workflow-definition/event/head/base/tree/checkout/run/attempt and required assertions/jobs; stale green/partial/skipped/copied trust refused; independent oracle/reviewer participation; fake marker/author/pagination/report scope; historical settings never fresh proof | SADR-10; SVR-024/025/030/032/033/034 |
| FV-11 | Actual distributed files/exports and every supported enabled/disabled API/CLI/UI/workflow/import/replay path; immutable XI restriction or separately demonstrated authentic trusted input contract, open guards/dispositions and independent release dossier | SADR-11; SVR-031/034/035 |
| FV-12 | Future authority delta, removed-confirmation equivalence, hostile generated/persisted/retrieved content, namespace-before-relevance, promotion denial, long-lived state drift/deletion/revocation and independent model corpus/rubric/version limitations | SADR-07/12; SVR-003/004/029/030/036 |

No new tests are implemented or executed. Existing inspected assertions are
reuse candidates only: #23E documented integrity-only constructability; apply
N21 canonical-package negative/positive cases; execution targeted argv/env and
whole-run unsafe target refusal; loader cause preservation; governance Markdown
structure/local reference cases (E03/E04/E08/E11). These tests cannot certify
their neighboring missing authenticity, policy or host-isolation properties.

## 26. Residual risks, gaps and unknowns

Eight grouped UNKNOWN records. Group counts describe unresolved domains, not a
count of findings or approved risk acceptances.

| ID | UNKNOWN domain | Required next evidence/decision |
|---|---|---|
| U01 | External production orchestrator, real host principal/resource/network/descendant envelope | ODR-06/07, FI/FV-01/08; source absence does not prove no external private caller |
| U02 | Actual AI/Jira/Azure credential rights, account/project membership and source-query semantics | Authorized custodian/vendor verification, ODR-01/04/07; no real values here |
| U03 | Provider retention/residency/training and effective remote artifact/log/comment audiences | ODR-03/05 plus authorized external evidence; initial endpoint not sufficient |
| U04 | Current GitHub settings/effective permission ceilings and checkout credential details | Fresh authorized admin/platform collection; AISEC-3 2026-09-24 observations remain historical |
| U05 | Current effective workflow-definition provenance/deployed adapter authenticity | Preserve TB20-WF-INFERENCE qualification; independent collection/deployment proof FV-10 |
| U06 | Effective AI/history redirect/header behavior and live comment update/render rights | Fake runtime tests establish narrow behavior only; external claims need separate authorized verification |
| U07 | Full supported-OS path alias/race/rollback and descendant behavior | Isolated platform evidence, finite-test limits, ODR-06 and separate full audit |
| U08 | Semantic injection resistance, reviewer comprehension and future shared-state/retrieval protocol behavior | ODR-08, independent corpus/review and future phase design; no universal guarantee |

Source and predecessor limitations remain: malicious in-scope code/narrative,
compromised dependencies/issuer/host, caller misuse, unknown deployment drift and
vendor rights, temporal filesystem races, uncertain external effects and incomplete
rollback. Architectural intent cannot compensate for these with a declaration of
safety. Current findings stay open under their original owners/dispositions.
AISEC-4's management handoffs N17/RP33 (public RTI element-level consumption),
N18/RP35 (comment targeting) and N03 (Windows/NTFS alias behavior) retain their
existing owners and pending qualified scope. They are predecessor/management
inputs, not freshly fetched management status or findings closed by this ADR.

## 27. Mandatory conclusions and delivery boundary

This candidate contains twelve proposed SADR decisions, sixteen SAI invariants,
nine owner packages, twelve future implementation groups, twelve future
verification groups and eight grouped unknown domains. It defines explicit
identity/provenance, approval/authority/display, audience, cross-project, tool/
host, deterministic, fail-closed, release and autonomy architecture properties,
with complete predecessor/SVR traceability and an AISEC-7 handoff.

It does not establish live authentication, sandboxing, credential isolation,
cross-project isolation, runtime/provider authorization, publication safety,
security certification, Controlled Release readiness, full autonomy readiness,
XI/AT/PI/TB remediation, Type & Schema Audit completion or AISEC-7 evidence.
XI-01/XI-02 remain OPEN / MEDIUM with immutable disposition. XI remediation,
closure, re-rating, waiver, risk acceptance and AT/PI/TB disposition changes: NONE.
Controlled Release approved: NO. Type & Schema Boundary Audit: DISTINCT FUTURE
GATE / NOT SATISFIED. AISEC-7/MEM/RAG/LEARN/full autonomy activation: NO.

Document validation checks headings/tables/anchors/fences/relative references,
ID/count coverage, exact one-new-file scope and `git diff --check`. It is not
independent technical/security approval. Delivery requires exactly one normal
commit with the authorized sole parent, fresh unchanged main/branch refs before
normal fast-forward push, remote/local HEAD correspondence, exact base-to-head
one-file delta and clean working tree; actual results/identities are in the final
report, not pre-certified inside this artifact.

Successful delivery returns control to PM for exact identity/scope verification
→ governed PR → fresh automatic exact-head CI → independent Senior HEAVY review
→ independent Security HEAVY review → Product Owner architecture/finding
disposition. No PR/issue change, merge, canonical closure or downstream start
is performed in this mission.

## 28. Repository evidence references

Function/configuration anchors identify narrow inspected evidence at section 3's
baseline. Linked tests were inspected for named assertions, not run as product
verification. Historical predecessor claims retain PREDECESSOR_FINDING strength.
No external platform or provider source is represented as freshly verified here.

| Key | Inspected files / anchors | Claims supported and limit |
|---|---|---|
| E01 | [ROADMAP](../ROADMAP.md), AISEC-4/5 closure/XI/next phase/Type & Schema entries; [SECURITY](../SECURITY.md), sections 23–28 and review-presentation restriction; [PROVIDERS](../PROVIDERS.md), explicit source/credential/error contract; [PUBLISHING](../PUBLISHING.md), destination/create/retry/cross-vendor contract | Existing lifecycle/owner restrictions and documented limits; normative contract not automatically runtime enforcement |
| E02 | [repository-root.js](../scripts/ai/repository-root.js), `validateRepositoryRoot`/`assertValidRepositoryRoot`; [analyze-failure.js](../scripts/ai/analyze-failure.js), `main`/`readContext`/`readHistory`/`buildFailureReport`/`runProviderAnalysis`/`summarizeProviderError`; [qa-agent-prompt.js](../scripts/ai/qa-agent-prompt.js), `pickPromptMetadata`/`projectPromptFailure`/`buildUserPrompt` | Independent profile/root checks, XI actual branches, history counter selection, selected versus forwarded prompt fields and safe provider summaries; no origin authentication |
| E03 | [review-record.js](../scripts/ai/test-automation/generated-change-set-review-record.js), integrity warning/builder/validator; [canonical helper](../scripts/ai/test-automation/generated-change-set-review-canonical.js), unkeyed digest; [review package](../scripts/ai/test-automation/generated-change-set-review-package.js), fields/digests; [apply](../scripts/ai/test-automation/change-set-application.js), approval/canonical rebuild/root/base/topology/rollback; [review tests](../scripts/ai/test-automation/generated-change-set-review-record.test.js), DOCUMENTED LIMITATION; [apply tests](../scripts/ai/test-automation/change-set-application.test.js), N21-T7 honest package and altered package assertions | Narrow canonical content/integrity behavior; not human authenticity, renderer, root authorization or replay ledger |
| E04 | [generic loader](../scripts/ai/requirements-source-provider.js), `loadRequirementsFromProvider` cause/whole-collection validation; [loader tests](../scripts/ai/requirements-source-provider.test.js), original cause/outer-message assertions; [Azure source](../scripts/ai/providers/azure-devops-requirements-provider.js), config/fetch/manual redirect/`validateWiqlResponseShape`; [Jira source](../scripts/ai/providers/jira-requirements-provider.js), config/manual redirect/private snapshot | Source-specific credential/selector/return contracts and content-derived diagnostic path; not actual vendor project rights or downstream disclosure |
| E05 | [generic publishing](../scripts/ai/test-design-publishing.js), destination/design/result contract; [Azure destination](../scripts/ai/destinations/azure-devops-test-case-destination.js), `attemptCreate`/`publish`/`globalStop`/private config | Fixed target, sequential CREATE_ONLY no retry; global-stop versus item-local invalid-2xx continuation; no authenticated source mapping |
| E06 | [Groq](../scripts/ai/providers/groq-provider.js), constructor/endpoint/request; [Gemini](../scripts/ai/providers/gemini-provider.js), constructor/endpoint/request; [history collector](../scripts/ai/collect-history.js), `fetchJson`/`GITHUB_API_URL` selection | Initial hosts/header construction versus env-selected API; no explicit AI/history redirect deny proof or vendor account authentication |
| E07 | [config](../scripts/ai/config.js), import-time provider/model/key; [agent-policy](../scripts/ai/agent-policy.js), `applyAgentPolicy`; [test-design prompt](../scripts/ai/generative-test-design/test-design-prompt.js), [test-case prompt](../scripts/ai/generative-test-design/test-case-model-prompt.js), [candidate prompt](../scripts/ai/generative-test-design/automation-candidate-prompt.js), [plan prompt](../scripts/ai/test-automation/automation-plan-prompt.js), [change prompt](../scripts/ai/test-automation/generate-change-set-prompt.js), DATA/projection anchors | Deterministic classification ceiling and prompt framing; private call inventory/mechanism detail inherited from AISEC-2/4, no universal semantic claim |
| E08 | [generated change set](../scripts/ai/test-automation/generated-change-set.js), protected/path/plan binding; [controlled execution](../scripts/ai/test-automation/controlled-execution.js), classifier/argv/env/spawn/timeout/current-byte checks; [execution tests](../scripts/ai/test-automation/controlled-execution.test.js), exact targeted argv/env and unsafe whole-run refusal; [regeneration](../scripts/ai/test-automation/regenerate-change-set.js), chain/attempt/CREATE/freshness/`redactSecrets`/prompt copy | Narrow write/launch and regeneration contracts; no OS sandbox, complete descendant containment or supported Windows execution |
| E09 | [knowledge selector](../scripts/ai/knowledge/selector.js), project/framework eligibility before relevance; [architecture model boundary](architecture-model-boundary-v2.md), separate RTI/#22 seam via [evidence ingestion](../scripts/ai/generative-test-design/evidence-ingestion.js) | Curated scope and explicit lossy evidence seam; not authenticated namespaces or implemented future retrieval |
| E10 | [Cypress workflow](../.github/workflows/cypress.yml), triggers/jobs/permissions/secret mapping/artifact/comment/forensics retention; [Dependency Review](../.github/workflows/dependency-review.yml), declared permissions/trigger; [Supply-Chain Audit](../.github/workflows/supply-chain-audit.yml), triggers/permissions; [comment client](../scripts/ai/pr-comment-client.js), `findMarkedComment`/`upsertPrComment`; [comment formatter](../scripts/ai/format-pr-comment.js), truncation | Tracked configuration and marker first-page/no-author gate; not live settings/permissions, recipient policy or platform rights |
| E11 | [governance process v3](governance-process-v3.md), authority/independent review/merge rules; [trusted context](../scripts/governance/stages/1a/trusted-context.js), `validateTrustedContext`; [head reader](../scripts/governance/stages/head-reader.js), Git-object reads; [revalidation](../scripts/governance/kernel/revalidation.js), subject freshness; [process primitive](../scripts/governance/safety/process.js), separate POSIX group/Windows limits; [Markdown checker](../scripts/governance/stages/1b/check.js) and [tests](../scripts/governance/stages/1b/check.test.js), structural/local-link/anchor assertions | Existing process authority and narrow evidence machinery; caller trust enum/shape never a live authentication mechanism, governance process handling not #23G sandbox |
| E12 | [package.json](../package.json), exports/files/npm scripts; [public entry](../scripts/ai/index.js); [package surface contract](package-surface-v2.md) | Actual declaration excludes private generation/design/automation; no new pack/install proof; tracked call-site searches identified definitions/test usages rather than production #23F/#23G orchestrator |

Primary predecessor references: [AISEC-1](agentic-threat-model-v1.md),
[AISEC-2](prompt-indirect-injection-study-v1.md),
[AISEC-3](tool-privilege-credential-boundary-analysis-v1.md),
[AISEC-4](data-exfiltration-cross-project-isolation-v1.md),
[AISEC-5](agentic-security-verification-strategy-v1.md).
No identifiers are renumbered. These links point to research claims with their
original evidence limits; source anchors above qualify current-state assertions.
