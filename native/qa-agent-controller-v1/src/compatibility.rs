//! Closed product/broker compatibility record (OD-06 §5.4).
//!
//! - B1-01: the record model and its closed schema.
//! - B1-02: `compatibilityDigest` = `H("qa-ai-agent:execution-compatibility:v1:", E(record))`
//!   and its comparison with the enrollment's `compatibilityDigest`.
//! - B1-05 (comparison half): the record `profileDigest` against the digest
//!   of the enrollment qualification (computed in [`crate::enrollment`]).
//! - B1-06: request/record agreement (the data part of the §5.4 broker check).
//!
//! Data only. Reading `compatibility.json`, computing the broker's own
//! artifact digest (`brokerSha256`), comparing live host builds with the
//! qualification and mapping these outcomes to public refusal reasons
//! (D-12) are not done here.

use crate::closed::Closed;
use crate::digest::{domains, h_value, is_h};
use crate::enrollment::Enrollment;
use crate::error::{Error, ErrorKind, Result};
use crate::grammar;
use crate::json::{self, Limits, Value};
use crate::request::CreateRequest;
use crate::CONTRACT_VERSION;

const K: ErrorKind = ErrorKind::Compatibility;

const fn err(code: &'static str) -> Error {
    Error::new(K, code)
}

/// Parser bound for a compatibility record. OD-06 sets no size for this file;
/// a closed record is a few hundred bytes, so the strict-JSON frame bounds
/// (262144 bytes, depth 12) are used as an implementation limit.
pub const COMPATIBILITY_LIMITS: Limits = json::FRAME_LIMITS;

const RECORD_KEYS: [&str; 5] = ["schemaVersion", "product", "contractVersion", "brokerSha256", "profileDigest"];

/// A validated §5.4 record. `schemaVersion` (1), `product.name`
/// ("qa-ai-agent") and `contractVersion` (the compiled literal) are fixed by
/// the schema and therefore not stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompatibilityRecord {
    /// `product.version`: exact SemVer, at most 64 ASCII.
    pub product_version: String,
    /// `brokerSha256` (`H`).
    pub broker_sha256: String,
    /// `profileDigest` (`H`).
    pub profile_digest: String,
    /// `compatibilityDigest` of this record (B1-02).
    pub digest: String,
}

/// Strictly parses and validates a record.
pub fn parse_compatibility_record(bytes: &[u8]) -> Result<CompatibilityRecord> {
    let v = json::parse_strict(bytes, COMPATIBILITY_LIMITS)?;
    validate_compatibility_record(&v)
}

/// Validates a parsed record against the closed §5.4 schema and computes its
/// `compatibilityDigest` over the canonical encoding of the record.
pub fn validate_compatibility_record(v: &Value) -> Result<CompatibilityRecord> {
    let o = Closed::new(v, &RECORD_KEYS, K)?;
    o.int("schemaVersion", 1, 1)?;
    let p = Closed::new(o.raw("product"), &["name", "version"], K)?;
    p.literal("name", "qa-ai-agent")?;
    let product_version = p.grammar("version", grammar::is_exact_semver)?.to_owned();
    // A record whose contractVersion is not the compiled literal is refused (§5.4).
    o.literal("contractVersion", CONTRACT_VERSION)?;
    let broker_sha256 = o.grammar("brokerSha256", is_h)?.to_owned();
    let profile_digest = o.grammar("profileDigest", is_h)?.to_owned();
    let digest = h_value(domains::COMPATIBILITY, v)?;
    Ok(CompatibilityRecord { product_version, broker_sha256, profile_digest, digest })
}

/// §5.4 binding between an enrollment and a record (data part):
/// - the enrollment `compatibilityDigest` equals the record digest (B1-02);
/// - the record `profileDigest` equals the digest of the enrollment
///   qualification (B1-05; a mismatch is the §5.4 "stale qualification" case).
pub fn check_enrollment_binding(enrollment: &Enrollment, record: &CompatibilityRecord) -> Result<()> {
    if enrollment.compatibility_digest != record.digest {
        return Err(err("COMPATIBILITY_DIGEST_MISMATCH"));
    }
    if record.profile_digest != enrollment.qualification.profile_digest {
        return Err(err("COMPATIBILITY_PROFILE_DIGEST_MISMATCH"));
    }
    Ok(())
}

/// B1-06: the request `contractVersion` and `subject.product.{name,version}`
/// must equal the record exactly (§5.4). The contract literal and the product
/// name are fixed by both closed schemas, so the remaining comparison is the
/// product version.
pub fn check_request_agreement(record: &CompatibilityRecord, request: &CreateRequest) -> Result<()> {
    if request.subject.product_version != record.product_version {
        return Err(err("COMPATIBILITY_PRODUCT_VERSION_MISMATCH"));
    }
    Ok(())
}
