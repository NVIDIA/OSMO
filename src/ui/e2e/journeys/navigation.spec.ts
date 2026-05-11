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
import { createPoolResponse, createResourcesResponse, createDatasetsResponse, DatasetType } from "@/mocks/factories";
import { setupDefaultMocks, setupPools, setupProfile, setupResources, setupDatasets } from "@/e2e/utils/mock-setup";

/**
 * Navigation Journey Tests
 *
 * Validates sidebar links and route accessibility for every user-facing route.
 * Content validation lives in the dedicated page specs (pools, resources, etc.).
 *
 * User-facing sidebar routes (admin routes excluded):
 *   Dashboard /  ·  Workflows /workflows  ·  Pools /pools
 *   Resources /resources  ·  Occupancy /occupancy  ·  Datasets /datasets
 *
 * Implementation notes:
 * - Scope sidebar queries to [data-sidebar="sidebar"] to avoid matching page
 *   content (e.g. dashboard stat cards "Pools Online", "Active Workflows")
 * - Use exact: true to prevent substring matches on dashboard card link names
 * - Clicking tests start from a fully-mocked page (/pools), not the dashboard,
 *   to avoid API-retry noise interfering with navigation
 */

// Scoped helper — avoids matching dashboard cards with similar link names
function sidebarLink(page: Parameters<typeof setupDefaultMocks>[0], name: string) {
  return page.locator('[data-sidebar="sidebar"]').first().getByRole("link", { name, exact: true });
}

test.describe("Sidebar Links", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(page, createPoolResponse());
    await setupProfile(page);
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");
  });

  test("shows all user-facing navigation links", async ({ page }) => {
    for (const name of ["Dashboard", "Workflows", "Pools", "Resources", "Occupancy", "Datasets"]) {
      await expect(sidebarLink(page, name)).toBeVisible();
    }
  });

  test("does not show admin-only Log Viewer link for regular users", async ({ page }) => {
    await expect(sidebarLink(page, "Log Viewer")).not.toBeVisible();
  });
});

test.describe("Sidebar Navigation", () => {
  // Start from /pools — fully mocked, stable, and not the dashboard which makes
  // many unmocked API calls that cause retry noise during sidebar clicks.
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(page, createPoolResponse());
    await setupProfile(page);
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");
  });

  // Each test waits for networkidle after navigation so the destination page
  // has settled before teardown begins. Without this, RSC fetch requests and
  // TanStack Query activity on the new page outlive the test and cause
  // "Tearing down context exceeded timeout". networkidle resolves quickly
  // because the catch-all in setupDefaultMocks answers all /api/** with 404
  // (no retries) and route warmup in globalSetup pre-compiles all routes.

  test("Pools link navigates to /pools", async ({ page }) => {
    await sidebarLink(page, "Pools").click();
    await expect(page).toHaveURL(/\/pools/);
    await page.waitForLoadState("networkidle");
  });

  test("Resources link navigates to /resources", async ({ page }) => {
    await sidebarLink(page, "Resources").click();
    await expect(page).toHaveURL(/\/resources/);
    await page.waitForLoadState("networkidle");
  });

  test("Workflows link navigates to /workflows", async ({ page }) => {
    await sidebarLink(page, "Workflows").click();
    await expect(page).toHaveURL(/\/workflows/);
    await page.waitForLoadState("networkidle");
  });

  test("Occupancy link navigates to /occupancy", async ({ page }) => {
    await sidebarLink(page, "Occupancy").click();
    await expect(page).toHaveURL(/\/occupancy/);
    await page.waitForLoadState("networkidle");
  });

  test("Datasets link navigates to /datasets", async ({ page }) => {
    await sidebarLink(page, "Datasets").click();
    await expect(page).toHaveURL(/\/datasets/);
    await page.waitForLoadState("networkidle");
  });

  test("Dashboard link navigates to /", async ({ page }) => {
    await sidebarLink(page, "Dashboard").click();
    await expect(page).toHaveURL(/\/$/);
    await page.waitForLoadState("networkidle");
  });
});

test.describe("Route Loading", () => {
  // Validate each route is reachable and the app shell renders.
  // waitUntil: "domcontentloaded" skips API-dependent networkidle for routes
  // whose data APIs are not mocked here (content is tested in dedicated specs).
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
  });

  test("/pools loads", async ({ page }) => {
    await setupPools(page, createPoolResponse());
    await setupProfile(page);
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/pools/);
    await expect(sidebarLink(page, "Pools")).toBeVisible();
  });

  test("/resources loads", async ({ page }) => {
    await setupResources(page, createResourcesResponse());
    await setupProfile(page);
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/resources/);
    await expect(sidebarLink(page, "Resources")).toBeVisible();
  });

  test("/workflows loads", async ({ page }) => {
    await page.goto("/workflows", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/workflows/);
    await expect(sidebarLink(page, "Workflows")).toBeVisible();
  });

  test("/occupancy loads", async ({ page }) => {
    await page.goto("/occupancy", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/occupancy/);
    await expect(sidebarLink(page, "Occupancy")).toBeVisible();
  });

  test("/datasets loads", async ({ page }) => {
    await page.goto("/datasets", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/datasets/);
    await expect(sidebarLink(page, "Datasets")).toBeVisible();
  });

  test("/profile loads", async ({ page }) => {
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/profile/);
    await expect(sidebarLink(page, "Dashboard")).toBeVisible();
  });
});

test.describe("Invalid Routes", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
  });

  test("unknown route shows a not-found page without crashing", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });

  test("deeply nested unknown route shows 404", async ({ page }) => {
    await page.goto("/pools/this/does/not/exist");
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  });
});

test.describe("Sidebar Active State", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(page, createPoolResponse());
    await setupProfile(page);
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");
  });

  test("Pools link is active on /pools route", async ({ page }) => {
    // The active link has data-active="true" attribute from shadcn sidebar
    const poolsLink = sidebarLink(page, "Pools");
    await expect(poolsLink).toBeVisible();
    await expect(poolsLink).toHaveAttribute("data-active", "true");
  });

  test("navigating changes the active sidebar link", async ({ page }) => {
    // Start on /pools - Pools should be active
    await expect(sidebarLink(page, "Pools")).toHaveAttribute("data-active", "true");

    // Navigate to Resources
    await sidebarLink(page, "Resources").click();
    await expect(page).toHaveURL(/\/resources/);
    await page.waitForLoadState("networkidle");

    // Now Resources should be active
    await expect(sidebarLink(page, "Resources")).toHaveAttribute("data-active", "true");
  });
});

test.describe("Profile Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(page, createPoolResponse());
    await setupProfile(page);
  });

  test("profile route has sidebar with Dashboard link", async ({ page }) => {
    await page.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(sidebarLink(page, "Dashboard")).toBeVisible();
  });

  test("log-viewer route has sidebar with Dashboard link", async ({ page }) => {
    await page.goto("/log-viewer", { waitUntil: "domcontentloaded" });
    await expect(sidebarLink(page, "Dashboard")).toBeVisible();
  });
});

test.describe("Cross-Page Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(page, createPoolResponse());
    await setupProfile(page);
  });

  test("navigating from datasets list to dataset detail and back", async ({ page }) => {
    // ARRANGE — mock datasets for the list page
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "nav-test-dataset", bucket: "nav-bucket", type: DatasetType.DATASET },
      ]),
    );

    // ACT — start at datasets list
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // Click the dataset row to navigate to detail
    const grid = page.getByRole("grid");
    const firstDataRow = grid.getByRole("row").nth(1);
    await expect(firstDataRow).toBeVisible();
    await firstDataRow.click();

    // ASSERT — navigated to a dataset detail page
    await expect(page).toHaveURL(/\/datasets\/[^/]+\/[^/]+/);

    // Navigate back via breadcrumb
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await breadcrumb.getByText("Datasets").first().click();

    // ASSERT — back at datasets list
    await expect(page).toHaveURL(/\/datasets\b/);
  });

  test("sidebar links work across multiple page navigations", async ({ page }) => {
    // ACT — start at pools
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // Navigate using sidebar to Datasets
    await sidebarLink(page, "Datasets").click();
    await expect(page).toHaveURL(/\/datasets/);
    await page.waitForLoadState("networkidle");

    // Navigate back to Pools via sidebar
    await sidebarLink(page, "Pools").click();
    await expect(page).toHaveURL(/\/pools/);
    await page.waitForLoadState("networkidle");

    // ASSERT — page content renders after multiple navigations
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Pools").first()).toBeVisible();
  });
});
