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
import { setupDefaultMocks, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Profile Credential Save Mutation Tests
 *
 * Tests the full save (upsert) and delete flows for credentials:
 * - Filling all Registry fields and clicking Save sends PUT to API
 * - Success toast appears after credential creation
 * - Form is dismissed after successful save
 * - Delete confirmation dialog's Delete button triggers API call
 * - Error handling when save mutation fails
 *
 * Architecture notes:
 * - CredentialsSection uses useUpsertCredential() for save (PUT /api/credentials/{name})
 * - CredentialsSection uses useDeleteCredential() for delete (DELETE /api/credentials/{name})
 * - On success: toast.success('Credential "name" created/deleted successfully')
 * - On error: toast.error(message)
 * - After save, form state is cleared and form is hidden
 */

const CT_JSON = "application/json";

async function setupProfileSettings(
  page: Parameters<typeof setupDefaultMocks>[0],
) {
  await page.route("**/api/profile/settings*", (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({
        profile: { email_notification: true, slack_notification: false, bucket: "default-bucket", pool: "default-pool" },
        roles: [],
        pools: ["pool-alpha"],
      }),
    }),
  );
}

async function setupBuckets(page: Parameters<typeof setupDefaultMocks>[0]) {
  await page.route("**/api/bucket*", (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({
        buckets: [{ name: "default-bucket", path: "s3://default-bucket", description: "", mode: "rw", default_credential: false }],
        default: "default-bucket",
      }),
    }),
  );
}

async function setupCredentials(
  page: Parameters<typeof setupDefaultMocks>[0],
  credentials: Array<{ cred_name: string; cred_type: string; profile?: string }> = [],
) {
  await page.route("**/api/credentials/**", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify({ credentials }),
      });
    }
    // PUT/POST for upsert, DELETE for removal
    return route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({ status: "ok" }),
    });
  });
  await page.route("**/api/credentials", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify({ credentials }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({ status: "ok" }),
    });
  });
}

async function scrollToCredentials(page: Parameters<typeof setupDefaultMocks>[0]) {
  await page.locator("#credentials").scrollIntoViewIfNeeded();
}

async function openNewCredentialForm(page: Parameters<typeof setupDefaultMocks>[0]) {
  await page.goto("/profile");
  await page.waitForLoadState("networkidle");
  await scrollToCredentials(page);
  await page.getByRole("button", { name: /new credential/i }).click();
}

test.describe("Credential Save Mutation (Registry)", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
    await setupCredentials(page, []);
  });

  test("filling all registry fields and saving shows success toast and dismisses form", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);

    // ACT — fill all required fields
    await page.getByLabel("Credential Name").fill("my-docker-cred");
    await page.getByLabel("Registry URL").fill("docker.io");
    await page.getByLabel("Username").fill("testuser");
    await page.getByLabel("Password / Token").fill("my-secret-token");

    // Verify Save is now enabled
    const credSection = page.locator("#credentials");
    await expect(credSection.getByRole("button", { name: "Save" })).toBeEnabled();

    // Click Save
    await credSection.getByRole("button", { name: "Save" }).click();

    // ASSERT — success toast appears (text: Credential "name" created successfully)
    await expect(page.getByText("created successfully").first()).toBeVisible();

    // ASSERT — form is dismissed (New Credential button is back)
    await expect(page.getByRole("button", { name: /new credential/i })).toBeVisible();
    await expect(page.getByLabel("Credential Name")).not.toBeVisible();
  });

  test("Save button remains disabled when required fields are partially filled", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);

    // ACT — fill only name and URL (missing username and password)
    await page.getByLabel("Credential Name").fill("partial-cred");
    await page.getByLabel("Registry URL").fill("ghcr.io");

    // ASSERT — Save is still disabled
    const credSection = page.locator("#credentials");
    await expect(credSection.getByRole("button", { name: "Save" })).toBeDisabled();

    // ACT — fill username but still missing password
    await page.getByLabel("Username").fill("user1");
    await expect(credSection.getByRole("button", { name: "Save" })).toBeDisabled();

    // ACT — fill password — now all fields complete
    await page.getByLabel("Password / Token").fill("pass1");
    await expect(credSection.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

test.describe("Credential Delete Mutation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
  });

  test("confirming delete in dialog triggers API call and shows success toast", async ({ page }) => {
    // ARRANGE — existing credential with a route that tracks API calls
    const apiCalls: { method: string; url: string }[] = [];
    const credHandler = (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
      apiCalls.push({ method: route.request().method(), url: route.request().url() });
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({
            credentials: [{ cred_name: "old-cred", cred_type: "REGISTRY" }],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify({ status: "ok" }),
      });
    };
    await page.route("**/api/credentials/**", credHandler);
    await page.route("**/api/credentials", credHandler);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);

    // Wait for credential to render
    await expect(page.getByText("old-cred").first()).toBeVisible();

    // Click delete on the credential
    await page.getByTitle("Delete credential").click();

    // Confirm delete in dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Delete" }).click();

    // ASSERT — success toast appears (text: Credential "old-cred" deleted successfully)
    await expect(page.getByText("deleted successfully").first()).toBeVisible();

    // ASSERT — dialog is dismissed
    await expect(dialog).not.toBeVisible();

    // ASSERT — DELETE was sent
    const deleteCalls = apiCalls.filter((c) => c.method === "DELETE");
    expect(deleteCalls.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Credential Save Error Handling", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
  });

  test("shows error state when credential save fails", async ({ page }) => {
    // ARRANGE — credential save fails
    const failHandler = (route: Parameters<Parameters<typeof page.route>[1]>[0]) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({ credentials: [] }),
        });
      }
      // PUT/POST fails
      return route.fulfill({
        status: 409,
        contentType: CT_JSON,
        body: JSON.stringify({ detail: "Credential already exists" }),
      });
    };
    await page.route("**/api/credentials/**", failHandler);
    await page.route("**/api/credentials", failHandler);

    // ACT
    await openNewCredentialForm(page);

    // Fill all registry fields
    await page.getByLabel("Credential Name").fill("duplicate-cred");
    await page.getByLabel("Registry URL").fill("docker.io");
    await page.getByLabel("Username").fill("user");
    await page.getByLabel("Password / Token").fill("pass");

    // Click Save
    const credSection = page.locator("#credentials");
    await credSection.getByRole("button", { name: "Save" }).click();

    // ASSERT — form remains visible (not dismissed on error)
    await expect(page.getByLabel("Credential Name")).toBeVisible();

    // ASSERT — Save button remains enabled (user can retry)
    await expect(credSection.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});
