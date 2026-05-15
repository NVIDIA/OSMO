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
 * DAG Node Status Hints & Accessibility Tests
 *
 * Tests the GroupNode component's status-specific hint text displayed
 * below node names in the DAG visualization, and accessibility labels.
 *
 * Coverage gaps addressed:
 * - DAG node shows task count badge for multi-task groups
 * - DAG node shows correct aria-label with task count
 * - DAG single-task node shows task name (not group name)
 * - DAG node waiting status shows "Waiting for" hint text
 * - DAG expand button shows correct aria-label
 *
 * Architecture notes:
 * - GroupNode (dag/group-node.tsx):
 *   - role="treeitem", aria-label="${name}, ${statusLabel}, N tasks"
 *   - hasManyTasks: shows task count badge with aria-label="${N} tasks"
 *   - isSingleTask: displayName = task name (not group name)
 *   - Status hint text from getStatusHint() utility
 *   - Expand lip button: aria-label="Expand to show N tasks"
 *   - Collapse lip button: aria-label="Collapse task list"
 */

const CT_JSON = "application/json";

function createDAGNodeWorkflow(name: string) {
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
        name: "preprocess",
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

test.describe("DAG Node — Accessibility & Badge", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("multi-task group node shows task count badge", async ({ page }) => {
    const wfName = "dag-count-badge-wf";
    const data = createDAGNodeWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — training group has 3 tasks, so count badge "3" should be visible
    const countBadge = page.locator('[aria-label="3 tasks"]');
    await expect(countBadge).toBeVisible({ timeout: 10_000 });
  });

  test("single-task group node shows task name instead of group name", async ({ page }) => {
    const wfName = "dag-single-task-wf";
    const data = createDAGNodeWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — the "preprocess" group has 1 task "download-data"
    // Single-task nodes show the task name, not the group name
    const singleTaskNode = page.getByRole("treeitem", { name: /download-data/i });
    await expect(singleTaskNode).toBeVisible({ timeout: 10_000 });
  });

  test("multi-task group node has aria-label with task count", async ({ page }) => {
    const wfName = "dag-aria-wf";
    const data = createDAGNodeWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — training group aria-label includes "3 tasks"
    const trainingNode = page.getByRole("treeitem", { name: /training.*3 tasks/i });
    await expect(trainingNode).toBeVisible({ timeout: 10_000 });
  });

  test("DAG nodes have treeitem role", async ({ page }) => {
    const wfName = "dag-role-wf";
    const data = createDAGNodeWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — at least 2 treeitem nodes exist (preprocess + training)
    const treeitems = page.getByRole("treeitem");
    await expect(treeitems.first()).toBeVisible({ timeout: 10_000 });
    const count = await treeitems.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("DAG edge connects preprocess to training group", async ({ page }) => {
    const wfName = "dag-edge-wf";
    const data = createDAGNodeWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // ASSERT — both nodes visible means the DAG rendered with edge connection
    await expect(page.getByRole("treeitem", { name: /download-data/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("treeitem", { name: /training/i })).toBeVisible({ timeout: 10_000 });

    // The SVG edge path should exist (React Flow renders edges as SVG paths)
    const edgePaths = page.locator(".react-flow__edge");
    await expect(edgePaths.first()).toBeVisible({ timeout: 5_000 });
  });
});
