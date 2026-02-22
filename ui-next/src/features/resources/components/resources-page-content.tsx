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
import { usePage } from "@/components/chrome/page-context";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { useResultsCount } from "@/hooks/use-results-count";
import { useUrlChips } from "@/hooks/use-url-chips";
import { usePanelState } from "@/hooks/use-url-state";
import { usePanelLifecycle } from "@/hooks/use-panel-lifecycle";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { useViewTransition } from "@/hooks/use-view-transition";
import type { Resource } from "@/lib/api/adapter/types";
import { useDisplayMode, useCompactMode } from "@/stores/shared-preferences-store";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { PANEL } from "@/components/panel/panel-header-controls";
import { ResourcePanelHeader } from "@/features/resources/components/panel/panel-header";
import { ResourcePanelContent } from "@/features/resources/components/panel/panel-content";
import { ResourcesDataTable } from "@/features/resources/components/table/resources-data-table";
import { ResourcesToolbar } from "@/features/resources/components/resources-toolbar";
import { useResourcesTableStore } from "@/features/resources/stores/resources-table-store";
import { AdaptiveSummary } from "@/features/resources/components/resource-summary-card";
import { useResourcesData } from "@/features/resources/hooks/use-resources-data";
import type { ResourceAggregates } from "@/lib/resource-aggregates";

// =============================================================================
// Client Component
// =============================================================================

export function ResourcesPageContent({ initialAggregates }: { initialAggregates?: ResourceAggregates | null }) {
  usePage({ title: "Resources" });
  const { startTransition } = useViewTransition();

  // Shared preferences (hydration-safe)
  const displayMode = useDisplayMode();
  const compactMode = useCompactMode();

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

  // Memoize autoRefreshProps to prevent unnecessary toolbar re-renders
  const autoRefreshProps = useMemo(
    () => ({
      onRefresh: refetch,
      isRefreshing: isLoading,
    }),
    [refetch, isLoading],
  );

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
  // Resource Panel State - URL state controls both selection and mounting
  // ==========================================================================

  // Find selected resource from URL
  const selectedResource = useMemo(
    () => (selectedResourceName ? resources.find((r) => r.name === selectedResourceName) : undefined),
    [resources, selectedResourceName],
  );

  // Panel lifecycle - handles open/close/closing animation state machine
  const {
    isPanelOpen,
    handleClose: handleClosePanel,
    handleClosed: handlePanelClosed,
  } = usePanelLifecycle({
    hasSelection: Boolean(selectedResourceName && selectedResource),
    onClosed: () => startTransition(() => clearSelectedResource()),
  });

  // Handle resource click
  const handleResourceClick = useCallback(
    (resource: Resource) => {
      handleResourceSelect(resource.name);
    },
    [handleResourceSelect],
  );

  // Panel width management
  const { panelWidth, setPanelWidth } = usePanelWidth({
    storedWidth: useResourcesTableStore((s) => s.panelWidth),
    setStoredWidth: useResourcesTableStore((s) => s.setPanelWidth),
  });

  // ==========================================================================
  // Render - Always render ResizablePanel to keep content in same tree position
  // ==========================================================================

  // Page content - always rendered in the same position (as mainContent)
  const pageContent = (
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
            autoRefreshProps={autoRefreshProps}
          />
        </InlineErrorBoundary>
      </div>

      {/* Adaptive resource summary cards */}
      {aggregates && (
        <div className="shrink-0">
          <AdaptiveSummary
            aggregates={aggregates}
            displayMode={displayMode}
            isLoading={isLoading}
            forceCompact={compactMode}
          />
        </div>
      )}

      {/* Main resources table */}
      <div className="min-h-0 flex-1">
        <InlineErrorBoundary
          title="Unable to display resources table"
          resetKeys={[resources.length]}
          onReset={refetch}
        >
          <ResourcesDataTable
            resources={resources}
            totalCount={totalCount}
            isLoading={isLoading}
            error={error ?? undefined}
            onRetry={refetch}
            showPoolsColumn
            onResourceClick={handleResourceClick}
            selectedResourceId={selectedResourceName ?? undefined}
            hasNextPage={hasNextPage}
            onLoadMore={fetchNextPage}
            isFetchingNextPage={isFetchingNextPage}
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );

  return (
    <ResizablePanel
      open={isPanelOpen}
      onClose={handleClosePanel}
      onClosed={handlePanelClosed}
      width={panelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
      mainContent={pageContent}
      backdrop={false}
      aria-label={selectedResource ? `Resource details: ${selectedResource.name}` : "Resources"}
      className="resources-panel"
    >
      {/* Panel content - only rendered when resource is selected */}
      {selectedResource && (
        <>
          <ResourcePanelHeader
            resource={selectedResource}
            onClose={handleClosePanel}
          />
          <ResourcePanelContent
            resource={selectedResource}
            selectedPool={selectedPoolConfig}
            onPoolSelect={handlePoolSelect}
          />
        </>
      )}
    </ResizablePanel>
  );
}
