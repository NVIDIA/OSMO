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
 * Table State Components
 *
 * Reusable loading and error state components for data tables.
 * Consolidates duplicated loading/error UI patterns across the codebase.
 *
 * @example
 * ```tsx
 * // In a data table component
 * if (isLoading && items.length === 0) {
 *   return <TableLoadingSkeleton className="my-table-container" />;
 * }
 *
 * if (error) {
 *   return <TableErrorState error={error} title="Unable to load items" onRetry={refetch} />;
 * }
 * ```
 */

import { cn } from "@/lib/utils";
import { TableSkeleton } from "./TableSkeleton";

// =============================================================================
// Types
// =============================================================================

export interface TableLoadingSkeletonProps {
  /** Number of columns to show */
  columnCount?: number;
  /** Number of skeleton rows to display */
  rows?: number;
  /** Height of each skeleton row */
  rowHeight?: number;
  /** Additional CSS class for the container */
  className?: string;
}

export interface TableErrorStateProps {
  /** The error object */
  error: Error;
  /** Title text for the error message */
  title?: string;
  /** Callback when retry button is clicked */
  onRetry?: () => void;
  /** Additional CSS class for the container */
  className?: string;
}

// =============================================================================
// Loading Skeleton
// =============================================================================

/**
 * Loading skeleton for data tables.
 *
 * Displays animated placeholder rows while data is loading.
 * Uses TableSkeleton internally for consistent layout.
 */
export function TableLoadingSkeleton({
  rows = 10,
  rowHeight = 48,
  columnCount = 5,
  className,
}: TableLoadingSkeletonProps) {
  return (
    <TableSkeleton
      rowCount={rows}
      rowHeight={rowHeight}
      columnCount={columnCount}
      className={className}
    />
  );
}

// =============================================================================
// Error State
// =============================================================================

/**
 * Error state for data tables.
 *
 * Displays an error message with optional retry button.
 */
export function TableErrorState({ error, title = "Unable to load data", onRetry, className }: TableErrorStateProps) {
  return (
    <div className={cn("table-container h-full", className)}>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <div className="text-sm text-red-600 dark:text-red-400">{title}</div>
        <div className="text-xs text-zinc-500 dark:text-zinc-400">{error.message}</div>
        {onRetry && (
          <button
            onClick={onRetry}
            className="rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
