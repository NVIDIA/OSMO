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
 * Cancel Workflow Dialog UI Tests
 *
 * Tests the cancel-workflow-dialog.tsx visual/interaction states:
 * - Dialog layout: title, workflow name badge, reason textarea, force checkbox
 * - "Keep Running" button closes dialog without action
 * - "Confirm" button submits the form
 * - Error state display within the dialog
 * - Loading (isPending) state disables form elements
 *
 * Complements workflow-cancel-mutation.spec.ts which tests the API mutation flow.
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

test.describe("Cancel Workflow Dialog — UI Layout", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "dialog-layout-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createRunningWorkflow(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("dialog shows Cancel Workflow title", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /cancel workflow/i }).first().click();

    // ASSERT — dialog title visible
    await expect(page.getByText("Cancel Workflow").first()).toBeVisible();
  });

  test("dialog shows workflow name in a code badge", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /cancel workflow/i }).first().click();

    // ASSERT — workflow name visible in dialog
    await expect(page.locator("code").filter({ hasText: wfName })).toBeVisible();
  });

  test("dialog shows Keep Running and Confirm buttons", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /cancel workflow/i }).first().click();

    // ASSERT — action buttons visible
    await expect(page.getByRole("button", { name: "Keep Running" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
  });

  test("Keep Running button closes the dialog", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /cancel workflow/i }).first().click();
    await expect(page.getByRole("button", { name: "Keep Running" })).toBeVisible();

    // Click Keep Running
    await page.getByRole("button", { name: "Keep Running" }).click();

    // ASSERT — dialog is closed (Confirm button no longer visible)
    await expect(page.getByRole("button", { name: "Confirm" })).not.toBeVisible();
  });

  test("force cancel tooltip explains what force cancel does", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /cancel workflow/i }).first().click();

    // Hover over the info icon next to "Force cancel"
    await page.getByRole("button", { name: "What is force cancel?" }).hover();

    // ASSERT — tooltip content appears
    await expect(page.getByText(/cancels the workflow even if/i).first()).toBeVisible();
  });

  test("dialog shows error message when cancel API fails", async ({ page }) => {
    // ARRANGE — cancel endpoint returns error
    await page.route(`**/api/workflow/${wfName}/cancel*`, (route) =>
      route.fulfill({
        status: 500,
        contentType: CT_JSON,
        body: JSON.stringify({ detail: "Internal server error" }),
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: /cancel workflow/i }).first().click();
    await page.getByRole("button", { name: "Confirm" }).click();

    // ASSERT — error message displayed inline in dialog (dialog stays open)
    await expect(page.getByText(/failed to cancel|internal server error/i).first()).toBeVisible();
    // Dialog should remain open
    await expect(page.getByRole("button", { name: "Keep Running" })).toBeVisible();
  });
});
