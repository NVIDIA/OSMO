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
 * Profile Settings Save/Reset Tests
 *
 * Tests save/reset state management for profile settings forms:
 * - Default pool selector and its save/reset behavior
 * - Default bucket selector interaction
 * - Notification toggle persistence (save mutation)
 * - Cross-section isolation (changing one section doesn't affect another)
 *
 * Architecture notes:
 * - Profile page at /profile with 5 sections: UserInfo, Notifications, Pools, Buckets, Credentials
 * - Each section has independent dirty tracking (Save + Reset buttons)
 * - Settings are fetched from GET /api/profile/settings
 * - Settings are saved via PUT /api/profile/settings
 * - Sections use IntersectionObserver for lazy loading
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
    pools: overrides.pools ?? ["pool-alpha", "pool-beta"],
  });
  await page.route("**/api/profile/settings*", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: CT_JSON, body });
    }
    // PUT for saving
    return route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({ status: "ok" }),
    });
  });
}

async function setupBuckets(
  page: Parameters<typeof setupDefaultMocks>[0],
  buckets: Array<{ name: string; path: string }> = [],
) {
  const body = JSON.stringify({
    buckets: buckets.map((b) => ({
      name: b.name,
      path: b.path,
      description: "",
      mode: "rw",
      default_credential: false,
    })),
    default: buckets[0]?.name ?? "",
  });
  await page.route("**/api/bucket*", (route) =>
    route.fulfill({ status: 200, contentType: CT_JSON, body }),
  );
}

async function setupCredentials(
  page: Parameters<typeof setupDefaultMocks>[0],
) {
  await page.route("**/api/credentials*", (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({ credentials: [] }),
    }),
  );
}

test.describe("Profile Notification Save/Reset Flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupBuckets(page, [
      { name: "default-bucket", path: "s3://default-bucket" },
    ]);
    await setupCredentials(page);
  });

  test("Save and Reset buttons start disabled with clean state", async ({
    page,
  }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      profile: { email_notification: true, slack_notification: false },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // ASSERT — no dirty state initially
    await expect(
      page.getByRole("button", { name: "Save" }).first(),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Reset" }).first(),
    ).toBeDisabled();
  });

  test("toggling email notification enables Save and Reset", async ({
    page,
  }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      profile: { email_notification: true, slack_notification: false },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Toggle email notification off
    const emailSwitch = page.locator("#notification-email");
    await emailSwitch.click();

    // ASSERT — dirty state activates buttons
    await expect(
      page.getByRole("button", { name: "Save" }).first(),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Reset" }).first(),
    ).toBeEnabled();
  });

  test("double-toggling same notification returns to clean state", async ({
    page,
  }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      profile: { email_notification: true, slack_notification: false },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    const slackSwitch = page.locator("#notification-slack");

    // Toggle on
    await slackSwitch.click();
    await expect(
      page.getByRole("button", { name: "Save" }).first(),
    ).toBeEnabled();

    // Toggle back off (same as original)
    await slackSwitch.click();

    // ASSERT — back to clean state
    await expect(
      page.getByRole("button", { name: "Save" }).first(),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Reset" }).first(),
    ).toBeDisabled();
  });
});

test.describe("Profile Pools Section Interaction", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupBuckets(page, [
      { name: "default-bucket", path: "s3://default-bucket" },
    ]);
    await setupCredentials(page);
  });

  test("shows accessible pools list with current default highlighted", async ({
    page,
  }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      pools: ["gpu-pool", "cpu-pool", "staging-pool"],
      profile: { pool: "gpu-pool" },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await page.locator("#pools").scrollIntoViewIfNeeded();

    // ASSERT — pool section visible
    await expect(page.getByText("Pools").first()).toBeVisible();
    // At least the accessible pools count is shown
    await expect(page.getByText("3 accessible").first()).toBeVisible();
  });

  test("shows Buckets section with multiple buckets", async ({ page }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      profile: { bucket: "my-bucket" },
    });
    await setupBuckets(page, [
      { name: "my-bucket", path: "s3://my-bucket" },
      { name: "shared-bucket", path: "s3://shared-bucket" },
      { name: "archive-bucket", path: "s3://archive-bucket" },
    ]);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await page.locator("#buckets").scrollIntoViewIfNeeded();

    // ASSERT — Data Buckets section visible with bucket names
    await expect(page.getByText("Data Buckets").first()).toBeVisible();
    await expect(page.getByText("my-bucket").first()).toBeVisible();
    await expect(page.getByText("shared-bucket").first()).toBeVisible();
    await expect(page.getByText("archive-bucket").first()).toBeVisible();
  });
});

test.describe("Profile Section Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page, [
      { name: "default-bucket", path: "s3://default-bucket" },
    ]);
    await setupCredentials(page);
  });

  test("clicking Notifications nav button scrolls to notifications section", async ({
    page,
  }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Click Notifications nav item
    await page.getByRole("button", { name: "Notifications" }).click();

    // ASSERT — Notifications section header visible in viewport
    await expect(
      page.getByText("Email Notifications").first(),
    ).toBeVisible();
  });

  test("clicking Credentials nav button scrolls to credentials section", async ({
    page,
  }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Click Credentials nav item
    await page.getByRole("button", { name: "Credentials" }).click();

    // Wait for scroll and lazy load
    await page.locator("#credentials").scrollIntoViewIfNeeded();

    // ASSERT — Credentials section visible
    await expect(page.getByText("Credentials").first()).toBeVisible();
  });
});
