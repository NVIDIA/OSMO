"use client";

import { Server, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NodeTable } from "./node-table";
import type { Node } from "@/lib/api/adapter";

interface NodeSectionProps {
  /** All nodes (after platform filtering) */
  nodes: Node[];
  /** Total node count (before any filtering) */
  totalCount: number;
  /** Pool name for node panel */
  poolName: string;
  /** Loading state */
  isLoading?: boolean;
  /** Current search query */
  search: string;
  /** Search change handler */
  onSearchChange: (query: string) => void;
  /** Clear search handler */
  onClearSearch: () => void;
  /** Whether any filter is active (platform or search) */
  hasActiveFilter?: boolean;
}

export function NodeSection({
  nodes,
  totalCount,
  poolName,
  isLoading,
  search,
  onSearchChange,
  onClearSearch,
  hasActiveFilter = false,
}: NodeSectionProps) {
  const hasSearch = search.length > 0;
  const filteredCount = nodes.length;

  return (
    <div className="space-y-3">
      {/* Header row with label and search */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-zinc-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Nodes
          </h2>
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {hasActiveFilter
              ? `(${filteredCount} of ${totalCount})`
              : `(${totalCount})`}
          </span>
        </div>

        {/* Search input */}
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-8 pl-9 pr-8 text-sm"
          />
          {hasSearch && (
            <button
              onClick={onClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Node table */}
      <NodeTable nodes={nodes} isLoading={isLoading} poolName={poolName} />
    </div>
  );
}
