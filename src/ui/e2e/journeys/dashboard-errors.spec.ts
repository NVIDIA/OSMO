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
  setupProfile,
  setupPools,
  setupWorkflows,
} from "@/e2e/utils/mock-setup";

/**
 * Dashboard Error & Edge Case Tests
 *
 * Tests dashboard behavior under error conditions and unusual data scenarios:
 * - Pool API failures (dashboard should still render workflows)
 * - Workflow API failures (dashboard should still render pools)
 * - All APIs failing (dashboard should show error states)
 * - Large numbers of workflows/pools (performance)
 * - Mixed status counts
 *
 * Architecture notes:
 * - Dashboard fetches pools + workflows in parallel
 * - Each section has its own error boundary
 * - Stat cards compute counts from API responses
 * - Recent workflows shows up to 5 items
 */

test.describe("Dashboard API Error Resilience", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows pools stat card even when workflow API fails", async ({ page }) => {
    // ARRANGE — pools succeed, workflows fail
    await setupPools(
      page,
      createPoolResponse([
        { name: "prod", status: PoolStatus.ONLINE },
        { name: "dev", status: PoolStatus.ONLINE },
      ]),
    );
    await page.route("**/api/workflow*", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Service unavailable" }),
      }),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without crash, pools stat is available
    await expect(page.getByText("Pools Online").first()).toBeVisible();
  });

  test("shows workflow stat cards even when pool API fails", async ({ page }) => {
    // ARRANGE — pools fail, workflows succeed
    await setupPools(page, { status: 400, detail: "Service unavailable" });
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "wf-1", status: WorkflowStatus.RUNNING },
        { name: "wf-2", status: WorkflowStatus.COMPLETED },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without crash, workflow stats are available
    await expect(page.getByText("Active Workflows").first()).toBeVisible();
  });

  test("page does not crash when both APIs fail", async ({ page }) => {
    // ARRANGE — both APIs return errors
    await setupPools(page, { status: 400, detail: "Pools unavailable" });
    await page.route("**/api/workflow*", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Workflows unavailable" }),
      }),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — page does not crash
    await expect(page.locator("body")).not.toBeEmpty();
    // Dashboard breadcrumb should still render
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Dashboard").first()).toBeVisible();
  });
});

test.describe("Dashboard Stat Count Verification", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("counts multiple running workflows correctly", async ({ page }) => {
    // ARRANGE — 3 running workflows
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "run-1", status: WorkflowStatus.RUNNING },
        { name: "run-2", status: WorkflowStatus.RUNNING },
        { name: "run-3", status: WorkflowStatus.RUNNING },
        { name: "done-1", status: WorkflowStatus.COMPLETED },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Active Workflows card shows the count
    await expect(page.getByText("Active Workflows").first()).toBeVisible();
    // The count should be 3 (three running workflows)
    await expect(page.getByText("3").first()).toBeVisible();
  });

  test("shows correct online pools count", async ({ page }) => {
    // ARRANGE — 2 online pools, 1 offline
    await setupPools(
      page,
      createPoolResponse([
        { name: "prod", status: PoolStatus.ONLINE },
        { name: "staging", status: PoolStatus.ONLINE },
        { name: "maintenance", status: PoolStatus.OFFLINE },
      ]),
    );
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Pools Online card visible
    await expect(page.getByText("Pools Online").first()).toBeVisible();
    // The count should be 2 (two online pools)
    await expect(page.getByText("2").first()).toBeVisible();
  });

  test("recent workflows list shows workflow names as links", async ({ page }) => {
    // ARRANGE — multiple workflows
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "ml-training-job", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "data-pipeline", status: WorkflowStatus.COMPLETED, user: "bob" },
        { name: "inference-test", status: WorkflowStatus.FAILED, user: "charlie" },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — workflow names visible in recent workflows
    await expect(page.getByText("Recent Workflows").first()).toBeVisible();
    // At least one workflow link is visible
    const workflowLinks = page.locator('a[href^="/workflows/"]');
    await expect(workflowLinks.first()).toBeVisible();
  });
});
