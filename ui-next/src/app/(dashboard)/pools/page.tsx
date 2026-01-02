/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
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
 * - Uses Zustand for state persistence
 * - Uses TanStack Virtual for virtualization
 * - Uses react-resizable-panels for panel resizing
 * - Uses react-error-boundary for inline error handling
 */

"use client";

import { useMemo, useCallback } from "react";
import { useQueryState, parseAsArrayOf, parseAsString } from "nuqs";
import { usePools } from "@/lib/api/adapter";
import { InlineErrorBoundary } from "@/components/shared";
import { usePage } from "@/components/shell";
import {
  PoolsTable,
  PoolsToolbar,
  PoolPanelLayout,
} from "@/components/features/pools";
import type { SearchChip } from "@/lib/stores";

// =============================================================================
// Main Page Component
// =============================================================================

export default function PoolsPage() {
  usePage({ title: "Pools" });

  // Fetch pools data
  const { pools, sharingGroups, isLoading, error, refetch } = usePools();

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

  // Filter chips - repeated f params: ?f=status:ONLINE&f=platform:dgx
  const [filterStrings, setFilterStrings] = useQueryState(
    "f",
    parseAsArrayOf(parseAsString).withOptions({
      shallow: true,
      history: "push",
      clearOnDefault: true,
    })
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
        // Derive label from field:value
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
    [setFilterStrings]
  );

  // Clear panel and optionally platform
  const clearSelectedPool = useCallback(() => {
    setSelectedPoolName(null);
    setSelectedPlatform(null);
  }, [setSelectedPoolName, setSelectedPlatform]);

  // Find selected pool
  const selectedPool = useMemo(
    () => (selectedPoolName ? pools.find((p) => p.name === selectedPoolName) ?? null : null),
    [pools, selectedPoolName],
  );

  // Pools data for table (null when loading or error)
  const poolsData = useMemo(
    () => (pools.length > 0 || !isLoading ? { pools, sharingGroups } : null),
    [pools, sharingGroups, isLoading],
  );

  // Always render the shell - loading/error/empty handled inline
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
              pools={pools}
              sharingGroups={sharingGroups}
              searchChips={searchChips}
              onSearchChipsChange={setSearchChips}
            />
          </InlineErrorBoundary>
        </div>

        {/* Main pools table - handles loading/error/empty internally */}
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
              searchChips={searchChips}
              onSearchChipsChange={setSearchChips}
            />
          </InlineErrorBoundary>
        </div>
      </div>
    </PoolPanelLayout>
  );
}
