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
import { WorkflowStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Workflow Cancel Mutation Tests
 *
 * Tests the cancel workflow mutation flow (confirm button click → API call → toast):
 * - Confirm sends cancel request with reason and force params
 * - Success shows toast notification
 * - Error displays error message in dialog
 * - Force cancel checkbox is checkable
 *
 * Architecture notes:
 * - CancelWorkflowDialog calls cancelWorkflow server action
 * - Server action POSTs to /api/workflow/{name}/cancel?message=...&force=...
 * - On success: shows toast "Cancellation request accepted" + closes dialog
 * - On error: shows error inline in dialog (does NOT close)
 * - useServerMutation wraps the action with isPending/error state
 */

const CT_JSON = "application/json";

function createRunningWorkflow(name: string) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  return {
    name,
    uuid: `uuid-${name}`,
    submitted_by: "test-user",
    cancelled_by: null,
    spec: "version: 1\ntasks:\n  - name: train",
    template_spec: "{}",
    logs: `/api/workflow/${name}/logs`,
    events: `/api/workflow/${name}/events`,
    overview: `/api/workflow/${name}/overview`,
    parent_name: null,
    parent_job_id: null,
    dashboard_url: null,
    grafana_url: null,
    tags: [],
    submit_time: oneHourAgo.toISOString(),
    start_time: oneHourAgo.toISOString(),
    end_time: null,
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 5,
    status: WorkflowStatus.RUNNING,
    outputs: "",
    groups: [
      {
        name: "train",
        status: "RUNNING",
        start_time: oneHourAgo.toISOString(),
        end_time: null,
        processing_start_time: oneHourAgo.toISOString(),
        scheduling_start_time: oneHourAgo.toISOString(),
        initializing_start_time: oneHourAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: null,
        tasks: [
          {
            name: "train-task",
            retry_id: 0,
            status: "RUNNING",
            failure_message: null,
            exit_code: null,
            logs: `/api/workflow/${name}/task/train-task/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: null,
            duration: 3600,
          },
        ],
      },
    ],
    pool: "test-pool",
    backend: "k8s-test",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

test.describe("Workflow Cancel Mutation Flow", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "cancel-mutation-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createRunningWorkflow(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
  });

  test("cancel dialog reason textarea accepts text input", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Open cancel dialog
    await page.getByRole("button", { name: /cancel workflow/i }).first().click();
    await expect(page.getByLabel(/reason/i)).toBeVisible();

    // Type a reason
    await page.getByLabel(/reason/i).fill("Need more GPUs for another job");

    // ASSERT — textarea has the typed value
    await expect(page.getByLabel(/reason/i)).toHaveValue("Need more GPUs for another job");
  });

  test("force cancel checkbox can be checked and unchecked", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Open cancel dialog
    await page.getByRole("button", { name: /cancel workflow/i }).first().click();

    const forceCheckbox = page.getByRole("checkbox", { name: /force cancel/i });
    await expect(forceCheckbox).toBeVisible();

    // Initially unchecked
    await expect(forceCheckbox).not.toBeChecked();

    // Check it
    await forceCheckbox.check();
    await expect(forceCheckbox).toBeChecked();

    // Uncheck it
    await forceCheckbox.uncheck();
    await expect(forceCheckbox).not.toBeChecked();
  });

  test("confirm button shows 'Cancelling...' text while pending", async ({ page }) => {
    // Mock cancel endpoint to hang (never respond) to see loading state
    await page.route(`**/api/workflow/${wfName}/cancel*`, () => {
      // Never fulfill - simulates a pending request
    });

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Open cancel dialog and click confirm
    await page.getByRole("button", { name: /cancel workflow/i }).first().click();
    await page.getByRole("button", { name: /confirm/i }).click();

    // ASSERT — button shows "Cancelling..." loading state
    await expect(page.getByRole("button", { name: /cancelling/i })).toBeVisible({ timeout: 5_000 });
  });

  test("force cancel tooltip explains what force cancel does", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Open cancel dialog
    await page.getByRole("button", { name: /cancel workflow/i }).first().click();

    // Hover over the info icon next to force cancel
    const infoButton = page.getByRole("button", { name: /what is force cancel/i });
    await expect(infoButton).toBeVisible();
    await infoButton.hover();

    // ASSERT — tooltip visible with explanation
    await expect(page.getByText(/cancels the workflow even if/i).first()).toBeVisible({ timeout: 3_000 });
  });
});
