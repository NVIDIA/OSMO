// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { createContext, useContext, useState, useLayoutEffect, type ReactNode } from "react";

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

  // Serialize breadcrumbs for stable dependency
  const breadcrumbsKey = config.breadcrumbs
    ?.map((b) => `${b.label}:${b.href ?? ""}`)
    .join("|") ?? "";

  useLayoutEffect(() => {
    setConfig(config);
    return () => setConfig(null);
  }, [config.title, breadcrumbsKey, setConfig]);
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
