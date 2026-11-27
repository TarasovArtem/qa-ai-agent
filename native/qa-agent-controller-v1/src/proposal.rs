//! Client result proposal (OD-06 §11.2) with the normalized result (§9.3)
//! and report list (§9.4).
//!
//! `parse_proposal` checks the closed structure. `check_proposal` checks it
//! against already-bound facts supplied by the caller (identities,
//! framework, targets, resultExpected). Comparing `reports[]` with the
//! broker's own descriptor-anchored enumeration of reportsDir, report content
//! parsing and the §9.3 decision precedence are integration concerns
//! (WP3-B/WP4) and are not performed here.

use crate::closed::{strictly_ascending, Closed};
use crate::digest::is_h;
use crate::error::{Error, ErrorKind, Result};
use crate::grammar;
use crate::json::{self, Value};

const K: ErrorKind = ErrorKind::Proposal;

const fn err(code: &'static str) -> Error {
    Error::new(K, code)
}

/// Report limits (§9.4).
pub mod limits {
    /// Reports per attempt.
    pub const MAX_REPORTS: usize = 100;
    /// Bytes per report, inclusive range.
    pub const REPORT_BYTES: (i64, i64) = (1, 4_194_304);
    /// Aggregate report bytes.
    pub const MAX_AGGREGATE_BYTES: u64 = 16_777_216;
    /// Per-count bound in the normalized result (§9.3).
    pub const MAX_COUNT: i64 = 10_000;
}

/// One `reports[]` entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Report {
    /// File name.
    pub name: String,
    /// Size in bytes.
    pub bytes: u64,
    /// `H` of the content.
    pub sha256: String,
}

/// Per-spec counts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpecResult {
    /// Canonical root-relative spec path.
    pub path: String,
    /// total
    pub total: u32,
    /// passed
    pub passed: u32,
    /// failed
    pub failed: u32,
    /// skipped
    pub skipped: u32,
}

/// Totals.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Totals {
    /// total
    pub total: u32,
    /// passed
    pub passed: u32,
    /// failed
    pub failed: u32,
    /// skipped
    pub skipped: u32,
}

/// Normalized result, exactly {adapterVersion,specs,totals,complete}.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedResult {
    /// `od06-playwright-v1` or `od06-cypress-v1`.
    pub adapter_version: String,
    /// Specs sorted by path.
    pub specs: Vec<SpecResult>,
    /// Totals.
    pub totals: Totals,
}

/// A structurally valid proposal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResultProposal {
    /// `executionId`
    pub execution_id: String,
    /// `invocationId`
    pub invocation_id: String,
    /// `bindingDigest`
    pub binding_digest: String,
    /// `attemptDigest`
    pub attempt_digest: String,
    /// `reports`, sorted by name
    pub reports: Vec<Report>,
    /// `result`
    pub result: Option<NormalizedResult>,
}

const ADAPTERS: [(&str, &str); 2] = [("cypress", "od06-cypress-v1"), ("playwright", "od06-playwright-v1")];

fn counts(o: &Closed<'_>) -> Result<(u32, u32, u32, u32)> {
    let c = |k: &str| o.int(k, 0, limits::MAX_COUNT).map(|n| n as u32);
    let (total, passed, failed, skipped) = (c("total")?, c("passed")?, c("failed")?, c("skipped")?);
    // "sums consistent" (§9.3) read as total = passed + failed + skipped.
    if passed + failed + skipped != total {
        return Err(err("PROPOSAL_COUNTS_INCONSISTENT"));
    }
    Ok((total, passed, failed, skipped))
}

fn parse_result(v: &Value) -> Result<NormalizedResult> {
    let o = Closed::new(v, &["adapterVersion", "specs", "totals", "complete"], K)?;
    let adapter_version = o.grammar("adapterVersion", |a| ADAPTERS.iter().any(|(_, x)| *x == a))?.to_owned();
    if !o.boolean("complete")? {
        return Err(err("PROPOSAL_INCOMPLETE"));
    }
    let raw_specs = o.array("specs")?;
    if raw_specs.is_empty() || raw_specs.len() > crate::request::limits::MAX_TARGETS {
        return Err(err("PROPOSAL_SPEC_COUNT"));
    }
    let mut specs = Vec::with_capacity(raw_specs.len());
    for s in raw_specs {
        let s = Closed::new(s, &["path", "total", "passed", "failed", "skipped"], K)?;
        let path = s.str("path")?.to_owned();
        let (total, passed, failed, skipped) = counts(&s)?;
        specs.push(SpecResult { path, total, passed, failed, skipped });
    }
    if !strictly_ascending(specs.iter().map(|s| s.path.as_str())) {
        return Err(err("PROPOSAL_SPEC_ORDER"));
    }
    let t = Closed::new(o.raw("totals"), &["total", "passed", "failed", "skipped"], K)?;
    let (total, passed, failed, skipped) = counts(&t)?;
    let totals = Totals { total, passed, failed, skipped };
    let sum = specs.iter().fold(Totals { total: 0, passed: 0, failed: 0, skipped: 0 }, |a, s| Totals {
        total: a.total + s.total,
        passed: a.passed + s.passed,
        failed: a.failed + s.failed,
        skipped: a.skipped + s.skipped,
    });
    if sum != totals {
        return Err(err("PROPOSAL_TOTALS_INCONSISTENT"));
    }
    Ok(NormalizedResult { adapter_version, specs, totals })
}

/// Maximum proposal frame size (§11.2).
pub const MAX_PROPOSAL_BYTES: usize = 262_144;

/// Strictly parses one proposal payload and checks its closed structure.
pub fn parse_proposal(payload: &[u8]) -> Result<ResultProposal> {
    let v = json::parse_strict(payload, json::FRAME_LIMITS)?;
    let o = Closed::new(
        &v,
        &["schemaVersion", "executionId", "invocationId", "bindingDigest", "attemptDigest", "reports", "result"],
        K,
    )?;
    o.int("schemaVersion", 1, 1)?;
    let raw_reports = o.array("reports")?;
    if raw_reports.len() > limits::MAX_REPORTS {
        return Err(err("PROPOSAL_REPORT_COUNT"));
    }
    let mut reports = Vec::with_capacity(raw_reports.len());
    let mut aggregate: u64 = 0;
    for r in raw_reports {
        let r = Closed::new(r, &["name", "bytes", "sha256"], K)?;
        let (lo, hi) = limits::REPORT_BYTES;
        let bytes = r.int("bytes", lo, hi)? as u64;
        aggregate += bytes;
        reports.push(Report {
            name: r.str("name")?.to_owned(),
            bytes,
            sha256: r.grammar("sha256", is_h)?.to_owned(),
        });
    }
    if aggregate > limits::MAX_AGGREGATE_BYTES {
        return Err(err("PROPOSAL_REPORT_AGGREGATE"));
    }
    if !strictly_ascending(reports.iter().map(|r| r.name.as_str())) {
        return Err(err("PROPOSAL_REPORT_ORDER"));
    }
    let result = match o.raw("result") {
        Value::Null => None,
        other => Some(parse_result(other)?),
    };
    Ok(ResultProposal {
        execution_id: o.grammar("executionId", grammar::is_id32)?.to_owned(),
        invocation_id: o.grammar("invocationId", grammar::is_id32)?.to_owned(),
        binding_digest: o.grammar("bindingDigest", is_h)?.to_owned(),
        attempt_digest: o.grammar("attemptDigest", is_h)?.to_owned(),
        reports,
        result,
    })
}

/// Facts already bound before the proposal arrives.
#[derive(Debug, Clone, Copy)]
pub struct ProposalContext<'a> {
    /// Request executionId.
    pub execution_id: &'a str,
    /// BOUND invocationId.
    pub invocation_id: &'a str,
    /// Request/broker bindingDigest.
    pub binding_digest: &'a str,
    /// EXITED frame attemptDigest.
    pub attempt_digest: &'a str,
    /// Request framework.
    pub framework: &'a str,
    /// Validated, sorted request target paths.
    pub targets: &'a [&'a str],
    /// EXITED observation resultExpected.
    pub result_expected: bool,
}

fn is_report_name(framework: &str, name: &str) -> bool {
    match framework {
        "playwright" => name == "playwright.xml",
        "cypress" => {
            let b = name.as_bytes();
            b.len() == "cypress-".len() + 32 + ".xml".len()
                && name.starts_with("cypress-")
                && name.ends_with(".xml")
                && b[8..40].iter().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
        }
        _ => false,
    }
}

/// Checks a parsed proposal against bound facts (identities §7.2, resultExpected
/// §7.2, report grammar/count §9.4, adapter and exact target paths §9.3).
pub fn check_proposal(p: &ResultProposal, ctx: &ProposalContext<'_>) -> Result<()> {
    if p.execution_id != ctx.execution_id
        || p.invocation_id != ctx.invocation_id
        || p.binding_digest != ctx.binding_digest
        || p.attempt_digest != ctx.attempt_digest
    {
        return Err(err("PROPOSAL_IDENTITY_MISMATCH"));
    }
    if !ctx.result_expected {
        if p.result.is_some() || !p.reports.is_empty() {
            return Err(err("PROPOSAL_NOT_EXPECTED"));
        }
        return Ok(());
    }
    if !p.reports.iter().all(|r| is_report_name(ctx.framework, &r.name)) {
        return Err(err("PROPOSAL_REPORT_NAME"));
    }
    if let Some(result) = &p.result {
        let expected_count = if ctx.framework == "playwright" { 1 } else { ctx.targets.len() };
        if p.reports.len() != expected_count {
            return Err(err("PROPOSAL_REPORT_COUNT"));
        }
        let adapter_ok = ADAPTERS.iter().any(|(f, a)| *f == ctx.framework && *a == result.adapter_version);
        if !adapter_ok {
            return Err(err("PROPOSAL_ADAPTER"));
        }
        let paths: Vec<&str> = result.specs.iter().map(|s| s.path.as_str()).collect();
        if paths.as_slice() != ctx.targets {
            return Err(err("PROPOSAL_SPEC_PATHS"));
        }
    }
    Ok(())
}
