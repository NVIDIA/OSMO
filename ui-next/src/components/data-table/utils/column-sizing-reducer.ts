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
 * Column Sizing Reducer - State Machine
 *
 * Pure reducer for column sizing state management.
 * Extracted for testability and separation of concerns.
 *
 * ## States
 * - IDLE: No active user interaction
 * - RESIZING: User is actively dragging a column resize handle
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
 */

import type { ColumnSizingState, ColumnSizingInfoState } from "@tanstack/react-table";
import { SizingModes, SizingEventTypes, assertNever, type SizingMode } from "../constants";

// =============================================================================
// Types
// =============================================================================

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
// Constants
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
// Reducer Helpers
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
// Reducer
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
