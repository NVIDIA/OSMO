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
 * Workflow Task Detail Panel Tests
 *
 * Tests navigating into the task detail panel from the workflow detail page
 * and verifying the task-level content (Overview, Shell, Logs, Events tabs).
 *
 * Architecture notes:
 * - Task detail panel is reached via ?group={groupName}&task={taskName}
 * - TaskDetails component shows: header (task name + status), tabs (Overview/Shell/Logs/Events)
 * - Overview tab: Timeline section, Details section (UUID, Node, Pod, Pod IP), Links section
 * - Shell tab: shows status prompt for non-running tasks ("Task Completed", "Task Failed", etc.)
 * - Logs tab: shows LogViewerContainer
 * - Events tab: shows EventViewerContainer
 * - Header has breadcrumbs: Workflow > Group > Task (or Workflow > Task for standalone)
 */

const CT_JSON = "application/json";

function createWorkflowWithTaskDetails(name: string) {
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
    dashboard_url: "https://dashboard.example.com/wf",
    grafana_url: "https://grafana.example.com/wf",
    tags: [],
    submit_time: twoHoursAgo.toISOString(),
    start_time: twoHoursAgo.toISOString(),
    end_time: null,
    exec_timeout: null,
    queue_timeout: null,
    duration: 7200,
    queued_time: 5,
    status: WorkflowStatus.RUNNING,
    outputs: "",
    priority: "NORMAL",
    groups: [
      {
        name: "training",
        status: "RUNNING",
        start_time: twoHoursAgo.toISOString(),
        end_time: null,
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
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
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: null,
            duration: 3600,
            task_uuid: "task-uuid-worker-0",
            node_name: "gpu-node-01.cluster.local",
            pod_name: "train-worker-0-pod-abc123",
            pod_ip: "10.0.1.42",
            dashboard_url: "https://dashboard.example.com/pod/train-worker-0",
            lead: true,
          },
          {
            name: "train-worker-1",
            retry_id: 0,
            status: "RUNNING",
            failure_message: null,
            exit_code: null,
            logs: `/api/workflow/${name}/task/train-worker-1/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: null,
            duration: 3600,
            task_uuid: "task-uuid-worker-1",
            node_name: "gpu-node-02.cluster.local",
            pod_name: "train-worker-1-pod-def456",
            pod_ip: "10.0.1.43",
            dashboard_url: null,
            lead: false,
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
        remaining_upstream_groups: ["training"],
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
            task_uuid: "task-uuid-eval",
            node_name: null,
            pod_name: null,
            pod_ip: null,
            dashboard_url: null,
            lead: false,
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

function createFailedWorkflowWithTask(name: string) {
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
    end_time: oneHourAgo.toISOString(),
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 3,
    status: WorkflowStatus.FAILED,
    outputs: "",
    priority: "NORMAL",
    groups: [
      {
        name: "train",
        status: "FAILED",
        start_time: twoHoursAgo.toISOString(),
        end_time: oneHourAgo.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: "OOM killed",
        tasks: [
          {
            name: "train-task",
            retry_id: 0,
            status: "FAILED",
            failure_message: "Container killed: OOM",
            exit_code: 137,
            logs: `/api/workflow/${name}/task/train-task/logs`,
            error_logs: `/api/workflow/${name}/task/train-task/error_logs`,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 3600,
            task_uuid: "task-uuid-failed",
            node_name: "gpu-node-03.cluster.local",
            pod_name: "train-task-pod-xyz789",
            pod_ip: "10.0.2.10",
            dashboard_url: null,
            lead: false,
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

test.describe("Workflow Task Detail — Overview Tab", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "task-detail-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowWithTaskDetails(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
  });

  test("task detail shows task name in header", async ({ page }) => {
    // ACT — navigate directly to task view
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — task name visible in header
    await expect(page.getByText("train-worker-0").first()).toBeVisible();
  });

  test("task detail shows Overview tab with node hostname", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — node hostname visible in details section
    await expect(page.getByText("gpu-node-01.cluster.local").first()).toBeVisible();
  });

  test("task detail shows Pod name in details section", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Pod name visible
    await expect(page.getByText("train-worker-0-pod-abc123").first()).toBeVisible();
  });

  test("task detail shows all four tabs (Overview, Shell, Logs, Events)", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — all tabs visible
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Shell" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Logs" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Events" })).toBeVisible();
  });

  test("task detail shows breadcrumb with workflow name", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — breadcrumb includes workflow name
    await expect(page.getByText(wfName).first()).toBeVisible();
  });

  test("task detail shows breadcrumb with group name for multi-task groups", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — breadcrumb includes group name "training"
    await expect(page.getByText("training").first()).toBeVisible();
  });
});

test.describe("Workflow Task Detail — Shell Tab Status", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "task-shell-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shell tab shows 'Task Failed' message for failed task", async ({ page }) => {
    const data = createFailedWorkflowWithTask(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // Click Shell tab
    await page.getByRole("tab", { name: "Shell" }).click();

    // ASSERT — task failed message visible
    await expect(page.getByText("Task Failed").first()).toBeVisible();
  });

  test("shell tab shows 'Task Completed' for completed task", async ({ page }) => {
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const data = {
      name: wfName,
      uuid: `uuid-${wfName}`,
      submitted_by: "test-user",
      cancelled_by: null,
      spec: `/api/workflow/${wfName}/spec`,
      template_spec: `/api/workflow/${wfName}/template_spec`,
      logs: `/api/workflow/${wfName}/logs`,
      events: `/api/workflow/${wfName}/events`,
      overview: `/api/workflow/${wfName}/overview`,
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
      queued_time: 3,
      status: WorkflowStatus.COMPLETED,
      outputs: "",
      priority: "NORMAL",
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
              logs: `/api/workflow/${wfName}/task/train-task/logs`,
              error_logs: null,
              processing_start_time: twoHoursAgo.toISOString(),
              scheduling_start_time: twoHoursAgo.toISOString(),
              initializing_start_time: twoHoursAgo.toISOString(),
              start_time: twoHoursAgo.toISOString(),
              end_time: oneHourAgo.toISOString(),
              duration: 3600,
              task_uuid: "task-uuid-completed",
              node_name: "gpu-node-01",
              pod_name: "train-task-pod",
              pod_ip: "10.0.1.50",
              dashboard_url: null,
              lead: false,
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

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // Click Shell tab
    await page.getByRole("tab", { name: "Shell" }).click();

    // ASSERT — task completed message
    await expect(page.getByText("Task Completed").first()).toBeVisible();
  });
});

test.describe("Workflow Task Detail — Failed Task Error Display", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "task-error-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createFailedWorkflowWithTask(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
  });

  test("failed task shows exit code in overview", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — exit code visible
    await expect(page.getByText("Exit Code: 137").first()).toBeVisible();
  });

  test("failed task shows failure message in overview", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — failure message visible
    await expect(page.getByText("Container killed: OOM").first()).toBeVisible();
  });
});
