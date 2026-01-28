/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Resources Page Content (Client Component)
 *
 * The interactive content of the Resources page.
 * Receives hydrated data from the server and handles all user interactions.
 *
 * Features:
 * - FilterBar for filtering
 * - URL-synced panel state (?view=resource&config=pool)
 * - Resizable details panel
 * - Infinite scroll pagination
 * - "You've reached the end" indicator
 */

"use client";

import { useMemo, useCallback } from "react";
import { usePage } from "@/components/chrome";
import { InlineErrorBoundary, ApiError, type ApiErrorProps } from "@/components/error";
import { useUrlChips, usePanelState, useResultsCount, useViewTransition } from "@/hooks";
import type { Resource } from "@/lib/api/adapter";
import { useSharedPreferences } from "@/stores";
import { ResourcesTable } from "./components/table/resources-table";
import { ResourcePanelLayout } from "./components/panel/resource-panel";
import { ResourcesToolbar } from "./components/resources-toolbar";
import { AdaptiveSummary } from "./components/resource-summary-card";
import { useResourcesData } from "./hooks/use-resources-data";
import type { ResourceAggregates } from "./lib/computeAggregates";

// =============================================================================
// Client Component
// =============================================================================

export function ResourcesPageContent({ initialAggregates }: { initialAggregates?: ResourceAggregates | null }) {
  usePage({ title: "Resources" });
  const { startTransition } = useViewTransition();

  // Shared preferences for display mode
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // ==========================================================================
  // URL State - All state is URL-synced for shareable deep links
  // URL: /resources?view=my-resource&config=pool-name&f=platform:dgx&f=pool:ml-team
  // ==========================================================================

  // Panel state (consolidated URL state hooks)
  const {
    selection: selectedResourceName,
    setSelection: setSelectedResourceName,
    config: selectedPoolConfig,
    setConfig: setSelectedPoolConfig,
    clear: clearSelectedResource,
  } = usePanelState();

  const handleResourceSelect = useCallback(
    (resourceName: string | null) => {
      startTransition(() => setSelectedResourceName(resourceName));
    },
    [setSelectedResourceName, startTransition],
  );

  const handlePoolSelect = useCallback(
    (poolName: string | null) => {
      startTransition(() => setSelectedPoolConfig(poolName));
    },
    [setSelectedPoolConfig, startTransition],
  );

  const handleClose = useCallback(() => {
    startTransition(() => clearSelectedResource());
  }, [clearSelectedResource, startTransition]);

  // Filter chips - URL-synced via shared hook
  const { searchChips, setSearchChips } = useUrlChips();

  // ==========================================================================
  // Data Fetching with FilterBar filtering
  // Data is hydrated from server prefetch - no loading spinner on initial load!
  // ==========================================================================

  const {
    resources,
    allResources,
    totalCount,
    filteredCount,
    isLoading,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    aggregates: queryAggregates,
  } = useResourcesData({ searchChips });

  // Check if filters are active
  const hasActiveFilters = searchChips.length > 0;

  // Results count for FilterBar display (consolidated hook)
  const resultsCount = useResultsCount({
    total: totalCount ?? resources.length,
    filteredTotal: filteredCount ?? resources.length,
    hasActiveFilters,
  });

  // ==========================================================================
  // Aggregates - Prefer query aggregates, fallback to initial (server prefetch)
  // The shim computes aggregates for the full filtered dataset on every request
  // ==========================================================================

  const aggregates = queryAggregates ?? initialAggregates;

  // ==========================================================================
  // Resource Selection
  // ==========================================================================

  // Find selected resource
  const selectedResource = useMemo<Resource | null>(
    () => (selectedResourceName ? (resources.find((r) => r.name === selectedResourceName) ?? null) : null),
    [resources, selectedResourceName],
  );

  // Handle resource click
  const handleResourceClick = useCallback(
    (resource: Resource) => {
      handleResourceSelect(resource.name);
    },
    [handleResourceSelect],
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <ResourcePanelLayout
      resource={selectedResource}
      onClose={handleClose}
      selectedPool={selectedPoolConfig}
      onPoolSelect={handlePoolSelect}
    >
      <div className="flex h-full flex-col gap-4 p-6">
        {/* Toolbar with FilterBar */}
        <div className="shrink-0">
          <InlineErrorBoundary
            title="Toolbar error"
            compact
          >
            <ResourcesToolbar
              resources={allResources}
              searchChips={searchChips}
              onSearchChipsChange={setSearchChips}
              resultsCount={resultsCount}
            />
          </InlineErrorBoundary>
        </div>

        {/* Adaptive resource summary cards */}
        {!error && aggregates && (
          <div className="shrink-0">
            <AdaptiveSummary
              aggregates={aggregates}
              displayMode={displayMode}
              isLoading={isLoading}
              forceCompact={compactMode}
            />
          </div>
        )}

        {/* Error display */}
        {error && (
          <ApiError
            error={error as ApiErrorProps["error"]}
            onRetry={refetch}
            title="Unable to load resources"
            authAware
            loginMessage="You need to log in to view resources."
          />
        )}

        {/* Main resources table */}
        {!error && (
          <div className="min-h-0 flex-1">
            <InlineErrorBoundary
              title="Unable to display resources table"
              resetKeys={[resources.length]}
              onReset={refetch}
            >
              <ResourcesTable
                resources={resources}
                totalCount={totalCount}
                isLoading={isLoading}
                showPoolsColumn
                onResourceClick={handleResourceClick}
                selectedResourceId={selectedResourceName ?? undefined}
                hasNextPage={hasNextPage}
                onLoadMore={fetchNextPage}
                isFetchingNextPage={isFetchingNextPage}
              />
            </InlineErrorBoundary>
          </div>
        )}
      </div>
    </ResourcePanelLayout>
  );
}
