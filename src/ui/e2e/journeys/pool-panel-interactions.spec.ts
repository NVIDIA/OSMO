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
 * Pool Panel Interactions Journey Tests
 *
 * Tests advanced pool panel features that require richer mock data:
 * - Timeout configuration display (default/max execution, queue timeouts)
 * - Shared capacity (pools within same node_set share capacity)
 * - Platform selector (switching between platforms in multi-platform pools)
 * - Exit actions display
 */

test.describe("Pool Panel Timeouts", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows timeout configuration when pool has timeouts", async ({ page }) => {
    // ARRANGE — pool with all timeout fields
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "timeout-pool",
          status: PoolStatus.ONLINE,
          default_exec_timeout: "4h",
          max_exec_timeout: "24h",
          default_queue_timeout: "15m",
          max_queue_timeout: "1h",
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=timeout-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — timeout section visible with values
    const panel = page.getByRole("complementary", { name: "Pool details: timeout-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Timeouts")).toBeVisible();
    await expect(panel.getByText("Default Execution")).toBeVisible();
    await expect(panel.getByText("4h", { exact: true })).toBeVisible();
    await expect(panel.getByText("Max Execution")).toBeVisible();
    await expect(panel.getByText("24h")).toBeVisible();
    await expect(panel.getByText("Default Queue")).toBeVisible();
    await expect(panel.getByText("15m")).toBeVisible();
    await expect(panel.getByText("Max Queue")).toBeVisible();
    await expect(panel.getByText("1h", { exact: true })).toBeVisible();
  });

  test("shows partial timeouts when only some are configured", async ({ page }) => {
    // ARRANGE — pool with only execution timeouts
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "partial-timeout-pool",
          status: PoolStatus.ONLINE,
          default_exec_timeout: "2h",
          max_exec_timeout: "12h",
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=partial-timeout-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — only configured timeouts shown
    const panel = page.getByRole("complementary", { name: "Pool details: partial-timeout-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Timeouts")).toBeVisible();
    await expect(panel.getByText("Default Execution")).toBeVisible();
    await expect(panel.getByText("2h", { exact: true })).toBeVisible();
    await expect(panel.getByText("Max Execution")).toBeVisible();
    await expect(panel.getByText("12h")).toBeVisible();
  });
});

test.describe("Pool Panel Exit Actions", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows default exit actions when pool has them configured", async ({ page }) => {
    // ARRANGE — pool with exit actions
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "exit-actions-pool",
          status: PoolStatus.ONLINE,
          default_exit_actions: {
            "0": "complete",
            "1": "retry",
            "137": "restart",
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=exit-actions-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — exit actions section visible with codes and actions
    const panel = page.getByRole("complementary", { name: "Pool details: exit-actions-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Default Exit Actions")).toBeVisible();
    await expect(panel.getByText("137")).toBeVisible();
    await expect(panel.getByText("restart")).toBeVisible();
    await expect(panel.getByText("complete")).toBeVisible();
    await expect(panel.getByText("retry")).toBeVisible();
  });
});

test.describe("Pool Panel Shared Capacity", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows shared capacity badge when pools share a node_set", async ({ page }) => {
    // ARRANGE — two pools in the same node_set (sharing capacity)
    // createPoolResponse wraps pools in a single node_set by default,
    // so pools in the same call share capacity.
    await setupPools(page, {
      node_sets: [
        {
          pools: [
            {
              name: "shared-pool-a",
              status: PoolStatus.ONLINE,
              backend: "k8s-prod",
              description: "First shared pool",
              resource_usage: {
                quota_used: "10",
                quota_free: "10",
                quota_limit: "20",
                total_usage: "32",
                total_capacity: "64",
                total_free: "32",
              },
              platforms: {
                base: {
                  description: "Base",
                  host_network_allowed: false,
                  privileged_allowed: false,
                  allowed_mounts: [],
                  default_mounts: [],
                },
              },
            },
            {
              name: "shared-pool-b",
              status: PoolStatus.ONLINE,
              backend: "k8s-prod",
              description: "Second shared pool",
              resource_usage: {
                quota_used: "5",
                quota_free: "15",
                quota_limit: "20",
                total_usage: "32",
                total_capacity: "64",
                total_free: "32",
              },
              platforms: {
                base: {
                  description: "Base",
                  host_network_allowed: false,
                  privileged_allowed: false,
                  allowed_mounts: [],
                  default_mounts: [],
                },
              },
            },
          ],
        },
      ],
      resource_sum: {
        quota_used: "15",
        quota_free: "25",
        quota_limit: "40",
        total_usage: "32",
        total_capacity: "64",
        total_free: "32",
      },
    });

    // ACT — open shared-pool-a panel
    await page.goto("/pools?all=true&view=shared-pool-a");
    await page.waitForLoadState("networkidle");

    // ASSERT — shared capacity badge visible
    const panel = page.getByRole("complementary", { name: "Pool details: shared-pool-a" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Shared", { exact: true })).toBeVisible();
    await expect(panel.getByText("Shares capacity with")).toBeVisible();
    await expect(panel.getByRole("button", { name: "shared-pool-b" })).toBeVisible();
  });

  test("clicking a shared pool chip navigates to that pool", async ({ page }) => {
    // ARRANGE — two pools sharing capacity
    await setupPools(page, {
      node_sets: [
        {
          pools: [
            {
              name: "navigate-from",
              status: PoolStatus.ONLINE,
              backend: "k8s-prod",
              description: "",
              resource_usage: {
                quota_used: "5",
                quota_free: "5",
                quota_limit: "10",
                total_usage: "16",
                total_capacity: "32",
                total_free: "16",
              },
              platforms: {
                base: {
                  description: "Base",
                  host_network_allowed: false,
                  privileged_allowed: false,
                  allowed_mounts: [],
                  default_mounts: [],
                },
              },
            },
            {
              name: "navigate-to",
              status: PoolStatus.ONLINE,
              backend: "k8s-prod",
              description: "",
              resource_usage: {
                quota_used: "3",
                quota_free: "7",
                quota_limit: "10",
                total_usage: "16",
                total_capacity: "32",
                total_free: "16",
              },
              platforms: {
                base: {
                  description: "Base",
                  host_network_allowed: false,
                  privileged_allowed: false,
                  allowed_mounts: [],
                  default_mounts: [],
                },
              },
            },
          ],
        },
      ],
      resource_sum: {
        quota_used: "8",
        quota_free: "12",
        quota_limit: "20",
        total_usage: "16",
        total_capacity: "32",
        total_free: "16",
      },
    });

    // ACT — open navigate-from panel, click the shared pool chip
    await page.goto("/pools?all=true&view=navigate-from");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: navigate-from" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: "navigate-to" })).toBeVisible();

    // Click the shared pool chip to navigate
    await panel.getByRole("button", { name: "navigate-to" }).click();

    // ASSERT — URL updated to the target pool
    await expect(page).toHaveURL(/view=navigate-to/);
  });
});

test.describe("Pool Panel Platform Selector", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows platform selector for multi-platform pool", async ({ page }) => {
    // ARRANGE — pool with multiple platforms
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "multi-plat",
          status: PoolStatus.ONLINE,
          platforms: {
            dgx: {
              description: "DGX H100 nodes",
              host_network_allowed: true,
              privileged_allowed: true,
              allowed_mounts: ["/data", "/models"],
              default_mounts: ["/workspace"],
            },
            cpu: {
              description: "CPU-only nodes",
              host_network_allowed: false,
              privileged_allowed: false,
              allowed_mounts: ["/data"],
              default_mounts: [],
            },
          },
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=multi-plat");
    await page.waitForLoadState("networkidle");

    // ASSERT — platform configuration section and selector visible
    const panel = page.getByRole("complementary", { name: "Pool details: multi-plat" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Platform Configuration")).toBeVisible();
    // Platform selector button is present (shows current platform name)
    await expect(panel.getByRole("button", { name: "Select platform" })).toBeVisible();
  });

  test("switching platform shows different config", async ({ page }) => {
    // ARRANGE — pool with two platforms with different configs
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "switch-plat",
          status: PoolStatus.ONLINE,
          default_platform: "dgx",
          platforms: {
            dgx: {
              description: "DGX H100 nodes",
              host_network_allowed: true,
              privileged_allowed: true,
              allowed_mounts: ["/dgx-data"],
              default_mounts: ["/dgx-workspace"],
            },
            cpu: {
              description: "CPU-only nodes",
              host_network_allowed: false,
              privileged_allowed: false,
              allowed_mounts: ["/cpu-data"],
              default_mounts: [],
            },
          },
        },
      ]),
    );

    // ACT — start with default platform (dgx)
    await page.goto("/pools?all=true&view=switch-plat");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: switch-plat" });
    await expect(panel).toBeVisible();

    // ASSERT — default platform (dgx) config is shown
    await expect(panel.getByText("DGX H100 nodes")).toBeVisible();
    await expect(panel.getByText("/dgx-data")).toBeVisible();

    // ACT — open the platform dropdown and select cpu
    await panel.getByRole("button", { name: "Select platform" }).click();
    await page.getByRole("menuitem", { name: /cpu/ }).click();

    // ASSERT — cpu platform config is now shown
    await expect(panel.getByText("CPU-only nodes")).toBeVisible();
    await expect(panel.getByText("/cpu-data")).toBeVisible();
  });

  test("pool description is shown in pool details section", async ({ page }) => {
    // ARRANGE — pool with a description
    await setupPools(
      page,
      createPoolResponse([
        {
          name: "described-pool",
          status: PoolStatus.ONLINE,
          description: "This pool runs ML training workloads on H100 GPUs",
        },
      ]),
    );

    // ACT
    await page.goto("/pools?all=true&view=described-pool");
    await page.waitForLoadState("networkidle");

    // ASSERT — description text is visible in the panel
    const panel = page.getByRole("complementary", { name: "Pool details: described-pool" });
    await expect(panel).toBeVisible();
    await expect(panel.getByText("This pool runs ML training workloads on H100 GPUs")).toBeVisible();
  });
});
