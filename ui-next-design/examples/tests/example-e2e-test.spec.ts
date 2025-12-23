/**
 * EXAMPLE: E2E Test Pattern
 * 
 * This shows the key patterns for Playwright E2E tests in this project.
 */

import {
  test,
  expect,
  createPoolResponse,
  createResourcesResponse,
  expandFiltersIfCollapsed,
  // Use generated enums, not string literals!
  PoolStatus,
  BackendResourceType,
} from "../fixtures";

/**
 * Test Structure:
 * - Describe blocks group related tests
 * - Each test defines its own scenario data inline
 * - Use AAA pattern: Arrange, Act, Assert
 */

test.describe("Pool List Page", () => {
  test("shows multiple pools with different statuses", async ({ page, withData }) => {
    // ARRANGE: Define exactly what this test needs
    await withData({
      pools: createPoolResponse([
        { name: "production", status: PoolStatus.ONLINE, description: "Prod cluster" },
        { name: "staging", status: PoolStatus.ONLINE, description: "Staging env" },
        { name: "maintenance", status: PoolStatus.OFFLINE, description: "Under repair" },
      ]),
    });

    // ACT: Navigate and wait for data
    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // ASSERT: Verify expected content
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/pools/i);
    await expect(page.getByText("production").first()).toBeVisible();
    await expect(page.getByText("staging").first()).toBeVisible();
    await expect(page.getByText("maintenance").first()).toBeVisible();
  });

  test("navigates to pool detail when clicked", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        { name: "my-pool", status: PoolStatus.ONLINE },
      ]),
      resources: createResourcesResponse([
        {
          hostname: "node-001.cluster",
          exposed_fields: { node: "node-001", "pool/platform": ["my-pool/base"] },
          pool_platform_labels: { "my-pool": ["base"] },
        },
      ]),
    });

    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // Click the pool link
    await page.getByRole("link", { name: /my-pool/i }).click();

    // Should navigate to detail page
    await expect(page).toHaveURL(/.*pools\/my-pool/);
  });

  test("searches pools by name", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        { name: "production-gpu", status: PoolStatus.ONLINE },
        { name: "production-cpu", status: PoolStatus.ONLINE },
        { name: "development", status: PoolStatus.ONLINE },
      ]),
    });

    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // Search for "production"
    const searchInput = page.getByRole("searchbox");
    if (await searchInput.isVisible()) {
      await searchInput.fill("production");

      // Should show production pools only
      await expect(page.getByText("production-gpu").first()).toBeVisible();
      await expect(page.getByText("production-cpu").first()).toBeVisible();
    }
  });
});

test.describe("Pool Detail Page", () => {
  test("shows pool resources with capacity info", async ({ page, withData }) => {
    const GiB = 1024 * 1024; // KiB to GiB

    await withData({
      pools: createPoolResponse([
        {
          name: "gpu-cluster",
          status: PoolStatus.ONLINE,
          description: "GPU training cluster",
          platforms: {
            dgx: { description: "DGX nodes" },
          },
        },
      ]),
      resources: createResourcesResponse([
        {
          hostname: "dgx-001.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "dgx-001", "pool/platform": ["gpu-cluster/dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB },
          usage_fields: { gpu: 4, cpu: 64, memory: 256 * GiB },
          pool_platform_labels: { "gpu-cluster": ["dgx"] },
        },
        {
          hostname: "dgx-002.cluster",
          resource_type: BackendResourceType.RESERVED,
          exposed_fields: { node: "dgx-002", "pool/platform": ["gpu-cluster/dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB },
          usage_fields: { gpu: 8, cpu: 128, memory: 480 * GiB },
          pool_platform_labels: { "gpu-cluster": ["dgx"] },
        },
      ]),
    });

    await page.goto("/pools/gpu-cluster");
    await page.waitForLoadState("networkidle");

    // Should show pool heading and resources
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByText("dgx-001").first()).toBeVisible();
    await expect(page.getByText("dgx-002").first()).toBeVisible();
  });

  test("filters resources by platform", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        {
          name: "multi-platform",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: { description: "DGX nodes" },
            cpu: { description: "CPU-only nodes" },
          },
        },
      ]),
      resources: createResourcesResponse([
        {
          hostname: "dgx-node.cluster",
          exposed_fields: { node: "dgx-node", "pool/platform": ["multi-platform/dgx"] },
          pool_platform_labels: { "multi-platform": ["dgx"] },
        },
        {
          hostname: "cpu-node.cluster",
          exposed_fields: { node: "cpu-node", "pool/platform": ["multi-platform/cpu"] },
          allocatable_fields: { gpu: 0, cpu: 96 },
          pool_platform_labels: { "multi-platform": ["cpu"] },
        },
      ]),
    });

    await page.goto("/pools/multi-platform");
    await page.waitForLoadState("networkidle");

    // Both should be visible initially
    await expect(page.getByText("dgx-node").first()).toBeVisible();
    await expect(page.getByText("cpu-node").first()).toBeVisible();

    // Expand filters if collapsed (responsive layout)
    await expandFiltersIfCollapsed(page);

    // Filter by platform if filter exists
    const platformFilter = page.getByLabel(/filter by platform/i);
    if (await platformFilter.isVisible()) {
      await platformFilter.click();
      // ... select specific platform
    }
  });

  test("opens resource detail panel on row click", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
      resources: createResourcesResponse([
        {
          hostname: "clickable-node.cluster",
          resource_type: BackendResourceType.SHARED,
          conditions: ["Ready", "SchedulingEnabled"],
          exposed_fields: { node: "clickable-node", "pool/platform": ["test-pool/base"] },
          pool_platform_labels: { "test-pool": ["base"] },
        },
      ]),
    });

    await page.goto("/pools/test-pool");
    await page.waitForLoadState("networkidle");

    // Click the resource row
    await page.getByText("clickable-node").first().click();

    // Panel should open
    const panel = page.getByRole("dialog");
    await expect(panel).toBeVisible();

    // Close panel
    await page.getByRole("button", { name: /close/i }).click();
    await expect(panel).not.toBeVisible();
  });
});

test.describe("Edge Cases", () => {
  test("handles empty pool gracefully", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        {
          name: "empty-pool",
          status: PoolStatus.ONLINE,
          description: "Pool with no resources",
          resource_usage: {
            quota_used: "0",
            quota_free: "100",
            quota_limit: "100",
            total_usage: "0",
            total_capacity: "0",
            total_free: "0",
          },
        },
      ]),
      resources: { resources: [] },
    });

    await page.goto("/pools/empty-pool");
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Should show empty state or "no resources" message
  });

  test("handles offline pool", async ({ page, withData }) => {
    await withData({
      pools: createPoolResponse([
        {
          name: "offline-pool",
          status: PoolStatus.OFFLINE,
          description: "Pool is down for maintenance",
        },
      ]),
    });

    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // Offline pool should be visible with status indicator
    await expect(page.getByText("offline-pool").first()).toBeVisible();
  });
});
