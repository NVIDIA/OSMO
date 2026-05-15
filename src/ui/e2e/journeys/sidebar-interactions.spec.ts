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
 * Sidebar Interaction Journey Tests
 *
 * Architecture notes:
 * - AppSidebar uses shadcn/ui Sidebar primitives (collapsible="icon")
 * - Collapse toggle button: shows "Collapse" label + keyboard shortcut (Cmd/Ctrl+B)
 * - Collapsed state: sidebar has data-state="collapsed", shows only icons
 * - Expanded state: sidebar has data-state="expanded", shows labels
 * - OSMO logo/text in sidebar header
 * - Footer contains: CLI Install (hover card), Documentation link, Collapse button
 * - Mobile: hamburger trigger in header, sidebar opens as Sheet overlay
 */

test.describe("Sidebar Collapse", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("sidebar starts in expanded state", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — sidebar wrapper div has data-state="expanded"
    // Note: data-state lives on the outer wrapper (group peer div), not on [data-sidebar="sidebar"]
    const sidebarWrapper = page.locator('[data-state="expanded"][data-slot="sidebar"]').first();
    await expect(sidebarWrapper).toBeVisible();
  });

  test("collapse button is visible in sidebar footer", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — collapse button with "Collapse" text is visible
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar.getByText("Collapse")).toBeVisible();
  });

  test("clicking collapse button collapses the sidebar", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // data-state lives on the outer wrapper div with data-slot="sidebar"
    const sidebarWrapper = page.locator('[data-slot="sidebar"][data-state]').first();
    const collapseButton = page.getByRole("button", { name: /Collapse/ });
    await collapseButton.click();

    // ASSERT — sidebar transitions to collapsed state
    await expect(sidebarWrapper).toHaveAttribute("data-state", "collapsed");
  });

  test("collapsed sidebar hides navigation labels", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const sidebar = page.locator('[data-sidebar="sidebar"]').first();

    // Verify labels are visible when expanded
    await expect(sidebar.getByRole("link", { name: "Pools", exact: true })).toBeVisible();

    // Collapse
    const collapseButton = page.getByRole("button", { name: /Collapse/ });
    await collapseButton.click();

    // ASSERT — the "Collapse" text is hidden (opacity-0 + w-0)
    const sidebarWrapper = page.locator('[data-slot="sidebar"][data-state]').first();
    await expect(sidebarWrapper).toHaveAttribute("data-state", "collapsed");

    // The text labels get opacity-0 + w-0, so they are not visible
    await expect(sidebar.getByText("Collapse")).not.toBeVisible();
  });

  test("keyboard shortcut Cmd+B toggles sidebar", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    const sidebarWrapper = page.locator('[data-slot="sidebar"][data-state]').first();
    await expect(sidebarWrapper).toHaveAttribute("data-state", "expanded");

    // Press Cmd+B (or Ctrl+B on Linux/Windows)
    await page.keyboard.press("Meta+b");

    // ASSERT — sidebar collapses
    await expect(sidebarWrapper).toHaveAttribute("data-state", "collapsed");

    // Press again to expand
    await page.keyboard.press("Meta+b");

    // ASSERT — sidebar expands
    await expect(sidebarWrapper).toHaveAttribute("data-state", "expanded");
  });
});

test.describe("Sidebar Branding", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("sidebar header shows OSMO branding", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — OSMO text in sidebar header
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    await expect(sidebar.getByText("OSMO")).toBeVisible();
  });

  test("sidebar header logo links to home", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — logo link in sidebar header goes to /
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    const logoLink = sidebar.locator('a[href="/"]').first();
    await expect(logoLink).toBeVisible();
  });
});

test.describe("Sidebar Keyboard Shortcut Display", () => {
  test.beforeEach(async ({ page }) => {
    await setupDefaultMocks(page);
    await setupProfile(page);
    await setupPools(page, createPoolResponse([{ name: "test-pool", status: PoolStatus.ONLINE }]));
  });

  test("collapse button shows keyboard shortcut badge", async ({ page }) => {
    // ACT
    await page.goto("/pools?all=true");
    await page.waitForLoadState("networkidle");

    // ASSERT — kbd element with shortcut is visible near collapse button
    const sidebar = page.locator('[data-sidebar="sidebar"]').first();
    const kbd = sidebar.locator("kbd");
    await expect(kbd.first()).toBeVisible();
  });
});
