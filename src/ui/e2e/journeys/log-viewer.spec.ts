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
 * Log Viewer Page Journey Tests
 *
 * Architecture notes:
 * - Log viewer lives at /log-viewer
 * - Without ?workflow= param, shows WorkflowSelector component
 * - WorkflowSelector has: heading, search input, submit button, recent workflows
 * - With ?workflow=X, shows LogViewerWithData (streaming SSR)
 * - WorkflowSelector uses client-side navigation (router.push)
 * - Recent workflows are stored in localStorage
 */

test.describe("Log Viewer Selector", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows workflow selector when no workflow param is provided", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // ASSERT — heading and input field are visible
    await expect(page.getByRole("heading", { name: "Log Viewer" })).toBeVisible();
    await expect(page.getByText(/enter a workflow id/i).first()).toBeVisible();
  });

  test("shows workflow input field with placeholder", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // ASSERT — input with placeholder is visible
    const input = page.getByPlaceholder(/enter workflow id/i);
    await expect(input).toBeVisible();
  });

  test("submit button is disabled when input is empty", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // ASSERT — submit button is disabled with empty input
    const submitButton = page.getByRole("button", { name: /load workflow/i });
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toBeDisabled();
  });

  test("submit button becomes enabled when input has text", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // Type a workflow name
    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("my-workflow");

    // ASSERT — submit button is now enabled
    const submitButton = page.getByRole("button", { name: /load workflow/i });
    await expect(submitButton).toBeEnabled();
  });

  test("clear button appears when input has text", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // Type a workflow name
    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("my-workflow");

    // ASSERT — clear button is visible
    const clearButton = page.getByRole("button", { name: /clear input/i });
    await expect(clearButton).toBeVisible();
  });

  test("clear button clears the input", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // Type a workflow name
    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("my-workflow");

    // Click clear
    const clearButton = page.getByRole("button", { name: /clear input/i });
    await clearButton.click();

    // ASSERT — input is now empty
    await expect(input).toHaveValue("");
  });

  test("submitting navigates to log-viewer with workflow param", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // Type and submit
    const input = page.getByPlaceholder(/enter workflow id/i);
    await input.fill("test-workflow-123");
    await input.press("Enter");

    // ASSERT — URL updates to include workflow param
    await expect(page).toHaveURL(/workflow=test-workflow-123/);
  });

  test("breadcrumb shows Log Viewer", async ({ page }) => {
    // ACT
    await page.goto("/log-viewer");
    await page.waitForLoadState("networkidle");

    // ASSERT
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Log Viewer").first()).toBeVisible();
  });
});
