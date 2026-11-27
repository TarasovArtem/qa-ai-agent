//! `od06-files-v1` fingerprint (OD-06 §8.2, amendment A2.1-A2.3).
//!
//! Portable part only: path-membership and grammar rules, limits, entry
//! construction from in-memory bytes, canonical ordering, and the domain
//! digest. The live walk (descriptor-anchored, no-follow, no mount crossing,
//! refusal of symlinks/FIFOs/sockets/devices/hard links and mount roots) needs
//! Linux kernel facilities on the qualified host and is NOT implemented here.

use crate::closed::{strictly_ascending, Closed};
use crate::digest::{domains, h_bytes, h_value, is_h};
use crate::error::{Error, ErrorKind, Result};
use crate::grammar::is_ppi1_segment;
use crate::json::Value;

const K: ErrorKind = ErrorKind::Fingerprint;

const fn err(code: &'static str) -> Error {
    Error::new(K, code)
}

/// `fingerprint.algorithm`.
pub const ALGORITHM: &str = "od06-files-v1";

/// A2.1 required root files.
pub const ROOT_FILES: [&str; 3] = ["package-lock.json", "package.json", "playwright.config.js"];

/// OD-06 §8.2 required literal members of a Playwright root (byte-sorted):
/// the A2.1 root files (fixed config, root `package.json`,
/// `package-lock.json`), the local framework metadata and the entrypoint
/// named by the §8.2 Playwright adapter. The executable JS/reporter closure,
/// Playwright/core files and static config imports are profile-enumerated
/// and are checked by the broker at runtime, not here.
pub const PLAYWRIGHT_REQUIRED: [&str; 5] = [
    "node_modules/@playwright/test/cli.js",
    "node_modules/@playwright/test/package.json",
    "package-lock.json",
    "package.json",
    "playwright.config.js",
];

/// OD-06 §8.2 required literal members of a Cypress root (byte-sorted): the
/// fixed conventional config `cypress.config.js` (§2.1), root `package.json`,
/// `package-lock.json`, and the local framework metadata and entrypoint named
/// by the §8.2 Cypress adapter. The closure is profile-enumerated (runtime).
pub const CYPRESS_REQUIRED: [&str; 5] = [
    "cypress.config.js",
    "node_modules/cypress/bin/cypress",
    "node_modules/cypress/package.json",
    "package-lock.json",
    "package.json",
];

/// A2.1 walked package trees (literal prefixes; the names reached by the walk
/// below them must satisfy the PPI-1 segment grammar).
pub const PACKAGE_TREES: [&str; 3] =
    ["node_modules/@playwright/test/", "node_modules/playwright/", "node_modules/playwright-core/"];

/// Tree limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TreeLimits {
    /// Maximum number of files.
    pub max_files: usize,
    /// Maximum bytes per file.
    pub max_file_bytes: u64,
    /// Maximum total hashed bytes.
    pub max_total_bytes: u64,
    /// Maximum bytes per root-relative path.
    pub max_path_bytes: usize,
}

/// Which tree is fingerprinted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TreeProfile {
    /// The enrolled root file set F (A2.1), digest domain execution-fingerprint.
    PlaywrightRoot,
    /// The qualified browser directory (A2.3), digest domain execution-browser-tree.
    ///
    /// A2.3 raises only the file-count and total limits; the per-file limit
    /// is kept at the unchanged 16 MiB, fail-closed. Whether a real Chromium
    /// tree fits it is open question OQ-2 (see `WP3A-EVIDENCE.md`).
    BrowserTree,
    /// An enrolled `cypress` root (amendment A1 keeps the literal while R1
    /// defers Cypress). Amendment A2 defines no Cypress file set, so paths
    /// follow the OD-06 §8.2 envelope (root limits, canonical root-relative
    /// paths of at most 300 bytes under the existing safe relative path rule,
    /// byte order, `H`, fingerprint domain), and the §8.2 required literal
    /// members [`CYPRESS_REQUIRED`] must be present.
    CypressRoot,
}

impl TreeProfile {
    /// Limits for this profile.
    pub fn limits(self) -> TreeLimits {
        match self {
            TreeProfile::PlaywrightRoot | TreeProfile::CypressRoot => TreeLimits {
                max_files: 4096,
                max_file_bytes: 16_777_216,
                max_total_bytes: 67_108_864,
                max_path_bytes: 300,
            },
            TreeProfile::BrowserTree => TreeLimits {
                max_files: 16_384,
                max_file_bytes: 16_777_216,
                max_total_bytes: 1_073_741_824,
                max_path_bytes: 300,
            },
        }
    }

    /// Digest domain for this profile.
    pub fn domain(self) -> &'static str {
        match self {
            TreeProfile::PlaywrightRoot | TreeProfile::CypressRoot => domains::FINGERPRINT,
            TreeProfile::BrowserTree => domains::BROWSER_TREE,
        }
    }

    /// Members that must be present (OD-06 §8.2 "Broker checks exact required
    /// membership"). The browser tree has no required member.
    pub fn required_files(self) -> &'static [&'static str] {
        match self {
            TreeProfile::PlaywrightRoot => &PLAYWRIGHT_REQUIRED,
            TreeProfile::CypressRoot => &CYPRESS_REQUIRED,
            TreeProfile::BrowserTree => &[],
        }
    }

    /// Path rule for this profile.
    pub fn path_allowed(self, path: &str) -> bool {
        if path.is_empty() || path.len() > self.limits().max_path_bytes {
            return false;
        }
        match self {
            TreeProfile::PlaywrightRoot => is_playwright_root_member(path),
            TreeProfile::BrowserTree => path.split('/').all(is_ppi1_segment),
            TreeProfile::CypressRoot => crate::grammar::is_safe_relative_path(path),
        }
    }
}

/// A2.1 membership: one of the three root files, or a file strictly below one
/// of the three package trees whose walked segments are all PPI-1 segments.
pub fn is_playwright_root_member(path: &str) -> bool {
    if ROOT_FILES.contains(&path) {
        return true;
    }
    PACKAGE_TREES.iter().any(|prefix| {
        path.strip_prefix(prefix)
            .map(|rest| !rest.is_empty() && rest.split('/').all(is_ppi1_segment))
            .unwrap_or(false)
    })
}

/// One `{path, sha256, size}` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileEntry {
    /// Canonical root-relative path.
    pub path: String,
    /// `H` of the file bytes.
    pub sha256: String,
    /// Size in bytes.
    pub size: u64,
}

impl FileEntry {
    /// Builds an entry from in-memory content.
    pub fn from_bytes(path: &str, content: &[u8]) -> FileEntry {
        FileEntry { path: path.to_owned(), sha256: h_bytes(content), size: content.len() as u64 }
    }

    fn to_value(&self) -> Value {
        Value::object(vec![
            ("path", Value::Str(self.path.clone())),
            ("sha256", Value::Str(self.sha256.clone())),
            ("size", Value::Int(self.size as i64)),
        ])
    }
}

/// Validates a canonical entry list: count, byte-sorted unique paths, path
/// rule, `H` format, per-file and total limits, and (root profiles) the
/// required members of [`TreeProfile::required_files`].
pub fn validate_entries(profile: TreeProfile, entries: &[FileEntry]) -> Result<()> {
    let l = profile.limits();
    if entries.is_empty() || entries.len() > l.max_files {
        return Err(err("FINGERPRINT_FILE_COUNT"));
    }
    if !strictly_ascending(entries.iter().map(|e| e.path.as_str())) {
        return Err(err("FINGERPRINT_ORDER"));
    }
    let mut total: u64 = 0;
    for e in entries {
        if !profile.path_allowed(&e.path) {
            return Err(err("FINGERPRINT_PATH"));
        }
        if !is_h(&e.sha256) {
            return Err(err("FINGERPRINT_SHA256"));
        }
        total = add_within_limits(total, e.size, l)?;
    }
    require_root_files(profile, entries.iter().map(|e| e.path.as_str()))
}

/// Adds one file size to a running total under the per-file and total limits.
/// Checked and fail-fast: the total never exceeds `max_total_bytes`.
fn add_within_limits(total: u64, size: u64, l: TreeLimits) -> Result<u64> {
    if size > l.max_file_bytes {
        return Err(err("FINGERPRINT_FILE_TOO_LARGE"));
    }
    total
        .checked_add(size)
        .filter(|t| *t <= l.max_total_bytes)
        .ok_or(err("FINGERPRINT_TOTAL_TOO_LARGE"))
}

fn require_root_files<'a>(profile: TreeProfile, paths: impl Iterator<Item = &'a str> + Clone) -> Result<()> {
    if !profile.required_files().iter().all(|f| paths.clone().any(|p| p == *f)) {
        return Err(err("FINGERPRINT_REQUIRED_FILE_MISSING"));
    }
    Ok(())
}

/// The canonical `{algorithm, files}` object that is hashed.
pub fn canonical_object(entries: &[FileEntry]) -> Value {
    Value::object(vec![
        ("algorithm", Value::str(ALGORITHM)),
        ("files", Value::Array(entries.iter().map(FileEntry::to_value).collect())),
    ])
}

/// Validates `entries` and returns `H(domain, E({algorithm, files}))`.
pub fn digest(profile: TreeProfile, entries: &[FileEntry]) -> Result<String> {
    validate_entries(profile, entries)?;
    h_value(profile.domain(), &canonical_object(entries))
}

/// Builds entries from in-memory `(path, content)` pairs (synthetic fixtures
/// or bytes already read by a qualified walker), sorts them by path bytes,
/// validates them and returns the entries with their digest.
///
/// Every check that needs only paths and sizes (count, path rule, per-file
/// limit, total hashed bytes, ordering and uniqueness, required members)
/// runs BEFORE any content byte is hashed, so a refused input costs no
/// hashing and at most `max_total_bytes` are ever hashed (OD-06 §8.2, A2.3).
pub fn compute(profile: TreeProfile, files: &[(&str, &[u8])]) -> Result<(Vec<FileEntry>, String)> {
    let l = profile.limits();
    if files.is_empty() || files.len() > l.max_files {
        return Err(err("FINGERPRINT_FILE_COUNT"));
    }
    let mut total: u64 = 0;
    for (path, content) in files {
        let size = u64::try_from(content.len()).map_err(|_| err("FINGERPRINT_FILE_TOO_LARGE"))?;
        total = add_within_limits(total, size, l)?;
        if !profile.path_allowed(path) {
            return Err(err("FINGERPRINT_PATH"));
        }
    }
    let mut sorted: Vec<&(&str, &[u8])> = files.iter().collect();
    sorted.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    if !strictly_ascending(sorted.iter().map(|(p, _)| *p)) {
        return Err(err("FINGERPRINT_ORDER"));
    }
    require_root_files(profile, sorted.iter().map(|(p, _)| *p))?;
    // Admitted: hash now.
    let entries: Vec<FileEntry> = sorted.iter().map(|(p, c)| FileEntry::from_bytes(p, c)).collect();
    let d = digest(profile, &entries)?;
    Ok((entries, d))
}

/// Validates an enrolled `fingerprint` object, exactly
/// `{algorithm:"od06-files-v1", files, digest:H}`, and recomputes its digest.
pub fn verify_enrolled(profile: TreeProfile, v: &Value) -> Result<Vec<FileEntry>> {
    let o = Closed::new(v, &["algorithm", "files", "digest"], K)?;
    o.literal("algorithm", ALGORITHM)?;
    let claimed = o.grammar("digest", is_h)?;
    let files = o.array("files")?;
    // Count limit before materializing any entry.
    if files.is_empty() || files.len() > profile.limits().max_files {
        return Err(err("FINGERPRINT_FILE_COUNT"));
    }
    let mut entries = Vec::with_capacity(files.len());
    for f in files {
        let f = Closed::new(f, &["path", "sha256", "size"], K)?;
        entries.push(FileEntry {
            path: f.str("path")?.to_owned(),
            sha256: f.str("sha256")?.to_owned(),
            size: f.int("size", 0, profile.limits().max_file_bytes as i64)? as u64,
        });
    }
    if digest(profile, &entries)? != claimed {
        return Err(err("FINGERPRINT_DIGEST_MISMATCH"));
    }
    Ok(entries)
}
