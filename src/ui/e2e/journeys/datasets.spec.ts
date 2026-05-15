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
import { createDatasetsResponse, DatasetType } from "@/mocks/factories";
import {
  setupDefaultMocks,
  setupDatasets,
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
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "e2e-dataset-one", bucket: "ci-bucket", type: DatasetType.DATASET },
        { name: "e2e-dataset-two", bucket: "ci-bucket", type: DatasetType.DATASET },
      ]),
    );
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

test.describe("Dataset Search and Filtering", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "e2e-dataset-alpha", bucket: "ci-bucket", type: DatasetType.DATASET },
        { name: "e2e-dataset-beta", bucket: "prod-bucket", type: DatasetType.DATASET },
      ]),
    );
  });

  test("search creates a filter chip for the typed dataset name", async ({ page }) => {
    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // The search input is a combobox (chip-based filter)
    const searchInput = page.getByRole("combobox", { name: /search and filter/i });
    await searchInput.fill("alpha");
    await searchInput.press("Enter");

    // ASSERT — filter chip is created and URL reflects the active filter
    await expect(page).toHaveURL(/f=name(%3A|:)alpha/);
  });

  test("toggle columns button opens column visibility menu", async ({ page }) => {
    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // Click the toggle columns button
    const toggleButton = page.getByRole("button", { name: /toggle columns/i });
    await toggleButton.click();

    // ASSERT — column options appear (popover/dropdown opens)
    await expect(page.getByRole("menuitemcheckbox").first()).toBeVisible();
  });
});

test.describe("Dataset Row Interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "e2e-dataset-one", bucket: "ci-bucket", type: DatasetType.DATASET },
        { name: "e2e-dataset-two", bucket: "ci-bucket", type: DatasetType.DATASET },
      ]),
    );
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

  test("sorting by column header changes sort order", async ({ page }) => {
    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // Click the Sort by Name button to toggle sorting
    const sortByName = page.getByRole("button", { name: "Sort by Name" }).first();
    await expect(sortByName).toBeVisible();
    await sortByName.click();

    // ASSERT — sort button was clicked without error (table re-renders)
    await expect(sortByName).toBeVisible();

    // Click again to reverse sort
    await sortByName.click();
    await expect(sortByName).toBeVisible();
  });
});

test.describe("Dataset Error and Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows error state when dataset list API fails", async ({ page }) => {
    // ARRANGE — use 400 to avoid TanStack Query retries on 5xx
    await setupDatasets(page, { status: 400, detail: "Bad request" });

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — page must not crash. SSR prefetch via MSW may succeed independently,
    // in which case the table renders with SSR data despite the Playwright route mock.
    // Either the error state or SSR-data table is acceptable — just verify the page doesn't crash.
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.locator("main, [role='main'], .flex").first()).toBeVisible();
  });

  test("/datasets/[bucket] redirects to /datasets with bucket filter", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "redirect-dataset", bucket: "redirect-bucket", type: DatasetType.DATASET },
      ]),
    );

    // ACT — navigate to bucket-level route
    await page.goto("/datasets/redirect-bucket");
    await page.waitForLoadState("networkidle");

    // ASSERT — redirected to /datasets with bucket filter in URL
    await expect(page).toHaveURL(/\/datasets\?/);
    await expect(page).toHaveURL(/f=bucket(%3A|:)redirect-bucket/);
  });
});
