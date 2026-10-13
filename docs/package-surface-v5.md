# Package Surface v5 — Controlled-v1 Stage 4A private runtime

Authority: `OD-CONTROLLED-V1-STAGE-4-IMPLEMENTATION — APPROVED` and
`OD-CONTROLLED-V1-STAGE-4-ENABLEMENT-SEQUENCING — APPROVED`.

This is package-surface evidence for the Stage 4A implementation. It records
private implementation shipping while preserving the supported release
surface and keeping `reviewRecord` and `apply` disabled. It does not authorize
Stage 4B activation, merge, or guard closure.

The disabled-capability statements below describe the certified Stage 4A
baseline. Stage 4B changes only CLI support and retains this exact physical
inventory and export contract; see [Stage 4B activation evidence](controlled-v1-stage4b-activation.md)
for Stage 4B **COMPLETE_ON_MAIN / POST-MERGE CERTIFIED** (PR #249) and the
installed-command proofs.

## Public surface

The five `exports` entries, their targets, the 19-name root API, package
metadata, and the `qa-agent` bin target are unchanged. No wildcard export or
runtime dependency was added. The Stage 4 implementation modules are not
available through package subpath imports.

The CLI command table keeps `review record` and `apply` reserved. Their
production routes check the immutable release capability gate before loading
Stage 4 authority modules or accessing config, identity, terminal or run state.
The installed bin returns
`CAPABILITY_NOT_ENABLED_IN_RELEASE` for both commands regardless of config,
environment, provider, model, or `--offline`. `info --json` continues to show
both capabilities as unavailable.

## Physical package delta

The exact tarball inventory is 103 files: the prior 89-file Stage 3 inventory
plus 14 explicit Stage 4A private runtime files. `package.json` continues to
exclude the private trees and names every re-included file explicitly.

The Stage 4A additions are:

```text
scripts/ai/cli/apply.js
scripts/ai/cli/canonical-review-serialization.js
scripts/ai/cli/path-identity.js
scripts/ai/cli/review-record-v2.js
scripts/ai/cli/review-record.js
scripts/ai/cli/stage4-durability.js
scripts/ai/cli/stage4-principal.js
scripts/ai/cli/stage4-run.js
scripts/ai/cli/stage4-state.js
scripts/ai/cli/terminal-session.js
scripts/ai/test-automation/applied-change-set-record.js
scripts/ai/test-automation/change-set-application.js
scripts/ai/test-automation/generated-change-set-review-record.js
scripts/ai/test-automation/generated-change-set-review-record-builder.js
```

The Stage 4 `apply.js` private closure reaches the canonical #23F application
and its existing #23E gate. The `review-record.js` closure reaches neither.
The builder is gate-free and does not define or call an approval gate. No
Stage 4 module is a supported API in this release. Every shipped Stage 4
implementation file is transitively reachable from the production bin;
§9.1 minimality has no whitelist exception. Reachability does not make the
capability available: both release capabilities remain disabled.

## Evidence

`test/installation/controlled-v1-cli-package.test.js` checks the exact pack
inventory, closure, minimality, private import denial, and unchanged exports.
`test/installation/controlled-v1-stage3-external-proof.test.js` installs a
real tarball outside the checkout, checks that Stage 4 files are present but
unexported, and verifies that the real installed CLI remains release-disabled
under config, environment, provider, and offline variations.

Windows Stage 4 eligibility remains fail-closed: no real-win32 proof is
claimed, and the principal and storage checks reject unproven Windows
configurations. `TSB-F02` remains OPEN / LOW / CONDITIONAL with trigger FALSE:
the gate is still reached only through #23F, whose per-change approval checks
remain in place. R-1..R-5 and AT-07/TB-01 remain accepted residuals; the three
FUTURE review guards remain OPEN.
