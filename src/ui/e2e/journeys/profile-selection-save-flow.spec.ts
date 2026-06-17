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
 * Profile Pool/Bucket Selection Save Tests
 *
 * Tests the full save flow for the SelectionCard component used in Pools and Buckets sections:
 * - Clicking a non-default pool item enables Save/Reset buttons
 * - Clicking Save sends PUT to API and shows success toast
 * - After successful save, buttons return to disabled state
 * - Reset reverts selection without API call
 * - Bucket section has the same selection/save pattern
 *
 * Architecture notes:
 * - PoolsSection + BucketsSection both use SelectionCard
 * - SelectionCard: click item → editedValue changes → isDirty → Save/Reset enabled
 * - On save: updateProfile(buildUpdate(stagedValue)) → toast.success(...)
 * - buildUpdate for pools: { pool: { default: value } }
 * - buildUpdate for buckets: { bucket: { default: value } }
 * - API: PUT /api/profile/settings with the pool/bucket payload
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
    pools: overrides.pools ?? ["default-pool", "gpu-pool", "cpu-pool"],
  });
  await page.route("**/api/profile/settings*", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ status: 200, contentType: CT_JSON, body });
    }
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
  await page.route("**/api/bucket*", (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify({
        buckets: buckets.map((b) => ({
          name: b.name,
          path: b.path,
          description: "",
          mode: "rw",
          default_credential: false,
        })),
        default: buckets[0]?.name ?? "",
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

test.describe("Profile Pool Selection Save Flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupBuckets(page, [{ name: "default-bucket", path: "s3://default-bucket" }]);
    await setupCredentials(page);
  });

  test("selecting a different pool enables Save/Reset and saving shows success toast", async ({ page }) => {
    // ARRANGE — multiple pools, default is "default-pool"
    const apiCalls: { method: string }[] = [];
    await page.route("**/api/profile/settings*", (route) => {
      apiCalls.push({ method: route.request().method() });
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({
            profile: { email_notification: true, slack_notification: false, bucket: "default-bucket", pool: "default-pool" },
            roles: [],
            pools: ["default-pool", "gpu-pool", "cpu-pool"],
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

    // Scroll to pools section to trigger intersection observer
    await page.locator("#pools").scrollIntoViewIfNeeded();

    // Wait for pool items to load
    await expect(page.getByText("3 accessible").first()).toBeVisible();

    // Find pool section's Save button — should be disabled initially
    const poolsSection = page.locator("#pools");
    await expect(poolsSection.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(poolsSection.getByRole("button", { name: "Reset" })).toBeDisabled();

    // Click a different pool (gpu-pool)
    await poolsSection.getByText("gpu-pool").click();

    // ASSERT — Save/Reset are enabled (dirty state)
    await expect(poolsSection.getByRole("button", { name: "Save" })).toBeEnabled();
    await expect(poolsSection.getByRole("button", { name: "Reset" })).toBeEnabled();

    // ACT — click Save
    await poolsSection.getByRole("button", { name: "Save" }).click();

    // ASSERT — success toast
    await expect(page.getByText(/default pool saved successfully/i).first()).toBeVisible();

    // ASSERT — buttons return to disabled
    await expect(poolsSection.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(poolsSection.getByRole("button", { name: "Reset" })).toBeDisabled();

    // ASSERT — PUT was sent
    const putCalls = apiCalls.filter((c) => c.method === "POST" || c.method === "PUT");
    expect(putCalls.length).toBeGreaterThanOrEqual(1);
  });

  test("Reset button reverts pool selection without calling API", async ({ page }) => {
    // ARRANGE
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
            pools: ["default-pool", "gpu-pool", "cpu-pool"],
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
    await page.locator("#pools").scrollIntoViewIfNeeded();

    await expect(page.getByText("3 accessible").first()).toBeVisible();

    // Select different pool
    const poolsSection = page.locator("#pools");
    await poolsSection.getByText("cpu-pool").click();

    // Verify dirty state
    await expect(poolsSection.getByRole("button", { name: "Save" })).toBeEnabled();

    // Click Reset
    await poolsSection.getByRole("button", { name: "Reset" }).click();

    // ASSERT — buttons disabled (clean state)
    await expect(poolsSection.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(poolsSection.getByRole("button", { name: "Reset" })).toBeDisabled();

    // ASSERT — no PUT was made
    expect(putCalls.length).toBe(0);
  });

  test("clicking the already-selected default pool does not enable Save", async ({ page }) => {
    // ARRANGE
    await setupProfileSettings(page, {
      pools: ["default-pool", "other-pool"],
      profile: { pool: "default-pool" },
    });

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await page.locator("#pools").scrollIntoViewIfNeeded();

    await expect(page.getByText("2 accessible").first()).toBeVisible();

    // Click the default pool (already selected)
    const poolsSection = page.locator("#pools");
    await poolsSection.getByText("default-pool").click();

    // ASSERT — buttons remain disabled (no dirty state)
    await expect(poolsSection.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});

test.describe("Profile Bucket Selection Save Flow", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupCredentials(page);
  });

  test("selecting a different bucket enables Save and saving shows success toast", async ({ page }) => {
    // ARRANGE
    await page.route("**/api/profile/settings*", (route) => {
      if (route.request().method() === "GET") {
        return route.fulfill({
          status: 200,
          contentType: CT_JSON,
          body: JSON.stringify({
            profile: { email_notification: true, slack_notification: false, bucket: "bucket-alpha", pool: "default-pool" },
            roles: [],
            pools: ["default-pool"],
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: CT_JSON,
        body: JSON.stringify({ status: "ok" }),
      });
    });
    await setupBuckets(page, [
      { name: "bucket-alpha", path: "s3://bucket-alpha" },
      { name: "bucket-beta", path: "s3://bucket-beta" },
      { name: "bucket-gamma", path: "s3://bucket-gamma" },
    ]);

    // ACT
    await page.goto("/profile");
    await page.waitForLoadState("networkidle");
    await page.locator("#buckets").scrollIntoViewIfNeeded();

    // Wait for bucket items to load
    await expect(page.getByText("3 accessible").last()).toBeVisible();

    // Find buckets section Save button — disabled initially
    const bucketsSection = page.locator("#buckets");
    await expect(bucketsSection.getByRole("button", { name: "Save" })).toBeDisabled();

    // Click a different bucket
    await bucketsSection.getByText("bucket-beta").click();

    // ASSERT — Save enabled
    await expect(bucketsSection.getByRole("button", { name: "Save" })).toBeEnabled();

    // ACT — save
    await bucketsSection.getByRole("button", { name: "Save" }).click();

    // ASSERT — success toast
    await expect(page.getByText(/default bucket saved successfully/i).first()).toBeVisible();

    // ASSERT — buttons disabled after save
    await expect(bucketsSection.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
