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

import { useEffect, useRef, type ReactNode } from "react";
import { setMockVolumes, getMockVolumes } from "@/actions/mock-config";
import type { MockVolumes } from "@/actions/mock-config.types";

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
  }
}

export function MockProvider({ children }: MockProviderProps) {
  const initStartedRef = useRef(false);

  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    // Only set up console API in mock mode
    const isMockMode =
      process.env.NEXT_PUBLIC_MOCK_API === "true" || localStorage.getItem(MOCK_ENABLED_STORAGE_KEY) === "true";

    if (!isMockMode || typeof window === "undefined") return;

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

  return <>{children}</>;
}
