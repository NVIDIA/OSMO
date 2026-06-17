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
 * Task Detail Overview Sections Tests
 *
 * Tests the task detail Overview tab's non-timeline sections:
 * - Details section: UUID, Node (as link), Pod, Pod IP
 * - Links section: Dashboard link when dashboard_url is set
 * - Timeline heading visibility
 *
 * Architecture notes:
 * - TaskDetails renders OverviewTab which includes:
 *   - TaskTimeline (inside <Card>)
 *   - DetailsSection: UUID (copyable, mono), Node (Link to /resources?view=), Pod, Pod IP
 *   - LinksSection: Dashboard (BarChart3), Grafana (Activity) — only shown when URLs are set
 * - DetailsSection filters items with show !== false && value !== null/undefined
 * - LinksSection filters to only links with valid URLs
 */

const CT_JSON = "application/json";

function createWorkflowForTaskOverview(name: string) {
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
        name: "compute-group",
        status: "COMPLETED",
        start_time: twoHoursAgo.toISOString(),
        end_time: now.toISOString(),
        processing_start_time: twoHoursAgo.toISOString(),
        scheduling_start_time: twoHoursAgo.toISOString(),
        initializing_start_time: twoHoursAgo.toISOString(),
        remaining_upstream_groups: [],
        downstream_groups: [],
        failure_message: null,
        tasks: [
          {
            name: "gpu-worker",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/gpu-worker/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 3600,
            task_uuid: "abc12345-task-uuid-gpu-worker",
            node_name: "dgx-node-07.cluster.internal",
            pod_name: "gpu-worker-pod-xyz789",
            pod_ip: "10.42.3.199",
            dashboard_url: "https://k8s-dashboard.example.com/pod/gpu-worker",
            lead: true,
          },
          {
            name: "cpu-helper",
            retry_id: 0,
            status: "COMPLETED",
            failure_message: null,
            exit_code: 0,
            logs: `/api/workflow/${name}/task/cpu-helper/logs`,
            error_logs: null,
            processing_start_time: twoHoursAgo.toISOString(),
            scheduling_start_time: twoHoursAgo.toISOString(),
            initializing_start_time: twoHoursAgo.toISOString(),
            start_time: oneHourAgo.toISOString(),
            end_time: now.toISOString(),
            duration: 1800,
            task_uuid: "def67890-task-uuid-cpu-helper",
            node_name: "cpu-node-02.cluster.internal",
            pod_name: "cpu-helper-pod-abc456",
            pod_ip: "10.42.4.55",
            dashboard_url: null,
            lead: false,
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

test.describe("Task Detail — Overview Sections", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "task-overview-sections-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);

    const data = createWorkflowForTaskOverview(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );
  });

  test("task overview shows Timeline heading", async ({ page }) => {
    await page.goto(`/workflows/${wfName}?group=compute-group&task=gpu-worker`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Timeline section heading visible
    await expect(page.getByText("Timeline", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("task overview shows UUID in Details section", async ({ page }) => {
    await page.goto(`/workflows/${wfName}?group=compute-group&task=gpu-worker`);
    await page.waitForLoadState("networkidle");

    // ASSERT — UUID label and value visible
    await expect(page.getByText("UUID").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("abc12345-task-uuid-gpu-worker").first()).toBeVisible();
  });

  test("task overview shows Pod IP in Details section", async ({ page }) => {
    await page.goto(`/workflows/${wfName}?group=compute-group&task=gpu-worker`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Pod IP label and value visible
    await expect(page.getByText("Pod IP").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("10.42.3.199").first()).toBeVisible();
  });

  test("task overview shows Dashboard link when dashboard_url is set", async ({ page }) => {
    await page.goto(`/workflows/${wfName}?group=compute-group&task=gpu-worker`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Dashboard link visible in Links section
    await expect(page.getByText("Dashboard").first()).toBeVisible({ timeout: 10_000 });
  });

  test("task overview does not show Dashboard link when dashboard_url is null", async ({ page }) => {
    // Navigate to cpu-helper which has dashboard_url: null
    await page.goto(`/workflows/${wfName}?group=compute-group&task=cpu-helper`);
    await page.waitForLoadState("networkidle");

    // Wait for details to load (Pod IP should be visible)
    await expect(page.getByText("10.42.4.55").first()).toBeVisible({ timeout: 10_000 });

    // ASSERT — Dashboard link NOT visible (LinksSection returns null when no URLs)
    // The "Links" heading should not be present since both dashboard_url and grafana_url are null
    await expect(page.getByText("Links", { exact: true })).not.toBeVisible();
  });
});
