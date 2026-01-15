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
 * Workflow Detail Page (Server Component)
 *
 * This is a Server Component that prefetches workflow data during SSR.
 * The actual interactive content (DAG, panels) is rendered by
 * WorkflowDetailContent (Client Component).
 *
 * Architecture:
 * 1. Server Component receives params and prefetches workflow data
 * 2. Data is dehydrated and passed to HydrationBoundary
 * 3. Client Component hydrates and uses useWorkflow() which gets cached data
 * 4. TanStack Query handles background refetching for live updates
 *
 * Benefits:
 * - Faster initial render (workflow structure is pre-rendered)
 * - No loading spinner on initial page load
 * - Better SEO and link previews (if needed)
 */

import { Suspense } from "react";
import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { fetchWorkflowByName } from "@/lib/api/server";
import { WorkflowDetailContent } from "./workflow-detail-content";
import { WorkflowDetailSkeleton } from "./workflow-detail-skeleton";

// =============================================================================
// Types
// =============================================================================

interface WorkflowDetailPageProps {
  params: Promise<{ name: string }>;
}

// =============================================================================
// Server Component (Prefetch + Hydration)
// =============================================================================

export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
  // Await params (Next.js 15+ async params)
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  // Create a new QueryClient for this request
  const queryClient = new QueryClient();

  // Prefetch workflow data on the server
  // Use short revalidation for workflow detail (it changes frequently)
  await queryClient.prefetchQuery({
    queryKey: ["workflow", decodedName],
    queryFn: () => fetchWorkflowByName(decodedName, true, { revalidate: 30 }),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<WorkflowDetailSkeleton />}>
        <WorkflowDetailContent name={decodedName} />
      </Suspense>
    </HydrationBoundary>
  );
}
