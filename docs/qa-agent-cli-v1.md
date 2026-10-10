# `qa-agent` CLI v1 — Controlled-v1 Stages 1–2

Status: **implemented on branch `feature/controlled-v1-productization-stages-1-2`**
(authority `OD-CONTROLLED-V1-PRODUCTIZATION-STAGES-1-2-IMPLEMENTATION`).
Governing design: [`controlled-v1-productization-contract-v1.md`](controlled-v1-productization-contract-v1.md).
This document describes the implemented Stage 1–2 surface only. It does not
change `ROADMAP.md` lifecycle state and does not authorize Stage 3+, release or
publication.

## 1. Package surface

| Surface | State |
|---|---|
| `exports` | **unchanged** — the same five keys and targets; 19 root names |
| `bin` | **added**: `qa-agent` → `scripts/ai/cli/qa-agent.js` (not exported; requiring it is unsupported) |
| Supported entrypoints | `exports ∪ bin` (package-surface minimality is computed over this union) |
| Tarball | 47 baseline files + 14 `scripts/ai/cli/*.js` modules = 61 files (closed list, tested) |
| Not shipped | `#22`/`#23`/`generation/**` (OD-02 not entered), tests, fixtures |

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
| `design`, `plan`, `generate`, `review show` | reserved (OD-02) | — | — | none — fixed refusal, exit 5 |
| `review record`, `apply` | reserved (OD-04) | — | — | none — fixed refusal, exit 5 |
| `execute` | reserved (OD-06) | — | — | none — fixed refusal, exit 5 |

Reserved commands return `CAPABILITY_NOT_ENABLED_IN_RELEASE` without reading
the root, the config or any other input, and load no review-gate, `#22`/`#23`
or approval module. There is no `commit`, `push`, `pr`, `merge`, `publish`,
`release`, `regenerate`, `init`, `review verify`/`status` command and no
`--provider` flag. The CLI never prompts.

Global options: `--root <dir>` (default: cwd; never searched upward),
`--config <path>` (must resolve inside the root), `--offline`, `--json`.

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
and canonically, case-insensitively.

A known capability that the release does not enable (e.g. `"apply": true`) is
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

Steps 7–10 apply to `triage analyze` and `triage run`. Step 6 is enforced for
`requirements check` and `triage *`; `info` and `config validate` report it.

## 5. Exit codes and output

`0` ok · `1` internal · `2` usage · `3` configuration · `4` input refused ·
`5` authority refused · `6` provider/network/model-output failure. `7`/`8`/`10`
are reserved for `execute` and are never produced by Stage 1–2.

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

## 9. Not in Stages 1–2

`#22`/`#23` shipping and `design`/`plan`/`generate`/`review show` (OD-02),
`review record`/`apply` (OD-04), `execute` and any OS support statement
(OD-06), run manifests, release/publication. `TSB-F02` remains
`OPEN / LOW / CONDITIONAL` with trigger `FALSE`, enforced by a static import
test over every shipped module.
