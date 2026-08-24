/**
 * Roadmap #21B - REPORTER-PROOF SPEC ONLY.
 *
 * NOT a production Playwright suite. Five deterministic cases, entirely
 * offline (page.setContent() only - no external URL, no live SUT), chosen
 * to exercise every logical status
 * scripts/ai/adapters/playwright-adapter.js's own docstring distinguishes:
 * expected (pass), unexpected (fail), flaky, and skipped. No timing races,
 * no randomness, no network - every case is reproducible on any machine.
 */

"use strict";

const { test, expect } = require("@playwright/test");

test("P_REAL_1 normal pass", async ({ page }) => {
  await page.setContent("<h1>ok</h1>");
  await expect(page.locator("h1")).toHaveText("ok");
});

test("P_REAL_2 unexpected failure", async ({ page }) => {
  await page.setContent("<h1>actual</h1>");
  await expect(page.locator("h1")).toHaveText("expected-but-wrong", { timeout: 1000 });
});

test("P_REAL_3 expected failure", async ({ page }) => {
  test.fail();
  await page.setContent("<h1>actual</h1>");
  await expect(page.locator("h1")).toHaveText("this-will-never-match", { timeout: 1000 });
});

test("P_REAL_4 deterministic flaky", async ({ page }, testInfo) => {
  await page.setContent("<h1>flaky</h1>");
  if (testInfo.retry === 0) {
    // First attempt: fail on purpose, deterministically (no timing/randomness).
    expect(testInfo.retry).toBe(1);
  } else {
    // Retry attempt: passes deterministically.
    expect(testInfo.retry).toBe(1);
  }
});

test.skip("P_REAL_5 skipped", async () => {
  throw new Error("must never run - this test is always skipped");
});
