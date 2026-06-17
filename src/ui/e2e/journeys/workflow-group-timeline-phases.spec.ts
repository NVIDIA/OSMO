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
 * Group Timeline Phase Tests
 *
 * Tests the GroupTimeline phases rendered in the group detail Overview tab.
 * The GroupTimeline builds phases from pre-execution stages (Processing,
 * Scheduling, Initializing) and execution stages (Executing, Done/Failed).
 *
 * Coverage gaps addressed:
 * - Group timeline "Processing" phase label visibility
 * - Group timeline "Scheduling" phase label visibility
 * - Group timeline "Initializing" phase label visibility
 * - Group timeline "Executing" phase label visibility
 * - Group timeline "Done" milestone for completed groups
 * - Group timeline "Failed" milestone for failed groups
 *
 * Architecture notes:
 * - GroupTimeline (group-timeline.tsx) uses the same buildPreExecutionPhases
 *   and buildTerminalPhase utilities as TaskTimeline
 * - Pre-execution phases: processing_start_time → scheduling_start_time → initializing_start_time
 * - Execution phase: start_time → end_time
 * - Terminal phase: "Done" for completed groups, "Failed" for failed groups
 * - GroupOverviewTab wraps GroupTimeline in a Timeline section card
 */

const CT_JSON = "application/json";

function createWorkflowForGroupTimeline(
  name: string,
  groupOverrides: {
    status?: string;
    failure_message?: string | null;
  } = {},
) {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const almostTwoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000 + 10_000);
  const nearlyTwoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000 + 20_000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const groupStatus = groupOverrides.status ?? "COMPLETED";
  const isTerminal = ["COMPLETED", "FAILED", "FAILED_CANCELED"].includes(groupStatus);
  const wfStatus = groupStatus.startsWith("FAILED") ? WorkflowStatus.FAILED : WorkflowStatus.COMPLETED;

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
    end_time: isTerminal ? now.toISOString() : null,
    exec_timeout: null,
    queue_timeout: null,
    duration: isTerminal ? 7200 : null,
    queued_time: 5,
    status: wfStatus,
    outputs: "",
    priority: "NORMAL",
    groups: [
      {
        name: "train-group",
        status: groupStatus,
        start_time: oneHourAgo.toISOString(),
        end_time: isTerminal ? now.toISOString() : null,
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: almostTwoHoursAgo.toISOString(),
        initializing_start_time: nearlyTwoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: groupOverrides.failure_message ?? null,
        tasks: [
          {
            name: "train-task-0",
            retry_id: 0,
            status: groupStatus,
            failure_message: groupOverrides.failure_message ?? null,
            exit_code: groupStatus === "COMPLETED" ? 0 : groupStatus.startsWith("FAILED") ? 1 : null,
            logs: `/api/workflow/${name}/task/train-task-0/logs`,
            error_logs: groupStatus.startsWith("FAILED") ? `/api/workflow/${name}/task/train-task-0/error_logs` : null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: almostTwoHoursAgo.toISOString(),
            initializing_start_time: nearlyTwoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: isTerminal ? now.toISOString() : null,
            duration: isTerminal ? 3600 : null,
          },
          {
            name: "train-task-1",
            retry_id: 0,
            status: groupStatus,
            failure_message: null,
            exit_code: groupStatus === "COMPLETED" ? 0 : null,
            logs: `/api/workflow/${name}/task/train-task-1/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: almostTwoHoursAgo.toISOString(),
            initializing_start_time: nearlyTwoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: isTerminal ? now.toISOString() : null,
            duration: isTerminal ? 3600 : null,
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

test.describe("Group Timeline — Pre-Execution Phases", () => {
  test.describe.configure({ timeout: 60_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("completed group shows Processing phase in timeline", async ({ page }) => {
    const wfName = "grp-tl-processing-wf";
    const data = createWorkflowForGroupTimeline(wfName, { status: "COMPLETED" });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    // Select the group node
    const dagNode = page.getByRole("treeitem", { name: /train-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /train-group/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — "Processing" phase visible in group timeline
    await expect(page.getByText("Processing").first()).toBeVisible({ timeout: 5_000 });
  });

  test("completed group shows Scheduling phase in timeline", async ({ page }) => {
    const wfName = "grp-tl-scheduling-wf";
    const data = createWorkflowForGroupTimeline(wfName, { status: "COMPLETED" });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /train-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /train-group/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — "Scheduling" phase visible in group timeline
    await expect(page.getByText("Scheduling").first()).toBeVisible({ timeout: 5_000 });
  });

  test("completed group shows Initializing phase in timeline", async ({ page }) => {
    const wfName = "grp-tl-init-wf";
    const data = createWorkflowForGroupTimeline(wfName, { status: "COMPLETED" });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /train-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /train-group/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — "Initializing" phase visible in group timeline
    await expect(page.getByText("Initializing").first()).toBeVisible({ timeout: 5_000 });
  });

  test("completed group shows Executing phase in timeline", async ({ page }) => {
    const wfName = "grp-tl-exec-wf";
    const data = createWorkflowForGroupTimeline(wfName, { status: "COMPLETED" });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /train-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /train-group/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — "Executing" phase visible in group timeline
    await expect(page.getByText("Executing").first()).toBeVisible({ timeout: 5_000 });
  });

  test("completed group shows Done milestone in timeline", async ({ page }) => {
    const wfName = "grp-tl-done-wf";
    const data = createWorkflowForGroupTimeline(wfName, { status: "COMPLETED" });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /train-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /train-group/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — "Done" terminal milestone visible in group timeline
    await expect(page.getByText("Done").first()).toBeVisible({ timeout: 5_000 });
  });

  test("failed group shows Failed milestone in timeline", async ({ page }) => {
    const wfName = "grp-tl-failed-wf";
    const data = createWorkflowForGroupTimeline(wfName, {
      status: "FAILED",
      failure_message: "GPU memory exceeded",
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator(".react-flow")).toBeVisible({ timeout: 20_000 });

    const dagNode = page.getByRole("treeitem", { name: /train-group/i }).first();
    await selectDagGroup(page, dagNode);
    await expect(page.getByRole("heading", { name: /train-group/i })).toBeVisible({ timeout: 20_000 });

    // ASSERT — "Failed" terminal milestone visible in group timeline
    await expect(page.getByText("Failed").first()).toBeVisible({ timeout: 5_000 });
  });
});
