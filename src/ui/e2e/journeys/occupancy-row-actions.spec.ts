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
 * Occupancy Row Actions & Navigation Tests
 *
 * Tests behavior in occupancy-column-defs.tsx and occupancy-data-table.tsx:
 * - ParentRowActions dropdown menu (View Workflows, View Pool links)
 * - Child row click → navigates to workflows with pool+user filter
 * - Priority badges display in parent/child rows (HIGH, NORMAL, LOW)
 * - Results count displayed in toolbar
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

test.describe("Occupancy Row Actions — Pool Grouping", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("parent row actions menu shows View Workflows link", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8 },
        { user: "bob", pool: "production", gpu: 4 },
      ]),
    );

    // ACT — navigate and hover over the parent row to reveal the actions button
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // Hover over the production row to make the actions button visible
    const productionRow = page.getByText("production").first();
    await productionRow.hover();

    // Click the actions button for the production row
    const actionsButton = page.getByRole("button", { name: "Row actions production" });
    await actionsButton.click();

    // ASSERT — "View Workflows" link is visible in the dropdown
    await expect(page.getByRole("menuitem", { name: /view workflows/i })).toBeVisible();
  });

  test("parent row actions menu shows View Pool link in pool grouping mode", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    const productionRow = page.getByText("production").first();
    await productionRow.hover();

    await page.getByRole("button", { name: "Row actions production" }).click();

    // ASSERT — "View Pool" link is visible (only shown in pool grouping mode)
    await expect(page.getByRole("menuitem", { name: /view pool/i })).toBeVisible();
  });

  test("View Workflows link in actions menu has correct href with pool filter", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "my-pool", gpu: 8 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    const poolRow = page.getByText("my-pool").first();
    await poolRow.hover();

    await page.getByRole("button", { name: "Row actions my-pool" }).click();

    // ASSERT — View Workflows link points to workflows filtered by pool
    const viewWorkflowsLink = page.getByRole("menuitem", { name: /view workflows/i });
    await expect(viewWorkflowsLink).toBeVisible();
    await expect(viewWorkflowsLink).toHaveAttribute("href", /\/workflows.*pool.*my-pool/);
  });

  test("View Pool link has correct href pointing to pools page", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "gpu-cluster", gpu: 8 },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    const poolRow = page.getByText("gpu-cluster").first();
    await poolRow.hover();

    await page.getByRole("button", { name: "Row actions gpu-cluster" }).click();

    // ASSERT — View Pool link points to pools page with view= query param
    const viewPoolLink = page.getByRole("menuitem", { name: /view pool/i });
    await expect(viewPoolLink).toBeVisible();
    await expect(viewPoolLink).toHaveAttribute("href", /\/pools.*view=gpu-cluster/);
  });
});

test.describe("Occupancy Row Actions — User Grouping", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("parent row actions in user grouping does NOT show View Pool link", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8 },
        { user: "alice", pool: "staging", gpu: 4 },
      ]),
    );

    // ACT — switch to By User grouping
    await page.goto("/occupancy?groupBy=user");
    await page.waitForLoadState("networkidle");

    const aliceRow = page.getByText("alice").first();
    await aliceRow.hover();

    await page.getByRole("button", { name: "Row actions alice" }).click();

    // ASSERT — only View Workflows is shown, not View Pool
    await expect(page.getByRole("menuitem", { name: /view workflows/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /view pool/i })).not.toBeVisible();
  });
});

test.describe("Occupancy Priority Badges", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("parent row shows priority badges for aggregated HIGH and NORMAL counts", async ({ page }) => {
    // ARRANGE — multiple users with different priorities in same pool
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8, priority: "HIGH" },
        { user: "bob", pool: "prod", gpu: 4, priority: "NORMAL" },
        { user: "charlie", pool: "prod", gpu: 2, priority: "HIGH" },
      ]),
    );

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — priority column shows badges with aggregated counts
    // 2 HIGH priority tasks, 1 NORMAL priority task
    await expect(page.getByLabel(/high priority: 2/i).first()).toBeVisible();
    await expect(page.getByLabel(/normal priority: 1/i).first()).toBeVisible();
  });

  test("child rows show individual priority badges after expand", async ({ page }) => {
    // ARRANGE
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "prod", gpu: 8, priority: "HIGH" },
        { user: "bob", pool: "prod", gpu: 4, priority: "LOW" },
      ]),
    );

    // ACT — expand all to see child rows
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /expand all/i }).click();

    // ASSERT — individual user rows are visible with their priority badges
    await expect(page.getByText("alice").first()).toBeVisible();
    await expect(page.getByText("bob").first()).toBeVisible();
    // Each child row should show its own priority badge
    await expect(page.getByLabel(/high priority: 1/i).first()).toBeVisible();
    await expect(page.getByLabel(/low priority: 1/i).first()).toBeVisible();
  });
});

test.describe("Occupancy Child Row Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("clicking a child row navigates to workflows with pool+user filter", async ({ page }) => {
    // ARRANGE — need at least one entry to produce a parent+child
    await setupOccupancy(
      page,
      createOccupancySummaries([
        { user: "alice", pool: "production", gpu: 8 },
        { user: "bob", pool: "production", gpu: 4 },
      ]),
    );

    // Mock the workflows page so navigation succeeds
    await page.route("**/api/workflow*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ workflows: [], more_entries: false }),
      }),
    );

    // ACT — expand and click a child row
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /expand all/i }).click();
    await expect(page.getByText("alice").first()).toBeVisible();

    // Click the child row (alice under production)
    await page.getByText("alice").first().click();

    // ASSERT — navigates to workflows page with both pool and user filters
    await expect(page).toHaveURL(/\/workflows/);
    await expect(page).toHaveURL(/pool.*production|production.*pool/);
    await expect(page).toHaveURL(/user.*alice|alice.*user/);
  });
});
