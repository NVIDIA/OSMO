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

/**
 * Error Handling E2E Tests
 *
 * Tests for error UI across different scenarios:
 * 1. API errors (caught by React Query, shown inline via <ApiError />)
 * 2. Render errors (caught by Next.js error.tsx boundaries)
 *
 * Run with Playwright UI to preview error states:
 *   pnpm test:e2e --ui
 */

import { test, expect } from "../fixtures";
import { createPoolResponse, createResourcesResponse, PoolStatus } from "../mocks/factories";

// =============================================================================
// API Errors - Inline error display via <ApiError />
// Uses fixtures with poolsError/resourcesError scenarios
// =============================================================================

test.describe("API Errors (Inline)", () => {
  test("pools page shows inline error when API fails", async ({ page, withData }) => {
    // Configure pools API to return error (4xx = not retryable, fails fast)
    await withData({
      poolsError: { status: 400, detail: "Bad request: invalid pool query" },
    });

    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // Should show inline API error component
    await expect(page.getByTestId("api-error")).toBeVisible({ timeout: 10000 });
  });

  test("resources page shows inline error when API fails", async ({ page, withData }) => {
    // Configure resources API to return error
    await withData({
      resourcesError: { status: 400, detail: "Bad request: invalid resource query" },
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Should show inline API error
    await expect(page.getByTestId("api-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("pool detail page shows inline error when API fails", async ({ page, withData }) => {
    // Configure both APIs to return errors (pool detail needs both)
    await withData({
      poolsError: { status: 404, detail: "Pool not found" },
      resourcesError: { status: 404, detail: "Pool not found" },
    });

    await page.goto("/pools/test-pool");
    await page.waitForLoadState("networkidle");

    // Should show inline API error
    await expect(page.getByTestId("api-error")).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("resource panel shows inline error when detail fetch fails", async ({ page }) => {
    // This test needs manual routing with call counting:
    // - First calls succeed (page loads, resource table shows)
    // - Later calls fail (panel detail fetch fails)
    let poolQuotaCallCount = 0;
    let resourcesCallCount = 0;

    // Clear fixture routes first to avoid conflicts
    await page.unroute("**/api/pool_quota*");
    await page.unroute("**/api/resources*");

    // Create properly structured mock data using factories
    const mockPoolData = createPoolResponse([
      {
        name: "test-pool",
        description: "Test pool for error testing",
        status: PoolStatus.ONLINE,
        platforms: { "dgx-a100": { description: "DGX A100" } },
      },
    ]);

    const mockResourceData = createResourcesResponse([
      {
        hostname: "gpu-node-1.cluster.local",
        exposed_fields: {
          node: "gpu-node-1",
          "pool/platform": ["test-pool/dgx-a100"],
        },
        pool_platform_labels: { "test-pool": ["dgx-a100"] },
      },
    ]);

    // Override pool_quota route - first call succeeds, subsequent fail
    await page.route("**/api/pool_quota*", async (route) => {
      poolQuotaCallCount++;
      if (poolQuotaCallCount === 1) {
        // First call succeeds (page load with pools=test-pool)
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockPoolData),
        });
      } else {
        // Second call fails (panel with all_pools=true)
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Failed to fetch pool configs" }),
        });
      }
    });

    // Override resources route - first call succeeds, subsequent fail
    await page.route("**/api/resources*", async (route) => {
      resourcesCallCount++;
      if (resourcesCallCount === 1) {
        // First call succeeds (page load with pools=test-pool)
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockResourceData),
        });
      } else {
        // Second call fails (panel with all_pools=true)
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ detail: "Failed to fetch resource details" }),
        });
      }
    });

    // Go to pool detail page (has resource table)
    await page.goto("/pools/test-pool");
    await page.waitForLoadState("networkidle");

    // Wait for resource table to load and show the resource
    // The transform extracts the node name from exposed_fields.node
    const resourceRow = page.getByText("gpu-node-1");
    await expect(resourceRow).toBeVisible({ timeout: 15000 });

    // Click on the resource to open the panel
    await resourceRow.click();

    // Panel should open and show error for the detail fetch
    await expect(page.getByTestId("api-error")).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("retry button is clickable", async ({ page, withData }) => {
    // Configure resources API to always fail
    await withData({
      resourcesError: { status: 400, detail: "Permanent failure" },
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Wait for error UI to appear
    await expect(page.getByTestId("api-error")).toBeVisible({ timeout: 10000 });

    // Verify retry button exists and is clickable
    const retryButton = page.getByRole("button", { name: "Retry" });
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toBeEnabled();
  });
});

// =============================================================================
// Render Errors - Caught by error.tsx boundaries
// These use manual page.route to return malformed data that crashes transforms
// =============================================================================

test.describe("Render Errors (error.tsx)", () => {
  test("dashboard error: shows error UI when pools API returns malformed data", async ({ page }) => {
    // Override pool_quota to return malformed data that will cause transform to crash
    // (page.route added after fixtures takes precedence)
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        // node_sets should be an array, this will cause .flatMap() to fail
        body: JSON.stringify({ node_sets: "this should be an array" }),
      });
    });

    await page.goto("/pools");

    // Should show error boundary UI
    await expect(page.getByRole("heading", { name: /something went wrong|couldn't load/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("copy button copies error details", async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Return malformed data
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: "invalid" }),
      });
    });

    await page.goto("/pools");

    // Wait for error UI
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    // Expand stack trace first to reveal copy button
    const stackTraceToggle = page.getByRole("button", { name: /stack trace/i });
    await expect(stackTraceToggle).toBeVisible();
    await stackTraceToggle.click();

    // Now click copy button
    const copyButton = page.getByTestId("copy-error-button");
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    // Should show copied feedback
    await expect(page.getByTestId("copy-success")).toBeVisible();
  });

  test("pools error shows 'View all pools' navigation", async ({ page }) => {
    // Return malformed data
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: "invalid" }),
      });
    });

    await page.goto("/pools");

    // Pools-specific error page should show "View all pools" button
    await expect(page.getByRole("link", { name: "View all pools" })).toBeVisible();
  });
});

// =============================================================================
// Error Recovery
// =============================================================================

test.describe("Error Recovery", () => {
  test("pools error 'View all pools' navigates correctly", async ({ page }) => {
    // Return malformed data
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: "invalid" }),
      });
    });

    await page.goto("/pools");

    // Wait for pools-specific error UI
    await expect(page.getByRole("link", { name: "View all pools" })).toBeVisible();

    // Click the link
    await page.getByRole("link", { name: "View all pools" }).click();

    // Should navigate to /pools (the link reloads the page)
    await expect(page).toHaveURL("/pools");
  });

  test("'Try again' button is clickable on error boundary", async ({ page }) => {
    // Return malformed data to trigger error boundary
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: "invalid" }),
      });
    });

    await page.goto("/pools");

    // Should show error boundary UI
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    // Verify button is enabled and clickable
    const tryAgainButton = page.getByRole("button", { name: "Try again" });
    await expect(tryAgainButton).toBeEnabled();

    // Click should not throw (button works)
    await tryAgainButton.click();
  });
});
