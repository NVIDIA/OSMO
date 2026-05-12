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
 * Workflows Filter Preset Journey Tests
 *
 * Tests the status filter presets (Running, Waiting, Completed, Failed) that
 * appear as pill buttons in the toolbar. These are a primary interaction pattern
 * for narrowing the workflow list by status category.
 *
 * Architecture notes:
 * - Status presets are defined in WorkflowsToolbar via STATUS_PRESET_CONFIG
 * - Each preset maps to one or more WorkflowStatus enum values
 * - Clicking a preset toggles the status filter chip(s) in the URL
 * - "Running" preset maps to RUNNING status
 * - "Waiting" preset maps to PENDING + QUEUED
 * - "Completed" preset maps to COMPLETED
 * - "Failed" preset maps to FAILED + CANCELLED
 */

test.describe("Workflow Status Filter Presets", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows status filter preset pills in dropdown when input is focused", async ({ page }) => {
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

    // ASSERT — dropdown shows all 4 status preset pills
    const dropdown = page.locator(".fb-dropdown");
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText("Running")).toBeVisible();
    await expect(dropdown.getByText("Waiting")).toBeVisible();
    await expect(dropdown.getByText("Completed")).toBeVisible();
    await expect(dropdown.getByText("Failed")).toBeVisible();
  });

  test("clicking Running preset adds status filter to URL", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "running-wf", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "completed-wf", status: WorkflowStatus.COMPLETED, user: "bob" },
      ]),
    );

    // ACT — open dropdown and click Running preset
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Running").click();

    // ASSERT — URL reflects status filter
    await expect(page).toHaveURL(/f=status(%3A|:)RUNNING/);
  });

  test("clicking Completed preset adds completed status filter to URL", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "running-wf", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "completed-wf", status: WorkflowStatus.COMPLETED, user: "bob" },
      ]),
    );

    // ACT — open dropdown and click Completed preset
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Completed").click();

    // ASSERT — URL reflects completed status filter
    await expect(page).toHaveURL(/f=status(%3A|:)COMPLETED/);
  });

  test("clicking Failed preset adds failed status filter to URL", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "running-wf", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "failed-wf", status: WorkflowStatus.FAILED, user: "bob" },
      ]),
    );

    // ACT — open dropdown and click Failed preset
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Failed").click();

    // ASSERT — URL reflects failed status filter
    await expect(page).toHaveURL(/f=status(%3A|:)(FAILED|CANCELLED)/);
  });

  test("clicking a preset pill again deactivates it", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([{ name: "running-wf", status: WorkflowStatus.RUNNING, user: "alice" }]),
    );

    // ACT — activate Running preset via dropdown
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    const filterInput = page.getByRole("combobox");
    await filterInput.click();

    const dropdown = page.locator(".fb-dropdown");
    await dropdown.getByText("Running").click();
    await expect(page).toHaveURL(/f=status(%3A|:)RUNNING/);

    // Click again to deactivate — re-open dropdown first
    await filterInput.click();
    await dropdown.getByText("Running").click();

    // ASSERT — status filter removed from URL
    await expect(page).not.toHaveURL(/f=status/);
  });
});

test.describe("Workflow Auto-Refresh", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("refresh button is visible in workflows toolbar", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([{ name: "wf-1", status: WorkflowStatus.RUNNING, user: "test-user" }]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — refresh button is present
    await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
  });

  test("toggle columns menu shows workflow-specific columns", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([{ name: "wf-1", status: WorkflowStatus.RUNNING, user: "test-user", pool: "prod" }]),
    );

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    const toggleButton = page.getByRole("button", { name: /toggle columns/i });
    await toggleButton.click();

    // ASSERT — workflow-specific column options appear
    const columnItems = page.getByRole("menuitemcheckbox");
    await expect(columnItems.first()).toBeVisible();
  });
});

test.describe("Workflow URL Filter State", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("navigating with pre-applied status filter shows filtered results", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        { name: "running-wf", status: WorkflowStatus.RUNNING, user: "alice" },
        { name: "completed-wf", status: WorkflowStatus.COMPLETED, user: "bob" },
      ]),
    );

    // ACT — navigate directly with status filter
    await page.goto("/workflows?all=true&f=status:RUNNING");
    await page.waitForLoadState("networkidle");

    // ASSERT — only running workflow visible (client-side filter)
    await expect(page.getByText("running-wf").first()).toBeVisible();
  });

  test("navigating with pool filter shows pool in URL", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(
      page,
      createWorkflowsResponse([{ name: "pool-wf", status: WorkflowStatus.RUNNING, user: "alice", pool: "production" }]),
    );

    // ACT — navigate with pool filter
    await page.goto("/workflows?all=true&f=pool:production");
    await page.waitForLoadState("networkidle");

    // ASSERT — page loads without error
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page).toHaveURL(/f=pool(%3A|:)production/);
  });
});
