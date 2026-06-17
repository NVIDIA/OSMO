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
 * Dashboard Stat Card Values Tests
 *
 * Tests that the dashboard stat cards render correct numeric values:
 * - Active Workflows shows count of RUNNING workflows
 * - Completed (24h) shows count of COMPLETED workflows
 * - Failed (24h) shows count of all failed-category workflows
 * - Pools Online shows "online/total" format
 *
 * Architecture notes:
 * - DashboardContent auto-fetches all pages to cover full 24h window
 * - workflowStats are simple counts by status
 * - poolStats filtered by accessible pools from profile
 * - Stat cards show value as large text, or "—" when loading
 */

test.describe("Dashboard Stat Card Values", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("Active Workflows card shows count of running workflows", async ({ page }) => {
    // ARRANGE — 3 running, 1 completed
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "running-1", status: WorkflowStatus.RUNNING },
        { name: "running-2", status: WorkflowStatus.RUNNING },
        { name: "running-3", status: WorkflowStatus.RUNNING },
        { name: "completed-1", status: WorkflowStatus.COMPLETED },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Active Workflows card shows "3"
    const activeCard = page.locator("a[href*='status:RUNNING']");
    await expect(activeCard.getByText("3")).toBeVisible();
  });

  test("Completed (24h) card shows count of completed workflows", async ({ page }) => {
    // ARRANGE — 2 completed
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "completed-1", status: WorkflowStatus.COMPLETED },
        { name: "completed-2", status: WorkflowStatus.COMPLETED },
        { name: "running-1", status: WorkflowStatus.RUNNING },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Completed card shows "2"
    const completedCard = page.locator("a[href*='status:COMPLETED']");
    await expect(completedCard.locator("p.text-2xl")).toHaveText("2");
  });

  test("Failed (24h) card shows count of failed workflows", async ({ page }) => {
    // ARRANGE — 1 FAILED
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "failed-1", status: WorkflowStatus.FAILED },
        { name: "completed-1", status: WorkflowStatus.COMPLETED },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Failed card shows "1" (text-red when failed > 0)
    const failedCard = page.locator("a[href*='FAILED']");
    await expect(failedCard.getByText("1")).toBeVisible();
  });

  test("Pools Online card shows online/total format", async ({ page }) => {
    // ARRANGE — 2 online out of 3 total
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

    // ASSERT — Pools Online card shows "2/3" (online/total)
    const poolsCard = page.locator("a[href*='status:ONLINE'][href*='pools']");
    await expect(poolsCard.getByText("2/3")).toBeVisible();
  });

  test("stat cards show zero values when no data matches", async ({ page }) => {
    // ARRANGE — 1 completed, no running, no failed
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(
      page,
      createWorkflowsResponse([{ name: "completed-1", status: WorkflowStatus.COMPLETED }]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Active Workflows shows "0" (no running workflows)
    const activeCard = page.locator("a[href*='status:RUNNING']");
    await expect(activeCard.getByText("0")).toBeVisible();
  });
});
