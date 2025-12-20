"use client";

import { Server, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { NodeTable } from "./node-table";
import { heading, clearButton } from "@/lib/styles";
import type { Node } from "@/lib/api/adapter";

interface NodeSectionProps {
  nodes: Node[];
  totalCount: number;
  poolName: string;
  isLoading?: boolean;
  search: string;
  onSearchChange: (query: string) => void;
  onClearSearch: () => void;
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-zinc-400" />
          <h2 className={heading.section}>Nodes</h2>
          <span className={heading.meta}>
            {hasActiveFilter
              ? `(${filteredCount} of ${totalCount})`
              : `(${totalCount})`}
          </span>
        </div>

        {/* Search */}
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
              className={`absolute right-2 top-1/2 -translate-y-1/2 ${clearButton}`}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <NodeTable nodes={nodes} isLoading={isLoading} poolName={poolName} />
    </div>
  );
}
