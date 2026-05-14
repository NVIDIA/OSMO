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
  createResourcesResponse,
  BackendResourceType,
} from "@/mocks/factories";
import { setupDefaultMocks, setupResources, setupProfile } from "@/e2e/utils/mock-setup";

/**
 * Display Mode Toggle Tests
 *
 * The DisplayModeToggle component lives in the resources toolbar and allows
 * users to switch between "Show Available" (free mode) and "Show Used" views.
 *
 * Architecture notes:
 * - Component: src/components/data-table/display-mode-toggle.tsx
 * - Persisted in localStorage via Zustand (shared-preferences-store)
 * - Default mode is "free" (show available)
 * - Toggle is a SemiStatefulButton that shows current state icon + next state label
 * - aria-label reflects current state: "Currently showing available" or "Currently showing used"
 */

test.describe("Display Mode Toggle — Resources", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupResources(
      page,
      createResourcesResponse([
        {
          hostname: "gpu-node-001.cluster.local",
          resource_type: BackendResourceType.SHARED,
          exposed_fields: { node: "gpu-node-001", "pool/platform": ["prod/dgx"] },
          pool_platform_labels: { prod: ["dgx"] },
          allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * 1024 * 1024, storage: 2e12 },
          usage_fields: { gpu: 6, cpu: 96, memory: 384 * 1024 * 1024, storage: 1e12 },
        },
      ]),
    );
  });

  test("display mode toggle button is visible in resources toolbar", async ({ page }) => {
    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — the toggle button is visible with default "currently showing available" state
    const toggleButton = page.getByRole("button", { name: /currently showing/i });
    await expect(toggleButton).toBeVisible();
  });

  test("default mode shows 'Currently showing available' label", async ({ page }) => {
    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // ASSERT — default mode is free/available
    const toggleButton = page.getByRole("button", { name: /currently showing available/i });
    await expect(toggleButton).toBeVisible();
  });

  test("clicking toggle switches to 'Currently showing used' mode", async ({ page }) => {
    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Click the display mode toggle
    const toggleButton = page.getByRole("button", { name: /currently showing available/i });
    await toggleButton.click();

    // ASSERT — now showing used mode
    await expect(page.getByRole("button", { name: /currently showing used/i })).toBeVisible();
  });

  test("clicking toggle twice returns to available mode", async ({ page }) => {
    // ACT
    await page.goto("/resources");
    await page.waitForLoadState("networkidle");

    // Toggle to used mode
    const toggleButton = page.getByRole("button", { name: /currently showing available/i });
    await toggleButton.click();
    await expect(page.getByRole("button", { name: /currently showing used/i })).toBeVisible();

    // Toggle back to free/available mode
    await page.getByRole("button", { name: /currently showing used/i }).click();

    // ASSERT — back to available mode
    await expect(page.getByRole("button", { name: /currently showing available/i })).toBeVisible();
  });
});
