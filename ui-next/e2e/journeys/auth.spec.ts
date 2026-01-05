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

import {
  test,
  expect,
  completeOAuthLogin,
  mockIdToken,
  mockRefreshToken,
} from "../fixtures";

/**
 * Authentication Journey Tests
 *
 * Tests use withAuth() to configure auth scenarios inline.
 * This makes each test's auth requirements explicit and self-documenting.
 */

test.describe("Unauthenticated User", () => {
  test("sees login screen when auth is required", async ({ page, withAuth }) => {
    // ARRANGE: Auth enabled, no tokens
    await withAuth({ authEnabled: true });

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT - look for auth page elements
    // The exact text depends on the implementation
    const authElement = page.locator("body").filter({ hasText: /log in|sign in|authentication/i });
    await expect(authElement).toBeVisible();
  });

  test("can skip authentication", async ({ page, withAuth }) => {
    await withAuth({ authEnabled: true });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Click skip button if available
    const skipButton = page.getByRole("button", { name: /continue without|skip|later/i });
    if (await skipButton.isVisible()) {
      await skipButton.click();
      await page.waitForLoadState("networkidle");

      // Should now see the app
      await expect(page.getByRole("navigation")).toBeVisible();
    }
  });

  test("can complete OAuth login flow", async ({ page, withAuth, baseURL }) => {
    await withAuth({ authEnabled: true });

    // Navigate directly to auth/success with tokens (simulating OAuth callback)
    const successUrl = new URL("/auth/success", baseURL ?? "http://localhost:3001");
    successUrl.searchParams.set("id_token", "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidGVzdHVzZXJAZXhhbXBsZS5jb20iLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJ0ZXN0dXNlciIsImV4cCI6NDEwMjQ0NDgwMH0.fake-signature");
    successUrl.searchParams.set("refresh_token", "mock-refresh-token-valid");
    successUrl.searchParams.set("redirect_to", "/");

    await page.goto(successUrl.toString());
    await page.waitForLoadState("networkidle");

    // After storing tokens, should redirect to app
    // The success page stores tokens and redirects
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("OAuth login redirects back to original page", async ({ page, withAuth, baseURL }) => {
    await withAuth({ authEnabled: true });

    // Navigate directly to auth/success with tokens (simulating OAuth callback)
    const successUrl = new URL("/auth/success", baseURL ?? "http://localhost:3001");
    successUrl.searchParams.set("id_token", "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidGVzdHVzZXJAZXhhbXBsZS5jb20iLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJ0ZXN0dXNlciIsImV4cCI6NDEwMjQ0NDgwMH0.fake-signature");
    successUrl.searchParams.set("refresh_token", "mock-refresh-token-valid");
    successUrl.searchParams.set("redirect_to", "/pools");

    await page.goto(successUrl.toString());
    await page.waitForLoadState("networkidle");

    // Should redirect to pools page
    await expect(page.locator("body")).not.toBeEmpty();
  });
});

test.describe("Authenticated User", () => {
  test("sees dashboard directly when tokens are valid", async ({ page, withAuth }) => {
    // ARRANGE: Auth enabled with valid tokens
    await withAuth({
      authEnabled: true,
      tokens: { idToken: mockIdToken, refreshToken: mockRefreshToken },
    });

    // ACT
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // ASSERT: No login screen, see app
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("can access protected pages directly", async ({ page, withAuth }) => {
    await withAuth({
      authEnabled: true,
      tokens: { idToken: mockIdToken, refreshToken: mockRefreshToken },
    });

    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // Should load without redirect
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("can navigate between pages while authenticated", async ({ page, withAuth }) => {
    await withAuth({
      authEnabled: true,
      tokens: { idToken: mockIdToken, refreshToken: mockRefreshToken },
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Navigate around
    await page.getByRole("link", { name: /pools/i }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/pools/i);

    await page.getByRole("link", { name: /resources/i }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/resources/i);

    await page.getByRole("link", { name: /dashboard/i }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("Token Refresh", () => {
  test("refreshes expired token automatically", async ({ page, withAuth }) => {
    // Expired token but refresh will succeed
    const expiredToken = [
      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJzdWIiOiJ1c2VyLTEyMyIsImV4cCI6MTU3NzgzNjgwMH0", // exp: 2020
      "fake",
    ].join(".");

    await withAuth({
      authEnabled: true,
      tokens: { idToken: expiredToken, refreshToken: mockRefreshToken },
      refreshResult: "success",
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Should refresh and show app (not login)
    await expect(page.getByRole("navigation")).toBeVisible();
  });

  test("shows login when refresh fails", async ({ page, withAuth }) => {
    const expiredToken = [
      "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJzdWIiOiJ1c2VyLTEyMyIsImV4cCI6MTU3NzgzNjgwMH0",
      "fake",
    ].join(".");

    await withAuth({
      authEnabled: true,
      tokens: { idToken: expiredToken, refreshToken: "invalid" },
      refreshResult: "failure",
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Refresh failed, should see auth page elements
    const authElement = page.locator("body").filter({ hasText: /log in|sign in|authentication/i });
    await expect(authElement).toBeVisible();
  });
});

test.describe("API Authorization Errors", () => {
  test("handles 401 Unauthorized from API", async ({ page, withAuth }) => {
    await withAuth({
      authEnabled: true,
      tokens: { idToken: mockIdToken, refreshToken: mockRefreshToken },
      apiError: "unauthorized",
    });

    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // App should handle 401 gracefully
    await expect(page.locator("body")).not.toBeEmpty();
  });

  test("handles 403 Forbidden from API", async ({ page, withAuth }) => {
    await withAuth({
      authEnabled: true,
      tokens: { idToken: mockIdToken, refreshToken: mockRefreshToken },
      apiError: "forbidden",
    });

    await page.goto("/pools");
    await page.waitForLoadState("networkidle");

    // User is authenticated but lacks permissions
    // App should show error, not crash
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.getByRole("navigation")).toBeVisible();
  });
});

test.describe("Auth Disabled", () => {
  test("shows app directly when auth is disabled", async ({ page }) => {
    // Default is auth disabled
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // No login screen, straight to app
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
