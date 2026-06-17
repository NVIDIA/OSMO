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
 * Group Details Tab Content Tests
 *
 * Tests the group detail panel content when navigated via the Tasks tab's
 * "Navigate to {group} details" button (SplitGroupHeader chevron).
 *
 * Targets:
 * - GroupDetails header subtitle shows task count
 * - GroupDetails shows Overview tab by default
 * - GroupDetails Overview tab has Timeline heading
 * - GroupDetails has Tasks tab that can be selected
 * - GroupDetails status label shows correct status text
 *
 * Architecture notes:
 * - SplitGroupHeader renders aria-label="Navigate to {name} details"
 * - Clicking the details button calls onSelectGroup which navigates to
 *   the group detail view (GroupDetails component)
 * - GroupDetails renders: DetailsPanelHeader (group name + subtitle + status)
 *   + PanelTabs (Overview, Tasks) + TabPanel content
 * - subtitle: `${stats.total} tasks`
 * - statusContent: SeparatedParts with status icon + label + duration
 */

const CT_JSON = "application/json";

function createWorkflowForGroupDetailsNav(name: string) {
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
        name: "ingestion",
        status: "COMPLETED",
        start_time: twoHoursAgo.toISOString(),
        end_time: oneHourAgo.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: ["analysis"],
        failure_message: null,
        tasks: [
          {
            name: "download-raw",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/download-raw/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 3600,
          },
          {
            name: "parse-format",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/parse-format/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 1800,
          },
          {
            name: "validate-checksums",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/validate-checksums/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: twoHoursAgo.toISOString(),
            end_time: oneHourAgo.toISOString(),
            duration: 900,
          },
        ],
      },
      {
        name: "analysis",
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
            name: "run-analysis",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/run-analysis/logs`,
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
    pool: "gpu-pool",
    backend: "k8s-cluster",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

test.describe("Group Detail — Navigation from Tasks Tab", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "group-details-nav-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowForGroupDetailsNav(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("clicking navigate-to-details button opens group detail view", async ({ page }) => {
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");
    await page.getByRole("tab", { name: "Tasks" }).click();

    // Wait for groups to render
    await expect(page.getByText("ingestion").first()).toBeVisible({ timeout: 10_000 });

    // Click the navigate-to-details chevron for "ingestion" group
    await page.getByRole("button", { name: /navigate to ingestion details/i }).click();

    // ASSERT — group detail view opens (Group badge visible)
    await expect(page.getByText("Group", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("group detail header shows task count subtitle", async ({ page }) => {
    // Navigate directly to group detail
    await page.goto(`/workflows/${wfName}?group=ingestion`);
    await page.waitForLoadState("networkidle");

    // ASSERT — subtitle shows "3 tasks"
    await expect(page.getByText("3 tasks").first()).toBeVisible({ timeout: 10_000 });
  });

  test("group detail shows Overview tab selected by default", async ({ page }) => {
    await page.goto(`/workflows/${wfName}?group=ingestion`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Overview tab is present and selected
    const overviewTab = page.getByRole("tab", { name: "Overview" });
    await expect(overviewTab).toBeVisible({ timeout: 10_000 });
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
  });

  test("group detail Overview tab shows Timeline heading", async ({ page }) => {
    await page.goto(`/workflows/${wfName}?group=ingestion`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Timeline section heading visible
    await expect(page.getByText("Timeline", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("group detail shows Completed status label", async ({ page }) => {
    await page.goto(`/workflows/${wfName}?group=ingestion`);
    await page.waitForLoadState("networkidle");

    // ASSERT — "Completed" status label visible in header
    await expect(page.getByText("Completed").first()).toBeVisible({ timeout: 10_000 });
  });
});
