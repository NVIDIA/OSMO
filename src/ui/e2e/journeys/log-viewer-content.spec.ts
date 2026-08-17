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
 * Log Viewer Content Page Tests
 *
 * Tests the log viewer when a workflow is selected (/log-viewer?workflow=name).
 * This complements log-viewer.spec.ts and log-viewer-selector.spec.ts which
 * only test the selector UI (when no workflow param is present).
 *
 * - Page shows log viewer container when workflow param is provided
 * - Breadcrumb shows "Log Viewer" link back to selector
 * - Loading skeleton shown while workflow data loads
 * - Navigating to log viewer with workflow adds to recent workflows
 * - Error boundary catches and displays errors gracefully
 *
 * Architecture notes:
 * - Route: /log-viewer?workflow={name}
 * - LogViewerWithData (server component) → LogViewerPageContent (client)
 * - LogViewerPageContent fetches workflow via useWorkflow({name, verbose: false})
 * - Shows LogViewerSkeleton while loading, then LogViewerContainer
 * - Adds workflowId to recent workflows via addRecentWorkflow on mount
 * - Page title set to workflowId via usePage()
 * - Breadcrumb: Log Viewer → {workflowId}
 */

const CT_JSON = "application/json";
const WRAPPED_LOG_SUFFIX = " wrapped-log-segment".repeat(24);
const SEARCH_CONTEXT_MESSAGE_BY_INDEX = new Map<number, string>([
  [0, "needle first match"],
  [2, "context immediately before target"],
  [3, `needle selected target${WRAPPED_LOG_SUFFIX}`],
  [4, "context immediately after target"],
]);

function createWorkflowForLogs(name: string) {
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
    pool: "test-pool",
    backend: "k8s-test",
    app_owner: null,
    app_name: null,
    app_version: null,
    plugins: { rsync: false },
  };
}

function createLogsWithSearchContext(): string {
  return Array.from({ length: 60 }, (_, index) => {
    const minute = String(index).padStart(2, "0");
    const message =
      SEARCH_CONTEXT_MESSAGE_BY_INDEX.get(index) ??
      (index >= 6 ? `needle filler match ${index}` : `ordinary log line ${index}`);
    return `2026/01/15 10:${minute}:00 [train-task] ${message}`;
  }).join("\n");
}

test.describe("Log Viewer Content Page", () => {
  test.describe.configure({ timeout: 30_000 });

  const wfName = "log-viewer-content-wf";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows log viewer container when workflow param is provided", async ({ page }) => {
    // ARRANGE
    const data = createWorkflowForLogs(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
    // Mock the logs endpoint to return some log content
    await page.route(`**/api/workflow/${wfName}/logs*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "2026-01-15T10:00:00Z [INFO] Training started\n2026-01-15T11:00:00Z [INFO] Training completed",
      }),
    );

    // ACT
    await page.goto(`/log-viewer?workflow=${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — page should NOT show the selector (input for workflow ID)
    await expect(page.getByPlaceholder(/enter workflow id/i)).not.toBeVisible();
  });

  test("breadcrumb shows 'Log Viewer' link when viewing a workflow", async ({ page }) => {
    // ARRANGE
    const data = createWorkflowForLogs(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
    await page.route(`**/api/workflow/${wfName}/logs*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "",
      }),
    );

    // ACT
    await page.goto(`/log-viewer?workflow=${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — breadcrumb shows "Log Viewer" text
    await expect(page.getByText("Log Viewer").first()).toBeVisible();
  });

  test("adds workflow to recent list on visit", async ({ page }) => {
    // ARRANGE
    const recentWfName = "recent-log-wf";
    const data = createWorkflowForLogs(recentWfName);
    await page.route(`**/api/workflow/${recentWfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
    await page.route(`**/api/workflow/${recentWfName}/logs*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "",
      }),
    );

    // Clear localStorage first
    await page.goto("/log-viewer");
    await page.evaluate(() => {
      localStorage.removeItem("osmo:recent-workflows");
    });

    // ACT — visit log viewer with workflow param
    await page.goto(`/log-viewer?workflow=${recentWfName}`);
    await page.waitForLoadState("networkidle");

    // Navigate back to selector
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // ASSERT — recent workflows should include the visited workflow
    await expect(page.getByText("Recent Workflows").first()).toBeVisible();
    await expect(page.getByText(recentWfName).first()).toBeVisible();
  });

  test("shows workflow name in the page when loaded", async ({ page }) => {
    // ARRANGE
    const data = createWorkflowForLogs(wfName);
    await page.route(`**/api/workflow/${wfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
    await page.route(`**/api/workflow/${wfName}/logs*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "Some log output here",
      }),
    );

    // ACT
    await page.goto(`/log-viewer?workflow=${wfName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — workflow name appears somewhere on the page (breadcrumb or title)
    await expect(page.getByText(wfName).first()).toBeVisible();
  });

  test("shows the selected search result in its surrounding log context", async ({ page }) => {
    const contextWfName = "log-viewer-show-context-wf";
    const data = createWorkflowForLogs(contextWfName);
    await page.route(`**/api/workflow/${contextWfName}*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify(data),
      }),
    );
    await page.route(`**/api/workflow/${contextWfName}/logs*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: createLogsWithSearchContext(),
      }),
    );

    await page.goto(`/log-viewer?workflow=${contextWfName}&f=source:user`);
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByRole("combobox", { name: /search and filter/i });
    await searchInput.fill("needle");
    await searchInput.press("Enter");

    await expect.poll(() => new URL(page.url()).searchParams.getAll("f")).toEqual(["source:user", "text:needle"]);
    const firstMatch = page.getByText("needle first match", { exact: true });
    const selectedTarget = page.getByText(/^needle selected target/);
    const contextBeforeTarget = page.getByText(/^context immediately before target/);
    const contextAfterTarget = page.getByText(/^context immediately after target/);
    await expect(firstMatch).toBeVisible();
    await expect(selectedTarget).toBeVisible();
    await expect(contextBeforeTarget).not.toBeVisible();
    await expect(contextAfterTarget).not.toBeVisible();

    // Enable wrapping after filtering so the tall measurement exists only at
    // the target's search-result index, not its later full-list index.
    await page.getByRole("button", { name: "Enable line wrap" }).click();
    await expect(page.getByRole("button", { name: "Disable line wrap" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // A keyboard-only user can focus a result and open the same action.
    const keyboardTarget = page.getByRole("row").filter({ hasText: "needle selected target" });
    // Seed a real dynamic-height measurement before the row moves to a new index.
    // This also guards against the test passing with a single-line fixture.
    await expect.poll(async () => (await keyboardTarget.boundingBox())?.height ?? 0).toBeGreaterThan(64);
    await keyboardTarget.focus();
    await expect(keyboardTarget).toBeFocused();
    await keyboardTarget.press("Shift+F10");
    await expect(page.getByRole("menuitem", { name: "Show in context" })).toBeEnabled();
    await page.keyboard.press("Escape");

    // Keep the first result selected to prove the action targets the right-clicked row.
    await firstMatch.click();
    await selectedTarget.click({ button: "right" });
    const showInContext = page.getByRole("menuitem", { name: "Show in context" });
    await expect(showInContext).toBeVisible();
    await showInContext.click();

    // The text search is removed while the structured source filter is preserved.
    await expect.poll(() => new URL(page.url()).searchParams.getAll("f")).toEqual(["source:user"]);
    await expect(page.getByText("source: user", { exact: true })).toBeVisible();

    const contextTarget = page.getByRole("row").filter({ hasText: "needle selected target" });
    await expect(contextTarget).toBeVisible();
    await expect(contextTarget).toHaveAttribute("aria-current", "true");
    await expect(contextBeforeTarget).toBeVisible();
    await expect(contextAfterTarget).toBeVisible();

    // The next absolute row must start below the unchanged wrapped target.
    // Index-keyed measurement caches position it inside the target instead.
    const contextAfterRow = page.getByRole("row").filter({ hasText: "context immediately after target" });
    await expect
      .poll(async () => {
        const [targetBox, nextBox] = await Promise.all([
          contextTarget.boundingBox(),
          contextAfterRow.boundingBox(),
        ]);
        if (!targetBox || !nextBox) return Number.NEGATIVE_INFINITY;
        return nextBox.y - (targetBox.y + targetBox.height);
      })
      .toBeGreaterThanOrEqual(-0.5);

    await contextTarget.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Show in context" })).toHaveCount(0);
  });
});
