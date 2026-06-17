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
 * Workflow Sequence Navigation Tests
 *
 * Tests the prev/next workflow navigation arrows in the detail panel header.
 * The feature parses sequential workflow names (e.g., "my-workflow-5") and
 * provides navigation to "my-workflow-4" (previous) and "my-workflow-6" (next).
 *
 * Architecture notes:
 * - useWorkflowSequenceNav hook: parses SEQUENCE_PATTERN = /^(.+-)(\d+)$/
 * - Returns null if name doesn't match (no arrows shown)
 * - Previous disabled when number <= 1 (at sequence start)
 * - DetailsPanelHeader renders: [< Previous] Title [Next >] with aria-labels
 * - "Previous workflow" and "Next workflow" buttons with tooltip
 */

const CT_JSON = "application/json";

function createSequentialWorkflow(name: string) {
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
    status: WorkflowStatus.COMPLETED,
    outputs: "",
    priority: "NORMAL",
    groups: [
      {
        name: "train",
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
            name: "train-task",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/train-task/logs`,
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
    pool: "prod-pool",
    backend: "k8s-prod",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

test.describe("Workflow Sequence Navigation", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows sequence navigation arrows for numbered workflows", async ({ page }) => {
    const wfName = "train-resnet-5";
    const data = createSequentialWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — previous and next workflow buttons are visible
    await expect(page.getByRole("button", { name: "Previous workflow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Next workflow" })).toBeVisible();
  });

  test("previous button is disabled for workflow number 1", async ({ page }) => {
    const wfName = "train-resnet-1";
    const data = createSequentialWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — previous button is disabled (number is 1, can't go lower)
    const prevBtn = page.getByRole("button", { name: "Previous workflow" });
    await expect(prevBtn).toBeVisible();
    await expect(prevBtn).toBeDisabled();
  });

  test("clicking next navigates to the next workflow in the sequence", async ({ page }) => {
    const wfName = "train-resnet-3";
    const data = createSequentialWorkflow(wfName);

    // Mock both the current and target workflow
    await page.route(`**/api/workflow/train-resnet-3*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
    await page.route(`**/api/workflow/train-resnet-4*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(createSequentialWorkflow("train-resnet-4")),
      }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ACT — click next workflow
    await page.getByRole("button", { name: "Next workflow" }).click();

    // ASSERT — URL changed to next workflow
    await expect(page).toHaveURL(/workflows\/train-resnet-4/);
  });

  test("clicking previous navigates to the previous workflow in the sequence", async ({ page }) => {
    const wfName = "train-resnet-5";
    const data = createSequentialWorkflow(wfName);

    await page.route(`**/api/workflow/train-resnet-5*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
    await page.route(`**/api/workflow/train-resnet-4*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(createSequentialWorkflow("train-resnet-4")),
      }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ACT — click previous workflow
    await page.getByRole("button", { name: "Previous workflow" }).click();

    // ASSERT — URL changed to previous workflow
    await expect(page).toHaveURL(/workflows\/train-resnet-4/);
  });

  test("no sequence arrows for non-sequential workflow names", async ({ page }) => {
    // "my-unique-workflow" doesn't end with -<number>, so no arrows
    const wfName = "my-unique-workflow";
    const data = createSequentialWorkflow(wfName);

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — no sequence navigation buttons
    await expect(page.getByRole("button", { name: "Previous workflow" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Next workflow" })).not.toBeVisible();
  });
});
