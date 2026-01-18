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

"use client";

/**
 * MockProvider - Non-Blocking MSW Initialization
 *
 * Initializes MSW (Mock Service Worker) for offline development.
 *
 * IMPORTANT: This provider does NOT block rendering!
 * - Server-side prefetch uses MSW node server (via instrumentation.ts)
 * - Client hydrates immediately with server-prefetched data
 * - MSW worker starts in background for subsequent client requests
 *
 * This architecture enables zero-flash mock mode with our Streaming SSR:
 * 1. Server prefetches data via MSW node server → data in HTML
 * 2. Client hydrates instantly (data already present)
 * 3. MSW browser worker starts in background
 * 4. Subsequent client requests are intercepted by MSW
 *
 * Enable mock mode:
 * - Set NEXT_PUBLIC_MOCK_API=true in environment
 * - Or set localStorage.setItem("osmo_use_mock_data", "true")
 *
 * Configure volumes (browser console):
 * - window.__mockConfig.setWorkflowTotal(100000)
 * - window.__mockConfig.setPoolTotal(1000)
 *
 * Volume settings persist in localStorage across refreshes.
 */

import { useEffect, useRef, type ReactNode } from "react";

interface MockProviderProps {
  children: ReactNode;
}

// LocalStorage keys for mock settings
export const MOCK_ENABLED_STORAGE_KEY = "osmo_use_mock_data";
const VOLUMES_STORAGE_KEY = "osmo_mock_volumes";

interface PersistedVolumes {
  workflows?: number;
  pools?: number;
  resourcesPerPool?: number;
  resourcesGlobal?: number;
  buckets?: number;
  datasets?: number;
}

// Type declaration for the global mock config
declare global {
  interface Window {
    __mockConfig?: {
      setWorkflowTotal: (n: number) => void;
      setPoolTotal: (n: number) => void;
      setResourcePerPool: (n: number) => void;
      setResourceTotalGlobal: (n: number) => void;
      setBucketTotal: (n: number) => void;
      setDatasetTotal: (n: number) => void;
      getVolumes: () => Record<string, number>;
      resetVolumes: () => void;
      help: () => void;
    };
  }
}

function loadPersistedVolumes(): PersistedVolumes {
  try {
    const stored = localStorage.getItem(VOLUMES_STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as PersistedVolumes;
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

function saveVolumes(volumes: PersistedVolumes): void {
  try {
    localStorage.setItem(VOLUMES_STORAGE_KEY, JSON.stringify(volumes));
  } catch {
    // Ignore storage errors
  }
}

export function MockProvider({ children }: MockProviderProps) {
  // Track initialization to prevent duplicate runs
  const initStartedRef = useRef(false);

  useEffect(() => {
    // Only initialize once
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    async function init() {
      // Check if we should enable mocking
      const shouldMock =
        process.env.NEXT_PUBLIC_MOCK_API === "true" || localStorage.getItem(MOCK_ENABLED_STORAGE_KEY) === "true";

      if (!shouldMock || typeof window === "undefined") return;

      try {
        // Start MSW worker in background - don't await to avoid blocking
        // The server has already prefetched data, so first render uses that
        const { initMocking } = await import("./browser");
        await initMocking();

        // Load generators and config API
        const generators = await import("./generators");

        // Load persisted volumes and apply them
        const persisted = loadPersistedVolumes();
        if (persisted.workflows !== undefined) {
          generators.setWorkflowTotal(persisted.workflows);
        }
        if (persisted.pools !== undefined) {
          generators.setPoolTotal(persisted.pools);
        }
        if (persisted.resourcesPerPool !== undefined) {
          generators.setResourcePerPool(persisted.resourcesPerPool);
        }
        if (persisted.resourcesGlobal !== undefined) {
          generators.setResourceTotalGlobal(persisted.resourcesGlobal);
        }
        if (persisted.buckets !== undefined) {
          generators.setBucketTotal(persisted.buckets);
        }
        if (persisted.datasets !== undefined) {
          generators.setDatasetTotal(persisted.datasets);
        }

        // Helper to get current volumes
        const getCurrentVolumes = () => ({
          workflows: generators.getWorkflowTotal(),
          pools: generators.getPoolTotal(),
          resourcesPerPool: generators.getResourcePerPool(),
          resourcesGlobal: generators.getResourceTotalGlobal(),
          buckets: generators.getBucketTotal(),
          datasets: generators.getDatasetTotal(),
        });

        window.__mockConfig = {
          setWorkflowTotal: (n: number) => {
            generators.setWorkflowTotal(n);
            saveVolumes({ ...loadPersistedVolumes(), workflows: n });
            console.log(`✅ Workflow total set to ${n.toLocaleString()} (persisted)`);
          },
          setPoolTotal: (n: number) => {
            generators.setPoolTotal(n);
            saveVolumes({ ...loadPersistedVolumes(), pools: n });
            console.log(`✅ Pool total set to ${n.toLocaleString()} (persisted)`);
          },
          setResourcePerPool: (n: number) => {
            generators.setResourcePerPool(n);
            saveVolumes({ ...loadPersistedVolumes(), resourcesPerPool: n });
            console.log(`✅ Resources per pool set to ${n.toLocaleString()} (persisted)`);
          },
          setResourceTotalGlobal: (n: number) => {
            generators.setResourceTotalGlobal(n);
            saveVolumes({ ...loadPersistedVolumes(), resourcesGlobal: n });
            console.log(`✅ Global resource total set to ${n.toLocaleString()} (persisted)`);
          },
          setBucketTotal: (n: number) => {
            generators.setBucketTotal(n);
            saveVolumes({ ...loadPersistedVolumes(), buckets: n });
            console.log(`✅ Bucket total set to ${n.toLocaleString()} (persisted)`);
          },
          setDatasetTotal: (n: number) => {
            generators.setDatasetTotal(n);
            saveVolumes({ ...loadPersistedVolumes(), datasets: n });
            console.log(`✅ Dataset total set to ${n.toLocaleString()} (persisted)`);
          },
          getVolumes: getCurrentVolumes,
          resetVolumes: () => {
            localStorage.removeItem(VOLUMES_STORAGE_KEY);
            console.log("✅ Volume settings reset. Refresh to apply defaults.");
          },
          help: () => {
            console.log(`
🎯 Mock Config API

Configure volumes (persisted across refreshes):
  __mockConfig.setWorkflowTotal(100000)    // 100k workflows
  __mockConfig.setPoolTotal(1000)          // 1k pools
  __mockConfig.setResourcePerPool(10000)   // 10k resources per pool
  __mockConfig.setResourceTotalGlobal(1000000) // 1M total resources
  __mockConfig.setBucketTotal(10000)       // 10k buckets
  __mockConfig.setDatasetTotal(50000)      // 50k datasets

Get current volumes:
  __mockConfig.getVolumes()

Reset to defaults:
  __mockConfig.resetVolumes()

Settings are saved to localStorage and persist across page refreshes.
            `);
          },
        };

        // Log current volumes on startup
        const volumes = getCurrentVolumes();
        const hasCustom = Object.keys(persisted).length > 0;
        console.log(`🔧 Mock mode enabled.${hasCustom ? " Custom volumes loaded:" : ""}`);
        if (hasCustom) {
          console.table(volumes);
        }
        console.log("Type __mockConfig.help() for options.");
      } catch (error) {
        console.error("Failed to initialize mocking:", error);
      }
    }

    init();
  }, []);

  // NON-BLOCKING: Render children immediately!
  // Server-side MSW has already prefetched data, so hydration uses that.
  // Browser MSW starts in background for subsequent requests.
  return <>{children}</>;
}
