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
import { setupDefaultMocks, setupDatasets, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Dataset Filter and Search Journey Tests
 *
 * Architecture notes:
 * - Dataset toolbar has search fields: type (DATASET/COLLECTION), name, bucket, user, created_at, updated_at
 * - "type" field is exhaustive with values: DATASET, COLLECTION
 * - "name" and "bucket" are derived from dataset list data
 * - Filter chips are committed to URL: f=type:DATASET, f=bucket:my-bucket, etc.
 * - Column visibility toggle is available via "Toggle columns" button
 * - Sorting is done client-side by clicking column headers
 */

test.describe("Dataset Type Filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("navigating with type filter shows only matching type", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "my-dataset", bucket: "test-bucket", type: DatasetType.DATASET },
        { name: "my-collection", bucket: "test-bucket", type: DatasetType.COLLECTION },
      ]),
    );

    // ACT — navigate with type filter pre-applied
    await page.goto("/datasets?all=true&f=type:DATASET");
    await page.waitForLoadState("networkidle");

    // ASSERT — only DATASET type visible
    await expect(page.getByText("my-dataset").first()).toBeVisible();
    await expect(page.getByText("my-collection")).not.toBeVisible();
  });

  test("navigating with collection type filter shows only collections", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "train-data", bucket: "ml-bucket", type: DatasetType.DATASET },
        { name: "all-datasets", bucket: "ml-bucket", type: DatasetType.COLLECTION },
      ]),
    );

    // ACT — navigate with COLLECTION filter
    await page.goto("/datasets?all=true&f=type:COLLECTION");
    await page.waitForLoadState("networkidle");

    // ASSERT — only COLLECTION type visible
    await expect(page.getByText("all-datasets").first()).toBeVisible();
    await expect(page.getByText("train-data")).not.toBeVisible();
  });
});

test.describe("Dataset Bucket Filter", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("navigating with bucket filter in URL preserves filter chip", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "bucket-a-dataset", bucket: "bucket-alpha", type: DatasetType.DATASET },
        { name: "bucket-b-dataset", bucket: "bucket-beta", type: DatasetType.DATASET },
      ]),
    );

    // ACT — navigate with bucket filter in URL
    await page.goto("/datasets?all=true&f=bucket:bucket-alpha");
    await page.waitForLoadState("networkidle");

    // ASSERT — URL still has bucket filter and page renders without crash
    await expect(page).toHaveURL(/f=bucket(%3A|:)bucket-alpha/);
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("combining bucket and type filter params are preserved in URL", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "prod-data", bucket: "production", type: DatasetType.DATASET },
        { name: "prod-coll", bucket: "production", type: DatasetType.COLLECTION },
      ]),
    );

    // ACT — navigate with both bucket and type filters
    await page.goto("/datasets?all=true&f=bucket:production&f=type:DATASET");
    await page.waitForLoadState("networkidle");

    // ASSERT — both filter params are preserved
    await expect(page).toHaveURL(/f=bucket(%3A|:)production/);
    await expect(page).toHaveURL(/f=type(%3A|:)DATASET/);
  });
});

test.describe("Dataset Search Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("typing a bucket name in search creates bucket filter chip", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "ds-1", bucket: "my-bucket", type: DatasetType.DATASET },
        { name: "ds-2", bucket: "other-bucket", type: DatasetType.DATASET },
      ]),
    );

    // ACT — type bucket: prefix and commit
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByRole("combobox", { name: /search and filter/i });
    await searchInput.fill("bucket:my-bucket");
    await searchInput.press("Enter");

    // ASSERT — URL reflects the bucket filter
    await expect(page).toHaveURL(/f=bucket(%3A|:)my-bucket/);
  });

  test("refresh button is visible and clickable", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([{ name: "refresh-test", bucket: "test-bucket", type: DatasetType.DATASET }]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — refresh button is present and clickable
    const refreshButton = page.getByRole("button", { name: "Refresh", exact: true });
    await expect(refreshButton).toBeVisible();
    await expect(refreshButton).toBeEnabled();
  });

  test("name search creates filter chip in URL", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "dataset-alpha", bucket: "b", type: DatasetType.DATASET },
        { name: "dataset-beta", bucket: "b", type: DatasetType.DATASET },
        { name: "dataset-gamma", bucket: "b", type: DatasetType.DATASET },
      ]),
    );

    // ACT — type name search and commit
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByRole("combobox", { name: /search and filter/i });
    await searchInput.fill("alpha");
    await searchInput.press("Enter");

    // ASSERT — URL has name filter
    await expect(page).toHaveURL(/f=name(%3A|:)alpha/);
  });
});

test.describe("Dataset Column Visibility", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("column visibility menu shows column options", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([{ name: "col-test-ds", bucket: "col-bucket", type: DatasetType.DATASET }]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // Open column visibility menu
    const toggleButton = page.getByRole("button", { name: /toggle columns/i });
    await toggleButton.click();

    // ASSERT — column checkbox options appear
    const columnCheckbox = page.getByRole("menuitemcheckbox").first();
    await expect(columnCheckbox).toBeVisible();
  });
});
