//! Shared std-only robustness harness for the L1 parsers (WP3-B slice B3,
//! D-10). No dependency, no toolchain extension (amendment A8): a seeded
//! SplitMix64 generator, a JSON value generator with a randomizing
//! serializer, and byte-level havoc mutation. Deterministic for a given seed,
//! so every reported case is reproducible.
//!
//! Iterations default to a quick count for `cargo test`; an extended campaign
//! sets `QA_ROBUSTNESS_ITERATIONS` (and optionally `QA_ROBUSTNESS_SEEDS`, a
//! comma-separated list of u64 seeds) and runs with `--release --nocapture`.
//!
//! JSON escapes are built from code points by `push_u_escape`, never written
//! as literals in this file.
#![allow(dead_code)]

use qa_agent_controller_v1::json::{Value, MAX_SAFE_INTEGER};
use std::collections::BTreeMap;

/// Default seeds of the reproducible campaign.
pub const DEFAULT_SEEDS: [u64; 3] = [0x5EED_0001, 0x5EED_0002, 0x5EED_0003];

/// Iterations per seed: `QA_ROBUSTNESS_ITERATIONS` or `default`.
pub fn iterations(default: u64) -> u64 {
    std::env::var("QA_ROBUSTNESS_ITERATIONS").ok().and_then(|s| s.parse().ok()).unwrap_or(default)
}

/// Seeds: `QA_ROBUSTNESS_SEEDS` (comma-separated) or [`DEFAULT_SEEDS`].
pub fn seeds() -> Vec<u64> {
    match std::env::var("QA_ROBUSTNESS_SEEDS") {
        Ok(s) => s.split(',').filter_map(|x| x.trim().parse().ok()).collect(),
        Err(_) => DEFAULT_SEEDS.to_vec(),
    }
}

/// SplitMix64 (Steele, Lea, Flood 2014).
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed)
    }

    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// Uniform-enough value in `0..n` (`0` when `n == 0`).
    pub fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next_u64() % n
        }
    }

    pub fn index(&mut self, len: usize) -> usize {
        self.below(len as u64) as usize
    }

    pub fn chance(&mut self, num: u64, den: u64) -> bool {
        self.below(den) < num
    }

    pub fn pick<'a, T>(&mut self, xs: &'a [T]) -> &'a T {
        &xs[self.index(xs.len())]
    }
}

/// Lowercase or uppercase hex, chosen per escape.
pub fn push_u_escape(out: &mut Vec<u8>, unit: u16, upper: bool) {
    out.push(b'\\');
    out.push(b'u');
    let s = if upper { format!("{unit:04X}") } else { format!("{unit:04x}") };
    out.extend_from_slice(s.as_bytes());
}

/// A string literal containing exactly one backslash-u escape of `unit`.
pub fn quoted_u(units: &[u16], tail: &[u8]) -> Vec<u8> {
    let mut out = vec![b'"'];
    for u in units {
        push_u_escape(&mut out, *u, false);
    }
    out.extend_from_slice(tail);
    out.push(b'"');
    out
}

/// Container depth; the outermost container is depth 1 (as `json::Limits`).
pub fn depth(v: &Value) -> usize {
    match v {
        Value::Array(items) => 1 + items.iter().map(depth).max().unwrap_or(0),
        Value::Object(members) => 1 + members.iter().map(|(_, v)| depth(v)).max().unwrap_or(0),
        _ => 0,
    }
}

/// True when no object at any depth has a repeated key.
pub fn keys_unique(v: &Value) -> bool {
    match v {
        Value::Array(items) => items.iter().all(keys_unique),
        Value::Object(members) => {
            let mut seen = std::collections::BTreeSet::new();
            members.iter().all(|(k, v)| seen.insert(k.clone()) && keys_unique(v))
        }
        _ => true,
    }
}

/// True when no string or key at any depth contains U+0000.
pub fn nul_free(v: &Value) -> bool {
    match v {
        Value::Str(s) => !s.contains('\0'),
        Value::Array(items) => items.iter().all(nul_free),
        Value::Object(members) => members.iter().all(|(k, v)| !k.contains('\0') && nul_free(v)),
        _ => true,
    }
}

/// True when every integer is a safe integer.
pub fn ints_safe(v: &Value) -> bool {
    match v {
        Value::Int(n) => (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(n),
        Value::Array(items) => items.iter().all(ints_safe),
        Value::Object(members) => members.iter().all(|(_, v)| ints_safe(v)),
        _ => true,
    }
}

fn gen_char(r: &mut Rng) -> char {
    loop {
        let c = match r.below(10) {
            0..=3 => char::from(0x20 + r.below(0x5F) as u8),
            4 => char::from(1 + r.below(0x1F) as u8),
            5 => *r.pick(&['"', '\\', '/', '\u{7f}', '\u{2028}', '\u{2029}', '\u{feff}']),
            6 | 7 => char::from_u32(0xA0 + r.below(0xD800 - 0xA0) as u32).unwrap_or('x'),
            8 => char::from_u32(0xE000 + r.below(0xFFFE - 0xE000) as u32).unwrap_or('x'),
            _ => char::from_u32(0x1_0000 + r.below(0x10_0000) as u32).unwrap_or('x'),
        };
        if c != '\0' {
            return c;
        }
    }
}

pub fn gen_string(r: &mut Rng) -> String {
    let len = if r.chance(1, 20) { r.below(200) } else { r.below(9) };
    (0..len).map(|_| gen_char(r)).collect()
}

pub fn gen_int(r: &mut Rng) -> i64 {
    match r.below(6) {
        0 => *r.pick(&[0, 1, -1, MAX_SAFE_INTEGER, -MAX_SAFE_INTEGER, MAX_SAFE_INTEGER - 1, 10, -10]),
        1 => r.below(10) as i64,
        2 => -(r.below(1_000_000) as i64) - 1,
        _ => {
            let n = (r.next_u64() % (MAX_SAFE_INTEGER as u64 + 1)) as i64;
            if r.chance(1, 2) {
                n
            } else {
                -n
            }
        }
    }
}

/// A random value whose container depth is at most `max_depth`.
pub fn gen_value(r: &mut Rng, max_depth: usize, budget: &mut usize) -> Value {
    let leaf = max_depth == 0 || *budget == 0 || r.chance(1, 2);
    if leaf {
        return match r.below(5) {
            0 => Value::Null,
            1 => Value::Bool(r.chance(1, 2)),
            2 => Value::Int(gen_int(r)),
            _ => Value::Str(gen_string(r)),
        };
    }
    let n = r.below(6) as usize;
    *budget = budget.saturating_sub(n + 1);
    if r.chance(1, 2) {
        Value::Array((0..n).map(|_| gen_value(r, max_depth - 1, budget)).collect())
    } else {
        let mut keys: BTreeMap<String, ()> = BTreeMap::new();
        let mut members = Vec::new();
        for _ in 0..n {
            let k = gen_string(r);
            if keys.insert(k.clone(), ()).is_none() {
                members.push((k, gen_value(r, max_depth - 1, budget)));
            }
        }
        Value::Object(members)
    }
}

/// Placeholder leaf whose serialization is replaced by a raw poison token.
pub const POISON: &str = "\u{e000}poison\u{e000}";

fn ws(r: &mut Rng, out: &mut Vec<u8>) {
    if r.chance(1, 4) {
        for _ in 0..=r.below(3) {
            out.push(*r.pick(&[b' ', b'\t', b'\n', b'\r']));
        }
    }
}

fn ser_string(r: &mut Rng, s: &str, out: &mut Vec<u8>) {
    out.push(b'"');
    for c in s.chars() {
        let upper = r.chance(1, 2);
        match c {
            '"' => out.extend_from_slice(if r.chance(1, 4) { b"\\u0022" } else { b"\\\"" }),
            '\\' => out.extend_from_slice(b"\\\\"),
            '/' if r.chance(1, 3) => out.extend_from_slice(b"\\/"),
            '\u{8}' if r.chance(1, 2) => out.extend_from_slice(b"\\b"),
            '\u{c}' if r.chance(1, 2) => out.extend_from_slice(b"\\f"),
            '\n' if r.chance(1, 2) => out.extend_from_slice(b"\\n"),
            '\r' if r.chance(1, 2) => out.extend_from_slice(b"\\r"),
            '\t' if r.chance(1, 2) => out.extend_from_slice(b"\\t"),
            c if (c as u32) < 0x20 || r.chance(1, 4) => {
                let mut units = [0u16; 2];
                for u in c.encode_utf16(&mut units) {
                    push_u_escape(out, *u, upper);
                }
            }
            c => {
                let mut buf = [0u8; 4];
                out.extend_from_slice(c.encode_utf8(&mut buf).as_bytes());
            }
        }
    }
    out.push(b'"');
}

/// Serializes `v` with random whitespace and escape spellings. A `POISON`
/// string leaf is emitted as the raw bytes `poison`.
pub fn serialize(r: &mut Rng, v: &Value, poison: &[u8], out: &mut Vec<u8>) {
    match v {
        Value::Null => out.extend_from_slice(b"null"),
        Value::Bool(b) => out.extend_from_slice(if *b { b"true" } else { b"false" }),
        Value::Int(n) => out.extend_from_slice(n.to_string().as_bytes()),
        Value::Str(s) if s == POISON => out.extend_from_slice(poison),
        Value::Str(s) => ser_string(r, s, out),
        Value::Array(items) => {
            out.push(b'[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                ws(r, out);
                serialize(r, item, poison, out);
                ws(r, out);
            }
            ws(r, out);
            out.push(b']');
        }
        Value::Object(members) => {
            out.push(b'{');
            for (i, (k, item)) in members.iter().enumerate() {
                if i > 0 {
                    out.push(b',');
                }
                ws(r, out);
                ser_string(r, k, out);
                ws(r, out);
                out.push(b':');
                ws(r, out);
                serialize(r, item, poison, out);
                ws(r, out);
            }
            ws(r, out);
            out.push(b'}');
        }
    }
}

/// Replaces one random leaf (whose container depth is below `max_leaf_depth`)
/// with the `POISON` placeholder. Returns false when no such leaf exists.
pub fn plant_poison(r: &mut Rng, v: &mut Value, max_leaf_depth: usize) -> bool {
    fn leaves(v: &Value, d: usize, max: usize, n: &mut usize) {
        match v {
            Value::Array(items) => items.iter().for_each(|x| leaves(x, d + 1, max, n)),
            Value::Object(members) => members.iter().for_each(|(_, x)| leaves(x, d + 1, max, n)),
            _ if d < max => *n += 1,
            _ => {}
        }
    }
    fn plant(v: &mut Value, d: usize, max: usize, target: &mut usize) -> bool {
        match v {
            Value::Array(items) => items.iter_mut().any(|x| plant(x, d + 1, max, target)),
            Value::Object(members) => members.iter_mut().any(|(_, x)| plant(x, d + 1, max, target)),
            _ if d < max => {
                if *target == 0 {
                    *v = Value::Str(POISON.to_owned());
                    true
                } else {
                    *target -= 1;
                    false
                }
            }
            _ => false,
        }
    }
    let mut n = 0;
    leaves(v, 0, max_leaf_depth, &mut n);
    if n == 0 {
        if max_leaf_depth > 0 {
            *v = Value::Str(POISON.to_owned());
            return true;
        }
        return false;
    }
    let mut target = r.index(n);
    plant(v, 0, max_leaf_depth, &mut target)
}

/// Byte-level havoc: 1..=8 random edits from a JSON/wire-aware dictionary.
pub fn havoc(r: &mut Rng, input: &mut Vec<u8>) {
    const DICT: [&[u8]; 24] = [
        b"{", b"}", b"[", b"]", b"\"", b"\\", b":", b",", b"true", b"false", b"null", b"-", b"0", b"1e9", b".5",
        b"9007199254740992", b"\xef\xbb\xbf", b"\x00", b"\xff", b"\xed\xa0\x80", b"\xc0\x80", b"\\x", b" ", b"\x01",
    ];
    for _ in 0..=r.below(8) {
        let len = input.len();
        match r.below(8) {
            0 if len > 0 => {
                let i = r.index(len);
                input[i] ^= 1 << r.below(8);
            }
            1 if len > 0 => {
                let i = r.index(len);
                input[i] = r.below(256) as u8;
            }
            2 => {
                let i = r.index(len + 1);
                input.insert(i, r.below(256) as u8);
            }
            3 | 4 => {
                let i = r.index(len + 1);
                let tok = *r.pick(&DICT);
                input.splice(i..i, tok.iter().copied());
            }
            5 if len > 0 => {
                let a = r.index(len);
                let b = (a + 1 + r.index(8)).min(len);
                input.drain(a..b);
            }
            6 if len > 0 => {
                let a = r.index(len);
                let b = (a + 1 + r.index(16)).min(len);
                let chunk: Vec<u8> = input[a..b].to_vec();
                let i = r.index(len + 1);
                input.splice(i..i, chunk);
            }
            7 if len > 0 => input.truncate(r.index(len)),
            _ => {}
        }
    }
}

/// Lowercase hex for failure reports.
pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Per-code tallies printed by the extended campaign.
#[derive(Default)]
pub struct Tally(pub BTreeMap<&'static str, u64>);

impl Tally {
    pub fn add(&mut self, code: &'static str) {
        *self.0.entry(code).or_insert(0) += 1;
    }

    pub fn get(&self, code: &str) -> u64 {
        self.0.get(code).copied().unwrap_or(0)
    }

    pub fn line(&self) -> String {
        self.0.iter().map(|(k, v)| format!("{k}={v}")).collect::<Vec<_>>().join(" ")
    }
}
