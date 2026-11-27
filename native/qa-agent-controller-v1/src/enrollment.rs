//! Closed enrollment document (OD-06 §5.2) and its qualification.
//!
//! - B1-03: the enrollment model and closed schema, including the data-only
//!   parts of the §5.5 root rules (M2, the M1/M4 device consequence, overlap
//!   rules 1–2 and the enrolled part of rule 3).
//! - B1-04: the qualification model and closed schema, plus the R1 profile
//!   check of amendment A1.
//! - B1-05: `profileDigest` = `H("qa-ai-agent:execution-profile:v1:", E(qualification))`.
//!
//! Data only. Nothing here opens `/etc/qa-agent-controller-v1/enrollment.json`.
//! Owner, mode and ancestor checks, live dev/ino and mount checks (§5.5 M1,
//! M3, live M4, ancestor identities of rule 3), the comparison of the
//! qualification with live host builds, "system directory" and per-account
//! home directory checks for the workspace (PO decision: literal rules only),
//! equality of `outputDir` with the target's configured value, and the
//! Cypress fingerprint file set (not defined for R1) are not done here.

use crate::closed::Closed;
use crate::digest::{domains, h_value, is_h};
use crate::error::{Error, ErrorKind, Result};
use crate::fingerprint::{self, FileEntry, TreeProfile};
use crate::grammar;
use crate::json::{self, Limits, Value};
use crate::request::{parse_root, Root};

const K: ErrorKind = ErrorKind::Enrollment;

const fn err(code: &'static str) -> Error {
    Error::new(K, code)
}

/// OD-06 §5.2: enrollment strict JSON of at most 1048576 bytes. The nesting
/// bound reuses the §4.2 strict-JSON depth (12); a valid enrollment nests 6.
pub const ENROLLMENT_LIMITS: Limits = Limits { max_bytes: 1_048_576, max_depth: 12 };

/// Fixed controller artifact locations (OD-06 §5.2 table; amendment A8 broker
/// path). The workspace anchor may not be one of them or an ancestor of one.
pub const CONTROLLER_ARTIFACT_PATHS: [&str; 5] = [
    "/usr/local/libexec/qa-agent-controller-v1",
    "/etc/qa-agent-controller-v1",
    "/usr/local/share/qa-agent-controller-v1",
    "/var/lib/qa-agent-controller-v1",
    "/var/lib/qa-agent-workload-v1",
];

/// Paths that amendment A7.2 hides or replaces; amendment A7.3 forbids a
/// workspace anchor (and therefore any root) at or beneath them.
pub const A7_HIDDEN_PREFIXES: [&str; 7] = ["/home", "/root", "/run/user", "/tmp", "/var/tmp", "/dev/shm", "/dev/mqueue"];

/// Enrollment limits (OD-06 §5.2).
pub mod limits {
    /// `roots`.
    pub const MAX_ROOTS: usize = 64;
    /// `roots[].sutNames`.
    pub const MAX_SUT_NAMES: usize = 32;
    /// `qualification.frameworkProfiles`.
    pub const MAX_FRAMEWORK_PROFILES: usize = 2;
    /// Caller uid/gid range.
    pub const ID_RANGE: (i64, i64) = (1, 4_294_967_294);
    /// Qualification build strings ("builds<=256 ASCII/no controls").
    pub const MAX_BUILD_BYTES: usize = 256;
    /// Framework profile version strings ("versions<=256"; UTF-8 bytes, no
    /// character-set restriction).
    pub const MAX_VERSION_BYTES: usize = 256;
    /// `workloadStorage.maxBytes` range.
    pub const MAX_BYTES_RANGE: (i64, i64) = (1_073_741_824, 1_099_511_627_776);
    /// `workloadStorage.minFreeBytes` lower bound (upper bound: `maxBytes`).
    pub const MIN_FREE_BYTES_FLOOR: i64 = 67_108_864;
}

/// `caller`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    /// `uid`
    pub uid: u32,
    /// `gid`
    pub gid: u32,
    /// `account`
    pub account: String,
}

/// `workspace`: the single operator anchor W.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Workspace {
    /// Canonical absolute path.
    pub path: String,
    /// Device, decimal string.
    pub dev: String,
    /// Inode, decimal string.
    pub ino: String,
}

/// One `roots[]` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrolledRoot {
    /// `root`, the same record as the CREATE request root.
    pub root: Root,
    /// `projectId`
    pub project_id: String,
    /// `outputDir`
    pub output_dir: String,
    /// `framework`
    pub framework: String,
    /// `sutNames`
    pub sut_names: Vec<String>,
    /// `fingerprint.digest`, verified against `fingerprint.files`.
    pub fingerprint_digest: String,
    /// `fingerprint.files`
    pub fingerprint_files: Vec<FileEntry>,
}

/// One `qualification.frameworkProfiles[]` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameworkProfile {
    /// `framework`
    pub framework: String,
    /// `packageVersion`
    pub package_version: String,
    /// `packageSha256`
    pub package_sha256: String,
    /// `nativePath`
    pub native_path: String,
    /// `nativeVersion`
    pub native_version: String,
    /// `nativeSha256`
    pub native_sha256: String,
    /// `browserPath`
    pub browser_path: String,
    /// `browserVersion`
    pub browser_version: String,
    /// `browserSha256`
    pub browser_sha256: String,
    /// `adapterVersion`
    pub adapter_version: String,
}

/// `workloadStorage.fsType` (OD-06 §5.2: ext4, xfs or f2fs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FsType {
    /// ext4
    Ext4,
    /// XFS
    Xfs,
    /// F2FS
    F2fs,
}

/// `qualification.workloadStorage`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkloadStorage {
    /// `fsType`
    pub fs_type: FsType,
    /// `maxBytes`
    pub max_bytes: u64,
    /// `minFreeBytes`
    pub min_free_bytes: u64,
}

/// `qualification` (`profileVersion` is fixed to "od06-linux-v1").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Qualification {
    /// `osBuild`
    pub os_build: String,
    /// `kernelBuild`
    pub kernel_build: String,
    /// The init manager build field (OD-06 §5.2 key for the systemd build).
    pub systemd_build: String,
    /// The privilege-helper build field (OD-06 §5.2 key for the sudo build).
    pub sudo_build: String,
    /// `nodePath`
    pub node_path: String,
    /// `nodeVersion`
    pub node_version: String,
    /// `nodeSha256`
    pub node_sha256: String,
    /// `brokerBuild`
    pub broker_build: String,
    /// `frameworkProfiles`
    pub framework_profiles: Vec<FrameworkProfile>,
    /// `workloadStorage`
    pub workload_storage: WorkloadStorage,
    /// `profileDigest` of this qualification (B1-05).
    pub profile_digest: String,
}

/// A validated enrollment document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Enrollment {
    /// `enabled`
    pub enabled: bool,
    /// `compatibilityDigest` (`H` of the §5.4 record).
    pub compatibility_digest: String,
    /// `caller`
    pub caller: Caller,
    /// `workspace`
    pub workspace: Workspace,
    /// `roots`
    pub roots: Vec<EnrolledRoot>,
    /// `qualification`
    pub qualification: Qualification,
}

const ENROLLMENT_KEYS: [&str; 7] =
    ["schemaVersion", "enabled", "compatibilityDigest", "caller", "workspace", "roots", "qualification"];
const ROOT_KEYS: [&str; 6] = ["root", "projectId", "outputDir", "framework", "sutNames", "fingerprint"];
const QUALIFICATION_KEYS: [&str; 11] = [
    "profileVersion", "osBuild", "kernelBuild", "systemdBuild", "sudoBuild", "nodePath", "nodeVersion", "nodeSha256",
    "brokerBuild", "frameworkProfiles", "workloadStorage",
];
const PROFILE_KEYS: [&str; 10] = [
    "framework", "packageVersion", "packageSha256", "nativePath", "nativeVersion", "nativeSha256", "browserPath",
    "browserVersion", "browserSha256", "adapterVersion",
];
const ADAPTERS: [(&str, &str); 2] = [("cypress", "od06-cypress-v1"), ("playwright", "od06-playwright-v1")];

/// Strictly parses and validates an enrollment document.
pub fn parse_enrollment(bytes: &[u8]) -> Result<Enrollment> {
    let v = json::parse_strict(bytes, ENROLLMENT_LIMITS)?;
    validate_enrollment(&v)
}

/// Validates a parsed enrollment document (B1-03).
pub fn validate_enrollment(v: &Value) -> Result<Enrollment> {
    let o = Closed::new(v, &ENROLLMENT_KEYS, K)?;
    o.int("schemaVersion", 1, 1)?;
    let enabled = o.boolean("enabled")?;
    let compatibility_digest = o.grammar("compatibilityDigest", is_h)?.to_owned();
    let caller = parse_caller(o.raw("caller"))?;
    let workspace = parse_workspace(o.raw("workspace"))?;
    let roots = parse_roots(o.array("roots")?, &workspace)?;
    let qualification = validate_qualification(o.raw("qualification"))?;
    Ok(Enrollment { enabled, compatibility_digest, caller, workspace, roots, qualification })
}

fn parse_caller(v: &Value) -> Result<Caller> {
    let c = Closed::new(v, &["uid", "gid", "account"], K)?;
    let (lo, hi) = limits::ID_RANGE;
    Ok(Caller {
        uid: c.int("uid", lo, hi)? as u32,
        gid: c.int("gid", lo, hi)? as u32,
        account: c.grammar("account", grammar::is_account)?.to_owned(),
    })
}

fn parse_workspace(v: &Value) -> Result<Workspace> {
    let w = Closed::new(v, &["path", "dev", "ino"], K)?;
    let path = w.grammar("path", grammar::is_canonical_absolute_path)?;
    // OD-06 §5.2 literal rules: never "/" and never an ancestor of (or equal
    // to) a controller artifact location; amendment A7.3 placement.
    if path == "/" {
        return Err(err("ENROLLMENT_WORKSPACE_ROOT"));
    }
    if A7_HIDDEN_PREFIXES.iter().any(|h| grammar::is_at_or_beneath(path, h)) {
        return Err(err("ENROLLMENT_WORKSPACE_HIDDEN"));
    }
    if CONTROLLER_ARTIFACT_PATHS.iter().any(|a| grammar::is_at_or_beneath(a, path)) {
        return Err(err("ENROLLMENT_WORKSPACE_ARTIFACT_ANCESTOR"));
    }
    Ok(Workspace {
        path: path.to_owned(),
        dev: w.grammar("dev", grammar::is_decimal_id)?.to_owned(),
        ino: w.grammar("ino", grammar::is_decimal_id)?.to_owned(),
    })
}

fn parse_sut_names(items: &[Value]) -> Result<Vec<String>> {
    if items.len() > limits::MAX_SUT_NAMES {
        return Err(err("ENROLLMENT_SUT_COUNT"));
    }
    let mut names: Vec<String> = Vec::with_capacity(items.len());
    for item in items {
        let name = match item {
            Value::Str(s) => s,
            _ => return Err(err("SCHEMA_TYPE")),
        };
        if !grammar::is_sut_name(name) {
            return Err(err("SCHEMA_GRAMMAR"));
        }
        if names.iter().any(|n| n == name) {
            return Err(err("ENROLLMENT_SUT_DUPLICATE"));
        }
        names.push(name.clone());
    }
    Ok(names)
}

fn parse_roots(items: &[Value], w: &Workspace) -> Result<Vec<EnrolledRoot>> {
    if items.len() > limits::MAX_ROOTS {
        return Err(err("ENROLLMENT_ROOT_COUNT"));
    }
    let mut roots: Vec<EnrolledRoot> = Vec::with_capacity(items.len());
    for item in items {
        let r = Closed::new(item, &ROOT_KEYS, K)?;
        let root = parse_root(r.raw("root"), K)?;
        let project_id = r.grammar("projectId", grammar::is_project_id)?.to_owned();
        let output_dir = r.grammar("outputDir", grammar::is_enrolled_output_dir)?.to_owned();
        let framework = r.grammar("framework", |f| grammar::FRAMEWORKS.contains(&f))?.to_owned();
        let sut_names = parse_sut_names(r.array("sutNames")?)?;
        let profile = if framework == "playwright" { TreeProfile::PlaywrightRoot } else { TreeProfile::CypressRoot };
        let fp = r.raw("fingerprint");
        let fingerprint_files = fingerprint::verify_enrolled(profile, fp)?;
        let fingerprint_digest = match fp.get("digest") {
            Some(Value::Str(d)) => d.clone(),
            _ => return Err(err("SCHEMA_TYPE")),
        };
        // §5.5 M2: R = W + "/" + one or more segments, R != W.
        if root.path == w.path || !grammar::is_at_or_beneath(&root.path, &w.path) {
            return Err(err("ENROLLMENT_ROOT_OUTSIDE_WORKSPACE"));
        }
        // §5.5 M1 + M4: live W dev/ino equal enrolled W, live R dev/ino equal
        // enrolled R, and live R dev equals live W dev; so the enrolled devices
        // must be equal for any enrollment that can pass.
        if root.dev != w.dev {
            return Err(err("ENROLLMENT_ROOT_DEVICE"));
        }
        // §5.5 overlap rule 3 with W, an ancestor of every root: a root that
        // carries W's own identity aliases the anchor.
        if root.dev == w.dev && root.ino == w.ino {
            return Err(err("ENROLLMENT_ROOT_OVERLAP"));
        }
        roots.push(EnrolledRoot { root, project_id, output_dir, framework, sut_names, fingerprint_digest, fingerprint_files });
    }
    // §5.5 overlap rules 1 and 2 on canonical path bytes, and the enrolled
    // part of rule 3 (equal dev/ino). Live ancestor identities are runtime.
    for (i, a) in roots.iter().enumerate() {
        for b in &roots[i + 1..] {
            let (pa, pb) = (&a.root.path, &b.root.path);
            if grammar::is_at_or_beneath(pa, pb)
                || grammar::is_at_or_beneath(pb, pa)
                || (a.root.dev == b.root.dev && a.root.ino == b.root.ino)
            {
                return Err(err("ENROLLMENT_ROOT_OVERLAP"));
            }
        }
    }
    Ok(roots)
}

/// Build strings: "builds<=256 ASCII/no controls" (OD-06 §5.2).
fn printable(s: &str) -> bool {
    grammar::is_printable_ascii_max(s, limits::MAX_BUILD_BYTES)
}

/// Framework profile versions: "versions<=256" (OD-06 §5.2) only. The
/// build-specific ASCII/no-controls rule does not apply (ARCH-B1-02).
fn version_within_limit(s: &str) -> bool {
    s.len() <= limits::MAX_VERSION_BYTES
}

fn parse_profile(v: &Value) -> Result<FrameworkProfile> {
    let p = Closed::new(v, &PROFILE_KEYS, K)?;
    let framework = p.grammar("framework", |f| grammar::FRAMEWORKS.contains(&f))?.to_owned();
    let adapter_version = p.grammar("adapterVersion", |a| ADAPTERS.iter().any(|(_, x)| *x == a))?.to_owned();
    if !ADAPTERS.iter().any(|(f, a)| *f == framework && *a == adapter_version) {
        return Err(err("ENROLLMENT_ADAPTER_MISMATCH"));
    }
    let path = |k: &str| p.grammar(k, grammar::is_canonical_absolute_path).map(str::to_owned);
    let version = |k: &str| p.grammar(k, version_within_limit).map(str::to_owned);
    let hash = |k: &str| p.grammar(k, is_h).map(str::to_owned);
    Ok(FrameworkProfile {
        package_version: version("packageVersion")?,
        package_sha256: hash("packageSha256")?,
        native_path: path("nativePath")?,
        native_version: version("nativeVersion")?,
        native_sha256: hash("nativeSha256")?,
        browser_path: path("browserPath")?,
        browser_version: version("browserVersion")?,
        browser_sha256: hash("browserSha256")?,
        framework,
        adapter_version,
    })
}

fn parse_workload_storage(v: &Value) -> Result<WorkloadStorage> {
    let s = Closed::new(v, &["fsType", "maxBytes", "minFreeBytes"], K)?;
    let fs_type = match s.str("fsType")? {
        "ext4" => FsType::Ext4,
        "xfs" => FsType::Xfs,
        "f2fs" => FsType::F2fs,
        _ => return Err(err("SCHEMA_GRAMMAR")),
    };
    let (lo, hi) = limits::MAX_BYTES_RANGE;
    let max_bytes = s.int("maxBytes", lo, hi)?;
    let min_free_bytes = s.int("minFreeBytes", limits::MIN_FREE_BYTES_FLOOR, max_bytes)?;
    Ok(WorkloadStorage { fs_type, max_bytes: max_bytes as u64, min_free_bytes: min_free_bytes as u64 })
}

/// Validates a qualification (B1-04) and computes its `profileDigest` (B1-05)
/// over the canonical encoding of the qualification object.
pub fn validate_qualification(v: &Value) -> Result<Qualification> {
    let q = Closed::new(v, &QUALIFICATION_KEYS, K)?;
    q.literal("profileVersion", "od06-linux-v1")?;
    let build = |k: &str| q.grammar(k, printable).map(str::to_owned);
    let raw_profiles = q.array("frameworkProfiles")?;
    if raw_profiles.len() > limits::MAX_FRAMEWORK_PROFILES {
        return Err(err("ENROLLMENT_PROFILE_COUNT"));
    }
    let mut framework_profiles: Vec<FrameworkProfile> = Vec::with_capacity(raw_profiles.len());
    for p in raw_profiles {
        let profile = parse_profile(p)?;
        if framework_profiles.iter().any(|x| x.framework == profile.framework) {
            return Err(err("ENROLLMENT_PROFILE_DUPLICATE"));
        }
        framework_profiles.push(profile);
    }
    Ok(Qualification {
        os_build: build("osBuild")?,
        kernel_build: build("kernelBuild")?,
        systemd_build: build("systemdBuild")?,
        sudo_build: build("sudoBuild")?,
        node_path: q.grammar("nodePath", grammar::is_canonical_absolute_path)?.to_owned(),
        node_version: q.grammar("nodeVersion", grammar::is_node22_version)?.to_owned(),
        node_sha256: q.grammar("nodeSha256", is_h)?.to_owned(),
        broker_build: build("brokerBuild")?,
        framework_profiles,
        workload_storage: parse_workload_storage(q.raw("workloadStorage"))?,
        profile_digest: h_value(domains::PROFILE, v)?,
    })
}

/// Amendment A1 (§5.4 overlay): an R1 qualification has exactly one
/// `frameworkProfiles` entry, `framework:"playwright"` with
/// `adapterVersion:"od06-playwright-v1"`.
pub fn check_r1_profile(q: &Qualification) -> Result<()> {
    match q.framework_profiles.as_slice() {
        [p] if p.framework == "playwright" && p.adapter_version == "od06-playwright-v1" => Ok(()),
        _ => Err(err("R1_PROFILE")),
    }
}
