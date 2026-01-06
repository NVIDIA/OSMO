// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Column Sizing Hook
 *
 * Minimal wrapper around TanStack Table's native column sizing.
 *
 * ## What TanStack Handles Natively
 * - Resize dragging (header.getResizeHandler())
 * - Size state (columnSizing)
 *
 * ## What This Hook Adds
 * - Persistence (via onSizingChange callback)
 * - CSS variables (performance optimization)
 * - Proportional scaling on container resize
 * - **minSize enforcement** (TanStack only enforces on read via column.getSize(),
 *   not in state - we enforce in CSS variables and during proportional scaling)
 *
 * @see https://tanstack.com/table/v8/docs/guide/column-sizing
 */

import { useCallback, useRef, useMemo, useLayoutEffect, useState } from "react";
import type { ColumnSizingState, ColumnSizingInfoState } from "@tanstack/react-table";
import { useStableCallback } from "@/hooks";

// =============================================================================
// Types
// =============================================================================

export interface UseColumnSizingOptions {
  /** Visible column IDs (for CSS variable generation) */
  columnIds: string[];
  /** Container ref for proportional resize on window changes */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Persisted column sizing from store */
  persistedSizing?: ColumnSizingState;
  /** Callback to persist sizing changes */
  onSizingChange?: (sizing: ColumnSizingState) => void;
  /**
   * Minimum sizes per column (in pixels).
   * Enforced in CSS variables and during proportional scaling.
   * Should match minSize values from column definitions.
   */
  minSizes?: Record<string, number>;
}

export interface UseColumnSizingResult {
  /** Column sizing state - pass to TanStack Table's state.columnSizing */
  columnSizing: ColumnSizingState;
  /** Handler for TanStack's onColumnSizingChange */
  onColumnSizingChange: (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => void;
  /** Column sizing info state - pass to TanStack Table's state.columnSizingInfo */
  columnSizingInfo: ColumnSizingInfoState;
  /** Handler for TanStack's onColumnSizingInfoChange */
  onColumnSizingInfoChange: (
    updater: ColumnSizingInfoState | ((old: ColumnSizingInfoState) => ColumnSizingInfoState),
  ) => void;
  /** Call on resize end to persist */
  handleResizeEnd: () => void;
  /** Reset all columns (clears persisted sizing) */
  resetAllColumns: () => void;
  /**
   * CSS variables for column widths.
   * Apply to table: `style={cssVariables}`
   * @see https://tanstack.com/table/v8/docs/guide/column-sizing#advanced-column-resizing-performance
   */
  cssVariables: React.CSSProperties;
}

// Default TanStack columnSizingInfo state
const DEFAULT_COLUMN_SIZING_INFO: ColumnSizingInfoState = {
  startOffset: null,
  startSize: null,
  deltaOffset: null,
  deltaPercentage: null,
  isResizingColumn: false,
  columnSizingStart: [],
};

// =============================================================================
// Hook
// =============================================================================

export function useColumnSizing({
  columnIds,
  containerRef,
  persistedSizing,
  onSizingChange,
  minSizes,
}: UseColumnSizingOptions): UseColumnSizingResult {
  // Track previous container width for proportional scaling
  const prevContainerWidth = useRef<number | null>(null);
  const isInitialMount = useRef(true);

  // =========================================================================
  // State
  // Initialize from persisted sizing. TanStack uses 150px default for missing.
  // =========================================================================

  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => persistedSizing ?? {});
  const [columnSizingInfo, setColumnSizingInfo] = useState<ColumnSizingInfoState>(DEFAULT_COLUMN_SIZING_INFO);

  // Stable callback for persistence (doesn't change reference)
  const persistSizing = useStableCallback((sizing: ColumnSizingState) => {
    onSizingChange?.(sizing);
  });

  // TanStack-compatible onChange handlers
  const onColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
      setColumnSizing((prev) => (typeof updater === "function" ? updater(prev) : updater));
    },
    [],
  );

  const onColumnSizingInfoChange = useCallback(
    (updater: ColumnSizingInfoState | ((old: ColumnSizingInfoState) => ColumnSizingInfoState)) => {
      setColumnSizingInfo((prev) => (typeof updater === "function" ? updater(prev) : updater));
    },
    [],
  );

  // =========================================================================
  // Proportional Scaling on Container Resize
  // When the container (window/panel) resizes, scale all columns proportionally
  // =========================================================================

  useLayoutEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    const observer = new ResizeObserver(([entry]) => {
      const newWidth = entry.contentRect.width;
      if (newWidth <= 0) return;

      // Skip during manual resize (user is dragging)
      if (columnSizingInfo.isResizingColumn) return;

      // Skip initial mount - just record the width
      if (isInitialMount.current) {
        prevContainerWidth.current = newWidth;
        isInitialMount.current = false;
        return;
      }

      const prevWidth = prevContainerWidth.current;
      if (prevWidth === null || Math.abs(prevWidth - newWidth) < 1) {
        prevContainerWidth.current = newWidth;
        return;
      }

      // Scale factor
      const scale = newWidth / prevWidth;
      prevContainerWidth.current = newWidth;

      // Scale all columns proportionally, respecting minSizes
      setColumnSizing((prev) => {
        if (Object.keys(prev).length === 0) return prev;

        const next: ColumnSizingState = {};
        for (const [colId, width] of Object.entries(prev)) {
          const scaledWidth = Math.round(width * scale);
          const minWidth = minSizes?.[colId] ?? 0;
          next[colId] = Math.max(scaledWidth, minWidth);
        }
        return next;
      });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, columnSizingInfo.isResizingColumn, minSizes]);

  // =========================================================================
  // Actions
  // =========================================================================

  const handleResizeEnd = useCallback(() => {
    // Use functional update to get latest columnSizing without dependency
    setColumnSizing((current) => {
      queueMicrotask(() => persistSizing(current));
      return current; // No change, just reading
    });
  }, [persistSizing]);

  const resetAllColumns = useCallback(() => {
    setColumnSizing({});
    queueMicrotask(() => persistSizing({}));
  }, [persistSizing]);

  // =========================================================================
  // CSS Variables (TanStack best practice for performance)
  // @see https://tanstack.com/table/v8/docs/guide/column-sizing#advanced-column-resizing-performance
  //
  // Key insight: Don't call column.getSize() on every cell!
  // Instead, calculate all widths once here, memoized, and apply via CSS variables.
  // =========================================================================

  const cssVariables = useMemo((): React.CSSProperties => {
    const vars: Record<string, string> = {};
    for (const colId of columnIds) {
      // Use persisted width, or TanStack's default (150px)
      const rawWidth = columnSizing[colId] ?? 150;
      // Enforce minSize (TanStack only enforces on read via column.getSize())
      const minWidth = minSizes?.[colId] ?? 0;
      const width = Math.max(rawWidth, minWidth);
      vars[`--col-${colId}`] = `${width}px`;
    }
    return vars as React.CSSProperties;
  }, [columnSizing, columnIds, minSizes]);

  return {
    columnSizing,
    onColumnSizingChange,
    columnSizingInfo,
    onColumnSizingInfoChange,
    handleResizeEnd,
    resetAllColumns,
    cssVariables,
  };
}
