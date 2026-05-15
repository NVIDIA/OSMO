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

import { test, expect, type Page, type Locator } from "@playwright/test";
import { WorkflowStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Group Tasks Tab — Search and Interaction Tests
 *
 * Tests the GroupTasksTab component's search/filter toolbar and task interaction:
 * - Search input placeholder text
 * - Filter bar presence in group tasks tab
 * - Task row click selects the task (opens task detail)
 * - Task table shows status column
 *
 * Architecture notes:
 * - GroupTasksTab (group-tasks-tab.tsx) renders:
 *   - TableToolbar with search fields, filter chips, column visibility
 *   - DataTable with task rows (clickable)
 * - Search placeholder: "Filter by name, status:, ip:, duration:..."
 * - Clicking a task row calls onSelectTask → navigates to task detail
 * - TaskNameCell renders task name + optional Lead badge
 */

const CT_JSON = "application/json";

function createWorkflowForGroupTasks(name: string) {
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
        name: "multi-task-group",
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
            name: "task-alpha",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/task-alpha/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            lead: true,
            task_uuid: "uuid-alpha",
            node_name: "gpu-node-01",
            pod_name: "alpha-pod",
            pod_ip: "10.0.1.1",
          },
          {
            name: "task-beta",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/task-beta/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            lead: false,
            task_uuid: "uuid-beta",
            node_name: "gpu-node-02",
            pod_name: "beta-pod",
            pod_ip: "10.0.1.2",
          },
          {
            name: "task-gamma",
            retry_id: 0,
            status: "FAILED",
            failure_message: "Segmentation fault",
            exit_code: 139,
            logs: `/api/workflow/${name}/task/task-gamma/logs`,
            error_logs: `/api/workflow/${name}/task/task-gamma/error_logs`,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 1800,
            lead: false,
            task_uuid: "uuid-gamma",
            node_name: "gpu-node-03",
            pod_name: "gamma-pod",
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

/** Select a DAG group: focus + Enter to handle React Flow transforms */
async function selectDagGroup(page: Page, treeitem: Locator) {
  await expect(treeitem).toBeVisible({ timeout: 20_000 });
  await treeitem.scrollIntoViewIfNeeded();
  await treeitem.focus();
  await page.keyboard.press("Enter");
}

test.describe("Group Tasks Tab — Search & Interaction", () => {
  test.describe.configure({ timeout: 60_000 });

  const wfName = "group-tasks-interact-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowForGroupTasks(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("group Tasks tab shows search placeholder", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // Select the multi-task group
    const dagNode = page.getByRole("treeitem", { name: /multi-task-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /multi-task-group/i })).toBeVisible({ timeout: 20_000 });

    // Switch to Tasks tab
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — search input with placeholder is visible
    await expect(page.getByPlaceholder(/filter by name/i)).toBeVisible({ timeout: 10_000 });
  });

  test("group Tasks tab shows all task names", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /multi-task-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /multi-task-group/i })).toBeVisible({ timeout: 20_000 });

    // Switch to Tasks tab
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — all three task names visible
    await expect(page.getByText("task-alpha").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("task-beta").first()).toBeVisible();
    await expect(page.getByText("task-gamma").first()).toBeVisible();
  });

  test("group Tasks tab shows Lead badge for lead task", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /multi-task-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /multi-task-group/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — "Lead" badge text is visible (rendered by LeadBadge component in TaskNameCell)
    await expect(page.getByText("task-alpha").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Lead").first()).toBeVisible();
  });

  test("clicking a task row in group Tasks tab opens task detail", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /multi-task-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /multi-task-group/i })).toBeVisible({ timeout: 20_000 });

    await page.getByRole("tab", { name: "Tasks" }).click();
    await expect(page.getByText("task-beta").first()).toBeVisible({ timeout: 10_000 });

    // Click the task-beta row
    await page.getByText("task-beta").first().click();

    // ASSERT — task detail opens (Task badge should become visible)
    await expect(page.getByText("Task", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("group header shows correct task count in subtitle", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /multi-task-group/i }).first();
    await selectDagGroup(page, dagNode);

    // ASSERT — subtitle shows "3 tasks"
    await expect(page.getByText("3 tasks").first()).toBeVisible({ timeout: 20_000 });
  });
});
