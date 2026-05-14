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
 * Workflow Detail Spec Viewer Interaction Tests
 *
 * Tests the WorkflowSpecViewer component inside the workflow detail Spec tab:
 * - YAML/Template view toggle
 * - Copy button interaction
 * - Download button visibility
 * - Open in new tab link visibility
 *
 * Architecture notes:
 * - Spec tab lazy-loads WorkflowSpecViewer (dynamic import, ssr: false)
 * - SpecToolbar has a radiogroup "View selection" with YAML and Template
 * - Copy, Download, and Open in new tab buttons in the toolbar
 * - Content fetched from workflow.spec and workflow.template_spec URLs
 */

const CT_JSON = "application/json";

function createWorkflowDetailForSpec(name: string) {
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

async function setupWorkflowAndSpec(
  page: Parameters<typeof setupDefaultMocks>[0],
  name: string,
) {
  const data = createWorkflowDetailForSpec(name);

  // Mock the spec endpoint — registered BEFORE the catch-all so LIFO gives these priority
  await page.route(`**/api/workflow/${name}/spec`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "version: 1\ntasks:\n  - name: train\n    image: nvcr.io/nvidia/pytorch:24.01-py3\n    command: python train.py",
    }),
  );

  // Mock the template_spec endpoint
  await page.route(`**/api/workflow/${name}/template_spec`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "version: 1\ntasks:\n  - name: train\n    image: {{image}}\n    command: {{command}}",
    }),
  );

  // Mock the workflow detail endpoint — registered LAST so LIFO tries it first for the base URL
  // but the more specific spec/template_spec routes above will match first for those sub-paths
  await page.route(`**/api/workflow/${name}*`, (route) => {
    const url = route.request().url();
    // Let spec/template_spec requests fall through to their specific handlers
    if (url.includes(`/workflow/${name}/spec`) || url.includes(`/workflow/${name}/template_spec`)) {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify(data),
    });
  });
}

test.describe("Workflow Spec Viewer Interactions", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "spec-viewer-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupWorkflowAndSpec(page, wfName);
  });

  test("YAML view is selected by default in spec tab", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    // Click Spec tab
    await page.getByRole("tab", { name: "Spec" }).click();

    // Wait for spec viewer to load (lazy loaded)
    const toolbar = page.getByRole("toolbar", { name: "Spec viewer controls" });
    await expect(toolbar).toBeVisible({ timeout: 10_000 });

    // ASSERT — YAML radio is checked by default
    const yamlRadio = page.getByRole("radio", { name: /yaml/i });
    await expect(yamlRadio).toHaveAttribute("aria-checked", "true");
  });

  test("clicking Template switches view and updates aria-checked", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: "Spec" }).click();

    const toolbar = page.getByRole("toolbar", { name: "Spec viewer controls" });
    await expect(toolbar).toBeVisible({ timeout: 10_000 });

    // Click Template radio button
    await page.getByRole("radio", { name: /template/i }).click();

    // ASSERT — Template is now checked, YAML is not
    await expect(page.getByRole("radio", { name: /template/i })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("radio", { name: /yaml/i })).toHaveAttribute("aria-checked", "false");
  });

  test("copy button is visible and enabled when spec content is loaded", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: "Spec" }).click();

    const toolbar = page.getByRole("toolbar", { name: "Spec viewer controls" });
    await expect(toolbar).toBeVisible({ timeout: 10_000 });

    // ASSERT — copy button is visible and enabled
    const copyButton = page.getByRole("button", { name: /copy to clipboard/i });
    await expect(copyButton).toBeVisible();
    await expect(copyButton).toBeEnabled();
  });

  test("download button is visible and enabled when spec content is loaded", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: "Spec" }).click();

    const toolbar = page.getByRole("toolbar", { name: "Spec viewer controls" });
    await expect(toolbar).toBeVisible({ timeout: 10_000 });

    // ASSERT — download button is visible and enabled
    const downloadButton = page.getByRole("button", { name: /download file/i });
    await expect(downloadButton).toBeVisible();
    await expect(downloadButton).toBeEnabled();
  });

  test("open in new tab link is visible", async ({ page }) => {
    // ACT
    await page.goto(`/workflows/${wfName}`);
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: "Spec" }).click();

    const toolbar = page.getByRole("toolbar", { name: "Spec viewer controls" });
    await expect(toolbar).toBeVisible({ timeout: 10_000 });

    // ASSERT — open in new tab link is visible (renders as <a> link, not button)
    const openLink = page.getByRole("link", { name: /open raw.*in new tab/i });
    await expect(openLink).toBeVisible();
  });
});
