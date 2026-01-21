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
import { enableMapSet } from "immer";

// Enable Immer's MapSet plugin for Set/Map support in state
enableMapSet();

// =============================================================================
// Types
// =============================================================================

interface LogViewerState {
  /** Set of expanded log entry IDs */
  expandedEntryIds: Set<string>;
  /**
   * Whether live mode is enabled (auto-scroll to bottom, fetch latest logs).
   *
   * In the upcoming time range selector, this will be true when end time = "NOW".
   * When user scrolls away from bottom, live mode is paused.
   * When user selects a historical time range, live mode is disabled.
   */
  isLiveMode: boolean;
  /** Whether to wrap long lines */
  wrapLines: boolean;
  /** Whether to show task suffix on log entries */
  showTask: boolean;
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
  /** Set live mode enabled/disabled */
  setLiveMode: (enabled: boolean) => void;
  /** Toggle live mode on/off */
  toggleLiveMode: () => void;
  /** Toggle line wrapping */
  toggleWrapLines: () => void;
  /** Toggle show task suffix */
  toggleShowTask: () => void;
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
  isLiveMode: false,
  wrapLines: false,
  showTask: true,
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

      setLiveMode: (enabled) =>
        set(
          (state) => {
            state.isLiveMode = enabled;
          },
          false,
          "setLiveMode",
        ),

      toggleLiveMode: () =>
        set(
          (state) => {
            state.isLiveMode = !state.isLiveMode;
          },
          false,
          "toggleLiveMode",
        ),

      toggleWrapLines: () =>
        set(
          (state) => {
            state.wrapLines = !state.wrapLines;
          },
          false,
          "toggleWrapLines",
        ),

      toggleShowTask: () =>
        set(
          (state) => {
            state.showTask = !state.showTask;
          },
          false,
          "toggleShowTask",
        ),

      reset: () =>
        set(
          () => ({
            expandedEntryIds: new Set(),
            isLiveMode: false,
            wrapLines: false,
            showTask: true,
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
