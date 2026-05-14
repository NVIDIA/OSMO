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
 * Workflow Detail Task Navigation Tests
 *
 * Tests navigating from the workflow detail Tasks tab into specific
 * group and task detail views via URL parameters.
 *
 * Architecture notes:
 * - Tasks tab shows WorkflowTasksTable (tree of groups/tasks)
 * - Clicking a group navigates to ?group={groupName}
 * - Group detail view shows GroupDetails with Overview and Tasks tabs
 * - GroupDetails has breadcrumb navigation back to workflow
 * - Group Overview shows task stats (completed/running/failed counts)
 * - Group Tasks tab shows tasks within that group
 *
 * Note: workflow-group-nav.spec.ts covers DAG node clicks.
 * This spec covers the Tasks TABLE interactions.
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
    spec: `/api/workflow/${name}/spec`,
    template_spec: `/api/workflow/${name}/template_spec`,
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
    end_time: null,
    exec_timeout: null,
    queue_timeout: null,
    duration: 7200,
    queued_time: 3,
    status: WorkflowStatus.RUNNING,
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
        downstream_groups: ["train"],
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
        name: "train",
        status: "RUNNING",
        start_time: oneHourAgo.toISOString(),
        end_time: null,
        processing_start_time: oneHourAgo.toISOString(),
        scheduling_start_time: oneHourAgo.toISOString(),
        initializing_start_time: oneHourAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: ["eval"],
        failure_message: null,
        tasks: [
          {
            name: "train-worker-0",
            retry_id: 0,
            status: "RUNNING",
            failure_message: null,
            exit_code: null,
            logs: `/api/workflow/${name}/task/train-worker-0/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: null,
            duration: 3600,
          },
          {
            name: "train-worker-1",
            retry_id: 0,
            status: "RUNNING",
            failure_message: null,
            exit_code: null,
            logs: `/api/workflow/${name}/task/train-worker-1/logs`,
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
      {
        name: "eval",
        status: "PENDING",
        start_time: null,
        end_time: null,
        processing_start_time: null,
        scheduling_start_time: null,
        initializing_start_time: null,
        remaining_upstream_groups: ["train"],
        downstream_groups: [],
        failure_message: null,
        tasks: [
          {
            name: "eval-task",
            retry_id: 0,
            status: "PENDING",
            failure_message: null,
            exit_code: null,
            logs: `/api/workflow/${name}/task/eval-task/logs`,
            error_logs: null,
            processing_start_time: null,
            scheduling_start_time: null,
            initializing_start_time: null,
            start_time: null,
            end_time: null,
            duration: null,
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

test.describe("Workflow Detail Tasks Tab Navigation", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "task-nav-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createMultiGroupWorkflow(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
  });

  test("Tasks tab shows all group names from workflow", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click Tasks tab
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — all group names visible
    await expect(page.getByText("data-prep").first()).toBeVisible();
    await expect(page.getByText("train").first()).toBeVisible();
    await expect(page.getByText("eval").first()).toBeVisible();
  });

  test("Tasks tab shows task names within groups", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — task names visible
    await expect(page.getByText("download-data").first()).toBeVisible();
    await expect(page.getByText("train-worker-0").first()).toBeVisible();
  });

  test("clicking a group in tasks table navigates to group detail (URL param)", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: "Tasks" }).click();

    // Click on the "data-prep" group
    await page.getByText("data-prep").first().click();

    // ASSERT — URL updates with group param
    await expect(page).toHaveURL(/group=data-prep/);
  });

  test("group detail shows Overview and Tasks tabs", async ({ page }) => {
    // ACT — navigate directly to a group
    await page.goto(`/workflows/${wfName}?group=train`);
    await page.waitForLoadState("networkidle");

    // ASSERT — group detail tabs visible
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tasks" })).toBeVisible();
  });

  test("group detail shows group name in header area", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=train`);
    await page.waitForLoadState("networkidle");

    // ASSERT — group name appears
    await expect(page.getByText("train").first()).toBeVisible();
  });

  test("group detail Tasks tab shows tasks within the group", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=data-prep`);
    await page.waitForLoadState("networkidle");

    // Click Tasks tab in group detail
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — tasks within the group visible
    await expect(page.getByText("download-data").first()).toBeVisible();
    await expect(page.getByText("validate-data").first()).toBeVisible();
  });
});
