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
 * TanStack Table Column Definitions for Resources
 *
 * Defines column structure for the resources DataTable component.
 */

import type { ColumnDef } from "@tanstack/react-table";
import { cn } from "@/lib/utils";
import { getResourceAllocationTypeDisplay } from "./constants";
import type { Resource } from "@/lib/api/adapter";
import type { DisplayMode } from "@/stores";
import { CapacityCell } from "../components/cells/capacity-cell";
import { type ResourceColumnId, COLUMN_LABELS, RESOURCE_COLUMN_SIZE_CONFIG } from "./resource-columns";
import { remToPx } from "@/components/data-table";

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

/** Pools membership cell */
function PoolsCell({ resource }: { resource: Resource }) {
  const pool = resource.poolMemberships[0]?.pool;
  const extra = resource.poolMemberships.length - 1;

  return (
    <span className="truncate text-zinc-500 dark:text-zinc-400">
      {pool ?? "—"}
      {extra > 0 && <span className="ml-1 text-xs text-zinc-400">+{extra}</span>}
    </span>
  );
}

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
  const getColumnMinSize = (id: ResourceColumnId): number => {
    const col = RESOURCE_COLUMN_SIZE_CONFIG.find((c) => c.id === id);
    return col ? remToPx(col.minWidthRem) : 100;
  };

  return [
    {
      id: "resource",
      accessorKey: "name",
      header: COLUMN_LABELS.resource,
      size: getColumnMinSize("resource"),
      minSize: getColumnMinSize("resource"),
      cell: ({ getValue }) => <ResourceNameCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "hostname",
      accessorKey: "hostname",
      header: COLUMN_LABELS.hostname,
      size: getColumnMinSize("hostname"),
      minSize: getColumnMinSize("hostname"),
      cell: ({ getValue }) => <TextCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "type",
      accessorKey: "resourceType",
      header: COLUMN_LABELS.type,
      size: getColumnMinSize("type"),
      minSize: getColumnMinSize("type"),
      cell: ({ getValue }) => <ResourceTypeCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "pools",
      accessorFn: (row) => row.poolMemberships[0]?.pool ?? "",
      header: COLUMN_LABELS.pools,
      size: getColumnMinSize("pools"),
      minSize: getColumnMinSize("pools"),
      cell: ({ row }) => <PoolsCell resource={row.original} />,
      meta: { align: "left" as const },
    },
    {
      id: "platform",
      accessorKey: "platform",
      header: COLUMN_LABELS.platform,
      size: getColumnMinSize("platform"),
      minSize: getColumnMinSize("platform"),
      cell: ({ getValue }) => <TextCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "backend",
      accessorKey: "backend",
      header: COLUMN_LABELS.backend,
      size: getColumnMinSize("backend"),
      minSize: getColumnMinSize("backend"),
      cell: ({ getValue }) => <TextCell value={getValue() as string} />,
      meta: { align: "left" as const },
    },
    {
      id: "gpu",
      accessorFn: (row) => (displayMode === "free" ? row.gpu.total - row.gpu.used : row.gpu.used),
      header: COLUMN_LABELS.gpu,
      size: getColumnMinSize("gpu"),
      minSize: getColumnMinSize("gpu"),
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
      size: getColumnMinSize("cpu"),
      minSize: getColumnMinSize("cpu"),
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
      size: getColumnMinSize("memory"),
      minSize: getColumnMinSize("memory"),
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
      size: getColumnMinSize("storage"),
      minSize: getColumnMinSize("storage"),
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
