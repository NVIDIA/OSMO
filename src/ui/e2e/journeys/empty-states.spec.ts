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
  createWorkflowsResponse,
  createPoolResponse,
  createResourcesResponse,
  createDatasetsResponse,
  WorkflowStatus,
  PoolStatus,
} from "@/mocks/factories";
import {
  setupDefaultMocks,
  setupProfile,
  setupWorkflows,
  setupPools,
  setupResources,
  setupDatasets,
} from "@/e2e/utils/mock-setup";

/**
 * Empty State Tests
 *
 * Verifies that tables show correct empty state messaging when no data is returned.
 * This covers the TableEmptyState component and ensures graceful degradation
 * when backends return empty arrays.
 *
 * Architecture notes:
 * - TableEmptyState renders a simple "No {items} found" message
 * - DataTable passes emptyContent prop which renders TableEmptyState
 * - Empty states should NOT crash the page or show loading spinners indefinitely
 */

test.describe("Empty States — Workflows Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows empty state text when no workflows returned", async ({ page }) => {
    // ARRANGE — empty response with no workflows
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT
    await expect(page.getByText(/no workflows found/i).first()).toBeVisible();
  });

  test("shows results count of 0 when no workflows match", async ({ page }) => {
    // ARRANGE
    await setupWorkflows(page, createWorkflowsResponse([]));

    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — results count shows 0
    await expect(page.getByText(/0 results/).first()).toBeVisible();
  });
});

test.describe("Empty States — Pools Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("pools page loads without crash when no pools exist", async ({ page }) => {
    // ARRANGE — pool response with empty pools list
    await setupPools(page, createPoolResponse([]));

    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without crashing (breadcrumb is visible)
    await expect(page.getByText(/pools/i).first()).toBeVisible();
  });
});

test.describe("Empty States — Resources Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("resources page loads without crash when no resources exist", async ({ page }) => {
    // ARRANGE — empty resources
    await setupResources(page, createResourcesResponse([]));

    // ACT
    await page.goto("/resources?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without crashing (breadcrumb is visible)
    await expect(page.getByText(/resources/i).first()).toBeVisible();
  });
});

test.describe("Empty States — Datasets Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows empty state when no datasets exist", async ({ page }) => {
    // ARRANGE — empty datasets
    await setupDatasets(page, createDatasetsResponse([]));

    // ACT
    await page.goto("/datasets");
    await page.waitForLoadState("networkidle");

    // ASSERT — empty datasets page shows 0 results
    await expect(page.getByText(/0 results/).first()).toBeVisible();
  });
});
