/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Row Navigation Hook
 *
 * Implements keyboard navigation between rows in a data table.
 * Uses roving tabindex pattern - only one row is tabbable at a time.
 *
 * Keyboard shortcuts:
 * - Arrow Up/Down: Move between rows
 * - Home: First row
 * - End: Last row
 * - Page Up/Down: Move by visible page
 * - Enter/Space: Activate row (trigger click)
 */

import { useState, useCallback, useMemo, useRef, useEffect, useLayoutEffect } from "react";

// =============================================================================
// Types
// =============================================================================

export interface UseRowNavigationOptions {
  /** Total number of rows */
  rowCount: number;
  /** Number of visible rows (for page up/down) */
  visibleRowCount?: number;
  /** Callback when a row should be activated (Enter/Space) */
  onRowActivate?: (index: number) => void;
  /** Callback to scroll a row into view (with alignment based on direction) */
  onScrollToRow?: (index: number, align: "start" | "end" | "center") => void;
  /** Whether navigation is disabled */
  disabled?: boolean;
  /** Container element to search for rows (for focusing) */
  containerRef?: React.RefObject<HTMLElement | null>;
}

export interface UseRowNavigationResult {
  /** Current focused row index */
  focusedRowIndex: number | null;
  /** Set focus to a specific row */
  setFocusedRowIndex: (index: number | null) => void;
  /** Get tabIndex for a row (roving tabindex pattern) */
  getRowTabIndex: (index: number) => 0 | -1;
  /** Check if a row is focused */
  isRowFocused: (index: number) => boolean;
  /** Focus event handler for rows */
  handleRowFocus: (index: number) => void;
  /** Keyboard event handler for rows */
  handleRowKeyDown: (e: React.KeyboardEvent, currentIndex: number) => void;
}

// =============================================================================
// Hook
// =============================================================================

export function useRowNavigation({
  rowCount,
  visibleRowCount = 10,
  onRowActivate,
  onScrollToRow,
  disabled = false,
  containerRef,
}: UseRowNavigationOptions): UseRowNavigationResult {
  const [focusedRowIndex, setFocusedRowIndexState] = useState<number | null>(null);

  // Track the target row we want to focus (may not be in DOM yet due to virtualization)
  const pendingFocusRef = useRef<number | null>(null);
  const rafIdRef = useRef<number | null>(null);

  // Cleanup RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Clamp index to valid range
  const clampIndex = useCallback(
    (index: number): number => Math.max(0, Math.min(rowCount - 1, index)),
    [rowCount],
  );

  // Try to focus a row element by aria-rowindex
  const tryFocusRow = useCallback(
    (rowIndex: number): boolean => {
      const container = containerRef?.current;
      if (!container) return false;

      // aria-rowindex is 1-based, with header at 1, so data rows start at 2
      const ariaRowIndex = rowIndex + 2;
      const rowElement = container.querySelector<HTMLElement>(
        `[aria-rowindex="${ariaRowIndex}"]`
      );

      if (rowElement) {
        rowElement.focus();
        return true;
      }
      return false;
    },
    [containerRef],
  );

  // Effect to focus row after React commits DOM changes
  // useLayoutEffect runs synchronously after DOM mutations but before paint
  useLayoutEffect(() => {
    if (pendingFocusRef.current !== null) {
      const rowIndex = pendingFocusRef.current;

      // Try focusing immediately after commit
      if (tryFocusRow(rowIndex)) {
        pendingFocusRef.current = null;
        return;
      }

      // Row not in DOM yet - the virtualizer may need another frame to render
      // Use RAF to retry after the next paint
      const retry = (retriesLeft: number) => {
        if (retriesLeft <= 0) {
          pendingFocusRef.current = null;
          return;
        }

        if (tryFocusRow(rowIndex)) {
          pendingFocusRef.current = null;
          return;
        }

        rafIdRef.current = requestAnimationFrame(() => retry(retriesLeft - 1));
      };

      rafIdRef.current = requestAnimationFrame(() => retry(10));
    }
  }, [focusedRowIndex, tryFocusRow]);

  // Set focus and scroll into view (internal, with alignment)
  const navigateToRow = useCallback(
    (index: number | null, align: "start" | "end" | "center" = "center") => {
      if (index !== null && rowCount > 0) {
        const clamped = clampIndex(index);
        // Set the pending focus - useLayoutEffect will handle focusing after DOM commit
        pendingFocusRef.current = clamped;
        // Update state (triggers the useLayoutEffect)
        setFocusedRowIndexState(clamped);
        // Scroll the row into view
        onScrollToRow?.(clamped, align);
      } else {
        pendingFocusRef.current = null;
        setFocusedRowIndexState(null);
      }
    },
    [clampIndex, rowCount, onScrollToRow],
  );

  // Public setter (defaults to center alignment for API callers)
  const setFocusedRowIndex = useCallback(
    (index: number | null) => {
      navigateToRow(index, "center");
    },
    [navigateToRow],
  );

  // Handle row focus (when clicking or tabbing)
  const handleRowFocus = useCallback(
    (index: number) => {
      if (!disabled) {
        setFocusedRowIndexState(index);
      }
    },
    [disabled],
  );

  // Handle keyboard navigation on a row
  const handleRowKeyDown = useCallback(
    (e: React.KeyboardEvent, currentIndex: number) => {
      if (disabled || rowCount === 0) return;

      let handled = true;

      switch (e.key) {
        case "ArrowUp":
          // Going up - align to end so row is fully visible at bottom of scroll
          navigateToRow(currentIndex - 1, "end");
          break;

        case "ArrowDown":
          // Going down - align to start so row is fully visible at top of scroll
          navigateToRow(currentIndex + 1, "start");
          break;

        case "Home":
          navigateToRow(0, "start");
          break;

        case "End":
          navigateToRow(rowCount - 1, "end");
          break;

        case "PageUp":
          navigateToRow(currentIndex - visibleRowCount, "center");
          break;

        case "PageDown":
          navigateToRow(currentIndex + visibleRowCount, "center");
          break;

        case "Enter":
        case " ":
          onRowActivate?.(currentIndex);
          break;

        default:
          handled = false;
      }

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    [disabled, rowCount, visibleRowCount, navigateToRow, onRowActivate],
  );

  // Get tabIndex for a row (roving tabindex pattern)
  const getRowTabIndex = useCallback(
    (index: number): 0 | -1 => {
      if (disabled) return -1;

      // If nothing focused, first row is tabbable
      if (focusedRowIndex === null) {
        return index === 0 ? 0 : -1;
      }

      // Focused row is tabbable
      return index === focusedRowIndex ? 0 : -1;
    },
    [focusedRowIndex, disabled],
  );

  // Check if row is focused
  const isRowFocused = useCallback(
    (index: number): boolean => focusedRowIndex === index,
    [focusedRowIndex],
  );

  return useMemo(
    () => ({
      focusedRowIndex,
      setFocusedRowIndex,
      getRowTabIndex,
      isRowFocused,
      handleRowFocus,
      handleRowKeyDown,
    }),
    [
      focusedRowIndex,
      setFocusedRowIndex,
      getRowTabIndex,
      isRowFocused,
      handleRowFocus,
      handleRowKeyDown,
    ],
  );
}
