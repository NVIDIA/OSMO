/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared Preferences Store
 *
 * Global user preferences that apply across multiple features (pools, resources, etc.).
 * Uses Zustand with persistence to localStorage for consistent UX across pages.
 *
 * ## Hydration-Safe Usage (Recommended)
 *
 * For values used in initial render, use the hydration-safe hooks to prevent
 * hydration mismatches from localStorage vs server state differences:
 *
 * ```ts
 * // ✅ Hydration-safe - no server/client mismatch
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
 * // ⚠️ Only in client-only contexts
 * const displayMode = useSharedPreferences((s) => s.displayMode);
 * ```
 */

import { create } from "zustand";
import { persist, devtools, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createHydratedSelector } from "@/hooks/use-hydrated-store";

// =============================================================================
// Types
// =============================================================================

export type DisplayMode = "free" | "used";

export type WorkflowDetailsView = "dag" | "table";

/** Default panel width percentage (matches PANEL.DEFAULT_WIDTH_PCT) */
const DEFAULT_PANEL_WIDTH_PCT = 50;

interface SharedPreferencesState {
  /** Display mode for capacity values: "free" shows available, "used" shows utilization */
  displayMode: DisplayMode;
  /** Whether tables use compact row height */
  compactMode: boolean;
  /** Panel width as percentage of container (applies to workflow/pools/resources panels) */
  panelWidthPct: number;
  /** Whether panel header details are expanded (unified across workflow/group/task views) */
  detailsExpanded: boolean;
  /** Whether the left navigation sidebar is open (expanded) or collapsed */
  sidebarOpen: boolean;
  /** Whether the workflow details panel (right side) is collapsed by default */
  detailsPanelCollapsed: boolean;
  /** Workflow details view mode: "dag" shows DAG visualization, "table" shows table view */
  workflowDetailsView: WorkflowDetailsView;
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
  /** Set panel width percentage */
  setPanelWidthPct: (pct: number) => void;
  /** Toggle details expanded state */
  toggleDetailsExpanded: () => void;
  /** Set details expanded state explicitly */
  setDetailsExpanded: (expanded: boolean) => void;
  /** Toggle sidebar open/collapsed state */
  toggleSidebarOpen: () => void;
  /** Set sidebar open state explicitly */
  setSidebarOpen: (open: boolean) => void;
  /** Toggle details panel collapsed state */
  toggleDetailsPanelCollapsed: () => void;
  /** Set details panel collapsed state explicitly */
  setDetailsPanelCollapsed: (collapsed: boolean) => void;
  /** Toggle workflow details view between DAG and table */
  toggleWorkflowDetailsView: () => void;
  /** Set workflow details view explicitly */
  setWorkflowDetailsView: (view: WorkflowDetailsView) => void;
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
  panelWidthPct: DEFAULT_PANEL_WIDTH_PCT,
  detailsExpanded: false,
  sidebarOpen: true,
  detailsPanelCollapsed: false,
  workflowDetailsView: "dag",
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

        setPanelWidthPct: (pct) =>
          set(
            (state) => {
              state.panelWidthPct = pct;
            },
            false,
            "setPanelWidthPct",
          ),

        toggleDetailsExpanded: () =>
          set(
            (state) => {
              state.detailsExpanded = !state.detailsExpanded;
            },
            false,
            "toggleDetailsExpanded",
          ),

        setDetailsExpanded: (expanded) =>
          set(
            (state) => {
              state.detailsExpanded = expanded;
            },
            false,
            "setDetailsExpanded",
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

        toggleDetailsPanelCollapsed: () =>
          set(
            (state) => {
              state.detailsPanelCollapsed = !state.detailsPanelCollapsed;
            },
            false,
            "toggleDetailsPanelCollapsed",
          ),

        setDetailsPanelCollapsed: (collapsed) =>
          set(
            (state) => {
              state.detailsPanelCollapsed = collapsed;
            },
            false,
            "setDetailsPanelCollapsed",
          ),

        toggleWorkflowDetailsView: () =>
          set(
            (state) => {
              state.workflowDetailsView = state.workflowDetailsView === "dag" ? "table" : "dag";
            },
            false,
            "toggleWorkflowDetailsView",
          ),

        setWorkflowDetailsView: (view) =>
          set(
            (state) => {
              state.workflowDetailsView = view;
            },
            false,
            "setWorkflowDetailsView",
          ),

        reset: () => set(initialState, false, "reset"),
      })),
      {
        name: "shared-preferences",
        storage: createJSONStorage(() => localStorage),
      },
    ),
    {
      name: "shared-preferences",
      enabled: process.env.NODE_ENV === "development",
    },
  ),
);

// =============================================================================
// Hydration-Safe Selectors
// =============================================================================
//
// These hooks return the initial state during SSR and hydration, then switch
// to the actual persisted value after hydration completes. This prevents
// hydration mismatches from server rendering with defaults but client having
// localStorage values.
//
// Use these for any preference value that affects the initial render output.
// =============================================================================

/**
 * Hydration-safe display mode selector.
 * Returns "free" during SSR, then actual value after hydration.
 */
export const useDisplayMode = createHydratedSelector(
  useSharedPreferences,
  (s) => s.displayMode,
  initialState.displayMode,
);

/**
 * Hydration-safe compact mode selector.
 * Returns false during SSR, then actual value after hydration.
 */
export const useCompactMode = createHydratedSelector(
  useSharedPreferences,
  (s) => s.compactMode,
  initialState.compactMode,
);

/**
 * Hydration-safe sidebar open state selector.
 * Returns true during SSR, then actual value after hydration.
 */
export const useSidebarOpen = createHydratedSelector(
  useSharedPreferences,
  (s) => s.sidebarOpen,
  initialState.sidebarOpen,
);

/**
 * Hydration-safe details expanded state selector.
 * Returns false during SSR, then actual value after hydration.
 */
export const useDetailsExpanded = createHydratedSelector(
  useSharedPreferences,
  (s) => s.detailsExpanded,
  initialState.detailsExpanded,
);

/**
 * Hydration-safe details panel collapsed state selector.
 * Returns false during SSR, then actual value after hydration.
 */
export const useDetailsPanelCollapsed = createHydratedSelector(
  useSharedPreferences,
  (s) => s.detailsPanelCollapsed,
  initialState.detailsPanelCollapsed,
);

/**
 * Hydration-safe panel width percentage selector.
 * Returns default (50%) during SSR, then actual value after hydration.
 */
export const usePanelWidthPct = createHydratedSelector(
  useSharedPreferences,
  (s) => s.panelWidthPct,
  initialState.panelWidthPct,
);

/**
 * Hydration-safe workflow details view selector.
 * Returns "dag" during SSR, then actual value after hydration.
 */
export const useWorkflowDetailsView = createHydratedSelector(
  useSharedPreferences,
  (s) => s.workflowDetailsView,
  initialState.workflowDetailsView,
);
