//! B1-01, B1-02, B1-05 (comparison) and B1-06: the OD-06 §5.4 compatibility
//! record, its digest, the enrollment binding and the request agreement.

mod b1_common;
mod common;

use b1_common::*;
use qa_agent_controller_v1::compatibility::{
    check_enrollment_binding, check_request_agreement, parse_compatibility_record, validate_compatibility_record,
    COMPATIBILITY_LIMITS,
};
use qa_agent_controller_v1::enrollment::{parse_enrollment, validate_enrollment};
use qa_agent_controller_v1::error::ErrorKind;
use qa_agent_controller_v1::json::Value;
use qa_agent_controller_v1::request::{parse_request, CreateRequest, Request};

fn code(v: &Value) -> &'static str {
    validate_compatibility_record(v).expect_err("must refuse").code
}

#[test]
fn golden_record_validates_with_js_digest() {
    let r = parse_compatibility_record(RECORD).unwrap();
    assert_eq!(r.digest, COMPATIBILITY_H);
    assert_eq!(r.profile_digest, PROFILE_H);
    assert_eq!(r.product_version, "1.2.3");
    assert_eq!(r.broker_sha256, h('5'));
}

#[test]
fn digest_is_canonical_and_covers_every_field() {
    let v = record();
    let reordered = match &v {
        Value::Object(m) => Value::Object(m.iter().rev().cloned().collect()),
        _ => unreachable!(),
    };
    assert_eq!(validate_compatibility_record(&reordered).unwrap().digest, COMPATIBILITY_H);
    // Compact canonical bytes and the pretty-printed fixture hash the same.
    assert_eq!(parse_compatibility_record(&enc(&v)).unwrap().digest, COMPATIBILITY_H);
    for (path, new) in [
        (vec![P::K("brokerSha256")], s(&h('6'))),
        (vec![P::K("profileDigest")], s(&h('7'))),
        (vec![P::K("product"), P::K("version")], s("1.2.4")),
    ] {
        assert_ne!(validate_compatibility_record(&with(&v, &path, new)).unwrap().digest, COMPATIBILITY_H);
    }
}

#[test]
fn closed_record_schema() {
    let v = record();
    assert_eq!(code(&adding(&v, &[], "extra", Value::Null)), "SCHEMA_KEY_SET");
    assert_eq!(code(&without(&v, &[], "brokerSha256")), "SCHEMA_KEY_SET");
    assert_eq!(code(&adding(&v, &[P::K("product")], "extra", Value::Null)), "SCHEMA_KEY_SET");
    assert_eq!(code(&with(&v, &[P::K("schemaVersion")], Value::Int(2))), "SCHEMA_RANGE");
    assert_eq!(code(&with(&v, &[P::K("product"), P::K("name")], s("other"))), "SCHEMA_LITERAL");
    // A record whose contractVersion differs from the compiled literal is refused.
    assert_eq!(code(&with(&v, &[P::K("contractVersion")], s("qa-agent-controller-v2"))), "SCHEMA_LITERAL");
    let version = |x: &str| with(&v, &[P::K("product"), P::K("version")], s(x));
    validate_compatibility_record(&version(&format!("1.2.3-{}", "a".repeat(58)))).unwrap(); // 64 bytes
    for bad in ["^1.2.3", "latest", "1.2", "v1.2.3", &format!("1.2.3-{}", "a".repeat(59))] {
        assert_eq!(code(&version(bad)), "SCHEMA_GRAMMAR", "{bad}");
    }
    for k in ["brokerSha256", "profileDigest"] {
        assert_eq!(code(&with(&v, &[P::K(k)], s("sha256:x"))), "SCHEMA_GRAMMAR", "{k}");
    }
    let e = validate_compatibility_record(&with(&v, &[P::K("schemaVersion")], s("1"))).unwrap_err();
    assert_eq!((e.kind, e.code), (ErrorKind::Compatibility, "SCHEMA_TYPE"));
    let big = vec![b' '; COMPATIBILITY_LIMITS.max_bytes + 1];
    assert_eq!(parse_compatibility_record(&big).unwrap_err().code, "JSON_TOO_LARGE");
}

#[test]
fn enrollment_binding() {
    let e = parse_enrollment(ENROLLMENT).unwrap();
    let r = parse_compatibility_record(RECORD).unwrap();
    check_enrollment_binding(&e, &r).unwrap();
    // The enrollment is pinned to a different record.
    let other = validate_enrollment(&with(&enrollment(), &[P::K("compatibilityDigest")], s(&h('8')))).unwrap();
    assert_eq!(check_enrollment_binding(&other, &r).unwrap_err().code, "COMPATIBILITY_DIGEST_MISMATCH");
    // The record changed after enrollment.
    let r2 = validate_compatibility_record(&with(&record(), &[P::K("brokerSha256")], s(&h('9')))).unwrap();
    assert_eq!(check_enrollment_binding(&e, &r2).unwrap_err().code, "COMPATIBILITY_DIGEST_MISMATCH");
    // Stale qualification: still pinned to the same record, qualification changed.
    let stale = validate_enrollment(&with(
        &enrollment(),
        &[P::K("qualification"), P::K("kernelBuild")],
        s("synthetic other kernel"),
    ))
    .unwrap();
    assert_eq!(check_enrollment_binding(&stale, &r).unwrap_err().code, "COMPATIBILITY_PROFILE_DIGEST_MISMATCH");
}

fn create(version: &str) -> CreateRequest {
    let v = common::with(&common::valid_create(), &["subject", "product", "version"], common::s(version));
    match parse_request(&common::bytes(&v)).unwrap() {
        Request::Create(c) => c,
        Request::Reconcile { .. } => unreachable!(),
    }
}

#[test]
fn request_record_agreement() {
    let r = parse_compatibility_record(RECORD).unwrap();
    check_request_agreement(&r, &create("1.2.3")).unwrap();
    for other in ["1.2.4", "1.2.3-rc.1", "2.0.0"] {
        let e = check_request_agreement(&r, &create(other)).unwrap_err();
        assert_eq!((e.kind, e.code), (ErrorKind::Compatibility, "COMPATIBILITY_PRODUCT_VERSION_MISMATCH"), "{other}");
    }
}
