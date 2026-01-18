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
 * Workflows With Data (Async Server Component)
 *
 * This component suspends while prefetching data on the server.
 * When wrapped in Suspense, it enables streaming:
 * 1. Parent renders skeleton immediately
 * 2. This component awaits data fetch
 * 3. When ready, React streams the content to replace skeleton
 *
 * nuqs Compatibility:
 * - Receives searchParams and parses filter chips
 * - Uses same query key format as client hooks
 * - Result: cache hit when client hydrates!
 */

import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { prefetchWorkflowsList } from "@/lib/api/server";
import { WorkflowsPageContent } from "./workflows-page-content";
import { parseUrlChips } from "@/lib/url-utils";

interface WorkflowsWithDataProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function WorkflowsWithData({ searchParams }: WorkflowsWithDataProps) {
  // Create QueryClient for this request
  const queryClient = new QueryClient();

  // Parse URL filter params (same format nuqs will read on client)
  const params = await searchParams;
  const filterChips = parseUrlChips(params.f);

  // This await causes the component to suspend
  // React streams the Suspense fallback, then streams this when ready
  await prefetchWorkflowsList(queryClient, filterChips);

  // Wrap in HydrationBoundary so client gets the cached data
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <WorkflowsPageContent />
    </HydrationBoundary>
  );
}
