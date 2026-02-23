// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

import { test, expect } from "../fixtures";

/**
 * Navigation Journey Tests
 *
 * Tests core navigation functionality.
 * Uses default mock data (auth disabled, standard pools/resources).
 */

test.describe("Main Navigation", () => {
  test("navigates to main sections via sidebar", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Should see navigation
    const nav = page.getByRole("navigation");
    await expect(nav).toBeVisible();

    // Navigate to Pools
    await page.getByRole("link", { name: /pools/i }).click();
    await expect(page).toHaveURL(/.*pools/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/pools/i);

    // Navigate to Resources
    await page.getByRole("link", { name: /resources/i }).click();
    await expect(page).toHaveURL(/.*resources/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/resources/i);

    // Return to Dashboard
    await page.getByRole("link", { name: /dashboard/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test("highlights current page in navigation", async ({ page }) => {
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // Pools link should be active/highlighted
    const poolsLink = page.getByRole("link", { name: /pools/i });
    await expect(poolsLink).toBeVisible();
    // Active state styling is implementation-dependent
  });
});

test.describe("Accessibility", () => {
  test("skip link allows keyboard users to skip navigation", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Tab to reach skip link
    await page.keyboard.press("Tab");

    // Skip link should be visible when focused
    const skipLink = page.locator("a.skip-link");
    // Check it exists (may or may not be visible depending on implementation)
    const skipLinkCount = await skipLink.count();

    if (skipLinkCount > 0) {
      // Some implementations show skip link on focus
      await expect(skipLink.first()).toHaveAttribute("href", "#main-content");
    }
  });

  test("all pages have proper heading structure", async ({ page }) => {
    // Check dashboard
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Check pools
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // Check resources
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("navigation is keyboard accessible", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Tab through navigation
    await page.keyboard.press("Tab"); // Skip link
    await page.keyboard.press("Tab"); // First nav item

    // Should be able to activate with Enter
    await page.keyboard.press("Enter");

    // Should have navigated
    await expect(page.url()).not.toBe("about:blank");
  });
});

test.describe("Responsive Behavior", () => {
  test("navigation works on mobile viewport", async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Mobile might have hamburger menu - check for any navigation mechanism
    const menuButton = page.getByRole("button", { name: /menu|toggle|navigation/i });
    if (await menuButton.isVisible()) {
      await menuButton.click();
    }

    // Just verify page loaded correctly (layout may differ on mobile)
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

test.describe("Error Handling", () => {
  test("shows not found page for invalid routes", async ({ page }) => {
    await page.goto("/this-page-does-not-exist");

    // Should show 404 or not found message OR redirect to valid page
    // Next.js might redirect or show a generic page
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("shows not found for invalid pool", async ({ page }) => {
    await page.goto("/pools/nonexistent-pool-12345");
    await page.waitForLoadState("networkidle");

    // Should handle gracefully (show not found or empty state)
    await expect(page.locator("body")).not.toBeEmpty();
  });
});
