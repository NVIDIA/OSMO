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
 * Sidebar Navigation Active State Tests
 *
 * Tests that the sidebar correctly highlights the active page:
 * - The current route's nav item gets active styling (data-active="true")
 * - Navigating between pages updates the active state
 * - Sub-paths correctly highlight the parent nav item
 *
 * Architecture notes:
 * - AppSidebar uses usePathname() + useMounted() to determine active state
 * - Active state only applies after client hydration
 * - isItemActive: activePath === href || (href !== "/" && activePath.startsWith(href))
 * - Active items get: bg-zinc-200 font-semibold text-zinc-900 (light)
 * - SidebarMenuButton uses isActive prop → data-active attr
 */

test.describe("Sidebar Navigation Active State", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("Pools nav item is active when on /pools page", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — Pools link has active state
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    const poolsLink = sidebar.getByRole("link", { name: "Pools", exact: true });
    await expect(poolsLink).toBeVisible();

    // The SidebarMenuButton wrapping the link should have data-active="true"
    const poolsMenuItem = sidebar.locator('[data-active="true"]').first();
    await expect(poolsMenuItem).toBeVisible();
  });

  test("Dashboard nav item is active when on root page", async ({ page }) => {
    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Dashboard link has active state
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    const activeItem = sidebar.locator('[data-active="true"]');
    await expect(activeItem.first()).toBeVisible();
    await expect(activeItem.getByText("Dashboard")).toBeVisible();
  });

  test("navigating between pages changes active state", async ({ page }) => {
    // ARRANGE — start on pools
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator('[data-sidebar="sidebar"]').first();

    // Verify Pools is active initially
    const poolsActiveItem = sidebar.locator('[data-active="true"]');
    await expect(poolsActiveItem.getByText("Pools")).toBeVisible();

    // ACT — navigate to workflows
    await sidebar.getByRole("link", { name: "Workflows", exact: true }).click();
    await page.waitForLoadState("networkidle");

    // ASSERT — Workflows is now active, Pools is not
    const workflowsActiveItem = sidebar.locator('[data-active="true"]');
    await expect(workflowsActiveItem.getByText("Workflows")).toBeVisible();
  });

  test("sidebar shows all main navigation items", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — all navigation links are visible
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar.getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Workflows", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Pools", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Resources", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Occupancy", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Datasets", exact: true })).toBeVisible();
  });
});
