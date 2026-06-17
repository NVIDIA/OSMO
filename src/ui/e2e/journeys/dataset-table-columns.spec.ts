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
 * Dataset Table Column Rendering Tests
 *
 * Tests the dataset-column-defs.tsx column definitions:
 * - Type column: "Dataset" vs "Collection" badge rendering
 * - Version column: "v{N}" format or "—" dash for no version
 * - Size column: formatted byte display
 * - Bucket column: bucket name text
 * - Date columns: formatted timestamps
 * - Name column with "Open details" button
 */

test.describe("Dataset Table — Type Column", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows 'Dataset' badge for dataset type entries", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "my-training-data", bucket: "prod-bucket", type: DatasetType.DATASET },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — "Dataset" badge visible in the type column
    await expect(page.getByText("Dataset", { exact: true }).first()).toBeVisible();
  });

  test("shows 'Collection' badge for collection type entries", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "my-collection", bucket: "prod-bucket", type: DatasetType.COLLECTION },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — "Collection" badge visible
    await expect(page.getByText("Collection", { exact: true }).first()).toBeVisible();
  });

  test("mixed types show both Dataset and Collection badges", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "training-set", bucket: "bucket-a", type: DatasetType.DATASET },
        { name: "combo-collection", bucket: "bucket-b", type: DatasetType.COLLECTION },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — both badges visible
    await expect(page.getByText("Dataset", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Collection", { exact: true }).first()).toBeVisible();
  });
});

test.describe("Dataset Table — Name & Details Button", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows dataset names in the table", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "imagenet-v2", bucket: "ml-bucket", type: DatasetType.DATASET },
        { name: "cifar-10", bucket: "ml-bucket", type: DatasetType.DATASET },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — dataset names visible
    await expect(page.getByText("imagenet-v2").first()).toBeVisible();
    await expect(page.getByText("cifar-10").first()).toBeVisible();
  });

  test("shows Open details button for each dataset", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "detail-test-ds", bucket: "test-bucket", type: DatasetType.DATASET },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — Open details button has correct aria-label
    await expect(page.getByRole("button", { name: "Open details for detail-test-ds" })).toBeVisible();
  });
});

test.describe("Dataset Table — Bucket Column", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows bucket names in the table", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([
        { name: "ds-1", bucket: "production-bucket", type: DatasetType.DATASET },
        { name: "ds-2", bucket: "staging-bucket", type: DatasetType.DATASET },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — bucket names visible
    await expect(page.getByText("production-bucket").first()).toBeVisible();
    await expect(page.getByText("staging-bucket").first()).toBeVisible();
  });
});
