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
 * Pool Panel Quick Links Tests
 *
 * Tests the "Quick Links" section in panel-content.tsx:
 * - Resources link: /resources?f=pool:{poolName}
 * - Workflows link: /workflows?f=pool:{poolName}&all=true
 * - Occupancy link: /occupancy?f=pool:{poolName}&groupBy=pool
 * - All links are visible and contain correct href values
 */

test.describe("Pool Panel Quick Links", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows Quick Links section heading", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "links-pool",
          status: PoolStatus.ONLINE,
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=links-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT
    const panel = page.getByRole("complementary", { name: "Pool details: links-pool" });
    await expect(panel.getByText("Quick Links")).toBeVisible();
  });

  test("shows Resources link with correct href", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "res-link-pool",
          status: PoolStatus.ONLINE,
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=res-link-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — Resources link points to /resources filtered by pool
    const panel = page.getByRole("complementary", { name: "Pool details: res-link-pool" });
    const resourcesLink = panel.getByRole("link", { name: /Resources/ });
    await expect(resourcesLink).toBeVisible();
    await expect(resourcesLink).toHaveAttribute("href", /\/resources\?f=pool.*res-link-pool/);
  });

  test("shows Workflows link with correct href", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "wf-link-pool",
          status: PoolStatus.ONLINE,
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=wf-link-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — Workflows link points to /workflows filtered by pool with all=true
    const panel = page.getByRole("complementary", { name: "Pool details: wf-link-pool" });
    const workflowsLink = panel.getByRole("link", { name: /Workflows/ });
    await expect(workflowsLink).toBeVisible();
    await expect(workflowsLink).toHaveAttribute("href", /\/workflows\?f=pool.*wf-link-pool.*all=true/);
  });

  test("shows Occupancy link with correct href", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "occ-link-pool",
          status: PoolStatus.ONLINE,
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=occ-link-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — Occupancy link points to /occupancy filtered by pool with groupBy=pool
    const panel = page.getByRole("complementary", { name: "Pool details: occ-link-pool" });
    const occupancyLink = panel.getByRole("link", { name: /Occupancy/ });
    await expect(occupancyLink).toBeVisible();
    await expect(occupancyLink).toHaveAttribute("href", /\/occupancy\?f=pool.*occ-link-pool.*groupBy=pool/);
  });

  test("quick links show descriptive subtitles", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "subtitle-pool",
          status: PoolStatus.ONLINE,
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=subtitle-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — subtitle text for each link
    const panel = page.getByRole("complementary", { name: "Pool details: subtitle-pool" });
    await expect(panel.getByText("View compute resources in this pool")).toBeVisible();
    await expect(panel.getByText("View workflows that ran on this pool")).toBeVisible();
    await expect(panel.getByText("View GPU usage by user in this pool")).toBeVisible();
  });
});
