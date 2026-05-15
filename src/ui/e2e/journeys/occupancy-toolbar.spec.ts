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
 * Occupancy Toolbar Interaction Tests
 *
 * Tests toolbar interactions on the occupancy page:
 * - Expand all / collapse all toggle button
 * - Search filtering creates chips
 * - Group by toggle updates URL
 *
 * Architecture notes:
 * - OccupancyToolbar has a GroupByToggle (radiogroup "Group by") + expand/collapse button
 * - Expand all button label toggles: "Expand all rows" / "Collapse all rows"
 * - Search uses TableToolbar with chip-based filters
 * - Group by changes update ?groupBy= URL parameter
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

test.describe("Occupancy Expand/Collapse Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("expand all button changes to collapse all after clicking", async ({ page }) => {
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

    // Initially shows "Expand all rows"
    const expandButton = page.getByRole("button", { name: /expand all rows/i });
    await expect(expandButton).toBeVisible();

    // Click to expand all
    await expandButton.click();

    // ASSERT — now shows "Collapse all rows"
    await expect(page.getByRole("button", { name: /collapse all rows/i })).toBeVisible();
  });

  test("collapse all button returns to expand all state", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8 },
        { user: "bob", pool: "staging", gpu: 4 },
      ]),
    );

    // ACT — expand then collapse
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /expand all rows/i }).click();
    await page.getByRole("button", { name: /collapse all rows/i }).click();

    // ASSERT — back to expand state
    await expect(page.getByRole("button", { name: /expand all rows/i })).toBeVisible();
  });

  test("expanding reveals user details in child rows", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "shared-pool", gpu: 8 },
        { user: "bob", pool: "shared-pool", gpu: 4 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /expand all rows/i }).click();

    // ASSERT — user names visible in expanded child rows
    await expect(page.getByText("alice").first()).toBeVisible();
    await expect(page.getByText("bob").first()).toBeVisible();
  });
});

test.describe("Occupancy Group By Toggle URL State", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("clicking By User updates URL with groupBy=user", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 4 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    const groupByRadioGroup = page.getByRole("radiogroup", { name: "Group by" });
    await groupByRadioGroup.getByText("By User").click();

    // ASSERT — URL updates
    await expect(page).toHaveURL(/groupBy=user/);
  });

  test("clicking By Pool after By User removes groupBy from URL", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 4 },
      ]),
    );

    // ACT
    await page.goto("/occupancy?groupBy=user");
    await page.waitForLoadState("networkidle");

    const groupByRadioGroup = page.getByRole("radiogroup", { name: "Group by" });
    await groupByRadioGroup.getByText("By Pool").click();

    // ASSERT — groupBy=user removed from URL (pool is default)
    await expect(page).not.toHaveURL(/groupBy=user/);
  });
});
