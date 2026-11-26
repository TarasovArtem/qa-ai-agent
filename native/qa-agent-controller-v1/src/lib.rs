//! QA Agent controller broker v1 — portable data components (R1 Stage 5 WP3-A).
//!
//! Pure, deterministic data processing for the OD-06 execution contract and
//! its R1 amendment:
//! - [`json`]: strict JSON intake (OD-06 §4.2);
//! - [`canonical`] and [`digest`]: CRS-1 canonical encoding and `H` domain
//!   digests (OD-06 §11.1);
//! - [`wire`]: sans-IO length-prefixed framing (OD-06 §4.2, §7.2, §9.2);
//! - [`request`], [`frame`], [`proposal`]: closed request, broker frame and
//!   result-proposal models (OD-06 §4.2, §7, §9, §11);
//! - [`fingerprint`]: the `od06-files-v1` digest (OD-06 §8.2, amendment A2);
//! - [`grammar`]: whole-string grammars, including PPI-1.
//!
//! This crate has no binary and no execution capability. It performs no
//! process, filesystem, systemd, D-Bus, privilege, credential or network
//! operation and uses no OS-specific API, so it builds and tests on any host.
//! Everything that needs the qualified Linux VM is out of scope here (WP3-B
//! and later); see `WP3A-EVIDENCE.md`.

#![forbid(unsafe_code)]
#![deny(missing_docs, rust_2018_idioms)]

pub mod canonical;
mod closed;
pub mod digest;
pub mod error;
pub mod fingerprint;
pub mod frame;
pub mod grammar;
pub mod json;
pub mod proposal;
pub mod request;
pub mod wire;

/// OD-06 §4.1/§5.4 contract literal compiled into the broker.
pub const CONTRACT_VERSION: &str = "qa-agent-controller-v1";
