# OD-RATE-1-C2-R3 — Provider Governor Design (Consolidated Corrective C3)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-design.md` (1 of 3; companions: [proofs](od-rate-1-c2-r3-proofs.md), [review matrix](od-rate-1-c2-r3-review-matrix.md)) |
| Status | **DESIGN — PENDING INDEPENDENT HEAVY REVIEW.** Not approved. No implementation, contract amendment, ROADMAP entry, merge or release is authorized by this document. |
| Issue | #258 (OPEN; not modified by this corrective) |
| Baseline (review) | `main` HEAD `a32a6cd7e0a1bdc9917fc3abc7f692039591a145`, TREE `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Baseline (historical C2) | HEAD `52e23acf0f7e5d2f7fce2b406a27de51ae1af68c`, TREE `176960ba98b1e7babfee553729200c49d748d7ca` |
| Supersedes | The governor architecture of OD-RATE-1-C2 (§2.2) for the seven findings in §2.3. C2 itself is preserved unmodified as historical evidence. |
| Author | Claude Code (same account that authored OD-RATE-1, C1 and C2). **This author cannot approve this design**; an independent reviewer is required. |

Normative keywords: **MUST**, **MUST NOT**, **SHOULD**, **MAY** as in RFC 2119.
Durations are integer milliseconds on a monotonic clock unless stated otherwise.

---

## 1. Purpose and scope

This document specifies an opt-in **provider governor** for the provider-backed
generative stages (`design`, `plan`, `generate`) of the `qa-agent` CLI. The
governor delays or refuses provider requests so that the process stays within
operator-declared request-rate (RPM) and heuristic token-rate (TPM) budgets, and
it bounds governed stages in time.

C3 is a consolidated, design-only corrective. It answers every confirmed finding
of the independent HEAVY Architecture Design Review of C2 (§2.3) and integrates
the certified FT0 SEC-C1 lifecycle that landed on `main` after C2 was written.

In scope:

- Governor state model, joint RPM + TPM admission, reservation and usage accounting.
- Wait-loop revalidation, cancellation, stage deadline, heartbeat and watchdog.
- Closed reason-code propagation from the governor to the CLI envelope.
- Configuration schema v2 (opt-in) and exact v1 compatibility.
- Integration with the certified SEC-C1 cancellation and result receipt/ACK protocol.

Out of scope (unchanged and not designed here):

- Triage (`stage-runner.js`, TSB contracts). Governor inclusion of triage is PD-R7 (open).
- Any change to the attempt budget (PD-R1, open), the provider request payload
  (PD-R4, open) or real-provider validation (PD-R9, open).
- Persistent or cross-process rate state (rejected in C1; remains rejected).
- Release, ROADMAP, governance, package exports, `README.md`, `SECURITY.md`.

## 2. Baseline, evidence and authority

### 2.1 Certified code baseline (`main` `a32a6cd7`)

Blob identities of the source files this design builds on:

| File | Blob | Facts used |
|---|---|---|
| `scripts/ai/cli/stage-process.js` | `4c9a8ab4` | First result stored then ACKed with the child's random receipt (L118–132); `close` settles (L139); after `exit`, a ref'd `CLOSE_AFTER_EXIT_MS = 10000` timer settles with `result = null` if `close` never arrives (L143–160). No timeout, no watchdog. |
| `scripts/ai/cli/generative-runner.js` | `5adac686` | `guardParentLink()` (L130): parent `disconnect` → abort controller → `process.exit(1)` in the same turn; `report()` (L167) state machine `running → sending → awaiting_ack → delivered \| failed`; `RESULT_ACK_DEADLINE_MS = 10000` (L115); `bindCancelSignal(parentLink.signal)` before any provider exists (L238); `failureCodes()` (L49) bounds codes to `^[A-Z][A-Z_]{0,63}$`, max 8. |
| `scripts/ai/providers/index.js` | `74c64cd3` | Process-scoped `bindCancelSignal()` (L28); `createProvider(name)` passes `{ cancelSignal }` to Groq/Gemini (L37–). |
| `scripts/ai/providers/groq-provider.js` | `3d97fd86` | Refuses when `cancelSignal.aborted`; links it to the per-request controller; cancellation → non-retryable `UNKNOWN`, no cause. `mapHttpError`: 401/403 AUTH ✗, 429 RATE_LIMIT ✓, **408 TIMEOUT ✓**, 5xx UNKNOWN ✓, other 4xx UNKNOWN ✗ (L41–72). 30 s timer spans fetch and bounded body read. Headers and `usage` discarded. |
| `scripts/ai/providers/gemini-provider.js` | `6559416d` | Same cancellation contract. `mapHttpError`: 401/403 AUTH ✗, 429 RATE_LIMIT ✓, 5xx UNKNOWN ✓, **every other 4xx incl. 408 UNKNOWN ✗** (L44–69). |
| `scripts/ai/cli/generative.js` | `418b5597` | Accepts only `result.ok === true && exitCode === 0` (L83); `classifyChildFailure()` (L50) maps `generation` failures to `PROVIDER_FAILURE` (exit 6) with sanitized reason codes in the message, or exit 4 when `providerAttempts === 0`. |
| `scripts/ai/cli/run-artifacts.js` | `56946794` | `KNOWN_CODES` closed allowlist = `ERROR_CODES ∪ PROVIDER_ERROR_CODES` (L49); unknown codes become `UNKNOWN` (`sanitizeCodes`, L62). |
| Generators | — | `providerAttempts` is set before `provider.analyze()`; max 2 attempts. Design-stage generators (`requirement-model`, `test-case-model`, `automation-candidate`) report `providerError.code` (e.g. RM L435). `automation-plan-generator.js` L677 and `generate-change-set.js` L270 replace **every** provider error with `INVALID_VALUE` / "provider call failed", and their attempt 2 after a retryable provider error sends the **correction** prompt, not the identical prompt. |

CLI contract facts ("contract" below means this file): exit taxonomy contract §10.7 of
`docs/controlled-v1-productization-contract-v1.md` (6 = provider failure incl.
"provider bounded-time exceeded"; 1 = internal / invariant violation);
`--json` envelope `{schemaVersion, command, ok, exitCode, runId, artifacts, errors:[{code,message}]}` (contract §10.8);
config schema v1 exactly `schemaVersion: 1` (contract §11.2).

### 2.2 Historical evidence (preserved, not rewritten)

| Item | Identity |
|---|---|
| Evidence package | `OD-RATE-1-C2-R2-EVIDENCE` (local PO evidence package; not in the repository) |
| `MANIFEST.sha256` SHA-256 | `eeb5a063b09803513eeb6ef77893802a37bf39e55d6abc8d5a955257d9ecbff9` (6/6 entries re-verified for C3) |
| `REMEDIATION-MANIFEST.sha256` SHA-256 | `006dae0d317d0ad35c9e0c0591d520f1d63e7f1b5cdbf443f9947ece57d9cdfc` |
| `POST-AUTH-MANIFEST.sha256` SHA-256 | `1139919745bf35507bdbe732af3e8e5fb55313e3d9d9ee0b3f42aad2f5470fcc` |
| C2 design (`04-OD-RATE-1-C2-FULL-WITH-APPENDICES.txt`) SHA-256 | `1c0851be7a40a9406c7d75daa7d9676534b4e61f7ff542a93be53f3e2f74c054` |
| Issue #258 raw body SHA-256 | `e5b84e8118631885d8034f9d6eab1bc730d5ccda3598597ba5d6c935e95c86cc` (re-verified unchanged for C3) |

C2 clauses are cited as `C2:<line>` against that file (for example `C2:617–648`
is Appendix A). C3 does not edit, re-hash or re-seal C2 or any manifest.

### 2.3 Review input

Independent HEAVY Architecture Design Review of C2, Codex session
`01a17740-3dc0-7ee2-b26e-a538092270cd` (rollout transcript SHA-256
`2f2744594809617aad701f2b594aba3fc14ac3fbcd2819afd89fbb57f84b22db`), verdict
**REJECTED**:

| Finding | Severity | Subject | C3 section |
|---|---|---|---|
| R2-ARCH-01 | MAJOR | RPM admission gate missing | §7 |
| R2-ARCH-02 | MAJOR | Governor reason codes lost in `plan`/`generate` | §11 |
| R2-ARCH-03 | MAJOR | Invalid light-regime and end-to-end time bounds | §14, proofs §5–§7 |
| R2-ARCH-04 | MAJOR | Wait-budget excess not checked before dispatch | §8 |
| R2-ARCH-05 | MINOR | HTTP 408 semantics misstated for Gemini | §10 |
| DRIFT-01 | corrective | FT0 SEC-C1 cancellation integration | §12 |
| DRIFT-02 | corrective | IPC receipt/ACK/settlement integration | §13 |

### 2.4 Product Owner decisions

Approved and preserved (Issue #258 for the first nine; the C3 mission for the last three):

| Decision | Status | Interpretation used in C3 |
|---|---|---|
| PD-R2 | APPROVED DIRECTION | Config schema v2 with opt-in `providerGovernor`; v1 accepted unchanged (§5). |
| PD-R3 | APPROVED FOR DESIGN REVIEW | 30 s request timeout, 65 s per wait, 900 s accumulated wait per stage, 1 800 s stage deadline, 45 s watchdog, 10 s heartbeat. Product constants, not configurable (§6.1). |
| PD-R5 | APPROVED | 65 s cold start in every governed stage process; counts toward wait budget and stage deadline (§7.6). |
| PD-R6 | APPROVED | No exit 130; platform-native user-signal termination; user cancellation is never exit 6 (§12.4). |
| PD-R8 | APPROVED DIRECTION | Closed reason-code extension; exact envelope and exit mapping subject to independent review (§11, §15). |
| PD-R10 | APPROVED | Heuristic, best-effort token admission; no provider-TPM guarantee; exceeding local budgets fails closed (§9.2). |
| PD-R13 | APPROVED | Deadline, heartbeat and watchdog exist only when the governor is enabled (§5.3). |
| SEC-C1 | APPROVED | Parent IPC loss aborts waits and in-flight requests, no new provider calls, child terminates (§12). |
| PD-R14 | APPROVED | SEC-C1 applies unconditionally, including with the governor disabled (§5.3). |
| **PD-R11** | **APPROVED: A** | `charged = max(reserved, normalizedObserved)`; no refund (§9.4). |
| **PD-R12** | **APPROVED: A** | Missing usage saturates the affected capacity window; never zero (§9.5). Interpretation details flagged for confirmation in §19. |
| **D+15** | **APPROVED: A** | Separate, measurable lifecycle bounds; no claim that a kill at 1 815 s settles the CLI at 1 815 s; no new global hard bound; FT0 termination semantics unchanged (§14). |

Open and **not** closed by C3: PD-R1, PD-R4, PD-R7, PD-R9 (§19). C3 assumes their
status-quo values: two attempts (PD-R1), no completion cap in the request (PD-R4),
generative scope only (PD-R7), no real-provider call (PD-R9).

---

## 3. Contract boundaries

| Surface | Class | C3 effect |
|---|---|---|
| Package `exports`, `bin`, library API | public | **None.** Governor modules are internal. |
| CLI exit codes (contract §10.7) | public | **None new.** Governor outcomes use existing codes 3, 6 and 1. |
| CLI reason codes (`errors[].code`, reason codes in messages) | public | Closed additive extension under PD-R8 (§15). Unreachable with v1 config or a disabled governor. |
| Config schema | public | v2 adds optional `providerGovernor` (§5). v1 unchanged. |
| stdout | public | Unchanged (single result). |
| stderr | public (bounded diagnostics) | No new mandatory output. |
| Child environment (`buildGenerativeEnv`) | private | **Unchanged.** Governor settings travel over IPC. |
| Parent → child IPC | private | Optional closed `governor` member on the existing `payload` message (§13.2). Absent when disabled. |
| Child → parent IPC | private | New closed `heartbeat` message (governed only); new closed `failure.kind: "stage-timeout"` (§11.3). The `result`/`result-ack` receipt protocol is unchanged. |
| `createProvider()` and provider constructors | private | Internal-only `observer` option (§9.6). Not exported. |
| Generators | internal, unchanged | **No change.** Reason-code preservation does not depend on generator edits (§11). |
| Run manifest, run store, review packages, approval/apply | — | Unchanged. |

---

## 4. Terminology

| Term | Meaning |
|---|---|
| Send | One inner `provider.analyze()` call made by the governor. One send is at most one HTTP request. |
| Admission | The synchronous decision, immediately before a send, that both budgets permit it. |
| Entry | The ledger record created at admission for exactly one send. |
| Settle | The instant the inner call resolves or rejects, observed by the governor (`tSettle`). |
| Reserved (`Res`) | Heuristic token reservation for a send (§9.2). |
| Normalized observed (`U`) | The validated, provider-normalized token total reported for a send (§9.3). |
| Charged | Tokens counted against the token ledger for an entry (§9.4). |
| `t0` | Child monotonic time at which a valid `payload` message is received; origin of every governed child bound. |
| `tSpawn` | Parent monotonic time at which `spawn()` returned; origin of every parent bound. |
| Governed | The governor is enabled for this stage (§5.3). |

---

## 5. Configuration and compatibility

### 5.1 Schema v2

`schemaVersion: 2` is v1 plus one optional top-level key:

```json
{
  "schemaVersion": 2,
  "providerGovernor": {
    "enabled": true,
    "limits": {
      "groq":   { "tokensPerMinute": 8000, "requestsPerMinute": 30, "completionReserveTokens": 2000, "reasoningReserveTokens": 0 },
      "gemini": { "tokensPerMinute": 250000, "requestsPerMinute": 10, "completionReserveTokens": 4000 }
    }
  }
}
```

All other keys keep their v1 meaning and validators. The values above are
illustrative only; C3 asserts no provider plan limit.

| Key | Rule |
|---|---|
| `providerGovernor` | optional object; closed keys `{enabled, limits}` |
| `enabled` | required boolean |
| `limits` | required object when `enabled` is `true`; closed key set ⊆ `{"groq", "gemini"}` |
| `tokensPerMinute` | required integer, 2 ≤ v ≤ 10 000 000 (`B_tok ≥ 1`) |
| `requestsPerMinute` | required integer, 1 ≤ v ≤ 100 000 |
| `completionReserveTokens` | required integer, 0 ≤ v ≤ 1 000 000 |
| `reasoningReserveTokens` | optional integer, 0 ≤ v ≤ 1 000 000, default 0; operator-declared; never inferred from the model name |

Timing values are product constants (§6.1) and MUST NOT be configurable.
Validation failures are exit 3 at the existing config-validation step, before
any provider exists.

### 5.2 Effective-provider rule

When `enabled` is `true` and the effective generative provider (contract §10.4.2) has no
`limits` entry, the command MUST fail with exit 3, reason code
`PROVIDER_GOVERNOR_LIMITS_MISSING`, before spawning the child (zero sends).
There is no fallback provider and no default limit.

### 5.3 Governed vs. ungoverned

| Config | Governor | Heartbeat / watchdog / deadline | SEC-C1 | IPC payload |
|---|---|---|---|---|
| v1 | absent | absent (PD-R13) | **present** (PD-R14) | byte-identical to baseline |
| v2, `providerGovernor` absent or `enabled: false` | absent | absent | present | byte-identical to baseline |
| v2, `enabled: true` | present | present | present | baseline + `governor` member |

INV-13 (§16) requires the first two rows to be indistinguishable from the
certified baseline in spawn arguments, environment, IPC traffic, exit codes and
output.

---

## 6. Governor state model

### 6.1 Product constants

| Symbol | Value | Source |
|---|---:|---|
| `T_REQ` | 30 000 | existing provider timer; PD-R3 |
| `C_COLD` | 65 000 | PD-R5 |
| `W_HOLD` | 65 000 | provider minute (60 000) + guard `G` (5 000); entry hold after settle |
| `W_MAX` | 65 000 | PD-R3 per-wait cap |
| `W_BUDGET` | 900 000 | PD-R3 accumulated wait per stage, cold start included |
| `D_STAGE` | 1 800 000 | PD-R3 stage deadline, from `t0` |
| `S_MIN` | 50 | minimum sleep granularity |
| `I_MAX` | 64 | wait-loop iteration cap per `analyze` |
| `HB` | 10 000 | PD-R3 heartbeat period |
| `WD` | 45 000 | PD-R3 watchdog silence |
| `K_PARENT` | 1 815 000 | parent enforcement point, from `tSpawn` (D+15) |
| `ACK` | 10 000 | FT0 `RESULT_ACK_DEADLINE_MS` (unchanged) |
| `CAE` | 10 000 | FT0 `CLOSE_AFTER_EXIT_MS` (unchanged) |
| `h` | 0.85 | token headroom |
| `κ` | 3.0 bytes/token | heuristic estimator ratio (not a bound) |
| `O` | 32 tokens | template overhead |
| `U_MAX` | 10 000 000 | maximum accepted usage field value |

Derived: `B_tok = floor(tokensPerMinute × h)`; `B_req = requestsPerMinute`.
`B_req` carries no headroom: request counting is exact, and the 65 s hold already
exceeds a 60 s window (proofs §3).

### 6.2 State

One governor exists per governed child process, keyed to the single effective
provider. It holds:

| Field | Type | Initial |
|---|---|---|
| `t0` | monotonic ms | at payload receipt |
| `entries` | list of `{tAdmit, tSettle \| null, res, charged}` | empty |
| `waited` | integer ms, observed | 0 |
| `coldUntil` | `t0 + C_COLD` | — |
| `cooldownUntil` | monotonic ms | `t0` |
| `hintTok` | `{used, until} \| null` | null |
| `hintReq` | `{until} \| null` | null |
| `exhausted` | boolean (set by an over-cap hint) | false |
| `terminal` | `null \| {code}` (sticky) | null |
| `inFlight` | boolean | false |
| `queue` | FIFO of waiting callers | empty |
| `cancelSignal` | the process-scoped SEC-C1 signal | bound at construction |

Logical states: `IDLE → WAITING → ADMITTED/IN_FLIGHT → IDLE`, absorbing
`TERMINAL` (sticky refusal) and `CANCELLED` (process ends, FT0). An entry is
**live at `t`** iff `tSettle === null` or `t < tSettle + W_HOLD`. Entries are
retained only while live; an expired entry has no further effect.

### 6.3 Clock

All governor times come from `process.hrtime.bigint()` converted to integer
milliseconds. Wall-clock time is never read. If a later reading is smaller than
an earlier one (impossible for a monotonic source; defensive), the governor sets
`terminal = RATE_ACCOUNTING_INVALID`.

---

## 7. Joint RPM + TPM admission (R2-ARCH-01)

### 7.1 Two independent ledgers over one entry list

Both ledgers are views over the same `entries` list, so there is exactly one
entry per send and no double counting:

- **Request ledger:** `reqLive(t) = count of entries live at t`.
- **Token ledger:** `tokLive(t) = Σ charged of entries live at t`.

Window origin: an entry occupies both ledgers from `tAdmit` (before the HTTP
request exists) until `tSettle + W_HOLD`. Expiry runs from settle, never from
admit, because the provider may count the request at any time up to the
response. An unsettled entry never expires.

### 7.2 Admission predicate

A send for reservation `res` is admissible at `t` iff all hold:

```text
P_cancel : cancelSignal is not aborted
P_term   : terminal === null and exhausted === false
P_cold   : t ≥ coldUntil
P_cool   : t ≥ cooldownUntil
P_req    : reqLive(t) + 1 ≤ B_req            and (hintReq === null or t ≥ hintReq.until)
P_tok    : max(tokLive(t), hintTokUsed(t)) + res ≤ B_tok
P_wait   : waited ≤ W_BUDGET
P_dead   : t + T_REQ ≤ t0 + D_STAGE
P_serial : inFlight === false and caller is at the head of queue
```

`hintTokUsed(t)` is `hintTok.used` while `t < hintTok.until`, else 0.

### 7.3 Atomic admission immediately before send

Admission, entry creation and the start of the inner call MUST happen in one
synchronous section with no `await` between them:

```text
if admissible(res, now):            // all predicates, evaluated at `now`
  entry = {tAdmit: now, tSettle: null, res, charged: res}
  entries.push(entry); inFlight = true
  p = inner.analyze(req)            // invoked in the same turn
```

JavaScript runs this section to completion, so no other caller, timer or IPC
handler can change ledger state between the check and the send. Admission is
re-evaluated from scratch after every wake (§8); a decision made before a sleep
never authorizes a send after it.

### 7.4 Serialization and concurrency

The governor allows at most one in-flight send. Callers wait in a FIFO queue;
only the head evaluates admission. The certified generators already call
`analyze()` strictly sequentially, so the queue is defensive. Time spent queued
counts as wait (§8.2). No fairness claim beyond FIFO order is made.

### 7.5 Correction retries

Each `analyze()` call, whether attempt 1, a transport retry or a correction
retry, makes at most one admission and therefore creates at most one entry. The
wait loop holds no reservation, so waiting never reserves twice. A retry after
an uncertain outcome is a second send with its own entry, even if the first
request completed remotely (§9.5).

### 7.6 Cold start, cooldown and provider hints

- **Cold start (PD-R5):** `coldUntil = t0 + 65 000`. The first send of every
  governed stage process is at or after it. The cold-start sleep counts toward
  `waited` and the deadline.
- **Cooldown:** after an HTTP 429, `cooldownUntil = tSettle + min(RA ?? 65 000, 65 000)`,
  where `RA` is a valid `Retry-After` delta-seconds value × 1000. If `RA > 65 000`,
  `exhausted = true` and the next admission throws `RATE_BUDGET_EXHAUSTED` without
  sleeping.
- **Hints only tighten.** Strict grammars from C2:151 apply (integers: ASCII
  digits, ≤ 9 characters; durations `^(\d{1,4}h)?(\d{1,4}m)?(\d{1,5}(\.\d{1,3})?s)?$`
  or `^\d{1,9}ms$`). Any invalid, oversized or out-of-range value is ignored.
  - Groq `x-ratelimit-remaining-tokens` / `x-ratelimit-reset-tokens` (TPM):
    `hintTok = {used: B_tok − remaining (floored at 0), until: tSettle + reset + 5 000}`.
    A hint can raise the effective usage, never lower it (`max`, §7.2).
  - Groq `x-ratelimit-remaining-requests` / `-reset-requests` describe requests
    **per day** in Groq's public documentation, not RPM. They never relax
    `P_req`. If `remaining-requests` is `0`, `hintReq.until = tSettle + reset + 5 000`;
    if that reset exceeds 65 000, `exhausted = true`.
  - Gemini: only `Retry-After` on 429 is used; no other header is interpreted.
  - Header meanings are unverified at runtime (PD-R9 evidence item).

### 7.7 Invariant

**INV-01 (joint admission).** Every send starts at an instant at which `P_req`
and `P_tok` (and every other predicate in §7.2) hold for the ledger state at that
instant. Consequently (proofs §3, Lemma 1), any half-open 65 s interval contains
at most `B_req` sends and at most `floor(B_tok / Res_min)` sends, where `Res_min`
is the smallest reservation among them.

This is a **local** guarantee about this process's sends. It is not a guarantee
about provider-side accounting, other processes, or other tools sharing the account.

Reviewer counterexample (RPM = 1, `B_tok = 6 800`, `Res = 3 201`, sends at 65 s
and 65.1 s): under C3 the second send fails `P_req` at 65.1 s and is deferred to
130.1 s. Trace in proofs §4.1.

---

## 8. Wait loop and post-wait revalidation (R2-ARCH-04)

### 8.1 Rules

1. Every loop iteration starts by re-reading `now` and evaluating, in this order:
   `P_cancel`, `P_term`, `P_wait` (observed), `P_dead`, then availability.
2. If all predicates hold at `now`, admit and send in the same turn (§7.3).
3. Otherwise compute `freeAt` (earliest instant at which `P_cold`, `P_cool`,
   `P_req`, `P_tok` and hint conditions would all hold if nothing else changed)
   and `planned = max(freeAt − now, S_MIN)`.
4. Before sleeping, refuse if any of:
   `planned > W_MAX` → `RATE_BUDGET_EXHAUSTED`;
   `waited + planned > W_BUDGET` → `RATE_BUDGET_EXHAUSTED`;
   `now + planned + T_REQ > t0 + D_STAGE` → `STAGE_TIMEOUT`.
   The **planned** sleep (including the `S_MIN` floor) is what is checked, not the
   raw wait.
5. Sleep with a cancellable timer bound to `cancelSignal`. After waking, add the
   **observed** duration `tAfter − tBefore` (oversleep included) to `waited`.
6. Go to 1. More than `I_MAX` iterations in one `analyze()` → `RATE_BUDGET_EXHAUSTED`.

### 8.2 Consequences

- **INV-05 (wait budget).** Every send occurs with observed `waited ≤ 900 000`.
  Rule 1 re-checks the observed total after every wake, so neither the `S_MIN`
  floor nor arbitrary timer oversleep can lead to a send after the budget is
  exceeded.
- **INV-06 (deadline).** Every send occurs at `now ≤ t0 + 1 770 000`.
- The budget is in observed milliseconds. Exceeding it by oversleep is possible;
  **sending after** exceeding it is not.

Reviewer counterexample (`waited = 899 990`, wait 1 ms, `S_MIN = 50`): rule 4
refuses before sleeping because `899 990 + 50 = 900 040 > 900 000`. Even if a
sleep had happened (or a timer overslept from a lawful start), rule 1 refuses
after waking at `waited = 900 040`. Traces in proofs §4.2.

---

## 9. Reservation and usage accounting (PD-R11 A, PD-R12 A)

### 9.1 Units

All accounting is in integer **tokens** of the provider's own counting, as
best-effort heuristics. Bytes are input to the estimator only. All values are
safe integers (`≤ 2^53 − 1`): per-entry values ≤ `U_MAX`, live entries ≤ `B_req`
≤ 100 000, so sums ≤ 10^12.

### 9.2 Estimate and reservation (PD-R10)

```text
b     = utf8Bytes(systemPrompt) + utf8Bytes(userPrompt)
E_in  = ceil(b / κ) + O
Res   = E_in + completionReserveTokens + reasoningReserveTokens
```

`Res > B_tok` → `RATE_REQUEST_EXCEEDS_BUDGET`, zero sends. The estimate is
recomputed for every `analyze()` call, so a correction prompt is estimated on its
own bytes. `b` is not a lower bound on tokens; the estimate is not a compliance
proof.

### 9.3 Usage normalization (untrusted input)

Usage is read only from a successfully parsed 2xx response body, through a pure
function that reads the whitelisted numeric fields below and nothing else. Every
field used MUST be an integer in `[0, U_MAX]`.

| Provider | Required | Optional | Consistency | `U` |
|---|---|---|---|---|
| Groq (`usage`) | `prompt_tokens`, `completion_tokens`, `total_tokens` | — | `total ≥ prompt + completion` | `total_tokens` |
| Gemini (`usageMetadata`) | `promptTokenCount`, `totalTokenCount` | `candidatesTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount` (absent = 0) | `total ≥ prompt + candidates + thoughts + toolUse` | `totalTokenCount` |

Classification of a settled send:

| Class | Definition |
|---|---|
| **Valid** | Usage object present, every required field valid, consistency holds. |
| **Missing** | 2xx parsed body with no usage object (`usage` / `usageMetadata` absent or `null`). |
| **Malformed** | Usage object present but any required field absent (partial), non-integer, negative, `> U_MAX`, or consistency fails. |
| **Unavailable** | No parsed 2xx body: HTTP error status, transport failure, timeout, body-read failure, oversized or non-JSON body. Includes every **uncertain remote completion**. |

All usage is untrusted. A valid `U` can only raise the charge (§9.4); it can
never lower it below `Res`.

### 9.4 Charge rule (PD-R11 A)

At settle:

| Class | `charged` |
|---|---|
| Valid | `max(Res, U)` |
| Missing | `B_tok` (saturation, §9.5) |
| Malformed | `B_tok`, then `terminal = RATE_ACCOUNTING_INVALID` |
| Unavailable | `B_tok` (saturation, §9.5) |

No refund: `charged ≥ Res` for every entry, and `charged` never decreases.
`charged > Res` (accounting above reservation) is allowed. It can make
`tokLive > B_tok` temporarily; `P_tok` then blocks every admission until enough
entries expire. Nothing is clamped.

### 9.5 Saturation (PD-R12 A)

- **Scope:** the token ledger of the effective provider in this child process.
  The request ledger is unaffected (the send was already counted exactly).
- **Effect:** the entry is charged `B_tok`, so `P_tok` fails for any `res ≥ 1`
  while it is live.
- **Expiry:** `tSettle + W_HOLD`. After that, normal admission resumes.
- **Uncertain remote completion** (timeout, network error after bytes may have
  been sent, cancellation, body-read failure) is handled separately from
  "missing usage": the governor (a) saturates, because the provider may have
  processed the request, including completion tokens beyond `Res` (PD-R4 open:
  no completion cap is sent); and (b) never treats a later attempt as a
  replacement. A retry is a new send with its own entry, and both sends count
  in both ledgers. A remote completion after local abort, or after the process
  ends, cannot be observed or charged. That is a stated non-guarantee (§17).

Missing or malformed usage is never converted to zero (INV-04).

### 9.6 Observer boundary (implementation touchpoint)

Providers gain an internal-only constructor option `observer`. It is passed only
by the governed child's provider construction and is `null` everywhere else, so
ungoverned behavior is unchanged. Per send, the provider calls it at most:

- once with `{status, rateHeaders}` when a response arrives, where `rateHeaders`
  is a frozen map of the header names in §7.6 only; and
- once with the raw usage object after a successful body parse.

The observer runs the §9.3 normalizer at once and keeps only integers. It never
retains bodies, content, prompts, keys or other headers. Observer exceptions are
caught inside the provider and turn the send's class into Malformed.
Observations never enter error messages or IPC.

### 9.7 Conservation invariants

- **INV-03.** One entry per send, created at admission and never removed while live.
  `charged` is monotone non-decreasing and `≥ Res`. An unsettled entry never expires.
- **INV-04.** `charged ∈ {max(Res, U), B_tok}`; never 0, never `< Res`.
- **INV-14.** All ledger arithmetic stays within safe integers (§9.1).

Worked accounting traces are in proofs §4.3.

---

## 10. Provider-specific retry semantics (R2-ARCH-05)

The governor adds **zero** retries and makes at most one inner call per
`analyze()`. Retrying stays with the generators' existing two-attempt loop
(PD-R1 open; status quo kept). The governor reads the certified provider
classification; it does not change it.

| Condition | Groq (code / retryable) | Gemini (code / retryable) | Accounting class | Governor action |
|---|---|---|---|---|
| HTTP **408** | `TIMEOUT` / **yes** | `UNKNOWN` / **no** (other-4xx branch) | Unavailable | none; Groq: generator may make attempt 2; Gemini: artifact fails |
| HTTP 429 | `RATE_LIMIT` / yes | `RATE_LIMIT` / yes | Unavailable | cooldown (§7.6); `RA > 65 s` → `exhausted` |
| HTTP 401 / 403 | `AUTH` / no | `AUTH` / no | Unavailable | none |
| Other 4xx | `UNKNOWN` / no | `UNKNOWN` / no | Unavailable | none |
| HTTP 5xx | `UNKNOWN` / yes | `UNKNOWN` / yes | Unavailable | none |
| Transport error (DNS, reset, TLS) | `NETWORK` / yes | `NETWORK` / yes | Unavailable (remote outcome unknown) | none |
| Own 30 s timer, during fetch or body read (request timeout) | `TIMEOUT` / yes | `TIMEOUT` / yes | Unavailable (remote outcome unknown) | none |
| Abort by SEC-C1 cancellation | `UNKNOWN` / no, no cause | `UNKNOWN` / no, no cause | — (process exits, FT0) | none |
| Body over 32 MiB / not JSON | `INVALID_RESPONSE` / no | `INVALID_RESPONSE` / no | Unavailable | none |
| 2xx without content | `INVALID_RESPONSE` / no | `INVALID_RESPONSE` / no | by usage class | none |
| 2xx, content invalid for the model contract | generator correction retry (existing) | same | by usage class | none |
| Governor refusal | `RATE_*` or `STAGE_TIMEOUT` / no | same | no entry (no send) | sticky `terminal` |

Generator-side retry behavior (unchanged): design-stage generators resend the
identical prompt after a retryable provider error; `plan`/`generate` send their
correction prompt. Either way the retry is a fresh `analyze()`: fresh estimate,
fresh admission, new entry.

---

## 11. Closed failure propagation (R2-ARCH-02)

### 11.1 Problem

A governor refusal thrown from `analyze()` reaches the CLI by two different paths
at baseline. Design-stage generators report the error's `code`, but
`run-artifacts.js` sanitizes unknown codes to `UNKNOWN`. `plan`/`generate`
generators replace it with `INVALID_VALUE` before it leaves the generator.
Adding codes to `KNOWN_CODES` alone cannot recover information the generator
already discarded.

### 11.2 Design: authoritative terminal channel, generators unchanged

1. Every governor refusal is a `ProviderError` with `retryable: false` and a code
   from the closed set `GOVERNOR_TERMINAL_CODES = {RATE_REQUEST_EXCEEDS_BUDGET,
   RATE_BUDGET_EXHAUSTED, RATE_ACCOUNTING_INVALID, STAGE_TIMEOUT}`, with a fixed
   message and no `cause`. Raw provider data never reaches it.
2. Before throwing, the governor records `terminal = {code}`. The record is
   **sticky**: every later `analyze()` throws the same code with zero sends.
3. `generative-runner.js`, which constructs and owns the governor, reads
   `governor.terminal()` after the stage function returns (successfully, with a
   failure, or by exception). It builds the child result by the precedence in §11.4.
4. Because the error is non-retryable, every generator returns at the attempt
   that observed it. The governor is the only path to the provider, so a
   recorded terminal code is the cause of that step's failure. Generator code
   and the existing generator outputs are unchanged.
5. The parent adds the three `RATE_*` codes to its allowlist as a separate set,
   `KNOWN_CODES ∪ GOVERNOR_REASON_CODES`. `PROVIDER_ERROR_CODES` (shared with
   triage) is not modified.

### 11.3 Child result shapes (private IPC)

| Situation | Child `result` |
|---|---|
| Terminal `RATE_*` | `{ok:false, failure:{kind:"generation", step, providerAttempts, codes:[<terminal code>, ...generator codes]}}`: deduplicated, terminal first, max 8, same `failureCodes()` bounds |
| Terminal `STAGE_TIMEOUT` | `{ok:false, failure:{kind:"stage-timeout", step, providerAttempts}}` |
| Terminal set but stage function returned `ok:true` (unreachable by construction) | fail closed as `{ok:false, failure:{kind:"generation", step:"generation", providerAttempts, codes:[<terminal code>]}}` |
| Terminal set and stage function threw | as the first two rows (terminal wins over `GENERATIVE_STAGE_FAILED`) |

### 11.4 Precedence (highest first)

| # | Outcome | Owner | CLI result |
|---|---|---|---|
| 1 | Parent IPC loss (SEC-C1) | child | child exits 1 with no result in the same turn. The CLI outcome is decided by what ended the parent: platform-native signal (PD-R6), or `STAGE_FAILED` exit 1 if the parent survives. |
| 2 | Parent enforcement kill at `K_PARENT` | parent | `STAGE_TIMEOUT`, exit 6. Any stored result is discarded. |
| 3 | Parent watchdog kill | parent | `CHILD_UNRESPONSIVE`, exit 1. Any stored result is discarded. |
| 4 | Governor `STAGE_TIMEOUT` | child | `STAGE_TIMEOUT`, exit 6 |
| 5 | Governor `RATE_*` | child | `PROVIDER_FAILURE`, exit 6; message reason codes begin with the governor code |
| 6 | Existing generator / provider failure | child | unchanged (`PROVIDER_FAILURE` 6, or exit 4 when `providerAttempts === 0`) |
| 7 | Existing input refusals before any provider call | parent / generator | unchanged exit 4. The governor is never reached. |

Rules 2 and 3 are decided by the parent's sticky `killed` reason (§13.5), never
by the child's exit code or signal. An external signal that kills the child is
not rule 2 or 3: it stays `STAGE_FAILED` (exit 1), as today. A governor refusal
always has `providerAttempts ≥ 1` (generators count before calling), so it can
never be misreported as an exit-4 input refusal.

### 11.5 Envelope examples

`qa-agent plan --json` when attempt 2's correction prompt exceeds `B_tok`:

```json
{"schemaVersion":1,"command":"plan","ok":false,"exitCode":6,"runId":"…","artifacts":[],
 "errors":[{"code":"PROVIDER_FAILURE","message":"the AutomationPlan step failed after 2 provider attempt(s) (reason codes: RATE_REQUEST_EXCEEDS_BUDGET, INVALID_VALUE); provider output is withheld."}]}
```

Governor deadline in `design`:

```json
{"errors":[{"code":"STAGE_TIMEOUT","message":"the AutomationCandidate step stopped at the governed stage deadline after 1 provider attempt(s); nothing was written."}],"exitCode":6}
```

Exact message wording is non-normative and subject to PD-R8 review. Codes and exit
codes are normative.

### 11.6 Future implementation touchpoints (not implemented)

`generative-runner.js` (terminal merge, `stage-timeout` kind),
`generative.js` `classifyChildFailure()` (`stage-timeout` → `STAGE_TIMEOUT`/6;
killed reasons), `run-artifacts.js` (`GOVERNOR_REASON_CODES` allowlist), the new
internal governor module. No generator file changes.

---

## 12. Cancellation (DRIFT-01)

### 12.1 Single cancellation source

The governor MUST use the certified process-scoped SEC-C1 signal: the same
`parentLink.signal` that `generative-runner.js` already passes to
`bindCancelSignal()`. It MUST NOT create a competing parent-link mechanism,
signal handler or abort source. The governor receives the signal at construction,
after `bindCancelSignal()` and before any provider exists.

### 12.2 Behavior

| Event | Effect |
|---|---|
| Parent IPC `disconnect` while running | FT0 `fail()`: abort the signal, then `process.exit(1)` in the same turn. No later JavaScript (wait wake-up, retry, next step, result) runs. |
| Pending governor sleep | Its timer is bound to the signal and rejects on abort. Defense in depth, since the process is already exiting. |
| In-flight fetch | Aborted by the provider's existing link from `cancelSignal` to the per-request controller. Provider throws non-retryable `UNKNOWN`. |
| `analyze()` after abort | `P_cancel` is the first check of every gate, so zero sends. The provider also refuses (existing). |
| Cooldown / hint / retry pending | Cancellation has priority. It is checked before any cooldown or availability computation. |
| Governor disabled | SEC-C1 behaves exactly as certified (PD-R14). The governor adds nothing. |

**INV-10.** After `cancelSignal` aborts, no send starts in this process.

### 12.3 Ordering inside a gate

`P_cancel` → `P_term` → `P_wait` → `P_dead` → availability. Cancellation outranks
every governor outcome, and a governor outcome is never reported for a cancelled
child (the child sends no result).

### 12.4 User signals

No signal handler is added in the parent or the child (PD-R6). A user Ctrl-C
ends the parent with the platform-native status (POSIX shell `128 + n`; Windows
`0xC000013A`). The child then observes IPC loss and SEC-C1 applies. This is never
exit 6.

---

## 13. Process and IPC lifecycle (DRIFT-02)

### 13.1 Unchanged FT0 protocol

The result transfer remains exactly as certified:

- the child sends one `result` with a random 32-hex `receipt`;
- the parent stores the first result **in memory** (receipt stripped), then sends
  `{type:"result-ack", receipt}` once;
- the child counts its result as delivered only on an ACK that echoes its receipt,
  even if the ACK overtakes the send callback;
- a send callback alone never proves receipt;
- no valid ACK within `ACK = 10 000` ms of `report()`, a send error, or parent loss
  → child exits 1;
- after a delivered ACK, the child disconnects via `setImmediate`;
- duplicate or late ACKs and pre-report messages cannot authorize anything,
  because the receipt check runs first.

The ACK means "stored in parent memory". It does **not** mean "committed to
disk". Disk commit happens later, in the parent, only after settlement (§13.6).

### 13.2 Governed additions

| Addition | Shape / rule |
|---|---|
| Payload member | `{type:"payload", stage, payload, governor:{provider, tokensPerMinute, requestsPerMinute, completionReserveTokens, reasoningReserveTokens}}`: closed keys, the §5.1 ranges, `provider` equal to the effective provider. Invalid → existing `STAGE_PAYLOAD_INVALID`. |
| Heartbeat | Child → parent `{type:"heartbeat", seq}`: exactly these keys; `seq` integer `1 … 2^31 − 1`, strictly increasing. First at `t0`, then every `HB`. |
| Heartbeat send | Uses a send callback that ignores errors. Parent loss is handled only by the FT0 `disconnect` path. |
| Heartbeat stop | Cleared when `report()` leaves `running` and in FT0 `fail()`, so heartbeats never interleave after the result. |
| Watchdog | Parent timer `WD`, armed at `tSpawn`, re-armed on each **valid** heartbeat received while no result is stored, disarmed when a result is stored. Invalid, duplicate, out-of-order or post-result heartbeats are ignored: they do not re-arm, and they are not fatal. |
| Enforcement timer | Parent timer at `tSpawn + K_PARENT`. Armed until settlement, including after a result is stored, so the parent's wait for `exit` stays bounded by a decision point. |

Heartbeats run on the event-loop timer, so they continue through lawful governor
sleeps (≤ 65 s) and in-flight requests (≤ 30 s). The watchdog (45 s) is shorter
than one lawful wait. That is safe only because heartbeats continue during waits.
A child whose event loop is blocked for more than about 45 s by synchronous work
is killed as `CHILD_UNRESPONSIVE`. That is the intended classification (§11.4 #3).

### 13.3 Child timers and terminal cleanup

At `report()` (any outcome) and in `fail()`: clear the heartbeat interval. The
governor has no timer outside an active `analyze()`. After `report()`, the only
live child handles are the FT0 ACK deadline and the IPC channel. A delivered child
therefore exits once the channel is closed. The governor adds **no** child
self-deadline timer and no new abort source. The child's deadline is enforced
algorithmically by `P_dead` (§7.2) plus the existing 30 s provider timer.

### 13.4 Message handling in the parent

```text
on message m:
  if killed: return                               // sticky; never store or ACK after a kill
  if m is valid heartbeat and result === null: re-arm watchdog; return
  if m.type === "result" and result === null: (FT0) store, ACK receipt; disarm watchdog
  else: ignore
```

### 13.5 Parent-killed sticky state

When the watchdog or the enforcement timer fires before settlement:

1. `killed = {reason}` with reason `STAGE_TIMEOUT` or `CHILD_UNRESPONSIVE`. The
   first reason wins and never changes.
2. `result = null`. A stored, even ACKed, result is discarded.
3. Disarm both parent timers; `child.kill("SIGKILL")` (POSIX SIGKILL; Windows `TerminateProcess`).
4. Settlement proceeds by the unchanged FT0 rules (§13.6). The outcome is
   classified by `killed.reason` only.

A child whose result was ACKed but which is then killed may already have exited
0 on its own. The parent still reports the kill reason, and nothing is committed.

### 13.6 Settlement and acceptance (unchanged FT0 + `killed`)

- Settle on `close`. Or, after `exit`, wait at most `CAE = 10 000` ms for `close`;
  then disconnect, destroy stdio and settle with `result = null`.
- `exit` alone never proves delivery.
- Accept (validate, then commit) only if: result stored, `exitCode === 0`,
  `killed === null`, settled normally. Otherwise no write occurs. (**INV-12**)

### 13.7 Platform differences that change guarantees

| Aspect | POSIX | Windows |
|---|---|---|
| Kill | SIGKILL, uncatchable; exit reported as `signal: "SIGKILL"` | `TerminateProcess`; exit code/signal reporting differs. The design never relies on it (sticky `killed`). |
| `close` after `exit` | normally prompt | may never arrive if IPC data is unread (FT0-C2-D1). `CAE` fallback settles with `result = null`. |
| Orphaned child after parent death | possible. SEC-C1 `disconnect` path ends it. | job-object behavior often kills children with the parent. SEC-C1 still applies. |
| User interrupt status | `128 + n` | `0xC000013A` |
| Timer granularity | usually ≈ 1 ms | often ≈ 15.6 ms by default. Oversleep is expected and handled (§8). |
| Monotonic clock across system suspend | platform-dependent | platform-dependent. No wall-clock claim is made across suspend. |
| Kill → `exit` latency | not bounded by the product (e.g. uninterruptible I/O) | not bounded by the product (pending I/O) |

---

## 14. Deadline and termination phases (R2-ARCH-03, D+15 A)

Each phase has its own clock, boundary and failure behavior. **No phase bound is
added to another to produce a whole-CLI hard bound**, and none is claimed.

| Phase | Clock / origin | Boundary | On violation |
|---|---|---|---|
| G — governed provider activity | child, `t0` | No send after `t0 + 1 770 000` (`P_dead`). No sleep that would end after `t0 + 1 770 000`. The last request ends by the provider timer at `send + T_REQ` plus timer overshoot. | `STAGE_TIMEOUT` thrown by the governor (exit 6), zero further sends |
| W — accumulated wait | child, `t0` | observed `waited ≤ 900 000` at every send | `RATE_BUDGET_EXHAUSTED` (exit 6) |
| P — post-response processing | child | not bounded by the governor (synchronous validation). Liveness is covered by heartbeats. | watchdog phase H |
| H — heartbeat liveness | parent, last valid heartbeat | silence `≤ WD` while no result is stored | kill, `CHILD_UNRESPONSIVE` (exit 1) |
| E — parent enforcement | parent, `tSpawn` | decision point at `tSpawn + K_PARENT` if not yet settled | kill, `STAGE_TIMEOUT` (exit 6) |
| A — result transfer | child, `report()` | ACK within `ACK = 10 000` (FT0) | child exits 1. Parent sees no accepted result: `STAGE_FAILED` (exit 1), unless E or H fired first. |
| K — child termination | parent, kill issued | **no product bound.** The OS decides when `exit` is delivered. | none added (see PD-R15, §19) |
| S — settlement | parent, `exit` | `close`, or `CAE = 10 000` after `exit` (FT0) | settle with `result = null` |
| V — parent validation and commit | parent, settlement | not bounded by the product (synchronous validation and file writes) | existing errors only |

Statements that hold, and statements that do **not**:

- Holds (algorithmic, child clock): no governed send occurs after `t0 + 1 770 000`.
- Holds (algorithmic, parent clock): the parent decides to kill no later than the
  first timer callback at or after `tSpawn + 1 815 000`.
- Does **not** hold: "the CLI settles by 1 815 s." After the kill, phases K, S and
  V add OS-dependent and I/O-dependent time. The bounded part (S) adds at most
  `CAE` plus timer overshoot after `exit`.
- Does **not** hold: "the 900 s wait budget always binds before the deadline." In
  the light regime with long requests, `STAGE_TIMEOUT` binds first (proofs §5.2).
  Both are fail-closed refusals with zero further sends.
- Node does not guarantee exact timer callback times. Every timer-based boundary
  is "at or after"; correctness never depends on punctuality (§8).

Start-up skew: child `t0` is after `tSpawn`. If the child takes more than 15 s to
start, phase E can fire while phase G would still permit a send. That is a
fail-closed early stop (`STAGE_TIMEOUT`), and it can interrupt an in-flight request
whose remote outcome is then unknown (§17).

---

## 15. Closed reason-code mapping

| Code | Where it appears | Origin | Exit | Reachable when |
|---|---|---|---:|---|
| `RATE_REQUEST_EXCEEDS_BUDGET` | reason code inside `PROVIDER_FAILURE` | governor, `Res > B_tok` | 6 | governed |
| `RATE_BUDGET_EXHAUSTED` | reason code inside `PROVIDER_FAILURE` | wait cap, wait budget, iteration cap, over-cap hint | 6 | governed |
| `RATE_ACCOUNTING_INVALID` | reason code inside `PROVIDER_FAILURE` | malformed usage; clock regression | 6 | governed |
| `STAGE_TIMEOUT` | top-level `errors[].code` | governor `P_dead`, or parent enforcement kill | 6 | governed |
| `CHILD_UNRESPONSIVE` | top-level `errors[].code` | parent watchdog | 1 | governed |
| `PROVIDER_GOVERNOR_LIMITS_MISSING` | top-level `errors[].code` | enabled governor, no limits for the effective provider | 3 | v2 enabled |

Exit 6 for `STAGE_TIMEOUT` follows contract §10.7 "provider bounded-time exceeded".
Exit 1 for `CHILD_UNRESPONSIVE` follows contract §10.7 "invariant violation": a governed
child must heartbeat. None of these codes can be produced with a v1 config or a
disabled governor. Exact envelope wording remains a PD-R8 review item.

---

## 16. Invariants

| ID | Invariant |
|---|---|
| INV-01 | Joint admission: every send starts with all §7.2 predicates true for the ledger state at that instant. No `await` separates check, entry and send. |
| INV-02 | Window occupancy: any half-open 65 s interval holds ≤ `B_req` sends and ≤ `floor(B_tok / Res_min)` sends (proofs Lemma 1). |
| INV-03 | One entry per send. Created at admission; never released while live; `charged` monotone and `≥ Res`; unsettled entries never expire. |
| INV-04 | `charged ∈ {max(Res, U), B_tok}`. Missing, malformed or unavailable usage is never zero. |
| INV-05 | Every send has observed `waited ≤ W_BUDGET`. Every sleep starts only if `waited + planned ≤ W_BUDGET`. |
| INV-06 | Every send is at child time `≤ t0 + D_STAGE − T_REQ`. |
| INV-07 | No send before `t0 + C_COLD`. |
| INV-08 | At most one inner call per `analyze()`. The governor makes zero retries; at most two `analyze()` calls per artifact (existing). At most one send in flight. |
| INV-09 | `terminal` is sticky. After it is set, every `analyze()` throws the same code with zero sends. |
| INV-10 | After `cancelSignal` aborts, zero sends. Cancellation is checked first at every gate. |
| INV-11 | A recorded terminal code reaches the CLI envelope (top-level for `STAGE_TIMEOUT`, first reason code for `RATE_*`) unless a higher-precedence outcome (§11.4) applies. |
| INV-12 | Commit only if a result is stored, `exitCode === 0`, `killed === null`, and settlement was normal. |
| INV-13 | v1 config or disabled governor: spawn, environment, IPC traffic, exit codes and output identical to the certified baseline; SEC-C1 present. |
| INV-14 | All accounting values are safe integers. |
| INV-15 | Provider hints only tighten admission. Invalid hints are ignored. |
| INV-16 | No prompt, content, key, raw header, raw usage object or raw provider error crosses the observer boundary or enters IPC, logs or the CLI envelope. |

## 17. Non-guarantees

C3 does **not** guarantee:

1. Compliance with any provider's TPM, RPM, RPD or TPD accounting (PD-R10).
2. Rate isolation from other processes, earlier CLI invocations still completing
   remotely, or other tools on the same account.
3. That a locally aborted or timed-out request was not processed or charged by
   the provider.
4. Accuracy of the token estimator, or that `b / κ` bounds tokens.
5. The meaning of any provider header (PD-R9).
6. Exact timer firing times, or any wall-clock bound across system suspend.
7. A bound on kill → `exit` latency (phase K), parent validation/commit time
   (phase V), or whole-CLI settlement time.
8. Completion of any particular N. Large N fails closed (proofs §5).
9. That a healthy child cannot be killed by the watchdog if a single synchronous
   step or a result transfer exceeds about 45 s without heartbeats (§13.2).

## 18. Future implementation touchpoints (design only; nothing implemented)

| Area | Expected change | Notes |
|---|---|---|
| New internal governor module(s) | ledger, estimator, normalizer, hint parsers, wait loop, terminal record | requires a package-surface-v6 inventory update and external install proof (C2:444) |
| `providers/groq-provider.js`, `gemini-provider.js` | internal `observer` option (§9.6) | `null` default keeps baseline behavior and SEC-C1 |
| `providers/index.js` | internal option pass-through for the governed child only | not exported |
| `cli/generative-runner.js` | build governor from validated `governor` payload; heartbeat; terminal merge; `stage-timeout` kind | FT0 `guardParentLink()` unchanged except heartbeat clearing at `report()`/`fail()` |
| `cli/stage-process.js` | governed-only: heartbeat validation, watchdog, enforcement timer, sticky `killed`, discard on kill | FT0 receipt/ACK and `CAE` paths unchanged |
| `cli/generative.js` | `stage-timeout` and killed-reason classification | |
| `cli/run-artifacts.js` | `GOVERNOR_REASON_CODES` allowlist | `PROVIDER_ERROR_CODES` untouched |
| `cli/config-file.js` | schema v2 (§5) | v1 unchanged |
| Contract docs | contract §10.7 reason codes, contract §11 schema v2 | separate PO-authorized canonical amendment (C-A) |

Generators: **no change**.

## 19. Remaining open PO decisions

| ID | Question | C3 assumption | Blocking for C3 review? |
|---|---|---|---|
| PD-R1 | Keep two attempts, or add a separate bounded 429 budget | two attempts (status quo) | No, while two attempts remain binding (reviewer) |
| PD-R4 | Send a completion-token cap | no cap (status quo); `Res` uses declared reserves only | No (reviewer) |
| PD-R7 | Include triage | generative only; SEC-C1 already in triage via FT0 | No (reviewer) |
| PD-R9 | Authorize real-provider evidence (S4) | not authorized; zero calls | No for design review; required before S4 |
| PD-R12-I1 (new, confirmation) | Confirm C3's reading of PD-R12 A: Malformed usage → saturate **and** `RATE_ACCOUNTING_INVALID`; Unavailable (incl. uncertain completion) → saturate | as stated in §9.4 | No. C3 uses the most conservative reading. The alternative (Malformed → saturate only) is a one-row change. |
| PD-R15 (new) | Whether the parent may stop waiting for `exit` some fixed time after a kill (phase K) | no new cap (D+15 A forbids inventing a global hard bound) | No. Safety (INV-12) holds without it; only liveness depends on the OS. |

PD-R2, PD-R3, PD-R5, PD-R6, PD-R8, PD-R10, PD-R11, PD-R12, PD-R13, PD-R14,
SEC-C1 and D+15 are not reopened.
