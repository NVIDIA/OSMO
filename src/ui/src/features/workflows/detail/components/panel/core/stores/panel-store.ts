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
 * Workflow Detail Panel Store
 *
 * Persisted state for the workflow detail page's resizable panel.
 * Manages panel width and header details expansion.
 *
 * ## Collapsed State is Derived
 *
 * `panelCollapsed` is NOT stored -- it is derived from `panelWidthPct`
 * via the `isCollapsedWidth()` function from the panel resize state machine.
 * This ensures a single source of truth: the width IS the collapsed state.
 *
 * This store is scoped to the workflow detail page only. For app-wide
 * preferences (display mode, compact mode, sidebar), see shared-preferences-store.ts.
 *
 * ## Hydration-Safe Usage (Recommended)
 *
 * For values used in initial render, use the hydration-safe hooks to prevent
 * hydration mismatches from localStorage vs server state differences:
 *
 * ```ts
 * // Hydration-safe - no server/client mismatch
 * const panelWidthPct = usePanelWidthPct();
 * const panelCollapsed = usePanelCollapsed(); // derived from panelWidthPct
 * const detailsExpanded = useDetailsExpanded();
 *
 * // For setters (always safe - actions don't affect initial render)
 * const setPanelWidthPct = useWorkflowDetailPanel((s) => s.setPanelWidthPct);
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
 * const panelWidthPct = useWorkflowDetailPanel((s) => s.panelWidthPct);
 * ```
 */

import { create } from "zustand";
import { persist, devtools, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { createHydratedSelector } from "@/hooks/use-hydrated-store";
import { isCollapsedWidth } from "@/features/workflows/detail/components/panel/core/lib/panel-resize-state-machine";
import { PANEL_CONSTRAINTS } from "@/features/workflows/detail/components/panel/core/lib/panel-constants";

// =============================================================================
// Constants
// =============================================================================

/** Full width percentage (DAG hidden) */
const FULL_WIDTH_PCT = 100;

// =============================================================================
// Types
// =============================================================================

interface WorkflowDetailPanelState {
  /** Panel width as percentage of container (0-100) */
  panelWidthPct: number;
  /** Whether panel header details section is expanded */
  detailsExpanded: boolean;
}

interface WorkflowDetailPanelActions {
  /** Set panel width percentage */
  setPanelWidthPct: (pct: number) => void;
  /** Set details expanded state explicitly */
  setDetailsExpanded: (expanded: boolean) => void;
  /** Toggle details expanded state */
  toggleDetailsExpanded: () => void;
  /** Reset to defaults */
  reset: () => void;
}

export type WorkflowDetailPanelStore = WorkflowDetailPanelState & WorkflowDetailPanelActions;

// =============================================================================
// Initial State
// =============================================================================

/**
 * Default initial state for workflow detail panel.
 *
 * Exported for testing purposes - allows resetting store to known state.
 * @see https://zustand.docs.pmnd.rs/guides/testing
 */
export const initialState: WorkflowDetailPanelState = {
  panelWidthPct: PANEL_CONSTRAINTS.DEFAULT_PCT,
  detailsExpanded: false,
};

// =============================================================================
// Store
// =============================================================================

export const useWorkflowDetailPanel = create<WorkflowDetailPanelStore>()(
  devtools(
    persist(
      immer((set) => ({
        ...initialState,

        setPanelWidthPct: (pct) =>
          set(
            (state) => {
              state.panelWidthPct = pct;
            },
            false,
            "setPanelWidthPct",
          ),

        setDetailsExpanded: (expanded) =>
          set(
            (state) => {
              state.detailsExpanded = expanded;
            },
            false,
            "setDetailsExpanded",
          ),

        toggleDetailsExpanded: () =>
          set(
            (state) => {
              state.detailsExpanded = !state.detailsExpanded;
            },
            false,
            "toggleDetailsExpanded",
          ),

        reset: () => set(initialState, false, "reset"),
      })),
      {
        name: "workflow-detail-panel",
        storage: createJSONStorage(() => localStorage),
        version: 2,
        migrate: (persistedState: unknown, version: number) => {
          if (version < 2) {
            // v2: panelCollapsed is now derived from panelWidthPct via isCollapsedWidth().
            // Remove the old stored field so it doesn't linger in localStorage.
            const state = persistedState as Record<string, unknown>;
            delete state.panelCollapsed;
            return state;
          }
          return persistedState;
        },
      },
    ),
    {
      name: "workflow-detail-panel",
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
 * Hydration-safe panel width percentage selector.
 * Returns default (60%) during SSR, then actual value after hydration.
 */
export const usePanelWidthPct = createHydratedSelector<WorkflowDetailPanelStore, number>(
  useWorkflowDetailPanel,
  (s) => s.panelWidthPct,
  initialState.panelWidthPct,
);

/**
 * Hydration-safe panel collapsed state selector.
 * Derived from panelWidthPct using the SSOT function isCollapsedWidth().
 * Returns false during SSR, then actual derived value after hydration.
 */
export const usePanelCollapsed = createHydratedSelector<WorkflowDetailPanelStore, boolean>(
  useWorkflowDetailPanel,
  (s) => isCollapsedWidth(s.panelWidthPct),
  isCollapsedWidth(initialState.panelWidthPct),
);

/**
 * Hydration-safe details expanded state selector.
 * Returns false during SSR, then actual value after hydration.
 */
export const useDetailsExpanded = createHydratedSelector<WorkflowDetailPanelStore, boolean>(
  useWorkflowDetailPanel,
  (s) => s.detailsExpanded,
  initialState.detailsExpanded,
);

/**
 * Hydration-safe DAG visibility selector.
 * DAG is visible when panel width is less than 100%.
 * Returns true during SSR (matches initialState.panelWidthPct = 60 < 100).
 */
export const useDagVisible = createHydratedSelector<WorkflowDetailPanelStore, boolean>(
  useWorkflowDetailPanel,
  (s) => s.panelWidthPct < FULL_WIDTH_PCT,
  initialState.panelWidthPct < FULL_WIDTH_PCT, // true (60 < 100)
);
