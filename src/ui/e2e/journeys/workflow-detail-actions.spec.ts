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
 * Workflow Detail Actions Tests
 *
 * Tests the Actions section of the workflow detail panel:
 * - Cancel Workflow button visibility and disabled states
 * - Cancel dialog (reason input, force checkbox, confirm/cancel)
 * - Resubmit button visibility
 * - Tab navigation (Overview, Tasks, Logs, Events, Spec)
 *
 * Architecture notes:
 * - Workflow detail lives at /workflows/{name}
 * - Detail panel shows tabs: Overview, Tasks, Logs, Events, Spec
 * - Overview tab contains: Timeline, Details, Links, Actions
 * - Cancel button enabled only for RUNNING/PENDING workflows
 * - Cancel opens CancelWorkflowDialog with reason + force + confirm
 * - Uses SSR streaming; Playwright route mocks affect client refetches
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
    user?: string;
  } = {},
) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  return {
    name,
    uuid: `uuid-${name}`,
    submitted_by: overrides.user ?? "test-user",
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
    submit_time: oneHourAgo.toISOString(),
    start_time: oneHourAgo.toISOString(),
    end_time:
      overrides.status === WorkflowStatus.COMPLETED
        ? now.toISOString()
        : null,
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 5,
    status: overrides.status ?? WorkflowStatus.RUNNING,
    outputs: "",
    groups: (
      overrides.groups ?? [
        {
          name: "train",
          status: "RUNNING",
          tasks: [
            { name: "train-task", retry_id: 0, status: "RUNNING" },
          ],
        },
      ]
    ).map((g) => ({
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
  data:
    | ReturnType<typeof createWorkflowDetailResponse>
    | { status: number; detail: string },
) {
  const response =
    "detail" in data
      ? {
          status: data.status,
          contentType: CT_JSON,
          body: JSON.stringify({ detail: data.detail }),
        }
      : {
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify(data),
        };

  await page.route(`**/api/workflow/${name}*`, (route) =>
    route.fulfill(response),
  );
}

test.describe("Workflow Detail Actions", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows Cancel Workflow button for RUNNING workflow", async ({
    page,
  }) => {
    // ARRANGE
    const wfName = "running-wf-action";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.RUNNING,
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Cancel Workflow button visible in actions
    await expect(
      page.getByRole("button", { name: /cancel workflow/i }).first(),
    ).toBeVisible();
  });

  test("Cancel Workflow button is disabled for COMPLETED workflow", async ({
    page,
  }) => {
    // ARRANGE
    const wfName = "completed-wf-action";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.COMPLETED,
        groups: [
          {
            name: "train",
            status: "COMPLETED",
            tasks: [
              { name: "train-task", retry_id: 0, status: "COMPLETED" },
            ],
          },
        ],
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Cancel Workflow button is visible but disabled
    const cancelButton = page
      .getByRole("button", { name: /cancel workflow/i })
      .first();
    await expect(cancelButton).toBeVisible();
    await expect(cancelButton).toBeDisabled();
  });

  test("clicking Cancel Workflow opens confirmation dialog", async ({
    page,
  }) => {
    // ARRANGE
    const wfName = "cancel-dialog-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.RUNNING,
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click Cancel Workflow button
    await page
      .getByRole("button", { name: /cancel workflow/i })
      .first()
      .click();

    // ASSERT — dialog opens with workflow name and action buttons
    await expect(page.getByText("Cancel Workflow").first()).toBeVisible();
    await expect(page.getByText(wfName).first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: /keep running/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /confirm/i }),
    ).toBeVisible();
  });

  test("cancel dialog has reason input and force checkbox", async ({
    page,
  }) => {
    // ARRANGE
    const wfName = "cancel-form-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.RUNNING,
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", { name: /cancel workflow/i })
      .first()
      .click();

    // ASSERT — reason textarea and force checkbox visible
    await expect(page.getByLabel(/reason/i)).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /force cancel/i })).toBeVisible();
  });

  test("Keep Running button dismisses the cancel dialog", async ({
    page,
  }) => {
    // ARRANGE
    const wfName = "keep-running-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.RUNNING,
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", { name: /cancel workflow/i })
      .first()
      .click();

    // Wait for dialog to appear
    await expect(
      page.getByRole("button", { name: /keep running/i }),
    ).toBeVisible();

    // Click Keep Running
    await page.getByRole("button", { name: /keep running/i }).click();

    // ASSERT — dialog is dismissed
    await expect(
      page.getByRole("button", { name: /keep running/i }),
    ).not.toBeVisible();
  });
});

test.describe("Workflow Detail Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows all panel tabs: Overview, Tasks, Logs, Events, Spec", async ({
    page,
  }) => {
    // ARRANGE
    const wfName = "tabs-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — all tabs visible
    await expect(page.getByRole("tab", { name: "Overview" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Tasks" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Logs" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Events" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Spec" })).toBeVisible();
  });

  test("shows Resubmit Workflow button in actions", async ({ page }) => {
    // ARRANGE
    const wfName = "resubmit-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        status: WorkflowStatus.COMPLETED,
        groups: [
          {
            name: "train",
            status: "COMPLETED",
            tasks: [
              { name: "train-task", retry_id: 0, status: "COMPLETED" },
            ],
          },
        ],
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Resubmit button visible
    await expect(
      page.getByRole("button", { name: /resubmit workflow/i }).first(),
    ).toBeVisible();
  });

  test("workflow detail shows pool and backend info", async ({ page }) => {
    // ARRANGE
    const wfName = "info-wf";
    await setupWorkflowDetail(
      page,
      wfName,
      createWorkflowDetailResponse(wfName, {
        pool: "production-pool",
      }),
    );

    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — pool name visible in details
    await expect(
      page.getByText("production-pool").first(),
    ).toBeVisible();
  });
});
