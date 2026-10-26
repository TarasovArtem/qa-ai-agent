# OD-RATE-1-C2-R3 — Review Traceability Matrix (Consolidated Corrective C4)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-review-matrix.md` (3 of 3; companions: [design](od-rate-1-c2-r3-design.md), [proofs](od-rate-1-c2-r3-proofs.md)) |
| Revision | C4 (supersedes C3 at `eff78a0c8d05b85b422f9945ced664485d7d563f`) |
| Status | **PENDING INDEPENDENT HEAVY REVIEW.** No finding is marked closed by this author. |
| Review input | Codex session `01a17740-3dc0-7ee2-b26e-a538092270cd`: R2 review of C2 (REJECTED) and R3 exact-head re-review of C3 `eff78a0c` (REJECTED). Transcript SHA-256 at C4 authoring time: `00c039587b2607e9eb017dc8da5118fc6bef03ef89c038de3af3717d8a46777c` |
| Baseline | `main` `a32a6cd7e0a1bdc9917fc3abc7f692039591a145` / tree `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Historical evidence | C2 SHA-256 `1c0851be…c054` in manifest `eeb5a063…cbff9` (unmodified) |

**D** = design, **P** = proofs. Test IDs refer to §2. All tests are specifications
for a future, separately authorized implementation. **None has been written or run.**

---

## 1. Traceability table: C4 targets

| Finding | Exact reviewer evidence (R3) | Corrected C4 design clause | Proof / counterexample | Future touchpoints | Tests | Residual risk | Open PO authority | Proposed disposition |
|---|---|---|---|---|---|---|---|---|
| **R2-ARCH-02** MAJOR (still open) | D(C3):592 requires the same result when a stage **throws**, but the terminal record held only `{code}`; step and `providerAttempts` after unwinding were undefined; parent `generative.js` L56–61 normalizes a missing count to 0 → exit 4; "terminal wins" sets priority but does not prove causation. | D §11.2 runner-owned `StageContext` (`stepSeq`, `step`, `calls`, `terminal`, `refusals` `WeakSet`, `cancelled`); §11.3 separate `classifyReturn` / `classifyThrow` (E1 identity-matched rethrow, E2 unrelated exception after refusal, E3 unchanged); §11.4 shapes; §11.5 four proofs; §11.6 precedence; INV-11 | P §4.6 EX-1…EX-10 (survival: EX-2/3/5/6/10; no relabel: EX-3/4/5/9; counts never invented: EX-1/7) | `generative-runner.js` (`StageContext`, `beginStep`, classifiers), `generative.js` (`stage-timeout`, `governorCode`), `run-artifacts.js` allowlist. No generator change. | T-R2-02-1…10 | E2 delivers the governor code only as an extra reason in a `STAGE_FAILED` (1) message, by design, to avoid relabelling. | Exact envelope wording within PD-R8 review. | ADDRESSED_IN_C4 / PENDING_INDEPENDENT_REVIEW |
| **R3-ARCH-01** MAJOR | D(C3) §9.3–9.6 L445–512, D:544, P:97–113. Baseline parses JSON before the content check (Groq L231–248). CE: `Res=3400`, `B_tok=6800`, valid usage `100/6900/7000`, content absent → C3 catch charged 6 800; required 7 000. Malformed usage + absent content never set `RATE_ACCOUNTING_INVALID`. | D §9.1 six-axis exchange record (transport, HTTP, body, content, usage, inner result); §9.4 charge by usage class only; §9.6 observer called after the bounded read and before the content check; §9.7 settlement with precedence cancellation > gate > malformed > provider outcome; INV-17 | P Lemma 7; P §4.3 AC-13 (charge 7 000), AC-14/15 (malformed → 6 800 + `RATE_ACCOUNTING_INVALID`), AC-16…AC-21 | providers: one `observer.onParsedBody()` call between `readBoundedResponseJson` and the content check; governor exchange record | T-R3-01-1…9 | Usage values are untrusted; a forged high value only slows admission. | None: PD-R11 A and PD-R12-I1 are approved. | ADDRESSED_IN_C4 / PENDING_INDEPENDENT_REVIEW |
| **R3-ARCH-02** MAJOR | D(C3) §7.3, §8.2, INV-06; P:63–73, Lemma 3:159–161. Groq L162–199 serializes before transport. CE: `nowMs() = 1770000` passes; 1 ms of setup; dispatch at 1 770 001 without any `await`. Run-to-completion does not stop the clock. | D §7.3 linearization at entry creation and the "time passes" rule; §7.8 gated `fetchImpl` with a fresh reading, absolute `dispatchDeadline` and cancellation via `slot`, one invocation per admission; INV-06 restated at the transport-invocation boundary; explicit non-claim about wire emission; §14 phases G1/G2/G3 | P Lemma 3, Lemma 5; P §4.4 DT-1 (1 ms advance → refused, 0 invocations), DT-2…DT-6 | governor gate passed as `fetchImpl` (existing constructor option) | T-R3-02-1…7 | Wire emission after `fetch()` is not observable; bounded only by the provider's certified 30 s controller. | None required: no approved contract promised wire timing (D §7.8). The reviewer is asked to confirm (§5 Q2). | ADDRESSED_IN_C4 / PENDING_INDEPENDENT_REVIEW |
| **R3-ARCH-03** MAJOR | D(C3) §4, §7.5, §10, INV-08; P:99, Lemma 4. Providers call `fetchImpl` without a redirect policy (Groq L185–199; Gemini L195–210). CE: RPM = 1, one `fetch()`, `307 /first → /second` → 2 POSTs, 1 admission. Reviewer verified on Node 24.22.1 localhost. | D §7.9 governed calls always use `redirect: "manual"`; 3xx is recorded `REDIRECT_NOT_FOLLOWED`, classified by the certified providers as non-retryable `UNKNOWN`, usage UNAVAILABLE → saturate; `"error"` rejected (it would become retryable `NETWORK`); multi-hop admission not designed; ungoverned unchanged; T1; INV-08 restated | P Lemma 4 (one invocation per admission; one request per invocation under T1; occupancy over invocation times); P §4.5 RD-1…RD-4; P §8.3 localhost: Node 22.23.3 and 24.22.1, default 2 requests, `manual` 1 request with 307 | gate only; provider classification unchanged; follows the Jira and Azure DevOps provider precedent | T-R3-03-1…8 | T1 is observed, not certified, and must be re-verified per Node line. | None: no multi-hop authority is requested. | ADDRESSED_IN_C4 / PENDING_INDEPENDENT_REVIEW |
| **R3-ARCH-04** MINOR | D(C3):332–335 promised to account FIFO waiting; P:55 `await queue.enter()` was not measured; `waited` changed only after sleep (P:79–81). | D §8.3 global union model: enter at `analyze()` entry, leave at admission, refusal or cancel; overlap counted once; queue waits bound to `cancelSignal`; queue time consumes the deadline and the budget; sequential meaning unchanged | P §4.2 Q1 (sequential: `W` = C3 sum), Q2 (union 160 s vs. per-caller 225 s), Q3 (cancel while queued), Q4 (queue exhausts budget) | governor `enterWaiting` / `leaveWaiting` | T-R3-04-1…5 | Concurrent callers are outside the supported scope; their accounting is defined but not exercised by current generators. | None for the supported scope (meaning unchanged); per-caller policy is informational (D §19.3). | ADDRESSED_IN_C4 / PENDING_INDEPENDENT_REVIEW |
| **R3-ARCH-05** MINOR | P(C3):270–272 gave a lower endpoint of 21.05 s; `65 + 19(65 − 21.05) = 900.05 > 900`; exact `400/19 s`; integer ms `21053`. | P §5.2 interval `[400/19, 23.5] s` = `[21 053, 23 500]` ms; boundary table 21 052 / 21 053 / 23 500 / 23 501; "constant-`d` maximum ≠ global maximum"; P §5.6 41-send trace; P Lemma 6 `k ≤ 41` for `c = 0` (tight); Corollary 1 `k ≤ 54` general | two independent artifacts agree: P §8.1 table E (21 052 → 38, 21 053 → 40, 23 500 → 40, 23 501 → 39, 41-trace → 41 / 895 000 / 1 770 000) and P §8.2 closed form (same values; `65·41 = 2 665 = 1 770 + 895`) | none (proofs only) | T-R3-05-1…4 | Tables still assume constant `Res` and `d`; the variable-`d` maximum with `c > 0` is bounded only by 54. | None. | ADDRESSED_IN_C4 / PENDING_INDEPENDENT_REVIEW |

### 1.1 R2 findings linked to R3 findings

| Finding | R3 status | Covered by | Proposed disposition |
|---|---|---|---|
| R2-ARCH-01 | STILL_OPEN: actual HTTP sends not covered | R3-ARCH-03 (Lemma 4 extends Lemma 1 to invocations and, under T1, HTTP requests) | ADDRESSED_IN_C4 / PENDING_INDEPENDENT_REVIEW |
| R2-ARCH-03 | STILL_OPEN: dispatch-time guarantee unproven | R3-ARCH-02 (gate, Lemma 3, phases G1–G3), R3-ARCH-05 (numerics), PD-R15 phase K | ADDRESSED_IN_C4 / PENDING_INDEPENDENT_REVIEW |

### 1.2 Regression gates (resolved by R3; must stay resolved)

| Gate | R3 basis | C4 preservation | Evidence |
|---|---|---|---|
| R2-ARCH-04 | planned sleep incl. 50 ms floor; observed wait after wake; budget checked before availability | Same order in D §8.1; `Wnow` replaces the sleep sum and equals it for sequential callers (P §4.2 Q1). T1–T5 unchanged. | P §4.2; T-R2-04-1…3 |
| R2-ARCH-05 | Groq 408 retryable, Gemini 408 not; 429/5xx retryable; other 4xx not; no governor retries | D §10 unchanged except an added 3xx row (non-retryable, from certified mapping) and a gate-refusal row | T-R2-05-1…3 |
| DRIFT-01 | same `parentLink.signal`; sleeps and in-flight fetch cancelled; no new handler; PD-R14 | D §12 adds one check at the gate (`CANCELLED`); nothing else changes | T-D1-1…6 |
| DRIFT-02 | receipt/ACK, store-before-ACK, late/duplicate handling, sticky `killed`, no commit after kill | D §13.1–§13.4 unchanged. The kill sequence (§13.5) adds no disconnect at kill time. Post-kill settlement (§13.8) runs only after a kill and uses the certified `settled` guard. | T-D2-1…14 |

---

## 2. Deterministic test specifications (future; none implemented)

Harness: injectable monotonic clock and timers inside the governor and lifecycle
modules; a fake `fetch` that records calls; a localhost HTTP server for transport
tests; real child processes for IPC; Windows and POSIX runners. No real provider.

### R2-ARCH-02 (exception paths)

| ID | Setup | Expected |
|---|---|---|
| T-R2-02-1 | EX-1 (`plan`, refusal on attempt 2, generator returns) | `PROVIDER_FAILURE`, 6, codes `RATE_REQUEST_EXCEEDS_BUDGET, INVALID_VALUE`, attempts 2 |
| T-R2-02-2 | stub generator rethrows the refusal object (E1) | identical envelope to the return path; attempts = `ctx.calls` = 1 |
| T-R2-02-3 | stub throws `TypeError` after a refusal (E2) | `STAGE_FAILED`, 1; message contains the governor code; no `PROVIDER_FAILURE` |
| T-R2-02-4 | stub throws `TypeError` with no refusal (E3) | byte-identical to baseline internal failure |
| T-R2-02-5 | stub throws `new Error("x", {cause: refusal})` | E2, not E1 |
| T-R2-02-6 | gate `DEADLINE` refusal rethrown | `STAGE_TIMEOUT`, 6, attempts 1 |
| T-R2-02-7 | return path with `providerAttempts` undefined after a refusal | exit 6 with attempts = `ctx.calls`; never 4 |
| T-R2-02-8 | refusal then cancellation | no result sent (FT0) |
| T-R2-02-9 | `governorCode` not in `GOVERNOR_TERMINAL_CODES` (forged IPC in a unit test) | dropped by the parent |
| T-R2-02-10 | ungoverned runs (all existing generative tests) | byte-identical results; no `StageContext` created |

### R3-ARCH-01 (failure-path accounting)

| ID | Setup | Expected |
|---|---|---|
| T-R3-01-1 | AC-13: fake 2xx body `{usage:{100,6900,7000}}` with no content | entry charged 7 000; provider error `INVALID_RESPONSE` rethrown unchanged |
| T-R3-01-2 | AC-14: malformed usage, no content | charged 6 800; `RATE_ACCOUNTING_INVALID` sticky |
| T-R3-01-3 | AC-15: malformed usage, content present | charged 6 800; refusal; content not returned |
| T-R3-01-4 | AC-16: valid 1 000, no content | charged `Res` |
| T-R3-01-5 | AC-17: usage absent, no content | charged 6 800 |
| T-R3-01-6 | Gemini equivalents of 1–5 (`usageMetadata`) | same |
| T-R3-01-7 | observer throws inside the normalizer | MALFORMED; provider behavior otherwise unchanged |
| T-R3-01-8 | marker strings in usage keys and values, headers and content | absent from IPC, stderr and the envelope |
| T-R3-01-9 | observer call after the slot is sealed | ignored |

### R3-ARCH-02 (dispatch deadline)

| ID | Setup | Expected |
|---|---|---|
| T-R3-02-1 | DT-1: fake clock advances 1 ms inside the provider before `fetchImpl` | gate refuses; fake `fetch` call count 0; `STAGE_TIMEOUT` |
| T-R3-02-2 | DT-2: gate reading exactly `t0 + 1 770 000` | one `fetch` call |
| T-R3-02-3 | DT-4: abort between admission and gate | 0 `fetch` calls; cancellation rethrown |
| T-R3-02-4 | provider calls `fetchImpl` twice in one `analyze()` (test double) | second call refused; `RATE_ACCOUNTING_INVALID` |
| T-R3-02-5 | gate receives a provider `init` with its own `redirect` | overridden to `"manual"` |
| T-R3-02-6 | gate refusal maps to provider `NETWORK` | governor replaces it with `STAGE_TIMEOUT` (never retried) |
| T-R3-02-7 | Lemma 5 property test: random clock advances between admission and gate | `P_req`/`P_tok` never false at the gate; only `P_dead`/`P_cancel` refusals |

### R3-ARCH-03 (redirects)

| ID | Setup | Expected |
|---|---|---|
| T-R3-03-1 | localhost 307 `/first → /second`, governed Groq provider | server sees exactly 1 POST; provider `UNKNOWN`, not retryable; entry saturated |
| T-R3-03-2 | same for 301, 302, 303, 308 | 1 request each; same classification |
| T-R3-03-3 | same with Gemini | same |
| T-R3-03-4 | RPM = 1, redirect response, generator attempt 2 not taken (non-retryable) | total server requests 1 |
| T-R3-03-5 | ungoverned provider (v1) against the same server | default follow behavior unchanged (2 requests) |
| T-R3-03-6 | keep-alive socket closed by the server before the request | at most 1 request observed per `fetch` (T1 check) |
| T-R3-03-7 | run 1–6 on every supported Node line (22.x per `engines`) | T1 holds |
| T-R3-03-8 | `opaqueredirect` response from a fake | treated as `REDIRECT_NOT_FOLLOWED` |

### R3-ARCH-04 (queue accounting)

| ID | Setup | Expected |
|---|---|---|
| T-R3-04-1 | Q1 sequential | `W` equals the sum of observed sleeps (± entry-to-first-sleep compute) |
| T-R3-04-2 | Q2 two concurrent callers | union `W = 160 000`; never two outstanding sends |
| T-R3-04-3 | Q3 abort while queued | queued caller rejects; 0 admissions |
| T-R3-04-4 | Q4 queue time pushes `Wnow` over budget | `RATE_BUDGET_EXHAUSTED` at head; 0 admissions |
| T-R3-04-5 | generators never call `analyze()` concurrently (instrumented run of each stage) | queue length never exceeds 1 |

### R3-ARCH-05 (numerics)

| ID | Setup | Expected |
|---|---|---|
| T-R3-05-1 | light, constant `d = 21 052` ms | 38 admissions |
| T-R3-05-2 | `d = 21 053`, `23 500`, `23 501` ms | 40, 40, 39 |
| T-R3-05-3 | variable-`d` 41-trace | 41 admissions; last at `t0 + 1 770 000`; waited 895 000 |
| T-R3-05-4 | property test over random `d, c, Res` | admissions ≤ `27·n_max`; with `c = 0` and two slots ≤ 41 |

### Regression gates and lifecycle

| ID | Setup | Expected |
|---|---|---|
| T-R2-04-1…3 | P §4.2 T1, T2, T3 | as specified (0 admissions) |
| T-R2-05-1…3 | Groq 408, Gemini 408, full status matrix | as D §10 |
| T-D1-1…6 | C3 TD1-1…6 (same signal object; parent killed during sleep, in-flight request and cooldown; disabled-governor SEC-C1 suite; listener census) | unchanged expectations |
| T-D2-1…11 | C3 TD2-1…11 (heartbeat during 65 s sleep; none after result; invalid heartbeats; ACK before callback; disconnect before ACK; ACK-then-kill; late result after kill; Windows missing `close`; v1 golden; prompt exit; external SIGKILL → `STAGE_FAILED`) | unchanged expectations |
| T-D2-12 | KS-2: kill issued, fake child never emits `exit` | parent settles at `≥ tKill + K_SETTLE`; stdio destroyed; `unref` called; one stderr line; kill reason; no write |
| T-D2-13 | KS-3: `kill()` returns false, child alive | abandonment disconnect → child exits 1 via SEC-C1; localhost server sees 0 further requests |
| T-D2-14 | Windows: abandoned child, then the CLI exits | child terminated by job-object closure (verifies D §13.7 row) |
| T-D2-15 | KS-5: `exit` at `tKill + K_SETTLE − 1` | settles by `tExit + CAE` |
| T-D2-16 | kill decision does **not** call `disconnect()` | verified by spy; Windows `close` still arrives in KS-1 |

---

## 3. Approved PO decisions and interpretation

| Decision | Interpretation in C4 | Where |
|---|---|---|
| PD-R11 A | `max(Res, U)` for `VALID(U)` on resolve **and** reject paths; no refund; unclamped above `B_tok` | D §9.4, §9.7; P Lemma 7, AC-13 |
| PD-R12 A | MISSING → `B_tok` until `tSettle + 65 s`; request ledger unaffected | D §9.4–§9.5 |
| PD-R12-I1 (APPROVED) | MALFORMED → `B_tok` + sticky `RATE_ACCOUNTING_INVALID`, even with valid content; UNAVAILABLE (non-2xx, redirect, transport failure, uncertain completion) → `B_tok`; NOT_INVOKED (gate proved nothing was sent) → `Res` | D §9.4 |
| D+15 A | separate phases G1/G2/G3/W/P/H/E/A/K/S/V; no whole-CLI bound | D §14 |
| PD-R15 direction (APPROVED) | bounded post-kill settlement: phase K start and end, abandonment procedure, disconnect/unref, surviving-child responsibility, Windows/Linux rows, kill-reason classification and result discard | D §13.5–§13.8 |
| PD-R2/R3/R5/R6/R8/R10/R13/R14, SEC-C1 | preserved | D §2.4 |

## 4. Open policy decisions

| ID | Status | Note |
|---|---|---|
| **PD-R15 `K_SETTLE` value** | **PROPOSED 10 000 ms — REQUIRES PO APPROVAL** | Alternatives and justification in D §19.2. The design is complete for any value in `[1 000, 60 000]` ms; implementation of the post-kill path is gated on this disposition. |
| PD-R1 | OPEN | two attempts assumed |
| PD-R4 | OPEN | no completion cap assumed |
| PD-R7 | OPEN | generative scope only |
| PD-R9 | OPEN | no real-provider calls; required before S4 |

## 5. Questions for the independent HEAVY reviewer

1. Do E1/E2/E3 (D §11.3) correctly separate a rethrown refusal from an unrelated
   exception, and is identity matching through a `WeakSet` an acceptable causation
   test?
2. Is the transport-invocation deadline (INV-06, gate reading) the right enforceable
   restatement? Do you agree no PO contract change is needed because no approved text
   promised wire timing?
3. Is `redirect: "manual"` plus the certified non-retryable 3xx mapping a sufficient
   fail-closed design? Is T1, with per-Node-line re-verification, acceptable evidence?
4. Is charging `Res` (not `B_tok`) for a gate-refused (`NOT_INVOKED`) admission
   acceptable, given that the gate proves no transport invocation occurred?
5. Is the union wait model acceptable as "meaning unchanged" for the 900 s budget,
   given that queue time is zero for all current callers?
6. Is the kill sequence without an immediate disconnect (D §13.5), plus abandonment
   after `K_SETTLE`, the right balance between Windows `close` behavior and
   bounded settlement?
7. Is "a delivered kill means no further user-mode code, so no new request"
   sufficient for the surviving-child responsibility statement on both platforms?
8. Are Lemma 6 (`k ≤ 41`, `c = 0`) and Corollary 1 (`k ≤ 54`) together an adequate
   quantitative statement, with the constant-`d` maximum explicitly non-global?

## 6. Newly discovered incompatibilities (C4)

| ID | Finding | Effect |
|---|---|---|
| NDI-10 | A rejection from `fetchImpl` that is not an `AbortError` is mapped by both providers to **retryable** `NETWORK`. A naive gate refusal would therefore invite attempt 2. | The governor replaces gate-refusal errors at settle (D §9.7, §7.8 table); no provider change. |
| NDI-11 | `redirect: "error"` produces a `TypeError` that maps to retryable `NETWORK`. | `"manual"` chosen instead (D §7.9). |
| NDI-12 | On Windows, a parent-side `disconnect()` can stop `close` from firing (local evidence noted in FT0 work). | No disconnect at the kill decision; only at abandonment (D §13.5, §13.8). |
| NDI-13 | The repository already contains a redirect-refusal precedent (Jira and Azure DevOps providers). | C4 aligns the governed path with it. |
| NDI-14 | `c > 0` breaks Lemma 6, and long synchronous `c` conflicts with the watchdog. | Bounds and H1 stated separately (P §5.5–§5.6). |

C3 statements corrected in C4: "the inner call is invoked in the same turn, so no
send after the deadline" (replaced by the gate, D §7.8); "≤ 1 HTTP request per
`analyze()`" without a redirect policy (D §7.9); "queue time counts as wait" without
a metric (D §8.3); "charge `B_tok` on any rejection" (D §9.4); "40 sends for
`d ∈ [21.05, 23.5] s`" (P §5.2); "no product bound after a kill" (D §13.8).

## 7. Lifecycle

C4 updates PR #262 with one design-only commit. It grants no approval, merge,
certification or closure. The new head invalidates any approval tied to `eff78a0c`.
Next permitted step: **independent HEAVY exact-head re-review of the C4 head.**
