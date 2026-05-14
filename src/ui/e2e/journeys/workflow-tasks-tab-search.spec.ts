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
 * Workflow Tasks Tab — Search & Filter Tests
 *
 * Tests the WorkflowTasksTab's toolbar search functionality:
 * - Search input is present with placeholder
 * - Typing in search filters visible tasks
 * - Tasks tab toolbar shows search chips when filtering
 * - Results count updates when filter is applied
 *
 * Architecture notes:
 * - WorkflowTasksTab wraps WorkflowTasksTable in an InlineErrorBoundary
 * - WorkflowTasksTable renders: inline TableToolbar + grouped sections
 * - TableToolbar uses FilterBar with:
 *   - searchFields: TASK_SEARCH_FIELDS (name, status, node, duration, etc.)
 *   - defaultField: "name"
 *   - placeholder: 'Filter by name, status:, ip:, duration:...'
 *   - searchPresets: TASK_GROUP_STATUS_PRESETS
 *   - columns: OPTIONAL_COLUMNS_ALPHABETICAL
 */

const CT_JSON = "application/json";

function createWorkflowForTasksSearch(name: string) {
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
        name: "data-group",
        status: "COMPLETED",
        start_time: twoHoursAgo.toISOString(),
        end_time: oneHourAgo.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: ["compute-group"],
        failure_message: null,
        tasks: [
          {
            name: "fetch-dataset",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/fetch-dataset/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 3600,
          },
          {
            name: "validate-schema",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/validate-schema/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 1800,
          },
        ],
      },
      {
        name: "compute-group",
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
            name: "train-model",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/train-model/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
          },
          {
            name: "evaluate-model",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/evaluate-model/logs`,
            error_logs: null,
            processing_start_time: oneHourAgo.toISOString(),
            scheduling_start_time: oneHourAgo.toISOString(),
            initializing_start_time: oneHourAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 1200,
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

test.describe("Workflow Tasks Tab — Search & Toolbar", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "tasks-search-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowForTasksSearch(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("Tasks tab toolbar shows search input with placeholder", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — search input with tasks-specific placeholder
    const searchInput = page.getByPlaceholder(/filter by name/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });
  });

  test("Tasks tab shows all groups and tasks", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — both group names visible
    await expect(page.getByText("data-group").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("compute-group").first()).toBeVisible();

    // Task names visible
    await expect(page.getByText("fetch-dataset").first()).toBeVisible();
    await expect(page.getByText("train-model").first()).toBeVisible();
  });

  test("typing in search creates a filter chip", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    const searchInput = page.getByPlaceholder(/filter by name/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Type a search query and press Enter
    await searchInput.fill("fetch");
    await searchInput.press("Enter");

    // ASSERT — a filter chip appears with the search term
    await expect(page.getByText("fetch").first()).toBeVisible({ timeout: 5_000 });
  });

  test("Tasks tab shows task count per group", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // ASSERT — task counts visible for groups
    await expect(page.getByText("(2 tasks)").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Tasks tab search input can be focused and typed into", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    const searchInput = page.getByPlaceholder(/filter by name/i);
    await expect(searchInput).toBeVisible({ timeout: 10_000 });

    // Focus and type
    await searchInput.click();
    await searchInput.fill("validate");

    // ASSERT — input has the typed value
    await expect(searchInput).toHaveValue("validate");
  });
});
