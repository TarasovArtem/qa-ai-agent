# OD-RATE-1-C2-R3 — Review Traceability Matrix (Parent Gateway, C6 Consolidated Containment Corrective)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-review-matrix.md` (3 of 3; companions: [design](od-rate-1-c2-r3-design.md), [proofs](od-rate-1-c2-r3-proofs.md)) |
| Revision | C6 (amends the C5 matrix at `0c91393d68f9ac66f8ae5a7e9a719d76187fed03`; C5 replaced the C4 matrix at `38121f95`) |
| Status | **C7 AUTHOR DESIGN, C6 ARCHITECTURE_REJECTED, PENDING NEW INDEPENDENT EXACT-HEAD ARCHITECTURE/SECURITY REVIEW.** No row is closed, approved or verified for production by this author. **Host feasibility: BLOCKED. No host is qualified.** |
| Authority | PO: OD-RATE-1 Unified Architecture Decision Package v2, AD-01 … AD-09, APPROVED 2026-10-27; C6 decisions PD-C6-1 … PD-C6-6 and SEC-D1 … SEC-D3 (D §24.1) |
| Review input | Codex session `01a17740-3dc0-7ee2-b26e-a538092270cd` (R2, R3, R4; R4 verdict REJECTED for C4). Transcript SHA-256 at C5 authoring: `b70f2e614f380d0176a87b5ee18abb30c99709e68418116ba0eb54a38dbb3a6f` |
| Baseline | `main` `a32a6cd7e0a1bdc9917fc3abc7f692039591a145` / tree `5e15c577faf60d65887569772dd4dd3558e53c26` |

**D** = design, **P** = proofs. Verification IDs `V-xx` refer to §12. All
verification items are specifications for a future, separately authorized
implementation. **None has been written or run.**

## 1. Status vocabulary

| Status | Meaning |
|---|---|
| `DESIGNED` | Specified normatively in D; argued in P where stated |
| `ALGORITHMICALLY_PROVEN` | (C6) Proven in P from the normative algorithm (label ALG). With `HOST_NOT_VERIFIED`, proven only conditionally on host assumptions (label ALG/H) |
| `SPIKE_VERIFIED` | The mechanism was observed in the Gateway spike, in prototype scope only. The spike's independent C2 verdict is PO-SUPPLIED (D §2.8). Never a production guarantee. |
| `HOST_NOT_VERIFIED` | (C6) Depends on host assumptions `H-L…` / `H-W…` or launcher contract LC-… that no formal probe has verified. Host feasibility was BLOCKED (D §30.1). An open qualification gate (D §30.2) is named |
| `PENDING_INDEPENDENT_DESIGN_REVIEW` | Awaits the independent exact-head Architecture review (and Security review where relevant) |
| `SECURITY_GATE_OPEN` | Needs a Security decision (SG-01 … SG-05) before it can be accepted |
| `PO_DECISION_REQUIRED` | (C6) Needs a PO decision named in D §31.2 (PO-C6-1 … PO-C6-5) or §21.1 |
| `NOT_PROVEN` | Not established by design argument, spike or certified code; or explicitly not provided |
| `PENDING_PM_METADATA_SYNC` | (C6) PR metadata correction owned by the PM (C5-GOV-01) |

A row may carry several statuses. Every row carries
`PENDING_INDEPENDENT_DESIGN_REVIEW` unless it is `NOT_PROVEN` by design.

Evidence provenance (D §2.8): IND-VERIFIED, PO-SUPPLIED, AUTHOR-LOCAL, SMOKE,
ASSUMPTION. No row is IND-VERIFIED. SMOKE and ASSUMPTION never support a
`*_VERIFIED` status.

---

## 2. Approved architecture decisions

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| AD-01 | Parent exclusively owns governed transport, credentials, admission, accounting, revocation; child uses validated private IPC | D §3, §7, §8, §10, §13.1 | P Lemma 4, Lemma 5; spike P13, P14, S1–S7, G13, G14 | V-03, V-04, V-09 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-02 | Preserve SEC-C1; Property A verified, Property B not provided (C5); mandatory Security reconciliation, no waiver. (C6) Reconciliation produced `SG01-SEC-01`; containment designed | D §13.3–§13.6, §21.2, §27, §28 | P Lemmas 4, 4b, 11–15; PT-06, PT-07, PT-15 … PT-24; spike P7, P12 (B probe 53/55, C5 motivation) | SG-01 … SG-05; HQ-L-…, HQ-W-… | DESIGNED · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-03 | 900 000 ms governor waiting; 65 000 ms cold start preserved | D §9.1, §8.6 | P Lemma 2, Lemma 8, PT-01, PT-03; spike G0–G3b (budget only) | V-01 | DESIGNED · SPIKE_VERIFIED (budget mechanics; cold start not in spike) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-04 | `now >= deadlineAt` refuses; overshoot may raise the charge, never permits dispatch | D §6.2, §8.4, §9.2, §9.3 | P Lemma 3, PT-02, PT-03; spike E1–E4b, GWV01-1 … 8 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-05 | Cancelled waits charged at actual elapsed time | D §9.3 | P PT-06(a); spike G4 | V-01, V-03 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-06 | One active request; concurrent request gets private BUSY, no FIFO | D §8.5, §15.4 | P Lemma 1, PT-12; spike G8, P4 | V-02 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-07 | FT0 receipt/ACK and close-based settlement; no 300 ms grace; `K_SETTLE = 10 000 ms` post-kill (C6: post-termination settlement bound only; event-driven settlement) | D §14, §27.8 | P Lemma 9 (C6 corrected), PT-09, PT-10, PT-14, PT-15, PT-22; BASE FT0; spike P0, P11, P12 (different order) | V-06, V-12 | DESIGNED · ALGORITHMICALLY_PROVEN · PENDING_INDEPENDENT_DESIGN_REVIEW (production lifecycle order not spike-verified) |
| AD-08 | Public error vocabulary, CLI semantics, IPC and config compatibility preserved. (C6) Ungoverned differences D-1 … D-5 enumerated; candidate codes proposed only | D §4, §5, §15.4, §16, §25.4, §29 | INV-G13 (amended); §9 below | V-07, V-08, V-15, V-16 | DESIGNED · PO_DECISION_REQUIRED (PO-C6-1) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| AD-09 | One replacement design, then independent exact-head Architecture and Security reviews; no implementation or real-provider testing | this PR (three documents, one commit) | §15 below | independent reviews | PENDING_INDEPENDENT_DESIGN_REVIEW · SECURITY_GATE_OPEN |

## 2A. C6 decisions and findings

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| PD-C6-1 | Ungoverned provider-backed execution through a parent-owned pass-through Gateway; no rate governance; SEC-C1 protection kept; PD-R13 / INV-G13 narrowly amended; observable differences enumerated | D §3.2, §25, INV-G13, INV-G24 | P Lemma 4b, PT-25 | V-15, HQ-X-02; PRQ-COMPAT-1, PRQ-COMPAT-2 | DESIGNED · ALGORITHMICALLY_PROVEN (Property A in pass-through) · PENDING_INDEPENDENT_DESIGN_REVIEW · SECURITY_GATE_OPEN (D-5, Q-C6-1) |
| PD-C6-2 | Bubblewrap and the native Windows helper (Job Object + AppContainer) as **candidate** launchers with precise assumptions | D §27.3–§27.5 | H-L-01 … 11, H-W-01 … 12 (ASSUMPTION; H-W-12 SMOKE) | HQ-L-…, HQ-W-… | DESIGNED · HOST_NOT_VERIFIED · PO_DECISION_REQUIRED (PO-C6-3 adoption) |
| PD-C6-3 | Qualified-host policy; refusal before credential use or provider traffic; WSL2 ≠ native | D §26, INV-G21 | P Lemma 14, PT-20 | HQ-X-01, HQ-L-01, HQ-W-01 | DESIGNED · ALGORITHMICALLY_PROVEN (predicate ordering) · HOST_NOT_VERIFIED (LC-2) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PD-C6-4 | Two candidate reasons designed; canonical amendment **not** authorized; no new numeric codes | D §29, §27.2.3, §15.3 rows 2a, 3a | — | V-16 | DESIGNED (proposal) · PO_DECISION_REQUIRED (PO-C6-1) |
| PD-C6-5 | Kernel-backed containment and lifetime; responsibility for unresolved termination; no permanent supervisor; `K_SETTLE` settlement bound only | D §27.6, §27.7, §14.5 | P Lemma 9, PT-18, PT-21, PT-22 | HQ-L-05, HQ-W-05 | DESIGNED · HOST_NOT_VERIFIED · PO_DECISION_REQUIRED (conditional PO-C6-5) |
| PD-C6-6 | Host feasibility BLOCKED; no retries; documentation-based assumptions with proof gaps | D §30.1 | AUTHOR-LOCAL hashes; SMOKE contents | — | recorded; no host property verified |
| `SG01-SEC-01` (MAJOR) | Termination guarantee compatible with SEC-C1 | D §13.6, §27, §28 | P Lemmas 11–15; PT-15 … PT-24 | HQ-L-02 … 14, HQ-W-02 … 13; SG-01 | DESIGNED · ALGORITHMICALLY_PROVEN (ALG/H) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN |
| `C5-ARCH-01` (MINOR) | Fresh pre-sleep reading; deadline and budget at that reading; strict final checks kept | D §8.3, §9.2, INV-G06 | P Lemma 3, PT-13 | V-01 | DESIGNED · ALGORITHMICALLY_PROVEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
| `C5-ARCH-02` (MINOR) | Event-driven post-termination settlement; `CAE` and `K_SETTLE` as fallbacks; INV-G18 corrected | D §14.5, §17, INV-G18 | P Lemma 9, PT-14 | V-06 | DESIGNED · ALGORITHMICALLY_PROVEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
| `C5-EVID-01` (LOW) | Correct evidence provenance | D §2.5, §2.8; P §1, §10 | manifest reproduced (AUTHOR-LOCAL); C2 report hash reviewer-reported (PO-SUPPLIED) | — | DESIGNED (corrected) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| `C5-GOV-01` (LOW) | PR metadata mismatch | — | — | PM action | PENDING_PM_METADATA_SYNC |

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
| **R4-ARCH-03** (MAJOR) | No new provider work by a surviving child after abandonment | D §13.3–§13.6, §14.4–§14.5, (C6) §27, §28.2 | P Lemma 4, 4b, 15, PT-16, PT-24, P §6.3; spike P12 (0 Gateway sends; 53/55 direct, C5) | V-03, V-06; SG-01, SG-02; HQ-L-03, HQ-L-08, HQ-W-03, HQ-W-09 | DESIGNED · SPIKE_VERIFIED (A) · ALGORITHMICALLY_PROVEN (ALG/H, containment) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
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
| SEC-C1-1 | Parent IPC disconnection aborts pending waits | D §13.1, §13.2, §13.6 | P Lemma 4, PT-06(a); spike G4, GWV01-7 | V-03 | DESIGNED · ALGORITHMICALLY_PROVEN · SPIKE_VERIFIED · SECURITY_GATE_OPEN (SG-01) |
| SEC-C1-2 | … and in-flight provider requests (abort cannot undo transmission); both modes | D §13.2, §13.7, §25.3 | P PT-07, PT-25; spike G11, T7, P9 | V-03, V-04 (TQ-03), V-15 | DESIGNED · ALGORITHMICALLY_PROVEN · SPIKE_VERIFIED (governed transport) · SECURITY_GATE_OPEN (SG-01) |
| SEC-C1-3 | No subsequent provider calls initiated, including direct bypass (SEC-D2) | D §13.3–§13.6, §28.2, §28.3 | Authorized calls: P Lemma 4, 4b; spike P7, P12. Bypass: two barriers, PT-23, PT-24 | SG-01, SG-02, SG-03; HQ-L-08, HQ-L-11, HQ-W-09, HQ-W-11 | DESIGNED · ALGORITHMICALLY_PROVEN (A; ALG/H barriers) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN |
| SEC-C1-4 | The child must terminate (worker tree; worker-independent; confirmed) | D §13.6, §14.4, §14.5, §27 | P Lemmas 11–15; PT-15 … PT-19, PT-21, PT-22 | SG-01; V-06, V-17; HQ-L-02 … 06, HQ-W-02 … 07 | DESIGNED · ALGORITHMICALLY_PROVEN (ALG/H) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN |
| SEC-C1-5 | Disabled governor: SEC-C1 protection present (PD-R14, PD-C6-1) | D §3.2, §25 | INV-G13 (amended), INV-G24; P Lemma 4b, PT-25 | V-07, V-15 | DESIGNED · ALGORITHMICALLY_PROVEN · HOST_NOT_VERIFIED (containment) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-1 | Receipt and ACK; receipt ownership | D §14.1 | BASE `stage-process.js` L118–132, `generative-runner.js` L130–193 | V-06, V-07 | DESIGNED (unchanged) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-2 | Close-based settlement | D §14.1, §14.6 | BASE L139; P PT-10(a) | V-06 | DESIGNED (unchanged) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-3 | Exit failure semantics (result + nonzero exit not accepted) | D §14.1 | BASE `generative.js` L83; P PT-09 | V-06 | DESIGNED (unchanged) · SPIKE_VERIFIED (GWV03) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-4 | After-exit recovery (`CAE`) | D §14.1, §14.6 | BASE L143–160; P PT-10(b) | V-06, V-12 | DESIGNED (unchanged) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-5 | Native signal handling, no handler, PD-R6 | D §13.1, §15.3 row 1 | BASE | V-06 | DESIGNED (unchanged) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-6 | Exactly-once settlement | D §14.5, §18 | P Lemma 9(a); BASE `settled` guard | V-06 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-7 | Result discarded after a termination decision or an unresolved settlement (C6); accepted only with `CONTAINMENT_EMPTY` | D §14.4, §14.5, §27.2.3, INV-G12 | P Lemma 9(b), Lemma 12 | V-06, V-17 | DESIGNED · ALGORITHMICALLY_PROVEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-8 | No arbitrary successful-exit grace (AD-07) | D §6.1, §14.6, §15.4 | spike `GRACEFUL_EXIT_MS` not carried | V-06 (spy: no parent kill on the success path) | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| FT0-9 | No parent disconnect at the kill decision (Windows `close`) | D §14.4 | C4 NDI-12 | V-06, V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |

## 6. Property A and Property B

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| Property A | No new authorized Gateway dispatch after parent revocation | D §13.3, INV-G10 | P Lemma 4; spike G4, G9, G11, G12, P5, P7, P9, P12, GWV01-7 | V-03 (incl. random-interleaving property test) | SPIKE_VERIFIED · DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| Property B | (C6) No direct network access from any process of the contained worker tree; scope per D §13.4 | D §13.4, §28.2 | C5: spike P12 53/55 direct requests (no containment). C6: P PT-24 (ALG/H) | HQ-L-08, HQ-L-09, HQ-W-09; PRQ-NET-1 | DESIGNED (candidate) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN (SG-02); Windows DNS/broker channel open |
| Credential confinement | (C6) Credential not obtainable by a compromised worker through process, filesystem or network paths; **not** from environment hygiene alone | D §13.5, §28.3 | P PT-23 (ALG/H). The BLOCKED spike verified nothing (D §30.1) | HQ-L-07, HQ-L-10, HQ-L-11, HQ-W-08, HQ-W-10, HQ-W-11 (methods need separate authorization) | DESIGNED (candidate) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN (SG-03, **not closed**) |
| Credential absent from child | No credential or model in the worker env or IPC; **both modes** (C6) | D §3.3, §7.2, §28.3, INV-G14, INV-G22 | spike P13, G13, G14 | V-09 | DESIGNED · SPIKE_VERIFIED (governed prototype) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| A ⇏ B | The design never claims Property A implies Property B | D §13.4, §19 item 1 | — | review | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| CT-1 | Pre-execution containment; membership without breakaway (CR-1, CR-2) | D §27.1, §27.4.2, §27.5.2 | P Lemma 15, PT-19 | HQ-L-04, HQ-W-04, HQ-W-12 | DESIGNED · HOST_NOT_VERIFIED |
| CT-2 | Worker-independent termination (CR-3) | D §27.4.3, §27.5.3 | P Lemma 15, PT-16, PT-17 | HQ-L-03, HQ-L-13, HQ-W-03 | DESIGNED · ALGORITHMICALLY_PROVEN (ALG/H) · HOST_NOT_VERIFIED |
| CT-3 | Termination only on OS-observable emptiness; request ≠ termination; `K_SETTLE` expiry ≠ termination (CR-4, INV-G19) | D §27.2, §27.4.4, §27.5.4 | P Lemma 11, 12, PT-21 | HQ-L-04, HQ-L-14, HQ-W-07 | DESIGNED · ALGORITHMICALLY_PROVEN (state logic) · HOST_NOT_VERIFIED (correspondence to OS state) |
| CT-4 | Parent death ends the containment by kernel-backed means; no confirmation claimed (CR-5) | D §27.4.5, §27.5.5, §27.6 | P PT-18 | HQ-L-05, HQ-W-05, HQ-W-06 | DESIGNED · HOST_NOT_VERIFIED · PO_DECISION_REQUIRED if S-2 (PO-C6-5) |
| CT-5 | Unresolved termination fails closed, is never counted as terminated; responsibility defined; no supervisor (CR-6, CR-8, INV-G23) | D §27.7 | P Lemma 13, PT-17, PT-21, PT-22 | V-17; HQ-L-06, HQ-W-07 | DESIGNED · ALGORITHMICALLY_PROVEN |
| CT-6 | Handle and resource lifetime; no persistent host state (Linux); Windows principal and ACL model open (CR-7) | D §27.4.7, §27.5.7 | — | HQ-W-06, HQ-W-14 | DESIGNED · HOST_NOT_VERIFIED · PO_DECISION_REQUIRED (PO-C6-2) |
| CT-7 | Fail closed on any launcher, status or protocol fault (CR-9; T7d, T7e) | D §27.2.2 | P Lemma 13 | V-17 | DESIGNED · ALGORITHMICALLY_PROVEN |
| CT-8 | Unsupported or unqualified host refuses before credential use (CR-10, INV-G21) | D §26 | P Lemma 14, PT-20 | HQ-X-01, HQ-L-01, HQ-W-01 | DESIGNED · ALGORITHMICALLY_PROVEN (ordering) · HOST_NOT_VERIFIED (LC-2) |
| CT-9 | Child IPC under isolation (LC-9) | D §28.6 | P PT-26 | HQ-L-12, HQ-W-13 | DESIGNED · HOST_NOT_VERIFIED |
| CT-10 | Linux PID-reuse residual R-L-PID disclosed | D §27.4.3 | — | HQ-L-13; Q-C6-3 | DESIGNED (residual disclosed) · SECURITY_GATE_OPEN |

## 7. Wait, deadline and accounting safety

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| WD-1 | Cold start 65 000 ms charged once; no commit before `coldUntil` | D §9.1, §8.6 | P Lemma 8 | V-01 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-2 | Per-wait cap 65 000 ms | D §8.3 | ALG | V-01 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-3 | Accumulated governor wait ≤ 900 000 ms at every commit | D §9.1 | P Lemma 2, PT-01 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-4 | Overshoot charged; no dispatch after exhaustion | D §9.3 | P PT-03; spike G3a, G3b | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-5 | Cancelled partial waits charged | D §9.3 | P PT-06(a); spike G4 | V-01 | DESIGNED · SPIKE_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| WD-6 | Exclusive dispatch deadline (`D_DISPATCH = 1 770 000`); (C6) pre-sleep tests at a fresh reading `a` | D §8.3, §9.2, INV-G06 | P Lemma 3, PT-02, PT-13 | V-01 | DESIGNED · ALGORITHMICALLY_PROVEN · SPIKE_VERIFIED (commit-time checks only) · PENDING_INDEPENDENT_DESIGN_REVIEW |
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
| PC-8 | (C6) Ungoverned operation: INV-G13 as amended; observable differences limited to D-1 … D-5 | D §3.2, §25.4 | P PT-25 | V-07, V-15; PRQ-COMPAT-1, PRQ-COMPAT-2 | DESIGNED · SECURITY_GATE_OPEN (D-5) · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-9 | No new persistent format; no new public API or package export | D §4 | — | V-07 (package-surface inventory) | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-10 | (C6) One fixed stderr line for unconfirmed termination, both modes; replaces the C5 governed-only abandonment line | D §4, §14.5 | — | V-06; reviewer question Q8 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-11 | (C6) Provider-backed execution refused on unsupported or unqualified hosts; unrelated capabilities unaffected (PD-C6-3) | D §26.3 | P PT-20 | HQ-X-01 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PC-12 | (C6) Candidate reasons `HOST_ISOLATION_UNAVAILABLE` (proposed exit 5) and `WORKER_TERMINATION_UNCONFIRMED` (proposed exit 1); **not** part of the public contract; no new numeric codes | D §29 | — | V-16 | DESIGNED (proposal) · PO_DECISION_REQUIRED (PO-C6-1) |
| PC-13 | (C6) Private containment states and launcher records never public | D §15.4, §27.2 | — | V-08 marker tests | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |

## 10. Platform differences

| ID | Requirement | Design section | Proof / evidence | Verification needed | Status |
|---|---|---|---|---|---|
| PL-1 | Windows on `engines` Node 22.x | D §14.7 | spike ran Windows on Node 24.22.1 only | V-12 | NOT_PROVEN · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-2 | Kill semantics: POSIX SIGKILL vs Windows `TerminateProcess`; "kill not delivered" only by fault | D §14.4, §14.7 | spike P11/P12 (Windows simulated) | V-06, V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-3 | Windows `close` may not follow `exit` (FT0-C2-D1); no disconnect at kill | D §14.4, §14.7 | BASE; C4 NDI-12 | V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-4 | (C6) Worker after CLI exit: Linux parent-death signal + PID-namespace teardown; Windows helper death → `KILL_ON_JOB_CLOSE` | D §14.7, §27.6 | P PT-18 (ALG/H); parent-death cleanup NOT VERIFIED (D §30.1) | HQ-L-05, HQ-W-05 | DESIGNED · HOST_NOT_VERIFIED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-5 | Timer granularity (≈ 1 ms vs ≈ 15.6 ms) does not affect safety | D §6.2 | P Lemma 2, Lemma 3 (fresh readings) | V-01, V-12 | DESIGNED · PENDING_INDEPENDENT_DESIGN_REVIEW |
| PL-6 | HTTPS/TLS stack behavior per platform | D §10.2 | none | V-04 | NOT_PROVEN · SECURITY_GATE_OPEN (SG-04) |
| PL-7 | Same-user credential exposure paths differ per OS; (C6) candidate separation per OS | D §13.5, §14.7, §28.3 | P PT-23 (ALG/H) | SG-03; HQ-L-07, HQ-W-08 | DESIGNED (candidate) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN |
| PL-8 | (C6) Host classes: native Linux, WSL2 (its own class, never proof for native or CI), Windows; Node 22.x; QHM empty | D §26.1 | host inventory (SMOKE): Windows Node 24.22.1 only; WSL2 Node 22.23.3 | HQ-L-15, HQ-W-15 | DESIGNED · HOST_NOT_VERIFIED |

## 11. Remaining Security and PO gates

| Gate | Owner | Blocks | Status |
|---|---|---|---|
| SG-01 SEC-C1 reconciliation. (C6) `SG01-SEC-01` addressed by the containment design (D §13.6, §27, §28) | Security | Design acceptance; closure also needs the HQ gates | SECURITY_GATE_OPEN |
| SG-02 Property B. (C6) designed for the contained worker tree; scope D §13.4 | Security | Implementation authorization | SECURITY_GATE_OPEN · HOST_NOT_VERIFIED |
| SG-03 Credential confinement against a compromised worker. (C6) candidate design, **not closed**; BLOCKED spike verified nothing | Security | Implementation authorization | SECURITY_GATE_OPEN · HOST_NOT_VERIFIED |
| SG-04 Production HTTPS transport security qualification (TQ-05, TQ-06, TQ-09, TS-9); (C6) plus D-5 in pass-through mode | Security | Implementation acceptance | SECURITY_GATE_OPEN |
| SG-05 (C6) Launcher trusted-computing-base review (bwrap argv and version floor; Windows helper source, handles, AppContainer principal) | Security | Implementation acceptance | SECURITY_GATE_OPEN |
| PO-B Property B scope for Controlled v1. (C6) addressed by the SEC-D2 / PD-C6 direction; Security confirms the scope under SG-02 | PO | — | ADDRESSED BY DIRECTION (D §21.1) |
| PO-C6-1 Canonical amendment for the two candidate reasons; exit mapping and precedence | PO | Implementation | PO_DECISION_REQUIRED |
| PO-C6-2 Windows AppContainer principal lifecycle and ACL-grant model (host security setting changes) | PO | Windows qualification | PO_DECISION_REQUIRED |
| PO-C6-3 Launcher dependency adoption after qualification (bubblewrap; helper build, signing, distribution) | PO | Implementation | PO_DECISION_REQUIRED |
| PO-C6-4 Disposition of the spike's author-reported AppContainer registration (possible scope deviation) | PO / PM | Evidence acceptance | PO_DECISION_REQUIRED |
| PO-C6-5 Conditional: cgroup delegation, persistent supervisor or extra privilege if qualification shows it unavoidable (S-1 … S-3) | PO | The affected platform | CONDITIONAL |
| Independent host qualification mission (HQ-L-…, HQ-W-…, HQ-X-…) | PO authorization; independent qualifier | QHM population; implementation acceptance | NOT AUTHORIZED; QHM empty |
| PD-R1 attempts, PD-R4 caps, PD-R7 triage | PO | Not blocking design review | OPEN |
| PD-R9 real-provider verification | PO | Production qualification against real endpoints | OPEN |
| Canonical contract amendment (contract §10.7 codes, §11 schema v2) | separate canonical change | Implementation release | OPEN |
| Independent exact-head Architecture review of C6 | reviewer | everything | PENDING |
| Independent exact-head Security review of C6 | reviewer | everything | PENDING |
| C5-GOV-01 PR metadata synchronization | PM | PR accuracy | PENDING_PM_METADATA_SYNC |

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
| V-06 | Lifecycle: PT-09, PT-10, PT-14 (immediate close after kill), PT-22 (`K_SETTLE` unresolved settlement); spy that no disconnect occurs at the termination decision and no termination request on the success path | as D §14; one settlement; event-driven; result discarded after a termination decision |
| V-07 | C7 ungoverned golden: Gateway/pass-through + SEC-C1 present, rate governance absent, D-5 baseline parity | Gateway loaded; no governor RPM/TPM/wait/watchdog; externally compatible on qualified host; PRQ-D5-1…3 pass |
| V-08 | Classification: D §15.3 table; forged governor codes; `stage-timeout` without terminal; C4 T-R2-02-1 … 10 equivalents | outcomes as tabled; never exit 4 after a refusal |
| V-09 | IPC schema: S1–S7 equivalents for every production message; governed child env without `AI_API_KEY` / `AI_MODEL` | closed shapes enforced; credential absent |
| V-10 | Process hygiene: owned-process audit in every child-process test | suite fails on any surviving owned process |
| V-11 | Provider mapping golden: governed child receives the same `{code, retryable}` as the ungoverned provider for the full status matrix | identical |
| V-12 | Platform: V-01 … V-11 and V-15 … V-17 on Windows and Linux Node 22.x; containment behavior after CLI exit is V-18 (HQ-L-05, HQ-W-05) | as specified |
| V-13 | Security review of SG-01 … SG-05 | decisions recorded |
| V-14 | Real-provider verification | **not authorized** (PD-R9) |
| V-15 | (C6) Pass-through golden: for v1 and a disabled governor, every existing generative suite against a fake provider endpoint; provider-error field fidelity (PRQ-COMPAT-2); D-1 precedence (PRQ-COMPAT-1); D-5 inputs | outputs equal to the baseline except D-1 … D-5; zero rate-governance effects (INV-G24) |
| V-16 | (C6) Classification of the candidate reasons, only after PO-C6-1 authorizes them; until then, a test that neither code is emitted | per D §29 once authorized |
| V-17 | (C6) Containment state machine with a fake launcher: every transition T1 … T7f, malformed and out-of-order records, `K_SETTLE` and `CAE` races, PT-14 and PT-22 timings | `CONTAINMENT_EMPTY` only from T6; acceptance only with it; exactly one settlement; event-driven settlement |
| V-18 | (C6) Host qualification gates HQ-L-01 … 15, HQ-W-01 … 15, HQ-X-01 … 04 (D §30.2) | only in a separately authorized independent qualification mission |

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
8. (C6) Is the fixed stderr line for unconfirmed termination (D §14.5), which replaces
   the C4/C5 governed-only abandonment line and now applies in both modes, acceptable
   under AD-08?
9. The IPC request carries prompts without a new size cap (PD-R4 open). Is that
   acceptable for the private channel?
10. (C6) Q-C6-1 … Q-C6-7 (D §31.3): D-5, exit 5 vs 3, Linux PID-reuse residual,
    precedence of `WORKER_TERMINATION_UNCONFIRMED`, unbounded launcher setup in ungoverned
    mode, an ungoverned worker that delivers a result but never exits, Property B and
    credential-separation scope under SEC-D2.
11. (C6) Do the host assumptions H-L-01 … 11 and H-W-01 … 12 state the documented OS
    semantics correctly, and do they claim nothing beyond them? In particular H-L-04
    (init reaping after namespace emptiness) and H-W-05 (`ActiveProcesses` as the
    emptiness signal; completion messages not guaranteed).
12. (C6) Are the qualification acceptance criteria (D §30.2) sufficient to close SG-01
    and SG-02 for a host class?

## 14. Author acceptance gates (C6; not a review)

The author checked the three C6 documents against these gates before commit. They do
not replace independent review.

| # | Mission gate | Result |
|---|---|---|
| 1 | All five findings addressed or explicitly blocked | SG01-SEC-01, C5-ARCH-01, C5-ARCH-02, C5-EVID-01 addressed (M §2A); C5-GOV-01 `PENDING_PM_METADATA_SYNC` |
| 2 | Parent Gateway remains the architecture direction | D §3, §8–§13 unchanged in direction; extended to pass-through (D §25) |
| 3 | SEC-C1 not weakened | every clause is stronger or equal in both modes (D §13.6) |
| 4 | PD-R14 preserved for ungoverned mode | D §25.2, INV-G24, SEC-C1-5 |
| 5 | No process abandonment counted as termination | INV-G19, INV-G23; C5 abandonment withdrawn (D §14.5, §24.3) |
| 6 | No unproven OS guarantee presented as established | every host property is `H-L…` / `H-W…` ASSUMPTION or SMOKE; statuses `HOST_NOT_VERIFIED` |
| 7 | No credential isolation claimed from child environment hygiene alone | D §13.5, §28.3, P PT-23 |
| 8 | Failure states fail closed | CR-9, T7a … T7f, Lemma 13 |
| 9 | Public contract amendments not silently implemented | D §29; PC-12; reason-code table §16 unchanged |
| 10 | Host qualification gaps explicitly open | D §30; QHM empty; HQ gates listed |
| 11 | No new host experiments attempted | none run; evidence files only read and hashed |
| 12 | All three documents consistent | IDs cross-checked: PT-13 … PT-26, Lemmas 4b, 11–15, INV-G06/G12/G13/G18–G24, HQ-…, PO-C6-…, SG-05 |
| 13 | All changes inside authorized scope | exactly the three documents |
| 14 | No new PO policy invented | open items are listed as PO-C6-1 … 5 for decision, not decided |

C5 consistency checks 2–4, 7 and 11 still hold. Check 6 changed: Property B is now
`DESIGNED (candidate) · HOST_NOT_VERIFIED`, with no PASS anywhere. Check 8 now holds
together with PC-12.

## 15. Lifecycle

C6 updates PR #262 with one consolidated, documentation-only commit that touches
exactly the three documents. It grants no approval, merge, certification, host
qualification or closure. The new head invalidates any review tied to `0c91393d`.

C5-GOV-01 is `PENDING_PM_METADATA_SYNC`: the PM synchronizes the PR title and
description. This author edits no PR metadata.

Next permitted step: **PM verification and the authorized PR metadata sync, then the
independent exact-head Architecture review of the C6 head**, followed by the
independent Security review. Host qualification (D §30.2) and implementation remain
**not authorized**.


---

## 16. C7 exact-head author traceability (overrides contradicted C6 entries)

Independent C6 reviewer: Codex session 01a17dff-71ab-7b83-a099-9efe8f7fac47, ARCHITECTURE_REJECTED at HEAD 79169d3158d749461855ef7bf1b55faf8713fc49. Findings C6-ARCH-01…05 MAJOR and C6-ARCH-06 MINOR. PO authorized one consolidated documentation-only C7 and approved OD-C7-OS-1, OD-C7-FT0-1 and D-5 baseline TLS/proxy parity. All below are author dispositions only.

| Finding | Normative C7 mechanism | Verification | Lifecycle |
|---|---|---|---|
| C6-ARCH-01 MAJOR | cgroup.events populated=0 on sealed dedicated cgroup; withdraw R-L-EMPTY and H-L-04/H-L-06 | D §32.2; P Lemma C7-B; C7-T01/11 | AUTHOR_DESIGNED, HQ-L-C7-01/02 OPEN |
| C6-ARCH-02 MAJOR | cgroup.kill by opened stable cgroup object, no numeric PID | D §32.2; P Lemma C7-A; C7-T02 | AUTHOR_DESIGNED, HQ-L-C7-03 OPEN |
| C6-ARCH-03 MAJOR | native J_life at helper creation, parent-only handle, nested J_worker | D §32.3; P Lemma C7-C; C7-T03/04 | AUTHOR_DESIGNED, HQ-W-C7-01/02 OPEN |
| C6-ARCH-04 MAJOR | ready→parent state→RELEASE, trusted status EOF/close finalization | D §32.4; P Lemma C7-D; C7-T05/06 | AUTHOR_DESIGNED, HQ-X-C7-01/02 OPEN |
| C6-ARCH-05 MAJOR / C7-AUTH-01 | unexpected loss even with result→revoke/kill; provider remains revoked on result; distinct private ACK intent+permit allowed ONLY after result-only revocation, receipt match, and no failure; 10000 exit guard | D §32.4; P Lemma C7-E; C7-T07…10, C7-T09A | AUTHOR_CORRECTED_C7_C1; independent review PENDING, HQ-X-C7-03/04 OPEN |
| C6-ARCH-06 MINOR | replace no-Gateway V-07 by mandatory pass-through Gateway/no rate governor | D §32.7; V-07 above | AUTHOR_DESIGNED, V-07/V-15 OPEN |
| D-5 | parent-owned trusted transport thread with explicit CA policy / closed environment, fail-closed unqualified host | D §32.6; P Lemma C7-F; C7-T13 | AUTHOR_DESIGNED, PRQ-D5-1…3 / SG-04 OPEN |
| SG01-SEC-01 | design corrective for termination/revocation; NOT independently closed | D §32; P Lemmas C7-A…E | SECURITY_GATE_OPEN, HOST_NOT_VERIFIED |

**Author pre-commit gates:** all six corrective mechanisms identified; Linux numeric-PID kill withdrawn; false monitor-emptiness inference withdrawn; Windows Node post-spawn binding assumption withdrawn; causal startup and drain specified; stored result does not bypass SEC-C1; C7-AUTH-01 post-result-revoked private intent contradiction corrected without re-enabling provider requests; V-07 fixed; D-5 candidate is falsifiable and no widened trust is claimed; all OS/Node host assumptions remain unqualified. There has been no implementation/test/probe, public reason-code amendment, external dependency adoption, host privilege change, security waiver, merge or independent C7 approval.

**Outstanding authority:** PO-C6-1…5 remain OPEN; SG-01…05 OPEN; all old/new HQ and TQ acceptance gates OPEN. Host Feasibility Spike BLOCKED. PR metadata sync remains PM responsibility. WIP=1, next lifecycle gate independent exact-head Architecture Review; not a merge or production authorization.


### 16.3 C7-C1 author consistency correction (not independent review)

At the previous C7 head, §32.4 accidentally required `disconnect-intent` while `unrevoked`, contradicting the mandatory first-result `session.revoke("result")` in §7.5/§14.3. C7-C1 preserves that revocation, separates private delivery-control eligibility from provider authorization, and forbids permitting an intent after any additional failure. Verify two explicit cases: (1) result-only revocation + matching receipt + valid ACK intent → permit → normal disconnect; (2) result storage + later launcher fault/IPC loss before intent → no permit, result discarded, OS termination. No OS mechanism, D-5 trust policy, public contract, code or other finding is amended. **Status: AUTHOR_CORRECTED / independent C7-C1 exact-head review PENDING.**
