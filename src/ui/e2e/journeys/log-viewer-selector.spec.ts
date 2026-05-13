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
 * Log Viewer Workflow Selector Input Tests
 *
 * Tests the workflow selector form on the log-viewer landing page:
 * - Submit button disabled when input is empty
 * - Submit button enabled when input has text
 * - Clear button appears when text is entered
 * - Pressing Enter submits and navigates
 * - Clicking submit button navigates
 *
 * Architecture notes:
 * - WorkflowSelector component at /log-viewer (no ?workflow= param)
 * - Form with input (placeholder "Enter workflow ID or name...")
 * - Submit button (aria-label "Load workflow") — disabled when empty
 * - Clear button (aria-label "Clear input") — only visible when input non-empty
 * - On submit: navigates to /log-viewer?workflow={trimmedValue}
 */

test.describe("Log Viewer Workflow Selector Input", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("submit button is disabled when input is empty", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // ASSERT — Load workflow button is disabled
    const submitButton = page.getByRole("button", { name: /load workflow/i });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeDisabled();
  });

  test("submit button becomes enabled when text is entered", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("my-workflow");

    // ASSERT — submit button is enabled
    const submitButton = page.getByRole("button", { name: /load workflow/i });
    await expect(submitButton).toBeEnabled();
  });

  test("clear button appears when input has text and clears on click", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // Initially no clear button
    await expect(page.getByRole("button", { name: /clear input/i })).not.toBeVisible();

    // Type in input
    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("some-text");

    // Clear button appears
    const clearButton = page.getByRole("button", { name: /clear input/i });
    await expect(clearButton).toBeVisible();

    // Click clear
    await clearButton.click();

    // ASSERT — input is cleared, clear button disappears, submit disabled
    await expect(input).toHaveValue("");
    await expect(clearButton).not.toBeVisible();
    await expect(page.getByRole("button", { name: /load workflow/i })).toBeDisabled();
  });

  test("pressing Enter submits and navigates to log viewer with workflow param", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("test-wf-123");
    await input.press("Enter");

    // ASSERT — navigates to log-viewer with workflow parameter
    await expect(page).toHaveURL(/workflow=test-wf-123/);
  });

  test("clicking submit button navigates to log viewer with workflow param", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("click-submit-wf");

    await page.getByRole("button", { name: /load workflow/i }).click();

    // ASSERT — navigates with workflow param
    await expect(page).toHaveURL(/workflow=click-submit-wf/);
  });
});
