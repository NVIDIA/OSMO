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
 * Data Table Types
 *
 * Type definitions for the canonical DataTable component.
 * Built on TanStack Table with extensions for:
 * - Native <table> markup
 * - Virtualization
 * - Section grouping
 * - Sticky headers
 */

// =============================================================================
// Sort Types (shared with existing tables during migration)
// =============================================================================

export type SortDirection = "asc" | "desc";

export interface SortState<TColumnId extends string = string> {
  column: TColumnId | null;
  direction: SortDirection;
}

/**
 * Cycle sort state: asc -> desc -> none
 */
export function cycleSortState<TColumnId extends string>(
  current: SortState<TColumnId>,
  columnId: TColumnId,
): SortState<TColumnId> {
  if (current.column !== columnId) {
    return { column: columnId, direction: "asc" };
  }
  if (current.direction === "asc") {
    return { column: columnId, direction: "desc" };
  }
  return { column: null, direction: "asc" };
}

// =============================================================================
// Sort Button Props (shared component)
// =============================================================================

export interface SortButtonProps {
  /** Column identifier */
  id: string;
  /** Button label */
  label: string;
  /** Column alignment */
  align?: "left" | "right";
  /** Is sorting enabled for this column? */
  sortable?: boolean;
  /** Is this column currently sorted? */
  isActive: boolean;
  /** Current sort direction (only relevant if active) */
  direction?: SortDirection;
  /** Click handler */
  onSort: () => void;
}

// =============================================================================
// Sortable Cell Props (shared component)
// =============================================================================

export interface SortableCellProps {
  /** Column ID (used as DnD item ID) */
  id: string;
  /** Cell content */
  children: React.ReactNode;
  /** Additional class names */
  className?: string;
  /** Render as th or div */
  as?: "th" | "div";
  /** Column width in pixels */
  width?: number;
}

// =============================================================================
// Section Types (for grouped tables like pools)
// =============================================================================

/**
 * A section groups items together with a header.
 * Used for status-based grouping in pools table.
 */
export interface Section<T, TMetadata = unknown> {
  /** Unique section ID */
  id: string;
  /** Section header label */
  label: string;
  /** Items in this section */
  items: T[];
  /** Optional metadata for styling (e.g., status color) */
  metadata?: TMetadata;
}

// =============================================================================
// TanStack Table Types (to be expanded)
// =============================================================================

// These will be added as we implement the TanStack Table integration.
// For now, consumers should import types directly from @tanstack/react-table.
