//! B2-01..05: Stage 4 `root-identity-v1`, the closed execution binding,
//! `bindingDigest` and the data-only agreements. All fixtures are synthetic.
//! The `b2-*` vectors were written by the repository's own JavaScript: Stage 4
//! `rootDigest`/`resolvePrincipal` (`scripts/ai/cli/stage4-principal.js`) and
//! CRS-1 `encodeValue`/`digest`.

mod b1_common;

use b1_common::*;
use qa_agent_controller_v1::binding::{
    check_enrollment_agreement, check_record_agreement, check_request_agreement, compute_binding_digest,
    parse_binding, validate_binding, BINDING_KEYS, PRINCIPAL_KEYS,
};
use qa_agent_controller_v1::canonical;
use qa_agent_controller_v1::compatibility::parse_compatibility_record;
use qa_agent_controller_v1::enrollment::validate_enrollment;
use qa_agent_controller_v1::error::ErrorKind;
use qa_agent_controller_v1::json::{parse_strict, Value, FRAME_LIMITS, MAX_SAFE_INTEGER};
use qa_agent_controller_v1::request::{validate_request, CreateRequest, Request, Root};
use qa_agent_controller_v1::root_identity;

const BINDING: &[u8] = include_bytes!("vectors/b2-binding.json");
const BINDING_H: &str = include_str!("vectors/b2-binding.h");
const REQUEST: &[u8] = include_bytes!("vectors/b2-request.json");
const ROOT_H: &str = include_str!("vectors/b2-root.h");
const STAGE4_GOLDEN_H: &str = include_str!("vectors/b2-stage4-root-golden.h");

fn binding() -> Value {
    parse_strict(BINDING, FRAME_LIMITS).expect("binding fixture")
}

fn request_value() -> Value {
    parse_strict(REQUEST, FRAME_LIMITS).expect("request fixture")
}

fn create(v: &Value) -> CreateRequest {
    match validate_request(v).expect("valid request") {
        Request::Create(c) => c,
        Request::Reconcile { .. } => panic!("not a create request"),
    }
}

/// Recomputes `bindingDigest` so that only the field under test differs.
fn seal(v: &Value) -> Value {
    let d = compute_binding_digest(v).expect("digest");
    with(v, &[P::K("bindingDigest")], s(&d))
}

fn code(v: &Value) -> (ErrorKind, &'static str) {
    let e = validate_binding(v).expect_err("must refuse");
    (e.kind, e.code)
}

fn binding_code(v: &Value) -> &'static str {
    let (kind, code) = code(v);
    assert_eq!(kind, ErrorKind::Binding, "{code}");
    code
}

/// A root record value with a Stage 4-consistent digest.
fn root_value(path: &str, dev: &str, ino: &str) -> Value {
    let r = Root { path: path.into(), dev: dev.into(), ino: ino.into(), digest: String::new() };
    let d = root_identity::digest(&r).unwrap();
    Value::object(vec![("platform", s("linux")), ("path", s(path)), ("dev", s(dev)), ("ino", s(ino)), ("digest", s(&d))])
}

fn cypress_targets() -> Value {
    Value::Array(vec![Value::object(vec![
        ("path", s("cypress/e2e/checkout.cy.js")),
        ("operation", s("CREATE")),
        ("afterDigest", s(&h('b'))),
    ])])
}

#[test]
fn stage4_root_identity_golden_parity() {
    // Stage 4 stage4-principal.test.js: the exact serialization and digest.
    let r = Root { path: "/tmp/\u{e9}".into(), dev: "1".into(), ino: "2".into(), digest: STAGE4_GOLDEN_H.into() };
    // CRS-1 escapes U+00E9 as backslash-u00e9; the backslash is built from its
    // code point so the expected bytes stay pure ASCII.
    let backslash = char::from(0x5c);
    let expected = format!(
        "{}{backslash}u00e9\"}}",
        r#"{"dev":"1","identityVersion":1,"ino":"2","platform":"linux","rootPath":"/tmp/"#
    );
    assert!(expected.is_ascii());
    assert_eq!(canonical::encode(&root_identity::identity_value(&r)).unwrap(), expected.into_bytes());
    assert_eq!(root_identity::digest(&r).unwrap(), STAGE4_GOLDEN_H);
    assert_eq!(STAGE4_GOLDEN_H, "sha256:23082e5b682ef90dba3c14c993239e65bdc1e435d52d21e7189453e211f604f3");
    root_identity::verify(&r).unwrap();
}

#[test]
fn root_identity_covers_every_field() {
    let b = parse_binding(BINDING).unwrap();
    assert_eq!(b.root.digest, ROOT_H);
    assert_eq!(root_identity::digest(&b.root).unwrap(), ROOT_H);
    let mut variants = vec![b.root.clone(), b.root.clone(), b.root.clone(), b.root.clone()];
    variants[0].path.push_str("x");
    variants[1].dev = "65026".into();
    variants[2].ino = "262146".into();
    variants[3].digest = h('0');
    for r in variants {
        let e = root_identity::verify(&r).unwrap_err();
        assert_eq!((e.kind, e.code), (ErrorKind::RootIdentity, "ROOT_IDENTITY_MISMATCH"));
    }
}

#[test]
fn golden_binding_validates_with_js_digest() {
    let b = parse_binding(BINDING).unwrap();
    assert_eq!(b.binding_digest, BINDING_H);
    assert_eq!(compute_binding_digest(&binding()).unwrap(), BINDING_H);
    assert_eq!(b.principal.principal, "os-account-v1:qarunner");
    assert_eq!((b.principal.uid, b.principal.profile_digest.as_deref()), (Some(1001), None));
    assert_eq!((b.framework.as_str(), b.targets.len(), b.timeout_ms), ("playwright", 2, 600_000));
    assert_eq!(b.fingerprint_digest, FINGERPRINT_H);
    assert_eq!(b.profile_digest, PROFILE_H);
}

#[test]
fn closed_schema_at_every_level() {
    let v = binding();
    assert_eq!(binding_code(&Value::Array(vec![])), "SCHEMA_NOT_OBJECT");
    for k in BINDING_KEYS {
        assert_eq!(binding_code(&without(&v, &[], k)), "SCHEMA_KEY_SET", "{k}");
    }
    assert_eq!(binding_code(&adding(&v, &[], "extra", Value::Null)), "SCHEMA_KEY_SET");
    let nested: [(&[P<'_>], &[&str]); 4] = [
        (&[P::K("product")], &["name", "version"]),
        (&[P::K("root")], &["platform", "path", "dev", "ino", "digest"]),
        (&[P::K("principal")], &PRINCIPAL_KEYS),
        (&[P::K("targets"), P::I(0)], &["path", "operation", "afterDigest"]),
    ];
    for (path, keys) in nested {
        for k in keys {
            assert_eq!(binding_code(&without(&v, path, k)), "SCHEMA_KEY_SET", "{k}");
        }
        assert_eq!(binding_code(&adding(&v, path, "extra", Value::Null)), "SCHEMA_KEY_SET");
    }
}

#[test]
fn field_grammars_reuse_existing_rules() {
    let v = binding();
    let set = |k: &str, new: Value| with(&v, &[P::K(k)], new);
    for bad in ["", " x", &"p".repeat(129) as &str] {
        assert_eq!(binding_code(&set("projectId", s(bad))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    assert_eq!(binding_code(&set("runId", s("20261127T120000Z-0123"))), "SCHEMA_GRAMMAR");
    assert_eq!(binding_code(&set("packageOrdinal", s("0000"))), "SCHEMA_GRAMMAR");
    assert_eq!(binding_code(&with(&v, &[P::K("product"), P::K("name")], s("other"))), "SCHEMA_LITERAL");
    for bad in ["1.2", "01.2.3", "1.2.3 ", "^1.2.3"] {
        assert_eq!(binding_code(&with(&v, &[P::K("product"), P::K("version")], s(bad))), "SCHEMA_GRAMMAR", "{bad}");
    }
    for k in ["reviewRecordId", "applyRecordId"] {
        assert_eq!(binding_code(&set(k, s("0123456789ABCDEF0123456789ABCDEF"))), "SCHEMA_GRAMMAR", "{k}");
    }
    for k in [
        "reviewRecordDigest",
        "packageDigest",
        "changeSetDigest",
        "automationPlanDigest",
        "repositoryContextDigest",
        "projectionDigest",
        "appliedRecordSha256",
        "fingerprintDigest",
        "profileDigest",
        "bindingDigest",
    ] {
        assert_eq!(binding_code(&set(k, s("sha256:XYZ"))), "SCHEMA_GRAMMAR", "{k}");
    }
    assert_eq!(binding_code(&set("framework", s("jest"))), "SCHEMA_GRAMMAR");
    assert_eq!(binding_code(&set("timeoutMs", Value::Int(999))), "SCHEMA_RANGE");
    assert_eq!(binding_code(&set("timeoutMs", Value::Int(600_001))), "SCHEMA_RANGE");
    assert_eq!(binding_code(&set("timeoutMs", s("600000"))), "SCHEMA_TYPE");
    validate_binding(&seal(&set("timeoutMs", Value::Int(1000)))).unwrap();
    assert_eq!(binding_code(&with(&v, &[P::K("root"), P::K("platform")], s("darwin"))), "SCHEMA_LITERAL");
    assert_eq!(binding_code(&with(&v, &[P::K("root"), P::K("dev")], s("065025"))), "SCHEMA_GRAMMAR");
    // Targets use the existing OD-06 §4.2 target rules.
    let t0 = get(&v, &[P::K("targets"), P::I(0)]).clone();
    let t1 = get(&v, &[P::K("targets"), P::I(1)]).clone();
    assert_eq!(binding_code(&set("targets", Value::Array(vec![]))), "SCHEMA_TARGET_COUNT");
    assert_eq!(binding_code(&set("targets", Value::Array(vec![t0.clone(); 101]))), "SCHEMA_TARGET_COUNT");
    assert_eq!(binding_code(&set("targets", Value::Array(vec![t1.clone(), t0.clone()]))), "SCHEMA_TARGET_ORDER");
    let upper = with(&t1, &[P::K("path")], s("playwright/Checkout.spec.js"));
    assert_eq!(binding_code(&set("targets", Value::Array(vec![upper, t0.clone()]))), "SCHEMA_TARGET_CASE_FOLD_DUPLICATE");
    assert_eq!(binding_code(&set("targets", cypress_targets())), "SCHEMA_GRAMMAR");
    assert_eq!(binding_code(&with(&v, &[P::K("targets"), P::I(0), P::K("operation")], s("DELETE"))), "SCHEMA_GRAMMAR");
}

#[test]
fn principal_is_the_exact_stage4_envelope_for_the_linux_root() {
    let v = binding();
    let pr = |k: &str, new: Value| with(&v, &[P::K("principal"), P::K(k)], new);
    assert_eq!(binding_code(&pr("method", s("os-local-account-v2"))), "SCHEMA_LITERAL");
    assert_eq!(binding_code(&pr("assurance", s("STRONG"))), "SCHEMA_LITERAL");
    for bad in ["qarunner", "os-account-v2:qarunner", "os-account-v1:a\u{1}b", " os-account-v1:qarunner"] {
        assert_eq!(binding_code(&pr("principal", s(bad))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    assert_eq!(binding_code(&pr("platform", s("plan9"))), "SCHEMA_GRAMMAR");
    assert_eq!(binding_code(&pr("uid", Value::Int(0))), "SCHEMA_RANGE");
    assert_eq!(binding_code(&pr("uid", Value::Int(MAX_SAFE_INTEGER + 1))), "SCHEMA_RANGE");
    assert_eq!(binding_code(&pr("uid", Value::Null)), "BINDING_PRINCIPAL_UID");
    assert_eq!(binding_code(&pr("uid", s("1001"))), "SCHEMA_TYPE");
    validate_binding(&seal(&pr("uid", Value::Int(MAX_SAFE_INTEGER)))).unwrap();
    assert_eq!(binding_code(&pr("profileDigest", s(&h('a')))), "BINDING_PRINCIPAL_PROFILE_DIGEST");
    // A valid Stage 4 envelope for another platform is refused for the linux root.
    assert_eq!(binding_code(&seal(&pr("platform", s("darwin")))), "BINDING_PRINCIPAL_PLATFORM");
    let win = with(&pr("platform", s("win32")), &[P::K("principal"), P::K("uid")], Value::Null);
    let win = with(&win, &[P::K("principal"), P::K("profileDigest")], s(&h('a')));
    assert_eq!(binding_code(&seal(&win)), "BINDING_PRINCIPAL_PLATFORM");
    // win32 envelope rules (Stage 4): uid null and profileDigest H.
    assert_eq!(binding_code(&with(&win, &[P::K("principal"), P::K("uid")], Value::Int(1))), "BINDING_PRINCIPAL_UID");
    assert_eq!(
        binding_code(&with(&win, &[P::K("principal"), P::K("profileDigest")], Value::Null)),
        "BINDING_PRINCIPAL_PROFILE_DIGEST"
    );
}

#[test]
fn root_must_be_root_identity_v1_consistent() {
    let v = binding();
    let wrong_digest = seal(&with(&v, &[P::K("root"), P::K("digest")], s(&h('0'))));
    assert_eq!(code(&wrong_digest), (ErrorKind::RootIdentity, "ROOT_IDENTITY_MISMATCH"));
    let moved = seal(&with(&v, &[P::K("root"), P::K("path")], s("/srv/qa-workspace/other")));
    assert_eq!(code(&moved), (ErrorKind::RootIdentity, "ROOT_IDENTITY_MISMATCH"));
    let consistent = seal(&with(&v, &[P::K("root")], root_value("/srv/qa-workspace/other", "65025", "7")));
    validate_binding(&consistent).unwrap();
}

#[test]
fn digest_is_canonical_and_covers_every_field() {
    let v = binding();
    // Key order and formatting do not matter (CRS-1 over the parsed value).
    let reversed = match &v {
        Value::Object(m) => Value::Object(m.iter().rev().cloned().collect()),
        _ => unreachable!(),
    };
    assert_eq!(validate_binding(&reversed).unwrap().binding_digest, BINDING_H);
    // Changing any bound field to another valid value without resealing is refused.
    let changed: Vec<(&str, Value)> = vec![
        ("projectId", with(&v, &[P::K("projectId")], s("other-project"))),
        ("runId", with(&v, &[P::K("runId")], s("20261128T120000Z-0123456789abcdef"))),
        ("packageOrdinal", with(&v, &[P::K("packageOrdinal")], s("0002"))),
        ("product", with(&v, &[P::K("product"), P::K("version")], s("1.2.4"))),
        ("root", with(&v, &[P::K("root")], root_value("/srv/qa-workspace/other", "65025", "7"))),
        ("principal", with(&v, &[P::K("principal"), P::K("uid")], Value::Int(1002))),
        ("reviewRecordId", with(&v, &[P::K("reviewRecordId")], s(&"9".repeat(32)))),
        ("applyRecordId", with(&v, &[P::K("applyRecordId")], s(&"9".repeat(32)))),
        ("targets", with(&v, &[P::K("targets"), P::I(0), P::K("afterDigest")], s(&h('9')))),
        ("framework", with(&with(&v, &[P::K("framework")], s("cypress")), &[P::K("targets")], cypress_targets())),
        ("timeoutMs", with(&v, &[P::K("timeoutMs")], Value::Int(599_999))),
        ("bindingDigest", with(&v, &[P::K("bindingDigest")], s(&h('9')))),
    ];
    let mut changed = changed;
    for k in [
        "reviewRecordDigest",
        "packageDigest",
        "changeSetDigest",
        "automationPlanDigest",
        "repositoryContextDigest",
        "projectionDigest",
        "appliedRecordSha256",
        "fingerprintDigest",
        "profileDigest",
    ] {
        changed.push((k, with(&v, &[P::K(k)], s(&h('9')))));
    }
    let covered: Vec<&str> = changed.iter().map(|(k, _)| *k).collect();
    assert!(BINDING_KEYS.iter().all(|k| covered.contains(k)), "every binding key is covered");
    for (k, doc) in &changed {
        assert_eq!(binding_code(doc), "BINDING_DIGEST_MISMATCH", "{k}");
        if *k != "bindingDigest" {
            validate_binding(&seal(doc)).unwrap();
        }
    }
    // The digest needs its own field to exclude.
    assert_eq!(compute_binding_digest(&without(&v, &[], "bindingDigest")).unwrap_err().code, "DIGEST_FIELD_MISSING");
}

#[test]
fn request_agreement() {
    let b = parse_binding(BINDING).unwrap();
    let r = request_value();
    check_request_agreement(&b, &create(&r)).unwrap();
    // Environment values are request-only data, not bound.
    let env = Value::Array(vec![Value::object(vec![("name", s("SUT_BASE_URL")), ("value", s("http://localhost"))])]);
    check_request_agreement(&b, &create(&with(&r, &[P::K("environment")], env))).unwrap();

    let refuse = |doc: &Value| {
        let e = check_request_agreement(&b, &create(doc)).unwrap_err();
        (e.kind, e.code)
    };
    let sub = |k: &str, new: Value| with(&r, &[P::K("subject"), P::K(k)], new);
    assert_eq!(refuse(&sub("bindingDigest", s(&h('9')))), (ErrorKind::Binding, "BINDING_REQUEST_DIGEST_MISMATCH"));
    assert_eq!(
        refuse(&with(&r, &[P::K("root"), P::K("digest")], s(&h('0')))),
        (ErrorKind::RootIdentity, "ROOT_IDENTITY_MISMATCH")
    );
    assert_eq!(
        refuse(&with(&r, &[P::K("root")], root_value("/srv/qa-workspace/other", "65025", "7"))),
        (ErrorKind::Binding, "BINDING_REQUEST_ROOT_MISMATCH")
    );
    for (k, new) in [
        ("runId", s("20261128T120000Z-0123456789abcdef")),
        ("packageOrdinal", s("0002")),
        ("applyRecordId", s(&"9".repeat(32))),
        ("packageDigest", s(&h('9'))),
        ("appliedRecordSha256", s(&h('9'))),
    ] {
        assert_eq!(refuse(&sub(k, new)), (ErrorKind::Binding, "BINDING_REQUEST_SUBJECT_MISMATCH"), "{k}");
    }
    assert_eq!(
        refuse(&with(&r, &[P::K("subject"), P::K("product"), P::K("version")], s("1.2.4"))),
        (ErrorKind::Binding, "BINDING_REQUEST_SUBJECT_MISMATCH")
    );
    let cy = with(&with(&r, &[P::K("framework")], s("cypress")), &[P::K("targets")], cypress_targets());
    assert_eq!(refuse(&cy), (ErrorKind::Binding, "BINDING_REQUEST_FRAMEWORK_MISMATCH"));
    assert_eq!(
        refuse(&with(&r, &[P::K("targets"), P::I(1), P::K("afterDigest")], s(&h('9')))),
        (ErrorKind::Binding, "BINDING_REQUEST_TARGETS_MISMATCH")
    );
    let first_only = Value::Array(vec![get(&r, &[P::K("targets"), P::I(0)]).clone()]);
    assert_eq!(refuse(&with(&r, &[P::K("targets")], first_only)), (ErrorKind::Binding, "BINDING_REQUEST_TARGETS_MISMATCH"));
    assert_eq!(
        refuse(&with(&r, &[P::K("timeoutMs")], Value::Int(599_999))),
        (ErrorKind::Binding, "BINDING_REQUEST_TIMEOUT_MISMATCH")
    );
}

#[test]
fn compatibility_record_agreement() {
    let b = parse_binding(BINDING).unwrap();
    let record = parse_compatibility_record(RECORD).unwrap();
    check_record_agreement(&b, &record).unwrap();
    let other = parse_binding(&enc(&seal(&with(&binding(), &[P::K("profileDigest")], s(&h('9')))))).unwrap();
    let e = check_record_agreement(&other, &record).unwrap_err();
    assert_eq!((e.kind, e.code), (ErrorKind::Binding, "BINDING_PROFILE_DIGEST_MISMATCH"));
}

#[test]
fn enrollment_agreement() {
    let b = parse_binding(BINDING).unwrap();
    // The B1 vector's enrolled root carries a synthetic digest; enrolling the
    // same root with its Stage 4 digest makes it the binding's root.
    let enrolled = with(&enrollment(), &[P::K("roots"), P::I(0), P::K("root"), P::K("digest")], s(ROOT_H));
    let e = validate_enrollment(&enrolled).unwrap();
    assert_eq!(check_enrollment_agreement(&b, &e).unwrap().project_id, "qa-agent-demo");

    let refuse = |b: &qa_agent_controller_v1::binding::Binding, enrollment: &Value| {
        let e = check_enrollment_agreement(b, &validate_enrollment(enrollment).unwrap()).unwrap_err();
        (e.kind, e.code)
    };
    assert_eq!(refuse(&b, &enrollment()), (ErrorKind::Binding, "BINDING_ROOT_NOT_ENROLLED"));
    let other_project = with(&enrolled, &[P::K("roots"), P::I(0), P::K("projectId")], s("other-project"));
    assert_eq!(refuse(&b, &other_project), (ErrorKind::Binding, "BINDING_ENROLLED_PROJECT_MISMATCH"));
    let rebound = |doc: Value| parse_binding(&enc(&seal(&doc))).unwrap();
    let cy = rebound(with(&with(&binding(), &[P::K("framework")], s("cypress")), &[P::K("targets")], cypress_targets()));
    assert_eq!(refuse(&cy, &enrolled), (ErrorKind::Binding, "BINDING_ENROLLED_FRAMEWORK_MISMATCH"));
    let stale = rebound(with(&binding(), &[P::K("fingerprintDigest")], s(&h('9'))));
    assert_eq!(refuse(&stale, &enrolled), (ErrorKind::Binding, "BINDING_FINGERPRINT_DIGEST_MISMATCH"));
}
