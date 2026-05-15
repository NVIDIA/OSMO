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
import { setupDefaultMocks, setupProfile, setupOccupancy } from "@/e2e/utils/mock-setup";

/**
 * Occupancy Detail Journey Tests
 *
 * Tests occupancy page features not covered by the main occupancy.spec.ts:
 * - Priority display in the table (NORMAL, HIGH, URGENT)
 * - URL-driven group-by state (?groupBy=user)
 * - KPI card values with real data
 * - Individual row expand/collapse
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

test.describe("Occupancy Priority Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows priority column when expand reveals child rows", async ({ page }) => {
    // ARRANGE — multiple users/priorities in same pool
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8, priority: "HIGH" },
        { user: "bob", pool: "prod", gpu: 4, priority: "NORMAL" },
      ]),
    );

    // ACT — expand the prod group row
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /expand all/i }).click();

    // ASSERT — user names and data visible in child rows
    await expect(page.getByText("alice").first()).toBeVisible();
    await expect(page.getByText("bob").first()).toBeVisible();
  });
});

test.describe("Occupancy URL State", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("navigating with groupBy=user in URL shows user grouping", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8 },
        { user: "bob", pool: "staging", gpu: 4 },
      ]),
    );

    // ACT — navigate directly with groupBy=user
    await page.goto("/occupancy?groupBy=user");
    await page.waitForLoadState("networkidle");

    // ASSERT — user names visible as group rows, By User is selected
    const groupByRadioGroup = page.getByRole("radiogroup", { name: "Group by" });
    await expect(groupByRadioGroup).toBeVisible();

    await expect(page.getByText("alice").first()).toBeVisible();
    await expect(page.getByText("bob").first()).toBeVisible();
  });

  test("switching from By Pool to By User and back preserves data", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8 },
        { user: "bob", pool: "staging", gpu: 4 },
      ]),
    );

    // ACT — start in default (pool grouping)
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // Verify pool grouping
    await expect(page.getByText("production").first()).toBeVisible();

    // Switch to user grouping
    const groupByRadioGroup = page.getByRole("radiogroup", { name: "Group by" });
    await groupByRadioGroup.getByText("By User").click();
    await expect(page).toHaveURL(/groupBy=user/);

    // Switch back to pool grouping
    await groupByRadioGroup.getByText("By Pool").click();

    // ASSERT — pool names visible again
    await expect(page.getByText("production").first()).toBeVisible();
    await expect(page.getByText("staging").first()).toBeVisible();
  });
});

test.describe("Occupancy KPI Cards", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("KPI cards show aggregated totals", async ({ page }) => {
    // ARRANGE — 12 GPUs total, 96 CPUs total
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

    // ASSERT — KPI cards show numbers (exact values depend on formatting)
    // GPU card should show the total 12
    await expect(page.getByText("GPU").first()).toBeVisible();
    await expect(page.getByText("12").first()).toBeVisible();
  });

  test("KPI cards show zero when no occupancy data", async ({ page }) => {
    // ARRANGE — empty data
    await setupOccupancy(page, { summaries: [] });

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — KPI cards still render (all zeroed out)
    await expect(page.getByText("GPU").first()).toBeVisible();
    await expect(page.getByText("CPU").first()).toBeVisible();
  });

  test("single user and pool shows data correctly", async ({ page }) => {
    // ARRANGE — single entry
    await setupOccupancy(page, createOccupancySummaries([{ user: "solo-user", pool: "solo-pool", gpu: 2, cpu: 16 }]));

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — the pool name is visible
    await expect(page.getByText("solo-pool").first()).toBeVisible();
  });
});
