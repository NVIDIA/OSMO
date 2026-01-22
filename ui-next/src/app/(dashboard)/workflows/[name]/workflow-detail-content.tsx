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
 * Workflow Detail Page
 *
 * Displays a single workflow with:
 * - DAG visualization of workflow groups and their dependencies
 * - Unified multi-layer inspector panel (workflow → group → task)
 * - URL-synced navigation for shareable deep links
 *
 * Architecture (Side-by-Side Model):
 * - Uses flexbox layout with DAG and Panel as siblings
 * - DAG canvas fills available space (flex-1)
 * - Panel has fixed percentage width
 * - Components are completely decoupled
 *
 * URL Navigation:
 * - /workflows/[name] → Workflow view
 * - /workflows/[name]?group=step-1 → Group view
 * - /workflows/[name]?group=step-1&task=my-task&retry=0 → Task view
 *
 * Keyboard Navigation:
 * - Escape → Collapse panel (when expanded)
 * - Enter → Expand panel (when focused on collapsed strip)
 * - Browser back/forward → Navigate through URL history
 *
 * Performance:
 * - ReactFlow (~200KB+) is dynamically imported - not in initial bundle
 * - ELK layout worker is preloaded for instant DAG rendering
 * - All ReactFlow hooks/components behind dynamic boundary
 */

"use client";

import dynamic from "next/dynamic";
import { usePage } from "@/components/chrome";
import { InlineErrorBoundary } from "@/components/error";
import { preloadElkWorker } from "@/components/dag";

// =============================================================================
// Dynamic Import for ReactFlow
// =============================================================================
// ReactFlow + ELK.js are heavy (~200KB+ gzipped). We dynamically import them
// to keep the initial bundle small. This is especially important for:
// - Mobile users on slow networks
// - Users who navigate directly to non-workflow pages
// - Faster initial page load across the app
//
// The WorkflowDetailInner component contains ALL ReactFlow dependencies and
// is behind this dynamic boundary to ensure @xyflow/react stays out of the
// initial bundle.

const WorkflowDetailInnerDynamic = dynamic(
  () =>
    import("./workflow-detail-inner")
      .then((mod) => {
        console.log("[DAG] Successfully loaded workflow detail inner module");
        return mod.WorkflowDetailInnerWithProvider;
      })
      .catch((error) => {
        console.error("[DAG] Failed to load workflow detail inner:", error);
        throw error;
      }),
  {
    ssr: false,
    loading: () => {
      console.log("[DAG] Loading workflow visualization...");
      return (
        <div className="flex h-full w-full items-center justify-center bg-gray-50 dark:bg-zinc-950">
          <div className="text-center text-gray-500 dark:text-zinc-500">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-zinc-600 dark:border-t-zinc-300" />
            <p>Loading visualization...</p>
          </div>
        </div>
      );
    },
  },
);

// Preload ELK worker on module load (before first render)
// This hides worker initialization latency from the user
if (typeof window !== "undefined") {
  preloadElkWorker();
}

// =============================================================================
// Types
// =============================================================================

interface WorkflowDetailContentProps {
  /** Workflow name from URL params */
  name: string;
}

// =============================================================================
// Exported Content Component
// =============================================================================

/**
 * Workflow Detail Content (Client Component)
 *
 * The interactive content of the workflow detail page.
 * Receives the workflow name and renders the DAG visualization and panels.
 *
 * This is separated from the page.tsx to allow server-side prefetching
 * while keeping all interactive functionality client-side.
 *
 * Performance: All ReactFlow dependencies are dynamically loaded via
 * WorkflowDetailInnerDynamic to keep them out of the initial bundle.
 */
export function WorkflowDetailContent({ name }: WorkflowDetailContentProps) {
  usePage({
    title: name,
    breadcrumbs: [{ label: "Workflows", href: "/workflows" }],
  });

  return (
    <InlineErrorBoundary title="Unable to display workflow" onReset={() => window.location.reload()}>
      <div className="h-full">
        <WorkflowDetailInnerDynamic name={name} />
      </div>
    </InlineErrorBoundary>
  );
}
