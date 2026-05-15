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
 * Profile Credentials Data & Generic Type Tests
 *
 * Tests credential form interactions for Data and Generic credential types,
 * complementing the existing profile-credentials-form.spec.ts which covers Registry.
 *
 * - Switching to Data type shows endpoint, access key, and secret key fields
 * - Switching to Generic type shows key-value pair fields
 * - Data type: secret key visibility toggle works
 * - Generic type: add/remove key-value pair buttons work
 * - Generic type: value visibility toggle works
 * - Save becomes enabled when all required fields are filled for each type
 *
 * Architecture notes:
 * - CredentialsSection at /profile#credentials
 * - Credential Type is a Select dropdown with options: Registry, Data, Generic
 * - Data type fields: Endpoint, Access Key ID, Secret Key (with show/hide toggle)
 * - Generic type fields: Key-Value Pairs (dynamic rows) with add/remove buttons
 * - The Select is wrapped in useMounted() guard for hydration safety
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
        profile: {
          email_notification: true,
          slack_notification: false,
          bucket: "default-bucket",
          pool: "default-pool",
        },
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
  await page.route("**/api/credentials*", (route) => {
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

test.describe("Credential Form Data Type Fields", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
    await setupCredentials(page, []);
  });

  test("switching to Data type shows endpoint, access key, and secret key fields", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);

    // ACT — switch from Registry (default) to Data type
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /data/i }).click();

    // ASSERT — Data credential fields visible, registry fields gone
    await expect(page.getByLabel("Endpoint")).toBeVisible();
    await expect(page.getByLabel("Access Key ID")).toBeVisible();
    await expect(page.getByLabel("Secret Key")).toBeVisible();
    await expect(page.getByLabel("Registry URL")).not.toBeVisible();
  });

  test("Data type secret key visibility toggle works", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /data/i }).click();

    // Fill in secret key
    const secretKeyInput = page.getByLabel("Secret Key");
    await secretKeyInput.fill("my-secret-access-key");

    // ASSERT — secret key is hidden by default
    await expect(secretKeyInput).toHaveAttribute("type", "password");

    // ACT — click show secret toggle
    await page.getByTitle("Show secret").click();

    // ASSERT — secret key is now visible
    await expect(secretKeyInput).toHaveAttribute("type", "text");

    // ACT — click hide secret toggle
    await page.getByTitle("Hide secret").click();

    // ASSERT — secret key is hidden again
    await expect(secretKeyInput).toHaveAttribute("type", "password");
  });

  test("Save is enabled when all Data type fields are filled", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /data/i }).click();

    const credSection = page.locator("#credentials");

    // Initially disabled
    await expect(credSection.getByRole("button", { name: "Save" })).toBeDisabled();

    // ACT — fill all required fields
    await page.getByLabel("Credential Name").fill("my-s3-cred");
    await page.getByLabel("Endpoint").fill("s3.amazonaws.com");
    await page.getByLabel("Access Key ID").fill("AKIAIOSFODNN7EXAMPLE");
    await page.getByLabel("Secret Key").fill("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY");

    // ASSERT — Save is now enabled
    await expect(credSection.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

test.describe("Credential Form Generic Type Fields", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
    await setupCredentials(page, []);
  });

  test("switching to Generic type shows key-value pair fields", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);

    // ACT — switch to Generic type
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /generic/i }).click();

    // ASSERT — Key-Value Pairs heading visible with input fields
    await expect(page.getByText("Key-Value Pairs")).toBeVisible();
    await expect(page.getByPlaceholder("Key").first()).toBeVisible();
    await expect(page.getByPlaceholder("Value").first()).toBeVisible();
    // Registry fields should not be visible
    await expect(page.getByLabel("Registry URL")).not.toBeVisible();
  });

  test("Generic type: add pair button adds a new key-value row", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /generic/i }).click();

    // Initially one row
    const keyInputs = page.getByPlaceholder("Key");
    await expect(keyInputs).toHaveCount(1);

    // ACT — click add pair button
    await page.getByTitle("Add another pair").click();

    // ASSERT — two rows now
    await expect(keyInputs).toHaveCount(2);
  });

  test("Generic type: remove pair button removes a row (requires 2+ rows)", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /generic/i }).click();

    // Add second row
    await page.getByTitle("Add another pair").click();
    await expect(page.getByPlaceholder("Key")).toHaveCount(2);

    // ACT — remove the second row (last "Remove pair" button)
    const removeButtons = page.getByTitle("Remove pair");
    await removeButtons.last().click();

    // ASSERT — back to one row
    await expect(page.getByPlaceholder("Key")).toHaveCount(1);
  });

  test("Generic type: remove button is disabled when only one pair exists", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /generic/i }).click();

    // ASSERT — single row's remove button is disabled
    await expect(
      page.getByTitle("At least one pair required"),
    ).toBeDisabled();
  });

  test("Generic type value visibility toggle works", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /generic/i }).click();

    // Fill a value
    const valueInput = page.getByPlaceholder("Value").first();
    await valueInput.fill("secret-token-123");

    // ASSERT — value is hidden by default
    await expect(valueInput).toHaveAttribute("type", "password");

    // ACT — click show values toggle
    await page.getByTitle("Show values").click();

    // ASSERT — value is now visible
    await expect(valueInput).toHaveAttribute("type", "text");
  });

  test("Save is enabled when all Generic type fields are filled", async ({ page }) => {
    // ARRANGE
    await openNewCredentialForm(page);
    await page.getByRole("combobox").click();
    await page.getByRole("option", { name: /generic/i }).click();

    const credSection = page.locator("#credentials");

    // Initially disabled
    await expect(credSection.getByRole("button", { name: "Save" })).toBeDisabled();

    // ACT — fill all required fields
    await page.getByLabel("Credential Name").fill("my-api-token");
    await page.getByPlaceholder("Key").first().fill("api_key");
    await page.getByPlaceholder("Value").first().fill("sk-1234567890");

    // ASSERT — Save is now enabled
    await expect(credSection.getByRole("button", { name: "Save" })).toBeEnabled();
  });
});

test.describe("Credential Type Grouping Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
  });

  test("credentials are grouped by type with group headers", async ({ page }) => {
    // ARRANGE — multiple credential types
    await setupCredentials(page, [
      { cred_name: "docker-hub", cred_type: "REGISTRY" },
      { cred_name: "ghcr-io", cred_type: "REGISTRY" },
      { cred_name: "s3-prod", cred_type: "DATA" },
      { cred_name: "api-token", cred_type: "GENERIC" },
    ]);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await scrollToCredentials(page);

    // ASSERT — group headers visible
    await expect(page.getByText("Registry").first()).toBeVisible();
    await expect(page.getByText("Data").first()).toBeVisible();
    await expect(page.getByText("Generic").first()).toBeVisible();

    // All credential names visible
    await expect(page.getByText("docker-hub").first()).toBeVisible();
    await expect(page.getByText("ghcr-io").first()).toBeVisible();
    await expect(page.getByText("s3-prod").first()).toBeVisible();
    await expect(page.getByText("api-token").first()).toBeVisible();
  });
});
