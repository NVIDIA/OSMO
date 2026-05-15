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
import { createResourcesResponse, BackendResourceType } from "@/mocks/factories";
import { setupDefaultMocks, setupResources } from "@/e2e/utils/mock-setup";

/**
 * Resource Filter Journey Tests
 *
 * Architecture notes:
 * - Resource toolbar uses filter bar with filter presets
 * - Filter chips are committed via URL params: f=resource:name, f=pool:name, f=type:SHARED
 * - URL-driven filters: navigating with pre-applied f= params filters the table
 * - Column visibility toggle shows/hides columns
 * - Refresh button triggers data re-fetch
 */

test.describe("Resource Filter Presets", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "shared-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "shared-node", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
        {
          hostname: "reserved-node.cluster",
          resource_type: BackendResourceType.RESERVED,
          exposed_fields: { node: "reserved-node", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
        {
          hostname: "unused-node.cluster",
          resource_type: BackendResourceType.UNUSED,
          exposed_fields: { node: "unused-node", "pool/platform": ["staging/base"] },
          pool_platform_labels: { staging: ["base"] },
        },
      ]),
    );
  });

  test("shows status filter preset pills when dropdown opens", async ({ page }) => {
    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    // ASSERT — dropdown opens with preset pills
    const dropdown = page.locator(".fb-dropdown");
    await expect(dropdown).toBeVisible();
  });

  test("pool filter via URL shows only that pool's resources", async ({ page }) => {
    // ACT — navigate with a pool filter pre-applied
    await page.goto("/resources?f=pool:prod");
    await page.waitForLoadState("networkidle");

    // ASSERT — prod resources visible, staging resource filtered out
    await expect(page.getByText("shared-node").first()).toBeVisible();
    await expect(page.getByText("reserved-node").first()).toBeVisible();
    await expect(page.getByText("unused-node")).not.toBeVisible();
  });

  test("multiple pool filters via URL narrows results to matching pools", async ({ page }) => {
    // ACT — navigate with both pools
    await page.goto("/resources?f=pool:prod&f=pool:staging");
    await page.waitForLoadState("networkidle");

    // ASSERT — all resources visible since both pools are included
    await expect(page.getByText("shared-node").first()).toBeVisible();
    await expect(page.getByText("unused-node").first()).toBeVisible();
  });

  test("resource name filter chip narrows results to matching names", async ({ page }) => {
    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByRole("combobox");
    await searchInput.fill("shared");
    await searchInput.press("Enter");

    // ASSERT — only shared-node visible
    await expect(page).toHaveURL(/f=resource(%3A|:)shared/);
    await expect(page.getByText("shared-node").first()).toBeVisible();
    await expect(page.getByText("reserved-node")).not.toBeVisible();
    await expect(page.getByText("unused-node")).not.toBeVisible();
  });

  test("toggle columns button opens column visibility menu", async ({ page }) => {
    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    const toggleButton = page.getByRole("button", { name: /toggle columns/i });
    await toggleButton.click();

    // ASSERT — column visibility popover opens with menu items
    await expect(page.getByRole("menuitemcheckbox").first()).toBeVisible();
  });

  test("refresh button is visible in the toolbar", async ({ page }) => {
    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — refresh button exists
    await expect(page.getByRole("button", { name: /refresh/i })).toBeVisible();
  });
});

test.describe("Resource URL Filter State", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "prod-node-1.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "prod-node-1", "pool/platform": ["production/dgx"] },
          pool_platform_labels: { production: ["dgx"] },
        },
        {
          hostname: "prod-node-2.cluster",
          resource_type: BackendResourceType.RESERVED,
          exposed_fields: { node: "prod-node-2", "pool/platform": ["production/cpu"] },
          pool_platform_labels: { production: ["cpu"] },
        },
        {
          hostname: "dev-node-1.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "dev-node-1", "pool/platform": ["development/base"] },
          pool_platform_labels: { development: ["base"] },
        },
      ]),
    );
  });

  test("navigating with pre-applied resource filter shows filtered results", async ({ page }) => {
    // ACT — navigate with a resource name filter
    await page.goto("/resources?f=resource:prod-node-1");
    await page.waitForLoadState("networkidle");

    // ASSERT — filtered resource is visible
    await expect(page.getByText("prod-node-1").first()).toBeVisible();
    await expect(page.getByText("dev-node-1")).not.toBeVisible();
  });

  test("navigating with pool filter shows pool-scoped resources", async ({ page }) => {
    // ACT — navigate with pool filter
    await page.goto("/resources?f=pool:development");
    await page.waitForLoadState("networkidle");

    // ASSERT — only development pool resources visible
    await expect(page.getByText("dev-node-1").first()).toBeVisible();
    await expect(page.getByText("prod-node-1")).not.toBeVisible();
  });

  test("combining resource and pool filters narrows results", async ({ page }) => {
    // ACT — navigate with both pool and resource filters
    await page.goto("/resources?f=pool:production&f=resource:prod-node-1");
    await page.waitForLoadState("networkidle");

    // ASSERT — only prod-node-1 matches both filters
    await expect(page.getByText("prod-node-1").first()).toBeVisible();
    await expect(page.getByText("prod-node-2")).not.toBeVisible();
    await expect(page.getByText("dev-node-1")).not.toBeVisible();
  });
});
