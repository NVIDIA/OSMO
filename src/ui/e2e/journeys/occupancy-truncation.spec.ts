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
  setupOccupancy,
} from "@/e2e/utils/mock-setup";

/**
 * Occupancy Truncation Warning Tests
 *
 * When the occupancy API returns more than 10,000 rows, the UI shows a warning
 * banner informing users that results may be incomplete. This tests the
 * truncation threshold detection in OccupancyPageContent.
 *
 * Architecture notes:
 * - useOccupancyData hook sets `truncated: true` when response rows >= 10,000
 * - OccupancyPageContent renders a warning banner conditionally on `truncated`
 * - The banner mentions "10,000 row fetch limit"
 */

function createLargeOccupancySummaries(count: number) {
  const summaries = [];
  for (let i = 0; i < count; i++) {
    summaries.push({
      user: `user-${i}`,
      pool: `pool-${i % 5}`,
      gpu: 4,
      cpu: 32,
      memory: 64 * 1024 * 1024 * 1024,
      storage: 100 * 1024 * 1024 * 1024,
      priority: "NORMAL",
    });
  }
  return { summaries };
}

function createSmallOccupancySummaries() {
  return {
    summaries: [
      { user: "alice", pool: "prod", gpu: 8, cpu: 64, memory: 64 * 1024 * 1024 * 1024, storage: 100 * 1024 * 1024 * 1024, priority: "NORMAL" },
      { user: "bob", pool: "staging", gpu: 4, cpu: 32, memory: 32 * 1024 * 1024 * 1024, storage: 50 * 1024 * 1024 * 1024, priority: "NORMAL" },
    ],
  };
}

test.describe("Occupancy Truncation Warning", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows truncation warning when response has 10000+ rows", async ({ page }) => {
    // ARRANGE — exactly 10,000 rows triggers the truncation banner
    await setupOccupancy(page, createLargeOccupancySummaries(10000));

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — truncation banner is visible
    await expect(
      page.getByText(/results may be incomplete/i).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/10,000 row fetch limit/i).first(),
    ).toBeVisible();
  });

  test("does not show truncation warning for small datasets", async ({ page }) => {
    // ARRANGE — small dataset (2 rows)
    await setupOccupancy(page, createSmallOccupancySummaries());

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — no truncation warning visible
    await expect(
      page.getByText(/results may be incomplete/i),
    ).not.toBeVisible();
  });

  test("truncation warning does not block table rendering", async ({ page }) => {
    // ARRANGE — truncated response should still show grouped data
    await setupOccupancy(page, createLargeOccupancySummaries(10000));

    // ACT
    await page.goto("/occupancy");
    await page.waitForLoadState("networkidle");

    // ASSERT — both warning and data table are visible
    await expect(page.getByText(/results may be incomplete/i).first()).toBeVisible();
    // Pool groups should still appear
    await expect(page.getByText("pool-0").first()).toBeVisible();
  });
});
