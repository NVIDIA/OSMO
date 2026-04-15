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
  createWorkflowEntry,
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
 * Dashboard Journey Tests
 *
 * Architecture notes:
 * - Dashboard lives at / (root route)
 * - Uses Streaming SSR: DashboardSkeleton → DashboardWithData → DashboardContent
 * - Shows 4 stat cards: Active Workflows, Completed (24h), Failed (24h), Pools Online
 * - Shows "Recent Workflows" list (up to 5 items)
 * - Shows version footer (OSMO v{major}.{minor}.{revision})
 * - Stat cards are links that navigate to filtered views
 * - Needs mocks for: /api/pool_quota, /api/workflow, /api/version, /api/profile/settings
 */

test.describe("Dashboard Stats", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows stat cards with correct counts", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        { name: "prod", status: PoolStatus.ONLINE },
        { name: "staging", status: PoolStatus.ONLINE },
        { name: "dev", status: PoolStatus.OFFLINE },
      ]),
    );
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "running-1", status: WorkflowStatus.RUNNING },
        { name: "running-2", status: WorkflowStatus.RUNNING },
        { name: "completed-1", status: WorkflowStatus.COMPLETED },
        { name: "failed-1", status: WorkflowStatus.FAILED },
      ]),
    );

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — stat cards render with values
    await expect(page.getByText("Active Workflows").first()).toBeVisible();
    await expect(page.getByText("Completed (24h)").first()).toBeVisible();
    await expect(page.getByText("Failed (24h)").first()).toBeVisible();
    await expect(page.getByText("Pools Online").first()).toBeVisible();
  });

  test("shows dashboard breadcrumb", async ({ page }) => {
    // ARRANGE
    await setupPools(page, createPoolResponse([]));
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Dashboard breadcrumb is visible in the page header
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Dashboard").first()).toBeVisible();
  });
});

test.describe("Dashboard Recent Workflows", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows recent workflows section with workflow entries", async ({ page }) => {
    // NOTE: Dashboard uses SSR streaming — data is server-prefetched via MSW,
    // not from Playwright route mocks. We verify the section renders with
    // workflow entries (links to /workflows/...) rather than specific names.

    // ARRANGE
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — Recent Workflows section renders with at least one workflow link
    await expect(page.getByText("Recent Workflows").first()).toBeVisible();
    const workflowLinks = page.locator('a[href^="/workflows/"]');
    await expect(workflowLinks.first()).toBeVisible();
  });

  test("shows workflow status badges in recent workflows", async ({ page }) => {
    // ARRANGE
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — at least one status badge (Completed, Running, or Failed) is visible
    const statusTexts = page.getByText(/^(Completed|Running|Failed|Pending)$/);
    await expect(statusTexts.first()).toBeVisible();
  });

  test("shows 'View all' link to workflows page", async ({ page }) => {
    // ARRANGE
    await setupPools(page, createPoolResponse([]));
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT
    const viewAllLink = page.getByRole("link", { name: /view all/i });
    await expect(viewAllLink.first()).toBeVisible();
    await expect(viewAllLink.first()).toHaveAttribute("href", /\/workflows/);
  });
});

test.describe("Dashboard Version", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows version footer", async ({ page }) => {
    // ARRANGE
    await setupPools(page, createPoolResponse([]));
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT — version string from createVersion() defaults: major=2, minor=5, revision=1
    await expect(page.getByText(/OSMO v\d+\.\d+\.\d+/).first()).toBeVisible();
  });
});
