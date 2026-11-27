//! Helpers for recursively closed schemas (OD-06 §4.2: every key required,
//! unknown keys, coercion and default merging refused, `null` explicit only).

use crate::error::{Error, ErrorKind, Result};
use crate::json::{Value, MAX_SAFE_INTEGER};

/// A closed object view whose key set has been checked to be exactly `keys`.
pub(crate) struct Closed<'a> {
    members: &'a [(String, Value)],
    kind: ErrorKind,
}

impl<'a> Closed<'a> {
    /// Requires `v` to be an object with exactly the key set `keys`.
    pub(crate) fn new(v: &'a Value, keys: &[&str], kind: ErrorKind) -> Result<Self> {
        let members = match v {
            Value::Object(m) => m,
            _ => return Err(Error::new(kind, "SCHEMA_NOT_OBJECT")),
        };
        if members.len() != keys.len() || !keys.iter().all(|k| members.iter().any(|(mk, _)| mk == k)) {
            return Err(Error::new(kind, "SCHEMA_KEY_SET"));
        }
        Ok(Closed { members, kind })
    }

    fn err(&self, code: &'static str) -> Error {
        Error::new(self.kind, code)
    }

    /// The value of a key known to be present.
    pub(crate) fn raw(&self, key: &str) -> &'a Value {
        // Presence is guaranteed by `new`.
        self.members.iter().find(|(k, _)| k == key).map(|(_, v)| v).unwrap_or(&Value::Null)
    }

    pub(crate) fn str(&self, key: &str) -> Result<&'a str> {
        match self.raw(key) {
            Value::Str(s) => Ok(s.as_str()),
            _ => Err(self.err("SCHEMA_TYPE")),
        }
    }

    pub(crate) fn opt_str(&self, key: &str) -> Result<Option<&'a str>> {
        match self.raw(key) {
            Value::Null => Ok(None),
            Value::Str(s) => Ok(Some(s.as_str())),
            _ => Err(self.err("SCHEMA_TYPE")),
        }
    }

    pub(crate) fn int(&self, key: &str, min: i64, max: i64) -> Result<i64> {
        match self.raw(key) {
            Value::Int(n) if *n >= min && *n <= max => Ok(*n),
            Value::Int(_) => Err(self.err("SCHEMA_RANGE")),
            _ => Err(self.err("SCHEMA_TYPE")),
        }
    }

    pub(crate) fn opt_int(&self, key: &str, min: i64, max: i64) -> Result<Option<i64>> {
        match self.raw(key) {
            Value::Null => Ok(None),
            _ => self.int(key, min, max).map(Some),
        }
    }

    pub(crate) fn boolean(&self, key: &str) -> Result<bool> {
        match self.raw(key) {
            Value::Bool(b) => Ok(*b),
            _ => Err(self.err("SCHEMA_TYPE")),
        }
    }

    pub(crate) fn array(&self, key: &str) -> Result<&'a [Value]> {
        match self.raw(key) {
            Value::Array(a) => Ok(a.as_slice()),
            _ => Err(self.err("SCHEMA_TYPE")),
        }
    }

    /// Requires `key` to hold exactly the string `literal`.
    pub(crate) fn literal(&self, key: &str, literal: &str) -> Result<()> {
        if self.str(key)? == literal {
            Ok(())
        } else {
            Err(self.err("SCHEMA_LITERAL"))
        }
    }

    /// Requires a string accepted by `pred`.
    pub(crate) fn grammar(&self, key: &str, pred: impl Fn(&str) -> bool) -> Result<&'a str> {
        let s = self.str(key)?;
        if pred(s) {
            Ok(s)
        } else {
            Err(self.err("SCHEMA_GRAMMAR"))
        }
    }

    /// Requires `null` or a string accepted by `pred`.
    pub(crate) fn opt_grammar(&self, key: &str, pred: impl Fn(&str) -> bool) -> Result<Option<&'a str>> {
        match self.opt_str(key)? {
            None => Ok(None),
            Some(s) if pred(s) => Ok(Some(s)),
            Some(_) => Err(self.err("SCHEMA_GRAMMAR")),
        }
    }
}

/// Non-negative safe integer upper bound, for `N` fields.
pub(crate) const N_MAX: i64 = MAX_SAFE_INTEGER;

/// True when `items` is strictly ascending by byte order (sorted and unique).
pub(crate) fn strictly_ascending<'a>(items: impl IntoIterator<Item = &'a str>) -> bool {
    let mut prev: Option<&str> = None;
    for s in items {
        if let Some(p) = prev {
            if p.as_bytes() >= s.as_bytes() {
                return false;
            }
        }
        prev = Some(s);
    }
    true
}
