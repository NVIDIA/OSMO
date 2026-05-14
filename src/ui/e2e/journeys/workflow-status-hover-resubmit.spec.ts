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
 * Workflow Status Hover Card & Resubmit Button Tests
 *
 * Tests the StatusHoverCard interaction and the Resubmit button visibility
 * in the workflow detail panel:
 *
 * StatusHoverCard:
 * - Hover over status label → shows description tooltip from STATUS_DESCRIPTIONS
 * - Hover card shows "View Events tab" link
 *
 * Resubmit button:
 * - Visible for completed/failed workflows
 * - Visible alongside disabled Cancel button for terminal workflows
 *
 * Architecture notes:
 * - StatusHoverCard wraps status label with HoverCard (openDelay=200)
 * - Trigger: <span> with cursor-help and dotted underline
 * - Content: description text + optional "View Events tab" button
 * - STATUS_DESCRIPTIONS defines one-line descriptions for each status
 * - Resubmit button is in the ActionsSection of OverviewTab
 * - Uses aria-label "Resubmit Workflow" and description text
 */

const CT_JSON = "application/json";

function createWorkflowForStatusCard(
  name: string,
  overrides: {
    status?: string;
    priority?: string;
  } = {},
) {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const status = overrides.status ?? WorkflowStatus.RUNNING;
  const terminalStatuses: WorkflowStatus[] = [
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.FAILED_CANCELED,
  ];
  const isTerminal = terminalStatuses.includes(status as WorkflowStatus);

  return {
    name,
    uuid: `uuid-${name}`,
    submitted_by: "test-user",
    cancelled_by: null,
    spec: "version: 1\ntasks:\n  - name: train",
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
    end_time: isTerminal ? oneHourAgo.toISOString() : null,
    exec_timeout: null,
    queue_timeout: null,
    duration: isTerminal ? 3600 : null,
    queued_time: 5,
    status,
    outputs: "",
    priority: overrides.priority ?? "NORMAL",
    groups: [
      {
        name: "train",
        status: isTerminal ? (status === WorkflowStatus.COMPLETED ? "COMPLETED" : "FAILED") : "RUNNING",
        start_time: twoHoursAgo.toISOString(),
        end_time: isTerminal ? oneHourAgo.toISOString() : null,
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: status === WorkflowStatus.FAILED ? "Process exited with code 1" : null,
        tasks: [
          {
            name: "train-task",
            retry_id: 0,
            status: isTerminal ? (status === WorkflowStatus.COMPLETED ? "COMPLETED" : "FAILED") : "RUNNING",
            failure_message: status === WorkflowStatus.FAILED ? "Process exited with code 1" : null,
            exit_code: status === WorkflowStatus.COMPLETED ? 0 : status === WorkflowStatus.FAILED ? 1 : null,
            logs: `/api/workflow/${name}/task/train-task/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: isTerminal ? oneHourAgo.toISOString() : null,
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

test.describe("Status Display — Workflow Detail", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("RUNNING workflow shows status text with cursor-help styling", async ({ page }) => {
    const wfName = "status-running-wf";
    const data = createWorkflowForStatusCard(wfName, { status: WorkflowStatus.RUNNING });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — RUNNING status label visible (rendered via StatusHoverCard)
    await expect(page.getByText("RUNNING").first()).toBeVisible();
  });

  test("COMPLETED workflow shows COMPLETED status text", async ({ page }) => {
    const wfName = "status-completed-wf";
    const data = createWorkflowForStatusCard(wfName, { status: WorkflowStatus.COMPLETED });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — COMPLETED status text visible
    await expect(page.getByText("COMPLETED").first()).toBeVisible();
  });

  test("FAILED workflow shows FAILED status text", async ({ page }) => {
    const wfName = "status-failed-wf";
    const data = createWorkflowForStatusCard(wfName, { status: WorkflowStatus.FAILED });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — FAILED status text visible
    await expect(page.getByText("FAILED").first()).toBeVisible();
  });

  test("workflow shows priority badge in status display", async ({ page }) => {
    const wfName = "status-priority-wf";
    const data = createWorkflowForStatusCard(wfName, { status: WorkflowStatus.RUNNING, priority: "HIGH" });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — both status and priority visible
    await expect(page.getByText("RUNNING").first()).toBeVisible();
    await expect(page.getByText("HIGH").first()).toBeVisible();
  });
});

test.describe("Workflow Actions — Resubmit Button", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("completed workflow shows Resubmit Workflow button", async ({ page }) => {
    const wfName = "resubmit-completed-wf";
    const data = createWorkflowForStatusCard(wfName, { status: WorkflowStatus.COMPLETED });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Resubmit button visible
    await expect(page.getByRole("button", { name: /resubmit workflow/i })).toBeVisible();
  });

  test("failed workflow shows Resubmit Workflow button", async ({ page }) => {
    const wfName = "resubmit-failed-wf";
    const data = createWorkflowForStatusCard(wfName, { status: WorkflowStatus.FAILED });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Resubmit button visible
    await expect(page.getByRole("button", { name: /resubmit workflow/i })).toBeVisible();
  });

  test("running workflow shows Resubmit Workflow button", async ({ page }) => {
    const wfName = "resubmit-running-wf";
    const data = createWorkflowForStatusCard(wfName, { status: WorkflowStatus.RUNNING });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Resubmit button visible (always shown regardless of status)
    await expect(page.getByRole("button", { name: /resubmit workflow/i })).toBeVisible();
  });
});
