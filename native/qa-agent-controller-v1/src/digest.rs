//! `H` digests (OD-06 §4.2, §11.1).
//!
//! `H` is the string `sha256:` + 64 lowercase hex. A domain digest is
//! SHA-256 of the ASCII domain prefix followed by the CRS-1 canonical bytes,
//! with no newline, excluding the object's own digest field.
//!
//! SHA-256 comes from the single vendored dependency `hmac-sha256` 1.1.15
//! (amendment A8 budget; OD-R1-STAGE5-WP3-A-SHA256-1). Only `Hash` is used;
//! the crate's HMAC/HKDF functionality is not used.

use crate::canonical;
use crate::error::{Error, ErrorKind, Result};
use crate::json::Value;

/// The `H` prefix.
pub const H_PREFIX: &str = "sha256:";

/// OD-06 §11.1/§11.2/§11.3 and amendment A2 digest domains.
pub mod domains {
    /// `bindingDigest`
    pub const BINDING: &str = "qa-ai-agent:execution-binding:v1:";
    /// `fingerprintDigest` (amendment A2.2)
    pub const FINGERPRINT: &str = "qa-ai-agent:execution-fingerprint:v1:";
    /// `browserSha256` tree digest (amendment A2.3)
    pub const BROWSER_TREE: &str = "qa-ai-agent:execution-browser-tree:v1:";
    /// `profileDigest`
    pub const PROFILE: &str = "qa-ai-agent:execution-profile:v1:";
    /// `compatibilityDigest`
    pub const COMPATIBILITY: &str = "qa-ai-agent:execution-compatibility:v1:";
    /// `propertiesDigest`
    pub const PROPERTIES: &str = "qa-ai-agent:execution-properties:v1:";
    /// `journalDigest`
    pub const ATTEMPT: &str = "qa-ai-agent:execution-attempt:v1:";
    /// `incidentDigest`
    pub const INCIDENT: &str = "qa-ai-agent:execution-incident:v1:";
    /// `recordDigest` of AutomationExecutionRecord v2
    pub const RECORD_V2: &str = "qa-ai-agent:automation-execution-record:v2:";
    /// Existing Stage 4 `root-identity-v1` domain (approval/apply contract
    /// §17.2; OD-06 §4.2, §11.1 "Existing Stage 4 domains/bytes unchanged").
    pub const REPOSITORY_ROOT_BINDING: &str = "qa-ai-agent:repository-root-binding:v1:";
}

const fn err(code: &'static str) -> Error {
    Error::new(ErrorKind::Canonical, code)
}

fn hex_lower(bytes: &[u8; 32]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(H_PREFIX.len() + 64);
    s.push_str(H_PREFIX);
    for b in bytes {
        s.push(char::from(HEX[usize::from(b >> 4)]));
        s.push(char::from(HEX[usize::from(b & 0xF)]));
    }
    s
}

/// `H` of raw bytes (for example a file's content).
pub fn h_bytes(bytes: &[u8]) -> String {
    hex_lower(&hmac_sha256::Hash::hash(bytes))
}

/// `H` of an ASCII domain prefix followed by `canonical` bytes.
pub fn h_domain(domain: &str, canonical: &[u8]) -> Result<String> {
    if domain.is_empty() || !domain.bytes().all(|b| (0x20..=0x7E).contains(&b)) {
        return Err(err("DIGEST_DOMAIN_NOT_ASCII"));
    }
    let mut h = hmac_sha256::Hash::new();
    h.update(domain.as_bytes());
    h.update(canonical);
    Ok(hex_lower(&h.finalize()))
}

/// `H(domain, E(v))`.
pub fn h_value(domain: &str, v: &Value) -> Result<String> {
    h_domain(domain, &canonical::encode(v)?)
}

/// `H(domain, E(obj without its own digest field))`. The field must be present
/// at the top level of `obj`; its value is not inspected.
pub fn h_value_excluding(domain: &str, obj: &Value, own_digest_field: &str) -> Result<String> {
    match obj {
        Value::Object(members) => {
            if !members.iter().any(|(k, _)| k == own_digest_field) {
                return Err(err("DIGEST_FIELD_MISSING"));
            }
            let rest: Vec<(String, Value)> =
                members.iter().filter(|(k, _)| k != own_digest_field).cloned().collect();
            h_value(domain, &Value::Object(rest))
        }
        _ => Err(err("DIGEST_NOT_OBJECT")),
    }
}

/// Whole-string `^sha256:[0-9a-f]{64}$`.
pub fn is_h(s: &str) -> bool {
    s.len() == H_PREFIX.len() + 64
        && s.starts_with(H_PREFIX)
        && s.as_bytes()[H_PREFIX.len()..].iter().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
