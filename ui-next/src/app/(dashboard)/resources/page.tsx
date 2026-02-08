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
 * Resources Page (Streaming SSR with Server Prefetch)
 *
 * Architecture: Hybrid streaming for optimal UX
 * 1. Page shell + skeleton stream immediately (fast TTFB)
 * 2. ResourcesWithData suspends while prefetching on server
 * 3. When API responds, content streams in and replaces skeleton
 * 4. Client hydrates with data already in cache (no client fetch!)
 *
 * nuqs Compatibility:
 * - URL params passed to async component for query key matching
 * - Client's nuqs hooks read same params → cache hit!
 */

import { Suspense } from "react";
import { ResourcesPageSkeleton } from "@/app/(dashboard)/resources/resources-page-skeleton";
import { ResourcesWithData } from "@/app/(dashboard)/resources/resources-with-data";

// =============================================================================
// Types
// =============================================================================

interface ResourcesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// =============================================================================
// Streaming SSR - Fast TTFB + Server Prefetch
// =============================================================================

export default function ResourcesPage({ searchParams }: ResourcesPageProps) {
  // No await - returns immediately with skeleton
  // ResourcesWithData suspends and streams when data is ready
  return (
    <Suspense fallback={<ResourcesPageSkeleton />}>
      <ResourcesWithData searchParams={searchParams} />
    </Suspense>
  );
}
