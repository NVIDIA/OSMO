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
  createWorkflowsResponse,
  WorkflowStatus,
} from "@/mocks/factories";
import {
  setupDefaultMocks,
  setupProfile,
  setupWorkflows,
} from "@/e2e/utils/mock-setup";

/**
 * Workflows Page Journey Tests
 *
 * Architecture notes:
 * - Workflows list lives at /workflows
 * - Uses Streaming SSR: WorkflowsPageSkeleton → WorkflowsWithData → WorkflowsPageContent
 * - Table shows: name, status, user, submit_time, start_time, end_time, duration, queued_time, pool, priority, app_name
 * - Clicking a row navigates to /workflows/{name} (detail page)
 * - Default filter: user scoped (shows only current user's workflows)
 * - ?all=true: opts out of user scoping, shows all users' workflows
 * - Toolbar has search, auto-refresh, and filter functionality
 * - Uses server-side pagination via /api/workflow endpoint
 * - Error state: shows "Unable to load workflows" message
 * - Empty state: shows "No workflows found" message
 */

test.describe("Workflows List", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("renders workflows in a table", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "train-resnet-50", status: WorkflowStatus.RUNNING, user: "alice", pool: "production" },
        { name: "eval-bert-base", status: WorkflowStatus.COMPLETED, user: "bob", pool: "staging" },
        { name: "data-preprocessing", status: WorkflowStatus.FAILED, user: "charlie", pool: "dev" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — all workflow names are visible in the table
    await expect(page.getByText("train-resnet-50").first()).toBeVisible();
    await expect(page.getByText("eval-bert-base").first()).toBeVisible();
    await expect(page.getByText("data-preprocessing").first()).toBeVisible();
  });

  test("shows empty state when no workflows exist", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText(/no workflows found/i).first()).toBeVisible();
  });

  test("shows error state when workflow API fails", async ({ page }) => {
    // ARRANGE — use 400 to avoid TanStack Query retries on 5xx
    await setupWorkflows(page, { status: 400, detail: "Bad request" });

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — page must not crash, should show an error
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText(/unable to load/i).first()).toBeVisible();
  });

  test("shows workflows with different statuses", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "pending-job", status: WorkflowStatus.PENDING, user: "user-1" },
        { name: "running-job", status: WorkflowStatus.RUNNING, user: "user-2" },
        { name: "completed-job", status: WorkflowStatus.COMPLETED, user: "user-3" },
        { name: "failed-job", status: WorkflowStatus.FAILED, user: "user-4" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — all workflow rows are visible
    await expect(page.getByText("pending-job").first()).toBeVisible();
    await expect(page.getByText("running-job").first()).toBeVisible();
    await expect(page.getByText("completed-job").first()).toBeVisible();
    await expect(page.getByText("failed-job").first()).toBeVisible();
  });

  test("page title is set to Workflows", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page).toHaveTitle(/Workflows/);
  });
});

test.describe("Workflow Row Interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("clicking a workflow row navigates to its detail page", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "clickable-workflow", status: WorkflowStatus.RUNNING, user: "test-user" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");
    // Click the data row (virtualized table) — text click alone can miss [role=row] hit targets.
    const dataRow = page.locator('[role="row"][data-index]').first();
    await expect(dataRow).toBeVisible();
    await dataRow.click();

    // ASSERT — navigates to the workflow detail page
    await expect(page).toHaveURL(/\/workflows\/clickable-workflow/, { timeout: 15_000 });
  });
});

test.describe("Workflows Toolbar", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("has toolbar with search and column controls", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "toolbar-workflow", status: WorkflowStatus.RUNNING, user: "test-user" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — toolbar controls are present
    await expect(page.getByRole("combobox", { name: /search and filter/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /toggle columns/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  });

  test("shows breadcrumb with Workflows", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Workflows").first()).toBeVisible();
  });

  test("search creates a filter chip for the typed workflow name", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "train-resnet-50", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "eval-bert-base", status: WorkflowStatus.COMPLETED, user: "bob" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // The search input is a combobox (chip-based filter, not free-text search)
    const searchInput = page.getByRole("combobox", { name: /search and filter/i });
    await searchInput.fill("train-resnet");
    await searchInput.press("Enter");

    // ASSERT — Pressing Enter commits a chip — the URL reflects the active filter
    await expect(page).toHaveURL(/f=name(%3A|:)train-resnet/);
    // Matched workflow remains visible
    await expect(page.getByText("train-resnet-50").first()).toBeVisible();
  });

  test("shows results count", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "wf-1", status: WorkflowStatus.RUNNING, user: "user-1" },
        { name: "wf-2", status: WorkflowStatus.COMPLETED, user: "user-2" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — results count is displayed
    await expect(page.getByText(/\d+ results/).first()).toBeVisible();
  });

  test("toggle columns button opens column visibility menu", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "col-workflow", status: WorkflowStatus.RUNNING, user: "test-user" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // Click the toggle columns button
    const toggleButton = page.getByRole("button", { name: /toggle columns/i });
    await toggleButton.click();

    // ASSERT — column options appear (popover/dropdown opens)
    await expect(page.getByRole("menuitemcheckbox").first()).toBeVisible();
  });
});
