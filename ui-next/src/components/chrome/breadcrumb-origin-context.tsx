//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Breadcrumb Origin Context
 *
 * Tracks where users came FROM when navigating to detail pages.
 * This enables smart breadcrumbs that navigate back to the exact table state
 * (with filters) rather than clean URLs.
 *
 * **Scope**: ONLY breadcrumbs use this. Left nav always goes to clean URLs.
 *
 * **Storage**: React Context (lives in layout, survives navigation)
 * - Lost on page refresh (desired - deep links work cleanly)
 * - Lost on new tab (desired - fresh start)
 * - Persists during navigation within the same tab
 *
 * **Usage**:
 * ```tsx
 * // In table row click handler:
 * const { setOrigin } = useBreadcrumbOrigin();
 * setOrigin(detailPath, currentUrl);
 * router.push(detailPath);
 *
 * // In breadcrumb:
 * const { getOrigin } = useBreadcrumbOrigin();
 * const origin = getOrigin(pathname);
 * if (origin) router.push(origin);
 * ```
 */

"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface BreadcrumbOriginContextType {
  /**
   * Store the origin URL for a detail page
   * @param detailPagePath - The path being navigated TO (e.g., `/workflows/my-workflow`)
   * @param originPath - The full URL being navigated FROM (e.g., `/workflows?f=status:RUNNING`)
   */
  setOrigin: (detailPagePath: string, originPath: string) => void;

  /**
   * Get the origin URL for a detail page
   * @param detailPagePath - The current detail page path
   * @returns The origin URL with filters, or null if not found
   */
  getOrigin: (detailPagePath: string) => string | null;

  /**
   * Clear the origin for a specific detail page
   * @param detailPagePath - The detail page path to clear
   */
  clearOrigin: (detailPagePath: string) => void;

  /**
   * Clear all origins (for testing or manual cleanup)
   */
  clearAll: () => void;
}

const BreadcrumbOriginContext = createContext<BreadcrumbOriginContextType | undefined>(undefined);

/**
 * Provider for breadcrumb origin tracking.
 * Should be placed in the layout so it survives navigation.
 */
export function BreadcrumbOriginProvider({ children }: { children: ReactNode }) {
  // Map of detail page path → origin URL
  // Example: "/workflows/my-workflow" → "/workflows?f=status:RUNNING"
  const [origins, setOrigins] = useState<Map<string, string>>(new Map());

  const setOrigin = useCallback((detailPagePath: string, originPath: string) => {
    setOrigins((prev) => {
      const next = new Map(prev);
      next.set(detailPagePath, originPath);
      return next;
    });
  }, []);

  const getOrigin = useCallback(
    (detailPagePath: string): string | null => {
      return origins.get(detailPagePath) ?? null;
    },
    [origins],
  );

  const clearOrigin = useCallback((detailPagePath: string) => {
    setOrigins((prev) => {
      const next = new Map(prev);
      next.delete(detailPagePath);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setOrigins(new Map());
  }, []);

  return (
    <BreadcrumbOriginContext.Provider value={{ setOrigin, getOrigin, clearOrigin, clearAll }}>
      {children}
    </BreadcrumbOriginContext.Provider>
  );
}

/**
 * Hook to access breadcrumb origin tracking.
 * Must be used within a BreadcrumbOriginProvider.
 */
export function useBreadcrumbOrigin(): BreadcrumbOriginContextType {
  const context = useContext(BreadcrumbOriginContext);

  if (context === undefined) {
    throw new Error("useBreadcrumbOrigin must be used within a BreadcrumbOriginProvider");
  }

  return context;
}
