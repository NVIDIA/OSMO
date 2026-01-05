/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Resources Page
 *
 * Displays a virtualized table of all resources with:
 * - SmartSearch for filtering
 * - URL-synced panel state (?view=resource&config=pool)
 * - Resizable details panel
 * - Infinite scroll pagination
 * - "You've reached the end" indicator
 *
 * Architecture:
 * - Uses Zustand for persisted preferences (shared with pools)
 * - Uses nuqs for URL state
 * - Uses useResources headless hook for data
 */

"use client";

import { useMemo, useCallback } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { usePage } from "@/components/shell";
import { InlineErrorBoundary, ApiError, type ApiErrorProps } from "@/components/error";
import { useUrlChips } from "@/hooks";
import type { Resource } from "@/lib/api/adapter";
import { useSharedPreferences } from "@/stores";
import { ResourcesTable } from "./components/table/resources-table";
import { ResourcePanelLayout } from "./components/panel/resource-panel";
import { ResourcesToolbar } from "./components/resources-toolbar";
import { AdaptiveSummary } from "./components/resource-summary-card";
import { useResourcesData } from "./hooks/use-resources-data";

// =============================================================================
// Main Page Component
// =============================================================================

export default function ResourcesPage() {
  usePage({ title: "Resources" });

  // Shared preferences for display mode
  const displayMode = useSharedPreferences((s) => s.displayMode);
  const compactMode = useSharedPreferences((s) => s.compactMode);

  // ==========================================================================
  // URL State - All state is URL-synced for shareable deep links
  // URL: /resources?view=my-resource&config=pool-name&f=platform:dgx&f=pool:ml-team
  // ==========================================================================

  // Panel state
  const [selectedResourceName, setSelectedResourceName] = useQueryState(
    "view",
    parseAsString.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  const [selectedPoolConfig, setSelectedPoolConfig] = useQueryState(
    "config",
    parseAsString.withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    }),
  );

  // Filter chips - URL-synced via shared hook
  const { searchChips, setSearchChips } = useUrlChips();

  // ==========================================================================
  // Data Fetching with SmartSearch filtering
  // ==========================================================================

  const {
    resources,
    allResources,
    filteredCount,
    totalCount,
    isLoading,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useResourcesData({ searchChips });

  // ==========================================================================
  // Resource Selection
  // ==========================================================================

  // Find selected resource
  const selectedResource = useMemo<Resource | null>(
    () => (selectedResourceName ? resources.find((r) => r.name === selectedResourceName) ?? null : null),
    [resources, selectedResourceName],
  );

  // Clear panel and config
  const clearSelectedResource = useCallback(() => {
    setSelectedResourceName(null);
    setSelectedPoolConfig(null);
  }, [setSelectedResourceName, setSelectedPoolConfig]);

  // Handle resource click
  const handleResourceClick = useCallback(
    (resource: Resource) => {
      setSelectedResourceName(resource.name);
    },
    [setSelectedResourceName],
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <ResourcePanelLayout
      resource={selectedResource}
      onClose={clearSelectedResource}
      selectedPool={selectedPoolConfig}
      onPoolSelect={setSelectedPoolConfig}
    >
      <div className="flex h-full flex-col gap-4">
        {/* Toolbar with SmartSearch */}
        <div className="shrink-0">
          <InlineErrorBoundary title="Toolbar error" compact>
            <ResourcesToolbar
              resources={allResources}
              searchChips={searchChips}
              onSearchChipsChange={setSearchChips}
            />
          </InlineErrorBoundary>
        </div>

        {/* Adaptive resource summary cards */}
        {!error && resources.length > 0 && (
          <div className="shrink-0">
            <AdaptiveSummary
              resources={resources}
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
                filteredCount={filteredCount}
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
