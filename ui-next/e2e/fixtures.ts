// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { test as base, type Page } from "@playwright/test";
import type { PoolResponse, ResourcesResponse } from "@/lib/api/generated";

// Default data for when tests don't specify their own
import {
  mockPools,
  mockResources,
  mockVersion,
  mockLoginInfoAuthDisabled,
  mockLoginInfoAuthEnabled,
  mockIdToken,
  mockRefreshToken,
  mockTokenRefreshSuccess,
  mockTokenRefreshFailureInvalid,
  mockApiUnauthorized,
  mockApiForbidden,
} from "./mocks/data";

// =============================================================================
// Types for test scenario data
// =============================================================================

export interface TestScenarioData {
  pools?: PoolResponse;
  resources?: ResourcesResponse;
  version?: { major: number; minor: number; revision: number; hash?: string };
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
      if (scenarioState.auth.apiError) {
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
      if (scenarioState.auth.apiError) {
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

// Re-export factories for inline test data creation
export {
  createPoolResourceUsage,
  createPoolResponse,
  createResourceEntry,
  createResourcesResponse,
  createLoginInfo,
  createVersion,
  createProductionScenario,
  createEmptyScenario,
  createHighUtilizationScenario,
  // Generated enums - use these instead of string literals in tests
  BackendResourceType,
  PoolStatus,
} from "./mocks/factories";

// Re-export tokens for auth scenarios
export { mockIdToken, mockRefreshToken } from "./mocks/data";
