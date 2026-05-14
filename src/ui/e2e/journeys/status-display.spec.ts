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
  createPoolResponse,
  WorkflowStatus,
  PoolStatus,
} from "@/mocks/factories";
import {
  setupDefaultMocks,
  setupProfile,
  setupWorkflows,
  setupPools,
} from "@/e2e/utils/mock-setup";

/**
 * Workflow Status Display Tests
 *
 * Verifies that different workflow statuses render with correct visual indicators
 * and that status-specific behaviors are reflected in the table.
 *
 * Architecture notes:
 * - Status badges use getStatusDisplay() from workflow-constants.ts
 * - Each status has a category (success, error, warning, running, etc.)
 * - Rows have status-themed left borders via CSS classes
 * - WorkflowStatus enum values: RUNNING, COMPLETED, FAILED, PENDING, CANCELLING, CANCELLED, etc.
 */

test.describe("Workflow Status Display", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("RUNNING workflows show running status indicator", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "training-job-1", status: WorkflowStatus.RUNNING, user: "alice" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — workflow row is visible with running indicator
    await expect(page.getByText("training-job-1").first()).toBeVisible();
    await expect(page.getByText(/running/i).first()).toBeVisible();
  });

  test("COMPLETED workflows show success status indicator", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "training-done", status: WorkflowStatus.COMPLETED, user: "bob" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText("training-done").first()).toBeVisible();
    await expect(page.getByText(/completed/i).first()).toBeVisible();
  });

  test("FAILED workflows show error status indicator", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "broken-job", status: WorkflowStatus.FAILED, user: "charlie" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText("broken-job").first()).toBeVisible();
    await expect(page.getByText(/failed/i).first()).toBeVisible();
  });

  test("PENDING workflows show waiting status indicator", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "queued-job", status: WorkflowStatus.PENDING, user: "dave" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText("queued-job").first()).toBeVisible();
    await expect(page.getByText(/pending/i).first()).toBeVisible();
  });

  test("FAILED_CANCELED workflows show canceled status indicator", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "stopping-job", status: WorkflowStatus.FAILED_CANCELED, user: "eve" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText("stopping-job").first()).toBeVisible();
    await expect(page.getByText(/cancel/i).first()).toBeVisible();
  });

  test("multiple statuses render correctly in same table", async ({ page }) => {
    // ARRANGE — one of each major status
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "wf-running", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "wf-completed", status: WorkflowStatus.COMPLETED, user: "bob" },
        { name: "wf-failed", status: WorkflowStatus.FAILED, user: "charlie" },
        { name: "wf-pending", status: WorkflowStatus.PENDING, user: "dave" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — all 4 rows are visible
    await expect(page.getByText("wf-running").first()).toBeVisible();
    await expect(page.getByText("wf-completed").first()).toBeVisible();
    await expect(page.getByText("wf-failed").first()).toBeVisible();
    await expect(page.getByText("wf-pending").first()).toBeVisible();
  });
});

test.describe("Pool Status Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("multiple pool statuses render in correct sections", async ({ page }) => {
    // ARRANGE — pools with different statuses
    await setupPools(
      page,
      createPoolResponse([
        { name: "production", status: PoolStatus.ONLINE },
        { name: "staging", status: PoolStatus.OFFLINE },
        { name: "maintenance-cluster", status: PoolStatus.MAINTENANCE },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — all pools are visible
    await expect(page.getByText("production").first()).toBeVisible();
    await expect(page.getByText("staging").first()).toBeVisible();
    await expect(page.getByText("maintenance-cluster").first()).toBeVisible();
  });
});
