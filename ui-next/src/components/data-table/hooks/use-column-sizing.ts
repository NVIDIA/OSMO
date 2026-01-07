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
import { SizingModes, SizingEventTypes, PreferenceModes, assertNever, type SizingMode } from "../constants";

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
  /**
   * Measured content widths per column (in pixels).
   * Used as floor for NO_TRUNCATE mode to prevent content truncation.
   * These are computed values, not user preferences.
   */
  contentWidths?: Record<string, number>;
  /** Callback when auto-fit measures a column's content width */
  onContentWidthChange?: (columnId: string, contentWidth: number) => void;
  /** Minimum sizes per column (in pixels) */
  minSizes?: Record<string, number>;
  /** Configured/default sizes per column (in pixels, from column config) */
  configuredSizes?: Record<string, number>;
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
// State Machine Types (Exported for testing)
// =============================================================================

// Re-export SizingMode from constants for backwards compatibility
export type { SizingMode } from "../constants";

export interface ResizingContext {
  columnId: string;
  startWidth: number;
  beforeResize: ColumnSizingState;
}

export interface SizingState {
  mode: SizingMode;
  sizing: ColumnSizingState;
  isInitialized: boolean;
  columnSizingInfo: ColumnSizingInfoState;
  // Only present when mode === 'RESIZING'
  resizing: ResizingContext | null;
}

export type SizingEvent =
  | { type: typeof SizingEventTypes.INIT; sizing: ColumnSizingState }
  | { type: typeof SizingEventTypes.CONTAINER_RESIZE; sizing: ColumnSizingState }
  | {
      type: typeof SizingEventTypes.RESIZE_START;
      columnId: string;
      startWidth: number;
      currentSizing: ColumnSizingState;
    }
  | { type: typeof SizingEventTypes.RESIZE_MOVE; columnId: string; newWidth: number }
  | { type: typeof SizingEventTypes.RESIZE_END }
  | { type: typeof SizingEventTypes.AUTO_FIT; columnId: string; width: number }
  | { type: typeof SizingEventTypes.SET_SIZE; columnId: string; width: number }
  | { type: typeof SizingEventTypes.TANSTACK_SIZING_CHANGE; sizing: ColumnSizingState }
  | { type: typeof SizingEventTypes.TANSTACK_INFO_CHANGE; info: ColumnSizingInfoState };

// =============================================================================
// Constants (Exported for testing)
// =============================================================================

export const DEFAULT_COLUMN_SIZING_INFO: ColumnSizingInfoState = {
  startOffset: null,
  startSize: null,
  deltaOffset: null,
  deltaPercentage: null,
  isResizingColumn: false,
  columnSizingStart: [],
};

export const INITIAL_STATE: SizingState = {
  mode: SizingModes.IDLE,
  sizing: {},
  isInitialized: false,
  columnSizingInfo: DEFAULT_COLUMN_SIZING_INFO,
  resizing: null,
};

// =============================================================================
// Module-Level rem-to-px Cache
// Optimization #1: Avoids forced layout on every useMemo recompute
// Invalidates automatically on browser zoom changes
// =============================================================================

let _remToPxCache: number | null = null;

// SSR-safe: only set up listener in browser with matchMedia support
if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  // matchMedia with resolution query fires on zoom changes
  window.matchMedia("(resolution: 1dppx)").addEventListener("change", () => {
    _remToPxCache = null;
  });
}

// =============================================================================
// Pure Functions (Exported for testing)
// =============================================================================

/**
 * Get the current rem-to-px ratio.
 * Cached at module level; invalidated on browser zoom.
 */
export function getRemToPx(): number {
  if (typeof document === "undefined") return 16;

  if (_remToPxCache !== null) return _remToPxCache;

  try {
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    _remToPxCache = fontSize > 0 ? fontSize : 16;
    return _remToPxCache;
  } catch {
    return 16;
  }
}

/**
 * Invalidate the rem-to-px cache. Exposed for testing.
 * @internal
 */
export function _invalidateRemToPxCache(): void {
  _remToPxCache = null;
}

/**
 * Calculate column widths based on container width and preferences.
 * Pure function - no side effects.
 *
 * Algorithm:
 * 1. Each column has: min (absolute floor), target (preferred), floor (mode-dependent)
 * 2. If container >= totalTarget: distribute surplus proportionally
 * 3. If container >= totalFloor but < totalTarget: shrink columns with "give" (target - floor)
 * 4. If container < totalFloor: all columns at floor (overflow, scrollable)
 */
export function calculateColumnWidths(
  columnIds: string[],
  containerWidth: number,
  minSizes: Record<string, number>,
  configuredSizes: Record<string, number>,
  preferences: ColumnSizingPreferences,
  contentWidths: Record<string, number> = {},
): ColumnSizingState {
  if (columnIds.length === 0 || containerWidth <= 0) {
    return {};
  }

  const columns = columnIds.map((id) => {
    const min = minSizes[id] ?? 80;
    const configuredWidth = configuredSizes[id] ?? min * 1.5;
    const pref = preferences[id];
    const contentWidth = contentWidths[id];

    let target: number;
    let floor: number;

    if (pref) {
      switch (pref.mode) {
        case PreferenceModes.NO_TRUNCATE: {
          // Use contentWidth (measured) as floor to prevent truncation
          // Fall back to pref.width if contentWidth not available
          const measuredWidth = contentWidth ?? pref.width;
          floor = Math.max(measuredWidth, min);
          break;
        }
        case PreferenceModes.TRUNCATE:
          floor = Math.max(pref.width, min);
          break;
        default:
          assertNever(pref.mode);
      }
      target = pref.width;
    } else {
      floor = min;
      target = configuredWidth;
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
// Reducer Helpers - Structural sharing to avoid unnecessary object creation
// =============================================================================

/**
 * Update a single column's width with structural sharing.
 * Returns the same object reference if the value hasn't changed.
 */
function updateSizing(sizing: ColumnSizingState, columnId: string, width: number): ColumnSizingState {
  if (sizing[columnId] === width) return sizing; // No change - structural sharing
  return { ...sizing, [columnId]: width };
}

// =============================================================================
// Reducer - All state transitions in one place (Exported for testing)
// =============================================================================

export function sizingReducer(state: SizingState, event: SizingEvent): SizingState {
  switch (state.mode) {
    // =========================================================================
    // IDLE Mode
    // =========================================================================
    case SizingModes.IDLE:
      switch (event.type) {
        case SizingEventTypes.INIT:
          return {
            ...state,
            sizing: event.sizing,
            isInitialized: true,
          };

        case SizingEventTypes.CONTAINER_RESIZE:
          return {
            ...state,
            sizing: event.sizing,
          };

        case SizingEventTypes.RESIZE_START:
          return {
            ...state,
            mode: SizingModes.RESIZING,
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

        case SizingEventTypes.AUTO_FIT: {
          const newSizing = updateSizing(state.sizing, event.columnId, event.width);
          if (newSizing === state.sizing) return state;
          return { ...state, sizing: newSizing };
        }

        case SizingEventTypes.SET_SIZE: {
          const newSizing = updateSizing(state.sizing, event.columnId, event.width);
          if (newSizing === state.sizing) return state;
          return { ...state, sizing: newSizing };
        }

        case SizingEventTypes.TANSTACK_SIZING_CHANGE:
          return {
            ...state,
            sizing: event.sizing,
          };

        case SizingEventTypes.TANSTACK_INFO_CHANGE:
          // TanStack might start resize via its own handler
          if (!state.columnSizingInfo.isResizingColumn && event.info.isResizingColumn) {
            const columnId = String(event.info.isResizingColumn);
            return {
              ...state,
              mode: SizingModes.RESIZING,
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
        case SizingEventTypes.RESIZE_MOVE:
        case SizingEventTypes.RESIZE_END:
          return state;

        default:
          // Exhaustive check - TypeScript will error if any case is missing
          return assertNever(event);
      }

    // =========================================================================
    // RESIZING Mode
    // =========================================================================
    case SizingModes.RESIZING:
      switch (event.type) {
        case SizingEventTypes.RESIZE_MOVE: {
          const newSizing = updateSizing(state.sizing, event.columnId, event.newWidth);
          if (newSizing === state.sizing) return state;
          return { ...state, sizing: newSizing };
        }

        case SizingEventTypes.RESIZE_END:
          return {
            ...state,
            mode: SizingModes.IDLE,
            resizing: null,
            columnSizingInfo: DEFAULT_COLUMN_SIZING_INFO,
          };

        case SizingEventTypes.TANSTACK_SIZING_CHANGE:
          // During resize, accept sizing updates from TanStack
          return {
            ...state,
            sizing: event.sizing,
          };

        case SizingEventTypes.TANSTACK_INFO_CHANGE:
          // TanStack might end resize via its own handler
          if (state.columnSizingInfo.isResizingColumn && !event.info.isResizingColumn) {
            return {
              ...state,
              mode: SizingModes.IDLE,
              resizing: null,
              columnSizingInfo: event.info,
            };
          }
          return { ...state, columnSizingInfo: event.info };

        // CRITICAL: These events are IGNORED during resize
        // This IS the guard - encoded in the structure
        case SizingEventTypes.INIT:
        case SizingEventTypes.CONTAINER_RESIZE:
        case SizingEventTypes.AUTO_FIT:
        case SizingEventTypes.SET_SIZE:
        case SizingEventTypes.RESIZE_START:
          return state;

        default:
          // Exhaustive check - TypeScript will error if any case is missing
          return assertNever(event);
      }

    default:
      // Exhaustive check for state.mode
      return assertNever(state.mode);
  }
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
  contentWidths: contentWidthsProp = {},
  onContentWidthChange,
  minSizes: minSizesProp,
  configuredSizes: configuredSizesProp,
  resizeDebounceMs = 150,
}: UseColumnSizingOptions): UseColumnSizingResult {
  // =========================================================================
  // State Machine
  // =========================================================================
  const [state, dispatch] = useReducer(sizingReducer, INITIAL_STATE);

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
  const minSizesRef = useStableValue(minSizes);
  const configuredSizesRef = useStableValue(configuredSizes);
  const sizingPreferencesRef = useStableValue(sizingPreferences);
  const contentWidthsRef = useStableValue(contentWidthsProp);
  const onPreferenceChangeRef = useStableValue(onPreferenceChange);
  const onContentWidthChangeRef = useStableValue(onContentWidthChange);
  const stateRef = useStableValue(state);

  // For tracking resize timing (cooldown after resize ends)
  const lastResizeEndRef = useRef<number>(0);
  const lastContainerWidthRef = useRef<number>(0);
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
    const RESIZE_COOLDOWN_MS = 300;

    const observer = new ResizeObserver((entries) => {
      // State machine handles this guard: RESIZING mode ignores CONTAINER_RESIZE
      // But we also check here to avoid unnecessary calculations
      if (stateRef.current.mode === SizingModes.RESIZING) return;

      const timeSinceResizeEnd = Date.now() - lastResizeEndRef.current;
      if (timeSinceResizeEnd < RESIZE_COOLDOWN_MS) return;

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
    lastResizeEndRef.current = Date.now();

    const finalSizing = stateRef.current.sizing;
    const beforeResize = stateRef.current.resizing?.beforeResize ?? {};

    dispatch({ type: SizingEventTypes.RESIZE_END });

    // Debug logging (lazy computation)
    logColumnSizingDebug(() => {
      const changes: Record<string, { from: number; to: number; mode: string }> = {};
      for (const [colId, newWidth] of Object.entries(finalSizing)) {
        const oldWidth = beforeResize[colId];
        if (oldWidth !== undefined && oldWidth !== newWidth) {
          const configuredWidth = configuredSizesRef.current[colId] ?? 150;
          const mode = newWidth < configuredWidth ? PreferenceModes.TRUNCATE : PreferenceModes.NO_TRUNCATE;
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

    // Optimization #7: Use requestIdleCallback for non-critical preference persistence
    // This moves localStorage writes out of the critical path
    const persistPreferences = () => {
      for (const [colId, newWidth] of Object.entries(finalSizing)) {
        const oldWidth = beforeResize[colId];
        if (oldWidth !== undefined && oldWidth !== newWidth) {
          const configuredWidth = configuredSizesRef.current[colId] ?? 150;
          const mode = newWidth < configuredWidth ? PreferenceModes.TRUNCATE : PreferenceModes.NO_TRUNCATE;
          onPreferenceChangeRef.current?.(colId, { mode, width: newWidth });
        }
      }
    };

    // Prefer idle callback, fall back to setTimeout for browsers without support
    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(persistPreferences, { timeout: 1000 });
    } else {
      setTimeout(persistPreferences, 0);
    }
  }, [cancelColumnUpdate, stateRef, configuredSizesRef, onPreferenceChangeRef, getDebugState]);

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

      // Optimization #7: Use requestIdleCallback for non-critical persistence
      const persist = () => {
        // Report measured content width (separate from preference)
        onContentWidthChangeRef.current?.(columnId, clampedSize);
        // Save preference as "no-truncate" - user wants full content
        onPreferenceChangeRef.current?.(columnId, {
          mode: PreferenceModes.NO_TRUNCATE,
          width: clampedSize,
        });
      };

      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(persist, { timeout: 1000 });
      } else {
        setTimeout(persist, 0);
      }
    },
    [
      minSizesRef,
      configuredSizesRef,
      cancelColumnUpdate,
      tableRef,
      onPreferenceChangeRef,
      onContentWidthChangeRef,
      getDebugState,
    ],
  );

  const recalculate = useStableCallback(() => {
    calculateAndDispatch("INIT", false, undefined);
  });

  // =========================================================================
  // TanStack Compatibility Handlers
  // =========================================================================

  const onColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
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
