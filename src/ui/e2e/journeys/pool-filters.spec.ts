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
 * Pool Filter Preset Journey Tests
 *
 * Architecture notes:
 * - Pool toolbar uses STATUS_PRESET_CONFIG with 3 status presets:
 *   Online (ONLINE), Maintenance (MAINTENANCE), Offline (OFFLINE)
 * - Status presets appear as pills in the dropdown (under "Status:" group)
 * - "My Pools" preset is a separate User group pill (amber)
 * - Filter chips are committed via URL params: f=status:online, etc.
 * - Clicking a preset toggles the corresponding status filter
 */

test.describe("Pool Status Filter Presets", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows status filter preset pills in dropdown when input is focused", async ({ page }) => {
    // ARRANGE
    await setupPools(page, createPoolResponse([{ name: "pool-1", status: PoolStatus.ONLINE }]));

    // ACT — focus the filter bar to open the dropdown
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    // ASSERT — dropdown shows all 3 status preset pills
    const dropdown = page.locator(".fb-dropdown");
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText("Online")).toBeVisible();
    await expect(dropdown.getByText("Maintenance")).toBeVisible();
    await expect(dropdown.getByText("Offline")).toBeVisible();
  });

  test("clicking Online preset adds status filter to URL", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        { name: "prod-pool", status: PoolStatus.ONLINE },
        { name: "maint-pool", status: PoolStatus.MAINTENANCE },
      ]),
    );

    // ACT — open dropdown and click Online preset
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Online").click();

    // ASSERT — URL reflects status filter
    await expect(page).toHaveURL(/f=status(%3A|:)online/);
  });

  test("clicking Offline preset adds offline status filter to URL", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        { name: "live-pool", status: PoolStatus.ONLINE },
        { name: "dead-pool", status: PoolStatus.OFFLINE },
      ]),
    );

    // ACT — open dropdown and click Offline preset
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Offline").click();

    // ASSERT — URL reflects offline status filter
    await expect(page).toHaveURL(/f=status(%3A|:)offline/);
  });

  test("clicking Maintenance preset adds maintenance status filter to URL", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        { name: "ok-pool", status: PoolStatus.ONLINE },
        { name: "maint-pool", status: PoolStatus.MAINTENANCE },
      ]),
    );

    // ACT — open dropdown and click Maintenance preset
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Maintenance").click();

    // ASSERT — URL reflects maintenance status filter
    await expect(page).toHaveURL(/f=status(%3A|:)maintenance/);
  });

  test("clicking a status preset again deactivates it", async ({ page }) => {
    // ARRANGE
    await setupPools(page, createPoolResponse([{ name: "pool-1", status: PoolStatus.ONLINE }]));

    // ACT — activate Online preset via dropdown
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Online").click();
    await expect(page).toHaveURL(/f=status(%3A|:)online/);

    // Click again to deactivate — re-open dropdown first
    await filterInput.click();
    await dropdown.getByText("Online").click();

    // ASSERT — status filter removed from URL
    await expect(page).not.toHaveURL(/f=status/);
  });
});

test.describe("Pool URL-Driven Filters", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("navigating with status filter in URL shows filtered results", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        { name: "online-pool", status: PoolStatus.ONLINE },
        { name: "offline-pool", status: PoolStatus.OFFLINE },
      ]),
    );

    // ACT — navigate with status filter pre-applied
    await page.goto("/pools?all=true&f=status:online");
    await page.waitForLoadState("networkidle");

    // ASSERT — only online pool is visible
    await expect(page.getByText("online-pool").first()).toBeVisible();
    await expect(page.getByText("offline-pool")).not.toBeVisible();
  });

  test("navigating with name filter in URL shows matching pools", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        { name: "production-gpu", status: PoolStatus.ONLINE },
        { name: "staging-cpu", status: PoolStatus.ONLINE },
      ]),
    );

    // ACT — navigate with pool name filter pre-applied
    await page.goto("/pools?all=true&f=pool:production");
    await page.waitForLoadState("networkidle");

    // ASSERT — only matching pool is visible
    await expect(page.getByText("production-gpu").first()).toBeVisible();
    await expect(page.getByText("staging-cpu")).not.toBeVisible();
  });

  test("combining status filter with name search narrows results", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        { name: "prod-online", status: PoolStatus.ONLINE },
        { name: "dev-online", status: PoolStatus.ONLINE },
        { name: "prod-offline", status: PoolStatus.OFFLINE },
      ]),
    );

    // ACT — apply Online status preset then search for "prod"
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Online").click();

    // URL now has status filter
    await expect(page).toHaveURL(/f=status(%3A|:)online/);

    // Now add a name search
    await filterInput.fill("prod");
    await filterInput.press("Enter");

    // ASSERT — URL has both filters
    await expect(page).toHaveURL(/f=.*status/);
    await expect(page).toHaveURL(/f=.*pool(%3A|:)prod|prod.*pool/);
  });
});

test.describe("Pool Empty and Error States with Filters", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows empty state when no pools match filter criteria", async ({ page }) => {
    // ARRANGE — only offline pools
    await setupPools(page, createPoolResponse([{ name: "down-pool", status: PoolStatus.OFFLINE }]));

    // ACT — navigate with online filter (no match)
    await page.goto("/pools?all=true&f=status:online");
    await page.waitForLoadState("networkidle");

    // ASSERT — the offline pool is not visible (filtered out)
    await expect(page.getByText("down-pool")).not.toBeVisible();
  });

  test("empty pool list shows appropriate state", async ({ page }) => {
    // ARRANGE — empty pool list
    await setupPools(page, createPoolResponse([]));

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without crashing
    await expect(page.locator("body")).not.toBeEmpty();
    // The toolbar should still be visible
    await expect(page.getByRole("combobox").first()).toBeVisible();
  });
});
