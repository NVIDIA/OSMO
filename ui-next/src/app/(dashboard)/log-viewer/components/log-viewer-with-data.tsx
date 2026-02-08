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
 * Log Viewer With Data (Async Server Component)
 *
 * This component suspends while prefetching log data on the server.
 * When wrapped in Suspense, it enables streaming (Partial Prerender):
 * 1. Parent renders skeleton immediately
 * 2. This component awaits data fetch
 * 3. When ready, React streams the content to replace skeleton
 *
 * Benefits:
 * - Fast TTFB (skeleton streams immediately)
 * - No client-side fetch for initial data (data in hydrated cache)
 * - Seamless content swap (React handles it)
 *
 * This pattern mirrors production usage where log-viewer will be used on:
 * - Task logs, Group logs, Workflow logs pages
 * - Static logs (completed workflows)
 * - Streaming logs (running workflows)
 * - Permalinked logs
 */

import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchLogData } from "@/lib/api/server/logs";
import { fetchWorkflowByName } from "@/lib/api/server/workflows";
import { LogViewerPageContent } from "@/app/(dashboard)/log-viewer/components/log-viewer-page-content";
import { createQueryClient } from "@/lib/query-client";

interface LogViewerWithDataProps {
  /** URL search params passed from page */
  searchParams: Promise<{ workflow?: string }>;
}

export async function LogViewerWithData({ searchParams }: LogViewerWithDataProps) {
  // Next.js 16: await searchParams in async Server Components
  const params = await searchParams;
  const workflowId = params.workflow;

  if (!workflowId) {
    throw new Error("Missing required parameter: workflow");
  }

  // Create QueryClient for this request using shared factory
  const queryClient = createQueryClient();

  // Fetch and validate workflow metadata
  // For SSR: Try to prefetch metadata, but if it fails (e.g., mock workflows in dev),
  // continue anyway and let client-side fetch handle it
  let workflowMetadata = null;

  try {
    const workflow = await fetchWorkflowByName(workflowId, true);

    if (workflow) {
      // Extract metadata for timeline bounds
      workflowMetadata = {
        name: workflow.name,
        status: workflow.status,
        submitTime: workflow.submit_time ? new Date(workflow.submit_time) : undefined,
        startTime: workflow.start_time ? new Date(workflow.start_time) : undefined,
        endTime: workflow.end_time ? new Date(workflow.end_time) : undefined,
      };
    }
    // If workflow is null, metadata remains null and client will fetch it
  } catch (_err) {
    // Server-side fetch failed (e.g., mock workflows, network issues)
    // This is okay - metadata remains null and client will fetch it
    // No need to show error since client-side fetching might succeed
  }

  // Prefetch log data - this await causes the component to suspend
  // React streams the Suspense fallback, then streams this when ready
  await prefetchLogData(queryClient, {
    workflowId,
  });

  // Wrap in HydrationBoundary so client gets the cached data
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LogViewerPageContent
        workflowId={workflowId}
        workflowMetadata={workflowMetadata}
      />
    </HydrationBoundary>
  );
}
