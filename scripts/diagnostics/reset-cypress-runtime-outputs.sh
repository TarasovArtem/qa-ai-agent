#!/usr/bin/env bash
# Roadmap #19.7F-B4B correction.
#
# The ONLY place that clears disposable Cypress runtime output between the
# forensic script's own diagnostic re-runs. Deliberately narrow:
# reports/cypress (never the bare "reports" directory, which is also the
# parent of this investigation's own reports/firefox-forensics output -
# that was the exact self-destruction bug this correction fixes) plus the
# two screenshot/video directories a fresh `cypress run` regenerates.
#
# firefox-failure-forensics.sh (production) and its own offline behavioral
# regression (firefox-failure-forensics.test.js) both invoke this exact
# script, so there is only one implementation of this behavior to keep
# correct - never two copies that could drift apart.
set -uo pipefail

rm -rf reports/cypress cypress/screenshots cypress/videos
