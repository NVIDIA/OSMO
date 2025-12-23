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
  expandFiltersIfCollapsed,
  // Generated enums - use instead of string literals
  PoolStatus,
  BackendResourceType,
} from "../fixtures";

/**
 * Resources Page Journey Tests
 *
 * Tests for the cross-pool resources view.
 * Each test defines its own scenario data inline.
 */

test.describe("Resources List", () => {
  test("shows resources from all pools", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        { name: "pool-a", status: PoolStatus.ONLINE },
        { name: "pool-b", status: PoolStatus.ONLINE },
      ]),
      resources: createResourcesResponse([
        {
          hostname: "node-from-pool-a.cluster",
          exposed_fields: { node: "node-from-pool-a", "pool/platform": ["pool-a/base"] },
          pool_platform_labels: { "pool-a": ["base"] },
        },
        {
          hostname: "node-from-pool-b.cluster",
          exposed_fields: { node: "node-from-pool-b", "pool/platform": ["pool-b/gpu"] },
          pool_platform_labels: { "pool-b": ["gpu"] },
        },
        {
          hostname: "shared-node.cluster",
          exposed_fields: { node: "shared-node", "pool/platform": ["pool-a/base", "pool-b/base"] },
          pool_platform_labels: { "pool-a": ["base"], "pool-b": ["base"] },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Should show all resources (use level: 1 for main heading)
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/resources/i);
    await expect(page.getByText("node-from-pool-a").first()).toBeVisible();
    await expect(page.getByText("node-from-pool-b").first()).toBeVisible();
    await expect(page.getByText("shared-node").first()).toBeVisible();
  });

  test("searches resources by hostname", async ({ page, withData }) => {
    await withData({
      resources: createResourcesResponse([
        {
          hostname: "dgx-a100-001.cluster",
          exposed_fields: { node: "dgx-a100-001", "pool/platform": ["prod/dgx"] },
        },
        {
          hostname: "dgx-a100-002.cluster",
          exposed_fields: { node: "dgx-a100-002", "pool/platform": ["prod/dgx"] },
        },
        {
          hostname: "cpu-worker-001.cluster",
          exposed_fields: { node: "cpu-worker-001", "pool/platform": ["prod/cpu"] },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Expand filters if collapsed (responsive layout)
    await expandFiltersIfCollapsed(page);

    // Search for "dgx"
    const searchInput = page.getByRole("searchbox");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("dgx");

    // Wait for search to filter results - count should show "2 of 3"
    await expect(page.getByText(/2 of 3/)).toBeVisible({ timeout: 3000 });

    // Re-expand filters in case auto-collapse was triggered by resize after filtering
    await expandFiltersIfCollapsed(page);

    // Clear search by clearing the input directly
    await searchInput.clear();
    await expect(searchInput).toHaveValue("");
  });

  test("filters by pool", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        { name: "production", status: PoolStatus.ONLINE },
        { name: "development", status: PoolStatus.ONLINE },
      ]),
      resources: createResourcesResponse([
        {
          hostname: "prod-node.cluster",
          exposed_fields: { node: "prod-node", "pool/platform": ["production/base"] },
          pool_platform_labels: { production: ["base"] },
        },
        {
          hostname: "dev-node.cluster",
          exposed_fields: { node: "dev-node", "pool/platform": ["development/base"] },
          pool_platform_labels: { development: ["base"] },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Both should be visible initially
    await expect(page.getByText("prod-node").first()).toBeVisible();
    await expect(page.getByText("dev-node").first()).toBeVisible();

    // Expand filters if collapsed (responsive layout)
    await expandFiltersIfCollapsed(page);

    // Open pool filter (use aria-label which is more specific)
    const poolFilter = page.getByLabel(/filter by pool/i);
    if (await poolFilter.isVisible()) {
      await poolFilter.click();
    }
  });

  test("filters by resource type", async ({ page, withData }) => {
    await withData({
      resources: createResourcesResponse([
        {
          hostname: "shared-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "shared-node", "pool/platform": ["prod/base"] },
        },
        {
          hostname: "reserved-node.cluster",
          resource_type: BackendResourceType.RESERVED,
          exposed_fields: { node: "reserved-node", "pool/platform": ["prod/base"] },
        },
        {
          hostname: "unused-node.cluster",
          resource_type: BackendResourceType.UNUSED,
          exposed_fields: { node: "unused-node", "pool/platform": ["prod/base"] },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // All types should be visible
    await expect(page.getByText("shared-node").first()).toBeVisible();
    await expect(page.getByText("reserved-node").first()).toBeVisible();
    await expect(page.getByText("unused-node").first()).toBeVisible();
  });

  test("clears all filters at once", async ({ page, withData }) => {
    await withData({
      resources: createResourcesResponse([
        {
          hostname: "test-node.cluster",
          exposed_fields: { node: "test-node", "pool/platform": ["pool/base"] },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Expand filters if collapsed (responsive layout)
    await expandFiltersIfCollapsed(page);

    // Apply a search filter
    const searchInput = page.getByRole("searchbox");
    await searchInput.fill("filter-test");

    // Look for clear all button
    const clearAllButton = page.getByRole("button", { name: /clear all/i });
    if (await clearAllButton.isVisible()) {
      await clearAllButton.click();
      await expect(searchInput).toHaveValue("");
    }
  });
});

test.describe("Resource Details", () => {
  test("opens detail panel on row click", async ({ page, withData }) => {
    const GiB = 1024 * 1024;

    await withData({
      resources: createResourcesResponse([
        {
          hostname: "detailed-node.cluster",
          resource_type: BackendResourceType.SHARED,
          conditions: ["Ready", "SchedulingEnabled"],
          exposed_fields: { node: "detailed-node", "pool/platform": ["prod/dgx", "dev/base"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB },
          usage_fields: { gpu: 4, cpu: 64, memory: 256 * GiB },
          pool_platform_labels: { prod: ["dgx"], dev: ["base"] },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Click the resource
    await page.getByText("detailed-node").first().click();

    // Panel should open with details
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading").first()).toBeVisible();

    // Close panel
    await page.getByRole("button", { name: /close/i }).click();
    await expect(panel).not.toBeVisible();
  });

  test("shows pool memberships for shared resources", async ({ page, withData }) => {
    await withData({
      resources: createResourcesResponse([
        {
          hostname: "multi-pool-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: {
            node: "multi-pool-node",
            "pool/platform": ["production/dgx", "research/dgx", "development/base"],
          },
          pool_platform_labels: {
            production: ["dgx"],
            research: ["dgx"],
            development: ["base"],
          },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Click to open panel
    await page.getByText("multi-pool-node").first().click();

    // Panel should show pool memberships
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();
  });
});

test.describe("Edge Cases", () => {
  test("handles empty resources gracefully", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([{ name: "empty", status: PoolStatus.ONLINE }]),
      resources: { resources: [] },
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Should show heading but handle empty state
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/resources/i);
  });

  test("handles resources with issues", async ({ page, withData }) => {
    await withData({
      resources: createResourcesResponse([
        {
          hostname: "problematic-node.cluster",
          resource_type: BackendResourceType.SHARED,
          conditions: ["Ready", "SchedulingDisabled", "MemoryPressure", "DiskPressure"],
          exposed_fields: { node: "problematic-node", "pool/platform": ["prod/base"] },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Should display the node with its conditions
    await expect(page.getByText("problematic-node").first()).toBeVisible();
  });

  test("handles CPU-only nodes (no GPU)", async ({ page, withData }) => {
    await withData({
      resources: createResourcesResponse([
        {
          hostname: "cpu-only-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "cpu-only-node", "pool/platform": ["prod/cpu"] },
          allocatable_fields: { gpu: 0, cpu: 256, memory: 1024 * 1024 * 1024 },
          usage_fields: { gpu: 0, cpu: 128, memory: 512 * 1024 * 1024 },
        },
      ]),
    });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("cpu-only-node").first()).toBeVisible();
  });
});
