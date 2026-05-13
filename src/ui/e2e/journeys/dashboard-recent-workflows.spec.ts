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
  createPoolResponse,
  createWorkflowsResponse,
  PoolStatus,
  WorkflowStatus,
} from "@/mocks/factories";
import {
  setupDefaultMocks,
  setupPools,
  setupProfile,
  setupWorkflows,
} from "@/e2e/utils/mock-setup";

/**
 * Dashboard Recent Workflow Interaction Tests
 *
 * Tests the interactive behavior of recent workflow items on the dashboard:
 * - Clicking a recent workflow navigates to workflow detail page
 * - Empty state shows appropriate message
 * - Multiple status types display correctly
 * - Workflow user names display in the list
 *
 * Architecture notes:
 * - Dashboard at / shows "Recent Workflows" section with up to 5 items
 * - Each recent workflow is a Link to /workflows/{name}
 * - Status badges use WorkflowStatus enum → getStatusDisplay → StatusBadge
 * - Dashboard auto-fetches all pages to compute 24h stats
 * - Profile accessible pools filter which pools appear in stats
 */

test.describe("Dashboard Recent Workflow Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("clicking a recent workflow navigates to its detail page", async ({ page }) => {
    // ARRANGE
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "my-training-job", status: WorkflowStatus.RUNNING, user: "alice" },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Click the workflow in the recent list
    await page.getByRole("link", { name: /my-training-job/i }).first().click();

    // ASSERT — navigates to workflow detail
    await expect(page).toHaveURL(/\/workflows\/my-training-job/);
  });

  test("shows 'No workflows to display' when recent list is empty", async ({ page }) => {
    // ARRANGE — no workflows
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — empty message
    await expect(page.getByText("No workflows to display").first()).toBeVisible();
  });

  test("recent workflows show user names", async ({ page }) => {
    // ARRANGE
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "job-alice", status: WorkflowStatus.RUNNING, user: "alice@nvidia.com" },
        { name: "job-bob", status: WorkflowStatus.COMPLETED, user: "bob@nvidia.com" },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — user names visible
    await expect(page.getByText("alice@nvidia.com").first()).toBeVisible();
    await expect(page.getByText("bob@nvidia.com").first()).toBeVisible();
  });

  test("recent workflows display at most 5 items", async ({ page }) => {
    // ARRANGE — 7 workflows
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "wf-1", status: WorkflowStatus.RUNNING },
        { name: "wf-2", status: WorkflowStatus.RUNNING },
        { name: "wf-3", status: WorkflowStatus.COMPLETED },
        { name: "wf-4", status: WorkflowStatus.COMPLETED },
        { name: "wf-5", status: WorkflowStatus.FAILED },
        { name: "wf-6", status: WorkflowStatus.FAILED },
        { name: "wf-7", status: WorkflowStatus.RUNNING },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — at most 5 workflow links in the recent section
    const recentSection = page.locator("text=Recent Workflows").first().locator("..").locator("..");
    const workflowLinks = recentSection.locator('a[href^="/workflows/"]');
    const count = await workflowLinks.count();
    expect(count).toBeLessThanOrEqual(5);
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("Dashboard Profile Pool Filtering", () => {
  test("stat cards reflect only accessible pools when profile has pool restrictions", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);

    // Profile with only "prod" accessible
    await page.route("**/api/profile/settings*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          profile: {
            username: "restricted-user",
            email_notification: true,
            slack_notification: false,
            bucket: "",
            pool: "prod",
          },
          roles: [],
          pools: ["prod"],
        }),
      }),
    );

    // 3 pools but user can only see "prod"
    await setupPools(
      page,
      createPoolResponse([
        { name: "prod", status: PoolStatus.ONLINE },
        { name: "staging", status: PoolStatus.ONLINE },
        { name: "dev", status: PoolStatus.OFFLINE },
      ]),
    );
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Pools Online shows 1/1 (only "prod" accessible and online)
    // The stat card displays "{online}/{total}" format
    await expect(page.getByText("Pools Online").first()).toBeVisible();
    await expect(page.getByText("1/1").first()).toBeVisible({ timeout: 5_000 });
  });
});
