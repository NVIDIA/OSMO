// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Error Handling E2E Tests
 *
 * Tests for error UI across different scenarios:
 * 1. Render errors (caught by Next.js error.tsx)
 * 2. API errors (caught by React Query, shown inline)
 *
 * Run with Playwright UI to preview error states:
 *   pnpm test:e2e --ui
 */

import { test as base, expect } from "@playwright/test";

// Use base test without fixtures to have full control over route mocking
const test = base;

// =============================================================================
// API Errors - Inline error display via <ApiError />
// =============================================================================

test.describe("API Errors (Inline)", () => {
  test("pools page shows inline error when API returns 500", async ({ page }) => {
    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Mock pools to return 500 error
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Internal server error: database connection failed",
        }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/pools");

    // Should show the error alert (pools page has custom error handling)
    await expect(page.getByText("Unable to fetch pools")).toBeVisible();
  });

  test("resources page shows inline error when API fails", async ({ page }) => {
    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Mock pools (needed for resources page)
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: [] }),
      });
    });

    // Mock resources to return error
    await page.route("**/api/resources*", async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Service temporarily unavailable",
        }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/resources");

    // Should show inline API error
    await expect(page.getByText("Unable to load resources")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("pool detail page shows inline error when API fails", async ({ page }) => {
    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Mock pool_quota to return error for specific pool
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Pool not found",
        }),
      });
    });

    // Mock resources to also fail
    await page.route("**/api/resources*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          detail: "Pool not found",
        }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/pools/test-pool");

    // Should show inline API error
    await expect(page.getByText("Unable to load pool data")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("retry button is clickable", async ({ page }) => {
    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Mock pools
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: [] }),
      });
    });

    // Mock resources to always fail
    await page.route("**/api/resources*", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ detail: "Permanent failure" }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/resources");

    // Wait for error UI to appear (React Query may retry a few times first)
    await expect(page.getByText("Unable to load resources")).toBeVisible({ timeout: 15000 });

    // Verify retry button exists and is clickable
    const retryButton = page.getByRole("button", { name: "Retry" });
    await expect(retryButton).toBeVisible();
    await expect(retryButton).toBeEnabled();
  });
});

// =============================================================================
// Render Errors - Caught by error.tsx boundaries
// =============================================================================

test.describe("Render Errors (error.tsx)", () => {
  test("dashboard error: shows error UI when pools API returns malformed data", async ({ page }) => {
    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Return malformed data that will cause transform to crash
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        // node_sets should be an array, this will cause .flatMap() to fail
        body: JSON.stringify({ node_sets: "this should be an array" }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/pools");

    // Should show error boundary UI
    await expect(page.getByRole("heading", { name: /something went wrong|couldn't load/i })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("copy button copies error details", async ({ page, context }) => {
    // Grant clipboard permissions
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Return malformed data
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: "invalid" }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/pools");

    // Wait for error UI
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    // Expand stack trace first to reveal copy button
    const stackTraceToggle = page.getByRole("button", { name: /stack trace/i });
    await expect(stackTraceToggle).toBeVisible();
    await stackTraceToggle.click();

    // Now click copy button
    const copyButton = page.getByRole("button", { name: /copy/i });
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    // Should show "Copied" feedback
    await expect(page.getByText("Copied")).toBeVisible();
  });

  test("pools error shows 'View all pools' navigation", async ({ page }) => {
    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Return malformed data
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: "invalid" }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/pools");

    // Pools-specific error page should show "View all pools" button
    await expect(page.getByRole("link", { name: "View all pools" })).toBeVisible();
  });
});

// =============================================================================
// Error Recovery
// =============================================================================

test.describe("Error Recovery", () => {
  test("pools error 'View all pools' navigates correctly", async ({ page }) => {
    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Return malformed data
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: "invalid" }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/pools");

    // Wait for pools-specific error UI
    await expect(page.getByRole("link", { name: "View all pools" })).toBeVisible();

    // Click the link
    await page.getByRole("link", { name: "View all pools" }).click();

    // Should navigate to /pools (the link reloads the page)
    await expect(page).toHaveURL("/pools");
  });

  test("'Try again' button is clickable on error boundary", async ({ page }) => {
    // Mock auth as disabled
    await page.route("**/auth/login_info*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ auth_enabled: false }),
      });
    });

    // Return malformed data to trigger error boundary
    await page.route("**/api/pool_quota*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ node_sets: "invalid" }),
      });
    });

    // Mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ major: 1, minor: 0, revision: 0 }),
      });
    });

    await page.goto("/pools");

    // Should show error boundary UI
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

    // Verify button is enabled and clickable
    const tryAgainButton = page.getByRole("button", { name: "Try again" });
    await expect(tryAgainButton).toBeEnabled();

    // Click should not throw (button works)
    await tryAgainButton.click();
  });
});
