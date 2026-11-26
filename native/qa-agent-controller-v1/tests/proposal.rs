mod common;

use common::*;
use qa_agent_controller_v1::json::Value;
use qa_agent_controller_v1::proposal::{check_proposal, parse_proposal, ProposalContext};

const TARGETS: [&str; 2] = ["playwright/a.spec.js", "playwright/b/c.spec.js"];

fn spec(path: &str, total: i64, passed: i64, failed: i64, skipped: i64) -> Value {
    obj(vec![
        ("path", s(path)),
        ("total", Value::Int(total)),
        ("passed", Value::Int(passed)),
        ("failed", Value::Int(failed)),
        ("skipped", Value::Int(skipped)),
    ])
}

fn report(name: &str, bytes: i64) -> Value {
    obj(vec![("name", s(name)), ("bytes", Value::Int(bytes)), ("sha256", s(&h('9')))])
}

fn valid() -> Value {
    obj(vec![
        ("schemaVersion", Value::Int(1)),
        ("executionId", s(EXEC_ID)),
        ("invocationId", s(INVOCATION_ID)),
        ("bindingDigest", s(&h('e'))),
        ("attemptDigest", s(&h('3'))),
        ("reports", Value::Array(vec![report("playwright.xml", 2048)])),
        (
            "result",
            obj(vec![
                ("adapterVersion", s("od06-playwright-v1")),
                ("specs", Value::Array(vec![spec(TARGETS[0], 3, 2, 1, 0), spec(TARGETS[1], 2, 1, 0, 1)])),
                (
                    "totals",
                    obj(vec![
                        ("total", Value::Int(5)),
                        ("passed", Value::Int(3)),
                        ("failed", Value::Int(1)),
                        ("skipped", Value::Int(1)),
                    ]),
                ),
                ("complete", Value::Bool(true)),
            ]),
        ),
    ])
}

fn ctx<'a>(targets: &'a [&'a str], result_expected: bool, framework: &'a str) -> ProposalContext<'a> {
    ProposalContext {
        execution_id: EXEC_ID,
        invocation_id: INVOCATION_ID,
        binding_digest: "",
        attempt_digest: "",
        framework,
        targets,
        result_expected,
    }
}

fn bound_ctx<'a>(targets: &'a [&'a str], result_expected: bool, framework: &'a str, b: &'a str, a: &'a str) -> ProposalContext<'a> {
    ProposalContext { binding_digest: b, attempt_digest: a, ..ctx(targets, result_expected, framework) }
}

fn code(v: &Value) -> &'static str {
    parse_proposal(&bytes(v)).expect_err("must refuse").code
}

#[test]
fn valid_playwright_proposal() {
    let p = parse_proposal(&bytes(&valid())).unwrap();
    let (b, a) = (h('e'), h('3'));
    check_proposal(&p, &bound_ctx(&TARGETS, true, "playwright", &b, &a)).unwrap();
    assert_eq!(p.result.as_ref().unwrap().totals.failed, 1);
}

#[test]
fn structural_rules() {
    let v = valid();
    assert_eq!(code(&adding(&v, "status", s("PASSED"))), "SCHEMA_KEY_SET");
    assert_eq!(code(&with(&v, &["result", "complete"], Value::Bool(false))), "PROPOSAL_INCOMPLETE");
    assert_eq!(code(&with(&v, &["result", "adapterVersion"], s("od06-jest-v1"))), "SCHEMA_GRAMMAR");
    let inconsistent = Value::Array(vec![spec(TARGETS[0], 3, 1, 1, 0), spec(TARGETS[1], 2, 1, 0, 1)]);
    assert_eq!(code(&with(&v, &["result", "specs"], inconsistent)), "PROPOSAL_COUNTS_INCONSISTENT");
    assert_eq!(code(&with(&v, &["result", "totals", "total"], Value::Int(6))), "PROPOSAL_COUNTS_INCONSISTENT");
    let totals_off = obj(vec![
        ("total", Value::Int(4)),
        ("passed", Value::Int(2)),
        ("failed", Value::Int(1)),
        ("skipped", Value::Int(1)),
    ]);
    assert_eq!(code(&with(&v, &["result", "totals"], totals_off)), "PROPOSAL_TOTALS_INCONSISTENT");
    let unsorted = Value::Array(vec![spec(TARGETS[1], 2, 1, 0, 1), spec(TARGETS[0], 3, 2, 1, 0)]);
    assert_eq!(code(&with(&v, &["result", "specs"], unsorted)), "PROPOSAL_SPEC_ORDER");
    assert_eq!(code(&with(&v, &["result", "specs"], Value::Array(vec![]))), "PROPOSAL_SPEC_COUNT");
    let big = Value::Array(vec![spec(TARGETS[0], 10_001, 10_001, 0, 0)]);
    assert_eq!(code(&with(&v, &["result", "specs"], big)), "SCHEMA_RANGE");
    assert_eq!(code(&with(&v, &["reports"], Value::Array(vec![report("playwright.xml", 0)]))), "SCHEMA_RANGE");
    assert_eq!(code(&with(&v, &["reports"], Value::Array(vec![report("playwright.xml", 4_194_305)]))), "SCHEMA_RANGE");
    let many: Vec<Value> = (0..101).map(|i| report(&format!("r{i:03}"), 1)).collect();
    assert_eq!(code(&with(&v, &["reports"], Value::Array(many))), "PROPOSAL_REPORT_COUNT");
    let agg: Vec<Value> = (0..5).map(|i| report(&format!("r{i}"), 4_194_304)).collect();
    assert_eq!(code(&with(&v, &["reports"], Value::Array(agg))), "PROPOSAL_REPORT_AGGREGATE");
    let unsorted_reports = Value::Array(vec![report("b", 1), report("a", 1)]);
    assert_eq!(code(&with(&v, &["reports"], unsorted_reports)), "PROPOSAL_REPORT_ORDER");
    assert_eq!(code(&with(&v, &["attemptDigest"], s("sha256:x"))), "SCHEMA_GRAMMAR");
    assert!(parse_proposal(&bytes(&with(&v, &["result"], Value::Null))).is_ok());
}

#[test]
fn contextual_rules() {
    let (b, a) = (h('e'), h('3'));
    let ok = bound_ctx(&TARGETS, true, "playwright", &b, &a);
    let p = parse_proposal(&bytes(&valid())).unwrap();
    assert_eq!(check_proposal(&p, &ctx(&TARGETS, true, "playwright")).unwrap_err().code, "PROPOSAL_IDENTITY_MISMATCH");
    assert_eq!(
        check_proposal(&p, &ProposalContext { invocation_id: OTHER_ID, ..ok }).unwrap_err().code,
        "PROPOSAL_IDENTITY_MISMATCH"
    );
    assert_eq!(
        check_proposal(&p, &ProposalContext { result_expected: false, ..ok }).unwrap_err().code,
        "PROPOSAL_NOT_EXPECTED"
    );
    assert_eq!(
        check_proposal(&p, &ProposalContext { targets: &TARGETS[..1], ..ok }).unwrap_err().code,
        "PROPOSAL_SPEC_PATHS"
    );
    assert_eq!(
        check_proposal(&p, &ProposalContext { framework: "cypress", ..ok }).unwrap_err().code,
        "PROPOSAL_REPORT_NAME"
    );
    let empty = with(&with(&valid(), &["result"], Value::Null), &["reports"], Value::Array(vec![]));
    let pe = parse_proposal(&bytes(&empty)).unwrap();
    check_proposal(&pe, &ProposalContext { result_expected: false, ..ok }).unwrap();
    check_proposal(&pe, &ok).unwrap(); // result=null when expected: broker decides RESULT_INVALID
    let two = with(&valid(), &["reports"], Value::Array(vec![report("playwright.xml", 1), report("playwright.xml2", 1)]));
    let p2 = parse_proposal(&bytes(&two)).unwrap();
    assert_eq!(check_proposal(&p2, &ok).unwrap_err().code, "PROPOSAL_REPORT_NAME");
}

#[test]
fn cypress_report_grammar_and_count() {
    let (b, a) = (h('e'), h('3'));
    let targets = ["cypress/e2e/a.cy.js", "cypress/e2e/b.cy.js"];
    let name = |c: char| format!("cypress-{}.xml", c.to_string().repeat(32));
    let v = with(&valid(), &["reports"], Value::Array(vec![report(&name('1'), 10), report(&name('2'), 10)]));
    let v = with(&v, &["result", "adapterVersion"], s("od06-cypress-v1"));
    let v = with(
        &v,
        &["result", "specs"],
        Value::Array(vec![spec(targets[0], 3, 2, 1, 0), spec(targets[1], 2, 1, 0, 1)]),
    );
    let p = parse_proposal(&bytes(&v)).unwrap();
    let c = bound_ctx(&targets, true, "cypress", &b, &a);
    check_proposal(&p, &c).unwrap();
    let one = with(&v, &["reports"], Value::Array(vec![report(&name('1'), 10)]));
    let p1 = parse_proposal(&bytes(&one)).unwrap();
    assert_eq!(check_proposal(&p1, &c).unwrap_err().code, "PROPOSAL_REPORT_COUNT");
    let upper = with(&v, &["reports"], Value::Array(vec![report(&name('A'), 10), report(&name('B'), 10)]));
    let pu = parse_proposal(&bytes(&upper)).unwrap();
    assert_eq!(check_proposal(&pu, &c).unwrap_err().code, "PROPOSAL_REPORT_NAME");
    let adapter = with(&v, &["result", "adapterVersion"], s("od06-playwright-v1"));
    let pa = parse_proposal(&bytes(&adapter)).unwrap();
    assert_eq!(check_proposal(&pa, &c).unwrap_err().code, "PROPOSAL_ADAPTER");
}
