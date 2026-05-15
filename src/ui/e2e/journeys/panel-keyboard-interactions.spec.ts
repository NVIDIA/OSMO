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
import { createPoolResponse, createResourcesResponse, BackendResourceType, PoolStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupPools, setupResources, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Panel Keyboard Interaction Journey Tests
 *
 * Architecture notes:
 * - Panels use usePanelEscape hook: ESC closes panel when focus is within it
 * - Pool panel: <aside role="complementary" aria-label="Pool details: {name}">
 * - Resource panel: <aside role="complementary" aria-label="Resource details: {name}">
 * - Close button: role="button", name="Close panel"
 * - Panels have focus scoping: ESC only fires when panel has focus
 * - Panels update URL state: ?view=name (present when open, removed when closed)
 */

test.describe("Pool Panel Keyboard Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("closes pool panel with close button and clears URL state", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "closeable-pool",
          status: PoolStatus.ONLINE,
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=closeable-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: closeable-pool" });
    await expect(panel).toBeVisible();

    // Click close button
    await page.getByRole("button", { name: "Close panel" }).click();

    // ASSERT — panel is closed and URL is cleared
    await expect(page).not.toHaveURL(/view=/);
    await expect(panel).not.toBeVisible();
  });

  test("pool panel renders accessible heading with pool name", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "accessible-pool",
          status: PoolStatus.ONLINE,
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=accessible-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — panel has correct accessible label and heading
    const panel = page.getByRole("complementary", { name: "Pool details: accessible-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading").first()).toContainText("accessible-pool");
  });

  test("pool panel shows pool description when set", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "described-pool",
          status: PoolStatus.ONLINE,
          description: "Production GPU cluster for training workloads",
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=described-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — description is visible in panel
    const panel = page.getByRole("complementary", { name: "Pool details: described-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Production GPU cluster for training workloads")).toBeVisible();
  });
});

test.describe("Resource Panel Keyboard Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
  });

  test("closes resource panel with close button", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "closeable-res.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "closeable-res", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=closeable-res");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Resource details: closeable-res" });
    await expect(panel).toBeVisible();

    // Click close button
    await page.getByRole("button", { name: "Close panel" }).click();

    // ASSERT
    await expect(page).not.toHaveURL(/view=/);
    await expect(panel).not.toBeVisible();
  });

  test("resource panel shows correct heading", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "heading-res.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "heading-res", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=heading-res");
    await page.waitForLoadState("networkidle");

    // ASSERT
    const panel = page.getByRole("complementary", { name: "Resource details: heading-res" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading").first()).toContainText("heading-res");
  });

  test("clicking a different resource row switches panel to new resource", async ({ page }) => {
    // ARRANGE — two resources
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "res-alpha.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "res-alpha", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
        {
          hostname: "res-beta.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "res-beta", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
      ]),
    );

    // ACT — open first resource panel
    await page.goto("/resources?view=res-alpha");
    await page.waitForLoadState("networkidle");

    const panelAlpha = page.getByRole("complementary", { name: "Resource details: res-alpha" });
    await expect(panelAlpha).toBeVisible();

    // Click second resource in the table
    await page.getByText("res-beta").first().click();

    // ASSERT — URL switches to the new resource
    await expect(page).toHaveURL(/view=res-beta/);
    const panelBeta = page.getByRole("complementary", { name: "Resource details: res-beta" });
    await expect(panelBeta).toBeVisible();
  });
});

test.describe("Pool Panel Quick Links Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("Resources link navigates to resources with pool filter", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([{ name: "nav-pool", status: PoolStatus.ONLINE }]),
    );

    // ACT
    await page.goto("/pools?all=true&view=nav-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: nav-pool" });
    await expect(panel).toBeVisible();

    // Click the Resources link
    const resourcesLink = panel.getByRole("link", { name: /resources/i });
    await expect(resourcesLink).toBeVisible();
    const href = await resourcesLink.getAttribute("href");

    // ASSERT — link points to /resources with pool filter
    expect(href).toContain("/resources");
    expect(href).toContain("nav-pool");
  });

  test("Workflows link navigates to workflows with pool filter", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([{ name: "wf-pool", status: PoolStatus.ONLINE }]),
    );

    // ACT
    await page.goto("/pools?all=true&view=wf-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: wf-pool" });
    await expect(panel).toBeVisible();

    // Click the Workflows link
    const workflowsLink = panel.getByRole("link", { name: /workflows/i });
    await expect(workflowsLink).toBeVisible();
    const href = await workflowsLink.getAttribute("href");

    // ASSERT — link points to /workflows with pool filter
    expect(href).toContain("/workflows");
    expect(href).toContain("wf-pool");
  });
});
