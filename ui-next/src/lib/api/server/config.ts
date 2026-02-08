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
 * Server-Side API Configuration (Development Build)
 *
 * Development version that composes production config with mock mode overlay.
 * In production builds, this entire file is aliased to config.production.ts.
 */

// Re-export all production functionality
export * from "@/lib/api/server/config.production";

// Import production implementation for composition
import { getServerApiBaseUrl as getProductionApiBaseUrl } from "@/lib/api/server/config.production";

// =============================================================================
// Development-Only Mock Mode Overlay
// =============================================================================

/**
 * Get the backend API base URL for server-side requests.
 *
 * Development version: Adds mock mode detection on top of production logic.
 *
 * MOCK MODE: In mock mode + dev mode, returns localhost:PORT
 * to allow MSW server instrumentation to intercept requests.
 * Otherwise delegates to production implementation.
 */
export function getServerApiBaseUrl(): string {
  const mockMode = process.env.NEXT_PUBLIC_MOCK_API === "true";
  const devMode = process.env.NODE_ENV === "development";

  // Mock mode: Route to localhost where MSW is running
  if (mockMode && devMode) {
    const port = process.env.PORT || "3000";
    return `http://localhost:${port}`;
  }

  // Normal mode: Delegate to production implementation
  return getProductionApiBaseUrl();
}
