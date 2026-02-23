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
 * useSpecData - React Query hooks for fetching workflow specs
 *
 * Fetches YAML specs and templates from backend URLs (workflow.spec, workflow.template_spec).
 * Uses immutable caching (staleTime: Infinity) since specs never change.
 *
 * @example
 * ```tsx
 * const { yamlSpec, jinjaSpec, isLoading, error } = useSpecData(workflow, activeView);
 * ```
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { handleRedirectResponse } from "@/lib/api/handle-redirect";
import type { WorkflowQueryResponse } from "@/lib/api/adapter/types";

// =============================================================================
// Types
// =============================================================================

export type SpecView = "yaml" | "jinja";

export interface UseSpecDataReturn {
  /** YAML spec content (always fetched) */
  yamlSpec: string | null;
  /** Template content (lazy fetched) */
  jinjaSpec: string | null;
  /** Current view's content */
  content: string | null;
  /** Loading state for current view */
  isLoading: boolean;
  /** Error for current view */
  error: Error | null;
  /** Whether spec is not available (404) */
  isNotFound: boolean;
  /** Refetch current view */
  refetch: () => void;
}

// =============================================================================
// Cache Configuration
// =============================================================================

// Specs are immutable - never refetch once loaded
const SPEC_STALE_TIME = Infinity;
// Keep in cache for 30 minutes even when unmounted
const SPEC_GC_TIME = 30 * 60 * 1000;

// =============================================================================
// Fetch Functions
// =============================================================================

/**
 * Fetch spec from backend URL (provided by workflow.spec or workflow.template_spec)
 *
 * Note: Token refresh is handled automatically by the fetcher's 401 handler,
 * no manual refresh needed before fetch.
 */
async function fetchSpec(specUrl: string): Promise<string> {
  const response = await fetch(specUrl, {
    method: "GET",
    headers: {
      Accept: "text/plain",
    },
    credentials: "include",
    redirect: "manual", // Prevent automatic redirect following (prevents CORS errors on auth expiry)
  });

  // Check for redirect responses and throw appropriate error
  handleRedirectResponse(response, "workflow spec");

  if (!response.ok) {
    throw new Error(`Failed to fetch spec: ${response.status} ${response.statusText}`, {
      cause: { status: response.status },
    });
  }

  return response.text();
}

// =============================================================================
// Hook
// =============================================================================

/**
 * Fetches workflow spec data with lazy loading for templates.
 *
 * - YAML spec is always fetched (default view) from workflow.spec URL
 * - Template is only fetched when activeView === 'jinja' from workflow.template_spec URL
 * - Both use immutable caching (staleTime: Infinity)
 * - Retry logic is handled by the global QueryClient (see query-client.ts)
 */
export function useSpecData(workflow: WorkflowQueryResponse | undefined, activeView: SpecView): UseSpecDataReturn {
  const specUrl = workflow?.spec;
  const templateUrl = workflow?.template_spec;

  // Always fetch YAML (default view)
  const yamlQuery = useQuery({
    queryKey: ["spec", specUrl],
    queryFn: () => {
      if (!specUrl) throw new Error("Spec URL is not available");
      return fetchSpec(specUrl);
    },
    staleTime: SPEC_STALE_TIME,
    gcTime: SPEC_GC_TIME,
    enabled: Boolean(specUrl),
  });

  // Only fetch template when user switches to template view
  const jinjaQuery = useQuery({
    queryKey: ["spec", templateUrl],
    queryFn: () => {
      if (!templateUrl) throw new Error("Template URL is not available");
      return fetchSpec(templateUrl);
    },
    staleTime: SPEC_STALE_TIME,
    gcTime: SPEC_GC_TIME,
    enabled: Boolean(templateUrl) && activeView === "jinja",
  });

  // Select data based on active view
  const currentQuery = activeView === "yaml" ? yamlQuery : jinjaQuery;

  // Check for 404 (not found)
  const isNotFound =
    (currentQuery.error as { status?: number })?.status === 404 ||
    (currentQuery.data !== undefined && currentQuery.data === "");

  return useMemo(
    () => ({
      yamlSpec: yamlQuery.data ?? null,
      jinjaSpec: jinjaQuery.data ?? null,
      content: currentQuery.data ?? null,
      isLoading: currentQuery.isLoading,
      error: currentQuery.error as Error | null,
      isNotFound,
      refetch: currentQuery.refetch,
    }),
    [
      yamlQuery.data,
      jinjaQuery.data,
      currentQuery.data,
      currentQuery.isLoading,
      currentQuery.error,
      isNotFound,
      currentQuery.refetch,
    ],
  );
}
