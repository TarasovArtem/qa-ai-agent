use qa_agent_controller_v1::json::{parse_strict, Limits, Value, FRAME_LIMITS, MAX_SAFE_INTEGER};

fn code(input: &[u8]) -> &'static str {
    parse_strict(input, FRAME_LIMITS).expect_err("must refuse").code
}

#[test]
fn accepts_closed_document_with_whitespace() {
    let v = parse_strict(b" {\"a\": [1, true, null, \"x\"]}\n\t", FRAME_LIMITS).unwrap();
    assert_eq!(
        v,
        Value::Object(vec![(
            "a".into(),
            Value::Array(vec![Value::Int(1), Value::Bool(true), Value::Null, Value::Str("x".into())])
        )])
    );
}

#[test]
fn refuses_bom_nul_and_invalid_utf8() {
    assert_eq!(code(b"\xEF\xBB\xBF{}"), "JSON_BOM");
    assert_eq!(code(b"{\"a\":\"\x00\"}"), "JSON_NUL");
    assert_eq!(code(b"{\"a\":\"\\u0000\"}"), "JSON_NUL");
    assert_eq!(code(b"{\"a\":\"\xC0\x80\"}"), "JSON_INVALID_UTF8");
    assert_eq!(code(b"{\"a\":\"\xFF\"}"), "JSON_INVALID_UTF8");
}

#[test]
fn refuses_invalid_unicode_escapes() {
    assert_eq!(code(br#"{"a":"\ud800"}"#), "JSON_INVALID_UNICODE");
    assert_eq!(code(br#"{"a":"\udc00"}"#), "JSON_INVALID_UNICODE");
    assert_eq!(code(br#"{"a":"\ud800\u0041"}"#), "JSON_INVALID_UNICODE");
    let v = parse_strict(br#"{"a":"\ud83d\ude00\u00e9\/\b"}"#, FRAME_LIMITS).unwrap();
    assert_eq!(v.get("a"), Some(&Value::Str("\u{1F600}\u{e9}/\u{8}".into())));
}

#[test]
fn refuses_duplicate_keys_at_any_depth() {
    assert_eq!(code(br#"{"a":1,"a":1}"#), "JSON_DUPLICATE_KEY");
    assert_eq!(code(br#"{"o":{"k":1,"k":2}}"#), "JSON_DUPLICATE_KEY");
    assert_eq!(code(br#"[{"k":1,"k":2}]"#), "JSON_DUPLICATE_KEY");
}

#[test]
fn refuses_trailing_content() {
    assert_eq!(code(b"{} {}"), "JSON_TRAILING_CONTENT");
    assert_eq!(code(b"{}x"), "JSON_TRAILING_CONTENT");
}

#[test]
fn enforces_depth_limit() {
    let ok = format!("{}{}", "[".repeat(12), "]".repeat(12));
    assert!(parse_strict(ok.as_bytes(), FRAME_LIMITS).is_ok());
    let deep = format!("{}{}", "[".repeat(13), "]".repeat(13));
    assert_eq!(code(deep.as_bytes()), "JSON_TOO_DEEP");
    let mixed = format!("{}1{}", "{\"a\":".repeat(13), "}".repeat(13));
    assert_eq!(code(mixed.as_bytes()), "JSON_TOO_DEEP");
}

#[test]
fn enforces_size_limit_exactly() {
    let limit = FRAME_LIMITS.max_bytes;
    let fill = limit - 2; // the two quotes
    let at = format!("\"{}\"", "a".repeat(fill));
    assert_eq!(at.len(), limit);
    assert!(parse_strict(at.as_bytes(), FRAME_LIMITS).is_ok());
    let over = format!("\"{}\"", "a".repeat(fill + 1));
    assert_eq!(code(over.as_bytes()), "JSON_TOO_LARGE");
    let tiny = Limits { max_bytes: 3, max_depth: 1 };
    assert_eq!(parse_strict(b"[[]]", tiny).unwrap_err().code, "JSON_TOO_LARGE");
}

#[test]
fn admits_only_safe_integers() {
    assert_eq!(parse_strict(b"9007199254740991", FRAME_LIMITS).unwrap(), Value::Int(MAX_SAFE_INTEGER));
    assert_eq!(parse_strict(b"-9007199254740991", FRAME_LIMITS).unwrap(), Value::Int(-MAX_SAFE_INTEGER));
    assert_eq!(parse_strict(b"0", FRAME_LIMITS).unwrap(), Value::Int(0));
    assert_eq!(code(b"9007199254740992"), "JSON_NUMBER_UNSAFE");
    assert_eq!(code(b"99999999999999999999999"), "JSON_NUMBER_UNSAFE");
    assert_eq!(code(b"-0"), "JSON_NEGATIVE_ZERO");
    assert_eq!(code(b"1.0"), "JSON_NUMBER_NOT_INTEGER");
    assert_eq!(code(b"1e3"), "JSON_NUMBER_NOT_INTEGER");
    assert_eq!(code(b"01"), "JSON_SYNTAX");
    assert_eq!(code(b"-"), "JSON_SYNTAX");
    assert_eq!(code(b"1."), "JSON_SYNTAX");
}

#[test]
fn refuses_syntax_errors() {
    let cases: [&[u8]; 9] = [b"", b"tru", b"{\"a\" 1}", b"[1,]", b"{\"a\":1,}", b"'a'", b"{a:1}", b"\"a\tb\"", b"\"\\x\""];
    for bad in cases {
        assert!(parse_strict(bad, FRAME_LIMITS).is_err(), "{:?}", String::from_utf8_lossy(bad));
    }
    assert_eq!(code(b"\"a\tb\""), "JSON_CONTROL_CHARACTER");
}

#[test]
fn errors_never_echo_input() {
    let e = parse_strict(b"{\"secret-value\":1,\"secret-value\":2}", FRAME_LIMITS).unwrap_err();
    assert!(!e.to_string().contains("secret"));
}
