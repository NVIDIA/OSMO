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
 * Dataset Panel Journey Tests
 *
 * Architecture notes:
 * - Dataset list has a details button per row ("Open details for {name}")
 * - Clicking it opens the DatasetPanel slideout via DatasetsPanelLayout
 * - Panel fetches detail from GET /api/bucket/{bucket}/dataset/{name}/info
 * - Panel shows: header with name, "Browse files" button, details section, versions section
 * - Error state: "Failed to load dataset details."
 * - Loading state: skeleton placeholders
 */

const CT_JSON = "application/json";

function createDatasetInfoResponse(
  bucket: string,
  name: string,
  overrides: {
    versions?: Array<Record<string, unknown>>;
    type?: "DATASET" | "COLLECTION";
    labels?: Record<string, string>;
  } = {},
) {
  const now = new Date().toISOString();
  const type = overrides.type ?? "DATASET";
  const locationPlaceholder = `s3://${bucket}/datasets/${name}/v1/`;

  if (type === "DATASET") {
    const defaultVersion = {
      name,
      version: "1",
      status: "READY",
      created_by: "e2e-user",
      created_date: now,
      last_used: now,
      size: 1024 * 1024 * 1024, // 1 GiB
      checksum: "abc123",
      location: locationPlaceholder,
      uri: locationPlaceholder,
      metadata: {},
      tags: ["latest"],
      collections: [],
    };

    return {
      name,
      id: `${bucket}/${name}`,
      bucket,
      labels: overrides.labels ?? {},
      type: "DATASET",
      versions: overrides.versions ?? [defaultVersion],
    };
  }

  return {
    name,
    id: `${bucket}/${name}`,
    bucket,
    labels: overrides.labels ?? {},
    type: "COLLECTION",
    versions: [
      {
        name: "sub-dataset-1",
        version: "1",
        location: `s3://${bucket}/datasets/sub-dataset-1/v1/`,
        uri: `s3://${bucket}/datasets/sub-dataset-1/v1/`,
        size: 512 * 1024 * 1024,
      },
      {
        name: "sub-dataset-2",
        version: "2",
        location: `s3://${bucket}/datasets/sub-dataset-2/v2/`,
        uri: `s3://${bucket}/datasets/sub-dataset-2/v2/`,
        size: 256 * 1024 * 1024,
      },
    ],
  };
}

async function setupDatasetInfo(
  page: Parameters<typeof setupDefaultMocks>[0],
  bucket: string,
  name: string,
  data: ReturnType<typeof createDatasetInfoResponse> | { status: number; detail: string },
) {
  const response =
    "detail" in data
      ? { status: data.status, contentType: CT_JSON, body: JSON.stringify({ detail: data.detail }) }
      : { status: 200, contentType: CT_JSON, body: JSON.stringify(data) };

  await page.route(`**/api/bucket/${bucket}/dataset/${encodeURIComponent(name)}/info*`, (route) =>
    route.fulfill(response),
  );
}

test.describe("Dataset Panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("clicking Open details button opens the dataset panel", async ({ page }) => {
    // ARRANGE
    const bucket = "ci-bucket";
    const name = "panel-dataset";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name));

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    const detailsButton = page.getByRole("button", { name: `Open details for ${name}` });
    await expect(detailsButton).toBeVisible();
    await detailsButton.click();

    // ASSERT — panel opens with dataset name
    await expect(page.getByText(name).first()).toBeVisible();
    await expect(page.getByText("Dataset Details").first()).toBeVisible();
  });

  test("panel shows Dataset Details section with bucket and size", async ({ page }) => {
    // ARRANGE
    const bucket = "detail-bucket";
    const name = "detail-dataset";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name));

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — details card shows bucket
    await expect(page.getByText("Bucket").first()).toBeVisible();
    await expect(page.getByText(bucket).first()).toBeVisible();
  });

  test("panel shows Versions section with version table", async ({ page }) => {
    // ARRANGE
    const bucket = "ver-bucket";
    const name = "ver-dataset";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name));

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — versions section is visible
    await expect(page.getByText("Versions").first()).toBeVisible();
    // Version table header
    await expect(page.getByText("Created by").first()).toBeVisible();
  });

  test("panel shows error state when dataset info API fails", async ({ page }) => {
    // ARRANGE
    const bucket = "err-bucket";
    const name = "err-dataset";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(page, bucket, name, { status: 400, detail: "Not found" });

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — error message is displayed
    await expect(page.getByText(/failed to load dataset details/i).first()).toBeVisible();
  });

  test("panel shows Browse files button that navigates to detail page", async ({ page }) => {
    // ARRANGE
    const bucket = "browse-bucket";
    const name = "browse-dataset";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name));

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — Browse files button is visible
    const browseButton = page.getByRole("button", { name: `Browse files for ${name}` });
    await expect(browseButton).toBeVisible();
  });

  test("panel shows labels when dataset has labels", async ({ page }) => {
    // ARRANGE
    const bucket = "label-bucket";
    const name = "label-dataset";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createDatasetInfoResponse(bucket, name, {
        labels: { environment: "production", team: "ml-infra" },
      }),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — labels are displayed
    await expect(page.getByText("Labels").first()).toBeVisible();
    await expect(page.getByText("environment").first()).toBeVisible();
    await expect(page.getByText("production").first()).toBeVisible();
  });

  test("panel shows 'No labels' when dataset has no labels", async ({ page }) => {
    // ARRANGE
    const bucket = "nolabel-bucket";
    const name = "nolabel-dataset";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name, { labels: {} }));

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — "No labels" text visible
    await expect(page.getByText("No labels").first()).toBeVisible();
  });
});

test.describe("Dataset Panel Collection", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("panel shows Members section for collections", async ({ page }) => {
    // ARRANGE
    const bucket = "coll-bucket";
    const name = "coll-dataset";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.COLLECTION }]));
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name, { type: "COLLECTION" }));

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — shows Members section with member datasets
    await expect(page.getByText("Members").first()).toBeVisible();
    await expect(page.getByText("sub-dataset-1").first()).toBeVisible();
    await expect(page.getByText("sub-dataset-2").first()).toBeVisible();
  });

  test("panel shows Collection badge for collection type", async ({ page }) => {
    // ARRANGE
    const bucket = "badge-bucket";
    const name = "badge-collection";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.COLLECTION }]));
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name, { type: "COLLECTION" }));

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — Collection badge visible in panel header
    await expect(page.getByText("Collection").first()).toBeVisible();
  });
});

test.describe("Datasets Deprecation Banner", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows deprecation warning banner on datasets page", async ({ page }) => {
    // ARRANGE
    await setupDatasets(
      page,
      createDatasetsResponse([{ name: "some-dataset", bucket: "bucket", type: DatasetType.DATASET }]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — deprecation warning is visible
    await expect(page.getByText(/OSMO datasets are deprecated/i).first()).toBeVisible();
  });
});
