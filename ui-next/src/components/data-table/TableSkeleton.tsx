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
 * Table Skeleton
 *
 * Shows a loading skeleton that matches the table structure.
 * Uses shadcn/ui Skeleton component for consistent styling.
 */

"use client";

import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/shadcn/skeleton";

// =============================================================================
// Types
// =============================================================================

export interface TableSkeletonProps {
  /** Number of columns to show */
  columnCount?: number;
  /** Number of rows to show */
  rowCount?: number;
  /** Row height in pixels */
  rowHeight?: number;
  /** Column headers (optional - shows generic if not provided) */
  headers?: string[];
  /** Additional className for the container */
  className?: string;
  /** Show header row */
  showHeader?: boolean;
}

// =============================================================================
// Skeleton Row
// =============================================================================

interface SkeletonRowProps {
  columnCount: number;
  rowHeight: number;
  rowIndex: number;
}

const SkeletonRow = memo(function SkeletonRow({ columnCount, rowHeight, rowIndex }: SkeletonRowProps) {
  // Vary cell widths for visual interest
  const cellWidths = useMemo(() => {
    const widths: string[] = [];
    for (let i = 0; i < columnCount; i++) {
      // First column is wider, others vary
      if (i === 0) {
        widths.push("60%");
      } else {
        // Pseudo-random width based on indices
        const variance = ((rowIndex * 7 + i * 13) % 40) + 40; // 40-80%
        widths.push(`${variance}%`);
      }
    }
    return widths;
  }, [columnCount, rowIndex]);

  return (
    <tr
      style={{ height: rowHeight, display: "flex" }}
      className="border-b border-border"
    >
      {Array.from({ length: columnCount }).map((_, colIndex) => (
        <td
          key={colIndex}
          className="flex flex-1 shrink-0 items-center px-4"
        >
          <Skeleton
            className="h-4"
            style={{ width: cellWidths[colIndex] }}
          />
        </td>
      ))}
    </tr>
  );
});

// =============================================================================
// Main Component
// =============================================================================

export const TableSkeleton = memo(function TableSkeleton({
  columnCount = 5,
  rowCount = 10,
  rowHeight = 48,
  headers,
  className,
  showHeader = true,
}: TableSkeletonProps) {
  const effectiveHeaders = useMemo(() => {
    if (headers && headers.length > 0) return headers;
    // Generate placeholder headers
    return Array.from({ length: columnCount }, (_, i) => (i === 0 ? "Name" : `Column ${i + 1}`));
  }, [headers, columnCount]);

  return (
    <div className={cn("overflow-hidden", className)}>
      <table className="w-full border-collapse text-sm">
        {/* Header */}
        {showHeader && (
          <thead className="bg-muted text-left text-xs font-medium uppercase text-muted-foreground">
            <tr style={{ display: "flex" }}>
              {effectiveHeaders.map((header, i) => (
                <th
                  key={i}
                  className="flex flex-1 shrink-0 items-center px-4 py-3"
                >
                  {/* Show actual header text if provided, otherwise skeleton */}
                  {headers && headers.length > 0 ? (
                    <span className="truncate">{header}</span>
                  ) : (
                    <Skeleton className="h-3 w-16" />
                  )}
                </th>
              ))}
            </tr>
          </thead>
        )}

        {/* Body */}
        <tbody>
          {Array.from({ length: rowCount }).map((_, rowIndex) => (
            <SkeletonRow
              key={rowIndex}
              columnCount={effectiveHeaders.length}
              rowHeight={rowHeight}
              rowIndex={rowIndex}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

export default TableSkeleton;
