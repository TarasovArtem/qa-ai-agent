//! Synthetic fixtures shared by the integration tests. No real host data.
#![allow(dead_code)]

use qa_agent_controller_v1::canonical;
use qa_agent_controller_v1::json::Value;

pub const EXEC_ID: &str = "0123456789abcdef0123456789abcdef";
pub const OTHER_ID: &str = "fedcba9876543210fedcba9876543210";
pub const INVOCATION_ID: &str = "00112233445566778899aabbccddeeff";

pub fn h(c: char) -> String {
    format!("sha256:{}", c.to_string().repeat(64))
}

pub fn s(x: &str) -> Value {
    Value::Str(x.to_owned())
}

pub fn obj(members: Vec<(&str, Value)>) -> Value {
    Value::object(members)
}

/// Replaces the value at `path` (object keys); panics if absent.
pub fn with(v: &Value, path: &[&str], new: Value) -> Value {
    let mut v = v.clone();
    set(&mut v, path, Some(new));
    v
}

/// Removes the key at `path`; panics if absent.
pub fn without(v: &Value, path: &[&str]) -> Value {
    let mut v = v.clone();
    set(&mut v, path, None);
    v
}

/// Adds a top-level key.
pub fn adding(v: &Value, key: &str, new: Value) -> Value {
    match v.clone() {
        Value::Object(mut m) => {
            m.push((key.to_owned(), new));
            Value::Object(m)
        }
        _ => panic!("not an object"),
    }
}

fn set(v: &mut Value, path: &[&str], new: Option<Value>) {
    let Value::Object(members) = v else { panic!("not an object") };
    let idx = members.iter().position(|(k, _)| k == path[0]).expect("key present");
    if path.len() == 1 {
        match new {
            Some(n) => members[idx].1 = n,
            None => {
                members.remove(idx);
            }
        }
    } else {
        set(&mut members[idx].1, &path[1..], new);
    }
}

pub fn bytes(v: &Value) -> Vec<u8> {
    canonical::encode(v).expect("encodable")
}

pub fn target(path: &str, op: &str) -> Value {
    obj(vec![("path", s(path)), ("operation", s(op)), ("afterDigest", s(&h('b')))])
}

pub fn valid_create() -> Value {
    obj(vec![
        ("schemaVersion", Value::Int(1)),
        ("contractVersion", s("qa-agent-controller-v1")),
        ("operation", s("create")),
        ("executionId", s(EXEC_ID)),
        (
            "root",
            obj(vec![
                ("platform", s("linux")),
                ("path", s("/srv/qa-workspace/project")),
                ("dev", s("2049")),
                ("ino", s("131073")),
                ("digest", s(&h('a'))),
            ]),
        ),
        (
            "subject",
            obj(vec![
                ("runId", s("20261126T120000Z-0123456789abcdef")),
                ("packageOrdinal", s("0001")),
                ("applyRecordId", s(OTHER_ID)),
                ("packageDigest", s(&h('c'))),
                ("appliedRecordSha256", s(&h('d'))),
                ("bindingDigest", s(&h('e'))),
                ("product", obj(vec![("name", s("qa-ai-agent")), ("version", s("1.2.3"))])),
            ]),
        ),
        ("framework", s("playwright")),
        (
            "targets",
            Value::Array(vec![target("playwright/a.spec.js", "CREATE"), target("playwright/b/c.spec.js", "MODIFY")]),
        ),
        ("timeoutMs", Value::Int(600_000)),
        (
            "environment",
            Value::Array(vec![obj(vec![("name", s("SUT_BASE_URL")), ("value", s("http://127.0.0.1:3000"))])]),
        ),
    ])
}

pub fn record(status: &str, reason: &str) -> Value {
    // Only status/reason are inspected in WP3-A; the full v2 record is deferred.
    obj(vec![("status", s(status)), ("reason", s(reason))])
}
