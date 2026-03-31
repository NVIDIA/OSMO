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

import { test as base, expect as baseExpect, type Page } from "@playwright/test";
import type { PoolResponse, ResourcesResponse } from "@/lib/api/generated";
import type { Version } from "@/lib/api/adapter/types";

import {
  createLoginInfo,
  createVersion,
  createPoolResponse,
  createResourcesResponse,
  mockIdToken,
  mockRefreshToken,
  BackendResourceType,
  PoolStatus,
} from "@/mocks/factories";

const GiB_IN_KiB = 1024 * 1024;
const TiB_IN_BYTES = 1024 * 1024 * 1024 * 1024;

const mockLoginInfoAuthDisabled = createLoginInfo({ auth_enabled: false });
const mockLoginInfoAuthEnabled = createLoginInfo({ auth_enabled: true });

const mockPools = createPoolResponse([
  {
    name: "production",
    description: "Production GPU cluster",
    status: PoolStatus.ONLINE,
    resource_usage: { quota_used: "45", quota_free: "55", quota_limit: "100", total_usage: "128", total_capacity: "256", total_free: "128" },
    platforms: {
      dgx: { description: "DGX A100 nodes", host_network_allowed: true },
      dgx_h100: { description: "DGX H100 nodes", host_network_allowed: true },
    },
  },
  {
    name: "development",
    description: "Development environment",
    status: PoolStatus.ONLINE,
    resource_usage: { quota_used: "12", quota_free: "38", quota_limit: "50", total_usage: "24", total_capacity: "64", total_free: "40" },
    platforms: { base: { description: "Standard nodes" }, gpu: { description: "GPU nodes" } },
  },
  {
    name: "maintenance",
    description: "Under maintenance",
    status: PoolStatus.MAINTENANCE,
    resource_usage: { quota_used: "0", quota_free: "0", quota_limit: "20", total_usage: "0", total_capacity: "0", total_free: "0" },
    platforms: {},
  },
]);

const mockResources = createResourcesResponse([
  {
    hostname: "gpu-node-001.prod.example.com",
    resource_type: BackendResourceType.SHARED,
    exposed_fields: { node: "dgx-a100-001", "pool/platform": ["production/dgx", "development/gpu"] },
    allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 2 * TiB_IN_BYTES },
    usage_fields: { gpu: 6, cpu: 96, memory: 384 * GiB_IN_KiB, storage: 1.2 * TiB_IN_BYTES },
    pool_platform_labels: { production: ["dgx"], development: ["gpu"] },
  },
  {
    hostname: "gpu-node-002.prod.example.com",
    resource_type: BackendResourceType.RESERVED,
    exposed_fields: { node: "dgx-a100-002", "pool/platform": ["production/dgx"] },
    allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 2 * TiB_IN_BYTES },
    usage_fields: { gpu: 8, cpu: 128, memory: 480 * GiB_IN_KiB, storage: 1.8 * TiB_IN_BYTES },
    pool_platform_labels: { production: ["dgx"] },
  },
  {
    hostname: "gpu-node-003.prod.example.com",
    resource_type: BackendResourceType.RESERVED,
    exposed_fields: { node: "dgx-h100-001", "pool/platform": ["production/dgx_h100"] },
    allocatable_fields: { gpu: 8, cpu: 256, memory: 1024 * GiB_IN_KiB, storage: 4 * TiB_IN_BYTES },
    usage_fields: { gpu: 8, cpu: 256, memory: 1000 * GiB_IN_KiB, storage: 3.5 * TiB_IN_BYTES },
    pool_platform_labels: { production: ["dgx_h100"] },
  },
  {
    hostname: "gpu-node-004.dev.example.com",
    resource_type: BackendResourceType.SHARED,
    exposed_fields: { node: "dev-gpu-001", "pool/platform": ["development/gpu", "development/base"] },
    allocatable_fields: { gpu: 4, cpu: 64, memory: 256 * GiB_IN_KiB, storage: 1 * TiB_IN_BYTES },
    usage_fields: { gpu: 2, cpu: 32, memory: 128 * GiB_IN_KiB, storage: 0.3 * TiB_IN_BYTES },
    pool_platform_labels: { development: ["gpu", "base"] },
  },
  {
    hostname: "gpu-node-005.prod.example.com",
    resource_type: BackendResourceType.SHARED,
    conditions: ["Ready", "SchedulingDisabled", "MemoryPressure"],
    exposed_fields: { node: "dgx-a100-003", "pool/platform": ["production/dgx"] },
    allocatable_fields: { gpu: 8, cpu: 128, memory: 512 * GiB_IN_KiB, storage: 2 * TiB_IN_BYTES },
    usage_fields: { gpu: 8, cpu: 128, memory: 510 * GiB_IN_KiB, storage: 1.9 * TiB_IN_BYTES },
    pool_platform_labels: { production: ["dgx"] },
  },
]);

const mockVersion = createVersion();

const mockTokenRefreshSuccess = { isFailure: false, id_token: mockIdToken, refresh_token: mockRefreshToken };
const mockTokenRefreshFailureInvalid = { isFailure: true, error: "invalid_grant", authError: "invalid_grant" };
const mockApiUnauthorized = { error: "Unauthorized", message: "Authentication required", statusCode: 401 };
const mockApiForbidden = { error: "Forbidden", message: "You do not have permission to access this resource", statusCode: 403 };

// =============================================================================
// Types for test scenario data
// =============================================================================

export interface ApiErrorScenario {
  status: number;
  detail: string;
}

export interface TestScenarioData {
  pools?: PoolResponse;
  resources?: ResourcesResponse;
  version?: Version;
  /** Force pools API to return an error */
  poolsError?: ApiErrorScenario;
  /** Force resources API to return an error */
  resourcesError?: ApiErrorScenario;
}

export interface AuthScenarioData {
  authEnabled?: boolean;
  tokens?: { idToken: string; refreshToken: string };
  refreshResult?: "success" | "failure";
  apiError?: "unauthorized" | "forbidden" | null;
}

// =============================================================================
// Shared state for scenario customization
// =============================================================================

interface ScenarioState {
  data: TestScenarioData;
  auth: AuthScenarioData;
}

// =============================================================================
// Core fixture - ALWAYS mocks by default (auth disabled)
// =============================================================================

/**
 * Extended test fixture that automatically mocks API calls.
 *
 * By default:
 * - Auth is DISABLED (no login required)
 * - Uses default mock pools and resources
 *
 * Tests can customize using withData() or withAuth():
 *
 * ```typescript
 * test("shows custom pools", async ({ page, withData }) => {
 *   await withData({ pools: createPoolResponse([...]) });
 *   await page.goto("/pools");
 * });
 *
 * test("requires login", async ({ page, withAuth }) => {
 *   await withAuth({ authEnabled: true });
 *   await page.goto("/");
 * });
 * ```
 */
export const test = base.extend<{
  scenarioState: ScenarioState;
  withData: (data: TestScenarioData) => Promise<void>;
  withAuth: (auth: AuthScenarioData) => Promise<void>;
}>({
  // Shared state for the test
  scenarioState: async ({}, use) => {
    await use({
      data: {},
      auth: { authEnabled: false },
    });
  },

  // Auto-setup all mocks before each test
  page: async ({ page, scenarioState }, use) => {
    // Always mock auth endpoint (auth disabled by default)
    await page.route("**/auth/login_info*", async (route) => {
      const authEnabled = scenarioState.auth.authEnabled ?? false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(authEnabled ? mockLoginInfoAuthEnabled : mockLoginInfoAuthDisabled),
      });
    });

    // Always mock pools
    await page.route("**/api/pool_quota*", async (route) => {
      // Check for explicit pool error scenario
      if (scenarioState.data.poolsError) {
        await route.fulfill({
          status: scenarioState.data.poolsError.status,
          contentType: "application/json",
          body: JSON.stringify({ detail: scenarioState.data.poolsError.detail }),
        });
      } else if (scenarioState.auth.apiError) {
        const status = scenarioState.auth.apiError === "forbidden" ? 403 : 401;
        const body = scenarioState.auth.apiError === "forbidden" ? mockApiForbidden : mockApiUnauthorized;
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(scenarioState.data.pools ?? mockPools),
        });
      }
    });

    // Always mock resources
    await page.route("**/api/resources*", async (route) => {
      // Check for explicit resources error scenario
      if (scenarioState.data.resourcesError) {
        await route.fulfill({
          status: scenarioState.data.resourcesError.status,
          contentType: "application/json",
          body: JSON.stringify({ detail: scenarioState.data.resourcesError.detail }),
        });
      } else if (scenarioState.auth.apiError) {
        const status = scenarioState.auth.apiError === "forbidden" ? 403 : 401;
        const body = scenarioState.auth.apiError === "forbidden" ? mockApiForbidden : mockApiUnauthorized;
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      } else {
        const url = new URL(route.request().url());
        const pools = url.searchParams.getAll("pools");
        const allPools = url.searchParams.get("all_pools");
        const resources = scenarioState.data.resources ?? mockResources;

        // Filter by pool if requested
        if (pools.length > 0 && allPools !== "true") {
          const filtered = {
            resources: resources.resources?.filter((r) => {
              const resourcePools = ((r.exposed_fields as Record<string, unknown>)?.["pool/platform"] as string[]) || [];
              return resourcePools.some((pp) =>
                pools.some((pool) => pp.startsWith(`${pool}/`))
              );
            }) ?? [],
          };
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(filtered),
          });
        } else {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(resources),
          });
        }
      }
    });

    // Always mock version
    await page.route("**/api/version*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(scenarioState.data.version ?? mockVersion),
      });
    });

    // Mock token refresh
    await page.route("**/auth/refresh_token*", async (route) => {
      if (scenarioState.auth.refreshResult === "failure") {
        await route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify(mockTokenRefreshFailureInvalid),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockTokenRefreshSuccess),
        });
      }
    });

    // Mock OAuth initiate
    await page.route("**/auth/initiate*", async (route) => {
      const url = new URL(route.request().url());
      const returnUrl = url.searchParams.get("return_url") || "/";
      const successUrl = new URL("/auth/success", url.origin);
      successUrl.searchParams.set("id_token", mockIdToken);
      successUrl.searchParams.set("refresh_token", mockRefreshToken);
      successUrl.searchParams.set("redirect_to", returnUrl);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ redirectTo: successUrl.toString() }),
      });
    });

    await use(page);
  },

  // Helper to customize data (call BEFORE page.goto)
  withData: async ({ scenarioState }, use) => {
    const setData = async (data: TestScenarioData) => {
      Object.assign(scenarioState.data, data);
    };
    await use(setData);
  },

  // Helper to customize auth (call BEFORE page.goto)
  withAuth: async ({ scenarioState, context }, use) => {
    const setAuth = async (auth: AuthScenarioData) => {
      Object.assign(scenarioState.auth, auth);

      // Inject tokens into localStorage if provided
      if (auth.tokens) {
        await context.addInitScript(
          ({ idToken, refreshToken }) => {
            localStorage.setItem("IdToken", idToken);
            localStorage.setItem("RefreshToken", refreshToken);
          },
          auth.tokens
        );
      }
    };
    await use(setAuth);
  },
});

// =============================================================================
// Helper to expand filters if collapsed (for responsive layouts)
// =============================================================================

/**
 * Expands the filters panel if it's collapsed due to responsive auto-collapse.
 * Call this before interacting with filter controls.
 * 
 * This function clicks the expand button and waits for the panel to expand,
 * which also pins the filters to prevent auto-collapse during the test.
 */
export async function expandFiltersIfCollapsed(page: Page) {
  // Look for the collapsed state by checking aria-expanded attribute
  const filterToggle = page.getByRole("button", { name: /Filters & Summary/i }).first();
  
  // Wait for the button to be visible
  try {
    await filterToggle.waitFor({ state: "visible", timeout: 3000 });
  } catch {
    // No filter toggle found - page may not have collapsible filters
    return;
  }
  
  // Check if filters are collapsed (aria-expanded="false")
  const isExpanded = await filterToggle.getAttribute("aria-expanded");
  
  if (isExpanded === "false") {
    // Click to expand and pin
    await filterToggle.click();
    // Wait for animation to complete
    await page.waitForTimeout(300);
    // Verify expansion happened
    await baseExpect(filterToggle).toHaveAttribute("aria-expanded", "true", { timeout: 3000 });
  }
}

// =============================================================================
// Helper to complete OAuth login
// =============================================================================

export async function completeOAuthLogin(page: Page, returnUrl = "/") {
  const baseUrl = new URL(page.url()).origin || "http://localhost:3001";
  const successUrl = new URL("/auth/success", baseUrl);
  successUrl.searchParams.set("id_token", mockIdToken);
  successUrl.searchParams.set("refresh_token", mockRefreshToken);
  successUrl.searchParams.set("redirect_to", returnUrl);
  await page.goto(successUrl.toString());

  // Wait for redirect with longer timeout
  await page.waitForURL((url) => url.pathname === returnUrl || url.pathname.startsWith(returnUrl), {
    timeout: 10000,
  });
}

// =============================================================================
// Exports
// =============================================================================

export { expect } from "@playwright/test";

export {
  createPoolResourceUsage,
  createPoolResponse,
  createResourceEntry,
  createResourcesResponse,
  createLoginInfo,
  createVersion,
  BackendResourceType,
  PoolStatus,
  mockIdToken,
  mockRefreshToken,
} from "@/mocks/factories";
