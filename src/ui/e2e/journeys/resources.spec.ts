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
import { createResourcesResponse, createPoolResponse, BackendResourceType, PoolStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupResources, setupPools } from "@/e2e/utils/mock-setup";

/**
 * Resources Page Journey Tests
 *
 * Architecture notes:
 * - Resources live at /resources (flat table with side panel, no /resources/[name] routes)
 * - Resource selection: click row → ?view=resource-name opens the details panel
 * - Panel is an <aside> (role="complementary", aria-label="Resource details: {name}")
 * - resource.name = exposed_fields.node (e.g. "gpu-node" from hostname "gpu-node.cluster")
 * - Resources with no pool memberships are skipped by the adapter
 * - URL state: ?view=name (panel), ?f=resource:name (chip filter), ?f=pool:name (pool filter)
 * - Search creates chips on Enter (role="combobox", not role="searchbox")
 */

test.describe("Resources List", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
  });

  test("shows resources from all pools", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "node-a.cluster",
        exposed_fields: { node: "node-a", "pool/platform": ["pool-a/base"] },
        pool_platform_labels: { "pool-a": ["base"] },
      },
      {
        hostname: "node-b.cluster",
        exposed_fields: { node: "node-b", "pool/platform": ["pool-b/gpu"] },
        pool_platform_labels: { "pool-b": ["gpu"] },
      },
    ]));

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("node-a").first()).toBeVisible();
    await expect(page.getByText("node-b").first()).toBeVisible();
  });

  test("search creates a filter chip for the typed resource name", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "dgx-001.cluster",
        exposed_fields: { node: "dgx-001", "pool/platform": ["prod/dgx"] },
        pool_platform_labels: { prod: ["dgx"] },
      },
      {
        hostname: "dgx-002.cluster",
        exposed_fields: { node: "dgx-002", "pool/platform": ["prod/dgx"] },
        pool_platform_labels: { prod: ["dgx"] },
      },
      {
        hostname: "cpu-001.cluster",
        exposed_fields: { node: "cpu-001", "pool/platform": ["prod/cpu"] },
        pool_platform_labels: { prod: ["cpu"] },
      },
    ]));

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // The search input is a combobox (chip-based filter, not free-text search)
    const searchInput = page.getByRole("combobox");
    await searchInput.fill("dgx");
    await searchInput.press("Enter");

    // Pressing Enter commits a chip — the URL reflects the active filter with the value
    await expect(page).toHaveURL(/f=resource(%3A|:)dgx/);
    // Matched resources remain visible
    await expect(page.getByText("dgx-001").first()).toBeVisible();
    // Non-matching resource is filtered out
    await expect(page.getByText("cpu-001")).not.toBeVisible();
  });

  test("pool filter chip via URL shows only that pool's resources", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
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
    ]));

    // Navigate with a pool chip pre-applied
    await page.goto("/resources?f=pool:production");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("prod-node").first()).toBeVisible();
    await expect(page.getByText("dev-node")).not.toBeVisible();
  });

  test("shows all resource types in the table", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "shared-node.cluster",
        resource_type: BackendResourceType.SHARED,
        exposed_fields: { node: "shared-node", "pool/platform": ["prod/base"] },
        pool_platform_labels: { prod: ["base"] },
      },
      {
        hostname: "reserved-node.cluster",
        resource_type: BackendResourceType.RESERVED,
        exposed_fields: { node: "reserved-node", "pool/platform": ["prod/base"] },
        pool_platform_labels: { prod: ["base"] },
      },
      {
        hostname: "unused-node.cluster",
        resource_type: BackendResourceType.UNUSED,
        exposed_fields: { node: "unused-node", "pool/platform": ["prod/base"] },
        pool_platform_labels: { prod: ["base"] },
      },
    ]));

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("shared-node").first()).toBeVisible();
    await expect(page.getByText("reserved-node").first()).toBeVisible();
    await expect(page.getByText("unused-node").first()).toBeVisible();
  });
});

test.describe("Resource Panel", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    // Panel's useResourceDetail fetches both /api/resources and /api/pool_quota
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
  });

  test("clicking a resource row opens the details panel", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "gpu-node.cluster",
        exposed_fields: { node: "gpu-node", "pool/platform": ["prod/dgx"] },
        pool_platform_labels: { prod: ["dgx"] },
      },
    ]));

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    await page.getByText("gpu-node").first().click();

    // URL state reflects the selection
    await expect(page).toHaveURL(/view=gpu-node/);

    // Panel opens with resource name
    const panel = page.getByRole("complementary", { name: "Resource details: gpu-node" });
    await expect(panel).toBeVisible();
  });

  test("navigating directly to a resource opens its panel", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "direct-node.cluster",
        exposed_fields: { node: "direct-node", "pool/platform": ["prod/dgx"] },
        pool_platform_labels: { prod: ["dgx"] },
      },
    ]));

    await page.goto("/resources?view=direct-node");
    await page.waitForLoadState("networkidle");

    // Panel is open without any clicking
    const panel = page.getByRole("complementary", { name: "Resource details: direct-node" });
    await expect(panel).toBeVisible();
  });

  test("closes with the close button and clears URL state", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "closeable-node.cluster",
        exposed_fields: { node: "closeable-node", "pool/platform": ["prod/base"] },
        pool_platform_labels: { prod: ["base"] },
      },
    ]));

    await page.goto("/resources?view=closeable-node");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Resource details: closeable-node" });
    await expect(panel).toBeVisible();

    await page.getByRole("button", { name: "Close panel" }).click();

    await expect(page).not.toHaveURL(/view=/);
    await expect(panel).not.toBeVisible();
  });

  test("shows resource name in panel header", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "named-node.cluster",
        exposed_fields: { node: "named-node", "pool/platform": ["prod/dgx"] },
        pool_platform_labels: { prod: ["dgx"] },
      },
    ]));

    await page.goto("/resources?view=named-node");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Resource details: named-node" });
    await expect(panel.getByRole("heading").first()).toContainText("named-node");
  });
});

test.describe("Resource Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
  });

  test("shows error state when resource API fails", async ({ page }) => {
    // Use 400 to avoid TanStack Query retries (5xx errors are retried with backoff)
    await setupResources(page, { status: 400, detail: "Bad request" });

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText(/unable to load/i)).toBeVisible();
  });

  test("shows resources with node conditions", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "problematic-node.cluster",
        conditions: ["Ready", "SchedulingDisabled", "MemoryPressure"],
        exposed_fields: { node: "problematic-node", "pool/platform": ["prod/base"] },
        pool_platform_labels: { prod: ["base"] },
      },
    ]));

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("problematic-node").first()).toBeVisible();
  });

  test("shows CPU-only nodes with zero GPU", async ({ page }) => {
    await setupResources(page, createResourcesResponse([
      {
        hostname: "cpu-only-node.cluster",
        resource_type: BackendResourceType.SHARED,
        exposed_fields: { node: "cpu-only-node", "pool/platform": ["prod/cpu"] },
        pool_platform_labels: { prod: ["cpu"] },
        allocatable_fields: { gpu: 0, cpu: 256, memory: 1024 * 1024, storage: 0 },
        usage_fields: { gpu: 0, cpu: 128, memory: 512 * 1024, storage: 0 },
      },
    ]));

    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("cpu-only-node").first()).toBeVisible();
  });
});
