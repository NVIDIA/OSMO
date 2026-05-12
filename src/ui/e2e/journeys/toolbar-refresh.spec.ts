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
import { createPoolResponse, createWorkflowsResponse, PoolStatus, WorkflowStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupPools, setupProfile, setupWorkflows, setupOccupancy } from "@/e2e/utils/mock-setup";

/**
 * Auto-Refresh & Toolbar Interactions Journey Tests
 *
 * Architecture notes:
 * - RefreshControl is a compound button: Refresh + Auto-refresh dropdown (chevron)
 * - Auto-refresh dropdown: "Off", "5 seconds", "10 seconds", "30 seconds", "1 minute"
 * - The dropdown is a DropdownMenuRadioGroup with radio items
 * - aria-label="Auto-refresh settings" on the chevron button
 * - Occupancy toolbar additionally has: GroupBy toggle, Expand/Collapse all, Toggle columns
 * - Occupancy search uses TASK_GROUP_STATUS_PRESETS (Running, Pending, etc.)
 */

function createOccupancySummaries(
  entries: Array<{
    user: string;
    pool: string;
    gpu?: number;
    cpu?: number;
    priority?: string;
  }>,
) {
  return {
    summaries: entries.map((e) => ({
      user: e.user,
      pool: e.pool,
      gpu: e.gpu ?? 4,
      cpu: e.cpu ?? 32,
      memory: 64 * 1024 * 1024 * 1024,
      storage: 100 * 1024 * 1024 * 1024,
      priority: e.priority ?? "NORMAL",
    })),
  };
}

test.describe("Auto-Refresh Dropdown — Pools", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("auto-refresh settings button is visible in pools toolbar", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — chevron button with aria-label is visible
    await expect(page.getByRole("button", { name: "Auto-refresh settings" })).toBeVisible();
  });

  test("clicking auto-refresh settings opens interval dropdown", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Auto-refresh settings" }).click();

    // ASSERT — interval options are visible
    await expect(page.getByText("Refresh interval")).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "Off" })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "10 seconds" })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "30 seconds" })).toBeVisible();
  });

  test("selecting an auto-refresh interval closes dropdown", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Auto-refresh settings" }).click();
    await page.getByRole("menuitemradio", { name: "10 seconds" }).click();

    // ASSERT — dropdown closes
    await expect(page.getByText("Refresh interval")).not.toBeVisible();
  });
});

test.describe("Auto-Refresh Dropdown — Workflows", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupWorkflows(
      page,
      createWorkflowsResponse([{ name: "wf-1", status: WorkflowStatus.RUNNING, user: "user-1" }]),
    );
  });

  test("auto-refresh settings button is visible in workflows toolbar", async ({ page }) => {
    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByRole("button", { name: "Auto-refresh settings" })).toBeVisible();
  });

  test("auto-refresh dropdown shows interval options in workflows page", async ({ page }) => {
    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Auto-refresh settings" }).click();

    // ASSERT
    await expect(page.getByRole("menuitemradio", { name: "Off" })).toBeVisible();
    await expect(page.getByRole("menuitemradio", { name: "5 minutes" })).toBeVisible();
  });
});

test.describe("Occupancy Column Toggle & Search Presets", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("toggle columns button is visible in occupancy toolbar", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([{ user: "alice", pool: "prod", gpu: 8 }]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — toggle columns button in toolbar
    await expect(page.getByRole("button", { name: /toggle columns/i })).toBeVisible();
  });

  test("toggle columns button opens column visibility menu in occupancy", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([{ user: "alice", pool: "prod", gpu: 8 }]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /toggle columns/i }).click();

    // ASSERT — column visibility menu items appear
    await expect(page.getByRole("menuitemcheckbox").first()).toBeVisible();
  });

  test("occupancy search shows status presets in dropdown", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8 },
        { user: "bob", pool: "staging", gpu: 4 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByRole("combobox").first();
    await searchInput.click();

    // ASSERT — dropdown with preset pills appears
    const dropdown = page.locator(".fb-dropdown");
    await expect(dropdown).toBeVisible();
  });

  test("occupancy refresh button is visible", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([{ user: "alice", pool: "prod", gpu: 8 }]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — occupancy has a simple Refresh button (no auto-refresh dropdown)
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  });
});
