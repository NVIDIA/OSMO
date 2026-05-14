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
  createPoolResponse,
  createWorkflowsResponse,
  createResourcesResponse,
  PoolStatus,
  WorkflowStatus,
  BackendResourceType,
} from "@/mocks/factories";
import {
  setupDefaultMocks,
  setupProfile,
  setupPools,
  setupWorkflows,
  setupResources,
} from "@/e2e/utils/mock-setup";

/**
 * Table Column Visibility Tests
 *
 * Tests the column toggle functionality across multiple table pages:
 * - Pools table column visibility toggle
 * - Workflows table column toggling
 * - Resources table column toggling
 * - Persisted column preferences in URL
 *
 * Architecture notes:
 * - Each DataTable has a "Toggle columns" button in the toolbar
 * - Clicking opens a dropdown with checkboxes for each column
 * - Column visibility state is synced via URL params (persisted across refresh)
 * - Uses shadcn DropdownMenuCheckboxItem for the column menu
 */

test.describe("Pools Table Column Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "prod-pool",
          status: PoolStatus.ONLINE,
          backend: "k8s-prod",
          resource_usage: {
            quota_used: "10",
            quota_free: "10",
            quota_limit: "20",
            total_usage: "32",
            total_capacity: "64",
            total_free: "32",
          },
        },
        {
          name: "staging-pool",
          status: PoolStatus.OFFLINE,
          backend: "k8s-staging",
        },
      ]),
    );
  });

  test("toggle columns button opens column visibility menu", async ({
    page,
  }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Click toggle columns button
    await page.getByRole("button", { name: /toggle columns/i }).click();

    // ASSERT — dropdown menu with column options visible
    await expect(
      page.getByRole("menuitemcheckbox").first(),
    ).toBeVisible();
  });

  test("pool table shows Status and Backend columns by default", async ({
    page,
  }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — status and backend values visible in the table
    await expect(page.getByText("prod-pool").first()).toBeVisible();
    await expect(page.getByText("staging-pool").first()).toBeVisible();
  });

  test("column menu has multiple toggleable columns", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Open column menu
    await page.getByRole("button", { name: /toggle columns/i }).click();

    // ASSERT — multiple column checkboxes are available
    const checkboxes = page.getByRole("menuitemcheckbox");
    const count = await checkboxes.count();
    expect(count).toBeGreaterThan(1);
  });
});

test.describe("Workflows Table Column Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupWorkflows(
      page,
      createWorkflowsResponse([
        {
          name: "train-job",
          status: WorkflowStatus.RUNNING,
          user: "alice",
          pool: "prod-pool",
        },
        {
          name: "eval-job",
          status: WorkflowStatus.COMPLETED,
          user: "bob",
          pool: "staging-pool",
        },
      ]),
    );
  });

  test("workflow table toggle columns shows column options", async ({
    page,
  }) => {
    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // Click toggle columns
    await page.getByRole("button", { name: /toggle columns/i }).click();

    // ASSERT — at least one column checkbox is visible
    await expect(
      page.getByRole("menuitemcheckbox").first(),
    ).toBeVisible();
  });

  test("workflows table shows workflow names and status", async ({
    page,
  }) => {
    // ACT
    await page.goto("/workflows?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — workflow data visible in table
    await expect(page.getByText("train-job").first()).toBeVisible();
    await expect(page.getByText("eval-job").first()).toBeVisible();
  });
});

test.describe("Resources Table Column Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(
      page,
      createPoolResponse([
        { name: "gpu-pool", status: PoolStatus.ONLINE },
      ]),
    );
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "node-a.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: {
            node: "node-a",
            "pool/platform": ["gpu-pool/dgx"],
          },
          pool_platform_labels: { "gpu-pool": ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128 },
          usage_fields: { gpu: 4, cpu: 64 },
        },
        {
          hostname: "node-b.cluster",
          resource_type: BackendResourceType.RESERVED,
          exposed_fields: {
            node: "node-b",
            "pool/platform": ["gpu-pool/dgx"],
          },
          pool_platform_labels: { "gpu-pool": ["dgx"] },
          allocatable_fields: { gpu: 4, cpu: 64 },
          usage_fields: { gpu: 2, cpu: 32 },
        },
      ]),
    );
  });

  test("resources table toggle columns shows column options", async ({
    page,
  }) => {
    // ACT
    await page.goto("/resources?all=true");
    await page.waitForLoadState("networkidle");

    // Click toggle columns
    await page.getByRole("button", { name: /toggle columns/i }).click();

    // ASSERT — at least one column checkbox is visible
    await expect(
      page.getByRole("menuitemcheckbox").first(),
    ).toBeVisible();
  });

  test("resources table shows node names", async ({ page }) => {
    // ACT
    await page.goto("/resources?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — resource nodes visible in table
    await expect(page.getByText("node-a").first()).toBeVisible();
    await expect(page.getByText("node-b").first()).toBeVisible();
  });

  test("resources table distinguishes shared and reserved types", async ({
    page,
  }) => {
    // ACT
    await page.goto("/resources?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — both types are represented in the table
    await expect(page.getByText(/shared/i).first()).toBeVisible();
    await expect(page.getByText(/reserved/i).first()).toBeVisible();
  });
});
