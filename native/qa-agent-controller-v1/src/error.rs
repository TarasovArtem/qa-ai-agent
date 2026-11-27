//! Closed, input-free error values.
//!
//! An error carries a component kind and a fixed code string only. It never
//! carries or echoes input bytes (OD-06 §11.3: malformed intake is answered
//! with a fixed reason and no echo). Mapping these internal codes onto the
//! public OD-06 refusal/record reasons belongs to the integration layer
//! (WP3-B/WP4) and is deliberately not decided here.

use core::fmt;

/// The component that produced an error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// Strict JSON intake (OD-06 §4.2).
    Json,
    /// CRS-1 canonical encoding (OD-06 §11.1, OD-04 §11.2).
    Canonical,
    /// Length-prefixed wire framing (OD-06 §4.2, §7.2, §9.2).
    Wire,
    /// Closed request schema (OD-06 §4.2).
    Schema,
    /// Closed broker frame model and frame ordering (OD-06 §7.2, §11.3).
    Frame,
    /// Client result proposal (OD-06 §11.2, §9.3, §9.4).
    Proposal,
    /// `od06-files-v1` fingerprint (OD-06 §8.2, amendment A2).
    Fingerprint,
}

/// A fixed-code error. `code` is a static identifier, never derived from input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Error {
    /// Producing component.
    pub kind: ErrorKind,
    /// Stable, input-free code such as `JSON_DUPLICATE_KEY`.
    pub code: &'static str,
}

impl Error {
    pub(crate) const fn new(kind: ErrorKind, code: &'static str) -> Self {
        Error { kind, code }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.kind, self.code)
    }
}

impl std::error::Error for Error {}

/// Result alias used across the crate.
pub type Result<T> = core::result::Result<T, Error>;
