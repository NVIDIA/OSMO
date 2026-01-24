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
 * const wrapLines = useLogViewerStore((s) => s.wrapLines);
 * const toggleWrapLines = useLogViewerStore((s) => s.toggleWrapLines);
 * ```
 */

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// =============================================================================
// Types
// =============================================================================

interface LogViewerState {
  /** Whether to wrap long lines */
  wrapLines: boolean;
  /** Whether to show task suffix on log entries */
  showTask: boolean;
  /** Whether the timeline histogram is collapsed */
  timelineCollapsed: boolean;
}

interface LogViewerActions {
  /** Toggle line wrapping */
  toggleWrapLines: () => void;
  /** Toggle show task suffix */
  toggleShowTask: () => void;
  /** Toggle timeline histogram collapsed state */
  toggleTimelineCollapsed: () => void;
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
  wrapLines: false,
  showTask: true,
  timelineCollapsed: false,
};

// =============================================================================
// Store
// =============================================================================

export const useLogViewerStore = create<LogViewerStore>()(
  devtools(
    immer((set) => ({
      ...initialState,

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

      toggleTimelineCollapsed: () =>
        set(
          (state) => {
            state.timelineCollapsed = !state.timelineCollapsed;
          },
          false,
          "toggleTimelineCollapsed",
        ),

      reset: () =>
        set(
          () => ({
            wrapLines: false,
            showTask: true,
            timelineCollapsed: false,
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
