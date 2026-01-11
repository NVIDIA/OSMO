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
 * React hook for managing column sizing with TanStack Table.
 * Uses a state machine pattern for clarity and correctness.
 *
 * @see ./column-sizing-reducer.ts for state machine details
 * @see https://tanstack.com/table/v8/docs/guide/column-sizing
 */

import { useCallback, useRef, useMemo, useEffect, useReducer, useState } from "react";
import type { ColumnSizingState, ColumnSizingInfoState } from "@tanstack/react-table";
import { useSyncedRef, useIsomorphicLayoutEffect, useRafCallback } from "@react-hookz/web";
import { useStableCallback } from "@/hooks";
import type { ColumnSizingPreference, ColumnSizingPreferences } from "@/stores";
import type { ColumnSizeConfig } from "../types";
import { logColumnSizingDebug, createDebugSnapshot, flushDebugBuffer } from "../utils/debug";
import {
  measureColumnContentWidth,
  measureMultipleColumns,
  calculateColumnWidths,
  getTruncationThreshold,
  getRemToPx,
} from "../utils/column-sizing";
import { SizingModes, SizingEventTypes, PreferenceModes, type PreferenceMode } from "../constants";
import { sizingReducer, INITIAL_STATE } from "../utils/column-sizing-reducer";

// =============================================================================
// Types - External API
// =============================================================================

export interface UseColumnSizingOptions {
  /** Visible column IDs (for CSS variable generation) */
  columnIds: string[];
  /** Container ref for adding/removing is-resizing class during drag */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Table element ref for direct DOM updates during resize */
  tableRef?: React.RefObject<HTMLTableElement | null>;
  /** Column size configurations (min and preferred widths in rem) */
  columnConfigs?: ColumnSizeConfig[];
  /** User sizing preferences from persistence */
  sizingPreferences?: ColumnSizingPreferences;
  /** Callback when user manually resizes a column or auto-fits */
  onPreferenceChange?: (columnId: string, preference: ColumnSizingPreference) => void;
  /** Minimum sizes per column (in pixels) */
  minSizes?: Record<string, number>;
  /** Configured/default sizes per column (in pixels, from column config) */
  configuredSizes?: Record<string, number>;
  /** Debounce delay for resize observer (ms) */
  resizeDebounceMs?: number;
  /**
   * Data length for triggering content width measurement.
   * When this changes (and > 0), NO_TRUNCATE columns will be remeasured.
   */
  dataLength?: number;
  /**
   * Whether data is still loading (skeleton visible).
   * Measurement is deferred until loading completes.
   */
  isLoading?: boolean;
}

export interface UseColumnSizingResult {
  /** Column sizing state - pass to TanStack Table */
  columnSizing: ColumnSizingState;
  /** Handler for TanStack's onColumnSizingChange */
  onColumnSizingChange: (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => void;
  /** Column sizing info state - pass to TanStack Table */
  columnSizingInfo: ColumnSizingInfoState;
  /** Handler for TanStack's onColumnSizingInfoChange */
  onColumnSizingInfoChange: (
    updater: ColumnSizingInfoState | ((old: ColumnSizingInfoState) => ColumnSizingInfoState),
  ) => void;

  /** Start resizing a column. Returns starting width. */
  startResize: (columnId: string) => number;
  /** Update column width during drag (RAF-throttled) */
  updateResize: (columnId: string, newWidth: number) => void;
  /** End resizing and persist preferences */
  endResize: () => void;
  /** Set a single column's size */
  setColumnSize: (columnId: string, size: number) => void;
  /** Auto-fit column to content (double-click) */
  autoFit: (columnId: string, measuredWidth: number) => void;
  /** Whether initial sizing has been calculated */
  isInitialized: boolean;
  /** Trigger recalculation */
  recalculate: () => void;
  /** CSS variables for column widths */
  cssVariables: React.CSSProperties;
}

// =============================================================================
// Re-exports for backwards compatibility and testing
// =============================================================================

// From reducer module (in utils/)
export {
  sizingReducer,
  INITIAL_STATE,
  DEFAULT_COLUMN_SIZING_INFO,
  type SizingState,
  type SizingEvent,
  type ResizingContext,
} from "../utils/column-sizing-reducer";

// From constants
export type { SizingMode } from "../constants";

// From utils
export {
  calculateColumnWidths,
  getRemToPx,
  _invalidateRemToPxCache,
  getTruncationThreshold,
} from "../utils/column-sizing";

// =============================================================================
// Hook
// =============================================================================

export function useColumnSizing({
  columnIds,
  containerRef,
  tableRef,
  columnConfigs,
  sizingPreferences = {},
  onPreferenceChange,
  minSizes: minSizesProp,
  configuredSizes: configuredSizesProp,
  resizeDebounceMs = 150,
  dataLength = 0,
  isLoading = false,
}: UseColumnSizingOptions): UseColumnSizingResult {
  // =========================================================================
  // State Machine
  // =========================================================================
  const [state, dispatch] = useReducer(sizingReducer, INITIAL_STATE);

  // =========================================================================
  // Content Width Measurement State
  // Tracks measured widths for NO_TRUNCATE columns to prevent truncation
  // =========================================================================
  const [contentWidths, setContentWidths] = useState<Record<string, number>>({});
  const measuredDataLengthRef = useRef<number>(0);
  const prevPreferencesRef = useRef<ColumnSizingPreferences | undefined>(undefined);

  // =========================================================================
  // Computed Sizes (min/preferred from configs or props)
  // =========================================================================
  const { minSizes, configuredSizes } = useMemo(() => {
    const remToPxRatio = getRemToPx();
    const mins: Record<string, number> = { ...minSizesProp };
    const prefs: Record<string, number> = { ...configuredSizesProp };

    if (columnConfigs) {
      for (const config of columnConfigs) {
        if (mins[config.id] === undefined) {
          mins[config.id] = config.minWidthRem * remToPxRatio;
        }
        if (prefs[config.id] === undefined) {
          const prefRem = config.preferredWidthRem ?? config.minWidthRem * 1.5;
          prefs[config.id] = prefRem * remToPxRatio;
        }
      }
    }

    for (const id of columnIds) {
      if (mins[id] === undefined) mins[id] = 80;
      if (prefs[id] === undefined) prefs[id] = 150;
    }

    return { minSizes: mins, configuredSizes: prefs };
  }, [columnIds, columnConfigs, minSizesProp, configuredSizesProp]);

  // =========================================================================
  // Stable Refs (for callbacks that need latest values without re-creating)
  // =========================================================================
  const minSizesRef = useSyncedRef(minSizes);
  const configuredSizesRef = useSyncedRef(configuredSizes);
  const sizingPreferencesRef = useSyncedRef(sizingPreferences);
  const contentWidthsRef = useSyncedRef(contentWidths);
  const onPreferenceChangeRef = useSyncedRef(onPreferenceChange);
  const stateRef = useSyncedRef(state);

  // For tracking container width changes (avoid recalc on tiny changes)
  const lastContainerWidthRef = useRef<number>(0);
  // Track auto-fit timing (cooldown to ignore TanStack echo)
  const lastAutoFitRef = useRef<number>(0);
  // Track transition timeout for cleanup
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RAF-throttled DOM update for 60fps performance during drag
  // Optimization #2/#4: Only update the single changing column to avoid object allocation
  const [scheduleColumnUpdate, cancelColumnUpdate] = useRafCallback(
    ({ columnId, width }: { columnId: string; width: number }) => {
      const table = tableRef?.current;
      if (!table) return;
      table.style.setProperty(`--col-${columnId}`, `${width}px`);
    },
  );

  // =========================================================================
  // Side Effects - DOM updates based on state changes
  // =========================================================================

  // Effect: Update CSS variables when sizing changes
  useEffect(() => {
    const table = tableRef?.current;
    if (!table) return;

    // Only update if NOT currently resizing (RAF handles that)
    if (state.mode === SizingModes.RESIZING) return;

    for (const [colId, width] of Object.entries(state.sizing)) {
      const minWidth = minSizes[colId] ?? 0;
      const clampedWidth = Math.max(width, minWidth);
      table.style.setProperty(`--col-${colId}`, `${clampedWidth}px`);
    }
  }, [state.sizing, state.mode, tableRef, minSizes]);

  // Effect: Toggle is-resizing class
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    if (state.mode === SizingModes.RESIZING) {
      container.classList.add("is-resizing");
    } else {
      container.classList.remove("is-resizing");
    }
  }, [state.mode, containerRef]);

  // Cleanup on unmount
  useEffect(() => {
    const container = containerRef?.current;
    return () => {
      container?.classList.remove("is-resizing");
      container?.classList.remove("is-transitioning");
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    };
  }, [containerRef]);

  // =========================================================================
  // Content Width Measurement Effects
  // Measures visible cells for NO_TRUNCATE columns to set accurate floors
  // =========================================================================

  // Identify columns with NO_TRUNCATE preference
  const noTruncateColumnIds = useMemo(() => {
    return columnIds.filter((id) => {
      const pref = sizingPreferences[id];
      return pref?.mode === PreferenceModes.NO_TRUNCATE;
    });
  }, [columnIds, sizingPreferences]);

  // Measure NO_TRUNCATE columns when data arrives or changes significantly
  // Uses useIsomorphicLayoutEffect for SSR safety (runs synchronously before paint)
  useIsomorphicLayoutEffect(() => {
    const container = containerRef?.current;
    // Skip if no container, no data, still loading, or no NO_TRUNCATE columns
    if (!container || dataLength === 0 || isLoading || noTruncateColumnIds.length === 0) {
      return;
    }

    // Only remeasure if data length changed (new data loaded)
    if (measuredDataLengthRef.current === dataLength) {
      return;
    }
    measuredDataLengthRef.current = dataLength;

    // Measure each NO_TRUNCATE column using the utility function
    const newWidths = measureMultipleColumns(container, noTruncateColumnIds);

    // Batch update if we measured anything
    if (Object.keys(newWidths).length > 0) {
      setContentWidths((prev) => ({ ...prev, ...newWidths }));
    }
  }, [dataLength, isLoading, noTruncateColumnIds, containerRef]);

  // Track pending idle callback for cleanup
  const pendingIdleCallbackRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);

  // Remeasure when a column becomes NO_TRUNCATE (after user resize)
  // Uses useEffect (not layout effect) since measurement can happen after paint
  useEffect(() => {
    const container = containerRef?.current;
    const prev = prevPreferencesRef.current;
    const current = sizingPreferences;
    prevPreferencesRef.current = current;

    // Skip on first render or if no data/container
    if (!container || !prev || dataLength === 0) {
      return;
    }

    // Find columns that just became NO_TRUNCATE
    const newNoTruncateColumns: string[] = [];
    for (const columnId of columnIds) {
      const prevMode = prev[columnId]?.mode;
      const currentMode = current[columnId]?.mode;
      if (currentMode === PreferenceModes.NO_TRUNCATE && prevMode !== PreferenceModes.NO_TRUNCATE) {
        // Column just became NO_TRUNCATE - needs measurement
        // Use ref to avoid effect re-runs when contentWidths changes
        if (!contentWidthsRef.current[columnId]) {
          newNoTruncateColumns.push(columnId);
        }
      }
    }

    if (newNoTruncateColumns.length === 0) {
      return;
    }

    // Measure using requestIdleCallback for non-blocking behavior
    const measureNewColumns = () => {
      pendingIdleCallbackRef.current = null;
      const containerEl = containerRef?.current;
      if (!containerEl) return;

      const newWidths = measureMultipleColumns(containerEl, newNoTruncateColumns);
      if (Object.keys(newWidths).length > 0) {
        setContentWidths((prev) => ({ ...prev, ...newWidths }));
      }
    };

    // Schedule measurement with proper cleanup tracking
    if (typeof requestIdleCallback !== "undefined") {
      pendingIdleCallbackRef.current = requestIdleCallback(measureNewColumns, { timeout: 500 });
    } else {
      pendingIdleCallbackRef.current = setTimeout(measureNewColumns, 0);
    }

    // Cleanup: cancel pending callback on unmount or re-run
    return () => {
      if (pendingIdleCallbackRef.current !== null) {
        if (typeof cancelIdleCallback !== "undefined" && typeof pendingIdleCallbackRef.current === "number") {
          cancelIdleCallback(pendingIdleCallbackRef.current);
        } else {
          clearTimeout(pendingIdleCallbackRef.current as ReturnType<typeof setTimeout>);
        }
        pendingIdleCallbackRef.current = null;
      }
    };
  }, [sizingPreferences, columnIds, dataLength, containerRef, contentWidthsRef]);

  // =========================================================================
  // Calculate Sizing (used by INIT and CONTAINER_RESIZE)
  // Optimization #3: Accept containerWidth to avoid forced layout when available
  // =========================================================================
  const calculateAndDispatch = useStableCallback(
    (eventType: "INIT" | "CONTAINER_RESIZE", animate: boolean, providedWidth: number | undefined) => {
      const container = containerRef?.current;
      if (!container) return;

      // Use provided width (from ResizeObserver) or read (forces layout - only for INIT)
      const containerWidth = providedWidth ?? container.clientWidth;
      if (containerWidth <= 0) return;

      const sizing = calculateColumnWidths(
        columnIds,
        containerWidth,
        minSizesRef.current,
        configuredSizesRef.current,
        sizingPreferencesRef.current,
        contentWidthsRef.current,
      );

      // Debug logging (lazy to avoid allocation when disabled)
      logColumnSizingDebug(() =>
        createDebugSnapshot(
          eventType,
          {
            columnIds,
            containerRef,
            columnSizing: sizing,
            preferences: sizingPreferencesRef.current,
            minSizes: minSizesRef.current,
            configuredSizes: configuredSizesRef.current,
            isResizing: stateRef.current.mode === SizingModes.RESIZING,
            isInitialized: stateRef.current.isInitialized,
          },
          { animate, containerWidth },
        ),
      );

      // Handle animation class with proper cleanup
      if (animate && container) {
        // Cancel any pending transition timeout
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
        }
        container.classList.add("is-transitioning");
        transitionTimeoutRef.current = setTimeout(() => {
          container.classList.remove("is-transitioning");
          transitionTimeoutRef.current = null;
        }, 150);
      }

      dispatch({ type: eventType, sizing });
    },
  );

  // =========================================================================
  // Initial Sizing Effect
  // Optimization #6: Memoize columnSetKey to avoid allocation on every render
  // =========================================================================
  const columnSetKey = useMemo(() => [...columnIds].sort().join(","), [columnIds]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      calculateAndDispatch("INIT", false, undefined);
    });
    return () => cancelAnimationFrame(frame);
  }, [columnSetKey, calculateAndDispatch]);

  // =========================================================================
  // Container Resize Effect
  // Optimization #3: Pass ResizeObserver width directly to avoid forced layout
  // =========================================================================
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    lastContainerWidthRef.current = container.clientWidth;

    let timeoutId: ReturnType<typeof setTimeout>;
    let pendingWidth: number | null = null;

    const observer = new ResizeObserver((entries) => {
      // State machine handles this guard: RESIZING mode ignores CONTAINER_RESIZE
      // But we also check here to avoid unnecessary calculations
      if (stateRef.current.mode === SizingModes.RESIZING) return;

      const entry = entries[0];
      if (!entry) return;
      const newWidth = entry.contentRect.width;
      const widthDelta = Math.abs(newWidth - lastContainerWidthRef.current);
      if (widthDelta < 1) return;

      lastContainerWidthRef.current = newWidth;
      pendingWidth = newWidth; // Capture width from ResizeObserver

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        // Pass captured width directly - no forced layout!
        calculateAndDispatch("CONTAINER_RESIZE", true, pendingWidth ?? undefined);
        pendingWidth = null;
      }, resizeDebounceMs);
    });

    observer.observe(container);

    return () => {
      clearTimeout(timeoutId);
      observer.disconnect();
    };
  }, [containerRef, calculateAndDispatch, resizeDebounceMs, stateRef]);

  // =========================================================================
  // Resize Control API
  // =========================================================================

  const getDebugState = useCallback(
    () => ({
      columnIds,
      containerRef,
      columnSizing: state.sizing,
      preferences: sizingPreferencesRef.current,
      minSizes: minSizesRef.current,
      configuredSizes: configuredSizesRef.current,
      contentWidths: contentWidthsRef.current,
      isResizing: state.mode === SizingModes.RESIZING,
      isInitialized: state.isInitialized,
    }),
    [
      columnIds,
      containerRef,
      state.sizing,
      state.mode,
      state.isInitialized,
      sizingPreferencesRef,
      minSizesRef,
      configuredSizesRef,
      contentWidthsRef,
    ],
  );

  const startResize = useCallback(
    (columnId: string): number => {
      const currentSizing = stateRef.current.sizing;
      const startWidth = currentSizing[columnId] ?? 150;

      dispatch({
        type: SizingEventTypes.RESIZE_START,
        columnId,
        startWidth,
        currentSizing,
      });

      logColumnSizingDebug(() => createDebugSnapshot("RESIZE_START", getDebugState(), { columnId, startWidth }));

      return startWidth;
    },
    [stateRef, getDebugState],
  );

  const updateResize = useCallback(
    (columnId: string, newWidth: number) => {
      const minWidth = minSizesRef.current?.[columnId] ?? 0;
      const clampedWidth = Math.max(newWidth, minWidth);

      dispatch({ type: SizingEventTypes.RESIZE_MOVE, columnId, newWidth: clampedWidth });

      // RAF-throttled DOM update for 60fps
      // Optimization #4: Only pass the changing column, not the entire sizing object
      scheduleColumnUpdate({ columnId, width: clampedWidth });
    },
    [minSizesRef, scheduleColumnUpdate],
  );

  const endResize = useCallback(() => {
    cancelColumnUpdate();

    const finalSizing = stateRef.current.sizing;
    const beforeResize = stateRef.current.resizing?.beforeResize ?? {};

    dispatch({ type: SizingEventTypes.RESIZE_END });

    // IMPORTANT: Capture mode determination SYNCHRONOUSLY to avoid race conditions
    // We compute the mode now and store it, so requestIdleCallback uses the same values
    const preferencesToPersist: Array<{ columnId: string; mode: PreferenceMode; width: number }> = [];
    const changes: Record<
      string,
      { from: number; to: number; mode: string; contentWidth: number; configuredWidth: number; threshold: number }
    > = {};

    // Get container for measurement
    const container = containerRef?.current;

    // Collect newly measured widths to batch the state update
    const newlyMeasuredWidths: Record<string, number> = {};

    for (const [colId, newWidth] of Object.entries(finalSizing)) {
      const oldWidth = beforeResize[colId];
      if (oldWidth !== undefined && oldWidth !== newWidth) {
        // Get cached contentWidth, or measure now if not available
        let contentWidth = contentWidthsRef.current[colId] ?? 0;

        // If no contentWidth cached, measure it now to make accurate mode decision
        if (contentWidth === 0 && container) {
          contentWidth = measureColumnContentWidth(container, colId);
          // Collect for batched state update
          if (contentWidth > 0) {
            newlyMeasuredWidths[colId] = contentWidth;
          }
        }

        const configuredWidth = configuredSizesRef.current[colId] ?? 150;
        // Threshold is just contentWidth - if user resizes below it, they accept truncation
        const threshold = getTruncationThreshold(contentWidth);
        const mode = newWidth < threshold ? PreferenceModes.TRUNCATE : PreferenceModes.NO_TRUNCATE;

        // Store for later persistence
        preferencesToPersist.push({ columnId: colId, mode, width: newWidth });

        // Store for debug
        changes[colId] = { from: oldWidth, to: newWidth, mode, contentWidth, configuredWidth, threshold };
      }
    }

    // Batch update all newly measured content widths
    if (Object.keys(newlyMeasuredWidths).length > 0) {
      setContentWidths((prev) => ({ ...prev, ...newlyMeasuredWidths }));
    }

    // Debug logging
    logColumnSizingDebug(() =>
      createDebugSnapshot("RESIZE_END", getDebugState(), {
        changes,
        beforeResize,
        finalSizing,
      }),
    );
    flushDebugBuffer();

    // Optimization #7: Use requestIdleCallback for non-critical preference persistence
    // Mode is already determined above - we just persist the captured values
    const persistPreferences = () => {
      for (const pref of preferencesToPersist) {
        onPreferenceChangeRef.current?.(pref.columnId, { mode: pref.mode, width: pref.width });
      }
    };

    // Prefer idle callback, fall back to setTimeout for browsers without support
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(persistPreferences, { timeout: 1000 });
    } else {
      setTimeout(persistPreferences, 0);
    }
  }, [
    cancelColumnUpdate,
    stateRef,
    containerRef,
    configuredSizesRef,
    contentWidthsRef,
    onPreferenceChangeRef,
    getDebugState,
  ]);

  // =========================================================================
  // Other Actions
  // =========================================================================

  const setColumnSize = useCallback(
    (columnId: string, size: number) => {
      const minWidth = minSizesRef.current?.[columnId] ?? 0;
      const clampedSize = Math.max(size, minWidth);

      cancelColumnUpdate();
      dispatch({ type: SizingEventTypes.SET_SIZE, columnId, width: clampedSize });

      // Direct DOM update for immediate feedback
      const table = tableRef?.current;
      if (table) {
        table.style.setProperty(`--col-${columnId}`, `${clampedSize}px`);
      }
    },
    [minSizesRef, cancelColumnUpdate, tableRef],
  );

  const autoFit = useCallback(
    (columnId: string, measuredWidth: number) => {
      const minWidth = minSizesRef.current?.[columnId] ?? 0;
      const configuredWidth = configuredSizesRef.current?.[columnId] ?? 150;
      const clampedSize = Math.max(measuredWidth, minWidth);

      // Set cooldown to ignore TanStack echo events
      lastAutoFitRef.current = Date.now();

      cancelColumnUpdate();
      dispatch({ type: SizingEventTypes.AUTO_FIT, columnId, width: clampedSize });

      // Direct DOM update for immediate feedback
      const table = tableRef?.current;
      if (table) {
        table.style.setProperty(`--col-${columnId}`, `${clampedSize}px`);
      }

      logColumnSizingDebug(() =>
        createDebugSnapshot("AUTO_FIT", getDebugState(), {
          columnId,
          measuredWidth,
          clampedSize,
          minWidth,
          configuredWidth,
        }),
      );

      // Cache measured content width internally
      setContentWidths((prev) => {
        if (prev[columnId] === clampedSize) return prev;
        return { ...prev, [columnId]: clampedSize };
      });

      // Persist preference synchronously to avoid race conditions
      // Unlike resize end, auto-fit is a discrete action that should complete immediately
      onPreferenceChangeRef.current?.(columnId, {
        mode: PreferenceModes.NO_TRUNCATE,
        width: clampedSize,
      });
    },
    [minSizesRef, configuredSizesRef, cancelColumnUpdate, tableRef, onPreferenceChangeRef, getDebugState],
  );

  const recalculate = useStableCallback(() => {
    calculateAndDispatch("INIT", false, undefined);
  });

  // =========================================================================
  // TanStack Compatibility Handlers
  // =========================================================================

  const onColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
      // Cooldown after autoFit/resize - ignore TanStack echo events
      // This prevents TanStack from overwriting the width we just set
      const AUTO_FIT_COOLDOWN_MS = 100;
      const timeSinceAutoFit = Date.now() - lastAutoFitRef.current;
      if (timeSinceAutoFit < AUTO_FIT_COOLDOWN_MS) {
        return; // Ignore TanStack update during cooldown
      }

      const currentSizing = stateRef.current.sizing;
      const newSizing = typeof updater === "function" ? updater(currentSizing) : updater;

      dispatch({ type: SizingEventTypes.TANSTACK_SIZING_CHANGE, sizing: newSizing });

      // Find changed columns for logging and DOM updates
      const changedColumns: Record<string, { from: number | undefined; to: number }> = {};
      for (const [columnId, width] of Object.entries(newSizing)) {
        if (currentSizing[columnId] !== width) {
          changedColumns[columnId] = { from: currentSizing[columnId], to: width };
        }
      }

      // During resize, also update DOM via RAF
      // Update only changed columns to match new scheduleColumnUpdate signature
      if (stateRef.current.mode === "RESIZING") {
        for (const columnId of Object.keys(changedColumns)) {
          scheduleColumnUpdate({ columnId, width: newSizing[columnId] });
        }
      }
    },
    [stateRef, scheduleColumnUpdate],
  );

  const onColumnSizingInfoChange = useCallback(
    (updater: ColumnSizingInfoState | ((old: ColumnSizingInfoState) => ColumnSizingInfoState)) => {
      const currentInfo = stateRef.current.columnSizingInfo;
      const newInfo = typeof updater === "function" ? updater(currentInfo) : updater;

      dispatch({ type: SizingEventTypes.TANSTACK_INFO_CHANGE, info: newInfo });
    },
    [stateRef],
  );

  // =========================================================================
  // CSS Variables (memoized for stable reference)
  // =========================================================================

  const cssVariables = useMemo((): React.CSSProperties => {
    const vars: Record<string, string> = {};
    for (const colId of columnIds) {
      const rawWidth = state.sizing[colId] ?? 150;
      const minWidth = minSizes?.[colId] ?? 0;
      const width = Math.max(rawWidth, minWidth);
      vars[`--col-${colId}`] = `${width}px`;
    }
    return vars as React.CSSProperties;
  }, [state.sizing, columnIds, minSizes]);

  // =========================================================================
  // Return API
  // =========================================================================

  return {
    columnSizing: state.sizing,
    onColumnSizingChange,
    columnSizingInfo: state.columnSizingInfo,
    onColumnSizingInfoChange,
    startResize,
    updateResize,
    endResize,
    setColumnSize,
    autoFit,
    isInitialized: state.isInitialized,
    recalculate,
    cssVariables,
  };
}
