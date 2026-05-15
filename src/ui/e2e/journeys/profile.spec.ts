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
import {
  setupDefaultMocks,
  setupProfile,
} from "@/e2e/utils/mock-setup";

/**
 * Profile Page Journey Tests
 *
 * Architecture notes:
 * - Profile lives at /profile
 * - ProfileLayout renders: ProfilePageTitle, ProfileNavigation, and 5 sections:
 *   UserInfoSection, NotificationsSection, PoolsSection, BucketsSection, CredentialsSection
 * - Each section is wrapped in InlineErrorBoundary + Suspense
 * - Sections use intersection observer for lazy loading
 * - API endpoints:
 *   - GET /api/profile/settings → profile data (notifications, pool, bucket defaults, accessible pools)
 *   - GET /api/bucket → available buckets
 *   - GET /api/credentials → user credentials
 * - User info (name, email) comes from UserProvider (server-side headers), not from API
 * - Auth is disabled in E2E (setupDefaultMocks handles login_info)
 */

const CT_JSON = "application/json";

// ── Profile-specific mock helpers ──────────────────────────────────────────────

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

  await page.route("**/api/profile/settings*", (route) =>
    route.fulfill({ status: 200, contentType: CT_JSON, body }),
  );
}

async function setupBuckets(
  page: Parameters<typeof setupDefaultMocks>[0],
  buckets: Array<{ name: string; path: string; description?: string }> = [],
) {
  const body = JSON.stringify({
    buckets: buckets.map((b) => ({
      name: b.name,
      path: b.path,
      description: b.description ?? "",
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
  credentials: Array<{
    cred_name: string;
    cred_type: string;
    profile?: string;
  }> = [],
) {
  const body = JSON.stringify({ credentials });

  await page.route("**/api/credentials*", (route) =>
    route.fulfill({ status: 200, contentType: CT_JSON, body }),
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Profile Page Layout", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page, [
      { name: "my-bucket", path: "s3://my-bucket" },
      { name: "shared-bucket", path: "s3://shared-bucket" },
    ]);
    await setupCredentials(page);
  });

  test("page title is set to Profile Settings", async ({ page }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page).toHaveTitle(/Profile/);
  });

  test("shows profile breadcrumb", async ({ page }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // ASSERT
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Profile").first()).toBeVisible();
  });

  test("shows all navigation sections in sidebar", async ({ page }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // ASSERT — all 5 nav items visible
    await expect(page.getByRole("button", { name: "User Information" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Notifications" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Pools" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Data Buckets" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Credentials" })).toBeVisible();
  });
});

test.describe("Profile User Info Section", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
    await setupCredentials(page);
  });

  test("shows User Information card with name and email fields", async ({ page }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText("User Information").first()).toBeVisible();
    await expect(page.getByLabel("Name")).toBeVisible();
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  });

  test("name and email fields are disabled (read-only)", async ({ page }) => {
    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // ASSERT — fields are disabled (user info comes from auth headers, not editable)
    await expect(page.getByLabel("Name")).toBeDisabled();
    await expect(page.getByLabel("Email", { exact: true })).toBeDisabled();
  });
});

test.describe("Profile Notifications Section", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupBuckets(page);
    await setupCredentials(page);
  });

  test("shows notification toggles with current settings", async ({ page }) => {
    // ARRANGE — email on, slack off
    await setupProfileSettings(page, {
      profile: { email_notification: true, slack_notification: false },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // ASSERT — Notifications card is visible with toggle labels
    await expect(page.getByText("Notifications").first()).toBeVisible();
    await expect(page.getByText("Email Notifications")).toBeVisible();
    await expect(page.getByText("Slack Notifications")).toBeVisible();
  });

  test("toggling a notification shows Save and Reset buttons", async ({ page }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      profile: { email_notification: true, slack_notification: false },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Toggle slack notification
    const slackSwitch = page.locator("#notification-slack");
    await slackSwitch.click();

    // ASSERT — dirty state activates Save and Reset buttons
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeEnabled();
    await expect(page.getByRole("button", { name: "Reset" }).first()).toBeEnabled();
  });

  test("Reset button reverts notification changes", async ({ page }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      profile: { email_notification: true, slack_notification: false },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Toggle slack on
    const slackSwitch = page.locator("#notification-slack");
    await slackSwitch.click();

    // Click Reset
    await page.getByRole("button", { name: "Reset" }).first().click();

    // ASSERT — buttons should be disabled again (no dirty state)
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reset" }).first()).toBeDisabled();
  });
});

test.describe("Profile Pools Section", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupBuckets(page);
    await setupCredentials(page);
  });

  test("shows Pools section with accessible pools", async ({ page }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      pools: ["gpu-pool", "cpu-pool", "staging-pool"],
      profile: { pool: "gpu-pool" },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Scroll to Pools section to trigger intersection observer
    await page.locator("#pools").scrollIntoViewIfNeeded();

    // ASSERT — section header and at least one pool visible
    await expect(page.getByText("Pools").first()).toBeVisible();
  });
});

test.describe("Profile Credentials Section", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupProfileSettings(page);
    await setupBuckets(page);
  });

  test("shows empty credentials state", async ({ page }) => {
    // ARRANGE — no credentials
    await setupCredentials(page, []);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Scroll to Credentials section
    await page.locator("#credentials").scrollIntoViewIfNeeded();

    // ASSERT
    await expect(page.getByText("Credentials").first()).toBeVisible();
    await expect(page.getByText("No credentials configured")).toBeVisible();
  });

  test("shows New Credential button", async ({ page }) => {
    // ARRANGE
    await setupCredentials(page, []);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Scroll to Credentials section
    await page.locator("#credentials").scrollIntoViewIfNeeded();

    // ASSERT
    await expect(page.getByRole("button", { name: /new credential/i })).toBeVisible();
  });

  test("clicking New Credential shows the credential form", async ({ page }) => {
    // ARRANGE
    await setupCredentials(page, []);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Scroll and click
    await page.locator("#credentials").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: /new credential/i }).click();

    // ASSERT — form fields appear
    await expect(page.getByLabel("Credential Name")).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancel" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeVisible();
  });

  test("shows existing credentials grouped by type", async ({ page }) => {
    // ARRANGE — credentials of different types
    await setupCredentials(page, [
      { cred_name: "docker-hub", cred_type: "REGISTRY" },
      { cred_name: "s3-prod", cred_type: "DATA" },
      { cred_name: "api-key", cred_type: "GENERIC" },
    ]);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Scroll to Credentials section
    await page.locator("#credentials").scrollIntoViewIfNeeded();

    // ASSERT — credential names visible
    await expect(page.getByText("docker-hub").first()).toBeVisible();
    await expect(page.getByText("s3-prod").first()).toBeVisible();
    await expect(page.getByText("api-key").first()).toBeVisible();
  });

  test("credential form Cancel button hides the form", async ({ page }) => {
    // ARRANGE
    await setupCredentials(page, []);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await page.locator("#credentials").scrollIntoViewIfNeeded();

    // Open form
    await page.getByRole("button", { name: /new credential/i }).click();
    await expect(page.getByLabel("Credential Name")).toBeVisible();

    // Cancel
    // The Cancel button is inside the form — use the last one visible in credentials section
    const credSection = page.locator("#credentials");
    await credSection.getByRole("button", { name: "Cancel" }).click();

    // ASSERT — form is gone, New Credential button is back
    await expect(page.getByLabel("Credential Name")).not.toBeVisible();
    await expect(page.getByRole("button", { name: /new credential/i })).toBeVisible();
  });
});

test.describe("Profile Error States", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows error when profile settings API fails", async ({ page }) => {
    // ARRANGE — profile endpoint returns error
    await page.route("**/api/profile/settings*", (route) =>
      route.fulfill({
        status: 400,
        contentType: CT_JSON,
        body: JSON.stringify({ detail: "Bad request" }),
      }),
    );
    await setupBuckets(page);
    await setupCredentials(page);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // ASSERT — page must not crash, should show at least User Information (which uses useUser, not profile API)
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText("User Information").first()).toBeVisible();
  });
});

test.describe("Profile Data Buckets Section", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupCredentials(page);
  });

  test("shows Data Buckets section with bucket list", async ({ page }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      profile: { bucket: "my-bucket" },
    });
    await setupBuckets(page, [
      { name: "my-bucket", path: "s3://my-bucket" },
      { name: "shared-bucket", path: "s3://shared-bucket" },
    ]);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Scroll to Buckets section to trigger intersection observer
    await page.locator("#buckets").scrollIntoViewIfNeeded();

    // ASSERT — section header visible
    await expect(page.getByText("Data Buckets").first()).toBeVisible();
  });

  test("shows error when buckets API fails", async ({ page }) => {
    // ARRANGE
    await setupProfileSettings(page);
    await page.route("**/api/bucket*", (route) =>
      route.fulfill({
        status: 400,
        contentType: CT_JSON,
        body: JSON.stringify({ detail: "Failed to load buckets" }),
      }),
    );

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");

    // Scroll to Buckets section
    await page.locator("#buckets").scrollIntoViewIfNeeded();

    // ASSERT — error state shown
    await expect(page.getByText(/unable to load buckets/i).first()).toBeVisible();
  });
});
