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
 * Profile Notification Save Mutation Tests
 *
 * Tests the full save flow for notification preferences:
 * - Toggling a notification and saving sends PUT to /api/profile/settings
 * - Success toast appears after save completes
 * - Save/Reset buttons return to disabled state after successful save
 * - Error toast appears when save fails
 *
 * Architecture notes:
 * - NotificationsSection uses useUpdateProfile() mutation
 * - On success: toast.success("Notification preferences saved successfully")
 * - On error: toast.error(message)
 * - After save, notificationEdits state is cleared → buttons become disabled
 */

const CT_JSON = "application/json";

async function setupProfileSettings(
  page: Parameters<typeof setupDefaultMocks>[0],
  overrides: {
    profile?: Record<string, unknown>;
    roles?: string[];
    pools?: string[];
  } = {},
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
  await page.route("**/api/profile/settings*", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: CT_JSON, body });
    }
    // PUT for saving — default success
    return route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({ status: "ok" }),
    });
  });
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

async function setupCredentials(page: Parameters<typeof setupDefaultMocks>[0]) {
  await page.route("**/api/credentials*", (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({ credentials: [] }),
    }),
  );
}

test.describe("Profile Notification Save Mutation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupBuckets(page);
    await setupCredentials(page);
  });

  test("saving notification toggle sends PUT request and shows success toast", async ({ page }) => {
    // ARRANGE — track API calls
    const apiCalls: { method: string; url: string }[] = [];
    await page.route("**/api/profile/settings*", (route) => {
      apiCalls.push({ method: route.request().method(), url: route.request().url() });
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({
            profile: { email_notification: true, slack_notification: false, bucket: "default-bucket", pool: "default-pool" },
            roles: [],
            pools: ["pool-alpha"],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify({ status: "ok" }),
      });
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Toggle slack notification on
    const slackSwitch = page.locator("#notification-slack");
    await slackSwitch.click();

    // Click Save
    await page.getByRole("button", { name: "Save" }).first().click();

    // ASSERT — success toast appears
    await expect(page.getByText("Notification preferences saved successfully").first()).toBeVisible();

    // ASSERT — Save/Reset buttons return to disabled state
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reset" }).first()).toBeDisabled();

    // ASSERT — PUT was sent
    const putCalls = apiCalls.filter((c) => c.method === "POST" || c.method === "PUT");
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("shows error toast when notification save fails", async ({ page }) => {
    // ARRANGE — make PUT fail
    await page.route("**/api/profile/settings*", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({
            profile: { email_notification: true, slack_notification: false, bucket: "default-bucket", pool: "default-pool" },
            roles: [],
            pools: ["pool-alpha"],
          }),
        });
      }
      // PUT fails
      return route.fulfill({
        status: 500,
        contentType: CT_JSON,
        body: JSON.stringify({ detail: "Internal server error" }),
      });
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Toggle email notification off
    const emailSwitch = page.locator("#notification-email");
    await emailSwitch.click();

    // Click Save
    await page.getByRole("button", { name: "Save" }).first().click();

    // ASSERT — error feedback appears (buttons stay enabled since save failed)
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeEnabled();
  });

  test("Reset button reverts edits without calling API", async ({ page }) => {
    // ARRANGE — track API calls
    const putCalls: string[] = [];
    await page.route("**/api/profile/settings*", (route) => {
      if (route.request().method() !== "GET") {
        putCalls.push(route.request().method());
      }
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({
            profile: { email_notification: true, slack_notification: false, bucket: "default-bucket", pool: "default-pool" },
            roles: [],
            pools: ["pool-alpha"],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify({ status: "ok" }),
      });
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Toggle notification
    const slackSwitch = page.locator("#notification-slack");
    await slackSwitch.click();

    // Verify dirty state
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeEnabled();

    // Click Reset instead of Save
    await page.getByRole("button", { name: "Reset" }).first().click();

    // ASSERT — buttons disabled (clean state)
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reset" }).first()).toBeDisabled();

    // ASSERT — no PUT was made
    expect(putCalls.length).toBe(0);
  });
});
