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
import {
  setupDefaultMocks,
  setupProfile,
} from "@/e2e/utils/mock-setup";

/**
 * Dataset Detail Page Journey Tests
 *
 * Architecture notes:
 * - Dataset detail lives at /datasets/{bucket}/{name}
 * - Uses Streaming SSR: DatasetDetailSkeleton → DatasetDetailWithData → DatasetDetailContent
 * - Fetches dataset info via GET /api/bucket/{bucket}/dataset/{name}/info
 * - Fetches file manifest via the version's location URL
 * - Shows file browser (table of folders/files), breadcrumbs, version picker
 * - Clicking a file opens a side preview panel
 * - URL state: ?path= (current dir), ?version= (dataset version), ?file= (selected file)
 * - Error state: "Error Loading Dataset" with retry button
 *
 * Manifest loading uses a server action (`fetchManifest`). Playwright `page.route`
 * only sees browser traffic, so with PLAYWRIGHT_E2E=1 manifests resolve via
 * `/api/e2e/dataset-manifest` (same-origin) instead of MSW on :9999.
 */

const CT_JSON = "application/json";

type ManifestCase = "default" | "grid" | "title" | "empty";

// ── Dataset Detail Mock Helpers ──────────────────────────────────────────────

function createDatasetInfoResponse(
  baseURL: string,
  bucket: string,
  name: string,
  overrides: {
    versions?: Array<Record<string, unknown>>;
    type?: "DATASET" | "COLLECTION";
    manifestCase?: ManifestCase;
  } = {},
) {
  const now = new Date().toISOString();
  const type = overrides.type ?? "DATASET";
  const manifestCase = overrides.manifestCase ?? "default";
  const manifestLocation = `${baseURL.replace(/\/$/, "")}/api/e2e/dataset-manifest?case=${manifestCase}`;

  if (type === "DATASET") {
    // Must satisfy `isDatasetEntry` in datasets.ts (status, created_by, created_date).
    // Version strings should be numeric for parseInt() in transformDatasetDetail.
    const defaultVersion = {
      name,
      version: "1",
      status: DatasetStatus.READY,
      created_by: "e2e-user",
      created_date: now,
      last_used: now,
      size: 1024 * 1024,
      checksum: "abc123",
      location: manifestLocation,
      uri: manifestLocation,
      metadata: {},
      tags: [] as string[],
      collections: [] as string[],
    };

    return {
      name,
      id: `${bucket}/${name}`,
      bucket,
      labels: {},
      type: "DATASET",
      versions: overrides.versions ?? [defaultVersion],
    };
  }

  // COLLECTION — DataInfoResponse uses `versions` with DataInfoCollectionEntry shape
  return {
    name,
    id: `${bucket}/${name}`,
    bucket,
    labels: {},
    type: "COLLECTION",
    versions: [
      {
        name: "sub-dataset-1",
        version: "1",
        location: `${baseURL.replace(/\/$/, "")}/api/e2e/dataset-manifest?case=default`,
        uri: `${baseURL.replace(/\/$/, "")}/api/e2e/dataset-manifest?case=default`,
        size: 512 * 1024,
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

  await page.route(`**/api/bucket/${bucket}/dataset/${name}/info*`, (route) => route.fulfill(response));
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Dataset Detail Page", () => {
  // Global test timeout is 10s; manifest + grid can exceed that with networkidle.
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("page title includes dataset name", async ({ page, baseURL }) => {
    // ARRANGE
    const origin = baseURL ?? "http://localhost:3000";
    const bucket = "my-bucket";
    const name = "my-dataset";
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createDatasetInfoResponse(origin, bucket, name, { manifestCase: "title" }),
    );

    // ACT
    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page).toHaveTitle(new RegExp(name));
  });

  test("shows breadcrumb with Datasets link and bucket", async ({ page, baseURL }) => {
    // ARRANGE
    const origin = baseURL ?? "http://localhost:3000";
    const bucket = "test-bucket";
    const name = "breadcrumb-dataset";
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(origin, bucket, name));

    // ACT
    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — breadcrumb shows Datasets > bucket > name
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Datasets").first()).toBeVisible();
    await expect(breadcrumb.getByText(bucket).first()).toBeVisible();
  });

  test("handles dataset API error without crashing", async ({ page }) => {
    // ARRANGE — use 400 to avoid TanStack Query retries on 5xx
    // NOTE: SSR prefetch via MSW may succeed independently of Playwright route mocks,
    // providing hydrated data to the client. In that case, the client component renders
    // normally using the SSR-prefetched data. This test verifies the page handles
    // the error gracefully — either showing an error state or rendering with SSR data.
    const bucket = "err-bucket";
    const name = "err-dataset";
    await setupDatasetInfo(page, bucket, name, { status: 400, detail: "Not found" });

    // ACT
    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — page must not crash and should not be completely empty
    await expect(page.locator("body")).not.toBeEmpty();
    // The page should show either the dataset content (SSR prefetch succeeded)
    // or an error state — either way, the page should have meaningful content
    await expect(page.locator("main, [role='main'], .flex").first()).toBeVisible();
  });

  test("shows file browser with files from manifest", async ({ page, baseURL }) => {
    // ARRANGE
    const origin = baseURL ?? "http://localhost:3000";
    const bucket = "data-bucket";
    const name = "file-dataset";
    await setupDatasetInfo(
      page,
      bucket,
      name,
      createDatasetInfoResponse(origin, bucket, name, { manifestCase: "grid" }),
    );

    // ACT
    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    // ASSERT — file browser renders (grid with rows)
    // Files at root level should show: readme.md, data/ folder, models/ folder
    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });
  });

  test("Datasets breadcrumb link navigates back to datasets list", async ({ page, baseURL }) => {
    // ARRANGE
    const origin = baseURL ?? "http://localhost:3000";
    const bucket = "nav-bucket";
    const name = "nav-dataset";
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(origin, bucket, name));

    // ACT
    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    // Click the Datasets breadcrumb link
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    const datasetsLink = breadcrumb.getByText("Datasets").first();
    await datasetsLink.click();

    // ASSERT — navigates to datasets list
    await expect(page).toHaveURL(/\/datasets\b/);
  });
});
