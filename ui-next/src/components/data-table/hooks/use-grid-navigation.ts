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
 * Grid Keyboard Navigation Hook
 *
 * Implements WCAG 2.1 compliant keyboard navigation for data grids.
 * Uses roving tabindex pattern - only one cell is tabbable at a time.
 *
 * Keyboard shortcuts:
 * - Arrow keys: Move between cells
 * - Home/End: First/last cell in row
 * - Ctrl+Home/End: First/last cell in grid
 * - Page Up/Down: Move by visible page
 * - Enter/Space: Activate cell (trigger row click)
 */

import { useState, useCallback, useMemo, useRef } from "react";

// =============================================================================
// Types
// =============================================================================

export interface GridPosition {
  row: number;
  col: number;
}

export interface UseGridNavigationOptions {
  /** Total number of rows in the grid */
  rowCount: number;
  /** Total number of columns */
  columnCount: number;
  /** Number of visible rows (for page up/down) */
  visibleRowCount?: number;
  /** Callback when a cell should be activated (Enter/Space) */
  onCellActivate?: (position: GridPosition) => void;
  /** Callback when focus position changes */
  onFocusChange?: (position: GridPosition) => void;
  /** Whether the grid is disabled */
  disabled?: boolean;
}

export interface UseGridNavigationResult {
  /** Current focused position */
  focusedPosition: GridPosition | null;
  /** Set focus to a specific cell */
  setFocusedPosition: (position: GridPosition | null) => void;
  /** Get tabIndex for a cell */
  getTabIndex: (row: number, col: number) => 0 | -1;
  /** Check if a cell is focused */
  isFocused: (row: number, col: number) => boolean;
  /** Keyboard event handler for the grid container */
  handleKeyDown: (e: React.KeyboardEvent) => void;
  /** Focus event handler for cells */
  handleCellFocus: (row: number, col: number) => void;
  /** Ref to attach to the grid container for focus management */
  gridRef: React.RefObject<HTMLElement | null>;
}

// =============================================================================
// Hook
// =============================================================================

export function useGridNavigation({
  rowCount,
  columnCount,
  visibleRowCount = 10,
  onCellActivate,
  onFocusChange,
  disabled = false,
}: UseGridNavigationOptions): UseGridNavigationResult {
  const [focusedPosition, setFocusedPositionState] = useState<GridPosition | null>(null);
  const gridRef = useRef<HTMLElement>(null);

  // Update focus position and notify
  const setFocusedPosition = useCallback(
    (position: GridPosition | null) => {
      setFocusedPositionState(position);
      if (position) {
        onFocusChange?.(position);
      }
    },
    [onFocusChange],
  );

  // Clamp position to valid range
  const clampPosition = useCallback(
    (pos: GridPosition): GridPosition => ({
      row: Math.max(0, Math.min(rowCount - 1, pos.row)),
      col: Math.max(0, Math.min(columnCount - 1, pos.col)),
    }),
    [rowCount, columnCount],
  );

  // Move focus in a direction
  const moveFocus = useCallback(
    (deltaRow: number, deltaCol: number) => {
      setFocusedPositionState((current) => {
        const from = current ?? { row: 0, col: 0 };
        const newPos = clampPosition({
          row: from.row + deltaRow,
          col: from.col + deltaCol,
        });
        onFocusChange?.(newPos);
        return newPos;
      });
    },
    [clampPosition, onFocusChange],
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled || rowCount === 0 || columnCount === 0) return;

      const current = focusedPosition ?? { row: 0, col: 0 };

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          moveFocus(-1, 0);
          break;

        case "ArrowDown":
          e.preventDefault();
          moveFocus(1, 0);
          break;

        case "ArrowLeft":
          e.preventDefault();
          moveFocus(0, -1);
          break;

        case "ArrowRight":
          e.preventDefault();
          moveFocus(0, 1);
          break;

        case "Home":
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+Home: First cell in grid
            setFocusedPosition({ row: 0, col: 0 });
          } else {
            // Home: First cell in row
            setFocusedPosition({ row: current.row, col: 0 });
          }
          break;

        case "End":
          e.preventDefault();
          if (e.ctrlKey || e.metaKey) {
            // Ctrl+End: Last cell in grid
            setFocusedPosition({ row: rowCount - 1, col: columnCount - 1 });
          } else {
            // End: Last cell in row
            setFocusedPosition({ row: current.row, col: columnCount - 1 });
          }
          break;

        case "PageUp":
          e.preventDefault();
          moveFocus(-visibleRowCount, 0);
          break;

        case "PageDown":
          e.preventDefault();
          moveFocus(visibleRowCount, 0);
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          if (focusedPosition) {
            onCellActivate?.(focusedPosition);
          }
          break;

        default:
          // Let other keys propagate
          return;
      }
    },
    [disabled, rowCount, columnCount, focusedPosition, moveFocus, setFocusedPosition, visibleRowCount, onCellActivate],
  );

  // Handle cell focus (when clicking or tabbing into a cell)
  const handleCellFocus = useCallback(
    (row: number, col: number) => {
      setFocusedPosition({ row, col });
    },
    [setFocusedPosition],
  );

  // Get tabIndex for a cell (roving tabindex pattern)
  const getTabIndex = useCallback(
    (row: number, col: number): 0 | -1 => {
      if (disabled) return -1;

      // If nothing focused, first cell is tabbable
      if (!focusedPosition) {
        return row === 0 && col === 0 ? 0 : -1;
      }

      // Focused cell is tabbable
      return row === focusedPosition.row && col === focusedPosition.col ? 0 : -1;
    },
    [focusedPosition, disabled],
  );

  // Check if cell is focused
  const isFocused = useCallback(
    (row: number, col: number): boolean => {
      if (!focusedPosition) return false;
      return row === focusedPosition.row && col === focusedPosition.col;
    },
    [focusedPosition],
  );

  return useMemo(
    () => ({
      focusedPosition,
      setFocusedPosition,
      getTabIndex,
      isFocused,
      handleKeyDown,
      handleCellFocus,
      gridRef,
    }),
    [focusedPosition, setFocusedPosition, getTabIndex, isFocused, handleKeyDown, handleCellFocus],
  );
}
