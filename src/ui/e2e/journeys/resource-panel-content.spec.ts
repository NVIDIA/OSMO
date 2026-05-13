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
  PoolStatus,
  BackendResourceType,
} from "@/mocks/factories";
import {
  setupDefaultMocks,
  setupPools,
  setupResources,
} from "@/e2e/utils/mock-setup";

/**
 * Resource Panel Content Tests
 *
 * Tests the resource detail panel features:
 * - Hostname display and capacity bars (GPU, CPU, Memory, Storage)
 * - Conditions badges display
 * - Pool-specific platform configuration
 * - RESERVED badge for reserved resources
 *
 * Architecture notes:
 * - Resource panel opens at /resources?view=<node-short-name>
 * - Panel is an <aside> (role="complementary", aria-label="Resource details: {node}")
 * - Shows: hostname, capacity bars, conditions, platform config per pool
 * - API calls: GET /api/resources, GET /api/pool_quota (for pool details)
 */

test.describe("Resource Panel Capacity Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupPools(
      page,
      createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
    );
  });

  test("shows hostname in resource panel", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "dgx-001.cluster.local",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: {
            node: "dgx-001",
            "pool/platform": ["test-pool/base"],
          },
          pool_platform_labels: { "test-pool": ["base"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=dgx-001");
    await page.waitForLoadState("networkidle");

    // ASSERT — panel shows hostname
    const panel = page.getByRole("complementary", { name: "Resource details: dgx-001" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("dgx-001.cluster.local")).toBeVisible();
  });

  test("shows GPU, CPU, Memory, and Storage capacity sections", async ({ page }) => {
    // ARRANGE
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "capacity-node.cluster.local",
          resource_type: BackendResourceType.SHARED,
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * 1024 * 1024, storage: 2e12 },
          usage_fields: { gpu: 4, cpu: 64, memory: 256 * 1024 * 1024, storage: 1e12 },
          exposed_fields: {
            node: "capacity-node",
            "pool/platform": ["test-pool/base"],
          },
          pool_platform_labels: { "test-pool": ["base"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=capacity-node");
    await page.waitForLoadState("networkidle");

    // ASSERT — capacity sections visible
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
          hostname: "conditioned-node.cluster.local",
          resource_type: BackendResourceType.SHARED,
          conditions: ["Ready", "SchedulingEnabled"],
          exposed_fields: {
            node: "conditioned-node",
            "pool/platform": ["test-pool/base"],
          },
          pool_platform_labels: { "test-pool": ["base"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=conditioned-node");
    await page.waitForLoadState("networkidle");

    // ASSERT — conditions visible
    const panel = page.getByRole("complementary", { name: "Resource details: conditioned-node" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Ready")).toBeVisible();
    await expect(panel.getByText("SchedulingEnabled")).toBeVisible();
  });
});

test.describe("Resource Panel Platform Config", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
  });

  test("shows platform configuration section for resource in a pool", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "config-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: {
              description: "DGX H100 nodes",
              host_network_allowed: true,
              privileged_allowed: false,
              allowed_mounts: ["/data"],
              default_mounts: ["/workspace"],
            },
          },
        },
      ]),
    );
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "platform-node.cluster.local",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: {
            node: "platform-node",
            "pool/platform": ["config-pool/dgx"],
          },
          pool_platform_labels: { "config-pool": ["dgx"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=platform-node");
    await page.waitForLoadState("networkidle");

    // ASSERT — platform configuration section visible
    const panel = page.getByRole("complementary", { name: "Resource details: platform-node" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/platform configuration/i)).toBeVisible();
  });

  test("shows RESERVED badge for reserved resources", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]),
    );
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "reserved-node.cluster.local",
          resource_type: BackendResourceType.RESERVED,
          exposed_fields: {
            node: "reserved-node",
            "pool/platform": ["test-pool/base"],
          },
          pool_platform_labels: { "test-pool": ["base"] },
        },
      ]),
    );

    // ACT
    await page.goto("/resources?view=reserved-node");
    await page.waitForLoadState("networkidle");

    // ASSERT — RESERVED badge visible in panel header
    const panel = page.getByRole("complementary", { name: "Resource details: reserved-node" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/reserved/i).first()).toBeVisible();
  });
});
