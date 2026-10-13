# Controlled-v1 OD-06 execution contract v1 — blocked design record

Date: 2026-10-13 (Europe/Berlin).

Authority: `OD-CONTROLLED-V1-OD-06-EXECUTION-DESIGN — APPROVED`.

Mission result: **STOP — OWNER RUNNER-CONTAINMENT DISPOSITION REQUIRED**.

This document records repository discovery and the blocking design question.
It is **not a complete execution contract**, an OD-06 approval, an
implementation specification, a platform certification, or permission to
activate execution. No security-critical decision is delegated to a later
implementation agent. The mission stops before selecting a supported runner.

`execute` remains reserved and release-disabled; invocation returns exit 5.
Stage 4B remains **COMPLETE_ON_MAIN / POST-MERGE CERTIFIED**; reviewRecord/apply
remain release-enabled subject to their existing target opt-ins and gates.
Controlled Release remains **NOT APPROVED**. No ROADMAP completion state,
finding disposition, FUTURE guard, source, test, workflow or public API changes.

## 1. Certified baseline and preflight

| Fact | Verified value |
|---|---|
| Repository | `TarasovArtem/qa-ai-agent` |
| Fetched `origin/main` | `126d105841cf404c92752ae54bb616ed710d7f53` |
| Main tree | `24f513931ac44e3fb71afb2f750616be75e112ec` |
| Existing remote design branch | `design/controlled-v1-od06-execution`, initially exactly the certified main SHA |
| Local checkout before this document | Exactly that SHA; clean |
| Later main commit | None at both fetch checks before this document |
| Branch handling | Local tracking checkout of the existing remote branch; no remote recreation, retarget, rebase or reset |
| Competing engineering WIP | None found in open PR inventory or extant additional worktree changes |

WIP=1 assignment comes from the mission authority. The open PR inventory
contained dependency-update PRs #243/#250/#251/#252 and historical proof PR
#132; no competing engineering PR. The two extant additional worktrees were
clean; two other registered worktrees were already prunable/nonexistent.
This is an inventory observation, not proof that no other machine has work.

## 2. Repository-grounded discovery

### 2.1 Installed command, config and package

The actual parser in [args.js](../scripts/ai/cli/args.js) classifies `execute`
as `kind: "reserved"`, with owner decision `OD-06`. Its trailing arguments
are not interpreted, apart from help/JSON presentation. The reserved route in
[cli.js](../scripts/ai/cli/cli.js) refuses before root/config/run reads;
`execute --help` is help-only and exits 0. There is no execution handler.

[policy.js](../scripts/ai/cli/policy.js) freezes
`RELEASE_CAPABILITIES.execute.enabled = false`. Target
`capabilities.execute = true` is schema-valid but cannot override that gate.
[errors.js](../scripts/ai/cli/errors.js) already reserves 7/8/10; their values
must not change. Provider selection cannot enable execution.

[config-file.js](../scripts/ai/cli/config-file.js) reads bounded strict JSON
once, rejects duplicate keys/invalid UTF-8/BOM/symlink leaves, and returns a
deep-frozen snapshot. Schema v1 has a closed top-level set and closed boolean
capabilities. `framework` is the target config authority (`cypress` or
`playwright`), not a provider-generated runner choice.
[FrameworkRuntimeConfig](../scripts/ai/framework-runtime-config.js) describes
data-only layout/config/report paths, not executable/argv/shell templates.
The current generative live-context builder in
[run-artifacts.js](../scripts/ai/cli/run-artifacts.js) still inspects the
conventional root `cypress.config.js`/`playwright.config.js`; configurable
layout support must not be inferred from the existence of that data schema.

[package.json](../package.json) declares Node 22.x, one `qa-agent` bin, five
export keys, and no runtime dependencies. The root barrel
[index.js](../scripts/ai/index.js) has 19 exported names and no execution API.
[Package Surface v5](package-surface-v5.md) and
[package-inventory.js](../test/helpers/package-inventory.js) establish a
103-file package inventory. The legacy execution/record/regeneration modules
are explicitly excluded. Its Stage 4A disabled review/apply annotations are
historical; [Stage 4B evidence](controlled-v1-stage4b-activation.md) owns their
subsequent activation.

The existing external proof
[controlled-v1-stage3-external-proof.test.js](../test/installation/controlled-v1-stage3-external-proof.test.js)
uses a real tarball in an external temp repository, tests private-import
denial, and checks the installed closure. Its safe test-harness `shell:true`
npx invocation is not a production execution precedent. No installation
test or framework execution was run during this design-only inspection.

### 2.2 Legacy execution is present but is not the product runner

[controlled-execution.js](../scripts/ai/test-automation/controlled-execution.js)
defines `executeAppliedChangeSet`, `runBoundedProcess`, and a closed
Cypress/Playwright mapping. It is repository-only, not shipped or routed by
the installed CLI. Actual properties:

- Framework comes from a validated plan. Cwd is the resolved repository root.
- Executable is constructed under `node_modules/.bin`; Windows selects a
  `.cmd` shim. Construction does not establish canonical package ownership,
  entrypoint authenticity, or absence of substitution/symlinks.
- Cypress argv is `run --headless --browser chrome --spec <comma-joined
  targets>`. Playwright uses `test --config=playwright.config.js
  --project=chromium <anchored escaped absolute-path regexes>`.
- Direct targets are applied `cypress/e2e/**/*.cy.js`-shaped or
  `playwright/**/*.spec.js`-shaped files. Support/helper-only changes refuse;
  there is no entire-suite fallback. Cypress target paths use a positive
  character allowlist to exclude glob/extglob syntax.
- TSB-F03 strengthening is present: closed AppliedChangeSetRecord validation,
  one-to-one change-set binding, approved-content digests, and fresh applied
  filesystem revalidation precede spawn. This is not a Stage 4 CLI
  outcome/ledger/principal integration.
- `spawn` uses `shell:false`, ignored stdin and piped stdout/stderr. No
  provider command text, npm script or free-form shell string is used.
- Timeout defaults/maxes at 600000 ms. Output constants are 200000 bytes per
  stream. Whole chunks are accumulated before final truncation; this is not
  an exact pre-allocation byte cap and no full report/disk bound exists.
- Timeout calls `child.kill()` once. There is no process-group ownership,
  SIGKILL escalation, independent watchdog, parent-death containment,
  descendant-empty proof or guaranteed bounded wait for pipe closure.
- The copied environment allowlist includes ambient PATH/HOME/profile/temp
  and CI. AI/GitHub secrets are excluded by name construction. This does
  not stop executable target code reading host files or spawning processes.
- Spawn error becomes EXECUTION_ERROR; timeout becomes TIMED_OUT; zero exit
  becomes PASSED; other outcomes become TEST_FAILED, including null-code
  signal outcomes. That legacy mapping is insufficient to distinguish the
  product's test-failure and runtime-error contract.

[automation-execution-record.js](../scripts/ai/test-automation/automation-execution-record.js)
already defines AutomationExecutionRecord **v1**, with four statuses,
applied-record digest, framework, descriptive command label, raw bounded
text/truncation flags, process exit code, timestamps and an unkeyed digest.
It has no executionId/run/package/root/principal/platform/durability binding.
Output text is limited to 4000 characters per stream in that record, which
differs from the launcher's capture limits. The builder proves shape and
integrity, not that execution occurred. It cannot silently serve as the
future installed-product authority envelope.

Repository-wide non-test search also found the CLI stage-process launcher
and a separate governance safety process launcher. Neither supplies a trusted
OS containment supervisor for the execute boundary. Searches for exec/fork
also matched regular-expression `.exec` methods and comments; those are not
child-process launches. Provider AbortController timeouts bound HTTP calls,
not test-process trees. Existing framework result adapters are triage
consumers; no installed execute result-parser contract exists.

### 2.3 Stage 4 authority integration that must be preserved

[Approval/apply contract](controlled-v1-approval-apply-contract-v1.md) remains
governing. [stage4-run.js](../scripts/ai/cli/stage4-run.js) reloads manifest
and artifacts, rebuilds canonical packages, checks PPI-1, and constructs the
CRS-1/TAP-2 subject and project/product/root binding.
[review-record-v2.js](../scripts/ai/cli/review-record-v2.js) validates a closed
v2 envelope, rebuilding its v1 per-target decisions through a gate-free
builder. The principal comes from OS-local account attribution, never env.
It is not authenticated physical-human identity.

[stage4-state.js](../scripts/ai/cli/stage4-state.js) derives package state
from fresh run-root inventory, manifest review ledger, claims, records and
external apply attempt/outcome files. APPLIED, CONSUMED, REJECTED,
QUARANTINED and INCONSISTENT must not be confused with fresh approval.
Later decisions supersede earlier approvals before consumption. Approval
is valid for 24 hours and consumed by one durable apply attempt, regardless
of the result. Ambiguous apply evidence quarantines; it does not permit retry.

[apply.js](../scripts/ai/cli/apply.js) checks the same approving OS principal,
run/project/root/package/product binding and fresh interactive confirmation;
rechecks after interaction; reserves before canonical #23F; then durably
records AppliedChangeSetRecord and QaAgentApplyOutcome. Successful APPLIED
evidence is necessary, not sufficient, to authorize execution.

Canonical mutation remains
[change-set-application.js](../scripts/ai/test-automation/change-set-application.js)
`applyApprovedGeneratedChangeSet` (#23F). It consumes the #23E gate and
independently checks exactly one APPROVE per recomputed target, exact
operation/path/content, canonical package reconstruction and live filesystem
conditions. Execution must not call #23F again to obtain fresh authority.

[stage4-principal.js](../scripts/ai/cli/stage4-principal.js) currently permits
storage eligibility only on Linux with the enumerated ext4/XFS/Btrfs/F2FS
filesystem types and successful directory fsync. Windows is explicitly
unproven/refused; macOS storage eligibility also refuses. These facts do not
certify Linux execution containment. Root binding includes platform,
canonical real path and dev/inode: relocation/copy/restore is not portable
execution authorization. Stage 4's CI/TTY policy is a supported policy
refusal, not authenticated CI-origin detection.

## 3. Blocking platform/process decision

**Mission STOP condition 6 applies:** safe process-tree termination semantics
cannot currently be specified for a proposed supported OS using the discovered
runner contract. Consequently a supported OS/runner matrix is not selected
(related STOP conditions 1/2). This is not a finding reclassification or a
claim that Linux execution is technically impossible.

The mission assumes malicious test/config/dependency code can spawn children.
The discovered launcher's direct-child termination does not cover descendants.
A POSIX process group improves cooperative cleanup, but is not an immutable
boundary: descendants can form another session/group. A same-account
watchdog can be killed by target code. Parent SIGKILL/power loss cannot be
turned into a guaranteed synchronous durable outcome by Node signal handlers.
Persisting an attempt and quarantining unknown outcomes protects replay
authority; it does not terminate surviving code.

The [Node 22 child-process documentation](https://nodejs.org/download/release/latest-v22.x/docs/api/child_process.html)
describes detached groups/sessions and children surviving parent exit; its
subprocess kill API is not a complete descendant-containment primitive.
Using `.cmd` via a shell would violate this mission; it is not a Windows
solution. No new shell exception is proposed.

The [Linux cgroup v2 documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html)
provides a possible foundation: inherited membership, migration-permission
rules, cgroup-wide kill and population observation. It does not define QA
Agent's supervisor owner, trusted installation, delegation policy, launcher
handoff, controller survival or audit protocol. Kernel mechanism availability
does not prove a target-config or same-account-controlled supervisor is trusted.

### 3.1 Alternatives evaluated, not selected

| Alternative | Disposition and reason |
|---|---|
| Existing direct-child launcher | REFUSED as the complete OD-06 process contract; descendants and parent death remain uncontrolled |
| POSIX process-group kill plus same-account Node watchdog | REFUSED as a guaranteed hostile-descendant/parent-death boundary; may improve cooperative cleanup only |
| User-selected command, npm script or shell wrapper | REFUSED; arbitrary command contract/shell violates the mission |
| Ambient CI variables or runner labels as trust | REFUSED; cannot authenticate GitHub-hosted/self-hosted origin or authority |
| Linux externally supervised cgroup workload | DEFERRED for owner platform disposition; requires a separately trusted controller/provisioning contract, not a guessed daemon/cgroup path |
| Windows shim plus shell | REFUSED; no shell use or Windows guard closure authorized |
| New Windows native helper/job-object integration | DEFERRED; no repository identity/durability/installed-helper evidence |
| Docker/OCI execution installation model | REFUSED within the existing productization model; a new distribution/containment model needs separate owner disposition |

### 3.2 Owner disposition required to resume

Resolve **OP-06-01** before restarting this design lifecycle:

1. Authorize a precisely scoped Linux supervisor/provisioning extension to the
   current npm-installed product model, including controller ownership,
   trusted-code installation, workload account, migration permissions,
   parent-death/watchdog behavior and evidence responsibilities; or
2. Explicitly revise the mission's required termination assurance to permit
   best-effort cleanup with escaping/orphan processes as a named, accepted
   execution residual; or
3. Keep execution deferred and release-disabled.

These are owner choices, not selected policies. A resumed design must define
the complete selected mechanism and fail-closed eligibility contract; an
implementation agent must not make this decision. No privileged broker,
daemon, cgroup path, helper binary, container or new installation prerequisite
has been adopted by this stopped document.

## 4. Threat-model findings at STOP

Generated and target-owned tests/configs/dependencies are executable untrusted
code. `shell:false` constrains the product launcher; it cannot prohibit the
launched code itself from using `child_process` or host authority. No OS,
filesystem, network or generic secret-isolation claim is made.

| Threat | Repository finding and required boundary before resume completes |
|---|---|
| EX-01 arbitrary command injection | Preserve product-derived executable/closed argv/root cwd; provider text and validationPlan prose must never become commands |
| EX-02 shell injection | `shell:false` is mandatory; shell need triggers STOP, including Windows shims |
| EX-03 binary substitution | `.bin` path construction is insufficient; canonical package-owned target-local entrypoint and trusted Node/native-framework/browser resolution must be defined; no global/PATH/shim fallback |
| EX-04 framework config execution | Both framework configs execute JS/TS and can load plugins/setup/imports; exact spec selection does not bound everything they execute; no sandbox claim |
| EX-05 mutation after apply | Bind successful Stage 4 outcome, exact change set and all changed-file bytes; final pre-spawn recheck, refuse mismatch; import/config/dependency drift and TOCTOU need explicit treatment |
| EX-06 environment secrets | Current positive allowlist strips AI/GitHub credentials but inherits OS paths; provider/npm/CI/SUT credentials and home-file exposure need a new closed contract |
| EX-07 filesystem authority | Tests have launch-account access; byte/path checks and evidence containment do not isolate their filesystem writes or stop disk filling |
| EX-08 network authority | Framework/SUT and malicious-code networking remain host/target behavior; no offline/network-isolation guarantee exists for execute |
| EX-09 child processes | Blocking OP-06-01: descendant escape, stubborn children, parent death, kill escalation and trusted-controller survival |
| EX-10 resource exhaustion | Existing stdout/stderr limits do not bound all allocation, runtime completion, native report sizes or total disk writes; exact bounds depend on selected controller |
| EX-11 path identity | Preserve PPI-1 validation-only identity plus canonical containment, no symlink/hardlink substitution and root binding; no repairs of hostile paths |
| EX-12 CI abuse | All CI execution is DEFERRED here; approval/apply remain CI-refused independently; fork PRs/secrets/runner origin cannot be trusted from env |
| EX-13 local execution | DEFERRED pending controller disposition; TTY and same principal establish policy/account attribution, not human identity or safe process containment |
| EX-14 Windows execution | REFUSED for this stopped lifecycle; fail-closed Stage 4 constraints and FUTURE Windows guard preserved; no inference from Node API portability |

## 5. D06 decision completeness register

There is **no supported execution path** selected by this document. DEFERRED
means refused by the current product and outside any implementation mandate;
it does not mean a developer may pick a policy later. Owner-blocked entries
prevent a complete OD-06 contract. Compatible constraints below are retained
for a resumed design, not approved new operational defaults.

| ID | Disposition at STOP |
|---|---|
| D06-01 runner classes | Local workstation DEFERRED; GitHub-hosted Actions DEFERRED; self-hosted CI DEFERRED; generic server DEFERRED. No class certified; OP-06-01 blocks identity/eligibility selection |
| D06-02 OS | Linux DEFERRED pending containment contract; Windows REFUSED; macOS DEFERRED. No OS supported by this document |
| D06-03 local vs CI | Both DEFERRED; execute CI decision is separate from unchanged approval/apply prohibition |
| D06-04 framework | Cypress DEFERRED; Playwright DEFERRED. Future framework must equal validated target config, plan, package and applied evidence |
| D06-05 executable resolution | No new resolver selected; target-local canonical package ownership/no ambient fallback required; legacy `.bin` policy insufficient |
| D06-06 command construction | Mandatory product-derived closed executable/argv, root cwd, `shell:false`; full launch vector blocked by platform decision |
| D06-07 targets | No runnable model adopted; resume must preserve exact applied generated spec scope without entire-suite fallback, with config/import/setup breadth disclosed |
| D06-08 execution binding | Successful Stage 4 apply chain necessary, never sufficient; no new execution authority derivation selected |
| D06-09 replay | Not selected: no execute permitted. Apply remains SINGLE_APPLY_ATTEMPT; no inferred repeatable execute right |
| D06-10 concurrency | Not selected: no execute permitted. Atomic attempts, cross-run resource ownership, locks and crash recovery depend on selected controller |
| D06-11 environment | No new pass-through grammar/secret policy adopted; current launcher allowlist is discovery only |
| D06-12 cwd/root | No arbitrary cwd; future canonical root must equal bound apply root; relocation must not revive authority |
| D06-13 timeout | No new default adopted; legacy 600000 ms is not a certified finite tree timeout; exit 8 preserved |
| D06-14 termination | BLOCKED OP-06-01; no descendant, SIGINT/SIGTERM, parent-death, grace/escalation guarantee selected |
| D06-15 cancellation | BLOCKED by D06-14/D06-21; no impossible durable-outcome promise on SIGKILL/power loss |
| D06-16 output bounds | No new bounds adopted; current 200000-byte capture/4000-character record limits are insufficient as whole-evidence guarantees |
| D06-17 redaction | No generic secret detector claimed; raw target output can contain any secret; persistence policy requires completed environment/evidence design |
| D06-18 record | Existing repository-only AutomationExecutionRecord v1 unchanged; no v2 or production envelope specified/adopted at STOP |
| D06-19 status | Existing PASSED/TEST_FAILED/TIMED_OUT/EXECUTION_ERROR vocabulary preserved; no new status proposed |
| D06-20 exits | Existing 0/1/2/3/4/5/7/8/10 contract preserved; executed-case classification not completed; current execute remains exit 5 |
| D06-21 durability | BLOCKED by controller survival and atomic handoff; durable attempt before code plus fail-closed unknown recovery required, but full protocol not selected |
| D06-22 storage | Must stay in canonical existing output/run structure, never arbitrary path; no execute subdirectory/schema added because current root inventory rejects unknown directories |
| D06-23 reports | Not selected; unreliable text parsing forbidden; legacy nonzero-exit classification is insufficient |
| D06-24 config | Existing boolean opt-in cannot encode controller trust; no schema expansion adopted; any required future expansion must be explicitly owner-reviewed |
| D06-25 public API | UNCHANGED: no new root name, export key or execution API. A required expansion triggers owner STOP |
| D06-26 installed model | Existing npm target installation preserved; no QA source-checkout dependency. Supervisor provisioning extension is OP-06-01, not silently included |
| D06-27 TSB-F02 | Fresh actual supported graph FALSE at this unchanged boundary; no complete future execute graph exists to certify |
| D06-28 TAP-2/CRS-1/PPI-1 | Preserved. Future execute must consume bound evidence and independently validate eligible paths/state; no new guard or closure adopted |
| D06-29 residuals | Existing acceptance preserved; prospective execution impact reported in section 7; no re-rating or extended acceptance |
| D06-30 execution residuals | Prospective exposures listed in section 7; not owner-accepted by this document |

## 6. Fresh TSB-F02 supported-consumer graph

Inspected both gate symbols across non-test source and the explicit packed
inventory, rather than inheriting the Stage 4B finding verdict:

```text
installed qa-agent -> cli.run
  -> review record -> v2 gate-free builder/validator -> review evidence
  -> apply -> Stage 4 checks/reservation -> canonical #23F
       -> validateApprovedGeneratedChangeSetReview
       -> independent verifyApprovedChangeBinding
       -> canonical package/live filesystem checks -> mutation
  -> execute -> reserved refusal (exit 5; no execution/gate load)

validateApprovedTestDesignReview -> no production supported consumer
legacy #23G -> not shipped; no CLI route; does not call either approval gate
```

The only non-test executable call/import edge to the change-set approval gate
is #23F; comments and gate definitions are not consumer edges. The test-design
gate remains unshipped with no production caller. The supported product has
not gained an execution consumer from this documentation record.

**TSB-F02 TRIGGER = FALSE for the actual unchanged supported surface.**
**TSB-F02 = OPEN / LOW / CONDITIONAL.** No remediation, closure, waiver,
re-rating or future-execute approval is asserted. A resumed design must
re-evaluate its actual proposed graph against DC-F02-1..5; it may not invoke
either weak gate outside canonical #23F, rely on stored APPROVED/APPLIED
alone, bypass per-decision checks, or call mutation again as an execution
shortcut. TRUE/INDETERMINATE requires owner/security disposition and STOP.

## 7. Residual impact and invariants retained for resume

R-1..R-5 stay ACCEPTED for their existing OD-04 scope, with no silent extension
to an execution platform. AT-07/TB-01 remain RESIDUAL; existing register
ratings stay unchanged. Prospective impact:

| Existing residual | Execution-specific impact to report to owner/security |
|---|---|
| R-1 | Same-principal automation can invoke eventual execution; TTY is not proof of a human; independent process control cannot rely on the same actor |
| R-2 | Account attribution is not person identity; a shared/reused UID cannot establish runner provenance |
| R-3 | Host test code may read/write/forge/delete its account-accessible run evidence; unkeyed apply/execute evidence is not authentic. Evidence deletion can affect replay and recovery |
| R-4 | Adds pre-spawn check-to-framework-open TOCTOU and config/import/dependency drift; #23F's existing write window unchanged |
| R-5 | Approving harmful code becomes code execution with host-account privileges, not merely filesystem application |
| AT-07/TB-01 | Forged authority evidence may reach a future executable boundary; successful APPLIED serialization is not proof of legitimate prior authority |

Prospective new residual classes, **UNACCEPTED / REQUIRES OD-06 DISPOSITION**:
host-account filesystem/process authority; executable framework configs and
transitive imports; malicious framework/browser/dependency installations;
target network/SUT behavior; intentionally provided SUT secrets being visible
to tests; secret-bearing output; same-account audit interference; orphan
process/resource consumption under an insufficient controller. These are
categories, not new severity assignments or finding closures.

All existing FUTURE guards remain OPEN, including reviewer identity, human
decision provenance, review presentation binding, framework capability
provenance, classifier coverage and Windows execution capability.

The resumed contract must establish EX-I01 no arbitrary command grammar;
EX-I02 shell false; EX-I03 target-local owned framework resolution; EX-I04
root binding; EX-I05 full applied-state binding; EX-I06 finite enforced
workload runtime; EX-I07 bounded capture/evidence; EX-I08 durable attempt
before external code; EX-I09 fail-closed ambiguity; EX-I10 no intentional
credential persistence. Listing invariants is not evidence they are achieved.

## 8. Implementation boundary and future verification requirements

**No implementable plan is issued.** Until OP-06-01 is resolved and a complete
design is independently approved, no agent may select interfaces, schemas,
launch vectors, lock/replay rules or runtime limits under this record.

Future affected areas, to be finalized by the resumed design: private execute
orchestration; parser/CLI route; canonical run-evidence loader/state inventory;
execution durability; private process/environment/framework resolver;
execution evidence schema; exact private package inventory. Existing
`derivePackageState` rejects an unknown execute directory, and durable-store
path/directory grammar permits only review/apply: adding storage requires
explicit narrowing-compatible integration, not a call to unchanged helpers
with an unsupported path. No mutation semantics, root public API, exports,
bin identity or existing exit numbers may be loosened.

Later implementation must remain release-disabled initially. Design approval
alone cannot flip `RELEASE_CAPABILITIES.execute`; independent implementation,
verification, owner activation/release decisions and separate merge authority
remain required. No artifact/config migration or schema version is invented
by this stopped record.

The resumed complete contract must define a mandatory test matrix with
observable expected outcomes for every case below, including no spawn on
refusal and durable/quarantined outcomes after an attempt is reserved:

- Cypress and Playwright pass/fail with real supported local installations.
- Capability false, malformed config, unsupported OS/runner, framework
  mismatch, missing apply outcome, stale target, and wrong project/root/run/
  package/product binding.
- Global-only binary, PATH poisoning, symlinked/substituted entrypoint,
  wrong package/version/native payload, and missing local installation.
- Shell metacharacters, hostile run/package/path, command-template config,
  provider command-like content, Cypress glob widening and Playwright regex
  widening; prove no unrelated spec selected.
- Timeout, SIGINT/SIGTERM, descendant and escaping/stubborn descendants,
  spawn failure, killed framework, parent SIGKILL, controller death, and
  unresolved prior attempt. Cooperative fixtures alone cannot certify the
  hostile-process boundary.
- Huge stdout/stderr, single oversized chunk, invalid UTF-8/binary data,
  secret output, report overflow and total evidence/disk exhaustion.
- Simultaneous same package, concurrent runs sharing a root, replay, and
  crashes before spawn, after spawn and before outcome persistence; include
  power-loss/flush failures and parent-controller handoff races.
- Real npm pack and external temp target, no source checkout dependency,
  unchanged public API/exports, exact private inventory/import denial and
  missing-private-file non-vacuity.
- Fresh TSB-F02 graph/non-vacuity proof, no direct gate/#23F bypass, forged
  applied outcome/per-decision evidence, executable ownership attacks,
  poisoned loader/env keys and environment leak probes.

No future test is created or claimed passing here. Existing unit/framework
tests and CI workflows are unchanged.

## 9. Handoff state

**STOP / OWNER DECISION REQUIRED**, not READY FOR INDEPENDENT HEAVY
ARCHITECTURE DESIGN REVIEW. A complete design PR was not opened or pushed.
The blocker is recorded locally; execution remains disabled.

After authorized resumption and completion, the required review sequence is
**HEAVY Architecture / Software Engineering design review → HEAVY Security
design review → Product Owner OD-06 disposition**. Security must not begin
before Architecture approves the exact same HEAD. Neither review has started.
Merge, publication, release, production implementation and activation remain
**NOT AUTHORIZED / NOT PERFORMED**.
