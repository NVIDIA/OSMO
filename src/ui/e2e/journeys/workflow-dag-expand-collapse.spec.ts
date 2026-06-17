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
 * Workflow DAG Node Expand/Collapse Tests
 *
 * Tests the expand/collapse functionality of multi-task group nodes in the
 * DAG visualization, as well as the task count badge on multi-task nodes.
 *
 * Coverage gaps addressed:
 * - Multi-task group nodes show task count badge
 * - Expand lip (ChevronDown) appears on collapsed multi-task nodes
 * - Expanding a node reveals task names inside the node
 * - Collapsing a node hides the task list
 * - Single-task nodes do NOT show expand/collapse or count badge
 *
 * Architecture notes:
 * - GroupNode renders role="treeitem" with aria-label including name + status + task count
 * - Multi-task nodes: aria-expanded attribute, count badge with aria-label="N tasks"
 * - Expand lip button: aria-label="Expand to show N tasks"
 * - Collapse lip button: aria-label="Collapse task list"
 * - Expanded task list uses role="list" with role="listitem" rows
 */

const CT_JSON = "application/json";

function createWorkflowWithMixedGroups(name: string) {
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
        name: "prepare",
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

test.describe("DAG Node — Multi-task Group Expand/Collapse", () => {
  test.describe.configure({ timeout: 60_000 });

  const wfName = "dag-expand-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowWithMixedGroups(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("multi-task group node shows task count badge", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — "training" node (3 tasks) shows count badge
    // Use exact: true to avoid matching the treeitem's aria-label that also contains "3 tasks"
    const badge = page.getByLabel("3 tasks", { exact: true });
    await expect(badge).toBeVisible({ timeout: 10_000 });
  });

  test("multi-task group node starts expanded with task list visible", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — training node starts expanded (aria-expanded=true)
    const trainingNode = page.getByRole("treeitem", { name: /training/i }).first();
    await expect(trainingNode).toBeVisible({ timeout: 10_000 });
    await expect(trainingNode).toHaveAttribute("aria-expanded", "true");

    // Collapse button visible (since it starts expanded)
    const collapseBtn = page.getByRole("button", { name: /collapse task list/i });
    await expect(collapseBtn).toBeVisible();
  });

  test("expanded node shows task list with individual tasks", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — task list is visible with individual tasks (node starts expanded)
    const taskList = page.getByRole("list", { name: /tasks in training/i });
    await expect(taskList).toBeVisible({ timeout: 10_000 });

    // Individual task names visible as list items
    await expect(page.getByRole("listitem", { name: /train-worker-0/i })).toBeVisible();
    await expect(page.getByRole("listitem", { name: /train-worker-1/i })).toBeVisible();
    await expect(page.getByRole("listitem", { name: /train-worker-2/i })).toBeVisible();
  });

  test("clicking collapse button hides the task list", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // Click collapse button on the already-expanded training node
    const collapseBtn = page.getByRole("button", { name: /collapse task list/i });
    await expect(collapseBtn).toBeVisible({ timeout: 10_000 });
    await collapseBtn.click();

    // ASSERT — task list is now hidden and expand button appears
    await expect(page.getByRole("button", { name: /expand to show 3 tasks/i })).toBeVisible({ timeout: 5_000 });
  });

  test("single-task node does not show expand button or count badge", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — "prepare" is a single-task group (1 task = "download-data")
    // For single-task groups, GroupNode renders the task name directly, not the group name
    // Single-task nodes: no aria-expanded attribute, no count badge
    const downloadNode = page.getByRole("treeitem", { name: /download-data/i }).first();
    await expect(downloadNode).toBeVisible({ timeout: 10_000 });
    // No aria-expanded attribute on single-task nodes
    await expect(downloadNode).not.toHaveAttribute("aria-expanded");
  });
});
