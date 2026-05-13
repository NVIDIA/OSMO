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
 * Workflow Pagination / Infinite Scroll Tests
 *
 * Architecture notes:
 * - Workflows list uses server-side pagination via more_entries flag
 * - When more_entries=true, more items auto-load on scroll (infinite scroll)
 * - The table uses TanStack Virtual for virtualization
 * - WorkflowsDataTable receives hasNextPage and onLoadMore props
 * - When all data is loaded (!hasNextPage), "You've reached the end" indicator appears
 * - Loading state shows via isFetchingNextPage as "Loading more..."
 */

test.describe("Workflow Pagination", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("does not show end-of-list indicator when more entries are available", async ({ page }) => {
    // ARRANGE — response indicates more entries are available
    await setupWorkflows(
      page,
      createWorkflowsResponse(
        [
          { name: "wf-1", status: WorkflowStatus.RUNNING, user: "alice" },
          { name: "wf-2", status: WorkflowStatus.COMPLETED, user: "bob" },
          { name: "wf-3", status: WorkflowStatus.FAILED, user: "charlie" },
        ],
        true, // moreEntries = true
      ),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — "reached the end" indicator should NOT be visible
    await expect(page.getByText(/reached the end/i)).not.toBeVisible();
  });

  test("shows end-of-list indicator when all entries are loaded", async ({ page }) => {
    // ARRANGE — response indicates no more entries
    await setupWorkflows(
      page,
      createWorkflowsResponse(
        [
          { name: "wf-single", status: WorkflowStatus.COMPLETED, user: "alice" },
        ],
        false, // moreEntries = false
      ),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — "reached the end" indicator IS visible
    await expect(page.getByText(/reached the end/i)).toBeVisible();
  });

  test("shows all loaded workflow rows", async ({ page }) => {
    // ARRANGE — 5 workflows, all loaded (no pagination)
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "batch-train-1", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "batch-train-2", status: WorkflowStatus.COMPLETED, user: "alice" },
        { name: "batch-eval-1", status: WorkflowStatus.PENDING, user: "bob" },
        { name: "batch-eval-2", status: WorkflowStatus.FAILED, user: "bob" },
        { name: "data-prep-1", status: WorkflowStatus.RUNNING, user: "charlie" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — all 5 workflows are visible in the table
    await expect(page.getByText("batch-train-1").first()).toBeVisible();
    await expect(page.getByText("batch-train-2").first()).toBeVisible();
    await expect(page.getByText("batch-eval-1").first()).toBeVisible();
    await expect(page.getByText("batch-eval-2").first()).toBeVisible();
    await expect(page.getByText("data-prep-1").first()).toBeVisible();
  });

  test("results count reflects total number of loaded workflows", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "count-wf-1", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "count-wf-2", status: WorkflowStatus.COMPLETED, user: "bob" },
        { name: "count-wf-3", status: WorkflowStatus.PENDING, user: "charlie" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — results count shows the number
    await expect(page.getByText(/3 results/).first()).toBeVisible();
  });
});
