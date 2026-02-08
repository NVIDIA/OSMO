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
 * Global Mock Configuration Store
 *
 * Persists mock config across Next.js module contexts using Node.js global.
 * This ensures Server Actions and MSW handlers share the same config state.
 *
 * PROBLEM: Next.js bundles Server Actions separately, creating duplicate
 * module instances. Standard module singletons don't work across contexts.
 *
 * SOLUTION: Use Node.js global object as the single source of truth.
 */

import { DEFAULT_VOLUME } from "@/mocks/seed/types";

interface GlobalMockConfig {
  workflows: number;
  pools: number;
  resourcesPerPool: number;
  resourcesGlobal: number;
  buckets: number;
  datasets: number;
}

// Extend Node.js global type
declare global {
  var __mockConfigData: GlobalMockConfig | undefined;
}

// Initialize global config on first import (server-side only)
// Client-side mocking is disabled - browser makes requests to Next.js API routes,
// which are intercepted by MSW in Node.js
const isServer = typeof globalThis.process !== "undefined";

if (isServer && !globalThis.__mockConfigData) {
  globalThis.__mockConfigData = {
    workflows: DEFAULT_VOLUME.workflows,
    pools: DEFAULT_VOLUME.pools,
    resourcesPerPool: DEFAULT_VOLUME.resourcesPerPool,
    resourcesGlobal: 80, // Default from config
    buckets: 50,
    datasets: 100,
  };
}

/**
 * Get the global mock configuration.
 * Returns the same object across all Next.js contexts.
 */
export function getGlobalMockConfig(): GlobalMockConfig {
  if (!globalThis.__mockConfigData) {
    throw new Error("[Global Config] Not initialized");
  }
  return globalThis.__mockConfigData;
}

/**
 * Update the global mock configuration.
 * Changes are immediately visible to all contexts (MSW handlers, Server Actions).
 */
export function setGlobalMockConfig(updates: Partial<GlobalMockConfig>): void {
  if (!globalThis.__mockConfigData) {
    throw new Error("[Global Config] Not initialized");
  }

  Object.assign(globalThis.__mockConfigData, updates);
}
