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
 * Pools Page Content (Client Component)
 *
 * The interactive content of the Pools page.
 * Receives hydrated data from the server and handles all user interactions.
 *
 * Features:
 * - Status-based sections (Online, Maintenance, Offline)
 * - Smart search with filter chips
 * - Column visibility and reordering
 * - Resizable details panel
 * - GPU quota and capacity visualization
 */

"use client";

import { useMemo, useCallback } from "react";
import { InlineErrorBoundary } from "@/components/error/inline-error-boundary";
import { usePage } from "@/components/chrome/page-context";
import { useResultsCount } from "@/hooks/use-results-count";
import { useUrlChips } from "@/hooks/use-url-chips";
import { usePanelState } from "@/hooks/use-url-state";
import { usePanelLifecycle } from "@/hooks/use-panel-lifecycle";
import { usePanelWidth } from "@/hooks/use-panel-width";
import { PoolsDataTable } from "@/app/(dashboard)/pools/components/table/pools-data-table";
import { ResizablePanel } from "@/components/panel/resizable-panel";
import { PANEL } from "@/components/panel/panel-header-controls";
import { PoolPanelHeader } from "@/app/(dashboard)/pools/components/panel/panel-header";
import { PanelContent } from "@/app/(dashboard)/pools/components/panel/panel-content";
import { PoolsToolbar } from "@/app/(dashboard)/pools/components/pools-toolbar";
import { usePoolsData } from "@/app/(dashboard)/pools/hooks/use-pools-data";
import { usePoolsTableStore } from "@/app/(dashboard)/pools/stores/pools-table-store";

// =============================================================================
// Client Component
// =============================================================================

export function PoolsPageContent() {
  usePage({ title: "Pools" });

  // ==========================================================================
  // URL State - All state is URL-synced for shareable deep links
  // URL: /pools?view=my-pool&config=dgx&f=status:ONLINE&f=platform:dgx
  // ==========================================================================

  // Panel state (consolidated URL state hooks)
  const {
    selection: selectedPoolName,
    setSelection: setSelectedPoolName,
    config: selectedPlatform,
    setConfig: setSelectedPlatform,
    clear: clearSelectedPool,
  } = usePanelState();

  // Filter chips - URL-synced via shared hook
  const { searchChips, setSearchChips } = useUrlChips();

  // ==========================================================================
  // Data Fetching with FilterBar filtering
  // Data is hydrated from server prefetch - no loading spinner on initial load!
  // TanStack Query will refetch in the background if data is stale.
  // ==========================================================================

  const { pools, allPools, sharingGroups, isLoading, error, refetch, total, filteredTotal, hasActiveFilters } =
    usePoolsData({ searchChips });

  // ==========================================================================
  // Pool Panel State - URL state controls both selection and mounting
  // ==========================================================================

  // Find selected pool from URL (search in allPools so selection persists through filtering)
  const selectedPool = useMemo(
    () => (selectedPoolName ? allPools.find((p) => p.name === selectedPoolName) : undefined),
    [allPools, selectedPoolName],
  );

  // Panel lifecycle - handles open/close/closing animation state machine
  const { isPanelOpen, handleClose, handleClosed } = usePanelLifecycle({
    hasSelection: Boolean(selectedPoolName && selectedPool),
    onClosed: clearSelectedPool,
  });

  // Open panel with a pool (URL-synced)
  const handlePoolSelect = useCallback(
    (poolName: string) => {
      setSelectedPoolName(poolName);
    },
    [setSelectedPoolName],
  );

  // Results count for FilterBar display (consolidated hook)
  const resultsCount = useResultsCount({ total, filteredTotal, hasActiveFilters });

  // Panel width management
  const { panelWidth, setPanelWidth, handleWidthPreset } = usePanelWidth({
    storedWidth: usePoolsTableStore((s) => s.panelWidth),
    setStoredWidth: usePoolsTableStore((s) => s.setPanelWidth),
  });

  // ==========================================================================
  // Render - Always render ResizablePanel to keep table in same tree position
  // ==========================================================================

  // Table content - always rendered in the same position (as mainContent)
  const tableContent = (
    <div className="flex h-full flex-col gap-4 p-6">
      {/* Toolbar with search and controls */}
      <div className="shrink-0">
        <InlineErrorBoundary
          title="Toolbar error"
          compact
        >
          <PoolsToolbar
            pools={allPools}
            sharingGroups={sharingGroups}
            searchChips={searchChips}
            onSearchChipsChange={setSearchChips}
            resultsCount={resultsCount}
          />
        </InlineErrorBoundary>
      </div>

      {/* Main pools table - receives pre-filtered data */}
      <div className="min-h-0 flex-1">
        <InlineErrorBoundary
          title="Unable to display pools table"
          resetKeys={[pools.length]}
          onReset={refetch}
        >
          <PoolsDataTable
            pools={pools}
            sharingGroups={sharingGroups}
            isLoading={isLoading}
            error={error ?? undefined}
            onRetry={refetch}
            onPoolSelect={handlePoolSelect}
            selectedPoolName={selectedPoolName}
            onSearchChipsChange={setSearchChips}
          />
        </InlineErrorBoundary>
      </div>
    </div>
  );

  return (
    <ResizablePanel
      open={isPanelOpen}
      onClose={handleClose}
      onClosed={handleClosed}
      width={panelWidth}
      onWidthChange={setPanelWidth}
      minWidth={PANEL.MIN_WIDTH_PCT}
      maxWidth={PANEL.OVERLAY_MAX_WIDTH_PCT}
      mainContent={tableContent}
      backdrop={false}
      aria-label={selectedPool ? `Pool details: ${selectedPool.name}` : "Pools"}
      className="pools-panel"
    >
      {/* Panel content - only rendered when pool is selected */}
      {selectedPool && (
        <>
          <PoolPanelHeader
            pool={selectedPool}
            onClose={handleClose}
            onWidthPreset={handleWidthPreset}
          />
          <PanelContent
            pool={selectedPool}
            sharingGroups={sharingGroups}
            onPoolSelect={handlePoolSelect}
            selectedPlatform={selectedPlatform}
            onPlatformSelect={setSelectedPlatform}
          />
        </>
      )}
    </ResizablePanel>
  );
}
