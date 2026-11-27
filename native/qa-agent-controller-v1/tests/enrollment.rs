//! B1-03, B1-04, B1-05 and the amendment A1 R1 profile check: the OD-06 §5.2
//! enrollment document, the data-only §5.5 root rules, the qualification and
//! `profileDigest`. All fixtures are synthetic.

mod b1_common;

use b1_common::*;
use qa_agent_controller_v1::enrollment::{
    check_r1_profile, parse_enrollment, validate_enrollment, validate_qualification, ENROLLMENT_LIMITS,
};
use qa_agent_controller_v1::error::ErrorKind;
use qa_agent_controller_v1::fingerprint::{compute, FileEntry, TreeProfile, CYPRESS_REQUIRED};
use qa_agent_controller_v1::json::Value;

fn code(v: &Value) -> &'static str {
    validate_enrollment(v).expect_err("must refuse").code
}

fn kind_code(v: &Value) -> (ErrorKind, &'static str) {
    let e = validate_enrollment(v).expect_err("must refuse");
    (e.kind, e.code)
}

fn ok(v: &Value) {
    validate_enrollment(v).expect("must accept");
}

fn r0<'a>(rest: &[P<'a>]) -> Vec<P<'a>> {
    let mut p: Vec<P<'a>> = vec![P::K("roots"), P::I(0)];
    p.extend_from_slice(rest);
    p
}

fn q<'a>(rest: &[P<'a>]) -> Vec<P<'a>> {
    let mut p: Vec<P<'a>> = vec![P::K("qualification")];
    p.extend_from_slice(rest);
    p
}

#[test]
fn golden_enrollment_validates_with_js_profile_digest() {
    let e = parse_enrollment(ENROLLMENT).unwrap();
    assert_eq!(e.qualification.profile_digest, PROFILE_H);
    assert!(e.enabled);
    assert_eq!((e.caller.uid, e.caller.gid, e.caller.account.as_str()), (1001, 1001, "qarunner"));
    assert_eq!(e.workspace.path, "/srv/qa-workspace");
    assert_eq!(e.roots.len(), 1);
    assert_eq!(e.roots[0].root.path, "/srv/qa-workspace/qa-agent-demo");
    assert_eq!(e.roots[0].fingerprint_digest, FINGERPRINT_H);
    assert_eq!(e.roots[0].fingerprint_files.len(), 8);
    assert_eq!(e.qualification.framework_profiles.len(), 1);
    check_r1_profile(&e.qualification).unwrap();
}

#[test]
fn profile_digest_is_canonical_and_covers_every_field() {
    let base = get(&enrollment(), &q(&[])).clone();
    let reordered = match &base {
        Value::Object(m) => Value::Object(m.iter().rev().cloned().collect()),
        _ => unreachable!(),
    };
    assert_eq!(validate_qualification(&reordered).unwrap().profile_digest, PROFILE_H);
    for (path, new) in [
        (vec![P::K("osBuild")], s("synthetic other os")),
        (vec![P::K("workloadStorage"), P::K("maxBytes")], Value::Int(1_073_741_824)),
        (vec![P::K("frameworkProfiles"), P::I(0), P::K("browserSha256")], s(&h('7'))),
    ] {
        assert_ne!(validate_qualification(&with(&base, &path, new)).unwrap().profile_digest, PROFILE_H);
    }
}

#[test]
fn closed_schema_at_every_level() {
    let v = enrollment();
    assert_eq!(code(&adding(&v, &[], "extra", Value::Null)), "SCHEMA_KEY_SET");
    assert_eq!(code(&without(&v, &[], "enabled")), "SCHEMA_KEY_SET");
    let nested: Vec<Vec<P<'_>>> = vec![
        vec![P::K("caller")],
        vec![P::K("workspace")],
        r0(&[]),
        r0(&[P::K("root")]),
        q(&[]),
        q(&[P::K("frameworkProfiles"), P::I(0)]),
        q(&[P::K("workloadStorage")]),
    ];
    for (i, path) in nested.iter().enumerate() {
        assert_eq!(kind_code(&adding(&v, path, "extra", Value::Null)), (ErrorKind::Enrollment, "SCHEMA_KEY_SET"), "{i}");
    }
    assert_eq!(kind_code(&adding(&v, &r0(&[P::K("fingerprint")]), "extra", Value::Null)), (ErrorKind::Fingerprint, "SCHEMA_KEY_SET"));
    assert_eq!(code(&with(&v, &[P::K("schemaVersion")], Value::Int(2))), "SCHEMA_RANGE");
    assert_eq!(code(&with(&v, &[P::K("enabled")], s("true"))), "SCHEMA_TYPE");
    assert_eq!(code(&with(&v, &[P::K("compatibilityDigest")], s("sha256:x"))), "SCHEMA_GRAMMAR");
    assert_eq!(code(&with(&v, &[P::K("roots")], Value::Null)), "SCHEMA_TYPE");
    ok(&with(&v, &[P::K("enabled")], Value::Bool(false)));
}

#[test]
fn caller_rules() {
    let v = enrollment();
    let c = |k: &str, new: Value| with(&v, &[P::K("caller"), P::K(k)], new);
    for (k, n) in [("uid", 1i64), ("uid", 4_294_967_294), ("gid", 1), ("gid", 4_294_967_294)] {
        ok(&c(k, Value::Int(n)));
    }
    for (k, n) in [("uid", 0i64), ("uid", 4_294_967_295), ("gid", 0), ("gid", -1)] {
        assert_eq!(code(&c(k, Value::Int(n))), "SCHEMA_RANGE", "{k}={n}");
    }
    ok(&c("account", s(&"a".repeat(64))));
    ok(&c("account", s("Qa_runner-1")));
    for bad in ["", "qa runner", "qa.runner", "q\u{e4}runner", &"a".repeat(65)] {
        assert_eq!(code(&c("account", s(bad))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
}

/// Sets the workspace path and moves the single root below it.
fn with_workspace(v: &Value, path: &str) -> Value {
    let v = with(v, &[P::K("workspace"), P::K("path")], s(path));
    with(&v, &r0(&[P::K("root"), P::K("path")]), s(&format!("{path}/demo")))
}

#[test]
fn workspace_literal_rules() {
    let v = enrollment();
    assert_eq!(code(&with_workspace(&v, "/")), "ENROLLMENT_WORKSPACE_ROOT");
    for hidden in ["/home", "/home/qa", "/root", "/run/user", "/run/user/1001/ws", "/tmp", "/tmp/ws", "/var/tmp/ws", "/dev/shm", "/dev/mqueue/x"] {
        assert_eq!(code(&with_workspace(&v, hidden)), "ENROLLMENT_WORKSPACE_HIDDEN", "{hidden}");
    }
    for ancestor in [
        "/etc",
        "/usr",
        "/usr/local",
        "/usr/local/share",
        "/usr/local/libexec",
        "/var",
        "/var/lib",
        "/etc/qa-agent-controller-v1",
        "/usr/local/share/qa-agent-controller-v1",
        "/var/lib/qa-agent-controller-v1",
        "/var/lib/qa-agent-workload-v1",
    ] {
        assert_eq!(code(&with_workspace(&v, ancestor)), "ENROLLMENT_WORKSPACE_ARTIFACT_ANCESTOR", "{ancestor}");
    }
    for bad in ["srv/ws", "/srv/ws/", "/srv//ws", "/srv/./ws", "/srv/%h", "/srv/w\u{1}s"] {
        assert_eq!(code(&with_workspace(&v, bad)), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    for good in ["/srv/qa-workspace", "/opt/ws", "/homework", "/var/lib/other", "/srv/qa-agent-controller-v1x"] {
        ok(&with_workspace(&v, good));
    }
    assert_eq!(code(&with(&v, &[P::K("workspace"), P::K("dev")], s("01"))), "SCHEMA_GRAMMAR");
}

#[test]
fn system_and_account_home_directories_are_not_data_rules() {
    // PO decision (WP3-B-NEXT-1): literal rules only; "system directory" and
    // per-account home checks stay runtime items and are recorded OPEN.
    let v = enrollment();
    for path in ["/usr/bin", "/opt", "/srv"] {
        ok(&with_workspace(&v, path));
    }
}

fn root_at(v: &Value, path: &str, ino: &str) -> Value {
    let r = get(v, &r0(&[])).clone();
    let r = with(&r, &[P::K("root"), P::K("path")], s(path));
    with(&r, &[P::K("root"), P::K("ino")], s(ino))
}

fn with_roots(v: &Value, roots: Vec<Value>) -> Value {
    with(v, &[P::K("roots")], Value::Array(roots))
}

#[test]
fn root_placement_and_overlap() {
    let v = enrollment();
    let root_path = |p: &str| with(&v, &r0(&[P::K("root"), P::K("path")]), s(p));
    for bad in ["/srv/other/demo", "/srv/qa-workspace", "/srv/qa-workspacex/demo", "/srv"] {
        assert_eq!(code(&root_path(bad)), "ENROLLMENT_ROOT_OUTSIDE_WORKSPACE", "{bad}");
    }
    ok(&root_path("/srv/qa-workspace/a/b/c"));
    assert_eq!(code(&with(&v, &r0(&[P::K("root"), P::K("dev")]), s("65026"))), "ENROLLMENT_ROOT_DEVICE");
    assert_eq!(code(&with(&v, &r0(&[P::K("root"), P::K("ino")]), s("131073"))), "ENROLLMENT_ROOT_OVERLAP");
    let two = |a: (&str, &str), b: (&str, &str)| with_roots(&v, vec![root_at(&v, a.0, a.1), root_at(&v, b.0, b.1)]);
    ok(&two(("/srv/qa-workspace/a", "1001"), ("/srv/qa-workspace/b", "1002")));
    ok(&two(("/srv/qa-workspace/a", "1001"), ("/srv/qa-workspace/ab", "1002")));
    for (a, b) in [
        (("/srv/qa-workspace/a", "1001"), ("/srv/qa-workspace/a", "1002")),
        (("/srv/qa-workspace/a", "1001"), ("/srv/qa-workspace/a/b", "1002")),
        (("/srv/qa-workspace/a/b", "1001"), ("/srv/qa-workspace/a", "1002")),
        (("/srv/qa-workspace/a", "1001"), ("/srv/qa-workspace/b", "1001")),
    ] {
        assert_eq!(code(&two(a, b)), "ENROLLMENT_ROOT_OVERLAP", "{a:?} {b:?}");
    }
    assert_eq!(code(&with(&v, &r0(&[P::K("root"), P::K("platform")]), s("darwin"))), "SCHEMA_LITERAL");
    assert_eq!(code(&with(&v, &r0(&[P::K("root"), P::K("digest")]), s("sha256:x"))), "SCHEMA_GRAMMAR");
}

#[test]
fn root_count_bounds() {
    let v = enrollment();
    ok(&with_roots(&v, vec![]));
    let many = |n: usize| {
        with_roots(&v, (0..n).map(|i| root_at(&v, &format!("/srv/qa-workspace/r{i:02}"), &format!("{}", 300_000 + i))).collect())
    };
    let e = validate_enrollment(&many(64)).unwrap();
    assert_eq!(e.roots.len(), 64);
    assert_eq!(code(&many(65)), "ENROLLMENT_ROOT_COUNT");
}

#[test]
fn project_id_mirrors_js_is_valid_id() {
    let v = enrollment();
    let pid = |x: &str| with(&v, &r0(&[P::K("projectId")]), s(x));
    for good in ["qa-agent-demo", "a", &"a".repeat(128), "\u{e9}", "\u{85}id", &"\u{1F600}".repeat(64), "with inner space"] {
        ok(&pid(good));
    }
    for bad in [
        "",
        &"a".repeat(129),
        &"\u{1F600}".repeat(65), // 130 UTF-16 code units
        " id",
        "id ",
        "\u{a0}id",
        "id\u{feff}",
        "\u{3000}id",
        "\u{2028}id",
        "a\u{1}b",
        "a\u{7f}b",
    ] {
        assert_eq!(code(&pid(bad)), "SCHEMA_GRAMMAR", "{bad:?}");
    }
}

#[test]
fn output_dir_mirrors_safe_relative_path_and_protected_prefixes() {
    let v = enrollment();
    let od = |x: &str| with(&v, &r0(&[P::K("outputDir")]), s(x));
    for good in ["reports/qa-agent", "out", "node_modules2/x", "x/node_modules", "reports/Qa Agent", &"a".repeat(300), &"\u{e9}".repeat(150)] {
        ok(&od(good));
    }
    for bad in [
        "",
        "/abs",
        "a/../b",
        "a/./b",
        "a//b",
        "a/",
        "a\\b",
        "c:/x",
        "node_modules",
        "node_modules/x",
        "Node_Modules/x",
        ".git",
        "playwright/out",
        "PLAYWRIGHT",
        "cypress/x",
        "a\u{1}b",
        &"a".repeat(301),
        &"\u{e9}".repeat(151), // 302 UTF-8 bytes
    ] {
        assert_eq!(code(&od(bad)), "SCHEMA_GRAMMAR", "{bad:?}");
    }
}

#[test]
fn framework_sut_names_and_fingerprint() {
    let v = enrollment();
    assert_eq!(code(&with(&v, &r0(&[P::K("framework")]), s("jest"))), "SCHEMA_GRAMMAR");
    let sut = |names: Vec<Value>| with(&v, &r0(&[P::K("sutNames")]), Value::Array(names));
    ok(&sut(vec![]));
    ok(&sut((0..32).map(|i| s(&format!("SUT_V{i:02}"))).collect()));
    assert_eq!(code(&sut((0..33).map(|i| s(&format!("SUT_V{i:02}"))).collect())), "ENROLLMENT_SUT_COUNT");
    assert_eq!(code(&sut(vec![s("SUT_A"), s("SUT_A")])), "ENROLLMENT_SUT_DUPLICATE");
    assert_eq!(code(&sut(vec![s("sut_a")])), "SCHEMA_GRAMMAR");
    assert_eq!(code(&sut(vec![Value::Int(1)])), "SCHEMA_TYPE");
    // The enrolled fingerprint is verified by the existing od06-files-v1 code.
    let digest = r0(&[P::K("fingerprint"), P::K("digest")]);
    assert_eq!(kind_code(&with(&v, &digest, s(&h('0')))), (ErrorKind::Fingerprint, "FINGERPRINT_DIGEST_MISMATCH"));
    let algorithm = r0(&[P::K("fingerprint"), P::K("algorithm")]);
    assert_eq!(kind_code(&with(&v, &algorithm, s("od06-files-v2"))), (ErrorKind::Fingerprint, "SCHEMA_LITERAL"));
}

fn fingerprint_value(entries: &[FileEntry], digest: &str) -> Value {
    let files = entries
        .iter()
        .map(|e| Value::object(vec![("path", s(&e.path)), ("sha256", s(&e.sha256)), ("size", Value::Int(e.size as i64))]))
        .collect();
    Value::object(vec![("algorithm", s("od06-files-v1")), ("files", Value::Array(files)), ("digest", s(digest))])
}

/// Synthetic Cypress root: the OD-06 §8.2 required members plus one extra
/// file (same bytes as the JS generator's Cypress fixture).
fn cypress_root() -> Vec<(&'static str, &'static [u8])> {
    vec![
        ("cypress.config.js", &b"module.exports = {};\n"[..]),
        ("package.json", &b"{\"name\":\"synthetic\",\"version\":\"0.0.0\"}\n"[..]),
        ("package-lock.json", &b"{\"lockfileVersion\":3}\n"[..]),
        ("node_modules/cypress/package.json", &b"{\"name\":\"cypress\"}\n"[..]),
        ("node_modules/cypress/bin/cypress", &b"require('../index.js');\n"[..]),
        ("spaces and @ + signs.txt", &b"x"[..]),
    ]
}

#[test]
fn cypress_roots_require_the_od06_8_2_members() {
    // Amendment A1 keeps the `cypress` literal. A2 defines no Cypress file set,
    // so paths follow the §8.2 envelope, and the §8.2 required members
    // (ARCH-B1-01) must be present (TreeProfile::CypressRoot).
    let v = enrollment();
    let (entries, digest) = compute(TreeProfile::CypressRoot, &cypress_root()).unwrap();
    assert_eq!(digest, CYPRESS_FINGERPRINT_H);
    let cy_framework = with(&v, &r0(&[P::K("framework")]), s("cypress"));
    let cy = with(&cy_framework, &r0(&[P::K("fingerprint")]), fingerprint_value(&entries, &digest));
    assert_eq!(validate_enrollment(&cy).unwrap().roots[0].framework, "cypress");
    // Each required member is mandatory, at compute time and in an enrolled
    // fingerprint whose digest is otherwise consistent.
    for required in CYPRESS_REQUIRED {
        let mut files = cypress_root();
        files.retain(|(p, _)| *p != required);
        assert_eq!(compute(TreeProfile::CypressRoot, &files).unwrap_err().code, "FINGERPRINT_REQUIRED_FILE_MISSING");
        let rest: Vec<FileEntry> = entries.iter().filter(|e| e.path != required).cloned().collect();
        let doc = with(&cy, &r0(&[P::K("fingerprint")]), fingerprint_value(&rest, &digest));
        assert_eq!(kind_code(&doc), (ErrorKind::Fingerprint, "FINGERPRINT_REQUIRED_FILE_MISSING"), "{required}");
    }
    // Only root `cypress.config.js` is the fixed config; other variants do
    // not satisfy the requirement.
    let mut ts = cypress_root();
    ts[0].0 = "cypress.config.ts";
    assert_eq!(compute(TreeProfile::CypressRoot, &ts).unwrap_err().code, "FINGERPRINT_REQUIRED_FILE_MISSING");
    // The envelope path rule still applies.
    for bad in ["../x", "/abs", "a//b", "a/./b"] {
        let mut files = cypress_root();
        files.push((bad, &b"x"[..]));
        assert_eq!(compute(TreeProfile::CypressRoot, &files).unwrap_err().code, "FINGERPRINT_PATH", "{bad}");
    }
    // A Cypress fingerprint does not satisfy a Playwright root (A2.1 membership).
    let pw = with(&v, &r0(&[P::K("fingerprint")]), fingerprint_value(&entries, &digest));
    assert_eq!(kind_code(&pw), (ErrorKind::Fingerprint, "FINGERPRINT_PATH"));
    // The Playwright fixture does not satisfy a Cypress root (required members).
    assert_eq!(kind_code(&cy_framework), (ErrorKind::Fingerprint, "FINGERPRINT_REQUIRED_FILE_MISSING"));
}

#[test]
fn qualification_scalar_rules() {
    let v = enrollment();
    let set = |k: &str, new: Value| with(&v, &q(&[P::K(k)]), new);
    assert_eq!(code(&set("profileVersion", s("od06-linux-v2"))), "SCHEMA_LITERAL");
    for k in ["osBuild", "kernelBuild", "systemdBuild", "sudoBuild", "brokerBuild"] {
        ok(&set(k, s(&"b".repeat(256))));
        ok(&set(k, s("")));
        for bad in [&"b".repeat(257) as &str, "tab\there", "\u{e9}", "c\u{1}"] {
            assert_eq!(code(&set(k, s(bad))), "SCHEMA_GRAMMAR", "{k} {bad:?}");
        }
    }
    for good in ["22.0.0", "22.23.5", "22.123.45"] {
        ok(&set("nodeVersion", s(good)));
    }
    for bad in ["23.0.0", "22.1", "22.01.0", "22.1.01", "v22.1.1", "22.1.1-rc.1", "22.1.1+b", "22..1", ""] {
        assert_eq!(code(&set("nodeVersion", s(bad))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    for bad in ["bin/node", "/opt/node/", "/opt//node", "/opt/%n"] {
        assert_eq!(code(&set("nodePath", s(bad))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    assert_eq!(code(&set("nodeSha256", s("sha256:XYZ"))), "SCHEMA_GRAMMAR");
}

fn playwright_profile(v: &Value) -> Value {
    get(v, &q(&[P::K("frameworkProfiles"), P::I(0)])).clone()
}

fn cypress_profile(v: &Value) -> Value {
    let p = with(&playwright_profile(v), &[P::K("framework")], s("cypress"));
    with(&p, &[P::K("adapterVersion")], s("od06-cypress-v1"))
}

#[test]
fn framework_profile_rules() {
    let v = enrollment();
    let profiles = |list: Vec<Value>| with(&v, &q(&[P::K("frameworkProfiles")]), Value::Array(list));
    let (pw, cy) = (playwright_profile(&v), cypress_profile(&v));
    ok(&profiles(vec![]));
    ok(&profiles(vec![cy.clone(), pw.clone()]));
    assert_eq!(code(&profiles(vec![pw.clone(), cy.clone(), pw.clone()])), "ENROLLMENT_PROFILE_COUNT");
    assert_eq!(code(&profiles(vec![pw.clone(), pw.clone()])), "ENROLLMENT_PROFILE_DUPLICATE");
    let field = |k: &str, new: Value| profiles(vec![with(&pw, &[P::K(k)], new)]);
    assert_eq!(code(&field("adapterVersion", s("od06-cypress-v1"))), "ENROLLMENT_ADAPTER_MISMATCH");
    assert_eq!(code(&field("adapterVersion", s("od06-jest-v1"))), "SCHEMA_GRAMMAR");
    assert_eq!(code(&field("framework", s("jest"))), "SCHEMA_GRAMMAR");
    for k in ["nativePath", "browserPath"] {
        assert_eq!(code(&field(k, s("relative/path"))), "SCHEMA_GRAMMAR", "{k}");
    }
    for k in ["packageSha256", "nativeSha256", "browserSha256"] {
        assert_eq!(code(&field(k, s("sha256:x"))), "SCHEMA_GRAMMAR", "{k}");
    }
    // ARCH-B1-02: "versions<=256" only, counted in UTF-8 bytes; the
    // build-specific ASCII/no-controls rule does not apply to versions.
    for k in ["packageVersion", "nativeVersion", "browserVersion"] {
        ok(&field(k, s(&"9".repeat(256))));
        ok(&field(k, s("")));
        ok(&field(k, s("1.0.0-\u{3b2} (tab\there)")));
        ok(&field(k, s(&"\u{e9}".repeat(128))));
        assert_eq!(code(&field(k, s(&"9".repeat(257)))), "SCHEMA_GRAMMAR", "{k}");
        assert_eq!(code(&field(k, s(&format!("{}9", "\u{e9}".repeat(128))))), "SCHEMA_GRAMMAR", "{k}");
    }
}

#[test]
fn workload_storage_bounds() {
    let v = enrollment();
    let ws = |k: &str, new: Value| with(&v, &q(&[P::K("workloadStorage"), P::K(k)]), new);
    for fs in ["ext4", "xfs", "f2fs"] {
        ok(&ws("fsType", s(fs)));
    }
    for fs in ["btrfs", "EXT4", "tmpfs", ""] {
        assert_eq!(code(&ws("fsType", s(fs))), "SCHEMA_GRAMMAR", "{fs:?}");
    }
    let both = |max: i64, min: i64| {
        let x = ws("maxBytes", Value::Int(max));
        with(&x, &q(&[P::K("workloadStorage"), P::K("minFreeBytes")]), Value::Int(min))
    };
    ok(&both(1_073_741_824, 67_108_864));
    ok(&both(1_099_511_627_776, 1_099_511_627_776));
    ok(&both(1_610_612_736, 1_610_612_736));
    for (max, min) in [
        (1_073_741_823, 67_108_864),
        (1_099_511_627_777, 67_108_864),
        (1_610_612_736, 67_108_863),
        (1_610_612_736, 1_610_612_737),
    ] {
        assert_eq!(code(&both(max, min)), "SCHEMA_RANGE", "{max} {min}");
    }
}

#[test]
fn r1_profile_requires_exactly_one_playwright_profile() {
    let v = enrollment();
    let base = get(&v, &q(&[])).clone();
    let r1 = |list: Vec<Value>| {
        check_r1_profile(&validate_qualification(&with(&base, &[P::K("frameworkProfiles")], Value::Array(list))).unwrap())
    };
    let (pw, cy) = (playwright_profile(&v), cypress_profile(&v));
    assert!(r1(vec![pw.clone()]).is_ok());
    for list in [vec![], vec![cy.clone()], vec![cy, pw]] {
        let e = r1(list).unwrap_err();
        assert_eq!((e.kind, e.code), (ErrorKind::Enrollment, "R1_PROFILE"));
    }
}

#[test]
fn document_size_and_strict_json() {
    let mut doc = ENROLLMENT.to_vec();
    doc.resize(ENROLLMENT_LIMITS.max_bytes, b' ');
    assert!(parse_enrollment(&doc).is_ok(), "exactly 1048576 bytes");
    doc.push(b' ');
    assert_eq!(parse_enrollment(&doc).unwrap_err().code, "JSON_TOO_LARGE");
    let dup = String::from_utf8(ENROLLMENT.to_vec()).unwrap().replacen("\"enabled\": true", "\"enabled\": true, \"enabled\": true", 1);
    assert_eq!(parse_enrollment(dup.as_bytes()).unwrap_err().code, "JSON_DUPLICATE_KEY");
}

#[test]
fn errors_do_not_echo_input() {
    let v = enrollment();
    let e = validate_enrollment(&with(&v, &[P::K("caller"), P::K("account")], s("secret value!"))).unwrap_err();
    assert!(!e.to_string().contains("secret"));
}
