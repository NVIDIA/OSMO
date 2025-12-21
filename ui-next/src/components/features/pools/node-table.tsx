"use client";

import { useState, useMemo, useEffect } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn, formatCompact } from "@/lib/utils";
import { NodePanel } from "./node-panel";
import type { Node, PlatformConfig } from "@/lib/api/adapter";
import type { ResourceDisplayMode } from "@/headless";

// =============================================================================
// Types
// =============================================================================

type SortColumn = "node" | "platform" | "gpu" | "cpu" | "memory" | "storage";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

interface NodeTableProps {
  nodes: Node[];
  isLoading?: boolean;
  poolName: string;
  platformConfigs: Record<string, PlatformConfig>;
  displayMode?: ResourceDisplayMode;
}

// =============================================================================
// Component
// =============================================================================

export function NodeTable({ nodes, isLoading, poolName, platformConfigs, displayMode = "free" }: NodeTableProps) {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [sort, setSort] = useState<SortState>({ column: null, direction: "asc" });

  // Reset sort when display mode changes
  useEffect(() => {
    setSort({ column: null, direction: "asc" });
  }, [displayMode]);

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

  // Sort nodes
  // In "free" mode: resource columns sort by free value (total - used)
  // In "used" mode: resource columns sort by used value
  const sortedNodes = useMemo(() => {
    if (!sort.column) return nodes;

    const sorted = [...nodes].sort((a, b) => {
      let cmp = 0;
      switch (sort.column) {
        case "node":
          cmp = a.nodeName.localeCompare(b.nodeName);
          break;
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
  }, [nodes, sort, displayMode]);

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

  if (nodes.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          No nodes found
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
                label="Node"
                column="node"
                sort={sort}
                onSort={handleSort}
              />
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
            {sortedNodes.map((node, idx) => (
              <tr
                key={`${node.nodeName}-${node.platform}-${idx}`}
                onClick={() => setSelectedNode(node)}
                className="cursor-pointer transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <td className="px-4 py-3 font-medium text-zinc-900 dark:text-zinc-100">
                  <span className="block max-w-[200px] truncate" title={node.nodeName}>
                    {node.nodeName}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-500 dark:text-zinc-400">
                  {node.platform}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <ResourceCell used={node.gpu.used} total={node.gpu.total} mode={displayMode} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <ResourceCell used={node.cpu.used} total={node.cpu.total} mode={displayMode} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <ResourceCell used={node.memory.used} total={node.memory.total} unit="Gi" mode={displayMode} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <ResourceCell used={node.storage.used} total={node.storage.total} unit="Gi" mode={displayMode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Node detail panel */}
      <NodePanel
        node={selectedNode}
        poolName={poolName}
        platformConfigs={platformConfigs}
        onClose={() => setSelectedNode(null)}
      />
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

function ResourceCell({
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
