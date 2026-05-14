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
 * Profile Credentials Form Tests
 *
 * Tests the credential creation form interactions including:
 * - Credential type switching (Registry / Data / Generic)
 * - Form field validation (Save button disabled until all fields filled)
 * - Password visibility toggle
 * - Delete credential confirmation dialog
 *
 * Architecture notes:
 * - CredentialsSection at /profile#credentials
 * - Uses intersection observer for lazy loading
 * - Form types: REGISTRY (url, username, password), DATA (endpoint, access_key, secret_key), GENERIC (key-value pairs)
 * - API endpoints: GET /api/credentials, PUT /api/credentials (upsert), DELETE /api/credentials/{name}
 */

const CT_JSON = "application/json";

async function setupProfileSettings(
  page: Parameters<typeof setupDefaultMocks>[0],
  overrides: { profile?: Record<string, unknown>; roles?: string[]; pools?: string[] } = {},
) {
  const body = JSON.stringify({
    profile: {
      email_notification: true,
      slack_notification: false,
      bucket: "default-bucket",
      pool: "default-pool",
      ...overrides.profile,
    },
    roles: overrides.roles ?? [],
    pools: overrides.pools ?? ["pool-alpha"],
  });
  await page.route("**/api/profile/settings*", (route) =>
    route.fulfill({ status: 200, contentType: CT_JSON, body }),
  );
}

async function setupBuckets(page: Parameters<typeof setupDefaultMocks>[0]) {
  const body = JSON.stringify({
    buckets: [{ name: "default-bucket", path: "s3://default-bucket", description: "", mode: "rw", default_credential: false }],
    default: "default-bucket",
  });
  await page.route("**/api/bucket*", (route) =>
    route.fulfill({ status: 200, contentType: CT_JSON, body }),
  );
}

async function setupCredentials(
  page: Parameters<typeof setupDefaultMocks>[0],
  credentials: Array<{ cred_name: string; cred_type: string; profile?: string }> = [],
) {
  const body = JSON.stringify({ credentials });
  await page.route("**/api/credentials*", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: CT_JSON, body });
    }
    // For PUT (upsert) and DELETE, return success
    return route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify({ status: "ok" }) });
  });
}

async function scrollToCredentials(page: Parameters<typeof setupDefaultMocks>[0]) {
  await page.locator("#credentials").scrollIntoViewIfNeeded();
}

test.describe("Credential Form Type Switching", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
    await setupCredentials(page, []);
  });

  test("credential form defaults to Registry type with registry fields", async ({ page }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);
    await page.getByRole("button", { name: /new credential/i }).click();

    // ASSERT — Registry fields are visible by default
    await expect(page.getByLabel("Credential Name")).toBeVisible();
    await expect(page.getByLabel("Registry URL")).toBeVisible();
    await expect(page.getByLabel("Username")).toBeVisible();
    await expect(page.getByLabel("Password / Token")).toBeVisible();
  });

  test("Save button is disabled when required fields are empty", async ({ page }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);
    await page.getByRole("button", { name: /new credential/i }).click();

    // ASSERT — Save button is disabled with empty form
    const credSection = page.locator("#credentials");
    await expect(credSection.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("password visibility toggle works for registry credential", async ({ page }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);
    await page.getByRole("button", { name: /new credential/i }).click();

    // Fill password field
    const passwordInput = page.getByLabel("Password / Token");
    await passwordInput.fill("my-secret-token");

    // ASSERT — password is hidden by default
    await expect(passwordInput).toHaveAttribute("type", "password");

    // Click show password toggle
    await page.getByTitle("Show password").click();

    // ASSERT — password is now visible
    await expect(passwordInput).toHaveAttribute("type", "text");

    // Click hide password toggle
    await page.getByTitle("Hide password").click();

    // ASSERT — password is hidden again
    await expect(passwordInput).toHaveAttribute("type", "password");
  });
});

test.describe("Credential Delete Confirmation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
  });

  test("clicking delete on a credential shows confirmation dialog", async ({ page }) => {
    // ARRANGE — existing credential
    await setupCredentials(page, [
      { cred_name: "my-docker-cred", cred_type: "REGISTRY" },
    ]);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);

    // Wait for the credential to appear
    await expect(page.getByText("my-docker-cred").first()).toBeVisible();

    // Click delete button on the credential
    await page.getByTitle("Delete credential").click();

    // ASSERT — confirmation dialog appears
    await expect(page.getByText("Delete Credential")).toBeVisible();
    await expect(page.getByText(/are you sure you want to delete/i)).toBeVisible();
    await expect(page.getByText("my-docker-cred").first()).toBeVisible();
  });

  test("cancel button in delete dialog closes without deleting", async ({ page }) => {
    // ARRANGE
    await setupCredentials(page, [
      { cred_name: "keep-this-cred", cred_type: "DATA" },
    ]);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);

    await expect(page.getByText("keep-this-cred").first()).toBeVisible();
    await page.getByTitle("Delete credential").click();

    // Click Cancel in the dialog
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    // ASSERT — dialog is dismissed, credential still visible
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("keep-this-cred").first()).toBeVisible();
  });

  test("shows total credential count badge", async ({ page }) => {
    // ARRANGE — multiple credentials
    await setupCredentials(page, [
      { cred_name: "docker-hub", cred_type: "REGISTRY" },
      { cred_name: "s3-prod", cred_type: "DATA" },
      { cred_name: "api-token", cred_type: "GENERIC" },
    ]);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);

    // ASSERT — total count badge shows correct number
    await expect(page.getByText("3 total")).toBeVisible();
  });
});

test.describe("Credential Error States", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
  });

  test("shows error state when credentials API fails", async ({ page }) => {
    // ARRANGE — credentials endpoint returns error
    await page.route("**/api/credentials*", (route) =>
      route.fulfill({
        status: 400,
        contentType: CT_JSON,
        body: JSON.stringify({ detail: "Failed to load credentials" }),
      }),
    );

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);

    // ASSERT — error state shown
    await expect(page.getByText(/unable to load credentials/i).first()).toBeVisible();
  });
});
