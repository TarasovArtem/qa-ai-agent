//! Strict JSON intake (OD-06 §4.2).
//!
//! Rules: strict UTF-8; no BOM; no NUL (raw or escaped); no invalid Unicode
//! (lone or mis-ordered surrogate escapes); no duplicate keys at any depth;
//! no trailing content; bounded size and depth. The only number form admitted
//! is a safe integer (|n| <= 2^53-1, never `-0`), the same numeric domain as
//! the CRS-1 canonical encoding (OD-06 §11.1); every OD-06 schema uses
//! integers only. No serde, per amendment A8.

use crate::error::{Error, ErrorKind, Result};

/// Largest safe integer, `Number.MAX_SAFE_INTEGER`.
pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Intake limits for one JSON document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Limits {
    /// Maximum encoded size in bytes.
    pub max_bytes: usize,
    /// Maximum container nesting; the outermost container is depth 1.
    pub max_depth: usize,
}

/// OD-06 §4.2 frame limits: <=262144 bytes, depth <=12.
pub const FRAME_LIMITS: Limits = Limits { max_bytes: 262_144, max_depth: 12 };

/// A parsed JSON value. Objects keep input order; keys are unique.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    /// `null`
    Null,
    /// `true` / `false`
    Bool(bool),
    /// A safe integer.
    Int(i64),
    /// A string of Unicode scalar values.
    Str(String),
    /// An array.
    Array(Vec<Value>),
    /// An object; keys unique, input order preserved.
    Object(Vec<(String, Value)>),
}

impl Value {
    /// Object member lookup.
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self {
            Value::Object(members) => members.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Convenience constructor for a string value.
    pub fn str(s: &str) -> Value {
        Value::Str(s.to_owned())
    }

    /// Convenience constructor for an object from `(key, value)` pairs.
    pub fn object(members: Vec<(&str, Value)>) -> Value {
        Value::Object(members.into_iter().map(|(k, v)| (k.to_owned(), v)).collect())
    }
}

const fn err(code: &'static str) -> Error {
    Error::new(ErrorKind::Json, code)
}

/// Parses exactly one strict JSON document from `bytes`.
pub fn parse_strict(bytes: &[u8], limits: Limits) -> Result<Value> {
    if bytes.len() > limits.max_bytes {
        return Err(err("JSON_TOO_LARGE"));
    }
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Err(err("JSON_BOM"));
    }
    if bytes.contains(&0) {
        return Err(err("JSON_NUL"));
    }
    if core::str::from_utf8(bytes).is_err() {
        return Err(err("JSON_INVALID_UTF8"));
    }
    let mut p = Parser { b: bytes, i: 0, limits };
    p.ws();
    let v = p.value(0)?;
    p.ws();
    if p.i != p.b.len() {
        return Err(err("JSON_TRAILING_CONTENT"));
    }
    Ok(v)
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
    limits: Limits,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }

    fn ws(&mut self) {
        while let Some(c) = self.peek() {
            if c == b' ' || c == b'\t' || c == b'\n' || c == b'\r' {
                self.i += 1;
            } else {
                break;
            }
        }
    }

    fn literal(&mut self, word: &[u8], v: Value) -> Result<Value> {
        if self.b[self.i..].starts_with(word) {
            self.i += word.len();
            Ok(v)
        } else {
            Err(err("JSON_SYNTAX"))
        }
    }

    fn value(&mut self, depth: usize) -> Result<Value> {
        match self.peek() {
            Some(b'{') => self.object(depth + 1),
            Some(b'[') => self.array(depth + 1),
            Some(b'"') => self.string().map(Value::Str),
            Some(b't') => self.literal(b"true", Value::Bool(true)),
            Some(b'f') => self.literal(b"false", Value::Bool(false)),
            Some(b'n') => self.literal(b"null", Value::Null),
            Some(c) if c == b'-' || c.is_ascii_digit() => self.number(),
            _ => Err(err("JSON_SYNTAX")),
        }
    }

    fn enter(&self, depth: usize) -> Result<()> {
        if depth > self.limits.max_depth {
            Err(err("JSON_TOO_DEEP"))
        } else {
            Ok(())
        }
    }

    fn object(&mut self, depth: usize) -> Result<Value> {
        self.enter(depth)?;
        self.i += 1; // '{'
        let mut members: Vec<(String, Value)> = Vec::new();
        let mut keys = std::collections::BTreeSet::new();
        self.ws();
        if self.peek() == Some(b'}') {
            self.i += 1;
            return Ok(Value::Object(members));
        }
        loop {
            self.ws();
            if self.peek() != Some(b'"') {
                return Err(err("JSON_SYNTAX"));
            }
            let key = self.string()?;
            if !keys.insert(key.clone()) {
                return Err(err("JSON_DUPLICATE_KEY"));
            }
            self.ws();
            if self.peek() != Some(b':') {
                return Err(err("JSON_SYNTAX"));
            }
            self.i += 1;
            self.ws();
            let v = self.value(depth)?;
            members.push((key, v));
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b'}') => {
                    self.i += 1;
                    return Ok(Value::Object(members));
                }
                _ => return Err(err("JSON_SYNTAX")),
            }
        }
    }

    fn array(&mut self, depth: usize) -> Result<Value> {
        self.enter(depth)?;
        self.i += 1; // '['
        let mut items = Vec::new();
        self.ws();
        if self.peek() == Some(b']') {
            self.i += 1;
            return Ok(Value::Array(items));
        }
        loop {
            self.ws();
            items.push(self.value(depth)?);
            self.ws();
            match self.peek() {
                Some(b',') => self.i += 1,
                Some(b']') => {
                    self.i += 1;
                    return Ok(Value::Array(items));
                }
                _ => return Err(err("JSON_SYNTAX")),
            }
        }
    }

    fn hex4(&mut self) -> Result<u16> {
        let digits = self.b.get(self.i..self.i + 4).ok_or(err("JSON_SYNTAX"))?;
        let mut v: u16 = 0;
        for &d in digits {
            let n = match d {
                b'0'..=b'9' => d - b'0',
                b'a'..=b'f' => d - b'a' + 10,
                b'A'..=b'F' => d - b'A' + 10,
                _ => return Err(err("JSON_SYNTAX")),
            };
            v = (v << 4) | u16::from(n);
        }
        self.i += 4;
        Ok(v)
    }

    fn string(&mut self) -> Result<String> {
        self.i += 1; // opening quote
        let mut out: Vec<u8> = Vec::new();
        loop {
            let c = self.peek().ok_or(err("JSON_SYNTAX"))?;
            match c {
                b'"' => {
                    self.i += 1;
                    // Input was validated as UTF-8 and escapes produce scalar
                    // values only, so this cannot fail; keep it fail-closed.
                    return String::from_utf8(out).map_err(|_| err("JSON_INVALID_UTF8"));
                }
                0x00..=0x1F => return Err(err("JSON_CONTROL_CHARACTER")),
                b'\\' => {
                    self.i += 1;
                    let e = self.peek().ok_or(err("JSON_SYNTAX"))?;
                    self.i += 1;
                    let ch: char = match e {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'b' => '\u{8}',
                        b'f' => '\u{c}',
                        b'n' => '\n',
                        b'r' => '\r',
                        b't' => '\t',
                        b'u' => self.unicode_escape()?,
                        _ => return Err(err("JSON_SYNTAX")),
                    };
                    if ch == '\0' {
                        return Err(err("JSON_NUL"));
                    }
                    let mut buf = [0u8; 4];
                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                }
                _ => {
                    out.push(c);
                    self.i += 1;
                }
            }
        }
    }

    fn unicode_escape(&mut self) -> Result<char> {
        let hi = self.hex4()?;
        let code: u32 = match hi {
            0xD800..=0xDBFF => {
                if self.b.get(self.i..self.i + 2) != Some(&b"\\u"[..]) {
                    return Err(err("JSON_INVALID_UNICODE"));
                }
                self.i += 2;
                let lo = self.hex4()?;
                if !(0xDC00..=0xDFFF).contains(&lo) {
                    return Err(err("JSON_INVALID_UNICODE"));
                }
                0x10000 + ((u32::from(hi) - 0xD800) << 10) + (u32::from(lo) - 0xDC00)
            }
            0xDC00..=0xDFFF => return Err(err("JSON_INVALID_UNICODE")),
            _ => u32::from(hi),
        };
        char::from_u32(code).ok_or(err("JSON_INVALID_UNICODE"))
    }

    fn number(&mut self) -> Result<Value> {
        let start = self.i;
        let negative = self.peek() == Some(b'-');
        if negative {
            self.i += 1;
        }
        let int_start = self.i;
        match self.peek() {
            Some(b'0') => self.i += 1,
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.i += 1;
                }
            }
            _ => return Err(err("JSON_SYNTAX")),
        }
        let int_end = self.i;
        let mut integral = true;
        if self.peek() == Some(b'.') {
            integral = false;
            self.i += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(err("JSON_SYNTAX"));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.i += 1;
            }
        }
        if matches!(self.peek(), Some(b'e') | Some(b'E')) {
            integral = false;
            self.i += 1;
            if matches!(self.peek(), Some(b'+') | Some(b'-')) {
                self.i += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(err("JSON_SYNTAX"));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.i += 1;
            }
        }
        // A digit directly after a leading zero ("01") is a syntax error.
        if matches!(self.peek(), Some(b'0'..=b'9')) {
            return Err(err("JSON_SYNTAX"));
        }
        if !integral {
            return Err(err("JSON_NUMBER_NOT_INTEGER"));
        }
        let digits = &self.b[int_start..int_end];
        if negative && digits == b"0" {
            return Err(err("JSON_NEGATIVE_ZERO"));
        }
        let mut n: i64 = 0;
        for &d in digits {
            n = n
                .checked_mul(10)
                .and_then(|x| x.checked_add(i64::from(d - b'0')))
                .filter(|x| *x <= MAX_SAFE_INTEGER)
                .ok_or(err("JSON_NUMBER_UNSAFE"))?;
        }
        debug_assert!(self.i > start);
        Ok(Value::Int(if negative { -n } else { n }))
    }
}
