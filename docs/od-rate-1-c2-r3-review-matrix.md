# OD-RATE-1-C2-R3 — Review Traceability Matrix (Consolidated Corrective C3)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-review-matrix.md` (3 of 3; companions: [design](od-rate-1-c2-r3-design.md), [proofs](od-rate-1-c2-r3-proofs.md)) |
| Status | **PENDING INDEPENDENT HEAVY REVIEW.** No finding is marked closed by this author. |
| Review input | Codex session `01a17740-3dc0-7ee2-b26e-a538092270cd`, HEAVY Architecture Design Review of OD-RATE-1-C2, verdict REJECTED (transcript SHA-256 `2f2744594809617aad701f2b594aba3fc14ac3fbcd2819afd89fbb57f84b22db`) |
| Baseline | `main` `a32a6cd7e0a1bdc9917fc3abc7f692039591a145` / tree `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Historical evidence | C2 file SHA-256 `1c0851be7a40a9406c7d75daa7d9676534b4e61f7ff542a93be53f3e2f74c054` inside package manifest `eeb5a063b09803513eeb6ef77893802a37bf39e55d6abc8d5a955257d9ecbff9` (unmodified) |

Abbreviations: **D** = design document, **P** = proofs document. Test IDs refer to
§2. All tests are specifications for a future, separately authorized
implementation. **None has been written or run.**

---

## 1. Traceability table

| Finding | Reviewer evidence | C3 design clause | Proof / counterexample | Future touchpoints | Deterministic tests | Residual risk | Proposed disposition |
|---|---|---|---|---|---|---|---|
| **R2-ARCH-01** MAJOR: RPM gate missing | C2:229–240 declares `requestsPerMinute`; Appendix A (C2:617–648) defines only token, cooldown and hint gates. CE: `RPM=1, B=6800, Res=3201`, sends at 65 and 65.1 s both admitted. | D §7 (two ledgers over one entry list, joint predicate §7.2, atomic admission §7.3, FIFO serialization §7.4, retries §7.5, hints §7.6, INV-01/02) | P §3 Lemma 1 (≤ `B_req` sends per 65 s interval); P §4.1 trace: second send deferred to 130.1 s; P §8 table A (C2: 65.0/65.1; C3: 65.0/130.1) | new governor module; `generative-runner.js` construction | T01-1 … T01-9 | Local only: other processes or accounts can still exhaust provider RPM. `B_req` has no headroom by design (reviewer Q3). | ADDRESSED_IN_C3 / PENDING_INDEPENDENT_REVIEW |
| **R2-ARCH-02** MAJOR: governor reason codes lost | C2:103, 345–357, 573; `automation-plan-generator.js` L672–681 and `generate-change-set.js` L267–275 map every provider error to `INVALID_VALUE`. `KNOWN_CODES` alone cannot restore lost codes. | D §11 (sticky terminal record read by the runner; generators unchanged; child result shapes §11.3; precedence §11.4; envelopes §11.5); D §15 | Trace: D §11.5 envelope for attempt-2 refusal in `plan`; precedence table proves `providerAttempts ≥ 1` keeps refusals out of exit 4. P §6.2 timeline for `STAGE_TIMEOUT`. | `generative-runner.js`, `generative.js` `classifyChildFailure()`, `run-artifacts.js` allowlist (separate `GOVERNOR_REASON_CODES`) | T02-1 … T02-9 | Two new top-level codes and one config code need the PD-R8 envelope review and the canonical contract amendment (C-A). | ADDRESSED_IN_C3 / PENDING_INDEPENDENT_REVIEW |
| **R2-ARCH-03** MAJOR: invalid temporal proofs | C2:256–268, Appendix D (C2:680–707); CE `B=6800, Res=3400, d=29.9` → 36 sends, 661.7 s wait, 1 738.1 s, deadline refusal; 1 815 s kill ≠ settlement (`stage-process.js` L139–158). | D §14 (separate phases G/W/P/H/E/A/K/S/V; explicit holds / does-not-hold list); D §17 non-guarantees; C2's `k ≤ 26` and "3 × 1 815 s" withdrawn | P §5.2 reproduces 36 / 661.7 / 1 738.1 analytically and in simulation. `k ≤ 26` holds only for `d = 0`; constant-`d` max is 40 (analytic proof); P §3 Corollary 1 `k ≤ 27·n_max`; P §5.3 tables for N=1/6/200; P §5.5 `c > 0`; P §6 timelines. | `stage-process.js` (enforcement timer, sticky `killed`), `generative-runner.js` (`P_dead`) | T03-1 … T03-7 | Phases K and V are OS/I-O dependent; no whole-CLI bound exists. Tables assume constant `Res`/`d`. | ADDRESSED_IN_C3 / PENDING_INDEPENDENT_REVIEW |
| **R2-ARCH-04** MAJOR: wait-budget excess before dispatch | C2:638–643: pre-check on raw wait; `sleep(max(wait, 50))`; no budget check after waking. CE `waited=899990`, wait 1 ms → 900 040 ms, then send. | D §8 (order of checks; pre-sleep check on **planned** sleep incl. `S_MIN`; post-wake check on **observed** wait; INV-05) | P §3 Lemma 2; P §4.2 traces T1 (refused before sleep), T2 (post-wake refusal at 900 040), T3 (oversleep 140 ms), T4 (arbitrary oversleep vs. deadline), T5 (cancel during wait) | governor wait loop | T04-1 … T04-6 | Observed wait can exceed 900 s by the last oversleep; a **send** after that cannot happen. | ADDRESSED_IN_C3 / PENDING_INDEPENDENT_REVIEW |
| **R2-ARCH-05** MINOR: HTTP 408 semantics | C2:664 lists 408 as a generic retryable case; `gemini-provider.js` L44–68 maps 408 to non-retryable `UNKNOWN`; `groq-provider.js` L41–71 maps it to retryable `TIMEOUT`. | D §10 per-provider table (408, 429, other 4xx, 5xx, transport, abort, request timeout, remote outcome unknown); governor adds zero retries; two attempts kept | P §4.3 AC-8 (Groq timeout → saturate → attempt 2 at 160 s) and AC-9 (Gemini 408 → one send) | none in providers' classification; observer only | T05-1 … T05-5 | Provider behavior and header meanings unverified at runtime (PD-R9). | ADDRESSED_IN_C3 / PENDING_INDEPENDENT_REVIEW |
| **DRIFT-01** FT0 SEC-C1 cancellation | `providers/index.js` L20–55 (`bindCancelSignal`); `generative-runner.js` L130–193; providers' abort paths. C2 described them as absent. | D §12 (single process-scoped signal; governor bound to `parentLink.signal`; `P_cancel` first; cancel outranks cooldown/retry; no new handler; PD-R14 preserved); INV-10 | P §4.2 T5; P §6.5 timeline | governor construction in `generative-runner.js` only; FT0 code unchanged | TD1-1 … TD1-6 | Remote completion of an aborted request is unknowable. | ADDRESSED_IN_C3 / PENDING_INDEPENDENT_REVIEW |
| **DRIFT-02** IPC receipt/ACK/settlement | `stage-process.js` L122–158; `generative-runner.js` L140–193; Node child-process semantics. Heartbeat/deadline not integrated with the FT0 state machine; send callback ≠ receipt. | D §13 (FT0 protocol unchanged §13.1; governed heartbeat, watchdog and enforcement timer §13.2; terminal cleanup §13.3; parent handler §13.4; sticky `killed` §13.5; acceptance §13.6; platform table §13.7) | P §6.1–§6.7 timelines incl. ACK-then-kill and Windows missing `close` | `stage-process.js` (governed-only additions), `generative-runner.js` (heartbeat start/stop) | TD2-1 … TD2-11 | Watchdog can kill a healthy child if one synchronous step or a huge result transfer exceeds about 45 s without heartbeats. Kill → `exit` unbounded (PD-R15). | ADDRESSED_IN_C3 / PENDING_INDEPENDENT_REVIEW |

---

## 2. Deterministic test specifications (future; none implemented)

Common harness: an injectable monotonic clock and timer facade inside the
governor and lifecycle modules (production uses `process.hrtime.bigint()` and
real timers); fake `fetchImpl` / local HTTP server that records every request;
real child processes for IPC cases; Windows and POSIX runners. No real provider.

### R2-ARCH-01

| ID | Setup | Expected |
|---|---|---|
| T01-1 | CE-01: RPM 1, `B_tok` 6 800, `Res` 3 201, first response after 100 ms | exactly 2 requests at fake times 65 000 and 130 100 ms |
| T01-2 | RPM 1, light `Res`, instant responses, unlimited demand | 13 requests, then `RATE_BUDGET_EXHAUSTED` (P table D) |
| T01-3 | RPM 30, heavy `Res` | one request per hold; RPM never binds |
| T01-4 | Two concurrent `analyze()` callers | never two requests in flight; FIFO order; Lemma 1 holds |
| T01-5 | Response delayed 29.9 s | entry expiry measured from settle (`tSettle + 65 000`), not admit |
| T01-6 | Attempt 1 invalid JSON → correction attempt 2 | exactly one new entry per attempt; no entry while waiting |
| T01-7 | Groq `x-ratelimit-remaining-requests: 5` then `0` with `reset` 30 s / 2 h | `5` never relaxes `P_req`; `0` with 30 s blocks until reset + 5 s; with 2 h → `RATE_BUDGET_EXHAUSTED`, no sleep |
| T01-8 | Hint claiming more capacity than the ledger | admission unchanged (tighten only) |
| T01-9 | Property test: random `Res`, `d`, `c`, RPM over 10⁴ seeds | the request log satisfies Lemma 1 for every 65 s window and Corollary 1 per stage |

### R2-ARCH-02

| ID | Setup | Expected `--json` |
|---|---|---|
| T02-1 | `plan`, attempt 1 `Res > B_tok` | `errors[0].code = PROVIDER_FAILURE`, message reason codes start with `RATE_REQUEST_EXCEEDS_BUDGET`, exit 6, nothing written |
| T02-2 | `generate`, attempt 1 invalid output, attempt 2 correction prompt `> B_tok` | reason codes `RATE_REQUEST_EXCEEDS_BUDGET, INVALID_VALUE`; attempts 2; exit 6 |
| T02-3 | `design`, wait budget exhausted at an AutomationCandidate | `RATE_BUDGET_EXHAUSTED` present (not `UNKNOWN`) |
| T02-4 | Governor `P_dead` refusal | top-level `STAGE_TIMEOUT`, exit 6 |
| T02-5 | After any terminal refusal, call `analyze()` again (unit) | same code; zero requests |
| T02-6 | Precedence: (a) disconnect during step; (b) enforcement kill after a stored result; (c) watchdog | (a) no result, child exit 1; (b) `STAGE_TIMEOUT` 6; (c) `CHILD_UNRESPONSIVE` 1 |
| T02-7 | v1 config, all existing generative tests | outputs byte-identical to baseline; governor codes unreachable |
| T02-8 | Provider error message containing a marker string | marker absent from stdout, stderr and IPC |
| T02-9 | Governor refusal on attempt 1 | never exit 4 (`providerAttempts ≥ 1`) |

### R2-ARCH-03

| ID | Setup | Expected |
|---|---|---|
| T03-1 | Implementation on the fake clock with P §8 scenarios | identical send counts, waited and stop reasons to P §8 tables A–D |
| T03-2 | Heavy, `c = 65 s`, `d = 0` | 27 requests, then `STAGE_TIMEOUT` |
| T03-3 | Any scenario | no request at child time `> t0 + 1 770 000` |
| T03-4 | Child stalls (no result) | parent decides kill at the first timer callback `≥ tSpawn + 1 815 000`; `killed` sticky; settlement by the FT0 `close` / `CAE` path; `STAGE_TIMEOUT` |
| T03-5 | Child start-up delayed 20 s (injected) | parent enforcement fires before child `P_dead`; `STAGE_TIMEOUT`; no commit |
| T03-6 | Light, `d = 29.9 s` | 36 requests, `STAGE_TIMEOUT` before the wait budget |
| T03-7 | Light, `d = 21.1 s` | 40 requests, `RATE_BUDGET_EXHAUSTED` |

### R2-ARCH-04

| ID | Setup | Expected |
|---|---|---|
| T04-1 | `waited = 899 990`, `freeAt − now = 1` | `RATE_BUDGET_EXHAUSTED` before any sleep; 0 requests |
| T04-2 | `waited = 899 900`, planned 50, timer fires 140 ms late | refusal after waking (`waited = 900 040`); 0 requests |
| T04-3 | Test hook forcing a raw-wait pre-check (C2 behavior) | post-wake gate refuses; 0 requests |
| T04-4 | Wake 630 s late at `t0 + 1 700 000` | refusal; 0 requests |
| T04-5 | Abort the signal during sleep (in-process harness, no exit) | sleep rejects; 0 requests |
| T04-6 | `freeAt` keeps moving (hint churn) | `RATE_BUDGET_EXHAUSTED` after `I_MAX` iterations |

### R2-ARCH-05

| ID | Setup | Expected |
|---|---|---|
| T05-1 | Groq 408 then 200 | 2 requests; second after the saturation hold (`tSettle + 65 000`) |
| T05-2 | Gemini 408 | 1 request; artifact fails, non-retryable |
| T05-3 | Both providers × {429, 401, 403, 400, 413, 500, 503, DNS error, fetch timeout, body timeout, oversized body} | classification equals the certified provider tables; ≤ 1 request per `analyze()` |
| T05-4 | 429 with `Retry-After: 120` | next `analyze()` → `RATE_BUDGET_EXHAUSTED`, no sleep |
| T05-5 | 429 with an HTTP-date `Retry-After` | ignored; 65 s cooldown |

### DRIFT-01

| ID | Setup | Expected |
|---|---|---|
| TD1-1 | Governed child start-up | governor's signal `===` the one bound by `bindCancelSignal()`; a second, different bind still throws |
| TD1-2 | Parent killed during a governor sleep (real processes, local server) | child exits ≤ 2 s; 0 further requests |
| TD1-3 | Parent killed during an in-flight request | request aborted; 0 further requests |
| TD1-4 | Parent killed during a 429 cooldown | 0 further requests |
| TD1-5 | Governor disabled: existing SEC-C1 suite | unchanged, green |
| TD1-6 | Listener census | no new `SIGINT`/`SIGTERM`/`SIGHUP` listeners in parent or child |

### DRIFT-02

| ID | Setup | Expected |
|---|---|---|
| TD2-1 | Governed sleep of 65 s (fake timers) | heartbeats at 10 s period throughout; watchdog never fires |
| TD2-2 | Child reports | no heartbeat is sent after the result |
| TD2-3 | Child sends invalid, duplicate and out-of-order `seq` only | watchdog not re-armed; `CHILD_UNRESPONSIVE` at 45 s |
| TD2-4 | ACK overtakes the send callback (existing FT0 case) with the governor on | delivered; exit 0; commit |
| TD2-5 | Parent disconnects before ACK | child exit 1; no commit |
| TD2-6 | Result stored and ACKed, enforcement fires before `close` | result discarded; `STAGE_TIMEOUT`; no write |
| TD2-7 | Result arrives after `killed` | not stored, not ACKed |
| TD2-8 | Windows: child exits with IPC data unread | `CAE` fallback; `result = null`; no commit |
| TD2-9 | v1 golden | IPC log identical to baseline (no heartbeat, no `governor` member) |
| TD2-10 | After ACK | child has no live timers except FT0's; exits promptly |
| TD2-11 | External SIGKILL of the child (not the parent's kill) | `STAGE_FAILED` exit 1, never `STAGE_TIMEOUT` |

---

## 3. Approved PO decisions and their interpretation in C3

| Decision | Interpretation | Where |
|---|---|---|
| PD-R11 A | `charged = max(Res, U)` for valid usage; no refund in any case; charges above the reservation are recorded unclamped and block admission until expiry; entries expire at `tSettle + 65 s`; unsettled entries never expire; failures and uncertain outcomes charge `B_tok` (PD-R12). | D §9.4, §9.7; P §4.3 |
| PD-R12 A | Missing usage → saturate the effective provider's token ledger in this process until `tSettle + 65 s`; request ledger unaffected. C3 also saturates on Unavailable usage (any non-2xx or failed exchange, incl. uncertain remote completion), and on Malformed usage (then `RATE_ACCOUNTING_INVALID`). Never zero. | D §9.3–§9.5. Confirmation requested: PD-R12-I1. |
| D+15 A | Kill decision at `tSpawn + 1 815 s` is one phase boundary (E). Termination (K), settlement (S, FT0 `CAE` unchanged), result transfer (A, FT0 ACK unchanged) and parent validation (V) are separate, with explicit failure behavior. No whole-CLI bound; no new global hard bound; no change to FT0 termination. | D §14; P §6 |
| PD-R2, R3, R5, R6, R8, R10, R13, R14, SEC-C1 | Preserved as listed in D §2.4. | D §2.4 |

## 4. Still-open policy decisions

| ID | Status | Note |
|---|---|---|
| PD-R1 | OPEN | Two attempts assumed (status quo). |
| PD-R4 | OPEN | No completion cap assumed (status quo). |
| PD-R7 | OPEN | Generative scope only. |
| PD-R9 | OPEN | No real-provider calls; needed before S4. |
| PD-R12-I1 | NEW, confirmation | C3's reading of PD-R12 A for Malformed and Unavailable usage (D §19). |
| PD-R15 | NEW | Optional parent cap on waiting for `exit` after a kill (phase K). C3 default: none. |

## 5. Questions for the independent HEAVY reviewer

1. Does the terminal channel (D §11.2) preserve governor reason codes without
   generator changes in every path, including a generator that throws instead of
   returning a failure?
2. Is `failure.kind: "stage-timeout"` plus top-level `STAGE_TIMEOUT` (exit 6) the
   right PD-R8 surfacing, given contract §10.7 "provider bounded-time exceeded"?
3. Is `B_req = requestsPerMinute` with no headroom acceptable, given the 65 s hold
   (Lemma 1), or should `h` also apply to RPM?
4. Is saturating on **every** Unavailable outcome (incl. 429 and 5xx) the right
   reading of PD-R12 A, given that it turns light behavior into heavy behavior
   after any failure?
5. Is discarding the content of a response whose usage is Malformed (AC-6)
   acceptable, versus saturating only?
6. Keeping the parent enforcement timer armed after a result is stored (D §13.2)
   bounds the wait for `exit` but can discard an ACKed result (P §6.7). Is that
   trade-off acceptable?
7. Ignoring (rather than killing on) invalid heartbeats differs from C2's
   "invalid IPC → kill + `STAGE_FAILED`". Is the watchdog sufficient?
8. Is the `PROVIDER_GOVERNOR_LIMITS_MISSING` exit 3 classification consistent with
   contract §10.7 "provider/framework environment configuration"?
9. Are the Corollary 1 bound and the analytic constant-`d` maximum sufficient
   quantitative evidence, given that the variable-`d` light maximum is not proven?
10. Is PD-R15 (no post-kill cap) acceptable as a liveness non-guarantee?

## 6. Newly discovered design incompatibilities and C2 corrections

| ID | Finding | Effect on C3 |
|---|---|---|
| NDI-01 | `plan`/`generate` generators send their **correction** prompt on attempt 2 after a retryable provider error; C2 said every transport retry resends the identical prompt (C2:75). | Retry is re-estimated per call (D §10). No design change needed. |
| NDI-02 | The heavy-regime `k ≤ 13` (C2 and reviewer, "within stated assumptions") requires zero caller processing between requests. With `c > 0`, up to 27 sends are possible and the deadline can bind first. | Corollary 1 is the universal bound; tables state `c = 0` (P §5.5). |
| NDI-03 | C2 Appendix A used different completion reserves per step (2 000 RM, 2 500 TCM), but the config sketch has one reserve per provider. | C3 config has one reserve per provider plus an optional reasoning reserve (D §5.1). |
| NDI-04 | Design-stage generators already forward `ProviderError.code`; only `plan`/`generate` collapse codes. | The terminal channel covers both uniformly (D §11.2). |
| NDI-05 | C2 Appendix C charged only the reservation for 408/5xx/network/timeout outcomes. Under PD-R12 A, C3 saturates instead (remote completion unknown; no completion cap). | D §9.4; reviewer Q4. |
| NDI-06 | C2 proposed that a 413 tightens future requests of that size. 413 is non-retryable, so the stage ends anyway. | Dropped as having no effect (D §10). |
| NDI-07 | C2 proposed killing the child on any invalid IPC message. The certified FT0 parent ignores non-result messages. | C3 ignores invalid heartbeats and relies on the watchdog (reviewer Q7), so FT0 semantics are unchanged. |
| NDI-08 | C2 proposed a child self-deadline at 1 800 s. With no new abort source, C3 enforces it algorithmically (`P_dead`) plus the existing 30 s provider timer. | No competing cancellation mechanism (D §13.3). |
| NDI-09 | The parent's FT0 "store before ACK" is in-memory storage, not disk persistence. | ACK ≠ commit is stated explicitly (D §13.1). |

Withdrawn C2 statements: `k ≤ 26` (C2:685); "the 900 s wait budget binds before
the 1 800 s deadline" (C2:265–267); "whole-workflow hard bound 3 × 1 815 s ≈ 91 min"
(C2:703); "the 15 s parent grace is enough" (C2:268); 408 as a generic retryable
case (C2:664).

## 7. Lifecycle

This corrective produces an exact-head design PR only. It grants no independent
approval, merge authorization, post-merge certification or canonical closure.
Next permitted step: **independent HEAVY exact-head design re-review.**
