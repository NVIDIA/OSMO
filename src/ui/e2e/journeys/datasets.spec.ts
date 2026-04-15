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
 * Datasets Page Journey Tests
 *
 * Architecture notes:
 * - Datasets list lives at /datasets
 * - Uses Streaming SSR: DatasetsPageSkeleton → DatasetsWithData → DatasetsPageContent
 * - SSR prefetch uses MSW handlers, not Playwright route mocks
 * - Table shows: Name, Type, Bucket, Version, Size, Created, Updated
 * - Clicking a row navigates to /datasets/{bucket}/{name} (detail page)
 * - Default filter: user scoped (shows only current user's datasets)
 * - ?all=true: opts out of user scoping, shows all users' datasets
 * - Toolbar has search, auto-refresh, column visibility controls
 * - Uses fetch-all + client-side shim (count: 10_000)
 * - API endpoint: GET /api/bucket/list_dataset
 *
 * NOTE: Because datasets uses SSR streaming with server prefetch via MSW,
 * the table data comes from MSW handlers (not Playwright route mocks).
 * Tests verify table structure, interactions, and navigation rather than
 * specific mock data values.
 */

test.describe("Datasets List", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("renders datasets table with column headers", async ({ page }) => {
    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — table renders with expected column headers
    await expect(page.getByRole("button", { name: "Sort by Name" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sort by Type" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sort by Bucket" }).first()).toBeVisible();
  });

  test("renders dataset rows from server data", async ({ page }) => {
    // ACT — navigate with all=true to see all users' datasets
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — at least one dataset row is visible in the grid
    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible();
    const rows = grid.getByRole("row");
    // First row is header, so at least 2 rows means we have data
    await expect(rows.nth(1)).toBeVisible();
  });

  test("shows results count", async ({ page }) => {
    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — results count is displayed (e.g., "120 results")
    await expect(page.getByText(/\d+ results/).first()).toBeVisible();
  });

  test("page title is set to Datasets", async ({ page }) => {
    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page).toHaveTitle(/Datasets/);
  });

  test("shows breadcrumb with Datasets", async ({ page }) => {
    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Datasets").first()).toBeVisible();
  });

  test("has toolbar with search and column controls", async ({ page }) => {
    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — toolbar controls are present
    await expect(page.getByRole("combobox", { name: /search and filter/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /toggle columns/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /refresh/i })).toBeVisible();
  });
});

test.describe("Dataset Row Interaction", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("clicking a dataset row navigates to its detail page", async ({ page }) => {
    // ACT — navigate and wait for data
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // Find the first "Open details for" button (each row has one)
    const firstDetailsButton = page.getByRole("button", { name: /open details for/i }).first();
    await expect(firstDetailsButton).toBeVisible();

    // Get the dataset name from the button's aria label
    const buttonName = await firstDetailsButton.getAttribute("aria-label");
    const datasetName = buttonName?.replace("Open details for ", "") ?? "";

    // Click the row (click the cell, not the button, to test row navigation)
    const grid = page.getByRole("grid");
    const firstDataRow = grid.getByRole("row").nth(1);
    await firstDataRow.click();

    // ASSERT — navigates to dataset detail page
    await expect(page).toHaveURL(new RegExp(`/datasets/[^/]+/${encodeURIComponent(datasetName)}`));
  });
});
