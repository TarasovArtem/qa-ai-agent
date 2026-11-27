# WP3-B evidence — slice B1: enrollment and compatibility records

| Item | Value |
|---|---|
| Work package | R1 Stage 5 WP3-B, slice B1 (OD-R1-STAGE5-WP3-B-NEXT-1) |
| Base | `main` f93c76d6dcff7c56a963b4e1835faa604604901e, tree a465da20fa45cbab5515244b8569249451384e90 |
| Branch | `feature/r1-stage5-wp3-b-next-1` (local candidate; the PR head identifies the delivered revision) |
| Design inputs | OD-06 §5.2, §5.4, §5.5, §8.2, §11.1; amendment A1, A2, A7.3, A8; existing JavaScript definitions named in §2 |
| Status | Development evidence only. **No runtime qualification is claimed.** Execute stays DISABLED; the crate has no binary and no execution capability |
| Delivery | OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY: one consolidated commit a5124c005cfe5ab8b0c4a08a42187fb49dd7e93a (PR #284). Corrective C1: OD-R1-STAGE5-WP3-B-NEXT-1-C1, commit b4c1ef31da6b025641e8f47fee314b691d13be2d (§9). Corrective C2: OD-R1-STAGE5-WP3-B-NEXT-1-C2, documentation only (§10) |

## 1. Scope and owner decisions

B1-01..06 were not defined in the repository. Before implementation the PO adopted the proposed component set and decided two §5.2 ambiguities (2026-11-27). The acceptance criteria are the authoritative AC-B1-01..13 recorded under OD-R1-STAGE5-WP3-B-NEXT-1-C2 (below). These decisions are recorded here:

| ID | Decision |
|---|---|
| PO-B1-1 | B1-01..06 as listed below (component scope). The acceptance criteria are not part of this decision: see "Authoritative acceptance criteria" |
| PO-B1-2 | Enrollment `roots[].root` is the same record as the CREATE request root: `{platform:"linux", path, dev, ino, digest}` |
| PO-B1-3 | Workspace: enforce only the literal rules ("/", controller artifact locations, A7.3 prefixes). "System directory" and per-account home checks stay runtime items, OPEN |
| PO-B1-C1-1 | (C1, ARCH-B1-01) OD-06 §8.2 required fingerprint membership is enforced for both frameworks, as the literal members named by §8.2 and its adapter table; the closure stays profile-enumerated (runtime) |
| PO-B1-C1-2 | (C1, ARCH-B1-01) The fixed Cypress config is exactly root `cypress.config.js` (§2.1 conventional root); other variants do not satisfy the requirement |

### Component scope (PO-B1-1), verbatim

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
```

The B1-03 text names "M2 + overlap rules 1-2". The implementation also enforces overlap rule 3 on enrolled identities and the I-5 derived checks. Architecture resolved this as R-C1-1 (§7).

### Authoritative acceptance criteria (OD-R1-STAGE5-WP3-B-NEXT-1-C2)

These are the exact authoritative definitions (ARCH-B1-03). They replace the AC text recorded at delivery and in C1, which was incorrect, and no status, mapping or interpretation in this document amends them. Status is reported separately in the §8 engineering-check crosswalk.

```text
AC-B1-01: Exact baseline verified.
AC-B1-02: Models conform to unambiguous OD-06 requirements.
AC-B1-03: Existing schemas and data formats unchanged.
AC-B1-04: Existing canonical encoding infrastructure reused.
AC-B1-05: A8 dependency budget preserved.
AC-B1-06: Existing 65 regression tests pass.
AC-B1-07: New applicable synthetic tests pass.
AC-B1-08: WSL and Debian Rust 1.85.1 builds pass.
AC-B1-09: Portability and security boundaries preserved.
AC-B1-10: No runtime capabilities.
AC-B1-11: Product, npm package and demo unchanged.
AC-B1-12: Evidence and readiness matrix updated.
AC-B1-13: Execute DISABLED.
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

## 3. Interpretations

I-1, I-4 and I-5 are ACCEPTED (Architecture). I-2, I-3 and I-6..I-9 remain review items.

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
| 11 | Architecture + Security review | WP3-A done. B1 Architecture: ARCH-B1-01 and ARCH-B1-02 RESOLVED (C1); ARCH-B1-03 corrected in C2, pending Architecture confirmation; R-C1-1 resolved; I-1, I-4, I-5 ACCEPTED. B1 Security review (including F-B1-01) PENDING |
| 12 | Debian build of record | Compile and test only (dev and release profiles); reproducible build D-11 OPEN |

D-03: the portable part (enrollment and §5.4 schemas, `profileDigest`/`compatibilityDigest` binding, product-version equality) is implemented by B1; its runtime part stays OPEN. All other D-items, OQ-1, OQ-2, RQ-7, L5, L6, K-1, I5 and Q1–Q7 remain OPEN; OQ-3 and RV-1 NOT_A_FINDING. "System directory"/home checks for the workspace are OPEN (PO-B1-3).

## 7. Findings disposition

| ID | Finding | Disposition |
|---|---|---|
| F-B1-01 | The portability guard (`tests/portability.rs`) refuses the bare guarded words anywhere in `src/`, but OD-06 §5.2 requires the qualification keys `systemdBuild` and `sudoBuild`. The guard was amended with a file-scoped exemption for exactly four tokens in `enrollment.rs` (§5); assembling the names to evade the scan was rejected | **Accepted for independent review** (OD-R1-STAGE5-WP3-B-NEXT-1-DELIVERY). This is **not a security waiver**. **Security review PENDING**: it decides whether the exemption stands, and no guarded capability is permitted by it |
| ARCH-B1-01 | Mandatory fingerprint membership under OD-06 §8.2 was not enforced: Cypress roots required nothing, and Playwright roots required only the three A2.1 root files | **RESOLVED** (C1, §9): §8.2 required literal members for both frameworks; affected regression tests corrected |
| ARCH-B1-02 | I-1 applied the build-specific "ASCII/no controls" rule to profile versions, for which §5.2 states only "versions<=256" | **RESOLVED** (C1, §9): versions are limited to ≤256 UTF-8 bytes only; builds unchanged |
| ARCH-B1-03 (MINOR) | The evidence record carried incorrect AC-B1-01..13 definitions. C1 had reproduced the drafted list adopted at implementation instead of the authoritative criteria | **Corrected in C2** (§10): §1 holds the authoritative definitions exactly; §8 crosswalk rebuilt. Pending Architecture confirmation |
| R-C1-1 | The B1-03 text names "M2 + overlap rules 1-2", while `parse_roots` also enforces overlap rule 3 on enrolled identities and the I-5 derived checks | **RESOLVED by Architecture** (I-5 ACCEPTED); no code change |

### OD-R1-STAGE5-WP3-B-C1-AC07: existing regression-test amendments

Recorded separately from the acceptance criteria.

| Amendment | Tests | Disposition |
|---|---|---|
| C1 ARCH-B1-01 fingerprint corrections (with the shared `synthetic_root`/`required` fixtures) | `digest_matches_js_reference_and_is_input_order_independent`, `refuses_missing_required_files_and_foreign_paths`, `limits_root_profile`, `total_limit_is_enforced_before_hashing`, `total_limit_exact_boundary` | **APPROVED** (five fingerprint-test amendments) |
| Portability guard exemption for four §5.2 data names in `enrollment.rs` | `library_source_is_portable_and_capability_free` | **Subject to Security disposition F-B1-01** (pending) |

## 8. Engineering-check crosswalk

This section maps each authoritative criterion (§1) to the checks that evidence it, at the C2 revision. It does not redefine any criterion. Evidence from C1 is reused only because C2 changes no source, test, vector or dependency file (§10).

| AC | Engineering checks | Status at C2 |
|---|---|---|
| AC-B1-01 Exact baseline verified | Implementation base f93c76d6/tree a465da20; delivery a5124c00 (parent f93c76d6); C1 baseline a5124c00/af9e22b5; C2 baseline b4c1ef31/e6220920. Each was checked locally and on the remote before change | MET |
| AC-B1-02 Models conform to unambiguous OD-06 requirements | §2 normative mapping (OD-06 §5.2, §5.4, §5.5, §8.2, §11.1; A1, A2, A7.3, A8); ARCH-B1-01 and ARCH-B1-02 RESOLVED; ambiguous text decided by PO-B1-2/3 and PO-B1-C1-1/2 or recorded as I-1..I-9 | MET. I-1, I-4, I-5 ACCEPTED; I-2, I-3, I-6..I-9 remain review items |
| AC-B1-03 Existing schemas and data formats unchanged | OD-04, OD-06 and the wire/request schema unchanged (request tests 14/14); CRS-1 encoder and digest domains unchanged; fingerprint canonical object `{algorithm, files}` unchanged; `profileDigest` 99790619… and `compatibilityDigest` 3cd57603… byte-identical across C1. C1 enforces required membership; it adds no key or format | MET |
| AC-B1-04 Existing canonical encoding infrastructure reused | `canonical` and `digest::h_value`, `fingerprint::verify_enrolled` and the request `parse_root` reused; golden vectors written by the repository's JS encoder, with parity against the WP3-A digest (§4) | MET |
| AC-B1-05 A8 dependency budget preserved | `Cargo.toml`, `Cargo.lock`, `vendor/`, `.cargo/` unchanged since base; `hmac-sha256` 1.1.15 the only dependency | MET |
| AC-B1-06 Existing 65 regression tests pass | 65/65 pass in WSL 1.93.1 and on Debian 1.85.1 (§4). Amendments are recorded in OD-R1-STAGE5-WP3-B-C1-AC07 (§7) | MET. The portability-guard amendment remains subject to F-B1-01 |
| AC-B1-07 New applicable synthetic tests pass | 23/23 B1 tests (5 compatibility, 18 enrollment) pass; all fixtures synthetic | MET |
| AC-B1-08 WSL and Debian Rust 1.85.1 builds pass | WSL rustc 1.93.1 and Debian rustc 1.85.1+dfsg1-1+deb13u1 (accepted WP2 VM): dev and release builds and tests, `--locked --offline`, 0 warnings, 88/88 (§4, C1 runs) | MET |
| AC-B1-09 Portability and security boundaries preserved | `#![forbid(unsafe_code)]`; no `std::fs`/`net`/`process`/`env`/`os` in `src/`; portability guard passes; fail-closed checks unchanged or tightened (C1) | MET, subject to Security disposition F-B1-01 for the guard amendment |
| AC-B1-10 No runtime capabilities | Library crate only, no binary target; no I/O, process, network or credential code | MET |
| AC-B1-11 Product, npm package and demo unchanged | All changed paths are under `native/qa-agent-controller-v1/`. The npm `files` allowlist (`package.json`) contains only `scripts/ai/**`, so the package is unaffected; no product or demo path changed | MET |
| AC-B1-12 Evidence and readiness matrix updated | This document: §6 readiness matrix, §7 dispositions, this crosswalk, §9 and §10 | MET |
| AC-B1-13 Execute DISABLED | No execution capability exists in the crate; product execute state untouched | MET |

## 9. Corrective C1 (OD-R1-STAGE5-WP3-B-NEXT-1-C1)

Baseline: PR #284 head a5124c005cfe5ab8b0c4a08a42187fb49dd7e93a, tree af9e22b589a69c5a55a01f089cff6b7f5a9b174a.

- **ARCH-B1-01.** `fingerprint::PLAYWRIGHT_REQUIRED` and `CYPRESS_REQUIRED` hold the §8.2 required literal members, and `TreeProfile::required_files` applies them in `validate_entries` and `compute`, so `verify_enrolled` enforces them too. `GenericRoot` is renamed `CypressRoot`. The executable JS/reporter closure, the Playwright/core files and the static config imports are profile-enumerated, so they stay runtime broker checks.
  - Corrected regression tests: the WP3-A synthetic Playwright root gains `node_modules/@playwright/test/cli.js`. Count, total and boundary arithmetic were re-derived (194 → 246 fixture bytes; 4093 → 4091 padding entries; 4089 → 4088 large entries; boundary file 16777022 → 16776970). The JS digests were regenerated, and every required member is tested for absence.
  - The B1 Cypress test is replaced by `cypress_roots_require_the_od06_8_2_members`.
- **ARCH-B1-02.** `version_within_limit` applies only "versions<=256" (UTF-8 bytes) to `packageVersion`, `nativeVersion` and `browserVersion`; the build rule is unchanged. I-1 is revised.
- **ARCH-B1-03.** C1 separated the status into §8 and removed the reworded B1 table. However, the AC text it recorded was not the authoritative set, so it did not resolve the finding. C2 corrects it (§10).
- Unchanged: schemas, CRS-1, digest domains, `profileDigest`, `compatibilityDigest`, limits, dependencies, the portability guard and F-B1-01, I-2, I-3, I-5..I-9, and every deferred item in §6.

## 10. Corrective C2 (OD-R1-STAGE5-WP3-B-NEXT-1-C2)

Baseline: PR #284 head b4c1ef31da6b025641e8f47fee314b691d13be2d, tree e62209206cd0394a276c59fcfb315f5df4e0a1a5. Documentation only: this file is the only changed path.

- ARCH-B1-03 (MINOR): §1 now holds the exact authoritative AC-B1-01..13, replacing the incorrect definitions, and the §8 crosswalk is rebuilt against them.
- OD-R1-STAGE5-WP3-B-C1-AC07 is recorded separately (§7): five fingerprint-test amendments APPROVED; the portability guard amendment remains subject to Security disposition F-B1-01.
- R-C1-1 is recorded as resolved by Architecture. I-1, I-4 and I-5 are ACCEPTED, and ARCH-B1-01 and ARCH-B1-02 are RESOLVED. The affected status statements in §3, §6 row 11, §7 and §9 are corrected.
- Evidence reuse: source, tests, vectors and dependency inputs are byte-identical to C1 (b4c1ef31), so the C1 WSL and Debian 88/88 runs (§4) apply unchanged. Rust builds and tests were not rerun.
- Unchanged and still OPEN: F-B1-01 Security review, I-2, I-3, I-6..I-9, every deferred item in §6. Execute DISABLED.
