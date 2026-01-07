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
 * Column Sizing Hook - State Machine Architecture
 *
 * This hook uses a state machine pattern for clarity and correctness:
 *
 * ## States
 * - IDLE: No active user interaction
 * - RESIZING: User is actively dragging a column resize handle
 *
 * ## Events
 * - INIT: Initial sizing calculation
 * - CONTAINER_RESIZE: Container width changed
 * - RESIZE_START: User started dragging
 * - RESIZE_MOVE: User is dragging
 * - RESIZE_END: User finished dragging
 * - AUTO_FIT: Double-click to fit content
 * - SET_SIZE: Programmatic size change
 *
 * ## State Machine Diagram
 * ```
 * ┌─────────────────────────────────────────────────────────────┐
 * │                        IDLE                                 │
 * │  Responds to: INIT, CONTAINER_RESIZE, RESIZE_START,         │
 * │               AUTO_FIT, SET_SIZE                            │
 * │  Ignores:     RESIZE_MOVE, RESIZE_END                       │
 * └──────────────────────────┬──────────────────────────────────┘
 *                            │ RESIZE_START
 *                            ▼
 * ┌─────────────────────────────────────────────────────────────┐
 * │                       RESIZING                              │
 * │  Responds to: RESIZE_MOVE, RESIZE_END                       │
 * │  Ignores:     INIT, CONTAINER_RESIZE, AUTO_FIT, SET_SIZE,   │
 * │               RESIZE_START                                  │
 * └──────────────────────────┬──────────────────────────────────┘
 *                            │ RESIZE_END
 *                            ▼
 *                          IDLE
 * ```
 *
 * @see https://tanstack.com/table/v8/docs/guide/column-sizing
 */

import { useCallback, useRef, useMemo, useEffect, useReducer } from "react";
import type { ColumnSizingState, ColumnSizingInfoState } from "@tanstack/react-table";
import { useStableCallback, useStableValue, useRafCallback } from "@/hooks";
import type { ColumnSizingPreference, ColumnSizingPreferences } from "@/stores/types";
import type { ColumnSizeConfig } from "../types";
import { logColumnSizingDebug, createDebugSnapshot, flushDebugBuffer } from "../utils/debug";

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
  /** Preferred sizes per column (in pixels) */
  preferredSizes?: Record<string, number>;
  /** Debounce delay for resize observer (ms) */
  resizeDebounceMs?: number;
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
// State Machine Types
// =============================================================================

type SizingMode = "IDLE" | "RESIZING";

interface ResizingContext {
  columnId: string;
  startWidth: number;
  beforeResize: ColumnSizingState;
}

interface SizingState {
  mode: SizingMode;
  sizing: ColumnSizingState;
  isInitialized: boolean;
  columnSizingInfo: ColumnSizingInfoState;
  // Only present when mode === 'RESIZING'
  resizing: ResizingContext | null;
}

type SizingEvent =
  | { type: "INIT"; sizing: ColumnSizingState }
  | { type: "CONTAINER_RESIZE"; sizing: ColumnSizingState }
  | { type: "RESIZE_START"; columnId: string; startWidth: number; currentSizing: ColumnSizingState }
  | { type: "RESIZE_MOVE"; columnId: string; newWidth: number }
  | { type: "RESIZE_END" }
  | { type: "AUTO_FIT"; columnId: string; width: number }
  | { type: "SET_SIZE"; columnId: string; width: number }
  | { type: "TANSTACK_SIZING_CHANGE"; sizing: ColumnSizingState }
  | { type: "TANSTACK_INFO_CHANGE"; info: ColumnSizingInfoState };

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_COLUMN_SIZING_INFO: ColumnSizingInfoState = {
  startOffset: null,
  startSize: null,
  deltaOffset: null,
  deltaPercentage: null,
  isResizingColumn: false,
  columnSizingStart: [],
};

const INITIAL_STATE: SizingState = {
  mode: "IDLE",
  sizing: {},
  isInitialized: false,
  columnSizingInfo: DEFAULT_COLUMN_SIZING_INFO,
  resizing: null,
};

// =============================================================================
// Pure Functions
// =============================================================================

function getRemToPx(): number {
  if (typeof document === "undefined") return 16;
  try {
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return fontSize > 0 ? fontSize : 16;
  } catch {
    return 16;
  }
}

/**
 * Calculate column widths based on container width and preferences.
 * Pure function - no side effects.
 */
function calculateColumnWidths(
  columnIds: string[],
  containerWidth: number,
  minSizes: Record<string, number>,
  preferredSizes: Record<string, number>,
  preferences: ColumnSizingPreferences,
): ColumnSizingState {
  if (columnIds.length === 0 || containerWidth <= 0) {
    return {};
  }

  const columns = columnIds.map((id) => {
    const min = minSizes[id] ?? 80;
    const configPreferred = preferredSizes[id] ?? min * 1.5;
    const pref = preferences[id];

    let target: number;
    let floor: number;

    if (pref) {
      if (pref.mode === "no-truncate") {
        floor = Math.max(configPreferred, min);
        target = Math.max(pref.width, floor);
      } else {
        floor = Math.max(pref.width, min);
        target = floor;
      }
    } else {
      floor = min;
      target = configPreferred;
    }

    target = Math.max(target, min);
    floor = Math.max(floor, min);

    return { id, min, target, floor };
  });

  const totalTarget = columns.reduce((sum, c) => sum + c.target, 0);
  const totalFloor = columns.reduce((sum, c) => sum + c.floor, 0);

  // Case 1: Container fits all targets
  if (containerWidth >= totalTarget) {
    const surplus = containerWidth - totalTarget;
    if (surplus > 0 && totalTarget > 0) {
      const result: ColumnSizingState = {};
      for (const c of columns) {
        const shareOfSurplus = (c.target / totalTarget) * surplus;
        result[c.id] = c.target + shareOfSurplus;
      }
      return result;
    }
    return Object.fromEntries(columns.map((c) => [c.id, c.target]));
  }

  // Case 2: Container smaller than targets but larger than floors
  if (containerWidth >= totalFloor) {
    const deficit = totalTarget - containerWidth;
    const columnsWithGive = columns.map((c) => ({
      ...c,
      give: Math.max(0, c.target - c.floor),
    }));

    const totalGive = columnsWithGive.reduce((sum, c) => sum + c.give, 0);
    if (totalGive <= 0) {
      return Object.fromEntries(columnsWithGive.map((c) => [c.id, c.floor]));
    }

    const shrinkRatio = Math.min(1, deficit / totalGive);
    const result: ColumnSizingState = {};
    for (const c of columnsWithGive) {
      const shrinkAmount = c.give * shrinkRatio;
      result[c.id] = Math.max(c.floor, c.target - shrinkAmount);
    }
    return result;
  }

  // Case 3: Container smaller than total floors
  return Object.fromEntries(columns.map((c) => [c.id, c.floor]));
}

// =============================================================================
// Reducer - All state transitions in one place
// =============================================================================

function sizingReducer(state: SizingState, event: SizingEvent): SizingState {
  switch (state.mode) {
    // =========================================================================
    // IDLE Mode
    // =========================================================================
    case "IDLE":
      switch (event.type) {
        case "INIT":
          return {
            ...state,
            sizing: event.sizing,
            isInitialized: true,
          };

        case "CONTAINER_RESIZE":
          return {
            ...state,
            sizing: event.sizing,
          };

        case "RESIZE_START":
          return {
            ...state,
            mode: "RESIZING",
            resizing: {
              columnId: event.columnId,
              startWidth: event.startWidth,
              beforeResize: event.currentSizing,
            },
            columnSizingInfo: {
              startOffset: 0,
              startSize: event.startWidth,
              deltaOffset: 0,
              deltaPercentage: 0,
              isResizingColumn: event.columnId,
              columnSizingStart: [[event.columnId, event.startWidth]],
            },
          };

        case "AUTO_FIT":
          return {
            ...state,
            sizing: { ...state.sizing, [event.columnId]: event.width },
          };

        case "SET_SIZE":
          return {
            ...state,
            sizing: { ...state.sizing, [event.columnId]: event.width },
          };

        case "TANSTACK_SIZING_CHANGE":
          return {
            ...state,
            sizing: event.sizing,
          };

        case "TANSTACK_INFO_CHANGE":
          // TanStack might start resize via its own handler
          if (!state.columnSizingInfo.isResizingColumn && event.info.isResizingColumn) {
            const columnId = String(event.info.isResizingColumn);
            return {
              ...state,
              mode: "RESIZING",
              columnSizingInfo: event.info,
              resizing: {
                columnId,
                startWidth: state.sizing[columnId] ?? 150,
                beforeResize: { ...state.sizing },
              },
            };
          }
          return { ...state, columnSizingInfo: event.info };

        // Invalid events in IDLE - no-op
        case "RESIZE_MOVE":
        case "RESIZE_END":
          return state;
      }
      break;

    // =========================================================================
    // RESIZING Mode
    // =========================================================================
    case "RESIZING":
      switch (event.type) {
        case "RESIZE_MOVE":
          return {
            ...state,
            sizing: { ...state.sizing, [event.columnId]: event.newWidth },
          };

        case "RESIZE_END":
          return {
            ...state,
            mode: "IDLE",
            resizing: null,
            columnSizingInfo: DEFAULT_COLUMN_SIZING_INFO,
          };

        case "TANSTACK_SIZING_CHANGE":
          // During resize, accept sizing updates from TanStack
          return {
            ...state,
            sizing: event.sizing,
          };

        case "TANSTACK_INFO_CHANGE":
          // TanStack might end resize via its own handler
          if (state.columnSizingInfo.isResizingColumn && !event.info.isResizingColumn) {
            return {
              ...state,
              mode: "IDLE",
              resizing: null,
              columnSizingInfo: event.info,
            };
          }
          return { ...state, columnSizingInfo: event.info };

        // CRITICAL: These events are IGNORED during resize
        // This IS the guard - encoded in the structure
        case "INIT":
        case "CONTAINER_RESIZE":
        case "AUTO_FIT":
        case "SET_SIZE":
        case "RESIZE_START":
          return state;
      }
      break;
  }

  return state;
}

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
  preferredSizes: preferredSizesProp,
  resizeDebounceMs = 150,
}: UseColumnSizingOptions): UseColumnSizingResult {
  // =========================================================================
  // State Machine
  // =========================================================================
  const [state, dispatch] = useReducer(sizingReducer, INITIAL_STATE);

  // =========================================================================
  // Computed Sizes (min/preferred from configs or props)
  // =========================================================================
  const { minSizes, preferredSizes } = useMemo(() => {
    const remToPxRatio = getRemToPx();
    const mins: Record<string, number> = { ...minSizesProp };
    const prefs: Record<string, number> = { ...preferredSizesProp };

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

    return { minSizes: mins, preferredSizes: prefs };
  }, [columnIds, columnConfigs, minSizesProp, preferredSizesProp]);

  // =========================================================================
  // Stable Refs (for callbacks that need latest values without re-creating)
  // =========================================================================
  const minSizesRef = useStableValue(minSizes);
  const preferredSizesRef = useStableValue(preferredSizes);
  const sizingPreferencesRef = useStableValue(sizingPreferences);
  const onPreferenceChangeRef = useStableValue(onPreferenceChange);
  const stateRef = useStableValue(state);

  // For tracking resize timing (cooldown after resize ends)
  const lastResizeEndRef = useRef<number>(0);
  const lastContainerWidthRef = useRef<number>(0);
  // Track transition timeout for cleanup
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RAF-throttled DOM update for 60fps performance during drag
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
  // Side Effects - DOM updates based on state changes
  // =========================================================================

  // Effect: Update CSS variables when sizing changes
  useEffect(() => {
    const table = tableRef?.current;
    if (!table) return;

    // Only update if NOT currently resizing (RAF handles that)
    if (state.mode === "RESIZING") return;

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

    if (state.mode === "RESIZING") {
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
  // Calculate Sizing (used by INIT and CONTAINER_RESIZE)
  // =========================================================================
  const calculateAndDispatch = useStableCallback((eventType: "INIT" | "CONTAINER_RESIZE", animate: boolean) => {
    const container = containerRef?.current;
    if (!container) return;

    const containerWidth = container.clientWidth;
    if (containerWidth <= 0) return;

    const sizing = calculateColumnWidths(
      columnIds,
      containerWidth,
      minSizesRef.current,
      preferredSizesRef.current,
      sizingPreferencesRef.current,
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
          preferredSizes: preferredSizesRef.current,
          isResizing: stateRef.current.mode === "RESIZING",
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
  });

  // =========================================================================
  // Initial Sizing Effect
  // =========================================================================
  const columnSetKey = [...columnIds].sort().join(",");

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      calculateAndDispatch("INIT", false);
    });
    return () => cancelAnimationFrame(frame);
  }, [columnSetKey, calculateAndDispatch]);

  // =========================================================================
  // Container Resize Effect
  // =========================================================================
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    lastContainerWidthRef.current = container.clientWidth;

    let timeoutId: ReturnType<typeof setTimeout>;
    const RESIZE_COOLDOWN_MS = 300;

    const observer = new ResizeObserver((entries) => {
      // State machine handles this guard: RESIZING mode ignores CONTAINER_RESIZE
      // But we also check here to avoid unnecessary calculations
      if (stateRef.current.mode === "RESIZING") return;

      const timeSinceResizeEnd = Date.now() - lastResizeEndRef.current;
      if (timeSinceResizeEnd < RESIZE_COOLDOWN_MS) return;

      const entry = entries[0];
      if (!entry) return;
      const newWidth = entry.contentRect.width;
      const widthDelta = Math.abs(newWidth - lastContainerWidthRef.current);
      if (widthDelta < 1) return;

      lastContainerWidthRef.current = newWidth;

      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        calculateAndDispatch("CONTAINER_RESIZE", true);
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
      preferredSizes: preferredSizesRef.current,
      isResizing: state.mode === "RESIZING",
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
      preferredSizesRef,
    ],
  );

  const startResize = useCallback(
    (columnId: string): number => {
      const currentSizing = stateRef.current.sizing;
      const startWidth = currentSizing[columnId] ?? 150;

      dispatch({
        type: "RESIZE_START",
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

      dispatch({ type: "RESIZE_MOVE", columnId, newWidth: clampedWidth });

      // RAF-throttled DOM update for 60fps
      scheduleColumnUpdate({ ...stateRef.current.sizing, [columnId]: clampedWidth });
    },
    [minSizesRef, scheduleColumnUpdate, stateRef],
  );

  const endResize = useCallback(() => {
    cancelColumnUpdate();
    lastResizeEndRef.current = Date.now();

    const finalSizing = stateRef.current.sizing;
    const beforeResize = stateRef.current.resizing?.beforeResize ?? {};

    dispatch({ type: "RESIZE_END" });

    // Debug logging (lazy computation)
    logColumnSizingDebug(() => {
      const changes: Record<string, { from: number; to: number; mode: string }> = {};
      for (const [colId, newWidth] of Object.entries(finalSizing)) {
        const oldWidth = beforeResize[colId];
        if (oldWidth !== undefined && oldWidth !== newWidth) {
          const preferredWidth = preferredSizesRef.current[colId] ?? 150;
          const mode = newWidth < preferredWidth ? "truncate" : "no-truncate";
          changes[colId] = { from: oldWidth, to: newWidth, mode };
        }
      }
      return createDebugSnapshot("RESIZE_END", getDebugState(), {
        changes,
        beforeResize,
        finalSizing,
      });
    });
    flushDebugBuffer();

    // Detect and persist preferences
    queueMicrotask(() => {
      for (const [colId, newWidth] of Object.entries(finalSizing)) {
        const oldWidth = beforeResize[colId];
        if (oldWidth !== undefined && oldWidth !== newWidth) {
          const preferredWidth = preferredSizesRef.current[colId] ?? 150;
          const mode: "truncate" | "no-truncate" = newWidth < preferredWidth ? "truncate" : "no-truncate";
          onPreferenceChangeRef.current?.(colId, { mode, width: newWidth });
        }
      }
    });
  }, [cancelColumnUpdate, stateRef, preferredSizesRef, onPreferenceChangeRef, getDebugState]);

  // =========================================================================
  // Other Actions
  // =========================================================================

  const setColumnSize = useCallback(
    (columnId: string, size: number) => {
      const minWidth = minSizesRef.current?.[columnId] ?? 0;
      const clampedSize = Math.max(size, minWidth);

      cancelColumnUpdate();
      dispatch({ type: "SET_SIZE", columnId, width: clampedSize });

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
      const clampedSize = Math.max(measuredWidth, minWidth);

      cancelColumnUpdate();
      dispatch({ type: "AUTO_FIT", columnId, width: clampedSize });

      // Direct DOM update for immediate feedback
      const table = tableRef?.current;
      if (table) {
        table.style.setProperty(`--col-${columnId}`, `${clampedSize}px`);
      }

      // Save preference as "no-truncate" - user explicitly wants full content
      queueMicrotask(() => {
        onPreferenceChangeRef.current?.(columnId, { mode: "no-truncate", width: clampedSize });
      });
    },
    [minSizesRef, cancelColumnUpdate, tableRef, onPreferenceChangeRef],
  );

  const recalculate = useStableCallback(() => {
    calculateAndDispatch("INIT", false);
  });

  // =========================================================================
  // TanStack Compatibility Handlers
  // =========================================================================

  const onColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
      const currentSizing = stateRef.current.sizing;
      const newSizing = typeof updater === "function" ? updater(currentSizing) : updater;

      dispatch({ type: "TANSTACK_SIZING_CHANGE", sizing: newSizing });

      // During resize, also update DOM via RAF
      if (stateRef.current.mode === "RESIZING") {
        scheduleColumnUpdate(newSizing);
      }
    },
    [stateRef, scheduleColumnUpdate],
  );

  const onColumnSizingInfoChange = useCallback(
    (updater: ColumnSizingInfoState | ((old: ColumnSizingInfoState) => ColumnSizingInfoState)) => {
      const currentInfo = stateRef.current.columnSizingInfo;
      const newInfo = typeof updater === "function" ? updater(currentInfo) : updater;

      dispatch({ type: "TANSTACK_INFO_CHANGE", info: newInfo });
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
