# Controlled-v1 Approval and Apply Security Contract v1

Lifecycle: **Controlled-v1 Productization Stage 4 / OD-04 — human approval +
apply security contract**

Authority: `OD-CONTROLLED-V1-STAGE-4-APPROVAL-DESIGN — APPROVED`

State: **DESIGN ONLY / SOLE WIP** (`WIP = 1`)

Document type: **security + software architecture design.** This document
changes no runtime code, test, workflow, package manifest, export, capability
flag, CLI behavior or ROADMAP status. Implementation is **NOT AUTHORIZED**.
Merge is **NOT AUTHORIZED**. `qa-agent review record` and `qa-agent apply`
remain **fixed refusals** (exit 5, `CAPABILITY_NOT_ENABLED_IN_RELEASE`).

Date: 2026-10-11

Normative language: **MUST / MUST NOT / SHOULD / MAY** are used in the RFC 2119
sense. Every MUST in §8–§24 is an acceptance condition for the later
implementation stage.

---

## 1. Executive decision

| Decision | Result |
|---|---|
| OD-04 recommendation | **APPROVE**, conditional on the Product Owner explicitly accepting the residual risks R-1..R-5 (§30.2). If the PO does not accept R-1, the result becomes `STOP — SIGNING / KEY MANAGEMENT DESIGN REQUIRED` (hardware-backed user-presence attestation), not this design |
| Approval granularity | **One human decision (`APPROVE` \| `REJECT`) over one complete canonical `GeneratedChangeSetReviewPackage`**, selected explicitly by run id and package ordinal. No per-file or per-operation approval |
| Trusted approval presentation | **Option A = `TAP-1`** (Trusted Approval Presentation v1): a repository-owned, deterministic, ASCII-only terminal rendering derived from the decoded bytes of `CRS-1`, which in turn is derived from the exact deep-frozen package built by `buildGeneratedChangeSetReviewPackage()`. Shown **only** inside `qa-agent review record`; `review show` stays non-authoritative and unchanged |
| Canonical review serialization | **`CRS-1` (`CanonicalReviewSerializationV1`)**: byte-exact, ASCII-only canonical JSON with one escape form per UTF-16 code unit (§11) |
| Canonical path identity | **`PPI-1` (Portable Path Identity v1)**: a validation-only (never normalizing) portable ASCII path grammar; the approved identity and the written identity are the same byte string (§13) |
| Reviewer identity | **OS-local account attribution** (`os-local-account-v1`), read from the operating system (never from environment variables, config or flags), recorded as attribution, not as personal authentication (§14) |
| Human decision provenance | **Interactive TTY challenge session** (`interactive-tty-challenge-v1`): full TAP-1 presentation with per-target acknowledgement, a fresh CSPRNG challenge, an exact typed `APPROVE <code>` / `REJECT <code>` line read from the controlling terminal, and re-verification of the package before the record is written (§15) |
| Authenticity | **Integrity + binding, not cryptographic authenticity.** Records stay unkeyed SHA-256 sealed. No signing, no key management, no external identity provider, no network |
| Review record schema | **`GeneratedChangeSetReviewRecord v2 REQUIRED`**: an authority envelope that embeds an unchanged v1 core consumed by #23F (§16) |
| Run manifest | **`QaAgentRunManifest v2 REQUIRED`** (reviews/apply ledger entries, §16.6) |
| Apply path | **Canonical #23F `applyApprovedGeneratedChangeSet` only**, preceded by refusal-only Stage 4 checks; #23F authority semantics unchanged (§22) |
| Replay | **Single-use per apply attempt.** An approval is consumed atomically before #23F is invoked, whatever the outcome (§20) |
| CI | `review record` and `apply` **refuse** under `GITHUB_ACTIONS=true` or a truthy `CI` (exit 5) |
| Offline | `review record` and `apply` **both permitted under `--offline`** (no network or provider is needed) |
| `TSB-F02` | `OPEN / LOW / CONDITIONAL`; **`TSB-F02 TRIGGER = FALSE`** (§26) |
| `SEC-S3-m01` | **DESIGN RESOLVED** (§12) |
| `SEC-S3-m02` | **DESIGN RESOLVED** (§13) |
| `AT-07` / `TB-01` | **RESIDUAL** (§27) — mitigated for every non-same-principal attacker; the same-OS-principal automation class remains and requires PO acceptance |
| `FUTURE_REVIEW_PRESENTATION_BINDING_GUARD` | **OPEN**; satisfaction criteria defined (§10.6). Not closed by this design |
| Public API / exit codes | **Unchanged.** No new root export, subpath or exit code |
| OD-06 | **NOT ENTERED.** The contract is platform-independent and fail-closed (§13.8) |

---

## 2. Scope

For Controlled-v1 only, this design defines normatively:

1. the authority model for `qa-agent review record` and `qa-agent apply` (OD-04);
2. what a valid human approval is, who may create it, and how the identity and
   the explicit decision are evidenced;
3. the exact bytes and representation a reviewer approves (`CRS-1`, `TAP-1`)
   and their binding to the canonical package and to the GeneratedChangeSet;
4. canonical path identity (`PPI-1`);
5. the `GeneratedChangeSetReviewRecord v2` and run-manifest deltas;
6. time-split, representation-split, cross-run, cross-project and replay
   defenses;
7. the apply contract around canonical #23F;
8. CI/offline policy, error/exit mapping, capability-enablement prerequisites,
   required tests, invariants, open decisions and the implementation forecast.

## 3. Non-scope

This design does **not**:

- implement anything, or authorize implementation, merge or release;
- modify `scripts/**`, `test/**`, `.github/**`, `package.json`,
  `package-lock.json`, capability flags, exports or `ROADMAP.md`;
- enable `review record`, `apply` or `execute`;
- design `execute`, a platform/runner matrix or any OD-06 item;
- introduce signing, key management, an external identity provider, a network
  identity requirement, a GitHub-based approval or any CI approval workflow;
- change #23F rollback implementation or #23F authority semantics;
- close `FUTURE_REVIEW_PRESENTATION_BINDING_GUARD`,
  `FUTURE_REVIEWER_IDENTITY_PROVENANCE_GUARD`,
  `FUTURE_HUMAN_DECISION_PROVENANCE_GUARD`, `AT-07`, `TB-01` or `TSB-F02`;
- change `qa-agent review show`.

## 4. Certified baseline

```text
repository:  TarasovArtem/qa-ai-agent
main:        45ed5b87d7a8de56e80f4bd53e8cd50f9d94c6ee
tree:        34d0fa47765d12602ee6a285d197480d087de1ed
lifecycle:   CONTROLLED-V1 PRODUCTIZATION STAGE 3 = COMPLETE_ON_MAIN / POST-MERGE CERTIFIED
branch:      design/controlled-v1-stage4-approval-security (parent = main above)
```

Pre-edit verification performed: `git fetch origin`; branch HEAD and TREE equal
the values above; `origin/main` equals the HEAD above; working tree clean; the
unrelated `stash@{0}` preserved untouched.

Repository evidence read for this design (all exist at the baseline):

| Evidence | Location |
|---|---|
| #23E package builder, `recomputeReviewPackageDigest` | `scripts/ai/test-automation/generated-change-set-review-package.js` |
| #23E record v1 builder, `recomputeReviewRecordDigest`, gate `validateApprovedGeneratedChangeSetReview` | `scripts/ai/test-automation/generated-change-set-review-record.js` |
| #23E snapshot/canonical/digest primitives (`canonicalStringify`, `computeDigest`) | `scripts/ai/test-automation/generated-change-set-review-canonical.js` |
| #23F `applyApprovedGeneratedChangeSet`, `verifyApprovedChangeBinding`, N-21 rebuild, live revalidation, rollback | `scripts/ai/test-automation/change-set-application.js` |
| #23D path/protected-path/framework-prefix validation (`isProtectedPath`, `FRAMEWORK_PATH_PREFIX`) | `scripts/ai/test-automation/generated-change-set.js` |
| `isSafeRepoRelativePath`, `isCanonicalPlanPath` | `scripts/ai/generation/automation-plan.js` |
| `classifyPathString`, `isCanonicalPathInsideRoot` | `scripts/ai/context-utils.js` |
| Stage 3 CLI: arg grammar, reserved commands, exit taxonomy, release capabilities, review show, run store/manifest, artifacts | `scripts/ai/cli/{args,cli,errors,policy,review-show,run-store,run-artifacts}.js` |
| DC-F02 static graph proof | `test/security/controlled-v1/dc-f02-static-graph.test.js` |
| Productization contract | `docs/controlled-v1-productization-contract-v1.md` |
| Guard register, R-1..R-5, Stage 3 status | `SECURITY.md` §23, §28 |
| AT-07, TB-01, SADR-02/03, ODR-02 | `docs/agentic-threat-model-v1.md`, `docs/security-architecture-decision-record-v1.md`, `ROADMAP.md` |

---

## 5. Current Stage 3 authority state

Facts at the baseline (read from source, not assumed):

1. `review record` and `apply` are `kind: "reserved"` in `scripts/ai/cli/args.js`.
   The parser stops interpreting argv as soon as a reserved command is
   recognized; `cli.js` throws `authorityRefused("CAPABILITY_NOT_ENABLED_IN_RELEASE")`
   before root, config or any input is read. `RELEASE_CAPABILITIES.reviewRecord`
   and `.apply` are `enabled: false` (`policy.js`).
2. A run holds, per `AutomationPlan`, one `GeneratedChangeSet` and one
   `GeneratedChangeSetReviewPackage` (`generate/generated-change-set-NNNN.json`,
   `generate/review-package-NNNN.json`). A run can therefore hold **several**
   packages.
3. `QaAgentRunManifest v1` is a closed schema: stages are exactly
   `design → plan → generate`; artifact paths match
   `^(design|plan|generate)/…\.json$`. There is no place for a review record or
   an apply result.
4. `review show` rebuilds every package with `buildGeneratedChangeSetReviewPackage()`,
   requires equality with the persisted package, and prints it with
   `printable()` escaping (C0/C1 except LF/TAB, `\p{Cf}`, `\p{Cs}`,
   U+2028/U+2029, backslash). It reads no record and reaches no gate. Its
   `--json` output emits review-package strings through `JSON.stringify`, which
   leaves bidi/format characters, U+2028/U+2029 and other non-ASCII **raw**
   (`SEC-S3-m01`).
5. `GeneratedChangeSetReviewRecord v1` carries a caller-supplied `reviewerId`
   (`isValidId` only), a caller-supplied `reviewedAt`, per-target decisions
   (`APPROVE | REQUEST_CHANGES | REJECT`), derived `status`, optional `comment`
   and an unkeyed `recordDigest`. It binds `packageDigest` and `projectId`
   only — no run id, no repository/root identity, no session, no expiry, no
   consumption state, no presentation identity.
6. The gate `validateApprovedGeneratedChangeSetReview` requires
   `kind === "GeneratedChangeSetReviewRecord"` and `schemaVersion === 1`, and
   trusts stored `status` (`TSB-F02`). Its only production consumer is #23F,
   which adds `verifyApprovedChangeBinding` (single `APPROVE` per change bound
   to recomputed target digests) and the N-21 package rebuild.
7. The builder `buildGeneratedChangeSetReviewRecord` and the gate are defined
   in the **same module**.
8. Path acceptance (`isSafeRepoRelativePath` + `isCanonicalPlanPath` + framework
   prefix + `isProtectedPath`) does **not** refuse: non-ASCII, Unicode `Cf`
   (bidi, zero-width, BOM), `Cs`, C1 controls, U+2028/U+2029, NFC/NFD variants,
   Windows trailing dot/space, `:` (NTFS alternate data streams), reserved
   device names (`CON`, `NUL`, `COM1`, …), `~` short-name aliases, or
   protected-segment aliases such as `node_modules.` / `.git ` that Windows
   resolves to the protected name (`SEC-S3-m02`). #23F batch case-collision
   detection uses `String.prototype.toLowerCase()` (full Unicode lowering, not
   a defined case-fold), and ancestor directories are matched by `lstat`, so on
   a case-insensitive filesystem an approved `cypress/E2E/x` can be written
   into an existing `cypress/e2e/`.

Consequence: Stage 3 provides **no** approval surface. It is safe because
`review record` / `apply` are fixed refusals, not because approval is designed.

---

## 6. Threat model

### 6.1 Protected assets

| Asset | Why |
|---|---|
| Target repository working tree (framework prefix `cypress/` or `playwright/`) | `apply` is the only product path that mutates it |
| Downstream execution | applied files are later executed with full host authority (#23G, OD-06) |
| Reviewer intent | the decision must mean "write exactly these bytes to exactly these paths" |
| Run evidence | records and manifest are audit evidence, not secrets |

### 6.2 Attackers

| ID | Attacker | Capabilities |
|---|---|---|
| A1 | Untrusted model/provider output | controls proposed file content, `purpose` text, plan paths (subject to validators); may embed hostile Unicode or text impersonating UI ("✔ APPROVED", fake prompts) |
| A2 | Hostile requirements / repository content | influences evidence, existing content shown as before-state |
| A3 | Non-interactive local automation | scripts, git hooks, IDE tasks, schedulers, background jobs, agents without a pseudo-terminal; can run any CLI command with any flags/env, pipe stdin |
| A4 | Same-OS-principal automation **with** a pseudo-terminal | e.g. an autonomous coding agent with shell access able to allocate a pty, read the screen and type; can also read/write every file the user can |
| A5 | Another local OS account | shared machine; may have write access to the repository |
| A6 | Artifact tamperer | edits run files between commands (with or without recomputing digests) |
| A7 | Remote / CI actor | PR author, workflow, GitHub reviewer, label/comment author |
| A8 | Repository substitution | sibling clone, copied run directory, moved/restored root |

### 6.3 Threats (mandatory list)

| Threat | Description |
|---|---|
| T-ESC | authority escalation: any path other than an explicit human decision yields write authority |
| T-SPOOF | approval spoofing: a record not produced by the interactive session is accepted |
| T-SUBST | reviewer substitution: decision attributed to a different principal |
| T-NONHUMAN | non-human approval: automation, CI, model output, config, env, flag, timeout produces a decision |
| T-REPLAY | an approval authorizes more than one apply attempt |
| T-STALE | an approval of earlier content authorizes later content |
| T-XRUN / T-XPROJ | approval for run/project A authorizes run/project B |
| T-PRES | presentation substitution: what the human saw is not what is written (time-split, representation-split) |

Mitigation mapping: §27.

---

## 7. OD-04 recommended disposition

```text
OD-04 RECOMMENDATION = APPROVE
```

Recommended disposition text (for the Product Owner):

> **OD-04 — APPROVED (Controlled-v1).** Approval recording and application use
> the authority model of `docs/controlled-v1-approval-apply-contract-v1.md`:
>
> - **OD-04.1 Eligible reviewer.** The eligible reviewer is the interactive
>   operator of the local OS account that runs `qa-agent review record` in the
>   target repository root. Controlled-v1 has no reviewer role registry; any
>   such account is eligible. Identity is OS-account attribution.
> - **OD-04.2 Decision.** One closed decision (`APPROVE` | `REJECT`) over one
>   complete canonical review package, made in an interactive TTY challenge
>   session after a full TAP-1 presentation.
> - **OD-04.3 Subject.** The decision binds the `CRS-1` digest, the
>   `packageDigest`, the change-set/plan/context digests, the run, the
>   run-semantic projection, the repository root binding and path policy
>   `PPI-1`.
> - **OD-04.4 Lifetime.** An approval is valid for at most **24 hours** after
>   the decision and for **one** apply attempt.
> - **OD-04.5 Application.** Only `qa-agent apply`, invoked interactively by the
>   same OS principal, through canonical #23F.
> - **OD-04.6 Forbidden sources.** No approval from CI, GitHub (PR review,
>   comment, label, check), config, environment, flags, provider/model output,
>   timeouts or defaults.
> - **OD-04.7 Assurance level.** Integrity and binding, not cryptographic
>   authenticity. The PO accepts residuals R-1..R-5 (§30.2) for Controlled-v1.
> - **OD-04.8 Enablement.** Release enablement additionally requires §24.

The recommendation is **APPROVE** rather than `ADDITIONAL OWNER DECISION
REQUIRED` because every element above is within OD-04's own scope (ODR-02:
eligibility and lifetime) and no element needs signing, key management,
an external identity provider, mandatory online identity, a new public API, a
new distribution service, a platform matrix, CI approval authority, partial
approval or a change to #23F authority semantics. Residual acceptance (OD-04.7)
is an integral clause of the same decision, not a separate one. If the PO
declines OD-04.7 for R-1, this design returns
`STOP — SIGNING / KEY MANAGEMENT DESIGN REQUIRED` (§32).

---

## 8. Approval granularity

| Option | Binding states | Replay cases | Apply semantics | Reviewer ambiguity | Verdict |
|---|---|---|---|---|---|
| Whole review package | 1 decision ↔ 1 `packageDigest` | 1 | #23F unchanged (all changes or none) | none | **SELECTED** |
| Whole run (all packages) | 1 ↔ N digests | 1 | N sequential #23F calls; partial completion across packages | large presentation; one veto rejects unrelated plans | rejected |
| Per-file | N partial decisions; subset digests | N | #23F requires an `APPROVE` for **every** change (`verifyApprovedChangeBinding`); subset apply would need a new change set | which subset was meant | rejected |
| Per-operation | same as per-file | same | same | same | rejected |

Normative rules:

- **G-1** One `review record` session decides exactly one package, identified
  by `--run <id>` **and** `--package <NNNN>` (four-digit ordinal equal to the
  `NNNN` of `generate/review-package-NNNN.json`). `--package` is mandatory even
  when the run holds one package (no implicit selection).
- **G-2** The decision vocabulary is closed: `APPROVE` | `REJECT` (§9.6). The v1
  core's per-target decisions are **derived** from it: every target receives
  the same decision. `REQUEST_CHANGES` is not reachable from the product
  surface (a non-approval is `REJECT`; changes are requested by generating a
  new run).
- **G-3** `apply --run <id> --package <NNNN>` applies exactly the package of
  the active approval, through one #23F call.
- Partial approval is **not** offered; no owner/product consequence arises
  because the selected option is the preferred one.

---

## 9. Trusted approval interaction

### 9.1 Command surface (future, reserved today)

```text
qa-agent review record --run <runId> --package <NNNN> [--root <dir>] [--config <path>] [--offline]
qa-agent apply         --run <runId> --package <NNNN> [--root <dir>] [--config <path>] [--offline]
```

- `--json` is **not** valid for either command (exit 2,
  `USAGE_OPTION_NOT_APPLICABLE`): the interactive presentation owns stdout.
- There is **no** `--yes`, `--force`, `--decision`, `--reviewer`, `--comment`,
  `--non-interactive` or equivalent flag, and none may ever be added for these
  commands in Controlled-v1.
- `--package` is a new value flag valid only for these two commands
  (grammar `^[0-9]{4}$`, value `0001..` up to the run's package count).

### 9.2 Preconditions (authority, exit 5, before any run input is read)

In order, after usage (2), root (3), config (3), containment (3) and the
offline contradiction check (5):

1. capability `reviewRecord` (resp. `apply`) requested **and** release-enabled;
2. `GITHUB_ACTIONS === "true"` or `CI` set to any non-empty value other than
   `"false"`/`"0"` → refuse (`APPROVAL_CI_FORBIDDEN` / `APPLY_CI_FORBIDDEN`);
3. `process.stdin.isTTY`, `process.stdout.isTTY` and `process.stderr.isTTY`
   MUST all be `true`; otherwise refuse `INTERACTIVE_TERMINAL_REQUIRED`;
4. reviewer identity resolvable (§14), otherwise `REVIEWER_IDENTITY_UNAVAILABLE`.

### 9.3 Session protocol `interactive-tty-challenge-v1` (review record)

```text
S1  open run (manifest shape + binding), select package NNNN, refuse if the
    package state is APPLIED or QUARANTINED                                  (4/5)
S2  rebuild package P from the run's validated plan/context/change set with
    buildGeneratedChangeSetReviewPackage(); require canonical equality with the
    persisted package and its manifest sha256                                (4)
S3  enforce PPI-1 on every target path of P                                 (4)
S4  require live repository context == plan-stage context ("CURRENT")       (4)
S5  B  = CRS-1 bytes of P;  C0 = crsDigest(B);  P' = decode(B), require
    encode(P') == B;  M0 = sha256(manifest bytes);  I0 = reviewer identity
S6  sessionId = 16 CSPRNG bytes (32 lowercase hex);
    challenge = 40 CSPRNG bits as 8 Crockford-base32 characters
    (alphabet 0123456789ABCDEFGHJKMNPQRSTVWXYZ); sessionStartedAt = now
S7  render TAP-1 (§10.3) from P' to stdout; after each target print
    "-- end of target k/N; press Enter to continue --" and read one line from
    the terminal (content ignored, max 64 bytes)
S8  print the decision prompt:
       To APPROVE writing exactly these N target(s), type:  APPROVE <challenge>
       To REJECT this package, type:                        REJECT <challenge>
       Anything else, Ctrl-C or end-of-input aborts without recording.
    read one line (max 64 bytes) from the terminal
S9  accept only an exact match of ^(APPROVE|REJECT) <challenge>$ (case-
    sensitive, one ASCII space, no other characters before the line
    terminator); otherwise re-prompt; after 3 failed lines abort
    HUMAN_DECISION_NOT_CONFIRMED                                             (5)
S10 optional comment prompt (§9.6); decidedAt = now
S11 refuse APPROVAL_SESSION_EXPIRED if decidedAt - sessionStartedAt > 60 min (5)
S12 re-verify (time-split defense, §18): reload manifest (sha256 == M0),
    repeat S2-S5 and require crsDigest == C0, live context CURRENT,
    reviewer identity == I0; otherwise REVIEW_PACKAGE_CHANGED_DURING_APPROVAL (4)
S13 build the v1 core with the (extracted) v1 builder from P, build record v2,
    write it write-once (O_CREAT|O_EXCL|O_NOFOLLOW), append the manifest
    review entry with compare-and-swap on M0                                 (4)
S14 print "decision recorded: <APPROVE|REJECT> (record <sessionId>)"
```

Interrupts (SIGINT/SIGTERM/SIGHUP), EOF, terminal read errors and the 60-minute
limit all abort with **no** record and no manifest change. Nothing is written
before S13.

### 9.4 Why this UX

- "Type yes" alone is rejected as provenance: it is replayable from piped or
  pre-typed input. The challenge is unknown before S8, so typeahead, piped
  input and replayed transcripts cannot match it.
- The challenge is printed only **after** the last target was acknowledged, so
  a decision cannot be entered before the full presentation was emitted.
- Typing a digest prefix/suffix is **not** required: a digest is not
  human-meaningful, and the binding to `packageDigest`/`crsDigest` is performed
  mechanically (S12/S13). The digests are displayed for audit.
- No separate interactive identity authentication (password, OTP) is
  required: the OS session already authenticated the account (§14); a second
  prompt would add no assurance against A4 and would need credential handling.

### 9.5 Apply confirmation (`apply`)

`apply` is also human-invoked and interactive (§21): after all checks it prints
a compact, non-authoritative apply summary (TAP-1 header lines, the ordered
`OPERATION path` list, record id, reviewer principal, `decidedAt`, `notAfter`)
and a fresh challenge, and requires the exact line `APPLY <challenge>` (same
rules as S9, 3 attempts). It never re-presents content as approval evidence and
never records a decision.

### 9.6 Decision vocabulary and comment

- Authority-bearing vocabulary is exactly `APPROVE` and `REJECT`, recognized
  only in the S9 grammar. No other string anywhere (config, env, flag, comment,
  artifact, model output, record field other than `decision`) can grant
  authority.
- `comment` is optional, non-authoritative metadata: printable ASCII
  `0x20–0x7E` only, 1..500 characters, no leading/trailing space; invalid input
  re-prompts (skip with an empty line). It is stored verbatim, never parsed,
  never displayed as a decision, and never influences any check. In the v1 core
  it fills `comment`; for `REJECT` the v1 per-target `reason` (required by the
  v1 builder) is the fixed text `Rejected in qa-agent review record session
  <sessionId>.` — never the comment.

---

## 10. Option A

### 10.1 Definition

**Option A = the repository-owned trusted approval presentation `TAP-1`,
rendered exclusively inside `qa-agent review record`, from the decoded `CRS-1`
bytes of the exact deep-frozen package returned by
`buildGeneratedChangeSetReviewPackage()`.**

Single-source chain (one process, one object):

```text
persisted plan/context/change set (manifest-digest verified)
   └─► buildGeneratedChangeSetReviewPackage()  ──►  P  (deep-frozen; == persisted package)
          ├─► CRS-1 encode ──► B (bytes) ──► crsDigest
          │        └─► strict decode ──► P'  (encode(P') == B)
          │                 └─► TAP-1 render ──► terminal  (presentationDigest)
          └─► v1 core builder (P) ──► record v2 binds packageDigest(P), crsDigest(B), presentationDigest
```

The display and the record builder consume the same authoritative object `P`
or its exact canonical serialization `B` (R-1 of `SECURITY.md` §28). `apply`
recomputes `B`, `crsDigest` and `presentationDigest` from the package it
rebuilds itself (§21).

### 10.2 Prohibited as approval evidence

Detached summaries, copied text, reconstructions from another source,
independently supplied JSON, screenshots, `review show` output (human or
`--json`), any `--json` output, digest-only assertions without a TAP-1 session,
GitHub reviews/comments/labels/checks, and any representation not produced by
TAP-1 in the same process that writes the record.

### 10.3 TAP-1 layout (exact)

All output lines are ASCII `0x20–0x7E` terminated by LF; no ANSI/SGR
sequences, colors, cursor movement or terminal-dependent features are
emitted. Field values are rendered with the TAP-1 string rule (§12.4).

```text
QA-AGENT TRUSTED APPROVAL PRESENTATION TAP-1
run: <runId>
package: <NNNN> of <count> (<packagePath>)
project: <projectId>
framework: <framework>
automationPlanId: <automationPlanId>
packageDigest: <sha256:...>
crsDigest: <sha256:...>
changeSetDigest: <sha256:...>
automationPlanDigest: <sha256:...>
repositoryContextDigest: <sha256:...>
pathPolicy: PPI-1
targets: <N>
escapes: \uXXXX = one UTF-16 code unit outside printable ASCII (0x20-0x7E); \\ = one literal backslash
=== TARGET <k>/<N>: <CREATE|MODIFY> <path>
purpose (model-generated, untrusted): <purpose>
baseContentDigest: <sha256:...|none>
proposedContentDigest: <sha256:...>
targetDigest: <sha256:...>
escapedCodeUnits: existing=<e> proposed=<p>
--- EXISTING CONTENT (bound repository context) ---        (MODIFY only)
00001| <line>
...
--- END EXISTING (lines=<L>, finalLF=<yes|no>, codeUnits=<U>) ---
+++ PROPOSED CONTENT (model-generated, untrusted) +++
00001| <line>
...
+++ END PROPOSED (lines=<L>, finalLF=<yes|no>, codeUnits=<U>) +++
```

Content rules: the content string is split on LF (U+000A); if it ends with LF
the final empty element is dropped and `finalLF=yes`; each line is rendered as
a 5-digit, zero-padded 1-based line number, `| `, and the TAP-1-escaped line.
Every line of every target is emitted — **no truncation, elision, folding,
diff or summarization** (content is already bounded: 50 000 code units per
file, 1 000 000 per change set). No diff is shown in v1: diff algorithms are an
additional derived representation with implementation-dependent output.

`presentationDigest` = SHA-256 over
`qa-ai-agent:trusted-approval-presentation:v1:` followed by the exact bytes of
the lines above (header through the last target's END line). Session lines
(Enter prompts, decision prompt, challenge, comment prompt) are excluded.

### 10.4 Labeling

Model-generated fields are labeled `untrusted` (purpose, proposed content).
TAP-1 never renders a model-provided string in a position where it could be
mistaken for product UI: every value appears after a fixed product-owned
label on the same line, and content lines always carry the `NNNNN| ` gutter.

### 10.5 Relationship to `review show`

`review show` remains `NON_AUTHORITATIVE`, unchanged, and is never approval
evidence (R-2, R-3). Reusing it for approval was rejected: it would turn
advisory output (including `--json`) into authority, its display rule is
Unicode-database-dependent (`\p{Cf}`), and it has no session, identity or
binding.

### 10.6 Satisfaction criteria for `FUTURE_REVIEW_PRESENTATION_BINDING_GUARD`

The guard stays **OPEN**. It may be proposed for closure only by a separately
authorized closure lifecycle after **all** of the following exist on `main`,
independently reviewed and post-merge certified:

1. a TAP-1 renderer and CRS-1 codec implementing §10–§12 exactly, with committed
   golden vectors;
2. `review record` implementing §9.3 so that the only path to a record v2 is
   the TAP-1 session;
3. `apply` recomputing `crsDigest` and `presentationDigest` and refusing
   mismatches (§21);
4. the hostile time-split and representation-split tests of §28 passing (R-4);
5. AT-07 addressed for this surface per §27 with the PO-accepted residuals.

---

## 11. Canonical review serialization (`CRS-1`)

### 11.1 Input domain

The input is exactly one value `P`: the `reviewPackage` of a successful
`buildGeneratedChangeSetReviewPackage()` call (GeneratedChangeSetReviewPackage
v1, closed shape), with `recomputeReviewPackageDigest(P) === P.packageDigest`.
Admitted JSON types: object (all keys ASCII `0x20–0x7E`), array, string,
`null`, `true`/`false`, and integers `n` with `Number.isSafeInteger(n)`. Any
other value (non-integer or unsafe number, `-0` is encoded as `0`, `undefined`,
function, symbol, bigint, non-plain object, non-ASCII key) → refusal
`REVIEW_SERIALIZATION_UNSUPPORTED`.

### 11.2 Encoding `E(v)`

| Value | Encoding |
|---|---|
| `null` / `true` / `false` | `null` / `true` / `false` |
| integer `n` | shortest decimal: optional `-`, no `+`, no leading zeros, no exponent, `0` for zero |
| string `s` (sequence of UTF-16 code units `u`) | `"` + per code unit: `0x20 ≤ u ≤ 0x7E` and `u ∉ {0x22, 0x5C}` → that ASCII byte; `0x22` → `\"`; `0x5C` → `\\`; every other code unit → `\u` + exactly 4 **lowercase** hex digits of `u` + `"` |
| array | `[` + `E(items)` joined by `,` + `]` |
| object | `{` + entries `E(key):E(value)` sorted ascending by key code-unit sequence, joined by `,` + `}` |

No whitespace, no short escapes (`\n`, `\t`, `\/`, `\b`, `\f`, `\r` are never
emitted), no BOM. Astral characters appear as their two surrogate escapes; lone
surrogates are representable (`\udXXX`). Consequently every code unit has
exactly one encoding and `E` is injective.

### 11.3 Document

```text
B = ASCII( E( { "crsVersion": 1,
                "kind": "CanonicalReviewSerialization",
                "reviewPackage": P } ) ) || 0x0A
crsDigest = "sha256:" || lowercase-hex( SHA-256( ASCII("qa-ai-agent:canonical-review-serialization:v1:") || B ) )
```

`P` includes its `packageDigest` field. Every byte of `B` except the final
`0x0A` is in `0x20–0x7E`.

### 11.4 Decoding and canonicality

`decode(B)`: require the final `0x0A`, all other bytes in `0x20–0x7E`, parse
with the existing strict parser (`scripts/ai/cli/strict-json.js`
`parseStrictJson`: duplicate keys and `__proto__`/`constructor`/`prototype`
refused), require `crsVersion === 1` and `kind`, then require
`encode(decoded) === B` byte-for-byte. Any difference → refusal. There is
therefore exactly one valid `B` per package.

### 11.5 Properties

| Required property | How |
|---|---|
| deterministic | pure function of `P`; no locale, clock, randomness, ICU/Unicode-database or platform input |
| versioned | `crsVersion: 1` inside `B` and `:v1:` in the digest label; any change is `CRS-2` |
| lossless | JSON escapes decode to the exact code units; `decode(B)` deep-equals `P` |
| one encoding | injective per-code-unit rule + canonicality check (§11.4) |
| stable ordering | keys sorted by code units; array order = builder order (plannedChanges order) |
| no terminal semantics | ASCII-only, no control bytes except the final LF |
| no hidden/truncated content | every code unit of every string is present, visibly |
| hostile-Unicode safe | every non-printable-ASCII code unit is an explicit escape |
| SHA-256 binding | `crsDigest`, domain-separated |
| reproducible by apply | apply rebuilds `P` from persisted inputs and recomputes `B` |

`CRS-1` is distinct from, and does not replace, `packageDigest`
(`canonicalStringify` over raw UTF-8). Both are bound; they are two
deterministic functions of the same object.

---

## 12. Unicode / representation policy (`SEC-S3-m01`)

### 12.1 Four representations

| # | Representation | Encoding rule | Authority |
|---|---|---|---|
| 1 | Machine artifact (run files) | unchanged: `JSON.stringify(value, null, 2) + "\n"`, raw Unicode preserved, bytes bound by manifest sha256 | evidence; never shown as approval |
| 2 | Machine CLI `--json` (stdout) | value-equivalent JSON; Stage 4 commands MUST emit ASCII-safe JSON (every code unit outside `0x20–0x7E` as `\uXXXX`); existing commands SHOULD adopt the same value-preserving escaping (§12.3) | advisory; never approval evidence |
| 3 | Human non-authoritative display (`review show`) | unchanged Stage 3 `printable()` rule | `NON_AUTHORITATIVE` |
| 4 | Trusted authoritative approval presentation (`TAP-1`) | ASCII-only rule §12.4, independent of the Unicode database | the only representation a decision may be made on |

The underlying semantic data (artifact strings, approved bytes) is **never**
altered by any representation: escaping is applied to rendered text only, and
#23F writes the exact approved code units encoded as UTF-8.

### 12.2 Character classes (TAP-1 and CRS-1)

| Class | TAP-1 / CRS-1 treatment |
|---|---|
| Unicode `Cf` (incl. bidi embeddings U+202A–U+202E, isolates U+2066–U+2069, LRM/RLM/ALM U+200E/U+200F/U+061C, zero-width U+200B–U+200D, U+2060–U+2064, BOM/ZWNBSP U+FEFF, soft hyphen U+00AD, tag characters) | escaped `\uXXXX` (non-ASCII) |
| Unicode `Cs` (lone or paired surrogates) | escaped per code unit |
| C0 controls U+0000–U+001F, DEL U+007F, C1 U+0080–U+009F | escaped (LF is a structural line break inside content blocks only, §12.4) |
| U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR | escaped |
| TAB U+0009, CR U+000D | escaped (`\u0009`, `\u000d`) — so CRLF and tab/space indentation differences are visible |
| other non-ASCII (letters, marks, NBSP, ideographic space, confusables) | escaped |
| backslash U+005C | `\\` |
| literal text `\u202e` (6 ASCII characters) | rendered `\\u202e`, distinct from the escaped character `\u202e` |

Rule choice: a code-unit range rule (`0x20–0x7E`) instead of General-Category
matching makes TAP-1 and CRS-1 output identical on every Node/ICU version.
Readability cost for non-ASCII text is accepted for the approval surface; each
target reports `escapedCodeUnits` so the reviewer sees that escaping occurred.

### 12.3 Machine `--json`

`--json` output is not an approval surface and is never parsed by the product
for authority. Stage 4 commands do not emit package content in `--json`
(`review record`/`apply` reject `--json`). For existing commands, ASCII-safe
escaping is a value-preserving change (same JSON value) and is RECOMMENDED for
the Stage 4 implementation to protect humans piping `--json` to a terminal; it
does not change the `cliOutput` v1 schema.

### 12.4 TAP-1 string rule

For a single-line field: each UTF-16 code unit `u` in `0x20–0x7E` except `0x5C`
is emitted as-is; `0x5C` → `\\`; every other `u` (including LF) → `\u` + 4
lowercase hex digits. For content blocks: identical, except that the string is
first split on LF (§10.3), so LF never appears inside a rendered line.

```text
SEC-S3-m01 = DESIGN RESOLVED
```

---

## 13. Canonical path identity (`PPI-1`, `SEC-S3-m02`)

### 13.1 Principle

`PPI-1` is a **validation predicate, never a normalization**. A path that is
not already in canonical form is refused, not repaired. The approved identity
is the exact path string bound inside `packageDigest`; the written identity is
`path.join(realRoot, ...segments)` of the same string. No transformation
(separator conversion, case change, Unicode normalization, trimming) is ever
applied between approval and write, so no normalization-split exists.

### 13.2 Grammar

A path `p` satisfies `PPI-1` iff all of:

1. `typeof p === "string"`, `1 ≤ p.length ≤ 300` (existing
   `SHORT_TEXT_MAX_LENGTH`), every code unit in `0x21–0x7E` (printable ASCII,
   no space);
2. `p` matches `^[A-Za-z0-9._/-]+$` (character set: ASCII letters, digits,
   `.`, `_`, `-`, and `/` as the **only** separator; no `\`, `:`, `~`, space,
   `@`, `+`, `%`, `*`, `?`, `"`, `<`, `>`, `|`);
3. split on `/` gives segments `s1..sn`, `n ≥ 2`; no segment is empty (no
   leading `/`, trailing `/` or `//`);
4. each segment `s`: `1 ≤ s.length ≤ 100`; matches `^[A-Za-z0-9_-][A-Za-z0-9._-]*$`
   (first character not `.`, so no `.`, `..`, hidden or dot-alias segment);
   does **not** end with `.` (Windows trailing-dot alias);
5. Windows reserved device names: for each segment, let `stem` = the part
   before the first `.`, ASCII-uppercased; `stem` MUST NOT be `CON`, `PRN`,
   `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9`;
6. `s1` equals the framework prefix segment **exactly** (`cypress` or
   `playwright`, case-sensitive, from the validated plan/config framework);
7. the existing checks still pass unchanged: `isSafeRepoRelativePath(p)` and
   `isCanonicalPlanPath(p)` are `true`, `p` starts with the framework prefix,
   and `isProtectedPath(p)` is `false` (PPI-1 only narrows);
8. protected-path evaluation is additionally applied to the **ASCII case-fold**
   (`A–Z → a–z` only) of every segment: no folded segment equals `.git`,
   `.github`, `node_modules`, `secrets`, `credentials`; the folded basename is
   not `package.json`, `package-lock.json` and does not match `^\.env(\..+)?$`
   (rules 2/4 already make most aliases unrepresentable; rule 8 is defense in
   depth).

### 13.3 Requirement-by-requirement resolution

| Requirement | Resolution |
|---|---|
| separator normalization | none; `/` is the only accepted separator, `\` refused |
| absolute paths | refused (leading `/` empty segment; `:` refused, so no drive letters; existing classifier also refuses) |
| traversal, `.`, `..` | refused (no segment may start with `.`) |
| Unicode normalization / NFC | not applicable: ASCII-only, so NFC/NFD/NFKC identities coincide; no normalization is performed |
| Unicode `Cf`, `Cs`, C0/C1, bidi, zero-width, BOM | refused (outside the character set) |
| Windows trailing dot / trailing space | refused (rule 4; space not in set) |
| colon / NTFS ADS | refused (`:` not in set) |
| reserved device names | refused (rule 5, including with extensions such as `CON.cy.js`) |
| 8.3 short-name aliases | refused (`~` not in set) |
| protected-path aliases | refused by rules 2/4/8 (`.git.`, `.git `, `node_modules.`, `NODE_MODULES`, `node~1`) |
| case-folding / case aliases | identity key = ASCII case-fold of the full path; two targets with equal keys in one package are refused at acceptance; #23F's existing batch check and CREATE sibling check remain; plus the apply-time exact-name check §13.6 |
| duplicate paths | refused: exact duplicates (existing #23D) and case-fold duplicates (rule above) |
| canonicalization ordering | 1) existing classifiers, 2) PPI-1, 3) framework prefix, 4) protected checks — any refusal stops; nothing is transformed |
| canonicalization before digest | PPI-1 is enforced before a package is accepted (`generate`) and before CRS-1/`packageDigest` are computed for presentation |
| canonicalization before approval | enforced in §9.3 S3 and again in S12 |
| canonicalization at apply | enforced on the rebuilt package before #23F, plus live exact-name check §13.6 inside #23F revalidation |

### 13.4 Enforcement points (all four mandatory)

1. **Acceptance:** `plan` and `generate` (CLI) refuse a plan/change set with a
   non-PPI-1 path (exit 6 for fresh provider output, exit 4 when re-read from
   disk, per the existing origin rule).
2. **Before presentation:** §9.3 S3.
3. **Before record creation:** §9.3 S12.
4. **At apply:** on the rebuilt package before reservation (§21 step A9) and
   live in #23F (§13.6).

### 13.5 Persisted or recomputed

Path identity is **recomputed** deterministically at each point from the exact
path string; no normalized form is persisted. The record binds the policy
version (`subject.pathPolicy = "PPI-1"`); apply refuses any other value
(`REVIEW_SERIALIZATION_UNSUPPORTED`).

### 13.6 Live filesystem exact-name check (strengthening of #23F)

For every target, at #23F Phase 5 **and** at the fresh Phase 7 revalidation,
for every existing ancestor segment (and the leaf for MODIFY), the parent
directory listing MUST contain an entry whose name is **byte-identical** to
the approved segment; otherwise refuse (`ANCESTOR_NAME_MISMATCH` /
`TARGET_NAME_MISMATCH`, zero writes). This closes the case-insensitive
filesystem alias (`cypress/E2E/x` landing in `cypress/e2e/`). It is an
additional refusal inside the existing revalidation functions — it narrows
what #23F accepts and does not change its authority semantics (§22.3).

### 13.7 Answers

```text
WHAT EXACT PATH IDENTITY DOES THE HUMAN APPROVE?
  The exact PPI-1-valid ASCII string reviewTargets[k].path of the package whose
  packageDigest and crsDigest are bound in the record, displayed verbatim in
  TAP-1 (no escaping can occur: every PPI-1 character is printable ASCII and
  not a backslash).

WHAT EXACT PATH IDENTITY MAY #23F WRITE?
  realRoot joined with the same string's "/"-segments, where realRoot is the
  bound repository root, every existing component has the byte-identical
  on-disk name, no component is a symlink/junction, and the result is
  canonically inside realRoot.
```

They are identical in security meaning: same byte string, no transformation,
same root (root binding §17), exact on-disk names.

### 13.8 Platform

PPI-1 is a portable subset whose meaning is identical on POSIX and Windows
filesystems (no separators other than `/`, no reserved names, no case
ambiguity after §13.6, no Unicode). Combined with #23F's existing
symlink/junction refusal, containment and identity checks, safe apply is
specified **platform-independently and fail-closed**: on any platform where a
check cannot be performed, apply refuses. Which operating systems are
*supported* remains OD-06(a); this design does not decide it.

```text
SEC-S3-m02 = DESIGN RESOLVED
```

---

## 14. Reviewer identity

### 14.1 Mechanisms evaluated

| Criterion | A. OS/local authenticated account | B. GitHub identity | C. Cryptographic signature | D. Trusted interactive local session |
|---|---|---|---|---|
| Reliability | OS authenticated the login; `os.userInfo()` reads the kernel uid / Windows token, not env | strong for the account | strong for key possession | proves an interactive terminal session, not who |
| Spoofing risk | env `USER`/`USERNAME` spoofable — not used; a same-account process is indistinguishable | token theft; any process with the token acts as the user | software key readable by any same-user process | pty-driving same-user automation (A4) |
| Cross-platform | uid/name on POSIX; name on Windows (uid −1) | uniform | uniform, key storage differs per OS | uniform (Node TTY) |
| Offline | yes | **no** | yes | yes |
| Shared-account risk | attribution is to the account only | per person if tokens are personal | per key | none additional |
| Proves a human saw this review? | no | **no** (token use is not presence) | **no** unless hardware user-presence | **partially**: fresh challenge after full presentation, not proof against A4 |
| Burden | none | login, token scopes, network | key generation, storage, rotation, revocation, recovery | typing one line |
| Needs owner decision outside OD-04? | no | yes (mandatory online identity, IdP) | yes (signing/key management) | no |

### 14.2 Decision

**Controlled-v1 mechanism = A + D:** reviewer identity is OS-local account
attribution (A), and human-decision provenance is the interactive TTY
challenge session (D). B is rejected (online dependency; a token does not prove
a human saw the presentation; GitHub approvals never become QA Agent
approvals). C is not required for Controlled-v1: software keys do not stop A4
(the same principal can use the key), and hardware user-presence keys require
a signing/key-management design that is outside current authority. C is
recorded as the future higher-assurance option (§30.3).

### 14.3 Identity record (`os-local-account-v1`)

- Source: `os.userInfo()` **only** (never `USER`, `USERNAME`, `LOGNAME`, config,
  flags or artifacts). Failure → `REVIEWER_IDENTITY_UNAVAILABLE` (5).
- `principal = "os-account-v1:" + TAP-1-escape(username)`; MUST satisfy the
  existing `isValidId` (≤ 128 code units, no control characters, trim-stable);
  otherwise refuse.
- `uid`: the POSIX uid (integer ≥ 0) or `null` on `win32` (Node reports −1).
- `platform`: `process.platform` value.
- `assurance: "LOCAL_ACCOUNT_ATTRIBUTION"` — explicitly not personal
  authentication; a shared OS account attributes all decisions to that account.
- `apply` MUST resolve the same `principal`, `uid` and `platform`; otherwise
  `APPLY_PRINCIPAL_MISMATCH` (5).

No credential, password, token, key or session secret is read, stored or
printed.

`FUTURE_REVIEWER_IDENTITY_PROVENANCE_GUARD` design disposition: **PARTIALLY
ADDRESSED BY DESIGN** (OS-account attribution, principal-bound apply) — remains
**OPEN**; residuals R-1/R-2.

---

## 15. Human decision provenance

Authenticated actor ≠ proven conscious human decision. Provenance is
established independently by the session (§9.3):

| Requirement | Mechanism |
|---|---|
| trusted renderer shows the exact canonical content | TAP-1 from decoded CRS-1 of the rebuilt package (S5, S7) |
| fresh challenge / session id | 128-bit `sessionId`, 40-bit challenge, generated after all checks, never persisted (challenge) |
| explicit selection of APPROVE or REJECT | exact typed line `APPROVE <code>` / `REJECT <code>` (S8, S9) |
| record built immediately against the same representation | S12 re-verification then S13 in the same process from the same `P`/`B` |
| stale/changed package invalidates the interaction | S12: manifest digest, crsDigest, live context, identity |
| full presentation before decision | per-target acknowledgement; challenge printed after the last target |

Approval MUST NOT come from: config, environment variables, model/provider
output, persisted status alone, automatic defaults, background tasks, CI,
`--yes`, force flags, implicit timeouts (a timeout always aborts), or piped /
pre-typed / replayed input (the challenge is fresh; non-TTY stdin is refused).

`FUTURE_HUMAN_DECISION_PROVENANCE_GUARD` design disposition: **ADDRESSED BY
DESIGN FOR A1, A3, A5, A6, A7, A8** — remains **OPEN**; residual R-1 (A4).

---

## 16. `GeneratedChangeSetReviewRecord` contract

```text
GeneratedChangeSetReviewRecord v2 REQUIRED
```

v1 is insufficient: no run, repository/root, projection, session, presentation,
serialization, path-policy, validity or consumption binding; caller-supplied
`reviewerId`/`reviewedAt`; stored `status` trusted by the gate (TSB-F02).

### 16.1 Design: authority envelope over an unchanged v1 core

v2 is an envelope whose `core` field is a **v1 record built by the unchanged v1
builder**. `apply` verifies the envelope (refusal-only, §21) and passes `core`
to #23F unchanged. #23F, its gate and `verifyApprovedChangeBinding` keep
operating on v1 exactly as today; no v2 field is ever interpreted by #23F. This
versions away from v1 for the product surface without weakening anything and
without changing #23F.

### 16.2 Schema (closed; unknown keys refused at every level)

```json
{
  "kind": "GeneratedChangeSetReviewRecord",
  "schemaVersion": 2,
  "recordId": "<sessionId: 32 lowercase hex>",
  "decision": "APPROVE | REJECT",
  "subject": {
    "runId": "<run id grammar>",
    "packageOrdinal": "<NNNN>",
    "packagePath": "generate/review-package-<NNNN>.json",
    "packageArtifactSha256": "sha256:<hex of persisted package bytes>",
    "changeSetArtifactSha256": "sha256:<hex of persisted change-set bytes>",
    "packageDigest": "sha256:...",
    "crsVersion": 1,
    "crsDigest": "sha256:...",
    "presentationVersion": "TAP-1",
    "presentationDigest": "sha256:...",
    "changeSetDigest": "sha256:...",
    "automationPlanDigest": "sha256:...",
    "repositoryContextDigest": "sha256:...",
    "automationPlanId": "<id>",
    "pathPolicy": "PPI-1",
    "targetCount": 1
  },
  "binding": {
    "projectId": "<ProjectProfile.id>",
    "projectionVersion": 1,
    "projectionDigest": "sha256:...",
    "product": { "name": "qa-ai-agent", "version": "<semver>" },
    "repositoryRoot": { "method": "root-identity-v1", "digest": "sha256:..." }
  },
  "reviewer": {
    "method": "os-local-account-v1",
    "principal": "os-account-v1:<escaped username>",
    "uid": 1000,
    "platform": "linux",
    "assurance": "LOCAL_ACCOUNT_ATTRIBUTION"
  },
  "provenance": {
    "method": "interactive-tty-challenge-v1",
    "sessionId": "<32 lowercase hex, == recordId>",
    "sessionStartedAt": "<UTC ms ISO-8601>",
    "decidedAt": "<UTC ms ISO-8601>"
  },
  "validity": { "notAfter": "<decidedAt + 24h>", "use": "SINGLE_APPLY_ATTEMPT" },
  "comment": null,
  "core": { "...": "GeneratedChangeSetReviewRecord v1, exactly as built by the v1 builder" },
  "recordDigest": "sha256:..."
}
```

`recordDigest = computeDigest("generated-change-set-review-record:v2", record without recordDigest)`
using the existing #23E canonical primitive. It is **integrity, not
authenticity** (unkeyed).

### 16.3 Field semantics

| Field | Semantics |
|---|---|
| `kind`, `schemaVersion` | `GeneratedChangeSetReviewRecord`, `2` |
| `decision` | the only authority-bearing field; closed vocabulary |
| `subject.*` | exact subject; every digest recomputed at apply (§21) |
| `subject.crsDigest` / `presentationDigest` | serialization / presentation identity (distinct from `packageDigest`) |
| `subject.changeSetDigest` | GeneratedChangeSet identity (also in `P`, and checked by #23F) |
| `subject.pathPolicy` | canonical-path policy version |
| `binding.projectId` + `projectionDigest` | project identity (§17) |
| `binding.repositoryRoot` | root identity (§17) |
| `reviewer` | identity attribution (§14) |
| `provenance` | session identity; `sessionStartedAt ≤ decidedAt ≤ sessionStartedAt + 60 min` |
| timestamps | UTC, millisecond ISO-8601 (`run-store` grammar), from the local clock; audit and validity only, never ordering authority |
| `validity.notAfter` | `decidedAt + 24 h` exactly; product constant, not configurable upward |
| `validity.use` | `SINGLE_APPLY_ATTEMPT` (§20) |
| `comment` | `null` or §9.6 string; non-authoritative |
| `core` | v1 record: `projectId = binding.projectId`, `packageDigest = subject.packageDigest`, `reviewerId = reviewer.principal`, `reviewedAt = provenance.decidedAt`, every decision = `decision`, `comment` = `comment` |
| authenticity evidence | none cryptographic (OD-04.7); integrity = `recordDigest` + core `recordDigest` |

### 16.4 Core re-derivation rule

`apply` MUST rebuild the expected core by calling the v1 builder with the
package it rebuilt itself, `reviewer.principal`, `provenance.decidedAt`,
decisions derived from `decision` (and the fixed REJECT reason), and `comment`,
and MUST require canonical equality with the stored `core`. The stored v1
`status` is therefore never trusted on the product path — it is re-derived.

### 16.5 Builder extraction (implementation requirement)

`buildGeneratedChangeSetReviewRecord` and `recomputeReviewRecordDigest` MUST
move to a gate-free module (e.g. `generated-change-set-review-record-builder.js`)
that defines no gate symbol and does not import the gate module. The existing
module keeps the gate and re-exports the builder for compatibility. Pure code
motion; no semantic change. This keeps `review record`'s module closure free of
any gate definer (§26).

### 16.6 Run-manifest and run-directory delta

```text
QaAgentRunManifest v2 REQUIRED
```

- New closed top-level field `reviews: []` of entries
  `{ packageOrdinal, recordPath, recordSha256, recordId, decision, decidedAt }`,
  append-only; the active record for a package is its last entry.
- Artifact path grammar extended with `review/record-<NNNN>-<recordId>.json`,
  `apply/attempt-<recordId>.json`, `apply/outcome-<recordId>.json`,
  `apply/applied-<NNNN>-<recordId>.json`.
- Record, attempt marker and outcome files are write-once
  (`O_CREAT|O_EXCL|O_NOFOLLOW`) through the existing root-anchored safe-write
  path. Manifest updates keep the existing compare-and-swap commit point
  (`RUN_CHANGED_DURING_COMMAND`).
- Runs created by a product version without v2 are refused by the existing
  product-version binding (exit 4); no migration.

---

## 17. Run / project / repository binding

### 17.1 Project identity

`binding.projectId` (ProjectProfile id) **and** `binding.projectionDigest`
(RunSemanticProjection v1: profile, framework, runtime, knowledge, requirements
digest) MUST equal the values recomputed from the current validated config and
requirements file, and the run manifest's projection. A human-readable name is
never used.

### 17.2 Repository-root identity (`root-identity-v1`)

```text
repositoryRoot.digest = sha256( ASCII("qa-ai-agent:repository-root-binding:v1:")
                                || UTF-8( canonicalJson({ platform, realRoot, dev, ino }) ) )
```

`realRoot` from `assertValidRepositoryRoot`; `dev`/`ino` from
`fs.lstatSync(realRoot, { bigint: true })` as decimal strings. Only the digest
is persisted (no absolute path, no username leak). Any change of path, volume
or directory object (clone, sibling, move, restore, different machine) makes
the binding mismatch → re-approval. A change of `dev` across reboot on some
filesystems fails closed the same way. No Git identity is used: the product
does not require Git, and live content is revalidated by #23F.

### 17.3 Cross-run binding

`subject.runId` MUST equal `--run`, the run directory and `manifest.runId`; the
record MUST be the active `reviews` entry of **this** manifest with matching
`recordSha256`; `packageArtifactSha256`/`changeSetArtifactSha256` MUST equal the
manifest artifact digests of package `NNNN`.

| Case | Result |
|---|---|
| same change set copied into another run | record's `runId`/manifest entry/artifact sha mismatch → `REVIEW_RECORD_RUN_MISMATCH` (4) |
| manifest modified | binding/shape/CAS failure → `RUN_*` (4) |
| requirements changed | projection mismatch → `RUN_BINDING_MISMATCH` (4) |
| review package rebuilt with different content | `packageDigest`/`crsDigest` mismatch (4) |
| package artifact replaced | manifest sha mismatch → `RUN_ARTIFACT_DIGEST_MISMATCH` (4) |
| stale record reused | expired / consumed / superseded → 5 (§20) |
| project A record in project B | projection/projectId/root mismatch (4) |
| sibling clone, same config | root binding mismatch → `REPOSITORY_BINDING_MISMATCH` (4) |

---

## 18. Time-split defenses

Threat: user views A → A changes → approval recorded → apply targets B. MUST
fail.

| Point | Built / re-derived | Compared against |
|---|---|---|
| Presentation time (S1–S7) | manifest-verified artifacts → rebuilt `P` (must equal persisted package) → PPI-1 → live context CURRENT → `B`, `crsDigest` C0, `presentationDigest`; manifest digest M0 | persisted package bytes, manifest |
| Record time (S12) | full repeat of S1–S5 after the decision | M0, C0, live context, reviewer identity I0 |
| Apply time (§21) | manifest-verified artifacts → rebuilt `P` → PPI-1 → `B` → `crsDigest`, `presentationDigest` → core re-derivation; then #23F: gate, `verifyApprovedChangeBinding`, N-21 rebuild, live filesystem revalidation (Phase 5 and fresh Phase 7) incl. §13.6 | record v2 subject/binding; live filesystem |

Approval never depends on a cached "what was shown": the record stores only
digests, and every consumer recomputes them from current bytes. If A changes
before S12 the session aborts; if it changes after S13, apply's recomputation
mismatches; if the live repository changes, #23F refuses (STALE/EXISTS) with
zero writes.

---

## 19. Representation-split defenses

| Threat | Fail-closed behavior |
|---|---|
| terminal view differs from JSON | approval is made only on TAP-1, a deterministic function of `B`; `--json` is never approval evidence and is refused for `review record` |
| bidi visual deception (Trojan Source) | every bidi/format code unit is escaped in TAP-1 and CRS-1; refused outright in paths (PPI-1) |
| escaped vs literal escape text | backslash always rendered `\\`; one escape form per code unit |
| filename looks different than actual target | PPI-1 printable-ASCII-only paths, displayed verbatim; exact on-disk name check (§13.6) |
| content truncation | TAP-1 renders every line; line counts, final-LF flag and code-unit counts printed per block |
| reordered operations | order = builder order (plannedChanges), bound in `packageDigest`/`crsDigest`; #23F binds by index |
| duplicate operations | #23D refuses duplicate paths; one review target per change |
| duplicate canonical paths | PPI-1 case-fold duplicate refusal + #23F batch/sibling checks |
| different Unicode normalization | no normalization anywhere; paths ASCII-only; content written as exact code units |
| different serialization implementations | one CRS-1/TAP-1 module used by both commands; golden vectors; decode→encode canonicality; `packageDigest` recomputed independently by the existing primitive |
| UI-impersonating model text | fixed product labels per line, gutters on content, `untrusted` labels, ASCII-only output, no ANSI |

---

## 20. Replay / staleness semantics

### 20.1 Lifetime

An APPROVE record authorizes **at most one apply attempt** for **one package**
within **24 hours** of `decidedAt`. Expired → `APPROVAL_EXPIRED` (5). A
`decidedAt` more than 5 minutes in the future of the apply host clock →
`REVIEW_RECORD_INVALID` (4).

### 20.2 Consumption (atomic reservation)

Immediately before calling #23F, `apply` MUST create
`apply/attempt-<recordId>.json` with `O_CREAT|O_EXCL|O_NOFOLLOW`. Creation is
the consumption: if the file exists, refuse `APPROVAL_ALREADY_CONSUMED` (5).
The reservation is never deleted or released. After #23F returns, `apply`
writes `apply/outcome-<recordId>.json` (write-once) and, for outcomes with an
`AppliedChangeSetRecord`, `apply/applied-<NNNN>-<recordId>.json`, then updates
the manifest. A reservation without an outcome file is `UNKNOWN_OUTCOME`.

### 20.3 Supersession

A new session for a package appends a new `reviews` entry; only the last entry
is active. Apply refuses a record that is not the active entry
(`APPROVAL_NOT_FOUND`, 5). A `REJECT` active entry → `APPROVAL_DECISION_REJECTED` (5).

### 20.4 Outcome consequences (authority semantics only; #23F unchanged)

| #23F outcome | Approval | Package state | Next allowed step |
|---|---|---|---|
| refused before any write (`ok:false`, `appliedChangeSetRecord: null`) | consumed | unchanged | new `review record` session (fresh approval), or new run |
| `APPLIED` | consumed | `APPLIED` | none for this package (`PACKAGE_ALREADY_APPLIED`, 5); human commits |
| `APPLICATION_FAILED_ROLLED_BACK` | consumed | unchanged (compensated) | new session required; retry never reuses the old approval |
| `APPLICATION_FAILED_ROLLBACK_INCOMPLETE` | consumed | `QUARANTINED` | no further `review record`/`apply` for this package (`PACKAGE_QUARANTINED`, 5); human repairs the working tree; new run |
| process crash / unknown outcome | consumed | `QUARANTINED` | as above |

Rationale: the authority to mutate is exercised by entering #23F; dropping an
attempt can never regain authority (SADR-02), and an uncertain outcome must not
be retried under the same grant.

---

## 21. Apply-time validation

`qa-agent apply --run <id> --package <NNNN>`, in order (first failure decides):

```text
A1  usage (2): --run, --package grammar; --json refused
A2  root (3), config (3), containment (3)
A3  offline contradiction (5)
A4  capability apply requested + release-enabled (5)
A5  CI refusal APPLY_CI_FORBIDDEN (5)
A6  TTY requirement INTERACTIVE_TERMINAL_REQUIRED (5); principal resolved (5)
A7  open run: manifest shape + binding (product, contracts, projection, runId) (4)
A8  package NNNN state: APPLIED / QUARANTINED -> 5; active reviews entry -> record
    path; read record bounded, strict JSON, closed v2 schema, recordSha256 ==
    manifest entry, recordDigest recomputed (4)
A9  rebuild P from manifest-verified plan/context/change set; P == persisted
    package; PPI-1 on every target; recompute B, crsDigest, presentationDigest,
    packageDigest, artifact sha256s; compare with record.subject (4)
A10 binding: projectId, projectionDigest, product, repositoryRoot digest (4)
A11 core re-derivation (§16.4) (4)
A12 decision == APPROVE else APPROVAL_DECISION_REJECTED (5); principal ==
    record.reviewer (5); now <= notAfter (5); no attempt marker (5)
A13 interactive APPLY <challenge> confirmation (5)
A14 re-check A12 expiry/marker; create attempt marker O_EXCL (consumption) (5)
A15 call applyApprovedGeneratedChangeSet({ expectedProjectId, repositoryRoot:
    realRoot, automationPlan, repositoryContext, generatedChangeSet,
    reviewPackage: persisted P, reviewRecord: record.core, appliedAt })
A16 persist outcome, AppliedChangeSetRecord, manifest update; map exit (§25)
```

A1–A14 are refusal-only: none of them grants authority. Authority is granted
solely by #23F (A15). Live filesystem revalidation, ancestor topology,
containment, protected paths and rollback are performed by #23F exactly as
today, plus §13.6.

---

## 22. #23F integration

### 22.1 Sole path

`applyApprovedGeneratedChangeSet` is the **only** application path. The CLI
MUST NOT write any file under the framework prefix itself, and MUST NOT call
`fs` write APIs on target paths outside #23F.

### 22.2 Preserved unchanged

`validateApprovedGeneratedChangeSetReview`; `verifyApprovedChangeBinding`; the
N-21 package rebuild; RP-32 snapshots; Phase 5 prevalidation; fresh Phase 7
revalidation; ancestor-topology identity; symlink/hardlink refusal; CREATE `wx`;
MODIFY staging + atomic rename + mode preservation; post-write structural
verification; rollback with identity/topology checks; `AppliedChangeSetRecord`.

### 22.3 Strengthening (allowed, narrows only)

The §13.6 exact-name check is added inside the existing revalidation used at
Phase 5 and Phase 7. It only adds refusal reasons with zero writes. No existing
refusal is removed, no input previously refused becomes accepted, and the
inputs, outputs and statuses of #23F are unchanged. Implementation requires
HEAVY review of `change-set-application.js`.

### 22.4 What apply may and may not do

May: write the exact approved bytes to the exact PPI-1 paths under the existing
framework prefix, through #23F. May not: `git add`, commit, push, create a PR,
merge, execute generated tests, publish, release, create directories (existing
#23F rule), delete or rename files.

---

## 23. CI / offline policy

| Command | `GITHUB_ACTIONS=true` or truthy `CI` | `--offline` |
|---|---|---|
| `review record` | **REFUSED** (`APPROVAL_CI_FORBIDDEN`, 5) | **permitted** (no network, no provider; identity is local) |
| `apply` | **REFUSED** (`APPLY_CI_FORBIDDEN`, 5) | **permitted** |

No GitHub Actions approval workflow, PR-comment approval, label approval,
check-run approval, or mapping of a GitHub review approval into a QA Agent
approval exists or may be added in Controlled-v1. Neither command loads
`scripts/ai/config.js` or any provider module; `AI_*` variables are ignored
(but the existing `--offline` contradiction check still applies for
consistency). No network requirement is introduced.

---

## 24. Capability enablement prerequisites

`capabilities.reviewRecord` and `capabilities.apply` move from *requested but
release-disabled* to *available* only when the installed release's
`RELEASE_CAPABILITIES` marks them enabled, and that build change is permitted
only when **all** hold:

1. OD-04 dispositioned by the PO as recommended, including OD-04.7 residual
   acceptance;
2. separate implementation authorization for Stage 4, including the package
   surface delta (shipping the #23E record builder/gate, #23F and
   `applied-change-set-record.js` modules unexported; new
   `package-surface-v5` record) — an R-5 trigger;
3. CRS-1 + TAP-1 + PPI-1 implemented with golden vectors;
4. `review record` session §9.3 and `apply` §21 implemented; record v2 and
   manifest v2 validators implemented; builder extraction §16.5;
5. §13.6 strengthening implemented in #23F;
6. all tests of §28 passing in CI (Linux), including the DC-F02 static graph
   updated per §26;
7. exact implementation HEAD independently HEAVY-reviewed (Architecture, then
   Security) and post-merge certified;
8. release-dossier evidence: disabled-path evidence for every other reserved
   command, CI-refusal evidence, non-TTY refusal evidence, and the
   `info --json` capability report;
9. `SECURITY.md` updated to describe the implemented controls without claiming
   guard closure (closure is a separate lifecycle, §10.6).

Config alone never raises authority: `reviewRecord: true` / `apply: true` in
`qa-agent.config.json` remains a request; both capabilities are enabled
**independently** (enabling `reviewRecord` without `apply` is valid; enabling
`apply` without `reviewRecord` is pointless but harmless).

---

## 25. Error / exit mapping

Existing taxonomy (`scripts/ai/cli/errors.js`) is reused. Rule: **malformed or
mismatched evidence → 4; well-formed evidence that does not grant authority,
or an absent human/terminal/identity precondition → 5**. Pipeline order
(usage → config → authority → input) still decides ties. Codes 7/8/10 stay
reserved for `execute`.

| Situation | Reason code | Exit |
|---|---|---:|
| `--json`, missing/invalid `--package` | `USAGE_OPTION_NOT_APPLICABLE`, `USAGE_MISSING_PACKAGE`, `USAGE_INVALID_PACKAGE` | 2 |
| approval/apply unavailable | `CAPABILITY_NOT_REQUESTED`, `CAPABILITY_NOT_ENABLED_IN_RELEASE` | 5 |
| CI approval / CI apply | `APPROVAL_CI_FORBIDDEN`, `APPLY_CI_FORBIDDEN` | 5 |
| non-interactive invocation | `INTERACTIVE_TERMINAL_REQUIRED` | 5 |
| reviewer identity failure | `REVIEWER_IDENTITY_UNAVAILABLE` | 5 |
| human-decision provenance failure (wrong/absent challenge, EOF, interrupt) | `HUMAN_DECISION_NOT_CONFIRMED` | 5 |
| session over 60 min | `APPROVAL_SESSION_EXPIRED` | 5 |
| package changed during approval | `REVIEW_PACKAGE_CHANGED_DURING_APPROVAL` | 4 |
| stale package (live context changed since plan) | `REVIEW_CONTEXT_STALE` | 4 |
| package digest mismatch | `REVIEW_PACKAGE_DIGEST_MISMATCH` | 4 |
| serialization / presentation / path-policy version mismatch | `REVIEW_SERIALIZATION_UNSUPPORTED` | 4 |
| canonical path refusal | `PATH_IDENTITY_REFUSED` | 4 |
| cross-run mismatch | `REVIEW_RECORD_RUN_MISMATCH` (+ existing `RUN_IDENTITY_MISMATCH`) | 4 |
| cross-project mismatch | `REVIEW_RECORD_PROJECT_MISMATCH` (+ existing `RUN_BINDING_MISMATCH`) | 4 |
| repository root mismatch | `REPOSITORY_BINDING_MISMATCH` | 4 |
| invalid approval record (shape, digest, core re-derivation, future timestamp) | `REVIEW_RECORD_INVALID` | 4 |
| review replay | `APPROVAL_ALREADY_CONSUMED` | 5 |
| no active approval / superseded | `APPROVAL_NOT_FOUND` | 5 |
| active decision is REJECT | `APPROVAL_DECISION_REJECTED` | 5 |
| approval expired | `APPROVAL_EXPIRED` | 5 |
| apply by another principal | `APPLY_PRINCIPAL_MISMATCH` | 5 |
| apply not confirmed | `APPLY_NOT_CONFIRMED` | 5 |
| package applied / quarantined | `PACKAGE_ALREADY_APPLIED`, `PACKAGE_QUARANTINED` | 5 |
| apply binding mismatch (#23F gate, `verifyApprovedChangeBinding`, N-21, changeSetDigest) | `APPLY_BINDING_MISMATCH` | 4 |
| #23F live-filesystem zero-write refusal (STALE, EXISTS, SYMLINK, PARENT_*, CASE_COLLISION, HARDLINK, NAME_MISMATCH, ESCAPE) | `APPLY_PRECONDITION_FAILED` | 4 |
| #23F failed after writes, fully compensated | `APPLY_FAILED_ROLLED_BACK` | 4 |
| #23F failed after writes, compensation incomplete | `APPLY_ROLLBACK_INCOMPLETE` | 4 |
| manifest CAS failure | `RUN_CHANGED_DURING_COMMAND` (existing) | 4 |
| unexpected exception | `INTERNAL_ERROR` | 1 |

#23F results are mapped from their structured `errors[].path` prefix and the
`AppliedChangeSetRecord.status`, never from message text. `APPLY_ROLLBACK_INCOMPLETE`
additionally prints a fixed, prominent stderr warning naming the affected
paths and the outcome file.

```text
NEW PUBLIC CLI EXIT CODE: NONE
```

A dedicated exit code for `APPLY_ROLLBACK_INCOMPLETE` is **not** required; it
is listed as an optional future owner decision (§30.1 OD-04-F2).

---

## 26. TSB-F02 analysis

Proposed call graph:

```text
review record  (future scripts/ai/cli/review-record.js)
  → run-artifacts / run-store            (load, rebuild package)
  → canonical review serialization       (CRS-1, TAP-1)       [new, gate-free]
  → path identity                         (PPI-1)              [new, gate-free]
  → v1 record builder module              (extracted, §16.5)   [gate-free]
  ✗ never imports generated-change-set-review-record.js (gate definer)
  ✗ never imports change-set-application.js
  → builds the authority record; does NOT consume the approval gate

apply  (future scripts/ai/cli/apply.js)
  → record v2 verifier                    (refusal-only; re-derives core with the builder)
  → change-set-application.applyApprovedGeneratedChangeSet      (canonical #23F)
        → validateApprovedGeneratedChangeSetReview              (sole gate call)
        → verifyApprovedChangeBinding
        → buildGeneratedChangeSetReviewPackage (N-21)
```

Evaluation against DC-F02-1..5:

| Constraint | Result |
|---|---|
| DC-F02-1 gate called only through `applyApprovedGeneratedChangeSet` | holds; `review record` cannot reach the gate module; `apply` reaches it only via #23F |
| DC-F02-2 no approval verdict from a gate or stored `status` | holds; `review record` reports the decision the human just typed; `apply` reports the #23F outcome; no `review verify`/`status` command; stored v1 `status` is re-derived, never trusted (§16.4) |
| DC-F02-3 test-design gate outside the surface | holds; untouched |
| DC-F02-4 no gate exported | holds; no export change |
| DC-F02-5 `apply` calls #23F without bypassing `verifyApprovedChangeBinding` | holds |

The Stage 4 static graph test MUST: add the `review record` entrypoint with
the existing Stage 3 rule (closure contains no gate definer, no gate-symbol
reference, no #23F); add the `apply` entrypoint whose closure may contain the
gate definer **only** via `change-set-application.js`; and assert the builder
module defines no gate symbol and imports no gate definer.

```text
TSB-F02 = OPEN / LOW / CONDITIONAL
TSB-F02 TRIGGER = FALSE
```

---

## 27. AT-07 / TB-01 mitigation mapping

| Threat | Attacker | Mitigation | Status |
|---|---|---|---|
| Authority escalation (T-ESC) | A1, A3, A7 | only `review record` creates records; closed vocabulary; no flag/config/env/model path; capability + release gate | mitigated |
| Approval spoofing (T-SPOOF) | A1, A3, A6, A7 | apply recomputes every digest and re-derives the core; TTY + challenge on apply; records only usable in the bound run/root | mitigated except A4 (R-1, R-3) |
| Reviewer substitution (T-SUBST) | A5 | OS-account attribution; apply requires the same principal; filesystem permissions | mitigated; shared-account attribution residual (R-2) |
| Non-human approval (T-NONHUMAN) | A1, A3, A7 | TTY on stdin/stdout/stderr; fresh challenge; CI refusal; no `--yes`/timeout/default | mitigated except A4 (R-1) |
| Replay (T-REPLAY) | A3, A4, A6 | O_EXCL attempt marker, single attempt, append-only manifest, supersession | mitigated (marker deletion by A4 is R-3) |
| Stale decision (T-STALE) | A2, A6 | 24 h validity; rebuild + digests at S12 and apply; #23F live revalidation | mitigated |
| Cross-run / cross-project (T-XRUN/T-XPROJ) | A6, A8 | runId, manifest entry, artifact sha, projection, projectId, root binding | mitigated |
| Presentation substitution (T-PRES) | A1, A2, A6 | Option A (TAP-1 ← CRS-1 ← rebuilt `P`), §18, §19 | mitigated |
| Model fabricates approval (AT-07 original) | A1 | the model never produces or touches a record; model text cannot reach the decision line; `untrusted` labels | mitigated |
| Forged approval accepted by #23F (TB-01) | A6, A4 | product path accepts only v2 envelopes whose cores are re-derived from rebuilt content and that pass session-independent checks; forging still needs the apply TTY confirmation | mitigated except A4 (R-1/R-3) |

```text
AT-07/TB-01 = RESIDUAL
```

Residual: an automation running as the **same OS principal** with the ability
to drive a pseudo-terminal can complete both interactive sessions (or forge an
unkeyed record and complete the apply session). No userspace design without a
hardware user-presence factor can distinguish it from the human. This is
consistent with existing canonical posture (#23F "never claims immunity to a
hostile co-resident local process"; capability gating is "not a security
isolation boundary"). The threat-model lifecycle is **not** closed by this
design.

---

## 28. Required implementation tests

All tests are future work; none is added here.

**Codecs and rendering**

- CRS-1 golden vectors: ASCII, every escaped class of §12.2, astral pairs,
  lone surrogates, literal `\u202e` text, `"`/`\`, key ordering, integers,
  `-0`; decode∘encode identity; non-canonical inputs refused (short escapes,
  uppercase hex, whitespace, duplicate keys, reordered keys, BOM, missing LF).
- TAP-1 golden output for a fixed package; no byte outside `0x20–0x7E`/LF;
  no truncation for maximum-size content; line/finalLF/code-unit counts;
  output identical across Node versions (no `\p{}` dependence).
- `presentationDigest` recomputation equality between `review record` and
  `apply`.

**Path identity (PPI-1) — each must be refused**

`cypress\e2e\a.cy.js`, `/cypress/a.cy.js`, `C:/x`, `cypress/../a`,
`cypress/./a`, `cypress/.hidden/a`, `cypress/a.cy.js.`, `cypress/a .cy.js`,
`cypress/a.cy.js:stream`, `cypress/CON.cy.js`, `cypress/com1/a.cy.js`,
`cypress/NODE~1/a`, `cypress/node_modules./a`, `cypress/NODE_MODULES/a`,
`cypress/.env.local`, `Cypress/a.cy.js`, bidi/zero-width/BOM/NBSP/Cyrillic
homoglyph variants, NFC vs NFD `é`, U+2028 in a segment, 101-character
segment, 301-character path; case-fold duplicate pair in one package; live
`cypress/E2E` vs on-disk `cypress/e2e` (§13.6, both Phase 5 and Phase 7).

**Interaction and provenance**

- non-TTY stdin / stdout / stderr each refused (5) before any run read;
- piped input containing a valid-looking `APPROVE <code>` refused (non-TTY)
  and pre-typed typeahead cannot match a fresh challenge;
- wrong challenge ×3, wrong case, extra spaces, `approve`, trailing text → no
  record; EOF, SIGINT, SIGHUP → no record, no manifest change;
- session > 60 min → no record; decision before final target impossible;
- `CI=true`, `CI=1`, `GITHUB_ACTIONS=true` refused for both commands;
  `--json`, `--yes`, `--force`, `--decision` refused as usage;
- identity from `os.userInfo()` only: `USER`/`USERNAME` overrides ignored;
- comment with non-ASCII/control/bidi re-prompts; comment never affects
  decision.

**Time-split / representation-split (hostile)**

- package bytes, change set, plan, context, manifest or requirements changed
  between S5 and S12 → no record; changed after S13 → apply refuses;
- live repository context changed before session → `REVIEW_CONTEXT_STALE`;
- hostile `purpose` impersonating prompts/approval text rendered escaped and
  labeled; RLO in content shown as `\u202e`;
- persisted package replaced by a self-digest-consistent forged package →
  refused (rebuild inequality).

**Record, binding, replay**

- v2 closed schema (unknown key at each level refused); `recordDigest`
  tamper; core tamper (status flipped to APPROVED with REJECT decisions; any
  per-target decision changed) refused by re-derivation;
- cross-run copy, cross-project copy, sibling clone, moved root, restored
  root → refused;
- second apply with same record → `APPROVAL_ALREADY_CONSUMED`; concurrent
  applies → exactly one reservation succeeds; marker deleted mid-way does not
  re-enable after outcome written; superseded record refused; REJECT refused;
  expired refused; future `decidedAt` refused; other principal refused;
- each #23F outcome (zero-write refusal, APPLIED, ROLLED_BACK,
  ROLLBACK_INCOMPLETE, simulated crash) produces the §20.4 state and exit.

**Graph / regression**

- DC-F02 static graph per §26; `review record` and `apply` closures load no
  provider or `scripts/ai/config.js`;
- `review show` byte-identical behavior and output to Stage 3;
- existing #23E/#23F/N-21/RP-32/CS2 tests unchanged and passing; v1 gate still
  refuses a v2 object passed directly (schemaVersion 2);
- no secret or token in record, manifest, stdout, stderr (secret-scoping test).

---

## 29. Security invariants

- **INV-01** No approval record exists except one written by a completed
  `interactive-tty-challenge-v1` session of `review record`.
- **INV-02** Only `APPROVE` grants; only in the S9 grammar; only as the human's
  typed input.
- **INV-03** The bytes written by #23F equal the approved bytes, and the paths
  written equal the approved PPI-1 strings, byte-for-byte.
- **INV-04** The approved representation is TAP-1 of CRS-1 of the rebuilt
  canonical package; `apply` recomputes all three digests.
- **INV-05** `applyApprovedGeneratedChangeSet` is the sole write path; its
  checks are never bypassed or replaced.
- **INV-06** No product module other than `change-set-application.js` reaches
  an approval gate; no command reports a verdict from a gate or stored status.
- **INV-07** An approval is consumed atomically before #23F is entered and is
  never released.
- **INV-08** An approval never crosses run, package, project, projection,
  repository root, product version or principal.
- **INV-09** CI never records or applies; non-interactive invocation never
  records or applies.
- **INV-10** No path or content is normalized between approval and write.
- **INV-11** No secret, credential, token or key appears in any record,
  manifest, artifact, stdout or stderr.
- **INV-12** Config, environment, flags and model output can never raise
  authority; release enablement is a build property.
- **INV-13** `review show` remains non-authoritative and is never approval
  evidence.
- **INV-14** Uncertainty (unknown outcome, failed check, missing data) never
  creates authority.

---

## 30. Open decisions

### 30.1 Decisions

| ID | Decision | Owner | Recommendation |
|---|---|---|---|
| OD-04 | Approval authority model (§7) | Product Owner (`ODR-02` owner) | **APPROVE** as worded in §7 |
| OD-04-F1 | Validity window (24 h) | Product Owner | accept 24 h; may only be shortened |
| OD-04-F2 | Dedicated exit code for `APPLY_ROLLBACK_INCOMPLETE` | Product Owner | **not required**; defer (exit 4 + distinct reason code) |
| Stage 4 implementation authorization | incl. package surface delta (§24 item 2) | Product Owner / Governance | separate mission; this design does not authorize it |

### 30.2 Residual risks requiring PO acceptance under OD-04.7

| ID | Residual |
|---|---|
| R-1 | Same-OS-principal automation able to drive a pseudo-terminal (e.g. an AI coding agent with shell access) can complete the approval and apply sessions. Not distinguishable from the human without a hardware user-presence factor |
| R-2 | Reviewer identity is OS-account attribution; a shared OS account cannot distinguish people |
| R-3 | Records and attempt markers are unkeyed local files; a same-principal actor can forge or delete them (forging still requires the interactive apply confirmation; deletion of a marker after use can re-enable a replay only for that actor) |
| R-4 | The existing #23F TOCTOU window between final revalidation and the mutating syscall (unchanged, `SECURITY.md` §24) |
| R-5 | Human factors: a genuine reviewer can approve harmful content or misunderstand escaped text; the digests prove correspondence, not comprehension |

### 30.3 Deferred (not Controlled-v1)

- Hardware-backed user-presence attestation (FIDO2/WebAuthn-style) or other
  signing — would address R-1/R-3; requires its own signing/key-management
  design and owner decision.
- Reviewer role registry / multiple-reviewer policies.
- A diff view inside TAP (would be an additional derived representation).

### 30.4 Documentation follow-ups (upon OD-04 approval; not done here)

- `docs/controlled-v1-productization-contract-v1.md` §10.2, §10.9, §14, §16,
  §22 rows for `review record`/`apply` to reference this contract.
- `ROADMAP.md`: **no ROADMAP conflict found**; lifecycle sync remains the
  Governance Coordinator's action (`ROADMAP: UNCHANGED`).

---

## 31. Implementation impact forecast (NOT AUTHORIZED)

| Area | Likely change |
|---|---|
| `scripts/ai/cli/args.js` | `review record`/`apply` move from `reserved` to real specs; `--package` flag; `--json` not applicable |
| `scripts/ai/cli/policy.js` | `RELEASE_CAPABILITIES.reviewRecord/apply` enabled only at enablement time (§24) |
| new `scripts/ai/cli/review-record.js`, `scripts/ai/cli/apply.js` | §9.3, §21 |
| new `canonical-review-serialization.js` (CRS-1 + TAP-1), `path-identity.js` (PPI-1), `review-record-v2.js` (validator), terminal I/O helper | §10–§13, §16 |
| `scripts/ai/cli/run-store.js` | `QaAgentRunManifest v2`, path grammar, write-once files, reviews ledger |
| `scripts/ai/cli/generative.js` / `run-artifacts.js` | PPI-1 at plan/generate acceptance |
| `scripts/ai/test-automation/generated-change-set-review-record.js` | builder extraction (code motion) |
| `scripts/ai/test-automation/change-set-application.js` | §13.6 exact-name refusal (strengthening only) |
| `package.json` `files` + `docs/package-surface-v5.md` | ship builder/gate/#23F/applied-record modules unexported; R-5 trigger |
| tests | §28; DC-F02 static graph update; package-surface minimality |
| `SECURITY.md` | implemented controls; guards remain OPEN until a closure lifecycle |

Estimated scope: one serial implementation stage (`WIP = 1`) with HEAVY
Architecture then Security review.

---

## 32. STOP conditions

### 32.1 Evaluated in this mission

| Condition | Result |
|---|---|
| design baseline changed | not met (verified, §4) |
| cryptographic signing / key management required | **not met** for Controlled-v1 under OD-04.7; becomes `STOP — SIGNING / KEY MANAGEMENT DESIGN REQUIRED` if the PO rejects R-1 |
| external identity provider / mandatory online identity | not met (local, offline) |
| new public API | not met (no export change) |
| new distribution service | not met |
| OS/platform support matrix | not met (§13.8, OD-06 not entered) |
| CI approval authority | not met (refused) |
| partial/per-file approval | not met (whole package) |
| change of #23F authority semantics | not met (wrap + narrowing only, §22.3) |
| TSB-F02 TRUE/UNRESOLVED | not met (FALSE, §26) |
| autonomous or LLM/provider-generated approval | not met (forbidden) |
| new public CLI exit code | not met (none) |
| runtime/test change needed by this design mission | not met |

### 32.2 Future STOP triggers (implementation lifecycle)

- any path that creates a record outside the §9.3 session, or any flag/env/
  config that substitutes for the typed decision;
- any change that makes `review record` reach a gate definer or #23F, or makes
  `apply` reach a gate other than through #23F →
  `STOP — TSB-F02 TRIGGER MUST BE RE-EVALUATED`;
- any normalization of paths or content between approval and write;
- any network, GitHub or CI dependency for approval or apply;
- any need for a new exit code → `STOP — PUBLIC CLI CONTRACT DECISION REQUIRED`;
- any #23F change beyond §22.3;
- enabling either capability before every §24 prerequisite holds.

---

`IMPLEMENTATION NOT AUTHORIZED` · `MERGE NOT AUTHORIZED` ·
`FUTURE_REVIEW_PRESENTATION_BINDING_GUARD OPEN` · `AT-07/TB-01 RESIDUAL`
