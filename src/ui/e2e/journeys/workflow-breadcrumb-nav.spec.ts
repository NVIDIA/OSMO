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
 * Panel Header Breadcrumb Navigation Tests
 *
 * Tests the breadcrumb navigation in DetailsPanelHeader used to navigate
 * back from task/group views to parent workflow/group views.
 *
 * Coverage gaps addressed:
 * - Breadcrumb shows workflow name when viewing group details
 * - Breadcrumb shows workflow name + group name when viewing task details
 * - Clicking breadcrumb workflow name navigates back to workflow view
 * - Task detail shows breadcrumb with "Navigate to" aria-label
 *
 * Architecture notes:
 * - DetailsPanelHeader renders breadcrumbs as buttons with "Navigate to {label}"
 * - Group view: single breadcrumb "workflowName" → onClick navigates to workflow
 * - Task view: two breadcrumbs "workflowName > groupName" → onClick navigates to workflow/group
 * - ChevronRight separators between breadcrumb segments
 */

const CT_JSON = "application/json";

function createBreadcrumbWorkflow(name: string) {
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
            name: "download-task",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/download-task/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 3600,
            task_uuid: "task-uuid-download",
            node_name: "node-01",
            pod_name: "download-pod",
            pod_ip: "10.0.1.1",
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
            task_uuid: "task-uuid-train-0",
            node_name: "node-02",
            pod_name: "train-0-pod",
            pod_ip: "10.0.1.2",
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
            task_uuid: "task-uuid-train-1",
            node_name: "node-03",
            pod_name: "train-1-pod",
            pod_ip: "10.0.1.3",
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

test.describe("Panel Header — Breadcrumb Navigation", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("group detail shows breadcrumb with workflow name", async ({ page }) => {
    const wfName = "breadcrumb-group-wf";
    const data = createBreadcrumbWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate to group detail via URL params
    await page.goto(`/workflows/${wfName}?group=data-prep`);
    await page.waitForLoadState("networkidle");

    // ASSERT — breadcrumb button with workflow name visible
    const breadcrumb = page.getByRole("button", { name: `Navigate to ${wfName}` });
    await expect(breadcrumb).toBeVisible({ timeout: 10_000 });
  });

  test("task detail shows breadcrumb with workflow and group names", async ({ page }) => {
    const wfName = "breadcrumb-task-wf";
    const data = createBreadcrumbWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate to task detail via URL params
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — breadcrumb buttons for workflow and group
    await expect(page.getByRole("button", { name: `Navigate to ${wfName}` })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Navigate to training" })).toBeVisible();
  });

  test("clicking workflow breadcrumb in task view navigates back", async ({ page }) => {
    const wfName = "breadcrumb-nav-wf";
    const data = createBreadcrumbWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate to task detail
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // Verify we're in task view
    await expect(page.getByText("Task", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // Click the workflow breadcrumb
    await page.getByRole("button", { name: `Navigate to ${wfName}` }).click();

    // ASSERT — should navigate back to workflow view (Workflow badge visible)
    await expect(page.getByText("Workflow", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("clicking group breadcrumb in task view navigates to group", async ({ page }) => {
    const wfName = "breadcrumb-grp-nav-wf";
    const data = createBreadcrumbWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate to task detail
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // Verify we're in task view
    await expect(page.getByText("Task", { exact: true }).first()).toBeVisible({ timeout: 10_000 });

    // Click the group breadcrumb
    await page.getByRole("button", { name: "Navigate to training" }).click();

    // ASSERT — should navigate to group view (Group badge visible)
    await expect(page.getByText("Group", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
