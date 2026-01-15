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
// Static Metadata (SEO)
// =============================================================================

export const metadata: Metadata = {
  title: "Workflows | OSMO",
  description: "Monitor and manage compute workflows, tasks, and job executions.",
};

/**
 * Workflows Page (Server Component)
 *
 * This is a Server Component that prefetches workflow data during SSR.
 * The actual interactive content is rendered by WorkflowsPageContent (Client Component).
 *
 * Architecture:
 * 1. Server Component prefetches data using prefetchWorkflows()
 * 2. Data is dehydrated and passed to HydrationBoundary
 * 3. Client Component hydrates and uses useWorkflowsData() which gets cached data
 * 4. TanStack Query handles background refetching and pagination
 */

import { Suspense } from "react";
import { dehydrate, QueryClient, HydrationBoundary } from "@tanstack/react-query";
import { prefetchWorkflows } from "@/lib/api/server";
import { WorkflowsPageContent } from "./workflows-page-content";
import { WorkflowsPageSkeleton } from "./workflows-page-skeleton";

// =============================================================================
// Server Component (Prefetch + Hydration)
// =============================================================================

export default async function WorkflowsPage() {
  // Create a new QueryClient for this request
  const queryClient = new QueryClient();

  // Prefetch initial workflows data on the server
  // We prefetch the default query (first page, no filters)
  await prefetchWorkflows(queryClient, {}, { revalidate: 30 });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense fallback={<WorkflowsPageSkeleton />}>
        <WorkflowsPageContent />
      </Suspense>
    </HydrationBoundary>
  );
}
