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
 * Submit Workflow Form Actions Tests
 *
 * Tests the submit workflow form interactions beyond basic overlay open/close:
 * - Validate button in dropdown triggers validation and shows result
 * - Preview button triggers dry run and shows rendered spec
 * - Localpath warnings block submission
 * - Submit button sends request and shows success toast
 * - Error states display inline alerts
 *
 * Architecture notes:
 * - Form view has: YAML editor (left), config panel (right)
 * - Config panel: Target Pool (combobox), Priority Level (radiogroup), action buttons
 * - Action buttons: Cancel, Preview, Submit + dropdown with Validate
 * - API: POST /api/pool/{pool}/workflow with params: priority, dry_run, validation_only
 * - Localpath detection: files[].localpath and dataset.localpath block Submit/Preview
 *
 * Pool selection flow:
 * - useSubmitWorkflowForm → useProfile() → GET /api/profile/settings → profile.pool = default pool
 * - usePoolSelection(defaultPool) → usePool(poolName) → GET /api/pool_quota?pools=[poolName]
 * - Both must return valid data for `pool` to be non-empty and buttons to be enabled
 */

const CT_JSON = "application/json";

/**
 * Setup profile with a default pool. The profile endpoint must return
 * `profile.pool` set to the default pool name so that usePoolSelection
 * auto-selects it. The `pools` array lists accessible pool names.
 */
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

/**
 * Wait for the pool to be auto-selected. The form fetches the profile
 * to get the default pool, then validates it via the pool_quota endpoint.
 * Once validated, the pool name appears in the config panel.
 */
async function waitForPoolSelected(overlay: Locator, poolName: string) {
  // The pool name should appear in the collapsed section summary or combobox
  await expect(overlay.getByText(poolName).first()).toBeVisible({ timeout: 5_000 });
}

test.describe("Submit Workflow Form Validation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfileWithDefaultPool(page, "test-pool", ["test-pool"]);
    await setupPools(
      page,
      createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
    );
  });

  test("Validate option is accessible from dropdown menu", async ({ page }) => {
    // ARRANGE
    const overlay = await openFormView(page);
    // Wait for pool to be auto-selected so buttons are enabled
    await waitForPoolSelected(overlay, "test-pool");

    // Type some YAML so spec is non-empty (required for canSubmit)
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.type("workflow:\n  tasks:\n  - name: hello");

    // ACT — open the dropdown for more options
    await overlay.getByRole("button", { name: "More workflow options" }).click();

    // ASSERT — Validate menu item is visible
    await expect(page.getByRole("menuitem", { name: /validate/i })).toBeVisible();
  });

  test("Validate shows success message when spec is valid", async ({ page }) => {
    // ARRANGE — mock the validation endpoint to succeed
    await page.route("**/api/pool/test-pool/workflow*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("validation_only") === "true") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({ name: "hello-osmo", spec: "..." }),
        });
      }
      return route.fulfill({ status: 404, contentType: CT_JSON, body: '{"detail":"Not mocked"}' });
    });

    const overlay = await openFormView(page);
    await waitForPoolSelected(overlay, "test-pool");

    // Type some YAML so spec is non-empty
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.type("workflow:\n  tasks:\n  - name: hello");

    // ACT — trigger validation via dropdown
    await overlay.getByRole("button", { name: "More workflow options" }).click();
    await page.getByRole("menuitem", { name: /validate/i }).click();

    // ASSERT — success message appears
    await expect(overlay.getByText("Workflow spec is valid").first()).toBeVisible({ timeout: 5_000 });
  });

  test("Validate shows error message when spec is invalid", async ({ page }) => {
    // ARRANGE — mock the validation endpoint to return error
    await page.route("**/api/pool/test-pool/workflow*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("validation_only") === "true") {
        return route.fulfill({
          status: 400,
          contentType: CT_JSON,
          body: JSON.stringify({ detail: "Invalid YAML: missing required field 'tasks'" }),
        });
      }
      return route.fulfill({ status: 404, contentType: CT_JSON, body: '{"detail":"Not mocked"}' });
    });

    const overlay = await openFormView(page);
    await waitForPoolSelected(overlay, "test-pool");

    // Type some YAML so spec is non-empty
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.type("workflow:\n  tasks:\n  - name: hello");

    // ACT — trigger validation
    await overlay.getByRole("button", { name: "More workflow options" }).click();
    await page.getByRole("menuitem", { name: /validate/i }).click();

    // ASSERT — error message appears
    await expect(
      overlay.getByText(/invalid yaml|missing required/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("Preview button shows rendered spec on success", async ({ page }) => {
    // ARRANGE — mock dry run to succeed
    await page.route("**/api/pool/test-pool/workflow*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("dry_run") === "true") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({
            name: "hello-osmo",
            spec: "workflow:\n  name: hello-osmo-rendered\n  tasks:\n  - name: hello",
          }),
        });
      }
      return route.fulfill({ status: 404, contentType: CT_JSON, body: '{"detail":"Not mocked"}' });
    });

    const overlay = await openFormView(page);
    await waitForPoolSelected(overlay, "test-pool");

    // Type some YAML so spec is non-empty
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.type("workflow:\n  tasks:\n  - name: hello");

    // ACT — click Preview
    await overlay
      .getByRole("button", { name: "Preview rendered workflow after template substitution" })
      .click();

    // ASSERT — preview banner appears
    await expect(
      overlay.getByText(/showing rendered workflow/i).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Back to spec button is available
    await expect(overlay.getByText("Back to spec").first()).toBeVisible();
  });

  test("Priority radio group allows switching between Low, Normal, and High", async ({ page }) => {
    // ARRANGE
    const overlay = await openFormView(page);

    // ASSERT — priority radiogroup is visible with all options
    const priorityGroup = overlay.getByRole("radiogroup", { name: "Priority level" });
    await expect(priorityGroup).toBeVisible();

    // Click High priority label (the radio input is sr-only, so we click the label text)
    await priorityGroup.getByText("High").click();

    // ASSERT — High is now checked
    await expect(overlay.getByRole("radio", { name: "High priority" })).toBeChecked();
  });
});

test.describe("Submit Workflow Localpath Warnings", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfileWithDefaultPool(page, "test-pool", ["test-pool"]);
    await setupPools(
      page,
      createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
    );
  });

  test("shows file localpath warning when spec contains files localpath", async ({ page }) => {
    // ARRANGE
    const overlay = await openFormView(page);

    // ACT — type a spec with files localpath in the editor
    // The CodeMirror editor area — we need to clear existing content and type new content
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    // Select all and replace
    await page.keyboard.press("Meta+a");
    await page.keyboard.type(
      "workflow:\n  tasks:\n  - name: train\n    files:\n    - localpath: /tmp/data\n      dest: /data",
    );

    // ASSERT — localpath warning appears
    await expect(
      overlay.getByText("Local file injection not supported").first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("shows dataset localpath warning when spec contains dataset localpath", async ({ page }) => {
    // ARRANGE
    const overlay = await openFormView(page);

    // ACT — type a spec with dataset localpath
    const editor = overlay.getByRole("textbox", { name: "YAML workflow specification editor" });
    await editor.click();
    await page.keyboard.press("Meta+a");
    await page.keyboard.type(
      "workflow:\n  tasks:\n  - name: train\n    dataset:\n      localpath: /local/dataset",
    );

    // ASSERT — dataset localpath warning appears
    await expect(
      overlay.getByText("Local dataset path not supported").first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
