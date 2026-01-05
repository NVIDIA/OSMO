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
 * Shared Preferences Store
 *
 * Global user preferences that apply across multiple features (pools, resources, etc.).
 * Uses Zustand with persistence to localStorage for consistent UX across pages.
 *
 * Usage:
 * ```ts
 * const displayMode = useSharedPreferences((s) => s.displayMode);
 * const toggleDisplayMode = useSharedPreferences((s) => s.toggleDisplayMode);
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
