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
 * Pool Table Column Definitions
 *
 * TanStack Table column definitions for the pools table.
 * Contains JSX cell renderers - colocated with pools-data-table.tsx.
 */

import type { ColumnDef } from "@tanstack/react-table";
import type { Pool } from "@/lib/api/adapter/types";
import type { DisplayMode } from "@/stores/shared-preferences-store";
import { CheckCircle2, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { remToPx } from "@/components/data-table/utils/column-sizing";
import { GpuProgressCell } from "../cells/gpu-progress-cell";
import { PlatformPills } from "../cells/platform-pills";
import { POOL_COLUMN_SIZE_CONFIG, COLUMN_LABELS, type PoolColumnId } from "../../lib/pool-columns";
import { getStatusDisplay, STATUS_STYLES, type StatusCategory } from "../../lib/constants";

// Status icons mapping
const STATUS_ICONS = {
  online: CheckCircle2,
  maintenance: Wrench,
  offline: XCircle,
} as const;

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
// Helpers
// =============================================================================

/** Get column minimum size from rem-based config */
function getMinSize(id: PoolColumnId): number {
  const col = POOL_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
  return col ? remToPx(col.minWidthRem) : 80;
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
  // TanStack handles initial sizing (defaults to 150px per column)
  // We only specify minSize to prevent columns from getting too small
  return [
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      minSize: getMinSize("name"),
      enableSorting: true,
      cell: ({ getValue }) => (
        <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{getValue() as string}</span>
      ),
    },
    {
      id: "status",
      accessorKey: "status",
      header: COLUMN_LABELS.status,
      minSize: getMinSize("status"),
      enableSorting: true,
      cell: ({ row }) => {
        const { category, label } = getStatusDisplay(row.original.status);
        const styles = STATUS_STYLES[category]?.badge;
        const Icon = STATUS_ICONS[category as StatusCategory];

        if (!styles) {
          return <span className="text-zinc-500">{label}</span>;
        }

        return (
          <span className={cn("inline-flex items-center gap-1 rounded px-2 py-0.5", styles.bg)}>
            <Icon className={cn("h-3.5 w-3.5", styles.icon)} />
            <span className={cn("text-xs font-semibold", styles.text)}>{label}</span>
          </span>
        );
      },
    },
    {
      id: "description",
      accessorKey: "description",
      header: COLUMN_LABELS.description,
      minSize: getMinSize("description"),
      enableSorting: false,
      cell: ({ getValue }) => (
        <span className="truncate text-zinc-500 dark:text-zinc-400">{(getValue() as string) || "—"}</span>
      ),
    },
    {
      id: "quota",
      accessorFn: (row) => row.quota.used,
      header: COLUMN_LABELS.quota,
      minSize: getMinSize("quota"),
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
    {
      id: "capacity",
      accessorFn: (row) => row.quota.totalUsage,
      header: COLUMN_LABELS.capacity,
      minSize: getMinSize("capacity"),
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
    {
      id: "platforms",
      accessorFn: (row) => row.platforms.join(", "),
      header: COLUMN_LABELS.platforms,
      minSize: getMinSize("platforms"),
      enableSorting: false,
      cell: ({ row }) => <PlatformPills platforms={row.original.platforms} />,
    },
    {
      id: "backend",
      accessorKey: "backend",
      header: COLUMN_LABELS.backend,
      minSize: getMinSize("backend"),
      enableSorting: true,
      cell: ({ getValue }) => (
        <span className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{getValue() as string}</span>
      ),
    },
  ];
}
