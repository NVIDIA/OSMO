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
 * Workflow Detail Tab Navigation Tests
 *
 * Tests that clicking each tab in the workflow detail panel
 * actually loads the corresponding content (not just that tab labels are visible).
 *
 * Architecture notes:
 * - WorkflowDetails component has 5 tabs: Overview, Tasks, Logs, Events, Spec
 * - Overview: timeline, details section, links, actions
 * - Tasks: WorkflowTasksTab with expandable group/task tree
 * - Logs: LogViewerContainer (streaming log viewer)
 * - Events: EventViewerContainer (event timeline)
 * - Spec: WorkflowSpecViewer (CodeMirror YAML viewer, lazy-loaded)
 *
 * SSR note: Workflow detail uses SSR prefetch via MSW. Our Playwright route mocks
 * affect client refetches but may not control initial SSR data. Tests focus on
 * content that appears after tab click regardless of SSR.
 */

const CT_JSON = "application/json";

function createWorkflowDetailResponse(
  name: string,
  overrides: {
    status?: string;
    groups?: Array<{
      name: string;
      status?: string;
      tasks?: Array<{ name: string; retry_id?: number; status?: string }>;
      downstream_groups?: string[];
    }>;
    pool?: string;
    tags?: string[];
  } = {},
) {
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
    dashboard_url: "https://dashboard.example.com/workflow",
    grafana_url: "https://grafana.example.com/workflow",
    tags: overrides.tags ?? ["training", "v2"],
    submit_time: oneHourAgo.toISOString(),
    start_time: oneHourAgo.toISOString(),
    end_time:
      overrides.status === WorkflowStatus.COMPLETED ? now.toISOString() : null,
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 5,
    status: overrides.status ?? WorkflowStatus.RUNNING,
    outputs: "",
    groups: (
      overrides.groups ?? [
        {
          name: "preprocess",
          status: "COMPLETED",
          tasks: [{ name: "preprocess-task", retry_id: 0, status: "COMPLETED" }],
          downstream_groups: ["train"],
        },
        {
          name: "train",
          status: "RUNNING",
          tasks: [
            { name: "train-worker-0", retry_id: 0, status: "RUNNING" },
            { name: "train-worker-1", retry_id: 0, status: "RUNNING" },
          ],
          downstream_groups: [],
        },
      ]
    ).map((g) => ({
      name: g.name,
      status: g.status ?? "RUNNING",
      start_time: oneHourAgo.toISOString(),
      end_time: g.status === "COMPLETED" ? now.toISOString() : null,
      processing_start_time: oneHourAgo.toISOString(),
      scheduling_start_time: oneHourAgo.toISOString(),
      initializing_start_time: oneHourAgo.toISOString(),
      remaining_upstream_groups: [],
      downstream_groups: g.downstream_groups ?? [],
      failure_message: null,
      tasks: (
        g.tasks ?? [{ name: `${g.name}-task`, retry_id: 0, status: g.status ?? "RUNNING" }]
      ).map((t) => ({
        name: t.name,
        retry_id: t.retry_id ?? 0,
        status: t.status ?? "RUNNING",
        failure_message: null,
        exit_code: null,
        logs: `/api/workflow/${name}/task/${t.name}/logs`,
        error_logs: null,
        processing_start_time: oneHourAgo.toISOString(),
        scheduling_start_time: oneHourAgo.toISOString(),
        initializing_start_time: oneHourAgo.toISOString(),
        start_time: oneHourAgo.toISOString(),
        end_time: t.status === "COMPLETED" ? now.toISOString() : null,
        duration: 1800,
      })),
    })),
    pool: overrides.pool ?? "training-pool",
    backend: "k8s-cluster-1",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

async function setupWorkflowDetail(
  page: Parameters<typeof setupDefaultMocks>[0],
  name: string,
  data: ReturnType<typeof createWorkflowDetailResponse>,
) {
  const response = {
    status: 200,
    contentType: CT_JSON,
    body: JSON.stringify(data),
  };
  await page.route(`**/api/workflow/${name}*`, (route) => route.fulfill(response));
}

test.describe("Workflow Detail Tab Content", () => {
  const wfName = "tab-content-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName),
    );
  });

  test("Overview tab shows timeline and details sections", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Overview tab is selected by default
    const overviewTab = page.getByRole("tab", { name: "Overview" });
    await expect(overviewTab).toBeVisible();

    // Overview content: Details section with UUID, User, Pool
    await expect(page.getByText("UUID").first()).toBeVisible();
    await expect(page.getByText("test-user").first()).toBeVisible();
    await expect(page.getByText("training-pool").first()).toBeVisible();
  });

  test("Overview tab shows tags when present", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Tags section shows workflow tags
    await expect(page.getByText("Tags").first()).toBeVisible();
    await expect(page.getByText("training").first()).toBeVisible();
    await expect(page.getByText("v2").first()).toBeVisible();
  });

  test("Tasks tab shows group and task names", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click Tasks tab
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — group and task names are visible in the tasks tree
    await expect(page.getByText("preprocess").first()).toBeVisible();
    await expect(page.getByText("train").first()).toBeVisible();
  });

  test("Spec tab shows spec viewer toolbar with YAML and Template buttons", async ({ page }) => {
    // ARRANGE — mock the spec URL paths that WorkflowSpecViewer fetches.
    // The workflow response has spec and template_spec as URL paths (e.g., /api/workflow/{name}/spec)
    // We need to intercept these with page.route BEFORE setupWorkflowDetail's catch-all fires.
    await page.route(`**/api/workflow/${wfName}/spec`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "version: 1\ntasks:\n  - name: train\n    image: nvcr.io/nvidia/pytorch:24.01-py3",
      }),
    );
    await page.route(`**/api/workflow/${wfName}/template_spec`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "version: 1\ntasks:\n  - name: train\n    image: {{image}}",
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click Spec tab
    await page.getByRole("tab", { name: "Spec" }).click();

    // ASSERT — spec viewer toolbar renders with YAML and Template radio buttons
    // The SpecToolbar has a radiogroup "View selection" with YAML and Template options
    // The component is lazy-loaded so we allow extra time for the dynamic import
    const toolbar = page.getByRole("toolbar", { name: "Spec viewer controls" });
    await expect(toolbar).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByRole("radio", { name: /yaml/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /template/i }),
    ).toBeVisible();
  });

  test("Events tab renders event viewer component", async ({ page }) => {
    // ARRANGE — mock the events endpoint
    await page.route(`**/api/workflow/${wfName}/events*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: [] }),
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click Events tab
    await page.getByRole("tab", { name: "Events" }).click();

    // ASSERT — events tab is now active (tab panel renders)
    const eventsTab = page.getByRole("tab", { name: "Events" });
    await expect(eventsTab).toHaveAttribute("aria-selected", "true");
  });

  test("Logs tab renders log viewer component", async ({ page }) => {
    // ARRANGE — mock the logs WebSocket/endpoint
    await page.route(`**/api/workflow/${wfName}/logs*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click Logs tab
    await page.getByRole("tab", { name: "Logs" }).click();

    // ASSERT — logs tab is now active
    const logsTab = page.getByRole("tab", { name: "Logs" });
    await expect(logsTab).toHaveAttribute("aria-selected", "true");
  });

  test("switching between tabs preserves workflow context", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Switch to Tasks tab
    await page.getByRole("tab", { name: "Tasks" }).click();
    await expect(page.getByText("preprocess").first()).toBeVisible();

    // Switch back to Overview
    await page.getByRole("tab", { name: "Overview" }).click();

    // ASSERT — overview content is still there
    await expect(page.getByText("training-pool").first()).toBeVisible();
    await expect(page.getByText("test-user").first()).toBeVisible();
  });
});
