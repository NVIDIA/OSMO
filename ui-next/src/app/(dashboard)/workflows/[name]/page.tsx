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

import type { Metadata } from "next";

// =============================================================================
// Static Metadata with Template (SEO)
// =============================================================================
// Note: Using static metadata to enable PPR (Partial Prerendering).
// The actual workflow name is shown in the page header and browser tab
// updates via the usePage() hook in WorkflowDetailContent.

export const metadata: Metadata = {
  title: "Workflow Details | OSMO",
  description: "View workflow details, DAG visualization, and task status.",
};

/**
 * Workflow Detail Page (Streaming SSR with Server Prefetch)
 *
 * Architecture: Hybrid streaming for optimal UX
 * 1. Page shell + skeleton stream immediately (fast TTFB)
 * 2. WorkflowDetailWithData suspends while prefetching on server
 * 3. When API responds, content streams in and replaces skeleton
 * 4. Client hydrates with data already in cache (no client fetch!)
 *
 * Performance:
 * - TTFB: ~100ms (shell + skeleton)
 * - DAG renders as soon as server gets workflow data
 * - Client network requests: 0 (data in hydrated cache)
 */

import { Suspense } from "react";
import { WorkflowDetailSkeleton } from "./workflow-detail-skeleton";
import { WorkflowDetailWithData } from "./workflow-detail-with-data";

// =============================================================================
// Types
// =============================================================================

interface WorkflowDetailPageProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

// =============================================================================
// Streaming SSR - Fast TTFB + Server Prefetch
// =============================================================================

export default function WorkflowDetailPage({ params, searchParams }: WorkflowDetailPageProps) {
  // No await - returns immediately with skeleton
  // WorkflowDetailWithData suspends and streams when data is ready
  // searchParams passed to enable server-side URL parsing (zero client hydration delay)
  return (
    <Suspense fallback={<WorkflowDetailSkeleton />}>
      <WorkflowDetailWithData
        params={params}
        searchParams={searchParams}
      />
    </Suspense>
  );
}
