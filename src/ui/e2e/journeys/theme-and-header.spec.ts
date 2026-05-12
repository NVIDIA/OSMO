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
import { createPoolResponse, PoolStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupPools, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Theme Toggle & Header UI Journey Tests
 *
 * Architecture notes:
 * - ThemeToggle lives in Header, uses next-themes + Radix DropdownMenu
 * - Theme options: Light, Dark, System
 * - Guarded by useMounted() to prevent hydration mismatch
 * - User menu only renders when user is resolved from server headers (not available in E2E)
 * - Header also contains: Home breadcrumb, Submit Workflow button, mobile menu trigger
 */

test.describe("Theme Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("theme toggle button is visible in header", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — toggle button with "Toggle theme" sr-only text is visible
    const toggleButton = page.getByRole("button", { name: "Toggle theme" });
    await expect(toggleButton).toBeVisible();
  });

  test("clicking theme toggle opens dropdown with Light, Dark, System options", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Toggle theme" }).click();

    // ASSERT — dropdown menu items are visible
    await expect(page.getByRole("menuitem", { name: "Light" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Dark" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "System" })).toBeVisible();
  });

  test("selecting Dark theme applies dark class to html element", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.getByRole("menuitem", { name: "Dark" }).click();

    // ASSERT — html element has dark class (next-themes applies class to <html>)
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  test("selecting Light theme removes dark class from html element", async ({ page }) => {
    // ACT — first set to dark, then switch back to light
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Set dark first
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.getByRole("menuitem", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Now switch to light
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.getByRole("menuitem", { name: "Light" }).click();

    // ASSERT — dark class is removed
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });
});

test.describe("Header Elements", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("home link is visible in header breadcrumb", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — Home link with aria-label exists in breadcrumb nav
    const homeLink = page.getByRole("link", { name: "Home" });
    await expect(homeLink).toBeVisible();
  });

  test("home link navigates to dashboard", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("link", { name: "Home" }).click();

    // ASSERT — navigates to root
    await expect(page).toHaveURL(/\/$/);
  });
});
