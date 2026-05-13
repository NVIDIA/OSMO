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
  PoolStatus,
} from "@/mocks/factories";
import {
  setupDefaultMocks,
  setupProfile,
  setupPools,
} from "@/e2e/utils/mock-setup";

/**
 * Pool Quick Links Navigation Tests
 *
 * Tests pool panel quick links that navigate to Resources, Workflows,
 * and Occupancy pages pre-filtered by pool name.
 *
 * Architecture notes:
 * - Pool panel has 3 quick links: Resources, Workflows, Occupancy
 * - Each link pre-applies a pool filter to the destination page URL
 * - Links are rendered as Next.js Link components in the pool panel
 * - Panel is at role="complementary" with aria-label="Pool details: {name}"
 */

test.describe("Pool Quick Links Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(
      page,
      createPoolResponse([
        { name: "prod-gpu", status: PoolStatus.ONLINE },
        { name: "staging", status: PoolStatus.OFFLINE },
      ]),
    );
  });

  test("resources quick link navigates to resources filtered by pool", async ({
    page,
  }) => {
    // ACT
    await page.goto("/pools?all=true&view=prod-gpu");
    await page.waitForLoadState("networkidle");

    // Click Resources quick link in panel
    const panel = page.getByRole("complementary", {
      name: "Pool details: prod-gpu",
    });
    await expect(panel).toBeVisible();

    const resourcesLink = panel.getByRole("link", { name: /resources/i });
    await expect(resourcesLink).toBeVisible();
    await resourcesLink.click();

    // ASSERT — navigated to resources page with pool filter
    await expect(page).toHaveURL(/\/resources/);
    await expect(page).toHaveURL(/prod-gpu/);
  });

  test("workflows quick link navigates to workflows filtered by pool", async ({
    page,
  }) => {
    // ACT
    await page.goto("/pools?all=true&view=prod-gpu");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", {
      name: "Pool details: prod-gpu",
    });
    const workflowsLink = panel.getByRole("link", { name: /workflows/i });
    await expect(workflowsLink).toBeVisible();
    await workflowsLink.click();

    // ASSERT — navigated to workflows page with pool in URL
    await expect(page).toHaveURL(/\/workflows/);
    await expect(page).toHaveURL(/prod-gpu/);
  });

  test("occupancy quick link navigates to occupancy filtered by pool", async ({
    page,
  }) => {
    // ACT
    await page.goto("/pools?all=true&view=prod-gpu");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", {
      name: "Pool details: prod-gpu",
    });
    const occupancyLink = panel.getByRole("link", { name: /occupancy/i });
    await expect(occupancyLink).toBeVisible();
    await occupancyLink.click();

    // ASSERT — navigated to occupancy page with pool in URL
    await expect(page).toHaveURL(/\/occupancy/);
    await expect(page).toHaveURL(/prod-gpu/);
  });

  test("quick links show correct href attributes before clicking", async ({
    page,
  }) => {
    // ACT
    await page.goto("/pools?all=true&view=prod-gpu");
    await page.waitForLoadState("networkidle");

    const panel = page.getByRole("complementary", {
      name: "Pool details: prod-gpu",
    });
    await expect(panel).toBeVisible();

    // ASSERT — each link has pool-filtered href
    const resourcesLink = panel.getByRole("link", { name: /resources/i });
    await expect(resourcesLink).toHaveAttribute("href", /prod-gpu/);

    const workflowsLink = panel.getByRole("link", { name: /workflows/i });
    await expect(workflowsLink).toHaveAttribute("href", /prod-gpu/);

    const occupancyLink = panel.getByRole("link", { name: /occupancy/i });
    await expect(occupancyLink).toHaveAttribute("href", /prod-gpu/);
  });
});
