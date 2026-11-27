//! B3-03: strict JSON robustness (L1, D-10). Std-only seeded campaign over
//! `json::parse_strict` with three oracles:
//! - positive: a generated document parses to exactly its model;
//! - negative: a planted defect yields its specific refusal code;
//! - havoc: arbitrary mutations never panic, refuse only with known codes,
//!   and every accepted input satisfies the strict invariants and round-trips
//!   through the CRS-1 canonical encoder.

mod robustness;

use qa_agent_controller_v1::canonical;
use qa_agent_controller_v1::error::ErrorKind;
use qa_agent_controller_v1::json::{parse_strict, Limits, Value, FRAME_LIMITS};
use robustness::*;
use std::panic::{catch_unwind, resume_unwind};

const CODES: [&str; 13] = [
    "JSON_TOO_LARGE",
    "JSON_BOM",
    "JSON_NUL",
    "JSON_INVALID_UTF8",
    "JSON_TRAILING_CONTENT",
    "JSON_SYNTAX",
    "JSON_TOO_DEEP",
    "JSON_DUPLICATE_KEY",
    "JSON_CONTROL_CHARACTER",
    "JSON_INVALID_UNICODE",
    "JSON_NUMBER_NOT_INTEGER",
    "JSON_NEGATIVE_ZERO",
    "JSON_NUMBER_UNSAFE",
];

/// Parses under `catch_unwind`; a panic is reported with the input and seed.
fn parse(input: &[u8], limits: Limits, ctx: &str) -> Result<Value, &'static str> {
    match catch_unwind(|| parse_strict(input, limits)) {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => {
            assert_eq!(e.kind, ErrorKind::Json, "{ctx} input={}", hex(input));
            assert!(CODES.contains(&e.code), "{ctx} unknown code {} input={}", e.code, hex(input));
            Err(e.code)
        }
        Err(p) => {
            eprintln!("PANIC {ctx} input={}", hex(input));
            resume_unwind(p)
        }
    }
}

/// Invariants every accepted input must satisfy.
fn check_accepted(input: &[u8], v: &Value, limits: Limits, ctx: &str) {
    let h = hex(input);
    assert!(input.len() <= limits.max_bytes, "{ctx} size {h}");
    assert!(!input.starts_with(&[0xEF, 0xBB, 0xBF]), "{ctx} BOM {h}");
    assert!(!input.contains(&0), "{ctx} raw NUL {h}");
    assert!(core::str::from_utf8(input).is_ok(), "{ctx} UTF-8 {h}");
    assert!(depth(v) <= limits.max_depth, "{ctx} depth {h}");
    assert!(keys_unique(v), "{ctx} duplicate key {h}");
    assert!(nul_free(v), "{ctx} NUL in string {h}");
    assert!(ints_safe(v), "{ctx} unsafe integer {h}");
    // Determinism.
    assert_eq!(parse_strict(input, limits).unwrap(), *v, "{ctx} nondeterministic {h}");
    // CRS-1 round trip (canonical keys are ASCII; other keys are refused by
    // the encoder, which is its own documented rule).
    if let Ok(bytes) = canonical::encode(v) {
        let wide = Limits { max_bytes: usize::MAX, max_depth: limits.max_depth };
        let again = parse_strict(&bytes, wide).unwrap_or_else(|e| panic!("{ctx} canonical reparse {} {h}", e.code));
        assert_eq!(canonical::encode(&again).unwrap(), bytes, "{ctx} canonical round trip {h}");
    }
}

fn gen_doc(r: &mut Rng, max_depth: usize) -> Value {
    let mut budget = if r.chance(1, 50) { 400 } else { 40 };
    gen_value(r, max_depth, &mut budget)
}

#[test]
fn positive_generated_documents_parse_to_their_model() {
    let mut accepted = 0u64;
    for seed in seeds() {
        let mut r = Rng::new(seed);
        for i in 0..iterations(3_000) {
            let max_depth = r.index(FRAME_LIMITS.max_depth + 1);
            let v = gen_doc(&mut r, max_depth);
            let mut doc = Vec::new();
            if r.chance(1, 4) {
                doc.extend_from_slice(b" \n");
            }
            serialize(&mut r, &v, b"", &mut doc);
            if r.chance(1, 4) {
                doc.extend_from_slice(b"\r\n\t ");
            }
            if doc.len() > FRAME_LIMITS.max_bytes {
                continue;
            }
            let ctx = format!("positive seed={seed} i={i}");
            let got = parse(&doc, FRAME_LIMITS, &ctx).unwrap_or_else(|c| panic!("{ctx} refused {c} input={}", hex(&doc)));
            assert_eq!(got, v, "{ctx} input={}", hex(&doc));
            check_accepted(&doc, &got, FRAME_LIMITS, &ctx);
            accepted += 1;
        }
    }
    eprintln!("ROBUSTNESS json-positive accepted={accepted}");
    assert!(accepted > 0);
}

/// Value-position poison tokens and the exact code each must produce.
fn value_poisons() -> Vec<(Vec<u8>, &'static str, bool)> {
    // (token, expected code, token opens a container)
    let mut v: Vec<(Vec<u8>, &'static str, bool)> = vec![
        (b"1.5".to_vec(), "JSON_NUMBER_NOT_INTEGER", false),
        (b"1e3".to_vec(), "JSON_NUMBER_NOT_INTEGER", false),
        (b"2E+2".to_vec(), "JSON_NUMBER_NOT_INTEGER", false),
        (b"0.0".to_vec(), "JSON_NUMBER_NOT_INTEGER", false),
        (b"-0".to_vec(), "JSON_NEGATIVE_ZERO", false),
        (b"9007199254740992".to_vec(), "JSON_NUMBER_UNSAFE", false),
        (b"-9007199254740992".to_vec(), "JSON_NUMBER_UNSAFE", false),
        (b"123456789012345678901234567890".to_vec(), "JSON_NUMBER_UNSAFE", false),
        (b"01".to_vec(), "JSON_SYNTAX", false),
        (b"-".to_vec(), "JSON_SYNTAX", false),
        (b"+1".to_vec(), "JSON_SYNTAX", false),
        (b".5".to_vec(), "JSON_SYNTAX", false),
        (b"1.".to_vec(), "JSON_SYNTAX", false),
        (b"1e".to_vec(), "JSON_SYNTAX", false),
        (b"tru".to_vec(), "JSON_SYNTAX", false),
        (b"nul".to_vec(), "JSON_SYNTAX", false),
        (b"NaN".to_vec(), "JSON_SYNTAX", false),
        (b"'a'".to_vec(), "JSON_SYNTAX", false),
        (b"\"a\\x\"".to_vec(), "JSON_SYNTAX", false),
        (b"\"a\x01b\"".to_vec(), "JSON_CONTROL_CHARACTER", false),
        (b"\"\x1f\"".to_vec(), "JSON_CONTROL_CHARACTER", false),
        (b"[1,]".to_vec(), "JSON_SYNTAX", true),
        (b"[,1]".to_vec(), "JSON_SYNTAX", true),
        (b"{\"a\":1,}".to_vec(), "JSON_SYNTAX", true),
        (b"{\"a\" 1}".to_vec(), "JSON_SYNTAX", true),
        (b"{1:2}".to_vec(), "JSON_SYNTAX", true),
        (b"[1 2]".to_vec(), "JSON_SYNTAX", true),
    ];
    // Escape-based poisons, built from code points.
    v.push((quoted_u(&[0x0000], b""), "JSON_NUL", false));
    v.push((quoted_u(&[0x0041, 0x0000], b"z"), "JSON_NUL", false));
    v.push((quoted_u(&[0xD800], b""), "JSON_INVALID_UNICODE", false));
    v.push((quoted_u(&[0xDBFF], b"x"), "JSON_INVALID_UNICODE", false));
    v.push((quoted_u(&[0xDC00], b""), "JSON_INVALID_UNICODE", false));
    v.push((quoted_u(&[0xD800, 0x0041], b""), "JSON_INVALID_UNICODE", false));
    v.push((quoted_u(&[0xD83D, 0xD83D], b""), "JSON_INVALID_UNICODE", false));
    // Duplicate key, the second spelled with an escape.
    let mut dup = b"{\"k\":1,".to_vec();
    dup.extend_from_slice(&quoted_u(&[0x006B], b""));
    dup.extend_from_slice(b":2}");
    v.push((dup, "JSON_DUPLICATE_KEY", true));
    v
}

#[test]
fn negative_planted_defects_yield_their_exact_code() {
    let poisons = value_poisons();
    let mut tally = Tally::default();
    for seed in seeds() {
        let mut r = Rng::new(seed ^ 0xBAD);
        for i in 0..iterations(3_000) {
            let max_depth = r.index(FRAME_LIMITS.max_depth + 1);
            let mut v = gen_doc(&mut r, max_depth);
            let mut doc = Vec::new();
            let expected: &'static str;
            let kind = r.below(8);
            if kind < 3 {
                // Value-position poison; containers only where depth allows.
                let (tok, code, container) = r.pick(&poisons).clone();
                let limit = if container { FRAME_LIMITS.max_depth } else { FRAME_LIMITS.max_depth + 1 };
                if !plant_poison(&mut r, &mut v, limit) {
                    continue;
                }
                serialize(&mut r, &v, &tok, &mut doc);
                expected = code;
            } else {
                serialize(&mut r, &v, b"", &mut doc);
                match kind {
                    3 => {
                        doc.splice(0..0, [0xEF, 0xBB, 0xBF]);
                        expected = "JSON_BOM";
                    }
                    4 => {
                        let at = r.index(doc.len() + 1);
                        doc.insert(at, 0);
                        expected = "JSON_NUL";
                    }
                    5 => {
                        let bad: &[&[u8]] = &[b"\xff", b"\x80", b"\xc0\x80", b"\xed\xa0\x80", b"\xf4\x90\x80\x80", b"\xe2\x82"];
                        let at = r.index(doc.len() + 1);
                        let bytes = *r.pick(bad);
                        doc.splice(at..at, bytes.iter().copied());
                        if doc.starts_with(&[0xEF, 0xBB, 0xBF]) {
                            continue;
                        }
                        expected = "JSON_INVALID_UTF8";
                    }
                    6 => {
                        doc.extend_from_slice(*r.pick(&[&b" 1"[..], b" {}", b" null", b" \"x\"", b"]", b"}", b","]));
                        expected = "JSON_TRAILING_CONTENT";
                    }
                    _ => {
                        // Depth: wrap so the outermost container is one over the limit.
                        let d = depth(&v);
                        let wraps = FRAME_LIMITS.max_depth + 1 - d;
                        let mut wrapped = vec![b'['; wraps];
                        wrapped.extend_from_slice(&doc);
                        wrapped.extend(std::iter::repeat(b']').take(wraps));
                        doc = wrapped;
                        expected = "JSON_TOO_DEEP";
                    }
                }
            }
            if doc.len() > FRAME_LIMITS.max_bytes {
                continue;
            }
            let ctx = format!("negative seed={seed} i={i} expected={expected}");
            match parse(&doc, FRAME_LIMITS, &ctx) {
                Err(code) => {
                    assert_eq!(code, expected, "{ctx} input={}", hex(&doc));
                    tally.add(code);
                }
                Ok(_) => panic!("{ctx} accepted input={}", hex(&doc)),
            }
        }
    }
    eprintln!("ROBUSTNESS json-negative {}", tally.line());
    for code in CODES.iter().filter(|c| **c != "JSON_TOO_LARGE") {
        assert!(tally.get(code) > 0, "negative class {code} never exercised");
    }
}

#[test]
fn size_and_depth_boundaries_are_exact() {
    // max_bytes: exactly at the limit accepted, one byte over refused.
    let max = FRAME_LIMITS.max_bytes;
    let mut at = b"[1]".to_vec();
    at.resize(max, b' ');
    assert!(parse(&at, FRAME_LIMITS, "size-at").is_ok());
    let mut over = at.clone();
    over.push(b' ');
    assert_eq!(parse(&over, FRAME_LIMITS, "size-over"), Err("JSON_TOO_LARGE"));
    // A long string filling the frame.
    let mut long = vec![b'"'];
    long.resize(max - 1, b'a');
    long.push(b'"');
    assert!(parse(&long, FRAME_LIMITS, "string-at").is_ok());
    // max_depth: 12 nested containers accepted, 13 refused, for both kinds.
    for (open, close) in [(b'[', b']'), (b'{', b'}')] {
        let nest = |n: usize| -> Vec<u8> {
            let mut d = Vec::new();
            for _ in 0..n {
                d.push(open);
                if open == b'{' {
                    d.extend_from_slice(b"\"k\":");
                }
            }
            d.extend_from_slice(b"0");
            for _ in 0..n {
                d.push(close);
            }
            d
        };
        assert!(parse(&nest(12), FRAME_LIMITS, "depth-at").is_ok());
        assert_eq!(parse(&nest(13), FRAME_LIMITS, "depth-over"), Err("JSON_TOO_DEEP"));
        // Deep nesting far beyond the limit is refused without deep recursion.
        assert_eq!(parse(&nest(100_000), Limits { max_bytes: usize::MAX, max_depth: 12 }, "depth-huge"), Err("JSON_TOO_DEEP"));
    }
}

#[test]
fn havoc_mutations_never_panic_and_accept_only_strict_documents() {
    let mut tally = Tally::default();
    let mut accepted = 0u64;
    for seed in seeds() {
        let mut r = Rng::new(seed ^ 0x4A5);
        for i in 0..iterations(5_000) {
            let mut input = if r.chance(1, 10) {
                (0..r.below(64)).map(|_| r.below(256) as u8).collect()
            } else {
                let max_depth = r.index(FRAME_LIMITS.max_depth + 2);
                let v = gen_doc(&mut r, max_depth);
                let mut d = Vec::new();
                serialize(&mut r, &v, b"", &mut d);
                d
            };
            havoc(&mut r, &mut input);
            let ctx = format!("havoc seed={seed} i={i}");
            match parse(&input, FRAME_LIMITS, &ctx) {
                Ok(v) => {
                    check_accepted(&input, &v, FRAME_LIMITS, &ctx);
                    accepted += 1;
                }
                Err(code) => tally.add(code),
            }
        }
    }
    eprintln!("ROBUSTNESS json-havoc accepted={accepted} {}", tally.line());
    assert!(accepted > 0, "havoc produced no accepted input");
    assert!(tally.0.len() >= 6, "havoc exercised too few refusal classes: {}", tally.line());
}
