//! Shared synthetic fixtures for the WP3-B slice B1 tests. The JSON files and
//! digests under `tests/vectors/b1-*` were written by the repository's own
//! JavaScript CRS-1 encoder (`scripts/ai/cli/canonical-review-serialization.js`);
//! every value in them is synthetic.
#![allow(dead_code)]

use qa_agent_controller_v1::canonical;
use qa_agent_controller_v1::enrollment::ENROLLMENT_LIMITS;
use qa_agent_controller_v1::json::{parse_strict, Value, FRAME_LIMITS};

pub const ENROLLMENT: &[u8] = include_bytes!("../vectors/b1-enrollment.json");
pub const RECORD: &[u8] = include_bytes!("../vectors/b1-compatibility-record.json");
pub const PROFILE_H: &str = include_str!("../vectors/b1-profile.h");
pub const COMPATIBILITY_H: &str = include_str!("../vectors/b1-compatibility.h");
/// The synthetic Playwright root digest, shared with `tests/fingerprint.rs`
/// (C1: the root carries the OD-06 §8.2 required entrypoint).
pub const FINGERPRINT_H: &str = include_str!("../vectors/fp-playwright-root.h");
/// The synthetic Cypress root digest (C1, OD-06 §8.2 required members).
pub const CYPRESS_FINGERPRINT_H: &str = include_str!("../vectors/fp-cypress-root.h");

pub fn enrollment() -> Value {
    parse_strict(ENROLLMENT, ENROLLMENT_LIMITS).expect("enrollment fixture")
}

pub fn record() -> Value {
    parse_strict(RECORD, FRAME_LIMITS).expect("record fixture")
}

/// A path step: object key or array index.
#[derive(Clone, Copy)]
pub enum P<'a> {
    K(&'a str),
    I(usize),
}

pub fn s(x: &str) -> Value {
    Value::Str(x.to_owned())
}

pub fn h(c: char) -> String {
    format!("sha256:{}", c.to_string().repeat(64))
}

pub fn enc(v: &Value) -> Vec<u8> {
    canonical::encode(v).expect("encodable")
}

fn at<'a>(v: &'a mut Value, path: &[P<'_>]) -> &'a mut Value {
    match path.split_first() {
        None => v,
        Some((P::K(k), rest)) => match v {
            Value::Object(m) => at(&mut m.iter_mut().find(|(mk, _)| mk.as_str() == *k).expect("key present").1, rest),
            _ => panic!("not an object"),
        },
        Some((P::I(i), rest)) => match v {
            Value::Array(a) => at(&mut a[*i], rest),
            _ => panic!("not an array"),
        },
    }
}

pub fn get<'a>(v: &'a Value, path: &[P<'_>]) -> &'a Value {
    match path.split_first() {
        None => v,
        Some((P::K(k), rest)) => get(v.get(k).expect("key present"), rest),
        Some((P::I(i), rest)) => match v {
            Value::Array(a) => get(&a[*i], rest),
            _ => panic!("not an array"),
        },
    }
}

/// Replaces the value at `path`.
pub fn with(v: &Value, path: &[P<'_>], new: Value) -> Value {
    let mut c = v.clone();
    *at(&mut c, path) = new;
    c
}

/// Removes `key` from the object at `path`.
pub fn without(v: &Value, path: &[P<'_>], key: &str) -> Value {
    let mut c = v.clone();
    match at(&mut c, path) {
        Value::Object(m) => m.retain(|(k, _)| k.as_str() != key),
        _ => panic!("not an object"),
    }
    c
}

/// Adds `key` to the object at `path`.
pub fn adding(v: &Value, path: &[P<'_>], key: &str, new: Value) -> Value {
    let mut c = v.clone();
    match at(&mut c, path) {
        Value::Object(m) => m.push((key.to_owned(), new)),
        _ => panic!("not an object"),
    }
    c
}
