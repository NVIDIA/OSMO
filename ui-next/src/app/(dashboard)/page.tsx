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
 * Dashboard Page (Server Component)
 *
 * The main dashboard with key metrics and recent workflows.
 * Uses parallel data fetching for optimal performance.
 *
 * Optimization: All data is fetched in parallel on the server,
 * reducing total request time from sequential (t1 + t2 + t3)
 * to parallel (max(t1, t2, t3)).
 */

import { Suspense } from "react";
import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { fetchPools, fetchWorkflows, fetchVersion } from "@/lib/api/server";
import { DashboardContent } from "./dashboard-content";
import { DashboardSkeleton } from "./dashboard-skeleton";

// =============================================================================
// Server Component with Parallel Data Fetching
// =============================================================================

export default async function DashboardPage() {
  const queryClient = new QueryClient();

  // Parallel data fetching - all requests start simultaneously
  // This is faster than sequential: Promise.all() vs await each
  await Promise.all([
    // Prefetch pools for stats
    queryClient.prefetchQuery({
      queryKey: ["pools", "all"],
      queryFn: () => fetchPools({ revalidate: 60 }),
    }),

    // Prefetch recent workflows
    queryClient.prefetchQuery({
      queryKey: ["workflows", { limit: 10 }],
      queryFn: () => fetchWorkflows({ limit: 10 }, { revalidate: 30 }),
    }),

    // Prefetch version
    queryClient.prefetchQuery({
      queryKey: ["version"],
      queryFn: () => fetchVersion({ revalidate: 600 }),
    }),
  ]);

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </HydrationBoundary>
  );
}
