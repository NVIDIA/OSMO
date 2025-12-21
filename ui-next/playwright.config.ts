// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E test configuration.
 *
 * Philosophy:
 * - Tests are semantic (roles, labels) not structural (classes, DOM)
 * - Tests verify user outcomes not implementation details
 * - Tests should survive major UI refactors (virtualization, pagination, etc.)
 * - Tests run fast (parallel, single browser for CI)
 */
export default defineConfig({
  testDir: "./e2e",
  // Run tests in parallel for speed
  fullyParallel: true,
  // Fail fast - stop on first failure in CI
  forbidOnly: !!process.env.CI,
  // No retries by default - tests should be deterministic
  retries: 0,
  // Use all available workers
  workers: process.env.CI ? 2 : undefined,
  // Minimal reporting for speed
  reporter: process.env.CI ? "github" : "list",
  // Global timeout - tests should be fast
  timeout: 10_000,

  use: {
    // Base URL for navigation
    baseURL: "http://localhost:3000",
    // Collect trace only on failure for debugging
    trace: "on-first-retry",
    // No screenshots by default
    screenshot: "off",
    // No video by default
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Skip Firefox/Safari for speed - add if cross-browser bugs appear
  ],

  // Start dev server before tests
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
