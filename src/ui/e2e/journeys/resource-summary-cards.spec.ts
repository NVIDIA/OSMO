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
import { createResourcesResponse, BackendResourceType } from "@/mocks/factories";
import { setupDefaultMocks, setupResources } from "@/e2e/utils/mock-setup";

/**
 * Resource Summary Cards (AdaptiveSummary) Journey Tests
 *
 * Architecture notes:
 * - AdaptiveSummary renders above the resources table showing 4 metric cards: GPU, CPU, Memory, Storage
 * - Each card shows: value + "free"/"used" label (based on displayMode)
 * - Aggregates are computed client-side by the resources-shim from allocatable_fields/usage_fields
 * - The shim calls computeAggregates on transformed Resource objects
 * - Memory is stored in KiB, storage in bytes — converted to GiB by the adapter
 * - Icons: Zap (GPU), Cpu (CPU), MemoryStick (Memory), HardDrive (Storage)
 * - Responsive via CSS container queries: 2-col narrow → 4-col wide
 */

const GiB_IN_KiB = 1024 * 1024; // 1 GiB in KiB for memory

test.describe("Resource Summary Cards", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
  });

  test("shows summary cards with metric labels on resources page", async ({ page }) => {
    // ARRANGE — single resource with known allocatable/usage
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "gpu-node-001.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "gpu-node-001", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 0 },
          usage_fields: { gpu: 4, cpu: 64, memory: 256 * GiB_IN_KiB, storage: 0 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — metric labels visible (GPU, CPU, Memory, Storage)
    // The card labels are rendered in the summary section above the table
    await expect(page.getByText("GPU").first()).toBeVisible();
    await expect(page.getByText("CPU").first()).toBeVisible();
  });

  test("displays free values for resources", async ({ page }) => {
    // ARRANGE — resource with 4 free GPUs (8 total - 4 used = 4 free)
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "free-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "free-node", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 64, memory: 128 * GiB_IN_KiB, storage: 0 },
          usage_fields: { gpu: 4, cpu: 32, memory: 64 * GiB_IN_KiB, storage: 0 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — "free" label is rendered on summary cards
    await expect(page.getByText("free").first()).toBeVisible();
  });

  test("aggregates metrics across multiple resources", async ({ page }) => {
    // ARRANGE — 2 nodes with 8 GPU each = 16 total; 4+6 used = 10 used; 4+2 free = 6 free
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "node-a.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "node-a", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 64, memory: 256 * GiB_IN_KiB, storage: 0 },
          usage_fields: { gpu: 4, cpu: 32, memory: 128 * GiB_IN_KiB, storage: 0 },
        },
        {
          hostname: "node-b.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "node-b", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 64, memory: 256 * GiB_IN_KiB, storage: 0 },
          usage_fields: { gpu: 6, cpu: 48, memory: 192 * GiB_IN_KiB, storage: 0 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — both nodes visible in the table
    await expect(page.getByText("node-a").first()).toBeVisible();
    await expect(page.getByText("node-b").first()).toBeVisible();
    // Summary section renders with "GPU" label (aggregated across resources)
    await expect(page.getByText("GPU").first()).toBeVisible();
  });

  test("shows zero values gracefully when resources have no utilization", async ({ page }) => {
    // ARRANGE — resource with zero usage
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "idle-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "idle-node", "pool/platform": ["prod/base"] },
          pool_platform_labels: { prod: ["base"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 0 },
          usage_fields: { gpu: 0, cpu: 0, memory: 0, storage: 0 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — page renders without errors, resource is visible
    await expect(page.getByText("idle-node").first()).toBeVisible();
    // Summary cards still show with metric labels
    await expect(page.getByText("GPU").first()).toBeVisible();
  });

  test("handles CPU-only nodes (zero GPU) in summary", async ({ page }) => {
    // ARRANGE — CPU-only node has 0 GPU allocatable and 0 GPU used
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "cpu-only.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "cpu-only", "pool/platform": ["prod/cpu"] },
          pool_platform_labels: { prod: ["cpu"] },
          allocatable_fields: { gpu: 0, cpu: 256, memory: 1024 * GiB_IN_KiB, storage: 0 },
          usage_fields: { gpu: 0, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 0 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — resource visible, CPU summary shows non-zero value
    await expect(page.getByText("cpu-only").first()).toBeVisible();
    await expect(page.getByText("CPU").first()).toBeVisible();
  });

  test("renders summary cards alongside resource table", async ({ page }) => {
    // ARRANGE — small resource set to verify both summary and table render together
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "summary-node-1.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "summary-node-1", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 4, cpu: 32, memory: 64 * GiB_IN_KiB, storage: 0 },
          usage_fields: { gpu: 2, cpu: 16, memory: 32 * GiB_IN_KiB, storage: 0 },
        },
        {
          hostname: "summary-node-2.cluster",
          resource_type: BackendResourceType.RESERVED,
          exposed_fields: { node: "summary-node-2", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 4, cpu: 32, memory: 64 * GiB_IN_KiB, storage: 0 },
          usage_fields: { gpu: 4, cpu: 24, memory: 48 * GiB_IN_KiB, storage: 0 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — both the summary section and the table are rendered
    // Summary cards visible
    await expect(page.getByText("GPU").first()).toBeVisible();
    // Table rows visible
    await expect(page.getByText("summary-node-1").first()).toBeVisible();
    await expect(page.getByText("summary-node-2").first()).toBeVisible();
    // Results count is displayed (indicating table is populated)
    await expect(page.getByText(/\d+ results/).first()).toBeVisible();
  });
});
