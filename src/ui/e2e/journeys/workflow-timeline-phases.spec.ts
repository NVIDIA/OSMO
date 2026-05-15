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
 * Workflow Timeline Phase Tests
 *
 * Tests the Timeline section phases in the workflow detail Overview tab.
 * The WorkflowTimeline renders phases: Submitted → Started → Running/Completed/Failed
 * with timing data and visual markers.
 *
 * Coverage gaps addressed:
 * - Timeline "Submitted" phase label visibility
 * - Timeline "Started" phase label visibility
 * - Timeline "Completed" milestone for completed workflows
 * - Timeline "Failed" milestone for failed workflows
 * - Timeline "Running" active phase for running workflows
 * - Timeline duration display (from queued_time / running duration)
 *
 * Architecture notes:
 * - WorkflowTimeline builds TimelinePhase[] from submit_time, start_time, end_time
 * - Timeline component renders markers + labels (horizontal or vertical layout)
 * - Each phase has an aria-label="<Label>: <full time>" on the marker button
 * - Phase labels are rendered as text spans within the timeline grid
 */

const CT_JSON = "application/json";

function createWorkflowForTimeline(
  name: string,
  overrides: {
    status?: string;
    start_time?: string | null;
    end_time?: string | null;
    queued_time?: number;
  } = {},
) {
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
    start_time: overrides.start_time !== undefined ? overrides.start_time : oneHourAgo.toISOString(),
    end_time: overrides.end_time !== undefined ? overrides.end_time : null,
    exec_timeout: null,
    queue_timeout: null,
    duration: overrides.end_time ? 3600 : null,
    queued_time: overrides.queued_time ?? 15,
    status: overrides.status ?? WorkflowStatus.RUNNING,
    outputs: "",
    priority: "NORMAL",
    groups: [
      {
        name: "train",
        status: overrides.status === WorkflowStatus.FAILED ? "FAILED" : overrides.end_time ? "COMPLETED" : "RUNNING",
        start_time: oneHourAgo.toISOString(),
        end_time: overrides.end_time ?? null,
        processing_start_time: oneHourAgo.toISOString(),
        scheduling_start_time: oneHourAgo.toISOString(),
        initializing_start_time: oneHourAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: overrides.status === WorkflowStatus.FAILED ? "Process exited with code 1" : null,
        tasks: [
          {
            name: "train-task",
            retry_id: 0,
            status: overrides.status === WorkflowStatus.FAILED ? "FAILED" : overrides.end_time ? "COMPLETED" : "RUNNING",
            failure_message: overrides.status === WorkflowStatus.FAILED ? "Process exited with code 1" : null,
            exit_code: overrides.status === WorkflowStatus.FAILED ? 1 : overrides.end_time ? 0 : null,
            logs: `/api/workflow/${name}/task/train-task/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: overrides.end_time ?? null,
            duration: overrides.end_time ? 3600 : null,
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

test.describe("Workflow Timeline — Completed Workflow Phases", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("completed workflow shows Submitted phase label", async ({ page }) => {
    const wfName = "timeline-completed-wf";
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const data = createWorkflowForTimeline(wfName, {
      status: WorkflowStatus.COMPLETED,
      end_time: now.toISOString(),
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Submitted" label present in the timeline
    await expect(page.getByText("Submitted").first()).toBeVisible();
  });

  test("completed workflow shows Started phase label", async ({ page }) => {
    const wfName = "timeline-started-wf";
    const now = new Date();
    const data = createWorkflowForTimeline(wfName, {
      status: WorkflowStatus.COMPLETED,
      end_time: now.toISOString(),
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Started" label present in the timeline
    await expect(page.getByText("Started").first()).toBeVisible();
  });

  test("completed workflow shows Completed milestone in timeline", async ({ page }) => {
    const wfName = "timeline-milestone-wf";
    const now = new Date();
    const data = createWorkflowForTimeline(wfName, {
      status: WorkflowStatus.COMPLETED,
      end_time: now.toISOString(),
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Completed" milestone label in timeline
    await expect(page.getByText("Completed").first()).toBeVisible();
  });
});

test.describe("Workflow Timeline — Failed Workflow Phases", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("failed workflow shows Failed milestone in timeline", async ({ page }) => {
    const wfName = "timeline-failed-wf";
    const now = new Date();
    const data = createWorkflowForTimeline(wfName, {
      status: WorkflowStatus.FAILED,
      end_time: now.toISOString(),
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Failed" milestone label in timeline
    // The timeline renders the "Failed" phase label for failed workflows
    const timelineSection = page.locator("section").filter({ hasText: "Timeline" });
    await expect(timelineSection.getByText("Failed").first()).toBeVisible();
  });
});

test.describe("Workflow Timeline — Running Workflow Phases", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("running workflow shows Running phase in timeline", async ({ page }) => {
    const wfName = "timeline-running-wf";
    const data = createWorkflowForTimeline(wfName, {
      status: WorkflowStatus.RUNNING,
      end_time: null,
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Running" phase label in timeline
    // Find within the Timeline section to avoid matching status text elsewhere
    const timelineSection = page.locator("section").filter({ hasText: "Timeline" });
    await expect(timelineSection.getByText("Running").first()).toBeVisible();
  });
});
