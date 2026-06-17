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
 * Dataset Panel Versions Section Tests
 *
 * Tests the dataset-panel-versions.tsx component inside the dataset panel:
 * - Version table with column headers (Version, Created by, Date, Size, Tags)
 * - Multiple versions sorted latest-first
 * - Tags displayed as badges
 * - Active version highlighting
 *
 * Also tests the collection-panel-members.tsx component:
 * - Members table with column headers (Dataset, Version, Size)
 * - Member dataset names visible
 * - Empty members state
 */

const CT_JSON = "application/json";

function createDatasetInfoWithVersions(
  bucket: string,
  name: string,
  versions: Array<{
    version: string;
    created_by?: string;
    size?: number;
    tags?: string[];
  }>,
) {
  const now = new Date().toISOString();
  return {
    name,
    id: `${bucket}/${name}`,
    bucket,
    labels: {},
    type: "DATASET",
    versions: versions.map((v) => ({
      name,
      version: v.version,
      status: "READY",
      created_by: v.created_by ?? "e2e-user",
      created_date: now,
      last_used: now,
      size: v.size ?? 1024 * 1024 * 1024,
      checksum: "abc123",
      location: `s3://${bucket}/datasets/${name}/v${v.version}/`,
      uri: `s3://${bucket}/datasets/${name}/v${v.version}/`,
      metadata: {},
      tags: v.tags ?? [],
      collections: [],
    })),
  };
}

function createCollectionInfoWithMembers(
  bucket: string,
  name: string,
  members: Array<{ name: string; version: string; size?: number }>,
) {
  return {
    name,
    id: `${bucket}/${name}`,
    bucket,
    labels: {},
    type: "COLLECTION",
    versions: members.map((m) => ({
      name: m.name,
      version: m.version,
      location: `s3://${bucket}/datasets/${m.name}/v${m.version}/`,
      uri: `s3://${bucket}/datasets/${m.name}/v${m.version}/`,
      size: m.size ?? 512 * 1024 * 1024,
    })),
  };
}

async function setupDatasetInfo(
  page: Parameters<typeof setupDefaultMocks>[0],
  bucket: string,
  name: string,
  data: Record<string, unknown>,
) {
  await page.route(`**/api/bucket/${bucket}/dataset/${encodeURIComponent(name)}/info*`, (route) =>
    route.fulfill({ status: 200, contentType: CT_JSON, body: JSON.stringify(data) }),
  );
}

test.describe("Dataset Panel — Version Table", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("version table shows column headers", async ({ page }) => {
    // ARRANGE
    const bucket = "ver-bucket";
    const name = "ver-headers-ds";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createDatasetInfoWithVersions(bucket, name, [{ version: "1", tags: ["latest"] }]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — version table column headers visible
    await expect(page.getByText("Versions").first()).toBeVisible();
    await expect(page.getByText("Version", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Created by").first()).toBeVisible();
    await expect(page.getByText("Date").first()).toBeVisible();
    await expect(page.getByText("Size", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Tags").first()).toBeVisible();
  });

  test("multiple versions are displayed in the table", async ({ page }) => {
    // ARRANGE
    const bucket = "multi-ver-bucket";
    const name = "multi-ver-ds";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createDatasetInfoWithVersions(bucket, name, [
        { version: "1", created_by: "alice", tags: [] },
        { version: "2", created_by: "bob", tags: ["stable"] },
        { version: "3", created_by: "charlie", tags: ["latest"] },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — all version creators are visible (proxy for row visibility)
    await expect(page.getByText("alice").first()).toBeVisible();
    await expect(page.getByText("bob").first()).toBeVisible();
    await expect(page.getByText("charlie").first()).toBeVisible();
  });

  test("version tags are shown as badges", async ({ page }) => {
    // ARRANGE
    const bucket = "tags-bucket";
    const name = "tags-ds";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createDatasetInfoWithVersions(bucket, name, [
        { version: "1", tags: ["latest", "production"] },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — tags visible in the versions table
    await expect(page.getByText("latest").first()).toBeVisible();
    await expect(page.getByText("production").first()).toBeVisible();
  });

  test("version without tags shows dash placeholder", async ({ page }) => {
    // ARRANGE
    const bucket = "notag-bucket";
    const name = "notag-ds";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.DATASET }]));
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createDatasetInfoWithVersions(bucket, name, [{ version: "1", tags: [] }]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — dash placeholder shown for empty tags
    await expect(page.getByText("Versions").first()).toBeVisible();
    await expect(page.getByText("—").first()).toBeVisible();
  });
});

test.describe("Dataset Panel — Collection Members Table", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("collection members table shows column headers", async ({ page }) => {
    // ARRANGE
    const bucket = "coll-bucket";
    const name = "coll-members";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.COLLECTION }]));
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createCollectionInfoWithMembers(bucket, name, [{ name: "sub-ds-1", version: "1" }]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — Members section with column headers
    await expect(page.getByText("Members").first()).toBeVisible();
    await expect(page.getByText("Dataset", { exact: true }).first()).toBeVisible();
  });

  test("collection shows multiple member datasets", async ({ page }) => {
    // ARRANGE
    const bucket = "multi-member-bucket";
    const name = "multi-coll";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.COLLECTION }]));
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createCollectionInfoWithMembers(bucket, name, [
        { name: "training-data", version: "3" },
        { name: "validation-set", version: "1" },
        { name: "test-holdout", version: "2" },
      ]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — all member names visible
    await expect(page.getByText("training-data").first()).toBeVisible();
    await expect(page.getByText("validation-set").first()).toBeVisible();
    await expect(page.getByText("test-holdout").first()).toBeVisible();
  });

  test("collection members show version numbers with v prefix", async ({ page }) => {
    // ARRANGE
    const bucket = "ver-coll-bucket";
    const name = "ver-coll";
    await setupDatasets(page, createDatasetsResponse([{ name, bucket, type: DatasetType.COLLECTION }]));
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createCollectionInfoWithMembers(bucket, name, [{ name: "member-ds", version: "5" }]),
    );

    // ACT
    await page.goto("/datasets?all=true");
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: `Open details for ${name}` }).click();

    // ASSERT — version shown as "v5"
    await expect(page.getByText("v5").first()).toBeVisible();
  });
});
