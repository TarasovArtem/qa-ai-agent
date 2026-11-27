//! Closed CREATE/RECONCILE request (OD-06 §4.2).
//!
//! Schema-level validation only. Checks that need enrollment, the §5.4
//! record, Stage 4 evidence, the journal or the live filesystem (root
//! identity digest, product version equality, applied-package agreement,
//! executionId non-reuse, R1 playwright-only eligibility) belong to the broker
//! integration (WP3-B/WP4) and are not performed here.

use crate::closed::{strictly_ascending, Closed};
use crate::digest::is_h;
use crate::error::{Error, ErrorKind, Result};
use crate::grammar;
use crate::json::{self, Value};
use crate::CONTRACT_VERSION;

const K: ErrorKind = ErrorKind::Schema;

/// Request operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    /// `create`
    Create,
    /// `reconcile`
    Reconcile,
}

impl Operation {
    /// Wire literal.
    pub fn as_str(self) -> &'static str {
        match self {
            Operation::Create => "create",
            Operation::Reconcile => "reconcile",
        }
    }

    /// Parses a wire literal.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "create" => Some(Operation::Create),
            "reconcile" => Some(Operation::Reconcile),
            _ => None,
        }
    }
}

/// `root` record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Root {
    /// Canonical absolute path.
    pub path: String,
    /// Device, decimal string.
    pub dev: String,
    /// Inode, decimal string.
    pub ino: String,
    /// Stage 4 root-identity-v1 digest (format checked only).
    pub digest: String,
}

/// `subject` record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Subject {
    /// `runId`
    pub run_id: String,
    /// `packageOrdinal`
    pub package_ordinal: String,
    /// `applyRecordId`
    pub apply_record_id: String,
    /// `packageDigest`
    pub package_digest: String,
    /// `appliedRecordSha256`
    pub applied_record_sha256: String,
    /// `bindingDigest`
    pub binding_digest: String,
    /// `product.version`
    pub product_version: String,
}

/// One `targets[]` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Target {
    /// PPI-1 root-relative executable spec path.
    pub path: String,
    /// `CREATE` or `MODIFY`.
    pub operation: String,
    /// `afterDigest`
    pub after_digest: String,
}

/// One `environment[]` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvEntry {
    /// SUT name.
    pub name: String,
    /// Value (bounded UTF-8, no NUL).
    pub value: String,
}

/// A validated CREATE request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreateRequest {
    /// `executionId`
    pub execution_id: String,
    /// `root`
    pub root: Root,
    /// `subject`
    pub subject: Subject,
    /// `cypress` or `playwright`
    pub framework: String,
    /// `targets`, sorted and unique
    pub targets: Vec<Target>,
    /// `timeoutMs`
    pub timeout_ms: u32,
    /// `environment`
    pub environment: Vec<EnvEntry>,
}

/// A validated request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Request {
    /// CREATE
    Create(CreateRequest),
    /// RECONCILE, carrying only `executionId`.
    Reconcile {
        /// `executionId`
        execution_id: String,
    },
}

const CREATE_KEYS: [&str; 10] = [
    "schemaVersion", "contractVersion", "operation", "executionId", "root", "subject", "framework",
    "targets", "timeoutMs", "environment",
];
const RECONCILE_KEYS: [&str; 4] = ["schemaVersion", "contractVersion", "operation", "executionId"];

/// Limits from OD-06 §4.2 and §9.1.
pub mod limits {
    /// Targets per request.
    pub const MAX_TARGETS: usize = 100;
    /// Environment entries.
    pub const MAX_ENVIRONMENT: usize = 32;
    /// Bytes per environment value.
    pub const MAX_ENV_VALUE_BYTES: usize = 4096;
    /// Total bytes of all names plus values.
    pub const MAX_ENV_TOTAL_BYTES: usize = 65_536;
    /// `timeoutMs` range.
    pub const TIMEOUT_MS: (i64, i64) = (1000, 600_000);
}

/// Parses and validates one request payload (the bytes inside a client frame).
pub fn parse_request(payload: &[u8]) -> Result<Request> {
    let v = json::parse_strict(payload, json::FRAME_LIMITS)?;
    validate_request(&v)
}

/// Validates an already parsed request value.
///
/// Every field rule of OD-06 §4.2/§9.1 is enforced here, independently of how
/// `v` was produced. The byte-size (<=262144) and nesting (<=12) bounds are
/// intake limits on the wire bytes, enforced by `parse_request`. A value
/// accepted here is at most 3 levels deep, because every closed key has a
/// fixed scalar, record or array-of-record type.
pub fn validate_request(v: &Value) -> Result<Request> {
    let op = match v.get("operation") {
        Some(Value::Str(s)) => Operation::parse(s).ok_or(Error::new(K, "SCHEMA_OPERATION"))?,
        _ => return Err(Error::new(K, "SCHEMA_OPERATION")),
    };
    let keys: &[&str] = match op {
        Operation::Create => &CREATE_KEYS,
        Operation::Reconcile => &RECONCILE_KEYS,
    };
    let o = Closed::new(v, keys, K)?;
    o.int("schemaVersion", 1, 1)?;
    o.literal("contractVersion", CONTRACT_VERSION)?;
    let execution_id = o.grammar("executionId", grammar::is_id32)?.to_owned();
    if op == Operation::Reconcile {
        return Ok(Request::Reconcile { execution_id });
    }

    let r = Closed::new(o.raw("root"), &["platform", "path", "dev", "ino", "digest"], K)?;
    r.literal("platform", "linux")?;
    let root = Root {
        path: r.grammar("path", grammar::is_canonical_absolute_path)?.to_owned(),
        dev: r.grammar("dev", grammar::is_decimal_id)?.to_owned(),
        ino: r.grammar("ino", grammar::is_decimal_id)?.to_owned(),
        digest: r.grammar("digest", is_h)?.to_owned(),
    };

    let s = Closed::new(
        o.raw("subject"),
        &["runId", "packageOrdinal", "applyRecordId", "packageDigest", "appliedRecordSha256", "bindingDigest", "product"],
        K,
    )?;
    let p = Closed::new(s.raw("product"), &["name", "version"], K)?;
    p.literal("name", "qa-ai-agent")?;
    let subject = Subject {
        run_id: s.grammar("runId", grammar::is_run_id)?.to_owned(),
        package_ordinal: s.grammar("packageOrdinal", grammar::is_ordinal)?.to_owned(),
        apply_record_id: s.grammar("applyRecordId", grammar::is_id32)?.to_owned(),
        package_digest: s.grammar("packageDigest", is_h)?.to_owned(),
        applied_record_sha256: s.grammar("appliedRecordSha256", is_h)?.to_owned(),
        binding_digest: s.grammar("bindingDigest", is_h)?.to_owned(),
        product_version: p.grammar("version", grammar::is_exact_semver)?.to_owned(),
    };

    let framework = o.grammar("framework", |f| grammar::FRAMEWORKS.contains(&f))?.to_owned();

    let raw_targets = o.array("targets")?;
    if raw_targets.is_empty() || raw_targets.len() > limits::MAX_TARGETS {
        return Err(Error::new(K, "SCHEMA_TARGET_COUNT"));
    }
    let mut targets = Vec::with_capacity(raw_targets.len());
    for t in raw_targets {
        let t = Closed::new(t, &["path", "operation", "afterDigest"], K)?;
        targets.push(Target {
            path: t.grammar("path", |p| grammar::is_ppi1_target_path(p, &framework))?.to_owned(),
            operation: t.grammar("operation", |x| x == "CREATE" || x == "MODIFY")?.to_owned(),
            after_digest: t.grammar("afterDigest", is_h)?.to_owned(),
        });
    }
    if !strictly_ascending(targets.iter().map(|t| t.path.as_str())) {
        return Err(Error::new(K, "SCHEMA_TARGET_ORDER"));
    }
    // PPI-1 identity key is the ASCII case-fold of the whole path; two targets
    // with equal keys are refused (OD-04 §13.3, adopted by OD-06 §4.2
    // "canonical PPI-1"). Paths are ASCII after the grammar check.
    let mut folded: Vec<String> = targets.iter().map(|t| t.path.to_ascii_lowercase()).collect();
    folded.sort();
    if folded.windows(2).any(|w| w[0] == w[1]) {
        return Err(Error::new(K, "SCHEMA_TARGET_CASE_FOLD_DUPLICATE"));
    }

    let (lo, hi) = limits::TIMEOUT_MS;
    let timeout_ms = o.int("timeoutMs", lo, hi)? as u32;

    let raw_env = o.array("environment")?;
    if raw_env.len() > limits::MAX_ENVIRONMENT {
        return Err(Error::new(K, "SCHEMA_ENVIRONMENT_COUNT"));
    }
    let mut environment: Vec<EnvEntry> = Vec::with_capacity(raw_env.len());
    let mut total = 0usize;
    for e in raw_env {
        let e = Closed::new(e, &["name", "value"], K)?;
        let name = e.grammar("name", grammar::is_sut_name)?;
        let value = e.str("value")?;
        // OD-06 §9.1: value <= 4096 UTF-8 bytes, no NUL. NUL is enforced here
        // as well as in the strict parser, so `validate_request` applies the
        // same rule to a value that did not come through `parse_request`.
        if value.len() > limits::MAX_ENV_VALUE_BYTES || value.contains('\0') {
            return Err(Error::new(K, "SCHEMA_ENVIRONMENT_VALUE"));
        }
        if environment.iter().any(|x| x.name == name) {
            return Err(Error::new(K, "SCHEMA_ENVIRONMENT_DUPLICATE"));
        }
        total = total.saturating_add(name.len() + value.len());
        environment.push(EnvEntry { name: name.to_owned(), value: value.to_owned() });
    }
    if total > limits::MAX_ENV_TOTAL_BYTES {
        return Err(Error::new(K, "SCHEMA_ENVIRONMENT_TOTAL"));
    }

    Ok(Request::Create(CreateRequest {
        execution_id,
        root,
        subject,
        framework,
        targets,
        timeout_ms,
        environment,
    }))
}
