/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

"use client";

import { memo, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { ColumnDef } from "@/lib/table";
import type { Pool } from "@/lib/api/adapter";
import { getStatusDisplay, type PoolColumnId } from "../../lib";
import { PoolCell } from "./pool-cell";

export interface PoolRowProps {
  pool: Pool;
  columns: ColumnDef<PoolColumnId>[];
  isSelected: boolean;
  onSelect: () => void;
  displayMode: "used" | "free";
  compact: boolean;
  isShared: boolean;
  onFilterBySharedPools?: () => void;
}

export const PoolRow = memo(function PoolRow({
  pool,
  columns,
  isSelected,
  onSelect,
  displayMode,
  compact,
  isShared,
  onFilterBySharedPools,
}: PoolRowProps) {
  const { category } = getStatusDisplay(pool.status);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    },
    [onSelect],
  );

  return (
    <tr
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      aria-selected={isSelected}
      data-status={category}
      data-selected={isSelected}
      data-compact={compact}
      className={cn(
        "pools-row cursor-pointer border-b border-zinc-200 text-sm dark:border-zinc-800",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500",
      )}
    >
      {columns.map((col) => (
        <td
          key={col.id}
          className={cn(
            "pools-td px-3",
            col.align === "right" && "text-right",
          )}
        >
          <PoolCell
            pool={pool}
            columnId={col.id}
            displayMode={displayMode}
            compact={compact}
            isShared={isShared}
            onFilterBySharedPools={onFilterBySharedPools}
          />
        </td>
      ))}
    </tr>
  );
});
