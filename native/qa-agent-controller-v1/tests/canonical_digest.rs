//! CRS-1 and `H` parity with the repository's JavaScript encoder
//! (`scripts/ai/cli/canonical-review-serialization.js` `encodeValue`/`digest`),
//! plus SHA-256 known-answer vectors (FIPS 180-2 examples).

mod common;

use common::{obj, s};
use qa_agent_controller_v1::canonical::encode;
use qa_agent_controller_v1::digest::{domains, h_bytes, h_domain, h_value, h_value_excluding, is_h};
use qa_agent_controller_v1::json::{parse_strict, Value, FRAME_LIMITS};

/// Golden vector files written by the repository's JS `encodeValue`/`digest`
/// (Node 22.23.3), byte-exact, for the same fixture as `fixture_v1`.
const JS_ENCODED_V1: &[u8] = include_bytes!("vectors/crs1-v1.encoded");
const JS_H_V1: &[u8] = include_bytes!("vectors/crs1-v1.h");

fn fixture_v1() -> Value {
    obj(vec![
        ("z", Value::Int(1)),
        (
            "a",
            Value::Array(vec![
                Value::Bool(true),
                Value::Bool(false),
                Value::Null,
                Value::Int(-42),
                Value::Int(0),
                Value::Int(9_007_199_254_740_991),
                Value::Int(-9_007_199_254_740_991),
            ]),
        ),
        ("m", s("e\u{301} \u{e9} \"q\" \\ / \u{2028} \u{1F600} tab\t nl\n cr\r del\u{7f} c1\u{85} @ ~")),
        ("", s("empty-key")),
        ("A", s("upper")),
        (
            "nested",
            obj(vec![
                ("y", Value::Array(vec![])),
                ("x", obj(vec![])),
                ("w", Value::Array(vec![obj(vec![("b", Value::Int(2)), ("a", Value::Int(1))])])),
            ]),
        ),
    ])
}

#[test]
fn encoding_matches_js_encode_value_byte_for_byte() {
    assert_eq!(encode(&fixture_v1()).unwrap(), JS_ENCODED_V1);
}

#[test]
fn domain_digest_matches_js_digest() {
    assert_eq!(h_value(domains::FINGERPRINT, &fixture_v1()).unwrap().as_bytes(), JS_H_V1);
    assert_eq!(JS_H_V1, b"sha256:57ec3831ee3f3fbfc4d47214830901f927c9174db142f9e60eec425f96df8509");
}

#[test]
fn canonical_bytes_reparse_to_the_same_value_and_reencode_identically() {
    let bytes = encode(&fixture_v1()).unwrap();
    assert!(bytes.iter().all(|b| (0x20..=0x7E).contains(b)), "ASCII only, no newline");
    let reparsed = parse_strict(&bytes, FRAME_LIMITS).unwrap();
    assert_eq!(encode(&reparsed).unwrap(), bytes);
}

#[test]
fn encoder_refuses_values_outside_the_crs1_domain() {
    assert_eq!(encode(&obj(vec![("\u{e9}", Value::Null)])).unwrap_err().code, "CANONICAL_NON_ASCII_KEY");
    assert_eq!(encode(&obj(vec![("\n", Value::Null)])).unwrap_err().code, "CANONICAL_NON_ASCII_KEY");
    let dup = Value::Object(vec![("k".into(), Value::Int(1)), ("k".into(), Value::Int(2))]);
    assert_eq!(encode(&dup).unwrap_err().code, "CANONICAL_DUPLICATE_KEY");
    assert_eq!(encode(&Value::Int(9_007_199_254_740_992)).unwrap_err().code, "CANONICAL_UNSAFE_INTEGER");
    assert_eq!(encode(&Value::Int(i64::MIN)).unwrap_err().code, "CANONICAL_UNSAFE_INTEGER");
}

#[test]
fn excluding_own_digest_field_equals_hashing_without_it() {
    let with_field = obj(vec![("b", Value::Int(2)), ("recordDigest", s("anything")), ("a", Value::Int(1))]);
    let without_field = obj(vec![("a", Value::Int(1)), ("b", Value::Int(2))]);
    assert_eq!(
        h_value_excluding(domains::RECORD_V2, &with_field, "recordDigest").unwrap(),
        h_value(domains::RECORD_V2, &without_field).unwrap()
    );
    assert_eq!(h_value_excluding(domains::RECORD_V2, &without_field, "recordDigest").unwrap_err().code, "DIGEST_FIELD_MISSING");
}

#[test]
fn domains_separate_digests() {
    let v = obj(vec![("a", Value::Int(1))]);
    assert_ne!(h_value(domains::FINGERPRINT, &v).unwrap(), h_value(domains::BROWSER_TREE, &v).unwrap());
    assert_eq!(h_domain("caf\u{e9}:", b"").unwrap_err().code, "DIGEST_DOMAIN_NOT_ASCII");
}

#[test]
fn sha256_known_answer_vectors() {
    let cases: [(&[u8], &str); 4] = [
        (b"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
        (b"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
        (
            b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq",
            "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
        ),
        (
            b"abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu",
            "cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1",
        ),
    ];
    for (input, hex) in cases {
        assert_eq!(h_bytes(input), format!("sha256:{hex}"));
    }
    let million_a = vec![b'a'; 1_000_000];
    assert_eq!(h_bytes(&million_a), "sha256:cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
    // Domain digest = SHA-256(domain || bytes).
    assert_eq!(h_domain("ab", b"c").unwrap(), h_bytes(b"abc"));
}

#[test]
fn h_grammar() {
    assert!(is_h(&format!("sha256:{}", "0".repeat(64))));
    assert!(!is_h(&format!("sha256:{}", "A".repeat(64))));
    assert!(!is_h(&format!("sha256:{}", "0".repeat(63))));
    assert!(!is_h(&format!("SHA256:{}", "0".repeat(64))));
    assert!(!is_h(&"0".repeat(64)));
}
