# `qa-agent` CLI v1 — Controlled-v1 through Stage 4B

Status: Stages 1–3 and Stage 4A are complete on `main`.
Stage 4B **COMPLETE_ON_MAIN / POST-MERGE CERTIFIED**, implementation
[PR #249](https://github.com/TarasovArtem/qa-ai-agent/pull/249), under
`OD-CONTROLLED-V1-STAGE-4B-ACTIVATION — APPROVED`.
See [activation evidence](controlled-v1-stage4b-activation.md) for the exact
reviewed HEAD, merge SHA/TREE, parents and fresh post-merge main/push CI.
Release state: `reviewRecord = enabled`, `apply = enabled`, `execute = disabled`.
Review recording/application require target-owned validated config opt-in.
Current lifecycle: OD-06 **COMPLETE_ON_MAIN / POST-MERGE CERTIFIED**
(design PR [#254](https://github.com/TarasovArtem/qa-ai-agent/pull/254), merge
`22ceb0682f9b56c2fbefdbad35273b7c21225d89`; certified contract
[`controlled-v1-execution-contract-v1.md`](controlled-v1-execution-contract-v1.md));
Stage 5 **READY / NOT AUTHORIZED**; execute **DISABLED**; Controlled Release
**NOT APPROVED**. OD-06 design certification causes no activated CLI behavior
change: `execute` remains a fixed release refusal (exit 5) until Stage 5
implementation and activation are separately authorized and completed.
`TSB-F02` proposed execute trigger remains `FALSE`.
The installed `info` output still reports `platform.executeDecision:
"PENDING_OD_06"` / `supportStatement: "NOT_DECIDED"`; that production wording
is unchanged by this documentation sync and its update is Stage 5 work.
Governing design: [`controlled-v1-productization-contract-v1.md`](controlled-v1-productization-contract-v1.md).
This document describes the implemented surface only. It does not change
`ROADMAP.md` lifecycle state and does not authorize `execute`, merge, release
or publication.

## 1. Package surface

| Surface | State |
|---|---|
| `exports` | **unchanged** — the same five keys and targets; 19 root names |
| `bin` | **added**: `qa-agent` → `scripts/ai/cli/qa-agent.js` (not exported; requiring it is unsupported) |
| Supported entrypoints | `exports ∪ bin` (package-surface minimality is computed over this union) |
| Tarball | unchanged 103-file Stage 4A inventory (closed list, tested; [`package-surface-v5.md`](package-surface-v5.md)) |
| Shipped private (Stage 3, OD-02) | the minimal `#22`/`#23`/`generation` closure of `design`/`plan`/`generate`/`review show` — not exported, unsupported for import |
| Shipped private (Stage 4A) | review/apply runtime and canonical #23F/#23E closure; `SHIPPED_PRIVATE_RUNTIME_DEPENDENCY`, never exported |
| Not shipped | test-design approval gate, execute/regeneration modules, tests, fixtures, evaluation |

Install and run from a target repository (no global install, no checkout):

```text
npm install --save-dev --save-exact <qa-ai-agent tarball or version>
npx qa-agent --version
```

## 2. Commands

| Command | Class | Provider | `--offline` | Writes |
|---|---|---|---|---|
| `--version`, `--help`, `<command> --help` | baseline | none | n/a | nothing |
| `info [--json]` | baseline | reported only, never constructed | valid (contradiction reported) | nothing |
| `config validate` | baseline | reported only | valid | nothing |
| `requirements check` | baseline (deterministic RTI-2→5) | none | valid | `<output.dir>/requirements/requirements-check.json` |
| `triage collect` | `capabilities.triage` | none | valid | `reports/ai/context.json` |
| `triage history` | `capabilities.triage` | none (GitHub API) | **refused (5)** | `reports/ai/history.json` |
| `triage aggregate` | `capabilities.triage` | none | valid | `reports/ai/context.json`, `history.json` |
| `triage analyze` | `capabilities.triage` | effective provider | valid with `mock` | `reports/ai/ai-report.json` |
| `triage run [--history]` | `capabilities.triage` | effective provider | valid without `--history` | collect → [history] → analyze |
| `design` | `capabilities.design` | **generative** (`groq`/`gemini`) | **refused (5)** | new run `<output.dir>/runs/<runId>/` (manifest + design artifacts) |
| `plan --run <id>` | `capabilities.plan` | **generative** | **refused (5)** | plan artifacts in the run |
| `generate --run <id>` | `capabilities.generate` | **generative** | **refused (5)** | GeneratedChangeSet + review package in the run (proposal only) |
| `review show --run <id>` | `capabilities.generate` | none | valid | nothing (read-only, non-authoritative) |
| `review record --run <id> --package <NNNN>` | `capabilities.reviewRecord` | none | valid | durable whole-package decision and manifest ledger, after TAP-2 |
| `apply --run <id> --package <NNNN>` | `capabilities.apply` | none | valid | one canonical #23F attempt and durable outcome, after same-principal approval and confirmation |
| `execute` | reserved (OD-06 design certified; Stage 5 not authorized) | — | — | none — fixed refusal, exit 5 |

Reserved commands return `CAPABILITY_NOT_ENABLED_IN_RELEASE` without reading
the root, the config or any other input, and load no review-gate, `#22`/`#23`
or approval module. There is no `commit`, `push`, `pr`, `merge`, `publish`,
`release`, `regenerate`, `init`, `review verify`/`status` command and no
`--provider` flag. Only `review record` and `apply` prompt, through the existing
Stage 4A interaction. Both require explicit validated target config opt-in;
missing/false returns `CAPABILITY_NOT_REQUESTED`. CI refuses both commands
(`APPROVAL_CI_FORBIDDEN` / `APPLY_CI_FORBIDDEN`). No target opt-in is added by
the product.

Global options: `--root <dir>` (default: cwd; never searched upward),
`--config <path>` (must resolve inside the root), `--offline`, `--json`;
`--run <id>` for `plan`/`generate`/`review show`/`review record`/`apply` (closed grammar
`yyyymmddThhmmssZ-<16 hex>`; missing → `USAGE_MISSING_RUN`, malformed →
`USAGE_INVALID_RUN_ID`, both exit 2).
`--package <NNNN>` is mandatory for `review record`/`apply` only (four ASCII
digits, excluding `0000`; missing/invalid → `USAGE_MISSING_PACKAGE` /
`USAGE_INVALID_PACKAGE`, exit 2). These commands refuse `--json` and accept
no automated decision or confirmation flags.

## 3. Configuration — `qa-agent.config.json` v1

Closed schema (`schemaVersion: 1`; unknown keys refused): `projectProfile`
(existing strict ProjectProfile), `framework` (`cypress` | `playwright`; sole
framework authority), optional `frameworkRuntime` / `knowledge` (existing
validators, must bind to `projectProfile.id` and `framework`),
`requirements` (`source: "file"`, safe relative `.json` path), `capabilities`
(closed boolean set, all default `false`), `providers.allow` (subset of
`mock`/`groq`/`gemini`, default `["mock"]`), `output.dir` (default
`reports/qa-agent`). No secrets: credentials come only from the environment.

Read hardening: the file is opened once and read through that descriptor with
a 64 KiB + 1 byte bound (exactly 64 KiB accepted); a symlinked leaf, a
canonical location outside the root, or a descriptor whose identity differs
from the checked leaf is refused; a BOM (UTF-8 or UTF-16) is refused, never
stripped; invalid UTF-8, non-standard JSON, duplicate keys at any depth and
`__proto__`/`constructor`/`prototype` keys are refused. The result is a
detached, deeply frozen snapshot; stage children receive these validated
values over IPC and never re-read the file.

Path containment: `requirements.path` and `output.dir` must be safe POSIX
relative paths and must realpath inside the root (symlink/junction escapes
refused). `output.dir` must not overlap `.git`, `node_modules`, `cypress`,
`playwright`, `frameworkRuntime.testSourceRoot` or the config file — lexically
and canonically, case-insensitively. `requirements check` applies the same
canonical check to its effective report directory
`<output.dir>/requirements` before creating anything and again immediately
before the write, so a symlink/junction below `output.dir` into a protected
location is refused (exit 5, `WRITE_TARGET_REFUSED`).

Requirements file leaf (ARCH-S3-m04). The two command families intentionally
differ on a symlinked `requirements.path` leaf:

- `requirements check` keeps its existing semantics: a symlink whose
  canonical target resolves inside the repository root is followed (an
  out-of-root target is refused).
- `design`, `plan`, `generate` and `review show` require the configured
  requirements file itself to be a **regular, non-symlink file**. They read it
  once, bounded, through the same descriptor-identity checks as run
  artifacts, and digest its exact bytes into the run binding. A symlinked
  leaf is refused **fail-closed** with exit 4 `REQUIREMENTS_INPUT_REFUSED`
  before any child, provider or write — also for `plan` / `generate` /
  `review show` of an existing run, so a run cannot be continued through a
  symlink swapped in after `design`. This narrowing is deliberate; replace
  the link with the file it points to.

A known capability that the release does not enable (e.g. `"execute": true`) is
schema-valid: `config validate` exits 0 and reports
`requested: true, available: false` with the reason; invoking it exits 5.

## 4. Normative validation order (ARCH-PROD-C1-m01)

The first failing step decides the exit code; nothing later runs, and no
child, provider, network call or write happens before step 13.

| # | Step | Exit |
|---:|---|---:|
| 1 | CLI syntax / usage (reserved commands stop here: fixed refusal, 5) | 2 |
| 2 | root resolution | 3 |
| 3 | bounded config load | 3 |
| 4 | config structural + semantic validation (+ `QA_FRAMEWORK` vs config for triage) | 3 |
| 5 | path containment | 3 |
| 6 | offline mode resolution (`OFFLINE_PROVIDER_CONTRADICTION`, `OFFLINE_NETWORK_STAGE_REFUSED`) | 5 |
| 7 | effective provider selection (`AI_PROVIDER`, default `mock`) | 3 |
| 8 | `providers.allow` ceiling (`PROVIDER_NOT_ALLOWED`) | 5 |
| 9 | command/provider compatibility | 5 |
| 10 | credential/model presence, provider-consuming commands only | 3 |
| 11 | release capability authorization | 5 |
| 12 | invocation trust setup (XI-01) | 5 |
| 13 | child spawn / provider construction / network / write | — |

Steps 7–10 apply to `triage analyze`, `triage run`, `design`, `plan` and
`generate`. For the generative commands step 9 is the generative fit: `mock`
or `--offline` → exit 5 `CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`. Step 6 is
enforced for `requirements check`, `triage *`, the generative commands and
`review show`, `review record` and `apply`; `info` and `config validate` report it. For the generative
commands, every run/artifact input check (exit 4) and the run-directory write
authorization (exit 5) also complete before step 13.
Stage 4 retains its product-owned release gate before config access, then
config/containment, offline contradiction and opt-in enforcement, followed by
the unchanged Stage 4A CI, terminal, principal, run, approval and durability
checks. Its stdout belongs to TAP-2 rather than the result-envelope formatter.

## 5. Exit codes and output

`0` ok · `1` internal · `2` usage · `3` configuration · `4` input refused ·
`5` authority refused · `6` provider/network/model-output failure. `7`/`8`/`10`
are reserved for `execute` and are never produced by Stages 1–3.

stdout carries only the result; with `--json` exactly one JSON object
(`schemaVersion`, `command`, `ok`, `exitCode`, `runId`, `artifacts`, `errors[]`
with stable `code`, plus command fields). stderr carries bounded diagnostics
(stage logs are forwarded there, capped and with known secret values
redacted); no stack traces, raw provider payloads, prompts or secrets.

## 6. Provider and offline rules

`AI_PROVIDER` (default `mock`) is the only selector. Unknown → 3; not in
`providers.allow` → 5; network provider without `AI_API_KEY`/`AI_MODEL` → 3;
runtime/network failure or malformed model output → 6. No fallback, ever.
`--offline` admits only `mock`, disables the GitHub History API, and passes no
network credential to any stage; an ambient non-mock `AI_PROVIDER` under
`--offline` is refused (5), never replaced.

## 7. Child isolation and environment (ARCH-PROD-C1-m02, SEC-PROD-L03)

Every triage stage runs as `process.execPath scripts/ai/cli/stage-runner.js
<stage>` — entrypoint resolved package-relatively, argv array, `shell: false`,
no `npm run`, no PATH lookup of the entrypoint. The CLI parent never loads
`scripts/ai/config.js`, a provider, or a stage module; those snapshot
`AI_*` at load time and are loaded only in the child, whose environment
already equals the parent's decision.

The child environment is built from `{}`:

| Stage | Keys (besides platform baseline `PATH SYSTEMROOT WINDIR TEMP TMP HOME USERPROFILE APPDATA LOCALAPPDATA CI`, `QA_FRAMEWORK`, `TEST_BROWSER`) |
|---|---|
| collect | invocation keys; in GitHub mode also `GITHUB_HEAD_REF/REF_NAME/EVENT_NAME` |
| aggregate | invocation keys |
| analyze | invocation keys, `AI_PROVIDER`; `AI_API_KEY`/`AI_MODEL` only for an effective network provider and never offline |
| history | `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `GITHUB_API_URL`, `GITHUB_RUN_ID`, `HISTORY_RUNS/BRANCH/JOB_NAME` (never offline) |

Invocation keys: `GITHUB_ACTIONS=true` + `GITHUB_REPOSITORY/SHA/RUN_ID/RUN_ATTEMPT`
(github-actions-v1, forwarded only when ambient), or
`QA_AI_INVOCATION_MODE`/`QA_AI_INVOCATION_ID` (local-v1). `NODE_OPTIONS`,
`NODE_PATH`, `NODE_DEBUG`, `npm_*` and all other keys are never inherited; key
matching is case-insensitive on Windows. Node adds its own IPC channel keys
(`NODE_CHANNEL_*`) to the child.

## 8. Triage trust (XI-01, XI-02, TSB-F04/F06/F07)

`triage run` (local) generates one fresh 128-bit CSPRNG id per logical run and
passes it to every stage; ambient `QA_AI_INVOCATION_*` alongside `triage run`
is refused as contradictory. Per-stage local commands require the caller's
pair and forward it verbatim; the stage's own grammar/binding check decides,
so persisted context cannot be rebound to a fresh id. The CLI never sets
`GITHUB_ACTIONS`. All XI-02 (separate History artifact, no `context.history`,
unavailable ≠ zero) and TSB-F04/F06/F07 enforcement stays inside the certified
stage functions; the CLI adds no bypass.

## 9. Stage 3 — design, plan, generate, review show (OD-02)

**Chain.** `requirements → design → plan → generate → review show`, all bound
to one run:

| Command | Consumes | Produces (in `<output.dir>/runs/<runId>/`) |
|---|---|---|
| `design` | `requirements.path` → canonical evidence (#22B) | `design/requirement-model.json`, `design/test-case-model.json`, `design/automation-candidate-NNNN.json` (one per test case) |
| `plan` | design artifacts; live repository context (framework config + `package.json` scripts) | `plan/automation-repository-context.json`, `plan/automation-plan-NNNN.json` (one per `AUTOMATE` candidate; none → exit 4 `NO_AUTOMATE_CANDIDATE`) |
| `generate` | design + plan artifacts; context must still equal the live repository | `generate/generated-change-set-NNNN.json`, `generate/review-package-NNNN.json` |
| `review show` | the whole run | stdout only |

**Generative provider.** `design`/`plan`/`generate` require an allowed
`groq` or `gemini` provider with `AI_MODEL`/`AI_API_KEY`. `mock` and
`--offline` are refused before any child process exists; there is no
fallback and no offline generation. Provider calls run only in an isolated
child (`scripts/ai/cli/generative-runner.js`, `process.execPath`, argv array,
`shell: false`) whose environment is built from `{}` with only the platform
baseline, `AI_PROVIDER`, `AI_MODEL` and `AI_API_KEY` — no `QA_FRAMEWORK`,
invocation, GitHub or `npm_*` key. The parent never loads `config.js` or a
provider; it validates the child's output with the existing validators before
writing anything.

**Run manifest and binding** (`manifest.json`, `QaAgentRunManifest` v1):
run id, product name/version, `RunSemanticProjection` v1 version + SHA-256
(`projectProfile`, `framework`, `frameworkRuntime`, `knowledge`,
`requirements.source`/`path` + SHA-256 of the requirements file — never
`capabilities`, `providers.allow` or `output.dir`), artifact contract
versions, and per stage the provider name/model plus every artifact's path,
kind, schema version and SHA-256 of its bytes. Each later command recomputes
the projection and refuses (exit 4) a different run id
(`RUN_IDENTITY_MISMATCH`), product version or projection
(`RUN_BINDING_MISMATCH`), wrong stage order (`RUN_STAGE_ORDER`), a repeated
stage (`RUN_STAGE_ALREADY_COMPLETED`), changed artifact bytes
(`RUN_ARTIFACT_DIGEST_MISMATCH`) or an artifact that fails schema/semantic
re-validation (`RUN_ARTIFACT_INVALID`). Artifacts of another run are never
adopted. Digests detect corruption, staleness and substitution; they are not
authenticity and carry no approval.

**Writes.** Only below the authorized run directory, which is checked for
canonical containment and protected-path overlap before any provider call
(redirects → exit 5 `WRITE_TARGET_REFUSED`); artifacts first, manifest last;
nothing is written when generation or validation fails. Target source files,
the requirements file and the config are never written. Proposed changes are
data only — never applied.

**Provider output confidentiality.** Child stdout/stderr is never forwarded
(only a "withheld" count); failures report the step, attempt count and
closed-vocabulary reason codes only — never model text, validator paths,
prompts, keys or stacks.

**`review show`.** Re-validates the entire run, re-derives each review
package from the persisted plan/context/change set and requires equality with
the persisted package, then prints it with an explicit **non-authoritative**
statement. The human view shows every C0/C1 control character, every Unicode
format character (bidi embeddings/overrides/isolates, zero-width characters,
BOM, …), the line/paragraph separators and lone surrogates escaped as
`\uXXXX` / `\u{XXXXX}`, and a literal backslash as `\\`, so the rendering is
unambiguous and cannot be visually reordered; nothing is deleted, and the
persisted package and the `--json` data keep the exact characters
(ARCH-S3-m05). It is not Option A and not approval evidence. It records, reads,
infers and reports no approval and reports whether the live repository still
matches the context (`CURRENT` / `CHANGED_SINCE_GENERATE` / `UNAVAILABLE`).

**DC-F02 / TSB-F02.** No Stage 3 entrypoint reaches
`validateApprovedGeneratedChangeSetReview`, `validateApprovedTestDesignReview`
or the #23F apply consumer. The change-set gate ships privately for Stage 4,
only #23F consumes it and independently rechecks per-target APPROVE binding;
the test-design gate remains unshipped. Neither gate is exported; there is no
`review verify`/`status` command. Enforced by a static import graph over the
shipped files (`test/security/controlled-v1/dc-f02-static-graph.test.js`).
`TSB-F02` remains `OPEN / LOW / CONDITIONAL`, trigger `FALSE`.

## 10. Outside the activated CLI surface

Cryptographic approval authenticity, physical-human proof, externally
authenticated reviewer identity, `execute` and any
OS support statement (OD-06), release/publication, a programmatic generative
API (OD-07).
