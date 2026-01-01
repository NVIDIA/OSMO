/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Pools Table Row Component
 *
 * Memoized row component for the pools table.
 * Uses data-attributes for status styling to avoid JS recalculation.
 */

"use client";

import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { Pool } from "@/lib/api/adapter";
import { GpuProgressCell } from "./gpu-progress-cell";
import { PlatformPills } from "./platform-pills";
import { getStatusDisplay } from "./constants";

export interface PoolsTableRowProps {
  /** Pool data */
  pool: Pool;
  /** CSS grid template for columns */
  gridTemplate: string;
  /** Minimum row width */
  minWidth: number;
  /** Whether this row is selected */
  isSelected: boolean;
  /** Visible column IDs */
  visibleColumnIds: string[];
  /** Column order */
  columnOrder: string[];
  /** Display mode for GPU numbers */
  displayMode: "used" | "free";
  /** Compact mode */
  compact: boolean;
  /** Whether this pool shares capacity */
  isShared: boolean;
  /** Click handler */
  onClick: () => void;
}

export const PoolsTableRow = memo(
  function PoolsTableRow({
    pool,
    gridTemplate,
    minWidth,
    isSelected,
    visibleColumnIds,
    columnOrder,
    displayMode,
    compact,
    isShared,
    onClick,
  }: PoolsTableRowProps) {
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      },
      [onClick],
    );

    // Get ordered visible columns
    const orderedColumns = columnOrder.filter((id) => visibleColumnIds.includes(id));

    const statusDisplay = getStatusDisplay(pool.status);

    return (
      <div
        role="row"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={handleKeyDown}
        data-status={statusDisplay.category}
        data-selected={isSelected}
        className={cn(
          "pools-row pools-contained grid cursor-pointer items-center gap-6 border-b border-zinc-200 px-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/50",
          compact ? "py-1" : "py-2",
          isSelected && "bg-blue-50 dark:bg-blue-950/30",
        )}
        style={{
          gridTemplateColumns: gridTemplate,
          minWidth,
          height: compact ? 32 : 48,
        }}
        aria-selected={isSelected}
      >
        {orderedColumns.map((columnId) => {
          switch (columnId) {
            case "name":
              return (
                <div key={columnId} className="min-w-0">
                  {/* Pool name - status is shown via left border */}
                  <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">{pool.name}</span>
                </div>
              );

            case "description":
              return (
                <div key={columnId} className="min-w-0">
                  <span className="truncate text-sm text-zinc-500 dark:text-zinc-400">
                    {pool.description || "—"}
                  </span>
                </div>
              );

            case "quota":
              return (
                <div key={columnId}>
                  <GpuProgressCell quota={pool.quota} type="quota" displayMode={displayMode} compact={compact} />
                </div>
              );

            case "capacity":
              return (
                <div key={columnId}>
                  <GpuProgressCell
                    quota={pool.quota}
                    type="capacity"
                    displayMode={displayMode}
                    compact={compact}
                    isShared={isShared}
                  />
                </div>
              );

            case "platforms":
              return (
                <div key={columnId}>
                  <PlatformPills platforms={pool.platforms} maxVisible={compact ? 1 : 2} />
                </div>
              );

            case "backend":
              return (
                <div key={columnId}>
                  <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{pool.backend}</span>
                </div>
              );

            default:
              return <div key={columnId} />;
          }
        })}
      </div>
    );
  },
  // Custom comparison for memoization
  (prev, next) =>
    prev.pool === next.pool &&
    prev.gridTemplate === next.gridTemplate &&
    prev.minWidth === next.minWidth &&
    prev.isSelected === next.isSelected &&
    prev.displayMode === next.displayMode &&
    prev.compact === next.compact &&
    prev.isShared === next.isShared &&
    prev.visibleColumnIds.join(",") === next.visibleColumnIds.join(",") &&
    prev.columnOrder.join(",") === next.columnOrder.join(","),
);
