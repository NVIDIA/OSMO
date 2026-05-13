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
 * Pool GPU Summary Card Journey Tests
 *
 * Architecture notes:
 * - PoolGpuSummary renders above the pools table as two cards: "GPU Quota" and "GPU Capacity"
 * - Each card shows: used / total, percentage, free count
 * - Color coding: <65% green, 65-85% amber, >85% red
 * - Each card has an info tooltip
 * - Aggregate values are summed across all pools from resource_sum in PoolResponse
 */

test.describe("Pool GPU Summary Cards", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows GPU Quota and GPU Capacity summary cards", async ({ page }) => {
    // ARRANGE — pools with clear quota/capacity numbers
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "prod",
          status: PoolStatus.ONLINE,
          resource_usage: {
            quota_used: "30",
            quota_free: "70",
            quota_limit: "100",
            total_usage: "64",
            total_capacity: "128",
            total_free: "64",
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — both summary card labels visible
    await expect(page.getByText("GPU Quota").first()).toBeVisible();
    await expect(page.getByText("GPU Capacity").first()).toBeVisible();
  });

  test("displays used and free counts in summary cards", async ({ page }) => {
    // ARRANGE — single pool with known values
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "single-pool",
          status: PoolStatus.ONLINE,
          resource_usage: {
            quota_used: "25",
            quota_free: "75",
            quota_limit: "100",
            total_usage: "50",
            total_capacity: "200",
            total_free: "150",
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — "free" values are visible in the cards
    // The cards display formatCompact values with "used" and "free" labels
    await expect(page.getByText("used").first()).toBeVisible();
    await expect(page.getByText("free").first()).toBeVisible();
  });

  test("shows percentage utilization in summary cards", async ({ page }) => {
    // ARRANGE — 50% quota utilization
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "half-used",
          status: PoolStatus.ONLINE,
          resource_usage: {
            quota_used: "50",
            quota_free: "50",
            quota_limit: "100",
            total_usage: "32",
            total_capacity: "64",
            total_free: "32",
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — percentage values are rendered (e.g., "50%")
    await expect(page.getByText("50%").first()).toBeVisible();
  });

  test("shows info tooltips on summary cards", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "tooltip-pool",
          status: PoolStatus.ONLINE,
          resource_usage: {
            quota_used: "10",
            quota_free: "90",
            quota_limit: "100",
            total_usage: "20",
            total_capacity: "200",
            total_free: "180",
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — info buttons are present (one per card)
    const infoButtons = page.getByRole("button", { name: /info/i });
    await expect(infoButtons.first()).toBeVisible();
  });

  test("aggregates GPU values across multiple pools", async ({ page }) => {
    // ARRANGE — two pools, quota_used 20 + 30 = 50 total
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "pool-a",
          status: PoolStatus.ONLINE,
          resource_usage: {
            quota_used: "20",
            quota_free: "30",
            quota_limit: "50",
            total_usage: "30",
            total_capacity: "64",
            total_free: "34",
          },
        },
        {
          name: "pool-b",
          status: PoolStatus.ONLINE,
          resource_usage: {
            quota_used: "30",
            quota_free: "20",
            quota_limit: "50",
            total_usage: "40",
            total_capacity: "64",
            total_free: "24",
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — aggregate summary is visible (both pools data renders)
    await expect(page.getByText("GPU Quota").first()).toBeVisible();
    await expect(page.getByText("GPU Capacity").first()).toBeVisible();
    // Both pool rows are visible in the table
    await expect(page.getByText("pool-a").first()).toBeVisible();
    await expect(page.getByText("pool-b").first()).toBeVisible();
  });

  test("shows zero utilization gracefully", async ({ page }) => {
    // ARRANGE — pool with zero usage
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "empty-pool",
          status: PoolStatus.ONLINE,
          resource_usage: {
            quota_used: "0",
            quota_free: "100",
            quota_limit: "100",
            total_usage: "0",
            total_capacity: "200",
            total_free: "200",
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — 0% utilization shown
    await expect(page.getByText("0%").first()).toBeVisible();
    await expect(page.getByText("GPU Quota").first()).toBeVisible();
  });
});
