/**
 * EXAMPLE: Themed Component Pattern
 * 
 * This is a simplified version of VirtualizedResourceTable showing the key patterns.
 * Use this as a reference when creating new components.
 */

"use client";

import {
  useState,
  useRef,
  useMemo,
  memo,
  useCallback,
  startTransition,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn, formatCompact } from "@/lib/utils";
import type { Resource } from "@/lib/api/adapter";

// =============================================================================
// Types
// =============================================================================

type SortColumn = "name" | "platform" | "gpu" | "cpu";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

interface ResourceTableProps {
  /** Array of resources to display */
  resources: Resource[];
  /** Total count for "X of Y" display */
  totalCount?: number;
  /** Show loading skeleton */
  isLoading?: boolean;
  /** Custom click handler */
  onResourceClick?: (resource: Resource) => void;
  /** Filter bar content slot */
  filterContent?: React.ReactNode;
}

// =============================================================================
// Constants
// =============================================================================

const ROW_HEIGHT = 48;
const TABLE_COLUMNS = "minmax(200px, 1fr) 120px 80px 80px";

// =============================================================================
// Main Component
// =============================================================================

export function ResourceTable({
  resources,
  totalCount,
  isLoading = false,
  onResourceClick,
  filterContent,
}: ResourceTableProps) {
  // Local UI state only
  const [sort, setSort] = useState<SortState>({ column: null, direction: "asc" });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Handle sort - wrapped in startTransition for non-blocking updates
  const handleSort = useCallback((column: SortColumn) => {
    startTransition(() => {
      setSort((prev) => {
        if (prev.column === column) {
          return prev.direction === "asc"
            ? { column, direction: "desc" }
            : { column: null, direction: "asc" };
        }
        return { column, direction: "asc" };
      });
    });
  }, []);

  // Memoize sorted resources
  const sortedResources = useMemo(() => {
    if (!sort.column) return resources;

    return [...resources].sort((a, b) => {
      let cmp = 0;
      switch (sort.column) {
        case "name":
          cmp = a.name.localeCompare(b.name);
          break;
        case "platform":
          cmp = a.platform.localeCompare(b.platform);
          break;
        case "gpu":
          cmp = a.gpu.total - a.gpu.used - (b.gpu.total - b.gpu.used);
          break;
        case "cpu":
          cmp = a.cpu.total - a.cpu.used - (b.cpu.total - b.cpu.used);
          break;
      }
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [resources, sort]);

  // Memoize row click handler
  const handleRowClick = useCallback(
    (resource: Resource) => {
      onResourceClick?.(resource);
    },
    [onResourceClick]
  );

  return (
    <div
      className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      style={{ contain: "strict" }}
    >
      {/* Filter slot */}
      {filterContent && (
        <div className="shrink-0 border-b border-zinc-100 p-4 dark:border-zinc-800/50">
          {filterContent}
        </div>
      )}

      {/* Header */}
      <TableHeader sort={sort} onSort={handleSort} />

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        {isLoading ? (
          <TableSkeleton />
        ) : (
          <TableContent
            resources={sortedResources}
            scrollRef={scrollRef}
            onRowClick={handleRowClick}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components (memoized)
// =============================================================================

const TableHeader = memo(function TableHeader({
  sort,
  onSort,
}: {
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  const columns: { label: string; column: SortColumn }[] = [
    { label: "Name", column: "name" },
    { label: "Platform", column: "platform" },
    { label: "GPU", column: "gpu" },
    { label: "CPU", column: "cpu" },
  ];

  return (
    <div
      className="grid gap-0 bg-[var(--nvidia-green-bg)] py-2.5 text-xs font-medium uppercase tracking-wider text-[var(--nvidia-green)] dark:bg-[var(--nvidia-green-bg-dark)] dark:text-[var(--nvidia-green-light)]"
      style={{ gridTemplateColumns: TABLE_COLUMNS }}
    >
      {columns.map((col) => (
        <button
          key={col.column}
          onClick={() => onSort(col.column)}
          className="flex items-center gap-1 px-4"
        >
          {col.label}
          {sort.column === col.column ? (
            sort.direction === "asc" ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )
          ) : (
            <ChevronsUpDown className="h-3 w-3 opacity-30" />
          )}
        </button>
      ))}
    </div>
  );
});

const TableContent = memo(function TableContent({
  resources,
  scrollRef,
  onRowClick,
}: {
  resources: Resource[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onRowClick: (resource: Resource) => void;
}) {
  const virtualizer = useVirtualizer({
    count: resources.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 5,
  });

  if (resources.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-zinc-500">
        No resources found
      </div>
    );
  }

  return (
    <div
      style={{
        height: virtualizer.getTotalSize(),
        position: "relative",
        contain: "strict",
      }}
    >
      {virtualizer.getVirtualItems().map((vRow) => {
        const resource = resources[vRow.index];
        return (
          <div
            key={vRow.key}
            role="row"
            tabIndex={0}
            onClick={() => onRowClick(resource)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(resource);
              }
            }}
            className="absolute left-0 right-0"
            style={{
              height: vRow.size,
              transform: `translate3d(0, ${vRow.start}px, 0)`,
            }}
          >
            <div
              className="grid h-full cursor-pointer items-center gap-0 border-b border-zinc-100 text-sm hover:bg-zinc-50 dark:border-zinc-800/50 dark:hover:bg-zinc-900"
              style={{ gridTemplateColumns: TABLE_COLUMNS }}
            >
              <div className="truncate px-4 font-medium">{resource.name}</div>
              <div className="truncate px-4 text-zinc-500">{resource.platform}</div>
              <div className="px-4 text-right tabular-nums">
                {formatCompact(resource.gpu.total - resource.gpu.used)}
              </div>
              <div className="px-4 text-right tabular-nums">
                {formatCompact(resource.cpu.total - resource.cpu.used)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
});

const TableSkeleton = memo(function TableSkeleton() {
  return (
    <div>
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="grid gap-0 border-b border-zinc-100 py-3 dark:border-zinc-800/50"
          style={{ gridTemplateColumns: TABLE_COLUMNS }}
        >
          <div className="px-4">
            <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="px-4">
            <div className="h-4 w-16 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="px-4">
            <div className="h-4 w-8 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="px-4">
            <div className="h-4 w-8 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
          </div>
        </div>
      ))}
    </div>
  );
});
