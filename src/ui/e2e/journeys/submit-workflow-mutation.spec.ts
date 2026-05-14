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

import { test, expect, type Locator } from "@playwright/test";
import { createPoolResponse, PoolStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupPools } from "@/e2e/utils/mock-setup";

/**
 * Submit Workflow Mutation Tests
 *
 * Tests the submit workflow mutation flow (submit button → API call → result):
 * - Submit sends request to POST /api/pool/{pool}/workflow
 * - Success shows toast "Workflow submitted as {name}" + overlay closes
 * - Error shows inline error message in the config panel
 * - "Submitting..." loading state while pending
 *
 * Architecture notes:
 * - useSubmitWorkflowForm → submitMutate → POST /api/pool/{pool}/workflow
 * - On success: toast.success + announcer.announce + close overlay
 * - On error: setError(msg) + announcer.announce (error stays inline)
 * - useSubmitWorkflowStore.close() hides the overlay
 * - The submit button is disabled when: no pool, empty spec, isPending, or localpath block
 *
 * Pool selection flow:
 * - useSubmitWorkflowForm → useProfile() → GET /api/profile/settings → profile.pool = default pool
 * - usePoolSelection(defaultPool) → validates pool via pool_quota endpoint
 */

const CT_JSON = "application/json";

async function setupProfileWithDefaultPool(
  page: Parameters<typeof setupDefaultMocks>[0],
  defaultPool: string,
  accessiblePools: string[],
) {
  await page.route("**/api/profile/settings*", (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({
        profile: {
          username: "test-user",
          email_notification: true,
          slack_notification: false,
          bucket: "",
          pool: defaultPool,
        },
        roles: [],
        pools: accessiblePools,
      }),
    }),
  );
}

async function openFormView(page: Parameters<typeof setupDefaultMocks>[0]) {
  await page.goto("/pools?all=true");
  await page.waitForLoadState("networkidle");

  // Open overlay
  await page.getByRole("button", { name: "Submit workflow" }).click();
  const overlay = page.getByRole("dialog", { name: "Submit workflow" });
  await expect(overlay).toBeVisible();

  // Select blank editor to enter form view
  await overlay.getByText("Start with blank editor").click();

  // Wait for form to be ready (resizer indicates form view)
  await expect(overlay.getByRole("separator", { name: /drag to resize/i })).toBeVisible();

  return overlay;
}

async function waitForPoolSelected(overlay: Locator, poolName: string) {
  await expect(overlay.getByText(poolName).first()).toBeVisible({ timeout: 5_000 });
}

test.describe("Submit Workflow Mutation — Success", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfileWithDefaultPool(page, "test-pool", ["test-pool"]);
    await setupPools(
      page,
      createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
    );
  });

  test("successful submission shows toast and closes overlay", async ({ page }) => {
    // ARRANGE — mock the workflow submission endpoint to succeed
    await page.route("**/api/pool/test-pool/workflow*", (route) => {
      const url = new URL(route.request().url());
      // Only handle actual submissions (not dry_run or validation_only)
      if (url.searchParams.get("dry_run") !== "true" && url.searchParams.get("validation_only") !== "true") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({ name: "my-submitted-workflow-123" }),
        });
      }
      return route.fulfill({ status: 404, contentType: CT_JSON, body: '{"detail":"Not mocked"}' });
    });

    const overlay = await openFormView(page);
    await waitForPoolSelected(overlay, "test-pool");

    // Type some YAML so spec is non-empty (required for canSubmit)
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.type("workflow:\n  tasks:\n  - name: hello");

    // ACT — click Submit (use exact aria-label to avoid matching "Close submit workflow")
    await overlay.getByRole("button", { name: "Submit workflow", exact: true }).click();

    // ASSERT — success toast appears with the new workflow name
    await expect(
      page.getByText(/workflow submitted as my-submitted-workflow-123/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    // ASSERT — overlay closes after successful submission
    await expect(overlay).not.toBeVisible({ timeout: 5_000 });
  });

  test("submit button shows 'Submitting...' while request is pending", async ({ page }) => {
    // ARRANGE — mock endpoint to never respond (simulates pending)
    await page.route("**/api/pool/test-pool/workflow*", () => {
      // Never fulfill — request stays pending
    });

    const overlay = await openFormView(page);
    await waitForPoolSelected(overlay, "test-pool");

    // Type some YAML
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.type("workflow:\n  tasks:\n  - name: hello");

    // ACT — click Submit (use exact aria-label)
    await overlay.getByRole("button", { name: "Submit workflow", exact: true }).click();

    // ASSERT — "Submitting..." loading state
    await expect(overlay.getByText("Submitting...").first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Submit Workflow Mutation — Error", () => {
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfileWithDefaultPool(page, "test-pool", ["test-pool"]);
    await setupPools(
      page,
      createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
    );
  });

  test("submission error displays inline error message", async ({ page }) => {
    // ARRANGE — mock the workflow submission endpoint to return an error
    await page.route("**/api/pool/test-pool/workflow*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("dry_run") !== "true" && url.searchParams.get("validation_only") !== "true") {
        return route.fulfill({
          status: 400,
          contentType: CT_JSON,
          body: JSON.stringify({ detail: "Pool 'test-pool' has insufficient resources" }),
        });
      }
      return route.fulfill({ status: 404, contentType: CT_JSON, body: '{"detail":"Not mocked"}' });
    });

    const overlay = await openFormView(page);
    await waitForPoolSelected(overlay, "test-pool");

    // Type some YAML
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.type("workflow:\n  tasks:\n  - name: hello");

    // ACT — click Submit (use exact aria-label)
    await overlay.getByRole("button", { name: "Submit workflow", exact: true }).click();

    // ASSERT — error message appears inline in the config panel
    await expect(
      overlay.getByText(/insufficient resources/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    // ASSERT — overlay stays open (not closed)
    await expect(overlay).toBeVisible();
  });

  test("submit button disabled when pool is not yet loaded (no profile mock)", async ({ page }) => {
    // ARRANGE — remove the profile mock so pool won't be auto-selected
    // The default 404 catch-all will handle the profile settings request
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await setupDefaultMocks(page);
    // Do NOT call setupProfileWithDefaultPool — this means pool will be empty
    await setupPools(
      page,
      createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
    );

    const overlay = await openFormView(page);

    // Type some YAML so spec is non-empty
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.type("workflow:\n  tasks:\n  - name: hello");

    // ASSERT — Submit button is disabled because no pool is selected
    const submitBtn = overlay.getByRole("button", { name: "Submit workflow", exact: true });
    await expect(submitBtn).toBeDisabled();
  });
});
