//! AC-3A-04 / AC-3A-05 static guard: the portable library source uses no
//! OS-specific, process, filesystem, network, FFI or unsafe facility, and the
//! crate ships no binary target. Test-only file reads; nothing is executed.

use std::fs;
use std::path::Path;

const FORBIDDEN: [&str; 16] = [
    "unsafe",
    "std::os",
    "std::process",
    "std::fs",
    "std::net",
    "std::env",
    "std::thread",
    "extern \"C\"",
    "extern crate",
    "#[link",
    "target_os",
    "libc",
    "Command::",
    "systemd",
    "dbus",
    "sudo",
];

#[test]
fn library_source_is_portable_and_capability_free() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut checked = 0;
    for entry in fs::read_dir(&src).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        // Doc comments may name excluded facilities; check code lines only.
        let code: String = text
            .lines()
            .filter(|l| {
                let t = l.trim_start();
                !(t.starts_with("//") || t.starts_with("#![forbid(unsafe_code)]"))
            })
            .collect::<Vec<_>>()
            .join("\n");
        for word in FORBIDDEN {
            assert!(!code.contains(word), "{} uses {word}", path.display());
        }
        checked += 1;
    }
    assert!(checked >= 10, "all modules scanned");
}

#[test]
fn no_binary_target_and_single_dependency() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    assert!(!root.join("src/main.rs").exists());
    assert!(!root.join("src/bin").exists());
    let manifest = fs::read_to_string(root.join("Cargo.toml")).unwrap();
    assert!(!manifest.contains("[[bin]]"));
    let lock = fs::read_to_string(root.join("Cargo.lock")).unwrap();
    let packages: Vec<&str> =
        lock.lines().filter_map(|l| l.strip_prefix("name = \"")).map(|n| n.trim_end_matches('"')).collect();
    assert_eq!(packages, ["hmac-sha256", "qa-agent-controller-v1"]);
}
