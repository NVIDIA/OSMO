//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OccupancyFlatRow, OccupancyGroupBy } from "@/lib/api/adapter/occupancy";

// =============================================================================
// Constants
// =============================================================================

const PRIORITY_COLOR: Record<"high" | "normal" | "low", string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  normal: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

// =============================================================================
// Helpers
// =============================================================================

function ResourceCell({ value }: { value: number }) {
  return <span className="text-sm text-zinc-700 tabular-nums dark:text-zinc-300">{value}</span>;
}

function PriorityBadge({ value, colorClass }: { value: number; colorClass: string }) {
  if (value === 0) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  return (
    <span
      className={cn(
        "inline-flex min-w-[1.5rem] items-center justify-center rounded px-1.5 py-0.5 text-xs font-semibold tabular-nums",
        colorClass,
      )}
    >
      {value}
    </span>
  );
}

// =============================================================================
// Column Definitions
// =============================================================================

export function createOccupancyColumns(groupBy: OccupancyGroupBy): ColumnDef<OccupancyFlatRow>[] {
  const keyLabel = groupBy === "user" ? "User" : "Pool";
  const countLabel = groupBy === "user" ? "Pools" : "Users";

  return [
    // Expand/collapse chevron
    {
      id: "expand",
      enableSorting: false,
      enableResizing: false,
      header: "",
      meta: { cellClassName: "pl-3 pr-0" },
      cell: ({ row }) => {
        const original = row.original;
        if (original._type === "parent") {
          return (
            <div className="flex items-center justify-center">
              <ChevronRight
                className={cn(
                  "h-4 w-4 shrink-0 text-zinc-400 transition-transform duration-150",
                  original.isExpanded && "rotate-90",
                )}
                aria-hidden="true"
              />
            </div>
          );
        }
        return <div className="w-4" />;
      },
    },

    // Primary key (user or pool name)
    {
      id: "key",
      accessorFn: (row) => row.key,
      enableSorting: true,
      header: keyLabel,
      cell: ({ row }) => {
        const original = row.original;
        const isChild = original._type === "child";
        return (
          <span
            className={cn(
              "block truncate font-medium",
              isChild ? "pl-2 text-sm text-zinc-600 dark:text-zinc-400" : "text-zinc-900 dark:text-zinc-100",
            )}
          >
            {original.key}
          </span>
        );
      },
    },

    // Child count (parent rows only)
    {
      id: "count",
      enableSorting: false,
      header: countLabel,
      cell: ({ row }) => {
        const original = row.original;
        if (original._type === "parent") {
          return <span className="text-sm text-zinc-500 tabular-nums">{original.childCount}</span>;
        }
        return null;
      },
    },

    // GPU
    {
      id: "gpu",
      accessorFn: (row) => row.gpu,
      enableSorting: true,
      header: "GPU",
      cell: ({ row }) => <ResourceCell value={row.original.gpu} />,
    },

    // CPU
    {
      id: "cpu",
      accessorFn: (row) => row.cpu,
      enableSorting: true,
      header: "CPU",
      cell: ({ row }) => <ResourceCell value={row.original.cpu} />,
    },

    // Memory
    {
      id: "memory",
      accessorFn: (row) => row.memory,
      enableSorting: true,
      header: "Memory",
      cell: ({ row }) => <ResourceCell value={row.original.memory} />,
    },

    // Storage
    {
      id: "storage",
      accessorFn: (row) => row.storage,
      enableSorting: true,
      header: "Storage",
      cell: ({ row }) => <ResourceCell value={row.original.storage} />,
    },

    // High priority count
    {
      id: "high",
      enableSorting: false,
      header: "High",
      cell: ({ row }) => (
        <PriorityBadge
          value={row.original.high}
          colorClass={PRIORITY_COLOR.high}
        />
      ),
    },

    // Normal priority count
    {
      id: "normal",
      enableSorting: false,
      header: "Normal",
      cell: ({ row }) => (
        <PriorityBadge
          value={row.original.normal}
          colorClass={PRIORITY_COLOR.normal}
        />
      ),
    },

    // Low priority count
    {
      id: "low",
      enableSorting: false,
      header: "Low",
      cell: ({ row }) => (
        <PriorityBadge
          value={row.original.low}
          colorClass={PRIORITY_COLOR.low}
        />
      ),
    },
  ];
}
