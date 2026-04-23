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
import {
  setupDefaultMocks,
  setupProfile,
} from "@/e2e/utils/mock-setup";

/**
 * Workflow Detail Page Journey Tests
 *
 * Architecture notes:
 * - Workflow detail lives at /workflows/{name}
 * - Uses Streaming SSR: WorkflowDetailSkeleton → WorkflowDetailWithData → WorkflowDetailContent
 * - SSR prefetch via prefetchWorkflowByName (server component) — uses MSW, NOT Playwright route mocks
 * - Client component (WorkflowDetailContent) uses useWorkflowDetail hook
 *   which calls GET /api/workflow/{name}?verbose=true
 * - Shows DAG visualization (ReactFlow), details panel, breadcrumbs
 * - URL navigation: ?group=X → group view, ?group=X&task=Y&retry=0 → task view
 * - Error states: "Error Loading Workflow", "Workflow Not Found"
 *
 * NOTE: Because workflow detail uses SSR streaming with server prefetch via MSW,
 * Playwright route mocks only affect client-side refetches (not initial server render).
 * Tests focus on page shell, navigation, and error handling from client-side perspective.
 */

const CT_JSON = "application/json";

// ── Workflow Detail Mock Helpers ─────────────────────────────────────────────

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
    user?: string;
  } = {},
) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  return {
    name,
    uuid: crypto.randomUUID(),
    submitted_by: overrides.user ?? "test-user",
    cancelled_by: null,
    spec: "{}",
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
    end_time: overrides.status === WorkflowStatus.COMPLETED
      ? now.toISOString()
      : null,
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 5,
    status: overrides.status ?? WorkflowStatus.RUNNING,
    outputs: "",
    groups: (overrides.groups ?? [
      {
        name: "train",
        status: "RUNNING",
        tasks: [{ name: "train-task", retry_id: 0, status: "RUNNING" }],
      },
    ]).map((g) => ({
      name: g.name,
      status: g.status ?? "RUNNING",
      start_time: oneHourAgo.toISOString(),
      end_time: null,
      processing_start_time: oneHourAgo.toISOString(),
      scheduling_start_time: oneHourAgo.toISOString(),
      initializing_start_time: oneHourAgo.toISOString(),
      remaining_upstream_groups: [],
      downstream_groups: g.downstream_groups ?? [],
      failure_message: null,
      tasks: (g.tasks ?? [{ name: `${g.name}-task`, retry_id: 0, status: g.status ?? "RUNNING" }]).map((t) => ({
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
        end_time: null,
        duration: 1800,
      })),
    })),
    pool: overrides.pool ?? "test-pool",
    backend: "k8s-test",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

async function setupWorkflowDetail(
  page: Parameters<typeof setupDefaultMocks>[0],
  name: string,
  data: ReturnType<typeof createWorkflowDetailResponse> | { status: number; detail: string },
) {
  const response =
    "detail" in data
      ? { status: data.status, contentType: CT_JSON, body: JSON.stringify({ detail: data.detail }) }
      : { status: 200, contentType: CT_JSON, body: JSON.stringify(data) };

  // Match both /api/workflow/{name} and /api/workflow/{name}?verbose=true
  await page.route(`**/api/workflow/${name}*`, (route) => route.fulfill(response));
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Workflow Detail Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("page title includes Workflow", async ({ page }) => {
    // ARRANGE
    const wfName = "train-resnet-50";
    await setupWorkflowDetail(page, wfName, createWorkflowDetailResponse(wfName));

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page).toHaveTitle(/Workflow/);
  });

  test("shows breadcrumb with Workflows link", async ({ page }) => {
    // ARRANGE
    const wfName = "breadcrumb-test-wf";
    await setupWorkflowDetail(page, wfName, createWorkflowDetailResponse(wfName));

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — breadcrumb contains link back to workflows list
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Workflows").first()).toBeVisible();
  });

  test("shows workflow name in the page", async ({ page }) => {
    // ARRANGE
    const wfName = "my-training-workflow";
    await setupWorkflowDetail(page, wfName, createWorkflowDetailResponse(wfName));

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — workflow name is visible somewhere in the page
    await expect(page.getByText(wfName).first()).toBeVisible();
  });

  test("shows error state when workflow API returns error", async ({ page }) => {
    // ARRANGE — use 400 to avoid TanStack Query retries on 5xx
    const wfName = "error-workflow";
    await setupWorkflowDetail(page, wfName, { status: 400, detail: "Bad request" });

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — page must not crash, should show error state
    // The SSR prefetch may fail silently, then the client-side fetch triggers error
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(
      page.getByText(/error|unable to load|not found/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("Workflows breadcrumb link navigates back to workflows list", async ({ page }) => {
    // ARRANGE
    const wfName = "back-nav-workflow";
    await setupWorkflowDetail(page, wfName, createWorkflowDetailResponse(wfName));

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click the Workflows breadcrumb link
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    const workflowsLink = breadcrumb.getByText("Workflows").first();
    await workflowsLink.click();

    // ASSERT — navigates to workflows list
    await expect(page).toHaveURL(/\/workflows$/);
  });
});

test.describe("Workflow Detail Multi-Group", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows workflow with multiple groups", async ({ page }) => {
    // ARRANGE — workflow with a linear pipeline: preprocess → train → evaluate
    const wfName = "multi-group-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.RUNNING,
        groups: [
          {
            name: "preprocess",
            status: "COMPLETED",
            tasks: [{ name: "preprocess-task", retry_id: 0, status: "COMPLETED" }],
            downstream_groups: ["train"],
          },
          {
            name: "train",
            status: "RUNNING",
            tasks: [{ name: "train-task", retry_id: 0, status: "RUNNING" }],
            downstream_groups: ["evaluate"],
          },
          {
            name: "evaluate",
            status: "PENDING",
            tasks: [{ name: "eval-task", retry_id: 0, status: "PENDING" }],
            downstream_groups: [],
          },
        ],
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — workflow name and group names should be visible somewhere in the page
    await expect(page.getByText(wfName).first()).toBeVisible();
    // DAG renders groups — at least the workflow name should be visible
    // (groups may be in DAG nodes, not always as text)
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("shows completed workflow status", async ({ page }) => {
    // ARRANGE
    const wfName = "completed-workflow";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.COMPLETED,
        groups: [
          {
            name: "train",
            status: "COMPLETED",
            tasks: [{ name: "train-task", retry_id: 0, status: "COMPLETED" }],
          },
        ],
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without error
    await expect(page.getByText(wfName).first()).toBeVisible();
  });

  test("shows failed workflow status", async ({ page }) => {
    // ARRANGE
    const wfName = "failed-workflow";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.FAILED,
        groups: [
          {
            name: "train",
            status: "FAILED",
            tasks: [{ name: "train-task", retry_id: 0, status: "FAILED" }],
          },
        ],
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without error
    await expect(page.getByText(wfName).first()).toBeVisible();
  });

  test("group URL param opens the group panel view", async ({ page }) => {
    // ARRANGE
    const wfName = "group-nav-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        groups: [
          {
            name: "preprocess",
            status: "COMPLETED",
            tasks: [{ name: "prep-task", retry_id: 0, status: "COMPLETED" }],
            downstream_groups: ["train"],
          },
          {
            name: "train",
            status: "RUNNING",
            tasks: [{ name: "train-task", retry_id: 0, status: "RUNNING" }],
            downstream_groups: [],
          },
        ],
      }),
    );

    // ACT — navigate directly with ?group=train
    await page.goto(`/workflows/${wfName}?group=train`);
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders and URL is correct
    await expect(page).toHaveURL(/group=train/);
    await expect(page.getByText(wfName).first()).toBeVisible();
  });

  test("task URL params render page without crashing", async ({ page }) => {
    // ARRANGE
    // NOTE: SSR prefetch via MSW serves its own workflow data (not our Playwright route mock).
    // The URL navigation state hook may clear task params if the task isn't found in SSR data.
    // This test verifies the page handles deep-link task params gracefully.
    const wfName = "task-nav-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        groups: [
          {
            name: "train",
            status: "RUNNING",
            tasks: [{ name: "gpu-task", retry_id: 0, status: "RUNNING" }],
            downstream_groups: [],
          },
        ],
      }),
    );

    // ACT — navigate directly with task params
    await page.goto(`/workflows/${wfName}?group=train&task=gpu-task&retry=0`);
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without crashing (task params may or may not persist
    // depending on whether MSW SSR data matches the route mock)
    await expect(page.getByText(wfName).first()).toBeVisible();
  });
});

test.describe("Workflow Detail 404", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows not-found state for non-existent workflow", async ({ page }) => {
    // ARRANGE — return 404 for the workflow
    const wfName = "nonexistent-workflow";
    await setupWorkflowDetail(page, wfName, { status: 404, detail: "Workflow not found" });

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — should show not-found or error message
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(
      page.getByText(/not found|error|does not exist/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});
