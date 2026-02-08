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
 * Provides `window.__mockConfig` for adjusting mock data volumes from the
 * browser console. Changes are sent to the server via Server Actions.
 *
 * Production safety: Aliased to MockProvider.production.tsx via next.config.ts.
 *
 * Console API:
 *   __mockConfig.setWorkflowTotal(100000)
 *   __mockConfig.getVolumes()
 *   __mockConfig.help()
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { setMockVolumes, getMockVolumes } from "@/actions/mock-config";
import type { MockVolumes } from "@/actions/mock-config.types";

interface MockProviderProps {
  children: ReactNode;
}

export const MOCK_ENABLED_STORAGE_KEY = "osmo_use_mock_data";

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

function hasCookie(name: string): boolean {
  return document.cookie.split(";").some((c) => c.trim().startsWith(`${name}=`));
}

export function MockProvider({ children }: MockProviderProps) {
  const initStartedRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (initStartedRef.current) return;
    initStartedRef.current = true;

    const isMockMode =
      process.env.NEXT_PUBLIC_MOCK_API === "true" || localStorage.getItem(MOCK_ENABLED_STORAGE_KEY) === "true";

    if (!isMockMode) {
      setIsReady(true);
      return;
    }

    // Ensure JWT cookie exists for mock auth, then mark ready
    const ensureAuth = async () => {
      if (!hasCookie("IdToken") && !hasCookie("BearerToken")) {
        const { generateMockJWT } = await import("@/mocks/inject-auth");
        const mockJwt = generateMockJWT("dev", ["admin", "user"]);
        document.cookie = `IdToken=${mockJwt}; path=/; max-age=28800`;
      }
      setIsReady(true);
    };

    ensureAuth().catch((err) => {
      console.error("[MockProvider] Auth initialization failed:", err);
      setIsReady(true);
    });

    // Set up console API for mock volume control
    const createSetter = (key: keyof MockVolumes) => async (n: number) => {
      const volumes = await setMockVolumes({ [key]: n });
      console.log(`${key} set to ${n.toLocaleString()}`);
      console.table(volumes);
    };

    window.__mockConfig = {
      setWorkflowTotal: createSetter("workflows"),
      setPoolTotal: createSetter("pools"),
      setResourcePerPool: createSetter("resourcesPerPool"),
      setResourceTotalGlobal: createSetter("resourcesGlobal"),
      setBucketTotal: createSetter("buckets"),
      setDatasetTotal: createSetter("datasets"),

      setVolumes: async (volumes: Partial<MockVolumes>) => {
        const result = await setMockVolumes(volumes);
        console.table(result);
      },

      getVolumes: async () => {
        const volumes = await getMockVolumes();
        console.table(volumes);
        return volumes;
      },

      help: () => {
        console.log(`Mock Config API (Server Actions)

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

Changes take effect on the next API request.`);
      },
    };

    // Developer utilities for service worker management
    import("@/lib/dev/service-worker-manager")
      .then(({ clearServiceWorker, showServiceWorkerStatus, clearAllCaches }) => {
        window.__dev = {
          clearServiceWorker: () => clearServiceWorker(true),
          serviceWorkerStatus: () => showServiceWorkerStatus(),
          clearCaches: () => clearAllCaches(),
          help: () => {
            console.log(`Developer Utilities

  await __dev.clearServiceWorker()    // Unregister SW, clear caches, reload
  await __dev.serviceWorkerStatus()   // Check SW status
  await __dev.clearCaches()           // Clear all caches only`);
          },
        };
      })
      .catch(() => {
        // Service worker manager not available - non-critical
      });

    console.log("[MockProvider] Mock mode active. Type __mockConfig.help() for options.");
  }, []);

  if (!isReady) {
    return null;
  }

  return <>{children}</>;
}
