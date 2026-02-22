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
 * Why prefetch only metadata: Logs can be huge (MBs) and streaming (infinite for running workflows).
 * Server prefetch would timeout or block. Client streaming during hydration is faster.
 *
 * Why this architecture works:
 * - Metadata: Small, static → SSR'd for instant availability
 * - Logs: Large, potentially infinite → Client streams via zero-copy proxy
 * - Result: Fast TTFB + parallel loading + no timeout issues
 */

import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { prefetchWorkflowByName } from "@/lib/api/server/workflows";
import { LogViewerPageContent } from "@/features/log-viewer/components/log-viewer-page-content";
import { createServerQueryClient } from "@/lib/query-client";

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

  const queryClient = createServerQueryClient();

  // Why prefetch: Avoid client waterfall (page load → fetch metadata → render).
  // Why ignore errors: Client will retry after hydration if needed.
  // verbose=false: log viewer only needs logs URL + status, not full task details.
  // Key must match useGetWorkflowApiWorkflowNameGet(workflowId, { verbose: false }).
  try {
    await prefetchWorkflowByName(queryClient, workflowId, false);
  } catch (error) {
    console.warn("Server-side workflow prefetch failed:", error);
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <LogViewerPageContent workflowId={workflowId} />
    </HydrationBoundary>
  );
}
