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
import { DatasetStatus } from "@/lib/api/generated";
import { setupDefaultMocks, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Dataset Detail File Browser Navigation Tests
 *
 * Tests the file browser component's navigation behavior:
 * - Folder navigation (clicking a folder row)
 * - Breadcrumb navigation (clicking parent segments)
 * - Details panel toggle
 * - Sorting behavior
 *
 * Architecture notes:
 * - FileBrowserTable renders a DataTable with folder/file rows
 * - Folders are clickable (onNavigate) — updates ?path= URL param
 * - Files are clickable (onSelectFile) — opens preview panel, updates ?file= URL param
 * - Breadcrumb trail shows current path with clickable segments
 * - Manifest data comes from e2e/mock-api-backend.mjs on port 9999
 *   - "data-bucket"/"file-dataset" → GRID fixture: readme.md, data/train.csv, data/test.csv, models/model.pt
 */

const CT_JSON = "application/json";

function createDatasetWithFolders(bucket: string, name: string) {
  const now = new Date().toISOString();
  const location = `s3://${bucket}/datasets/${name}/v1/`;

  return {
    name,
    id: `${bucket}/${name}`,
    bucket,
    labels: {},
    type: "DATASET",
    versions: [
      {
        name,
        version: "1",
        status: DatasetStatus.READY,
        created_by: "e2e-user",
        created_date: now,
        last_used: now,
        size: 100 * 1024 * 1024,
        checksum: "abc123",
        location,
        uri: location,
        metadata: {},
        tags: ["latest"],
        collections: [],
      },
    ],
  };
}

async function setupDatasetInfo(
  page: Parameters<typeof setupDefaultMocks>[0],
  bucket: string,
  name: string,
  data: ReturnType<typeof createDatasetWithFolders>,
) {
  await page.route(`**/api/bucket/${bucket}/dataset/${name}/info*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify(data),
    }),
  );
}

test.describe("Dataset File Browser Navigation", () => {
  test.describe.configure({ timeout: 30_000 });

  // Uses "data-bucket"/"file-dataset" which maps to GRID fixture in mock-api-backend.mjs:
  // readme.md, data/train.csv, data/test.csv, models/model.pt
  const bucket = "data-bucket";
  const datasetName = "file-dataset";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupDatasetInfo(page, bucket, datasetName, createDatasetWithFolders(bucket, datasetName));
  });

  test("file browser shows folders and files at root", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — grid renders with folder and file entries from GRID fixture
    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // Root should show: data/ folder, models/ folder, readme.md file
    await expect(grid.getByText("data").first()).toBeVisible();
    await expect(grid.getByText("models").first()).toBeVisible();
    await expect(grid.getByText("readme.md").first()).toBeVisible();
  });

  test("clicking a folder navigates into it and updates path", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // Click the "data" folder row
    await grid.getByText("data").first().click();

    // ASSERT — URL updates with path param
    await expect(page).toHaveURL(/path=data/);

    // Folder contents visible (train.csv, test.csv)
    await expect(grid.getByText("train.csv").first()).toBeVisible({ timeout: 5_000 });
    await expect(grid.getByText("test.csv").first()).toBeVisible();
  });

  test("breadcrumb shows dataset name at root level", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // ASSERT — dataset name visible in the control strip
    await expect(page.getByText(datasetName).first()).toBeVisible();
  });

  test("navigating into folder and then clicking dataset name returns to root", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}?path=data`);
    await page.waitForLoadState("networkidle");

    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // Click dataset name in breadcrumb to go back to root
    await page.getByRole("button", { name: datasetName }).first().click();

    // ASSERT — back at root with folders visible
    await expect(page).not.toHaveURL(/path=/);
    await expect(grid.getByText("readme.md").first()).toBeVisible({ timeout: 5_000 });
  });

  test("details panel toggle button works", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });

    // Find the details toggle button
    const detailsButton = page.getByRole("button", { name: /show details|hide details/i });
    await expect(detailsButton).toBeVisible();

    // Click to toggle panel visibility — check aria-pressed changes
    const initialPressed = await detailsButton.getAttribute("aria-pressed");
    await detailsButton.click();
    const newPressed = await detailsButton.getAttribute("aria-pressed");

    // ASSERT — aria-pressed toggled
    expect(newPressed).not.toBe(initialPressed);
  });
});
