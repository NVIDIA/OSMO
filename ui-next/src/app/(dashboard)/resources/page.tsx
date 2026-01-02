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
import { useQueryState, parseAsArrayOf, parseAsString } from "nuqs";
import { usePage } from "@/components/shell";
import { InlineErrorBoundary, ApiError } from "@/components/shared";
import type { SearchChip } from "@/lib/stores";
import type { Resource } from "@/lib/api/adapter";
import type { ApiErrorProps } from "@/components/shared";
import {
  ResourcesToolbar,
  ResourcesTable,
  ResourcePanelLayout,
  AdaptiveSummary,
} from "@/components/features/resources";
import { useSharedPreferences } from "@/lib/stores";
import { useResourcesData } from "./use-resources-data";

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

  // Filter chips - repeated f params: ?f=platform:dgx&f=pool:ml-team
  const [filterStrings, setFilterStrings] = useQueryState(
    "f",
    parseAsArrayOf(parseAsString).withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    }),
  );

  // Parse filter strings to SearchChip format
  const searchChips = useMemo<SearchChip[]>(() => {
    if (!filterStrings || filterStrings.length === 0) return [];
    return filterStrings
      .map((str) => {
        const colonIndex = str.indexOf(":");
        if (colonIndex === -1) return null;
        const field = str.slice(0, colonIndex);
        const value = str.slice(colonIndex + 1);
        if (!field || !value) return null;
        const label = `${field}: ${value}`;
        return { field, value, label };
      })
      .filter((chip): chip is SearchChip => chip !== null);
  }, [filterStrings]);

  // Convert chips back to filter strings for URL
  const setSearchChips = useCallback(
    (chips: SearchChip[]) => {
      if (chips.length === 0) {
        setFilterStrings(null);
      } else {
        setFilterStrings(chips.map((c) => `${c.field}:${c.value}`));
      }
    },
    [setFilterStrings],
  );

  // ==========================================================================
  // Data Fetching with SmartSearch filtering
  // ==========================================================================

  const {
    resources,
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
              resources={resources}
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
