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
 * Pool Platform Selector Tests
 *
 * Tests the platform selector in the pool panel (platform-selector.tsx):
 * - Single platform: static label (no dropdown)
 * - Multiple platforms (2-5): simple dropdown
 * - Default platform badge
 * - Platform switching within the panel
 *
 * Architecture notes:
 * - PlatformSelector is rendered inside PanelContent
 * - It shows below the GPU Quota/Capacity section
 * - The selected platform determines what platform config is shown below it
 * - The "default" badge is shown for the first platform in the pool config
 */

test.describe("Pool Platform Selector — Single Platform", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("single platform shows static label without dropdown toggle", async ({ page }) => {
    // ARRANGE — pool with exactly one platform
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "single-plat-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            base: {
              description: "Base platform only",
              host_network_allowed: false,
              privileged_allowed: false,
              allowed_mounts: [],
              default_mounts: [],
            },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=single-plat-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — platform name is visible as text but no "Select platform" button
    const panel = page.getByRole("complementary", { name: "Pool details: single-plat-pool" });
    await expect(panel.getByText("base").first()).toBeVisible();
    await expect(panel.getByRole("button", { name: "Select platform" })).not.toBeVisible();
  });
});

test.describe("Pool Platform Selector — Multiple Platforms", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("multiple platforms show a dropdown trigger with the selected platform name", async ({ page }) => {
    // ARRANGE — pool with 3 platforms
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "multi-plat-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: { description: "DGX H100" },
            cpu: { description: "CPU only" },
            gpu_shared: { description: "Shared GPU" },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=multi-plat-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — dropdown trigger button is present with "Select platform" label
    const panel = page.getByRole("complementary", { name: "Pool details: multi-plat-pool" });
    await expect(panel.getByRole("button", { name: "Select platform" })).toBeVisible();
  });

  test("clicking platform dropdown shows all platform options", async ({ page }) => {
    // ARRANGE
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "dropdown-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: { description: "DGX H100" },
            cpu: { description: "CPU only" },
            training: { description: "Training nodes" },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=dropdown-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: dropdown-pool" });
    await panel.getByRole("button", { name: "Select platform" }).click();

    // ASSERT — all platform names visible in dropdown
    await expect(page.getByRole("menuitem", { name: /cpu/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /dgx/ })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /training/ })).toBeVisible();
  });

  test("selecting a different platform updates the displayed platform config", async ({ page }) => {
    // ARRANGE — two platforms with different mount configs
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "switch-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            alpha: {
              description: "Alpha platform",
              host_network_allowed: true,
              privileged_allowed: false,
              allowed_mounts: ["/alpha-mount"],
              default_mounts: [],
            },
            beta: {
              description: "Beta platform",
              host_network_allowed: false,
              privileged_allowed: true,
              allowed_mounts: ["/beta-mount"],
              default_mounts: [],
            },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=switch-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: switch-pool" });

    // Click platform selector and switch to beta
    await panel.getByRole("button", { name: "Select platform" }).click();
    await page.getByRole("menuitem", { name: /beta/ }).click();

    // ASSERT — beta platform's mounts are now shown
    await expect(panel.getByText("/beta-mount")).toBeVisible();
  });

  test("default platform shows 'default' badge", async ({ page }) => {
    // ARRANGE — dgx is listed first → it's the default
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "default-badge-pool",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: { description: "DGX" },
            cpu: { description: "CPU" },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=default-badge-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — "default" badge is visible near the platform name
    const panel = page.getByRole("complementary", { name: "Pool details: default-badge-pool" });
    await expect(panel.getByText("default")).toBeVisible();
  });
});
