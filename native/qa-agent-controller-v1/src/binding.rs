//! Closed execution `binding` and `bindingDigest` (OD-06 §11.1), with its
//! data-only agreements (OD-06 §4.2, §4.3 items 2–3, §8.1; amendment A2.2).
//! WP3-B slice B2: the portable, inert data-model subset of D-04.
//!
//! What this module does NOT do: reload Stage 4 evidence, rebuild the
//! generation chain, read the applied files or the live root, or reconstruct a
//! binding from fixed Stage 4 data (OD-06 §8.1 items 1–7, §4.3 item 3). That
//! runtime reconstruction stays OPEN (D-04). Every function here only checks
//! that data is well formed and mutually consistent. No result of this module
//! is execution authority: a valid, consistent binding is a precondition the
//! broker may refuse on, never a grant.

use crate::closed::Closed;
use crate::compatibility::CompatibilityRecord;
use crate::digest::{domains, h_value_excluding, is_h};
use crate::enrollment::{EnrolledRoot, Enrollment};
use crate::error::{Error, ErrorKind, Result};
use crate::grammar;
use crate::json::{self, Value, MAX_SAFE_INTEGER};
use crate::request::{parse_root, parse_targets, CreateRequest, Root, Target};
use crate::root_identity;

const K: ErrorKind = ErrorKind::Binding;

const fn err(code: &'static str) -> Error {
    Error::new(K, code)
}

/// The exact `binding` key set (OD-06 §11.1).
pub const BINDING_KEYS: [&str; 21] = [
    "projectId",
    "runId",
    "packageOrdinal",
    "product",
    "root",
    "principal",
    "reviewRecordId",
    "applyRecordId",
    "reviewRecordDigest",
    "packageDigest",
    "changeSetDigest",
    "automationPlanDigest",
    "repositoryContextDigest",
    "projectionDigest",
    "appliedRecordSha256",
    "targets",
    "framework",
    "timeoutMs",
    "fingerprintDigest",
    "profileDigest",
    "bindingDigest",
];

/// The exact Stage 4 OS-local principal envelope key set (Stage 4
/// review-record-v2 `reviewer`; OD-06 §11.1 "principal exact Stage 4 OS-local
/// envelope").
pub const PRINCIPAL_KEYS: [&str; 6] = ["method", "principal", "uid", "profileDigest", "platform", "assurance"];

/// Stage 4 principal `method`.
pub const PRINCIPAL_METHOD: &str = "os-local-account-v1";
/// Stage 4 principal identifier prefix.
pub const PRINCIPAL_PREFIX: &str = "os-account-v1:";
/// Stage 4 principal `assurance`.
pub const PRINCIPAL_ASSURANCE: &str = "LOCAL_ACCOUNT_ATTRIBUTION";
/// Stage 4 principal platforms.
pub const PRINCIPAL_PLATFORMS: [&str; 7] = ["linux", "darwin", "freebsd", "openbsd", "sunos", "aix", "win32"];

/// Intake bound for a serialized binding: the OD-06 §4.2 frame limits.
pub const BINDING_LIMITS: json::Limits = json::FRAME_LIMITS;

/// Stage 4 OS-local principal envelope.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Principal {
    /// `principal` (`os-account-v1:` + escaped account name).
    pub principal: String,
    /// `uid`: a safe integer >= 1 off Windows, `None` on `win32`.
    pub uid: Option<u64>,
    /// `profileDigest`: `H` on `win32`, `None` elsewhere.
    pub profile_digest: Option<String>,
    /// `platform`
    pub platform: String,
}

/// A validated, digest-consistent execution binding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Binding {
    /// `projectId`
    pub project_id: String,
    /// `runId`
    pub run_id: String,
    /// `packageOrdinal`
    pub package_ordinal: String,
    /// `product.version` (`product.name` is the literal `qa-ai-agent`).
    pub product_version: String,
    /// `root`, the OD-06 §4.2 root record, `root-identity-v1` consistent.
    pub root: Root,
    /// `principal`
    pub principal: Principal,
    /// `reviewRecordId`
    pub review_record_id: String,
    /// `applyRecordId`
    pub apply_record_id: String,
    /// `reviewRecordDigest`
    pub review_record_digest: String,
    /// `packageDigest`
    pub package_digest: String,
    /// `changeSetDigest`
    pub change_set_digest: String,
    /// `automationPlanDigest`
    pub automation_plan_digest: String,
    /// `repositoryContextDigest`
    pub repository_context_digest: String,
    /// `projectionDigest`
    pub projection_digest: String,
    /// `appliedRecordSha256`
    pub applied_record_sha256: String,
    /// `targets`, sorted and unique (OD-06 §4.2 rules).
    pub targets: Vec<Target>,
    /// `cypress` or `playwright`
    pub framework: String,
    /// `timeoutMs`
    pub timeout_ms: u32,
    /// `fingerprintDigest`
    pub fingerprint_digest: String,
    /// `profileDigest`
    pub profile_digest: String,
    /// `bindingDigest`, equal to the recomputed digest.
    pub binding_digest: String,
}

/// Parses strict JSON bytes and validates a binding.
pub fn parse_binding(bytes: &[u8]) -> Result<Binding> {
    let v = json::parse_strict(bytes, BINDING_LIMITS)?;
    validate_binding(&v)
}

/// `bindingDigest` = `H("qa-ai-agent:execution-binding:v1:", E(binding
/// without bindingDigest))` (OD-06 §11.1). The value is not otherwise
/// validated; use [`validate_binding`] for that.
pub fn compute_binding_digest(v: &Value) -> Result<String> {
    h_value_excluding(domains::BINDING, v, "bindingDigest")
}

fn parse_principal(v: &Value) -> Result<Principal> {
    let p = Closed::new(v, &PRINCIPAL_KEYS, K)?;
    p.literal("method", PRINCIPAL_METHOD)?;
    p.literal("assurance", PRINCIPAL_ASSURANCE)?;
    let principal =
        p.grammar("principal", |s| grammar::is_project_id(s) && s.starts_with(PRINCIPAL_PREFIX))?.to_owned();
    let platform = p.grammar("platform", |s| PRINCIPAL_PLATFORMS.contains(&s))?.to_owned();
    // Stage 4: win32 -> uid null and profileDigest H; otherwise uid a safe
    // integer >= 1 and profileDigest null.
    let (uid, profile_digest) = if platform == "win32" {
        if !matches!(p.raw("uid"), Value::Null) {
            return Err(err("BINDING_PRINCIPAL_UID"));
        }
        let d = p.opt_grammar("profileDigest", is_h)?.ok_or(err("BINDING_PRINCIPAL_PROFILE_DIGEST"))?;
        (None, Some(d.to_owned()))
    } else {
        let uid = p.opt_int("uid", 1, MAX_SAFE_INTEGER)?.ok_or(err("BINDING_PRINCIPAL_UID"))?;
        if !matches!(p.raw("profileDigest"), Value::Null) {
            return Err(err("BINDING_PRINCIPAL_PROFILE_DIGEST"));
        }
        (Some(uid as u64), None)
    };
    Ok(Principal { principal, uid, profile_digest, platform })
}

/// Validates a binding value: the closed schema (OD-06 §11.1, every key
/// required, no other key), each field's existing grammar, Stage 4
/// `root-identity-v1` consistency of `root`, the principal platform against
/// the root platform, and `bindingDigest` against its recomputation.
pub fn validate_binding(v: &Value) -> Result<Binding> {
    let o = Closed::new(v, &BINDING_KEYS, K)?;
    let hash = |k: &str| o.grammar(k, is_h).map(str::to_owned);
    let id = |k: &str| o.grammar(k, grammar::is_id32).map(str::to_owned);

    let project_id = o.grammar("projectId", grammar::is_project_id)?.to_owned();
    let run_id = o.grammar("runId", grammar::is_run_id)?.to_owned();
    let package_ordinal = o.grammar("packageOrdinal", grammar::is_ordinal)?.to_owned();
    let product = Closed::new(o.raw("product"), &["name", "version"], K)?;
    product.literal("name", "qa-ai-agent")?;
    let product_version = product.grammar("version", grammar::is_exact_semver)?.to_owned();
    let root = parse_root(o.raw("root"), K)?;
    let principal = parse_principal(o.raw("principal"))?;
    let review_record_id = id("reviewRecordId")?;
    let apply_record_id = id("applyRecordId")?;
    let review_record_digest = hash("reviewRecordDigest")?;
    let package_digest = hash("packageDigest")?;
    let change_set_digest = hash("changeSetDigest")?;
    let automation_plan_digest = hash("automationPlanDigest")?;
    let repository_context_digest = hash("repositoryContextDigest")?;
    let projection_digest = hash("projectionDigest")?;
    let applied_record_sha256 = hash("appliedRecordSha256")?;
    let framework = o.grammar("framework", |f| grammar::FRAMEWORKS.contains(&f))?.to_owned();
    let targets = parse_targets(o.array("targets")?, &framework, K)?;
    let (lo, hi) = crate::request::limits::TIMEOUT_MS;
    let timeout_ms = o.int("timeoutMs", lo, hi)? as u32;
    let fingerprint_digest = hash("fingerprintDigest")?;
    let profile_digest = hash("profileDigest")?;
    let binding_digest = hash("bindingDigest")?;

    // Consistency (data only).
    root_identity::verify(&root)?;
    if principal.platform != root_identity::PLATFORM {
        return Err(err("BINDING_PRINCIPAL_PLATFORM"));
    }
    if compute_binding_digest(v)? != binding_digest {
        return Err(err("BINDING_DIGEST_MISMATCH"));
    }

    Ok(Binding {
        project_id,
        run_id,
        package_ordinal,
        product_version,
        root,
        principal,
        review_record_id,
        apply_record_id,
        review_record_digest,
        package_digest,
        change_set_digest,
        automation_plan_digest,
        repository_context_digest,
        projection_digest,
        applied_record_sha256,
        targets,
        framework,
        timeout_ms,
        fingerprint_digest,
        profile_digest,
        binding_digest,
    })
}

/// The CREATE request agrees with the binding (OD-06 §4.2 subject and launch
/// fields; §4.3 item 3 "compares bindingDigest"): the request carries the
/// binding's digest, and every request field that the binding also holds is
/// equal. The request root must also be `root-identity-v1` consistent.
pub fn check_request_agreement(binding: &Binding, request: &CreateRequest) -> Result<()> {
    let s = &request.subject;
    if s.binding_digest != binding.binding_digest {
        return Err(err("BINDING_REQUEST_DIGEST_MISMATCH"));
    }
    root_identity::verify(&request.root)?;
    if request.root != binding.root {
        return Err(err("BINDING_REQUEST_ROOT_MISMATCH"));
    }
    if s.run_id != binding.run_id
        || s.package_ordinal != binding.package_ordinal
        || s.apply_record_id != binding.apply_record_id
        || s.package_digest != binding.package_digest
        || s.applied_record_sha256 != binding.applied_record_sha256
        || s.product_version != binding.product_version
    {
        return Err(err("BINDING_REQUEST_SUBJECT_MISMATCH"));
    }
    if request.framework != binding.framework {
        return Err(err("BINDING_REQUEST_FRAMEWORK_MISMATCH"));
    }
    if request.targets != binding.targets {
        return Err(err("BINDING_REQUEST_TARGETS_MISMATCH"));
    }
    if request.timeout_ms != binding.timeout_ms {
        return Err(err("BINDING_REQUEST_TIMEOUT_MISMATCH"));
    }
    Ok(())
}

/// The binding's `profileDigest` is the §5.4 record's (OD-06 §11.1 "the
/// client takes profileDigest from the §5.4 record").
pub fn check_record_agreement(binding: &Binding, record: &CompatibilityRecord) -> Result<()> {
    if binding.profile_digest != record.profile_digest {
        return Err(err("BINDING_PROFILE_DIGEST_MISMATCH"));
    }
    Ok(())
}

/// The binding names an enrolled root and agrees with it: the root record is
/// exactly an enrolled `roots[].root` (OD-06 §4.3 item 2), and the enrolled
/// `projectId`, `framework` (§4.2) and `fingerprint.digest` (amendment A2.2)
/// equal the binding's. Returns the matching enrolled root.
pub fn check_enrollment_agreement<'e>(binding: &Binding, enrollment: &'e Enrollment) -> Result<&'e EnrolledRoot> {
    let enrolled =
        enrollment.roots.iter().find(|r| r.root == binding.root).ok_or(err("BINDING_ROOT_NOT_ENROLLED"))?;
    if enrolled.project_id != binding.project_id {
        return Err(err("BINDING_ENROLLED_PROJECT_MISMATCH"));
    }
    if enrolled.framework != binding.framework {
        return Err(err("BINDING_ENROLLED_FRAMEWORK_MISMATCH"));
    }
    if enrolled.fingerprint_digest != binding.fingerprint_digest {
        return Err(err("BINDING_FINGERPRINT_DIGEST_MISMATCH"));
    }
    Ok(enrolled)
}
