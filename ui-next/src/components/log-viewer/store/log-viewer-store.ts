// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Log Viewer Store
 *
 * Lightweight Zustand store for log viewer UI state.
 * NO persistence - state resets on navigation. Filters live in URL via nuqs.
 *
 * Usage:
 * ```ts
 * const expanded = useLogViewerStore((s) => s.expandedEntryIds);
 * const toggleExpand = useLogViewerStore((s) => s.toggleExpand);
 * ```
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// =============================================================================
// Types
// =============================================================================

interface LogViewerState {
  /** Set of expanded log entry IDs */
  expandedEntryIds: Set<string>;
  /** Whether live tailing is enabled */
  isTailing: boolean;
  /** Whether to wrap long lines */
  wrapLines: boolean;
  /** Currently focused entry ID (for keyboard navigation) */
  focusedEntryId: string | null;
}

interface LogViewerActions {
  /** Toggle expansion state of a log entry */
  toggleExpand: (id: string) => void;
  /** Expand a specific entry */
  expand: (id: string) => void;
  /** Collapse a specific entry */
  collapse: (id: string) => void;
  /** Collapse all entries */
  collapseAll: () => void;
  /** Set tailing enabled/disabled */
  setTailing: (enabled: boolean) => void;
  /** Toggle tailing on/off */
  toggleTailing: () => void;
  /** Set line wrapping */
  setWrapLines: (wrap: boolean) => void;
  /** Toggle line wrapping */
  toggleWrapLines: () => void;
  /** Set focused entry for keyboard navigation */
  setFocusedEntry: (id: string | null) => void;
  /** Reset store to initial state */
  reset: () => void;
}

export type LogViewerStore = LogViewerState & LogViewerActions;

// =============================================================================
// Initial State
// =============================================================================

/**
 * Default initial state.
 * Exported for testing - allows resetting store to known state.
 */
export const initialState: LogViewerState = {
  expandedEntryIds: new Set(),
  isTailing: false,
  wrapLines: false,
  focusedEntryId: null,
};

// =============================================================================
// Store
// =============================================================================

export const useLogViewerStore = create<LogViewerStore>()(
  devtools(
    immer((set) => ({
      ...initialState,

      toggleExpand: (id) =>
        set(
          (state) => {
            if (state.expandedEntryIds.has(id)) {
              state.expandedEntryIds.delete(id);
            } else {
              state.expandedEntryIds.add(id);
            }
          },
          false,
          "toggleExpand",
        ),

      expand: (id) =>
        set(
          (state) => {
            state.expandedEntryIds.add(id);
          },
          false,
          "expand",
        ),

      collapse: (id) =>
        set(
          (state) => {
            state.expandedEntryIds.delete(id);
          },
          false,
          "collapse",
        ),

      collapseAll: () =>
        set(
          (state) => {
            state.expandedEntryIds.clear();
          },
          false,
          "collapseAll",
        ),

      setTailing: (enabled) =>
        set(
          (state) => {
            state.isTailing = enabled;
          },
          false,
          "setTailing",
        ),

      toggleTailing: () =>
        set(
          (state) => {
            state.isTailing = !state.isTailing;
          },
          false,
          "toggleTailing",
        ),

      setWrapLines: (wrap) =>
        set(
          (state) => {
            state.wrapLines = wrap;
          },
          false,
          "setWrapLines",
        ),

      toggleWrapLines: () =>
        set(
          (state) => {
            state.wrapLines = !state.wrapLines;
          },
          false,
          "toggleWrapLines",
        ),

      setFocusedEntry: (id) =>
        set(
          (state) => {
            state.focusedEntryId = id;
          },
          false,
          "setFocusedEntry",
        ),

      reset: () =>
        set(
          () => ({
            expandedEntryIds: new Set(),
            isTailing: false,
            wrapLines: false,
            focusedEntryId: null,
          }),
          false,
          "reset",
        ),
    })),
    {
      name: "log-viewer",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
