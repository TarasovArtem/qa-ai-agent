mod common;

use common::*;
use qa_agent_controller_v1::json::Value;
use qa_agent_controller_v1::request::{parse_request, Request};

fn refuse(v: &Value) -> &'static str {
    parse_request(&bytes(v)).expect_err("must refuse").code
}

#[test]
fn accepts_valid_create() {
    let Request::Create(c) = parse_request(&bytes(&valid_create())).unwrap() else { panic!("create expected") };
    assert_eq!(c.execution_id, EXEC_ID);
    assert_eq!(c.framework, "playwright");
    assert_eq!(c.targets.len(), 2);
    assert_eq!(c.timeout_ms, 600_000);
    assert_eq!(c.subject.product_version, "1.2.3");
    assert_eq!(c.environment[0].name, "SUT_BASE_URL");
}

#[test]
fn accepts_valid_reconcile_and_refuses_extra_keys() {
    let r = obj(vec![
        ("schemaVersion", Value::Int(1)),
        ("contractVersion", s("qa-agent-controller-v1")),
        ("operation", s("reconcile")),
        ("executionId", s(EXEC_ID)),
    ]);
    assert_eq!(parse_request(&bytes(&r)).unwrap(), Request::Reconcile { execution_id: EXEC_ID.into() });
    assert_eq!(refuse(&adding(&r, "root", Value::Null)), "SCHEMA_KEY_SET");
}

#[test]
fn closed_top_level_schema() {
    let v = valid_create();
    assert_eq!(refuse(&adding(&v, "extra", Value::Null)), "SCHEMA_KEY_SET");
    assert_eq!(refuse(&without(&v, &["environment"])), "SCHEMA_KEY_SET");
    assert_eq!(refuse(&with(&v, &["operation"], s("inspect"))), "SCHEMA_OPERATION");
    assert_eq!(refuse(&with(&v, &["schemaVersion"], Value::Int(2))), "SCHEMA_RANGE");
    assert_eq!(refuse(&with(&v, &["schemaVersion"], s("1"))), "SCHEMA_TYPE");
    assert_eq!(refuse(&with(&v, &["contractVersion"], s("qa-agent-controller-v2"))), "SCHEMA_LITERAL");
    assert_eq!(refuse(&with(&v, &["executionId"], s(&EXEC_ID.to_uppercase()))), "SCHEMA_GRAMMAR");
    assert_eq!(refuse(&with(&v, &["executionId"], Value::Null)), "SCHEMA_TYPE");
    assert_eq!(refuse(&with(&v, &["framework"], s("jest"))), "SCHEMA_GRAMMAR");
}

#[test]
fn closed_nested_records() {
    let v = valid_create();
    assert_eq!(refuse(&with(&v, &["root", "platform"], s("darwin"))), "SCHEMA_LITERAL");
    assert_eq!(refuse(&without(&v, &["root", "digest"])), "SCHEMA_KEY_SET");
    assert_eq!(refuse(&with(&v, &["subject", "product", "name"], s("other"))), "SCHEMA_LITERAL");
    assert_eq!(refuse(&adding(&with(&v, &["root"], Value::Null), "x", Value::Null)), "SCHEMA_KEY_SET");
}

#[test]
fn root_identity_grammar() {
    let v = valid_create();
    for bad in ["srv/rel", "/srv//x", "/srv/x/", "/srv/./x", "/srv/../x", "/srv/%h", "/srv/a\u{1}b", "/srv/a\u{85}b"] {
        assert_eq!(refuse(&with(&v, &["root", "path"], s(bad))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    let long = format!("/{}", "a".repeat(4096));
    assert_eq!(refuse(&with(&v, &["root", "path"], s(&long))), "SCHEMA_GRAMMAR");
    for bad in ["", "01", "-1", "1.0", "123456789012345678901"] {
        assert_eq!(refuse(&with(&v, &["root", "dev"], s(bad))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    assert!(parse_request(&bytes(&with(&v, &["root", "ino"], s("0")))).is_ok());
    assert_eq!(refuse(&with(&v, &["root", "digest"], s(&h('A')))), "SCHEMA_GRAMMAR");
}

#[test]
fn subject_grammar() {
    let v = valid_create();
    assert_eq!(refuse(&with(&v, &["subject", "runId"], s("20261126T120000Z-0123456789ABCDEF"))), "SCHEMA_GRAMMAR");
    assert_eq!(refuse(&with(&v, &["subject", "packageOrdinal"], s("0000"))), "SCHEMA_GRAMMAR");
    assert_eq!(refuse(&with(&v, &["subject", "packageOrdinal"], s("01"))), "SCHEMA_GRAMMAR");
    for bad in ["^1.2.3", "latest", "1.2", "01.2.3", "1.2.3-01", "1.2.3+", "v1.2.3"] {
        assert_eq!(refuse(&with(&v, &["subject", "product", "version"], s(bad))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    for ok in ["0.0.0", "1.2.3-rc.1", "1.2.3-0a", "1.2.3+build.5", "10.20.30-alpha-1+x"] {
        assert!(parse_request(&bytes(&with(&v, &["subject", "product", "version"], s(ok)))).is_ok(), "{ok:?}");
    }
}

#[test]
fn targets_rules() {
    let v = valid_create();
    assert_eq!(refuse(&with(&v, &["targets"], Value::Array(vec![]))), "SCHEMA_TARGET_COUNT");
    let many: Vec<Value> = (0..101).map(|i| target(&format!("playwright/t{i:03}.spec.js"), "CREATE")).collect();
    assert_eq!(refuse(&with(&v, &["targets"], Value::Array(many))), "SCHEMA_TARGET_COUNT");
    let hundred: Vec<Value> = (0..100).map(|i| target(&format!("playwright/t{i:03}.spec.js"), "CREATE")).collect();
    assert!(parse_request(&bytes(&with(&v, &["targets"], Value::Array(hundred)))).is_ok());
    let unsorted = Value::Array(vec![target("playwright/b.spec.js", "CREATE"), target("playwright/a.spec.js", "CREATE")]);
    assert_eq!(refuse(&with(&v, &["targets"], unsorted)), "SCHEMA_TARGET_ORDER");
    let dup = Value::Array(vec![target("playwright/a.spec.js", "CREATE"), target("playwright/a.spec.js", "MODIFY")]);
    assert_eq!(refuse(&with(&v, &["targets"], dup)), "SCHEMA_TARGET_ORDER");
    let bad_op = Value::Array(vec![target("playwright/a.spec.js", "DELETE")]);
    assert_eq!(refuse(&with(&v, &["targets"], bad_op)), "SCHEMA_GRAMMAR");
    for bad in [
        "cypress/a.spec.js",
        "playwright",
        "playwright/.hidden.spec.js",
        "playwright/CON.spec.js",
        "playwright/a.",
        "playwright//a.js",
        "playwright/a b.js",
        "playwright/a\\b.js",
        "playwright/node_modules/a.js",
        "playwright/Node_Modules/a.js",
        "playwright/x/package.json",
        "playwright/x/PACKAGE-LOCK.JSON",
        "playwright/a@b.js",
    ] {
        let t = Value::Array(vec![target(bad, "CREATE")]);
        assert_eq!(refuse(&with(&v, &["targets"], t)), "SCHEMA_GRAMMAR", "{bad:?}");
    }
}

#[test]
fn cypress_targets_are_schema_valid() {
    // R1 refuses Cypress by eligibility (INELIGIBLE, amendment A1), not by schema.
    let v = with(&valid_create(), &["framework"], s("cypress"));
    let v = with(&v, &["targets"], Value::Array(vec![target("cypress/e2e/a.cy.js", "CREATE")]));
    assert!(parse_request(&bytes(&v)).is_ok());
}

#[test]
fn timeout_bounds() {
    let v = valid_create();
    assert!(parse_request(&bytes(&with(&v, &["timeoutMs"], Value::Int(1000)))).is_ok());
    assert_eq!(refuse(&with(&v, &["timeoutMs"], Value::Int(999))), "SCHEMA_RANGE");
    assert_eq!(refuse(&with(&v, &["timeoutMs"], Value::Int(600_001))), "SCHEMA_RANGE");
    let mut raw = String::from_utf8(bytes(&v)).unwrap();
    raw = raw.replace("\"timeoutMs\":600000", "\"timeoutMs\":600000.5");
    assert_eq!(parse_request(raw.as_bytes()).unwrap_err().code, "JSON_NUMBER_NOT_INTEGER");
}

fn env(name: &str, value: &str) -> Value {
    obj(vec![("name", s(name)), ("value", s(value))])
}

#[test]
fn environment_rules() {
    let v = valid_create();
    assert!(parse_request(&bytes(&with(&v, &["environment"], Value::Array(vec![])))).is_ok());
    for bad in ["sut_x", "SUT_", "SUT_1X", "SUT_a", "BASE_URL", &format!("SUT_{}", "A".repeat(61))] {
        assert_eq!(refuse(&with(&v, &["environment"], Value::Array(vec![env(bad, "x")]))), "SCHEMA_GRAMMAR", "{bad:?}");
    }
    let dup = Value::Array(vec![env("SUT_A", "1"), env("SUT_A", "2")]);
    assert_eq!(refuse(&with(&v, &["environment"], dup)), "SCHEMA_ENVIRONMENT_DUPLICATE");
    let big = Value::Array(vec![env("SUT_A", &"x".repeat(4097))]);
    assert_eq!(refuse(&with(&v, &["environment"], big)), "SCHEMA_ENVIRONMENT_VALUE");
    let multibyte = Value::Array(vec![env("SUT_A", &"\u{e9}".repeat(2049))]); // 4098 UTF-8 bytes
    assert_eq!(refuse(&with(&v, &["environment"], multibyte)), "SCHEMA_ENVIRONMENT_VALUE");
    let total: Vec<Value> = (0..17).map(|i| env(&format!("SUT_V{i:02}"), &"x".repeat(4000))).collect();
    assert_eq!(refuse(&with(&v, &["environment"], Value::Array(total))), "SCHEMA_ENVIRONMENT_TOTAL");
    let count: Vec<Value> = (0..33).map(|i| env(&format!("SUT_V{i:02}"), "x")).collect();
    assert_eq!(refuse(&with(&v, &["environment"], Value::Array(count))), "SCHEMA_ENVIRONMENT_COUNT");
    let mut raw = String::from_utf8(bytes(&v)).unwrap();
    raw = raw.replace("http://127.0.0.1:3000", "a\\u0000b");
    assert_eq!(parse_request(raw.as_bytes()).unwrap_err().code, "JSON_NUL");
}

#[test]
fn oversize_and_malformed_payloads_are_refused_without_partial_acceptance() {
    assert_eq!(parse_request(&vec![b' '; 262_145]).unwrap_err().code, "JSON_TOO_LARGE");
    assert_eq!(parse_request(b"[]").unwrap_err().code, "SCHEMA_OPERATION");
    let mut raw = bytes(&valid_create());
    raw.extend_from_slice(b"{}");
    assert_eq!(parse_request(&raw).unwrap_err().code, "JSON_TRAILING_CONTENT");
}
