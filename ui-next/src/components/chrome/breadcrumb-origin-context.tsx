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
 * Tracks navigation origin for smart breadcrumbs.
 *
 * Enables breadcrumbs to navigate back to filtered table state rather than clean URLs.
 * Uses React Context - survives navigation but resets on refresh (desired for deep links).
 */

"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

interface BreadcrumbOriginContextType {
  setOrigin: (detailPagePath: string, originPath: string) => void;
  getOrigin: (detailPagePath: string) => string | null;
  clearOrigin: (detailPagePath: string) => void;
  clearAll: () => void;
}

const BreadcrumbOriginContext = createContext<BreadcrumbOriginContextType | undefined>(undefined);

export function BreadcrumbOriginProvider({ children }: { children: ReactNode }) {
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

export function useBreadcrumbOrigin(): BreadcrumbOriginContextType {
  const context = useContext(BreadcrumbOriginContext);

  if (context === undefined) {
    throw new Error("useBreadcrumbOrigin must be used within a BreadcrumbOriginProvider");
  }

  return context;
}
