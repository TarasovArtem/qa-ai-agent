# AISEC-4 — Data exfiltration and cross-project isolation v1

Status: CURRENT (research / architecture input; no remediation implemented)

Authorization: `OD-AISEC-4-RESEARCH — APPROVED`; management issue #211.
Review class: HEAVY. This document is research, not release approval, risk
acceptance, an implementation contract, or closure of an existing finding.

## 1. Purpose / status

Determine where repository, project, execution, credential, and provider data
cross security domains at the exact baseline. The source contains useful
deterministic containment and projection controls, but no single authenticated
project identity spanning triage, RTI acquisition, publication, and private
automation. Host pinning, matching strings, and content digests solve different
problems; none alone establishes that a caller selected the intended project.

Two additional triage gaps are recorded as XI-01 and XI-02. Their control-flow
reachability is established statically; actual unauthorized disclosure is not
observed. Other confidentiality consequences refine existing AT/PI/TB records
without creating duplicate findings. No predecessor rating changes or closures
are made. No security remediation, hostile tests, MEM/RAG/LEARN, runtime changes,
or public/package changes are implemented by this artifact.

## 2. Scope

Covered: supported installed triage/RTI APIs and concrete provider/destination
subpaths; repository-only CI comments and diagnostics; private #22/#23 prompt,
review, apply, execute, and regeneration seams; filesystem reports, environment,
knowledge, evaluation, governance evidence, and workflow data transport.

Private callable library code is distinguished from tracked production callers.
The repository has no tracked production #23F/#23G/#23H orchestrator. A private
function being executable by a trusted repository caller does not make it a
supported installed package capability or a demonstrated remote attack path.
Only static repository research and narrowly authorized GitHub management/ref
reads were used. No real credential values, provider requests, issue-tracker
requests, generated hostile execution, or external disclosure probes were used.

## 3. Relationship to AISEC-1 / AISEC-2 / AISEC-3

| Owner | Primary artifact | AISEC-4 consumes / refines | Authority retained |
|---|---|---|---|
| AISEC-1 | [Agentic threat model](agentic-threat-model-v1.md) | T6 egress, T7 cross-project contamination, default isolation and AT-01 through AT-16 | Threat ratings and dispositions |
| AISEC-2 | [Prompt and indirect injection study](prompt-indirect-injection-study-v1.md) | C1 through C7 model calls and PI-01 through PI-15; what injection-controlled text can disclose or contaminate | Injection mechanisms, ratings, hostile-injection analysis |
| AISEC-3 | [Tool / privilege / credential analysis](tool-privilege-credential-boundary-analysis-v1.md) | Credential inventory, TB-01 through TB-20, root/approval/launch authority, publishing and CI credentials | Existing privilege findings and ratings |

All three predecessors were read as primary research. Current executable source
and newer normative guards qualify their historical observations. In particular,
the N21 correction recomputes the review package from authoritative apply inputs;
it does not authenticate a reviewer or bind approval to a checkout. SECURITY
section 28 retains `FUTURE_REVIEW_PRESENTATION_BINDING_GUARD` and AT-07. Closing
N21 under that restriction does not close either remaining security boundary.

## 4. Exact repository baseline

| Property | Value |
|---|---|
| Repository | `TarasovArtem/qa-ai-agent` |
| Origin | `https://github.com/TarasovArtem/qa-ai-agent.git` |
| Baseline main / research branch / parent | `35c8d72a06aa86c94bd0550e6d66715c5e27edb3` |
| Baseline tree | `4bfcb476187dd68c85da912bac8cdd50bb29de7b` |
| Authorized branch | `research/aisec-4-data-exfiltration-isolation` |
| Sole authorized change | `docs/data-exfiltration-cross-project-isolation-v1.md` |
| Research date | 2026-10-04 |

Initial fetch established both remote refs at the required baseline; local
checkout HEAD/tree matched and the working tree was clean. Management issue #211
was OPEN and authorizes research only. The pre-mission ROADMAP AISEC-4 lifecycle
entry is not rewritten by this mission. Immediately-before-push ref checks and
the resulting commit/tree are reported separately; this document does not
self-certify its own future commit SHA.

## 5. Terminology

**Project identity** is an authorization scope, if authenticated by a trusted
host; a `projectId` string alone is only a label. **Repository root** is a
filesystem location with containment semantics, not proof of repository owner,
remote, project, or revision. **Origin project** means the actual data owner,
which may be UNKNOWN even where a label is present. **Egress** includes handing
data to another process, persistent file, artifact service, log reader, comment
reader, or remote API; it does not imply unauthorized exfiltration.

**Confused deputy** means using legitimate authority for the wrong data or
target. Secret disclosure and credential misuse are separate endpoints.
**Projection** selects data fields; **redaction** removes recognized content;
**provenance** describes origin; **authentication** establishes the origin or
actor through a trusted seam. An unkeyed digest detects specified content
changes but does not authenticate an actor, namespace, or project ownership.

## 6. Methodology / evidence classes

| Label | Meaning in this document |
|---|---|
| CURRENT / DIRECTLY OBSERVED (`C`) | Exact tracked source/configuration establishes the behavior; static observation, not exploit execution |
| SUPPORTED INFERENCE (`I`) | Consequence derived from that behavior with explicit actor/preconditions; not executed |
| POINT-IN-TIME OBSERVATION (`P`) | Narrow read-only GitHub ref/management observation on the research date; not a durable platform guarantee |
| UNKNOWN (`U`) | Repository evidence cannot determine platform behavior, deployed scope, actual sensitive content, or successful impact |
| PLANNED / FUTURE (`F`) | Proposed invariant, requirement, or unimplemented capability |

Evidence keys E01 through E18 in section 34 identify tracked paths and function
or configuration anchors. Matrix cells use these keys so claims are auditable
without treating grep hits as proof. Every listed DE/XB current-control claim is
static `C`; conditional consequences are `I`, and platform-dependent outcomes
remain `U`. All VR4 and future controls are `F`, not test results.

Repository-wide tracked-file searches used every requested term: `fetch(`,
`axios`, `http`, `https`, `Octokit`, `github`, `GITHUB_TOKEN`, `AI_API_KEY`,
`GROQ_API_KEY`, `apiToken`, `bearer`, `PAT`, `Authorization`, `process.env`,
`child_process`, `spawn`, `exec`, `execFile`, `repositoryRoot`,
`expectedProjectId`, `ProjectProfile`, `projectId`, `project.id`, `repository`,
`history`, `reports`, `artifact`, `upload-artifact`, `comment`, `publish`,
`destination`, `provider`, `cache`, `tmp`, `temp`, `cwd`, `realpath`, `writeFile`,
`readFile`, `stdout`, and `stderr`. No `axios` or literal `project.id` hits were
found. The ten tracked `fetch(` hits include tests; operational implementations
were traced separately. Ignored runtime reports and credential files were not
searched. Read-only GitHub metadata is planning/ref evidence, not vendor research.

## 7. System and project-identity model

| Identity concept | Supplier and consumer | What it actually establishes | What it does not establish |
|---|---|---|---|
| `ProjectProfile.id` | Target or public API caller; collectors and guidance builders | Valid non-empty label; collectors stamp metadata | Authenticated tenant, root ownership, remote identity |
| `repositoryRoot` | Explicit caller; generic root/path helpers | Existing absolute directory, canonical root and contained paths where checked | Relationship to profile, original artifact checkout, Git origin or current revision |
| `expectedProjectId` | Private generator/apply/execute/regenerate caller | Equality to artifact/model project fields at the relevant validators | Host-authenticated project or root association |
| GitHub `owner/repo` / `GITHUB_REPOSITORY` | Workflow context or invoking environment | Comment target from `context.repo`; history query repository; collector provenance | Equality to profile/root, token permissions beyond declared workflow scopes |
| Git origin / commit / branch | Root-anchored Git metadata, with CI env precedence in collector | Informational source context | An authorization binding across all pipelines |
| Jira base URL, JQL, provider ID | Trusted constructor caller | HTTPS configured site, query and namespaced output identity | Approved target project membership or profile association |
| Azure organization/project/WIQL/provider ID | Trusted constructor caller | Constructed platform path, selected query, configured source provenance | Every returned item's actual project membership or target profile association |
| Azure destination organization/project/ID | Trusted destination constructor | Fixed create endpoint and result correlation | Permission to transfer a particular source design to this project |
| Artifact IDs / evidence refs / digests | Artifact producer and canonical builders | Local identity, structural references, specified content consistency | Global project ownership or cryptographic actor authenticity |
| SUT URL / framework ID | Target config and tracked workflow | Which test runtime/SUT is selected | Canonical equality with requirement-source or publish-project identity |

The system has independent identity planes, not one canonical authorization
join. E01/E02 validate roots and profiles separately. E04 has project/framework
history-label gates; E05 has knowledge config/profile equality. E08/E09 RTI
artifacts intentionally have no `projectId`. E10 adds caller-selected #22
project identity through the explicit architecture seam. E12/E13 enforce label
and digest consistency at privilege transitions. E07 publication has no
ProjectProfile input. This supports an identity split risk with selected/copied
inputs; it does not prove automatic cross-project mixing in the normal workflow.

## 8. Data classifications

These are research categories, not an invented product confidentiality policy.
Actual owner-approved classification and permitted audiences remain OQ4-07.

| Class | Examples | Exposure consequence / required distinction |
|---|---|---|
| D1 credential material | API key, GitHub token, Jira token, Azure PAT/bearer | Values must remain secret; even a non-disclosed value can authorize misdirected activity |
| D2 repository / requirement content | Source snippets, existing test content, requirement descriptions and criteria | Public in this checkout does not imply acceptable disclosure for installed private consumers |
| D3 execution / failure evidence | Error/stack, stdout/stderr, DOM-derived errors, screenshots, videos, reporter JSON | May contain D1/D2 or personal/application data; size bounds do not declassify it |
| D4 generated / reviewed content | Models, test designs, proposed file changes, review before/after text | Derived content can quote D2/D3; approval does not approve every downstream audience |
| D5 provenance / operational metadata | Paths, project/repository/run IDs, branch, commit, native source IDs, destination IDs | Useful tracing data, not generally secret by itself; may be sensitive for a consumer |
| D6 curated knowledge / evaluation | Static knowledge units, project units, frozen datasets | Guidance/fixture trust is distinct from live evidence; no automatic learning |
| D7 governance evidence | Policy, review determinations, result reports, external evidence IDs | May authorize or influence management decisions only through the normative governance seam |

No real D1 values were inspected. Synthetic examples in code/tests do not prove
that current runtime artifacts contain secrets. Absolute hosted-CI stack paths
are deliberately allowed by SECURITY section 11a; consumer-specific path privacy
is unresolved and is not silently treated as an existing defect or acceptance.

## 9. Data-flow inventory

| Flow | Current chain | Authority transition and evidence |
|---|---|---|
| Triage | SUT/framework reporter → collector → browser/framework artifacts → aggregator → analyzer/prompt → AI provider → validated report → comment/artifact | Local reports become provider-visible evidence and published text; E02–E06, E14–E16 |
| History | Env-selected GitHub API/repository → runs/jobs → counters and labels in history.json → eligibility gate → prompt/report | API read authority and later model disclosure are separate; E04 |
| RTI | Explicit file or source-provider config → normalized requirements → quality/design/traceability → explicit destination | Trusted selectors, untrusted returned data, structural model validation and durable remote create; E07–E09 |
| Private design | Explicit evidence → requirement model → testcase model → candidate → review package/record | Caller project labels and local references; no automatic provider credential authority derived from content; E10 |
| Private automation | Root/profile repository evidence + candidate → plan → change proposal → canonical review/record → apply → execution record → bounded regeneration → fresh review | Read → model → write → host process → model re-entry are different boundaries; E11–E13 |
| Knowledge | Shipped core corpus + optional contained project units → hard scope selection → guidance prompt | No persistent memory or provider-driven promotion; E05 |
| Governance | Root/commit-scoped Git reads + supplied external evidence adapters → result aggregation/revalidation → JSON/Markdown reports | Management evidence, not authorization for agent product APIs; E17 |
| Evaluation / diagnostics | Tracked fixtures or runner evidence → offline scoring / bounded diagnostic reports → logs/artifacts | No evaluation model calls; diagnostic test reruns do contact the configured SUT; E16/E18 |

## 10. Data-egress inventory

Twenty current egress categories are inventoried. Local persistence and process
handoffs are included because their receiving domain differs from the immediate
producer. Each ID's complete schema is the join of the two tables below. `Y*`
means conditional on invocation/content, not an observed disclosure. `U` means
audience/behavior not established. Project A/B are synthetic logical labels.

| ID | Source / data class / origin project | Component | Destination / destination project-domain | Credential used | Project binding | Authority level / model-visible |
|---|---|---|---|---|---|---|
| DE-01 | C1–C7 selected prompts, D2–D6; caller-selected origin | GroqProvider | Fixed Groq chat-completions endpoint; configured account/domain, project U | AI_API_KEY as Bearer | No profile/root/account join | Remote model inference / Y |
| DE-02 | C1–C7 selected prompts, D2–D6; caller-selected origin | GeminiProvider | Fixed Google generativelanguage host/model path; account/project U | AI_API_KEY as x-goog-api-key | No profile/root/account join | Remote model inference / Y |
| DE-03 | Prompt/evidence, D2–D6; caller origin | MockProvider / injected provider | In-process implementation; caller process | None for mock; injected implementation U | Provider contract only | Executable in-process dependency / mock receives Y |
| DE-04 | JQL, selected field names, pagination tokens, D5; constructor origin | Jira source provider | Caller HTTPS site/search API; JQL-selected projects | Email/apiToken Basic | Configured site; no target-profile/project membership gate | Remote requirements read request / N |
| DE-05 | WIQL, item IDs/field selectors, D5; constructor origin | Azure requirements provider | dev.azure.com configured org/project; actual item membership U | Config PAT or bearer | URL org/project, requested-ID reconciliation; no profile join | Remote requirements read request / N |
| DE-06 | File bytes, D2/D5; selected root/file owner | requirements-file | In-process RequirementArtifact[] | None | Explicit contained file; artifacts have no projectId | Local read / only later explicit C2 seam Y* |
| DE-07 | Design title/objective/expected results, D2/D4; design source owner | Azure test-case destination | dev.azure.com configured org/project work-item create | PAT or bearer | Constructor target, result destinationId; no source-project gate | Durable CREATE_ONLY writes / N |
| DE-08 | Repository/workflow/branch/run/job IDs, D5; env-selected repository | collect-history | Env GITHUB_API_URL or default GitHub API; GITHUB_REPOSITORY target | GITHUB_TOKEN Bearer | Env selectors, not root/profile authentication | Remote read / later reduced counters Y* |
| DE-09 | Status/count/path, model-influenced warning title, selected errors, D3–D5; invoking job/root | Triage and workflow log producers | Terminal/Actions logs; job repository/domain | Platform logging; no direct API key in normal lines | Job/run association, no content DLP | Log publish / N unless re-entered elsewhere |
| DE-10 | Full context/history and AI report, D2–D5; report labels | Collectors/analyzer/aggregator | reports/ai under supplied root | None | Write containment; copied input not authenticated | Local persistence / context subsets Y* |
| DE-11 | reports/ai triage input/output, D2–D5; job labels | upload/download-artifact steps | GitHub artifact storage and same-run triage job | Actions platform credentials | Names/frameworks and workflow-run flow; data project not authenticated | Artifact publish/read / selected downloaded context Y* |
| DE-12 | Reporter JSON, screenshot/video/test-results, D3/D5; configured SUT/root | Cypress/Playwright workflow | Local reports and GitHub test artifacts | Actions platform credentials | Workflow/SUT config; no DLP policy | Artifact publish / image bytes N in current prompt |
| DE-13 | Forensics copies, resource metadata, terminal/ps output, D3/D5; Firefox runner | firefox-failure-forensics.sh | reports/firefox-forensics, terminal and GitHub artifact | Actions platform credentials | Job association; derived resource fields omit raw URLs | Diagnostic execute/publish / N |
| DE-14 | Formatted AI summaries/rootCause/evidence/fix/test names, D2–D5; report sourceContext | PR comment formatter/client | context.repo owner/repo + event PR; readers U | Injected Octokit/job token | Workflow target fixed; no report sourceContext equality gate | Message create/update / N |
| DE-15 | Plan/change/review/apply records and file content, D2/D4/D5; caller projectId | #23F application / review builders | Selected root paths; returned in-process records | OS filesystem principal | Label/digest/path checks, no original-root approval binding | Scoped filesystem write / proposed content earlier Y |
| DE-16 | Approved file and filtered env values, D1*–D5; selected execution root | #23G controlled-execution | Framework child, loaded Node/framework/test dependencies | OS principal; env names allowlisted | Applied digests and scope; cwd is not an OS boundary | Code execution / N at launch |
| DE-17 | Raw bounded stdout/stderr/status, D1*–D5; launched process | Execution-record builder / #23H | Returned record; caller may persist; prompt COPY after pattern redaction | Provider key only on later C7 call | Digests/IDs match chain; root not authenticated | Output-to-model transition / redacted C7 Y |
| DE-18 | SUT requests/resource fetches, D3/D5; configured tests | Browser suites / diagnostic reruns | poi.targomo.com and application-selected resource hosts | No explicit SUT credential in inspected tracked tests; browser state U | Target/framework config, not RTI project scope | Network interaction / N |
| DE-19 | Package names/versions, install/download/audit requests, D5 | npm ci, npm audit, browser/action setup | Tool-configured registry/download services; effective host U | Ambient tool config U; no custom registry credential in tracked .npmrc | Dependency/workflow pinning; not project confidentiality | Tool/process/network / N |
| DE-20 | D6 fixtures, D7 governance/Git evidence and reports, D5 branch data | Offline eval, governance Git runner/adapters, branch inventory | Child processes, returned JSON/Markdown and console; supplied external adapters U | Git runner filtered env; external adapter credentials U | Commit/root/subject checks; caller supplies adapter and output writer | Read/scoring/evidence rendering / N |

| ID | Logged? / persisted? / human-visible? | Current control | Residual gap | Evidence class / anchors | Existing relationship | Future verification |
|---|---|---|---|---|---|---|
| DE-01 | No normal raw-prompt log; provider-side retention U / selected evidence in local reports / provider/operators U | Fixed initial endpoint, TLS defaults, timeout; caller prompt projection | Free text may contain sensitive data; no authenticated project/key join; redirect policy unspecified | C E03, I disclosure, U retention/redirect | AT-12/13/16, PI-02/04/06, TB-16 | VR4-09/10/17 |
| DE-02 | Same distinction as DE-01 | Encoded model path, header key, timeout | Same project and free-text limits; explicit redirect policy absent | C E03, I, U | AT-12/13/16, PI-02/04/06, TB-16 | VR4-09/10/17 |
| DE-03 | Caller logging/persistence U / returned mock analysis / caller visible | Mock no network; minimal provider interface | Injected provider is trusted executable code, not a capability sandbox | C E03, I TB-16 consequence | AT-06/16, PI-05, TB-16 | VR4-06/10 |
| DE-04 | Fixed adapter errors; raw response not logged / returned normalized artifacts, no own durable cache / caller visible | HTTPS validated, private frozen config, manual redirect rejection, selected fields, bounded paging/retry | Caller can authorize wrong site/query; scope/actual membership U; normalized text may later egress | C E06, U platform permissions | AT-01/06/16, PI-01/05, TB-15 | VR4-06/17 |
| DE-05 | Fixed adapter errors / normalized return, no own durable cache / caller visible | Fixed platform host, manual redirect rejection, selected fields, exact batch-ID reconciliation | Org/project label is from config; no independent TeamProject check; WIQL scope U | C E06, U platform scope | AT-05/06/16, PI-05, TB-04/15 | VR4-06/17 |
| DE-06 | Fixed read/validation diagnostics / source file already persisted / caller visible | Explicit path containment and byte/shape bounds | Containment proves location not business project; imported text not DLP-scanned | C E08, I misuse | AT-01/05, PI-01/14, TB-04/09 | VR4-01/02/06 |
| DE-07 | Fixed destination errors / durable remote items and returned IDs / authorized platform readers U | Host pinning, manual redirects, escaped field mapping, sequential no-write-retry, short circuit | Project A design accepted for B destination when caller selects it; no canonical project authorization | C E07, I confidentiality consequence | AT-04/08/16, PI-12, TB-05/06/19 | VR4-07/18 |
| DE-08 | Status/reason including errors / aggregate history file / caller/job readers | Bounded run count/retry; project/framework labels later checked | API host/env target substitution; no root/repo match; history omits originating repository | C E04, I misuse, U permissions | AT-05/13/16, PI-14, TB-15/20 | VR4-08/17 |
| DE-09 | Y / platform logs / authorized readers U | Sanitized provider error summary; most lines counts/config/paths | Warning title and parser/API/dependency errors can expose text; log audience/retention U | C E02/E04/E14/E16, I sensitive echo | AT-12/13, PI-04/08, TB-07/17/20 | VR4-10/12 |
| DE-10 | Status only normally / Y / local readers by OS permissions | Contained writes; separate compact prompt projection | Richer than prompts, portable stale inputs; analyzer reads fixed report paths without per-file containment helper | C E02, I replay, U actual secrets | AT-03/05/12, PI-06/14, TB-04/09 | VR4-08/11/12 |
| DE-11 | Step metadata / Y / GitHub audience U | Same-run downloads as configured; named browser artifacts | Uploaded whole reports/ai; no content confidentiality scanner or project-authenticated import | C E14, I disclosure/replay | AT-03/05/12, PI-06/14, TB-17/20 | VR4-08/11/12 |
| DE-12 | Framework logs Y* / Y / GitHub audience U | Fixed workflow paths; capture settings | Screenshots/video/reporter errors can contain application data; no general redaction | C E14/E15, I disclosure | AT-12/13, PI-04, TB-17 | VR4-10/12/13 |
| DE-13 | Y before privacy removal / Y; artifact retention 7 days / readers U | Resource trace positive projection; final case-insensitive sensitive-pattern file removal | Removal does not retract already cat'ed terminal output; patterns do not cover all secrets/binary media | C E16/E14, I leakage | AT-12/13, PI-04, TB-17 | VR4-10/12/13 |
| DE-14 | Notices and raw caught err.message / Y remote comment / PR readers U | Bounded Markdown fields/total; workflow-derived PR target | No semantic secret scan; model may quote source; marker-only first-page target matching | C E14, I disclosure, U platform render/update rights | AT-03/12/16, PI-06/08, TB-07/08 | VR4-08/10/12/20 |
| DE-15 | Library returns, logging U / changed files, record persistence caller-owned / reviewer/caller | Canonical review binding, target digests, protected scope, containment/topology checks | Roots and humans unauthenticated; temporal race/OS normalization residuals inherited | C E12, I | AT-07/16, PI-07/09/10, TB-01/02/03/04/09/10/11/18 | VR4-02/03/04/15 |
| DE-16 | Captured child output / returned record; caller persistence U / caller | Fixed runner/argv, shell false, env-name allowlist, timeout/output bounds, post-apply revalidation | Full host principal after launch; sibling/parent reads and network conditional on host permissions | C E13, I host disclosure | AT-16, PI-11, TB-12/13/14/17 | VR4-13/14 |
| DE-17 | Caller-owned logs / raw record returned, no own writer / caller/reviewer | Exact chain validation; pattern redaction before prompt copy; one retry | Raw output still in record; sensitive unmatched free text can enter model; root-origin binding absent | C E13, I disclosure | AT-03/12, PI-04/06/13/14, TB-02/04/14 | VR4-05/09/10/12 |
| DE-18 | Framework/diagnostic logs / captures Y* / report viewers | Explicit SUT base URLs and fixed inspected flows | External SUT behavior, cookies, resource destinations and server retention U | C E15/E16, U external behavior | AT-02/12, PI-04, TB-12/17 | VR4-13/14 |
| DE-19 | Tool status/audit summaries / installed package files/cache / job readers | Lockfile, pinned actions, audit drift identities | Tool config/env/network dependencies not a data sandbox; transmitted request envelope U | C E14/E16/E18, U tool/platform behavior | AT-09/13, TB-16/17/20 | VR4-13/17 |
| DE-20 | Y summaries/reports / injected report writer, temporary test fixtures / caller | Bounded canonical Git runner, pattern-redacted outputs, subject-scoped checks; eval offline | Injected adapter/writer trusted, generic safety primitive can run caller-allowlisted executable; no tenant service boundary | C E17/E18, U external adapters | AT-09/14/15, PI-09, TB-09/16 | VR4-15/16/19 |

## 11. AI-provider egress

E03 providers receive `analyze({systemPrompt,userPrompt})`; they do not themselves
collect repository evidence. Groq posts to
`https://api.groq.com/openai/v1/chat/completions` with model plus system/user
messages and Bearer auth. Gemini posts to the fixed
`https://generativelanguage.googleapis.com/v1beta/models/` host/path with an
encoded model segment, `systemInstruction`/`contents`, and `x-goog-api-key`.
Both use configured/injected fetch and bounded request timeout. Neither sets an
explicit `redirect` policy. The exact redirect/header behavior of the deployed
fetch runtime is UNKNOWN; the fixed initial host must not be described as a
proved end-to-end redirect deny policy.

AI configuration is read from process environment at module load; constructor
overrides exist. Provider instances hold key/model/fetch state in ordinary
instance properties. No tracked code intentionally serializes the instance/key
into a prompt or normal log. An in-process provider is trusted executable code,
so its contract is not isolation from process authority (TB-16). Neither vendor
account scope, retention, residency, training use, nor per-project key policy is
established by this repository. Mock has no network and is not a fallback after
a real provider fails. Triage retries the same prepared prompts/provider up to
three attempts; generator correction calls are separately bounded. Repeated
transmission is not a different project or provider authorization.

The normal collector positive-selects framework source/config/page-object
evidence and bounds content (20 KB per file, 150 KB aggregate in the triage
collector). Private #23 repository-context construction also checks lexical and
resolved framework scope, sensitive/runtime-artifact exclusions, regular files,
physical duplicates, and per-file/aggregate bounds. These are useful selection
controls, not semantic secret detection. An allowed test/config can contain
sensitive text. C1's direct container forwarding also means the final prompt
builder alone is not a universal deep allowlist for copied/caller-supplied JSON.

## 12. Requirements-source boundaries

E08 file ingestion requires an explicit caller-authorized repository-local JSON
file, performs path containment and structural/size checks, and constructs file
provenance. It does not discover an arbitrary requirements file from cwd or
equate root containment with project authorization. The file artifact schema has
no projectId; provenance location is data and never retrieval authority.

E06 Jira construction validates HTTPS base URL without embedded credentials,
query or fragment, then privately snapshots config. The caller supplies site,
email/token, JQL, optional criterion field, limits and timeout. Requests explicitly
select fields and refuse redirects. JQL is caller authority; there is no separate
target project/profile or allowed-site registry. Reusing the instance retains the
configured site/query. Project membership and token access rights are UNKNOWN
without safe vendor verification. Sending the token to the selected legitimate
site does not prove that site/query is appropriate for the invoking project.

Azure constructs a fixed `dev.azure.com` org/project endpoint, privately freezes
config, rejects unknown config keys, refuses redirects, bounds WIQL results, and
reconciles batch returned IDs exactly against requested IDs. Its selected fields
and normalization do not independently compare `System.TeamProject` against an
authenticated target project. `source.system` is configured org/project; item IDs
and native source ID are retained. Whether a particular WIQL can obtain another
project's items is UNKNOWN platform behavior, not a proved cross-project query
exploit. Caller-selected WIQL/credentials remain separate from profile identity.

E09 generic `loadRequirementsFromProvider` accepts a trusted executable provider,
validates normalized artifacts and duplicate IDs, and gives no generic guarantee
of sanitized custom-provider error causes. Concrete adapters use fixed error
messages rather than raw response/credential dumps. Structural normalization
preserves source descriptions/native IDs; it does not authenticate ownership.
Provider-qualified IDs avoid a class of collisions if callers allocate distinct
provider IDs; no global project namespace registry exists.

The E10 opt-in RTI-to-#22 seam selects title/content/acceptance-criterion text and
keeps an artifact-to-evidence-ID mapping. It deliberately excludes source
location/metadata/relationships/type/priority/labels from model evidence. #22
evidence references use canonical user-input identity, not an authenticated
source project token. This is the existing architecture decision, not an
accidental regression; a future host must authorize scope before this lossy
projection rather than asking the model to infer it from source text.

## 13. Publishing-destination boundaries

E07 `publishTestDesigns` validates designs and the destination/result contract;
the destination is trusted executable code. The Azure destination snapshots
org/project/auth into private config and constructs a fixed platform create
endpoint. It maps title and escaped objective/expected-result descriptions,
creates sequentially, does not update existing items, and never retries a write.
Ambiguous transport/server/response outcomes stop subsequent publication.
Returned remote IDs and destination ID are correlated; there is no durable
idempotency ledger or later unknown-outcome reconciliation in v1.

A structurally valid Project A design can be passed to a Project B destination
by a trusted caller. Neither API accepts ProjectProfile/repositoryRoot as a
source-project authorization gate. This is current contract behavior and TB-05,
not a newly proved unauthorized cross-project exploit. Cross-vendor Jira-to-Azure
publication is intentional; denying all unequal source/destination names would
break that design. The unresolved question is who authorizes the explicit
mapping, not whether vendor names match. Escaping addresses field rendering,
not confidentiality or target correctness. Returned location is display
metadata checked against the platform hostname; it is not fetched and does not
establish org/project ownership. TB-19 replay semantics are unchanged.

Management #199's pending public element-level TOCTOU work (N17/RP33) is not
silently treated as closed by the existing detached snapshots. Its final
disposition/evidence is outside this mission. Reviewers must retain that public
surface follow-up independently of AISEC-4's source/destination binding question.

## 14. GitHub / CI / artifact / comment boundaries

E14 workflow separates test jobs from triage. Unit/evaluation jobs have no mapped
AI secret; evaluation is offline. Cypress history steps receive job token;
triage declares contents read/actions read/pull-requests write and maps the named
Groq repository secret into AI_API_KEY only for the analysis step. These are
tracked declarations. Effective token permissions, repository visibility,
organization policy, artifact/log audiences, default retention, and present
GitHub settings are UNKNOWN unless specifically observed. AISEC-3's 2026-09-24
settings inventory is dated predecessor evidence, not a fresh 2026-10-04 claim.

Fork behavior is the carried SECURITY/workflow contract: no repository Groq
secret, unavailable analysis rather than fabricated fallback, and comment writes
may fail under platform-capped read-only token. No current live fork/settings
experiment was performed. Same-repository edited-workflow exposure retains
TB-20's inference qualification and drift sensitivity; this artifact adds no
current exploit proof or new token-scope rating.

| Artifact / publication | Creator and fields | Identity / reuse | Redaction and retention established by source |
|---|---|---|---|
| reports/ai/context.json | Collector: full failedTests extras, relevantFiles source, metadata/project/repository/run, constraints; aggregator adds correlations | File location and labels; portable JSON, no authenticated import | No general content scanner before write/upload; richer than C1 prompt; retention unspecified |
| reports/ai/history.json | Collector: project/framework/browser/branch/generatedAt and aggregate counters; unavailable reason on failure | Env query target not retained as canonical repository identity; reusable label-gated file | Prompt normal history reduced to four counters; raw artifact not equivalently minimized; retention unspecified |
| reports/ai/ai-report.json | Analyzer: model results/policy/warnings, sourceContext, provider attempts, safe firstAttemptError, compact separately loaded history | Report provenance not checked by comment step against current repo/profile | Safe provider error summary, no general DLP of result strings; retention unspecified |
| browser-result.json / correlation input directories | Workflow literal framework/browser and step outcome; downloaded triage inputs | Configured current-run artifact names; aggregator framework consistency gate | No authenticated data-origin gate; no external run ID configured in downloads |
| Cypress reporter/screenshots/videos | Framework and mochawesome: test names/errors/stacks/application visuals | Job/SUT configuration; filenames not owner authentication | No general redaction; retention unspecified |
| Playwright report/test-results | JSON reporter errors and on-failure screenshot; trace/video off | Job/framework/SUT config; portable files | No general redaction; retention unspecified |
| Firefox forensics | Original report/media copies, runner/resource metadata, ps listing, diagnostic terminal logs, derived resource trace | Firefox job and run metadata | Raw URLs omitted from trace; final pattern-based file removal; earlier cat output remains in logs; artifact retention exactly 7 days |
| PR triage/resolution comments | Formatter + client: model summary/root cause/evidence/fix, test/spec/run link; resolved text | Workflow context.repo/event PR; browser marker; report label not authorization | Size bounds, no semantic secret scan; first 100 comments searched without author gate; comment lifetime/visibility U |
| #23 execution/review records | Pure builders return bounded raw outputs or full reviewed file text and digests | projectId and artifact chain; no authenticated persisted checkout identity | Caller decides persistence; C7 redacts only prompt COPY, not original record |
| Governance pre-review reports | Injected pipeline and writer: subject/result/evidence/policy metadata in JSON/Markdown | Commit/subject checks; caller repository context, no connection to product projectId | Writer must perform real-path safety; audience/retention caller-owned |

Comment output excludes wholesale relevantFiles and raw error stacks as fields,
but model-generated evidence may quote their contents. Formatter truncation is
not DLP. Analyzer warning messages embed a model-supplied test title in normal
logs; parser/dependency errors and workflow comment catches can also render raw
error messages. The fixed provider-error summary is a narrower, valuable control.
Forensics' privacy pass deletes matched files after some log contents were
already printed, and binary/unmatched secrets are not covered by its regex.

## 15. Filesystem application boundary

E12 apply consumes authoritative plan/context/change set, review package/record,
caller expectedProjectId, and caller root. Current N21 source rebuilds the
canonical package from authoritative inputs and compares content/digests,
including target before/after content binding. REVIEW presentation restriction
and AT-07 remain separate. No supported #23E display/record/apply UI/CLI/workflow
exists; shipping one triggers SECURITY section 28's guard.

CREATE/MODIFY scope checks, protected path rules, canonical paths, ancestor
topology, symlink/hardlink checks, base digests, exclusive creates, temporary
write/rename and rollback protect the selected root. They do not determine that
the selected root belongs to the artifact's real project. A second checkout with
the same relevant base bytes can satisfy the content checks (TB-02). Changing
only expectedProjectId to a genuinely mismatching artifact label is blocked;
using consistent caller labels and a wrong root is a different path. Restoring
base content permits content-based replay without durable nonce/ledger (TB-03).

The root and approval actor are not persisted as authenticated authority in the
records. Absolute root omission has privacy value but leaves original-checkout
binding unresolved. Filesystem race residuals remain TB-11; Windows normalization
and management's NTFS ADS observation remain TB-10/N03 owner work, with no
re-rating here. No write/application probe was run for this research.

## 16. Controlled-execution isolation

E13 traces approved proposal → applied-change record → current files/topology
and afterDigest revalidation → framework target mapping → framework binary
under selected root's node_modules/.bin → child process → loaded framework/test
code → bounded output record. Cypress `.cy.js` and Playwright `.spec.js` scope,
fixed runner arguments, `shell:false`, finite timeout/output, and label/digest
checks constrain launch. They do not constrain the behavior of approved code.

The main launch path copies only these environment names (case-insensitively):
PATH, SYSTEMROOT, WINDIR, TEMP, TMP, HOME, USERPROFILE, APPDATA, LOCALAPPDATA,
CI. Typical token/key variable names are excluded. Values of allowed variables
are not proved non-sensitive. HOME/USERPROFILE and writable temp locations can
lead code to other data; credentials already present in filesystem are not
removed. The generic private process helper must not be mistaken for a public
guarantee that every possible caller uses the main path's filtered environment.

After launch, code runs under the host OS principal. Node-loaded test/config/
framework code may read parent or sibling repositories where OS permissions
permit, inspect allowed environment values, read credential/config files, and
make network requests where host/network policy permits (`I`, TB-12/TB-14).
Browser-page JavaScript has different runtime permissions; arbitrary Node
filesystem access is not attributed to every browser script. Exact permitted
files/resources and successful disclosure are `U` for a particular deployment.
No OS sandbox, filesystem capability boundary, tenant namespace, or network deny
policy is established by #23G. cwd is a launch location, not confinement.

Timeout handling kills the direct child best-effort; #23G does not establish
full descendant reaping or removal of remote effects. Governance's separate
process primitive uses POSIX process-group handling and has a Windows descendant
limit; it is not substituted for #23G's behavior. Full sandbox work remains
future. Any controlled demonstration must assess its actual narrow environment
before execution rather than label the current launcher project-isolated.

## 17. Cross-project state inventory

Each row answers ownership/binding, selection/immutability, consumption,
persistence/sharing/reuse, and stale/wrong-project risk. `No automatic sharing`
means no tracked cross-project service/cache was found; callers can still reuse
objects/files. Static research cannot establish concurrent deployed host use.

| State item | Owner / binding | Caller-selected / immutable? | Validated at consumption? | Persisted / shared / reusable? | Stale or wrong-project consequence |
|---|---|---|---|---|---|
| AI config module constants | Process env, no project owner | Env chosen at import; constants fixed for module lifetime | Provider/model/key structural checks | In-memory process-wide module cache; reused | Long-lived process may retain first invocation's config; no multi-tenant dispatcher currently present |
| AI provider instances | Account/key/model, no project field | Constructor chosen; ordinary mutable properties | Provider interface/string response; no project check | Caller may share/reuse; no own persistent store | Wrong account key can process otherwise valid A/B prompt |
| Jira / Azure source config | Configured site or org/project | Caller-selected; private frozen snapshot | Constructor + response/normalized validation | Instance reusable; no shared cache | Fixed wrong source persists across calls; object immutability does not authorize source |
| Azure destination config/ID | Configured target org/project; caller destination ID | Caller-selected; private config; public ID does not authenticate target | Config, designs, publish result | Reusable instance, remote IDs persist | A designs can be sent to B; mutable display identity cannot authorize mapping |
| ProjectProfile | Caller label/display/guidance | Caller-selected object, not intrinsically authenticated/frozen | Shape validated; some config equality checks | Caller-held/reusable | Profile/root/context can describe different projects (XI-01) |
| expectedProjectId | Invocation caller label | Caller-selected string | Compared with model/artifact chain | No own store; reused by caller | Matching labels can describe wrong actual root |
| repositoryRoot | Invocation filesystem root | Caller-selected, canonical resolution per call | Existing directory; path checks at relevant read/write points | No mutable root singleton; records omit authenticated root | Selecting another valid checkout is not blocked by existence checks |
| process.cwd() | Host invocation working directory | Operator/process-selected, process-wide mutable | Generic core requires explicit root; unrelated CLI/tool use is ambient | Reused across process calls | cwd does not choose generic core project; npm/diagnostic scripts need correct host invocation |
| Git/CI repository, commit, branch env | Invoking workflow/env and root Git | Env-selected metadata takes precedence where coded | Shape/lookup, not profile-origin auth join | Context/report persisted | Env identity can name another repository despite selected root |
| context.json | Root location + collector metadata label | Portable caller-writable file; content mutable | Analyzer parses; no profile/repository/run equality gate | Persisted, artifact transport, reusable | Copied A context analyzed under B profile/key (XI-01) |
| embedded context.history | Context producer/file owner | Caller/file-controlled object | No independent eligibility projection if separate history is null | Persisted in copied context; prompt forwards it | Rejected/missing separate history does not remove it (XI-02) |
| history.json | Profile/framework/browser labels, env query source | Mutable persisted file | Project/framework/available/integer counter gates | Persisted/reusable; no repo identity in file | Matching labels do not prove repository/run/time; legacy absence rules remain |
| aggregate input/browser-result | Workflow labels and file roots | Caller paths/config or same-run download | Safe JSON reads, framework identity consistency | Artifact directories copied/persisted | Framework match does not authenticate project/run; stale files require separate import policy |
| report.json / AI report output | Source context labels | Mutable portable file | Result schema/policy when generated; comment only consumes selected fields | Persisted/uploaded; reusable | Prompt minimization does not prevent artifact/comment audience disclosure |
| Generated model/plan/change IDs | Caller projectId + canonical references | Validated detached/frozen representations where built | Expected IDs, cross-model refs and digests | Return values, persistence caller-owned | Identical IDs/content can be replayed; no global namespace registry |
| Review packages/records | projectId, content digests, self-declared reviewer | Builders canonicalize/snapshot; attacker can construct data with valid digests | Package/record shape and canonical bindings | Portable return data, caller storage | No authenticated human/root/non-replay authority (TB-01/02/03/18) |
| Applied records | Change IDs/digests, after-state summaries | Canonical records | Current root/content revalidation before execution | Returned; caller storage/reuse | Same bytes in another root may satisfy checks; root not bound |
| Execution/regeneration records | project/model/plan/change/apply/execute digests | Caller chain, output snapshots | Exact chain, attempt/category/status/content checks | Returned, caller persistence | Foreign label/digest mismatch blocked; relabelled/identical-root provenance unresolved |
| Temp write/rollback files | Selected application target directory | Implementation-selected names | Write topology/exclusive-create checks | Transient/rollback; not project cache | Host race remains; file lifecycle not OS tenant isolation |
| HOME/TEMP/tool caches | Host OS/environment | Env-selected and mutable | Names allowlisted, values not classified | May persist/share across host projects | Allowed paths can point to another project's data or ambient credentials |
| Core knowledge | Shipped static corpus, neutral/explicit scopes | Repository-owned units; per-invocation load/selection | Schema; hard project/framework eligibility before relevance | Tracked static files; no mutable retrieval cache | Neutral scope intentional; caller context label is not authentication |
| Project knowledge | Config projectId and contained directory | Caller config; project files mutable | Config/profile equality + containment + unit scopes | Local files, invocation-local maps | Context/profile mismatch still affects selection when context supplies projectId |
| Evaluation datasets/baselines | Committed fixture dataset version | Explicit/local fixture paths | Schema/scoring/regression checks | Tracked fixtures and local temp test data; no online promotion | Evaluation data is not live project evidence or approval authorization |
| External source/remote destination IDs | Provider-qualified ID/native source ID/destination result | Caller registry convention | Local duplicate/result ID checks | Source artifacts and remote creates persist | Distinct caller IDs required; identifiers are opaque, not authenticated namespaces |
| Governance policy/results/evidence | Commit subject and caller/platform invocation context | Canonical snapshots; adapters/writer trusted | Provenance/subject/policy/CI/revalidation gates | JSON/Markdown reports; source can be externally mutable | Governance authority does not automatically authenticate product project selection |

## 18. Cross-project boundary matrix

Sixteen important boundary joins are listed. Fail-closed means the stated check,
not a claim of complete isolation. Reachability always distinguishes trusted
caller misuse, copied local input, tracked workflow flow, and future service.

| ID / boundary | Source identity → target identity | Mechanism / supplier / validation point | Failure mode / fail-closed? | Cross-project misuse reachable? | Current evidence / remaining gap |
|---|---|---|---|---|---|
| XB-01 profile → root | Caller profile.id → caller directory | Independent validators at collector/analyzer entry | Invalid/missing values rejected; valid disagreement not checked | Public API caller can select unrelated valid pair | C E01/E02; no canonical join; VR4-01/02 |
| XB-02 persisted context → analyzer | Context project/repo/run → profile/root/provider key | JSON parse, failure count; profile used for system guidance | No identity mismatch fail-closed gate | Copied/local file path current; normal fresh CI does not demonstrate it | C E02; XI-01; VR4-01/08/11 |
| XB-03 history → context/prompt | history.projectId/framework → context metadata | readHistory eligibility and four-counter projection | Separate mismatching history returns null; embedded history remains | Copied/caller context current; XI-02 | C E02/E04; nested bypass and no authenticated repo scope; VR4-08/09 |
| XB-04 CI env → collector/history | Env repo/API/commit → selected root/profile | Env precedence, API request construction, stamped labels | Missing env unavailable; wrong valid env not rejected | Local env trusted caller; edited workflow TB-20 qualified inference | C E02/E04/E14; host/repo join absent; VR4-08/17 |
| XB-05 workflow artifact → aggregator | Artifact browser/framework/context labels → invocation | Same-run configured downloads; safe reads; framework consistency | Comparable framework mismatch stops context/provider flow | External-run download not configured; copied local dirs can mislabel project | C E02/E14; no project/run authentication; VR4-08/11 |
| XB-06 file/source config → RTI | Caller file/site/org/query → artifact provenance | Containment/config/network and artifact validators | Shape/path/redirect failure rejects; valid wrong business scope accepted | Supported trusted caller misuse; actual remote membership U | C E06/E08/E09; no profile input; VR4-06 |
| XB-07 RTI → #22 evidence | RTI source/ID → caller projectId/user-input refs | Explicit one-way positive projection + ID mapping | Structural mismatch rejected; ownership not authenticated | Private opt-in adapter caller only | C E10/architecture contract; source scope must be authorized before projection; VR4-06/09 |
| XB-08 #22 → #23 context/plan | Models' projectId → profile-derived context projectId | Expected-ID/cross-model checks | Actual unequal labels fail closed | Consistent forged labels or wrong root remain possible for private caller | C E10/E11; labels not root authorization; VR4-01/04 |
| XB-09 proposal → review/approval | Plan/context/change digest → canonical package/record | Canonical recomputation and snapshots; self-declared reviewer | Content/digest mismatch rejected; no actor authentication | Private callable seams; no supported presentation entrypoint | C E12 + SECURITY 28; AT-07 remains; VR4-03/04 |
| XB-10 approval → filesystem | Approved project/digests → selected root | Expected labels, scope, topology/base bytes; caller root | Mismatch/unsafe path fails; second matching checkout accepted | Private caller replay; no tracked production orchestrator | C E12; TB-02/04; VR4-02/03/15 |
| XB-11 applied record → execution | Applied project/after digests → current root/runner | Revalidation + fixed launch mapping | Modified files/IDs rejected; root ownership not checked | Private caller; matching equivalent checkout residual | C E13; original root not recorded; VR4-02/05 |
| XB-12 launch → host resources | Scoped target/cwd → OS principal/files/network | Filtered env, fixed argv/time/output; no OS boundary | No post-launch filesystem/network fail-closed policy | Legitimately approved Node code under host permissions; I disclosure | C E13/SECURITY; TB-12/14; VR4-13/14 |
| XB-13 execution → regeneration | Execution/apply/change/plan/context IDs → C7 proposal | Digests/status/attempt/current MODIFY evidence; redacted output copy | Different chain/infra/CREATE origin rejected | Matching caller labels/root provenance gap remains; no production auto loop | C E13; raw record privacy separate; VR4-05/10 |
| XB-14 selected prompt → provider | Caller evidence project → selected provider account | C1–C7 projection + provider interface | Schema/size fails; account/project mismatch not represented | Supported triage + private calls under trusted config | C E03/E10/E11; no authenticated prompt account scope; VR4-06/09 |
| XB-15 designs → remote publish | Requirement/design identity → configured destination org/project | Generic design/result validation; constructor target | Invalid input/redirect/ambiguous write stops; wrong valid project accepted | Supported public caller; cross-vendor transfer intentional | C E07; TB-05/19; VR4-07/18 |
| XB-16 report → comment/reader | Report sourceContext → workflow repo/PR audience | Formatter bounds; context.repo and event PR select target | Missing report/results/PR skips; mismatching report provenance not rejected | Workflow consumes local file; copying requires filesystem/code control | C E14; no audience/secret or origin policy; VR4-08/12/20 |

## 19. Adversarial cross-project scenarios

These are conceptual static analyses, not executed hostile tests. No scenario
renames, closes, or re-rates AT/PI/TB. Current callable reachability is narrower
than successful unauthorized remote exploitation.

| Scenario | Synthetic setup / actor / entry point | Checks and outcome | Reachability / impact evidence | Related records / future requirement |
|---|---|---|---|---|
| XP-01 | Private caller supplies A plan/change artifacts with B repositoryRoot to #23F/#23G | Unequal expectedProjectId is blocked; consistent A labels and valid B root with matching base/after bytes are not authenticated to original root | C code, I misplaced write/execution; no tracked production orchestrator; installed private modules absent | TB-02/04/09, AT-05/16; VR4-02/04 |
| XP-02 | Supported caller constructs A requirements source then uses its artifacts in a B target pipeline | Source/generic loader have no ProjectProfile parameter; #22 adapter introduces caller B label after explicit projection | C contract, I wrong evidence; no automatic project-routing service; remote A membership U | AT-05/06, PI-14, TB-04; VR4-06 |
| XP-03 | Supported caller sends A TestDesignArtifact to B Azure destination | Valid design and target config accepted; source requirementId is not a destination authorization gate | C current public behavior; I disclosure to B readers if credentials permit; intended cross-vendor use must remain possible | AT-04/08/16, PI-12, TB-05/19; VR4-07/18 |
| XP-04 | Private caller copies A review/approval package to B apply target | Canonical package recomputation blocks changed authoritative content; matching package plus B root can pass base/scope checks; forged actor concern separate | C guards, I root replay; no supported review renderer; no new human approval authenticity | AT-07, PI-08/09, TB-01/02/18; VR4-03/15 |
| XP-05 | Caller uses A execution/output record in B regeneration | Plain project/plan/change/apply/digest mismatch, invalid status/category, or attempt >1 rejected; caller-consistent identical chains still lack authenticated root | C mismatch rejection; I output provenance risk; future shared orchestrator only for automatic tenant mixing | AT-03/05, PI-04/14, TB-02/04; VR4-05/10 |
| XP-06 | A context/history copied into B root; valid B profile and configured real provider; public analyzeFailure.main | No context/profile equality; separately loaded history only gates against context metadata; null readHistory leaves embedded history intact | C source-reachable XI-01/02 with filesystem input control; I disclosure and wrong analysis; fresh tracked CI not demonstrated | AT-05/12, PI-14, TB-04; VR4-01/08/09 |
| XP-07 | Trusted caller reuses A AI/source/destination instance for B task | AI instance no project field; source/destination snapshots retain A endpoint/config rather than switching to B; contract validates interface/shape | C trusted dependency behavior; I wrong account/source/target; no concurrent tenant service found | AT-06/16, TB-05/15/16; VR4-06/07/16 |
| XP-08 | Operator/stale workspace copies reports/ai or triage-input directory between checkouts | Root-contained output and framework matching do not authenticate report project/repo/run; analyzer/comment can consume copied data | C current paths; I contamination/disclosure; same-run workflow itself does not fetch another repository/run | AT-03/05/12, PI-06/14; VR4-08/11/12 |
| XP-09 | Operator changes cwd/env to B while providing A inputs | Generic missing-root/profile invocation fails closed; no generic cwd fallback. Valid wrong root still selected by caller; env history repo/API and import-time AI config can disagree | C structural guards and selectors; I env-mediated routing; actual scopes U | TB-09/15/16/20, AT-05; VR4-02/08/16/17 |
| XP-10 | Reviewed/generated Node-capable test is legitimately applied/launched, then reads sibling/parent data and sends it out | Scope/digest/env checks permit launch but impose no post-launch OS filesystem/network confinement | C no sandbox, I read/egress if OS/network permissions permit; no malicious code or secret probe run | TB-12/14/17, PI-11; VR4-13/14 |

## 20. Credential-mediated exfiltration

This consumes AISEC-3's credential classes. No values, deployed privileges, or
user/account identities were obtained. `Token remains outside prompt` is a
source construction claim, not protection against sensitive strings occurring
inside otherwise allowed evidence.

| Credential class | Authorized data activity and destination | Account/project/caller binding | Secret confidentiality versus use authority | Evidence / requirement |
|---|---|---|---|---|
| AI_API_KEY, CI Groq secret mapping | Sends prepared prompts to selected Groq/Gemini endpoint | Env/import-time config and provider constructor; account/project scope U | Header-only intentional channel; wrong project evidence can still be sent with legitimate key | C E03/E14; TB-16; VR4-06/09/10/17 |
| GITHUB_TOKEN / Octokit job credential | Reads runs/jobs; creates/updates comments in supplied workflow context | History env target/API; comment context.repo; declared job scopes only | No intentional model inclusion; wrong API base can receive token (TB-15) without needing model cooperation; target profile not checked | C E04/E14; U effective token scope; VR4-08/17/20 |
| Jira email/apiToken | JQL/fields/page requests and returned requirements from selected HTTPS site | Trusted base URL and query constructor; actual token permissions U | Private snapshot, Basic header, manual redirect denial; allowed HTTPS alone does not authorize a site/project for B | C E06; TB-15; VR4-06/17 |
| Azure PAT | Requirements WIQL/batch reads or destination test-case creates | Fixed platform host, selected org/project; configured token scope U | Header-only private config; same trusted host can still be wrong org/project; read and write instances are distinct authority | C E06/E07; TB-05/15/19; VR4-06/07/18 |
| Azure bearer | Same selected source/destination operations | Trusted config; bearer audience/scope U | No prompt channel; absence of token disclosure does not prevent misbound creates | C E06/E07; VR4-06/07/17 |
| Checkout credential / host credential files | Git/tool or arbitrary loaded code activity subject to OS/platform scope | Workflow checkout defaults and host filesystem; current effective storage/scope U | Env filtering does not remove credential files; retain TB-14/17/20 qualifications | C workflow/default config, I host path; VR4-13/14 |
| Actions artifact/setup/dependency tooling credentials | Artifact transport/install/audit/setup operations | Platform/tool-managed env/config; exact envelopes/scopes U | No application prompt construction for them; third-party tooling not audited as a tenant sandbox | C workflows, U tool internals; VR4-12/13/17 |
| Future provider / external evidence adapter credentials | Caller-defined executable implementation | No current canonical per-project registry | Generic trusted interface is not a secret-use confinement boundary | F future designs; C injected governance seam; VR4-16/19 |

Host pinning prevents one form of destination substitution. It cannot decide
whether data from A should be read/published under B's account/project on the
same platform. Conversely a configurable Jira/GitHub API authority requires a
trusted host decision before any credentialed request; content or model output
must never be allowed to choose it merely by containing a plausible URL.

## 21. Provider-visible minimization

C1–C7 were checked against current prompt builders/generator call sites, not
assumed unchanged from AISEC-2. E02/E03/E10/E11/E13 provide executable anchors.
Static necessity assessments below are design inputs, not permission to add or
remove fields in this mission.

| Call / current surface | Exact model-visible data classes and fields | Task necessity / excess question | Project provenance / credential / redaction |
|---|---|---|---|
| C1 triage; public main and tracked CI | System: profile displayName and framework plus fixed policy. User metadata browser/ci/commit/branch/event/framework; testResults; failedTests title/fullTitle/specFile, error.message/stack and own duration/screenshot; relevantFiles; warnings; history; constraints; projected browser/framework correlations; selected knowledge | Failure text/source/counters ground triage. Commit/branch/event and optional screenshot locator are operational context; owner must decide private-consumer disclosure. Named containers testResults/relevantFiles/history/warnings/constraints/knowledge are not universally deep-reprojected here | Profile.id and repo/run labels omitted from metadata prompt; displayName not authenticated scope. Separately eligible history becomes four counters, but XI-02 embedded field bypass remains. Credentials not intentionally included; error/stack/source free text unredacted |
| C2 requirement model; private | projectId; evidence entries with evidenceRef id/kind/sourceId and text; correction diagnostics restricted to path/code/message | Requirement evidence needed; sourceId is opaque attribution, not access authority; all supplied bounded evidence is selected by caller | Exact label copied/checked, no authenticated origin; RTI source metadata omitted at seam. No raw prior provider output or credential config in correction |
| C3 testcase model; private | projectId, requirementModelId; requirements id/text; assumptions id/text/rationale; open questions id/type/description/reason | Requirement reasoning needed; all assumptions/questions can disclose content beyond a selected eventual testcase | Source-system/project provenance no longer carried as authorization; caller IDs and cross-model checks only. No credential field; free text retained |
| C4 automation candidate; private | projectId, testCaseModelId; one testcase id/title/objective/requirementIds/preconditions/steps(action/expectedResult/requirementIds)/priority(level/rationale/requirementIds); only referenced requirements id/text; all assumptions/open questions; optional guidance displayName/constraints; authorizedFrameworks; availableEvidence id/kind/sourceId/location | Positive selection reduces unrelated testcase/requirement disclosure; all assumptions/questions and evidence locator catalog need owner necessity review | projectId is present on wire, even if model must only copy it. Evidence locations are metadata, not root/source authentication. No raw repository/file contents or credential config here |
| C5 automation plan; private | projectId/framework; candidate id/decision/rationale/targetFrameworks; guidance displayName/constraints; availableTestScripts names; repositoryEvidence ref id/kind/location, role/content | Framework evidence needed to plan feasible changes; script names sent, script commands excluded. Whole selected config/file content can contain unrelated/sensitive literals | Root absolute path excluded; profile-derived context label and artifact equality, no authenticated root join. Free text not DLP-redacted; key excluded structurally |
| C6 change proposal; private | projectId/framework and plannedChanges path/operation/purpose; existingContent only for MODIFY from matching repository evidence | Existing bytes needed for grounded MODIFY; all file bytes may exceed semantic minimum but removal policy unresolved. Other candidate/evidence catalog/script commands not forwarded | Relative path plus caller chain, not root ownership; no credentials or stdout/stderr field; selected content may contain secrets |
| C7 bounded regeneration; private | C6 projection plus execution status/exitCode/stdout/stderr and bounded correction diagnostics | Failure output needed to propose correction; arbitrary output can contain unrelated host/application data | Exact expected project/plan/context/change/apply/execute IDs and digests, attempt 1, TEST_FAILED status with derived GENERATED_AUTOMATION_FAILURE category only, CREATE origin refused, MODIFY current evidence matches afterDigest. Pattern-redacted prompt copy; raw execution record retained |

C7 redaction recognizes Authorization/Bearer, token/secret/password/API-key
assignment patterns and URL credentials before model-visible serialization.
This is a partial deterministic content control. It cannot prove removal of
unknown encodings, unlabelled confidential prose, personal data, or every secret
format (PI-13 remains injection-owner work). The record is not mutated into a
sanitized persistence artifact. New generated proposals require fresh review;
execution output does not itself become authority to apply.

Repository content is positive-selected upstream, but C1 accepts parsed report
containers without a complete nested confidentiality schema. Neither exclusion
of credential config fields nor selected file paths prevents sensitive literals
inside text. No current model call enforces an authenticated project/provider
account binding. A proposed provenance token must be host-verified authorization
data outside the model decision, not a textual instruction relied upon for
isolation (OQ4-01/OQ4-05).

## 22. Current control inventory

Every important class uses one of the required categories. Classification is
specific to the stated property; a component can have a strong path control and
only caller-contract project binding at the same time.

| Control / property | Classification | Evidence / limit |
|---|---|---|
| Generic required explicit profile/root | STRONG_DETERMINISTIC_CONTROL | E01/E02 reject missing/invalid values; does not join valid identities |
| Root-to-business-project mapping | CALLER_CONTRACT_ONLY | Caller selects valid pair; no Git/profile authentication |
| Contained selected reads/writes | PARTIAL_DETERMINISTIC_CONTROL | E01/E08/E11/E12 topology/path guards; analyzer report reads do not use per-file realpath containment; temporal races remain |
| Prompt top-level and selected failure/correlation projection | PARTIAL_DETERMINISTIC_CONTROL | E02/E10/E11 positive selection; C1 containers and allowed free text retain residual exposure |
| Secret exclusion by credential channel construction | PARTIAL_DETERMINISTIC_CONTROL | Headers/private config, safe provider summaries; no general semantic scanner |
| C7 output redaction | PARTIAL_DETERMINISTIC_CONTROL | E13 pattern redaction before prompt copy, not every format nor persisted record |
| Jira/Azure redirect refusal and Azure host construction | STRONG_DETERMINISTIC_CONTROL | E06/E07 reject 3xx/opaqueredirect; caller-approved project/site correctness separate |
| AI/history explicit redirect denial | UNKNOWN | No explicit option; effective runtime/header behavior not verified |
| RTI returned artifact and publication result correctness | STRUCTURAL_VALIDATION_ONLY | E07–E09 IDs/schema/snapshots; no business-project auth; pending N17 element-level concern retained |
| External source/destination project authorization | CALLER_CONTRACT_ONLY | Trusted constructor/publisher controls selectors; no profile seam |
| Separate history project/framework/counter gates | PARTIAL_DETERMINISTIC_CONTROL | E02 gates labels and reduces fields; no repo authentication and XI-02 fallback |
| Report project/profile equality at analyzer | NO_CONTROL_IDENTIFIED | XI-01, public entrypoint reads copied JSON without comparison |
| Aggregate framework mismatch | STRONG_DETERMINISTIC_CONTROL | E02 comparable mismatch prevents selected context/provider flow; not project auth |
| Knowledge project eligibility before relevance | PARTIAL_DETERMINISTIC_CONTROL | E05 hard scope predicate/config checks; context identity caller/file controlled |
| Review content/digest binding after N21 | STRONG_DETERMINISTIC_CONTROL | E12 authoritative canonical recomputation for specified content; not human/root auth |
| Reviewer authenticity and supported presentation | PROCESS_GOVERNANCE_ONLY | AT-07 and SECURITY 28 guard remain; self-declared record actor not authenticated |
| Original checkout binding / durable replay prevention | NO_CONTROL_IDENTIFIED | Content and label checks, no authenticated root/nonces/ledger; TB-02/03 |
| #23G launch constraints | PARTIAL_DETERMINISTIC_CONTROL | E13 fixed runner/argv, filtered env, revalidation and bounds; post-launch authority broad |
| Post-launch project filesystem/network confinement | NO_CONTROL_IDENTIFIED | No OS sandbox in #23G; deployment external controls U |
| CI permissions/job separation | PARTIAL_DETERMINISTIC_CONTROL | E14 explicit declarations; actual platform caps/settings U, edited-workflow TB-20 qualified |
| Artifact/comment/log confidentiality policy | NO_CONTROL_IDENTIFIED | Local projections/forensics patterns exist; no common classification/retention/audience gate |
| Package private surface exclusion | STRONG_DETERMINISTIC_CONTROL | E18 exports/files exclude #22/#23 physically; supported public RTI/triage remain exposed |
| Governance subject/policy/evidence revalidation | PARTIAL_DETERMINISTIC_CONTROL | E17 useful commit/evidence guards; adapters and human identity authentication remain caller responsibilities |
| Shared service cache / MEM/RAG tenant enforcement | FUTURE_ONLY | No current persistent memory/retrieval service found; future constraints below |

## 23. Gap / finding register

Exactly two new findings are recorded. Both concern a specific triage boundary
not separately recorded in the predecessor catalogs. They refine AT-05/AT-12 and
PI-14 rather than duplicating general unanchored identity or injected-content
risks. Neither is a demonstrated external attacker exploit or actual exfiltration.
There are zero new HIGH/CRITICAL findings and zero new DX findings. Existing
publishing/root/host/credential gaps remain under their predecessor IDs.

### XI-01 — Persisted triage context is not bound to invocation profile

| Field | Record |
|---|---|
| Status / evidence | OPEN_RESEARCH; CURRENT / DIRECTLY OBSERVED control-flow gap; SUPPORTED INFERENCE confidentiality/analysis impact |
| Actor / precondition | Trusted public API consumer/operator, or actor controlling the selected root's reports/ai/context.json; non-empty failedTests, valid profile/root, and a configured real provider for remote disclosure |
| Entry point / surface | Supported `analyzeFailure.main({projectProfile,repositoryRoot,...})`; tracked Targomo/Project B wrappers call this core; no multi-tenant routing service found |
| Boundary / asset | Persisted context project/repository/run → invocation profile/guidance/provider key; A source/failure evidence and B analysis authority |
| Current control | Profile/root validators; source collector stamps IDs; optional knowledge config must equal supplied profile; report result/schema/policy controls |
| Gap | main parses context but does not compare context.metadata.projectId/repository/run/commit against supplied profile/root/invocation. buildFailureReport uses profile for system guidance while history/knowledge/report provenance use context metadata |
| Reachability | C E02 readContext/main/buildFailureReport/runProviderAnalysis and E05 computeRelevantKnowledge. Supplying B profile and B-valid knowledge config does not independently authenticate A-labelled context; optional knowledge config absence also permits core-only path |
| Impact | I: A evidence can be sent with B-selected account/key and paired with B guidance, producing contaminated report/provenance. U: sensitive input presence, token-account ownership, successful unauthorized disclosure |
| Likelihood basis | Requires copied/stale/caller-controlled local input or changed producer; tracked normal CI builds fresh same-run inputs. No anonymous network entrypoint or automatic project service currently present |
| Risk / severity rationale | MEDIUM research concern, conditional. Supported package path and remote evidence transmission are material; local input control and no observed unauthorized disclosure rule out an unqualified HIGH/CRITICAL claim |
| Related / verification | AT-05/12/16, PI-14, TB-04/09; VR4-01/08/11/16 |
| Future control owner | PO selects canonical identity; future target/orchestrator and triage boundary owner implement separately authorized binding |
| Release relevance | UNKNOWN_OWNER_DISPOSITION_REQUIRED; exposed installed consumer surface, normal CI narrowness does not decide controlled-release policy |
| Remediation status | NOT IMPLEMENTED |

### XI-02 — Ineligible separate history does not clear embedded context history

| Field | Record |
|---|---|
| Status / evidence | OPEN_RESEARCH; CURRENT / DIRECTLY OBSERVED prompt-path gap; SUPPORTED INFERENCE contamination/disclosure impact |
| Actor / precondition | Caller/local file producer can provide context.history; at least one failure; separate readHistory returns null (absent, unavailable, malformed, project/framework-ineligible or invalid counters) |
| Entry point / surface | Public analyzer main through private buildFailureReport; buildUserPrompt consumes context.history; no independent remote history-import endpoint |
| Boundary / asset | Replayed embedded history/free text → model-visible history despite separate history eligibility/projection; history from A or excess data |
| Current control | readHistory rejects separate-file mismatches and projects four counters; ordinary eligible file overwrites context.history; no direct credential field is intentionally added |
| Gap | `if (history) context.history = history` leaves pre-existing context.history unchanged when history is null; buildUserPrompt uses `context.history || null` without independently projecting/gating that value |
| Reachability | C E02 buildFailureReport and qa-agent-prompt buildUserPrompt. Valid separately loaded history prevents this particular fallback by replacing the field. Normal collector workflow does not establish an attacker-provided embedded field; copied/external report remains required |
| Impact | I: wrong-project or arbitrary nested history can influence analysis or be disclosed in prompt; report's returned history can be null while the prompt saw embedded history. U: actual sensitive contents or successful remote disclosure |
| Likelihood basis | Stale/copied/caller-writable JSON, not a demonstrated fresh-CI exploit; no schema gate sanitizes the surviving embedded field |
| Risk / severity rationale | MEDIUM research concern, conditional. A confidentiality-relevant fallback bypasses an existing deterministic minimization gate on a supported analyzer path, with local input-control precondition |
| Related / verification | AT-05/12, PI-14, TB-04; VR4-08/09/10/11 |
| Future control owner | Triage history/prompt boundary owner after PO scope/disposition; AISEC-5 tests must distinguish absent history from embedded replay |
| Release relevance | UNKNOWN_OWNER_DISPOSITION_REQUIRED; not an owner-approved deferral |
| Remediation status | NOT IMPLEMENTED |

Architectural/unknown observations are not additional confirmed findings:
unspecified AI/history redirect behavior (TB-15/16, VR4-17); RTI/#22 provenance
projection (AT-05, VR4-06); wrong publication target (TB-05); root replay
(TB-02/04); raw record versus C7-only redaction (PI-04/TB-14); artifact/log/comment
audiences (AT-12/13/TB-07); and process authority (TB-12/14). No current
cross-project cache leak, shared tenant database, or live secret disclosure was
established.

## 24. Existing AT / PI / TB traceability

All 51 predecessor scenario IDs were considered; indirect relationships are
included rather than assuming only obviously named exfiltration records matter.
In every row: **rating change NO; closure NO; remediation by AISEC-4 NO**.
The owner column names the future analysis/control owner, not reassigned finding
authority. Evidence column means baseline refinement, not new exploit execution.

### AISEC-1 records

Owner artifact for every AT row: agentic-threat-model-v1.md, AISEC-1.

| ID | Relationship / AISEC-4 refinement | Baseline evidence | Future owner |
|---|---|---|---|
| AT-01 | Requirement text can contain sensitive values as well as instructions; authorize source before downstream model/publish | E06/E08/E10, DE-04/05/06 | RTI/source host; AISEC-5/7 |
| AT-02 | Selected repository/SUT text can originate outside intended project; path selection not semantic DLP | E02/E11/E15, C1/C5 | Evidence/target owner |
| AT-03 | Generated/output/report re-entry carries confidentiality and stale-origin risks | E02/E13/E14, XI-02 | Triage/regeneration owner |
| AT-04 | Fixed Azure host does not authorize source-to-destination project mapping | E07, XP-03 | Publishing host/PO |
| AT-05 | Different profile/root/source/history identity planes; XI-01/02 supply specific triage gaps | E01/E02/E04/E06 | PO canonical identity / target host |
| AT-06 | Provider response validation authenticates neither source ownership nor executable adapter | E03/E06/E09 | Provider integration owner |
| AT-07 | Canonical review content binding does not authenticate human approval; SECURITY 28 remains | E12/SECURITY 28 | Review host/PO; AISEC-6/7 |
| AT-08 | Ambiguous create outcome/replay can duplicate durable data exposure | E07 no-write-retry/short circuit | Publishing/audit owner |
| AT-09 | Dependencies/actions/tools add executable and network domains; offline fixtures do not audit them | E14/E16/E18 | Supply chain / full audit |
| AT-10 | Future poisoned memory may promote generated/sensitive data; no current memory promotion | E05, F section 28 | MEM/LEARN later |
| AT-11 | Future shared memory requires authorization hard filter before relevance | E05 current static scopes; F | MEM/RAG later |
| AT-12 | C1–C7 projections differ from artifact/log/comment privacy; allowed free text may carry sensitive data | E02/E10/E11/E13/E14, DE tables | Data policy/PO / AISEC-5 |
| AT-13 | Header-only construction and safe summaries reduce intentional secret logging; raw output/forensics remain separate | E03/E13/E16 | Logging/artifact owner |
| AT-14 | This research/validator output is not independent security/release certification | E17 normative governance | PM/independent reviewer |
| AT-15 | Project-scope policy must be trusted host authority; model/prose/fixtures cannot amend it | E17/SECURITY/governance contract | Governance/PO |
| AT-16 | Legitimate credential/tool authority may be used for wrong data/root/destination | E01/E03/E07/E13 | Orchestrator/AISEC-6 |

### AISEC-2 records

Owner artifact for every PI row: prompt-indirect-injection-study-v1.md, AISEC-2.

| ID | Relationship / AISEC-4 refinement | Baseline evidence | Future owner |
|---|---|---|---|
| PI-01 | Requirement content crosses source → #22/publish domains; sensitive text selection unresolved | E06/E08/E10 | Injection owner + source host |
| PI-02 | No intentionally model-visible credential config channel; does not imply all evidence secret-free | E03/C1–C7 | AISEC-5 canary/prompt owner |
| PI-03 | Allowed repository content may still carry unrelated project/confidential text | E02/E11/C5/C6 | Evidence host |
| PI-04 | Execution stdout/stderr raw record versus redacted regeneration COPY; diagnostics logs separate | E13/E16 | Execution/regeneration owner |
| PI-05 | Remote provider data normalized structurally, not authenticated to target business project | E03/E06/E09 | Provider/source host |
| PI-06 | Generated results/evidence can quote source into report/comment or later prompts | E02/E13/E14 | Re-entry boundary owner |
| PI-07 | Proposal file scope and root containment do not establish project ownership | E12, XP-01 | Apply host |
| PI-08 | Reviewer persuasion may also cause authorization of wrong root/audience; no human auth added | E12/SECURITY 28 | Review host/AISEC-6 |
| PI-09 | Governance prose remains non-authoritative; self-declared labels/digests are not project authorization | E17/SECURITY | Governance host |
| PI-10 | Protected-path checks are distinct from root/project correctness and OS normalization | E12/TB-10/11 | Apply/full audit |
| PI-11 | Fixed launch still gives loaded code host resource access; no OS isolation | E13 | Execution/AISEC-6/7 |
| PI-12 | Publishing host pinning/escaping does not decide destination-project correctness | E07 | Publishing host |
| PI-13 | Pattern redaction does not prove encoded/unlabelled secret removal; no new injection experiment | E13 C7 | Injection owner/AISEC-7 |
| PI-14 | Current copied-context/history paths differ from future memory contamination; XI-01/02 refine current triage | E02/E04/E05 | Triage now; MEM/RAG later |
| PI-15 | No persistent learned data implemented; future promotion needs provenance and reviewed authorization | E05/E18, F | LEARN/MEM later |

### AISEC-3 records

Owner artifact for every TB row: tool-privilege-credential-boundary-analysis-v1.md,
AISEC-3. Existing severity values are deliberately not recomputed here.

| ID | Relationship / AISEC-4 refinement | Baseline evidence | Future owner |
|---|---|---|---|
| TB-01 | Forged self-declared approval can authorize writes/launch; canonical package change does not authenticate actor | E12/SECURITY 28 | Review host/PO |
| TB-02 | Equivalent checkout replay crosses filesystem project/root ownership despite digests | E12/E13, XP-01/04/05 | Apply/execute host |
| TB-03 | Restored-base replay can repeat disclosure/side effects; no durable nonce store | E12 | Apply host |
| TB-04 | Unanchored project strings cannot join source/root/profile; XI-01/02 are specific new triage paths | E01/E02/E06/E10–E13 | PO identity / target host |
| TB-05 | Legitimate credential writes A content to B destination when caller selects B; vendor equality is insufficient | E07 | Publishing host |
| TB-06 | Escaped attacker text still becomes durable remote content; confidentiality independent of HTML escaping | E07 | Publishing/injection owner |
| TB-07 | PR comment field/total bounds do not prevent disclosure of model-quoted source; audience U | E14 | Comment/data policy owner |
| TB-08 | Marker-only first-page matching; another-author update/pagination/rendering consequences U; retain N18/RP35 | E14 | GitHub integration/full audit |
| TB-09 | Valid root chosen by caller can be wrong project; current private callable versus future orchestrator separated | E01/E12/E13 | Trusted host/orchestrator |
| TB-10 | Windows normalization/ADS evidence remains predecessor/management-owned; no rating or supported-platform assumption added | E12, #199 planning | Apply/full audit/PO |
| TB-11 | Path topology controls remain temporally bounded, no handle-based complete race elimination | E12 | Apply/full audit |
| TB-12 | Approved generated code after launch runs under OS principal; cwd not confinement | E13, XP-10 | Execution/AISEC-6 |
| TB-13 | Fixed argv/shell false protects launch syntax, not executed program behavior | E13 | Execution/AISEC-7 |
| TB-14 | Filtering env names does not stop file-based credential/sibling-project reads | E13 | Execution/data policy owner |
| TB-15 | Env GitHub API host and caller Jira site can misbind credential use; same-host project scope separate | E04/E06 | Trusted config/credential host |
| TB-16 | AI/source/destination/custom adapters are executable dependencies in-process; no tenant sandbox | E03/E06/E07/E09 | Provider/supply chain owner |
| TB-17 | CI spec execution has workflow-declared narrower authority; runner/artifact confidentiality remains deployment-sensitive | E14/E15/E16 | CI/demo environment/full audit |
| TB-18 | Compound persuasion + forged approval can cross root/project boundaries; no new closure | E12/SECURITY 28 | Review host/AISEC-6/7 |
| TB-19 | CREATE_ONLY no-write-retry limits ambiguity; manual reinvocation can repeat publication, no durable ledger | E07 | Publishing/audit owner |
| TB-20 | Same-repo edited-workflow secret reach retains TB20-WF-INFERENCE, settings-date and drift qualifications | E14; predecessor dated settings only | CI/governance/PO |

## 25. Security invariants

Sixteen invariants are design constraints. Enforcement states apply to baseline
implementation only and must not be read as newly adopted product policy.

| ID | Invariant | Current enforcement state | Evidence / missing authority | Verification |
|---|---|---|---|---|
| DXI-01 | A data must not be sent under B authority without explicit authorized mapping | NOT_ENFORCED | XI-01, source/destination/provider identity planes not joined | VR4-01/06/07/08 |
| DXI-02 | A artifacts must not authorize B writes/execution merely through consistent labels/content | PARTIALLY_ENFORCED | E12/E13 equality/digests; no authenticated root join | VR4-02/03/04/05 |
| DXI-03 | Destination credential validity must not establish correct target project by itself | NOT_ENFORCED | E07 trusts constructor selection; correct mapping PO/host unresolved | VR4-07/18 |
| DXI-04 | Authenticated project scope must survive every read/model/review/apply/execute/publish transition | NOT_ENFORCED | No canonical authenticated scope today; RTI projection intentionally loses source detail | VR4-06/15/16 |
| DXI-05 | Provider prompts receive only task-selected allowed fields and evidence | PARTIALLY_ENFORCED | C1–C7 selection; C1 forwarded containers and all free-text content not universal DLP | VR4-09 |
| DXI-06 | Secret values must not become model-visible | PARTIALLY_ENFORCED | Credential channels excluded; allowed source/error/output text may contain values | VR4-10 |
| DXI-07 | Sensitive execution output must be sanitized before regeneration model exposure | PARTIALLY_ENFORCED | C7 pattern redaction before prompt copy; unknown formats/data categories not covered | VR4-10/12 |
| DXI-08 | Persisted reports must not silently acquire trust for another project/run | NOT_ENFORCED | XI-01/02 and copied report/comment paths | VR4-08/11 |
| DXI-09 | Caller label/digest must not be represented as authenticated identity without independent proof | PARTIALLY_ENFORCED | SECURITY trust disclaimers; executable APIs still rely on trusted caller labels | VR4-01/03/16 |
| DXI-10 | Launched code must not be described as project-isolated while host authority is broader | CURRENTLY_ENFORCED | SECURITY/#23G explicitly disclaim OS sandbox; technical confinement itself absent | VR4-13/14 |
| DXI-11 | Credentialed source/destination request target must be trusted before request; redirects must not change it silently | PARTIALLY_ENFORCED | Jira/Azure manual rejection; AI/history explicit redirect policy absent, configurable history host | VR4-17 |
| DXI-12 | Artifact/log/comment privacy must be assessed separately from prompt privacy | PARTIALLY_ENFORCED | SECURITY separates artifacts; no common audience/classification/retention gate | VR4-12/20 |
| DXI-13 | Regeneration must retain exact execution/artifact chain, bounded attempt and fresh review | CURRENTLY_ENFORCED | E13 exact ID/digest/status/category/attempt gates, no auto apply | VR4-05/09 |
| DXI-14 | Shared clients/caches must not implicitly reuse another project's config/evidence | NOT_ENFORCED | Process config/provider reuse caller-owned; no current multi-tenant service to enforce a join | VR4-16 |
| DXI-15 | Future MEM/RAG must hard-filter authenticated project/trust scope before similarity | FUTURE_ONLY | Current static knowledge scope is precedent, not persistent retrieval implementation | VR4-19 |
| DXI-16 | Future learning/evaluation must preserve provenance and prohibit default promotion of model outputs | FUTURE_ONLY | Offline fixtures and no current learning/promotion service | VR4-19 |

## 26. Verification requirements

Twenty requirements for separately authorized executable work. None were
implemented/run as hostile security tests in this mission. Synthetic fixtures,
fake transports, explicit approved platform verification, and isolated test hosts
must be chosen by the later owner; real secrets are not test inputs.

| ID | Future executable requirement / decisive observation | Owner handoff |
|---|---|---|
| VR4-01 | Supply valid B profile with A context/model labels and vice versa; assert selected trusted identity rejects mismatch before model/write; distinguish absence/malformed/whitespace IDs | AISEC-5 triage/identity |
| VR4-02 | Use two synthetic roots with identical relevant files but different authorized project/checkout identity; wrong root must not gain apply/execute authority; missing root stays rejected | AISEC-5/7 apply/execute |
| VR4-03 | Copy approval package/record between roots/projects; test content binding separately from authenticated reviewer and root binding, including reconstructed presentation | AISEC-5/7 review; SECURITY 28 guard |
| VR4-04 | Copy/relabel GeneratedChangeSet and plan/context independently; verify cross-model expected IDs/digests and future authenticated-scope refusal before any write | AISEC-5/7 proposal/apply |
| VR4-05 | Replay foreign/stale execution/apply/regeneration chain; test ID/digest mismatches, same-content different-root case, infra category, attempt limit, CREATE origin, current MODIFY afterDigest | AISEC-5/7 regeneration |
| VR4-06 | Reuse A file/Jira/Azure/provider for B task; fake cross-project returned records and colliding provider IDs; prove host authorized mapping and rejection before model projection | AISEC-5 source/architecture |
| VR4-07 | Route A design to B destination with valid synthetic credential; verify approved cross-vendor mapping allowed and unapproved project mapping rejected before POST | AISEC-5/7 publication |
| VR4-08 | Mismatch context/history CI repo/project/framework/run metadata; include env overriding root Git identity and copied aggregate directories; observe no unintended request/comment | AISEC-5 triage/CI |
| VR4-09 | Capture C1–C7 payloads with fake provider. Exact positive field sets, excluded nested extras, no wholesale errors/previous response, referenced C4 requirements only, C5 script names not commands; embedded history null/ineligible path separately covered | AISEC-5 prompt owners |
| VR4-10 | Use synthetic canaries in keys, source literals, errors/stacks, nested history, stdout/stderr, quoted model output and encoded/unlabelled forms; record which channels reject/redact/pass, never send to real service | AISEC-5/7 confidentiality |
| VR4-11 | Replay stale/wrong-project context/history/report/artifact under valid root; require explicit authenticated import or refusal, test fresh same-run path stays functional | AISEC-5/7 artifact import |
| VR4-12 | Compare raw record/context/report/comment/log/upload payloads; verify sanitization point before each approved boundary rather than infer it from prompt copy | AISEC-5 artifact/log owners |
| VR4-13 | Assess a disposable demonstration runner: actual env, permissions, credential files, cache/home paths, artifact audience, outbound policy and descendant lifetime; no host-real-secret probing | AISEC-5/6 demo environment |
| VR4-14 | On an explicitly isolated synthetic host, approved Node-capable test attempts parent/sibling reads and controlled network access; demonstrate actual confinement or document permitted host authority | AISEC-6 decides, AISEC-7 hostile tests |
| VR4-15 | Move target root/checkout/revision or replace path topology after review/apply; distinguish content, root identity, freshness and race controls; fail before side effects where promised | AISEC-5/7 apply; full audit |
| VR4-16 | Sequential/concurrent A/B invocations in same process with different profiles/roots/provider instances and import-time config; prove no unintended mutable state/cache reuse | AISEC-5 host integration |
| VR4-17 | Fake redirects for AI/history/Jira/Azure; observe effective header/host behavior with supported runtime, wrong initial host rejection and timeout/retry limits. Vendor account/token/WIQL scope requires separate approved external verification | AISEC-5 credential/transport |
| VR4-18 | Publication ambiguity/manual reinvocation/partial results: no automatic retry after uncertain outcome; future mapping/idempotency decisions independently checked | AISEC-5 publication/audit |
| VR4-19 | Once authorized future MEM/RAG/LEARN exists, cross-project namespace/query/cache/promotion tests enforce scope before relevance and preserve training/evaluation separation; current governance adapter/writer tests remain subject-bound | Future owners / AISEC-7 |
| VR4-20 | Comment target must match authenticated report/invocation scope; test marker/pagination/author and hostile quoted output with fake client; live rendering/update-right conclusions require separately authorized verification | AISEC-5/7 GitHub; N18 owner |

## 27. Controlled Release relevance

[ROADMAP](../ROADMAP.md), [SECURITY](../SECURITY.md),
[PROVIDERS](../PROVIDERS.md), [PUBLISHING](../PUBLISHING.md),
[package surface](package-surface-v2.md), and
[governance process](governance-process-v3.md) remain authoritative for their
domains. Management [#199](https://github.com/TarasovArtem/qa-ai-agent/issues/199)
/ PM-P0-02 was read as planning context only. Proposed deferrals, dependency
matrix/RP27/F19 sandbox timing, N17 public API TOCTOU and N18 comment follow-ups
are not approvals or changes to canonical evidence. No broad vendor/web study
or live security-settings verification was performed.

Six potential blocker records are tracked below. Counting them does not decide
that six release blockers exist. None receives an invented PO acceptance or
deferral. New XI findings are supported public-surface concerns with local input
preconditions; private #23 enablement has stronger existing contractual gates.

| Record | Research release category | Evidence / owner decision needed |
|---|---|---|
| XI-01 | UNKNOWN_OWNER_DISPOSITION_REQUIRED | Installed analyzer exposes copied-context identity gap. PO must decide controlled consumer input/provenance contract and required guard |
| XI-02 | UNKNOWN_OWNER_DISPOSITION_REQUIRED | Installed analyzer can forward unprojected embedded history. Fresh CI precondition narrowness does not approve deferral |
| AT-07 / TB-01 | BLOCKS_ONLY_IF_CAPABILITY_ENABLED | Existing SECURITY 28 independently forbids supported presentation/#23 operational enablement until canonical renderer/binding and AT-07 work satisfy guard; no new rating/closure |
| TB-02 / TB-04 | BLOCKS_ONLY_IF_CAPABILITY_ENABLED | Root/project binding necessary if private apply/execute becomes a supported pilot/service; installed private capability currently physically absent |
| TB-05 | CAN_BE_CONDITIONALLY_DEFERRED_PENDING_OWNER | Public publishing already relies on trusted constructor/caller mapping; PO must affirm controlled mapping responsibility or require product gate; no deferral approved here |
| TB-12 / TB-14 | BLOCKS_ONLY_IF_CAPABILITY_ENABLED | Generated-code launch needs actual demo environment assessment and explicit isolation decision. Full sandbox timing may be planned later; narrow demo assessment is not thereby waived |

Artifact/log/comment classification and TB-15/17/20 deployment conditions also
require owner treatment before sensitive consumers/expanded autonomy; they are
not newly counted confirmed findings. Full multi-tenant persistent retrieval is
FULL_AUTONOMY_ONLY/FUTURE scope; independent review and lifecycle sequence are
GOVERNANCE_ONLY. No new unconditional `BLOCKS_CURRENT_CONTROLLED_RELEASE`
determination is asserted without owner scope/disposition. UNKNOWN is not PASS.

## 28. Future MEM / RAG / LEARN constraints

**FUTURE CONSTRAINT** in every item; no subsystem design or implementation is
authorized here. Current curated knowledge is not persistent agent memory.

- Authenticate project/trust scope at a host boundary and preserve namespace,
  source/version/content provenance and data classification through persistence.
- Deny cross-project retrieval by default. Apply hard authorization filters
  before similarity/relevance, not a prompt instruction or final display filter.
- Do not promote model/provider output, execution stdout, copied reports, or
  generated review evidence into trusted memory automatically.
- Separate cache namespaces/configuration/credentials by authenticated scope;
  any reviewed cross-project transfer must be an explicit auditable seam.
- Keep evaluation/training fixtures distinct from live project knowledge and
  approval evidence; do not let successful scoring authenticate provenance.
- Scope deletion, retention, export, access and learning promotion decisions to
  owner-approved policy. Size limits and pseudonymous IDs do not declassify data.

## 29. Open questions

Twelve genuine unresolved questions. Answers require owner/design authority or
separately authorized verification; none is silently decided by this artifact.

| ID | Question | Decision / evidence owner |
|---|---|---|
| OQ4-01 | What canonical authenticated identity joins repository/checkout, project profile, user/account and provider/destination scope? | PO/architecture/trusted host |
| OQ4-02 | Is ProjectProfile.id an operator label only, or will a host validate it against a repository/tenant registry; who owns that registry? | PO/target host |
| OQ4-03 | What authorizes a Jira JQL/Azure WIQL/file source to supply this target's requirements, including intentional multiple sources? | Source host/PO |
| OQ4-04 | What explicit mapping authorizes source requirements/designs to destination org/project while preserving cross-vendor use? | Publishing host/PO |
| OQ4-05 | Must prompts include provenance tokens, and what host-verifiable scope remains outside the model when projection omits source metadata? | Architecture/AISEC-6 |
| OQ4-06 | What filesystem/network/process isolation is required for controlled demonstrations versus supported generated-code execution and later autonomy? | PO/execution/AISEC-6 |
| OQ4-07 | Which source/error/output/image data categories may enter providers, logs, artifacts and comments; what audience/retention is acceptable? | PO/data owner/CI |
| OQ4-08 | Which XI/existing gaps block Controlled Release v1.0, and what exact limited-scope conditions would permit any deferral? | PO/PM; independent review |
| OQ4-09 | Which future adapter/orchestrator authenticates scope, root movement/freshness and human approval rather than trusting fields/digests? | Architecture/review host |
| OQ4-10 | What are effective AI/token account scopes, redirect header behavior, remote WIQL/JQL project semantics and GitHub audiences/settings today? | Authorized external verifier; U here |
| OQ4-11 | What replay age/import policy binds context/history/report/approval/execution data to a project/run/checkout without exposing unnecessary paths? | Triage/apply/audit host |
| OQ4-12 | Which exact requirements become AISEC-5 coverage, AISEC-6 architecture decisions and AISEC-7 hostile tests, and who disposes N17/N18/N03 alongside them? | PM/PO/later phase owners |

## 30. Non-goals

No fixes, test implementation, security experiments, release approval, defect
closure, severity revision, lifecycle/status synchronization, public API/package
change, telemetry system, external data policy, tenant service, sandbox,
provenance-token schema, publishing allowlist, replay ledger, or MEM/RAG/LEARN
implementation. No PR, merge, issue closure, or external research probe is
authorized by this artifact. Current intentional RTI cross-vendor behavior and
documented stack-evidence contract are not redesigned incidentally.

## 31. Assumptions / evidence limitations

Findings describe this exact tracked baseline. Source-confirmed branches were
not exercised against real services or malicious code. Actual sensitive data,
credential privileges, repository visibility, artifact/log access, vendor
retention, effective fetch redirect behavior, deployment concurrency, OS
filesystem/network policies and server authorization are UNKNOWN.

Only ref/management GitHub reads were made during research. Existing predecessor
live findings remain dated/qualified; broad GitHub/platform/security research
was not repeated. Tracked tests/fixtures demonstrate intended code contracts,
not successful unauthorized disclosure or current external-platform behavior.
No tracked production #23F/#23G/#23H caller or shared multi-tenant memory/cache
was found by call-site and state searches; this is a tracked-repository scope
statement, not proof that no external consumer ever invokes private source.

Package exclusions are actual exports/files configuration plus existing
package-surface proof contracts; no new npm install/pack/network experiment was
necessary for a one-file research change. The coverage appendix records targeted
inspection, not a claim that every line of every test or historical document was
independently audited. Markdown/reference checks establish document structure,
not security acceptance or factual independent review.

## 32. Handoff to AISEC-5 / AISEC-6 / AISEC-7

AISEC-5 receives the DE/XB inventory, XI-01/02 control-flow anchors and VR4-01
through VR4-20 as proposed future evidence requirements. It must preserve
synthetic/offline versus live platform distinctions and validate current guards
as well as gaps; a passing field/digest test does not authenticate a project.

AISEC-6 receives OQ4-01 through OQ4-09/11, authenticated identity joins,
source/destination mapping ownership, original-root/freshness/approval binding,
prompt versus artifact policy, and post-launch isolation. It must decide
architecture under PO authorization rather than derive policy from this report.

AISEC-7 receives XP-01 through XP-10 and the hostile portions of VR4. Future
tests need explicit isolated-host/fake-transport preconditions and must not use
real secrets or publish probes. Existing AT/PI/TB owners retain their findings.
Future MEM/RAG/LEARN owners receive only section 28's constraints after canonical
phase gates. Full strict audit receives vendor/platform UNKNOWNs, public RTI
element-level TOCTOU, Windows normalization/races, comment platform semantics,
deployment authority and supply-chain/runtime behavior.

## 33. Summary / disposition-required items

The repository minimizes many prompt fields, contains selected filesystem
operations, rejects certain identity/digest mismatches, pins or validates network
authorities, and separates CI jobs. It does not establish end-to-end authenticated
project ownership, report import authority, source-to-destination project mapping,
or post-launch OS isolation. Two specific supported triage paths (XI-01/02)
require owner disposition; no actual exfiltration is claimed.

Inventory counts: 20 DE surfaces; 16 XB boundaries; 10 XP scenarios; seven C1–C7
call profiles; two new MEDIUM conditional findings (C reachability, I impact);
16 DXI invariants; 20 future VR4 requirements; 12 OQ4 questions; six potential
blocker records in section 27. Existing AT/PI/TB closed NONE, re-rated NONE.
Remediation implemented NONE. MEM/RAG/LEARN implemented NO.

OWNER_DISPOSITION_REQUIRED: XI-01, XI-02; AT-07/TB-01 and SECURITY 28 guard;
TB-02/TB-04 root identity; TB-05 source/destination mapping; TB-12/TB-14 demo/
execution isolation; OQ4-01 through OQ4-12. TB-15/17/20 deployment credentials,
artifact audiences and planning N17/N18/N03 retain their existing owners. This
is a disposition queue, not a request to re-rate or reopen certified prior work.

Return control to PM. PM must independently verify the pushed HEAD/tree,
single-file scope and evidence, and evaluate the research. Separate PO
disposition/authorization is required before implementation/remediation. No PR
may be created without separate PM/PO authorization; Issue #211 remains open.

## 34. Source coverage appendix

The following materially relevant tracked files were inspected by full reads or
targeted function/configuration reads and call-site searches. Primary predecessor
research was read completely; large management/history contracts were read in
applicable sections. Listed anchors indicate what was actually investigated.
Paths below are repository-relative; Markdown links resolve from this document.

| Evidence key / domain | Covered files and anchors | Why relevant / material result |
|---|---|---|
| E01 identity / paths | [project-profile.js](../scripts/ai/project-profile.js), [repository-root.js](../scripts/ai/repository-root.js), [context-utils.js](../scripts/ai/context-utils.js); validators, real/lexical roots, safe read/write resolvers | Explicit selection and containment; no authenticated profile/root association |
| E02 triage | [collect-context.js](../scripts/ai/collect-context.js) metadata/relevant-file policy and writes; [analyze-failure.js](../scripts/ai/analyze-failure.js) main/readContext/readHistory/computeRelevantKnowledge/buildFailureReport/runProviderAnalysis/error summaries; [qa-agent-prompt.js](../scripts/ai/qa-agent-prompt.js) complete field projections/system boundary; [aggregate-browser-context.js](../scripts/ai/aggregate-browser-context.js) safe JSON reads/identity/main; [correlation-projection.js](../scripts/ai/correlation-projection.js), [agent-policy.js](../scripts/ai/agent-policy.js) | XI-01/02; container projection, framework checks, output policy are distinct |
| E03 AI providers/config | [config.js](../scripts/ai/config.js), [providers/index.js](../scripts/ai/providers/index.js), [groq-provider.js](../scripts/ai/providers/groq-provider.js), [gemini-provider.js](../scripts/ai/providers/gemini-provider.js), [mock-provider.js](../scripts/ai/providers/mock-provider.js), [provider-contract.js](../scripts/ai/providers/provider-contract.js), [provider-error.js](../scripts/ai/providers/provider-error.js) | Endpoint/auth/instance/transport/error and call interface; no project binding; redirect U |
| E04 GitHub history | [collect-history.js](../scripts/ai/collect-history.js) env selectors/fetchJson/aggregate/main; analyzer history classifiers/eligibility/counter reduction in E02 | Host/repository selection and credential use; label guards and XI-02 limit |
| E05 knowledge | [loader.js](../scripts/ai/knowledge/loader.js), [schema.js](../scripts/ai/knowledge/schema.js), [selector.js](../scripts/ai/knowledge/selector.js), [project-knowledge-config.js](../scripts/ai/project-knowledge-config.js); analyzer config/profile checks | Local curated sources, containment, hard eligibility, invocation-local maps; no memory/cache service |
| E06 concrete requirements sources | [jira-requirements-provider.js](../scripts/ai/providers/jira-requirements-provider.js), [azure-devops-requirements-provider.js](../scripts/ai/providers/azure-devops-requirements-provider.js); config, auth/fetch/redirect/selected fields, normalization/instance state | Trusted source selectors, private config, retained provenance; actual project membership U |
| E07 publishing | [test-design-publishing.js](../scripts/ai/test-design-publishing.js) design snapshots/result validation/publish call; [azure-devops-test-case-destination.js](../scripts/ai/destinations/azure-devops-test-case-destination.js) target config/mapping/write/response/short circuit | Fixed host and CREATE_ONLY semantics; no source-to-destination authorization |
| E08 file/RTI artifact | [requirements-file.js](../scripts/ai/requirements-file.js), [requirement-artifact.js](../scripts/ai/requirement-artifact.js); explicit file schema/path/read/source and normalized identity | Root-contained acquisition, no projectId; source is descriptive provenance |
| E09 generic RTI | [requirements-source-provider.js](../scripts/ai/requirements-source-provider.js), [requirement-quality.js](../scripts/ai/requirement-quality.js), [test-design.js](../scripts/ai/test-design.js), [requirement-traceability.js](../scripts/ai/requirement-traceability.js); provider contract, normalized validation/design/reference path | Supported deterministic chain, trusted executable provider; no profile authorization |
| E10 private #22 | [evidence-ingestion.js](../scripts/ai/generative-test-design/evidence-ingestion.js), [requirement-model-generator.js](../scripts/ai/generative-test-design/requirement-model-generator.js), [test-design-prompt.js](../scripts/ai/generative-test-design/test-design-prompt.js), [test-case-model-generator.js](../scripts/ai/generative-test-design/test-case-model-generator.js), [test-case-model-prompt.js](../scripts/ai/generative-test-design/test-case-model-prompt.js), [automation-candidate-generator.js](../scripts/ai/generative-test-design/automation-candidate-generator.js), [automation-candidate-prompt.js](../scripts/ai/generative-test-design/automation-candidate-prompt.js); C2–C4 projections/call gates; generation requirement-model/test-case-model/automation-candidate/cross-model-validation contracts; test-design-review-package/review-record/canonical snapshot seams | Lossy explicit RTI projection; project labels/references; no supported installed generative entrypoint |
| E11 private #23 read/model | [automation-repository-context.js](../scripts/ai/test-automation/automation-repository-context.js), [automation-plan-generator.js](../scripts/ai/test-automation/automation-plan-generator.js), [automation-plan-prompt.js](../scripts/ai/test-automation/automation-plan-prompt.js), [generate-change-set.js](../scripts/ai/test-automation/generate-change-set.js), [generate-change-set-prompt.js](../scripts/ai/test-automation/generate-change-set-prompt.js), [generated-change-set.js](../scripts/ai/test-automation/generated-change-set.js); generation/automation-plan.js checks | Scope/read/projection/expected-ID paths; C5/C6 free text and root not in model context |
| E12 private #23 review/apply | [generated-change-set-review-package.js](../scripts/ai/test-automation/generated-change-set-review-package.js), [generated-change-set-review-record.js](../scripts/ai/test-automation/generated-change-set-review-record.js), [generated-change-set-review-canonical.js](../scripts/ai/test-automation/generated-change-set-review-canonical.js), [change-set-application.js](../scripts/ai/test-automation/change-set-application.js), [applied-change-set-record.js](../scripts/ai/test-automation/applied-change-set-record.js); canonical inputs/digests, N21 recomputation, apply/inspect/root/topology/write/rollback | Content binding strengthened; actor/root auth and replay/race gaps inherited |
| E13 private #23 execute/re-enter | [controlled-execution.js](../scripts/ai/test-automation/controlled-execution.js), [automation-execution-record.js](../scripts/ai/test-automation/automation-execution-record.js), [regenerate-change-set.js](../scripts/ai/test-automation/regenerate-change-set.js); launcher env/argv/revalidation/output bounds and C7 chain/redaction | No OS sandbox; raw output record versus sanitized prompt copy |
| E14 workflows / comments | [.github/workflows/cypress.yml](../.github/workflows/cypress.yml) permissions/events/job secret mapping/history/artifact/download/comment/forensics blocks; [dependency-review.yml](../.github/workflows/dependency-review.yml), [supply-chain-audit.yml](../.github/workflows/supply-chain-audit.yml); [format-pr-comment.js](../scripts/ai/format-pr-comment.js), [pr-comment-client.js](../scripts/ai/pr-comment-client.js) | Same-run CI flow, declaration-scoped credentials, artifact/comment confidentiality; platform U |
| E15 target/runtime/SUT | [cypress.config.js](../cypress.config.js), [playwright.config.js](../playwright.config.js), [smoke.spec.js](../playwright/tests/smoke.spec.js); cypress/e2e/tests/poi_data_requests.cy.js and pageObjects/navigation.js; [framework-runtime-config.js](../scripts/ai/framework-runtime-config.js), adapters/cypress-adapter.js and adapters/playwright-adapter.js; scripts/targets/targomo/{project-profile,repository-root,collect-context,collect-history,analyze-failure}.js and scripts/targets/project-b/{project-profile,framework-runtime-config,project-knowledge-config,collect-context,collect-history,analyze-failure}.js | Explicit production bootstrap and independent generic consumer roots; external SUT requests/report capture; no shared canonical RTI project |
| E16 diagnostics | [firefox-failure-forensics.sh](../scripts/diagnostics/firefox-failure-forensics.sh), [reset-cypress-runtime-outputs.sh](../scripts/diagnostics/reset-cypress-runtime-outputs.sh), [audit-drift-check.js](../scripts/diagnostics/audit-drift-check.js), [branch-inventory.js](../scripts/diagnostics/branch-inventory.js); reruns/output/privacy pass, npm audit invocation, explicit-root Git metadata | Pattern file removal after log emission; audit network/tool boundary and offline branch metadata |
| E17 governance | [index.js](../scripts/governance/index.js), [safety/process.js](../scripts/governance/safety/process.js), [safety/redaction.js](../scripts/governance/safety/redaction.js), [stages/1a/git-adapter.js](../scripts/governance/stages/1a/git-adapter.js), [stages/head-reader.js](../scripts/governance/stages/head-reader.js), [kernel/revalidation.js](../scripts/governance/kernel/revalidation.js), [stages/1f/cli.js](../scripts/governance/stages/1f/cli.js); [stages/1b/check.js](../scripts/governance/stages/1b/check.js), [check.test.js](../scripts/governance/stages/1b/check.test.js), [test-support-git.js](../scripts/governance/test-support-git.js) for offline Markdown/reference validation seam | Explicit-root bounded child/output evidence, trusted injected adapters/writer; validation is not human security approval |
| E18 package / evaluation / contracts | [package.json](../package.json), [.npmrc](../.npmrc), [scripts/ai/index.js](../scripts/ai/index.js), [package-surface-v2.md](package-surface-v2.md), [architecture-model-boundary-v2.md](architecture-model-boundary-v2.md); test/installation/package-surface.test.js boundary assertions; evaluation/evaluate.js through evaluate-v6.js and regression variants call/file/network searches, evaluate-v6.js/scoring-v6.js fixture-only #22F seam; three predecessor docs and SECURITY/PROVIDERS/PUBLISHING/governance-process-v3/ROADMAP applicable sections | Public triage/RTI plus four subpaths, private generative physical exclusion, offline fixtures; normative guards/lifecycle retained |

## 35. Validation boundary

Required local validation for this one-file artifact: existing offline governance
Markdown structure/local-link/anchor checker; repository-path coverage check;
unique local register IDs and stated counts; `git diff --check`; exact single-file
diff; one commit with sole required parent; fresh remote main/research refs at
baseline before normal fast-forward push; pushed branch SHA/tree identity and
clean working tree. Final mission report records actual results.

No runtime tests, installs, malicious execution or live vendor probes are needed
to validate this documentation-only change. Future VR4 requirements remain
unimplemented. Independent HEAVY review and PO disposition remain outstanding.
