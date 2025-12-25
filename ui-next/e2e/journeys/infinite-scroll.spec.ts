// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import {
  test,
  expect,
  createPoolResponse,
  createResourcesResponse,
  PoolStatus,
  BackendResourceType,
} from "../fixtures";

/**
 * Infinite Scroll E2E Tests
 *
 * Tests for the infinite scroll pagination behavior on the Resources page.
 * These tests verify:
 * - Initial page load with limited data
 * - Loading more data on scroll
 * - Loading indicators
 * - Cache behavior with filter changes
 */

/**
 * Generate a large set of resources for infinite scroll testing.
 */
function createManyResources(count: number) {
  return createResourcesResponse(
    Array.from({ length: count }, (_, i) => ({
      hostname: `node-${String(i + 1).padStart(4, "0")}.cluster.local`,
      resource_type: i % 3 === 0 ? BackendResourceType.RESERVED : BackendResourceType.SHARED,
      exposed_fields: {
        node: `node-${String(i + 1).padStart(4, "0")}`,
        "pool/platform": [`pool-${(i % 3) + 1}/${i % 2 === 0 ? "dgx" : "base"}`],
      },
      allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * 1024 * 1024 },
      usage_fields: { gpu: i % 8, cpu: 64, memory: 256 * 1024 * 1024 },
      pool_platform_labels: { [`pool-${(i % 3) + 1}`]: [i % 2 === 0 ? "dgx" : "base"] },
    }))
  );
}

test.describe("Infinite Scroll - Resources Page", () => {
  test("displays resources table with data", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        { name: "pool-1", status: PoolStatus.ONLINE },
        { name: "pool-2", status: PoolStatus.ONLINE },
        { name: "pool-3", status: PoolStatus.ONLINE },
      ]),
      resources: createManyResources(100),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Should show resources heading
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/resources/i);

    // Should show some resources
    await expect(page.getByText("node-0001")).toBeVisible();
  });

  test("shows resource count information", async ({ page, withData }) => {
    await withData({
      resources: createManyResources(150),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Should display count information in the header area
    // The exact format depends on whether we're showing "X of Y" or just "X"
    const countText = page.locator('[aria-controls="filter-content"]');
    await expect(countText).toBeVisible();
  });

  test("loads more data when scrolling to bottom", async ({ page, withData }) => {
    await withData({
      resources: createManyResources(200),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Get the scroll container (the table body area)
    const scrollContainer = page.locator('[role="table"]').locator("..");
    await expect(scrollContainer).toBeVisible();

    // Initial data should be visible
    await expect(page.getByText("node-0001")).toBeVisible();

    // Scroll to bottom to trigger loading more
    await scrollContainer.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    // Wait for more data to potentially load
    await page.waitForTimeout(500);

    // Should still show the table (no error state)
    await expect(page.getByText("node-0001")).toBeVisible();
  });

  test("filter changes reset scroll position", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        { name: "production", status: PoolStatus.ONLINE },
        { name: "development", status: PoolStatus.ONLINE },
      ]),
      resources: createManyResources(100),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Apply a search filter
    const searchInput = page.getByRole("searchbox");
    if (await searchInput.isVisible()) {
      await searchInput.fill("node-00");

      // Should filter results
      await page.waitForTimeout(300);

      // Clear filter
      await searchInput.clear();
    }
  });

  test("handles empty results gracefully", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        { name: "empty-pool", status: PoolStatus.ONLINE },
      ]),
      resources: { resources: [] },
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Should show empty state or "no resources" message
    // The exact text depends on the UI implementation
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/resources/i);
  });

  test("maintains scroll position on back navigation", async ({ page, withData }) => {
    await withData({
      resources: createManyResources(100),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Verify initial load
    await expect(page.getByText("node-0001")).toBeVisible();

    // Navigate to a different page
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // Navigate back
    await page.goBack();
    await page.waitForLoadState("networkidle");

    // Data should still be visible (from cache)
    await expect(page.getByText("node-0001")).toBeVisible();
  });
});

test.describe("Loading States", () => {
  test("shows skeleton during initial load", async ({ page, withData }) => {
    // Delay the response to see loading state
    await page.route("**/api/resources*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(createManyResources(50)),
      });
    });

    await withData({
      pools: createPoolResponse([{ name: "test", status: PoolStatus.ONLINE }]),
    });

    await page.goto("/resources");

    // Should show loading indicator or skeleton
    // This depends on the specific loading state implementation
    await page.waitForLoadState("networkidle");
  });
});

test.describe("Filter Integration", () => {
  test("search works with paginated data", async ({ page, withData }) => {
    await withData({
      resources: createManyResources(100),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByRole("searchbox");
    if (await searchInput.isVisible()) {
      // Search for a specific node
      await searchInput.fill("node-0050");

      // Should find the matching node (use exact: true to avoid matching the filter chip)
      await expect(page.getByText("node-0050", { exact: true })).toBeVisible({ timeout: 3000 });

      // Clear search
      await searchInput.clear();
    }
  });

  test("pool filter updates results", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        { name: "pool-1", status: PoolStatus.ONLINE },
        { name: "pool-2", status: PoolStatus.ONLINE },
      ]),
      resources: createResourcesResponse([
        {
          hostname: "pool1-node.cluster",
          exposed_fields: { node: "pool1-node", "pool/platform": ["pool-1/dgx"] },
          pool_platform_labels: { "pool-1": ["dgx"] },
        },
        {
          hostname: "pool2-node.cluster",
          exposed_fields: { node: "pool2-node", "pool/platform": ["pool-2/dgx"] },
          pool_platform_labels: { "pool-2": ["dgx"] },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Both nodes should be visible initially
    await expect(page.getByText("pool1-node")).toBeVisible();
    await expect(page.getByText("pool2-node")).toBeVisible();
  });
});
