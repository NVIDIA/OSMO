// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Pool Table Column Definitions
 *
 * TanStack Table column definitions for the pools table.
 * Contains JSX cell renderers - colocated with pools-data-table.tsx.
 */

import type { ColumnDef } from "@tanstack/react-table";
import type { Pool } from "@/lib/api/adapter/types";
import { CheckCircle2, CirclePile, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/shadcn/tooltip";
import { remToPx } from "@/components/data-table/utils/column-sizing";
import { InlineProgress } from "@/components/inline-progress";
import { PlatformPills } from "@/components/platform-pills";
import { POOL_COLUMN_SIZE_CONFIG, COLUMN_LABELS, type PoolColumnId } from "@/features/pools/lib/pool-columns";
import { getStatusDisplay, STATUS_STYLES, type StatusCategory } from "@/lib/pool-status";

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
 * GPU columns are split into used (bar + fraction) and free (emerald number)
 * pairs for clarity.
 */
export function createPoolColumns({
  compact = false,
  sharingMap,
  filterBySharedPoolsMap,
}: CreatePoolColumnsOptions): ColumnDef<Pool, unknown>[] {
  return [
    {
      id: "name",
      accessorKey: "name",
      header: COLUMN_LABELS.name,
      minSize: getMinSize("name"),
      enableSorting: true,
      cell: ({ row }) => {
        const pool = row.original;
        const isShared = sharingMap?.has(pool.name) ?? false;
        const onFilterBySharedPools = filterBySharedPoolsMap?.get(pool.name);

        return (
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{pool.name}</span>
            {isShared && (
              <Tooltip>
                <TooltipTrigger asChild>
                  {onFilterBySharedPools ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFilterBySharedPools();
                      }}
                      className="shrink-0 rounded p-0.5 text-violet-500 transition-colors hover:bg-violet-100 hover:text-violet-600 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:outline-none dark:text-violet-400 dark:hover:bg-violet-900/30 dark:hover:text-violet-300"
                      aria-label="Show shared pools"
                    >
                      <CirclePile
                        className={cn(compact ? "h-3 w-3" : "h-3.5 w-3.5")}
                        aria-hidden="true"
                      />
                    </button>
                  ) : (
                    <span className="inline-flex shrink-0">
                      <CirclePile
                        className={cn("text-violet-500 dark:text-violet-400", compact ? "h-3 w-3" : "h-3.5 w-3.5")}
                        aria-label="This pool shares capacity with other pools"
                      />
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent>Show shared pools</TooltipContent>
              </Tooltip>
            )}
          </div>
        );
      },
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
        <InlineProgress
          used={row.original.quota.used}
          total={row.original.quota.limit}
          compact={compact}
        />
      ),
    },
    {
      id: "quotaFree",
      accessorFn: (row) => row.quota.free,
      header: COLUMN_LABELS.quotaFree,
      minSize: getMinSize("quotaFree"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-xs text-emerald-600 tabular-nums dark:text-emerald-400">
          {Math.max(0, row.original.quota.free)}
        </span>
      ),
    },
    {
      id: "capacity",
      accessorFn: (row) => row.quota.totalUsage,
      header: COLUMN_LABELS.capacity,
      minSize: getMinSize("capacity"),
      enableSorting: true,
      cell: ({ row }) => (
        <InlineProgress
          used={row.original.quota.totalUsage}
          total={row.original.quota.totalCapacity}
          compact={compact}
        />
      ),
    },
    {
      id: "capacityFree",
      accessorFn: (row) => row.quota.totalFree,
      header: COLUMN_LABELS.capacityFree,
      minSize: getMinSize("capacityFree"),
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-xs text-emerald-600 tabular-nums dark:text-emerald-400">
          {Math.max(0, row.original.quota.totalFree)}
        </span>
      ),
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
