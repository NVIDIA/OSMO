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
 * Workflow Task Switcher & Detail Metadata Tests
 *
 * Tests the task switcher dropdown, lead badge, and detailed metadata
 * that is NOT covered by workflow-task-detail.spec.ts:
 * - Task switcher dropdown appears for multi-task groups
 * - Task switcher lists all sibling tasks
 * - Clicking a sibling in the switcher navigates to that task
 * - Lead badge shown for lead tasks
 * - Pod IP displayed in Details section
 * - Node name rendered as link to /resources?view=<nodeName>
 *
 * Architecture notes:
 * - DetailsPanelHeader renders TaskSwitcher when siblingTasks.length > 1
 * - TaskSwitcher has aria-label="Switch task" trigger button
 * - TaskSwitcher dropdown shows all sibling tasks with status icons
 * - Lead badge uses PanelBadge with "Lead" label and amber variant
 * - Node name links to /resources?view=<encoded-node-name>
 * - Pod IP shown as mono text with copyable
 */

const CT_JSON = "application/json";

function createWorkflowWithMultipleTasks(name: string) {
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
        name: "training",
        status: "COMPLETED",
        start_time: twoHoursAgo.toISOString(),
        end_time: now.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
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
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            task_uuid: "task-uuid-worker-0",
            node_name: "gpu-node-01.cluster.local",
            pod_name: "train-worker-0-pod-abc",
            pod_ip: "10.0.1.42",
            dashboard_url: "https://dashboard.example.com/pod/worker-0",
            lead: true,
          },
          {
            name: "train-worker-1",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/train-worker-1/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            task_uuid: "task-uuid-worker-1",
            node_name: "gpu-node-02.cluster.local",
            pod_name: "train-worker-1-pod-def",
            pod_ip: "10.0.2.88",
            dashboard_url: null,
            lead: false,
          },
          {
            name: "train-worker-2",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/train-worker-2/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            task_uuid: "task-uuid-worker-2",
            node_name: "gpu-node-03.cluster.local",
            pod_name: "train-worker-2-pod-ghi",
            pod_ip: "10.0.3.15",
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

test.describe("Task Switcher Dropdown", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "task-switcher-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowWithMultipleTasks(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("task switcher button visible for multi-task group", async ({ page }) => {
    // ACT — navigate to task within multi-task group
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — the "Switch task" button is visible
    await expect(page.getByRole("button", { name: "Switch task" })).toBeVisible();
  });

  test("task switcher dropdown lists all sibling tasks", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // Open the task switcher dropdown
    await page.getByRole("button", { name: "Switch task" }).click();

    // ASSERT — all three sibling task names visible in the dropdown
    await expect(page.getByRole("menuitem", { name: /train-worker-0/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /train-worker-1/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /train-worker-2/ })).toBeVisible();
  });

  test("clicking a sibling in the switcher navigates to that task", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // Open the switcher and click on train-worker-1
    await page.getByRole("button", { name: "Switch task" }).click();
    await page.getByRole("menuitem", { name: /train-worker-1/ }).click();

    // ASSERT — URL changes to the selected task
    await expect(page).toHaveURL(/task=train-worker-1/);
  });
});

test.describe("Task Detail — Lead Badge & Metadata", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "task-lead-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowWithMultipleTasks(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("lead task shows Lead badge in header", async ({ page }) => {
    // ACT — navigate to the lead task (train-worker-0 has lead: true)
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Lead badge visible
    await expect(page.getByText("Lead").first()).toBeVisible();
  });

  test("non-lead task does not show Lead badge in header", async ({ page }) => {
    // ACT — navigate to a non-lead task
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-1`);
    await page.waitForLoadState("networkidle");

    // Wait for the task details to load
    await expect(page.getByText("train-worker-1").first()).toBeVisible();

    // ASSERT — The "Task" badge should be visible (confirms header rendered),
    // but no "Lead" badge should appear for non-lead tasks.
    // The Lead badge uses PanelBadge with title="Leader task for distributed training"
    await expect(page.getByTitle("Leader task for distributed training")).not.toBeVisible();
  });

  test("task detail shows Pod IP in details section", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Pod IP visible
    await expect(page.getByText("10.0.1.42").first()).toBeVisible();
  });

  test("node name is rendered as a link to resources page", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}?group=training&task=train-worker-0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Node name is a link with proper href
    const nodeLink = page.getByRole("link", { name: "gpu-node-01.cluster.local" });
    await expect(nodeLink).toBeVisible();
    await expect(nodeLink).toHaveAttribute("href", /\/resources\?view=gpu-node-01\.cluster\.local/);
  });
});
