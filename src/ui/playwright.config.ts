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

import { defineConfig, devices } from "@playwright/test";

// Port is resolved by scripts/test-e2e.mjs before Playwright starts and
// passed in via $PORT. Fallback to 3000 for direct `playwright test` invocations.
const parsed = parseInt(process.env.PORT ?? "", 10);
const PORT = Number.isFinite(parsed) ? parsed : 3000;
const BASE_URL = `http://localhost:${PORT}`;

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
  globalSetup: "./e2e/global-setup.ts",
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
    baseURL: BASE_URL,
    // Collect trace only on failure for debugging
    trace: "on-first-retry",
    // No screenshots by default
    screenshot: "off",
    // No video by default
    video: "off",
    // Guarantee a clean browser context per test — prevents cookies/localStorage
    // from leaking between tests when --ui "Reuse browser" is enabled.
    storageState: { cookies: [], origins: [] },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    // Skip Firefox/Safari for speed - add if cross-browser bugs appear
  ],

  // Start dev server before tests.
  // Remove stale .next/dev/lock before starting — Next.js doesn't clean it up
  // when the server crashes, which blocks a subsequent `next dev` from starting.
  webServer: {
    command: "node scripts/start-dev.mjs",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { PORT: String(PORT) },
  },
});
