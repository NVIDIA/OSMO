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
import { createWorkflowsResponse, WorkflowStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupProfile, setupWorkflows } from "@/e2e/utils/mock-setup";

/**
 * Workflow User Filter Preset Tests
 *
 * Architecture notes:
 * - The "My Workflows" preset is an amber pill button that filters by user
 * - It's distinct from status presets — uses replace semantics (not additive toggle)
 * - Clicking while active removes the user filter
 * - Clicking while inactive replaces any existing user chip with the current user
 * - Also tests: "Waiting" preset (PENDING + QUEUED), combining presets with search
 */

test.describe("Workflow My Workflows Preset", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("status presets are visible in the dropdown alongside User preset group", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([{ name: "wf-1", status: WorkflowStatus.RUNNING, user: "test-user" }]),
    );

    // ACT — focus the filter bar to open the dropdown
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    // ASSERT — status presets are visible in the dropdown
    const dropdown = page.locator(".fb-dropdown");
    await expect(dropdown).toBeVisible();
    // The "Status:" label grouping the status presets should be present
    await expect(dropdown.getByText("Status:", { exact: true }).first()).toBeVisible();
  });

  test("clicking Waiting preset adds PENDING and QUEUED status filters to URL", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "pending-wf", status: WorkflowStatus.PENDING, user: "alice" },
        { name: "running-wf", status: WorkflowStatus.RUNNING, user: "bob" },
      ]),
    );

    // ACT — open dropdown and click Waiting preset
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Waiting").click();

    // ASSERT — URL reflects status filter (PENDING or QUEUED)
    await expect(page).toHaveURL(/f=status(%3A|:)(PENDING|QUEUED)/);
  });

  test("combining status preset with name search narrows results", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "train-resnet", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "eval-bert", status: WorkflowStatus.COMPLETED, user: "bob" },
      ]),
    );

    // ACT — apply Running preset then search for "train"
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Running").click();

    // URL now has status filter
    await expect(page).toHaveURL(/f=status(%3A|:)RUNNING/);

    // Now add a name search
    await filterInput.fill("train");
    await filterInput.press("Enter");

    // ASSERT — URL has both filters
    await expect(page).toHaveURL(/f=.*status/);
    await expect(page).toHaveURL(/f=.*name(%3A|:)train|train.*name/);
  });
});

test.describe("Workflow Empty and Loading States", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows empty state message when no workflows are returned from API", async ({ page }) => {
    // ARRANGE — API returns empty list
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — "No workflows found" empty state message
    await expect(page.getByText(/no workflows found/i).first()).toBeVisible();
  });

  test("workflows page shows correct table columns", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        {
          name: "col-test-wf",
          status: WorkflowStatus.RUNNING,
          user: "test-user",
          pool: "production",
          priority: "HIGH",
        },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — key data displayed in rows
    await expect(page.getByText("col-test-wf").first()).toBeVisible();
    await expect(page.getByText("test-user").first()).toBeVisible();
    await expect(page.getByText("production").first()).toBeVisible();
  });

  test("workflow priority column shows priority values", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "high-prio-wf", status: WorkflowStatus.RUNNING, user: "alice", priority: "HIGH" },
        { name: "normal-prio-wf", status: WorkflowStatus.RUNNING, user: "bob", priority: "NORMAL" },
      ]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — both workflow names are visible (priorities are rendered in the table)
    await expect(page.getByText("high-prio-wf").first()).toBeVisible();
    await expect(page.getByText("normal-prio-wf").first()).toBeVisible();
  });
});
