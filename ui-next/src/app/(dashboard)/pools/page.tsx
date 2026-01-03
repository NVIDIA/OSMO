/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pools Page
 *
 * Displays a table of all pools with:
 * - Status-based sections (Online, Maintenance, Offline)
 * - Smart search with filter chips
 * - Column visibility and reordering
 * - Resizable details panel
 * - GPU quota and capacity visualization
 *
 * Architecture:
 * - usePoolsData encapsulates data fetching and filtering
 * - UI receives pre-filtered data (ready for server-driven filtering)
 * - Uses Zustand for state persistence
 * - Uses nuqs for URL state synchronization
 */

"use client";

import { useMemo, useCallback } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { InlineErrorBoundary } from "@/components/inline-error-boundary";
import { usePage } from "@/components/shell";
import { useUrlChips } from "@/hooks";
import { PoolsTable } from "./components/table/pools-table";
import { PoolPanelLayout } from "./components/panel/pool-panel";
import { PoolsToolbar } from "./components/pools-toolbar";
import { usePoolsData } from "./hooks/use-pools-data";

// =============================================================================
// Main Page Component
// =============================================================================

export default function PoolsPage() {
  usePage({ title: "Pools" });

  // ==========================================================================
  // URL State - All state is URL-synced for shareable deep links
  // URL: /pools?view=my-pool&config=dgx&f=status:ONLINE&f=platform:dgx
  // ==========================================================================

  // Panel state
  const [selectedPoolName, setSelectedPoolName] = useQueryState(
    "view",
    parseAsString.withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    })
  );

  const [selectedPlatform, setSelectedPlatform] = useQueryState(
    "config",
    parseAsString.withOptions({
      shallow: true,
      history: "replace",
      clearOnDefault: true,
    })
  );

  // Filter chips - URL-synced via shared hook
  const { searchChips, setSearchChips } = useUrlChips();

  // ==========================================================================
  // Data Fetching with SmartSearch filtering
  // Filtering encapsulated in hook (ready for server-driven filtering)
  // ==========================================================================

  const {
    pools,
    allPools,
    sharingGroups,
    isLoading,
    error,
    refetch,
  } = usePoolsData({ searchChips });

  // ==========================================================================
  // Pool Selection
  // ==========================================================================

  // Clear panel and optionally platform
  const clearSelectedPool = useCallback(() => {
    setSelectedPoolName(null);
    setSelectedPlatform(null);
  }, [setSelectedPoolName, setSelectedPlatform]);

  // Find selected pool (search in allPools so selection persists through filtering)
  const selectedPool = useMemo(
    () => (selectedPoolName ? allPools.find((p) => p.name === selectedPoolName) ?? null : null),
    [allPools, selectedPoolName],
  );

  // Pools data for table (null when loading or error)
  const poolsData = useMemo(
    () => (pools.length > 0 || !isLoading ? { pools, sharingGroups } : null),
    [pools, sharingGroups, isLoading],
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <PoolPanelLayout
      pool={selectedPool}
      sharingGroups={sharingGroups}
      onClose={clearSelectedPool}
      onPoolSelect={setSelectedPoolName}
      selectedPlatform={selectedPlatform}
      onPlatformSelect={setSelectedPlatform}
    >
      <div className="flex h-full flex-col gap-4">
        {/* Toolbar with search and controls */}
        <div className="shrink-0">
          <InlineErrorBoundary title="Toolbar error" compact>
            <PoolsToolbar
              pools={allPools}
              sharingGroups={sharingGroups}
              searchChips={searchChips}
              onSearchChipsChange={setSearchChips}
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
            <PoolsTable
              poolsData={poolsData}
              isLoading={isLoading}
              error={error ?? undefined}
              onRetry={refetch}
              onPoolSelect={setSelectedPoolName}
              selectedPoolName={selectedPoolName}
              onSearchChipsChange={setSearchChips}
            />
          </InlineErrorBoundary>
        </div>
      </div>
    </PoolPanelLayout>
  );
}
