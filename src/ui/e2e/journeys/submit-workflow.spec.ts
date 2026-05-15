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
import { createPoolResponse, PoolStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupPools, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Submit Workflow Overlay Journey Tests
 *
 * Architecture notes:
 * - Submit Workflow button lives in the Header (aria-label="Submit workflow")
 * - Opens a full-page overlay (role="dialog", aria-label="Submit workflow")
 * - Phase 1: SourcePicker — "Drag & drop or click to upload" and "Start with blank editor"
 * - Phase 2: Form view — YAML editor (CodeMirror), config panel (pool, priority)
 * - Close button (aria-label="Close submit workflow") or Escape key to dismiss
 * - Store: useSubmitWorkflowStore manages isOpen state
 * - Overlay uses 4-phase CSS transition: closed → opening → open → closing → closed
 * - API: POST /api/pool/{pool}/workflow for submission
 */

test.describe("Submit Workflow Source Picker", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("Submit Workflow button is visible in header", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — button is present in the header
    await expect(page.getByRole("button", { name: "Submit workflow" })).toBeVisible();
  });

  test("clicking Submit Workflow opens the overlay with source picker", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Submit workflow" }).click();

    // ASSERT — overlay dialog opens
    const overlay = page.getByRole("dialog", { name: "Submit workflow" });
    await expect(overlay).toBeVisible();

    // Source picker content is visible
    await expect(overlay.getByText("Submit Workflow").first()).toBeVisible();
    await expect(overlay.getByText(/drag.*drop|click to upload/i)).toBeVisible();
    await expect(overlay.getByText("Start with blank editor")).toBeVisible();
  });

  test("close button dismisses the overlay", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Open overlay
    await page.getByRole("button", { name: "Submit workflow" }).click();
    const overlay = page.getByRole("dialog", { name: "Submit workflow" });
    await expect(overlay).toBeVisible();

    // Close it
    await page.getByRole("button", { name: "Close submit workflow" }).click();

    // ASSERT — overlay is dismissed
    await expect(overlay).toBeHidden();
  });

  test("'Start with blank editor' opens the YAML editor form", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Open overlay
    await page.getByRole("button", { name: "Submit workflow" }).click();
    const overlay = page.getByRole("dialog", { name: "Submit workflow" });
    await expect(overlay).toBeVisible();

    // Click blank editor button
    await overlay.getByText("Start with blank editor").click();

    // ASSERT — form view appears with resizer and close button
    await expect(overlay.getByRole("separator", { name: /drag to resize/i })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Close submit workflow" })).toBeVisible();
  });

  test("file upload zone accepts only YAML files", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Submit workflow" }).click();
    const overlay = page.getByRole("dialog", { name: "Submit workflow" });
    await expect(overlay).toBeVisible();

    // ASSERT — file input accepts .yaml and .yml
    const fileInput = overlay.locator('input[type="file"]');
    await expect(fileInput).toHaveAttribute("accept", ".yaml,.yml");
  });
});

test.describe("Submit Workflow Form View", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("form view shows pool selector and priority picker", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Open overlay and select blank editor
    await page.getByRole("button", { name: "Submit workflow" }).click();
    const overlay = page.getByRole("dialog", { name: "Submit workflow" });
    await expect(overlay).toBeVisible();
    await overlay.getByText("Start with blank editor").click();

    // ASSERT — pool and priority fields are visible in the config panel
    await expect(overlay.getByText(/pool/i).first()).toBeVisible();
    await expect(overlay.getByText(/priority/i).first()).toBeVisible();
  });

  test("form view shows Submit button", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Open overlay and select blank editor
    await page.getByRole("button", { name: "Submit workflow" }).click();
    const overlay = page.getByRole("dialog", { name: "Submit workflow" });
    await expect(overlay).toBeVisible();
    await overlay.getByText("Start with blank editor").click();

    // ASSERT — Submit button is visible
    await expect(overlay.getByRole("button", { name: /submit/i }).first()).toBeVisible();
  });

  test("reopening overlay resets to source picker", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Open overlay and go to form view
    await page.getByRole("button", { name: "Submit workflow" }).click();
    const overlay = page.getByRole("dialog", { name: "Submit workflow" });
    await overlay.getByText("Start with blank editor").click();
    // Verify we're in form view
    await expect(overlay.getByRole("separator", { name: /drag to resize/i })).toBeVisible();

    // Close
    await page.getByRole("button", { name: "Close submit workflow" }).click();
    await expect(overlay).toBeHidden();

    // Reopen
    await page.getByRole("button", { name: "Submit workflow" }).click();
    await expect(overlay).toBeVisible();

    // ASSERT — back to source picker, not the form
    await expect(overlay.getByText("Start with blank editor")).toBeVisible();
  });
});
