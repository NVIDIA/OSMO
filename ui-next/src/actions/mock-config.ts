// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

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

import type { MockVolumes } from "./mock-config.types";
import { getGlobalMockConfig, setGlobalMockConfig } from "@/mocks/global-config";

/**
 * Set mock data volumes on the server.
 * Changes take effect immediately for subsequent API requests.
 *
 * Uses global config store to ensure changes are visible across all
 * Next.js contexts (Server Actions, MSW handlers, etc.).
 */
export async function setMockVolumes(volumes: Partial<MockVolumes>): Promise<MockVolumes> {
  console.log("[Mock Config] Setting volumes:", volumes);

  // Update global config (shared across all Next.js contexts)
  setGlobalMockConfig(volumes);

  // Clear generator caches so they regenerate with new totals
  if (volumes.workflows !== undefined) {
    try {
      const generators = await import("@/mocks/handlers");
      generators.workflowGenerator.clearCache();
      console.log("[Mock Config] Cleared workflow generator cache");
    } catch (err) {
      console.warn("[Mock Config] Could not clear cache:", err);
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
  const volumes = getGlobalMockConfig();
  console.log("[Mock Config] Current volumes:", volumes);
  return volumes;
}
