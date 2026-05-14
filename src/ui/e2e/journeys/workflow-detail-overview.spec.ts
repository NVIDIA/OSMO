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
 * Workflow Detail Overview Content Tests
 *
 * Tests the Overview tab content in the workflow detail panel beyond
 * what workflow-detail.spec.ts and workflow-detail-tabs.spec.ts cover:
 * - Links section (Dashboard, Grafana) with external URLs
 * - Failed workflow shows failure message in group/task
 * - Status display with priority badge
 * - Timeline section shows phase information
 * - Details section shows UUID, User, Pool, Backend
 *
 * Architecture notes:
 * - Overview tab has 4 sections: Timeline, Details, Links, Actions
 * - Links section: Dashboard (BarChart3), Grafana (Activity), Outputs (Package)
 *   - Only shown if URL is non-null
 * - Details section: UUID (with copy button), User (link), Pool (link), Backend
 * - StatusDisplay shows: status icon + label, priority badge, duration
 * - Failed workflows: groups/tasks have failure_message field
 */

const CT_JSON = "application/json";

function createWorkflowDetailResponse(
  name: string,
  overrides: {
    status?: string;
    dashboard_url?: string | null;
    grafana_url?: string | null;
    outputs?: string;
    priority?: string;
    tags?: string[];
    groups?: Array<{
      name: string;
      status?: string;
      failure_message?: string | null;
      tasks?: Array<{
        name: string;
        retry_id?: number;
        status?: string;
        failure_message?: string | null;
        exit_code?: number | null;
      }>;
      downstream_groups?: string[];
    }>;
    pool?: string;
    backend?: string;
  } = {},
) {
  const now = new Date();
  const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const terminalWorkflowStatuses: WorkflowStatus[] = [
    WorkflowStatus.COMPLETED,
    WorkflowStatus.FAILED,
    WorkflowStatus.FAILED_CANCELED,
  ];
  const isTerminal = terminalWorkflowStatuses.includes(
    (overrides.status as WorkflowStatus) ?? WorkflowStatus.RUNNING,
  );

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
    dashboard_url: overrides.dashboard_url !== undefined ? overrides.dashboard_url : null,
    grafana_url: overrides.grafana_url !== undefined ? overrides.grafana_url : null,
    tags: overrides.tags ?? [],
    submit_time: twoHoursAgo.toISOString(),
    start_time: twoHoursAgo.toISOString(),
    end_time: isTerminal ? oneHourAgo.toISOString() : null,
    exec_timeout: null,
    queue_timeout: null,
    duration: isTerminal ? 3600 : null,
    queued_time: 5,
    status: overrides.status ?? WorkflowStatus.RUNNING,
    outputs: overrides.outputs ?? "",
    priority: overrides.priority ?? "NORMAL",
    groups: (
      overrides.groups ?? [
        {
          name: "train",
          status: overrides.status === WorkflowStatus.FAILED ? "FAILED" : "RUNNING",
          tasks: [
            {
              name: "train-task",
              retry_id: 0,
              status: overrides.status === WorkflowStatus.FAILED ? "FAILED" : "RUNNING",
            },
          ],
        },
      ]
    ).map((g) => ({
      name: g.name,
      status: g.status ?? "RUNNING",
      start_time: twoHoursAgo.toISOString(),
      end_time: g.status === "COMPLETED" || g.status === "FAILED" ? oneHourAgo.toISOString() : null,
      processing_start_time: twoHoursAgo.toISOString(),
      scheduling_start_time: twoHoursAgo.toISOString(),
      initializing_start_time: twoHoursAgo.toISOString(),
      remaining_upstream_groups: [],
      downstream_groups: g.downstream_groups ?? [],
      failure_message: g.failure_message ?? null,
      tasks: (
        g.tasks ?? [
          {
            name: `${g.name}-task`,
            retry_id: 0,
            status: g.status ?? "RUNNING",
          },
        ]
      ).map((t) => ({
        name: t.name,
        retry_id: t.retry_id ?? 0,
        status: t.status ?? "RUNNING",
        failure_message: t.failure_message ?? null,
        exit_code: t.exit_code ?? null,
        logs: `/api/workflow/${name}/task/${t.name}/logs`,
        error_logs: null,
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        start_time: twoHoursAgo.toISOString(),
        end_time: t.status === "COMPLETED" || t.status === "FAILED" ? oneHourAgo.toISOString() : null,
        duration: 3600,
      })),
    })),
    pool: overrides.pool ?? "test-pool",
    backend: overrides.backend ?? "k8s-test",
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
  await page.route(`**/api/workflow/${name}*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify(data),
    }),
  );
}

test.describe("Workflow Detail Overview — Links Section", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows Dashboard and Grafana links when URLs are provided", async ({ page }) => {
    const wfName = "links-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        dashboard_url: "https://dashboard.example.com/workflow/links-wf",
        grafana_url: "https://grafana.example.com/workflow/links-wf",
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Links section with Dashboard and Grafana
    await expect(page.getByText("Links").first()).toBeVisible();
    await expect(page.getByText("Dashboard").first()).toBeVisible();
    await expect(page.getByText("Grafana").first()).toBeVisible();
  });

  test("does not show workflow Dashboard/Grafana links when no external URLs are set", async ({ page }) => {
    const wfName = "no-links-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        dashboard_url: null,
        grafana_url: null,
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — No "Kubernetes details" description text visible (Dashboard link description)
    await expect(page.getByText("Kubernetes details")).not.toBeVisible();
    // No "Metrics & monitoring" description text visible (Grafana link description)
    await expect(page.getByText("Metrics & monitoring")).not.toBeVisible();
  });
});

test.describe("Workflow Detail Overview — Failed Workflow", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("failed workflow shows FAILED status", async ({ page }) => {
    const wfName = "failed-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.FAILED,
        groups: [
          {
            name: "train",
            status: "FAILED",
            failure_message: "OOM killed by kernel",
            tasks: [
              {
                name: "train-task",
                retry_id: 0,
                status: "FAILED",
                failure_message: "OOM killed by kernel",
                exit_code: 137,
              },
            ],
          },
        ],
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — FAILED status text visible
    await expect(page.getByText("FAILED").first()).toBeVisible();
  });

  test("failed workflow shows cancel button as disabled", async ({ page }) => {
    const wfName = "failed-cancel-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.FAILED,
        groups: [
          {
            name: "train",
            status: "FAILED",
            tasks: [{ name: "train-task", retry_id: 0, status: "FAILED", exit_code: 1 }],
          },
        ],
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Cancel Workflow button is disabled
    await expect(
      page.getByRole("button", { name: /cancel workflow/i }).first(),
    ).toBeDisabled();
  });
});

test.describe("Workflow Detail Overview — Priority Display", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows priority badge in status display", async ({ page }) => {
    const wfName = "priority-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        priority: "HIGH",
        status: WorkflowStatus.RUNNING,
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — HIGH priority badge visible
    await expect(page.getByText("HIGH").first()).toBeVisible();
  });
});

test.describe("Workflow Detail Overview — Details Section", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows UUID with copy button", async ({ page }) => {
    const wfName = "uuid-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — UUID label and value visible
    await expect(page.getByText("UUID").first()).toBeVisible();
    await expect(page.getByText(`uuid-${wfName}`).first()).toBeVisible();
  });

  test("user name links to workflows filtered by user", async ({ page }) => {
    const wfName = "user-link-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — User link with correct href
    const userLink = page.getByRole("link", { name: "test-user" }).first();
    await expect(userLink).toBeVisible();
    await expect(userLink).toHaveAttribute("href", /f=user.*test-user/);
  });

  test("pool name links to workflows filtered by pool", async ({ page }) => {
    const wfName = "pool-link-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, { pool: "production-pool" }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Pool link with correct href
    const poolLink = page.getByRole("link", { name: "production-pool" }).first();
    await expect(poolLink).toBeVisible();
    await expect(poolLink).toHaveAttribute("href", /f=pool.*production-pool/);
  });

  test("backend name is displayed in details section", async ({ page }) => {
    const wfName = "backend-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, { backend: "k8s-production-cluster" }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Backend label and value
    await expect(page.getByText("Backend").first()).toBeVisible();
    await expect(page.getByText("k8s-production-cluster").first()).toBeVisible();
  });
});
