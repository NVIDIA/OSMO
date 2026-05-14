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
 * Dataset Detail Version Picker Tests
 *
 * Tests the VersionPicker component in the dataset detail page:
 * - Version picker renders with current version label
 * - Switching between versions and tags tabs
 * - Selecting a different version
 * - Version picker shows "latest" tag
 *
 * Architecture notes:
 * - Dataset detail at /datasets/{bucket}/{name}
 * - VersionPicker uses Radix Popover + tabs (Versions / Tags)
 * - Data comes entirely from the `versions` prop (no additional API calls)
 * - SSR: dataset info comes from /api/bucket/{bucket}/dataset/{name}/info
 * - Manifest: served by e2e/mock-api-backend.mjs on port 9999
 * - Version picker only visible for datasets with versions (not collections)
 */

const CT_JSON = "application/json";

function createDatasetInfoWithVersions(bucket: string, name: string) {
  const now = new Date().toISOString();
  const location = `s3://${bucket}/datasets/${name}/v3/`;

  return {
    name,
    id: `${bucket}/${name}`,
    bucket,
    labels: {},
    type: "DATASET",
    versions: [
      {
        name,
        version: "3",
        status: DatasetStatus.READY,
        created_by: "e2e-user",
        created_date: now,
        last_used: now,
        size: 1024 * 1024 * 50,
        checksum: "abc333",
        location,
        uri: location,
        metadata: {},
        tags: ["latest", "production"],
        collections: [],
      },
      {
        name,
        version: "2",
        status: DatasetStatus.READY,
        created_by: "e2e-user",
        created_date: now,
        last_used: now,
        size: 1024 * 1024 * 40,
        checksum: "abc222",
        location: `s3://${bucket}/datasets/${name}/v2/`,
        uri: `s3://${bucket}/datasets/${name}/v2/`,
        metadata: {},
        tags: ["staging"],
        collections: [],
      },
      {
        name,
        version: "1",
        status: DatasetStatus.READY,
        created_by: "e2e-user",
        created_date: now,
        last_used: now,
        size: 1024 * 1024 * 30,
        checksum: "abc111",
        location: `s3://${bucket}/datasets/${name}/v1/`,
        uri: `s3://${bucket}/datasets/${name}/v1/`,
        metadata: {},
        tags: [],
        collections: [],
      },
    ],
  };
}

async function setupDatasetInfo(
  page: Parameters<typeof setupDefaultMocks>[0],
  bucket: string,
  name: string,
  data: ReturnType<typeof createDatasetInfoWithVersions>,
) {
  await page.route(`**/api/bucket/${bucket}/dataset/${name}/info*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: CT_JSON,
      body: JSON.stringify(data),
    }),
  );
}

test.describe("Dataset Detail Version Picker", () => {
  test.describe.configure({ timeout: 30_000 });

  const bucket = "my-bucket";
  const datasetName = "my-dataset";

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupDatasetInfo(
      page,
      bucket,
      datasetName,
      createDatasetInfoWithVersions(bucket, datasetName),
    );
  });

  test("shows version picker with latest version label", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — version picker trigger is visible with "v3" (latest)
    const versionButton = page.getByRole("button", { name: /Version:.*Click to change/i });
    await expect(versionButton).toBeVisible({ timeout: 10_000 });
    await expect(versionButton).toContainText("v3");
  });

  test("opening version picker shows versions tab with all versions", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    // Click version picker trigger
    const versionButton = page.getByRole("button", { name: /Version:.*Click to change/i });
    await versionButton.click();

    // ASSERT — popover opens with version list
    await expect(page.getByText("Switch versions / tags")).toBeVisible();

    // Versions tab is active by default
    const versionsTab = page.getByRole("tab", { name: "Versions" });
    await expect(versionsTab).toHaveAttribute("aria-selected", "true");

    // All versions visible in the list
    const versionList = page.getByRole("listbox", { name: "Versions" });
    await expect(versionList.getByText("v3")).toBeVisible();
    await expect(versionList.getByText("v2")).toBeVisible();
    await expect(versionList.getByText("v1")).toBeVisible();
  });

  test("switching to tags tab shows named tags", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    // Open version picker
    const versionButton = page.getByRole("button", { name: /Version:.*Click to change/i });
    await versionButton.click();

    // Click Tags tab
    const tagsTab = page.getByRole("tab", { name: "Tags" });
    await tagsTab.click();

    // ASSERT — tags are shown
    await expect(tagsTab).toHaveAttribute("aria-selected", "true");
    const tagList = page.getByRole("listbox", { name: "Tags" });
    await expect(tagList.getByText("latest")).toBeVisible();
    await expect(tagList.getByText("production")).toBeVisible();
    await expect(tagList.getByText("staging")).toBeVisible();
  });

  test("selecting a different version updates the picker label", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    // Open version picker and select v2
    const versionButton = page.getByRole("button", { name: /Version:.*Click to change/i });
    await versionButton.click();

    const versionList = page.getByRole("listbox", { name: "Versions" });
    await versionList.getByText("v2").click();

    // ASSERT — picker label updates to v2 and URL includes version param
    await expect(versionButton).toContainText("v2");
    await expect(page).toHaveURL(/version=2/);
  });

  test("version picker search filters version list", async ({ page }) => {
    // ACT
    await page.goto(`/datasets/${bucket}/${datasetName}`);
    await page.waitForLoadState("networkidle");

    // Open version picker
    const versionButton = page.getByRole("button", { name: /Version:.*Click to change/i });
    await versionButton.click();

    // Type in search — filter for "v1"
    const searchInput = page.getByPlaceholder("Find a version…");
    await searchInput.fill("v1");

    // ASSERT — only v1 remains visible
    const versionList = page.getByRole("listbox", { name: "Versions" });
    await expect(versionList.getByText("v1")).toBeVisible();
    // v3 and v2 should be hidden
    await expect(versionList.getByText("v3")).not.toBeVisible();
    await expect(versionList.getByText("v2")).not.toBeVisible();
  });
});
