# WP3-B evidence — slice B1: enrollment and compatibility records

| Item | Value |
|---|---|
| Work package | R1 Stage 5 WP3-B, slice B1 (OD-R1-STAGE5-WP3-B-NEXT-1) |
| Base | `main` f93c76d6dcff7c56a963b4e1835faa604604901e, tree a465da20fa45cbab5515244b8569249451384e90 |
| Branch | `feature/r1-stage5-wp3-b-next-1` (local candidate; the PR head identifies the delivered revision) |
| Design inputs | OD-06 §5.2, §5.4, §5.5, §8.2, §11.1; amendment A1, A2, A7.3, A8; existing JavaScript definitions named in §2 |
| Status | Development evidence only. **No runtime qualification is claimed.** Execute stays DISABLED; the crate has no binary and no execution capability |
| Delivery | OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY: one consolidated commit a5124c005cfe5ab8b0c4a08a42187fb49dd7e93a (PR #284). Corrective C1: OD-R1-STAGE5-WP3-B-NEXT-1-C1, one commit on the same branch (§9) |

## 1. Scope and owner decisions

B1-01..06 and AC-B1-01..13 were not defined in the repository. Before implementation the PO adopted the proposed set and decided two §5.2 ambiguities (2026-11-27). These decisions are recorded here under OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY:

| ID | Decision |
|---|---|
| PO-B1-1 | B1-01..06 and AC-B1-01..13 exactly as approved (verbatim below) |
| PO-B1-2 | Enrollment `roots[].root` is the same record as the CREATE request root: `{platform:"linux", path, dev, ino, digest}` |
| PO-B1-3 | Workspace: enforce only the literal rules ("/", controller artifact locations, A7.3 prefixes). "System directory" and per-account home checks stay runtime items, OPEN |
| PO-B1-C1-1 | (C1, ARCH-B1-01) OD-06 §8.2 required fingerprint membership is enforced for both frameworks, as the literal members named by §8.2 and its adapter table; the closure stays profile-enumerated (runtime) |
| PO-B1-C1-2 | (C1, ARCH-B1-01) The fixed Cypress config is exactly root `cypress.config.js` (§2.1 conventional root); other variants do not satisfy the requirement |

### Approved definitions (PO-B1-1), verbatim

These are the definitions the PO approved on 2026-11-27, reproduced unchanged (ARCH-B1-03). They are not amended by any status, mapping or interpretation in this document. Status against them is reported separately in the §8 engineering-check crosswalk.

```text
B1-01 Compatibility record (OD-06 5.4): closed
      {schemaVersion:1, product{name:"qa-ai-agent",
      version SemVer<=64}, contractVersion = compiled
      literal, brokerSha256 H, profileDigest H}
B1-02 compatibilityDigest = H(execution-compatibility
      domain, E(record)); compare with enrollment
B1-03 Enrollment document (5.2): strict JSON <=1 MiB,
      exact keys; caller; workspace; roots<=64 {root,
      projectId, outputDir, framework, sutNames<=32,
      fingerprint via existing verify_enrolled};
      5.5 data rules M2 + overlap rules 1-2 (path bytes)
B1-04 Qualification (5.2, A1): builds, node path/
      version/sha, frameworkProfiles<=2, workloadStorage;
      R1 profile = exactly one playwright entry
B1-05 profileDigest = H(execution-profile domain,
      E(qualification)); compare with record
B1-06 Request/record agreement (5.4 data part):
      request contractVersion + subject.product = record
Not in B1: live checks (C1a, M1/M3/M4, live builds,
      broker self-digest), reason mapping (D-12), disk I/O

AC-B1-01 base f93c76d6/tree a465da20; clean; local branch
AC-B1-02 B1-01..06 inert, data-only, no I/O or OS API
AC-B1-03 only normative rules; ambiguities recorded OPEN
AC-B1-04 closed schemas fail closed; no input echo
AC-B1-05 digests via existing CRS-1/H; JS vectors match
AC-B1-06 focused synthetic tests per item + boundaries
AC-B1-07 existing 65 tests unchanged and passing
AC-B1-08 WSL build/test --locked --offline, 0 warnings
AC-B1-09 Debian Rust 1.85.1 build/test PASS (WP2 VM)
AC-B1-10 A8 budget unchanged; no unsafe/FFI; guard OK
AC-B1-11 no runtime capability/binary/network/creds
AC-B1-12 product/demo/npm/CI/OD-04/OD-06/wire unchanged
AC-B1-13 evidence + readiness matrix updated; open items kept
```

Module placement: B1-01, B1-02 and B1-06 in `compatibility`; B1-03 and B1-04 in `enrollment`; B1-05 in `enrollment` and `compatibility`.

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
| `fingerprint` (§8 fingerprint) | §8.2, A2.1 | existing `fingerprint::verify_enrolled` (Playwright: A2.1 membership; Cypress: §8.2 envelope paths, I-4) | `framework_sut_names_and_fingerprint`, `cypress_roots_require_the_od06_8_2_members` |
| Required fingerprint membership ("Broker checks exact required membership"): Playwright `playwright.config.js`, `package.json`, `package-lock.json`, `node_modules/@playwright/test/package.json`, `node_modules/@playwright/test/cli.js`; Cypress `cypress.config.js`, `package.json`, `package-lock.json`, `node_modules/cypress/package.json`, `node_modules/cypress/bin/cypress` | §8.2 (required list and adapter table), A2.1, §2.1; PO-B1-C1-1/2 | `fingerprint::PLAYWRIGHT_REQUIRED`, `CYPRESS_REQUIRED`, `TreeProfile::required_files` | `refuses_missing_required_files_and_foreign_paths`, `cypress_roots_require_the_od06_8_2_members` |
| M2: every root is W + "/" + segments, R ≠ W | §5.5 | `parse_roots` | `root_placement_and_overlap` |
| Overlap rules 1–2 on path bytes; rule 3 on enrolled identities | §5.5 | `parse_roots` | `root_placement_and_overlap` |
| `qualification` exact keys; `profileVersion` "od06-linux-v1"; builds ≤256 ASCII, no controls; `nodePath` absolute canonical ≤4096; `nodeVersion` exact 22.x.y; `nodeSha256` `H` | §5.2 | `validate_qualification` | `qualification_scalar_rules` |
| `frameworkProfiles` ≤2 unique; paths ≤4096 absolute; versions ≤256 (UTF-8 bytes, no character-set rule); hashes `H`; adapters `od06-cypress-v1`/`od06-playwright-v1` | §5.2 | `parse_profile`, `version_within_limit` | `framework_profile_rules` |
| `workloadStorage` exactly `{fsType ext4/xfs/f2fs, maxBytes 2^30..2^40, minFreeBytes 2^26..maxBytes}` | §5.2 | `parse_workload_storage` | `workload_storage_bounds` |
| R1: exactly one profile, playwright / `od06-playwright-v1` | A1 (§5.4 overlay; "enrollment validation") | `check_r1_profile` | `r1_profile_requires_exactly_one_playwright_profile` |

## 3. Interpretations for review

| ID | Interpretation | Why |
|---|---|---|
| I-1 | Builds: printable ASCII (`0x20..0x7E`), at most 256 bytes. Profile versions (`packageVersion`, `nativeVersion`, `browserVersion`): at most 256 UTF-8 bytes, with no character-set restriction. Empty is not refused for either | "builds<=256 ASCII/no controls" applies to builds only; "versions<=256" states only a length (revised by C1, ARCH-B1-02). The unit is UTF-8 bytes, as for every other OD-06 length bound, and it is the stricter reading. No minimum length is stated |
| I-2 | `nativePath` and `browserPath` use the same canonical absolute path rule as `nodePath` | "paths<=4096 absolute"; a non-canonical path could not be verified as the qualified location |
| I-3 | `frameworkProfiles` are unique by `framework`; `adapterVersion` must be the adapter of that framework | "<=2 unique"; two frameworks, one adapter each |
| I-4 | Cypress roots are schema-valid (A1 keeps the literal). `TreeProfile::CypressRoot` paths follow the OD-06 §8.2 envelope (root limits, existing safe relative path rule, ≤300 bytes, order, `H`, digest), and the §8.2 required literal members must be present (revised by C1, ARCH-B1-01; PO-B1-C1-1/2) | A2 defines the file set F for Playwright only and R1 defers Cypress, so path membership beyond the envelope stays undefined; required membership comes from §8.2 itself |
| I-5 | Two derived checks: enrolled root `dev` equals workspace `dev`; a root must not carry the workspace's own dev/ino | M1 + M4 make the first necessary; rule 3 with W as an ancestor gives the second |
| I-6 | `outputDir` also may not overlap the fixed protected prefixes; equality with the target's configured value and the context-dependent overlaps are runtime checks | A configured `output.dir` can never overlap the fixed prefixes |
| I-7 | Compatibility record parser bound: 262144 bytes, depth 12 (implementation limit) | OD-06 sets no size for `compatibility.json` |
| I-8 | Controller artifact locations: the broker path (A8) and the four §5.2 directories. The `sudoers.d` rule location is not a compiled literal in OD-06 and is not listed | PO-B1-3: literal rules only |
| I-9 | `compatibilityDigest` and `profileDigest` are computed over the parsed, validated objects (CRS-1), so file formatting and key order do not matter | "over this record (§11.1 encoding)"; "hashes qualification (§11)" |

## 4. Test evidence

| Run | Toolchain | Result |
|---|---|---|
| WSL Ubuntu (development), B1 a5124c00 | rustc/cargo 1.93.1 | `cargo build`, `cargo build --release`, `cargo test` with `--locked --offline`: 0 warnings; **88 passed, 0 failed** (65 existing + 23 new) |
| Accepted WP2 VM, B1 a5124c00 (no network device; F-WZ disk flags; new cloud-init instance, no reconfiguration) | Debian rustc/cargo 1.85.1+dfsg1-1+deb13u1 | Same commands as the runner: 0 warnings; **88 passed, 0 failed**; VM disk still 0 unwritten blocks afterwards |
| WSL Ubuntu (development), C1 | rustc/cargo 1.93.1 | Same commands: 0 warnings; **88 passed, 0 failed** |
| Accepted WP2 VM, C1 (instance `wp2-r1-b1-c1-1`; only `lo`; no reconfiguration) | Debian rustc/cargo 1.85.1+dfsg1-1+deb13u1 | Same commands as the runner: 0 warnings; **88 passed, 0 failed**; VM disk still 0 unwritten blocks afterwards |

New suites: `tests/compatibility.rs` (5) and `tests/enrollment.rs` (18), with helpers in `tests/b1_common/`. Golden vectors `tests/vectors/b1-*` (the record, the enrollment, and both digests) were written by the repository's own JavaScript `encodeValue`/`digest`; the Rust tests read the same bytes. All fixture values are synthetic.

C1 vectors: before deriving anything, the generator reproduced the published WP3-A fingerprint digest `sha256:1c1aa7dc…` (encoder parity). It then wrote `tests/vectors/fp-playwright-root.h`, `fp-playwright-root-browser-domain.h` and `fp-cypress-root.h`, and the regenerated `b1-enrollment.json` (whose Playwright root now carries the required entrypoint). It refused to proceed unless `b1-profile.h`, `b1-compatibility.h` and `b1-compatibility-record.json` came out byte-identical: `profileDigest` `sha256:99790619…` and `compatibilityDigest` `sha256:3cd57603…` are unchanged.

## 5. Dependencies and invariants

- `Cargo.toml`, `Cargo.lock`, `vendor/` and `.cargo/` unchanged: `hmac-sha256` 1.1.15 is the only dependency (A8).
- No `unsafe`, FFI, OS-specific API, process, file, network or environment access; no binary.
- `tests/portability.rs` was amended: four exact data names (`"systemdBuild"`, `"sudoBuild"`, `systemd_build`, `sudo_build`) are exempt from the guarded-word scan, in `enrollment.rs` only. They are OD-06 §5.2 qualification key names, not capabilities. Every other use of the guarded words still fails. Disposition: F-B1-01 (§7).
- `request.rs`: the root-record validation moved into `parse_root` (crate-private, shared with the enrollment); request behaviour unchanged (14/14 request tests).
- `fingerprint.rs`: new `TreeProfile::CypressRoot` (I-4). C1 (ARCH-B1-01) makes the §8.2 required literal members mandatory for both root profiles. A Playwright root now also needs `node_modules/@playwright/test/package.json` and `cli.js`, so this deliberately tightens WP3-A behaviour. Membership, limits, ordering, domains and the canonical format are unchanged, and the browser tree is unchanged.
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
| 9 | Fingerprint (A2) | Portable done (WP3-A); Cypress profile (B1); §8.2 required literal members for both frameworks (C1); profile-enumerated closure, live walk D-01 and OQ-2 OPEN |
| 10 | Unit tests | Portable scope done: 88/88 (WSL and Debian 1.85.1) |
| 11 | Architecture + Security review | WP3-A done; B1 HEAVY Architecture review raised ARCH-B1-01..03 (corrected in C1, §9); re-review of C1 and the Security review (including F-B1-01 and I-1..I-9) pending |
| 12 | Debian build of record | Compile and test only (dev and release profiles); reproducible build D-11 OPEN |

D-03: the portable part (enrollment and §5.4 schemas, `profileDigest`/`compatibilityDigest` binding, product-version equality) is implemented by B1; its runtime part stays OPEN. All other D-items, OQ-1, OQ-2, RQ-7, L5, L6, K-1, I5 and Q1–Q7 remain OPEN; OQ-3 and RV-1 NOT_A_FINDING. "System directory"/home checks for the workspace are OPEN (PO-B1-3).

## 7. Findings disposition

| ID | Finding | Disposition |
|---|---|---|
| F-B1-01 | The portability guard (`tests/portability.rs`) refuses the bare guarded words anywhere in `src/`, but OD-06 §5.2 requires the qualification keys `systemdBuild` and `sudoBuild`. The guard was amended with a file-scoped exemption for exactly four tokens in `enrollment.rs` (§5); assembling the names to evade the scan was rejected | **Accepted for independent review** (OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY). This is **not a security waiver**: the HEAVY Security review decides whether the exemption stands, and no guarded capability is permitted by it |
| ARCH-B1-01 | Mandatory fingerprint membership under OD-06 §8.2 was not enforced: Cypress roots required nothing, and Playwright roots required only the three A2.1 root files | **Corrected in C1** (§9): §8.2 required literal members for both frameworks; affected regression tests corrected |
| ARCH-B1-02 | I-1 applied the build-specific "ASCII/no controls" rule to profile versions, for which §5.2 states only "versions<=256" | **Corrected in C1** (§9): versions are limited to ≤256 UTF-8 bytes only; builds unchanged |
| ARCH-B1-03 | The delivery record restated AC-B1-01..13 with status and mapping text mixed into the definitions, and reworded B1-01..06 | **Corrected in C1** (§9): §1 reproduces the approved definitions verbatim; status is in the separate §8 crosswalk |

## 8. Engineering-check crosswalk

This section maps the approved criteria (§1, verbatim) to the checks that evidence them, at the C1 revision. It does not redefine any criterion. Where a criterion is not met as written, it says so.

| AC | Engineering checks | Status at C1 |
|---|---|---|
| AC-B1-01 | Base f93c76d6/tree a465da20 verified before implementation, at delivery (parent of a5124c00) and before C1 (head a5124c00, tree af9e22b5). The branch was pushed under OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY | MET for base and tree. "local branch" was superseded by the authorized delivery |
| AC-B1-02 | `tests/portability.rs` guard; review of `compatibility.rs`, `enrollment.rs` and `fingerprint.rs` (no `std::fs`/`std::net`/`std::process`/`std::env`/`std::os`) | MET |
| AC-B1-03 | §2 normative mapping; I-1..I-9 (§3) open for review; PO-B1-1..3 and PO-B1-C1-1/2 recorded | MET. Review note: `parse_roots` also enforces overlap rule 3 on enrolled identities and the I-5 derived checks, which go beyond the B1-03 text "M2 + overlap rules 1-2". They are stricter, fail-closed and recorded as I-5 |
| AC-B1-04 | `closed_schema_at_every_level`, `closed_record_schema`, `document_size_and_strict_json`; error codes carry no input | MET |
| AC-B1-05 | JS-generated `b1-*` and `fp-*` vectors; JS encoder parity with the WP3-A digest; `profileDigest` and `compatibilityDigest` byte-identical across C1 | MET |
| AC-B1-06 | 23 B1 tests (5 compatibility, 18 enrollment) with boundary values; C1 adds per-member, config-variant and UTF-8 boundary assertions | MET |
| AC-B1-07 | All 65 existing tests pass. Changed since base: `library_source_is_portable_and_capability_free` (F-B1-01), and under C1 ARCH-B1-01 the fingerprint tests `digest_matches_js_reference_and_is_input_order_independent`, `refuses_missing_required_files_and_foreign_paths`, `limits_root_profile`, `total_limit_is_enforced_before_hashing` and `total_limit_exact_boundary`, plus the shared `synthetic_root`/`required` fixtures | **NOT MET as written** ("unchanged"). The changes were made under F-B1-01 (pending review) and the PO-authorized C1 correction. Disposition rests with the PO |
| AC-B1-08 | WSL rustc 1.93.1 dev/release build and test, `--locked --offline` (§4) | MET: 0 warnings, 88/88 |
| AC-B1-09 | Debian rustc 1.85.1 on the accepted WP2 VM (§4) | MET: 0 warnings, 88/88 |
| AC-B1-10 | `Cargo.toml`/`Cargo.lock`/`vendor/`/`.cargo/` unchanged; `#![forbid(unsafe_code)]`; portability guard passes | MET, with the guard amendment subject to F-B1-01 review |
| AC-B1-11 | No binary target; no I/O, network or credential code; Execute DISABLED | MET |
| AC-B1-12 | Changed paths only under `native/qa-agent-controller-v1/` | MET |
| AC-B1-13 | §6 readiness matrix, this crosswalk and §9; open items listed in §6 | MET |

## 9. Corrective C1 (OD-R1-STAGE5-WP3-B-NEXT-1-C1)

Baseline: PR #284 head a5124c005cfe5ab8b0c4a08a42187fb49dd7e93a, tree af9e22b589a69c5a55a01f089cff6b7f5a9b174a.

- **ARCH-B1-01.** `fingerprint::PLAYWRIGHT_REQUIRED` and `CYPRESS_REQUIRED` hold the §8.2 required literal members, and `TreeProfile::required_files` applies them in `validate_entries` and `compute`, so `verify_enrolled` enforces them too. `GenericRoot` is renamed `CypressRoot`. The executable JS/reporter closure, the Playwright/core files and the static config imports are profile-enumerated, so they stay runtime broker checks.
  - Corrected regression tests: the WP3-A synthetic Playwright root gains `node_modules/@playwright/test/cli.js`. Count, total and boundary arithmetic were re-derived (194 → 246 fixture bytes; 4093 → 4091 padding entries; 4089 → 4088 large entries; boundary file 16777022 → 16776970). The JS digests were regenerated, and every required member is tested for absence.
  - The B1 Cypress test is replaced by `cypress_roots_require_the_od06_8_2_members`.
- **ARCH-B1-02.** `version_within_limit` applies only "versions<=256" (UTF-8 bytes) to `packageVersion`, `nativeVersion` and `browserVersion`; the build rule is unchanged. I-1 is revised.
- **ARCH-B1-03.** §1 holds the approved definitions verbatim, §8 holds the status, and the B1 table that reworded the definitions is removed.
- Unchanged: schemas, CRS-1, digest domains, `profileDigest`, `compatibilityDigest`, limits, dependencies, the portability guard and F-B1-01, I-2, I-3, I-5..I-9, and every deferred item in §6.
