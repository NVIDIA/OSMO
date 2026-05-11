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
 * Dataset Detail Page Journey Tests
 *
 * Architecture notes:
 * - Dataset detail lives at /datasets/{bucket}/{name}
 * - Uses Streaming SSR: DatasetDetailSkeleton → DatasetDetailWithData → DatasetDetailContent
 * - Fetches dataset info via GET /api/bucket/{bucket}/dataset/{name}/info (mocked with page.route)
 * - Fetches manifest via server action → GET {getServerApiBaseUrl()}/api/bucket/.../manifest
 *   In E2E, NEXT_PUBLIC_MOCK_API=true (playwright webServer.env) so base URL is localhost:9999
 *   where `e2e/mock-api-backend.mjs` serves fixtures keyed by bucket + dataset name.
 */

const CT_JSON = "application/json";

// ── Dataset Detail Mock Helpers ──────────────────────────────────────────────

function createDatasetInfoResponse(
  bucket: string,
  name: string,
  overrides: {
    versions?: Array<Record<string, unknown>>;
    type?: "DATASET" | "COLLECTION";
  } = {},
) {
  const now = new Date().toISOString();
  const type = overrides.type ?? "DATASET";
  // Non-null location enables the files query; manifest rows come from bucket/name via server action.
  const locationPlaceholder = `s3://${bucket}/datasets/${name}/v1/`;

  if (type === "DATASET") {
    const defaultVersion = {
      name,
      version: "1",
      status: DatasetStatus.READY,
      created_by: "e2e-user",
      created_date: now,
      last_used: now,
      size: 1024 * 1024,
      checksum: "abc123",
      location: locationPlaceholder,
      uri: locationPlaceholder,
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

  const subLoc = `s3://${bucket}/datasets/sub-dataset-1/v1/`;
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
        location: subLoc,
        uri: subLoc,
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
  test.describe.configure({ timeout: 30_000 });

  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("page title includes dataset name", async ({ page }) => {
    const bucket = "my-bucket";
    const name = "my-dataset";
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name));

    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    await expect.poll(async () => page.title()).toContain(name);
  });

  test("shows breadcrumb with Datasets link and bucket", async ({ page }) => {
    const bucket = "test-bucket";
    const name = "breadcrumb-dataset";
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name));

    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByText("Datasets").first()).toBeVisible();
    await expect(breadcrumb.getByText(bucket).first()).toBeVisible();
  });

  test("handles dataset API error without crashing", async ({ page }) => {
    const bucket = "err-bucket";
    const name = "err-dataset";
    await setupDatasetInfo(page, bucket, name, { status: 400, detail: "Not found" });

    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.locator("main, [role='main'], .flex").first()).toBeVisible();
  });

  test("shows file browser with files from manifest", async ({ page }) => {
    const bucket = "data-bucket";
    const name = "file-dataset";
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name));

    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    const grid = page.getByRole("grid");
    await expect(grid).toBeVisible({ timeout: 15_000 });
  });

  test("Datasets breadcrumb link navigates back to datasets list", async ({ page }) => {
    const bucket = "nav-bucket";
    const name = "nav-dataset";
    await setupDatasetInfo(page, bucket, name, createDatasetInfoResponse(bucket, name));

    await page.goto(`/datasets/${bucket}/${name}`);
    await page.waitForLoadState("networkidle");

    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await breadcrumb.getByText("Datasets").first().click();

    await expect(page).toHaveURL(/\/datasets\b/);
  });
});
