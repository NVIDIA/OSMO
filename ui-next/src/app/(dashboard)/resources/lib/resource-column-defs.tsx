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
 * TanStack Table Column Definitions for Resources
 *
 * Defines column structure for the resources DataTable component.
 */

import { memo, useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { getResourceAllocationTypeDisplay } from "@/app/(dashboard)/resources/lib/constants";
import type { Resource } from "@/lib/api/adapter/types";
import type { DisplayMode } from "@/stores/shared-preferences-store";
import { CapacityCell } from "@/app/(dashboard)/resources/components/cells/capacity-cell";
import {
  type ResourceColumnId,
  COLUMN_LABELS,
  RESOURCE_COLUMN_SIZE_CONFIG,
} from "@/app/(dashboard)/resources/lib/resource-columns";
import { remToPx } from "@/components/data-table/utils/column-sizing";
import { ExpandableChips } from "@/components/expandable-chips";

// =============================================================================
// Column Cell Components
// =============================================================================

/** Resource name cell */
function ResourceNameCell({ value }: { value: string }) {
  return <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{value}</span>;
}

/** Resource type badge cell */
function ResourceTypeCell({ value }: { value: string }) {
  const typeDisplay = getResourceAllocationTypeDisplay(value);
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", typeDisplay.className)}>
      {typeDisplay.label}
    </span>
  );
}

/** Pools membership cell using expandable chips */
const PoolsCell = memo(function PoolsCell({ resource }: { resource: Resource }) {
  // Memoize the pools array to maintain stable reference for useExpandableChips
  const pools = useMemo(() => resource.poolMemberships.map((m) => m.pool), [resource.poolMemberships]);
  return <ExpandableChips items={pools} />;
});

/** Text cell (platform, backend) */
function TextCell({ value }: { value: string }) {
  return <span className="truncate text-zinc-500 dark:text-zinc-400">{value}</span>;
}

// =============================================================================
// Column Definitions Factory
// =============================================================================

export interface CreateColumnsOptions {
  displayMode: DisplayMode;
}

/**
 * Create TanStack column definitions for resources table.
 *
 * @param options - Column configuration options
 * @returns Array of column definitions
 */
export function createResourceColumns({ displayMode }: CreateColumnsOptions): ColumnDef<Resource, unknown>[] {
  // Get minimum width from rem-based config (converted to pixels)
  const getMinSize = (id: ResourceColumnId): number => {
    const col = RESOURCE_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
    return col ? remToPx(col.minWidthRem) : 80;
  };

  // TanStack handles initial sizing (defaults to 150px per column)
  // We only specify minSize to prevent columns from getting too small
  return [
    {
      id: "resource",
      accessorKey: "name",
      header: COLUMN_LABELS.resource,
      minSize: getMinSize("resource"),
      cell: ({ getValue }) => <ResourceNameCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "hostname",
      accessorKey: "hostname",
      header: COLUMN_LABELS.hostname,
      minSize: getMinSize("hostname"),
      cell: ({ getValue }) => <TextCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "type",
      accessorKey: "resourceType",
      header: COLUMN_LABELS.type,
      minSize: getMinSize("type"),
      cell: ({ getValue }) => <ResourceTypeCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "pools",
      accessorFn: (row) => row.poolMemberships[0]?.pool ?? "",
      header: COLUMN_LABELS.pools,
      minSize: getMinSize("pools"),
      cell: ({ row }) => <PoolsCell resource={row.original} />,
      meta: { align: "left" as const },
    },
    {
      id: "platform",
      accessorKey: "platform",
      header: COLUMN_LABELS.platform,
      minSize: getMinSize("platform"),
      cell: ({ getValue }) => <TextCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "backend",
      accessorKey: "backend",
      header: COLUMN_LABELS.backend,
      minSize: getMinSize("backend"),
      cell: ({ getValue }) => <TextCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "gpu",
      accessorFn: (row) => (displayMode === "free" ? row.gpu.total - row.gpu.used : row.gpu.used),
      header: COLUMN_LABELS.gpu,
      minSize: getMinSize("gpu"),
      cell: ({ row }) => (
        <div className="text-right whitespace-nowrap tabular-nums">
          <CapacityCell
            used={row.original.gpu.used}
            total={row.original.gpu.total}
            mode={displayMode}
          />
        </div>
      ),
      meta: { align: "right" as const },
    },
    {
      id: "cpu",
      accessorFn: (row) => (displayMode === "free" ? row.cpu.total - row.cpu.used : row.cpu.used),
      header: COLUMN_LABELS.cpu,
      minSize: getMinSize("cpu"),
      cell: ({ row }) => (
        <div className="text-right whitespace-nowrap tabular-nums">
          <CapacityCell
            used={row.original.cpu.used}
            total={row.original.cpu.total}
            mode={displayMode}
          />
        </div>
      ),
      meta: { align: "right" as const },
    },
    {
      id: "memory",
      accessorFn: (row) => (displayMode === "free" ? row.memory.total - row.memory.used : row.memory.used),
      header: COLUMN_LABELS.memory,
      minSize: getMinSize("memory"),
      cell: ({ row }) => (
        <div className="text-right whitespace-nowrap tabular-nums">
          <CapacityCell
            used={row.original.memory.used}
            total={row.original.memory.total}
            isBytes
            mode={displayMode}
          />
        </div>
      ),
      meta: { align: "right" as const },
    },
    {
      id: "storage",
      accessorFn: (row) => (displayMode === "free" ? row.storage.total - row.storage.used : row.storage.used),
      header: COLUMN_LABELS.storage,
      minSize: getMinSize("storage"),
      cell: ({ row }) => (
        <div className="text-right whitespace-nowrap tabular-nums">
          <CapacityCell
            used={row.original.storage.used}
            total={row.original.storage.total}
            isBytes
            mode={displayMode}
          />
        </div>
      ),
      meta: { align: "right" as const },
    },
  ];
}
