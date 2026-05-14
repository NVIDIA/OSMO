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

import { test, expect } from "@playwright/test";
import { setupDefaultMocks, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Not Found (404) Page Journey Tests
 *
 * Architecture notes:
 * - 404 page lives at src/app/(dashboard)/not-found.tsx
 * - Uses NotFoundContent component from src/components/not-found-content.tsx
 * - Shows "404" heading, OSMO acronym ("Our Server Missed One..."), description
 * - Has two action buttons: "Dashboard" (link to /) and "Go Back" (router.back())
 * - Decorative gradient background behind content
 */

test.describe("Not Found Page Content", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows 404 heading and descriptive text", async ({ page }) => {
    // ACT
    await page.goto("/this-page-does-not-exist");

    // ASSERT
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await expect(page.getByText(/the page you.*looking for/i)).toBeVisible();
  });

  test("shows OSMO acronym phrase", async ({ page }) => {
    // ACT
    await page.goto("/nonexistent-route");

    // ASSERT — "Our Server Missed One..." is displayed
    await expect(page.getByText(/our/i).first()).toBeVisible();
    await expect(page.getByText(/server/i).first()).toBeVisible();
    await expect(page.getByText(/missed/i).first()).toBeVisible();
  });

  test("Dashboard action links to home", async ({ page }) => {
    // ACT
    await page.goto("/another-nonexistent-route");
    await page.waitForLoadState("networkidle");

    // ASSERT — Dashboard action in main content (not sidebar) is visible
    const mainContent = page.getByLabel("Main content");
    const dashboardAction = mainContent.getByRole("link", { name: /dashboard/i });
    await expect(dashboardAction).toBeVisible();
    await expect(dashboardAction).toHaveAttribute("href", "/");
  });

  test("Go Back button is visible", async ({ page }) => {
    // ACT
    await page.goto("/some-missing-page");

    // ASSERT — Go Back button is visible
    const goBackButton = page.getByRole("button", { name: /go back/i });
    await expect(goBackButton).toBeVisible();
  });

  test("Dashboard action navigates to home page", async ({ page }) => {
    // ACT
    await page.goto("/not-a-real-page");
    await page.waitForLoadState("networkidle");

    // Scope to main content to avoid sidebar "Dashboard" link
    const mainContent = page.getByLabel("Main content");
    const dashboardAction = mainContent.getByRole("link", { name: /dashboard/i });
    await expect(dashboardAction).toBeVisible();

    // Click and wait for navigation
    await Promise.all([
      page.waitForURL(/\/$/),
      dashboardAction.click(),
    ]);

    // ASSERT — navigated to home
    await expect(page).toHaveURL(/\/$/);
  });

  test("Go Back button navigates to previous page", async ({ page }) => {
    // ARRANGE — first navigate to a known page, then to 404
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");
    await page.goto("/this-is-not-a-page");
    await page.waitForLoadState("networkidle");

    // ACT — click Go Back
    const goBackButton = page.getByRole("button", { name: /go back/i });
    await goBackButton.click();

    // ASSERT — back to pools
    await expect(page).toHaveURL(/\/pools/);
  });
});
