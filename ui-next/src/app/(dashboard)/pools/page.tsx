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
 * Pools Page (Streaming SSR with Server Prefetch)
 *
 * Architecture: Hybrid streaming for optimal UX
 * 1. Page shell + skeleton stream immediately (fast TTFB)
 * 2. PoolsWithData suspends while prefetching on server
 * 3. When API responds, content streams in and replaces skeleton
 * 4. Client hydrates with data already in cache (no client fetch!)
 *
 * Performance:
 * - TTFB: ~100ms (shell + skeleton)
 * - Time to content: ~API response time
 * - Client network requests: 0 (data in hydrated cache)
 *
 * This gives the best of both worlds:
 * - User sees immediate feedback (skeleton)
 * - Content streams in as soon as server has it
 * - No client-side data fetching needed
 */

import { Suspense } from "react";
import { PoolsPageSkeleton } from "@/app/(dashboard)/pools/pools-page-skeleton";
import { PoolsWithData } from "@/app/(dashboard)/pools/pools-with-data";

// =============================================================================
// Streaming SSR - Fast TTFB + Server Prefetch
// =============================================================================

export default function PoolsPage() {
  // No await - returns immediately with skeleton
  // PoolsWithData suspends and streams when data is ready
  return (
    <Suspense fallback={<PoolsPageSkeleton />}>
      <PoolsWithData />
    </Suspense>
  );
}
