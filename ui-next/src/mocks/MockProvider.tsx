// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

/**
 * MockProvider
 *
 * Initializes MSW (Mock Service Worker) for offline development.
 * Wraps children and only renders them after mocking is ready.
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

import { useEffect, useState, type ReactNode } from "react";

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
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    async function init() {
      // Check if we should enable mocking
      const shouldMock =
        process.env.NEXT_PUBLIC_MOCK_API === "true" || localStorage.getItem(MOCK_ENABLED_STORAGE_KEY) === "true";

      if (shouldMock && typeof window !== "undefined") {
        try {
          const { initMocking } = await import("./browser");
          await initMocking();

          // Expose config API on window for browser console access
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

      setIsReady(true);
    }

    init();
  }, []);

  // Show nothing until mocking is initialized
  // This prevents requests from going to the real API before MSW intercepts
  if (!isReady) {
    return null;
  }

  return <>{children}</>;
}
