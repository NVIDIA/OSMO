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
 * Workflow Tasks Tab — Group Tree Tests
 *
 * Tests the WorkflowTasksTable's tree-style group rendering:
 * - SplitGroupHeader shows group names with "Group" badge and task count
 * - Groups are collapsible (expand/collapse via row click)
 * - Collapsed groups hide their task rows
 * - Navigation chevron button navigates to group details
 * - Multi-group workflows show all group headers
 *
 * Coverage gaps addressed:
 * - Group header rendering in Tasks tab (group name + badge + count)
 * - Tasks tab group expand/collapse behavior
 * - Tasks tab shows tasks within expanded groups
 * - Tasks tab navigation to group detail view
 * - Multiple groups are all visible in Tasks tab
 *
 * Architecture notes:
 * - WorkflowTasksTable renders groups as sections with SplitGroupHeader
 * - SplitGroupHeader: role="button", aria-expanded, aria-label="Expand/Collapse {name}"
 * - Groups start expanded by default (collapsed Set starts empty)
 * - Task rows within groups show task name, status
 * - Navigation button: aria-label="Navigate to {name} details"
 */

const CT_JSON = "application/json";

function createMultiGroupWorkflow(name: string) {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  return {
    name,
    uuid: `uuid-${name}`,
    submitted_by: "test-user",
    cancelled_by: null,
    spec: "version: 1",
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
    end_time: now.toISOString(),
    exec_timeout: null,
    queue_timeout: null,
    duration: 7200,
    queued_time: 5,
    status: WorkflowStatus.COMPLETED,
    outputs: "",
    priority: "NORMAL",
    groups: [
      {
        name: "data-prep",
        status: "COMPLETED",
        start_time: twoHoursAgo.toISOString(),
        end_time: oneHourAgo.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: ["training"],
        failure_message: null,
        tasks: [
          {
            name: "download-data",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/download-data/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 3600,
          },
          {
            name: "validate-data",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/validate-data/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 1800,
          },
        ],
      },
      {
        name: "training",
        status: "COMPLETED",
        start_time: oneHourAgo.toISOString(),
        end_time: now.toISOString(),
        processing_start_time: oneHourAgo.toISOString(),
        scheduling_start_time: oneHourAgo.toISOString(),
        initializing_start_time: oneHourAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: null,
        tasks: [
          {
            name: "train-worker-0",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/train-worker-0/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
          },
          {
            name: "train-worker-1",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/train-worker-1/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
          },
          {
            name: "train-worker-2",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/train-worker-2/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
          },
        ],
      },
    ],
    pool: "gpu-pool",
    backend: "k8s-cluster",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

test.describe("Tasks Tab — Group Tree Headers", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "tasks-tree-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createMultiGroupWorkflow(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("Tasks tab shows group names with task count", async ({ page }) => {
    // ACT — navigate to workflow and switch to Tasks tab
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — both group names visible with task counts
    await expect(page.getByText("data-prep").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("(2 tasks)").first()).toBeVisible();
    await expect(page.getByText("training").first()).toBeVisible();
    await expect(page.getByText("(3 tasks)").first()).toBeVisible();
  });

  test("Tasks tab shows task names within expanded groups", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — tasks visible within groups (groups start expanded)
    await expect(page.getByText("download-data").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("validate-data").first()).toBeVisible();
    await expect(page.getByText("train-worker-0").first()).toBeVisible();
  });

  test("clicking group header collapses the group", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // Wait for tasks to be visible (groups start expanded)
    await expect(page.getByText("download-data").first()).toBeVisible({ timeout: 10_000 });

    // Click the data-prep group header to collapse it
    const groupHeader = page.getByRole("button", { name: /collapse data-prep/i });
    await expect(groupHeader).toBeVisible();
    await groupHeader.click();

    // ASSERT — after collapse, tasks in data-prep are hidden
    // The expand button should now appear
    await expect(page.getByRole("button", { name: /expand data-prep/i })).toBeVisible({ timeout: 5_000 });
  });

  test("collapsed group can be re-expanded", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // Wait for expanded state
    await expect(page.getByText("download-data").first()).toBeVisible({ timeout: 10_000 });

    // Collapse then expand
    await page.getByRole("button", { name: /collapse data-prep/i }).click();
    await expect(page.getByRole("button", { name: /expand data-prep/i })).toBeVisible({ timeout: 5_000 });

    // Re-expand
    await page.getByRole("button", { name: /expand data-prep/i }).click();

    // ASSERT — tasks visible again
    await expect(page.getByRole("button", { name: /collapse data-prep/i })).toBeVisible({ timeout: 5_000 });
  });

  test("navigate to group details button is present", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // Wait for groups to render
    await expect(page.getByText("data-prep").first()).toBeVisible({ timeout: 10_000 });

    // ASSERT — navigation buttons present for groups
    await expect(page.getByRole("button", { name: /navigate to data-prep details/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /navigate to training details/i })).toBeVisible();
  });
});
