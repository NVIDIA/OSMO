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
 * Log Viewer Recent Workflows Tests
 *
 * Tests the "Recent Workflows" feature on the log viewer workflow selector page.
 * Recent workflows are stored in localStorage and displayed below the search input.
 *
 * Architecture notes:
 * - WorkflowSelector component reads from localStorage key "osmo:recent-workflows"
 * - Submitting a workflow ID adds it to recent workflows list
 * - Each recent workflow entry has a select button and a remove (X) button
 * - "Clear" button removes all recent workflows
 * - Recent list shows max 10 items
 */

test.describe("Log Viewer Recent Workflows", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows recent workflows section when localStorage has entries", async ({ page }) => {
    // ARRANGE — seed localStorage with recent workflows before navigating
    await page.goto("/log-viewer");
    await page.evaluate(() => {
      localStorage.setItem(
        "osmo:recent-workflows",
        JSON.stringify(["workflow-alpha", "workflow-beta", "workflow-gamma"]),
      );
    });

    // ACT — reload to pick up localStorage
    await page.reload();
    await page.waitForLoadState("networkidle");

    // ASSERT — Recent Workflows section visible with entries
    await expect(page.getByText("Recent Workflows").first()).toBeVisible();
    await expect(page.getByText("workflow-alpha").first()).toBeVisible();
    await expect(page.getByText("workflow-beta").first()).toBeVisible();
    await expect(page.getByText("workflow-gamma").first()).toBeVisible();
  });

  test("does not show recent workflows section when localStorage is empty", async ({ page }) => {
    // ARRANGE — ensure no recent workflows
    await page.goto("/log-viewer");
    await page.evaluate(() => {
      localStorage.removeItem("osmo:recent-workflows");
    });

    // ACT
    await page.reload();
    await page.waitForLoadState("networkidle");

    // ASSERT — no Recent Workflows heading
    await expect(page.getByText("Recent Workflows")).not.toBeVisible();
  });

  test("clear button removes all recent workflows", async ({ page }) => {
    // ARRANGE
    await page.goto("/log-viewer");
    await page.evaluate(() => {
      localStorage.setItem(
        "osmo:recent-workflows",
        JSON.stringify(["wf-1", "wf-2"]),
      );
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Verify recent section is visible first
    await expect(page.getByText("Recent Workflows").first()).toBeVisible();

    // ACT — click clear button
    await page.getByRole("button", { name: /clear recent workflows/i }).click();

    // ASSERT — recent section disappears
    await expect(page.getByText("Recent Workflows")).not.toBeVisible();
  });

  test("clicking a recent workflow navigates to log viewer with that workflow", async ({ page }) => {
    // ARRANGE
    await page.goto("/log-viewer");
    await page.evaluate(() => {
      localStorage.setItem(
        "osmo:recent-workflows",
        JSON.stringify(["my-recent-workflow"]),
      );
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // ACT — click the recent workflow entry
    await page.getByText("my-recent-workflow").first().click();

    // ASSERT — navigates to log-viewer with workflow param
    await expect(page).toHaveURL(/workflow=my-recent-workflow/);
  });

  test("remove button removes individual recent workflow", async ({ page }) => {
    // ARRANGE
    await page.goto("/log-viewer");
    await page.evaluate(() => {
      localStorage.setItem(
        "osmo:recent-workflows",
        JSON.stringify(["keep-this", "remove-this"]),
      );
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Verify both are visible
    await expect(page.getByText("keep-this").first()).toBeVisible();
    await expect(page.getByText("remove-this").first()).toBeVisible();

    // ACT — hover over "remove-this" to make remove button visible, then click it
    const removeThisEntry = page.getByText("remove-this").first();
    await removeThisEntry.hover();
    await page
      .getByRole("button", { name: /remove remove-this from recent workflows/i })
      .click();

    // ASSERT — "remove-this" is gone, "keep-this" remains
    await expect(page.getByText("remove-this")).not.toBeVisible();
    await expect(page.getByText("keep-this").first()).toBeVisible();
  });

  test("submitting a workflow adds it to recent workflows on next visit", async ({ page }) => {
    // ARRANGE — start with empty recent
    await page.goto("/log-viewer");
    await page.evaluate(() => {
      localStorage.removeItem("osmo:recent-workflows");
    });
    await page.reload();
    await page.waitForLoadState("networkidle");

    // ACT — submit a workflow ID
    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("new-submitted-workflow");
    await input.press("Enter");

    // Wait for navigation to complete
    await expect(page).toHaveURL(/workflow=new-submitted-workflow/);

    // Navigate back to selector
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // ASSERT — the submitted workflow should now appear in recent list
    await expect(page.getByText("Recent Workflows").first()).toBeVisible();
    await expect(page.getByText("new-submitted-workflow").first()).toBeVisible();
  });
});
