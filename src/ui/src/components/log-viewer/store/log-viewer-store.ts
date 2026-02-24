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

type LogViewerStore = LogViewerState & LogViewerActions;

// =============================================================================
// Initial State
// =============================================================================

/**
 * Default initial state.
 * Exported for testing - allows resetting store to known state.
 */
const initialState: LogViewerState = {
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
