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
 * Workflow Group Detail Content Tests
 *
 * Tests group-level detail content beyond basic navigation (covered by workflow-group-nav.spec.ts):
 * - Group Overview tab shows Timeline section with timing data
 * - Group Overview tab shows Dependencies section when group has upstream/downstream deps
 * - Failed group shows failure message in the Timeline card
 * - Group Tasks tab shows task names
 * - Group status subtitle shows correct task count
 *
 * Architecture notes:
 * - GroupDetails (panel/ui/group/group-details.tsx)
 *   - Header: group name + "N tasks" subtitle + status content (status icon + duration)
 *   - Tabs: Overview, Tasks
 *   - Overview tab (group-overview-tab.tsx):
 *     - Timeline section: GroupTimeline component (scheduling_start_time → end_time phases)
 *     - Failure message: red alert inside timeline card
 *     - Dependencies section: DependenciesSection with upstream/downstream pills
 *   - Tasks tab (group-tasks-tab.tsx):
 *     - Table of tasks within the group with status and duration
 */

const CT_JSON = "application/json";

function createWorkflowWithGroupDeps(name: string) {
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
        name: "prepare-data",
        status: "COMPLETED",
        start_time: twoHoursAgo.toISOString(),
        end_time: oneHourAgo.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: ["train-model"],
        failure_message: null,
        tasks: [
          {
            name: "download",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/download/logs`,
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
        name: "train-model",
        status: "COMPLETED",
        start_time: oneHourAgo.toISOString(),
        end_time: now.toISOString(),
        processing_start_time: oneHourAgo.toISOString(),
        scheduling_start_time: oneHourAgo.toISOString(),
        initializing_start_time: oneHourAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: ["evaluate"],
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
        ],
      },
      {
        name: "evaluate",
        status: "COMPLETED",
        start_time: now.toISOString(),
        end_time: now.toISOString(),
        processing_start_time: now.toISOString(),
        scheduling_start_time: now.toISOString(),
        initializing_start_time: now.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: null,
        tasks: [
          {
            name: "eval-task",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/eval-task/logs`,
            error_logs: null,
            processing_start_time: now.toISOString(),
            scheduling_start_time: now.toISOString(),
            initializing_start_time: now.toISOString(),
            start_time: now.toISOString(),
            end_time: now.toISOString(),
            duration: 60,
          },
        ],
      },
    ],
    pool: "prod-pool",
    backend: "k8s-prod",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

function createWorkflowWithFailedGroup(name: string) {
  const now = new Date();
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
    submit_time: oneHourAgo.toISOString(),
    start_time: oneHourAgo.toISOString(),
    end_time: now.toISOString(),
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 5,
    status: WorkflowStatus.FAILED,
    outputs: "",
    priority: "HIGH",
    groups: [
      {
        name: "failing-step",
        status: "FAILED",
        start_time: oneHourAgo.toISOString(),
        end_time: now.toISOString(),
        processing_start_time: oneHourAgo.toISOString(),
        scheduling_start_time: oneHourAgo.toISOString(),
        initializing_start_time: oneHourAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: "OOMKilled: Container exceeded memory limit (32Gi)",
        tasks: [
          {
            name: "oom-task",
            retry_id: 0,
            status: "FAILED",
            failure_message: "OOMKilled: Container exceeded memory limit (32Gi)",
            exit_code: 137,
            logs: `/api/workflow/${name}/task/oom-task/logs`,
            error_logs: `/api/workflow/${name}/task/oom-task/error_logs`,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
          },
          {
            name: "skipped-task",
            retry_id: 0,
            status: "PENDING",
            failure_message: null,
            exit_code: null,
            logs: `/api/workflow/${name}/task/skipped-task/logs`,
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
    pool: "prod-pool",
    backend: "k8s-prod",
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

test.describe("Group Overview — Dependencies", () => {
  test.describe.configure({ timeout: 60_000 });

  const wfName = "group-deps-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowWithGroupDeps(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("group with upstream and downstream dependencies shows Dependencies section", async ({ page }) => {
    // ACT — navigate to workflow detail, select "train-model" group (has both upstream and downstream)
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /train-model/i }).first();
    await selectDagGroup(page, dagNode);

    // Wait for group details to load
    await expect(page.getByRole("heading", { name: /train-model/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — Dependencies section is visible with upstream and downstream labels
    await expect(page.getByText("Upstream").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Downstream").first()).toBeVisible({ timeout: 5_000 });
  });

  test("group with upstream dependencies shows upstream group name as pill", async ({ page }) => {
    // ACT — select "train-model" (upstream: prepare-data)
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /train-model/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /train-model/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — "prepare-data" appears as an upstream dependency pill
    await expect(page.getByText("prepare-data").first()).toBeVisible({ timeout: 5_000 });
  });

  test("group shows correct task count in subtitle", async ({ page }) => {
    // ACT — select "train-model" (has 2 tasks)
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /train-model/i }).first();
    await selectDagGroup(page, dagNode);

    // ASSERT — "2 tasks" subtitle visible
    await expect(page.getByText(/\b2\s+tasks\b/).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Group Overview — Failure Message", () => {
  test.describe.configure({ timeout: 60_000 });

  const wfName = "group-fail-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowWithFailedGroup(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("failed group shows failure message in overview timeline", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /failing-step/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /failing-step/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — failure message is displayed in the overview tab
    await expect(page.getByText("OOMKilled: Container exceeded memory limit").first()).toBeVisible({ timeout: 5_000 });
  });

  test("failed group Tasks tab shows both failed and pending tasks", async ({ page }) => {
    // ACT — select the failed group and switch to Tasks tab
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /failing-step/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /failing-step/i })).toBeVisible({ timeout: 20_000 });

    // Switch to Tasks tab
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — both task names are visible in the tasks table
    await expect(page.getByText("oom-task").first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("skipped-task").first()).toBeVisible({ timeout: 5_000 });
  });
});
