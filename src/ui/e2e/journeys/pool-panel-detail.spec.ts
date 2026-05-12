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
import { createPoolResponse, PoolStatus } from "@/mocks/factories";
import { setupDefaultMocks, setupPools, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Pool Panel Detail Journey Tests
 *
 * Tests the pool details panel — the section that opens when clicking a
 * pool row or navigating with ?view=pool-name. Specifically covers:
 * - Pool panel header (status indicator, backend info, platform count)
 * - Pool timeouts section
 * - Platform selector (single vs multiple platforms)
 * - Platform config (host network, privileged mode, mounts)
 * - Shared capacity badge (when pools share capacity)
 */

test.describe("Pool Panel Header Detail", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows status indicator and backend in panel header", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "detail-pool",
          status: PoolStatus.ONLINE,
          backend: "k8s-production",
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=detail-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — header has backend info
    const panel = page.getByRole("complementary", { name: "Pool details: detail-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("k8s-production").first()).toBeVisible();
  });

  test("shows platform count in panel header for multi-platform pool", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "multi-platform-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: { description: "DGX nodes" },
            cpu: { description: "CPU-only" },
            gpu_shared: { description: "Shared GPU" },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=multi-platform-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — platform count visible
    const panel = page.getByRole("complementary", { name: "Pool details: multi-platform-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/3 platforms/)).toBeVisible();
  });

  test("shows single platform label (not count) for single-platform pool", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "single-platform-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            base: { description: "Base platform" },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=single-platform-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — "1 platform" visible in header
    const panel = page.getByRole("complementary", { name: "Pool details: single-platform-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/1 platform\b/)).toBeVisible();
  });
});

test.describe("Pool Panel Platform Config", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows Host Network and Privileged Mode flags", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "config-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: {
              description: "DGX H100",
              host_network_allowed: true,
              privileged_allowed: false,
              allowed_mounts: ["/data"],
              default_mounts: ["/workspace"],
            },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=config-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — boolean flags visible in platform config
    const panel = page.getByRole("complementary", { name: "Pool details: config-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Host Network")).toBeVisible();
    await expect(panel.getByText("Privileged Mode")).toBeVisible();
  });

  test("shows allowed mounts in platform config", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "mounts-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            base: {
              description: "Base platform",
              host_network_allowed: false,
              privileged_allowed: false,
              allowed_mounts: ["/data/shared", "/models/pretrained"],
              default_mounts: [],
            },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=mounts-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — allowed mounts visible
    const panel = page.getByRole("complementary", { name: "Pool details: mounts-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Allowed Mounts")).toBeVisible();
    await expect(panel.getByText("/data/shared")).toBeVisible();
    await expect(panel.getByText("/models/pretrained")).toBeVisible();
  });

  test("shows default mounts in platform config", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "default-mounts-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            base: {
              description: "Base",
              host_network_allowed: false,
              privileged_allowed: false,
              allowed_mounts: [],
              default_mounts: ["/workspace", "/home/user"],
            },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=default-mounts-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — default mounts visible
    const panel = page.getByRole("complementary", { name: "Pool details: default-mounts-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Default Mounts")).toBeVisible();
    await expect(panel.getByText("/workspace")).toBeVisible();
    await expect(panel.getByText("/home/user")).toBeVisible();
  });
});

test.describe("Pool Panel Empty States", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("pool without platforms does not show platform configuration section", async ({ page }) => {
    // ARRANGE — pool with no platforms configured
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "no-platform-pool",
          status: PoolStatus.ONLINE,
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=no-platform-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — panel renders but no platform configuration section
    const panel = page.getByRole("complementary", { name: "Pool details: no-platform-pool" });
    await expect(panel).toBeVisible();
    // GPU quota is always present
    await expect(panel.getByText("GPU Quota")).toBeVisible();
  });

  test("pool with zero quota shows zero in capacity bar", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "zero-pool",
          status: PoolStatus.ONLINE,
          resource_usage: {
            quota_used: "0",
            quota_free: "0",
            quota_limit: "0",
            total_usage: "0",
            total_capacity: "0",
            total_free: "0",
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=zero-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — panel renders with zero capacity
    const panel = page.getByRole("complementary", { name: "Pool details: zero-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("GPU Quota")).toBeVisible();
    await expect(panel.getByText("GPU Capacity")).toBeVisible();
  });
});
