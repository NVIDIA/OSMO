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

import { useMemo } from "react";
import { usePools } from "@/lib/api/adapter";
import { ApiError, InlineErrorBoundary } from "@/components/shared";
import { usePage } from "@/components/shell";
import {
  PoolsTable,
  PoolsToolbar,
  PoolPanelLayout,
  PoolsLoading,
  usePoolsExtendedStore,
  usePoolsTableStore,
} from "@/components/features/pools";

// =============================================================================
// Main Page Component
// =============================================================================

export default function PoolsPage() {
  usePage({ title: "Pools" });

  // Compact mode from store
  const compactMode = usePoolsTableStore((s) => s.compactMode);

  // Fetch pools data
  const { pools, sharingGroups, isLoading, error, refetch } = usePools();

  // Panel state - use individual selectors for stable hook ordering
  const selectedPoolName = usePoolsExtendedStore((s) => s.selectedPoolName);
  const setSelectedPool = usePoolsExtendedStore((s) => s.setSelectedPool);

  // Find selected pool
  const selectedPool = useMemo(
    () => (selectedPoolName ? pools.find((p) => p.name === selectedPoolName) ?? null : null),
    [pools, selectedPoolName],
  );

  // Pools data for table
  const poolsData = useMemo(() => ({ pools, sharingGroups }), [pools, sharingGroups]);

  // Loading state - show skeleton that matches final layout
  if (isLoading) {
    return <PoolsLoading compact={compactMode} />;
  }

  // Error state - fills available space
  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <ApiError
          error={error}
          onRetry={refetch}
          title="Unable to load pools"
          authAware
          loginMessage="You need to log in to view pools."
        />
      </div>
    );
  }

  return (
    <PoolPanelLayout
      pool={selectedPool}
      sharingGroups={sharingGroups}
      onClose={() => setSelectedPool(null)}
    >
      <div className="flex h-full flex-col gap-4">
        {/* Toolbar with search and controls - wrapped in error boundary */}
        <div className="shrink-0">
          <InlineErrorBoundary title="Toolbar error" compact>
            <PoolsToolbar pools={pools} />
          </InlineErrorBoundary>
        </div>

        {/* Main pools table - fills remaining space */}
        <div className="min-h-0 flex-1">
          <InlineErrorBoundary
            title="Unable to display pools table"
            resetKeys={[pools.length]}
            onReset={refetch}
          >
            <PoolsTable poolsData={poolsData} isLoading={isLoading} />
          </InlineErrorBoundary>
        </div>
      </div>
    </PoolPanelLayout>
  );
}
