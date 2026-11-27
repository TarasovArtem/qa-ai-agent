//! Stage 4 `root-identity-v1` (approval/apply contract §17.2), as required by
//! OD-06 §4.2 ("digest=H matching Stage 4 root-identity-v1"). WP3-B slice B2.
//!
//! Data-only: the digest is computed from the `{platform, path, dev, ino}`
//! values of a root record. Resolving the path and reading `dev`/`ino` from the
//! live filesystem (Stage 4 §17.2 steps 1–2) is runtime work and is NOT done
//! here. A matching digest proves only that the record is internally
//! consistent; it grants no execution authority.
//!
//! This check is standalone (PO decision for OD-R1-STAGE5-WP3-B-NEXT-2). The
//! existing request and enrollment validators keep their format-only check of
//! `root.digest`.

use crate::digest::{domains, h_value};
use crate::error::{Error, ErrorKind, Result};
use crate::json::Value;
use crate::request::Root;

/// `identityVersion` of Stage 4 `root-identity-v1`.
pub const IDENTITY_VERSION: i64 = 1;

/// The only platform a §4.2 root record carries.
pub const PLATFORM: &str = "linux";

/// The Stage 4 `rootIdentity` object `{identityVersion:1, platform, rootPath,
/// dev, ino}` for a §4.2 root record. On POSIX the Stage 4 `rootPath` is the
/// resolved native path used as returned (§17.2 step 1.3), which is the
/// record's canonical absolute `path`.
pub fn identity_value(root: &Root) -> Value {
    Value::object(vec![
        ("identityVersion", Value::Int(IDENTITY_VERSION)),
        ("platform", Value::str(PLATFORM)),
        ("rootPath", Value::Str(root.path.clone())),
        ("dev", Value::Str(root.dev.clone())),
        ("ino", Value::Str(root.ino.clone())),
    ])
}

/// `repositoryRoot.digest` = `H("qa-ai-agent:repository-root-binding:v1:",
/// E(rootIdentity))` (Stage 4 §17.2 step 3).
pub fn digest(root: &Root) -> Result<String> {
    h_value(domains::REPOSITORY_ROOT_BINDING, &identity_value(root))
}

/// Refuses a root record whose `digest` is not the Stage 4 `root-identity-v1`
/// digest of its own `platform`, `path`, `dev` and `ino`.
pub fn verify(root: &Root) -> Result<()> {
    if digest(root)? != root.digest {
        return Err(Error::new(ErrorKind::RootIdentity, "ROOT_IDENTITY_MISMATCH"));
    }
    Ok(())
}
