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
 * Pool Journey Tests
 *
 * Architecture notes:
 * - Pools live at /pools (flat table with side panel, no /pools/[name] routes)
 * - Pool selection: click row → ?view=pool-name opens the details panel
 * - Panel is an <aside> (role="complementary", aria-label="Pool details: {name}")
 * - Panel shows: GPU quota/capacity, quick links, pool details, platform config
 * - ?all=true opts out of the default "My Pools" scope filter
 */

test.describe("Pools List", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("renders all pools", async ({ page }) => {
    await setupPools(page, createPoolResponse([
      { name: "production", status: PoolStatus.ONLINE },
      { name: "staging", status: PoolStatus.ONLINE },
      { name: "maintenance", status: PoolStatus.OFFLINE },
    ]));

    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("production").first()).toBeVisible();
    await expect(page.getByText("staging").first()).toBeVisible();
    await expect(page.getByText("maintenance").first()).toBeVisible();
  });

  test("clicking a pool row opens the details panel", async ({ page }) => {
    await setupPools(page, createPoolResponse([{ name: "my-pool", status: PoolStatus.ONLINE }]));

    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await page.getByText("my-pool").first().click();

    // URL state reflects the selection
    await expect(page).toHaveURL(/view=my-pool/);

    // Panel opens with pool name
    const panel = page.getByRole("complementary", { name: "Pool details: my-pool" });
    await expect(panel).toBeVisible();
  });

  test("navigating directly to a pool opens its panel", async ({ page }) => {
    await setupPools(page, createPoolResponse([{ name: "direct-pool", status: PoolStatus.ONLINE }]));

    await page.goto("/pools?all=true&view=direct-pool");
    await page.waitForLoadState("networkidle");

    // Panel is open without any clicking
    const panel = page.getByRole("complementary", { name: "Pool details: direct-pool" });
    await expect(panel).toBeVisible();
  });

  test("search creates a filter chip for the typed pool name", async ({ page }) => {
    await setupPools(page, createPoolResponse([
      { name: "production", status: PoolStatus.ONLINE },
      { name: "development", status: PoolStatus.ONLINE },
    ]));

    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // The search input is a combobox (chip-based filter, not free-text search)
    const searchInput = page.getByRole("combobox");
    await searchInput.fill("production");
    await searchInput.press("Enter");

    // Pressing Enter commits a chip — the URL reflects the active filter with the value
    await expect(page).toHaveURL(/f=pool(%3A|:)production/);
    // The matched pool remains visible
    await expect(page.getByText("production").first()).toBeVisible();
    // Non-matching pool is filtered out
    await expect(page.getByText("development")).not.toBeVisible();
  });
});

test.describe("Pool Panel", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("shows pool name in panel header", async ({ page }) => {
    await setupPools(page, createPoolResponse([{ name: "gpu-cluster", status: PoolStatus.ONLINE }]));

    await page.goto("/pools?all=true&view=gpu-cluster");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: gpu-cluster" });
    await expect(panel.getByRole("heading").first()).toContainText("gpu-cluster");
  });

  test("shows GPU quota and capacity sections", async ({ page }) => {
    await setupPools(page, createPoolResponse([
      {
        name: "gpu-cluster",
        status: PoolStatus.ONLINE,
        resource_usage: {
          quota_used: "50",
          quota_free: "50",
          quota_limit: "100",
          total_usage: "64",
          total_capacity: "128",
          total_free: "64",
        },
      },
    ]));

    await page.goto("/pools?all=true&view=gpu-cluster");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: gpu-cluster" });
    await expect(panel.getByText("GPU Quota")).toBeVisible();
    await expect(panel.getByText("GPU Capacity")).toBeVisible();
  });

  test("panel has quick links to Resources, Workflows, and Occupancy", async ({ page }) => {
    await setupPools(page, createPoolResponse([{ name: "linked-pool", status: PoolStatus.ONLINE }]));

    await page.goto("/pools?all=true&view=linked-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: linked-pool" });
    await expect(panel.getByRole("link", { name: /resources/i })).toBeVisible();
    await expect(panel.getByRole("link", { name: /workflows/i })).toBeVisible();
    await expect(panel.getByRole("link", { name: /occupancy/i })).toBeVisible();
  });

  test("resources quick link points to the correct pool filter", async ({ page }) => {
    await setupPools(page, createPoolResponse([{ name: "my-pool", status: PoolStatus.ONLINE }]));

    await page.goto("/pools?all=true&view=my-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: my-pool" });
    const resourcesLink = panel.getByRole("link", { name: /resources/i });
    await expect(resourcesLink).toHaveAttribute("href", /pool.*my-pool|my-pool.*pool/);
  });

  test("shows pool description when provided", async ({ page }) => {
    await setupPools(page, createPoolResponse([
      { name: "described-pool", status: PoolStatus.ONLINE, description: "High-performance GPU cluster for AI training" },
    ]));

    await page.goto("/pools?all=true&view=described-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: described-pool" });
    await expect(panel.getByText("High-performance GPU cluster for AI training")).toBeVisible();
  });

  test("shows platform configuration section for pools with platforms", async ({ page }) => {
    await setupPools(page, createPoolResponse([
      {
        name: "platform-pool",
        status: PoolStatus.ONLINE,
        platforms: {
          dgx: { description: "DGX H100 nodes" },
          cpu: { description: "CPU-only nodes" },
        },
      },
    ]));

    await page.goto("/pools?all=true&view=platform-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: platform-pool" });
    await expect(panel.getByText(/platform configuration/i)).toBeVisible();
  });

  test("closes with the close button and clears URL state", async ({ page }) => {
    await setupPools(page, createPoolResponse([{ name: "closeable-pool", status: PoolStatus.ONLINE }]));

    await page.goto("/pools?all=true&view=closeable-pool");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", { name: "Pool details: closeable-pool" });
    await expect(panel).toBeVisible();

    await page.getByRole("button", { name: "Close panel" }).click();

    await expect(page).not.toHaveURL(/view=/);
    await expect(panel).not.toBeVisible();
  });
});

test.describe("Pool Edge Cases", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
  });

  test("offline pool is visible in the list", async ({ page }) => {
    await setupPools(page, createPoolResponse([
      { name: "offline-pool", status: PoolStatus.OFFLINE, description: "Down for maintenance" },
    ]));

    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    await expect(page.getByText("offline-pool").first()).toBeVisible();
  });

  test("shows error state when pool API fails", async ({ page }) => {
    await setupPools(page, { status: 400, detail: "Bad request" });

    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Page must not crash — should show an error state
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByText(/unable to load/i)).toBeVisible();
  });
});
