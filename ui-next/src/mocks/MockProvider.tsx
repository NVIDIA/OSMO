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
 * MockProvider - Developer Console API for Mock Mode
 *
 * Provides `window.__mockConfig` API for adjusting mock data volumes
 * from the browser console. Changes are sent to the server via Server Actions
 * and take effect immediately (no page refresh needed!).
 *
 * Architecture:
 * - Browser: __mockConfig.setWorkflowTotal(100000)
 * - Server Action: setMockVolumes() runs in Node.js process
 * - Generators: Updated in the same process as MSW
 * - Next API request: MSW uses new values
 *
 * PRODUCTION SAFETY:
 * - This file is aliased to MockProvider.production.tsx in production builds
 * - Therefore, server actions and generators are never imported in production
 * - Zero mock code in production bundle
 *
 * Console API:
 *   __mockConfig.setWorkflowTotal(100000)  // Set and apply immediately
 *   __mockConfig.getVolumes()               // See current values
 *   __mockConfig.help()                     // Show all options
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { setMockVolumes, getMockVolumes } from "@/actions/mock-config";
import type { MockVolumes } from "@/actions/mock-config.types";
import { getBasePath } from "@/lib/config";

interface MockProviderProps {
  children: ReactNode;
}

// LocalStorage key for mock mode toggle
export const MOCK_ENABLED_STORAGE_KEY = "osmo_use_mock_data";

// Type declaration for the global mock config
declare global {
  interface Window {
    __mockConfig?: {
      setWorkflowTotal: (n: number) => Promise<void>;
      setPoolTotal: (n: number) => Promise<void>;
      setResourcePerPool: (n: number) => Promise<void>;
      setResourceTotalGlobal: (n: number) => Promise<void>;
      setBucketTotal: (n: number) => Promise<void>;
      setDatasetTotal: (n: number) => Promise<void>;
      setVolumes: (volumes: Partial<MockVolumes>) => Promise<void>;
      getVolumes: () => Promise<MockVolumes>;
      help: () => void;
    };
    __dev?: {
      clearServiceWorker: () => Promise<void>;
      serviceWorkerStatus: () => Promise<void>;
      clearCaches: () => Promise<void>;
      help: () => void;
    };
  }
}

export function MockProvider({ children }: MockProviderProps) {
  const initStartedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    // Only set up in mock mode
    const isMockMode =
      process.env.NEXT_PUBLIC_MOCK_API === "true" || localStorage.getItem(MOCK_ENABLED_STORAGE_KEY) === "true";

    if (!isMockMode || typeof window === "undefined") {
      setIsReady(true);
      return;
    }

    // Initialize mock mode with proper sequencing:
    // 1. Check/inject JWT cookie (synchronous)
    // 2. Start MSW and wait for it to be fully ready (deterministic)
    // 3. Only then render children (including UserProvider)
    const initMSW = async () => {
      // Step 1: Ensure JWT cookie exists
      const { generateMockJWT } = await import("./inject-auth");

      // Check if JWT cookie already exists
      const cookies = document.cookie.split(";").reduce(
        (acc, cookie) => {
          const [key, value] = cookie.trim().split("=");
          if (key) acc[key] = value;
          return acc;
        },
        {} as Record<string, string>,
      );

      if (!cookies["IdToken"] && !cookies["BearerToken"]) {
        // No JWT exists, inject one
        const mockJwt = generateMockJWT("dev", ["admin", "user"]);
        document.cookie = `IdToken=${mockJwt}; path=/; max-age=28800`; // 8 hours
        console.log("🔐 Mock JWT injected for user: dev");
      } else {
        console.log("🔐 Existing JWT cookie found, reusing");
      }

      // Step 2: Start MSW and wait for it to be fully ready
      const basePath = getBasePath();

      const getServiceWorkerUrl = () => {
        if (!basePath) {
          return "/mockServiceWorker.js";
        }
        // Ensure basePath doesn't end with / and path starts with /
        const normalizedBasePath = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
        return `${normalizedBasePath}/mockServiceWorker.js`;
      };

      // Service worker scope: use default (root) for reliable control
      // MSW will only intercept requests that have handlers
      // No scope restriction needed - the worker controls the whole origin

      const { worker } = await import("./browser");

      await worker.start({
        onUnhandledRequest: "bypass",
        serviceWorker: {
          url: getServiceWorkerUrl(),
          // Use default scope for reliable control
        },
        quiet: true, // Disable request logging in console
      });

      console.log("[MSW] Service worker registered");

      // On first load, the service worker won't be controlling the page yet.
      // We need to reload once to let it take control.
      if (!navigator.serviceWorker.controller) {
        // Check if we've already reloaded once to avoid infinite reload loop
        const hasReloaded = sessionStorage.getItem("msw_reloaded");

        if (!hasReloaded) {
          console.log("[MSW] First load: reloading to activate service worker...");
          sessionStorage.setItem("msw_reloaded", "true");
          window.location.reload();
          return; // Don't set isReady, page will reload
        } else {
          // We've already reloaded but SW still not controlling - proceed anyway
          console.warn("[MSW] Service worker not controlling after reload, proceeding anyway");
        }
      } else {
        console.log("[MSW] Service worker is controlling");
        // Clear reload flag since SW is working
        sessionStorage.removeItem("msw_reloaded");
      }

      setIsReady(true);
    };

    initMSW().catch((err) => {
      console.error("[MSW] Failed to initialize:", err);
      setIsReady(true); // Continue anyway to avoid blocking the app
    });

    // Helper to create a setter that calls the server action
    const createSetter = (key: keyof MockVolumes) => async (n: number) => {
      try {
        const volumes = await setMockVolumes({ [key]: n });
        console.log(`✅ ${key} set to ${n.toLocaleString()}. Server updated.`);
        console.table(volumes);
      } catch (error) {
        console.error(`❌ Failed to set ${key}:`, error);
      }
    };

    window.__mockConfig = {
      setWorkflowTotal: createSetter("workflows"),
      setPoolTotal: createSetter("pools"),
      setResourcePerPool: createSetter("resourcesPerPool"),
      setResourceTotalGlobal: createSetter("resourcesGlobal"),
      setBucketTotal: createSetter("buckets"),
      setDatasetTotal: createSetter("datasets"),

      setVolumes: async (volumes: Partial<MockVolumes>) => {
        try {
          const result = await setMockVolumes(volumes);
          console.log("✅ Volumes updated. Server state:");
          console.table(result);
        } catch (error) {
          console.error("❌ Failed to set volumes:", error);
        }
      },

      getVolumes: async () => {
        try {
          const volumes = await getMockVolumes();
          console.log("📊 Current server volumes:");
          console.table(volumes);
          return volumes;
        } catch (error) {
          console.error("❌ Failed to get volumes:", error);
          throw error;
        }
      },

      help: () => {
        console.log(`
🎯 Mock Config API (Server Actions)

All changes apply IMMEDIATELY to the server - no refresh needed!

Set individual volumes:
  await __mockConfig.setWorkflowTotal(100000)
  await __mockConfig.setPoolTotal(1000)
  await __mockConfig.setResourcePerPool(10000)
  await __mockConfig.setResourceTotalGlobal(1000000)
  await __mockConfig.setBucketTotal(10000)
  await __mockConfig.setDatasetTotal(50000)

Set multiple at once:
  await __mockConfig.setVolumes({ workflows: 100000, pools: 500 })

Get current server state:
  await __mockConfig.getVolumes()

Note: These are async functions that talk to the server.
Changes take effect on the next API request.
        `);
      },
    };

    // Set up developer utilities for service worker management
    // This helps when hot reload isn't working due to old service worker
    import("@/lib/dev/service-worker-manager")
      .then(({ clearServiceWorker, showServiceWorkerStatus, clearAllCaches }) => {
        window.__dev = {
          clearServiceWorker: async () => {
            console.log("💡 Clearing service worker and reloading...");
            await clearServiceWorker(true);
          },
          serviceWorkerStatus: async () => {
            await showServiceWorkerStatus();
          },
          clearCaches: async () => {
            await clearAllCaches();
          },
          help: () => {
            console.log(`
🔧 Developer Utilities

Service Worker Management (for hot reload issues):
  await __dev.clearServiceWorker()    // Unregister SW, clear caches, and reload
  await __dev.serviceWorkerStatus()   // Check SW status
  await __dev.clearCaches()           // Clear all caches only

Note: If hot reload isn't working after code changes, run:
  __dev.clearServiceWorker()

This unregisters the old service worker and reloads the page.
            `);
          },
        };

        console.log("🔧 Developer tools available. Type __dev.help() for options.");
      })
      .catch((error) => {
        console.warn("Could not load developer utilities:", error);
      });

    // Show initial state
    console.log("🔧 Mock mode active. Fetching server volumes...");
    getMockVolumes()
      .then((volumes) => {
        console.log("📊 Server mock volumes:");
        console.table(volumes);
        console.log("Type __mockConfig.help() for options.");
      })
      .catch((error) => {
        console.warn("Could not fetch server volumes:", error);
        console.log("Type __mockConfig.help() for options.");
      });
  }, []);

  // Wait for browser MSW to be ready before rendering
  if (!isReady) {
    return null;
  }

  return <>{children}</>;
}
