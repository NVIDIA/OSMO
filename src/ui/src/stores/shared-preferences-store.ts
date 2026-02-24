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
 * Shared Preferences Store
 *
 * App-wide user preferences that apply across multiple pages and features.
 * Contains only truly global settings: display mode, compact mode, and sidebar state.
 *
 * Page-specific state lives in dedicated stores:
 * - Workflow detail panel: workflow-detail-panel-store.ts
 *
 * Uses Zustand with persistence to localStorage for consistent UX across pages.
 *
 * ## Hydration-Safe Usage (Recommended)
 *
 * For values used in initial render, use the hydration-safe hooks to prevent
 * hydration mismatches from localStorage vs server state differences:
 *
 * ```ts
 * // Hydration-safe - no server/client mismatch
 * const displayMode = useDisplayMode();
 * const compactMode = useCompactMode();
 * const sidebarOpen = useSidebarOpen();
 *
 * // For setters (always safe - actions don't affect initial render)
 * const toggleDisplayMode = useSharedPreferences((s) => s.toggleDisplayMode);
 * ```
 *
 * ## Direct Usage (for client-only components)
 *
 * Only use direct store access in components that are:
 * - Already wrapped with useMounted()/useIsHydrated()
 * - Never rendered during SSR
 *
 * ```ts
 * // Only in client-only contexts
 * const displayMode = useSharedPreferences((s) => s.displayMode);
 * ```
 */

import { create } from "zustand";
import { persist, devtools, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

// =============================================================================
// Types
// =============================================================================

export type DisplayMode = "free" | "used";

interface SharedPreferencesState {
  /** Display mode for capacity values: "free" shows available, "used" shows utilization */
  displayMode: DisplayMode;
  /** Whether tables use compact row height */
  compactMode: boolean;
  /** Whether the left navigation sidebar is open (expanded) or collapsed */
  sidebarOpen: boolean;
}

interface SharedPreferencesActions {
  /** Toggle between "free" and "used" display modes */
  toggleDisplayMode: () => void;
  /** Set display mode explicitly */
  setDisplayMode: (mode: DisplayMode) => void;
  /** Toggle compact mode on/off */
  toggleCompactMode: () => void;
  /** Set compact mode explicitly */
  setCompactMode: (compact: boolean) => void;
  /** Toggle sidebar open/collapsed state */
  toggleSidebarOpen: () => void;
  /** Set sidebar open state explicitly */
  setSidebarOpen: (open: boolean) => void;
  /** Reset to defaults */
  reset: () => void;
}

export type SharedPreferencesStore = SharedPreferencesState & SharedPreferencesActions;

// =============================================================================
// Initial State
// =============================================================================

/**
 * Default initial state for shared preferences.
 *
 * Exported for testing purposes - allows resetting store to known state.
 * @see https://zustand.docs.pmnd.rs/guides/testing
 */
export const initialState: SharedPreferencesState = {
  displayMode: "free",
  compactMode: false,
  sidebarOpen: true,
};

// =============================================================================
// Store
// =============================================================================

export const useSharedPreferences = create<SharedPreferencesStore>()(
  devtools(
    persist(
      immer((set) => ({
        ...initialState,

        toggleDisplayMode: () =>
          set(
            (state) => {
              state.displayMode = state.displayMode === "free" ? "used" : "free";
            },
            false,
            "toggleDisplayMode",
          ),

        setDisplayMode: (mode) =>
          set(
            (state) => {
              state.displayMode = mode;
            },
            false,
            "setDisplayMode",
          ),

        toggleCompactMode: () =>
          set(
            (state) => {
              state.compactMode = !state.compactMode;
            },
            false,
            "toggleCompactMode",
          ),

        setCompactMode: (compact) =>
          set(
            (state) => {
              state.compactMode = compact;
            },
            false,
            "setCompactMode",
          ),

        toggleSidebarOpen: () =>
          set(
            (state) => {
              state.sidebarOpen = !state.sidebarOpen;
            },
            false,
            "toggleSidebarOpen",
          ),

        setSidebarOpen: (open) =>
          set(
            (state) => {
              state.sidebarOpen = open;
            },
            false,
            "setSidebarOpen",
          ),

        reset: () => set(initialState, false, "reset"),
      })),
      {
        name: "shared-preferences",
        storage: createJSONStorage(() => localStorage),
        version: 4,
        migrate: (persistedState, version) => {
          const state = persistedState as Record<string, unknown>;

          // v1 -> v2: Migrate workflowDetailsView to dagVisible (legacy)
          if (version < 2) {
            delete state.workflowDetailsView;
          }

          // v2 -> v3: dagVisible to panelWidthPct (legacy, now removed)
          if (version < 3) {
            delete state.dagVisible;
          }

          // v3 -> v4: Remove panel state (moved to workflow-detail-panel-store)
          if (version < 4) {
            delete state.panelWidthPct;
            delete state.detailsExpanded;
            delete state.detailsPanelCollapsed;
          }

          return state as unknown as SharedPreferencesState;
        },
      },
    ),
    {
      name: "shared-preferences",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);
