//! `od06-files-v1` fingerprint over synthetic in-memory trees, with a golden
//! vector produced by the repository's JS `encodeValue`/`digest`.

mod common;

use common::{obj, s};
use qa_agent_controller_v1::digest::{domains, h_value};
use qa_agent_controller_v1::fingerprint::{
    canonical_object, compute, digest, is_playwright_root_member, validate_entries, verify_enrolled, FileEntry,
    TreeProfile,
};
use qa_agent_controller_v1::json::Value;

const JS_DIGEST: &str = "sha256:1c1aa7dc3cf32781fa6dd5ee3d8b428cc888c7fb7a35fd199358664caec6b612";
const JS_BROWSER_DOMAIN_DIGEST: &str = "sha256:c82f7b0924edc3fd3e3e8c656a22c9f8c96c1bb09403b641ecc3d73c0297ca95";

fn synthetic_root() -> Vec<(&'static str, &'static [u8])> {
    vec![
        ("playwright.config.js", &b"module.exports = { testDir: 'playwright' };\n"[..]),
        ("package.json", &b"{\"name\":\"synthetic\",\"version\":\"0.0.0\"}\n"[..]),
        ("package-lock.json", &b"{\"lockfileVersion\":3}\n"[..]),
        ("node_modules/@playwright/test/index.js", &b"module.exports = require('playwright/test');\n"[..]),
        ("node_modules/@playwright/test/package.json", &b"{\"name\":\"@playwright/test\"}\n"[..]),
        ("node_modules/playwright/lib/x.js", "\u{e9}\u{0}\u{ff} binary-ish".as_bytes()),
        ("node_modules/playwright-core/LICENSE", &b""[..]),
    ]
}

#[test]
fn digest_matches_js_reference_and_is_input_order_independent() {
    let (entries, d) = compute(TreeProfile::PlaywrightRoot, &synthetic_root()).unwrap();
    assert_eq!(d, JS_DIGEST);
    assert_eq!(entries[0].path, "node_modules/@playwright/test/index.js");
    assert_eq!(entries[3].size, 16);
    let mut reversed = synthetic_root();
    reversed.reverse();
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &reversed).unwrap().1, JS_DIGEST);
    assert_eq!(h_value(domains::BROWSER_TREE, &canonical_object(&entries)).unwrap(), JS_BROWSER_DOMAIN_DIGEST);
}

#[test]
fn any_byte_change_changes_the_digest() {
    let mut files: Vec<(&str, &[u8])> = synthetic_root();
    files[1] = ("package.json", &b"{\"name\":\"synthetic\",\"version\":\"0.0.1\"}\n"[..]);
    assert_ne!(compute(TreeProfile::PlaywrightRoot, &files).unwrap().1, JS_DIGEST);
}

#[test]
fn membership_rule_a2_1() {
    for ok in [
        "package.json",
        "package-lock.json",
        "playwright.config.js",
        "node_modules/@playwright/test/index.js",
        "node_modules/playwright/lib/server/x.js",
        "node_modules/playwright-core/bin/install_media_pack.ps1",
    ] {
        assert!(is_playwright_root_member(ok), "{ok}");
    }
    for bad in [
        "src/app.js",
        "playwright.config.ts",
        "node_modules/other/index.js",
        "node_modules/@playwright/test",
        "node_modules/@playwright/test/",
        "node_modules/playwright/.bin/x",
        "node_modules/playwright/lib//x.js",
        "node_modules/playwright/lib/../x.js",
        "node_modules/playwright/lib/a@b.js",
        "node_modules/playwright/lib/CON",
        "node_modules/playwrightx/a.js",
        "./package.json",
        "/package.json",
    ] {
        assert!(!is_playwright_root_member(bad), "{bad}");
    }
}

#[test]
fn refuses_missing_required_files_and_foreign_paths() {
    let mut files: Vec<(&str, &[u8])> = synthetic_root();
    files.retain(|(p, _)| *p != "package-lock.json");
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &files).unwrap_err().code, "FINGERPRINT_REQUIRED_FILE_MISSING");
    let mut foreign = synthetic_root();
    foreign.push(("src/app.js", &b"x"[..]));
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &foreign).unwrap_err().code, "FINGERPRINT_PATH");
    let mut dup = synthetic_root();
    dup.push(("package.json", &b"other"[..]));
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &dup).unwrap_err().code, "FINGERPRINT_ORDER");
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &[]).unwrap_err().code, "FINGERPRINT_FILE_COUNT");
}

fn fake(path: String, size: u64) -> FileEntry {
    FileEntry { path, sha256: format!("sha256:{}", "0".repeat(64)), size }
}

fn required() -> Vec<FileEntry> {
    vec![fake("package-lock.json".into(), 1), fake("package.json".into(), 1), fake("playwright.config.js".into(), 1)]
}

#[test]
fn limits_root_profile() {
    let sixteen_mib = vec![0u8; 16_777_216];
    let mut files: Vec<(&str, &[u8])> = synthetic_root();
    files.push(("node_modules/playwright/big.bin", &sixteen_mib[..]));
    assert!(compute(TreeProfile::PlaywrightRoot, &files).is_ok());
    let over = vec![0u8; 16_777_217];
    let mut files: Vec<(&str, &[u8])> = synthetic_root();
    files.push(("node_modules/playwright/big.bin", &over[..]));
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &files).unwrap_err().code, "FINGERPRINT_FILE_TOO_LARGE");

    let mut total: Vec<FileEntry> = (0..5).map(|i| fake(format!("node_modules/playwright/f{i}"), 16_000_000)).collect();
    total.extend(required());
    assert_eq!(validate_entries(TreeProfile::PlaywrightRoot, &total).unwrap_err().code, "FINGERPRINT_TOTAL_TOO_LARGE");

    let mut count: Vec<FileEntry> = (0..4094).map(|i| fake(format!("node_modules/playwright/f{i:05}"), 0)).collect();
    count.extend(required());
    assert_eq!(validate_entries(TreeProfile::PlaywrightRoot, &count).unwrap_err().code, "FINGERPRINT_FILE_COUNT");
    count.truncate(4093);
    count.extend(required());
    assert!(validate_entries(TreeProfile::PlaywrightRoot, &count).is_ok());

    let long = format!("node_modules/playwright/{}/{}", "a".repeat(100), "b".repeat(180));
    assert!(long.len() > 300);
    let mut long_entries = vec![fake(long, 1)];
    long_entries.extend(required());
    assert_eq!(validate_entries(TreeProfile::PlaywrightRoot, &long_entries).unwrap_err().code, "FINGERPRINT_PATH");

    let mut bad_hash = required();
    bad_hash[0].sha256 = "sha256:XYZ".into();
    assert_eq!(validate_entries(TreeProfile::PlaywrightRoot, &bad_hash).unwrap_err().code, "FINGERPRINT_SHA256");
}

#[test]
fn browser_tree_profile() {
    let files: Vec<(&str, &[u8])> = vec![
        ("chrome-linux/chrome", &b"\x7fELF synthetic"[..]),
        ("chrome-linux/locales/en-US.pak", &b"pak"[..]),
        ("INSTALLATION_COMPLETE", &b""[..]),
    ];
    let (entries, d) = compute(TreeProfile::BrowserTree, &files).unwrap();
    assert_eq!(entries.len(), 3);
    assert_ne!(d, compute_root_like(&entries));
    // No PlaywrightRoot membership or required files; PPI-1 segments only.
    assert_eq!(
        compute(TreeProfile::BrowserTree, &[("chrome-linux/@x", &b""[..])]).unwrap_err().code,
        "FINGERPRINT_PATH"
    );
    assert_eq!(compute(TreeProfile::BrowserTree, &[(".hidden", &b""[..])]).unwrap_err().code, "FINGERPRINT_PATH");
    // A2.3 raises count/total only; the per-file limit stays 16 MiB (OQ-2).
    let big = vec![fake("chrome-linux/chrome".into(), 16_777_217)];
    assert_eq!(validate_entries(TreeProfile::BrowserTree, &big).unwrap_err().code, "FINGERPRINT_FILE_TOO_LARGE");
    let many: Vec<FileEntry> = (0..16_384).map(|i| fake(format!("f{i:05}"), 0)).collect();
    assert!(validate_entries(TreeProfile::BrowserTree, &many).is_ok());
    let total: Vec<FileEntry> = (0..65).map(|i| fake(format!("f{i:02}"), 16_777_216)).collect();
    assert_eq!(validate_entries(TreeProfile::BrowserTree, &total).unwrap_err().code, "FINGERPRINT_TOTAL_TOO_LARGE");
}

fn compute_root_like(entries: &[FileEntry]) -> String {
    h_value(domains::FINGERPRINT, &canonical_object(entries)).unwrap()
}

#[test]
fn enrolled_fingerprint_verification() {
    let (entries, d) = compute(TreeProfile::PlaywrightRoot, &synthetic_root()).unwrap();
    let files: Vec<Value> = entries
        .iter()
        .map(|e| obj(vec![("path", s(&e.path)), ("sha256", s(&e.sha256)), ("size", Value::Int(e.size as i64))]))
        .collect();
    let enrolled = obj(vec![("algorithm", s("od06-files-v1")), ("files", Value::Array(files.clone())), ("digest", s(&d))]);
    assert_eq!(verify_enrolled(TreeProfile::PlaywrightRoot, &enrolled).unwrap(), entries);
    let tampered = obj(vec![
        ("algorithm", s("od06-files-v1")),
        ("files", Value::Array(files.clone())),
        ("digest", s(&format!("sha256:{}", "0".repeat(64)))),
    ]);
    assert_eq!(verify_enrolled(TreeProfile::PlaywrightRoot, &tampered).unwrap_err().code, "FINGERPRINT_DIGEST_MISMATCH");
    let wrong_algo = obj(vec![("algorithm", s("od06-files-v2")), ("files", Value::Array(files)), ("digest", s(&d))]);
    assert_eq!(verify_enrolled(TreeProfile::PlaywrightRoot, &wrong_algo).unwrap_err().code, "SCHEMA_LITERAL");
    assert_eq!(digest(TreeProfile::PlaywrightRoot, &entries).unwrap(), d);
}

// SEC-WP3A-01: contractual resource limits hold before any content is hashed.
// One 16 MiB buffer is referenced many times, so these inputs cost no extra
// memory; without pre-hash admission they would hash 64 GiB (root) or 256 GiB
// (browser) before being refused.

#[test]
fn total_limit_is_enforced_before_hashing() {
    let chunk = vec![0u8; 16_777_216];
    let names: Vec<String> = (0..4089).map(|i| format!("node_modules/playwright/f{i:05}")).collect();
    let mut files: Vec<(&str, &[u8])> = synthetic_root();
    files.extend(names.iter().map(|n| (n.as_str(), &chunk[..])));
    assert_eq!(files.len(), 4096);
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &files).unwrap_err().code, "FINGERPRINT_TOTAL_TOO_LARGE");
    files.push(("node_modules/playwright/zz", &chunk[..1]));
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &files).unwrap_err().code, "FINGERPRINT_FILE_COUNT");

    let browser_names: Vec<String> = (0..16_384).map(|i| format!("f{i:05}")).collect();
    let mut browser: Vec<(&str, &[u8])> = browser_names.iter().map(|n| (n.as_str(), &chunk[..])).collect();
    assert_eq!(compute(TreeProfile::BrowserTree, &browser).unwrap_err().code, "FINGERPRINT_TOTAL_TOO_LARGE");
    browser.push(("g", &chunk[..1]));
    assert_eq!(compute(TreeProfile::BrowserTree, &browser).unwrap_err().code, "FINGERPRINT_FILE_COUNT");
}

#[test]
fn total_limit_exact_boundary() {
    // synthetic_root() holds 194 bytes; 3 x 16 MiB + 16777022 brings the total
    // to exactly 64 MiB (67108864).
    let root_bytes: usize = synthetic_root().iter().map(|(_, c)| c.len()).sum();
    assert_eq!(root_bytes, 194);
    let mut at: Vec<FileEntry> = (0..3).map(|i| fake(format!("node_modules/playwright/f{i}"), 16_777_216)).collect();
    at.push(fake("node_modules/playwright/f3".into(), 16_777_022));
    for (p, c) in synthetic_root().into_iter().filter(|(p, _)| !p.starts_with("node_modules/")) {
        at.push(fake(p.into(), c.len() as u64));
    }
    at.push(fake("node_modules/playwright/g".into(), 194 - 105)); // remaining root bytes as one entry
    at.sort_by(|a, b| a.path.cmp(&b.path));
    assert_eq!(at.iter().map(|e| e.size).sum::<u64>(), 67_108_864);
    assert!(validate_entries(TreeProfile::PlaywrightRoot, &at).is_ok());
    let idx = at.iter().position(|e| e.path == "node_modules/playwright/g").unwrap();
    at[idx].size += 1;
    assert_eq!(validate_entries(TreeProfile::PlaywrightRoot, &at).unwrap_err().code, "FINGERPRINT_TOTAL_TOO_LARGE");

    // The same +1 overflow through compute() is refused before hashing.
    let big = vec![0u8; 16_777_216];
    let mut files: Vec<(&str, &[u8])> = synthetic_root();
    for name in ["node_modules/playwright/f0", "node_modules/playwright/f1", "node_modules/playwright/f2"] {
        files.push((name, &big[..]));
    }
    files.push(("node_modules/playwright/f3", &big[..16_777_023]));
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &files).unwrap_err().code, "FINGERPRINT_TOTAL_TOO_LARGE");
}

#[test]
fn enrolled_file_count_is_checked_before_materializing_entries() {
    let zero = format!("sha256:{}", "0".repeat(64));
    let file = obj(vec![("path", s("package.json")), ("sha256", s(&zero)), ("size", Value::Int(1))]);
    for files in [vec![], vec![file; 4097]] {
        let enrolled = obj(vec![("algorithm", s("od06-files-v1")), ("files", Value::Array(files)), ("digest", s(&zero))]);
        assert_eq!(verify_enrolled(TreeProfile::PlaywrightRoot, &enrolled).unwrap_err().code, "FINGERPRINT_FILE_COUNT");
    }
    let oversize = obj(vec![("path", s("package.json")), ("sha256", s(&zero)), ("size", Value::Int(16_777_217))]);
    let enrolled = obj(vec![("algorithm", s("od06-files-v1")), ("files", Value::Array(vec![oversize])), ("digest", s(&zero))]);
    assert_eq!(verify_enrolled(TreeProfile::PlaywrightRoot, &enrolled).unwrap_err().code, "SCHEMA_RANGE");
}

#[test]
fn per_file_and_path_checks_precede_hashing() {
    let big = vec![0u8; 16_777_217];
    assert_eq!(
        compute(TreeProfile::PlaywrightRoot, &[("node_modules/playwright/x", &big[..])]).unwrap_err().code,
        "FINGERPRINT_FILE_TOO_LARGE"
    );
    assert_eq!(compute(TreeProfile::PlaywrightRoot, &[("src/x.js", &big[..16])]).unwrap_err().code, "FINGERPRINT_PATH");
    let sizes = vec![fake("package.json".into(), u64::MAX)];
    assert_eq!(validate_entries(TreeProfile::PlaywrightRoot, &sizes).unwrap_err().code, "FINGERPRINT_FILE_TOO_LARGE");
}
