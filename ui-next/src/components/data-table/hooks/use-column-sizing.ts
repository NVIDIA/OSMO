// SPDX-FileCopyrightText: Copyright (c) 2024-2026 NVIDIA CORPORATION. All rights reserved.
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

import { useCallback, useRef, useMemo, useEffect, useState } from "react";
import type { ColumnSizingState, ColumnSizingInfoState } from "@tanstack/react-table";
import { useSyncedRef, useIsomorphicLayoutEffect, useRafCallback, usePrevious } from "@react-hookz/web";
import { useEventCallback } from "usehooks-ts";
import type { ColumnSizingPreference, ColumnSizingPreferences } from "@/stores";
import type { ColumnSizeConfig } from "../types";
import {
  measureColumnContentWidth,
  measureMultipleColumns,
  calculateColumnWidths,
  getTruncationThreshold,
  getRemToPx,
} from "../utils/column-sizing";
import { PreferenceModes, type PreferenceMode } from "../constants";

export interface UseColumnSizingOptions {
  columnIds: string[];
  containerRef?: React.RefObject<HTMLElement | null>;
  tableRef?: React.RefObject<HTMLTableElement | null>;
  columnConfigs?: readonly ColumnSizeConfig[];
  sizingPreferences?: ColumnSizingPreferences;
  onPreferenceChange?: (columnId: string, preference: ColumnSizingPreference) => void;
  minSizes?: Record<string, number>;
  configuredSizes?: Record<string, number>;
  resizeDebounceMs?: number;
  dataLength?: number;
  isLoading?: boolean;
}

export interface UseColumnSizingResult {
  columnSizing: ColumnSizingState;
  onColumnSizingChange: (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => void;
  columnSizingInfo: ColumnSizingInfoState;
  onColumnSizingInfoChange: (
    updater: ColumnSizingInfoState | ((old: ColumnSizingInfoState) => ColumnSizingInfoState),
  ) => void;
  startResize: (columnId: string) => number;
  updateResize: (columnId: string, newWidth: number) => void;
  endResize: () => void;
  setColumnSize: (columnId: string, size: number) => void;
  autoFit: (columnId: string, measuredWidth: number) => void;
  isInitialized: boolean;
  recalculate: () => void;
  cssVariables: React.CSSProperties;
}

const DEFAULT_COLUMN_SIZING_INFO: ColumnSizingInfoState = {
  startOffset: null,
  startSize: null,
  deltaOffset: null,
  deltaPercentage: null,
  isResizingColumn: false,
  columnSizingStart: [],
};

export {
  calculateColumnWidths,
  getRemToPx,
  _invalidateRemToPxCache,
  getTruncationThreshold,
} from "../utils/column-sizing";

interface ResizingContext {
  columnId: string;
  startWidth: number;
  beforeResize: ColumnSizingState;
}

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
  // Core State (simplified from useReducer)
  // =========================================================================
  const [sizing, setSizing] = useState<ColumnSizingState>({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [columnSizingInfo, setColumnSizingInfo] = useState<ColumnSizingInfoState>(DEFAULT_COLUMN_SIZING_INFO);

  // Resizing context stored in ref (only needed during resize, not for render)
  const resizingContextRef = useRef<ResizingContext | null>(null);

  // =========================================================================
  // Content Width Measurement State
  // =========================================================================
  const [contentWidths, setContentWidths] = useState<Record<string, number>>({});
  const measuredDataLengthRef = useRef<number>(0);
  const prevPreferences = usePrevious(sizingPreferences);

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
  // Stable Refs
  // =========================================================================
  const minSizesRef = useSyncedRef(minSizes);
  const configuredSizesRef = useSyncedRef(configuredSizes);
  const sizingPreferencesRef = useSyncedRef(sizingPreferences);
  const contentWidthsRef = useSyncedRef(contentWidths);
  const onPreferenceChangeRef = useSyncedRef(onPreferenceChange);
  const sizingRef = useSyncedRef(sizing);
  const isResizingRef = useSyncedRef(isResizing);
  const columnSizingInfoRef = useSyncedRef(columnSizingInfo);

  // Other refs
  const lastContainerWidthRef = useRef<number>(0);
  const lastAutoFitRef = useRef<number>(0);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // RAF-throttled DOM update for 60fps performance during drag
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
    if (isResizing) return;

    for (const [colId, width] of Object.entries(sizing)) {
      const minWidth = minSizes[colId] ?? 0;
      const clampedWidth = Math.max(width, minWidth);
      table.style.setProperty(`--col-${colId}`, `${clampedWidth}px`);
    }
  }, [sizing, isResizing, tableRef, minSizes]);

  // Effect: Toggle is-resizing class
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    if (isResizing) {
      container.classList.add("is-resizing");
    } else {
      container.classList.remove("is-resizing");
    }
  }, [isResizing, containerRef]);

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
  // =========================================================================

  // Identify columns with NO_TRUNCATE preference
  const noTruncateColumnIds = useMemo(() => {
    return columnIds.filter((id) => {
      const pref = sizingPreferences[id];
      return pref?.mode === PreferenceModes.NO_TRUNCATE;
    });
  }, [columnIds, sizingPreferences]);

  // Measure NO_TRUNCATE columns when data arrives or changes
  useIsomorphicLayoutEffect(() => {
    const container = containerRef?.current;
    if (!container || dataLength === 0 || isLoading || noTruncateColumnIds.length === 0) {
      return;
    }

    if (measuredDataLengthRef.current === dataLength) {
      return;
    }
    measuredDataLengthRef.current = dataLength;

    const newWidths = measureMultipleColumns(container, noTruncateColumnIds);
    if (Object.keys(newWidths).length > 0) {
      setContentWidths((prev) => ({ ...prev, ...newWidths }));
    }
  }, [dataLength, isLoading, noTruncateColumnIds, containerRef]);

  // Track pending idle callback for cleanup
  const pendingIdleCallbackRef = useRef<number | ReturnType<typeof setTimeout> | null>(null);

  // Remeasure when a column becomes NO_TRUNCATE
  useEffect(() => {
    const container = containerRef?.current;
    const current = sizingPreferences;

    if (!container || !prevPreferences || dataLength === 0) {
      return;
    }

    const newNoTruncateColumns: string[] = [];
    for (const columnId of columnIds) {
      const prevMode = prevPreferences[columnId]?.mode;
      const currentMode = current[columnId]?.mode;
      if (currentMode === PreferenceModes.NO_TRUNCATE && prevMode !== PreferenceModes.NO_TRUNCATE) {
        if (!contentWidthsRef.current[columnId]) {
          newNoTruncateColumns.push(columnId);
        }
      }
    }

    if (newNoTruncateColumns.length === 0) {
      return;
    }

    const measureNewColumns = () => {
      pendingIdleCallbackRef.current = null;
      const containerEl = containerRef?.current;
      if (!containerEl) return;

      const newWidths = measureMultipleColumns(containerEl, newNoTruncateColumns);
      if (Object.keys(newWidths).length > 0) {
        setContentWidths((prev) => ({ ...prev, ...newWidths }));
      }
    };

    if (typeof requestIdleCallback !== "undefined") {
      pendingIdleCallbackRef.current = requestIdleCallback(measureNewColumns, { timeout: 500 });
    } else {
      // Safari fallback: Use RAF to ensure DOM measurement happens at optimal time
      // (after paint, before next frame) rather than arbitrary setTimeout timing
      pendingIdleCallbackRef.current = requestAnimationFrame(measureNewColumns) as unknown as ReturnType<
        typeof setTimeout
      >;
    }

    return () => {
      if (pendingIdleCallbackRef.current !== null) {
        if (typeof cancelIdleCallback !== "undefined" && typeof pendingIdleCallbackRef.current === "number") {
          cancelIdleCallback(pendingIdleCallbackRef.current);
        } else if (typeof cancelAnimationFrame !== "undefined") {
          // Safari fallback uses RAF, so cancel with cancelAnimationFrame
          cancelAnimationFrame(pendingIdleCallbackRef.current as number);
        } else {
          clearTimeout(pendingIdleCallbackRef.current as ReturnType<typeof setTimeout>);
        }
        pendingIdleCallbackRef.current = null;
      }
    };
  }, [sizingPreferences, columnIds, dataLength, containerRef, contentWidthsRef, prevPreferences]);

  // =========================================================================
  // Calculate Sizing
  // =========================================================================
  const calculateAndApply = useEventCallback((animate: boolean, providedWidth: number | undefined) => {
    const container = containerRef?.current;
    if (!container) return;

    const containerWidth = providedWidth ?? container.clientWidth;
    if (containerWidth <= 0) return;

    const newSizing = calculateColumnWidths(
      columnIds,
      containerWidth,
      minSizesRef.current,
      configuredSizesRef.current,
      sizingPreferencesRef.current,
      contentWidthsRef.current,
    );

    // Handle animation class
    if (animate && container) {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
      container.classList.add("is-transitioning");
      transitionTimeoutRef.current = setTimeout(() => {
        container.classList.remove("is-transitioning");
        transitionTimeoutRef.current = null;
      }, 150);
    }

    setSizing(newSizing);
    setIsInitialized(true);
  });

  // =========================================================================
  // Initial Sizing Effect
  // =========================================================================
  // Note: Initial sizing is handled by the ResizeObserver effect below.
  // The ResizeObserver fires immediately when observe() is called, providing
  // contentRect.width as the single source of truth for container width.
  // This eliminates potential discrepancies between clientWidth and contentRect.width.
  const columnSetKey = useMemo(() => [...columnIds].sort().join(","), [columnIds]);

  // When column set changes, trigger recalculation via ResizeObserver
  const prevColumnSetKey = usePrevious(columnSetKey);
  useEffect(() => {
    if (prevColumnSetKey !== undefined && prevColumnSetKey !== columnSetKey) {
      // Column set changed, ResizeObserver will recalculate on next observation
      // Force a recalculation by resetting the last width (next observation will trigger)
      lastContainerWidthRef.current = 0;
    }
  }, [columnSetKey, prevColumnSetKey]);

  // =========================================================================
  // Container Resize Effect
  // =========================================================================
  useEffect(() => {
    const container = containerRef?.current;
    if (!container) return;

    // Don't set lastContainerWidthRef here - let the first ResizeObserver callback
    // set it. This prevents stale initial values from blocking updates.
    let isFirstObservation = true;
    let timeoutId: ReturnType<typeof setTimeout>;
    let rafId: number | null = null;
    let pendingWidth: number | null = null;

    const observer = new ResizeObserver((entries) => {
      // Ignore container resize during user resize
      if (isResizingRef.current) return;

      const entry = entries[0];
      if (!entry) return;
      const newWidth = entry.contentRect.width;

      // On first observation, always recalculate to ensure correct sizing
      if (isFirstObservation) {
        isFirstObservation = false;
        lastContainerWidthRef.current = newWidth;
        // Use RAF for first observation to ensure layout is complete
        // This avoids setTimeout violations while ensuring DOM is ready
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(() => {
          rafId = null;
          calculateAndApply(false, newWidth);
        });
        return;
      }

      const widthDelta = Math.abs(newWidth - lastContainerWidthRef.current);
      if (widthDelta < 1) return;

      lastContainerWidthRef.current = newWidth;
      pendingWidth = newWidth;

      // Debounce subsequent resizes with setTimeout (acceptable since it's
      // user-driven resize, and we need the delay for debouncing)
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        calculateAndApply(true, pendingWidth ?? undefined);
        pendingWidth = null;
      }, resizeDebounceMs);
    });

    observer.observe(container);

    return () => {
      clearTimeout(timeoutId);
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [containerRef, calculateAndApply, resizeDebounceMs, isResizingRef]);

  // =========================================================================
  // Resize Control API
  // =========================================================================

  const startResize = useCallback(
    (columnId: string): number => {
      const currentSizing = sizingRef.current;
      const startWidth = currentSizing[columnId] ?? 150;

      // Store context for endResize
      resizingContextRef.current = {
        columnId,
        startWidth,
        beforeResize: { ...currentSizing },
      };

      // Update state
      setIsResizing(true);
      setColumnSizingInfo({
        startOffset: 0,
        startSize: startWidth,
        deltaOffset: 0,
        deltaPercentage: 0,
        isResizingColumn: columnId,
        columnSizingStart: [[columnId, startWidth]],
      });

      return startWidth;
    },
    [sizingRef],
  );

  const updateResize = useCallback(
    (columnId: string, newWidth: number) => {
      // Ignore if not resizing
      if (!isResizingRef.current) return;

      const minWidth = minSizesRef.current?.[columnId] ?? 0;
      const clampedWidth = Math.max(newWidth, minWidth);

      setSizing((prev) => {
        if (prev[columnId] === clampedWidth) return prev;
        return { ...prev, [columnId]: clampedWidth };
      });

      // RAF-throttled DOM update for 60fps
      scheduleColumnUpdate({ columnId, width: clampedWidth });
    },
    [isResizingRef, minSizesRef, scheduleColumnUpdate],
  );

  const endResize = useCallback(() => {
    cancelColumnUpdate();

    const finalSizing = sizingRef.current;
    const beforeResize = resizingContextRef.current?.beforeResize ?? {};

    // Reset state
    setIsResizing(false);
    setColumnSizingInfo(DEFAULT_COLUMN_SIZING_INFO);
    resizingContextRef.current = null;

    // Determine mode for each changed column
    const preferencesToPersist: Array<{ columnId: string; mode: PreferenceMode; width: number }> = [];
    const changes: Record<
      string,
      { from: number; to: number; mode: string; contentWidth: number; configuredWidth: number; threshold: number }
    > = {};
    const container = containerRef?.current;
    const newlyMeasuredWidths: Record<string, number> = {};

    for (const [colId, newWidth] of Object.entries(finalSizing)) {
      const oldWidth = beforeResize[colId];
      if (oldWidth !== undefined && oldWidth !== newWidth) {
        let contentWidth = contentWidthsRef.current[colId] ?? 0;

        if (contentWidth === 0 && container) {
          contentWidth = measureColumnContentWidth(container, colId);
          if (contentWidth > 0) {
            newlyMeasuredWidths[colId] = contentWidth;
          }
        }

        const configuredWidth = configuredSizesRef.current[colId] ?? 150;
        const threshold = getTruncationThreshold(contentWidth);
        const mode = newWidth < threshold ? PreferenceModes.TRUNCATE : PreferenceModes.NO_TRUNCATE;

        preferencesToPersist.push({ columnId: colId, mode, width: newWidth });
        changes[colId] = { from: oldWidth, to: newWidth, mode, contentWidth, configuredWidth, threshold };
      }
    }

    if (Object.keys(newlyMeasuredWidths).length > 0) {
      setContentWidths((prev) => ({ ...prev, ...newlyMeasuredWidths }));
    }

    // Persist preferences asynchronously
    const persistPreferences = () => {
      for (const pref of preferencesToPersist) {
        onPreferenceChangeRef.current?.(pref.columnId, { mode: pref.mode, width: pref.width });
      }
    };

    if (typeof requestIdleCallback !== "undefined") {
      requestIdleCallback(persistPreferences, { timeout: 1000 });
    } else {
      setTimeout(persistPreferences, 0);
    }
  }, [cancelColumnUpdate, sizingRef, containerRef, configuredSizesRef, contentWidthsRef, onPreferenceChangeRef]);

  // =========================================================================
  // Other Actions
  // =========================================================================

  const setColumnSize = useCallback(
    (columnId: string, size: number) => {
      // Ignore during resize
      if (isResizingRef.current) return;

      const minWidth = minSizesRef.current?.[columnId] ?? 0;
      const clampedSize = Math.max(size, minWidth);

      cancelColumnUpdate();
      setSizing((prev) => {
        if (prev[columnId] === clampedSize) return prev;
        return { ...prev, [columnId]: clampedSize };
      });

      const table = tableRef?.current;
      if (table) {
        table.style.setProperty(`--col-${columnId}`, `${clampedSize}px`);
      }
    },
    [isResizingRef, minSizesRef, cancelColumnUpdate, tableRef],
  );

  const autoFit = useCallback(
    (columnId: string, measuredWidth: number) => {
      // Ignore during resize
      if (isResizingRef.current) return;

      const minWidth = minSizesRef.current?.[columnId] ?? 0;
      const clampedSize = Math.max(measuredWidth, minWidth);

      lastAutoFitRef.current = Date.now();

      cancelColumnUpdate();
      setSizing((prev) => {
        if (prev[columnId] === clampedSize) return prev;
        return { ...prev, [columnId]: clampedSize };
      });

      const table = tableRef?.current;
      if (table) {
        table.style.setProperty(`--col-${columnId}`, `${clampedSize}px`);
      }

      setContentWidths((prev) => {
        if (prev[columnId] === clampedSize) return prev;
        return { ...prev, [columnId]: clampedSize };
      });

      onPreferenceChangeRef.current?.(columnId, {
        mode: PreferenceModes.NO_TRUNCATE,
        width: clampedSize,
      });
    },
    [isResizingRef, minSizesRef, cancelColumnUpdate, tableRef, onPreferenceChangeRef],
  );

  const recalculate = useEventCallback(() => {
    // Force recalculation by resetting the last known width.
    // The ResizeObserver will fire on the next frame and recalculate.
    // This ensures we use the same source of truth (contentRect.width) consistently.
    lastContainerWidthRef.current = 0;
    // Also trigger an immediate calculation using clientWidth as fallback
    // This provides immediate feedback while ResizeObserver catches up.
    calculateAndApply(false, undefined);
  });

  // =========================================================================
  // TanStack Compatibility Handlers
  // =========================================================================

  const onColumnSizingChange = useCallback(
    (updater: ColumnSizingState | ((old: ColumnSizingState) => ColumnSizingState)) => {
      // Cooldown after autoFit - ignore TanStack echo events
      const AUTO_FIT_COOLDOWN_MS = 100;
      const timeSinceAutoFit = Date.now() - lastAutoFitRef.current;
      if (timeSinceAutoFit < AUTO_FIT_COOLDOWN_MS) {
        return;
      }

      const currentSizing = sizingRef.current;
      const newSizing = typeof updater === "function" ? updater(currentSizing) : updater;

      setSizing(newSizing);

      // During resize, also update DOM via RAF
      if (isResizingRef.current) {
        for (const [columnId, width] of Object.entries(newSizing)) {
          if (currentSizing[columnId] !== width) {
            scheduleColumnUpdate({ columnId, width });
          }
        }
      }
    },
    [sizingRef, isResizingRef, scheduleColumnUpdate],
  );

  const onColumnSizingInfoChange = useCallback(
    (updater: ColumnSizingInfoState | ((old: ColumnSizingInfoState) => ColumnSizingInfoState)) => {
      const currentInfo = columnSizingInfoRef.current;
      const newInfo = typeof updater === "function" ? updater(currentInfo) : updater;

      // Handle TanStack starting resize
      if (!currentInfo.isResizingColumn && newInfo.isResizingColumn) {
        const columnId = String(newInfo.isResizingColumn);
        resizingContextRef.current = {
          columnId,
          startWidth: sizingRef.current[columnId] ?? 150,
          beforeResize: { ...sizingRef.current },
        };
        setIsResizing(true);
      }

      // Handle TanStack ending resize
      if (currentInfo.isResizingColumn && !newInfo.isResizingColumn) {
        setIsResizing(false);
        resizingContextRef.current = null;
      }

      setColumnSizingInfo(newInfo);
    },
    [columnSizingInfoRef, sizingRef],
  );

  // =========================================================================
  // CSS Variables (memoized for stable reference)
  // =========================================================================

  const cssVariables = useMemo((): React.CSSProperties => {
    const vars: Record<string, string> = {};
    for (const colId of columnIds) {
      const rawWidth = sizing[colId] ?? 150;
      const minWidth = minSizes?.[colId] ?? 0;
      const width = Math.max(rawWidth, minWidth);
      // Use Math.floor to prevent subpixel rounding from causing horizontal overflow
      // (cells have flexShrink: 0, so any cumulative rounding up causes overflow)
      vars[`--col-${colId}`] = `${Math.floor(width)}px`;
    }
    return vars as React.CSSProperties;
  }, [sizing, columnIds, minSizes]);

  // =========================================================================
  // Return API
  // =========================================================================

  return {
    columnSizing: sizing,
    onColumnSizingChange,
    columnSizingInfo,
    onColumnSizingInfoChange,
    startResize,
    updateResize,
    endResize,
    setColumnSize,
    autoFit,
    isInitialized,
    recalculate,
    cssVariables,
  };
}
