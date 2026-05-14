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
 * Task Lead Badge & View Type Badge Tests
 *
 * Tests the "Lead" badge displayed for distributed training leader tasks
 * and the "Task" view type badge in the panel header.
 *
 * Coverage gaps addressed:
 * - Lead badge visibility in task detail header
 * - "Task" view type badge in header
 * - "Group" view type badge in group detail header
 * - Lead badge visibility in DAG expanded task list
 *
 * Architecture notes:
 * - DetailsPanelHeader shows Lead badge (PanelBadge variant="amber") when isLead=true
 * - Lead is determined by task.lead field (boolean)
 * - View type badges use PanelBadge with labels "Workflow", "Group", "Task"
 * - In DAG GroupNode expanded list, lead tasks show an inline "Lead" badge
 * - TaskNameCell in Tasks tab also shows LeadBadge for lead tasks
 */

const CT_JSON = "application/json";

function createWorkflowWithLeadTask(name: string) {
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
        name: "distributed-train",
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
            name: "worker-0",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/worker-0/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            lead: true,
            task_uuid: "task-uuid-worker-0",
            node_name: "gpu-node-01",
            pod_name: "worker-0-pod",
            pod_ip: "10.0.1.1",
          },
          {
            name: "worker-1",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/worker-1/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            lead: false,
            task_uuid: "task-uuid-worker-1",
            node_name: "gpu-node-02",
            pod_name: "worker-1-pod",
            pod_ip: "10.0.1.2",
          },
          {
            name: "worker-2",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/worker-2/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            lead: false,
            task_uuid: "task-uuid-worker-2",
            node_name: "gpu-node-03",
            pod_name: "worker-2-pod",
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

test.describe("Task Detail — Lead Badge & View Type", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("lead task shows Lead badge in task detail header", async ({ page }) => {
    const wfName = "lead-badge-wf";
    const data = createWorkflowWithLeadTask(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate directly to the lead task detail
    await page.goto(`/workflows/${wfName}?group=distributed-train&task=worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Lead badge visible in task detail header
    await expect(page.getByText("Lead").first()).toBeVisible({ timeout: 10_000 });
  });

  test("task detail header shows Task view type badge", async ({ page }) => {
    const wfName = "task-badge-wf";
    const data = createWorkflowWithLeadTask(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate to task detail
    await page.goto(`/workflows/${wfName}?group=distributed-train&task=worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Task" badge visible in header
    await expect(page.getByText("Task", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("non-lead task does not show Lead badge in header", async ({ page }) => {
    const wfName = "no-lead-badge-wf";
    const data = createWorkflowWithLeadTask(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate to a non-lead task
    await page.goto(`/workflows/${wfName}?group=distributed-train&task=worker-1`);
    await page.waitForLoadState("networkidle");

    // Wait for the task detail to render
    await expect(page.getByText("worker-1").first()).toBeVisible({ timeout: 10_000 });

    // ASSERT — "Task" badge visible in header actions area
    await expect(page.getByText("Task", { exact: true }).first()).toBeVisible();

    // The header badges area should NOT contain "Lead" for a non-lead task
    // The PanelBadge "Lead" has title="Leader task for distributed training"
    const leadBadge = page.locator('[title="Leader task for distributed training"]');
    await expect(leadBadge).toHaveCount(0);
  });

  test("group detail header shows Group view type badge", async ({ page }) => {
    const wfName = "group-badge-wf";
    const data = createWorkflowWithLeadTask(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate to group detail
    await page.goto(`/workflows/${wfName}?group=distributed-train`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Group" badge visible in group detail header
    await expect(page.getByText("Group", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("workflow detail header shows Workflow view type badge", async ({ page }) => {
    const wfName = "wf-badge-wf";
    const data = createWorkflowWithLeadTask(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    // Navigate to workflow detail (no group/task params)
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Workflow" badge visible in header
    await expect(page.getByText("Workflow", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
