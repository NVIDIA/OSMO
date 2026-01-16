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

import { QueryClient, QueryClientProvider, HydrationBoundary } from "@tanstack/react-query";
import type { DehydratedState } from "@tanstack/react-query";
// React Query Devtools available via Chrome extension:
// https://chrome.google.com/webstore/detail/react-query-devtools/ooaplkfkopclpbpjgbhfjllmbjdpakoh
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState } from "react";
import { PageProvider } from "@/components/chrome/page-context";
import { ConfigProvider, ServiceProvider } from "@/contexts";
import { AuthProvider, UserProvider } from "@/lib/auth";
import { MockProvider } from "@/mocks/MockProvider";
import { isApiError } from "@/lib/api/fetcher";
import { QUERY_STALE_TIME_MS, QUERY_MAX_RETRY_DELAY_MS } from "@/lib/config";

// =============================================================================
// Performance-Optimized Query Client
// =============================================================================

/**
 * Creates an optimized QueryClient with:
 * - Short caching for real-time data accuracy
 * - Background refetching on window focus
 * - Structural sharing for minimal re-renders
 * - Smart retry with exponential backoff
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data freshness - use config value (default 1 min)
        staleTime: QUERY_STALE_TIME_MS,
        // Keep unused data in cache for 5 minutes
        gcTime: 5 * 60 * 1000,
        // Refetch stale data when window regains focus - ensures fresh data
        refetchOnWindowFocus: "always",
        // Refetch on mount to ensure latest data
        refetchOnMount: true,
        // Refetch when network reconnects
        refetchOnReconnect: true,
        // Structural sharing - only update references if data actually changed
        // This prevents unnecessary re-renders when data is the same
        structuralSharing: true,
        // Network mode - online first for real-time accuracy
        networkMode: "online",
        // Retry logic
        retry: (failureCount, error) => {
          // Check if error is an ApiError with retryable flag
          if (isApiError(error)) {
            return error.isRetryable && failureCount < 2;
          }
          // For other errors, don't retry (fail fast)
          return false;
        },
        retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, QUERY_MAX_RETRY_DELAY_MS),
      },
      mutations: {
        // Retry failed mutations once
        retry: 1,
        retryDelay: 1000,
        // Network mode for mutations
        networkMode: "online",
      },
    },
  });
}

// =============================================================================
// Provider Props
// =============================================================================

interface ProvidersProps {
  children: React.ReactNode;
  /**
   * Dehydrated state from server-side prefetching.
   * Pass this from Server Components to hydrate the query cache.
   *
   * @example
   * ```tsx
   * // In a Server Component
   * const queryClient = new QueryClient();
   * await prefetchPools(queryClient);
   * const dehydratedState = dehydrate(queryClient);
   *
   * return <Providers dehydratedState={dehydratedState}>{children}</Providers>;
   * ```
   */
  dehydratedState?: DehydratedState;
}

// =============================================================================
// Main Providers Component
// =============================================================================

/**
 * Application providers wrapper.
 *
 * Provides:
 * - TanStack Query for data fetching (with optional SSR hydration)
 * - Theme provider (dark/light mode)
 * - URL state (nuqs)
 * - Auth context
 * - User context
 * - Service context (clipboard, announcer)
 * - Config context
 * - Mock provider (dev only)
 *
 * @param props.children - App content
 * @param props.dehydratedState - Optional prefetched query state from server
 */
export function Providers({ children, dehydratedState }: ProvidersProps) {
  // useState ensures single instance across re-renders
  const [queryClient] = useState(createQueryClient);

  return (
    <ConfigProvider>
      <ServiceProvider>
        <MockProvider>
          <NuqsAdapter>
            <QueryClientProvider client={queryClient}>
              <HydrationBoundary state={dehydratedState}>
                <ThemeProvider
                  attribute="class"
                  defaultTheme="system"
                  enableSystem
                  disableTransitionOnChange
                >
                  <AuthProvider>
                    <UserProvider>
                      <PageProvider>{children}</PageProvider>
                    </UserProvider>
                  </AuthProvider>
                </ThemeProvider>
              </HydrationBoundary>
            </QueryClientProvider>
          </NuqsAdapter>
        </MockProvider>
      </ServiceProvider>
    </ConfigProvider>
  );
}

// =============================================================================
// Export Query Client Factory for Server Components
// =============================================================================

/**
 * Create a QueryClient for server-side prefetching.
 *
 * Use this in Server Components to create a client for prefetching,
 * then pass the dehydrated state to Providers.
 *
 * @example
 * ```tsx
 * // In layout.tsx or page.tsx (Server Component)
 * import { createServerQueryClient } from '@/components/providers';
 * import { dehydrate } from '@tanstack/react-query';
 *
 * export default async function Layout({ children }) {
 *   const queryClient = createServerQueryClient();
 *   await prefetchSomeData(queryClient);
 *
 *   return (
 *     <Providers dehydratedState={dehydrate(queryClient)}>
 *       {children}
 *     </Providers>
 *   );
 * }
 * ```
 */
export { createQueryClient as createServerQueryClient };
