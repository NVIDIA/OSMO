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
  createResourcesResponse,
  createResourceEntry,
  BackendResourceType,
  PoolStatus,
} from "@/mocks/factories";
import { setupDefaultMocks, setupPools, setupResources, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Resource Panel Detail Journey Tests
 *
 * Tests the resource details panel — the section that opens when clicking a
 * resource row or navigating with ?view=resource-name. Specifically covers:
 * - Hostname display
 * - Capacity bars (GPU, CPU, Memory, Storage)
 * - Conditions badges
 * - Platform configuration section (loading pools from API)
 * - View Pool Details link
 */

test.describe("Resource Panel Capacity", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "prod",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: {
              description: "DGX H100",
              host_network_allowed: true,
              privileged_allowed: false,
              allowed_mounts: ["/data", "/models"],
              default_mounts: ["/workspace"],
            },
          },
        },
      ]),
    );
  });

  test("shows hostname in panel", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "dgx-h100-001.nvidia.local",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "dgx-h100-001", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * 1024 * 1024, storage: 2e12 },
          usage_fields: { gpu: 6, cpu: 96, memory: 384 * 1024 * 1024, storage: 1.5e12 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=dgx-h100-001");
    await page.waitForLoadState("networkidle");

    // ASSERT — panel shows hostname
    const panel = page.getByRole("complementary", { name: "Resource details: dgx-h100-001" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("dgx-h100-001.nvidia.local")).toBeVisible();
  });

  test("shows capacity bars for GPU, CPU, Memory, Storage", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "capacity-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "capacity-node", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * 1024 * 1024, storage: 2e12 },
          usage_fields: { gpu: 4, cpu: 64, memory: 256 * 1024 * 1024, storage: 1e12 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=capacity-node");
    await page.waitForLoadState("networkidle");

    // ASSERT — all capacity labels visible in panel
    const panel = page.getByRole("complementary", { name: "Resource details: capacity-node" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("GPU").first()).toBeVisible();
    await expect(panel.getByText("CPU").first()).toBeVisible();
    await expect(panel.getByText("Memory").first()).toBeVisible();
    await expect(panel.getByText("Storage").first()).toBeVisible();
  });

  test("shows conditions badges when resource has conditions", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "condition-node.cluster",
          resource_type: BackendResourceType.SHARED,
          conditions: ["Ready", "SchedulingEnabled", "MemoryPressure"],
          exposed_fields: { node: "condition-node", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=condition-node");
    await page.waitForLoadState("networkidle");

    // ASSERT — conditions badges visible
    const panel = page.getByRole("complementary", { name: "Resource details: condition-node" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Ready")).toBeVisible();
    await expect(panel.getByText("SchedulingEnabled")).toBeVisible();
    await expect(panel.getByText("MemoryPressure")).toBeVisible();
  });

  test("shows platform configuration section header", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "platform-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "platform-node", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=platform-node");
    await page.waitForLoadState("networkidle");

    // ASSERT — Platform Configuration section visible
    const panel = page.getByRole("complementary", { name: "Resource details: platform-node" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/platform configuration/i)).toBeVisible();
  });

  test("shows View Pool Details button when pool is loaded", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "poolview-node.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "poolview-node", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=poolview-node");
    await page.waitForLoadState("networkidle");

    // ASSERT — "View Pool Details" button is visible
    const panel = page.getByRole("complementary", { name: "Resource details: poolview-node" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("View Pool Details").first()).toBeVisible();
  });
});

test.describe("Resource Panel Resource Type", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(page, createPoolResponse([{ name: "prod", status: PoolStatus.ONLINE }]));
  });

  test("shows resource type badge for SHARED resource", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "shared-res.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "shared-res", "pool/platform": ["prod/base"] },
          pool_platform_labels: { prod: ["base"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=shared-res");
    await page.waitForLoadState("networkidle");

    // ASSERT — panel shows resource type
    const panel = page.getByRole("complementary", { name: "Resource details: shared-res" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/shared/i).first()).toBeVisible();
  });

  test("shows resource type badge for RESERVED resource", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "reserved-res.cluster",
          resource_type: BackendResourceType.RESERVED,
          exposed_fields: { node: "reserved-res", "pool/platform": ["prod/base"] },
          pool_platform_labels: { prod: ["base"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=reserved-res");
    await page.waitForLoadState("networkidle");

    // ASSERT — panel shows resource type
    const panel = page.getByRole("complementary", { name: "Resource details: reserved-res" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/reserved/i).first()).toBeVisible();
  });
});

test.describe("Resource Summary Cards", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
  });

  test("shows resource summary section with GPU and CPU metrics", async ({ page }) => {
    // ARRANGE — multiple resources with GPU usage
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "node-1.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "node-1", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * 1024 * 1024, storage: 2e12 },
          usage_fields: { gpu: 6, cpu: 96, memory: 384 * 1024 * 1024, storage: 1e12 },
        },
        {
          hostname: "node-2.cluster",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "node-2", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * 1024 * 1024, storage: 2e12 },
          usage_fields: { gpu: 2, cpu: 32, memory: 128 * 1024 * 1024, storage: 0.5e12 },
        },
      ]),
    );

    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — summary section with GPU label visible
    await expect(page.getByText("GPU").first()).toBeVisible();
  });
});
