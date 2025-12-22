"use client";

// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

import { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn, formatCompact } from "@/lib/utils";
import { ResourcePanel } from "./resource-panel";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Resource } from "@/lib/api/adapter";
import type { ResourceDisplayMode } from "@/headless";

// =============================================================================
// Types
// =============================================================================

type SortColumn = "resource" | "pools" | "platform" | "gpu" | "cpu" | "memory" | "storage";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

interface ResourceTableProps {
  /** Array of resources to display */
  resources: Resource[];
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Show the Pools column (for cross-pool views) */
  showPoolsColumn?: boolean;
  /**
   * Pool context for ResourcePanel display.
   * When provided, ResourcePanel shows pool-specific task configurations.
   */
  poolName?: string;
  /** Display mode: "free" shows available capacity, "used" shows utilization */
  displayMode?: ResourceDisplayMode;
  /**
   * Custom click handler for row selection.
   * If not provided, opens ResourcePanel.
   */
  onResourceClick?: (resource: Resource) => void;
}

// =============================================================================
// Component
// =============================================================================

export function ResourceTable({
  resources,
  isLoading,
  showPoolsColumn = false,
  poolName,
  displayMode = "free",
  onResourceClick,
}: ResourceTableProps) {
  const [selectedResource, setSelectedResource] = useState<Resource | null>(null);

  // Handle row click - use custom handler or default to panel
  const handleResourceClick = (resource: Resource) => {
    if (onResourceClick) {
      onResourceClick(resource);
    } else {
      setSelectedResource(resource);
    }
  };
  const [sort, setSort] = useState<SortState>({ column: null, direction: "asc" });

  // Reset sort when display mode changes (React pattern for resetting state on prop change)
  const [prevDisplayMode, setPrevDisplayMode] = useState(displayMode);
  if (prevDisplayMode !== displayMode) {
    setPrevDisplayMode(displayMode);
    setSort({ column: null, direction: "asc" });
  }

  // Handle column header click
  const handleSort = (column: SortColumn) => {
    setSort((prev) => {
      if (prev.column === column) {
        // Same column: toggle direction, or clear if already desc
        if (prev.direction === "asc") {
          return { column, direction: "desc" };
        }
        return { column: null, direction: "asc" };
      }
      // New column: start with ascending
      return { column, direction: "asc" };
    });
  };

  // Sort resources
  // In "free" mode: resource columns sort by free value (total - used)
  // In "used" mode: resource columns sort by used value
  const sortedResources = useMemo(() => {
    if (!sort.column) return resources;

    const sorted = [...resources].sort((a, b) => {
      let cmp = 0;
      switch (sort.column) {
        case "resource":
          cmp = a.name.localeCompare(b.name);
          break;
        case "pools": {
          // Sort by first pool name (alphabetically)
          const aFirstPool = a.poolMemberships[0]?.pool ?? "";
          const bFirstPool = b.poolMemberships[0]?.pool ?? "";
          cmp = aFirstPool.localeCompare(bFirstPool);
          break;
        }
        case "platform":
          cmp = a.platform.localeCompare(b.platform);
          break;
        case "gpu":
          cmp = displayMode === "free"
            ? (a.gpu.total - a.gpu.used) - (b.gpu.total - b.gpu.used)
            : a.gpu.used - b.gpu.used;
          break;
        case "cpu":
          cmp = displayMode === "free"
            ? (a.cpu.total - a.cpu.used) - (b.cpu.total - b.cpu.used)
            : a.cpu.used - b.cpu.used;
          break;
        case "memory":
          cmp = displayMode === "free"
            ? (a.memory.total - a.memory.used) - (b.memory.total - b.memory.used)
            : a.memory.used - b.memory.used;
          break;
        case "storage":
          cmp = displayMode === "free"
            ? (a.storage.total - a.storage.used) - (b.storage.total - b.storage.used)
            : a.storage.used - b.storage.used;
          break;
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });

    return sorted;
  }, [resources, sort, displayMode]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <div className="h-4 w-32 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
              <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No resources found
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
              <SortableHeader
                label="Resource"
                column="resource"
                sort={sort}
                onSort={handleSort}
              />
              {showPoolsColumn && (
                <SortableHeader
                  label="Pools"
                  column="pools"
                  sort={sort}
                  onSort={handleSort}
                />
              )}
              <SortableHeader
                label="Platform"
                column="platform"
                sort={sort}
                onSort={handleSort}
              />
              <SortableHeader
                label="GPU"
                column="gpu"
                sort={sort}
                onSort={handleSort}
                align="right"
              />
              <SortableHeader
                label="CPU"
                column="cpu"
                sort={sort}
                onSort={handleSort}
                align="right"
              />
              <SortableHeader
                label="Memory"
                column="memory"
                sort={sort}
                onSort={handleSort}
                align="right"
              />
              <SortableHeader
                label="Storage"
                column="storage"
                sort={sort}
                onSort={handleSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {sortedResources.map((resource, idx) => (
              <tr
                key={`${resource.name}-${resource.platform}-${idx}`}
                tabIndex={0}
                role="button"
                aria-label={`View details for resource ${resource.name}`}
                onClick={() => handleResourceClick(resource)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleResourceClick(resource);
                  }
                }}
                className="cursor-pointer transition-colors hover:bg-zinc-50 focus:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#76b900] dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
              >
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                  <span className="block max-w-[200px] truncate" title={resource.name}>
                    {resource.name}
                  </span>
                </td>
                {showPoolsColumn && (
                  <td className="whitespace-nowrap px-4 py-3 text-zinc-500 dark:text-zinc-400">
                    <PoolsCell memberships={resource.poolMemberships} />
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {resource.platform}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <CapacityCell used={resource.gpu.used} total={resource.gpu.total} mode={displayMode} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <CapacityCell used={resource.cpu.used} total={resource.cpu.total} mode={displayMode} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <CapacityCell used={resource.memory.used} total={resource.memory.total} unit="Gi" mode={displayMode} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <CapacityCell used={resource.storage.used} total={resource.storage.total} unit="Gi" mode={displayMode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Resource detail panel - only render when not using custom handler */}
      {!onResourceClick && (
        <ResourcePanel
          resource={selectedResource}
          poolName={poolName}
          onClose={() => setSelectedResource(null)}
        />
      )}
    </>
  );
}

function SortableHeader({
  label,
  column,
  sort,
  onSort,
  align = "left",
}: {
  label: string;
  column: SortColumn;
  sort: SortState;
  onSort: (column: SortColumn) => void;
  align?: "left" | "right";
}) {
  const isActive = sort.column === column;

  return (
    <th
      className={cn(
        "whitespace-nowrap px-4 py-2 text-xs font-medium uppercase tracking-wider",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      <button
        onClick={() => onSort(column)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors hover:text-zinc-900 dark:hover:text-zinc-100",
          isActive
            ? "text-zinc-900 dark:text-zinc-100"
            : "text-zinc-500 dark:text-zinc-400"
        )}
      >
        {label}
        {isActive ? (
          sort.direction === "asc" ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </th>
  );
}

function CapacityCell({
  used,
  total,
  unit = "",
  mode = "free",
}: {
  used: number;
  total: number;
  unit?: string;
  mode?: ResourceDisplayMode;
}) {
  if (total === 0) {
    return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  }

  const free = total - used;

  if (mode === "free") {
    // Free mode: just show the free amount
    return (
      <span className="tabular-nums text-zinc-900 dark:text-zinc-100">
        {formatCompact(free)}{unit && ` ${unit}`}
      </span>
    );
  }

  // Used mode: show fraction
  return (
    <span className="tabular-nums">
      <span className="text-zinc-900 dark:text-zinc-100">{formatCompact(used)}</span>
      <span className="text-zinc-400 dark:text-zinc-500">/{formatCompact(total)}</span>
      {unit && <span className="text-zinc-400 dark:text-zinc-500 text-xs ml-0.5">{unit}</span>}
    </span>
  );
}

/**
 * Pool cell showing 1 full pool name + "+N" for additional pools.
 * Never truncates pool names - uses +N instead for clean display.
 */
function PoolsCell({
  memberships,
}: {
  memberships: Resource["poolMemberships"];
}) {
  // Get unique pool names, sorted alphabetically
  const pools = [...new Set(memberships.map((m) => m.pool))].sort((a, b) =>
    a.localeCompare(b)
  );

  if (pools.length === 0) {
    return <span className="text-zinc-400 dark:text-zinc-600">—</span>;
  }

  // Always show exactly 1 full pool name, +N for the rest
  const firstPool = pools[0];
  const additionalCount = pools.length - 1;
  const fullText = pools.join(", ");

  const content = (
    <span className="inline-flex items-center gap-1.5">
      <span>{firstPool}</span>
      {additionalCount > 0 && (
        <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          +{additionalCount}
        </span>
      )}
    </span>
  );

  // Show tooltip with full list when there are multiple pools
  if (additionalCount > 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="text-left focus:outline-none">
            {content}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {fullText}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Single pool - no tooltip needed
  return content;
}
