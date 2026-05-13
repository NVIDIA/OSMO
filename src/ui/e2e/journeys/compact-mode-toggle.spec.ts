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
  setupPools,
  setupProfile,
} from "@/e2e/utils/mock-setup";

/**
 * Compact Mode Toggle Tests
 *
 * The TableToolbar includes a compact/comfortable view toggle (SemiStatefulButton)
 * that persists state in localStorage via Zustand shared-preferences-store.
 *
 * Architecture notes:
 * - Component: src/components/data-table/table-toolbar.tsx
 * - Uses useCompactMode() hook (hydration-safe)
 * - aria-label: "Currently in compact view" or "Currently in comfortable view"
 * - Toggle label: "Switch to Compact" or "Switch to Comfortable"
 * - Affects row height across all table pages (Pools, Resources, Workflows, etc.)
 */

test.describe("Compact Mode Toggle — Pools Page", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(
      page,
      createPoolResponse([
        { name: "prod-pool", status: PoolStatus.ONLINE },
        { name: "dev-pool", status: PoolStatus.ONLINE },
      ]),
    );
  });

  test("compact mode toggle button is visible in toolbar", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — the toggle button is visible with default "comfortable" state
    const toggleButton = page.getByRole("button", { name: /currently in comfortable view/i });
    await expect(toggleButton).toBeVisible();
  });

  test("default mode shows 'Currently in comfortable view' label", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — default is comfortable (not compact)
    await expect(
      page.getByRole("button", { name: /currently in comfortable view/i }),
    ).toBeVisible();
  });

  test("clicking toggle switches to compact view", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Click the compact mode toggle
    const toggleButton = page.getByRole("button", { name: /currently in comfortable view/i });
    await toggleButton.click();

    // ASSERT — now in compact mode
    await expect(
      page.getByRole("button", { name: /currently in compact view/i }),
    ).toBeVisible();
  });

  test("clicking toggle twice returns to comfortable view", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // Toggle to compact
    const toggleButton = page.getByRole("button", { name: /currently in comfortable view/i });
    await toggleButton.click();
    await expect(
      page.getByRole("button", { name: /currently in compact view/i }),
    ).toBeVisible();

    // Toggle back to comfortable
    await page.getByRole("button", { name: /currently in compact view/i }).click();

    // ASSERT — back to comfortable
    await expect(
      page.getByRole("button", { name: /currently in comfortable view/i }),
    ).toBeVisible();
  });
});
