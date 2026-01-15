/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Metadata } from "next";

// =============================================================================
// Static Metadata (SEO)
// =============================================================================

export const metadata: Metadata = {
  title: "Resources | OSMO",
  description: "View compute resources, GPU nodes, and their allocation across pools.",
};

/**
 * Resources Page (Server Component)
 *
 * This is a Server Component that prefetches resource data during SSR.
 * The actual interactive content is rendered by ResourcesPageContent (Client Component).
 *
 * Architecture:
 * 1. Server Component prefetches data using prefetchResources()
 * 2. Data is dehydrated and passed to HydrationBoundary
 * 3. Client Component hydrates and uses useResourcesData() which gets cached data
 * 4. TanStack Query handles background refetching after hydration
 */

import { Suspense } from "react";
import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { prefetchResources } from "@/lib/api/server";
import { ResourcesPageContent } from "./resources-page-content";
import { ResourcesPageSkeleton } from "./resources-page-skeleton";

// =============================================================================
// Server Component (Prefetch + Hydration)
// =============================================================================

export default async function ResourcesPage() {
  // Create a new QueryClient for this request
  const queryClient = new QueryClient();

  // Prefetch resources data on the server
  // Resources are expensive - use longer revalidation
  await prefetchResources(queryClient, { revalidate: 300 });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<ResourcesPageSkeleton />}>
        <ResourcesPageContent />
      </Suspense>
    </HydrationBoundary>
  );
}
