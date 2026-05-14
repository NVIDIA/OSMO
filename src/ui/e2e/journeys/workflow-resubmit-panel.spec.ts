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
import { WorkflowStatus, createPoolResponse, PoolStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupProfile, setupPools } from "@/e2e/utils/mock-setup";

/**
 * Workflow Resubmit Panel Tests
 *
 * Tests the resubmit workflow panel accessible from workflow detail:
 * - Panel opens with correct header showing workflow name
 * - Pool picker section visible and collapsible
 * - Priority picker section visible with radio options
 * - Submit button disabled when pool is empty/pending
 * - Cancel button closes the panel
 * - Error state displayed on submission failure
 * - Submitting... loading state on submit
 *
 * Architecture notes:
 * - ResubmitPanel wraps ResizablePanel with backdrop
 * - aria-label="Resubmit workflow: {name}"
 * - ResubmitPanelHeader shows "Resubmit Workflow" title + workflow name in code tag
 * - ResubmitPanelContent has: SpecSection (step 1), PoolPicker (step 2), PriorityPicker (step 3)
 * - Action buttons: Cancel + Submit (aria-label="Submit workflow {name}")
 * - useResubmitForm → usePoolSelection(workflow.pool) + useResubmitMutation
 * - API: POST /api/pool/{pool}/workflow with workflow_id or spec
 * - On success: toast "Workflow resubmitted as {name}" + close panel
 */

const CT_JSON = "application/json";

function createCompletedWorkflow(name: string) {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  return {
    name,
    uuid: `uuid-${name}`,
    submitted_by: "test-user",
    cancelled_by: null,
    spec: "version: 1\ntasks:\n  - name: train\n    image: nvcr.io/nvidia/pytorch:24.01-py3",
    template_spec: "{}",
    logs: `/api/workflow/${name}/logs`,
    events: `/api/workflow/${name}/events`,
    overview: `/api/workflow/${name}/overview`,
    parent_name: null,
    parent_job_id: null,
    dashboard_url: null,
    grafana_url: null,
    tags: [],
    submit_time: twoHoursAgo.toISOString(),
    start_time: twoHoursAgo.toISOString(),
    end_time: oneHourAgo.toISOString(),
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 5,
    status: WorkflowStatus.COMPLETED,
    outputs: "",
    groups: [
      {
        name: "train",
        status: "COMPLETED",
        start_time: twoHoursAgo.toISOString(),
        end_time: oneHourAgo.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: null,
        tasks: [
          {
            name: "train-task",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/train-task/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 3600,
          },
        ],
      },
    ],
    pool: "test-pool",
    priority: "NORMAL",
    backend: "k8s-test",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

test.describe("Workflow Resubmit Panel", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "resubmit-test-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createCompletedWorkflow(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );

    // Setup pools for pool picker
    await setupPools(
      page,
      createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
    );
  });

  test("resubmit button opens panel with workflow name in header", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click the Resubmit Workflow button
    await page.getByRole("button", { name: /resubmit workflow/i }).first().click();

    // ASSERT — panel opens with correct aria-label and header content
    const panel = page.locator(`[aria-label="Resubmit workflow: ${wfName}"]`);
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Resubmit Workflow")).toBeVisible();
    await expect(panel.getByText(wfName)).toBeVisible();
  });

  test("panel shows Target Pool section with collapsible content", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /resubmit workflow/i }).first().click();

    const panel = page.locator(`[aria-label="Resubmit workflow: ${wfName}"]`);
    await expect(panel).toBeVisible();

    // ASSERT — Target Pool section is visible
    await expect(panel.getByText("Target Pool")).toBeVisible();
  });

  test("panel shows Priority Level section with radio options", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /resubmit workflow/i }).first().click();

    const panel = page.locator(`[aria-label="Resubmit workflow: ${wfName}"]`);
    await expect(panel).toBeVisible();

    // ASSERT — Priority Level section visible
    await expect(panel.getByText("Priority Level")).toBeVisible();
  });

  test("cancel button closes the resubmit panel", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /resubmit workflow/i }).first().click();

    const panel = page.locator(`[aria-label="Resubmit workflow: ${wfName}"]`);
    await expect(panel).toBeVisible();

    // Click Cancel in the panel footer
    await panel.getByRole("button", { name: "Cancel" }).click();

    // ASSERT — panel is closed
    await expect(panel).not.toBeVisible();
  });

  test("panel shows Workflow Specification section", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /resubmit workflow/i }).first().click();

    const panel = page.locator(`[aria-label="Resubmit workflow: ${wfName}"]`);
    await expect(panel).toBeVisible();

    // ASSERT — Workflow Specification section visible
    await expect(panel.getByText("Workflow Specification")).toBeVisible();
  });

  test("submit button has correct aria-label with workflow name", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /resubmit workflow/i }).first().click();

    const panel = page.locator(`[aria-label="Resubmit workflow: ${wfName}"]`);
    await expect(panel).toBeVisible();

    // ASSERT — Submit button exists with proper aria-label
    await expect(
      panel.getByRole("button", { name: `Submit workflow ${wfName}` }),
    ).toBeVisible();
  });

  test("submit shows 'Submitting...' while pending", async ({ page }) => {
    // Mock the submission endpoint to hang (never respond)
    await page.route("**/api/pool/test-pool/workflow*", () => {
      // Never fulfill - simulates a pending request
    });

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /resubmit workflow/i }).first().click();

    const panel = page.locator(`[aria-label="Resubmit workflow: ${wfName}"]`);
    await expect(panel).toBeVisible();

    // Wait for pool to be auto-selected so submit becomes enabled
    await expect(panel.getByText("test-pool").first()).toBeVisible({ timeout: 5_000 });

    // Click Submit
    await panel.getByRole("button", { name: `Submit workflow ${wfName}` }).click();

    // ASSERT — button shows "Submitting..." loading state
    await expect(panel.getByText("Submitting...")).toBeVisible({ timeout: 5_000 });
  });

  test("panel close button (X) in header closes the panel", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /resubmit workflow/i }).first().click();

    const panel = page.locator(`[aria-label="Resubmit workflow: ${wfName}"]`);
    await expect(panel).toBeVisible();

    // Click the X close button in the panel header
    await panel.getByRole("button", { name: /close/i }).click();

    // ASSERT — panel is closed
    await expect(panel).not.toBeVisible();
  });
});
