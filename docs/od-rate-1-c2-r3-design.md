# OD-RATE-1-C2-R3 — Provider Gateway Design (Parent Gateway, C6 Consolidated Containment Corrective)

| Field | Value |
|---|---|
| Document | `docs/od-rate-1-c2-r3-design.md` (1 of 3; companions: [proofs](od-rate-1-c2-r3-proofs.md), [review matrix](od-rate-1-c2-r3-review-matrix.md)) |
| Revision | **C6: consolidated containment corrective of the C5 Parent Gateway design** (C5 = PR #262 head `0c91393d68f9ac66f8ae5a7e9a719d76187fed03`, tree `203006c000a0e1d97aff86f3fa9965466e50d955`). C6 addresses `SG01-SEC-01`, `C5-ARCH-01`, `C5-ARCH-02` and `C5-EVID-01` (§24). C5 replaced the child-owned C4 governor (`38121f95`), which the independent R4 review REJECTED (§2.6). Superseded C4 material: §22. Change log: §23. **C6 containment sections: §24–§31.** |
| Status | **DESIGN — PENDING INDEPENDENT EXACT-HEAD ARCHITECTURE REVIEW AND SECURITY REVIEW.** Not approved. It authorizes no implementation, test, contract amendment, ROADMAP entry, real-provider call, host experiment, dependency, merge or release. **Host feasibility: BLOCKED (§30.1). No host is qualified.** |
| Authority | Product Owner: **OD-RATE-1 Unified Architecture Decision Package v2, AD-01 … AD-09, APPROVED 2026-10-27** (§2.2); **C6 decisions PD-C6-1 … PD-C6-6** and SEC-D1 … SEC-D3 (§24.1) |
| Issue | #258 (OPEN; not modified; its body predates the later PO decisions, §2.3) |
| Baseline | `main` HEAD `a32a6cd7e0a1bdc9917fc3abc7f692039591a145`, TREE `5e15c577faf60d65887569772dd4dd3558e53c26` |
| Author | Claude Code, the same account that authored OD-RATE-1, C1 … C4 and the Gateway spike. **This author cannot approve this design.** |

Normative keywords: **MUST**, **MUST NOT**, **SHOULD**, **MAY** as in RFC 2119.
Durations are milliseconds on a monotonic clock (§6.2). "Contract" means
`docs/controlled-v1-productization-contract-v1.md`. **D** = this document,
**P** = proofs, **M** = review matrix.

---

## 1. Purpose, scope and decision record

This document specifies one production target: an opt-in, **parent-owned
Provider Gateway** for the provider-backed generative stages (`design`, `plan`,
`generate`) of the `qa-agent` CLI. When the governor is enabled, the parent
process alone owns the provider credentials, the provider transport, admission,
rate accounting, the wait budget, the dispatch deadline and revocation. The stage
child keeps the generative work and asks the parent for each provider exchange
over a validated private IPC protocol.

Decision record:

- The child-owned governor of C3/C4 (a governed `fetchImpl` gate inside the
  child, FIFO queue, union wait accounting) is **withdrawn**. It is kept only as
  history (§22).
- The PO approved the Parent Gateway direction (AD-01 … AD-09, §2.2). This
  document turns it into one implementable design. It does **not** copy the
  spike into production. The spike is feasibility evidence (§2.5); every spike
  behavior used here is restated as a production requirement, and the spike-only
  behaviors that production must not have are listed in §15.4 and §22.
- **C6.** The Security review finding `SG01-SEC-01` (MAJOR) found that C5's
  termination guarantee, which relied on child cooperation and K_SETTLE abandonment,
  is incompatible with SEC-C1. C6 adds **worker containment**: every provider-backed
  stage child runs inside an OS containment created by a per-stage launcher, before
  the child runs. The parent can terminate the containment without the child's
  cooperation and confirm that it is empty. The containment also gives the child no
  network and no credential (§27, §28). Ungoverned provider-backed execution now
  also uses the parent-owned Gateway, in pass-through mode (PD-C6-1, §25). Hosts that
  are unsupported or unqualified refuse provider-backed execution (PD-C6-3, §26).
  **The containment mechanisms are candidate designs. No host has been qualified
  (§30).**

Reading guide: §3–§23 are the C5 Gateway design with C6 amendments marked
"(C6)". §24–§31 are the C6 containment design. Where a C5 statement in §3–§21
conflicts with §24–§31, §24–§31 govern. Every such conflict is listed in §24.3.

In scope: architecture, private IPC, admission, wait and deadline semantics,
transport contract and HTTPS qualification, accounting, revocation, Property A/B
and SEC-C1 analysis, worker containment and termination, direct-provider-bypass
prevention, credential boundary, host qualification policy, FT0 lifecycle
compatibility, failure propagation, public compatibility.

Out of scope (unchanged and not designed here): triage (`stage-runner.js`, PD-R7);
the attempt budget (PD-R1); provider request payload caps (PD-R4); real-provider
validation (PD-R9); persistent or cross-process rate state (rejected in C1);
non-generative child processes (`collect`, `history`, `aggregate`, `analyze`);
release, ROADMAP, governance, package exports, `README.md`, `SECURITY.md`,
`PROVIDERS` docs; installation, packaging or signing of any launcher.

## 2. Authority, evidence and baseline

### 2.1 Evidence classes

Every claim in D, P and M carries one of these classes. They are never merged.

| Class | Meaning | Example |
|---|---|---|
| **PO-CONV** | Approved by the Product Owner in conversation; not (yet) published on GitHub | AD-01 … AD-09; PD-R11 A, PD-R12 A, PD-R12-I1, PD-R15 |
| **PO-GH** | Disposition published on GitHub (Issue #258 body, 2026-10-19) | PD-R2, PD-R3, PD-R5, PD-R6, PD-R8, PD-R10, PD-R13, PD-R14, SEC-C1 |
| **HIST-C4** | Rejected child-owned C4 design and its numbers | §22; P §7.2 |
| **SPIKE** | Behavior of the isolated Gateway spike. The independent C2 verdict reached the author as PO-supplied evidence (§2.5, §2.8) | P §8 |
| **OPEN** | Production behavior not yet verified by anyone | HTTPS transport (§10.2), integrated lifecycle (§14), Windows on Node 22.x, every containment property (§30) |

Orthogonal to these classes, C6 records each evidence item's **provenance**, which
says who verified it. Provenance is defined in §2.8 (C5-EVID-01) and is never
upgraded.

Issue #258 still lists PD-R11 and PD-R12 as open. Its body predates the later PO
decisions and is unsynchronized. It is **not** evidence that those decisions are
absent. The R4 reviewer noted the same (§2.6).

### 2.2 Approved architecture decisions (PO-CONV, 2026-10-27)

| ID | Decision | Where C5 implements it |
|---|---|---|
| AD-01 | Parent exclusively owns governed provider transport, credentials, admission, accounting and revocation. Child uses validated private IPC. | §3, §7, §8, §10, §13.1 |
| AD-02 | Preserve SEC-C1. Property A is verified; Property B is not provided. Mandatory Security reconciliation, no waiver. | §13; gates SG-01 … SG-04 (§21.2). **C6:** the reconciliation produced `SG01-SEC-01`; C6 adds a candidate containment design for Property B and for worker termination (§27, §28), still under the Security gates |
| AD-03 | 900 000 ms cumulative governor waiting; preserve the approved 65 000 ms cold start. | §9.1, §8.6 |
| AD-04 | `now >= deadlineAt` means REFUSE. Timer overshoot may increase charged waiting but must never permit further dispatch. | §9.2, §9.3, §8.4 |
| AD-05 | Count actual waiting elapsed before cancellation. | §9.3 |
| AD-06 | One active Gateway request; a concurrent request receives a private BUSY refusal, not FIFO queueing. | §8.5 |
| AD-07 | Preserve FT0 receipt/ACK and close-based settlement. No arbitrary 300 ms successful-exit grace. `K_SETTLE = 10 000 ms` for the governed post-kill phase. | §14 |
| AD-08 | Preserve public error vocabulary, CLI semantics, IPC compatibility and configuration compatibility. | §4, §5, §15.4, §16 |
| AD-09 | One replacement design, then independent exact-head Architecture and Security reviews. No implementation or real-provider testing authorization. | this PR; M §15 |

### 2.3 Earlier PO dispositions used

| Decision | Class | Status | Use in C5 |
|---|---|---|---|
| PD-R2 | PO-GH | APPROVED DIRECTION | Config schema v2 with opt-in `providerGovernor`; v1 unchanged (§5). |
| PD-R3 | PO-GH | APPROVED FOR DESIGN REVIEW | 30 s request timeout, 65 s per wait, 900 s accumulated wait, 1 800 s stage deadline, 45 s watchdog, 10 s heartbeat (§6.1). |
| PD-R5 | PO-GH | APPROVED | 65 s cold start per governed stage; counts toward wait and stage budgets (§9.1). |
| PD-R6 | PO-GH | APPROVED | No exit 130; native user-signal termination; user cancellation never exit 6. |
| PD-R8 | PO-GH | APPROVED DIRECTION | Closed reason-code extension (§16). |
| PD-R10 | PO-GH | APPROVED | Heuristic, best-effort token admission; exceeding local budgets fails closed (§11.2). |
| PD-R13 | PO-GH | APPROVED; **interpretation narrowly amended by PD-C6-1** | Deadline and watchdog only when governed. C6 reading (§25.2): PD-R13 covers the rate-governance features (admission, ledgers, wait budget, dispatch deadline, heartbeat, watchdog, enforcement). It does not exclude the parent-owned transport, credential custody, revocation or containment. Those are SEC-C1 protections and apply in both modes. |
| SEC-C1 | PO-GH | APPROVED; FT0 implementation certified on `main` | "Parent IPC disconnection must abort pending waits and in-flight provider requests. No subsequent provider calls may be initiated. The child must terminate." (§13.6) |
| PD-R14 | PO-GH | APPROVED | SEC-C1 unconditional, also when the governor is disabled. |
| PD-R11 | PO-CONV | APPROVED: A | `charged = max(reserved, observed)` for valid usage; valid usage survives content failure (§11.4). |
| PD-R12 | PO-CONV | APPROVED: A | Missing usage saturates (§11.4). |
| PD-R12-I1 | PO-CONV | APPROVED | Malformed usage saturates **and** sets `RATE_ACCOUNTING_INVALID`; unavailable usage or uncertain completion saturates; never zero (§11.4). |
| D+15 | PO-CONV | APPROVED: A | Separate measurable lifecycle phases; no whole-CLI 1 815 s claim (§17). |
| PD-R15 | PO-CONV | APPROVED, value `K_SETTLE = 10 000 ms` (reaffirmed by AD-07) | Bounded post-kill settlement (§14.5). |
| PD-R1, PD-R4, PD-R7, PD-R9 | PO-GH | OPEN | Status-quo assumptions (§21.1). |

### 2.4 Certified code baseline (`main` `a32a6cd7`)

| File | Blob | Facts used |
|---|---|---|
| `scripts/ai/cli/stage-process.js` | `4c9a8ab4` | Generic child launcher (`spawn(process.execPath, [runner, stage])`, `shell:false`, `stdio: [ignore, pipe, pipe, ipc]`). The first `result` message is stored, then ACKed with the child's receipt `^[0-9a-f]{32}$` (L118–132); all other message types are ignored. `close` settles (L139). After `exit`, a ref'd `CLOSE_AFTER_EXIT_MS = 10000` timer settles with `result = null` if `close` never arrives (L143–160). Late events after settlement are ignored (`settled` guard). No timeout, watchdog or kill. |
| `scripts/ai/cli/generative-runner.js` | `5adac686` | `guardParentLink()` (L130): parent `disconnect` → abort → `process.exit(1)` in the same turn. `report()` moves `running → sending → awaiting_ack → delivered \| failed`; `RESULT_ACK_DEADLINE_MS = 10000`. `bindCancelSignal(parentLink.signal)` before any provider exists (L238). The child creates its provider with `createProvider(PROVIDER)` (L215); a constructor error is reported as `provider-configuration`. |
| `scripts/ai/cli/child-env.js` | — | `buildGenerativeEnv()` (L116) copies `AI_SECRET_KEYS = ["AI_API_KEY", "AI_MODEL"]` (L37) into the child's closed environment. **Today the generative child holds the credential.** |
| `scripts/ai/cli/generative.js` | `418b5597` | The parent reads `AI_API_KEY` for redaction (L71). It accepts only `result.ok === true && exitCode === 0` (L83). `classifyChildFailure()` (L50): `generation` → `PROVIDER_FAILURE` (6), or exit 4 when `providerAttempts` is 0 or not an integer; `provider-configuration` → `PROVIDER_CONFIGURATION_INVALID`; missing failure → `STAGE_FAILED` (1). |
| `scripts/ai/providers/index.js` | `74c64cd3` | Process-scoped `bindCancelSignal()`; `createProvider()` passes `{cancelSignal}` to Groq and Gemini. |
| `scripts/ai/providers/groq-provider.js` | `3d97fd86` | `fetch(GROQ_API_URL, {POST, Authorization: Bearer, JSON body, signal})` with no `redirect` member; 30 s timer covers fetch and body read. Rejection: `AbortError` → `TIMEOUT` ✓, else `NETWORK` ✓. `mapHttpError`: 401/403 `AUTH` ✗, 429 `RATE_LIMIT` ✓, 408 `TIMEOUT` ✓, 5xx `UNKNOWN` ✓, every other status (incl. 3xx and 421) `UNKNOWN` ✗. Bounded body read (32 MiB), **then** the content check → `INVALID_RESPONSE` ✗. Cancellation → `UNKNOWN` ✗, no cause. |
| `scripts/ai/providers/gemini-provider.js` | `6559416d` | Same structure; credential in header `x-goog-api-key`; model in the URL path. `mapHttpError`: 401/403 `AUTH` ✗, 429 ✓, 5xx ✓, every other status **incl. 408**, 3xx and 421 `UNKNOWN` ✗. |
| `scripts/ai/cli/run-artifacts.js` | `56946794` | `KNOWN_CODES` closed allowlist; unknown codes → `UNKNOWN`. |
| `scripts/ai/cli/config-file.js` | `65ed658f` | Config schema v1 is exactly `schemaVersion: 1`. |
| Generators | — | At most 2 attempts; `providerAttempts` set before `provider.analyze()`. `automation-plan-generator.js` L677 and `generate-change-set.js` L270 replace every provider error with `INVALID_VALUE`. Calls are strictly sequential. |
| `package.json` | — | `engines.node` = `22.x`. |

(✓ retryable, ✗ not retryable.) CLI contract facts: exit taxonomy contract §10.7
(6 = provider failure incl. provider bounded-time exceeded; 1 = internal or
invariant violation); `--json` envelope contract §10.8; config v1 contract §11.2.

### 2.5 Spike evidence identity

| Item | Value |
|---|---|
| Location | `C:\Users\artem\Desktop\OD-RATE-1-Gateway-Spike` (outside every repository) |
| `src/gateway.js` SHA-256 | `f5bc4af4dca14005fa0cd592306aea95d6dd1a84f6e93bf07798a0e01c741ff4` — **matches** the PO-stated C2 identity |
| `test/gateway.test.js` SHA-256 | `7059ad212e063addf39ba8a47b67e93e9def252b95e17f11a519b6b941744bb3` — **matches** |
| Other sources (SHA-256) | `src/parent.js` `cfdc9ce9e181b58a7a0734af17c5e5b2f403c81156502947c8f0a818b6e58dc2`; `src/transport.js` `dabd7978557f094bd7ff0ed7ee6fa67f55a07a43e1e72e51bd2c2e70f2571af6`; `src/worker.js` `d9c9832db61a237b73babb3775a6ce46a23f559a4d25174e56c101236ea05c0c`; `src/schema.js` `b17ff59d79a62c9a9f05c98e4b3f92f2fd67c6c1b1bc7fe8e7a435fa582c3b09`; `src/clock.js` `80301a914e234fddd7d405bf46b785ecc3adbfedc6f9383997c3345a48de8e78`; `test/parent.test.js` `c3bf9e533d8a1490d3e03b7f9c50d72b996b8168d95be5636a212c372f4f5262`; `test/transport.test.js` `6e8b1ca6287c1d0da2ac9c3ec1cd65fa52712694f17bdd138b1895a9bcf26554`; `test/schema.test.js` `18320899ddc9d0d6fa9005a57f868a86a24d1867a4c1c9f4d0d230b614bbac79`; `test/helpers/fakeServer.js` `53745906e46d7be51c50fc8828597b0485747eba01f4fc7c7d8c30897c786d6e` |
| Evidence outputs | `evidence/test-output.txt` `5881cc8881e477ef763e1d3314e5d5b16052ee9d26763158d0a2a5d616b018e6` (Windows 11, Node v24.22.1, 82/82); `evidence/test-output-linux.txt` `61fa4057f0eb5542316748735b38f5b914472f67497f474a85bb27e6dcab12ed` (WSL2 Linux, Node v22.23.3, 82/82). Both equal the hashes recorded in the spike's C2 record. |
| Source manifest (C6, C5-EVID-01) | `8bcd557c82c50f54006fc84537b0fd72dc0503882e5ecc96bba7b7f743ea5f2c`. **Reproduced by the author at C6 authoring (AUTHOR-LOCAL)** over all **24** files of the spike directory: `README.md`, `REPORT.md`, `evidence/` (10 files), `package.json`, `src/` (6), `test/` (5 incl. `helpers/fakeServer.js`). Rule: one line per file, `sorted relative path + space + lowercase SHA-256 + LF`, sorted bytewise (C locale); the manifest hash is the SHA-256 of the concatenated lines. The C5 statement "not reproduced" is withdrawn: it tried constructions over `src/`, `test/` and `package.json` only. |
| Independent verdict | **PO-SUPPLIED.** The PO mission stated: C2 VERIFIED_PASS; Windows Node 24 82/82; Linux Node 22 82/82; GWV-01/02/03 FIXED_VERIFIED; F1–F5 PASS in spike scope; Property A VERIFIED_PASS; Property B NOT PROVIDED; real HTTPS/TLS not verified; 0 real provider calls. Independent C2 report SHA-256, **reviewer-reported**: `5447dc2ab15de967f39ee4497ded79a0e3c29a0795f7b27d2c29082fb713f9c7`. **Gap:** the author has no copy of that report, so neither its content nor its hash is author-verified. The verdict is used as PO-supplied evidence of an independent verification, together with the AUTHOR-LOCAL source identities and manifest above. |
| Spike scope limits | Loopback `node:http` only, no TLS; fake credential; scenario-driven worker, not the production runner; parent lifecycle disconnects first and uses a 300 ms graceful-exit window (not carried, §15.4); Windows ran Node 24 (outside `engines` 22.x); Windows ignored-kill is simulated with a no-op kill hook. |

### 2.6 Independent review history

Codex reviewer session `01a17740-3dc0-7ee2-b26e-a538092270cd` holds R2 (of C2),
R3 (of C3 `eff78a0c`) and R4 (of C4 `38121f95`). Transcript SHA-256 at C5
authoring time: `b70f2e614f380d0176a87b5ee18abb30c99709e68418116ba0eb54a38dbb3a6f`
(it grew with each review; the C4-time hash `00c03958…` covered R2 and R3 only).

R4 verdict: **REJECTED.** Findings and their R4 status:

| Finding | Severity | R4 status | C5 treatment |
|---|---|---|---|
| R2-ARCH-01 | MAJOR | RESOLVED_BY_DESIGN (admission); physical sends via R4-ARCH-02 | §8.6, §10 |
| R2-ARCH-02 | MAJOR | RESOLVED_BY_DESIGN | §15 (C4 machinery retained; parent-authoritative terminal) |
| R2-ARCH-03 | MAJOR | RESOLVED_BY_DESIGN (conditional admission mathematics) | §9.2, §17 |
| R2-ARCH-04 | MAJOR | **REGRESSED** (union wait grows after the last check) | §9.1 (R4-ARCH-01) |
| R2-ARCH-05 | MINOR | RESOLVED_BY_DESIGN | §12 |
| DRIFT-01 | corrective | RESOLVED_BY_DESIGN for observed cancellation; abandonment guarantee refuted (R4-ARCH-03) | §13 |
| DRIFT-02 | corrective | RESOLVED_BY_DESIGN for receipt/ACK/close | §14.1 |
| R3-ARCH-01 | MAJOR | RESOLVED_BY_DESIGN | §11 |
| R3-ARCH-02 | MAJOR | RESOLVED_BY_DESIGN (gate-reading boundary) | §8.4 |
| R3-ARCH-03 | MAJOR | **STILL_OPEN** (T1 refuted by HTTP 421) | §10 |
| R3-ARCH-04 | MINOR | **STILL_OPEN** (admission budget and FIFO serialization) | §8.5, §9.1 |
| R3-ARCH-05 | MINOR | RESOLVED_BY_DESIGN (conditional bounds) | P §7 |
| **R4-ARCH-01** | MAJOR | NEW: wait budget exceeded before admission (computation inside `analyze()` grew union wait after the last check) | §9.1; P Lemma 2, P §6.1 |
| **R4-ARCH-02** | MAJOR | NEW: `redirect: "manual"` does not give one HTTP request per `fetch` — HTTP 421 caused **2 POSTs** on Node 22.23.3/undici 6.28.1 and Node 24.22.1/undici 7.30.1 | §10; P Lemma 5, P §6.2 |
| **R4-ARCH-03** | MAJOR | NEW: abandonment does not guarantee no new provider requests (a live child continued with `transportAllowed=true` after parent `disconnect()`) | §13; P Lemma 4, P §6.3 |
| **R4-ARCH-04** | MINOR | NEW: FIFO released at admission contradicts the single slot | §8.5; P §6.4 |

R4 also recorded: `K_SETTLE = 10 000 ms` accepted as PO-approved; widening the
wait budget to synchronous computation would need a separate PO decision;
weakening the surviving-child guarantee would need a separate PO disposition.
C5 needs neither: §9.1 restores the sum-of-governor-waits meaning, and §13 does
not weaken the guarantee but restates it as Property A with Property B handed to
the mandatory Security gate (AD-02).

### 2.7 Preserved historical evidence

C2 identities (unchanged, not re-sealed): C2 design SHA-256
`1c0851be7a40a9406c7d75daa7d9676534b4e61f7ff542a93be53f3e2f74c054`; manifests
`eeb5a063b09803513eeb6ef77893802a37bf39e55d6abc8d5a955257d9ecbff9`,
`006dae0d317d0ad35c9e0c0591d520f1d63e7f1b5cdbf443f9947ece57d9cdfc`,
`1139919745bf35507bdbe732af3e8e5fb55313e3d9d9ee0b3f42aad2f5470fcc`; Issue #258
raw body `e5b84e8118631885d8034f9d6eab1bc730d5ccda3598597ba5d6c935e95c86cc`. The
full C3 and C4 texts remain in git history at `eff78a0c` and `38121f95`. C2
clauses are still cited as `C2:<line>`. The C5 text remains at `0c91393d`.

### 2.8 Evidence provenance (C6; C5-EVID-01)

| Provenance | Meaning | Items in C6 |
|---|---|---|
| **IND-VERIFIED** | Verified by an independent reviewer **and** the verification artifact is available to the author | none in C6. (R4 reran the C4 artifacts, with output hashes recorded in P §7.2. That result is historical C4 evidence.) |
| **PO-SUPPLIED** | A verdict or fact the PO stated in a mission. The author did not verify the underlying artifact | spike C2 independent verdict; C2 report SHA-256 `5447dc2a…f9c7` (reviewer-reported); SG01-SEC-01 and C5-ARCH-01/02, C5-EVID-01, C5-GOV-01 finding texts; PD-C6-1 … 6; SEC-D1 … D3 |
| **AUTHOR-LOCAL** | Verified by the author on local files at C6 authoring time; **not independent** | spike per-file hashes and 24-file manifest `8bcd557c…`; host-feasibility report hashes (§30.1); repository code facts at `a32a6cd7` (§2.4, §28.1) |
| **SMOKE** | Experimental setup-smoke observations. They are not formal probes and are certified by no one | host-feasibility S1–S7 (Windows Job Object and AppContainer setup), WSL2 inventory (§30.1) |
| **ASSUMPTION** | An unverified design assumption, from OS documentation or reasoning, pending a qualification gate | every host property `H-L…` / `H-W…` (§27.4, §27.5) and their gates (§30.2) |

No item is moved to a stronger provenance without new evidence. Provenance labels
SMOKE and ASSUMPTION never support a "verified", "qualified" or "certified" statement.

---

## 3. Architecture

### 3.1 Components and ownership

```text
CLI parent process (qa-agent; generative.js + stage-process.js)
 |
 +-- Provider Gateway session (one per governed stage child; parent memory only)
 |     +-- Admission / rate accounting   RPM + TPM ledgers, reservation, usage charge
 |     +-- Deadline / wait budget        single monotonic origin tOpen; exclusive deadline
 |     +-- Revocation                    synchronous, idempotent, parent-only
 |     +-- Provider adapter              Groq / Gemini request build, response parse, error mapping
 |     +-- Controlled HTTPS transport    single-send core https; no redirects, retries or reuse
 |     +-- Provider credentials          AI_API_KEY, AI_MODEL read from the parent environment
 |
 +-- Lifecycle supervisor (stage-process.js)
 |     +-- FT0 result store + receipt ACK, close-based settlement, CLOSE_AFTER_EXIT
 |     +-- governed only: heartbeat watchdog, stage enforcement
 |     +-- both modes (C6): containment state machine, termination request, K_SETTLE settlement bound
 |
 |   spawn; private launcher status / control channel (C6, §27.3)
 v
Per-stage launcher (C6; candidate: Linux bubblewrap, Windows native helper; §27.4, §27.5)
 |     creates the OS containment BEFORE the worker runs; never holds credentials
 v
OS containment (C6): Linux user+PID+net+IPC namespaces / Windows Job Object + AppContainer
 |   private IPC (validated, closed schema; no credentials, URLs or headers), passed through
 v
Stage worker = stage child (generative-runner.js; governed AND ungoverned, C6)
       +-- generators (unchanged)
       +-- Gateway client provider       implements the provider contract via IPC
       +-- StageContext                  governed only: step, per-step call count, sticky refusal (C4 §11 machinery)
       +-- FT0 guardParentLink           cancellation on parent loss, result receipt/ACK (unchanged)
       +-- heartbeat sender              governed only
```

In C6 the term **worker** means the stage child process together with every
descendant it creates. All of them are members of one containment (§27.1).

| Responsibility | Owner | Notes |
|---|---|---|
| Provider credential and model | parent Gateway | Never in child env or IPC (§3.3, §7.2) |
| Transport and its 30 s timer | parent Gateway | §10 |
| Admission, RPM/TPM ledgers, cold start, cooldown, hints | parent Gateway | §8 |
| Wait budget and dispatch deadline | parent Gateway | §9 |
| Usage observation and charging | parent Gateway | §11 |
| Revocation | parent (session + supervisor) | §13 |
| Provider error mapping | parent Gateway (same mapping code as today) | §12 |
| Retry policy (two attempts) | child generators (unchanged) | §12 |
| Step, attempt counting, return/unwind classification | child runner | §15.1 |
| Authoritative governor refusal record | parent Gateway | §15.2 |
| Result transfer and receipt | child (`report()`), parent stores + ACKs | §14.1 |
| Kill, watchdog, enforcement, K_SETTLE | parent supervisor | §14 |

### 3.2 Governed and ungoverned modes (C6: PD-C6-1)

| Config | Gateway session | Child provider | Child env credentials | Rate governance: admission, wait, deadline, heartbeat, watchdog, enforcement | SEC-C1 protection |
|---|---|---|---|---|---|
| v1 | **pass-through** (§25) | Gateway client (IPC) | **absent** | none (PD-R13) | revocation + containment + FT0 (PD-R14, §27) |
| v2, `providerGovernor` absent or `enabled: false` | **pass-through** (§25) | Gateway client (IPC) | **absent** | none (PD-R13) | revocation + containment + FT0 |
| v2, `enabled: true` | governed (§8–§11) | Gateway client (IPC) | **absent** | present | revocation + containment + FT0 |

C5's table had the first two rows unchanged from the baseline (child-owned
`createProvider()` and credentials in the child environment). PD-C6-1 replaces those
rows. In every mode, provider-backed execution happens only on a qualified host
(§26); elsewhere it is refused before any credential is used.

**INV-G13 (C6, amended under PD-C6-1; ungoverned compatibility):** with v1 or a
disabled governor, **no rate governance exists**: no admission, ledger, cold start,
wait, dispatch deadline, heartbeat, watchdog or enforcement timer. The provider
request bytes and transport semantics are the certified provider implementation's
(§25.3). Exit codes, reason codes, stdout and the `--json` envelope equal the
baseline on every path. The only exceptions are the differences enumerated in §25.4
(D-1 … D-4), each traceable to PD-C6-1, PD-C6-3 or PD-C6-4. The C5 clause "No Gateway
module is loaded on those paths" is **withdrawn**.

### 3.3 What the worker can and cannot do (C6; both modes)

- It holds no provider credential and no model name. The worker environment is
  `buildGenerativeEnv()` **without** `AI_SECRET_KEYS`, in both modes (§20, §28.3).
- It never loads the Gateway, the adapter or the transport. Its only provider
  path is the IPC request in §7.
- It cannot name a URL, host, header, method or credential: the IPC schema has
  no such fields (§7.2).
- C5 recorded that the child **can** still open arbitrary network connections
  (Property B, §13.4). C6 designs the containment so that the worker has **no
  network interface except an isolated loopback** (Linux) or **no network
  capability** (Windows AppContainer). It also has no view of the parent process
  and no access to credential files (§28). These are **candidate** properties:
  `HOST_NOT_VERIFIED` (§30).

## 4. Contract boundaries

| Surface | Class | C5 effect |
|---|---|---|
| Package `exports`, `bin`, library API | public | **None.** New modules are internal only. |
| CLI exit codes (contract §10.7) | public | **None new.** Governed outcomes use existing codes 3, 6 and 1. C6 candidate reasons are proposed onto existing codes 5 and 1, **pending authorization** (§29). |
| CLI reason codes | public | The PD-R8 closed extension of §16. **No code beyond the set already designed in C4 is part of C6's design contract.** The two PD-C6-4 candidates `HOST_ISOLATION_UNAVAILABLE` and `WORKER_TERMINATION_UNCONFIRMED` are **proposed only**. Adding them needs a canonical contract amendment that is not authorized (§29). |
| Provider-backed execution availability | public behavior | **C6 (PD-C6-3):** refused on unsupported or unqualified hosts, before any credential use or provider traffic. Unrelated capabilities stay available (§26). |
| Config schema | public | v2 adds optional `providerGovernor` (§5). v1 unchanged. |
| stdout | public | Unchanged. |
| stderr | bounded diagnostics | **C6:** one fixed-template line when termination cannot be confirmed (§27.7), in both modes. It replaces C5's governed-only abandonment line (§14.5). |
| Persistent data, run manifest, run store, review packages | — | **Unchanged. No new persistent format.** Gateway and containment state live in parent memory and end with the session. |
| Child (worker) environment | private | **C6: both modes:** credentials removed (§3.3, §28.3). |
| Parent ↔ child IPC | private | **C6: both modes:** `provider-request`, `provider-response`. Governed only: payload marker `gateway`, `heartbeat`, `failure.kind: "stage-timeout"`, optional `failure.governorCode` (§7, §15). FT0 `result` / `result-ack` unchanged. |
| Parent ↔ launcher channels | private | **C6:** a closed status channel and, on Windows, a control channel (§27.3). These are not part of any public contract. |
| Provider adapters | internal | Governed: mapping functions shared with the ungoverned providers, so classification is identical (§12). **C6, ungoverned:** the certified provider implementations run unchanged inside the parent (§25.3). |
| Generators | internal | **No change.** |

## 5. Configuration and compatibility

`schemaVersion: 2` is v1 plus one optional top-level key (unchanged from C4):

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

The values are illustrative; no provider plan limit is asserted.

| Key | Rule |
|---|---|
| `providerGovernor` | optional object; closed keys `{enabled, limits}` |
| `enabled` | required boolean |
| `limits` | required when `enabled` is `true`; closed key set ⊆ `{"groq", "gemini"}` |
| `tokensPerMinute` | integer, 2 ≤ v ≤ 10 000 000 |
| `requestsPerMinute` | integer, 1 ≤ v ≤ 100 000 |
| `completionReserveTokens` | integer, 0 ≤ v ≤ 1 000 000 |
| `reasoningReserveTokens` | optional integer, 0 ≤ v ≤ 1 000 000, default 0 |

Timing values are product constants and MUST NOT be configurable. Validation
failures are exit 3 before any provider exists. When `enabled` is `true` and the
effective generative provider has no `limits` entry, the command fails with exit
3, `PROVIDER_GOVERNOR_LIMITS_MISSING`, before spawning the child (zero sends).

Governed provider configuration: the parent builds the adapter before spawn. A
missing `AI_API_KEY` or `AI_MODEL` raises the same `CONFIGURATION` provider error
the child raises today and maps to the same `PROVIDER_CONFIGURATION_INVALID`
outcome (§15.3 row 2), only earlier and without a spawn.

---

## 6. Constants and clock

### 6.1 Constants

| Symbol | Value (ms unless noted) | Source |
|---|---:|---|
| `T_REQ` | 30 000 | PD-R3; existing provider timer |
| `C_COLD` | 65 000 | PD-R5, AD-03 |
| `W_HOLD` | 65 000 | provider minute (60 000) + guard (5 000) |
| `W_MAX` | 65 000 | PD-R3 per-wait cap |
| `W_BUDGET` | 900 000 | PD-R3, AD-03 |
| `D_STAGE` | 1 800 000 | PD-R3 |
| `D_DISPATCH` | 1 770 000 = `D_STAGE − T_REQ` | last dispatch instant (exclusive), from `tOpen` |
| `S_MIN` | 50 | minimum planned sleep |
| `I_MAX` | 64 | wait-loop iterations per request |
| `HB` | 10 000 | PD-R3 heartbeat |
| `WD` | 45 000 | PD-R3 watchdog |
| `K_PARENT` | 1 815 000 | parent enforcement point from `tOpen` (D+15 A) |
| `K_SETTLE` | **10 000, APPROVED** | PD-R15 / AD-07 |
| `ACK` | 10 000 | FT0 `RESULT_ACK_DEADLINE_MS` (unchanged) |
| `CAE` | 10 000 | FT0 `CLOSE_AFTER_EXIT_MS` (unchanged) |
| `MAX_RESPONSE_BYTES` | 32 MiB | existing provider envelope bound (unchanged) |
| `h` | 0.85 | token headroom |
| `κ` | 3.0 bytes/token | heuristic estimator (PD-R10) |
| `O` | 32 tokens | template overhead |
| `U_MAX` | 10 000 000 tokens | maximum accepted usage value |

Derived per session: `B_tok = floor(tokensPerMinute × h)`; `B_req = requestsPerMinute`.

No other numeric constant exists. In particular there is **no** graceful-exit
window and no acceptance grace (§14.6).

### 6.2 Clock semantics

- **One clock, one authority.** Every Gateway and supervisor decision reads the
  parent's `process.hrtime.bigint()` (monotonic nanoseconds). The child's clock is
  never used for a governed decision.
- **One origin.** `tOpen` is read immediately before `spawn()`. Then
  `coldUntil = tOpen + C_COLD`, `dispatchDeadline = tOpen + D_DISPATCH` and
  `enforceAt = tOpen + K_PARENT`. All are absolute instants on the same clock.
- **Exact arithmetic.** All comparisons and sums are done in integer nanoseconds
  (constants × 10⁶). No rounding is applied before a comparison.
- **Fresh readings.** Every time-dependent decision takes a new reading. A
  reading is never reused across an `await`, and the final dispatch reading is
  the last operation before the transport call (§8.4).
- **Exclusive deadlines.** For every absolute deadline `X` used to refuse an
  action, `now >= X` refuses (AD-04).
- **Timers are prompts, not proofs.** A timer fires "at or after" its instant,
  with unbounded lateness `ε ≥ 0`. A decision that matters is re-checked against
  a fresh reading when it is taken.
- **Regression guard.** If a reading is smaller than an earlier one, the session
  refuses with sticky `RATE_ACCOUNTING_INVALID`. (`hrtime` is monotonic; the
  guard is defensive.)
- **Suspend.** No claim is made across system suspend (§19).

---

## 7. Private IPC protocol

### 7.1 Messages (C6: provider messages on both paths; heartbeat governed only)

In C6 the provider-request/response exchange is used in **both** modes. In
pass-through mode (§25) the parent answers with `content` or `provider-error` only.
`refused` carries only the private codes `BUSY`, `REVOKED` and `INVALID_REQUEST`.
Governor codes are never sent in pass-through mode.

| Direction | Message | Closed shape |
|---|---|---|
| parent → child | payload (existing) + marker | `{type:"payload", stage, payload, gateway:{v:1}}`. The `gateway` member is present only when governed. In C6 the runner **always** uses the Gateway client provider. The marker selects only the governed-only features: heartbeat and `StageContext` (§25.1). |
| child → parent | provider request | `{type:"provider-request", v:1, id, systemPrompt, userPrompt}` |
| parent → child | provider response | `{type:"provider-response", v:1, id, outcome:"content", content}` · `{…, outcome:"provider-error", code, retryable}` · `{…, outcome:"refused", code}` |
| child → parent | heartbeat | `{type:"heartbeat", v:1, seq}` |
| child → parent | result (FT0, existing) | `{type:"result", …, receipt}` |
| parent → child | result ACK (FT0, existing) | `{type:"result-ack", receipt}` |

Field domains:

| Field | Domain |
|---|---|
| `id` | integer, `1 ≤ id ≤ 2³¹ − 1` |
| `systemPrompt`, `userPrompt` | strings. No new size cap is introduced here (PD-R4 is open). |
| `content` | non-empty string, from a response body already bounded by `MAX_RESPONSE_BYTES` |
| `code` (provider-error) | one of `AUTH`, `RATE_LIMIT`, `TIMEOUT`, `NETWORK`, `INVALID_RESPONSE`, `UNKNOWN` |
| `retryable` | boolean, exactly as the existing provider mapping would set it (§12) |
| `code` (refused) | governor codes `RATE_REQUEST_EXCEEDS_BUDGET`, `RATE_BUDGET_EXHAUSTED`, `RATE_ACCOUNTING_INVALID`, `STAGE_TIMEOUT`; private codes `BUSY`, `REVOKED`, `INVALID_REQUEST` |
| `seq` | integer, strictly increasing, `1 ≤ seq ≤ 2³¹ − 1` |

### 7.2 Validation

Both sides treat every received message as untrusted input.

- Parent, for every child message: the value MUST be a non-array object; `type`
  MUST be one of the child-to-parent types; the own key set MUST equal the closed
  key set of that type exactly (no missing, no extra); every field MUST be in its
  domain. On success the parent copies the fields into a fresh plain object and
  uses only that copy (spike S1–S7).
- A `provider-request` that fails validation but carries a valid `id` gets
  `refused INVALID_REQUEST`. Anything else is dropped. Neither path dispatches.
- Parent → child messages never contain a credential, model name, URL, header,
  raw provider message, raw usage or raw body. The only provider text that crosses
  IPC is `content`, which the child already receives today from its own provider.
- Child, for every parent message: the same closed-shape rule. A `provider-response`
  whose `id` is not the child's single pending request is ignored.
- The governed child's environment and argv carry no credential (spike P13).

### 7.3 Request IDs and correlation

- The child numbers its requests `1, 2, 3, …` per process. The certified generators
  have at most one request outstanding.
- The parent keeps `lastId`. A request with `id ≤ lastId` (replay or duplicate) is
  refused `INVALID_REQUEST` and makes no admission. Otherwise `lastId = id`.
- Each `provider-response` echoes the request's `id`. Responses MAY arrive in any
  order relative to other responses (a `BUSY` refusal can overtake an in-flight
  reply; spike P4). The child matches only by `id`.

### 7.4 Child Gateway client provider

The governed child passes a `GatewayClientProvider` to the unchanged generators.
It implements the existing provider contract (`name`, `analyze({systemPrompt,
userPrompt})`) and passes `validateProvider()`.

```text
analyze({systemPrompt, userPrompt}):
  if cancelSignal.aborted: throw cancelledError()          // certified SEC-C1 error: UNKNOWN, not retryable, no cause
  ctx.calls += 1                                           // §15.1
  id = ++nextId
  send {type:"provider-request", v:1, id, systemPrompt, userPrompt}   // send error -> FT0 fail() exits
  r = await response(id) or cancelSignal abort             // abort -> throw cancelledError()
  switch r.outcome:
    "content":        return r.content
    "provider-error": throw ProviderError(FIXED_MESSAGE[r.code], {code: r.code, retryable: r.retryable})
    "refused":
      if r.code in GOVERNOR_CODES: refuseLocally(r.code)    // sets ctx.terminal, registers the error, throws (§15.1)
      else /* BUSY, REVOKED, INVALID_REQUEST */: throw ProviderError(FIXED_MESSAGE.UNKNOWN, {code:"UNKNOWN", retryable:false})
```

The client has no timer of its own. A response always arrives, or the parent is
lost (FT0 `fail()` exits the child), or the parent kills the child (§14.4).

### 7.5 Parent routing

`stage-process.js` routes child messages on every provider-backed path (C6). The
heartbeat branch exists only when governed:

```text
on message m from child:
  v = validate(m)                                         // §7.2
  if v is heartbeat (governed): if !killed and result === null: re-arm watchdog
  elif v is provider-request:
      if killed or settled or session.revoked or containment.state !== PROCESS_RUNNING:
          reply(id, refused REVOKED); return              // C6: no dispatch before launcher "ready" (§27.3)
      session.onRequest(v)                                 // §8 governed, §25 pass-through
  elif v is result (FT0):    session.revoke("result"); FT0 store-then-ACK (unchanged); disarm watchdog
  else: ignore (FT0 behavior)
on child "disconnect" | "exit" | "error":  session.revoke(<event>)   then the FT0 handlers and the
                                           C6 containment rules (§27.2, §27.8) run
```

`reply()` sends only when `child.connected`, inside `try`, with a callback that
ignores errors. A failed reply never dispatches anything and never revives a
session.

---

## 8. Gateway session and admission

### 8.1 Session state

| Field | Meaning |
|---|---|
| `tOpen`, `coldUntil`, `dispatchDeadline` | §6.2 |
| `B_tok`, `B_req`, adapter, credential | per effective provider (§5) |
| `entries` | list of `{tCommit, tSettle \| null, res, charged}`; one per transport invocation |
| `W` | charged governor waiting (ns); starts at `C_COLD` (§9.1) |
| `cooldownUntil`, `hintTok`, `hintReq`, `exhausted` | C4 §7.6 semantics, unchanged (§8.6) |
| `active` | `null` or `{id, controller}` of the one request in the pipeline |
| `revoked` | boolean; set once, never reset |
| `terminal` | `null` or `{code}`; sticky governor refusal (§15.2) |
| `lastId` | §7.3 |
| `stats` | private counters (busy refusals, invalid requests); never public |

An entry is **live at `t`** iff `tSettle === null` or `t < tSettle + W_HOLD`.

### 8.2 Request states

```text
RECEIVED --validate fail--------------------------------------------> REFUSED(INVALID_REQUEST)
RECEIVED --revoked------------------------------------------------> REFUSED(REVOKED)
RECEIVED --active !== null----------------------------------------> REFUSED(BUSY)            (no state change)
RECEIVED --terminal !== null--------------------------------------> REFUSED(terminal.code)
RECEIVED --accepted: active = this--> PLANNING
PLANNING --Res > B_tok / budget / cap / deadline / exhausted------> REFUSED(governor code)   (active cleared)
PLANNING --capacity free now--> COMMIT --send()--> IN_FLIGHT
PLANNING --capacity later--> WAITING --sleep returns--> PLANNING
WAITING  --revoked (sleep aborted)--------------------------------> CANCELLED (wait charged)
IN_FLIGHT --transport outcome--> SETTLING --charge, hints--> RESPONDED   (active cleared before the reply)
IN_FLIGHT --revoked--> abort --> SETTLING (UNAVAILABLE) --> no reply or REVOKED
```

Only COMMIT creates an entry and calls the transport. Every refusal before
COMMIT leaves `entries`, `W`, hints and cooldown unchanged, except that a sleep
that has already happened stays charged (§9.3).

### 8.3 Admission algorithm (normative)

```text
onRequest(req):                                     // req is a validated copy (§7.2)
  if req.id <= lastId: return reply(req.id, refused INVALID_REQUEST)
  lastId = req.id
  if revoked:           return reply(req.id, refused REVOKED)
  if active !== null:   return reply(req.id, refused BUSY)          // §8.5, no other effect
  if terminal !== null: return reply(req.id, refused terminal.code)
  active = {id: req.id, controller: new AbortController()}
  out = await run(req)                              // never throws; returns a reply value
  active = null                                     // cleared BEFORE the reply is sent
  if !revoked: reply(req.id, out)

run(req):
  res  = estimate(req)                              // PD-R10, §11.2
  if res > B_tok: return refuse(RATE_REQUEST_EXCEEDS_BUDGET)
  body = adapter.buildRequest(req)                  // pure; prepared once, before any wait
  for it = 0, 1, …:
    t = now()
    if revoked:                return CANCELLED
    if exhausted:              return refuse(RATE_BUDGET_EXHAUSTED)
    if W > W_BUDGET:           return refuse(RATE_BUDGET_EXHAUSTED)   // after an overshooting sleep
    if t >= dispatchDeadline:  return refuse(STAGE_TIMEOUT)
    f = freeAt(res, t)                              // §8.6
    if f <= t:
      return commit(res, body)                      // §8.4: same synchronous turn, no await before send
    if it >= I_MAX:            return refuse(RATE_BUDGET_EXHAUSTED)
    planned = max(f − t, S_MIN)
    if planned > W_MAX:                              return refuse(RATE_BUDGET_EXHAUSTED)
    // ---- pre-sleep section (C6, C5-ARCH-01): fresh reading, then checks, then sleep; no await in between
    a = now()                                       // FRESH pre-sleep reading; t is NOT reused here
    if a < t:                                       return refuse(RATE_ACCOUNTING_INVALID)  // §6.2 guard
    if revoked:                                     return CANCELLED
    if a >= dispatchDeadline:                       return refuse(STAGE_TIMEOUT)
    if W + chargeable(a, a + planned) > W_BUDGET:   return refuse(RATE_BUDGET_EXHAUSTED)
    if a + planned >= dispatchDeadline:             return refuse(STAGE_TIMEOUT)
    fired = await sleep(planned, active.controller.signal)   // timer armed in this same synchronous section
    b = now()
    if b < a: return refuse(RATE_ACCOUNTING_INVALID)  // clock regression guard (§6.2)
    W += chargeable(a, b)                           // actual elapsed, incl. overshoot or cancellation (§9.3)
    if !fired or revoked: return CANCELLED

refuse(code): if terminal === null: terminal = {code}; return {outcome:"refused", code: terminal.code}
chargeable(a, b) = max(0, b − max(a, coldUntil))    // §9.1
```

`refuse()` makes the first governor refusal sticky. `CANCELLED` produces no reply:
the session is revoked and the stage is settling. Requests that arrive after
revocation get `refused REVOKED` (§7.5). Revocation never sets `terminal`.

**Pre-sleep section (C6, C5-ARCH-01).** C5 checked the planned sleep against
`t`, the loop-top reading. Synchronous work between `t` and the start of the sleep
(`freeAt`, bookkeeping, garbage collection) could make that reading stale. C6 takes
a fresh reading `a` immediately before the checks. It evaluates revocation, the
deadline, the wait budget and the planned end against `a`, and arms the sleep timer
in the same synchronous section. Only these comparisons and the timer arming lie
between `a` and the sleep. `planned` keeps the value computed at `t`. The sleep
therefore ends no earlier than `f` (if `f` is already in the past, the next loop
iteration commits), and the check `a + planned >= dispatchDeadline` refers to the
sleep that is actually armed. The per-wait cap and the iteration cap do not depend
on the clock and are unchanged. The final dispatch checks at `t2` (§8.4) are
unchanged and remain strict. The pre-sleep section adds an earlier refusal; it does
not replace the commit-time checks.

Required trace (P PT-13): `dispatchDeadline = D`; loop reading `t = D − 75`;
`planned = 50` (C5 would pass `t + planned = D − 25 < D`). A synchronous delay of
100 ms follows, so the fresh `a = D + 25`. Then `a >= D` → `STAGE_TIMEOUT` **before
sleeping**: 0 sleeps, `W` unchanged, 0 commits, 0 HTTP.

### 8.4 Commit point (irrevocable boundary)

```text
commit(res, body):                                  // entered synchronously from run()
  t2 = now()                                        // final reading, last operation before the checks
  if revoked:                return CANCELLED
  if t2 >= dispatchDeadline: return refuse(STAGE_TIMEOUT)
  p = transport.send(body.bytes, body.headers(credential), active.controller.signal, T_REQ)   // IRREVOCABLE
  e = {tCommit: t2, tSettle: null, res, charged: res}; entries.push(e)
  return settleExchange(e, await p)                 // §11.6
```

- No `await`, I/O or allocation-heavy work (serialization, header building) lies
  between `t2` and the call into `transport.send`. The request bytes and header
  template were prepared before the wait loop. JavaScript run-to-completion means
  no callback (revocation, message, timer) can run between the checks and the call.
- Predicates evaluated at the loop reading `t ≤ t2` stay true at `t2`: live
  entries only expire as time passes; `cooldownUntil`, hints and `exhausted`
  change only at exchange settlement, and no exchange can be outstanding while
  this request is active (§8.5); `W` changes only after a sleep (§9.1). Only the
  deadline and revocation can flip, and both are re-checked at `t2` (P Lemma 3).
- The entry is pushed in the same turn as the send call, so no other code can
  observe the ledger between them.
- The irreducible interval between reading `t2` and entering `send` (evaluating two
  comparisons and a call) is the enforcement granularity. It is disclosed, not
  claimed to be zero. After `send` is entered, socket, DNS, TLS and wire timing
  are not observable or bounded by the Gateway, except by the 30 s timer (§10.1).

### 8.5 Sequential BUSY policy (AD-06)

- At most one request is in PLANNING, WAITING, COMMIT, IN_FLIGHT or SETTLING per
  session (`active`).
- A request that arrives while `active !== null` is refused `BUSY` at once. It
  creates no entry, sleeps for no time, changes no counter except a private
  statistic, and **is not queued**. There is no queue anywhere in the Gateway, so
  queue waiting cannot exist (R3-ARCH-04, R4-ARCH-04).
- `active` is cleared only after the exchange is settled and charged, and before
  the reply is sent. A cooperative child sends its next request only after the
  reply, so the certified sequential generators never meet `BUSY`.
- The child maps `BUSY` to a non-retryable `UNKNOWN` provider error (§7.4). `BUSY`
  is private: it never appears in IPC to the user, in the envelope or on stderr
  (§15.4).

### 8.6 Ledgers, cold start, cooldown and hints

Unchanged in meaning from C4 §7.1, §7.6, now evaluated by the parent:

- **Request ledger** `reqLive(t)` = number of entries live at `t`. **Token ledger**
  `tokLive(t)` = Σ `charged` of entries live at `t`. An entry occupies both from
  commit to `tSettle + W_HOLD` and is never removed early.
- `freeAt(res, t)` = the earliest `t' ≥ t` such that all hold at `t'`:
  `t' ≥ coldUntil`; `t' ≥ cooldownUntil`; `reqLive(t') + 1 ≤ B_req` and
  (`hintReq === null` or `t' ≥ hintReq.until`); `max(tokLive(t'), hintTokUsed(t')) + res ≤ B_tok`.
  Because every entry is settled when `freeAt` runs (single active request), the
  ledgers only decrease with time and `freeAt` is finite unless `exhausted`.
- **Cold start:** no commit before `coldUntil` (PD-R5).
- **Cooldown:** after an HTTP 429, `cooldownUntil = tSettle + min(RA ?? 65 000, 65 000)`;
  `RA > 65 000` sets `exhausted` (sticky `RATE_BUDGET_EXHAUSTED` at the next request).
- **Hints** only tighten, under the strict grammars of C2:151. Groq
  `remaining/reset-tokens` feed `hintTok`. Groq `remaining/reset-requests` are per
  day and never relax `P_req`; `0` sets `hintReq`. Gemini: only `Retry-After` on
  429. Header meanings are unverified (PD-R9). Hints and cooldown are applied only
  at exchange settlement.

**INV-G01.** Every transport invocation happens at a COMMIT whose final reading
`t2` satisfies: not revoked, `t2 < dispatchDeadline`, `W ≤ W_BUDGET`, and every
ledger, cold-start, cooldown and hint predicate.

---

## 9. Wait budget and deadline

### 9.1 What is charged (AD-03, R4-ARCH-01)

`W` is **governor waiting**: time the Gateway deliberately spends asleep before
a commit, plus the fixed cold-start charge.

```text
at session open:        W = C_COLD                            // 65 000 ms, charged once (PD-R5)
after every sleep [a,b]: W += chargeable(a, b) = max(0, b − max(a, coldUntil))
nowhere else
```

- **Cold start.** The 65 000 ms cold start is charged in full at session open,
  whether or not the child's first request arrives before `coldUntil`. Sleeping
  inside `[tOpen, coldUntil)` is already covered by that charge and is not charged
  again. Sleeping past `coldUntil` (including overshoot of a cold-start sleep) is
  charged. The charge is never reduced.
- **Not charged:** request validation, estimation, request-body preparation,
  `freeAt`, the commit section, transport time, response parsing, IPC latency,
  child computation and parent lifecycle work. They are stage time, not governor
  waiting. They still consume the deadline because the deadline is absolute.
- **Why this resolves R4-ARCH-01.** C4's union model let `W` grow during
  synchronous computation after the last budget check. Here `W` changes only in
  the statement right after a sleep. The next loop iteration checks `W > W_BUDGET`
  before any commit, and no sleep can occur between that check and the commit.
  With one active request, no other request's sleep can change `W` either. So the
  `W` at every commit is the `W` that was checked (P Lemma 2, P §6.1).
- **Meaning.** This is the C3 "sum of observed governor sleeps" meaning that the
  PO approved under PD-R3, with the PD-R5 cold-start charge. It does not include
  computation, so the separate PO decision R4 mentioned for a widened meaning is
  not needed.

### 9.2 Deadline predicate (AD-04)

- **Dispatch deadline:** `dispatchDeadline = tOpen + D_DISPATCH`. A commit is
  refused when its final reading satisfies `t2 >= dispatchDeadline`. A planned
  sleep is refused before it starts when its **fresh pre-sleep reading** `a`
  satisfies `a >= dispatchDeadline` or `a + planned >= dispatchDeadline` (C6,
  C5-ARCH-01; §8.3). The loop-top reading `t` is never used for this test.
- **Exchange bound:** the transport's `T_REQ` timer is armed inside `send`, so an
  exchange committed before `dispatchDeadline` is aborted at the first timer
  callback at or after its commit plus 30 000 ms, i.e. at or after (but normally
  close to) `tOpen + D_STAGE`.
- **Stage enforcement:** the supervisor's kill decision fires at the first timer
  callback at or after `enforceAt = tOpen + K_PARENT` (§14.4).
- **Authority:** the parent alone. The child has no deadline timer and no deadline
  input. One absolute instant, computed once, is used by every Gateway check
  (spike GWV-01 corrective).

### 9.3 Overshoot and cancellation (AD-04, AD-05)

| Event | Effect on `W` | Effect on dispatch |
|---|---|---|
| Sleep ends on time | `+ chargeable(a, b)` | loop re-evaluates |
| Sleep overshoots by `ε` | `+ chargeable(a, b)` including `ε` | loop top: if `W > W_BUDGET` → refuse; if `t >= dispatchDeadline` → refuse. No dispatch is ever allowed by an overshoot. |
| Sleep cancelled by revocation after `x` ms | `+ chargeable(a, a + x)` (actual elapsed) | `CANCELLED`, zero dispatch |
| Refusal before any sleep | unchanged | zero dispatch |

`W` can therefore exceed `W_BUDGET` by at most the lateness of one sleep plus
`S_MIN`-scale rounding of that sleep. After that no commit occurs in the session.
`W` never decreases.

### 9.4 Counterexamples (details in P §5, P §6)

- `W = 899 990`, rate window needs 1 more ms → `planned = 50` →
  `899 990 + 50 > 900 000` → `RATE_BUDGET_EXHAUSTED` before sleeping (PT-01, spike G1).
- `t = dispatchDeadline − 500`, capacity at `dispatchDeadline` → `planned = 500`;
  with no synchronous delay, `a = t` and `a + planned = dispatchDeadline` →
  `STAGE_TIMEOUT` before sleeping (PT-02, spike E4a).
- Planned 400, timer 100 ms late → loop reads `t = dispatchDeadline` → refused, 500 ms
  charged (PT-03, spike E4b, GWV01-6).
- (C6) Stale loop reading: `t = D − 75`, `planned = 50`, 100 ms synchronous delay,
  `a = D + 25` → `STAGE_TIMEOUT` before sleeping (PT-13; C5-ARCH-01). In C5 this
  sleep would have started. No dispatch would have followed (the loop-top and commit
  checks refuse), but the refusal came only after an unnecessary charged sleep.

---

## 10. Transport

### 10.1 Single-send contract (TS)

The Gateway's transport MUST satisfy, for each `send()` call:

| ID | Requirement |
|---|---|
| TS-1 | At most **one** HTTP request is written for one `send()`. No automatic retry or resend for any status (including 421) or connection failure. |
| TS-2 | Redirects are never followed. A 3xx response is returned as a response. |
| TS-3 | No connection reuse: a fresh connection per `send()` (`agent: false` or an equivalent non-pooling agent) and `Connection: close`. A stale pooled socket can therefore never cause a silent resend. |
| TS-4 | An explicit `AbortSignal` destroys the request. An already-aborted signal causes zero network activity. |
| TS-5 | A `T_REQ` timer is armed inside `send()` and covers connect, TLS, request, response headers and the whole body read. On expiry the request is destroyed and the outcome is `timeout`. |
| TS-6 | The response body is read with a hard byte bound (`MAX_RESPONSE_BYTES`) while streaming, before any JSON parse (TSB-F06 semantics, as `bounded-response.js` today). |
| TS-7 | The outcome is classified (`response {status, rate headers, bounded body}`, `network_error`, `timeout`, `aborted`), never acted on. It settles exactly once. |
| TS-8 | The credential is supplied by the session at the call and used only for the request header. It is never logged, traced or included in an outcome. |
| TS-9 | Only the fixed provider origins are reachable: `https://api.groq.com:443` and `https://generativelanguage.googleapis.com:443`, with paths built by the adapter. The child cannot influence them. |

Global `fetch` (undici) MUST NOT be used on the governed path: it resends a POST
after 421 even with `redirect: "manual"` (R4-ARCH-02; spike B1 on Node 22 and 24).
The spike's `node:http` transport (`agent:false`, `Connection: close`, no retry,
no redirect logic, explicit abort and timeout) met TS-1 … TS-4 and TS-7 on
loopback for 200, 301/302/303/307/308, **421**, 429, 500, connection reset,
timeout, in-flight abort and pre-abort (spike T1–T10). That is the feasibility
basis for TS.

### 10.2 Production HTTPS qualification (OPEN; required before implementation acceptance)

The production transport is core `node:https` with the same structure. Loopback
HTTP evidence does **not** show real Groq or Gemini HTTPS behavior. These items
MUST be verified for the production transport on every supported Node line
(`engines` 22.x) and on Windows and Linux, against a local TLS test server (test
CA injected only through test-only transport options) and, only after PD-R9
authorizes it, against the real providers:

| ID | Qualification |
|---|---|
| TQ-01 | One `send()` → at most one TLS connection and one HTTP request for every status in §12, incl. 421 and each 3xx. |
| TQ-02 | No retry on connection reset, TLS handshake failure, or handshake timeout. |
| TQ-03 | Abort before connect, during handshake, during request write and during the body read: zero further requests; outcome `aborted`; uncertain completion recorded. |
| TQ-04 | `T_REQ` covers handshake and body; slow-drip body ends as `timeout`. |
| TQ-05 | TLS verification is on (`rejectUnauthorized` default true); SNI equals the fixed host; no `NODE_TLS_REJECT_UNAUTHORIZED` path is honored on the governed transport; behavior with `NODE_EXTRA_CA_CERTS` documented. |
| TQ-06 | No proxy path: environment proxy variables and any runtime proxy switch present on the supported Node line do not route or duplicate governed requests. |
| TQ-07 | HTTP/1.1 only; no ALPN negotiation to HTTP/2 on the governed transport. |
| TQ-08 | The bounded body reader for Node streams matches `bounded-response.js` semantics (byte cap, abort mapping, no parse before full acquisition). |
| TQ-09 | Credential never appears in any outcome, trace, error message, IPC message or diagnostic (marker test). |
| TQ-10 | Request bytes are identical to the ungoverned provider's request body for the same prompts and model (golden comparison), so provider behavior is unchanged apart from transport semantics. |

TQ-05, TQ-06 and TQ-09 are also Security gate SG-04 (§21.2).

### 10.3 Evidence limits

- Spike: loopback `node:http`, fake server, no TLS, no DNS, no real provider.
- R4 and spike B1: `fetch` sends 2 POSTs on 421 on Node 22.23.3 and 24.22.1.
- Not shown by anyone: real provider handling of single-send requests, HTTP 421 or
  3xx from real providers, TLS behavior, Windows on Node 22.x.

---

## 11. Exchange outcome and accounting (R3-ARCH-01; PD-R10, PD-R11 A, PD-R12 A, PD-R12-I1)

### 11.1 Exchange record

One record per commit, owned by the session, written only by the transport
outcome and the adapter's parse, sealed once at settlement.

| Axis | Values |
|---|---|
| A. Transport | `RESPONSE` · `NETWORK_ERROR` · `TIMEOUT` · `ABORTED` (every non-`RESPONSE` value after a send is **uncertain completion**) |
| B. HTTP | `none` · `2xx` · `3xx` (not followed) · `4xx` (incl. 421) · `5xx`; `status`; frozen map of the §8.6 rate headers only |
| C. Body | `NOT_READ` (non-2xx; discarded) · `READ_FAILED` (timeout, oversize, invalid JSON) · `PARSED` |
| D. Content | `PRESENT` · `ABSENT` |
| E. Usage | `VALID(U)` · `MISSING` · `MALFORMED` · `UNAVAILABLE` |

Usage classification:

| Condition | Usage class |
|---|---|
| C = `PARSED`, usage object present, every required field valid, consistency holds (§11.3) | `VALID(U)` |
| C = `PARSED`, usage object absent or `null` | `MISSING` |
| C = `PARSED`, usage present but a required field absent, non-integer, negative, `> U_MAX`, inconsistent, or the normalizer threw | `MALFORMED` |
| C ≠ `PARSED` | `UNAVAILABLE` |

The adapter classifies usage **immediately after** the bounded JSON parse and
**before** the content check. Content validity never changes the usage class.

### 11.2 Estimate and reservation (PD-R10)

`Res = ceil(utf8Bytes(systemPrompt + userPrompt) / κ) + O + completionReserveTokens + reasoningReserveTokens`.
`Res > B_tok` → `RATE_REQUEST_EXCEEDS_BUDGET` with zero commits. `Res` is the
reservation charged from commit until settlement. It is heuristic; provider-side
TPM compliance is not guaranteed.

### 11.3 Usage normalization

| Provider | Required | Optional (absent = 0) | Consistency | `U` |
|---|---|---|---|---|
| Groq `usage` | `prompt_tokens`, `completion_tokens`, `total_tokens` | — | `total ≥ prompt + completion` | `total_tokens` |
| Gemini `usageMetadata` | `promptTokenCount`, `totalTokenCount` | `candidatesTokenCount`, `thoughtsTokenCount`, `toolUsePromptTokenCount` | `total ≥ prompt + candidates + thoughts + toolUse` | `totalTokenCount` |

Every field used is an integer in `[0, U_MAX]`. The normalizer performs a fixed
set of own-property reads on a `JSON.parse` product, never iterates unknown keys,
never stringifies, and maps any throw to `MALFORMED`. It stores only `{class, U}`.

### 11.4 Charge rule

| Usage class | Final `charged` | Effect |
|---|---|---|
| `VALID(U)` | `max(Res, U)` whether content is present or absent | none from accounting |
| `MISSING` | `B_tok` | none |
| `MALFORMED` | `B_tok` | sticky `RATE_ACCOUNTING_INVALID` (PD-R12-I1), even if content is present |
| `UNAVAILABLE` (non-2xx, 3xx, read failure, network error, timeout, abort, uncertain completion) | `B_tok` | none |

`charged ≥ Res` always. `charged > B_tok` is possible for `VALID(U)` with
`U > B_tok` and is recorded unclamped; it blocks token admission until expiry.

Reviewer counterexample (R3-ARCH-01, preserved): `Res = 3 400`, `B_tok = 6 800`,
2xx, usage `{100, 6 900, 7 000}`, content absent → `charged = 7 000`; the child
receives `provider-error INVALID_RESPONSE` (not retryable).

### 11.5 Saturation, expiry, no double charge, no hidden refund

- Every commit creates exactly one entry. Refusals create none. There is no
  "not invoked" entry class in C5: commit and send are one step (§8.4).
- `charged` is set to `Res` at commit (reservation) and replaced exactly once at
  settlement by the §11.4 value, which is `≥ Res`. It never changes afterwards.
- An entry is never removed while live. It expires at `tSettle + W_HOLD` for both
  ledgers. Saturation (`B_tok`) affects only this session's token ledger.
- A retry is always a new IPC request, a new admission and a new entry.
- `W` never decreases. No refund of reservation, charge or wait exists.

### 11.6 Settlement procedure and precedence

```text
settleExchange(e, outcome):                            // runs once per commit
  s = classify(outcome)                                // axes A–E (§11.1)
  e.tSettle = now()
  e.charged = s.usage == VALID ? max(e.res, s.U) : B_tok
  applyHintsAndCooldown(s)                             // from status and frozen rate headers only
  if revoked:                 return CANCELLED          // child is being settled; no reply
  if s.usage == MALFORMED:    return refuse(RATE_ACCOUNTING_INVALID)
  if s.transport == RESPONSE and s.http == 2xx and s.content == PRESENT:
                              return {outcome:"content", content}
  return {outcome:"provider-error", code, retryable} = adapter.mapFailure(s)   // §12
```

Precedence: **revocation > malformed-usage refusal > provider outcome**. Accounting
runs before every branch, including revocation (§9.3, §13.7).

---

## 12. Provider mapping and retry ownership (R2-ARCH-05 preserved)

The adapter reuses the existing provider mapping functions. The governed child
therefore sees the same `{code, retryable}` it would see from its own provider today.

| Condition | Groq | Gemini | Usage class | Gateway action |
|---|---|---|---|---|
| HTTP 408 | `TIMEOUT` ✓ | `UNKNOWN` ✗ | UNAVAILABLE | none |
| HTTP 429 | `RATE_LIMIT` ✓ | `RATE_LIMIT` ✓ | UNAVAILABLE | cooldown; `RA > 65 s` → `exhausted` |
| HTTP 421 | `UNKNOWN` ✗ | `UNKNOWN` ✗ | UNAVAILABLE | single send (TS-1); no transport retry |
| HTTP 3xx (never followed) | `UNKNOWN` ✗ | `UNKNOWN` ✗ | UNAVAILABLE | none |
| HTTP 401 / 403 | `AUTH` ✗ | `AUTH` ✗ | UNAVAILABLE | none |
| Other 4xx | `UNKNOWN` ✗ | `UNKNOWN` ✗ | UNAVAILABLE | none |
| HTTP 5xx | `UNKNOWN` ✓ | `UNKNOWN` ✓ | UNAVAILABLE | none |
| Network error | `NETWORK` ✓ | `NETWORK` ✓ | UNAVAILABLE | none |
| `T_REQ` timeout (connect, headers or body) | `TIMEOUT` ✓ | `TIMEOUT` ✓ | UNAVAILABLE | none |
| Body oversize / not JSON | `INVALID_RESPONSE` ✗ | same | UNAVAILABLE | none |
| 2xx parsed, content absent | `INVALID_RESPONSE` ✗ | same | by usage | §11.6 |
| 2xx, content invalid for the model contract | content returned; generator correction retry | same | by usage | none |
| Revocation (SEC-C1 or settlement) | child: certified cancellation `UNKNOWN` ✗ | same | UNAVAILABLE if sent | no reply / `REVOKED` |
| Governor refusal | `RATE_*` / `STAGE_TIMEOUT` ✗, sticky | same | no entry | §15 |
| `BUSY`, `INVALID_REQUEST` | child: `UNKNOWN` ✗ | same | no entry | none |

Retry ownership: generators keep their two attempts (PD-R1 open). The Gateway and
the transport make **zero** retries. Each attempt is a separate IPC request and a
separate admission. Since 3xx and 421 map to non-retryable errors, they never
trigger attempt 2.

---

## 13. Revocation, Property A, Property B and SEC-C1

### 13.1 Revocation authority and triggers

Only the parent revokes. `session.revoke(reason)` is called synchronously by the
supervisor as the **first** action on each of:

| Trigger | Where |
|---|---|
| Valid FT0 `result` stored | §7.5 (the child declared completion) |
| Kill decision (watchdog or enforcement) | §14.4 step 1 |
| Child `disconnect` (IPC loss seen by the parent) | §7.5 |
| Child `exit`, `close` or spawn `error` | §7.5 |
| Parent settlement of the stage (any path) | §14.6 |

Parent process death (including native signal termination, PD-R6) destroys the
session with the process. No Gateway can dispatch after its process has ended.
(C6) Parent death also triggers the kernel-backed parent-death path of the
containment (§27.6). C6 also requests worker termination (§27.2) on every trigger
above other than a stored result, and on the result path when the worker does not
exit by itself (§27.8).

### 13.2 Revocation procedure

```text
revoke(reason):
  if revoked: return                 // idempotent
  revoked = true                     // first statement, synchronous
  if active: active.controller.abort()   // ends a sleep (charged, §9.3) or destroys an in-flight request (TS-4)
```

A session is never un-revoked. A later stage gets a new session with a new origin.

### 13.3 Property A

> **Property A.** After `session.revoke()` returns, the session makes no new
> `transport.send()` call. (Equivalently: no authorized Gateway dispatch after
> parent revocation.)

Design argument (P Lemma 4): `transport.send()` is called only from `commit()`,
which checks `revoked` after its final reading with no `await` before the call.
`revoke()` runs to completion in one turn. Either `revoke()` runs before that
check (the check refuses) or after `send()` was entered (that send was authorized
before revocation and is now aborted, best effort). Every other path re-checks
`revoked` after each `await`. The transport object and credential are private to
the session.

Status: **SPIKE_VERIFIED** in prototype scope (spike G4, G9, G11, G12, P5, P7,
P9, P12, GWV01-7). **DESIGNED** for production. Integrated production evidence:
**OPEN** (M §12).

### 13.4 Property B

> **Property B.** A surviving or compromised child has no arbitrary direct
> network access.

**C5: NOT PROVIDED.** The Gateway does not and cannot provide it. A child that is an
ordinary Node process of the same OS user can load `node:http`, `node:https`,
`node:net` or any file from disk and connect anywhere the user can. Spike P12
measured an abandoned child making **53 (Windows) / 55 (Linux)** unauthenticated
direct HTTP requests while the Gateway made zero. Property A does **not** imply
Property B.

**C6: DESIGNED (candidate) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN.** C6 places
the worker in an OS containment with no usable network path (§28.2). That design
gives Property B with this **scope**: no direct network access from any process of
the contained worker tree, to the provider or anywhere else. The scope does **not**
cover (a) other processes of the same OS user outside the containment, (b) covert
channels through OS broker services that the containment leaves reachable, which
are qualification items HQ-L-09 and HQ-W-09, or (c) kernel or sandbox escapes.
Property A still does not imply Property B; B rests on the containment alone. It
is **not** shown on any host (§30.1).

### 13.5 Scenario analysis (C6: with containment, on a qualified host)

All C6 entries are **DESIGNED, HOST_NOT_VERIFIED** (§30). The C5 column values are
kept in brackets where C6 changes them.

| Scenario | Gateway dispatch (A) | Credentialed provider call by the worker | Direct network by the worker (B) | Worker termination (C6) |
|---|---|---|---|---|
| Normal completion | stops at revocation on result | impossible (no credential) | no network path (§28.2) [C5: possible if compromised] | worker exit, then containment emptied and confirmed before acceptance (§27.8, PT-15) |
| Parent IPC loss (parent alive, channel broken) | revoked at the parent's `disconnect` event | impossible | no network path | termination requested at once; confirmed by containment emptiness (§27.2) |
| Parent process dies | no Gateway exists | impossible | no network path | kernel-backed parent-death path (§27.6); confirmation impossible after the parent is gone (PT-18) |
| Delayed IPC disconnect | revoked at the parent's decision, before disconnect | impossible | no network path | as the trigger that revoked |
| Worker ignores cancellation / kill not honored | revoked first | impossible | no network path [C5: **possible**] | containment termination does not need worker cooperation (§27.2); unresolved → `CLEANUP_UNRESOLVED`, never "terminated" (PT-16, PT-21) |
| Descendants survive the leader's exit | — | impossible | no network path | descendants are members of the containment; emptiness is required (PT-19) |
| Worker blocked in synchronous computation | revoked by the watchdog decision (governed) | impossible | no network path | as "ignores cancellation" |
| Compromised worker | revoked; IPC requests validated and refused | **designed out**: no credential in its environment, no view of the parent's process, no credential files in its filesystem view (§28.3) [C5: **not prevented**] | **designed out** [C5: **possible**] | as "ignores cancellation" |
| Containment cannot be created | — (no worker) | — | — | provider-backed execution refused before any credential use (§26.3, PT-20) |

**Parent-owned credentials versus arbitrary network permission.** Moving the
credential out of the child's environment and IPC removes it from the child's
normal reach and from every artifact the child produces. **That alone does not
confine the credential against a compromised same-user process, and it does not
restrict network access** (C5, unchanged). C6 does not claim credential confinement
from environment hygiene. It claims it only from the containment's process,
filesystem and network isolation (§28.3). That claim is a candidate design and is
not verified (SG-03 stays open).

### 13.6 SEC-C1 reconciliation (mandatory Security gate, AD-02)

SEC-C1 (PO-GH): "Parent IPC disconnection must abort pending waits and in-flight
provider requests. No subsequent provider calls may be initiated. The child must
terminate."

| Clause | C6 mechanism (both modes) | Status |
|---|---|---|
| Abort pending waits | Gateway waits live in the parent; `revoke()` aborts them (§13.2). The worker has no governor waits. Pass-through mode has no waits. | DESIGNED · ALGORITHMICALLY_PROVEN (P Lemma 4) · SPIKE_VERIFIED (prototype) |
| Abort in-flight provider requests | `revoke()` aborts the in-flight request: governed via TS-4, pass-through via the certified provider's cancel signal (§25.3). The worker's pending IPC call rejects through the certified cancel signal. Abort cannot undo a transmitted request (§13.7). | DESIGNED · ALGORITHMICALLY_PROVEN · SPIKE_VERIFIED (governed transport, loopback) |
| No subsequent provider calls initiated | **Authorized** calls: Property A (§13.3) in both modes. **Direct provider calls (bypass)**: the worker has no credential (§28.3) **and** no network path (§28.2). These are two independent barriers (SEC-D2). | A: DESIGNED · ALGORITHMICALLY_PROVEN. Bypass barriers: DESIGNED · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN |
| Child must terminate | The certified child self-exit is kept (cooperative path). **Worker-independent termination**: the parent requests termination of the whole containment, which needs no worker cooperation, and accepts only OS-observable emptiness as proof (§27.2). On parent death, the kernel-backed lifetime binding ends the containment (§27.6). An unresolved termination is reported `CLEANUP_UNRESOLVED`, fails closed and is never counted as terminated (§27.7). | DESIGNED · ALGORITHMICALLY_PROVEN (state machine, conditional on host assumptions) · HOST_NOT_VERIFIED · SECURITY_GATE_OPEN |
| Disabled governor (PD-R14) | The same mechanisms in pass-through mode (PD-C6-1, §25). | DESIGNED |

**SG01-SEC-01 disposition (C6).** C5 explicitly gave no termination guarantee for a
non-cooperative child. It relied on K_SETTLE abandonment and left Property B
unprovided. The Security finding found that incompatible with SEC-C1. C6 replaces
that with the containment design of §27 and §28:

- termination is requested by the parent, does not need the worker, and is
  confirmed only by OS-observable emptiness;
- parent death ends the containment through kernel-backed mechanisms;
- the worker has no credential and no network, in both modes.

`K_SETTLE` remains only the parent's settlement bound (PD-C6-5). When it expires
without confirmed emptiness, the outcome is `CLEANUP_UNRESOLVED`. It is never
"terminated" or "abandoned and done".

The design satisfies SEC-C1 **on a qualified host, conditional on the host
assumptions `H-L…` / `H-W…`**, which are open qualification gates (§30.2). On every
other host, provider-backed execution is refused (§26). This is an **author design
disposition**. SG-01 stays **SECURITY_GATE_OPEN** until the independent Security
review accepts the design and the qualification gates pass. No waiver is requested
or assumed.

### 13.7 Abort is not rollback

Once `transport.send()` has been entered, the request may already be on the wire
or processed remotely. Revocation and abort end local activity and suppress any
reply, but cannot retract the request, its remote processing, or any provider-side
charge. The exchange is recorded as uncertain completion and charged `B_tok`
(§11.4). This applies equally to the certified FT0 path, and to pass-through mode
(no charge is kept there, §25).

---

## 14. Process lifecycle and FT0 compatibility (DRIFT-02; AD-07)

### 14.1 Unchanged FT0 behavior

On every path, governed or not, these stay exactly as certified:

- Receipt and ACK: the child sends its result with a fresh random receipt; the
  parent stores the **first** result in memory, then ACKs the matching receipt.
  Only that ACK counts as delivery, even if it overtakes the send callback.
- Child result transfer: `running → sending → awaiting_ack → delivered | failed`;
  missing ACK within `ACK`, a send error or parent loss → child exit 1.
- Close-based settlement; `CAE` recovery after `exit` without `close` (FT0-C2-D1)
  with `result = null`.
- Exit failure semantics: accept only `result.ok === true && exitCode === 0` after
  `close` (generative.js L83). A result followed by a nonzero exit or a signal is
  not accepted.
- Native signal handling: no handler is added; PD-R6 holds.
- Exactly-once settlement via the certified `settled` guard; late events ignored.
- Ungoverned paths: INV-G13 as amended (§3.2, §25.4).
- (C6) The parent's direct child process is the **launcher** (§27.3). FT0 `exit`,
  `close` and `CAE` refer to the launcher process. A launcher exits only after its
  containment is empty (or after reporting `cleanup-unresolved`). Its exit code
  equals the worker's exit code (§27.3 LC-5). The FT0 rules therefore keep their
  meaning: "exit 0 then close" still means that the worker exited 0, and in C6 it
  also means the containment was confirmed empty first.

### 14.2 Governed additions

| Addition | Rule |
|---|---|
| Payload marker | `gateway: {v:1}`; closed; invalid → `STAGE_PAYLOAD_INVALID` (existing) |
| Heartbeat | child sends `{type:"heartbeat", v:1, seq}` from payload receipt, then every `HB`; cleared at `report()` and in FT0 `fail()`; send errors ignored |
| Watchdog | parent timer `WD` from `tOpen`; re-armed by valid heartbeats while no result is stored; disarmed when a result is stored |
| Enforcement | parent timer at `enforceAt = tOpen + K_PARENT`, armed until settlement |
| Revocation hooks | §13.1 |

The child has no governor timer, deadline timer or new abort source.

### 14.3 Parent message handling

```text
on message m:
  if killed: (provider-request → reply REVOKED if connected); return
  heartbeat (valid) and result === null:  re-arm watchdog
  provider-request (valid):               session.onRequest (§8.3)
  result (FT0):                           session.revoke("result"); store first result; ACK; disarm watchdog
  else:                                   ignore
```

### 14.4 Kill decision (C6: termination decision)

A **termination decision** is taken by the governed watchdog or enforcement timer
when it fires before settlement. In C6 it is also taken, in both modes, on the
SEC-C1 triggers of §27.2 (parent-observed IPC loss without a stored result, and
launcher or status-channel faults):

1. `session.revoke(reason)` (synchronous, first).
2. `killed = {reason}`, where the reason is `STAGE_TIMEOUT`, `CHILD_UNRESPONSIVE`,
   or (C6) the private `IPC_LOST` or `LAUNCHER_FAULT`. The first reason wins and is
   sticky.
3. `result = null`: a stored or ACKed result is discarded.
4. Disarm watchdog and enforcement timers (governed).
5. **(C6) Request containment termination** through the platform's
   worker-independent mechanism (§27.4.3, §27.5.3). Set the containment state to
   `TERMINATION_REQUESTED`. The C5 step `child.kill("SIGKILL")` on the stage child
   is **replaced**: signalling the launcher alone would lose the emptiness
   confirmation (§27.4.3).
6. Arm the `K_SETTLE` timer (§14.5).

The parent does **not** disconnect IPC at the termination decision. On Windows a
parent-side `disconnect()` can prevent `close` from firing, which would turn every
kill into a `CAE`-delayed settlement (C4 NDI-12). Property A does not depend on
disconnect: revocation is step 1.

### 14.5 Post-termination settlement (`K_SETTLE = 10 000 ms`, APPROVED; C6 corrective of C5-ARCH-02)

Phase K starts at the termination decision `tKill` (§14.4) and ends at the
**first** of these events. Settlement is **event-driven** and may occur
immediately. `CAE` and `K_SETTLE` are **fallbacks** only.

| Event (launcher process, §27.3) | Next |
|---|---|
| `exit` | clear `K_SETTLE`; FT0 phase S: settle at `close`, or at the first `CAE` callback at or after `tExit + CAE` if `close` has not arrived |
| `close` | settle **at once** (result already discarded) |
| spawn `error` | settle at once |
| first `K_SETTLE` callback at or after `tKill + K_SETTLE`, no `exit` observed | **unresolved settlement** (C6; replaces C5 "abandonment") |

At every settlement in phase K, the containment state (§27.2) decides the
classification. With `CONTAINMENT_EMPTY` it is `killed.reason`, mapped as in §15.3.
In every other state it is `CLEANUP_UNRESOLVED` → candidate
`WORKER_TERMINATION_UNCONFIRMED` (§29). Settlement by `close` after the launcher's
exit normally finds `CONTAINMENT_EMPTY`, because the launcher exits only after it
reported emptiness (§27.3 LC-4, LC-5).

Unresolved settlement (one-shot, then `settled = true`):

1. If `child.connected`, `child.disconnect()` inside `try`. **Nothing depends on
   this for Property A**: the session was revoked at `tKill`, and any request that
   still arrives is refused.
2. (C6) Close the parent's ends of the launcher control channel (Windows), which
   prompts the launcher to terminate its containment again (§27.5.3). Destroy the
   launcher's stdout, stderr and status streams.
3. `child.unref()` on the launcher, so that the CLI process can end. Ending the CLI
   triggers the kernel-backed parent-death path of §27.6. That is a further
   **unconfirmed** cleanup attempt, never counted as termination.
4. Clear every timer of the stage (watchdog, enforcement, `K_SETTLE`, `CAE`).
5. Settle once: `result = null`, containment state `CLEANUP_UNRESOLVED`; no commit.
6. One stderr line (fixed template, C6; replaces the C5 abandonment line):
   `[qa-agent] <stage> process termination could not be confirmed within 10s (launcher pid <n>); provider access was revoked; processes may still be running.`
7. Late `exit`, `close`, status records and messages are ignored (`settled` guard).
   Their content is not used to change the settled outcome.

Bound (**INV-G18**, corrected in C6; parent clock):

- **No lower bound** beyond `tKill`. Settlement may happen at the first `close` or
  spawn `error` event after `tKill`, however early.
- **Upper bound.** If the launcher's `exit` is observed at `tExit < tKill + K_SETTLE`,
  settlement occurs at `close`, or at the first `CAE` callback at or after
  `tExit + CAE`. Otherwise it occurs at the first `K_SETTLE` callback at or after
  `tKill + K_SETTLE`. Settlement therefore occurs no later than the first such
  callback at or after `tKill + K_SETTLE + CAE` (20 000 ms), plus timer lateness.
- Required trace (P PT-14): kill decision at 0, launcher `exit` at 3, `close` at 5
  → **settlement at 5**. C5's statement that settlement is decided "at or after
  `tKill + K_SETTLE` … or `tExit + CAE`" was wrong for this trace and is withdrawn.

`K_SETTLE` is **only the parent's settlement bound** (PD-C6-5). Its expiry is not
evidence of termination. It bounds a phase, not the whole CLI (§17).

### 14.6 Result acceptance and separated mechanisms

Acceptance rule (unchanged FT0, plus the C4 kill discard, plus the C6 containment
condition): commit only if a result is stored, `exitCode === 0`, `killed === null`,
settlement was by `close`, **and the containment state is `CONTAINMENT_EMPTY`**
(**INV-G12**). There is **no** time-based acceptance grace, and the parent never
requests termination on the successful path. The launcher purges descendants after
the worker's own exit (§27.8), which is containment hygiene and not a parent kill.
A governed child that stores a result but never exits is ended by the enforcement
timer, and its result is discarded. In ungoverned mode such a child waits, as in
the baseline (PD-R13), unless an SEC-C1 trigger of §27.2 fires.

These mechanisms stay separate and never substitute for each other:

| Mechanism | Trigger | Effect |
|---|---|---|
| Ordinary successful-result acceptance | `result` + `exit 0` + `close` | validate and commit |
| Gateway dispatch deadline | `t2 >= dispatchDeadline` | refuse dispatch (`STAGE_TIMEOUT`) |
| Stage enforcement | callback at or after `enforceAt` | kill decision, `STAGE_TIMEOUT` (6) |
| Watchdog termination | no valid heartbeat for `WD` before a result | kill decision, `CHILD_UNRESPONSIVE` (1) |
| Post-termination `K_SETTLE` (both modes, C6) | no launcher `exit` within `K_SETTLE` after a termination decision | unresolved settlement (`CLEANUP_UNRESOLVED`) |
| Containment confirmation (C6) | launcher status `containment-empty` | precondition of acceptance and of a resolved settlement |
| FT0 `CLOSE_AFTER_EXIT` recovery | `exit` without `close` for `CAE` | settle with `result = null` |
| Parent finalization | settlement | classification (§15.3); validation and commit only on acceptance |

### 14.7 Platform differences

| Aspect | POSIX | Windows |
|---|---|---|
| Kill | SIGKILL; uncatchable; no further user-mode code once delivered | `TerminateProcess`; no further user-mode code once termination begins |
| Ignorable termination | SIGTERM can be ignored (spike P12 used it); C5 uses SIGKILL | cannot be ignored; "kill not delivered" exists only as a fault (spike simulated it with a no-op hook) |
| Kill → `exit` latency | unbounded in uninterruptible I/O | unbounded while pending I/O drains |
| `close` after `exit` | normally prompt | may never arrive with unread IPC data (FT0-C2-D1); `CAE` handles it |
| Parent-side `disconnect()` | `close` follows | `close` may not fire; hence none at the kill decision |
| After the CLI exits | C5: an unreaped child is reparented and reaped. **C6:** the launcher's parent-death signal and the PID-namespace teardown end the containment (§27.4.5; HQ-L-05) | C5: libuv job object closure expected. **C6:** the helper's Job Object handle closes and `KILL_ON_JOB_CLOSE` applies (§27.5.5; HQ-W-05, HQ-W-06) |
| Credential exposure to a same-user child | C5: `/proc/<ppid>/environ` readable subject to ptrace access checks. **C6:** the worker sees only its own PID namespace (§28.3; HQ-L-07) | C5: process memory readable at equal integrity. **C6:** an AppContainer token has no access to the parent's process object (§28.3; HQ-W-08) |
| Timer granularity | ≈ 1 ms | ≈ 15.6 ms by default |
| Spike runtime | Node 22.23.3 (WSL2) | Node 24.22.1 — **outside `engines` 22.x**; Windows on Node 22.x is unverified |

---

## 15. Failure propagation and error precedence (R2-ARCH-02 preserved)

### 15.1 Child-side stage context

The C4 §11 machinery is retained in the child, with the Gateway client as the
governor's local proxy:

- `StageContext {stage, stepSeq, step, calls, terminal, refusals, cancelled}`,
  created by the runner on the governed path only; `beginStep(label)` before every
  generator invocation.
- The client increments `ctx.calls` per `analyze()` and, on a governor refusal,
  sets `ctx.terminal = {code, stepSeq, step, callOrdinal}` once and registers the
  thrown error object in `ctx.refusals` (identity, `WeakSet`).
- `classifyReturn` and `classifyThrow` (E1 identity-matched rethrow, E2 unrelated
  exception after a refusal, E3 unchanged baseline) are exactly as C4 §11.3. R4
  found this path RESOLVED_BY_DESIGN.
- Child failure shapes: `{kind:"generation", step, providerAttempts ≥ 1, codes}`,
  `{kind:"stage-timeout", step, providerAttempts ≥ 1}`,
  `{kind:"internal", code:"GENERATIVE_STAGE_FAILED", governorCode}` (E2), baseline
  shapes otherwise.

### 15.2 Parent-authoritative terminal

The parent knows exactly which governor refusal its session issued
(`session.terminal`). The child's report is used only for the step and the
per-step attempt count.

- A governor code in the child's report that the session did not issue is
  removed. The child cannot introduce a governor code.
- `kind:"stage-timeout"` without `session.terminal.code === STAGE_TIMEOUT` is an
  invariant violation → `STAGE_FAILED` (1).
- When `session.terminal` is set and the child's `providerAttempts` is not a
  positive integer, the parent does not synthesize a count; it classifies
  `STAGE_FAILED` (1) (invariant violation). It never falls into the exit-4 rule.

### 15.3 Parent classification and precedence (highest first)

| # | Outcome | CLI result |
|---|---|---|
| 1 | Parent's own native signal termination | process ends natively (PD-R6); no classification |
| 2 | Pre-spawn failure: config, `PROVIDER_GOVERNOR_LIMITS_MISSING`, provider configuration | existing exit 3 codes |
| 2a | (C6) Host unsupported or unqualified (§26), or launcher setup failed before the worker ran (§27.3 LC-2) | **proposed** `HOST_ISOLATION_UNAVAILABLE`, exit 5. Pending authorization (§29) |
| 3 | Spawn `error` | `STAGE_SPAWN_FAILED` (1), existing |
| 3a | (C6) Containment state `CLEANUP_UNRESOLVED` at settlement, whatever the termination reason | **proposed** `WORKER_TERMINATION_UNCONFIRMED`, exit 1. The kill reason is appended to the message only. Pending authorization (§29) |
| 4 | Kill by enforcement, containment empty | `STAGE_TIMEOUT` (6); result discarded |
| 5 | Kill by watchdog, containment empty | `CHILD_UNRESPONSIVE` (1); result discarded |
| 5a | (C6) Termination for the private reasons `IPC_LOST` or `LAUNCHER_FAULT`, containment empty | `STAGE_FAILED` (1), existing. Baseline outcome for "no result" |
| 6 | Accepted result (INV-G12) | existing validation and commit |
| 7 | `session.terminal = STAGE_TIMEOUT`, child report generation/stage-timeout/E1 | `STAGE_TIMEOUT` (6) |
| 8 | `session.terminal = RATE_*`, child report generation/E1 | `PROVIDER_FAILURE` (6), governor code first, then the child's sanitized codes |
| 9 | `session.terminal` set, child internal failure (E2) | `STAGE_FAILED` (1), message adds "(governor reason code: X)" |
| 10 | Invariant violations of §15.2 | `STAGE_FAILED` (1) |
| 11 | No terminal: existing child failure classification | unchanged (incl. exit 4 when attempts 0) |
| 12 | No result, nonzero exit, signal, `CAE` recovery, SEC-C1 child exit | `STAGE_FAILED` (1), existing |

### 15.4 Private field mapping (spike and IPC names)

| Name | Origin | Production treatment | Public? |
|---|---|---|---|
| `BUSY` | spike, AD-06 | private refusal; child `UNKNOWN` ✗; private counter | **No** |
| `REVOKED`, `REVOKED_IN_FLIGHT` | spike | private; settlement precedence decides the outcome | **No** |
| `INVALID_REQUEST` (spike `rejected`, `DUPLICATE_ID`) | spike | private refusal; child `UNKNOWN` ✗ | **No** |
| `DEADLINE` | spike | `STAGE_TIMEOUT` via `session.terminal` | as `STAGE_TIMEOUT` (§16) |
| `WAIT_BUDGET`, `WAIT_BUDGET_EXCEEDED_AFTER_WAIT`, `RATE_WINDOW` | spike | `RATE_BUDGET_EXHAUSTED` | as `RATE_BUDGET_EXHAUSTED` |
| `PREPARE_FAILED` | spike | not applicable (no prepare hook); a request-build exception → `UNKNOWN` ✗ | **No** |
| `child_failed` + `resultRejection: NONZERO_EXIT \| SIGNAL` | spike C1 | existing FT0 path: no acceptance → `STAGE_FAILED` (1) | **No** new field |
| `resultRejection: KILLED \| NOT_EXITED` | spike C1 | `killed.reason` (rows 4–5) | **No** new field |
| `completed`, `child_exited`, `timeout` reasons; trace events | spike | not emitted | **No** |
| `maybeReachedRemote` | spike | internal → `UNAVAILABLE`, charge `B_tok` | **No** |
| `GRACEFUL_EXIT_MS = 300` | spike | **not carried** (AD-07) | — |
| `stage-timeout`, `governorCode`, `heartbeat`, `provider-*` | C4/C5 private IPC | parent-only, validated, closed | **No** |
| `PROCESS_RUNNING`, `TERMINATION_REQUESTED`, `PROCESS_EXIT_OBSERVED`, `CONTAINMENT_EMPTY`, `CLEANUP_UNRESOLVED` | C6 containment states (§27.2) | parent memory only; mapped by §27.2.3 | **No** (not approved public status strings) |
| `IPC_LOST`, `LAUNCHER_FAULT` | C6 private termination reasons (§14.4) | mapped to existing `STAGE_FAILED` (1) or to the candidate `WORKER_TERMINATION_UNCONFIRMED` | **No** |
| launcher records `ready`, `worker-exit`, `termination-delivered`, `containment-empty`, `cleanup-unresolved`, `setup-failed` | C6 launcher status channel (§27.3) | parent-only, validated, closed | **No** |
| spike / smoke `cause:"control_eof"`, helper `ev` names | host-feasibility smoke | not carried | **No** |

## 16. Public reason codes (PD-R8; unchanged from C4)

| Code | Where | Origin | Exit | Reachable when |
|---|---|---|---:|---|
| `RATE_REQUEST_EXCEEDS_BUDGET` | reason code in `PROVIDER_FAILURE` | `Res > B_tok` | 6 | governed |
| `RATE_BUDGET_EXHAUSTED` | reason code in `PROVIDER_FAILURE` | budget, per-wait cap, iteration cap, over-cap 429 hint | 6 | governed |
| `RATE_ACCOUNTING_INVALID` | reason code in `PROVIDER_FAILURE` | malformed usage (PD-R12-I1); clock regression | 6 | governed |
| `STAGE_TIMEOUT` | top-level `errors[].code` | dispatch deadline; enforcement kill | 6 | governed |
| `CHILD_UNRESPONSIVE` | top-level `errors[].code` | watchdog kill | 1 | governed |
| `PROVIDER_GOVERNOR_LIMITS_MISSING` | top-level `errors[].code` | enabled, no limits for the effective provider | 3 | v2 enabled |

No other code is added by the C5 design contract. None of the six is reachable
with v1 or a disabled governor. These codes still need the separate canonical
contract amendment (§20).

(C6) The two PD-C6-4 **candidate** reasons are listed in §29 with their proposed
mappings. Unlike the rows above, they are reachable in **both** modes. They are
**not** part of this table, and neither is authorized: the design direction is
approved, but the canonical amendment is not.

## 17. Deadline and termination phases (D+15 A)

| Phase | Clock / origin | Boundary | On violation |
|---|---|---|---|
| G1 — admission | parent, `tOpen` | commit only at `t2 < tOpen + D_DISPATCH` | `STAGE_TIMEOUT` |
| G2 — exchange | parent transport timer | aborted at the first callback at or after commit + `T_REQ` | provider `TIMEOUT` |
| W — wait | parent `W` | `W ≤ W_BUDGET` at every commit | `RATE_BUDGET_EXHAUSTED` |
| C — child computation | child | not bounded by the Gateway; liveness via heartbeat | phase H |
| H — heartbeat liveness | parent | silence `< WD` while no result is stored | kill, `CHILD_UNRESPONSIVE` (1) |
| E — enforcement | parent, `tOpen` | first callback at or after `tOpen + K_PARENT` | kill, `STAGE_TIMEOUT` (6) |
| A — result transfer | child | ACK within `ACK` (FT0) | child exit 1 |
| L — launcher setup (C6, both modes) | launcher | `ready` record before any provider request is served; not time-bounded by the parent before `ready` (open item, §31.3 Q-C6-5) | `setup-failed` → refusal, `HOST_ISOLATION_UNAVAILABLE` (proposed) |
| K — post-termination (C6, both modes) | parent, `tKill` | event-driven: `close` / `error` at once; `exit` → phase S; fallback `K_SETTLE` at or after `tKill + K_SETTLE` | unresolved settlement (`CLEANUP_UNRESOLVED`) |
| S — settlement | parent, `tExit` | `close`, or `CAE` after `exit` (FT0) | settle with `result = null` |
| V — validation and commit | parent | not bounded | existing errors |

Statements that hold (algorithmic): no governed transport invocation at a parent
reading `>= tOpen + 1 770 000`; no governed sleep starts when its fresh pre-sleep
reading `a` satisfies `a + planned >= tOpen + 1 770 000` (C6); kill decision at the
first callback at or after `tOpen + 1 815 000`. (C6) After a termination decision,
settlement happens at the **first** of: `close`, spawn `error`, the first `CAE`
callback at or after `tExit + CAE`, or the first `K_SETTLE` callback at or after
`tKill + K_SETTLE` when no `exit` was seen. It therefore happens no later than the
first such callback at or after `tKill + K_SETTLE + CAE`, and it may happen
immediately. No acceptance happens without `CONTAINMENT_EMPTY`.

Statements that do **not** hold: "the CLI settles by 1 815 s"; "no HTTP bytes leave
after 1 770 s" (wire timing is not observable); "the 900 s budget binds before the
deadline"; any punctual timer. (C6) "Settlement after a kill happens no earlier than
`tKill + K_SETTLE` or `tExit + CAE`" (withdrawn; C5-ARCH-02). "`K_SETTLE` expiry
means the worker terminated." "A termination request means the worker terminated."

## 18. Invariants

| ID | Invariant |
|---|---|
| INV-G01 | Every transport invocation happens at a COMMIT whose final reading satisfies not-revoked, `t2 < dispatchDeadline`, `W ≤ W_BUDGET` and all ledger, cold-start, cooldown and hint predicates (§8.4). |
| INV-G02 | At most one active request per session; a concurrent request is refused `BUSY` without queueing or any accounting effect (§8.5). |
| INV-G03 | Any half-open 65 s interval holds at most `B_req` and at most `floor(B_tok / Res_min)` commits (P Lemma 6). |
| INV-G04 | One entry per commit; `charged ∈ {max(Res, U), B_tok}`, set once at settlement, `≥ Res`; never removed while live (§11.5). |
| INV-G05 | `W` starts at `C_COLD`, changes only by `chargeable()` after a sleep, never decreases, and is `≤ W_BUDGET` at every commit (§9.1). |
| INV-G06 | (C6) No commit at a final reading `t2 >= dispatchDeadline`. No sleep is started unless its **fresh** pre-sleep reading `a`, taken after all synchronous planning work and followed only by the pre-sleep comparisons and the timer arming, satisfies `a < dispatchDeadline`, `a + planned < dispatchDeadline` and `W + chargeable(a, a + planned) ≤ W_BUDGET` (§8.3, §9.2; C5-ARCH-01). |
| INV-G07 | No commit before `coldUntil`. |
| INV-G08 | Zero Gateway and transport retries; at most one transport invocation per commit; under TS at most one HTTP request per invocation (§10.1). |
| INV-G09 | The first governor refusal is sticky in the session; afterwards every request is refused with that code and zero commits. |
| INV-G10 | **Property A:** after `revoke()` returns, zero `transport.send()` calls in that session (§13.3). |
| INV-G11 | A governor refusal reaches the envelope on the return and unwind paths as primary classification or as `governorCode` (E2), unless a higher-precedence outcome applies; the code comes from the parent's session record (§15.2). |
| INV-G12 | (C6) Commit only if a result is stored, `exitCode === 0`, `killed === null`, settlement was by `close`, and the containment state is `CONTAINMENT_EMPTY`. |
| INV-G13 | (C6, amended under PD-C6-1) v1 or disabled governor: no rate governance; certified provider request bytes and transport semantics; exit codes, reason codes, stdout and envelope equal to the baseline, except the enumerated differences D-1 … D-4 (§25.4); SEC-C1 protection (revocation, credential custody, containment) present (PD-R14). |
| INV-G14 | No credential, model name, URL, header, raw usage, raw provider message or body other than validated `content` crosses IPC; none reaches logs or the envelope. |
| INV-G15 | Hints only tighten; invalid hints are ignored. |
| INV-G16 | All accounting arithmetic is exact (BigInt ns, integer tokens). |
| INV-G17 | Valid usage is charged `max(Res, U)` whether or not content is present; malformed usage always sets `RATE_ACCOUNTING_INVALID`. |
| INV-G18 | (C6, corrected; C5-ARCH-02) After a termination decision at `tKill`, the parent settles exactly once, at the **first** of: launcher `close`; spawn `error`; the first `CAE` callback at or after `tExit + CAE` when `exit` arrived without `close`; the first `K_SETTLE` callback at or after `tKill + K_SETTLE` when no `exit` was observed. Event-driven settlement may be immediate (kill 0, exit 3, close 5 → settlement 5). The upper bound is the first such callback at or after `tKill + K_SETTLE + CAE`. Every settlement in phase K discards the result. |
| INV-G19 | (C6) The containment state is `CONTAINMENT_EMPTY` only after an OS-observable emptiness record from the launcher (§27.2). A termination request, an observed leader exit, a `K_SETTLE` expiry, a launcher exit without that record, or parent-side assumptions never produce it. |
| INV-G20 | (C6) No provider request is served (governed or pass-through) while the containment state is not `PROCESS_RUNNING`, in particular before the launcher's `ready` record (§7.5, §27.3). |
| INV-G21 | (C6) Provider-backed execution starts only on a qualified host (§26). On any other host the refusal happens before spawn, before any provider request is built and before the credential is passed to any transport. |
| INV-G22 | (C6) The worker's environment, argv, IPC and filesystem view contain no provider credential, in both modes (§28.3). |
| INV-G23 | (C6) A settled outcome with containment state other than `CONTAINMENT_EMPTY` is never classified as a terminated or successful worker. It is `CLEANUP_UNRESOLVED` (§27.7). |
| INV-G24 | (C6) Ungoverned mode never applies admission, ledgers, cold start, wait, dispatch deadline, heartbeat, watchdog or enforcement (PD-R13), and always applies revocation, credential custody and containment (PD-R14, PD-C6-1). |

## 19. Non-guarantees

C6 does **not** guarantee:

1. **Property B** on any host before its qualification gates pass. B is designed as
   a candidate (§28.2); it is not shown anywhere. B never covers same-user processes
   outside the containment, OS-broker covert channels that qualification has not
   excluded, or kernel or sandbox escapes.
2. Credential confinement before SG-03 and its gates pass. It is a candidate design
   (§28.3) and is **not** claimed from environment hygiene alone.
3. Confirmed termination in every case. C6 guarantees only that an unconfirmed
   termination is reported as `CLEANUP_UNRESOLVED`, fails closed, and is never
   counted as terminated (§27.7). After parent death, termination is attempted by
   kernel-backed mechanisms and **cannot be confirmed** by anyone in the product
   (§27.6).
4. That an aborted, timed-out or abandoned request was not processed or charged remotely.
5. Compliance with any provider's TPM, RPM, RPD or TPD accounting (PD-R10); estimator accuracy; provider header meanings (PD-R9).
6. Isolation from other processes, earlier invocations or other tools on the account.
7. Timer punctuality, or any bound across system suspend.
8. The instant at which HTTP bytes leave the host after `transport.send()` is entered.
9. TS on real HTTPS before TQ-01 … TQ-10 pass; real provider behavior before PD-R9.
10. Parent validation and commit time (phase V), or whole-CLI settlement time.
11. That a healthy child is never killed by the watchdog if one synchronous segment
    or result transfer exceeds about 45 s without heartbeats.
12. Completion of any particular amount of work N.
13. (C6) That any host is qualified. Until §30 gates pass on a host class, that
    class refuses provider-backed execution (§26). **Today the qualified set is empty.**
14. (C6) Protection against a compromised launcher, a compromised parent, or a
    compromised OS. The launcher and parent are trusted computing base (§28.4).

## 20. Future implementation touchpoints (design only; not authorized)

| Area | Expected change |
|---|---|
| New internal modules (parent) | Gateway session (admission, ledgers, wait, deadline, revocation, accounting), single-send `https` transport, bounded stream reader, adapters, IPC schema. Package-surface inventory update and external install proof (C2:444). |
| New internal module (child) | `GatewayClientProvider`, heartbeat sender, `StageContext`. |
| `providers/groq-provider.js`, `gemini-provider.js` | Export the existing pure pieces (request build, `mapHttpError`, body-read and content mapping) for reuse by the adapters; ungoverned behavior byte-identical. |
| `cli/child-env.js` | (C6) Worker variant of `buildGenerativeEnv()` without `AI_SECRET_KEYS`, used in **both** modes. |
| `cli/generative-runner.js` | (C6) Gateway client provider in both modes, instead of `createProvider()`; governed mode from the payload marker: heartbeat, `StageContext`, `classifyReturn` / `classifyThrow`. |
| `cli/stage-process.js` | Routing, revocation hooks, (governed) watchdog and enforcement, (C6) containment state machine, launcher spawn and channels, termination request, `K_SETTLE` unresolved settlement. |
| `cli/generative.js` | Session open before spawn (governed or pass-through), adapter or provider construction, (C6) host qualification check, classification of §15.3, unconfirmed-termination diagnostic. |
| (C6) New internal module: host qualification and launcher integration | Host class detection, preflight (§26.2), Linux `bwrap` argv construction (§27.4), Windows helper invocation (§27.5), status-record validation (§27.3). |
| (C6) Native Windows helper | A separate native artifact (§27.5). Its build, signing, distribution and installation are **not designed or authorized** (PO-C6-3, §31.2). |
| `cli/run-artifacts.js` | `GOVERNOR_REASON_CODES` allowlist. |
| `cli/config-file.js` | Schema v2. |
| Contract docs | Canonical amendment for contract §10.7 reason codes and §11 schema v2 (separate). |
| Tests | Specifications in M §12, including owned-process audits based on observed exit status (spike GWV-02 lesson). |

Generators: **no change.**

## 21. Open PO decisions and Security gates

### 21.1 PO decisions

| ID | C5 assumption | Blocks design review? |
|---|---|---|
| PD-R1 | two attempts | No |
| PD-R4 | no completion cap; no new IPC prompt cap | No |
| PD-R7 | generative scope only | No |
| PD-R9 | no real-provider calls; required before production qualification against real endpoints (TQ) | No; blocks production acceptance |
| PO-B (joint with SG-02) | C5: Property B scope. **C6:** the C6 direction treats direct provider bypass as within SEC-C1 (SEC-D2, PD-C6-1 … 5) and designs B for the contained worker (§28.2). PO-B is recorded as **addressed by that direction**. Security confirms the B scope of §13.4 under SG-02 | No for design review |

The C6 decisions still open are listed in §31.2 (PO-C6-1 … PO-C6-5). Apart from
those, no other PO decision is needed: AD-03 … AD-07 settle overshoot, cancelled
waits, BUSY, the 300 ms grace and `K_SETTLE`, and §9.1 keeps the approved wait
meaning.

### 21.2 Security gates (all SECURITY_GATE_OPEN)

| ID | Gate |
|---|---|
| SG-01 | SEC-C1 reconciliation. **C6:** C5's reconciliation was found incompatible with SEC-C1 (`SG01-SEC-01`). C6 replaces it with worker-independent containment termination, emptiness confirmation, kernel-backed parent-death binding, no-network containment and credential exclusion, in both modes (§13.6, §27, §28). Security must accept that design. Its host assumptions must pass HQ-L-… / HQ-W-… (§30.2) before SG-01 can close. |
| SG-02 | Property B. **C6:** DESIGNED (candidate) for the contained worker tree, with the scope of §13.4. HOST_NOT_VERIFIED. |
| SG-03 | Credential confinement against a compromised worker. **C6:** DESIGNED (candidate) through process, filesystem and network isolation (§28.3), **not** through environment hygiene. HOST_NOT_VERIFIED; the BLOCKED host spike did not verify it (§30.1). **Not closed.** |
| SG-04 | Production HTTPS transport security qualification: TQ-05, TQ-06, TQ-09 and host allowlist TS-9 (governed transport). In pass-through mode the certified provider transport runs in the parent, unchanged (§25.3). |
| SG-05 | (C6) Launcher trusted-computing-base review: bubblewrap argv and version floor; Windows helper source, privileges, handle hygiene and AppContainer principal lifecycle (§27.4, §27.5, §28.4). |

## 22. Superseded C4 material (historical; not normative)

The following C4 content is withdrawn and MUST NOT be implemented. It stays
readable at `38121f95`:

| C4 item | Why withdrawn | C5 replacement |
|---|---|---|
| Child-owned governor, governed `fetchImpl` gate, usage `observer` injected into the child's providers | AD-01; R4-ARCH-03 | Parent Gateway (§3, §8, §11) |
| `redirect: "manual"` with global `fetch`; transport assumption T1 | R4-ARCH-02 (421 → 2 POSTs) | single-send `https` transport (§10) |
| FIFO queue, `P_serial`, union wait accounting | R4-ARCH-01, R4-ARCH-04; AD-06 | BUSY, sum of governor sleeps (§8.5, §9.1) |
| Deadline predicate that admitted a reading equal to the dispatch deadline | AD-04, spike GWV-01 | exclusive predicate (§9.2) |
| `NOT_INVOKED` charge of `Res` after a gate refusal | no separate gate exists | refusals create no entry (§11.5) |
| `K_SETTLE` presented as a proposal awaiting a value | AD-07 approved 10 000 ms | §14.5 |
| Abandonment relying on the child observing `disconnect` before new provider work | R4-ARCH-03 | revocation first; Property A independent of disconnect (§14.4–§14.5) |
| Child clock origin `t0` (payload receipt) for admission and deadline | parent authority | single parent origin `tOpen` (§6.2) |
| Admission counts 36/38/40/39/41/54 and per-stage tables as statements about the governor | model changed | historical only, with assumptions (P §7.2) |

The C4 parts that R4 found RESOLVED_BY_DESIGN are kept in substance: the
`StageContext` E1/E2/E3 paths (§15.1), the usage classes and charge rule (§11),
the provider-specific retry table (§12), the reason-code set (§16), the FT0
receipt/ACK protocol (§14.1), the kill sequence without disconnect and the
abandonment procedure's parent-side steps (§14.4–§14.5).

## 23. Change log

| Rev | Change |
|---|---|
| C3 (`eff78a0c`) | Initial consolidated corrective for R2. |
| C4 (`38121f95`) | Child-owned gate, redirect `manual`, union wait, six-axis exchange record, StageContext, bounded post-kill settlement. REJECTED by R4. |
| C5 (`0c91393d`) | **Replacement.** Parent-owned Provider Gateway (AD-01 … AD-09): credentials, single-send `https` transport, admission, accounting, deadline and revocation in the parent; private validated IPC; BUSY instead of FIFO; wait = cold-start charge + measured governor sleeps; exclusive deadline at a final commit reading; Property A designed, Property B explicitly not provided with Security gates SG-01 … SG-04; FT0 lifecycle unchanged, no successful-exit grace, `K_SETTLE = 10 000 ms` approved; parent-authoritative refusal record; spike-only fields mapped to private or existing outcomes; HTTPS qualification TQ-01 … TQ-10. |
| C6 | **Consolidated containment corrective** (PD-C6-1 … 6). `SG01-SEC-01`: per-stage launcher and OS containment in both modes; worker-independent termination; private containment states with emptiness confirmation; kernel-backed parent-death binding; `CLEANUP_UNRESOLVED` fail-closed (§27). No-network containment and credential exclusion (§28). Ungoverned pass-through Gateway; INV-G13 and PD-R13 interpretation amended (§25). Qualified-host refusal (§26). Candidate public reasons, proposed only (§29). Qualification gates with acceptance criteria; host feasibility BLOCKED (§30). `C5-ARCH-01`: fresh pre-sleep reading (§8.3, INV-G06). `C5-ARCH-02`: event-driven post-termination settlement, INV-G18 corrected (§14.5). `C5-EVID-01`: provenance categories; manifest reproduced; C2 report hash reviewer-reported (§2.5, §2.8). `C5-GOV-01`: `PENDING_PM_METADATA_SYNC` (no PR metadata edited). |

---

## 24. C6 authority, findings and amended C5 statements

### 24.1 C6 decisions used (PO-CONV, 2026-10-27; provenance PO-SUPPLIED)

| ID | PO disposition | Where C6 applies it |
|---|---|---|
| PD-C6-1 | **APPROVED.** Ungoverned provider-backed execution may internally use a parent-owned pass-through Gateway. The design interpretation of PD-R13 and INV-G13 is narrowly amended. Externally observable compatibility is preserved wherever possible. "Governor disabled" means no rate governance, **not** no SEC-C1 protection. Any further public behavior change outside the approved decisions requires STOP. | §3.2, §25, INV-G13, INV-G24 |
| PD-C6-2 | **APPROVED DESIGN DIRECTION.** Linux Bubblewrap and a Windows native helper using a Job Object and AppContainer are candidate launcher mechanisms. They are not production-qualified and not approved mandatory dependencies. The design states precise assumptions and host capabilities. | §27.3–§27.5; PO-C6-3 (§31.2) |
| PD-C6-3 | **APPROVED.** Qualified-host policy for Windows and Linux on Node 22.x. Unsupported or unqualified hosts refuse provider-backed execution, governed or ungoverned, before exposing credentials or initiating provider traffic. Unrelated capabilities remain available. WSL2 does not prove native Linux or CI compatibility. | §26, INV-G21 |
| PD-C6-4 | **APPROVED DESIGN DIRECTION.** Two candidate closed public failure reasons, `HOST_ISOLATION_UNAVAILABLE` and `WORKER_TERMINATION_UNCONFIRMED`: design their meaning, occurrence and proposed mappings. Canonical public-contract changes are **not** authorized. No new numeric exit codes without separate approval. | §29; PO-C6-1 |
| PD-C6-5 | **APPROVED DIRECTION.** Prefer kernel-backed containment and lifetime enforcement. Preserve responsibility for unresolved termination. A permanent host supervisor is **not** approved as an additional production dependency; if one proves unavoidable, STOP for PO disposition. `K_SETTLE = 10 000 ms` remains the parent settlement bound only. | §27.6, §27.7, §14.5; PO-C6-5 |
| PD-C6-6 | **COMPLETED AS BLOCKED.** The isolated host feasibility experiment ended BLOCKED. Do not retry blocked probes, create alternate credential-inspection tooling, install dependencies or modify OS security settings. Use official OS documentation and existing evidence, and identify the proof gaps. | §30.1; every host property is ASSUMPTION |
| SEC-D1 … SEC-D3 | **APPROVED** (PO-CONV; their full texts are not reproduced in this repository). C6 relies on SEC-D2 as summarized in the PO record: SEC-C1 covers direct provider bypass, and OS-level credential separation is required. SEC-D1 and SEC-D3 are preserved unchanged; C6 changes nothing they decide. | §13.6, §28 |

AD-01 … AD-09 are preserved. C6 extends AD-01 (parent ownership) to ungoverned
mode under PD-C6-1. It extends AD-02 by designing a candidate Property B and a
worker termination guarantee under the Security gates. It keeps AD-07 (FT0, no
grace, `K_SETTLE`), with the settlement bound corrected (§14.5).

### 24.2 Findings and C6 disposition

| Finding | Severity | C6 disposition | Where |
|---|---|---|---|
| `SG01-SEC-01` | MAJOR | **Addressed by design** with worker-independent containment termination, emptiness confirmation, kernel-backed parent-death binding, no-network containment and credential exclusion, in both modes. Fail-closed refusal elsewhere. The disposition is conditional on the host assumptions, which are open qualification gates. **SG-01 stays SECURITY_GATE_OPEN.** | §13.6, §25–§30 |
| `C5-ARCH-01` | MINOR | **Corrected.** A fresh pre-sleep reading `a`; the deadline, planned end and wait budget are evaluated at `a`; the strict final dispatch checks are unchanged. | §8.3, §9.2, §9.4, INV-G06; P Lemma 3, PT-13 |
| `C5-ARCH-02` | MINOR | **Corrected.** Post-termination settlement is event-driven and may be immediate; `CAE` and `K_SETTLE` are fallbacks; INV-G18 is restated with an upper bound only. | §14.5, §17, INV-G18; P Lemma 9, PT-14 |
| `C5-EVID-01` | LOW | **Corrected.** Provenance categories (§2.8). Manifest `8bcd557c…` reproduced (AUTHOR-LOCAL). C2 report hash `5447dc2a…` recorded as reviewer-reported (PO-SUPPLIED), not author-verified. | §2.5, §2.8; P §1; M §1 |
| `C5-GOV-01` | LOW | **`PENDING_PM_METADATA_SYNC`.** PR title and body are owned by the PM. C6 edits no PR metadata. | M §15 |

### 24.3 C5 statements withdrawn or amended by C6

| C5 statement | C6 status |
|---|---|
| §3.2 ungoverned rows: child-owned `createProvider()`, credentials in the child environment; INV-G13 "identical … No Gateway module is loaded" | amended (PD-C6-1): pass-through Gateway, no credentials in the worker; INV-G13 restated with D-1 … D-5 (§25.4) |
| §13.4 "Property B NOT PROVIDED … not designed here" | superseded: B designed as a candidate for the contained worker tree (§28.2); HOST_NOT_VERIFIED |
| §13.6 "child must terminate: … not guaranteed to terminate, in FT0 or in C5"; SG-01 BLOCKED condition | superseded: worker-independent termination with confirmation (§27); SG-01 open pending Security and qualification |
| §14.4 step 5 `child.kill("SIGKILL")` | replaced by a containment termination request (§27.4.3, §27.5.3) |
| §14.5 "abandonment"; INV-G18 "decided at or after `tKill + K_SETTLE` … or `tExit + CAE`" | replaced by unresolved settlement; INV-G18 corrected (event-driven, upper bound only) |
| §8.3 pre-sleep test against the loop reading `t` | replaced by the fresh pre-sleep reading `a` |
| §2.5 "Source manifest … Not reproduced" | withdrawn: reproduced (AUTHOR-LOCAL) |
| §19 item 1–3 (B, credential confinement, termination "not guaranteed") | restated for C6 (§19) |
| PT-08 "child keeps running … termination not guaranteed" | replaced by PT-16, PT-21, PT-22 (P §5) |

---

## 25. Ungoverned pass-through Gateway (PD-C6-1)

### 25.1 Mode selection

Every provider-backed generative stage child is launched inside a containment
(§27) and receives the Gateway client provider (§7.4). The parent opens exactly one
session per stage child:

- **governed session** (§8–§11) when v2 `providerGovernor.enabled === true`;
- **pass-through session** (this section) otherwise.

The worker always uses the Gateway client. The payload marker `gateway: {v:1}`
(governed only) enables only the governed-only worker features: heartbeat and
`StageContext`. No worker ever calls `createProvider()` for a network provider.

### 25.2 PD-R13 interpretation (narrowly amended)

| Mechanism | Class | Ungoverned (C6) |
|---|---|---|
| Admission, RPM/TPM ledgers, reservation, usage charge, cold start, cooldown, hints | rate governance | **absent** |
| Wait budget, dispatch deadline, stage enforcement, heartbeat, watchdog | rate governance / PD-R13 | **absent** |
| Parent-owned credential custody and provider transport | SEC-C1 protection (SEC-D2) | present |
| Revocation (Property A) | SEC-C1 protection | present |
| Worker containment, termination request, emptiness confirmation, `K_SETTLE` settlement bound | SEC-C1 protection (PD-R14) | present |
| Single active request (`BUSY`) | session hygiene (one in-flight request to revoke) | present; unreachable with the certified sequential generators |

### 25.3 Pass-through algorithm (normative)

```text
openPassThrough():                                  // before spawn, after the host check (§26)
  provider = createProvider(PROVIDER, {cancelSignal: sessionController.signal})
                                                    // the CERTIFIED Groq/Gemini implementation, unchanged
                                                    // (global fetch, 30 s timer, bounded body, existing mapping)
  on throw: classify exactly as the baseline child's provider-configuration failure
            (PROVIDER_CONFIGURATION_INVALID, exit 3), with no spawn

onRequestPT(req):                                   // req is a validated copy (§7.2)
  if req.id <= lastId: return reply(req.id, refused INVALID_REQUEST)
  lastId = req.id
  if revoked:           return reply(req.id, refused REVOKED)
  if active !== null:   return reply(req.id, refused BUSY)
  active = {id: req.id}
  try:   out = {outcome:"content", content: await provider.analyze({systemPrompt, userPrompt})}
  catch e: out = revoked ? CANCELLED
                         : {outcome:"provider-error", code: e.code, retryable: e.retryable}  // §25.5
  active = null
  if !revoked and out !== CANCELLED: reply(req.id, out)

revoke(): revoked = true; sessionController.abort()  // aborts the certified provider's in-flight fetch
```

- The request bytes, endpoint, headers, timeout, body bound, redirect handling and
  HTTP-status mapping are those of the certified providers (`groq-provider.js`,
  `gemini-provider.js` at `a32a6cd7`). That includes the global-`fetch` behavior on
  HTTP 421 (R4-ARCH-02), which **stays a baseline property** of ungoverned mode. The
  single-send transport (TS-1 … TS-9) is governed-only. C6 does not change it.
- The certified providers today take a **process-scoped** cancel signal through
  `bindCancelSignal()`. In the parent, a **per-session** signal is required.
  Implementation touchpoint (§20): allow `createProvider()` to take an explicit
  signal, with no change to any other behavior.
- Property A in pass-through mode: `provider.analyze()` is called only from
  `onRequestPT` after the `revoked` test with no intervening `await` (P Lemma 4b).

### 25.4 Externally observable differences from the baseline (enumerated; INV-G13)

| ID | Difference | Authority | Public outcome |
|---|---|---|---|
| D-1 | A provider-configuration failure (missing `AI_API_KEY` / `AI_MODEL`, constructor error) is detected in the parent before spawn, not in the child | PD-C6-1 (credential custody) | unchanged: `PROVIDER_CONFIGURATION_INVALID`, exit 3. Prerequisite **PRQ-COMPAT-1**: confirm that the child-side checks which run before `createProvider()` in the baseline (`STAGE_PAYLOAD_INVALID`, `CAPABILITY_REQUIRES_GENERATIVE_PROVIDER`, `generative-runner.js` L201–L212) cannot fire in a state where D-1 now fires first. Otherwise STOP |
| D-2 | Provider-backed execution is refused on unsupported or unqualified hosts | PD-C6-3 | proposed `HOST_ISOLATION_UNAVAILABLE` (§29), pending authorization |
| D-3 | After parent-observed IPC loss without a stored result, the parent requests containment termination and settles within the `K_SETTLE` bound | PD-C6-1, PD-R14, PD-C6-5 | unchanged when the containment empties: `STAGE_FAILED` (1), as the baseline "no result" outcome. One stderr line only when unresolved |
| D-4 | Containment failures produce the candidate reasons | PD-C6-4 | proposed `HOST_ISOLATION_UNAVAILABLE` / `WORKER_TERMINATION_UNCONFIRMED` (§29), pending authorization |
| D-5 | Provider HTTPS requests originate in the CLI parent process. The parent's runtime TLS and proxy configuration therefore applies, instead of the closed child environment (for example `NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS`, which `buildGenerativeEnv()` never passes to the child) | PD-C6-1 (consequence of parent custody) | no outcome change when those variables are unset. **Disclosed for Security review (SG-04, Q-C6-1).** If Security requires parity, the pass-through transport must neutralize those inputs, which needs re-review |

No other public difference is designed. Internal differences (worker environment
without credentials, containment, Gateway module loaded) are not public.

### 25.5 Error fidelity (pass-through)

The worker reconstructs the provider error from `{code, retryable}` (§7.4). The
fields that generators or the envelope read from a provider error must be equal to
the baseline. Prerequisite **PRQ-COMPAT-2**: enumerate those fields (for example
through `normalizeProviderError()`). If any field other than `code` and `retryable`
is read (for example the message text), the IPC `provider-error` shape must carry it
in a closed, sanitized form, which needs re-review. Verification V-15 (M §12).

---

## 26. Host qualification policy (PD-C6-3)

### 26.1 Host classes

| Class | Definition | C6 status |
|---|---|---|
| `linux-native` | Linux x64 kernel on bare metal or a VM, not WSL; includes the CI runner image class, recorded separately per image | candidate; **not qualified** |
| `linux-wsl2` | Linux under WSL2 | candidate as its **own** class. Its evidence **never** qualifies `linux-native` or CI |
| `windows` | Windows 10/11 x64 builds named by qualification | candidate; **not qualified** |
| any other (macOS, other architectures, Linux without the required capabilities, Node ≠ 22.x) | — | **unsupported**: refused |

**Qualified Host Matrix (QHM).** A host class is qualified only when every gate of
§30.2 for that class has passed under an independent qualification mission. **The
QHM is empty at C6.** If C6 were implemented unchanged, every host would refuse
provider-backed execution until qualification. This consequence is stated, not
hidden.

### 26.2 Qualified-host predicate (evaluated in the parent, per invocation)

`qualified(host)` holds iff all of these are true:

1. the host class is in the QHM;
2. `process.versions.node` is `22.x` (the `engines` range);
3. the class's launcher passes the static preflight recorded in the QHM entry:
   - Linux: `bwrap` resolved at a fixed absolute path, version at or above the
     qualified floor, not setuid (H-L-01);
   - Windows: helper present at its installed path with matching integrity identity
     (PO-C6-3), and OS build in the qualified set;
4. no QHM exclusion condition holds. For example, running as `root` on Linux is
   unqualified unless separately qualified.

The predicate reads no credential, opens no network connection and spawns at most
read-only version probes defined by the qualification. Runtime capability
(namespace or AppContainer creation) is proven by the launcher itself, before the
worker runs (LC-2).

### 26.3 Refusal semantics

- **Order.** The existing pipeline order stays: usage (2) → config (3) → authority
  (5) → input (4) → provider (6). The host check runs after the existing
  configuration and authority checks of the provider-backed command, and before the
  provider or adapter is used and before spawn.
- **Effect.** Zero child processes, zero provider requests, the credential never
  passed to any transport or child. The parent reads `AI_API_KEY` only as today, for
  redaction (`generative.js` L71). Outcome: proposed `HOST_ISOLATION_UNAVAILABLE`
  (§29).
- **Runtime setup failure on a qualified host.** If the launcher reports
  `setup-failed` before the worker ran (LC-2), the outcome is the same. If the
  launcher fails in any other way, the outcome is `CLEANUP_UNRESOLVED` (§27.2,
  fail closed).
- **Scope.** Only provider-backed generative execution (`design`, `plan`,
  `generate` with an effective network provider) is refused. Offline or mock
  providers, non-generative stages and every other CLI capability are unaffected.

---

## 27. Worker containment and termination (SG01-SEC-01)

### 27.1 Requirements

| ID | Requirement (both modes, every qualified host) |
|---|---|
| CR-1 | **Pre-execution containment.** The containment exists, and the worker is a member, before the worker executes any instruction of its own. |
| CR-2 | **Membership.** Every descendant of the worker is a member. No member can leave the containment or create a process outside it. |
| CR-3 | **Worker-independent termination.** The parent can cause every member to be terminated without any action by any member. |
| CR-4 | **OS-observable confirmation.** "Terminated" is established only by an OS-observable emptiness condition of the containment (`CONTAINMENT_EMPTY`), never by a request, a timeout or a leader exit alone. |
| CR-5 | **Parent death.** If the parent process dies by any cause, the containment is ended by kernel-backed mechanisms that need neither the worker nor the parent's code to run. |
| CR-6 | **Failed termination.** A termination that cannot be confirmed is `CLEANUP_UNRESOLVED`, fails closed, and is never classified as terminated. |
| CR-7 | **Handle and resource lifetime.** Every handle or resource that keeps the containment alive or controllable is owned by the launcher (or the kernel), is non-inheritable, and is unreachable from members. |
| CR-8 | **Cleanup responsibility.** Defined for each outcome (§27.7). No permanent host supervisor (PD-C6-5). |
| CR-9 | **Fail closed.** Any setup, status or protocol fault yields refusal (before the worker runs) or `CLEANUP_UNRESOLVED` (after). It never yields acceptance. |
| CR-10 | **Unsupported-host refusal.** §26. |

### 27.2 Containment state machine (private)

#### 27.2.1 States

`LAUNCHING` is an internal pre-state. The five states below are the C6 design
states. They are **not** approved public status strings.

| State | Meaning | Established by |
|---|---|---|
| `LAUNCHING` | launcher spawned; worker not yet confirmed inside the containment | spawn |
| `PROCESS_RUNNING` | the worker was created inside the containment and may run | launcher `ready` record |
| `TERMINATION_REQUESTED` | the parent decided to terminate and issued the platform's termination request | parent (§14.4 step 5) |
| `PROCESS_EXIT_OBSERVED` | the worker **leader** exited. Descendants may still be alive. **Not** termination of the worker tree | launcher `worker-exit` record |
| `CONTAINMENT_EMPTY` | the OS reported that the containment has no member process | launcher `containment-empty` record (Windows) or the derivation rule R-L-EMPTY (Linux, §27.4.4) |
| `CLEANUP_UNRESOLVED` | termination or emptiness could not be confirmed | rules T7a … T7f below |

#### 27.2.2 Transitions

| # | From | Event | To |
|---|---|---|---|
| T1 | `LAUNCHING` | valid `ready` | `PROCESS_RUNNING` |
| T2 | `LAUNCHING` | valid `setup-failed`, then launcher exit | settled as **refusal** (`HOST_ISOLATION_UNAVAILABLE`, proposed). No worker ran (LC-2) |
| T3 | `PROCESS_RUNNING` | termination decision (§14.4) | `TERMINATION_REQUESTED` |
| T4 | `PROCESS_RUNNING` | valid `worker-exit` | `PROCESS_EXIT_OBSERVED` |
| T5 | `TERMINATION_REQUESTED` | valid `worker-exit` | `PROCESS_EXIT_OBSERVED` (the request flag is kept) |
| T6 | `PROCESS_RUNNING`, `TERMINATION_REQUESTED`, `PROCESS_EXIT_OBSERVED` | valid `containment-empty` (or R-L-EMPTY) | `CONTAINMENT_EMPTY` (final) |
| T7a | any non-final | valid `cleanup-unresolved` | `CLEANUP_UNRESOLVED` (final) |
| T7b | any non-final | launcher exit, `close` or `CAE` settlement without a prior `containment-empty` | `CLEANUP_UNRESOLVED` |
| T7c | any non-final | first `K_SETTLE` callback at or after `tKill + K_SETTLE` without emptiness | `CLEANUP_UNRESOLVED` |
| T7d | any | malformed status record, record not allowed in the current state, status channel EOF before the launcher's exit while a record is still required | termination decision (`LAUNCHER_FAULT`) if not already taken, then `CLEANUP_UNRESOLVED` at settlement unless T6 occurs first |
| T7e | `LAUNCHING` | launcher exit without `ready` and without `setup-failed` | `CLEANUP_UNRESOLVED`: a worker may have run |
| T7f | `TERMINATION_REQUESTED` | the termination fallback that forfeits confirmation was used (§27.4.3, §27.5.3) | stays `TERMINATION_REQUESTED`; T6 is no longer accepted from R-L-EMPTY; settles `CLEANUP_UNRESOLVED` unless the launcher itself reports `containment-empty` |

Rules: final states never change. A termination request, `PROCESS_EXIT_OBSERVED`,
a `K_SETTLE` expiry or a `CAE` settlement **never** produce `CONTAINMENT_EMPTY`
(INV-G19). The only producers are T6.

The worker's IPC `disconnect`, the launcher's `exit` and the launcher's `close` are
FT0 events. Their effect on containment state is only through T7b.

#### 27.2.3 Private-to-public mapping (proposal)

| Final containment state at settlement | `killed` | Result stored | Public outcome |
|---|---|---|---|
| `CONTAINMENT_EMPTY` | `null` | yes, `exitCode === 0`, `close` | accepted (INV-G12) → existing validation and commit |
| `CONTAINMENT_EMPTY` | `null` | otherwise | existing FT0 classification (§15.3 rows 6–12) |
| `CONTAINMENT_EMPTY` | `STAGE_TIMEOUT` / `CHILD_UNRESPONSIVE` | discarded | `STAGE_TIMEOUT` (6) / `CHILD_UNRESPONSIVE` (1) |
| `CONTAINMENT_EMPTY` | `IPC_LOST` / `LAUNCHER_FAULT` | discarded | `STAGE_FAILED` (1), existing |
| `CLEANUP_UNRESOLVED` | any | discarded | **proposed** `WORKER_TERMINATION_UNCONFIRMED`, exit 1 (§29) |
| refusal (T2) | — | — | **proposed** `HOST_ISOLATION_UNAVAILABLE`, exit 5 (§29) |

### 27.3 Launcher contract (platform-neutral)

| ID | Requirement |
|---|---|
| LC-1 | One launcher per stage child, spawned by the parent with `shell: false` at a fixed absolute path. Its lifetime ends with its containment. It is **not** a host supervisor and does not outlive the stage except as described in §27.6. Its environment is the worker environment (no credential, INV-G22). |
| LC-2 | It creates the containment and places the worker in it before the worker runs (CR-1). On any failure before that point, it writes `setup-failed {stage}` and exits non-zero **without having started the worker**. |
| LC-3 | It provides membership without breakaway (CR-2). |
| LC-4 | It reports `containment-empty` only from the OS emptiness condition of its platform. |
| LC-5 | It exits only after `containment-empty` or `cleanup-unresolved`. After `containment-empty` its exit code equals the worker leader's exit code (signal-terminated leaders: a platform-defined non-zero code). In every other case it exits non-zero. |
| LC-6 | After the leader's exit, it terminates the remaining members (descendant purge) before it reports emptiness. |
| LC-7 | It is bound to the parent's lifetime by kernel-backed means (§27.6). |
| LC-8 | It never reads, holds or forwards a provider credential and never opens a network connection. |
| LC-9 | It passes the parent's IPC channel and stdio to the worker unchanged and retains no copy of the IPC channel after the worker has started. It never parses or relays IPC content. |
| LC-10 | It writes only closed status records on the status channel (below). |

Status channel: an extra parent-created pipe (child stdio index 4). Records:

| Record | Closed fields | Allowed in state |
|---|---|---|
| `ready` | `workerPid` (positive integer; on Linux the sandbox init's PID in the parent's namespace) | `LAUNCHING` |
| `setup-failed` | `stage` ∈ closed set (`userns`, `namespace`, `mount`, `job`, `appcontainer`, `create-process`, `assign`, `verify`, `other`) | `LAUNCHING` |
| `worker-exit` | `code` (integer or `null`), `signal` (closed string or `null`) | `PROCESS_RUNNING`, `TERMINATION_REQUESTED` |
| `termination-delivered` | `ok` (boolean) | `TERMINATION_REQUESTED`, `PROCESS_EXIT_OBSERVED` |
| `containment-empty` | — | `PROCESS_RUNNING`, `TERMINATION_REQUESTED`, `PROCESS_EXIT_OBSERVED` |
| `cleanup-unresolved` | `stage` ∈ closed set | any non-final |

Linux (`bwrap`) does not speak this schema. The parent's Linux adapter maps bwrap's
documented `--json-status-fd` output: `{"child-pid": n}` → `ready`,
`{"exit-code": n}` → `worker-exit`. A bwrap error before `child-pid` maps to
`setup-failed {stage:"other"}`, and `containment-empty` is derived by R-L-EMPTY
(§27.4.4). Every record that does not parse to the closed schema is T7d.

Control channel (Windows only): the helper's stdin pipe. The parent writes the
single closed record `terminate`. EOF means the parent is gone (§27.5.5). The
Linux design needs no control channel.

### 27.4 Linux candidate: bubblewrap (unprivileged user namespaces)

#### 27.4.1 Host assumptions (all ASSUMPTION; gates in §30.2)

| ID | Assumption | Source | Gate |
|---|---|---|---|
| H-L-01 | `bwrap` at a fixed path, version at or above the qualified floor, **not setuid**, able to create an unprivileged user namespace on the host. Distribution policy, for example an AppArmor user-namespace restriction or a sysctl, may forbid this; that host is then unqualified | bwrap(1); distribution docs | HQ-L-01 |
| H-L-02 | The parent (same UID) may send `SIGKILL` to the sandbox init by its PID in the parent's namespace | kill(2) permission rules | HQ-L-03 |
| H-L-03 | When the init of a PID namespace terminates, the kernel sends `SIGKILL` to every other process in that namespace | pid_namespaces(7) (documented) | HQ-L-03, HQ-L-04 |
| H-L-04 | The init's exit status becomes reapable only after every other member of its PID namespace has exited and been reaped | kernel behavior; **not stated in the manual page** | HQ-L-04 |
| H-L-05 | A parent-death signal set with `PR_SET_PDEATHSIG` is delivered when the creating parent **thread** ends (prctl(2), with its documented thread caveat); bwrap `--die-with-parent` uses it for the sandbox processes | prctl(2); bwrap(1) | HQ-L-05 |
| H-L-06 | The bwrap monitor (the parent's direct child) exits only after reaping the sandbox init. Its exit status is the command's exit status; the `exit-code` status record precedes that exit | bwrap behavior; ASSUMPTION | HQ-L-04, HQ-L-14 |
| H-L-07 | A `/proc` mounted inside the sandbox lists only the sandbox's PID namespace | proc(5), pid_namespaces(7) | HQ-L-07 |
| H-L-08 | A new network namespace contains only a loopback interface, separate from the host's loopback, and has no route to any other network | network_namespaces(7) | HQ-L-08 |
| H-L-09 | No host pathname socket (for example under `/run`, `$XDG_RUNTIME_DIR`, `/tmp` of the host) is present in the sandbox filesystem view; abstract UNIX sockets are scoped to the network namespace | unix(7); bwrap mount options | HQ-L-09 |
| H-L-10 | `SIGKILL` sent from an ancestor PID namespace to a namespace's init is delivered forcibly | pid_namespaces(7) (documented) | HQ-L-03 |
| H-L-11 | A process cannot move itself or a descendant out of its PID namespace into the parent's namespace without `CAP_SYS_ADMIN` in the user namespace that owns the target namespace | setns(2) | HQ-L-04 |

#### 27.4.2 Containment creation (CR-1, CR-2)

The parent spawns `bwrap` (the **monitor**, the parent's direct child) with, in
substance:

```text
bwrap --unshare-user --unshare-pid --unshare-net --unshare-ipc --unshare-uts --unshare-cgroup-try
      --die-with-parent --new-session [--disable-userns, if the qualified version supports it]
      --clearenv --setenv <worker environment allowlist, incl. the Node IPC channel variables>
      --ro-bind <node runtime> --ro-bind <package code root> --ro-bind <required system libs>
      --proc /proc --dev /dev --tmpfs /tmp --chdir /
      --json-status-fd 4
      -- <node> <generative-runner.js> <stage>
```

- `--unshare-user` is mandatory, not `-try`. Failure to create the namespace is a
  setup failure (LC-2).
- bwrap runs its own init as PID 1 of the new PID namespace (no `--as-pid-1`). The
  worker is a child of that init. Every descendant, including double-forked and
  `setsid` processes, stays in the namespace and is reparented to the init
  (H-L-11).
- The filesystem view contains only read-only binds that the worker needs:
  PRQ-FS-1 (§28.1) defines that set and qualification confirms it. It contains no
  home directory, no workspace, no `/run` and no host `/tmp`.
- cgroup v2 is **not** used. It is not needed for CR-1 … CR-5 under H-L-03 … H-L-06,
  and on the observed WSL2 host the process's cgroup was `0::/init.scope` with no
  delegation (SMOKE inventory). If qualification refutes H-L-04 or H-L-06, the only
  remaining documented emptiness signal is cgroup v2 `cgroup.events` `populated 0`.
  That needs a delegated cgroup subtree, which is an additional host dependency, so
  **STOP for PO** (PO-C6-5).

#### 27.4.3 Worker-independent termination (CR-3)

Primary path: the parent sends `SIGKILL` to the sandbox init's PID from the `ready`
record (H-L-02, H-L-10). The kernel then kills every other member (H-L-03). No
member's cooperation is involved. `termination-delivered{ok:true}` is recorded when
the `kill` call returns without error.

Preconditions (PID-reuse guard): `ready` was received; no `worker-exit` record was
received; the monitor's `exit` was not observed. While these hold, the init has not
been reaped (H-L-06), so its PID cannot have been reused. **Residual R-L-PID:**
between the monitor reaping the init and the parent reading the `exit-code` record
or the monitor's exit, the PID is free. A `SIGKILL` sent in that window could reach
an unrelated process of the same user if the PID was reused within it. The design
keeps the window as small as the event loop allows. It is disclosed, not claimed to
be zero (Q-C6-3). Removing it entirely needs a PID-file-descriptor-capable launcher
or native addon, which is a dependency outside PD-C6-2.

Fallback (forfeits confirmation, T7f): if the preconditions fail while the monitor
is alive, or `kill` fails with `EPERM`, the parent kills the monitor
(`child.kill("SIGKILL")`). bwrap's `--die-with-parent` then kills the sandbox
processes through the parent-death signal (H-L-05). After that, emptiness can no
longer be confirmed: `CLEANUP_UNRESOLVED`. `ESRCH` means the init already
terminated; the parent waits for the records.

#### 27.4.4 Emptiness confirmation (CR-4): rule R-L-EMPTY

The parent records `CONTAINMENT_EMPTY` (T6) iff:

- the `worker-exit` record (bwrap `exit-code`) was received; and
- the monitor's `exit` was observed afterwards with a consistent status; and
- the fallback of §27.4.3 was not used.

The rule rests on H-L-04 and H-L-06: the monitor can exit only after reaping the
init, and the init can be reaped only after the namespace is empty. Both are
ASSUMPTIONS until HQ-L-04 and HQ-L-14 pass. A leader exit alone
(`PROCESS_EXIT_OBSERVED`) is never emptiness. A namespace whose init outlives the
worker leader is not possible in this configuration: bwrap's init exits when its
command exits. That exit tears the namespace down (descendant purge, LC-6),
assumed under H-L-03 and HQ-L-04.

#### 27.4.5 Parent death (CR-5)

If the CLI process dies, the monitor receives its parent-death `SIGKILL`, and the
sandbox init receives its own (bwrap `--die-with-parent`, H-L-05). The init's death
kills the namespace (H-L-03). No product code runs; no confirmation is possible
(§27.6).

#### 27.4.6 Failed or unresolved termination (CR-6)

`kill` errors, members stuck in uninterruptible kernel waits (`SIGKILL` pending), a
monitor killed by a third party, a missing or malformed status record: each leads
to T7b … T7f and `CLEANUP_UNRESOLVED`.

#### 27.4.7 Resources and cleanup (CR-7, CR-8)

The namespaces and the tmpfs are kernel objects that exist only while a member
exists. The design creates no persistent host state: no cgroup, no files outside
the sandbox tmpfs, no registration. After `CONTAINMENT_EMPTY` nothing remains to
clean up. After `CLEANUP_UNRESOLVED` the remaining kernel objects are released when
their last member exits.

#### 27.4.8 Limitations

All Linux evidence is an **inventory on WSL2** (bubblewrap 0.11.1 present, not
setuid; user namespaces available; Node 22.23.3 available). **No sandbox was ever
started** (§30.1). Native Linux and CI runners are not shown. Hosts that forbid
unprivileged user namespaces are unqualified.

### 27.5 Windows candidate: native helper with Job Object and AppContainer

#### 27.5.1 Host assumptions (all ASSUMPTION unless marked SMOKE)

| ID | Assumption | Source | Gate |
|---|---|---|---|
| H-W-01 | Nested jobs are supported, and a process can be placed in a job at creation (`PROC_THREAD_ATTRIBUTE_JOB_LIST`) on the qualified builds | Windows documentation (Job Objects; `UpdateProcThreadAttribute`) | HQ-W-01, HQ-W-12 |
| H-W-02 | With `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, all processes in the job are terminated when the **last handle** to the job is closed | `JOBOBJECT_BASIC_LIMIT_INFORMATION` (documented) | HQ-W-05, HQ-W-06 |
| H-W-03 | Without `JOB_OBJECT_LIMIT_BREAKAWAY_OK` and `JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK`, a member's child processes are created in the job, and `CREATE_BREAKAWAY_FROM_JOB` fails | Job Objects documentation | HQ-W-04 |
| H-W-04 | `TerminateJobObject` terminates every process currently associated with the job. Process exit may complete asynchronously (pending I/O) | `TerminateJobObject` (documented) | HQ-W-03, HQ-W-07 |
| H-W-05 | `JOBOBJECT_BASIC_ACCOUNTING_INFORMATION.ActiveProcesses == 0` means that no process in the job is still active. Completion-port job messages are notifications whose delivery is **not guaranteed** and are used only as prompts | Job Objects / `JOBOBJECT_ASSOCIATE_COMPLETION_PORT` (documented) | HQ-W-07 |
| H-W-06 | The helper's job handle is non-inheritable. The job is unnamed. No member can obtain a handle to it, because an AppContainer member cannot open the helper's process | ASSUMPTION | HQ-W-06, HQ-W-08 |
| H-W-07 | An AppContainer token with **no capabilities** has no outbound network access, and loopback is blocked unless a loopback exemption exists for that AppContainer | AppContainer network isolation documentation | HQ-W-09 |
| H-W-08 | An AppContainer token cannot open processes, files or registry keys that do not grant access to its SID or to ALL APPLICATION PACKAGES. That includes the parent's process and the user's profile files | AppContainer isolation documentation | HQ-W-08, HQ-W-10 |
| H-W-09 | Node 22.x runs as an AppContainer process given read access to its runtime and the package code, and a writable AppContainer temp directory | ASSUMPTION | HQ-W-13, HQ-W-15 |
| H-W-10 | The parent's IPC pipe handle and stdio handles can be passed through the helper to the worker by explicit handle-list inheritance, with the stdio encoding that Node's `NODE_CHANNEL_FD` expects | ASSUMPTION | HQ-W-13 |
| H-W-11 | The helper ends when the parent ends, by (a) EOF on its control pipe, which helper code acts on, and (b) a kernel mechanism independent of helper code, for example membership in a kill-on-close job held only by the parent process. libuv implements such a job, but that is an implementation detail, not a Node API | ASSUMPTION | HQ-W-05 |
| H-W-12 | An AppContainer process can be created only with a registered AppContainer profile (error 2 without registration; error 203 with the helper's minimal explicit environment until the profile environment variables were added) | **SMOKE** S2–S6 on one Windows 11 build; inference | HQ-W-14 |

#### 27.5.2 Containment creation (CR-1, CR-2)

The helper performs these steps, in order. Any failure before step 7 → `setup-failed`, exit non-zero:

1. Create an unnamed Job Object `J` with a non-inheritable handle. Set
   `KILL_ON_JOB_CLOSE`, **without** `BREAKAWAY_OK` and `SILENT_BREAKAWAY_OK`.
   Associate a completion port for prompts (H-W-05).
2. Obtain the AppContainer SID for the product's AppContainer principal. Its
   lifecycle is PO-C6-2: per-run creation and deletion, or explicit setup.
3. Build `SECURITY_CAPABILITIES` with that SID and **zero** capabilities: no
   `internetClient`, `internetClientServer` or `privateNetworkClientServer`.
4. Build an explicit, closed environment block: the worker allowlist (INV-G22),
   the Node IPC channel variables, the AppContainer profile variables required
   on the build (H-W-12), and `TEMP`/`TMP` pointing to the AppContainer temp
   directory.
5. `CreateProcess(node, runner, stage)` with `EXTENDED_STARTUPINFO_PRESENT |
   CREATE_SUSPENDED`. Attributes: security capabilities,
   `PROC_THREAD_ATTRIBUTE_JOB_LIST = {J}`, and `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`
   restricted to the IPC and stdio handles.
6. Verify `IsProcessInJob(worker, J)`. On mismatch, `TerminateProcess` the
   suspended worker. No instruction of the worker has run.
7. Write `ready {workerPid}`, then `ResumeThread`.
8. Close the helper's copies of the IPC and stdio handles that it passed on (LC-9).

#### 27.5.3 Worker-independent termination (CR-3)

The parent writes `terminate` on the control channel. The helper calls
`TerminateJobObject(J, code)` and writes `termination-delivered {ok}`. No member's
cooperation is involved (H-W-04).

Fallback (forfeits confirmation, T7f): if the control write fails, or no
`termination-delivered` record follows, the parent may terminate the helper
(`child.kill()`). Closing the helper's last handle to `J` makes the kernel apply
`KILL_ON_JOB_CLOSE` (H-W-02), but nobody can query `J` any more:
`CLEANUP_UNRESOLVED`.

#### 27.5.4 Emptiness confirmation (CR-4)

After a completion-port prompt (`EXIT_PROCESS`, `ACTIVE_PROCESS_ZERO`) or after
`TerminateJobObject`, the helper **queries** `ActiveProcesses`. Only a query result
of `0` produces `containment-empty` (H-W-05). Then the helper closes `J` and exits
with the worker's exit code (LC-5). On the successful path the helper first purges
the remaining members with `TerminateJobObject` once the leader has exited (LC-6).
The helper needs no timer for correctness; the parent's `K_SETTLE` bounds the
parent's wait (§14.5).

#### 27.5.5 Parent death (CR-5)

When the parent dies, the helper's control pipe reaches EOF, and the helper calls
`TerminateJobObject` (H-W-11a). Independently of helper code, the helper's own
termination by the kernel (H-W-11b) closes the last handle to `J`, which triggers
`KILL_ON_JOB_CLOSE` (H-W-02). No product code needs to survive; no confirmation is
possible (§27.6). If qualification shows that the helper's death cannot be bound to
the parent's death without a persistent service, **STOP for PO** (PO-C6-5).

#### 27.5.6 Failed or unresolved termination (CR-6)

A failing `TerminateJobObject` (`termination-delivered{ok:false}`) leads the helper
to write `cleanup-unresolved` and exit, which closes `J` (H-W-02, unconfirmed).
Members held by pending I/O keep `ActiveProcesses > 0` until the parent's
`K_SETTLE` → `CLEANUP_UNRESOLVED`.

#### 27.5.7 Resources, nested jobs and cleanup (CR-7, CR-8)

- `J` and its completion port are held only by the helper and die with it.
- **Nested jobs:** the observed host shell runs inside a job with flags `0x1800`
  (breakaway allowed, silent breakaway allowed, no kill-on-close; SMOKE S1). The
  helper created its own job and placed a process in it (`inHelperJob=true`, SMOKE
  S3, S6). Whether `J` nests under an outer job, and whether an outer job's limits
  interact with `J`, is HQ-W-12. An outer job that terminates its members also
  terminates `J`'s members, which is not harmful to safety.
- **AppContainer principal.** The SMOKE runs needed a per-user profile
  registration. File access for the worker needs ACL grants to the AppContainer SID
  on the Node runtime and the package code (H-W-08). Both are **host security
  setting changes**. Their production model (when, by whom, how it is cleaned up)
  is **not designed** and needs PO-C6-2. No such change is prescribed or authorized
  here.

#### 27.5.8 Limitations

Windows evidence is **setup smoke only** (S1–S7) on Windows 11 Home build 26300
with **Node 24.22.1**. Node 22.x was unavailable on that host. The helper's IPC
forwarding was never exercised. `isAppContainer` was not queried from inside the
child. `WORKER_TERMINATION_UNCONFIRMED` was never exercised (§30.1).

### 27.6 Parent death (both platforms)

| Platform | Mechanism (kernel-backed) | Product code needed | Confirmation |
|---|---|---|---|
| Linux | parent-death `SIGKILL` to the monitor and the sandbox init → PID-namespace teardown (H-L-03, H-L-05) | none | **none possible**: the parent is gone |
| Windows | helper terminated with the parent (H-W-11b) → last `J` handle closed → `KILL_ON_JOB_CLOSE` (H-W-02); in addition, helper control-pipe EOF → `TerminateJobObject` (H-W-11a) | none for (b) | **none possible** |

Parent death is therefore a case where termination is **designed** (CR-5) but can
never be confirmed at runtime. Its evidence can only come from qualification
(HQ-L-05, HQ-W-05).

### 27.7 Unresolved termination: responsibility (PD-C6-5)

When the final state is `CLEANUP_UNRESOLVED`:

1. The invocation fails closed. No result is accepted or committed. The outcome
   is the proposed `WORKER_TERMINATION_UNCONFIRMED` (§29). The process is never
   reported as terminated.
2. Provider access was already revoked (Property A). The worker holds no
   credential and has no network path (§28). An unresolved worker cannot make a
   provider call through the design's paths.
3. The parent emits one fixed diagnostic line (§14.5). It names the launcher PID,
   and on Linux the sandbox init PID when known, so that the operator can finish
   the cleanup. Operator documentation is a later deliverable, not designed here.
4. The parent unrefs the launcher and may end. Ending the CLI triggers the
   kernel-backed parent-death path (§27.6), which is a further, unconfirmed,
   attempt.
5. No permanent supervisor is introduced. If qualification finds a class of
   unresolved states that cannot be bounded without one, **STOP for PO**
   (PO-C6-5).

### 27.8 FT0 integration (both modes)

| Path | Sequence | Outcome |
|---|---|---|
| Normal success | requests answered → `result` → `revoke` → store → ACK → worker disconnects and exits 0 → `worker-exit 0` → descendant purge (LC-6) → `containment-empty` → launcher exits 0 → `exit 0` → `close` | INV-G12 holds → accept (PT-15) |
| Disconnect **with** a stored result (the certified child-initiated disconnect) | no termination request. The certified worker exits next | as above |
| Disconnect **without** a stored result (`IPC_LOST`) | termination decision (§14.4) → containment termination → event-driven settlement | `STAGE_FAILED` (1) when empty; else `CLEANUP_UNRESOLVED` |
| Result stored, worker never exits (non-cooperative) | governed: the enforcement timer ends it (§14.4). Ungoverned: no timer exists (PD-R13). The CLI waits as in the baseline; the worker is revoked, credential-free and network-less. It ends with the CLI (§27.6) | **Residual** (Q-C6-6). No acceptance before `CONTAINMENT_EMPTY` |
| Launcher `exit` without `close` (Windows, FT0-C2-D1) | `CAE` fallback | `result = null`. State per T7b unless `containment-empty` was read first |

No time-based grace is introduced. The parent never requests termination on the
successful path. The descendant purge is the launcher's emptiness step after the
leader's own exit.

---

## 28. Direct provider-call prevention and credential boundary

### 28.1 Network and filesystem needs of the stage child (repository analysis; AUTHOR-LOCAL at `a32a6cd7`)

- `generative-runner.js` imports `crypto`, `../config`, `../providers/index` and
  the five generator modules (L34–L43). `providers/index.js` imports only the
  mock, Groq and Gemini providers (L13–L18).
- A search of every non-test module under `scripts/ai/` for `http`, `https`,
  `net`, `dgram`, `dns`, `tls`, `http2`, `fetch(`, `WebSocket` and `undici` finds
  network use only in `collect-history.js`, `destinations/azure-devops-test-case-destination.js`,
  `providers/azure-devops-requirements-provider.js`, `providers/jira-requirements-provider.js`,
  and the Groq and Gemini providers. None of the first four is imported by the
  runner's direct dependencies.
- In C6 the worker no longer loads a network provider (it uses the Gateway
  client). **Conclusion:** at the level of direct imports, the generative child
  needs **no network access other than provider communication**. With the provider
  moved to the parent, it needs **none**.
- Filesystem: the generator modules read no files at run time. The plan
  generator imports only constants and a pure predicate from
  `automation-repository-context.js`. That module requires `fs` at load time; its
  readers run in the parent. The worker reads module code and the Node runtime.
- **Prerequisites (not established):** **PRQ-NET-1**, the full transitive import
  closure and dynamic-require audit of the worker, confirmed by a deny-all network
  run under qualification (HQ-L-08, HQ-W-09). **PRQ-FS-1**, the exact read-only
  file set of the worker (runtime, package code, system libraries) and its temp
  needs, confirmed under HQ-L-10 and HQ-W-10. Until both pass, "no network needed"
  is a repository finding, not an established fact.

### 28.2 No-network containment model (Property B, candidate)

| Path | Linux (bwrap) | Windows (AppContainer + Job) | Status |
|---|---|---|---|
| Direct HTTP(S) to a provider or anywhere | no interface except an isolated loopback (H-L-08) | no network capability → outbound blocked (H-W-07) | DESIGNED · HOST_NOT_VERIFIED |
| Raw and packet sockets, UDP, ICMP, IPv6 | same namespace: no route; no capability in the parent user namespace | blocked with the same AppContainer network isolation | DESIGNED · HOST_NOT_VERIFIED |
| Host loopback services, including a local proxy or a local provider emulator | separate loopback; the host's `127.0.0.1` is unreachable (H-L-08) | loopback blocked unless a loopback exemption exists for the SID. Qualification checks that none exists (H-W-07) | DESIGNED · HOST_NOT_VERIFIED |
| Proxy routes (environment variables, system or WinHTTP proxy) | the environment is cleared; a proxy is a network endpoint and is unreachable | the same; a proxy is not reachable without a capability | DESIGNED · HOST_NOT_VERIFIED |
| DNS | no resolver reachable (no network; no host resolver socket bound) | **open question**: whether the system DNS client service resolves names for a capability-less AppContainer, which would be a covert channel to an attacker's authoritative server. Not a provider call (one needs HTTPS to the fixed origins) | Linux DESIGNED · Windows **SECURITY_GATE_OPEN** (HQ-W-09) |
| Pathname UNIX sockets, named pipes, local RPC brokers | not in the filesystem view (H-L-09) | reachable only when their ACL grants the AppContainer SID or ALL APPLICATION PACKAGES (H-W-08). Broker services that grant this are a residual to characterize | DESIGNED · HOST_NOT_VERIFIED; Windows brokers HQ-W-09 |
| Abstract UNIX sockets | scoped to the new network namespace | n/a | DESIGNED · HOST_NOT_VERIFIED |
| Inherited descriptors and handles | only stdio, the IPC channel and the status pipe (launcher-side) cross; the worker gets stdio and IPC only | `HANDLE_LIST` restricted to stdio and IPC | DESIGNED · HOST_NOT_VERIFIED |
| The IPC channel to the parent | the **only** provider path: closed schema, parent-authorized (§28.5) | same | DESIGNED · ALGORITHMICALLY_PROVEN (Lemma 4, 4b) |

### 28.3 Credential boundary (candidate; SG-03)

The credential is `AI_API_KEY`, read only from the parent's environment
(`config.js` L38; there is no dotenv loading). The model name `AI_MODEL` is treated
the same way.

| Exposure path | Linux | Windows | Basis |
|---|---|---|---|
| Worker environment and argv | not present (`--clearenv` + allowlist; INV-G22) | not present (explicit environment block) | environment hygiene. **Never claimed sufficient on its own** |
| Parent's environment block and memory | the parent is not in the worker's PID namespace and `/proc` shows only that namespace (H-L-07). No `ptrace` target is addressable | the AppContainer token cannot open the parent process (H-W-08) | process isolation (candidate) |
| Secret files of the user (dotfiles, credential stores, workspace `.env`) | not in the filesystem view (PRQ-FS-1, H-L-09) | not readable without an ACL grant to the SID (H-W-08) | filesystem isolation (candidate) |
| Other same-user processes (shells, editors, agents holding the key) | not addressable (PID namespace) | not openable (AppContainer) | process isolation (candidate) |
| IPC and launcher channels | no credential field exists (§7.2, §27.3); INV-G14 | same | schema (ALG) |
| Transport | parent only (governed: TS-8; pass-through: certified provider in the parent) | same | design |
| Launcher | holds no credential (LC-8). Its environment is the worker environment | same | design |

**Not claimed:** confinement against a compromised parent, launcher, OS or
non-contained same-user process. The C6 credential boundary separates the worker
tree only. It is a candidate design: **SG-03 remains open**. The BLOCKED spike did
not verify it, and its cross-process credential-inspection component was itself
blocked (§30.1).

### 28.4 Trust boundaries

| Component | Trust |
|---|---|
| CLI parent, Gateway, launcher (`bwrap` or helper), OS kernel | trusted computing base. Launcher review is SG-05 |
| Worker tree (stage child and descendants) | **untrusted** after the payload is received (compromise assumed for B, credential and termination analysis) |
| Provider responses | untrusted input (existing validation) |

### 28.5 Governed and ungoverned routing; IPC authorization

The worker's only provider path is a `provider-request` over the IPC channel. The
parent serves it only when all of these hold: the message passes the closed-schema
validation (§7.2); `id > lastId`; the session is not revoked; no request is active;
and the containment state is `PROCESS_RUNNING` (INV-G20). The request can choose
prompts only, never an endpoint, header, method or credential.

Governed mode then applies admission (§8). Pass-through mode calls the certified
provider (§25.3). Both modes revoke on the same triggers (§13.1).

### 28.6 Child IPC under isolation

- The IPC channel is created by the parent's `spawn` of the launcher and passed to
  the worker unchanged (LC-9). Linux: the inherited descriptor and the Node channel
  variables pass through `bwrap` (`--setenv`). Windows: handle-list inheritance
  with Node's stdio encoding (H-W-10).
- If the launcher kept a copy of the channel, the parent's `disconnect` event
  would be delayed until the launcher exits. That is why LC-9 forbids it. Property
  A does not depend on it, because revocation also happens on `exit`, `close` and
  every termination decision.
- Schema, validation, receipt/ACK and close-based settlement are unchanged (§7,
  §14.1).
- **Evidence:** none. Private IPC under containment was never exercised on either
  platform (§30.1). Gates HQ-L-12 and HQ-W-13.

---

## 29. Candidate public failure reasons (PD-C6-4)

**Status: the design direction is APPROVED. The canonical contract amendment is NOT
AUTHORIZED.** Neither code is part of the public contract, and implementing either
needs that separate authorization (PO-C6-1). No new numeric exit code is proposed.

| Code (candidate) | Internal meaning | Occurrence | Proposed mapping | Precedence (§15.3) | Modes |
|---|---|---|---|---|---|
| `HOST_ISOLATION_UNAVAILABLE` | The product cannot establish its mandatory worker containment on this host, so it refuses provider-backed execution | (a) host not qualified or unsupported (§26.3), before spawn; (b) launcher `setup-failed` before the worker ran (T2) | top-level `errors[].code`; **exit 5** (authority refused: the product refuses a capability on this platform, like the existing "platform decision pending" refusal). Alternative: exit 3 ("provider/framework environment configuration"). Choice is PO-C6-1 | row 2a: after usage, configuration and the existing authority checks; before input, provider and spawn | both |
| `WORKER_TERMINATION_UNCONFIRMED` | A provider-backed worker could not be confirmed terminated; its result is discarded | final containment state `CLEANUP_UNRESOLVED` (T7a–T7f) | top-level `errors[].code`; **exit 1** (the product cannot confirm its own safety invariant). The kill reason, if any, is appended to the message only | row 3a: above the kill outcomes (rows 4–5a) and every child outcome, below native signal termination, pre-spawn failures and spawn error. It is never masked by `STAGE_TIMEOUT` | both |

Before authorization, nothing is implemented (AD-09). If the PO rejects the
amendment, no fallback mapping onto an existing reason code is designed. Folding
`WORKER_TERMINATION_UNCONFIRMED` into `STAGE_FAILED` would hide a safety-relevant
state. That fallback would need a new PO decision.

---

## 30. Host feasibility evidence and qualification gates

### 30.1 Evidence boundary (PD-C6-6: BLOCKED)

Location: `C:\Users\artem\Desktop\OD-RATE-1-Host-Feasibility` (outside every
repository). The report files were read, and their SHA-256 values were computed by
the author at C6 authoring (AUTHOR-LOCAL). Their **contents** are SMOKE and
author-observed, **not** independently verified.

| File | SHA-256 |
|---|---|
| `REPORT.md` | `dd3cee3e607391d3f83771988d8cf0c85fe64a1a76545d093b170e515252c3d0` |
| `evidence/results.md` | `cb4d19f6a2baf591c41a25315cf2e0937f48a81e10b174dd4a885dfd0088c0d2` |
| `evidence/process-lifecycle.md` | `02bb6320a6063db584ace9113392d33f1ca64b9e51111559ed43b04edd50a458` |
| `evidence/host-inventory.md` | `3f771f7baf18eed3b548278203718f4d026a5ad2ee7234c3ca210087083003c7` |
| `evidence/commands.md` | `ca2f5dbc82e053a87eea7d4c0d3488210353e94065ed6caf0e51f397e9d4f15e` |
| `evidence/source-hashes.sha256` | `e710ee1d5062feb467eac64e295d019ee3ddd0815fd4df87f4bc5ba6a6d8b3cf` (lists `win/helper.cs` `fcf4edf4…0e50`, `win/helper.exe` `046e51f3…e449`, `linux/inventory.sh` `08344fd0…8cad8d`, `raw/linux-inventory.txt` `3f92345c…056d`) |

| Area | Status (from the report; preserved verbatim in substance) |
|---|---|
| Overall | **BLOCKED** |
| Formal probes L1–L10, W1–W12 | **NOT EXECUTED** (all) |
| W8 and the cross-process part of L7 | **BLOCKED**: safety restrictions on credential-inspection tooling. That tooling is not to be recreated, modified or substituted |
| Dependent worker probes (L6/W7 network, L8/W9 file access, own-environment hygiene) | **BLOCKED** (worker authoring stopped) |
| Windows Job Object | **setup smoke only** (S3, S6) |
| Windows AppContainer | **setup smoke only** (S2–S6): profile registration and profile environment variables needed |
| Linux bubblewrap | installed, **inventory only**; no sandbox started |
| Parent-death cleanup | **NOT VERIFIED** |
| Whole process-tree containment | **NOT VERIFIED** |
| Direct network denial | **NOT VERIFIED** |
| Credential confinement; SG-03 | **NOT VERIFIED** |
| Private IPC under containment | **NOT VERIFIED** |
| Fail-closed launcher before credential exposure | **not demonstrated** (incidental `HOST_ISOLATION_UNAVAILABLE` setup failures only, no credential involved) |
| `WORKER_TERMINATION_UNCONFIRMED` | never exercised |
| Windows Node 22.x | **UNAVAILABLE** (Node 24.22.1 only) |
| Linux Node 22.x | available on **WSL2** (22.23.3). **Not** native Linux or CI qualification |
| Surviving owned processes after the smoke runs | 0, author-observed (S7c); not a certification |

**Author-reported possible scope deviation (not an approved procedure).** During
the smoke runs the author once registered a temporary per-user AppContainer profile
`odr1hf.spike.canary` (no capabilities) without prior PM approval, then deleted it
(`DeleteAppContainerProfile` hr 0). Post-state: 0 HKCU mapping entries and 0
package folders matching `odr1hf*`. The registry pre-state was **not recorded**.
Other side effects were not checked. It is recorded for PM/PO disposition
(PO-C6-4). C6 prescribes **no** such registration (§27.5.7).

**SG-03 is not closed** by anything in this evidence.

### 30.2 Qualification gates (future; none executed)

**Lifecycle boundary.** These gates run only in a **separately authorized,
independent qualification mission**. That mission comes after the independent
Architecture and Security reviews accept this design, and before any implementation
acceptance. It uses no real provider (PD-R9) and only test-owned listeners,
canaries and synthetic credentials. Methods that inspect credentials across process
boundaries need their own explicit authorization; **this author does not write or
reproduce them**. Results are recorded with artifact hashes by the independent
qualifier (provenance IND-VERIFIED). A class enters the QHM only when all of its
gates pass. A failed gate leaves the class unqualified (refusal), or triggers a STOP
where §31.2 says so.

Common acceptance rules for the termination gates (HQ-L-02 … 06, HQ-L-13, HQ-W-02
… 07): at least 100 repetitions per host class and Node 22.x line. Survivors are
counted by an **external** process audit outside the containment, keyed on
test-owned identities (GWV-02 method). The required survivor count is **0**.
`CONTAINMENT_EMPTY` must never be recorded while any member exists. An unresolved
case must be reported as `CLEANUP_UNRESOLVED` and never as empty.

| Gate | Old probe | Acceptance criterion |
|---|---|---|
| HQ-L-01 | L9 | Launcher present with the qualified version, not setuid, unprivileged user namespace creation succeeds. When made unavailable: refusal before spawn, 0 provider requests, 0 child processes, credential never passed |
| HQ-L-02 | L1 | Worker exits 0: `ready`, `worker-exit 0`, `CONTAINMENT_EMPTY`, monitor exit 0, FT0 acceptance; 0 survivors |
| HQ-L-03 | L2 | Worker ignores `SIGTERM` and IPC loss (busy loop): after the termination request, `CONTAINMENT_EMPTY` within `K_SETTLE`; 0 survivors (H-L-02, H-L-03, H-L-10) |
| HQ-L-04 | L3 | Worker creates descendants (plain, double-forked, `setsid`, one that outlives the leader): emptiness recorded only after the last member is gone; 0 survivors; no member visible outside the namespace (H-L-04, H-L-06, H-L-11) |
| HQ-L-05 | L4, L10 | Parent killed with `SIGKILL` while the worker and descendants are active: external audit finds 0 members; the time to emptiness is measured and reported, not claimed (H-L-05) |
| HQ-L-06 | L5 | Where reproducible, a member in an uninterruptible wait at the termination request: the parent reports `CLEANUP_UNRESOLVED` at `K_SETTLE` and never `CONTAINMENT_EMPTY` early |
| HQ-L-07 | — | Process view: the worker can enumerate and signal only namespace members; the parent and other user processes are not addressable (H-L-07) |
| HQ-L-08 | L6 | Network denial with positive controls: connections from inside to a test listener on host loopback, to a non-loopback test address, and name resolution all fail; the same attempts from outside succeed (H-L-08); PRQ-NET-1 |
| HQ-L-09 | — | No host pathname socket in the filesystem view; abstract sockets isolated (H-L-09) |
| HQ-L-10 | L8 | A test-owned secret canary outside the binds is unreadable; only the PRQ-FS-1 set is readable; only tmpfs is writable |
| HQ-L-11 | L7 | Credential confinement (SG-03) against a synthetic credential by every path in §28.3. **Method requires separate authorization; the author's attempt was BLOCKED** |
| HQ-L-12 | — | FT0 and provider-request exchanges through the sandbox; parent `disconnect` timing; the monitor retains no channel copy (LC-9) |
| HQ-L-13 | — | Fault injection: PID-reuse guard preconditions and the fallback behave per §27.4.3; the fallback always yields `CLEANUP_UNRESOLVED` |
| HQ-L-14 | — | Exit status propagation per LC-5; `exit-code` record precedes the monitor exit (H-L-06) |
| HQ-L-15 | — | All `HQ-L` gates on each **native** Linux class and CI image. WSL2 results are recorded under `linux-wsl2` only |
| HQ-W-01 | W10 | Helper present with its approved identity. When a required control is unavailable: refusal before the worker runs, 0 provider requests, credential never passed |
| HQ-W-02 | W1 | Worker exits 0: `ready`, `worker-exit 0`, purge, `containment-empty` from `ActiveProcesses == 0`, helper exit 0, FT0 acceptance; 0 survivors |
| HQ-W-03 | W2 | Non-cooperative worker: `TerminateJobObject` → `CONTAINMENT_EMPTY` within `K_SETTLE`; 0 survivors (H-W-04) |
| HQ-W-04 | W3 | Descendants, including an attempted `CREATE_BREAKAWAY_FROM_JOB`: breakaway fails; all members end; 0 survivors (H-W-03) |
| HQ-W-05 | W4 | Parent killed while the worker and descendants are active: the helper ends, the job is killed, external audit 0 members; time measured (H-W-02, H-W-11) |
| HQ-W-06 | W5, W6 | No handle to `J` exists outside the helper; `KILL_ON_JOB_CLOSE` is effective on helper death; an inherited or retained handle is shown impossible under the design's attributes |
| HQ-W-07 | W11 | Emptiness only from `ActiveProcesses == 0`; never from completion messages alone; pending-I/O case yields `CLEANUP_UNRESOLVED` where reproducible (H-W-05) |
| HQ-W-08 | — | The AppContainer worker cannot open the parent, the helper or other user processes (H-W-06, H-W-08). Method authorization as HQ-L-11 |
| HQ-W-09 | W7 | Network denial with positive controls, including loopback with no exemption; characterization of DNS-service and broker reachability (H-W-07). Any reachable covert channel is reported to Security |
| HQ-W-10 | W9 | A test-owned file in the user profile is unreadable; only granted paths are readable |
| HQ-W-11 | W8 | Credential confinement (SG-03). **BLOCKED method; separate authorization required** |
| HQ-W-12 | W12 | Interaction with pre-existing jobs (the host shell's `0x1800` job, CI runner jobs): `J` creation, nesting, and termination behave per H-W-01 … H-W-04 |
| HQ-W-13 | — | Node 22.x worker in the AppContainer with IPC handle passing (H-W-09, H-W-10); FT0 receipt/ACK and close-based settlement intact; the helper retains no channel copy |
| HQ-W-14 | — | The AppContainer principal lifecycle and ACL grants follow the PO-C6-2 model; no residue beyond it after cleanup |
| HQ-W-15 | — | All `HQ-W` gates on Node 22.x (unavailable on the author's host) |
| HQ-X-01 | L9, W10 | Unsupported and unqualified classes refuse before spawn: 0 child processes, 0 provider requests (INV-G21) |
| HQ-X-02 | — | Ungoverned compatibility golden on qualified hosts (D-1 … D-5; PRQ-COMPAT-1, PRQ-COMPAT-2) |
| HQ-X-03 | — | Owned-process audit in every suite (GWV-02) |
| HQ-X-04 | — | 0 real provider calls (PD-R9) |

---

## 31. STOP analysis, remaining decisions and reviewer questions

### 31.1 STOP conditions checked by the author

| Mission STOP condition | Result |
|---|---|
| Exact repository identity differs | not triggered (preflight matched every expected SHA) |
| An unapproved public contract change is required | not triggered: candidate codes are proposed only (§29); D-1 … D-5 trace to PD-C6-1 / 3 / 4. D-5 is disclosed for Security |
| Additional privileges or production dependencies committed or mandated without approval | not triggered: launchers are candidates (PD-C6-2); no privilege is required; host security changes on Windows are left to PO-C6-2, not mandated |
| SEC-C1 cannot be met by a concrete specified architecture | not triggered: §27–§28 specify it, conditional on host assumptions with gates |
| Host security assumptions treated as proven | not triggered: every `H-L…` / `H-W…` is ASSUMPTION or SMOKE |
| Another experimental probe needed now | not triggered: qualification is a future, separately authorized lifecycle step (§30.2) |
| Scope beyond three documents | not triggered |
| A security waiver required | not triggered |
| Concurrent work violates WIP = 1 | not triggered (preflight) |

**Conditional STOP triggers, for qualification or review:** (S-1) H-L-04 or H-L-06
refuted, so Linux emptiness needs cgroup delegation; (S-2) the Windows helper's
lifetime cannot be bound to the parent without a persistent service; (S-3)
unresolved states need a supervisor; (S-4) PRQ-COMPAT-1 or PRQ-COMPAT-2 shows a
public difference beyond D-1 … D-5. Each one → PO disposition before work continues.

### 31.2 Remaining PO decisions (identified; not decided here)

| ID | Decision needed | Blocks |
|---|---|---|
| PO-C6-1 | Canonical contract amendment for `HOST_ISOLATION_UNAVAILABLE` and `WORKER_TERMINATION_UNCONFIRMED`, including the exit mapping (5 or 3; 1) and precedence (§29) | implementation |
| PO-C6-2 | Windows AppContainer principal lifecycle (per-run or explicit setup) and the ACL-grant model for runtime and package paths. Both are host security setting changes | Windows qualification |
| PO-C6-3 | Adoption of the launchers as production dependencies after qualification: bubblewrap as a required system package on qualified Linux classes; build, signing, distribution and integrity identity of the Windows helper | implementation |
| PO-C6-4 | Disposition of the author-reported AppContainer profile registration during the BLOCKED spike (§30.1) | evidence acceptance |
| PO-C6-5 | Conditional (S-1 … S-3): any cgroup delegation, persistent supervisor or additional privilege that qualification shows to be unavoidable | the affected platform |
| — | Authorization of the independent qualification mission (§30.2) and of any credential-confinement method | qualification |

PD-R1, PD-R4, PD-R7 and PD-R9 stay open as in §21.1.

### 31.3 Questions for the independent reviewers (C6)

- **Q-C6-1.** Is D-5 acceptable under PD-C6-1 and SG-04? D-5 means the parent's
  runtime TLS and proxy inputs now apply to ungoverned provider traffic.
- **Q-C6-2.** For `HOST_ISOLATION_UNAVAILABLE`, is exit 5 (authority) or exit 3
  (environment configuration) the right existing class?
- **Q-C6-3.** Is the Linux PID-reuse residual R-L-PID acceptable, or must the
  launcher provide PID-descriptor-based termination, which would be a dependency?
- **Q-C6-4.** Should `WORKER_TERMINATION_UNCONFIRMED` take precedence over
  `STAGE_TIMEOUT` (exit 6) and `CHILD_UNRESPONSIVE` (§29)?
- **Q-C6-5.** Ungoverned mode has no time bound before the launcher's `ready`, as
  the baseline has none for child start. Is that acceptable?
- **Q-C6-6.** In ungoverned mode, a worker that delivers a result and then never
  exits keeps the CLI waiting, as in the baseline. It cannot call the provider and
  ends with the CLI. Is that residual acceptable under SEC-C1 (§27.8)?
- **Q-C6-7.** Security: does the candidate scope of Property B (§13.4) and of
  credential separation (§28.3) satisfy SEC-D2 once its gates pass?
