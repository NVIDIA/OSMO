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

"use server";

/**
 * Server Actions for Mock Configuration
 *
 * These actions run in the same Node.js process as the MSW server,
 * allowing direct manipulation of mock data generators.
 *
 * IMPORTANT: This file is only imported by MockProvider.tsx, which is
 * aliased to a no-op stub in production. Therefore, this file is never
 * part of the production bundle.
 *
 * Usage (from browser console):
 *   __mockConfig.setWorkflowTotal(100000)
 *   __mockConfig.getVolumes()
 *
 * ARCHITECTURE NOTE: Uses global config store to ensure consistency across
 * Next.js contexts (Server Actions run in separate bundle from MSW handlers).
 */

import type { MockVolumes } from "@/actions/mock-config.types";
import { getGlobalMockConfig, setGlobalMockConfig } from "@/mocks/global-config";

/**
 * Set mock data volumes on the server.
 * Changes take effect immediately for subsequent API requests.
 *
 * Uses global config store to ensure changes are visible across all
 * Next.js contexts (Server Actions, MSW handlers, etc.).
 */
export async function setMockVolumes(volumes: Partial<MockVolumes>): Promise<MockVolumes> {
  // Update global config (shared across all Next.js contexts)
  setGlobalMockConfig(volumes);

  // Clear generator caches so they regenerate with new totals
  if (volumes.workflows !== undefined) {
    try {
      const generators = await import("@/mocks/handlers");
      generators.workflowGenerator.clearCache();
    } catch {
      // Cache clear failed, not critical
    }
  }

  // Return current volumes from global config
  return getGlobalMockConfig();
}

/**
 * Get current mock data volumes from the server.
 * Reads from global config store.
 */
export async function getMockVolumes(): Promise<MockVolumes> {
  return getGlobalMockConfig();
}
