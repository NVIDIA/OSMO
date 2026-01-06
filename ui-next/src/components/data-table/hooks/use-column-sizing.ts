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

import { useCallback, useRef, useMemo, useLayoutEffect, useState, useEffect } from "react";
import type { ColumnSizingState, ColumnSizingInfoState } from "@tanstack/react-table";
import { useStableCallback, useStableValue, useRafCallback } from "@/hooks";

// =============================================================================
// Types
// =============================================================================

export interface UseColumnSizingOptions {
  /** Visible column IDs (for CSS variable generation) */
  columnIds: string[];
  /** Container ref for proportional resize on window changes */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Table element ref for direct DOM updates during resize */
  tableRef?: React.RefObject<HTMLTableElement | null>;
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
  /** Set a single column's size (respects minSize, persists immediately) */
  setColumnSize: (columnId: string, size: number) => void;
  /** Reset a single column to default (removes from sizing state) */
  resetColumn: (columnId: string) => void;
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
  tableRef,
  persistedSizing,
  onSizingChange,
  minSizes,
}: UseColumnSizingOptions): UseColumnSizingResult {
  // Track previous container width for proportional scaling
  const prevContainerWidth = useRef<number | null>(null);
  const isInitialMount = useRef(true);

  // =========================================================================
  // Performance: RAF-throttled resize tracking
  // During drag, we update DOM directly and only sync to React on idle/end
  // =========================================================================
  const pendingSizingRef = useRef<ColumnSizingState | null>(null);
  const isResizingRef = useRef(false);

  // Stable ref to minSizes for use in callbacks
  const minSizesRef = useStableValue(minSizes);

  // RAF-throttled CSS variable update for smooth 60fps during column resize
  // IMPORTANT: Also get cancel function to prevent stale RAF from overwriting direct DOM updates
  const [scheduleColumnUpdate, cancelColumnUpdate] = useRafCallback((sizing: ColumnSizingState) => {
    const table = tableRef?.current;
    if (!table) return;

    for (const [colId, width] of Object.entries(sizing)) {
      const minWidth = minSizesRef.current?.[colId] ?? 0;
      const clampedWidth = Math.max(width, minWidth);
      table.style.setProperty(`--col-${colId}`, `${clampedWidth}px`);
    }
  });

  // =========================================================================
  // State
  // Initialize from persisted sizing. TanStack uses 150px default for missing.
  // =========================================================================

  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => persistedSizing ?? {});

  // Stable ref to columnSizing for use in callbacks (avoids stale closures)
  // This is critical because TanStack Table may cache callback references
  const columnSizingRef = useStableValue(columnSizing);
  const [columnSizingInfo, setColumnSizingInfo] = useState<ColumnSizingInfoState>(DEFAULT_COLUMN_SIZING_INFO);

  // Stable callback for persistence (doesn't change reference)
  const persistSizing = useStableCallback((sizing: ColumnSizingState) => {
    onSizingChange?.(sizing);
  });

  // =========================================================================
  // RAF-throttled onChange handler for smooth 60fps updates
  // During drag: update DOM directly, bypass React for performance
  // After drag: sync final state to React
  //
  // IMPORTANT: Uses columnSizingRef.current (not columnSizing) to avoid stale
  // closures. TanStack Table may cache callback references, so we must always
  // read the latest state from a ref.
  // =========================================================================
  const onColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
      // Calculate new sizing using ref for latest value (avoid stale closure)
      const currentSizing = pendingSizingRef.current ?? columnSizingRef.current;
      const newSizing = typeof updater === "function"
        ? updater(currentSizing)
        : updater;

      // Store pending sizing for next RAF frame
      pendingSizingRef.current = newSizing;

      // If we're resizing, update DOM directly (RAF-throttled)
      if (isResizingRef.current) {
        scheduleColumnUpdate(newSizing);
      } else {
        // Not resizing, update React state normally
        setColumnSizing(newSizing);
      }
    },
    [scheduleColumnUpdate, columnSizingRef],
  );

  const onColumnSizingInfoChange = useCallback(
    (updater: ColumnSizingInfoState | ((old: ColumnSizingInfoState) => ColumnSizingInfoState)) => {
      setColumnSizingInfo((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;

        // Track resize state for RAF optimization
        const wasResizing = isResizingRef.current;
        const isNowResizing = Boolean(next.isResizingColumn);

        if (!wasResizing && isNowResizing) {
          // Resize started: add is-resizing class, cache current sizing
          // Use ref for latest value (avoid stale closure)
          isResizingRef.current = true;
          pendingSizingRef.current = columnSizingRef.current;
          containerRef?.current?.classList.add("is-resizing");
        } else if (wasResizing && !isNowResizing) {
          // Resize ended: remove class, cancel any pending RAF, sync to React state
          isResizingRef.current = false;
          containerRef?.current?.classList.remove("is-resizing");

          // CRITICAL: Cancel any pending RAF to prevent it from overwriting
          // direct DOM updates (e.g., from double-click auto-fit)
          cancelColumnUpdate();

          // Sync final sizing to React state
          if (pendingSizingRef.current) {
            setColumnSizing(pendingSizingRef.current);
          }
        }

        return next;
      });
    },
    [containerRef, columnSizingRef, cancelColumnUpdate],
  );

  // Cleanup on unmount - ensure is-resizing class is removed
  useEffect(() => {
    const container = containerRef?.current;
    return () => {
      container?.classList.remove("is-resizing");
    };
  }, [containerRef]);

  // =========================================================================
  // Proportional Scaling on Container Resize
  // When the container (window/panel) resizes, scale all columns proportionally
  // =========================================================================

  // RAF-throttled proportional scaling for 60fps during window resize
  const [scheduleProportionalScale] = useRafCallback((newWidth: number) => {
    const prevWidth = prevContainerWidth.current;
    if (prevWidth === null) return;

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

      scheduleProportionalScale(newWidth);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef, columnSizingInfo.isResizingColumn, scheduleProportionalScale]);

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
    // Cancel any pending RAF first
    cancelColumnUpdate();

    // CRITICAL: Update pendingSizingRef FIRST to prevent race conditions
    pendingSizingRef.current = {};

    // Update React state
    setColumnSizing({});
    queueMicrotask(() => persistSizing({}));

    // Also update DOM directly for immediate visual feedback
    const table = tableRef?.current;
    if (table) {
      for (const colId of columnIds) {
        table.style.setProperty(`--col-${colId}`, "150px");
      }
    }
  }, [persistSizing, tableRef, columnIds, cancelColumnUpdate]);

  const setColumnSize = useCallback(
    (columnId: string, size: number) => {
      const minWidth = minSizesRef.current?.[columnId] ?? 0;
      const clampedSize = Math.max(size, minWidth);

      // CRITICAL: Cancel any pending RAF FIRST to prevent it from overwriting
      // our direct DOM update with stale values
      cancelColumnUpdate();

      // Calculate the new sizing state using latest available values
      const currentSizing = pendingSizingRef.current ?? columnSizingRef.current ?? {};
      const newSizing = { ...currentSizing, [columnId]: clampedSize };

      // CRITICAL: Update pendingSizingRef FIRST so any concurrent resize events
      // (e.g., pointer events during double-click) use this new value instead
      // of overwriting it with stale cached state
      pendingSizingRef.current = newSizing;

      // Update React state
      setColumnSizing(() => {
        queueMicrotask(() => persistSizing(newSizing));
        return newSizing;
      });

      // Also update DOM directly for immediate visual feedback
      // This ensures the change is visible before React's next render
      const table = tableRef?.current;
      if (table) {
        table.style.setProperty(`--col-${columnId}`, `${clampedSize}px`);
      }
    },
    [minSizesRef, persistSizing, tableRef, columnSizingRef, cancelColumnUpdate],
  );

  const resetColumn = useCallback(
    (columnId: string) => {
      // Cancel any pending RAF first
      cancelColumnUpdate();

      // Calculate the new sizing state
      const currentSizing = pendingSizingRef.current ?? columnSizingRef.current ?? {};
      const newSizing = { ...currentSizing };
      delete newSizing[columnId];

      // CRITICAL: Update pendingSizingRef FIRST to prevent race conditions
      pendingSizingRef.current = newSizing;

      // Update React state
      setColumnSizing(() => {
        queueMicrotask(() => persistSizing(newSizing));
        return newSizing;
      });

      // Also update DOM directly for immediate visual feedback
      const table = tableRef?.current;
      if (table) {
        table.style.setProperty(`--col-${columnId}`, "150px");
      }
    },
    [persistSizing, tableRef, columnSizingRef, cancelColumnUpdate],
  );

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
    setColumnSize,
    resetColumn,
    cssVariables,
  };
}
