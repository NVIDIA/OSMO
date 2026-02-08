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
 * Workflow Detail With Data (Async Server Component)
 *
 * This component suspends while prefetching workflow data on the server.
 * When wrapped in Suspense, it enables streaming:
 * 1. Parent renders skeleton immediately
 * 2. This component awaits workflow data fetch
 * 3. When ready, React streams the content (including DAG) to replace skeleton
 *
 * Benefits:
 * - User sees skeleton immediately (fast TTFB)
 * - DAG visualization streams in as soon as server has data
 * - No client-side fetch needed (data in hydrated cache)
 * - TanStack Query handles background refetch for live updates
 */

import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchWorkflowByName } from "@/lib/api/server/workflows";
import { WorkflowDetailContent } from "@/app/(dashboard)/workflows/[name]/workflow-detail-content";
import { createQueryClient } from "@/lib/query-client";

interface WorkflowDetailWithDataProps {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function WorkflowDetailWithData({ params, searchParams }: WorkflowDetailWithDataProps) {
  // Next.js 16: await params/searchParams in async Server Components
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  // Parse URL search params on server (zero client hydration delay)
  const urlParams = await searchParams;
  const initialView = {
    groupName: typeof urlParams.group === "string" ? urlParams.group : null,
    taskName: typeof urlParams.task === "string" ? urlParams.task : null,
    taskRetryId:
      typeof urlParams.retry === "string" && !isNaN(parseInt(urlParams.retry, 10))
        ? parseInt(urlParams.retry, 10)
        : null,
  };

  // Create QueryClient for this request using shared factory
  // This ensures server-side defaults match client-side defaults
  const queryClient = createQueryClient();

  // This await causes the component to suspend
  // React streams the Suspense fallback, then streams this when ready
  try {
    await prefetchWorkflowByName(queryClient, decodedName);
  } catch (error) {
    // Prefetch failed (e.g., auth unavailable during HMR, network error, backend down)
    // Page will still render - client will fetch on hydration if cache is empty
    console.debug(
      `[Server Prefetch] Could not prefetch workflow "${decodedName}":`,
      error instanceof Error ? error.message : "Unknown error",
    );
  }

  // Wrap in HydrationBoundary so client gets the cached data
  // Pass initialView for instant panel rendering (no nuqs hydration delay)
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkflowDetailContent
        name={decodedName}
        initialView={initialView}
      />
    </HydrationBoundary>
  );
}
