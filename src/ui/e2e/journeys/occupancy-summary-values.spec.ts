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
 * Occupancy Summary KPI Cards Tests
 *
 * Tests the occupancy-summary.tsx component (KPI cards):
 * - GPU, CPU, Memory, Storage cards show aggregated totals
 * - Memory and Storage display formatted byte values (GiB/TiB)
 * - Cards reflect actual data from the occupancy API
 * - Empty data shows zero-like values
 *
 * Also tests the results count in occupancy-toolbar.tsx:
 * - Results count reflects number of grouped rows
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

test.describe("Occupancy Summary KPI Values", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("GPU KPI card shows total GPU count across all entries", async ({ page }) => {
    // ARRANGE — 3 entries with known GPU counts: 8 + 4 + 2 = 14
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8 },
        { user: "bob", pool: "prod", gpu: 4 },
        { user: "charlie", pool: "staging", gpu: 2 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — GPU card shows the total "14"
    await expect(page.getByText("14").first()).toBeVisible();
  });

  test("CPU KPI card shows total CPU count", async ({ page }) => {
    // ARRANGE — 2 entries with known CPU counts: 64 + 32 = 96
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", cpu: 64 },
        { user: "bob", pool: "prod", cpu: 32 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — CPU card shows the total "96"
    await expect(page.getByText("96").first()).toBeVisible();
  });

  test("Memory KPI card shows formatted byte value with unit suffix", async ({ page }) => {
    // ARRANGE — single entry with known memory value
    await setupOccupancy(
      page,
      createOccupancySummaries([{ user: "alice", pool: "prod", memory: 64 * 1024 * 1024 * 1024 }]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — Memory card is visible with a unit suffix (Gi or Ti)
    // Note: "MEMORY" appears uppercase via CSS text-transform, but DOM text is "Memory"
    await expect(page.getByText("Memory").first()).toBeVisible();
    // The unit suffix "Gi" or "Ti" should be visible somewhere in the card
    await expect(page.locator("text=/Gi|Ti/").first()).toBeVisible();
  });

  test("all four KPI cards are labeled correctly", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([{ user: "alice", pool: "prod", gpu: 1, cpu: 1 }]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — all four card labels present (CSS uppercase, DOM text is capitalized)
    await expect(page.getByText("GPU").first()).toBeVisible();
    await expect(page.getByText("CPU").first()).toBeVisible();
    await expect(page.getByText("Memory").first()).toBeVisible();
    await expect(page.getByText("Storage").first()).toBeVisible();
  });
});

test.describe("Occupancy Toolbar Results Count", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("toolbar shows results count matching number of parent rows", async ({ page }) => {
    // ARRANGE — 3 pools → 3 parent rows in pool grouping
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8 },
        { user: "bob", pool: "staging", gpu: 4 },
        { user: "charlie", pool: "development", gpu: 2 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — results count shows "3"
    await expect(page.getByText(/3 results/i).first()).toBeVisible();
  });

  test("results count updates when switching to By User grouping", async ({ page }) => {
    // ARRANGE — 2 users across pools → 2 parent rows in user grouping
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8 },
        { user: "alice", pool: "staging", gpu: 4 },
        { user: "bob", pool: "prod", gpu: 2 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // Switch to By User
    const groupByRadioGroup = page.getByRole("radiogroup", { name: "Group by" });
    await groupByRadioGroup.getByText("By User").click();

    // ASSERT — 2 user parent rows
    await expect(page.getByText(/2 results/i).first()).toBeVisible();
  });
});
