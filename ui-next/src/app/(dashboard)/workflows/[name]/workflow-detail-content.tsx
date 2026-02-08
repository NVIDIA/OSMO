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
 * - ReactFlow is bundled with this route (not lazy-loaded)
 * - ELK layout worker is preloaded for instant DAG rendering
 * - Server prefetches workflow data before client loads
 * - DAG renders immediately when page loads (no spinner delay)
 */

"use client";

import { usePage } from "@/components/chrome/page-context";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { preloadElkWorker } from "@/components/dag/layout/elk-worker-client";
import { WorkflowDetailInnerWithProvider } from "@/app/(dashboard)/workflows/[name]/workflow-detail-inner";

// =============================================================================
// Direct Import for ReactFlow
// =============================================================================
// RATIONALE: Workflow pages are the PRIMARY use case for this app.
// The previous dynamic() import with ssr: false caused unnecessary delays:
//   1. User navigates to workflow page
//   2. Server prefetches data (fast! ✓)
//   3. Client receives hydrated data (instant! ✓)
//   4. Browser downloads ReactFlow chunk... (SLOW! ✗)
//   5. Finally renders DAG
//
// By importing directly:
//   - Next.js automatic route-based code splitting still applies
//   - ReactFlow is bundled with THIS route, not the global bundle
//   - No download delay - chunk is already part of the route bundle
//   - DAG renders immediately when data is ready
//
// Trade-off: Slightly larger route bundle (~200KB), but:
//   - This IS the main feature - users expect it immediately
//   - Route-level splitting means other pages aren't affected
//   - Much better UX for the 99% use case

// Preload ELK worker on module load (before first render)
// This hides worker initialization latency from the user
if (typeof window !== "undefined") {
  preloadElkWorker();
}

// =============================================================================
// Types
// =============================================================================

export interface InitialView {
  groupName: string | null;
  taskName: string | null;
  taskRetryId: number | null;
}

interface WorkflowDetailContentProps {
  /** Workflow name from URL params */
  name: string;
  /** Server-parsed URL state for instant panel rendering */
  initialView: InitialView;
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
 * Performance: ReactFlow is imported directly (not dynamically) because
 * workflow visualization is the primary feature. Next.js route-based code
 * splitting ensures other pages aren't affected.
 */
export function WorkflowDetailContent({ name, initialView }: WorkflowDetailContentProps) {
  usePage({
    title: name,
    breadcrumbs: [{ label: "Workflows", href: "/workflows" }],
  });

  return (
    <InlineErrorBoundary
      title="Unable to display workflow"
      onReset={() => window.location.reload()}
    >
      <div className="h-full">
        <WorkflowDetailInnerWithProvider
          name={name}
          initialView={initialView}
        />
      </div>
    </InlineErrorBoundary>
  );
}
