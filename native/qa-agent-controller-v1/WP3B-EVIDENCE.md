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

## 11. Post-merge lifecycle record (2026-11-27)

- PO authority: `OD-R1-STAGE5-WP3-B-NEXT-1-MERGE` and `OD-R1-STAGE5-WP3-B-NEXT-1-CLOSURE` APPROVED.
- [PR #284](https://github.com/TarasovArtem/qa-ai-agent/pull/284): B1 portable scope MERGED / POST-MERGE CERTIFIED. Reviewed HEAD `a9f1bb11a7e5af4b52c6fd88ffabf0c230b5e10a`, TREE `37422e538af88f961049f2b504d41622cbc241e2`.
- Supplied exact-head Architecture and HEAVY Security verdicts APPROVED; ARCH-B1-01..03, R-C1-1 and F-B1-01 RESOLVED; I-1..I-9 ACCEPTED. This supersedes pending review statements in earlier sections for this exact implementation only. No waiver.
- Exact-head [PR CI](https://github.com/TarasovArtem/qa-ai-agent/actions/runs/46022234985) 7/7 SUCCESS. Merge `2df4dfdeaa745a6c7b0b1696ca4278d36d4969eb`, STANDARD_TWO_PARENT; parents `f93c76d6dcff7c56a963b4e1835faa604604901e` and reviewed HEAD; merge TREE equals reviewed TREE. Fresh automatic [push CI](https://github.com/TarasovArtem/qa-ai-agent/actions/runs/46026550328) on exact merge SHA/main, attempt 1, 7/7 SUCCESS. GitHub identities and CI verified by PM.
- Accepted reported WSL and Debian builds and 88/88 tests (65 regression + 23 new); no Rust job in repository CI, no independent rerun. All AC-B1-01..13 accepted for B1 scope, including F-B1-01 disposition.
- All deferred requirements retain their existing OPEN dispositions, including runtime D-03, OQ-1/OQ-2/RQ-7, L5/L6/K-1, carried Security I5, Q1–Q7. OQ-3 and RV-1 remain NOT_A_FINDING. Full WP3 INCOMPLETE; no runtime qualification, execution activation, or release approval. Further WP3-B implementation and WP4–WP9 require separate authority. Execute DISABLED; TPR SUSPENDED / NOT RELEASED; Issue #199 OPEN; WIP = 1.

## 12. Slice B2: portable execution binding (OD-R1-STAGE5-WP3-B-NEXT-2)

| Item | Value |
|---|---|
| Authority | OD-R1-STAGE5-WP3-B-NEXT-2 (APPROVED) |
| Base | `main` 3f846729a40d9676021cc37f2f7b7953d4364865, tree 098416df940677a1662f2c12db1de153b45c93e1 (B1 merged and closed, §11) |
| Branch | `feature/r1-stage5-wp3-b-next-2` (local candidate; delivery needs separate PO authorization) |
| Objective | The portable, inert data-model subset of D-04 ("Stage 4 root-identity-v1 digest, `bindingDigest` reconstruction from Stage 4 evidence", `WP3A-EVIDENCE.md`) |
| Design inputs | OD-06 §4.2, §4.3 items 2–3, §8.1, §11.1; amendment A2.2; Stage 4 approval/apply contract §17.2 (`root-identity-v1`) and its implementation `scripts/ai/cli/stage4-principal.js`; Stage 4 `review-record-v2` principal envelope (`scripts/ai/cli/review-record-v2.js`) |
| Status | Development evidence only. **No runtime qualification is claimed.** No validation result is execution authority. Execute stays DISABLED |

### 12.1 Components and owner decisions

Components (mission text): B2-01 root identity data model conforming to Stage 4; B2-02 closed execution binding data model; B2-03 reuse existing CRS-1 canonical infrastructure; B2-04 data consistency and integrity validation only; B2-05 synthetic unit tests and canonical parity evidence; B2-06 update evidence and readiness matrix.

| ID | Decision (2026-11-27) |
|---|---|
| PO-B2-1 | `binding.root` is the OD-06 §4.2 root record `{platform:"linux", path, dev, ino, digest}` (the existing crate `parse_root`, the same record as the CREATE request root and the B1 enrollment root), not the Stage 4 `repositoryRoot {method, digest}` object |
| PO-B2-2 | The Stage 4 `root-identity-v1` digest check is standalone (`root_identity::verify`), used by the B2 binding and agreement checks. The existing request and enrollment validators, fixtures and tests are unchanged; wiring the check into them is an open integration item |

### 12.2 Acceptance criteria (immutable, as issued)

```text
AC-B2-01: Exact baseline verified.
AC-B2-02: Models conform to unambiguous OD-06 requirements.
AC-B2-03: Existing Stage 4 formats unchanged.
AC-B2-04: Existing canonical infrastructure reused.
AC-B2-05: A8 dependency budget preserved.
AC-B2-06: Existing 88 regression tests pass.
AC-B2-07: New applicable synthetic tests pass.
AC-B2-08: WSL and Debian builds pass.
AC-B2-09: No runtime capabilities or new execution authority.
AC-B2-10: Evidence and readiness matrix updated.
AC-B2-11: Product, npm package and demo unchanged.
AC-B2-12: Execute DISABLED.
```

Status is reported only in the §12.7 crosswalk.

### 12.3 Normative mapping

| Rule | Source | Implementation | Tests (`tests/binding.rs`) |
|---|---|---|---|
| `rootIdentity` = `{identityVersion:1, platform, rootPath, dev, ino}`; digest = `H("qa-ai-agent:repository-root-binding:v1:", E(rootIdentity))`; POSIX `rootPath` is the native path as returned | Stage 4 §17.2 step 1.3 and step 3; OD-06 §4.2 "digest=H matching Stage 4 root-identity-v1"; §11.1 "Existing Stage 4 domains/bytes unchanged" | `root_identity::{identity_value, digest, verify}`, `digest::domains::REPOSITORY_ROOT_BINDING` | `stage4_root_identity_golden_parity`, `root_identity_covers_every_field` |
| `binding` exactly the 21 keys, every key required, no other key | §11.1 | `binding::BINDING_KEYS`, `validate_binding` | `closed_schema_at_every_level` |
| `projectId` existing generation ID grammar; `runId`, `packageOrdinal` §4.2; `product` `{name:"qa-ai-agent", version}`; review/apply IDs ID; digests `H`; targets §4; framework literal; `timeoutMs` 1000..600000 | §11.1, §4.2 | existing `grammar::*`, request `parse_root` and `parse_targets` (shared, behaviour unchanged), `request::limits::TIMEOUT_MS` | `field_grammars_reuse_existing_rules` |
| `principal` is the exact Stage 4 OS-local envelope `{method:"os-local-account-v1", principal ("os-account-v1:" + valid ID), uid, profileDigest, platform, assurance:"LOCAL_ACCOUNT_ATTRIBUTION"}`; win32: uid null and profileDigest `H`; otherwise uid safe integer ≥1 and profileDigest null | §11.1 "principal exact Stage 4 OS-local envelope"; Stage 4 `review-record-v2` reviewer rules | `binding::parse_principal` | `principal_is_the_exact_stage4_envelope_for_the_linux_root` |
| `root.digest` matches Stage 4 `root-identity-v1` | §4.2 | `root_identity::verify` in `validate_binding` | `root_must_be_root_identity_v1_consistent` |
| `bindingDigest` = `H("qa-ai-agent:execution-binding:v1:", E(binding without bindingDigest))` | §11.1 | existing `digest::h_value_excluding` via `compute_binding_digest` | `golden_binding_validates_with_js_digest`, `digest_is_canonical_and_covers_every_field` |
| Request carries the binding's `bindingDigest`; shared request fields equal | §4.2 subject, §4.3 item 3, §8.1 item 7 | `check_request_agreement` | `request_agreement` |
| Binding `profileDigest` is the §5.4 record's | §11.1 | `check_record_agreement` | `compatibility_record_agreement` |
| Binding root is an enrolled root; enrolled `framework` and `fingerprint.digest` agree | §4.3 item 2, §4.2 framework agreement, amendment A2.2 | `check_enrollment_agreement` | `enrollment_agreement` |

### 12.4 Interpretations for review

| ID | Interpretation | Why |
|---|---|---|
| I-B2-1 | `binding.root` is the §4.2 root record | PO-B2-1 |
| I-B2-2 | The `root-identity-v1` check is standalone; `validate_request` and enrollment parsing still check only the digest format | PO-B2-2; avoids changing existing behaviour, fixtures and the 88 tests |
| I-B2-3 | `binding.product.version` uses the exact SemVer grammar of the request and §5.4, not the looser Stage 4 `review-record-v2` product regex | §4.2 requires the "exact enrolled version", and a binding must agree with the request (§4.3 item 3); the looser grammar could never yield an agreeing binding |
| I-B2-4 | The principal envelope is validated exactly as Stage 4 does for every Stage 4 platform; a valid envelope whose platform is not `linux` is then refused (`BINDING_PRINCIPAL_PLATFORM`) | §4.2 root platform is the literal `linux`; §8.1 item 4 rechecks "caller principal/root" together |
| I-B2-5 | Request agreement compares `bindingDigest` and every field the request shares with the binding (subject, root, framework, targets, timeout); `environment` is request-only and not bound | §4.3 item 3, §8.1 item 7; §11.1 key list has no environment |
| I-B2-6 | Enrollment agreement also requires the enrolled `projectId` to equal the binding's | Derived: an enrolled root belongs to one project (§5.2). Stricter, fail-closed |
| I-B2-7 | Binding intake bound: the §4.2 frame limits (262144 bytes, depth 12) | Implementation limit; OD-06 sets no binding size |
| I-B2-8 | `bindingDigest` is computed over the parsed, validated value (CRS-1), so key order and formatting do not matter | As I-9 for B1 |
| I-B2-9 | Stage 4 `rootPath` for a §4.2 record is its `path` unchanged | Stage 4 §17.2 step 1.3 (POSIX path used as returned); the record platform is `linux` |

### 12.5 Test and parity evidence

| Run | Toolchain | Result |
|---|---|---|
| WSL Ubuntu (development) | rustc/cargo 1.93.1 | `cargo build`, `cargo build --release`, `cargo test` with `--locked --offline`: 0 warnings; **99 passed, 0 failed** (88 existing + 11 new) |
| Accepted WP2 VM (instance `wp2-r1-b2-1`; only `lo`; F-WZ disk flags; no reconfiguration) | Debian rustc/cargo 1.85.1+dfsg1-1+deb13u1 | Same commands as the runner: 0 warnings; **99 passed, 0 failed**; VM disk still 0 unwritten blocks afterwards |

Canonical parity: the vectors `tests/vectors/b2-*` were written by the repository's own JavaScript.
- The generator first reproduced the published Stage 4 golden `sha256:23082e5b…` with `stage4-principal.rootDigest`.
- It derived the binding root digest with the same function and the principal with `resolvePrincipal`.
- It computed `bindingDigest` with CRS-1 `encodeValue`/`digest`.
- The Rust tests reproduce the Stage 4 golden serialization byte for byte and match the JS root and binding digests.
- The existing B1 vectors were read, not rewritten.

### 12.6 Invariants

- `Cargo.toml`, `Cargo.lock`, `vendor/` and `.cargo/` unchanged: `hmac-sha256` 1.1.15 is the only dependency (A8).
- No `unsafe`, FFI, OS-specific API, process, file, network or environment access; no binary; portability guard passes unchanged.
- `request.rs`: the targets validation moved into `parse_targets` (crate-private, shared with the binding); request behaviour is unchanged (14/14 request tests).
- No existing test, fixture or vector changed. The new error kinds (`RootIdentity`, `Binding`) and codes are internal; mapping them to public reasons stays D-12.
- OD-04, OD-06, the Stage 4 formats and domains, the wire contract, product, demo, npm package (its `files` allowlist covers only `scripts/ai/**`) and CI are unchanged.

### 12.7 Engineering-check crosswalk (B2)

| AC | Engineering checks | Status |
|---|---|---|
| AC-B2-01 Exact baseline verified | `origin/main` = 3f846729…, tree 098416df…, checked before branching; the branch starts at that commit | MET |
| AC-B2-02 Models conform to unambiguous OD-06 requirements | §12.3 mapping. The one material ambiguity (`binding.root` shape) was decided by PO-B2-1 before implementation; the other readings are recorded as I-B2-1..9 | MET; I-B2-1..9 for review |
| AC-B2-03 Existing Stage 4 formats unchanged | No Stage 4 file changed; the Stage 4 domain and `rootIdentity` bytes are reproduced, not redefined (golden parity) | MET |
| AC-B2-04 Existing canonical infrastructure reused | `canonical::encode`, `digest::h_value` and `h_value_excluding`, request `parse_root` and `parse_targets` and the existing grammars | MET |
| AC-B2-05 A8 dependency budget preserved | Dependency inputs unchanged | MET |
| AC-B2-06 Existing 88 regression tests pass | 88/88 pass unchanged (WSL; Debian §12.5) | MET |
| AC-B2-07 New applicable synthetic tests pass | 11/11 in `tests/binding.rs` | MET |
| AC-B2-08 WSL and Debian builds pass | §12.5: WSL rustc 1.93.1 and Debian rustc 1.85.1, dev and release, `--locked --offline`, 0 warnings | MET |
| AC-B2-09 No runtime capabilities or new execution authority | Library only; functions return data or a refusal; module docs state that no result is execution authority | MET |
| AC-B2-10 Evidence and readiness matrix updated | This section and §12.8 | MET |
| AC-B2-11 Product, npm package and demo unchanged | All changes are under `native/qa-agent-controller-v1/` | MET |
| AC-B2-12 Execute DISABLED | No execution capability; product state untouched | MET |

### 12.8 Updated WP3 readiness (after B2)

| WP3 / deferred item | Status after B2 |
|---|---|
| D-04 Stage 4 root-identity-v1 and `bindingDigest` | **Portable subset done (B2)**: data-only `root-identity-v1` digest, closed binding, `bindingDigest`, request/record/enrollment agreements. **OPEN**: reconstruction from fixed Stage 4 evidence (§8.1 items 1–7, §4.3 item 3); live realpath/lstat of the root (Stage 4 §17.2 steps 1–2); wiring `root_identity::verify` into request and enrollment validation (PO-B2-2) |
| #4 C1a integrity gate, #5–#6 A3, #8 live §5.5/§5.6 (D-06), #9 live walk (D-01), #3 L1 fuzzing (D-10), #12 reproducible build (D-11), D-12 reason mapping | OPEN, unchanged |
| Runtime D-03, OQ-1, OQ-2, RQ-7, L5, L6, K-1, carried Security I5, Q1–Q7 | OPEN, unchanged; OQ-3 and RV-1 NOT_A_FINDING |

Full WP3 is INCOMPLETE. No runtime qualification, execution activation or release approval is claimed.

## 13. B2 post-merge lifecycle record (2026-11-27)

- PO authority: `OD-R1-STAGE5-WP3-B-NEXT-2-MERGE` and `OD-R1-STAGE5-WP3-B-NEXT-2-CLOSURE` APPROVED.
- [PR #286](https://github.com/TarasovArtem/qa-ai-agent/pull/286): B2 portable scope MERGED / POST-MERGE CERTIFIED. Reviewed HEAD `d43faeed2aaf8627afe4927dcbae1fc08d32617c`, TREE `d7b404665cc3a1ec8763ee63556fc986d4dd5bbf`.
- Supplied exact-head Architecture and HEAVY defensive Security verdicts APPROVED; B2-01..06 and AC-B2-01..12 accepted; PO-B2-1/2 conformant; I-B2-1..9 ACCEPTED; no confirmed findings. This supersedes pending B2 review statements in §12. No waiver.
- Exact-head [PR CI](https://github.com/TarasovArtem/qa-ai-agent/actions/runs/46034350062) 7/7 SUCCESS. Merge `f88a63aeed01a095b8f72806c82d6ac45596292f`, STANDARD_TWO_PARENT; parents `3f846729a40d9676021cc37f2f7b7953d4364865` and reviewed HEAD; merge TREE equals reviewed TREE. Fresh automatic [push CI](https://github.com/TarasovArtem/qa-ai-agent/actions/runs/46036908786) on exact merge SHA/main, 7/7 SUCCESS. GitHub identities and CI verified by PM.
- Accepted reported WSL and Debian builds and 99/99 tests (88 existing + 11 new), canonical parity; no Rust job in repository CI, no independent rerun.
- D-04 runtime and all other deferred requirements retain their existing OPEN dispositions (§12.8). Full WP3 INCOMPLETE. No runtime qualification, execution activation or release approval. Further WP3-B implementation and WP4–WP9 require separate authority. Execute DISABLED; TPR SUSPENDED / NOT RELEASED; Issue #199 OPEN; WIP = 1 during closure.

## 14. Slice B3: parser robustness and L1 verification (OD-R1-STAGE5-WP3-B-NEXT-3)

| Item | Value |
|---|---|
| Authority | OD-R1-STAGE5-WP3-B-NEXT-3 (APPROVED) |
| Base | `main` ecec4ef5cb20c3bdee900d03c0f5eea6917e667c, tree d9811dad6361962b75cf408e21d09e2fdc244b10 (B2 merged and closed, §13) |
| Branch | `feature/r1-stage5-wp3-b-next-3` (local candidate; delivery needs separate PO authorization) |
| Objective | Defensive robustness evidence for D-10 / L1: the P0 frame parser (`wire`) and the strict JSON parser (`json`) of the portable library |
| Obligation | Amendment A8: "Fuzzing of the P0 frame parser and the strict JSON parser is still required for L1"; Q2: "L1 by the memory-safe parser (A8) plus fuzzing"; OD-06 §19.1 L1 |
| Status | Development evidence only. **L1 is not closed** (§14.8). No runtime capability. Execute stays DISABLED |

### 14.1 Components and method decision

Components (mission text): B3-01 establish an A8-compatible verification method; B3-02 defensive P0 framing robustness assessment; B3-03 defensive strict JSON robustness assessment; B3-04 regression verification; B3-05 evidence and readiness matrix update.

Preflight: no approved fuzzing method existed. D-10 recorded the tool choice as pending, and neither the WSL host nor the accepted WP2 VM had any fuzzer: no cargo-fuzz, AFL++, honggfuzz, clang or libFuzzer runtime. Coverage-guided fuzzing would need a toolchain-budget extension.

| ID | Decision (2026-11-27) |
|---|---|
| PO-B3-1 | Method: an in-tree, test-only, **std-only** robustness harness on the existing Debian rustc. It uses a deterministic seeded PRNG, grammar-based generation and byte-level havoc mutation, and needs no dependency or toolchain change. It is black-box (not coverage-guided), so L1 is recorded as PARTIAL, not closed |

### 14.2 Acceptance criteria (immutable, as issued)

```text
AC-B3-01: Exact baseline verified.
AC-B3-02: Verification method complies with A8.
AC-B3-03: P0 framing robustness evidence recorded.
AC-B3-04: Strict JSON robustness evidence recorded.
AC-B3-05: Existing 99 regression tests pass.
AC-B3-06: Production dependency budget preserved.
AC-B3-07: Portability preserved.
AC-B3-08: D-10 evidence and readiness matrix updated.
AC-B3-09: No new runtime capabilities.
AC-B3-10: Execute DISABLED.
```

Status is reported only in the §14.7 crosswalk.

### 14.3 Harness

Files: `tests/robustness/mod.rs` (shared), `tests/robustness_json.rs` (4 tests) and `tests/robustness_wire.rs` (4 tests). No `src/` file changed.

- **Generator.** SplitMix64, seeded. Fixed default seeds `0x5EED0001..3` run in every `cargo test`. `QA_ROBUSTNESS_ITERATIONS` and `QA_ROBUSTNESS_SEEDS` scale a campaign. Every failure report names the seed, the iteration and the input bytes (hex), so every case is reproducible.
- **Strict JSON (B3-03)**, `json::parse_strict`:
  - **Positive.** A random value (depth 0..12, Unicode across all planes, controls, quotes, boundary integers, unique keys) is serialized with random whitespace and escape spellings. The parse must equal the model exactly.
  - **Negative.** A planted defect must yield its exact code: BOM, raw NUL, escaped NUL, invalid UTF-8 (lone continuation, overlong, encoded surrogate, beyond U+10FFFF, truncated), lone or mis-ordered surrogate escapes, raw control characters, floats and exponents, `-0`, unsafe integers, leading zero, bad literals, bad escapes, trailing commas, missing colons, non-string keys, a duplicate key spelled with an escape, trailing content, depth limit+1. This exercises 12 of the 13 codes. The 13th, `JSON_TOO_LARGE`, is covered by the size-boundary test.
  - **Boundaries.** Exactly 262144 bytes and depth 12 are accepted; one more byte or level is refused. 100000 nested containers are refused without deep recursion.
  - **Havoc.** Arbitrary mutations of valid documents and of random bytes must never panic and must refuse only with known `Json` codes. Every accepted input must satisfy every strict rule (size, no BOM, no raw NUL, valid UTF-8, depth, unique keys, NUL-free strings, safe integers), parse deterministically and round-trip through the CRS-1 canonical encoder.
- **P0 framing (B3-02)**, `wire::decode_client_frame` and `decode_broker_frame`:
  - every result is structurally consistent (`consumed`, `needed`, limits, payload slice);
  - **prefix consistency**: a shorter prefix is always `Incomplete`; an oversize or unknown header is refused as soon as its deciding bytes are present and for any longer buffer, so an oversize frame can never be truncated into a shorter valid one;
  - **chunking invariance** of frame streams under random split points (including 1-byte chunks), checked against a one-shot decode, with a bounded buffer;
  - an encode/decode round trip at 0, 1, limit−1 and limit, with limit+1 refused;
  - **the root P0 path**: a mutated client frame goes through strict JSON to the closed CREATE request (`parse_request`); refusals may only be `Json` or `Schema` kinds.

### 14.4 Results

| Run | Toolchain | Result |
|---|---|---|
| WSL, `cargo test` (debug, default seeds) | rustc/cargo 1.93.1 | `--locked --offline`, 0 warnings; **107 passed, 0 failed** (99 existing unchanged + 8 new) |
| WSL, extended campaign (release) | rustc/cargo 1.93.1 | `QA_ROBUSTNESS_ITERATIONS=200000`, seeds 1592459265, 1592459266, 1592459267, 42, 20261127 (5 seeds distinct from the defaults): **all 8 robustness tests pass**, 268 s. About 1,000,000 iterations per target; 1,000,000 positive documents parsed to their model; about 3,000,000 frames reassembled; 0 panics |
| Accepted WP2 VM (instance `wp2-r1-b3-1`; only `lo`; F-WZ disk flags; no reconfiguration) | Debian rustc/cargo 1.85.1+dfsg1-1+deb13u1 | `cargo build`, `cargo build --release`, `cargo test` as the runner: 0 warnings; **107 passed, 0 failed**. Release campaign `QA_ROBUSTNESS_ITERATIONS=50000`, default seeds: **pass**, 0 panics. VM disk still 0 unwritten blocks |

Refusal classes exercised in the WSL extended campaign:
- JSON negative: all 12 planted classes (each 10870 to 182518 times).
- JSON havoc: 28856 accepted inputs, all invariant-checked, plus 12 refusal codes.
- Wire: 39004 complete, 123952 incomplete, 465086 `WIRE_FRAME_TOO_LARGE` and 371958 `WIRE_UNKNOWN_KIND`.
- P0 path: 5015 requests accepted, 664272 refused as JSON and 58794 refused by the schema.

The Debian campaign shows the same classes at 3×50000 iterations.

**Oracle sensitivity (mutation check).** Each defect below was planted in a throwaway copy of the crate, never in the candidate, and the harness ran against it:
- **Killed (7):**
  - M1: no raw-NUL precheck;
  - M2: depth limit off by one;
  - M3: no duplicate-key check;
  - M4: no safe-integer bound;
  - M5b: a lone high surrogate decodes to U+FFFD;
  - M6: client frame limit off by one;
  - M7: broker length checked after buffering.
- **Survived (1):** M5 (removing the explicit lone-low-surrogate arm) is *equivalent*: `char::from_u32` refuses surrogates with the same code, so behaviour does not change.

Records: operator-local `~/r1-wp3b-b3/` (`campaign-wsl/`, `debian/`, `mutants/results.txt`).

### 14.5 Findings

No confirmed defect. Observations from the assessment:
- **B3-O1.** Both parsers keep a fixed check order. For JSON: size, BOM, raw NUL and UTF-8 before parsing. For frames: header complete, then length against the limit, before any payload is needed. Container recursion is bounded by `max_depth`, and decoding is zero-copy, so memory is bounded by the input buffer.
- **B3-O2.** Lone low surrogates are refused twice (explicit arm and `char::from_u32`); this is defence in depth, not a defect.

### 14.6 Invariants

- `Cargo.toml`, `Cargo.lock`, `vendor/` and `.cargo/` unchanged: `hmac-sha256` 1.1.15 is the only dependency (A8). No dev-dependency was added.
- No `src/` change; no `unsafe`, FFI, OS-specific API, process, file, network or environment access in the library. The harness reads two optional environment variables in test code only.
- No existing test, fixture or vector changed; the portability guard passes unchanged.
- OD-04, OD-06, product, demo, npm package and CI unchanged.

### 14.7 Engineering-check crosswalk (B3)

| AC | Engineering checks | Status |
|---|---|---|
| AC-B3-01 Exact baseline verified | `origin/main` = ecec4ef5…, tree d9811dad…, checked before branching; the branch starts there | MET |
| AC-B3-02 Verification method complies with A8 | PO-B3-1: std-only, test-only harness built with the existing Debian `rustc`/`cargo`; no rustup, nightly, crate or system package; `--locked --offline` | MET |
| AC-B3-03 P0 framing robustness evidence recorded | §14.3–§14.4: wire and P0-path campaign, prefix consistency, chunking invariance, limits, mutation check M6/M7 | MET |
| AC-B3-04 Strict JSON robustness evidence recorded | §14.3–§14.4: positive, negative, boundary and havoc campaign, mutation check M1–M5b | MET |
| AC-B3-05 Existing 99 regression tests pass | 99/99 unchanged pass in WSL and on Debian (within 107/107) | MET |
| AC-B3-06 Production dependency budget preserved | Dependency inputs unchanged; no dev-dependency | MET |
| AC-B3-07 Portability preserved | No `src/` change; portability guard passes; Debian rustc 1.85.1 build and tests pass | MET |
| AC-B3-08 D-10 evidence and readiness matrix updated | This section and §14.8 | MET |
| AC-B3-09 No new runtime capabilities | Test files only | MET |
| AC-B3-10 Execute DISABLED | No execution capability; product state untouched | MET |

### 14.8 D-10 / L1 disposition and readiness

| Item | Status after B3 |
|---|---|
| D-10 L1 fuzzing of the P0 frame parser and the strict JSON parser | **PARTIAL.** A method is established (PO-B3-1), and a reproducible std-only black-box campaign with strong oracles is recorded (§14.4): no defect, all non-equivalent mutants killed. **OPEN:** (a) the PO decision on whether this black-box campaign satisfies the A8 "fuzzing" requirement, or whether a coverage-guided campaign (needing a toolchain-budget extension) is required; (b) the WP8 CI fuzz job (amendment WP8 row) |
| L1 (OD-06 §19.1; Q2 "memory-safe parser (A8) plus fuzzing") | **OPEN.** The memory-safe parser part is in place (`#![forbid(unsafe_code)]`, A8 Rust). The fuzzing part is PARTIAL (D-10). The process-level prechecks are runtime (WP4+). The disposition belongs to WP7 qualification (Q2) |
| All other WP3 and deferred items | OPEN, unchanged (§12.8, §13) |

Full WP3 is INCOMPLETE. No runtime qualification, execution activation or release approval is claimed.

## 15. B3 post-merge lifecycle record (2026-11-27)

- PO authority: `OD-R1-STAGE5-WP3-B-NEXT-3-MERGE` and `OD-R1-STAGE5-WP3-B-NEXT-3-CLOSURE` APPROVED.
- [PR #288](https://github.com/TarasovArtem/qa-ai-agent/pull/288): bounded B3 test/documentation scope MERGED / POST-MERGE CERTIFIED. Reviewed HEAD `d34737ba20aa1720275d247c10a0cedf5d1b20a0`, TREE `de919d83350ba8e9bcee92186a776ee938324b9b`.
- Supplied exact-head Architecture and HEAVY defensive Security verdicts APPROVED; AC-B3-01..10 accepted; no confirmed findings. A8 compliance accepted for bounded B3 only; no risk waiver or final qualification.
- Exact-head [PR CI](https://github.com/TarasovArtem/qa-ai-agent/actions/runs/46044273049) 7/7 SUCCESS. Merge `7d726b6b0c8d7d709a121f2ac2588e835de5aa8a`, STANDARD_TWO_PARENT; parents `ecec4ef5cb20c3bdee900d03c0f5eea6917e667c` and reviewed HEAD; merge TREE equals reviewed TREE. Fresh automatic [push CI](https://github.com/TarasovArtem/qa-ai-agent/actions/runs/46046420379) on exact merge SHA/main, 7/7 SUCCESS. GitHub identities and CI verified by PM.
- Accepted reported WSL and Debian builds and 107/107 tests and bounded robustness evidence; no Rust job in repository CI, no independent rerun. Finite campaigns do not establish exhaustive assurance or runtime qualification.
- D-10 remains PARTIAL: final method/evidence disposition and WP8 CI integration remain outstanding. L1 remains OPEN; runtime and qualification obligations preserved. All other deferred requirements retain existing dispositions. Full WP3 INCOMPLETE; further implementation requires separate authority; WP4–WP9 NOT AUTHORIZED. Execute DISABLED; TPR SUSPENDED / NOT RELEASED; Issue #199 OPEN; WIP = 1 during closure.
