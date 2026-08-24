// @ts-check
const { test, expect } = require("@playwright/test");

// Roadmap #21F: minimal production Playwright smoke proof - not a port of
// the Cypress suite, and deliberately not built around the historically
// intermittent poi_data_requests.cy.js / cy.wait("@poiTiles") flow (see the
// #19.7F-C organic Firefox forensic review: that failure family's exact
// mechanism remains unproven, and this smoke is not intended to reproduce
// or investigate it). Instead this mirrors the stable, non-network-wait
// select_group_POI.cy.js flow: select a category from the tree component
// and assert its checked state and the map's visibility - both pure
// UI-state assertions, no network interception involved.
test("selecting the Gastronomy category checks it and keeps the map visible", async ({ page }) => {
  await page.goto("/");

  // Bounded, optional cookie-consent handling (see the #19.7F-C organic
  // Firefox forensic review, which observed this dialog undismissed in
  // fresh sessions) - dismiss it if present, continue unconditionally if
  // not. Never a fixed sleep: the timeout only bounds how long this
  // specific optional check waits before concluding the dialog is absent.
  const acceptCookies = page.getByRole("button", { name: "Accept" });
  if (await acceptCookies.isVisible({ timeout: 5000 }).catch(() => false)) {
    await acceptCookies.click();
  }

  // Angular Material renders the real, accessible <input type="checkbox">
  // visually hidden (cdk-visually-hidden) under a visible <label> that
  // intercepts pointer events - the same reason the proven-stable Cypress
  // suite clicks the <mat-checkbox> host element itself
  // (cy.contains('mat-checkbox', 'Gastronomy').click(), see
  // cypress/e2e/pageObjects/categories.js) rather than the inner input
  // directly. The role locator is still the correct way to read state
  // (toBeChecked() inspects the real input regardless of its own visual
  // visibility), but the click must target the visible host element.
  const gastronomyCheckboxHost = page.locator("mat-checkbox", { hasText: "Gastronomy" });
  const gastronomyCheckboxInput = page.getByRole("checkbox", { name: "Gastronomy" });
  await expect(gastronomyCheckboxHost).toBeVisible();

  await gastronomyCheckboxHost.click();
  await expect(gastronomyCheckboxInput).toBeChecked();

  await expect(page.locator(".map-container")).toBeVisible();
});
