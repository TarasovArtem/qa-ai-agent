//! CRS-1 canonical encoding `E(v)` (OD-06 §11.1, defined in OD-04 §11.2).
//!
//! Byte rules, identical to `encodeValue` in
//! `scripts/ai/cli/canonical-review-serialization.js`:
//! - `null`/`true`/`false` literal; safe integers as shortest decimal;
//! - strings per UTF-16 code unit: `0x20..=0x7E` except `"` and `\` verbatim,
//!   `"` -> `\"`, `\` -> `\\`, every other unit -> `\u` + 4 lowercase hex;
//! - arrays dense, joined by `,`; objects with ASCII (`0x20..=0x7E`) keys
//!   sorted by code units, no whitespace, no trailing newline.
//!
//! Output is ASCII only. Rust strings hold Unicode scalar values, so a lone
//! surrogate can never reach the encoder; the strict parser refuses it too.

use crate::error::{Error, ErrorKind, Result};
use crate::json::{Value, MAX_SAFE_INTEGER};

const fn err(code: &'static str) -> Error {
    Error::new(ErrorKind::Canonical, code)
}

/// Encodes `v` as CRS-1 canonical ASCII bytes.
pub fn encode(v: &Value) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    encode_into(v, &mut out)?;
    Ok(out)
}

fn push_string(s: &str, out: &mut Vec<u8>) {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    out.push(b'"');
    for u in s.encode_utf16() {
        match u {
            0x22 => out.extend_from_slice(b"\\\""),
            0x5C => out.extend_from_slice(b"\\\\"),
            0x20..=0x7E => out.push(u as u8),
            _ => {
                out.extend_from_slice(b"\\u");
                for shift in [12u16, 8, 4, 0] {
                    out.push(HEX[usize::from((u >> shift) & 0xF)]);
                }
            }
        }
    }
    out.push(b'"');
}

fn encode_into(v: &Value, out: &mut Vec<u8>) -> Result<()> {
    match v {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(true) => out.extend_from_slice(b"true"),
        Value::Bool(false) => out.extend_from_slice(b"false"),
        Value::Int(n) => {
            if *n > MAX_SAFE_INTEGER || *n < -MAX_SAFE_INTEGER {
                return Err(err("CANONICAL_UNSAFE_INTEGER"));
            }
            out.extend_from_slice(n.to_string().as_bytes());
        }
        Value::Str(s) => push_string(s, out),
        Value::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                encode_into(item, out)?;
            }
            out.push(b']');
        }
        Value::Object(members) => {
            let mut sorted: Vec<&(String, Value)> = members.iter().collect();
            for (k, _) in &sorted {
                if !k.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
                    return Err(err("CANONICAL_NON_ASCII_KEY"));
                }
            }
            // ASCII-only keys: byte order equals UTF-16 code-unit order.
            sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
            for pair in sorted.windows(2) {
                if pair[0].0 == pair[1].0 {
                    return Err(err("CANONICAL_DUPLICATE_KEY"));
                }
            }
            out.push(b'{');
            for (i, (k, val)) in sorted.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                push_string(k, out);
                out.push(b':');
                encode_into(val, out)?;
            }
            out.push(b'}');
        }
    }
    Ok(())
}
