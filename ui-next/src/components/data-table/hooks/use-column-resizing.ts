// Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Unified Column Sizing Hook
 *
 * Single entry point for all column sizing functionality.
 *
 * ## Two-Tier Model
 *
 * ### Tier 1: Config (defined in code)
 * - `minWidthRem`: Absolute floor - user can NEVER go below this
 * - `share`: Default proportional share for space distribution
 *
 * ### Tier 2: User Override (persisted to localStorage)
 * - `minWidthPx`: User's set minimum (must be >= config min)
 * - `share`: Original share preserved (for proportional participation)
 *
 * ## Layout Algorithm
 *
 * 1. Every column meets min width first (effective min = override or config)
 * 2. Remaining space distributed by share until max (content-fit)
 * 3. Leftover space = whitespace on right
 * 4. Container < total min → horizontal scroll
 *
 * ## Resize Behavior
 *
 * - **Preview**: Clamped between config min and content-fit max
 * - **Commit**: Sets minWidthPx = dragged width, keeps original share
 * - **Result**: Column floor is set, but proportional growth continues
 */

import { useCallback, useRef, useMemo, useReducer, useLayoutEffect, useEffect, useState } from "react";
import { useStableValue } from "@/hooks";
import type { ColumnSizeConfig, ColumnOverride } from "../types";
import {
  getBaseFontSize,
  remToPx,
  resolveColumns,
  calculateColumnWidths,
  measureColumnContentWidth,
  measureAllColumns,
  generateCSSVariables,
  getColumnCSSVariable,
  getColumnCSSValue,
  DEFAULT_MEASUREMENT_PADDING,
  DRAG_OVERSHOOT_REM,
} from "../utils/column-sizing";

// =============================================================================
// Types
// =============================================================================

export interface UseUnifiedColumnSizingOptions {
  /** Column configs (rem-based) */
  columns: ColumnSizeConfig[];
  /** Scroll container ref */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Table element ref */
  tableRef: React.RefObject<HTMLTableElement | null>;
  /** Initial overrides (from persistence) */
  initialOverrides?: Record<string, ColumnOverride>;
  /** Callback when overrides change */
  onOverridesChange?: (overrides: Record<string, ColumnOverride>) => void;
  /** Measurement padding (default: 48px) */
  measurementPadding?: number;
}

export interface UseUnifiedColumnSizingResult {
  /** CSS variables for table style */
  cssVariables: React.CSSProperties;
  /** Get CSS var reference for a column */
  getColumnCSSValue: (columnId: string) => string;
  /** Computed widths in pixels */
  widths: Record<string, number>;
  /** Natural (content-fit) widths */
  naturalWidths: Record<string, number>;
  /** Whether any column has overrides */
  hasOverrides: boolean;
  /** Whether currently resizing */
  isResizing: boolean;

  /** Resize handlers (attach to ResizeHandle) */
  resize: {
    handlePointerDown: (e: React.PointerEvent, columnId: string) => void;
    handlePointerMove: (e: React.PointerEvent) => void;
    handlePointerUp: (e: React.PointerEvent) => void;
    handlePointerCancel: (e: React.PointerEvent) => void;
    handleDoubleClick: (columnId: string) => void;
  };

  /** Actions */
  actions: {
    autoFitColumn: (columnId: string) => void;
    resetColumn: (columnId: string) => void;
    resetAllColumns: () => void;
    measureNaturalWidths: () => void;
  };
}

// =============================================================================
// Reducer State
// =============================================================================

interface State {
  containerWidth: number;
  overrides: Record<string, ColumnOverride>;
  naturalWidths: Record<string, number>;
  resizingColumnId: string | null;
}

type Action =
  | { type: "SET_CONTAINER_WIDTH"; width: number }
  | { type: "SET_ALL_OVERRIDES"; overrides: Record<string, ColumnOverride> }
  | { type: "CLEAR_ALL_OVERRIDES" }
  | { type: "SYNC_EXTERNAL_OVERRIDES"; overrides: Record<string, ColumnOverride> }
  | { type: "SET_NATURAL_WIDTHS"; widths: Record<string, number> }
  | { type: "START_RESIZE"; columnId: string }
  | { type: "END_RESIZE" }
  // Combined action to batch overrides update with resize end (single render)
  | { type: "COMMIT_RESIZE"; overrides: Record<string, ColumnOverride> };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_CONTAINER_WIDTH":
      if (state.containerWidth === action.width) return state;
      return { ...state, containerWidth: action.width };

    case "SET_ALL_OVERRIDES":
      // Replace all overrides atomically (used when any column is resized)
      return { ...state, overrides: action.overrides };

    case "CLEAR_ALL_OVERRIDES":
      if (Object.keys(state.overrides).length === 0) return state;
      return { ...state, overrides: {} };

    case "SYNC_EXTERNAL_OVERRIDES": {
      // Used only for initial hydration from localStorage
      // Simply replace internal overrides with external values
      if (Object.keys(action.overrides).length === 0) return state;
      return { ...state, overrides: { ...action.overrides } };
    }

    case "SET_NATURAL_WIDTHS": {
      // Merge, keeping widest seen
      let changed = false;
      const merged = { ...state.naturalWidths };
      for (const [id, width] of Object.entries(action.widths)) {
        if (width > (merged[id] ?? 0)) {
          merged[id] = width;
          changed = true;
        }
      }
      return changed ? { ...state, naturalWidths: merged } : state;
    }

    case "START_RESIZE":
      if (state.resizingColumnId === action.columnId) return state;
      return { ...state, resizingColumnId: action.columnId };

    case "END_RESIZE":
      if (state.resizingColumnId === null) return state;
      return { ...state, resizingColumnId: null };

    case "COMMIT_RESIZE":
      // Batched action: set overrides and end resize in single state update
      return {
        ...state,
        overrides: action.overrides,
        resizingColumnId: null,
      };

    default:
      return state;
  }
}

// =============================================================================
// Drag State (ref for zero re-renders during drag)
// =============================================================================

interface DragState {
  columnId: string;
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startWidth: number;
  currentWidth: number;
  /** Config min (absolute floor for preview and commit) */
  minWidthPx: number;
  /** Content max (ceiling for preview) */
  maxWidthPx: number;
  /** Snapshot of ALL column widths at drag start */
  snapshotWidths: Record<string, number>;
  /** Snapshot of ALL column minWidthPx at drag start (for share recalculation) */
  snapshotMins: Record<string, number>;
}

// =============================================================================
// Hook
// =============================================================================

export function useUnifiedColumnSizing({
  columns,
  containerRef,
  tableRef,
  initialOverrides = {},
  onOverridesChange,
  measurementPadding = DEFAULT_MEASUREMENT_PADDING,
}: UseUnifiedColumnSizingOptions): UseUnifiedColumnSizingResult {
  // ===== State =====
  const [state, dispatch] = useReducer(reducer, {
    containerWidth: 0,
    overrides: initialOverrides,
    naturalWidths: {},
    resizingColumnId: null,
  });

  // ===== Stable Refs =====
  const columnsRef = useStableValue(columns);
  const stateRef = useStableValue(state);
  const onOverridesChangeRef = useStableValue(onOverridesChange);

  // baseFontSize is computed once and stored in state (not ref) so it can be read during render
  // This is the React-recommended pattern: refs cannot be read during render, but state can
  const [baseFontSize] = useState(() => getBaseFontSize());
  const dragRef = useRef<DragState | null>(null);

  // ===== Container Width Observation =====
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Initial measurement
    const initialWidth = container.clientWidth || container.offsetWidth;
    if (initialWidth > 0) {
      dispatch({ type: "SET_CONTAINER_WIDTH", width: initialWidth });
    }

    // Observe changes
    const observer = new ResizeObserver(([entry]) => {
      // Skip if currently resizing - prevents recalculation during drag
      if (stateRef.current.resizingColumnId) return;

      const width = entry.contentRect.width;
      if (width > 0) {
        dispatch({ type: "SET_CONTAINER_WIDTH", width });
      }
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef, stateRef]);

  // ===== Initial Natural Width Measurement =====
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table || columns.length === 0) return;

    // Measure immediately in layout effect (before paint)
    // This ensures columns are sized correctly before user sees them
    const measured = measureAllColumns(
      table,
      columns.map((c) => c.id),
      measurementPadding,
    );
    if (Object.keys(measured).length > 0) {
      dispatch({ type: "SET_NATURAL_WIDTHS", widths: measured });
    }
  }, [tableRef, columns, measurementPadding]);

  // ===== Sync External Overrides (Hydration Only) =====
  // This handles hydration timing: Zustand stores hydrate from localStorage
  // AFTER React's first render. We detect this by checking if our internal
  // state is empty but external has values (indicates hydration completed).
  // After hydration, the hook is the source of truth - we don't sync back.
  const hasHydratedRef = useRef(false);
  useEffect(() => {
    // Only sync once during hydration
    if (hasHydratedRef.current) return;

    // Skip if we're currently resizing
    if (stateRef.current.resizingColumnId) return;

    // Detect hydration: internal is empty but external has values
    const internalEmpty = Object.keys(stateRef.current.overrides).length === 0;
    const externalHasValues = Object.keys(initialOverrides).length > 0;

    if (internalEmpty && externalHasValues) {
      // Hydration detected - sync external overrides into internal state
      dispatch({ type: "SYNC_EXTERNAL_OVERRIDES", overrides: initialOverrides });
      hasHydratedRef.current = true;
    } else if (!internalEmpty) {
      // Internal already has values (either from initial prop or user interaction)
      // Mark as hydrated to prevent future syncs
      hasHydratedRef.current = true;
    }
  }, [initialOverrides, stateRef]);

  // ===== Derived: Resolved Columns & Widths =====
  const resolved = useMemo(
    () => resolveColumns(columns, state.overrides, state.naturalWidths, baseFontSize),
    [columns, state.overrides, state.naturalWidths, baseFontSize],
  );

  const widthsResult = useMemo(() => {
    if (resolved.length === 0) {
      return { widths: {}, totalWidth: 0, needsScroll: false, whitespace: 0 };
    }

    // Fallback container width for SSR/initial render
    let effectiveWidth = state.containerWidth;
    if (effectiveWidth <= 0) {
      const totalMin = resolved.reduce((sum, c) => sum + c.minWidthPx, 0);
      effectiveWidth =
        typeof window !== "undefined" ? Math.max(window.innerWidth - 100, totalMin) : Math.max(totalMin * 1.5, 1000);
    }

    return calculateColumnWidths(resolved, effectiveWidth);
  }, [resolved, state.containerWidth]);

  const widths = widthsResult.widths;
  const widthsRef = useStableValue(widths);

  // Pre-compute effective mins for all columns (used during resize)
  // This avoids expensive calculations during drag start
  const effectiveMins = useMemo(() => {
    const mins: Record<string, number> = {};
    for (const col of columns) {
      const override = state.overrides[col.id];
      mins[col.id] = override?.minWidthPx ?? remToPx(col.minWidthRem, baseFontSize);
    }
    return mins;
  }, [columns, state.overrides, baseFontSize]);

  const effectiveMinsRef = useStableValue(effectiveMins);

  const cssVariables = useMemo(() => generateCSSVariables(widths), [widths]);

  // ===== Helpers =====

  /** Get config min (absolute floor from code) */
  const getConfigMinPx = useCallback(
    (columnId: string): number => {
      const col = columnsRef.current.find((c) => c.id === columnId);
      return col ? remToPx(col.minWidthRem, baseFontSize) : 0;
    },
    [baseFontSize, columnsRef],
  );

  /** Measure a single column's content width */
  const measureColumn = useCallback(
    (columnId: string): number => {
      const table = tableRef.current;
      if (!table) return 0;
      return measureColumnContentWidth(columnId, table, measurementPadding);
    },
    [tableRef, measurementPadding],
  );

  /** Get actual rendered width from DOM */
  const getActualColumnWidth = useCallback(
    (columnId: string): number => {
      const table = tableRef.current;
      if (!table) return 0;

      const headerCell = table.querySelector(`th[data-column-id="${columnId}"]`) as HTMLElement | null;

      return headerCell?.offsetWidth || widthsRef.current[columnId] || 0;
    },
    [tableRef, widthsRef],
  );

  /** Update CSS variable directly on table element */
  const updateCSSVariable = useCallback(
    (columnId: string, width: number) => {
      const table = tableRef.current;
      if (table) {
        table.style.setProperty(getColumnCSSVariable(columnId), `${width}px`);
      }
    },
    [tableRef],
  );

  /**
   * Calculate new overrides when a column is resized.
   *
   * Key insight: Recalculate ALL shares so that proportional calculation
   * produces the SAME pixel widths for non-resized columns.
   *
   * Formula: share = (width - minWidthPx) / extraSpace
   * where extraSpace = totalWidth - totalMin
   */
  const calculateResizeOverrides = useCallback(
    (
      resizedColumnId: string,
      newWidth: number,
      snapshotWidths: Record<string, number>,
      snapshotMins: Record<string, number>,
    ): Record<string, ColumnOverride> => {
      const overrides: Record<string, ColumnOverride> = {};

      // Calculate new widths (resized column gets new width, others keep snapshot)
      const newWidths: Record<string, number> = { ...snapshotWidths };
      newWidths[resizedColumnId] = newWidth;

      // Calculate new mins (resized column gets new min, others keep snapshot)
      const newMins: Record<string, number> = { ...snapshotMins };
      newMins[resizedColumnId] = newWidth; // Resized column's min = new width

      // Calculate table totals
      const tableWidth = Object.values(newWidths).reduce((sum, w) => sum + w, 0);
      const totalMin = Object.values(newMins).reduce((sum, m) => sum + m, 0);
      const extraSpace = tableWidth - totalMin;

      // Calculate shares for each column
      for (const [colId, width] of Object.entries(newWidths)) {
        const minWidthPx = newMins[colId];
        const growth = Math.max(0, width - minWidthPx);
        // Share is proportional to growth (if no extra space, share = 0)
        const share = extraSpace > 0 ? growth / extraSpace : 0;
        overrides[colId] = { minWidthPx, share };
      }

      return overrides;
    },
    [],
  );

  /** Lock scroll during resize */
  const lockScroll = useCallback(() => {
    containerRef.current?.classList.add("is-resizing");
    document.body.style.cursor = "col-resize";
  }, [containerRef]);

  /** Unlock scroll after resize */
  const unlockScroll = useCallback(() => {
    containerRef.current?.classList.remove("is-resizing");
    document.body.style.cursor = "";
  }, [containerRef]);

  // ===== Resize Logic with Global Event Listeners =====
  // Using global listeners ensures we catch pointer events even when:
  // - Pointer moves too fast and leaves the element
  // - Pointer is released outside the window
  // - Window loses focus

  // Refs for cleanup functions (stable across renders)
  const removeGlobalListenersRef = useRef<(() => void) | null>(null);

  /** Commit the resize and clean up */
  const commitResize = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    // Clear drag ref first to prevent double-processing
    dragRef.current = null;

    // Remove global listeners
    removeGlobalListenersRef.current?.();

    // Release pointer capture
    try {
      drag.element.releasePointerCapture(drag.pointerId);
    } catch {
      // Ignore - might already be released
    }

    unlockScroll();

    // Clamp new width to min/max
    const newWidth = Math.max(drag.minWidthPx, Math.min(drag.maxWidthPx, Math.round(drag.currentWidth)));

    // Calculate new overrides for ALL columns:
    // - Resized column: minWidthPx = newWidth
    // - All columns: shares recalculated to preserve their pixel widths
    const newOverrides = calculateResizeOverrides(drag.columnId, newWidth, drag.snapshotWidths, drag.snapshotMins);

    // Batched dispatch: set overrides and end resize in single state update
    dispatch({ type: "COMMIT_RESIZE", overrides: newOverrides });

    // Notify parent
    queueMicrotask(() => {
      onOverridesChangeRef.current?.(newOverrides);
    });
  }, [unlockScroll, calculateResizeOverrides, onOverridesChangeRef]);

  /** Cancel the resize and restore original width */
  const cancelResize = useCallback(() => {
    const drag = dragRef.current;
    if (!drag) return;

    // Clear drag ref first to prevent double-processing
    dragRef.current = null;

    // Remove global listeners
    removeGlobalListenersRef.current?.();

    // Release pointer capture
    try {
      drag.element.releasePointerCapture(drag.pointerId);
    } catch {
      // Ignore
    }

    unlockScroll();
    updateCSSVariable(drag.columnId, drag.startWidth);
    dispatch({ type: "END_RESIZE" });
  }, [unlockScroll, updateCSSVariable]);

  /** Handle pointer movement (global listener) */
  const onPointerMoveGlobal = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      e.preventDefault();

      const delta = e.clientX - drag.startX;
      const unclamped = drag.startWidth + delta;
      const newWidth = Math.max(drag.minWidthPx, Math.min(drag.maxWidthPx, unclamped));

      if (newWidth !== drag.currentWidth) {
        drag.currentWidth = newWidth;
        updateCSSVariable(drag.columnId, newWidth);
      }
    },
    [updateCSSVariable],
  );

  /** Handle pointer up (global listener) */
  const onPointerUpGlobal = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      e.preventDefault();
      commitResize();
    },
    [commitResize],
  );

  /** Handle pointer cancel (global listener) */
  const onPointerCancelGlobal = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      cancelResize();
    },
    [cancelResize],
  );

  /** Handle window blur - cancel resize if window loses focus */
  const onWindowBlur = useCallback(() => {
    if (dragRef.current) {
      cancelResize();
    }
  }, [cancelResize]);

  /** Handle visibility change - cancel resize if tab becomes hidden */
  const onVisibilityChange = useCallback(() => {
    if (document.hidden && dragRef.current) {
      cancelResize();
    }
  }, [cancelResize]);

  /** Handle lost pointer capture - commit if released, cancel if interrupted */
  const onLostPointerCapture = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;

      // Check if pointer was released (no buttons pressed) vs capture lost while dragging
      // e.buttons === 0 means no mouse buttons are pressed = normal release
      // e.buttons > 0 means buttons still pressed = unexpected capture loss
      if (e.buttons === 0) {
        // Pointer was released - commit the resize
        commitResize();
      } else {
        // Capture lost while still dragging (e.g., system interrupt) - cancel
        cancelResize();
      }
    },
    [commitResize, cancelResize],
  );

  // ===== Global Event Listener Management =====

  const addGlobalListeners = useCallback(() => {
    // Add all global listeners for reliable event capture
    window.addEventListener("pointermove", onPointerMoveGlobal, { passive: false });
    window.addEventListener("pointerup", onPointerUpGlobal, { passive: false });
    window.addEventListener("pointercancel", onPointerCancelGlobal);
    window.addEventListener("lostpointercapture", onLostPointerCapture);
    window.addEventListener("blur", onWindowBlur);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // Store the cleanup function
    removeGlobalListenersRef.current = () => {
      window.removeEventListener("pointermove", onPointerMoveGlobal);
      window.removeEventListener("pointerup", onPointerUpGlobal);
      window.removeEventListener("pointercancel", onPointerCancelGlobal);
      window.removeEventListener("lostpointercapture", onLostPointerCapture);
      window.removeEventListener("blur", onWindowBlur);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      removeGlobalListenersRef.current = null;
    };
  }, [
    onPointerMoveGlobal,
    onPointerUpGlobal,
    onPointerCancelGlobal,
    onLostPointerCapture,
    onWindowBlur,
    onVisibilityChange,
  ]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      removeGlobalListenersRef.current?.();
      if (dragRef.current) {
        unlockScroll();
        dragRef.current = null;
      }
    };
  }, [unlockScroll]);

  // ===== Resize Handlers (exposed to ResizeHandle) =====

  const handlePointerDown = useCallback(
    (e: React.PointerEvent, columnId: string) => {
      // Prevent default to avoid text selection
      e.preventDefault();
      e.stopPropagation();

      const element = e.currentTarget as HTMLElement;
      const configMin = getConfigMinPx(columnId);
      const actualWidth = getActualColumnWidth(columnId);
      const startWidth = actualWidth > 0 ? actualWidth : configMin;

      // Fresh-measure the column to get accurate max width
      // (cached naturalWidths might be from when column was truncated)
      const freshMeasured = measureColumn(columnId);
      const contentMax = freshMeasured > 0 ? freshMeasured : Infinity;

      // For drag operations, allow overshooting content max by a small amount.
      // This gives users breathing room when manually resizing.
      // Double-click (auto-fit) still uses exact contentMax.
      const dragOvershootPx = remToPx(DRAG_OVERSHOOT_REM, baseFontSize);
      const dragMax = contentMax < Infinity ? contentMax + dragOvershootPx : Infinity;

      // Update naturalWidths cache with fresh measurement
      if (freshMeasured > 0) {
        dispatch({ type: "SET_NATURAL_WIDTHS", widths: { [columnId]: freshMeasured } });
      }

      // Fast: just copy pre-computed refs (O(1) object spreads, no loops)
      const snapshotWidths = { ...widthsRef.current };
      const snapshotMins = { ...effectiveMinsRef.current };

      // Store drag state
      dragRef.current = {
        columnId,
        pointerId: e.pointerId,
        element,
        startX: e.clientX,
        startWidth,
        currentWidth: startWidth,
        minWidthPx: configMin,
        maxWidthPx: dragMax,
        snapshotWidths,
        snapshotMins,
      };

      // Capture pointer to receive events even if pointer leaves element
      try {
        element.setPointerCapture(e.pointerId);
      } catch {
        // Some browsers don't support this, fallback to global listeners
      }

      // Add global listeners for reliable event capture
      addGlobalListeners();

      lockScroll();
      dispatch({ type: "START_RESIZE", columnId });
    },
    [
      getConfigMinPx,
      getActualColumnWidth,
      measureColumn,
      lockScroll,
      addGlobalListeners,
      baseFontSize,
      widthsRef,
      effectiveMinsRef,
    ],
  );

  // These are still exposed for component API but global listeners do the actual work
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Handled by global listener - this is just for completeness
      const drag = dragRef.current;
      if (!drag) return;

      const delta = e.clientX - drag.startX;
      const unclamped = drag.startWidth + delta;
      const newWidth = Math.max(drag.minWidthPx, Math.min(drag.maxWidthPx, unclamped));

      if (newWidth !== drag.currentWidth) {
        drag.currentWidth = newWidth;
        updateCSSVariable(drag.columnId, newWidth);
      }
    },
    [updateCSSVariable],
  );

  const handlePointerUp = useCallback(
    (_e: React.PointerEvent) => {
      // Global listener handles this, but commit here too for redundancy
      commitResize();
    },
    [commitResize],
  );

  const handlePointerCancel = useCallback(
    (_e: React.PointerEvent) => {
      // Global listener handles this, but cancel here too for redundancy
      cancelResize();
    },
    [cancelResize],
  );

  const handleDoubleClick = useCallback(
    (columnId: string) => {
      const contentWidth = measureColumn(columnId);
      if (contentWidth <= 0) return;

      // Update natural widths cache
      dispatch({ type: "SET_NATURAL_WIDTHS", widths: { [columnId]: contentWidth } });

      // Target = content-fit, clamped to config min
      const configMin = getConfigMinPx(columnId);
      const targetWidth = Math.max(contentWidth, configMin);
      const newWidth = Math.round(targetWidth);

      // Fast: just copy pre-computed refs (O(1) object spreads, no loops)
      const snapshotWidths = { ...widthsRef.current };
      const snapshotMins = { ...effectiveMinsRef.current };

      // Calculate new overrides with recalculated shares
      const newOverrides = calculateResizeOverrides(columnId, newWidth, snapshotWidths, snapshotMins);

      dispatch({ type: "SET_ALL_OVERRIDES", overrides: newOverrides });

      // Update CSS variable immediately for instant feedback
      updateCSSVariable(columnId, targetWidth);

      // Notify parent
      queueMicrotask(() => {
        onOverridesChangeRef.current?.(newOverrides);
      });
    },
    [
      measureColumn,
      getConfigMinPx,
      calculateResizeOverrides,
      updateCSSVariable,
      widthsRef,
      effectiveMinsRef,
      onOverridesChangeRef,
    ],
  );

  // ===== Actions =====

  const resetColumn = useCallback(
    (_columnId: string) => {
      // In the new model, resetting any column clears ALL overrides
      // because shares are interdependent - going back to proportional mode
      dispatch({ type: "CLEAR_ALL_OVERRIDES" });
      queueMicrotask(() => {
        onOverridesChangeRef.current?.({});
      });
    },
    [onOverridesChangeRef],
  );

  const resetAllColumns = useCallback(() => {
    dispatch({ type: "CLEAR_ALL_OVERRIDES" });
    queueMicrotask(() => {
      onOverridesChangeRef.current?.({});
    });
  }, [onOverridesChangeRef]);

  const measureNaturalWidths = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    const measured = measureAllColumns(
      table,
      columnsRef.current.map((c) => c.id),
      measurementPadding,
    );
    if (Object.keys(measured).length > 0) {
      dispatch({ type: "SET_NATURAL_WIDTHS", widths: measured });
    }
  }, [tableRef, measurementPadding, columnsRef]);

  // ===== Return =====

  return {
    cssVariables,
    getColumnCSSValue: useCallback((columnId: string) => getColumnCSSValue(columnId), []),
    widths,
    naturalWidths: state.naturalWidths,
    hasOverrides: Object.keys(state.overrides).length > 0,
    isResizing: state.resizingColumnId !== null,

    resize: {
      handlePointerDown,
      handlePointerMove,
      handlePointerUp,
      handlePointerCancel,
      handleDoubleClick,
    },

    actions: {
      autoFitColumn: handleDoubleClick,
      resetColumn,
      resetAllColumns,
      measureNaturalWidths,
    },
  };
}
