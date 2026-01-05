/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useMemo } from "react";
import type { Pool } from "@/lib/api/adapter";
import type { SearchChip } from "@/stores";
import { TableToolbar } from "@/components/data-table";
import { usePoolsTableStore } from "../stores/pools-table-store";
import { OPTIONAL_COLUMNS } from "../lib/pool-columns";
import { createPoolSearchFields } from "../lib/pool-search-fields";

export interface PoolsToolbarProps {
  pools: Pool[];
  sharingGroups?: string[][];
  searchChips: SearchChip[];
  onSearchChipsChange: (chips: SearchChip[]) => void;
}

export const PoolsToolbar = memo(function PoolsToolbar({
  pools,
  sharingGroups = [],
  searchChips,
  onSearchChipsChange,
}: PoolsToolbarProps) {
  const visibleColumnIds = usePoolsTableStore((s) => s.visibleColumnIds);
  const toggleColumn = usePoolsTableStore((s) => s.toggleColumn);

  // Create search fields with sharing context
  const searchFields = useMemo(
    () => createPoolSearchFields(sharingGroups),
    [sharingGroups],
  );

  return (
    <TableToolbar
      data={pools}
      searchFields={searchFields}
      columns={OPTIONAL_COLUMNS}
      visibleColumnIds={visibleColumnIds}
      onToggleColumn={toggleColumn}
      searchChips={searchChips}
      onSearchChipsChange={onSearchChipsChange}
      placeholder="Search pools... (try 'pool:', 'platform:', 'shared:')"
    />
  );
});
