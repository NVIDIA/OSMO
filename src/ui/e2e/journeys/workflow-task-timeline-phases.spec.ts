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
 * Task Timeline Phase Tests
 *
 * Tests the TaskTimeline phases rendered in the task detail Overview tab.
 * The TaskTimeline builds phases from pre-execution stages (Processing,
 * Scheduling, Initializing) and execution stages (Input Download, Executing,
 * Output Upload, Done/Failed).
 *
 * Coverage gaps addressed:
 * - Task timeline "Processing" phase label visibility
 * - Task timeline "Scheduling" phase label visibility
 * - Task timeline "Initializing" phase label visibility
 * - Task timeline "Executing" phase label visibility
 * - Task timeline "Done" milestone for completed tasks
 * - Task timeline "Failed" milestone for failed tasks with exit code + failure message
 *
 * Architecture notes:
 * - TaskTimeline builds TimelinePhase[] from task timestamps:
 *   processing_start_time, scheduling_start_time, initializing_start_time,
 *   start_time (execution), input_download_start_time, output_upload_start_time
 * - Timeline component renders phase labels as <span> text
 * - Terminal phase is "Done" (completed) or "Failed" (failed)
 * - OverviewTab also renders an error banner for failed tasks with exit code + failure message
 */

const CT_JSON = "application/json";

function createWorkflowForTaskTimeline(
  name: string,
  taskOverrides: {
    status?: string;
    start_time?: string | null;
    end_time?: string | null;
    exit_code?: number | null;
    failure_message?: string | null;
    input_download_start_time?: string | null;
    input_download_end_time?: string | null;
    output_upload_start_time?: string | null;
  } = {},
) {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const almostTwoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000 + 10_000);
  const nearlyTwoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000 + 20_000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const taskStatus = taskOverrides.status ?? "COMPLETED";
  const wfStatus = taskStatus.startsWith("FAILED") ? WorkflowStatus.FAILED : taskStatus === "RUNNING" ? WorkflowStatus.RUNNING : WorkflowStatus.COMPLETED;

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
    end_time: taskOverrides.end_time !== undefined ? taskOverrides.end_time : oneHourAgo.toISOString(),
    exec_timeout: null,
    queue_timeout: null,
    duration: taskOverrides.end_time ? 3600 : null,
    queued_time: 10,
    status: wfStatus,
    outputs: "",
    priority: "NORMAL",
    groups: [
      {
        name: "train",
        status: taskStatus,
        start_time: taskOverrides.start_time !== undefined ? taskOverrides.start_time : oneHourAgo.toISOString(),
        end_time: taskOverrides.end_time !== undefined ? taskOverrides.end_time : oneHourAgo.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: almostTwoHoursAgo.toISOString(),
        initializing_start_time: nearlyTwoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: taskOverrides.failure_message ?? null,
        tasks: [
          {
            name: "train-task",
            retry_id: 0,
            status: taskStatus,
            failure_message: taskOverrides.failure_message ?? null,
            exit_code: taskOverrides.exit_code ?? (taskStatus === "COMPLETED" ? 0 : null),
            logs: `/api/workflow/${name}/task/train-task/logs`,
            error_logs: taskStatus.startsWith("FAILED") ? `/api/workflow/${name}/task/train-task/error_logs` : null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: almostTwoHoursAgo.toISOString(),
            initializing_start_time: nearlyTwoHoursAgo.toISOString(),
            start_time: taskOverrides.start_time !== undefined ? taskOverrides.start_time : oneHourAgo.toISOString(),
            end_time: taskOverrides.end_time !== undefined ? taskOverrides.end_time : oneHourAgo.toISOString(),
            duration: taskOverrides.end_time ? 3600 : null,
            task_uuid: "task-uuid-train",
            node_name: "gpu-node-01.cluster.local",
            pod_name: "train-task-pod-abc",
            pod_ip: "10.0.1.42",
            dashboard_url: null,
            lead: false,
            input_download_start_time: taskOverrides.input_download_start_time ?? null,
            input_download_end_time: taskOverrides.input_download_end_time ?? null,
            output_upload_start_time: taskOverrides.output_upload_start_time ?? null,
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

test.describe("Task Timeline — Pre-Execution Phases", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("completed task shows Processing phase label in timeline", async ({ page }) => {
    const wfName = "task-tl-processing-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTaskTimeline(wfName, {
      status: "COMPLETED",
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      exit_code: 0,
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Processing" phase label in the task timeline
    await expect(page.getByText("Processing").first()).toBeVisible();
  });

  test("completed task shows Scheduling phase label in timeline", async ({ page }) => {
    const wfName = "task-tl-scheduling-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTaskTimeline(wfName, {
      status: "COMPLETED",
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      exit_code: 0,
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Scheduling" phase label in the task timeline
    await expect(page.getByText("Scheduling").first()).toBeVisible();
  });

  test("completed task shows Initializing phase label in timeline", async ({ page }) => {
    const wfName = "task-tl-init-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTaskTimeline(wfName, {
      status: "COMPLETED",
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      exit_code: 0,
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Initializing" phase label in the task timeline
    await expect(page.getByText("Initializing").first()).toBeVisible();
  });

  test("completed task shows Executing phase label in timeline", async ({ page }) => {
    const wfName = "task-tl-exec-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTaskTimeline(wfName, {
      status: "COMPLETED",
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      exit_code: 0,
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Executing" phase label in the task timeline
    await expect(page.getByText("Executing").first()).toBeVisible();
  });

  test("completed task shows Done milestone in timeline", async ({ page }) => {
    const wfName = "task-tl-done-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTaskTimeline(wfName, {
      status: "COMPLETED",
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      exit_code: 0,
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Done" terminal phase label in timeline
    // The task timeline renders "Done" (not "Completed") for completed tasks
    const timelineSection = page.locator("section").filter({ hasText: "Timeline" });
    await expect(timelineSection.getByText("Done").first()).toBeVisible();
  });
});

test.describe("Task Timeline — Failed Task", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("failed task shows Failed milestone in timeline", async ({ page }) => {
    const wfName = "task-tl-failed-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTaskTimeline(wfName, {
      status: "FAILED",
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      exit_code: 137,
      failure_message: "Container killed: OOM",
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Failed" terminal phase label in task timeline
    const timelineSection = page.locator("section").filter({ hasText: "Timeline" });
    await expect(timelineSection.getByText("Failed").first()).toBeVisible();
  });

  test("failed task shows exit code in error banner", async ({ page }) => {
    const wfName = "task-tl-exitcode-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTaskTimeline(wfName, {
      status: "FAILED",
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      exit_code: 137,
      failure_message: "Container killed: OOM",
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — exit code 137 visible in the error banner
    await expect(page.getByText("Exit Code: 137").first()).toBeVisible();
  });

  test("failed task shows failure message in error banner", async ({ page }) => {
    const wfName = "task-tl-failmsg-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTaskTimeline(wfName, {
      status: "FAILED",
      start_time: oneHourAgo.toISOString(),
      end_time: now.toISOString(),
      exit_code: 1,
      failure_message: "Process exited with code 1",
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}?group=train&task=train-task`);
    await page.waitForLoadState("networkidle");

    // ASSERT — failure message visible in the error banner
    await expect(page.getByText("Process exited with code 1").first()).toBeVisible();
  });
});
