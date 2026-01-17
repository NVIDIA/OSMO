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
import { WorkflowDetailContent } from "./workflow-detail-content";
import { WorkflowDetailSkeleton } from "./workflow-detail-skeleton";

// =============================================================================
// Types
// =============================================================================

interface WorkflowDetailPageProps {
  params: Promise<{ name: string }>;
}

// =============================================================================
// Streaming SSR - Fast TTFB + Progressive Content
// =============================================================================

export default async function WorkflowDetailPage({ params }: WorkflowDetailPageProps) {
  // Await params (Next.js 15+ async params)
  const { name } = await params;
  const decodedName = decodeURIComponent(name);

  // Shell renders immediately, WorkflowDetailContent fetches data on render
  // DAG visualization streams in as workflow data becomes available
  return (
    <Suspense fallback={<WorkflowDetailSkeleton />}>
      <WorkflowDetailContent name={decodedName} />
    </Suspense>
  );
}
