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

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// React Query Devtools available via Chrome extension:
// https://chrome.google.com/webstore/detail/react-query-devtools/ooaplkfkopclpbpjgbhfjllmbjdpakoh
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState } from "react";
import { SidebarProvider } from "@/components/shell/sidebar-context";
import { PageProvider } from "@/components/shell/page-context";
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

export function Providers({ children }: { children: React.ReactNode }) {
  // useState ensures single instance across re-renders
  const [queryClient] = useState(createQueryClient);

  return (
    <MockProvider>
      <NuqsAdapter>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <AuthProvider>
              <UserProvider>
                <SidebarProvider>
                  <PageProvider>{children}</PageProvider>
                </SidebarProvider>
              </UserProvider>
            </AuthProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </NuqsAdapter>
    </MockProvider>
  );
}
