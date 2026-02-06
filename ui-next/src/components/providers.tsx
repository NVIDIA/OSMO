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

import { QueryClientProvider, HydrationBoundary } from "@tanstack/react-query";
import type { DehydratedState } from "@tanstack/react-query";
// React Query Devtools available via Chrome extension:
// https://chrome.google.com/webstore/detail/react-query-devtools/ooaplkfkopclpbpjgbhfjllmbjdpakoh
import { ThemeProvider } from "next-themes";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { useState } from "react";
import { PageProvider } from "@/components/chrome/page-context";
import { BreadcrumbOriginProvider } from "@/components/chrome/breadcrumb-origin-context";
import { ConfigProvider } from "@/contexts/config-context";
import { ServiceProvider } from "@/contexts/service-context";
import { UserProvider } from "@/lib/auth/user-context";
import { MockProvider } from "@/mocks/MockProvider";
import { createQueryClient } from "@/lib/query-client";

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
                  <UserProvider>
                    <PageProvider>
                      <BreadcrumbOriginProvider>{children}</BreadcrumbOriginProvider>
                    </PageProvider>
                  </UserProvider>
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

export { createQueryClient as createServerQueryClient };
