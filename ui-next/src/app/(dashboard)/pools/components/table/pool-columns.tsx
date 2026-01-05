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
 * Pool Table Column Definitions
 *
 * TanStack Table column definitions for the pools table.
 * Contains JSX cell renderers - colocated with pools-data-table.tsx.
 */

import type { ColumnDef } from "@tanstack/react-table";
import type { Pool } from "@/lib/api/adapter";
import type { DisplayMode } from "@/stores";
import { remToPx } from "@/components/data-table";
import { GpuProgressCell } from "../cells/gpu-progress-cell";
import { PlatformPills } from "../cells/platform-pills";
import { POOL_COLUMN_SIZE_CONFIG, COLUMN_LABELS, type PoolColumnId } from "../../lib/pool-columns";
import { getStatusDisplay, STATUS_STYLES } from "../../lib/constants";

// =============================================================================
// Types
// =============================================================================

export interface CreatePoolColumnsOptions {
  /** Display mode for quota/capacity columns */
  displayMode: DisplayMode;
  /** Whether to show compact cells */
  compact?: boolean;
  /** Map of pool names to whether they are shared */
  sharingMap?: Map<string, boolean>;
  /** Callback map for filtering by shared pools (keyed by pool name) */
  filterBySharedPoolsMap?: Map<string, () => void>;
}

// =============================================================================
// Helper
// =============================================================================

/** Get column minimum size from rem-based config */
function getColumnMinSize(id: PoolColumnId): number {
  const col = POOL_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
  return col ? remToPx(col.minWidthRem) : 100;
}

// =============================================================================
// Column Definitions Factory
// =============================================================================

/**
 * Create TanStack Table column definitions for pools.
 *
 * Uses plain object notation (not helper.accessor) for correct type inference.
 *
 * @param options - Display options and callbacks
 * @returns Array of column definitions compatible with DataTable
 */
export function createPoolColumns({
  displayMode,
  compact = false,
  sharingMap,
  filterBySharedPoolsMap,
}: CreatePoolColumnsOptions): ColumnDef<Pool, unknown>[] {
  return [
    // Name column (mandatory)
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      size: getColumnMinSize("name"),
      minSize: getColumnMinSize("name"),
      enableSorting: true,
      cell: ({ getValue }) => (
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
          {getValue() as string}
        </span>
      ),
    },

    // Status column
    {
      id: "status",
      accessorKey: "status",
      header: COLUMN_LABELS.status,
      size: getColumnMinSize("status"),
      minSize: getColumnMinSize("status"),
      enableSorting: true,
      cell: ({ row }) => {
        const { category, label } = getStatusDisplay(row.original.status);
        const dotClass = STATUS_STYLES[category]?.dot ?? "bg-zinc-400";
        return (
          <span className="flex items-center gap-1.5">
            <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
            <span className="truncate text-zinc-600 dark:text-zinc-300">{label}</span>
          </span>
        );
      },
    },

    // Description column
    {
      id: "description",
      accessorKey: "description",
      header: COLUMN_LABELS.description,
      size: getColumnMinSize("description"),
      minSize: getColumnMinSize("description"),
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="truncate text-zinc-500 dark:text-zinc-400">
          {(getValue() as string) || "—"}
        </span>
      ),
    },

    // Quota column (GPU quota)
    {
      id: "quota",
      accessorFn: (row) => row.quota.used,
      header: COLUMN_LABELS.quota,
      size: getColumnMinSize("quota"),
      minSize: getColumnMinSize("quota"),
      enableSorting: true,
      cell: ({ row }) => (
        <GpuProgressCell
          quota={row.original.quota}
          type="quota"
          displayMode={displayMode}
          compact={compact}
        />
      ),
    },

    // Capacity column (GPU capacity with sharing indicator)
    {
      id: "capacity",
      accessorFn: (row) => row.quota.totalUsage,
      header: COLUMN_LABELS.capacity,
      size: getColumnMinSize("capacity"),
      minSize: getColumnMinSize("capacity"),
      enableSorting: true,
      cell: ({ row }) => {
        const pool = row.original;
        const isShared = sharingMap?.has(pool.name) ?? false;
        const onFilterBySharedPools = filterBySharedPoolsMap?.get(pool.name);

        return (
          <GpuProgressCell
            quota={pool.quota}
            type="capacity"
            displayMode={displayMode}
            compact={compact}
            isShared={isShared}
            onFilterBySharedPools={onFilterBySharedPools}
          />
        );
      },
    },

    // Platforms column
    {
      id: "platforms",
      accessorFn: (row) => row.platforms.join(", "),
      header: COLUMN_LABELS.platforms,
      size: getColumnMinSize("platforms"),
      minSize: getColumnMinSize("platforms"),
      enableSorting: false,
      cell: ({ row }) => <PlatformPills platforms={row.original.platforms} />,
    },

    // Backend column
    {
      id: "backend",
      accessorKey: "backend",
      header: COLUMN_LABELS.backend,
      size: getColumnMinSize("backend"),
      minSize: getColumnMinSize("backend"),
      enableSorting: true,
      cell: ({ getValue }) => (
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
          {getValue() as string}
        </span>
      ),
    },
  ];
}
