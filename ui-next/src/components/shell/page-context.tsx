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

import { createContext, useContext, useState, useLayoutEffect, useMemo, type ReactNode } from "react";

/**
 * Breadcrumb segment for navigation
 */
export interface BreadcrumbSegment {
  /** Display label */
  label: string;
  /** Navigation href (null for current page) */
  href: string | null;
}

/**
 * Page configuration set by individual pages
 */
export interface PageConfig {
  /** Page title displayed in the header */
  title: string;
  /** Breadcrumb trail (excluding the current page title) */
  breadcrumbs?: BreadcrumbSegment[];
}

interface PageContextType {
  config: PageConfig | null;
  setConfig: (config: PageConfig | null) => void;
}

const PageContext = createContext<PageContextType | undefined>(undefined);

/**
 * Provider for page-level metadata.
 */
export function PageProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PageConfig | null>(null);

  return <PageContext.Provider value={{ config, setConfig }}>{children}</PageContext.Provider>;
}

/**
 * Hook to set page metadata from any page component.
 *
 * @example
 * ```tsx
 * usePage({ title: "Pools" });
 *
 * usePage({
 *   title: poolName,
 *   breadcrumbs: [{ label: "Pools", href: "/pools" }],
 * });
 * ```
 */
export function usePage(config: PageConfig) {
  const context = useContext(PageContext);

  if (context === undefined) {
    throw new Error("usePage must be used within a PageProvider");
  }

  const { setConfig } = context;

  // Serialize breadcrumbs for stable dependency comparison
  const breadcrumbsKey = config.breadcrumbs?.map((b) => `${b.label}:${b.href ?? ""}`).join("|") ?? "";

  // Memoize config to create stable reference based on actual content
  const stableConfig = useMemo(
    () => config,
    // Only recreate when actual content changes (primitives, not object reference)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.title, breadcrumbsKey],
  );

  useLayoutEffect(() => {
    setConfig(stableConfig);
    return () => setConfig(null);
  }, [stableConfig, setConfig]);
}

/**
 * Hook to read page configuration (used by Header component)
 */
export function usePageConfig() {
  const context = useContext(PageContext);

  if (context === undefined) {
    throw new Error("usePageConfig must be used within a PageProvider");
  }

  return context.config;
}
