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
import { ChevronRight, Layers, MoreHorizontal, Workflow } from "lucide-react";
import { cn, formatCompact, formatBytes } from "@/lib/utils";
import { Link } from "@/components/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/shadcn/dropdown-menu";
import { useMounted } from "@/hooks/use-mounted";
import type { SearchChip } from "@/stores/types";
import type { OccupancyFlatRow, OccupancyGroupBy } from "@/lib/api/adapter/occupancy";

/** Occupancy chip fields that map directly to workflow filters.
 * "status" is excluded — TaskGroupStatus is per-task-group, not per-workflow. */
const CROSS_LINKABLE_FIELDS: ReadonlySet<string> = new Set(["pool", "user", "priority"]);

const PRIORITY_COLOR: Record<"high" | "normal" | "low", string> = {
  high: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  normal: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  low: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

function ResourceCell({ value }: { value: number }) {
  return <span className="text-sm text-zinc-700 tabular-nums dark:text-zinc-300">{formatCompact(value)}</span>;
}

function BytesCell({ value }: { value: number }) {
  if (value === 0) return <span className="text-zinc-300 dark:text-zinc-600">—</span>;
  const { value: val, unit } = formatBytes(value);
  return (
    <span className="text-sm text-zinc-700 tabular-nums dark:text-zinc-300">
      {val}
      <span className="ml-0.5 text-xs text-zinc-400">{unit}</span>
    </span>
  );
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

function buildWorkflowsUrl(row: OccupancyFlatRow, groupBy: OccupancyGroupBy, searchChips: SearchChip[]): string {
  const params: string[] = [];
  if (row._type === "parent") {
    params.push(`f=${groupBy}:${encodeURIComponent(row.key)}`);
  } else {
    params.push(`f=${groupBy}:${encodeURIComponent(row.parentKey)}`);
    const childDim = groupBy === "pool" ? "user" : "pool";
    params.push(`f=${childDim}:${encodeURIComponent(row.key)}`);
  }
  // Child rows provide both pool+user; parent rows only provide their own dimension.
  // Only exclude what the row already supplies so searchChip context isn't lost.
  const rowFields = row._type === "child" ? new Set(["pool", "user"]) : new Set([groupBy]);
  for (const chip of searchChips) {
    if (CROSS_LINKABLE_FIELDS.has(chip.field) && !rowFields.has(chip.field))
      params.push(`f=${chip.field}:${encodeURIComponent(chip.value)}`);
  }
  return `/workflows?${params.join("&")}&all=true`;
}

function ParentRowActions({
  original,
  href,
  groupBy,
}: {
  original: OccupancyFlatRow & { _type: "parent" };
  href: string;
  groupBy: OccupancyGroupBy;
}) {
  const mounted = useMounted();

  if (!mounted) {
    return (
      <button
        type="button"
        className="shrink-0 rounded p-0.5 opacity-0"
        disabled
        aria-label={`Row actions ${original.key}`}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        asChild
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={cn(
            "hover:bg-accent focus-visible:ring-ring shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover/occ-row:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:outline-none data-[state=open]:opacity-100",
            original.isExpanded && "opacity-100",
          )}
          aria-label={`Row actions ${original.key}`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem asChild>
          <Link
            href={href}
            className="flex items-center gap-2"
          >
            <Workflow className="h-4 w-4" />
            View Workflows
          </Link>
        </DropdownMenuItem>
        {groupBy === "pool" && (
          <DropdownMenuItem asChild>
            <Link
              href={`/pools?all=true&view=${encodeURIComponent(original.key)}`}
              className="flex items-center gap-2"
            >
              <Layers className="h-4 w-4" />
              View Pool
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function createOccupancyColumns(
  groupBy: OccupancyGroupBy,
  searchChips: SearchChip[],
): ColumnDef<OccupancyFlatRow>[] {
  const keyLabel = groupBy === "user" ? "User" : "Pool";
  const countLabel = groupBy === "user" ? "Pools" : "Users";

  return [
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

    {
      id: "key",
      accessorFn: (row) => row.key,
      enableSorting: true,
      header: keyLabel,
      cell: ({ row }) => {
        const original = row.original;
        const href = buildWorkflowsUrl(original, groupBy, searchChips);
        if (original._type === "child") {
          return (
            <Link
              href={href}
              className="hover:text-primary pl-2 text-sm text-zinc-600 underline decoration-zinc-400/50 underline-offset-2 transition-colors hover:decoration-current dark:text-zinc-400"
              onClick={(e) => e.stopPropagation()}
            >
              {original.key}
            </Link>
          );
        }
        return (
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{original.key}</span>
            <ParentRowActions
              original={original}
              href={href}
              groupBy={groupBy}
            />
          </div>
        );
      },
    },

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

    {
      id: "gpu",
      accessorFn: (row) => row.gpu,
      enableSorting: true,
      header: "GPU",
      cell: ({ row }) => <ResourceCell value={row.original.gpu} />,
    },
    {
      id: "cpu",
      accessorFn: (row) => row.cpu,
      enableSorting: true,
      header: "CPU",
      cell: ({ row }) => <ResourceCell value={row.original.cpu} />,
    },
    {
      id: "memory",
      accessorFn: (row) => row.memory,
      enableSorting: true,
      header: "Memory",
      cell: ({ row }) => <BytesCell value={row.original.memory} />,
    },
    {
      id: "storage",
      accessorFn: (row) => row.storage,
      enableSorting: true,
      header: "Storage",
      cell: ({ row }) => <BytesCell value={row.original.storage} />,
    },

    ...(["high", "normal", "low"] as const).map((p) => ({
      id: p,
      enableSorting: false,
      header: `${p[0].toUpperCase()}${p.slice(1)}`,
      cell: ({ row }: { row: { original: OccupancyFlatRow } }) => (
        <PriorityBadge
          value={row.original[p]}
          colorClass={PRIORITY_COLOR[p]}
        />
      ),
    })),
  ];
}
