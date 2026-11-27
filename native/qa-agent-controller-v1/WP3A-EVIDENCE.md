# WP3-A evidence and deferred-requirements matrix

| Item | Value |
|---|---|
| Work package | R1 Stage 5 WP3-A — portable data components (OD-R1-STAGE5-WP3-A, -PREFLIGHT-1, -SHA256-1, -DELIVERY-1; corrective OD-R1-STAGE5-WP3-A-C1) |
| Base | `main` a5a14cfea286df6c487a26ef0f15bff70068a185 |
| Reviewed candidate | PR #280, branch `feature/r1-stage5-wp3-a`, HEAD 3b0e7e1d45b45123fa169469af567292d33b4a06, tree 04e92ee9c904d398b0fc1a80e1c4d0044df74baf, parent a5a14cfe (38 files, +5189) |
| Current revision | Corrective C1: one commit on top of 3b0e7e1d (§8). It changes only `src/frame.rs`, `tests/frame.rs` and this file. A commit cannot name its own hash; the PR head identifies it |
| Design inputs | `docs/controlled-v1-execution-contract-v1.md` (OD-06), `docs/controlled-v1-execution-amendment-r1-v1.md` (A1–A9), OD-04 §11 (CRS-1) and §13 (PPI-1) |
| Status | Development evidence only. **No runtime qualification is claimed.** Execute stays DISABLED: this crate is a library with no binary and no execution capability |

## 1. What this crate is

A Rust library implementing only the portable, deterministic data contracts the future broker (A8) needs:

| Module | Contract | Implemented |
|---|---|---|
| `json` | OD-06 §4.2 strict intake | UTF-8 only; no BOM, NUL (raw or escaped), invalid Unicode or duplicate keys; no trailing content; ≤262144 bytes; depth ≤12; safe integers only, never `-0` |
| `canonical`, `digest` | OD-06 §11.1, OD-04 §11.2 | CRS-1 `E(v)` byte rules; `H` = `sha256:`+hex; `H(domain, E(v))`, excluding the object's own digest field; all OD-06 domains |
| `wire` | OD-06 §4.2, §7.2, §9.2 | Sans-IO client frames (u32 BE + JSON ≤262144) and broker frames (kind 1/2/3; structural ≤262144, raw ≤65536). The length is checked before any payload byte |
| `request` | OD-06 §4.2, §5.4, §9.1, OD-04 §13 | Closed CREATE/RECONCILE schema and grammars: ID, runId, ordinal, `H`, root path/dev/ino, exact SemVer product version, PPI-1 targets (1..100, sorted, unique), timeout, SUT environment |
| `frame` | OD-06 §7.1, §7.2, §11.1, §11.3 | Closed broker frame; disposition, refusal, record and status enums; EXITED observation; unambiguous per-disposition field rules; transition table; frame sequence; identity constancy; raw-frame window. `frameSequence` is an `N` (`0..=2^53-1`) in both serialization and deserialization (C1) |
| `proposal` | OD-06 §11.2, §9.3, §9.4 | Closed result proposal; report limits (≤100, 1..4194304 each, aggregate ≤16777216, sorted); normalized result; checks against bound identities, resultExpected, framework report grammar/count, adapter and exact target paths |
| `fingerprint` | OD-06 §8.2, amendment A2.1–A2.3 | `od06-files-v1`; A2.1 membership; PPI-1 segment grammar for walked names; limits; byte ordering; required root files; fingerprint and browser-tree domains; enrolled `{algorithm, files, digest}` verification |

The library contains no `unsafe` (`#![forbid(unsafe_code)]`) and makes no process, filesystem, network, environment, thread, FFI, systemd, D-Bus or sudo call. `tests/portability.rs` enforces this.

## 2. Dependency inventory and provenance (A8, P-3)

| Check | Result |
|---|---|
| Closure (`cargo tree -e normal,build`) | `hmac-sha256 v1.1.15` only; default features off, so the optional `digest` 0.9/0.10/0.11 dependencies are never resolved |
| `Cargo.lock` | 2 packages: `hmac-sha256` 1.1.15 and this crate |
| Registry checksum | `1ad320b3b96fb2a455a0726d16efe0a5afdbd34b71dea5bc53b05ea057714d4e` = crates.io index = `Cargo.lock` = `vendor/.../.cargo-checksum.json` |
| Upstream identity | `.cargo_vcs_info.json` commit `3f2ad8a97d4d0e46a6eaf7d3323f25aef6d095bd` = upstream tag `1.1.15`; vendored `src/lib.rs` SHA-256 `4774be0974d1b4548273f44f939cbc19b9ce92648a075c5d9ba5aaeaa4693e4f` = upstream file at that tag |
| Licence | ISC |
| Functionality used | `Hash::new`, `update`, `finalize` and `hash` only. HMAC, HKDF and `verify*` are not used |
| `unsafe` in the dependency | One `core::ptr::read_volatile` in its constant-time `verify()` helper; not reached by the functions used |
| Build mode | `.cargo/config.toml` replaces crates.io with `vendor/`; every build and test ran with `--locked --offline` |
| Debian 13 compatibility | Debian 13 ships `rustc` 1.85.x (1.85.1+dfsg1-1+deb13u1). The crate declares `rust-version = "1.85"`, edition 2021 and lockfile v4 (readable by cargo ≥1.78). The dependency is `no_std`, edition 2021. **Compiling on 1.85 is not verified here** (the development toolchain is Ubuntu 1.93.1); see D-14 |

## 3. Test evidence (development toolchain, WSL Ubuntu, rustc/cargo 1.93.1)

`cargo build --locked --offline`, `cargo build --release --locked --offline` and `cargo test --locked --offline`: 0 warnings (`deny(missing_docs, rust_2018_idioms)`); **58 passed, 0 failed** after C1 (54 on the reviewed candidate 3b0e7e1d, plus 4 C1 frame tests).

| Suite | Tests | Covers |
|---|---:|---|
| `json_strict` | 10 | BOM, NUL, UTF-8, surrogates, duplicates, trailing content, exact size/depth limits, integer domain, syntax, no input echo |
| `canonical_digest` | 8 | **Byte-for-byte parity with the repository's JS `encodeValue`/`digest`** (vector files under `tests/vectors/` written by that JS code), round trip, CRS-1 domain refusals, own-digest exclusion, domain separation, SHA-256 known-answer vectors (FIPS 180-2 examples, including one million `a`) |
| `wire` | 3 | Round trip, partial input, oversize length refused before payload, kinds, raw limit |
| `request` | 11 | Closed keys at every level; every grammar and limit, positive and negative |
| `frame` | 13 | Round trip of every disposition; closed keys; field rules; observation rule; status/reason pairs; happy path; every transition, sequence and identity violation; reconcile and malformed intake. C1: `frameSequence` round trip across the valid range (0 to 2^53-1); out-of-range values refused, never wrapped; deserialization admits only `N`; a refused frame leaves the sequence checker unchanged |
| `proposal` | 4 | Structure, counts and totals, report limits and order, identity binding, resultExpected, Cypress/Playwright report grammar and count, adapter, exact spec paths |
| `fingerprint` | 7 | JS-produced golden digest, order independence, membership, required files, all limits (exact boundaries), browser profile, enrolled verification and tamper detection |
| `portability` | 2 | No OS, process, FS, network, FFI or unsafe tokens in `src/`; no binary target; lockfile has exactly one dependency |

All fixtures are synthetic.

**Read-only measurement of real local trees** (evidence for the open questions, not a fixture). With the A2.1 rule applied to `@playwright/test` + `playwright` + `playwright-core` 1.63.0: 11 + 62 + 114 = **187 files, 18,576,425 bytes**, largest 3,477,183 bytes, longest path 72 bytes, 0 special or hard-linked files, **0 PPI-1 segment violations**. This matches the A2.1 design-time measurement exactly. Chromium build 1243: 305 files, 410,251,304 bytes, 0 grammar violations, but the largest file (`chrome-linux64/chrome`) is **293,285,184 bytes** (see OQ-2).

## 4. Contract invariants preserved

- No new public contract element. No new frame, disposition, reason, exit code, CLI option, config key or schema field. Internal error codes are not wire values; their mapping to OD-06 reasons is deferred (D-12).
- Fail-closed throughout. Anything outside the closed schemas is refused, and nothing is repaired or normalized (PPI-1 and root paths are validated, never rewritten).
- Malformed input is never echoed.
- R1 playwright-only stays an eligibility rule (INELIGIBLE), not a schema rule. A Cypress request is schema-valid (OD-06 §4.2) and is refused later by A1.
- npm never builds or installs this directory: `npm pack --dry-run` lists 103 files, none under `native/`. No CI, workflow, release, product or demo file is changed.

## 5. Design questions

Dispositions as of corrective C1 (OD-R1-STAGE5-WP3-A-C1): OQ-1, OQ-2 and RQ-7 are **OPEN**; OQ-3 and RV-1 are **NOT_A_FINDING**. The code behaviour below is unchanged by C1.

| ID | Status | Question | Current code behaviour |
|---|---|---|---|
| OQ-1 | OPEN | OD-06 §7.2 lists only the *required* non-null fields per disposition and says the others are null. Yet TERMINAL carries `invocationId` once bound, and §7.1 echoes `executionId` in every frame. Are `operation`, `unitName`, `attemptDigest` and `observation` null or echoed on frames whose row omits them? This decides what the broker emits (WP4) | Only unambiguous rules are enforced: REFUSED nulls; progress frames' null reason and record; ACCEPTED without invocationId; required fields; status/reason pairs. The ambiguous fields are neither required nor refused |
| OQ-2 | OPEN | A2.3 raises only the browser tree's file count and total. The unchanged per-file limit (16 MiB) cannot hold a real Chromium binary (293 MB measured), so the A2.3 digest is unreachable as written | Fail-closed: the browser profile keeps 16 MiB per file and refuses larger files |
| OQ-3 | NOT_A_FINDING | §9.3 "sums consistent" | Read as per spec `total = passed + failed + skipped`, and `totals` = the sum over specs |
| RQ-7 | OPEN | Amendment RQ-7: identity rule for a RECONCILE final frame at frameSequence 0 that carries `invocationId` | Accepted without a decision (`FrameSequence` treats it as learnable on reconcile only) |
| RV-1 | NOT_A_FINDING | PPI-1 rule 7 (JS classifiers) is argued to follow from rules 1–6 and 8 over the PPI-1 alphabet | Rules 1–6 and 8 are implemented; rule 7 is covered by that implication |

## 6. Deferred-requirements matrix (OPEN; not implemented by WP3-A)

| ID | Requirement | Source | Why deferred | Owner |
|---|---|---|---|---|
| D-01 | Live descriptor-anchored, no-follow, no-mount-crossing fingerprint walk; refusal of symlinks, FIFOs, sockets, devices, hard links and mount roots | A2.1, OD-06 §8.2 | Needs Linux `openat2`/`statx` on the qualified VM | WP3-B |
| D-02 | A3 caller authentication (SO_PEERCRED/SO_PEERPIDFD), C1a integrity gate | A3, OD-06 §5.1–§5.2 | Kernel facility | WP3-B |
| D-03 | Enrollment and §5.4 compatibility record schemas, `profileDigest`/`compatibilityDigest` binding, product-version equality | OD-06 §5.2, §5.4 | Next portable slice; needs a review of the enrollment schema text | WP3-B |
| D-04 | Stage 4 root-identity-v1 digest, `bindingDigest` reconstruction from Stage 4 evidence | OD-06 §4.2, §8.1, §11.1 | Needs Stage 4 evidence and the root-identity algorithm parity | WP3-B/WP4 |
| D-05 | AutomationExecutionRecord v2 full closed schema and `recordDigest`; journal entry, claim, tombstone, transaction, incident, consumed keys | OD-06 §11.2–§11.3 | Large closed schemas tied to the journal | WP4 |
| D-06 | §5.5 root non-overlap; §5.6 namespace, filesystem and workload-storage (B) checks | OD-06 §5.5–§5.6 | Kernel and mount facts | WP3-B |
| D-07 | systemd/sd-bus FFI, transient unit properties, `propertiesDigest` payload, A7 confinement readback | OD-06 §6, A7 | Privileged runtime | WP5 |
| D-08 | Report enumeration of reportsDir, JUnit parsing, §9.3 decision precedence | OD-06 §9.3–§9.4 | Filesystem and runtime | WP4/WP6 |
| D-09 | Intake deadline (5000 ms), non-blocking writes, 5000 ms drain, queue bounds (16 frames / 4 MiB), SIGPIPE | OD-06 §4.2, §7.2, §9.2 | Runtime I/O | WP4 |
| D-10 | L1 fuzzing of the P0 frame parser and the strict JSON parser | A8 | Needs a fuzzing toolchain; A8 forbids rustup, so the tool choice is pending | WP3-B (decision) |
| D-11 | Reproducible build (`SOURCE_DATE_EPOCH`, `--remap-path-prefix`), `brokerSha256`, `qualification.brokerBuild` | A8, OD-06 §5.4 | Build of record on Debian 13 | WP8 |
| D-12 | Mapping of internal error codes to OD-06 refusal and record reasons and exits | OD-06 §9.3, §11.3 | Integration decision | WP4 |
| D-13 | Broker binary, root and `--workload-v1` modes, sudo entry | A8, OD-06 §5.1 | Execution capability; out of WP3-A scope | WP4+ |
| D-14 | Compile and test on Debian 13 `rustc` 1.85 (build-of-record toolchain) | A8, P-2 | The development toolchain is Ubuntu 1.93.1 | WP2 resume/WP3-B |
| D-15 | All qualification evidence (Q1–Q7) | Amendment §2.4 | VM | WP7 |

## 7. Reproduce

```sh
cd native/qa-agent-controller-v1
cargo build --locked --offline
cargo test --locked --offline
cargo tree --locked --offline -e normal,build
```

## 8. Corrective C1 record (OD-R1-STAGE5-WP3-A-C1, 2026-11-27)

Delta on the reviewed candidate 3b0e7e1d (tree 04e92ee9). Files: `src/frame.rs`, `tests/frame.rs`, `WP3A-EVIDENCE.md`. No contract, dependency, CI, product or demo change.

| Finding | Defect | Correction | Evidence |
|---|---|---|---|
| ARCH-WP3A-01 | Asymmetric `frameSequence` handling. Deserialization admitted only an OD-06 §11.1 `N` (`0..=2^53-1`), but serialization converted the `u64` with `as i64`: `u64::MAX` encoded as `"frameSequence":-1`, and values above 2^53-1 failed later with an unrelated canonical-encoder error | `MAX_FRAME_SEQUENCE` = 2^53-1 is applied in both directions. `validate_fields` refuses larger values (`FRAME_SEQUENCE_RANGE`). `to_value` now returns `Result` and converts losslessly or refuses. `from_value` converts with a checked conversion under the same bound. `FrameSequence::accept` computes the next sequence with a checked add before mutating any state | 4 tests in `tests/frame.rs`: the round trip across the range (0, 1, …, 2^32-1, 2^53-2, 2^53-1) is byte-identical and value-identical; 2^53, `i64::MAX`, 2^63 and `u64::MAX` are refused by validate/to_value/encode; the parser refuses -1, 2^53, 2^64-1, `-0`, `0.0`, `1e0`, `00`, `"0"`, null and bool; a refused frame leaves the sequence checker usable |
| ARCH-WP3A-02 | Stale evidence metadata (the base row said "local, not committed"; no reviewed-candidate identity; no corrective record) | Header rows for the reviewed candidate and the current revision; test counts; design-question dispositions; this record | This file |

Unchanged by C1: the dependency budget (`hmac-sha256` 1.1.15 only, same `Cargo.lock`); every other module; the wire format of every in-range frame (the encoding of `frameSequence` values in `0..=2^53-1` is byte-identical); OQ-1, OQ-2 and RQ-7 OPEN; D-01..D-15 OPEN; execute DISABLED; no runtime qualification claim.
