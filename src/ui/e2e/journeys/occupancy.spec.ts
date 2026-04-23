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
import {
  setupDefaultMocks,
  setupProfile,
  setupOccupancy,
} from "@/e2e/utils/mock-setup";

/**
 * Occupancy Page Journey Tests
 *
 * Architecture notes:
 * - Occupancy lives at /occupancy (client component, OccupancyPageContent)
 * - Fetches from /api/task?summary=true — returns (user, pool, priority) rows
 * - Client-side aggregation groups rows by pool (default) or user
 * - Shows 4 KPI summary cards: GPU, CPU, Memory, Storage
 * - Data table with expandable parent/child rows
 * - Toolbar has group-by toggle (By Pool / By User), search, expand/collapse all
 * - Default filter: status=Running (from TASK_STATE_CATEGORIES.running)
 * - Error state: "Unable to load occupancy data"
 * - Empty state: "No occupancy data available"
 */

function createOccupancySummaries(
  entries: Array<{
    user: string;
    pool: string;
    gpu?: number;
    cpu?: number;
    memory?: number;
    storage?: number;
    priority?: string;
  }>,
) {
  return {
    summaries: entries.map((e) => ({
      user: e.user,
      pool: e.pool,
      gpu: e.gpu ?? 4,
      cpu: e.cpu ?? 32,
      memory: e.memory ?? 64 * 1024 * 1024 * 1024,
      storage: e.storage ?? 100 * 1024 * 1024 * 1024,
      priority: e.priority ?? "NORMAL",
    })),
  };
}

test.describe("Occupancy Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows page title in breadcrumb", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(page, { summaries: [] });

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Occupancy").first()).toBeVisible();
  });

  test("shows summary KPI cards", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8, cpu: 64 },
        { user: "bob", pool: "prod", gpu: 4, cpu: 32 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — all 4 KPI cards are visible
    await expect(page.getByText("GPU").first()).toBeVisible();
    await expect(page.getByText("CPU").first()).toBeVisible();
    await expect(page.getByText("MEMORY").first()).toBeVisible();
    await expect(page.getByText("STORAGE").first()).toBeVisible();
  });

  test("shows group-by toggle with By Pool and By User options", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(page, { summaries: [] });

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — group-by radio options are visible
    const groupByRadioGroup = page.getByRole("radiogroup", { name: "Group by" });
    await expect(groupByRadioGroup).toBeVisible();
    await expect(groupByRadioGroup.getByText("By Pool")).toBeVisible();
    await expect(groupByRadioGroup.getByText("By User")).toBeVisible();
  });

  test("shows occupancy data grouped by pool by default", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8, cpu: 64 },
        { user: "bob", pool: "production", gpu: 4, cpu: 32 },
        { user: "alice", pool: "staging", gpu: 2, cpu: 16 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — pool names visible as group rows
    await expect(page.getByText("production").first()).toBeVisible();
    await expect(page.getByText("staging").first()).toBeVisible();
  });

  test("switching to By User groups data by user", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8, cpu: 64 },
        { user: "bob", pool: "production", gpu: 4, cpu: 32 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // Switch to By User
    const groupByRadioGroup = page.getByRole("radiogroup", { name: "Group by" });
    await groupByRadioGroup.getByText("By User").click();

    // ASSERT — user names visible as group rows
    await expect(page.getByText("alice").first()).toBeVisible();
    await expect(page.getByText("bob").first()).toBeVisible();

    // URL reflects groupBy parameter
    await expect(page).toHaveURL(/groupBy=user/);
  });

  test("shows empty state when no occupancy data", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(page, { summaries: [] });

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText(/no occupancy data/i).first()).toBeVisible();
  });

  test("shows error state when API fails", async ({ page }) => {
    // ARRANGE — use 400 to avoid TanStack Query retries on 5xx
    await setupOccupancy(page, { status: 400, detail: "Bad request" });

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — page must not crash, should show error
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText(/unable to load/i).first()).toBeVisible();
  });

  test("page title is set to Occupancy", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(page, { summaries: [] });

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page).toHaveTitle(/Occupancy/);
  });
});

test.describe("Occupancy Expand/Collapse", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("expand all button shows child rows", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8 },
        { user: "bob", pool: "production", gpu: 4 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // Click expand all button
    await page.getByRole("button", { name: /expand all/i }).click();

    // ASSERT — child rows (users under pool) become visible
    await expect(page.getByText("alice").first()).toBeVisible();
    await expect(page.getByText("bob").first()).toBeVisible();
  });

  test("collapse all button hides child rows", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8 },
        { user: "bob", pool: "production", gpu: 4 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // Expand all first
    await page.getByRole("button", { name: /expand all/i }).click();
    await expect(page.getByText("alice").first()).toBeVisible();

    // Now collapse all
    await page.getByRole("button", { name: /collapse all/i }).click();

    // ASSERT — the button text changes back to "expand all"
    await expect(page.getByRole("button", { name: /expand all/i })).toBeVisible();
  });
});

test.describe("Occupancy Search", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("search creates a filter chip", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8 },
        { user: "bob", pool: "staging", gpu: 4 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // Use the search combobox
    const searchInput = page.getByRole("combobox").first();
    await searchInput.fill("production");
    await searchInput.press("Enter");

    // ASSERT — filter chip is created and URL reflects active filter
    await expect(page).toHaveURL(/f=/);
  });

  test("shows multiple pools in the occupancy table", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8, cpu: 64 },
        { user: "bob", pool: "staging", gpu: 4, cpu: 32 },
        { user: "charlie", pool: "development", gpu: 2, cpu: 16 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — multiple pool names are visible as group rows
    await expect(page.getByText("production").first()).toBeVisible();
    await expect(page.getByText("staging").first()).toBeVisible();
    await expect(page.getByText("development").first()).toBeVisible();
  });
});
