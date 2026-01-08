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
 * Workflows Page
 *
 * Displays a table of all workflows with:
 * - Smart search with filter chips (status, user, pool, priority)
 * - Column visibility and reordering
 * - Status-based row styling
 * - Infinite scroll pagination
 * - Navigation to workflow detail page on row click
 *
 * Architecture:
 * - useWorkflowsData encapsulates data fetching, filtering, and pagination
 * - UI receives paginated, pre-filtered data
 * - Uses Zustand for state persistence
 * - Uses nuqs for URL state synchronization
 */

"use client";

import { InlineErrorBoundary } from "@/components/error";
import { usePage } from "@/components/shell";
import { useUrlChips } from "@/hooks";
import { WorkflowsDataTable } from "./components/table/workflows-data-table";
import { WorkflowsToolbar } from "./components/workflows-toolbar";
import { useWorkflowsData } from "./hooks/use-workflows-data";

// =============================================================================
// Main Page Component
// =============================================================================

export default function WorkflowsPage() {
  usePage({ title: "Workflows" });

  // ==========================================================================
  // URL State - All state is URL-synced for shareable deep links
  // URL: /workflows?f=status:running&f=user:alice
  // ==========================================================================

  // Filter chips - URL-synced via shared hook
  const { searchChips, setSearchChips } = useUrlChips();

  // ==========================================================================
  // Data Fetching with SmartSearch filtering and pagination
  // ==========================================================================

  const { workflows, allWorkflows, isLoading, error, refetch, hasMore, fetchNextPage, isFetchingNextPage, total } =
    useWorkflowsData({
      searchChips,
    });

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toolbar with search and controls */}
      <div className="shrink-0">
        <InlineErrorBoundary
          title="Toolbar error"
          compact
        >
          <WorkflowsToolbar
            workflows={allWorkflows}
            searchChips={searchChips}
            onSearchChipsChange={setSearchChips}
          />
        </InlineErrorBoundary>
      </div>

      {/* Main workflows table */}
      <div className="min-h-0 flex-1">
        <InlineErrorBoundary
          title="Unable to display workflows table"
          resetKeys={[workflows.length]}
          onReset={refetch}
        >
          <WorkflowsDataTable
            workflows={workflows}
            totalCount={total}
            isLoading={isLoading}
            error={error ?? undefined}
            onRetry={refetch}
            hasNextPage={hasMore}
            onLoadMore={fetchNextPage}
            isFetchingNextPage={isFetchingNextPage}
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );
}
