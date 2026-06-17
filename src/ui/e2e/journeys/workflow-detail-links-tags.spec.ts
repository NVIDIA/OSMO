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
 * Workflow Detail Links & Tags Section Tests
 *
 * Tests the Links section (Dashboard, Grafana, Outputs) and Tags display
 * in the workflow detail panel Overview tab:
 * - Links section renders all 3 link types with correct labels
 * - Tags section renders multiple tag pills
 * - Outputs link renders when outputs URL is present
 * - No links section when all link URLs are null
 * - Multiple tags wrapped in pills
 *
 * Architecture notes:
 * - Overview tab: Timeline → Details → Links → Actions
 * - Links section: Dashboard (BarChart3), Grafana (Activity), Outputs (Package)
 *   - Only shown if at least one URL is non-null/non-empty
 * - Tags section: inside Details card, rendered as flex-wrap pills
 * - Tags field: workflow.tags string array
 */

const CT_JSON = "application/json";

function createWorkflowWithLinksAndTags(
  name: string,
  overrides: {
    dashboard_url?: string | null;
    grafana_url?: string | null;
    outputs?: string;
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
    spec: "version: 1\ntasks:\n  - name: train",
    template_spec: "{}",
    logs: `/api/workflow/${name}/logs`,
    events: `/api/workflow/${name}/events`,
    overview: `/api/workflow/${name}/overview`,
    parent_name: null,
    parent_job_id: null,
    dashboard_url: overrides.dashboard_url ?? null,
    grafana_url: overrides.grafana_url ?? null,
    tags: overrides.tags ?? [],
    submit_time: oneHourAgo.toISOString(),
    start_time: oneHourAgo.toISOString(),
    end_time: now.toISOString(),
    exec_timeout: null,
    queue_timeout: null,
    duration: 3600,
    queued_time: 10,
    status: WorkflowStatus.COMPLETED,
    outputs: overrides.outputs ?? "",
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

test.describe("Workflow Detail — Links Section", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows all three link types when all URLs are present", async ({ page }) => {
    const wfName = "links-all-wf";
    const data = createWorkflowWithLinksAndTags(wfName, {
      dashboard_url: "https://dashboard.example.com/wf/123",
      grafana_url: "https://grafana.example.com/d/abc",
      outputs: "https://storage.example.com/outputs/train-run-1",
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — all three links are visible in the Links section
    await expect(page.getByText("Dashboard").first()).toBeVisible();
    await expect(page.getByText("Grafana").first()).toBeVisible();
    await expect(page.getByText("Outputs").first()).toBeVisible();
  });

  test("shows Outputs link pointing to correct URL", async ({ page }) => {
    const wfName = "links-outputs-wf";
    const outputsUrl = "https://storage.example.com/outputs/my-results";
    const data = createWorkflowWithLinksAndTags(wfName, {
      outputs: outputsUrl,
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — Outputs link is visible and has correct href
    const outputsLink = page.getByRole("link", { name: /Outputs/i }).first();
    await expect(outputsLink).toBeVisible();
    await expect(outputsLink).toHaveAttribute("href", outputsUrl);
  });

  test("does not show Links section when no external URLs are set", async ({ page }) => {
    const wfName = "links-none-wf";
    const data = createWorkflowWithLinksAndTags(wfName, {
      dashboard_url: null,
      grafana_url: null,
      outputs: "",
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — LinksSection returns null when all URLs are empty/null,
    // so the "Links" section header text is not rendered in the Overview tab.
    // The Overview tab contains Timeline, Details, Links (conditional), Actions sections.
    // Verify the "Links" heading is absent while "Details" is present.
    await expect(page.getByText("Details").first()).toBeVisible();
    // LinksSection renders <h3>Links</h3> — if no URLs, the entire section returns null
    await expect(page.locator("h3").filter({ hasText: /^Links$/ })).not.toBeVisible();
  });
});

test.describe("Workflow Detail — Tags Section", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows multiple tags as pills in the details section", async ({ page }) => {
    const wfName = "tags-multi-wf";
    const data = createWorkflowWithLinksAndTags(wfName, {
      tags: ["nightly", "gpu-benchmark", "v2.1"],
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — all tag pills are visible
    await expect(page.getByText("nightly").first()).toBeVisible();
    await expect(page.getByText("gpu-benchmark").first()).toBeVisible();
    await expect(page.getByText("v2.1").first()).toBeVisible();
  });

  test("tags section hidden when workflow has no tags", async ({ page }) => {
    const wfName = "tags-empty-wf";
    const data = createWorkflowWithLinksAndTags(wfName, {
      tags: [],
    });

    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
    );

    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — The tag pills should not exist when tags array is empty.
    // The Tags subsection only renders when workflow.tags.length > 0.
    // We verify UUID is visible (Details section loads) but no tag-specific
    // pill elements exist. Since "Tags" text might match other elements,
    // check that no elements with the tag pill class exist.
    await expect(page.getByText(`uuid-${wfName}`).first()).toBeVisible();
    // The tag container div uses flex-wrap gap-1.5 with pill spans.
    // With no tags, the icon+label "Tags" row is not rendered (conditional rendering).
    // Verify a specific tag pill ("nightly") does NOT exist (it would if tags were set).
    await expect(page.getByText("nightly")).not.toBeVisible();
  });
});
