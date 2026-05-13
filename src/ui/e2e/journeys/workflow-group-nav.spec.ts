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
 * Workflow Detail Group Selection Tests
 *
 * Tests selecting task groups within the workflow detail panel:
 * - Clicking a group in the DAG opens group details
 * - Group details shows group name and task count
 * - Breadcrumb navigation back to workflow
 *
 * Architecture notes:
 * - Workflow detail DAG shows nodes for each group
 * - Clicking a node navigates to GroupDetails view (breadcrumb: workflow > group)
 * - GroupDetails has tabs: Overview, Tasks
 * - GroupDetails header shows group name + "N tasks" subtitle
 * - Breadcrumb click navigates back to workflow level
 */

const CT_JSON = "application/json";

function createWorkflowWithMultipleGroups(name: string) {
  const now = new Date();
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
    submit_time: oneHourAgo.toISOString(),
    start_time: oneHourAgo.toISOString(),
    end_time: null,
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 5,
    status: WorkflowStatus.RUNNING,
    outputs: "",
    groups: [
      {
        name: "data-prep",
        status: "COMPLETED",
        start_time: oneHourAgo.toISOString(),
        end_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        processing_start_time: oneHourAgo.toISOString(),
        scheduling_start_time: oneHourAgo.toISOString(),
        initializing_start_time: oneHourAgo.toISOString(),
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
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            duration: 1800,
          },
          {
            name: "preprocess",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/preprocess/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            duration: 1800,
          },
        ],
      },
      {
        name: "training",
        status: "RUNNING",
        start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        end_time: null,
        processing_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        scheduling_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        initializing_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
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
            processing_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            scheduling_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            initializing_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            end_time: null,
            duration: 1800,
          },
          {
            name: "train-worker-1",
            retry_id: 0,
            status: "RUNNING",
            failure_message: null,
            exit_code: null,
            logs: `/api/workflow/${name}/task/train-worker-1/logs`,
            error_logs: null,
            processing_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            scheduling_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            initializing_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            end_time: null,
            duration: 1800,
          },
          {
            name: "train-worker-2",
            retry_id: 0,
            status: "RUNNING",
            failure_message: null,
            exit_code: null,
            logs: `/api/workflow/${name}/task/train-worker-2/logs`,
            error_logs: null,
            processing_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            scheduling_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            initializing_start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            start_time: new Date(now.getTime() - 30 * 60 * 1000).toISOString(),
            end_time: null,
            duration: 1800,
          },
        ],
      },
    ],
    pool: "training-pool",
    backend: "k8s-prod",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

test.describe("Workflow Detail Group Navigation", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "group-nav-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowWithMultipleGroups(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
  });

  test("clicking a group node in the DAG shows group details", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // Click the "data-prep" group in the DAG (outer node is role="treeitem";
    // the inner role="button" can be hard to hit under React Flow transforms in CI).
    const dagNode = page.getByRole("treeitem", { name: /data-prep/i }).first();
    await expect(dagNode).toBeVisible({ timeout: 15_000 });
    await dagNode.scrollIntoViewIfNeeded();
    await dagNode.click();

    // ASSERT — group details panel shows group name
    await expect(page.getByRole("heading", { name: /data-prep/i })).toBeVisible({ timeout: 15_000 });
    // Shows task count subtitle
    await expect(page.getByText("2 tasks", { exact: true }).first()).toBeVisible();
  });

  test("group details shows Overview and Tasks tabs", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // Click the "training" group node
    const dagNode = page.getByRole("treeitem", { name: /training,/i }).first();
    await expect(dagNode).toBeVisible({ timeout: 15_000 });
    await dagNode.scrollIntoViewIfNeeded();
    await dagNode.click();

    // ASSERT — group tabs visible
    await expect(page.getByRole("heading", { name: /^training$/i })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tasks" })).toBeVisible();
  });

  test("breadcrumb click navigates back to workflow details", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // Click the "data-prep" group
    const dagNode = page.getByRole("treeitem", { name: /data-prep/i }).first();
    await expect(dagNode).toBeVisible({ timeout: 15_000 });
    await dagNode.scrollIntoViewIfNeeded();
    await dagNode.click();

    // Wait for group details
    await expect(page.getByRole("heading", { name: /data-prep/i })).toBeVisible({ timeout: 15_000 });

    // Click breadcrumb to go back to workflow
    await page.getByRole("button", { name: wfName }).click();

    // ASSERT — back at workflow level (workflow name visible as heading again)
    await expect(page.getByRole("heading", { name: wfName })).toBeVisible({ timeout: 5_000 });
  });
});
