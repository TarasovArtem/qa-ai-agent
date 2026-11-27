# WP3-B evidence — slice B1: enrollment and compatibility records

| Item | Value |
|---|---|
| Work package | R1 Stage 5 WP3-B, slice B1 (OD-R1-STAGE5-WP3-B-NEXT-1) |
| Base | `main` f93c76d6dcff7c56a963b4e1835faa604604901e, tree a465da20fa45cbab5515244b8569249451384e90 |
| Branch | `feature/r1-stage5-wp3-b-next-1` (local candidate; the PR head identifies the delivered revision) |
| Design inputs | OD-06 §5.2, §5.4, §5.5, §8.2, §11.1; amendment A1, A2, A7.3, A8; existing JavaScript definitions named in §2 |
| Status | Development evidence only. **No runtime qualification is claimed.** Execute stays DISABLED; the crate has no binary and no execution capability |
| Delivery | OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY: one consolidated commit. The 15 code, test and vector files are byte-identical to the tested candidate (operator-local `CANDIDATE.sha256` 5a9f61f9dd04e2b83f50333e3b4b02e26b5a6bf0275ebd2b15423417c3504c34); only this document changed at delivery (§1 records, §7), so the 88/88 evidence in §4 applies unchanged and was not rerun |

## 1. Scope and owner decisions

B1-01..06 and AC-B1-01..13 were not defined in the repository. Before implementation the PO adopted the proposed set and decided two §5.2 ambiguities (2026-11-27). These decisions are recorded here under OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY:

| ID | Decision |
|---|---|
| PO-B1-1 | B1-01..06 and AC-B1-01..13 as listed below |
| PO-B1-2 | Enrollment `roots[].root` is the same record as the CREATE request root: `{platform:"linux", path, dev, ino, digest}` |
| PO-B1-3 | Workspace: enforce only the literal rules ("/", controller artifact locations, A7.3 prefixes). "System directory" and per-account home checks stay runtime items, OPEN |

| Item | Component | Module |
|---|---|---|
| B1-01 | §5.4 compatibility record: closed model and schema | `compatibility` |
| B1-02 | `compatibilityDigest` = `H(execution-compatibility, E(record))`; comparison with the enrollment | `compatibility` |
| B1-03 | §5.2 enrollment document; data-only §5.5 root rules | `enrollment` |
| B1-04 | §5.2 qualification; amendment A1 R1 profile check | `enrollment` |
| B1-05 | `profileDigest` = `H(execution-profile, E(qualification))`; comparison with the record | `enrollment`, `compatibility` |
| B1-06 | §5.4 request/record agreement (request `contractVersion` and `subject.product` equal the record) | `compatibility` |

Acceptance criteria as approved (PO-B1-1), with the implementation report's mapping:

| AC | Approved criterion | Result | Basis |
|---|---|---|---|
| AC-B1-01 | base f93c76d6/tree a465da20; clean; local branch | PASS | Base, tree and branch verified before implementation and again at delivery |
| AC-B1-02 | B1-01..06 inert, data-only, no I/O or OS API | PASS | §5 |
| AC-B1-03 | only normative rules; ambiguities recorded OPEN | PASS | §2 mapping; I-1..I-9 in §3 are review items |
| AC-B1-04 | closed schemas fail closed; no input echo | PASS | §2 tests |
| AC-B1-05 | digests via existing CRS-1/H; JS vectors match | PASS | §4 golden vectors |
| AC-B1-06 | focused synthetic tests per item + boundaries | PASS | 23 new tests (§4) |
| AC-B1-07 | existing 65 tests unchanged and passing | **Passing; one amended test, disclosed** | All 65 pass; 64 unchanged; `tests/portability.rs` amended (F-B1-01, §7) |
| AC-B1-08 | WSL build/test --locked --offline, 0 warnings | PASS | §4 |
| AC-B1-09 | Debian Rust 1.85.1 build/test PASS (WP2 VM) | PASS | §4 |
| AC-B1-10 | A8 budget unchanged; no unsafe/FFI; guard OK | PASS | §5; guard passes with the F-B1-01 exemption |
| AC-B1-11 | no runtime capability/binary/network/creds | PASS | §5 |
| AC-B1-12 | product/demo/npm/CI/OD-04/OD-06/wire unchanged | PASS | §5 |
| AC-B1-13 | evidence + readiness matrix updated; open items kept | PASS | §6 |

Excluded (runtime or later): reading `enrollment.json`/`compatibility.json`; owner/mode/ancestor checks; §5.5 M1, M3, live M4 and live ancestor identities; comparison of qualification with live host builds; broker self-digest; framework/root/profile agreement at C7; mapping of internal error codes to public reasons (D-12).

## 2. Normative mapping

| Rule | Source | Implementation | Tests |
|---|---|---|---|
| Record keys exactly `{schemaVersion:1, product{name:"qa-ai-agent", version}, contractVersion, brokerSha256, profileDigest}` | §5.4 | `validate_compatibility_record` | `closed_record_schema` |
| `product.version` exact SemVer, ≤64 ASCII, no range or tag | §5.4 | existing `grammar::is_exact_semver` | `closed_record_schema` |
| Record `contractVersion` equals the compiled literal | §5.4 | `Closed::literal(CONTRACT_VERSION)` | `closed_record_schema` |
| `compatibilityDigest` over the record (§11.1 encoding) | §5.4, §11.1 | `h_value(domains::COMPATIBILITY, record)` | `golden_record_validates_with_js_digest`, `digest_is_canonical_and_covers_every_field` |
| Canonical record bytes match the enrollment `compatibilityDigest` | §5.4 | `check_enrollment_binding` | `enrollment_binding` |
| `profileDigest` equals the digest recomputed over the enrollment qualification ("stale qualification") | §5.4, §5.2, §11.1 | `validate_qualification` + `check_enrollment_binding` | `golden_enrollment_validates_with_js_profile_digest`, `profile_digest_is_canonical_and_covers_every_field`, `enrollment_binding` |
| Request `contractVersion` and `subject.product.{name,version}` equal the record | §5.4 | `check_request_agreement` (the literals are fixed by both closed schemas; the version is compared) | `request_record_agreement` |
| Enrollment strict JSON ≤1048576 bytes; exact keys; `schemaVersion` 1; `enabled` boolean; `compatibilityDigest` `H` | §5.2 | `ENROLLMENT_LIMITS`, `validate_enrollment` | `document_size_and_strict_json`, `closed_schema_at_every_level` |
| `caller` uid/gid 1..4294967294; account ≤64 `[A-Za-z0-9_-]+` | §5.2 | `parse_caller`, `grammar::is_account` | `caller_rules` |
| `workspace` canonical absolute ≤4096 (§4.2 path rules); not "/"; not a controller artifact or its ancestor; not at or beneath an A7.3 path; dev/ino decimal | §5.2, A7.3, A8; PO-B1-3 | `parse_workspace` | `workspace_literal_rules`, `system_and_account_home_directories_are_not_data_rules` |
| `roots` ≤64, exact keys | §5.2 | `parse_roots` | `root_count_bounds`, `closed_schema_at_every_level` |
| `roots[].root` | §5.2 "§4 root"; PO-B1-2 | existing request `parse_root` (shared) | `root_placement_and_overlap` |
| `projectId`: existing project ID grammar | §5.2; JS `isValidId` (`scripts/ai/generation/primitives.js`) | `grammar::is_project_id` (UTF-16 length 1..128, ECMAScript trim rule, no `[\x00-\x1F\x7F]`) | `project_id_mirrors_js_is_valid_id` |
| `outputDir`: configured canonical relative ≤300 bytes, safe segments, no `..` | §5.2; JS `isSafeRelativePath`, `pathsOverlap`, `PROTECTED_OUTPUT_PREFIXES` | `grammar::is_enrolled_output_dir` | `output_dir_mirrors_safe_relative_path_and_protected_prefixes` |
| `framework` literal; `sutNames` ≤32 unique SUT names | §5.2, §9.1, §4.2 | `parse_roots`, `parse_sut_names` | `framework_sut_names_and_fingerprint` |
| `fingerprint` (§8 fingerprint) | §8.2, A2.1 | existing `fingerprint::verify_enrolled` (Playwright: A2.1 membership; Cypress: envelope only, I-4) | `framework_sut_names_and_fingerprint`, `cypress_roots_keep_the_schema_literal_with_envelope_only_fingerprints` |
| M2: every root is W + "/" + segments, R ≠ W | §5.5 | `parse_roots` | `root_placement_and_overlap` |
| Overlap rules 1–2 on path bytes; rule 3 on enrolled identities | §5.5 | `parse_roots` | `root_placement_and_overlap` |
| `qualification` exact keys; `profileVersion` "od06-linux-v1"; builds ≤256 ASCII, no controls; `nodePath` absolute canonical ≤4096; `nodeVersion` exact 22.x.y; `nodeSha256` `H` | §5.2 | `validate_qualification` | `qualification_scalar_rules` |
| `frameworkProfiles` ≤2 unique; paths ≤4096 absolute; versions ≤256; hashes `H`; adapters `od06-cypress-v1`/`od06-playwright-v1` | §5.2 | `parse_profile` | `framework_profile_rules` |
| `workloadStorage` exactly `{fsType ext4/xfs/f2fs, maxBytes 2^30..2^40, minFreeBytes 2^26..maxBytes}` | §5.2 | `parse_workload_storage` | `workload_storage_bounds` |
| R1: exactly one profile, playwright / `od06-playwright-v1` | A1 (§5.4 overlay; "enrollment validation") | `check_r1_profile` | `r1_profile_requires_exactly_one_playwright_profile` |

## 3. Interpretations for review

| ID | Interpretation | Why |
|---|---|---|
| I-1 | Builds and profile versions: printable ASCII (`0x20..0x7E`), at most 256 bytes; empty is not refused | "builds<=256 ASCII/no controls"; "versions<=256" names no other charset; no minimum length is stated |
| I-2 | `nativePath` and `browserPath` use the same canonical absolute path rule as `nodePath` | "paths<=4096 absolute"; a non-canonical path could not be verified as the qualified location |
| I-3 | `frameworkProfiles` are unique by `framework`; `adapterVersion` must be the adapter of that framework | "<=2 unique"; two frameworks, one adapter each |
| I-4 | Cypress roots are schema-valid (A1 keeps the literal). Their fingerprint gets the OD-06 §8.2 envelope only (`TreeProfile::GenericRoot`: root limits, existing safe relative path rule, ≤300 bytes, order, `H`, digest); no file set is required | A2 defines the file set for Playwright only; R1 defers Cypress |
| I-5 | Two derived checks: enrolled root `dev` equals workspace `dev`; a root must not carry the workspace's own dev/ino | M1 + M4 make the first necessary; rule 3 with W as an ancestor gives the second |
| I-6 | `outputDir` also may not overlap the fixed protected prefixes; equality with the target's configured value and the context-dependent overlaps are runtime checks | A configured `output.dir` can never overlap the fixed prefixes |
| I-7 | Compatibility record parser bound: 262144 bytes, depth 12 (implementation limit) | OD-06 sets no size for `compatibility.json` |
| I-8 | Controller artifact locations: the broker path (A8) and the four §5.2 directories. The `sudoers.d` rule location is not a compiled literal in OD-06 and is not listed | PO-B1-3: literal rules only |
| I-9 | `compatibilityDigest` and `profileDigest` are computed over the parsed, validated objects (CRS-1), so file formatting and key order do not matter | "over this record (§11.1 encoding)"; "hashes qualification (§11)" |

## 4. Test evidence

| Run | Toolchain | Result |
|---|---|---|
| WSL Ubuntu (development) | rustc/cargo 1.93.1 | `cargo build`, `cargo build --release`, `cargo test` with `--locked --offline`: 0 warnings; **88 passed, 0 failed** (65 existing + 23 new) |
| Accepted WP2 VM (no network device; F-WZ disk flags; new cloud-init instance, no reconfiguration) | Debian rustc/cargo 1.85.1+dfsg1-1+deb13u1 | Same commands as the runner: 0 warnings; **88 passed, 0 failed**; VM disk still 0 unwritten blocks afterwards |

New suites: `tests/compatibility.rs` (5) and `tests/enrollment.rs` (18), with helpers in `tests/b1_common/`. Golden vectors `tests/vectors/b1-*` (the record, the enrollment, and both digests) were written by the repository's own JavaScript `encodeValue`/`digest`; the Rust tests read the same bytes. The generator also reproduced the WP3-A fingerprint vector exactly. All fixture values are synthetic.

## 5. Dependencies and invariants

- `Cargo.toml`, `Cargo.lock`, `vendor/` and `.cargo/` unchanged: `hmac-sha256` 1.1.15 is the only dependency (A8).
- No `unsafe`, FFI, OS-specific API, process, file, network or environment access; no binary.
- `tests/portability.rs` was amended: four exact data names (`"systemdBuild"`, `"sudoBuild"`, `systemd_build`, `sudo_build`) are exempt from the guarded-word scan, in `enrollment.rs` only. They are OD-06 §5.2 qualification key names, not capabilities. Every other use of the guarded words still fails. Disposition: F-B1-01 (§7).
- `request.rs`: the root-record validation moved into `parse_root` (crate-private, shared with the enrollment); request behaviour unchanged (14/14 request tests).
- `fingerprint.rs`: new `TreeProfile::GenericRoot` (I-4); Playwright and browser-tree behaviour unchanged (11/11 fingerprint tests).
- OD-04, OD-06, RC-07, RC-08, the wire contract, product, demo, npm package and CI unchanged.

## 6. Updated WP3 readiness matrix

| # | WP3 requirement (amendment WP3 row) | Status after B1 |
|---|---|---|
| 1 | Framing | Portable part done (WP3-A); runtime I/O D-09 OPEN |
| 2 | Strict JSON parser | Done (WP3-A) |
| 3 | L1 fuzzing | OPEN (D-10; method decision) |
| 4 | C1a integrity gate | **Portable enrollment schema done (B1-03)**; runtime integrity, ownership, effective root, argv and caller checks OPEN |
| 5 | A3 caller authentication | OPEN (runtime; crate-structure decision O-1) |
| 6 | A3 negative vectors on the VM | OPEN |
| 7 | Enrollment/compatibility (§5.4) | **Data part done (B1-01..06)**; broker self-digest, live builds, reading the fixed files and C7 profile agreement OPEN |
| 8 | §5.5/§5.6 checks | **§5.5 data rules done (B1-03)**; live M1/M3/M4, ancestor identities and §5.6 OPEN (D-06) |
| 9 | Fingerprint (A2) | Portable done (WP3-A); Cypress envelope (B1); live walk D-01 and OQ-2 OPEN |
| 10 | Unit tests | Portable scope done: 88/88 (WSL and Debian 1.85.1) |
| 11 | Architecture + Security review | WP3-A done; B1 pending HEAVY review (including F-B1-01 and I-1..I-9) |
| 12 | Debian build of record | Compile and test only (dev and release profiles); reproducible build D-11 OPEN |

D-03: the portable part (enrollment and §5.4 schemas, `profileDigest`/`compatibilityDigest` binding, product-version equality) is implemented by B1; its runtime part stays OPEN. All other D-items, OQ-1, OQ-2, RQ-7, L5, L6, K-1, I5 and Q1–Q7 remain OPEN; OQ-3 and RV-1 NOT_A_FINDING. "System directory"/home checks for the workspace are OPEN (PO-B1-3).

## 7. Findings disposition

| ID | Finding | Disposition |
|---|---|---|
| F-B1-01 | The portability guard (`tests/portability.rs`) refuses the bare guarded words anywhere in `src/`, but OD-06 §5.2 requires the qualification keys `systemdBuild` and `sudoBuild`. The guard was amended with a file-scoped exemption for exactly four tokens in `enrollment.rs` (§5); assembling the names to evade the scan was rejected | **Accepted for independent review** (OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY). This is **not a security waiver**: the HEAVY Security review decides whether the exemption stands, and no guarded capability is permitted by it |
