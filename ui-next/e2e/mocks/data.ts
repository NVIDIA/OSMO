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

/**
 * Default mock data for E2E tests.
 *
 * Uses type-safe factories from ./factories.ts to ensure mock data
 * stays in sync with the OpenAPI-generated types.
 */

import {
  createProductionScenario,
  createLoginInfo,
  createVersion,
} from "./factories";

// =============================================================================
// Default Mock Data (from typed factories)
// =============================================================================

const scenario = createProductionScenario();

export const mockPools = scenario.pools;
export const mockResources = scenario.resources;
export const mockVersion = createVersion();

// =============================================================================
// Auth Mocks (using generated LoginInfo type)
// =============================================================================

/**
 * Login info with auth disabled.
 */
export const mockLoginInfoAuthDisabled = createLoginInfo({
  auth_enabled: false,
});

/**
 * Login info with auth enabled.
 */
export const mockLoginInfoAuthEnabled = createLoginInfo({
  auth_enabled: true,
  device_endpoint: "http://localhost:8080/device",
  device_client_id: "osmo-device-flow",
  browser_endpoint: "http://localhost:8080/auth",
  browser_client_id: "osmo-browser-flow",
  token_endpoint: "http://localhost:8080/token",
  logout_endpoint: "http://localhost:8080/logout",
});

// =============================================================================
// Mock Tokens
// =============================================================================

/**
 * Mock JWT ID token - VALID (expires year 2099).
 * Structure matches real JWT: header.payload.signature
 */
export const mockIdToken = [
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidGVzdHVzZXJAZXhhbXBsZS5jb20iLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJ0ZXN0dXNlciIsImV4cCI6NDEwMjQ0NDgwMH0",
  "fake-signature",
].join(".");

/**
 * Mock JWT ID token - EXPIRED (expired year 2020).
 */
export const mockExpiredIdToken = [
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9",
  "eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidGVzdHVzZXJAZXhhbXBsZS5jb20iLCJwcmVmZXJyZWRfdXNlcm5hbWUiOiJ0ZXN0dXNlciIsImV4cCI6MTU3NzgzNjgwMH0",
  "fake-signature",
].join(".");

/**
 * Mock refresh tokens.
 */
export const mockRefreshToken = "mock-refresh-token-valid";
export const mockInvalidRefreshToken = "mock-refresh-token-invalid";

// =============================================================================
// Auth API Response Mocks
// =============================================================================

export const mockTokenRefreshSuccess = {
  isFailure: false,
  id_token: mockIdToken,
  refresh_token: mockRefreshToken,
};

export const mockTokenRefreshFailureInvalid = {
  isFailure: true,
  error: "invalid_grant",
  authError: "invalid_grant",
};

export const mockTokenRefreshFailureServer = {
  isFailure: true,
  error: "Failed to reach auth server",
};

// =============================================================================
// API Error Responses
// =============================================================================

export const mockApiUnauthorized = {
  error: "Unauthorized",
  message: "Authentication required",
  statusCode: 401,
};

export const mockApiForbidden = {
  error: "Forbidden",
  message: "You do not have permission to access this resource",
  statusCode: 403,
};

export const mockApiServerError = {
  error: "Internal Server Error",
  message: "An unexpected error occurred",
  statusCode: 500,
};

// =============================================================================
// Re-export factories and generated enums for test files
// =============================================================================

export {
  // Factories
  createPoolResourceUsage,
  createPoolResponse,
  createResourceEntry,
  createResourcesResponse,
  createLoginInfo,
  createVersion,
  createProductionScenario,
  createEmptyScenario,
  createHighUtilizationScenario,
  // Generated enums (for test assertions)
  BackendResourceType,
  PoolStatus,
} from "./factories";
