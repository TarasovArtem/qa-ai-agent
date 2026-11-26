//! Whole-string grammars from OD-06 §4.2, §5.4, §6.2, §9.1 and OD-04 §13.2
//! (PPI-1). Every predicate validates only; nothing is normalized or repaired.

/// `executionId`/ID: `^[0-9a-f]{32}$`.
pub fn is_id32(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// `runId`: `^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{16}$`.
pub fn is_run_id(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 33
        && b[..8].iter().all(u8::is_ascii_digit)
        && b[8] == b'T'
        && b[9..15].iter().all(u8::is_ascii_digit)
        && b[15] == b'Z'
        && b[16] == b'-'
        && b[17..].iter().all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f'))
}

/// `packageOrdinal`: `^(?!0000)[0-9]{4}$`.
pub fn is_ordinal(s: &str) -> bool {
    s.len() == 4 && s.bytes().all(|b| b.is_ascii_digit()) && s != "0000"
}

/// `dev`/`ino` decimal strings: 1..20 digits, no sign, no leading zero except `"0"`.
pub fn is_decimal_id(s: &str) -> bool {
    let b = s.as_bytes();
    (1..=20).contains(&b.len()) && b.iter().all(u8::is_ascii_digit) && (b.len() == 1 || b[0] != b'0')
}

fn is_control(c: char) -> bool {
    // Unicode Cc: C0, DEL and C1.
    (c as u32) < 0x20 || (0x7F..=0x9F).contains(&(c as u32))
}

/// Canonical absolute root path (OD-06 §4.2): <=4096 UTF-8 bytes, leading `/`,
/// no empty, `.` or `..` segment, no trailing `/`, no control character and
/// no `%` (systemd specifier). No path repair is attempted.
pub fn is_canonical_absolute_path(s: &str) -> bool {
    if s.is_empty() || s.len() > 4096 || !s.starts_with('/') {
        return false;
    }
    if s.chars().any(|c| is_control(c) || c == '%') {
        return false;
    }
    if s == "/" {
        return true;
    }
    s[1..].split('/').all(|seg| !seg.is_empty() && seg != "." && seg != "..")
}

/// Target-owned SUT name (OD-06 §9.1): `^SUT_[A-Z][A-Z0-9_]{0,59}$`.
pub fn is_sut_name(s: &str) -> bool {
    let b = s.as_bytes();
    (5..=64).contains(&b.len())
        && b.starts_with(b"SUT_")
        && b[4].is_ascii_uppercase()
        && b[5..].iter().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || *c == b'_')
}

fn is_numeric_ident(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) && (s.len() == 1 || !s.starts_with('0'))
}

fn is_alnum_hyphen(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// Product version (OD-06 §5.4): an exact SemVer 2.0.0 string, <=64 ASCII,
/// never a range or dist-tag.
pub fn is_exact_semver(s: &str) -> bool {
    if s.is_empty() || s.len() > 64 || !s.is_ascii() {
        return false;
    }
    let (rest, build) = match s.split_once('+') {
        Some((r, b)) => (r, Some(b)),
        None => (s, None),
    };
    let (core, pre) = match rest.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (rest, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3 || !parts.iter().all(|p| is_numeric_ident(p)) {
        return false;
    }
    if let Some(pre) = pre {
        let ok = pre.split('.').all(|id| {
            is_alnum_hyphen(id) && (id.bytes().any(|b| !b.is_ascii_digit()) || is_numeric_ident(id))
        });
        if !ok {
            return false;
        }
    }
    if let Some(build) = build {
        if !build.split('.').all(is_alnum_hyphen) {
            return false;
        }
    }
    true
}

const RESERVED_STEMS: [&str; 24] = [
    "CON", "PRN", "AUX", "NUL", "COM0", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
    "COM8", "COM9", "LPT0", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// PPI-1 segment grammar (OD-04 §13.2 rules 4 and 5): 1..100 bytes,
/// `^[A-Za-z0-9_-][A-Za-z0-9._-]*$`, not ending with `.`, and no Windows
/// reserved device stem (case-insensitive, stem = part before the first `.`).
pub fn is_ppi1_segment(s: &str) -> bool {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > 100 {
        return false;
    }
    let first_ok = b[0].is_ascii_alphanumeric() || b[0] == b'_' || b[0] == b'-';
    let rest_ok = b[1..].iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'));
    if !first_ok || !rest_ok || b[b.len() - 1] == b'.' {
        return false;
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    !RESERVED_STEMS.contains(&stem.as_str())
}

/// Accepted frameworks (OD-06 §4.2). R1 eligibility (amendment A1: playwright
/// only) is an enrollment/compatibility decision, not a schema rule.
pub const FRAMEWORKS: [&str; 2] = ["cypress", "playwright"];

fn is_protected_folded(segments: &[&str]) -> bool {
    const SEGMENTS: [&str; 5] = [".git", ".github", "node_modules", "secrets", "credentials"];
    let folded: Vec<String> = segments.iter().map(|s| s.to_ascii_lowercase()).collect();
    if folded.iter().any(|s| SEGMENTS.contains(&s.as_str())) {
        return true;
    }
    let base = folded.last().map(String::as_str).unwrap_or("");
    base == "package.json" || base == "package-lock.json" || base == ".env" || base.starts_with(".env.")
}

/// Full PPI-1 target path (OD-04 §13.2) for `framework`.
///
/// Rules 1-6 and 8 are checked directly. Rule 7 (the existing JavaScript
/// classifiers `isSafeRepoRelativePath`, `isCanonicalPlanPath`,
/// `isProtectedPath`) is implied over the PPI-1 alphabet: without `:`, `\`,
/// a leading `/`, empty or dot-leading segments, no absolute, drive, UNC, URL,
/// traversal or non-canonical spelling can be formed, and rule 8 is a
/// case-folded superset of `isProtectedPath`. That implication is a review
/// item, not a runtime claim.
pub fn is_ppi1_target_path(s: &str, framework: &str) -> bool {
    let b = s.as_bytes();
    if b.is_empty() || b.len() > 300 {
        return false;
    }
    if !b.iter().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-' | b'/')) {
        return false;
    }
    let segments: Vec<&str> = s.split('/').collect();
    if segments.len() < 2 || !segments.iter().all(|seg| is_ppi1_segment(seg)) {
        return false;
    }
    if !FRAMEWORKS.contains(&framework) || segments[0] != framework {
        return false;
    }
    !is_protected_folded(&segments)
}

/// Unit name derived from `executionId` (OD-06 §6.2, §7.1). Never accepted as
/// input; both sides derive it.
pub fn unit_name(execution_id: &str) -> Option<String> {
    if is_id32(execution_id) {
        Some(format!("qa-agent-exec-v1-{execution_id}.service"))
    } else {
        None
    }
}
