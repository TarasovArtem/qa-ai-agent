# OD-RATE-1-C2-R3 — Review Traceability Matrix (Parent Gateway Replacement, C5)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-review-matrix.md` (3 of 3; companions: [design](od-rate-1-c2-r3-design.md), [proofs](od-rate-1-c2-r3-proofs.md)) |
| Revision | C5 (replaces the C4 matrix at `38121f95938b28e065283707d01a70b05893e94c`) |
| Status | **PENDING INDEPENDENT EXACT-HEAD ARCHITECTURE REVIEW AND SECURITY REVIEW.** No row is closed, approved or verified for production by this author. |
| Authority | PO: OD-RATE-1 Unified Architecture Decision Package v2, AD-01 … AD-09, APPROVED 2026-10-27 |
| Review input | Codex session `01a17740-3dc0-7ee2-b26e-a538092270cd` (R2, R3, R4; R4 verdict REJECTED for C4). Transcript SHA-256 at C5 authoring: `b70f2e614f380d0176a87b5ee18abb30c99709e68418116ba0eb54a38dbb3a6f` |
| Baseline | `main` `a32a6cd7e0a1bdc9917fc3abc7f692039591a145` / tree `5e15c577faf60d65887569772dd4dd3558e53c26` |

**D** = design, **P** = proofs. Verification IDs `V-xx` refer to §12. All
verification items are specifications for a future, separately authorized
implementation. **None has been written or run.**

## 1. Status vocabulary

| Status | Meaning |
|---|---|
| `DESIGNED` | Specified normatively in D; argued in P where stated |
| `SPIKE_VERIFIED` | The mechanism was observed in the independently verified Gateway spike, in prototype scope only. Never a production guarantee. |
| `PENDING_INDEPENDENT_DESIGN_REVIEW` | Awaits the independent exact-head Architecture review (and Security review where relevant) |
| `SECURITY_GATE_OPEN` | Needs a Security decision (SG-01 … SG-04) before it can be accepted |
| `NOT_PROVEN` | Not established by design argument, spike or certified code; or explicitly not provided |

A row may carry several statuses. Every row carries
`PENDING_INDEPENDENT_DESIGN_REVIEW` unless it is `NOT_PROVEN` by design (Property B).

---

## 2. Approved architecture decisions

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| AD-01 | Parent exclusively owns governed transport, credentials, admission, accounting, revocation; child uses validated private IPC | D §3, §7, §8, §10, §13.1 | P Lemma 4, Lemma 5; spike P13, P14, S1–S7, G13, G14 | V-03, V-04, V-09 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-02 | Preserve SEC-C1; Property A verified, Property B not provided; mandatory Security reconciliation, no waiver | D §13.3–§13.6, §21.2 | P Lemma 4, PT-06, PT-07, PT-08; spike P7, P12 (B probe 53/55) | SG-01 … SG-04 | DESIGNED · SECURITY_GATE_OPEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-03 | 900 000 ms governor waiting; 65 000 ms cold start preserved | D §9.1, §8.6 | P Lemma 2, Lemma 8, PT-01, PT-03; spike G0–G3b (budget only) | V-01 | DESIGNED · SPIKE_VERIFIED (budget mechanics; cold start not in spike) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-04 | `now >= deadlineAt` refuses; overshoot may raise the charge, never permits dispatch | D §6.2, §8.4, §9.2, §9.3 | P Lemma 3, PT-02, PT-03; spike E1–E4b, GWV01-1 … 8 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-05 | Cancelled waits charged at actual elapsed time | D §9.3 | P PT-06(a); spike G4 | V-01, V-03 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-06 | One active request; concurrent request gets private BUSY, no FIFO | D §8.5, §15.4 | P Lemma 1, PT-12; spike G8, P4 | V-02 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-07 | FT0 receipt/ACK and close-based settlement; no 300 ms grace; `K_SETTLE = 10 000 ms` post-kill | D §14 | P Lemma 9, PT-08, PT-09, PT-10; BASE FT0; spike P0, P11, P12 (different order) | V-06, V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW (production lifecycle order not spike-verified) |
| AD-08 | Public error vocabulary, CLI semantics, IPC and config compatibility preserved | D §4, §5, §15.4, §16 | INV-G13; §9 below | V-07, V-08 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-09 | One replacement design, then independent exact-head Architecture and Security reviews; no implementation or real-provider testing | this PR (three documents, one commit) | §15 below | independent reviews | PENDING_INDEPENDENT_DESIGN_REVIEW · SECURITY_GATE_OPEN |

## 3. Spike verification findings

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| GWV-01 | One absolute deadline forwarded to every dispatch; exclusive at admission and commit | D §6.2, §9.2, §8.4 | P §6.6, Lemma 3; spike GWV01-1 … 8, E1–E4b (independent: FIXED_VERIFIED per PO) | V-01 (production origin `tOpen`) | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| GWV-02 | Test suites must detect surviving owned processes by observed exit status, never by PID bookkeeping | D §20 (Tests) | spike GWV02-1 … 7, strict P99 (independent: FIXED_VERIFIED per PO) | V-10 | DESIGNED (as verification requirement) · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| GWV-03 | A result is not successful until exit 0 is observed | D §14.1, §14.6 (production FT0 already requires `exitCode === 0` after `close`) | P PT-09; BASE `generative.js` L83; spike GWV03-1 … 6 (independent: FIXED_VERIFIED per PO) | V-06 | DESIGNED (baseline preserved) · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |

## 4. Independent review findings and dispositions

| Finding | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| R2-ARCH-01 (MAJOR; R4: resolved for admission, physical sends via R4-ARCH-02) | Joint RPM + TPM admission bounds actual sends | D §8.6, §10.1 | P Lemma 5, Lemma 6, Corollary 6.1; spike T1–T10 | V-01, V-04 | DESIGNED · SPIKE_VERIFIED (loopback) · NOT_PROVEN for production HTTPS · PENDING_INDEPENDENT_DESIGN_REVIEW |
| R2-ARCH-02 (MAJOR; R4: RESOLVED_BY_DESIGN) | Governor refusal survives the unwind path; unrelated errors not relabelled | D §15.1–§15.3 | C4 E1/E2/E3 retained; P Lemma 10 (parent-authoritative code) | V-08 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW (terminal source moved to the parent) |
| R2-ARCH-03 (MAJOR; R4: RESOLVED_BY_DESIGN) | Dispatch-time deadline is enforceable | D §8.4, §9.2, §17 | P Lemma 3; spike G10, E2 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| R2-ARCH-04 (MAJOR; R4: **REGRESSED**) | No admission once the wait budget is exceeded, incl. overshoot | D §9.1, §9.3 | P Lemma 2, PT-01, PT-03, P §6.1; spike G1, G3b | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| R2-ARCH-05 (MINOR; R4: RESOLVED_BY_DESIGN) | Groq 408 retryable, Gemini 408 not; 429/5xx retryable; zero governor retries | D §12 | existing mapping functions reused (BASE) | V-11 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| DRIFT-01 (R4: cancellation resolved; abandonment guarantee refuted) | SEC-C1 cancellation with the same certified signal | D §13, §14.1 | P Lemma 4, PT-06, PT-07, P §6.3 | V-03, V-06 | DESIGNED · SECURITY_GATE_OPEN (SG-01) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| DRIFT-02 (R4: RESOLVED_BY_DESIGN) | Receipt/ACK, store-before-ACK, close settlement unchanged | D §14.1 | BASE; P PT-10 | V-06, V-07 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| R3-ARCH-01 (MAJOR; R4: RESOLVED_BY_DESIGN) | Valid usage charged on content failure; malformed → `RATE_ACCOUNTING_INVALID` | D §11 | P Lemma 7, PT-11 (ALG only) | V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW (no spike coverage) |
| R3-ARCH-02 (MAJOR; R4: RESOLVED_BY_DESIGN) | Fresh clock reading at the dispatch boundary | D §8.4 | P Lemma 3, P §6.5; spike G10 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| R3-ARCH-03 (MAJOR; R4: **STILL_OPEN**, T1 refuted) | One admission yields at most one HTTP request | D §10 | P Lemma 5, PT-04, PT-05; spike T2, T3, B1 | V-04 (TQ-01 … TQ-03) | DESIGNED · SPIKE_VERIFIED (loopback `http`) · NOT_PROVEN for production HTTPS · PENDING_INDEPENDENT_DESIGN_REVIEW |
| R3-ARCH-04 (MINOR; R4: **STILL_OPEN**) | Waiting is accounted; serialization holds | D §8.5, §9.1 (no queue exists) | P Lemma 1, Lemma 2, P §6.4 | V-01, V-02 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| R3-ARCH-05 (MINOR; R4: RESOLVED_BY_DESIGN, conditional) | Correct quantitative statements | P §7 | Corollary 6.1 re-derived; C4 counts labelled HIST with premises | — | DESIGNED (27·n_max) · NOT_PROVEN for C4 counts under C5 · PENDING_INDEPENDENT_DESIGN_REVIEW |
| **R4-ARCH-01** (MAJOR) | `W ≤ 900 000` at every admission | D §9.1 | P Lemma 2, P §6.1; spike G1, G2, G3b, G5 | V-01 (property test: random computation and overshoot) | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| **R4-ARCH-02** (MAJOR) | No hidden transport resend (incl. 421) | D §10.1, §10.2 | P Lemma 5, PT-04, P §6.2; spike T3 vs. B1 | V-04 (TQ-01 … TQ-10) | DESIGNED · SPIKE_VERIFIED (loopback) · NOT_PROVEN for HTTPS · PENDING_INDEPENDENT_DESIGN_REVIEW |
| **R4-ARCH-03** (MAJOR) | No new provider work by a surviving child after abandonment | D §13.3–§13.6, §14.4–§14.5 | P Lemma 4, PT-08, P §6.3; spike P12 (0 Gateway sends; 53/55 direct) | V-03, V-06; SG-01, SG-02 | DESIGNED (authorized dispatch, Property A) · SPIKE_VERIFIED (A) · SECURITY_GATE_OPEN (unauthenticated network, Property B) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| **R4-ARCH-04** (MINOR) | Serialization not contradicted by queue release | D §8.5 | P Lemma 1, PT-12, P §6.4; spike G8, P4 | V-02 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |

R4 PO notes and their disposition:

| R4 note | C5 disposition |
|---|---|
| Widening the wait budget to include synchronous computation needs PO confirmation | Not needed: C5 keeps the sum-of-governor-sleeps meaning plus the PD-R5 cold-start charge (D §9.1). |
| Weakening the surviving-child guarantee needs a PO disposition | Not weakened relative to certified FT0 (D §13.6). Whether SEC-C1 requires Property B is SG-01; PO-B (D §21.1). |
| `K_SETTLE = 10 000 ms` accepted as PO-approved | Recorded APPROVED (D §6.1, §14.5). |

## 5. SEC-C1 and FT0 regression gates

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| SEC-C1-1 | Parent IPC disconnection aborts pending waits | D §13.1, §13.2, §13.6 | P Lemma 4, PT-06(a); spike G4, GWV01-7 | V-03 | DESIGNED · SPIKE_VERIFIED · SECURITY_GATE_OPEN (SG-01) |
| SEC-C1-2 | … and in-flight provider requests (abort cannot undo transmission) | D §13.2, §13.7 | P PT-07; spike G11, T7, P9 | V-03, V-04 (TQ-03) | DESIGNED · SPIKE_VERIFIED · SECURITY_GATE_OPEN (SG-01) |
| SEC-C1-3 | No subsequent provider calls initiated | D §13.3–§13.6 | Authorized calls: P Lemma 4; spike P7, P12. Unauthenticated network: not prevented | SG-01, SG-02 | DESIGNED (Property A) · SECURITY_GATE_OPEN · NOT_PROVEN (Property B) |
| SEC-C1-4 | The child must terminate | D §13.6, §14.4, §14.5 | Certified child self-exit (BASE); parent kill + `K_SETTLE` abandonment bounds the parent phase only | SG-01; V-06 | DESIGNED (cooperative child, unchanged) · SECURITY_GATE_OPEN · NOT_PROVEN (non-cooperative child) |
| SEC-C1-5 | Disabled governor: SEC-C1 exactly as certified (PD-R14) | D §3.2 | INV-G13; BASE | V-07 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-1 | Receipt and ACK; receipt ownership | D §14.1 | BASE `stage-process.js` L118–132, `generative-runner.js` L130–193 | V-06, V-07 | DESIGNED (unchanged) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-2 | Close-based settlement | D §14.1, §14.6 | BASE L139; P PT-10(a) | V-06 | DESIGNED (unchanged) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-3 | Exit failure semantics (result + nonzero exit not accepted) | D §14.1 | BASE `generative.js` L83; P PT-09 | V-06 | DESIGNED (unchanged) · SPIKE_VERIFIED (GWV03) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-4 | After-exit recovery (`CAE`) | D §14.1, §14.6 | BASE L143–160; P PT-10(b) | V-06, V-12 | DESIGNED (unchanged) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-5 | Native signal handling, no handler, PD-R6 | D §13.1, §15.3 row 1 | BASE | V-06 | DESIGNED (unchanged) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-6 | Exactly-once settlement | D §14.5, §18 | P Lemma 9(a); BASE `settled` guard | V-06 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-7 | Result discarded after kill or abandonment | D §14.4, §14.5, INV-G12 | P Lemma 9(b) | V-06 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-8 | No arbitrary successful-exit grace (AD-07) | D §6.1, §14.6, §15.4 | spike `GRACEFUL_EXIT_MS` not carried | V-06 (spy: no parent kill on the success path) | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-9 | No parent disconnect at the kill decision (Windows `close`) | D §14.4 | C4 NDI-12 | V-06, V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |

## 6. Property A and Property B

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| Property A | No new authorized Gateway dispatch after parent revocation | D §13.3, INV-G10 | P Lemma 4; spike G4, G9, G11, G12, P5, P7, P9, P12, GWV01-7 | V-03 (incl. random-interleaving property test) | SPIKE_VERIFIED · DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| Property B | No arbitrary direct network access by a surviving or compromised child | D §13.4, §13.5 | spike P12: 53 (Windows) / 55 (Linux) unauthenticated direct requests | OS-isolation requirement (not designed) | **NOT_PROVEN (NOT PROVIDED)** · SECURITY_GATE_OPEN (SG-02, PO-B) |
| Credential confinement | Credential not obtainable by a compromised same-user child | D §13.5 | analysis only (`/proc/<ppid>/environ`, process memory) | SG-03 decision | NOT_PROVEN · SECURITY_GATE_OPEN (SG-03) |
| Credential absent from child | No credential or model in governed child env or IPC | D §3.3, §7.2, INV-G14 | spike P13, G13, G14 | V-09 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| A ⇏ B | The design never claims Property A implies Property B | D §13.4, §19 item 1 | — | review | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |

## 7. Wait, deadline and accounting safety

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| WD-1 | Cold start 65 000 ms charged once; no commit before `coldUntil` | D §9.1, §8.6 | P Lemma 8 | V-01 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-2 | Per-wait cap 65 000 ms | D §8.3 | ALG | V-01 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-3 | Accumulated governor wait ≤ 900 000 ms at every commit | D §9.1 | P Lemma 2, PT-01 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-4 | Overshoot charged; no dispatch after exhaustion | D §9.3 | P PT-03; spike G3a, G3b | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-5 | Cancelled partial waits charged | D §9.3 | P PT-06(a); spike G4 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-6 | Exclusive dispatch deadline (`D_DISPATCH = 1 770 000`) | D §9.2 | P Lemma 3, PT-02 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-7 | Stage deadline 1 800 000, request timeout 30 000, watchdog 45 000, heartbeat 10 000 preserved | D §6.1, §14.2, §17 | constants | V-06 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-8 | Monotonic, single-origin, exact clock | D §6.2 | ALG | V-01 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-1 | PD-R10 heuristic reservation; `Res > B_tok` refused | D §11.2 | ALG | V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-2 | Reservation vs. observed: `max(Res, U)` for valid usage | D §11.4 | P Lemma 7, PT-11 | V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-3 | Valid usage with invalid or absent content | D §11.1, §11.4 | P PT-11 row 1 | V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-4 | Missing usage → `B_tok` | D §11.4 | P PT-11 | V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-5 | Malformed usage → `B_tok` + sticky `RATE_ACCOUNTING_INVALID` | D §11.4 | P PT-11 | V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-6 | Uncertain provider completion → `B_tok` | D §11.1, §11.4, §13.7 | P PT-07 | V-05, V-03 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-7 | Rate-window expiry at `tSettle + 65 000`; saturation scoped to the session | D §8.6, §11.5 | P Lemma 6 | V-01, V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-8 | No double charge; no hidden refund | D §11.5 | P Lemma 7 | V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AC-9 | Separate accounting for each explicitly permitted send | D §11.5 | P Lemma 5, Lemma 7(a) | V-05 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |

## 8. Provider-specific semantics

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| PS-1 | Groq 408 `TIMEOUT` retryable; Gemini 408 `UNKNOWN` not retryable | D §12 | BASE mapping reused | V-11 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PS-2 | 429 `RATE_LIMIT` retryable; cooldown; `Retry-After > 65 s` → exhausted | D §12, §8.6 | BASE + C4 §7.6 | V-11, V-01 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PS-3 | 5xx `UNKNOWN` retryable; 401/403 `AUTH`; other 4xx incl. 421 `UNKNOWN` not retryable | D §12 | BASE | V-11 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PS-4 | 3xx never followed; `UNKNOWN` not retryable | D §10.1 TS-2, §12 | P PT-05; spike T2 | V-04, V-11 | DESIGNED · SPIKE_VERIFIED (loopback) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PS-5 | Network error `NETWORK` and `T_REQ` timeout `TIMEOUT`, both retryable | D §12, TS-5 | BASE; spike T5, T6 | V-04, V-11 | DESIGNED · SPIKE_VERIFIED (loopback) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PS-6 | Two-attempt policy unchanged (PD-R1); zero Gateway/transport retries | D §12 | P Lemma 5 | V-11, V-07 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PS-7 | Request bytes identical to the ungoverned provider's | D §10.2 TQ-10 | — | V-04 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |

## 9. Public contract preservation

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| PC-1 | Config schema v1 unchanged | D §5 | — | V-07 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-2 | Opt-in `providerGovernor` v2 (PD-R2) | D §5 | — | V-07 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-3 | Existing CLI exit codes only (3, 6, 1, 4) | D §4, §15.3, §16 | — | V-08 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-4 | Closed external taxonomy; no code beyond the C4 PD-R8 set | D §16 | — | V-08 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-5 | Spike/private names (`BUSY`, `REVOKED`, `INVALID_REQUEST`, `child_failed`, `resultRejection`, reasons, `maybeReachedRemote`) never public | D §15.4 | — | V-08 (marker tests on envelope and stderr) | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-6 | FT0 IPC `result` / `result-ack` semantics unchanged | D §7.1, §14.1 | BASE | V-06, V-07 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-7 | Provider selection unchanged; provider-configuration failure keeps its outcome | D §5, §15.3 row 2 | BASE `classifyChildFailure` | V-08 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-8 | Ungoverned operation byte-identical (INV-G13) | D §3.2 | — | V-07 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-9 | No new persistent format; no new public API or package export | D §4 | — | V-07 (package-surface inventory) | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-10 | Governed-only stderr abandonment line (as C4 under PD-R15) | D §4, §14.5 | — | V-06; reviewer question Q8 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |

## 10. Platform differences

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| PL-1 | Windows on `engines` Node 22.x | D §14.7 | spike ran Windows on Node 24.22.1 only | V-12 | NOT_PROVEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-2 | Kill semantics: POSIX SIGKILL vs Windows `TerminateProcess`; "kill not delivered" only by fault | D §14.4, §14.7 | spike P11/P12 (Windows simulated) | V-06, V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-3 | Windows `close` may not follow `exit` (FT0-C2-D1); no disconnect at kill | D §14.4, §14.7 | BASE; C4 NDI-12 | V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-4 | Abandoned child after CLI exit: POSIX reparenting; Windows job-object closure | D §14.7 | not verified | V-12 | NOT_PROVEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-5 | Timer granularity (≈ 1 ms vs ≈ 15.6 ms) does not affect safety | D §6.2 | P Lemma 2, Lemma 3 (fresh readings) | V-01, V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-6 | HTTPS/TLS stack behavior per platform | D §10.2 | none | V-04 | NOT_PROVEN · SECURITY_GATE_OPEN (SG-04) |
| PL-7 | Same-user credential exposure paths differ per OS | D §13.5, §14.7 | analysis only | SG-03 | NOT_PROVEN · SECURITY_GATE_OPEN |

## 11. Remaining Security and PO gates

| Gate | Owner | Blocks | Status |
|---|---|---|---|
| SG-01 SEC-C1 reconciliation (Property A + credential-free child + certified self-termination vs. a reading that requires B or stronger termination) | Security | Design acceptance; if B is required, C5 is BLOCKED | SECURITY_GATE_OPEN |
| SG-02 Property B NOT PROVIDED; scope | Security + PO (PO-B) | Implementation authorization | SECURITY_GATE_OPEN |
| SG-03 Credential confinement against a compromised same-user child | Security | Implementation authorization | SECURITY_GATE_OPEN |
| SG-04 Production HTTPS transport security qualification (TQ-05, TQ-06, TQ-09, TS-9) | Security | Implementation acceptance | SECURITY_GATE_OPEN |
| PO-B Property B scope for Controlled v1 | PO | Implementation authorization | OPEN |
| PD-R1 attempts, PD-R4 caps, PD-R7 triage | PO | Not blocking design review | OPEN |
| PD-R9 real-provider verification | PO | Production qualification against real endpoints | OPEN |
| Canonical contract amendment (contract §10.7 codes, §11 schema v2) | separate canonical change | Implementation release | OPEN |
| Independent exact-head Architecture review of C5 | reviewer | everything | PENDING |
| Independent exact-head Security review of C5 | reviewer | everything | PENDING |

## 12. Verification specifications (future; none implemented)

Harness: injectable monotonic clock and timers in the Gateway and supervisor; a fake
transport that records calls; a local TLS test server with server-side request
counters; real child processes for IPC; Windows and Linux runners on Node 22.x; an
owned-process registry keyed on observed exit status (GWV-02). No real provider.

| ID | Scope | Expected |
|---|---|---|
| V-01 | Admission and wait: PT-01, PT-02, PT-03; per-wait cap; iteration cap; cold start (Lemma 8); property test with random computation delays, sleep overshoots and arrival times | never a commit with `W > W_BUDGET`, `t2 >= dispatchDeadline` or before `coldUntil`; `W` equals the cold charge plus measured post-cold sleeps |
| V-02 | BUSY: PT-12; instrumented runs of every stage | BUSY refusals change nothing; certified generators never trigger BUSY |
| V-03 | Revocation: PT-06, PT-07; random interleavings of `revoke()` with the request pipeline | zero `send()` after `revoke()` returns; in-flight requests destroyed; partial waits charged |
| V-04 | Transport TQ-01 … TQ-10 (local TLS server; Windows and Linux; Node 22.x) | one request per `send()` for every status incl. 421 and 3xx; no proxy or reuse path; credential never leaked |
| V-05 | Accounting: PT-11 for Groq and Gemini; uncertain completion; expiry; marker strings in usage, headers and content | charges per D §11.4; nothing unclamped lost; no raw values in IPC, stderr or envelope |
| V-06 | Lifecycle: PT-08 (kill-not-delivered fault), PT-09, PT-10; `K_SETTLE` abandonment; spy that no disconnect occurs at the kill decision and no kill on the success path | as D §14; one settlement; result discarded after kill |
| V-07 | Ungoverned golden: all existing generative and FT0 suites; package-surface inventory | byte-identical behavior; no Gateway module loaded |
| V-08 | Classification: D §15.3 table; forged governor codes; `stage-timeout` without terminal; C4 T-R2-02-1 … 10 equivalents | outcomes as tabled; never exit 4 after a refusal |
| V-09 | IPC schema: S1–S7 equivalents for every production message; governed child env without `AI_API_KEY` / `AI_MODEL` | closed shapes enforced; credential absent |
| V-10 | Process hygiene: owned-process audit in every child-process test | suite fails on any surviving owned process |
| V-11 | Provider mapping golden: governed child receives the same `{code, retryable}` as the ungoverned provider for the full status matrix | identical |
| V-12 | Platform: V-01 … V-11 on Windows Node 22.x; job-object termination of an abandoned child after CLI exit | as specified |
| V-13 | Security review of SG-01 … SG-04 | decisions recorded |
| V-14 | Real-provider verification | **not authorized** (PD-R9) |

## 13. Questions for the independent reviewers

1. Does the commit section (D §8.4, P Lemma 3) close R3-ARCH-02 and R4-ARCH-01 with an
   acceptable disclosed granularity (two comparisons and a call)?
2. Is "sum of governor sleeps plus a fixed 65 000 ms cold-start charge" (D §9.1) the
   correct reading of AD-03 and PD-R5, including the choice to charge the cold start in
   full even when the first request arrives late?
3. Is the TS contract (D §10.1) plus TQ-01 … TQ-10 sufficient to close R4-ARCH-02 for
   production, given that the spike evidence is loopback `http` only?
4. Security: is SEC-C1 satisfied by Property A, the credential-free child and certified
   child self-termination (D §13.6), or does it require Property B (SG-01)?
5. Security: is the same-user credential exposure (SG-03) an acceptable residual for
   Controlled v1?
6. Is the parent-authoritative terminal (D §15.2), including fail-closed `STAGE_FAILED`
   instead of a synthesized attempt count, an acceptable refinement of the R4-accepted
   C4 classification?
7. Should a `BUSY` refusal (unreachable with certified generators) remain a per-request
   refusal, or fail the stage closed?
8. Is the governed-only stderr abandonment line (D §14.5), carried from C4 under PD-R15,
   acceptable under AD-08?
9. The IPC request carries prompts without a new size cap (PD-R4 open). Is that
   acceptable for the private channel?

## 14. Author consistency checks (not a review)

Performed by the author on the three C5 documents before commit. They do not replace
independent review.

| # | Gate | Result |
|---|---|---|
| 1 | All three documents describe the same Parent Gateway architecture | consistent section references D §3–§17 ↔ P §3–§6 ↔ M §2–§10 |
| 2 | No child-owned governed transport is normative | child-owned gate appears only in D §22 and P §6/§7.2 as history |
| 3 | No FIFO is normative | FIFO appears only as removed (D §8.5, §22; P §6.4) |
| 4 | No inclusive deadline predicate is normative | all deadline tests use `>=` refusal |
| 5 | `K_SETTLE` is recorded as approved | D §6.1, §14.5; M §4 |
| 6 | No Property B PASS | Property B `NOT_PROVEN (NOT PROVIDED)` everywhere |
| 7 | No 300 ms successful-exit policy | listed only as not carried (D §15.4, M FT0-8) |
| 8 | No unapproved public contract extension | reason codes = C4 PD-R8 set; private names mapped (D §15.4) |
| 9 | Wait and retry semantics consistent | D §9, §12 ↔ P §3, Lemma 2, PT-04 |
| 10 | References point to existing sections | checked |
| 11 | Historical C4 material separated | D §22, P §7.2 |
| 12 | Every open security or policy gap disclosed | D §21, M §11 |

## 15. Lifecycle

C5 updates PR #262 with one design-only commit touching exactly the three documents.
It grants no approval, merge, certification or closure. The new head invalidates any
review tied to `38121f95`. Next permitted step: **independent exact-head Architecture
review of the C5 head**, followed by the independent Security review.
