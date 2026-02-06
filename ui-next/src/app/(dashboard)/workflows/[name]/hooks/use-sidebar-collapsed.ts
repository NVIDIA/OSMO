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
 * Hook for managing workflow details sidebar collapsed state.
 *
 * GLOBAL collapse/expand state (NOT per-node):
 * - User preference (Zustand shared-preferences store): Default collapsed state for workflow overview
 * - Session state: Single global collapsed state, NOT tied to specific nodes
 *
 * Behavior:
 * - Workflow view (no selection): Uses user preference from Zustand store
 * - Any navigation (node click OR URL change): Auto-expands panel
 * - User can manually collapse: Stays collapsed until next navigation
 * - Panel state is GLOBAL - no per-node memory
 * - Escape key: Collapses panel
 * - Enter key: Expands panel
 *
 * @param hasSelection - Whether there's an active group/task selection
 * @param selectionKey - Unique key for current selection (changes trigger auto-expand)
 */

"use client";

import { useState, useRef, useMemo } from "react";
import { useEventCallback, useIsomorphicLayoutEffect } from "usehooks-ts";
import { useSharedPreferences, initialState as sharedPreferencesInitialState } from "@/stores/shared-preferences-store";
import { useMounted } from "@/hooks/use-mounted";

// Module-level stable no-op function (created once, never changes)
const NOOP = () => {};

export interface UseSidebarCollapsedOptions {
  /** Whether there's an active group/task selection from URL */
  hasSelection: boolean;
  /** Unique key identifying the current selection (changes trigger auto-expand) */
  selectionKey: string | null;
  /** Whether DAG is visible (when false, panel is always expanded) */
  dagVisible: boolean;
}

export function useSidebarCollapsed({ hasSelection, selectionKey, dagVisible }: UseSidebarCollapsedOptions) {
  // User preference for default state (used when no selection)
  // Using Zustand shared preferences store for unified localStorage management
  const storePreferredCollapsed = useSharedPreferences((s) => s.detailsPanelCollapsed);
  const setPreferredCollapsed = useSharedPreferences((s) => s.setDetailsPanelCollapsed);
  const togglePreferredCollapsed = useSharedPreferences((s) => s.toggleDetailsPanelCollapsed);

  // SSR-safe hydration: Use default value until after mount to prevent hydration mismatch.
  // Zustand persist returns initial state on server but localStorage value on client,
  // which causes React hydration errors. We defer reading the persisted value until after mount.
  const mounted = useMounted();

  // Use initial state during SSR/first render, then switch to store value after hydration
  const preferredCollapsed = mounted ? storePreferredCollapsed : sharedPreferencesInitialState.detailsPanelCollapsed;

  // Global collapsed state - NOT tied to any specific node
  // This is the user's manual collapse action that persists until next navigation
  const [userCollapsed, setUserCollapsed] = useState(false);

  // Track whether we've navigated during this session (to distinguish initial load from back-navigation)
  const [hasNavigatedThisSession, setHasNavigatedThisSession] = useState(false);

  // Track previous selection key to detect navigation
  const prevSelectionKeyRef = useRef<string | null>(null);
  const prevHasSelectionRef = useRef<boolean>(hasSelection);

  // Auto-expand on ANY navigation (click or URL change)
  // Using layout effect to update state before render to avoid flicker
  useIsomorphicLayoutEffect(() => {
    // Detect if selection changed (navigation occurred)
    const prevKey = prevSelectionKeyRef.current;
    const prevHasSelection = prevHasSelectionRef.current;
    const navigationOccurred = selectionKey !== prevKey && selectionKey !== null;

    if (navigationOccurred) {
      // Any navigation auto-expands the panel
      setUserCollapsed(false);
      setHasNavigatedThisSession(true);
    }

    // When navigating BACK to workflow (from selection to no selection),
    // keep the panel expanded (don't snap back to preference)
    if (prevHasSelection && !hasSelection && hasNavigatedThisSession) {
      // We're navigating back to workflow view - keep panel expanded
      setUserCollapsed(false);
    }

    // Update refs for next comparison
    prevSelectionKeyRef.current = selectionKey;
    prevHasSelectionRef.current = hasSelection;
  }, [selectionKey, hasSelection, hasNavigatedThisSession]);

  // Determine which state to use: session state (userCollapsed) or preference
  // - Has selection OR has navigated this session → use session state
  // - Initial page load with no selection → use user preference (or table view override)
  // This single flag is used by both the derived state AND all action functions
  // to prevent drift between them.
  const usesSessionState = hasSelection || hasNavigatedThisSession;

  // Derive collapsed state from the appropriate source
  // In table view with no preference set, default to collapsed when showing workflow overview (no selection)
  // This gives more space for the table, since the workflow info is less critical
  // However, once the user sets a preference (by toggling), respect it even in table view
  const collapsed = usesSessionState ? userCollapsed : preferredCollapsed;

  // Toggle collapsed state - stable callback for memoized children
  const toggle = useEventCallback(() => {
    if (dagVisible && usesSessionState) {
      setUserCollapsed((prev) => !prev);
    } else if (dagVisible) {
      togglePreferredCollapsed();
    }
  });

  // Expand panel - stable callback for memoized children
  const expand = useEventCallback(() => {
    if (dagVisible && usesSessionState) {
      setUserCollapsed(false);
    } else if (dagVisible) {
      setPreferredCollapsed(false);
    }
  });

  // Collapse panel - stable callback for memoized children
  const collapse = useEventCallback(() => {
    if (dagVisible && usesSessionState) {
      setUserCollapsed(true);
    } else if (dagVisible) {
      setPreferredCollapsed(true);
    }
  });

  // Stable return value for fullWidth mode (DAG hidden)
  // Uses module-level NOOP to maintain referential stability
  const fullWidthReturn = useMemo(
    () => ({
      collapsed: false,
      toggle: NOOP,
      expand: NOOP,
      collapse: NOOP,
      preferredCollapsed: false,
      setPreferredCollapsed: NOOP,
    }),
    [],
  );

  // When DAG is hidden, panel is always expanded (full-width mode)
  if (!dagVisible) {
    return fullWidthReturn;
  }

  return {
    /** Current collapsed state (considering preference and navigation) */
    collapsed,
    /** Toggle collapsed state */
    toggle,
    /** Expand panel */
    expand,
    /** Collapse panel */
    collapse,
    /** User's preferred default state (for workflow overview) */
    preferredCollapsed,
    /** Update user preference directly */
    setPreferredCollapsed,
  };
}
