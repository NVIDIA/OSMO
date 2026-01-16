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
  title: "Pools | OSMO",
  description: "View and manage compute pools, quotas, and resource allocation.",
};

/**
 * Pools Page (Server Component)
 *
 * This is a Server Component that prefetches pool data during SSR.
 * The actual interactive content is rendered by PoolsPageContent (Client Component).
 *
 * Architecture:
 * 1. Server Component prefetches data using fetchPools()
 * 2. Data is dehydrated and passed to HydrationBoundary
 * 3. Client Component hydrates and uses usePoolsData() which gets cached data
 * 4. TanStack Query handles background refetching after hydration
 *
 * Benefits:
 * - No loading spinner on initial page load (data is pre-rendered)
 * - Faster Time to First Contentful Paint (FCP)
 * - Reduced client JavaScript for initial data fetch
 * - SEO-friendly (content is in HTML)
 */

import { Suspense } from "react";
import { PoolsPageContent } from "./pools-page-content";
import { PoolsPageSkeleton } from "./pools-page-skeleton";

// =============================================================================
// Streaming SSR - Fast TTFB + Progressive Content
// =============================================================================

export default function PoolsPage() {
  return (
    <Suspense fallback={<PoolsPageSkeleton />}>
      <PoolsPageContent />
    </Suspense>
  );
}
